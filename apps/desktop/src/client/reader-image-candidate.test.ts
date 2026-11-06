import { expect, test } from "bun:test";

import { parseReadingMarkdown } from "./canonical-parser";
import { readerImageCandidates } from "./reader-image-candidate";

test("selects the first exact occurrence and preserves original UTF-16 range including BOM", () => {
  const image = "![甲](<图%20像.%50NG>)";
  const text = `\uFEFF# 中文 📖\r\n\r\n${image} ![乙](<图%20像.%50NG>) ![丙](other.jpg)`;
  const tree = parseReadingMarkdown(text);
  const paragraph = tree.children[1];
  if (paragraph?.type !== "paragraph") throw new Error("missing image paragraph");
  const [first, , second] = paragraph.children;
  if (first?.type !== "image" || second?.type !== "image") throw new Error("missing image nodes");
  const candidates = readerImageCandidates(tree, text.length);
  const [candidate, duplicate] = candidates;
  expect(candidates).toHaveLength(2);
  expect(candidate?.node).toBe(first);
  expect(duplicate?.node).toBe(second);
  expect(duplicate?.reference).toBe(candidate?.reference);
  expect(candidate?.reference).toBe("图%20像.%50NG");
  expect(candidate?.from).toBe(text.indexOf(image));
  expect(text.slice(candidate?.from, candidate?.to)).toBe(image);
  expect(text.slice(duplicate?.from, duplicate?.to)).toBe("![乙](<图%20像.%50NG>)");
});

test("uses the first normalized definition without considering unused definitions or alternate bindings", () => {
  const text = "[unused]: unused.png\n\n![chosen][Photo] ![later](later.png)\n\n[photo]: ../outside.JpEg\n[PHOTO]: duplicate.png";
  const tree = parseReadingMarkdown(text);
  const [result, later] = readerImageCandidates(tree, text.length);
  expect(result?.node.type).toBe("imageReference");
  expect(result?.reference).toBe("../outside.JpEg");
  expect(text.slice(result?.from, result?.to)).toBe("![chosen][Photo]");
  expect(later?.reference).toBe("later.png");

  const remote = "![chosen][photo] ![later](later.png)\n\n[photo]: https://example.invalid/remote.jpg\n[PHOTO]: duplicate.png";
  expect(readerImageCandidates(parseReadingMarkdown(remote), remote.length).map(({ reference }) => reference)).toEqual(["later.png"]);
});

test("ignores code, raw HTML, unsupported sources, and clipped GFM table cells", () => {
  const text = [
    "`![inline](inline.png)`", "", "```", "![code](code.png)", "```", "",
    '<img src="raw.png">', "", "![net](https://example.invalid/net.jpg)",
    "![absolute](/absolute.png) ![wrong](vector.svg) ![fragment](fragment.png#x)", "",
    "| x |", "|---|", "| a | ![clipped](clipped.png) |", "",
    "> ![visible](visible.jpg)",
  ].join("\n");
  const [candidate] = readerImageCandidates(parseReadingMarkdown(text), text.length);
  expect(candidate?.reference).toBe("visible.jpg");
  expect(text.slice(candidate?.from, candidate?.to)).toBe("![visible](visible.jpg)");
  const inTable = "| x |\n|---|\n| ![shown](shown.jpeg) | ![clipped](clipped.png) |";
  expect(readerImageCandidates(parseReadingMarkdown(inTable), inTable.length).map(({ reference }) => reference)).toEqual(["shown.jpeg"]);
});

test("fails closed for invalid ranges and over-budget tree size or depth", () => {
  const text = "![first](a.png) ![second](b.png)";
  const tree = parseReadingMarkdown(text);
  expect(readerImageCandidates(tree, -1)).toEqual([]);
  expect(readerImageCandidates(tree, 1)).toEqual([]);
  const paragraph = tree.children[0];
  if (paragraph?.type !== "paragraph") throw new Error("missing image paragraph");
  const first = paragraph.children[0];
  if (first?.type !== "image") throw new Error("missing first image");
  first.position = undefined;
  expect(readerImageCandidates(tree, text.length)).toEqual([]);

  const budget = parseReadingMarkdown("![first](a.png)");
  const rule = { type: "thematicBreak" } as const;
  budget.children = budget.children.concat(Array<typeof rule>(99_997).fill(rule));
  expect(readerImageCandidates(budget, text.length)[0]?.reference).toBe("a.png");
  budget.children.push(rule);
  expect(readerImageCandidates(budget, text.length)).toEqual([]);

  const depth = parseReadingMarkdown("![first](a.png)");
  let nested: typeof depth.children[number] = rule;
  for (let index = 0; index < 128; index++) nested = { type: "blockquote", children: [nested] };
  depth.children.push(nested);
  expect(readerImageCandidates(depth, text.length)).toEqual([]);
});
