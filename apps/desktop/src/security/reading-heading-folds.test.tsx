import { expect, test } from "bun:test";

import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { parseReadingMarkdown } from "../client/canonical-parser";
import { createReadingHeadingFolds } from "../client/reading-heading-folds";
import type { ReadingHeadingProjection } from "../client/reading-heading-structure";
import { createReadingSearchRegistry } from "../client/reading-search-registry";

import {
  auditReadingContent,
  commonmarkContent,
  isControlledReadingElement,
} from "./commonmark-content";

/** Structural DOM + real renderer refs. Actual layout, keyboard and focus need WK. */
function host(
  tag: string,
  attrs: Record<string, string> = {},
  children: HTMLElement[] = []
) {
  const attributes = new Map(Object.entries(attrs));
  const element = {
    nodeType: 1,
    localName: tag,
    namespaceURI: "http://www.w3.org/1999/xhtml",
    isConnected: true,
    parentElement: null as HTMLElement | null,
    children,
    firstElementChild: children[0] ?? null,
    lastElementChild: children[children.length - 1] ?? null,
    childElementCount: children.length,
    textContent: "",
    get attributes() {
      return [...attributes].map(([name, value]) => ({ name, value }));
    },
    get className() {
      return attributes.get("class") ?? "";
    },
    get hidden() {
      return attributes.has("hidden");
    },
    set hidden(value: boolean) {
      if (value) attributes.set("hidden", "");
      else attributes.delete("hidden");
    },
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    querySelectorAll: () =>
      children.flatMap((child) => [child, ...child.querySelectorAll("*")]),
  } as unknown as HTMLElement;
  for (const child of children) Object.defineProperty(child, "parentElement", { value: element, writable: true, configurable: true });
  return element;
}
function setup() {
  const source =
    "\uFEFF# Parent\r\n\r\nintro\r\n\r\n## Child\r\n\r\ninside\r\n\r\n### Empty\r\n\r\n# Other\r\n\r\nelse\r\n";
  const projection: ReadingHeadingProjection = { blocks: [], sections: [] };
  const registry = createReadingSearchRegistry();
  const folds = createReadingHeadingFolds(projection, registry);
  const content = commonmarkContent(
    parseReadingMarkdown(source),
    source,
    undefined,
    undefined,
    registry,
    undefined,
    projection,
    folds
  );
  const cleanups: (() => void)[] = [];
  function mount(node: ReactNode): HTMLElement[] {
    if (Array.isArray(node)) return node.flatMap(mount);
    if (
      !isValidElement<{
        children?: ReactNode;
        ref?: (element: HTMLElement) => (() => void) | undefined;
        [key: string]: unknown;
      }>(node)
    )
      return [];
    if (typeof node.type !== "string")
      throw Error("Only host nodes in fixture");
    const attrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(node.props)) {
      if (
        key === "children" ||
        key === "ref" ||
        key.startsWith("on") ||
        value === undefined
      )
        continue;
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw Error("Unexpected host attribute");
      attrs[key === "className" ? "class" : key] = String(value);
    }
    const element = host(node.type, attrs, mount(node.props.children));
    if (typeof node.props.children === "string")
      element.textContent = node.props.children;
    const cleanup = node.props.ref?.(element);
    if (cleanup) cleanups.push(cleanup);
    return [element];
  }
  const article = host("article", {}, mount(content));
  expect(auditReadingContent(article).safe).toBe(true);
  expect(folds.bind(article)).toBe(true);
  const range = (index: number) =>
    ({
      startContainer: article.children[index],
      endContainer: article.children[index],
    }) as unknown as Range;
  return {
    source,
    content,
    article,
    projection,
    registry,
    folds,
    range,
    cleanups,
  };
}

test("real canonical renderer folds keep nodes and registry, nested choices and explicit reveal", () => {
  const { article, registry, folds, range, cleanups } = setup();
  const nodes = [...article.children] as HTMLElement[];
  const version = registry.version;
  let changes = 0;
  const release = folds.subscribe(() => changes++);
  folds.toggle(2);
  expect(
    [...article.children].map((node) => (node as HTMLElement).hidden)
  ).toEqual([false, false, false, true, true, false, false]);
  folds.toggle(0);
  expect(folds.presentation().visible).toEqual([nodes[0], nodes[5], nodes[6]]);
  expect(folds.visible(range(3))).toBe(false);
  folds.toggle(0);
  expect((nodes[3]).hidden).toBe(true);
  folds.toggle(0);
  folds.reveal(range(1));
  expect((nodes[3]).hidden).toBe(true); // child choice retained
  folds.reveal(range(3));
  expect(folds.visible(range(3))).toBe(true);
  expect(folds.presentation().visible).toBeUndefined();
  expect(auditReadingContent(article).safe).toBe(true);
  expect([...article.children]).toEqual(nodes);
  expect(registry.version).toBe(version);
  expect(changes).toBe(6);
  release();
  folds.bind(null);
  const revision = folds.presentation().revision;
  folds.toggle(0);
  folds.reveal(range(3));
  expect(folds.visible(range(3))).toBe(false);
  expect(folds.presentation().revision).toBe(revision);
  cleanups.forEach((cleanup) => cleanup());
  expect(registry.blocks()).toHaveLength(0);
});

test("owned controls are exact, spoofed or moved controls fail, fallback has no controls", () => {
  const { article, folds, registry, source } = setup();
  const button = article.children[0].firstElementChild as HTMLElement;
  const spoof = host(
    "button",
    Object.fromEntries(
      [...button.attributes].map(({ name, value }) => [name, value])
    )
  );
  expect(isControlledReadingElement(spoof)).toBe(false);
  const owner = button.parentElement!;
  Object.defineProperty(owner, "parentElement", { value: host("aside"), configurable: true });
  expect(auditReadingContent(article).safe).toBe(false);
  Object.defineProperty(owner, "parentElement", { value: article, configurable: true });
  button.setAttribute("onclick", "evil()");
  expect(auditReadingContent(article).safe).toBe(false);
  expect(folds.bind(host("article"))).toBe(false);
  const plain = renderToStaticMarkup(
    commonmarkContent(parseReadingMarkdown(source), source)
  );
  expect(plain).not.toContain("reading-heading-toggle");
  const projection: ReadingHeadingProjection = { blocks: [], sections: [] };
  const tree = parseReadingMarkdown("# Empty");
  const noBody = commonmarkContent(
    tree,
    "# Empty",
    undefined,
    undefined,
    registry,
    undefined,
    projection,
    createReadingHeadingFolds(projection, registry)
  );
  expect(renderToStaticMarkup(noBody)).not.toContain("reading-heading-toggle");
});
