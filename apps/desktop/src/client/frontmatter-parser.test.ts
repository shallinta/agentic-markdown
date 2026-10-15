import { expect, test } from "bun:test";

import { syntaxTree } from "@codemirror/language";
import { TreeFragment, type Tree } from "@lezer/common";

import { BomAwareParser } from "./bom-aware-parser";
import { parseEditingMarkdown, parseReadingMarkdown } from "./canonical-parser";
import { summarizeImages } from "./image-summary";
import { documentMarkdownParser, markdownGrammar } from "./markdown-grammar";
import { encodeMarkdownTree, decodeMarkdownTree } from "./markdown-tree-wire";
import { createRawEditorState, rawText } from "./raw-buffer";

function nodes(tree: Tree) {
  const output: [string, number, number][] = [];
  tree.iterate({
    enter(node) {
      output.push([node.name, node.from, node.to]);
    },
  });
  return output;
}
test("root proof requires the closed-EOL guard and separates stopped-at-body from partial-body reuse", () => {
  const raw = "---\na: 1\n---\n# first\n\nparagraph\n\n# last",
    boundary = 13;
  const full = documentMarkdownParser.parse(raw);
  function measured(text: string, fragments: readonly TreeFragment[]) {
    const reads: [number, number][] = [];
    const input = {
      length: text.length,
      lineChunks: false,
      chunk: (from: number) => text.slice(from),
      read: (from: number, to: number) => {
        reads.push([from, to]);
        return text.slice(from, to);
      },
    };
    const parse = documentMarkdownParser.startParse(input, fragments);
    let tree: Tree | null = null;
    for (let i = 0; i < 100 && !tree; i++) tree = parse.advance();
    expect(tree).not.toBeNull();
    return { tree: tree!, reads };
  }
  const valid = measured(raw, TreeFragment.addTree(full));
  expect(valid.reads[0]).toEqual([12, 14]);
  expect(valid.reads.some(([from, to]) => from === 0 && to > 2)).toBe(false);
  for (const stop of [boundary, boundary + 10]) {
    const parse = documentMarkdownParser.startParse(raw);
    parse.stopAt(stop);
    let tree: Tree | null = null;
    for (let i = 0; i < 100 && !tree; i++) tree = parse.advance();
    expect(tree).not.toBeNull();
    expect(tree!.length).toBeGreaterThanOrEqual(stop);
    const resumed = measured(raw, TreeFragment.addTree(tree!, [], true));
    expect(nodes(resumed.tree)).toEqual(nodes(full));
    if (stop === boundary)
      expect(resumed.reads.some(([from, to]) => from === 0 && to > 2)).toBe(
        true
      );
    else
      expect(resumed.reads.some(([from, to]) => from === 0 && to > 2)).toBe(
        false
      );
  }
  for (const offset of [0, 9, 12]) {
    const changed = raw.slice(0, offset) + "x" + raw.slice(offset + 1);
    const fragments = TreeFragment.applyChanges(TreeFragment.addTree(full), [
      { fromA: offset, toA: offset + 1, fromB: offset, toB: offset + 1 },
    ]);
    const result = measured(changed, fragments);
    expect(result.reads.some(([from, to]) => from === 0 && to > 2)).toBe(true);
    expect(nodes(result.tree)).toEqual(
      nodes(documentMarkdownParser.parse(changed))
    );
  }
});
test("closed header is one atomic block and fragment grammar keeps normal Markdown", () => {
  const raw = "---\n# fake\n---\n# real";
  expect(nodes(documentMarkdownParser.parse(raw))).toEqual([
    ["Document", 0, 21],
    ["Frontmatter", 0, 14],
    ["ATXHeading1", 15, 21],
    ["HeaderMark", 15, 16],
  ]);
  expect(
    nodes(markdownGrammar.parse(raw)).some(([name]) => name === "Frontmatter")
  ).toBe(false);
  for (const text of [
    "---\n# unclosed",
    "---\na\n...\n# body",
    "x\n---\na\n---",
    "> ---\n> a\n> ---",
  ]) {
    expect(nodes(documentMarkdownParser.parse(text))).toEqual(
      nodes(markdownGrammar.parse(text))
    );
  }
});
test("BOM and all EOL styles preserve raw and explicit document coordinates", () => {
  for (const eol of ["\n", "\r\n", "\r"]) {
    const raw = ["\uFEFF---", "a: 1", "---", "# real"].join(eol);
    const tree = new BomAwareParser(documentMarkdownParser).parse(raw);
    expect(tree.topNode.firstChild?.name).toBe("Frontmatter");
    expect(tree.topNode.firstChild?.from).toBe(1);
    expect(tree.topNode.lastChild?.from).toBe(raw.indexOf("# real"));
    const state = createRawEditorState(raw);
    expect(state.field(rawText)).toBe(raw);
    expect(syntaxTree(state).topNode.firstChild?.name).toBe("Frontmatter");
  }
});
test("decoded root fragments survive body edits, delimiter edit invalidates and partial resumes", () => {
  const raw = "---\na: 1\n---\n# first\n\nparagraph\n\n# last";
  const tree = decodeMarkdownTree(
    encodeMarkdownTree(documentMarkdownParser.parse(raw))
  );
  const next = raw + "!";
  const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), [
    { fromA: raw.length, toA: raw.length, fromB: raw.length, toB: next.length },
  ]);
  expect(nodes(documentMarkdownParser.parse(next, fragments))).toEqual(
    nodes(documentMarkdownParser.parse(next))
  );
  const changed = raw.slice(0, 10) + "x" + raw.slice(11);
  const edited = TreeFragment.applyChanges(TreeFragment.addTree(tree), [
    { fromA: 10, toA: 11, fromB: 10, toB: 11 },
  ]);
  expect(nodes(documentMarkdownParser.parse(changed, edited))).toEqual(
    nodes(documentMarkdownParser.parse(changed))
  );
  const partial = documentMarkdownParser.startParse(raw);
  partial.stopAt(13);
  let stopped: Tree | null = null;
  for (let n = 0; n < 100 && !stopped; n++) stopped = partial.advance();
  expect(stopped).not.toBeNull();
  expect(
    nodes(
      documentMarkdownParser.parse(
        raw,
        TreeFragment.addTree(stopped!, [], true)
      )
    )
  ).toEqual(nodes(tree));
  expect(() =>
    documentMarkdownParser.parse(raw, [], [{ from: 2, to: raw.length }])
  ).toThrow("Unsupported");
});
test("editing excludes YAML fake definitions/images but preserves real body references and code; reading stays legacy", () => {
  const raw =
    "---\n[img]: wrong.png\n![fake](hidden.png)\n---\n\n[img]: right.png\n\n![body][img]\n\n```js\nconst ok = 1\n```";
  const editing = parseEditingMarkdown(raw),
    reading = parseReadingMarkdown(raw);
  expect(editing.children[0].type).toBe("yaml");
  expect(reading.children.some((n) => n.type === "yaml")).toBe(false);
  expect(editing.children.find((n) => n.type === "code")?.value).toBe(
    "const ok = 1"
  );
  const images = summarizeImages(raw);
  expect(images.images).toHaveLength(1);
  expect(images.sources).toEqual([{ url: "right.png", title: null }]);
});
