import { expect, test } from "bun:test";

import { collectReadingDom } from "./reading-search-dom";
import { projectReading } from "./reading-search-projection";
import { createReadingSearchRegistry } from "./reading-search-registry";

/** Structural DOM seam only; no assertion of browser layout/selection/paint. */
export function text(value: string): Text {
  return {
    nodeType: 3,
    data: value,
    length: value.length,
    nextSibling: null,
  } as unknown as Text;
}
export function element(
  tag: string,
  children: Node[] = [],
  classes = "",
  role = ""
): HTMLElement {
  for (let i = 0; i < children.length; i++)
    Object.defineProperty(children[i], "nextSibling", {
      value: children[i + 1] ?? null,
      configurable: true,
    });
  const value = {
    nodeType: 1,
    tagName: tag,
    firstChild: children[0] ?? null,
    nextSibling: null,
    isConnected: true,
    classList: {
      contains: (name: string) => classes.split(" ").includes(name),
    },
    getAttribute: (name: string) => (name === "role" ? role : null),
    contains: (node: Node): boolean =>
      node === (value as unknown) ||
      children.some(
        (child) =>
          child === node ||
          (child.nodeType === 1 && (child as HTMLElement).contains(node))
      ),
  };
  return value as unknown as HTMLElement;
}
function finish<T>(job: Generator<void, T>): T {
  let next = job.next();
  while (!next.done) next = job.next();
  return next.value;
}
test("private consumers: visible alt only, code body only, cross inline and explicit cell/object boundaries", () => {
  const alt = element("SPAN", [text("visible alt")]);
  const image = element("SPAN", [text("图片等待加载"), alt], "reading-image");
  const paragraph = element("P", [
    text("ab"),
    element("STRONG", [text("cd")]),
    text("ef"),
    image,
    text("tail"),
  ]);
  const code = element("DIV", [
    element("SPAN", [text("js")], "reading-code-language"),
    element("PRE", [element("CODE", [text("a  b\r\nc")])]),
  ]);
  const table = element("TABLE", [
    element("TR", [
      element("TD", [text("left")]),
      element("TD", [text("right")]),
    ]),
  ]);
  const block = element("DIV", [paragraph, code, table]);
  const registry = createReadingSearchRegistry();
  registry.mount(block, { kind: "block", id: 0 });
  registry.mount(image, { kind: "image", alt });
  const snapshot = finish(collectReadingDom(block, registry));
  const p = finish(projectReading(snapshot.leaves, 10000));
  expect(p.text).toContain("abcdef");
  expect(p.text).toContain("visible alt");
  expect(p.text).not.toContain("图片等待加载");
  expect(p.text).not.toContain("js");
  expect(p.text).toContain("a  b\nc");
  expect(p.text).not.toContain("leftright");
  registry.mount(image, { kind: "image", alt: null });
  const ready = finish(
    projectReading(finish(collectReadingDom(block, registry)).leaves, 10000)
  );
  expect(ready.text).not.toContain("visible alt");
  expect(ready.text).not.toContain("abcdeftail");
});
test("unregistered dynamic host is pending, not an apparently complete empty result", () => {
  const html = element("DIV", [], "reading-html"),
    block = element("DIV", [html]);
  const registry = createReadingSearchRegistry();
  registry.mount(block, { kind: "block", id: 0 });
  expect(() => finish(collectReadingDom(block, registry))).toThrow("尚未就绪");
});
test("HTML privately-owned fragment uses actual tree, fallback status remains excluded", () => {
  const html = element(
    "DIV",
    [element("P", [text("safe "), element("EM", [text("HTML")])])],
    "reading-html"
  );
  const raw = element("PRE", [text("<iframe>\r\nx\r\n</iframe>")]);
  const block = element("DIV", [
    html,
    element("P", [text("App reason")], "", "status"),
    raw,
  ]);
  const registry = createReadingSearchRegistry();
  registry.mount(block, { kind: "block", id: 0 });
  registry.mount(html, { kind: "html", mode: "sanitized" });
  registry.mount(raw, { kind: "html", mode: "source" });
  const result = finish(
    projectReading(finish(collectReadingDom(block, registry)).leaves, 10000)
  );
  expect(result.text).toContain("safe HTML");
  expect(result.text).toContain("<iframe>\nx\n</iframe>");
  expect(result.text).not.toContain("App reason");
});
