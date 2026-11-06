import { expect, test } from "bun:test";

import { MAX_DOCUMENT_BYTES } from "../shared/documents";

import { copyReadingSelection, projectReadingSelection } from "./reading-selection-copy";

function leaf(data: string) {
  return {
    nodeType: 3, parentNode: null, nextSibling: null, length: data.length,
    substringData: (from: number, length: number) => data.slice(from, from + length),
  } as unknown as Text;
}

function element(localName: string, children: Node[] = [], classes: string[] = [], role?: string): HTMLElement {
  const value = {
    nodeType: 1, localName, parentNode: null, nextSibling: null, firstChild: children[0] ?? null,
    childNodes: { item: (index: number) => children[index] ?? null, length: children.length },
    namespaceURI: "http://www.w3.org/1999/xhtml", isConnected: true, classList: classes,
    getAttribute: (name: string) => name === "role" ? role : "private-attribute",
    contains(node: Node) {
      for (let candidate: Node | null = node; candidate; candidate = candidate.parentNode)
        if (candidate === root) return true;
      return false;
    },
  };
  const root = value as unknown as HTMLElement;
  // The projector only needs membership for its exact controlled CSS classes.
  Object.assign(classes, { contains: (name: string) => classes.includes(name) });
  children.forEach((child, index) => Object.assign(child, {
    parentNode: root, nextSibling: children[index + 1] ?? null,
  }));
  return root;
}

function range(startContainer: Node, startOffset: number, endContainer: Node, endOffset: number) {
  return { startContainer, startOffset, endContainer, endOffset, intersectsNode: () => true };
}

test("copies only the selected text with static formatting and literal code whitespace", () => {
  const start = leaf("before A  ");
  const end = leaf("  a\r\n    b <tag> after");
  const root = element("article", [
    element("div", [element("p", [start, element("strong", [leaf("B & C")]), leaf(" / "), element("span", [leaf("link name")])])]),
    element("div", [
      element("span", [leaf("javascript")], ["reading-code-language"]),
      element("button", [leaf("复制")]),
      element("pre", [element("code", [end])]),
      element("p", [leaf("已复制")], [], "status"),
    ]),
    element("p", [leaf("outside")]),
  ]);
  expect(projectReadingSelection(root, range(start, 7, end, 17))).toEqual({
    text: "A B & C / link name\n  a\r\n    b <tag> ",
    html: "<p>A  <strong>B &amp; C</strong> / link name</p><pre><code>  a\r\n    b &lt;tag&gt; </code></pre>",
  });
});

test("rich size refusal preserves complete plain text, and plain overflow has no partial result", () => {
  const content = "<&>".repeat(30_000);
  const root = element("article", [element("p", [leaf(content)])]);
  expect(projectReadingSelection(root, range(root, 0, root, 1))).toEqual({ text: content });
  const oversized = element("article", [leaf("a".repeat(MAX_DOCUMENT_BYTES + 1))]);
  expect(projectReadingSelection(oversized, range(oversized, 0, oversized, 1))).toBeUndefined();
});

test("an owned image placeholder contributes its visible alt without app status or a resource", () => {
  const alt = element("span", [leaf("visible alt")]);
  const image = element("span", [leaf("图片尚未加载："), alt]);
  const root = element("article", [element("p", [image])]);
  expect(projectReadingSelection(root, range(root, 0, root, 1), {
    get: (node) => node === image ? { kind: "image", alt } : undefined,
  })).toEqual({ text: "visible alt", html: "<p>visible alt</p>" });
});

test("native copy clips full-page ranges to the article and writes two MIME values", () => {
  const root = element("article", [element("strong", [leaf("only content")])]);
  const outside = leaf("toolbar");
  const original = {
    ...range(outside, 0, outside, 7),
    collapsed: false,
    cloneRange() { return { ...this }; },
    setStart(node: Node, offset: number) { this.startContainer = node; this.startOffset = offset; },
    setEnd(node: Node, offset: number) { this.endContainer = node; this.endOffset = offset; },
  };
  Object.defineProperty(root, "ownerDocument", { value: {
    activeElement: null, getSelection: () => ({ rangeCount: 1, isCollapsed: false, getRangeAt: () => original }),
  } });
  const data = new Map<string, string>();
  let prevented = false;
  const event = {
    isTrusted: true, target: null, preventDefault: () => { prevented = true; },
    clipboardData: { clearData: () => data.clear(), setData: (type: string, value: string) => data.set(type, value) },
  } as unknown as ClipboardEvent;
  expect(copyReadingSelection(event, root)).toBe("rich");
  expect(prevented).toBe(true);
  expect([...data]).toEqual([["text/plain", "only content"], ["text/html", "<strong>only content</strong>"]]);
  expect(copyReadingSelection({ ...event, isTrusted: false }, root)).toBe("ignored");
});
