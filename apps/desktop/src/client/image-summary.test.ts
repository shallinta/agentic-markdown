import { expect, test } from "bun:test";

import { normalizeIdentifier } from "micromark-util-normalize-identifier";

import { parseEditingMarkdown as parseCanonicalMarkdown } from "./canonical-parser";
import { currentImageCandidates } from "./editing-images";
import { summarizeImages } from "./image-summary";
import { validateImageSummary } from "./image-summary-protocol";
import { editorOffset, editorText, createRawEditorState } from "./raw-buffer";

const samples = [
  "![cat](cat.png)",
  "before ![cat](cat.png) after",
  "**![cat](cat.png)**",
  "> ![cat](cat.png)",
  "- ![cat](cat.png)",
  "![cat](<my cat.png>)",
  "![cat](a(b).png)",
  "![cat](a\\(b\\).png)",
  '![a &amp; b](a&amp;b.png "t &amp; x")',
  "![a **bold** and `code`](a.png)",
  '![cat](a.png "a title")',
  '![cat][ID]\n\n[id]: a.png "title"',
  "![cat][]\n\n[cat]: a.png",
  "![cat]\n\n[cat]: a.png",
  "![cat][missing]",
  "![cat][id]\n\n" + "ordinary\n\n".repeat(100) + "[id]: a.png",
  "![cat][id]\n\n" + "ordinary\n\n".repeat(100),
  "![cat][id]\n\n[id]: first.png\n[id]: second.png",
  "![cat][a  B]\n\n[A b]: first.png",
  "`![cat](a.png)`\n\n~~~\n![cat](b.png)\n~~~",
  "<div>\n![cat](a.png)\n</div>",
  "![a\nb](a.png)",
  "> ![a\n> b](a.png)",
  "- ![a\n  b](a.png)",
  '![cat](a.png\n "title")',
  "\ufeffbefore\r\n\r\n![a\rb](a.png)\r\n",
  "![cat](a.png",
  "[![cat](a.png)](target.md)",
  "![a](a.png) ![b](b.jpg)",
  "![~~gone~~](a.png)",
  "![a [b][id]](a.png)\n\n[id]: b.md",
  "![a [b][id]](a.png)",
  "![a [b][]](a.png)\n\n[b]: b.md",
  "> ![a\n>\tb](a.png)",
  "![a](a.png)\n\n![a](a.png)",
  "\ufeff![a](a.png)\r\n\r\n![b][id]\r\n\r\n[id]: b.jpg",
  "![a [b]](a.png)\n\n[b]: b.md",
];
type Node = ReturnType<typeof parseCanonicalMarkdown>;
function oracle(raw: string) {
  const tree = parseCanonicalMarkdown(raw),
    definitions = new Map<string, { url: string; title?: string | null }>(),
    images: {
      from: number;
      to: number;
      rawFrom: number;
      rawTo: number;
      alt: string;
      url: string;
      title: string | null;
    }[] = [];
  const visit = (
    node: Node | Node["children"][number],
    fn: (node: Node | Node["children"][number]) => void
  ) => {
    fn(node);
    if ("children" in node) for (const child of node.children) visit(child, fn);
  };
  visit(tree, (node) => {
    if (
      node.type === "definition" &&
      !definitions.has(normalizeIdentifier(node.identifier))
    )
      definitions.set(normalizeIdentifier(node.identifier), node);
  });
  visit(tree, (node) => {
    if (node.type !== "image" && node.type !== "imageReference") return;
    const source =
      node.type === "image"
        ? node
        : definitions.get(normalizeIdentifier(node.identifier));
    if (!source) return;
    const rawFrom = node.position!.start.offset!,
      rawTo = node.position!.end.offset!;
    images.push({
      from: editorOffset(raw, rawFrom),
      to: editorOffset(raw, rawTo),
      rawFrom,
      rawTo,
      alt: node.alt ?? "",
      url: source.url,
      title: source.title ?? null,
    });
  });
  return images;
}
for (const [index, raw] of samples.entries())
  test(`image summary frozen semantic ${index + 1}`, () => {
    const summary = summarizeImages(raw);
    expect(
      summary.images.map(({ source, ...image }) => ({
        ...image,
        ...summary.sources[source],
      }))
    ).toEqual(oracle(raw));
    const validator = validateImageSummary(
      summary,
      raw.length,
      editorText(raw).length
    );
    let result = validator.next();
    while (!result.done) result = validator.next();
    expect(result.value).toBe(true);
    const state = createRawEditorState(raw);
    expect(
      currentImageCandidates(
        state,
        summary,
        [{ from: 0, to: state.doc.length }],
        new Set()
      )
    ).toEqual(summary.images);
  });
test("long reference source values are shared, and first definition wins", () => {
  const url = "x".repeat(10000) + ".png",
    raw = "![a][id]\n\n".repeat(1000) + `[id]: ${url} "title"\n[id]: wrong.png`;
  const summary = summarizeImages(raw);
  expect(summary.sources).toEqual([{ url, title: "title" }]);
  expect(summary.images).toHaveLength(1000);
  expect(summary.images.every((image) => image.source === 0)).toBe(true);
  expect(JSON.stringify(summary).length).toBeLessThan(160000);
});
test("protocol rejects excess result units, invalid ranges and indexes", () => {
  for (const summary of [
    { sources: [{ url: "x".repeat(30), title: null }], images: [] },
    {
      sources: [],
      images: [{ from: 0, to: 1, rawFrom: 0, rawTo: 1, source: 0, alt: "" }],
    },
  ]) {
    const iterator = validateImageSummary(summary, 10, 10);
    let result = iterator.next();
    while (!result.done) result = iterator.next();
    expect(result.value).toBe(false);
  }
});
