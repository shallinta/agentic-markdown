import { expect, test } from "bun:test";

import { syntaxTree } from "@codemirror/language";
import { Tree, TreeBuffer } from "@lezer/common";
import { highlightTree } from "@lezer/highlight";

import {
  CANONICAL_PROFILE,
  MARKDOWN_GRAMMAR,
} from "../shared/markdown-profile";

import { BomAwareParser } from "./bom-aware-parser";
import { parseCanonicalMarkdown } from "./canonical-parser";
import { sourceHighlightStyle, switchEditorMode } from "./editor-mode";
import { liveDecorations } from "./live-formatting";
import { decodeMarkdownTree, encodeMarkdownTree } from "./markdown-tree-wire";
import {
  createRawEditorState,
  editorText,
  rawOffset,
  rawText,
} from "./raw-buffer";
import { sourceColorDecorations } from "./source-highlighting";

function nodes(tree: Tree) {
  const result: { name: string; from: number; to: number }[] = [];
  tree.iterate({
    enter(node) {
      result.push({ name: node.name, from: node.from, to: node.to });
    },
  });
  return result;
}
test("table grammar preserves canonical raw table boundaries and wire including buffers", () => {
  const samples = [
    "| a | b |\n| - | - |\n| c | d |",
    "a | b | c\n:-- | :-: | --:\nx | y | z",
    "| | b |\n| - | - |\n| | |",
    "a | b\n--- | ---\nx\ny | z | extra",
    "a | b\n--- | ---\nx\\|y | `a\\|b`",
    "> a | b\n> --- | ---\n> c | d",
    "- a | b\n  --- | ---\n  c | d",
    "\ufeffa | b\r\n--- | ---\rc | d\n",
  ];
  type Node =
    | ReturnType<typeof parseCanonicalMarkdown>
    | ReturnType<typeof parseCanonicalMarkdown>["children"][number];
  for (const raw of samples) {
    const expected: number[][] = [];
    function visit(node: Node) {
      if (node.type === "table")
        expected.push([
          node.position!.start.offset!,
          node.position!.end.offset!,
        ]);
      if ("children" in node) node.children.forEach(visit);
    }
    visit(parseCanonicalMarkdown(raw));
    const tree = new BomAwareParser().parse(editorText(raw));
    expect(
      nodes(tree)
        .filter((n) => n.name === "Table")
        .map((n) => [rawOffset(raw, n.from), rawOffset(raw, n.to)])
    ).toEqual(expected);
    expect(
      nodes(decodeMarkdownTree(structuredClone(encodeMarkdownTree(tree))))
    ).toEqual(nodes(tree));
  }
  const tree = new BomAwareParser().parse(
    "a | b\n--- | ---\nx | y\n\n".repeat(40)
  );
  function buffered(t: Tree): boolean {
    return t.children.some((c) => c instanceof TreeBuffer || buffered(c));
  }
  expect(buffered(tree)).toBe(true);
  expect(nodes(decodeMarkdownTree(encodeMarkdownTree(tree)))).toEqual(
    nodes(tree)
  );
});

test("old, missing and nested old table grammar cannot enter the current decoder", () => {
  const wire = encodeMarkdownTree(
    new BomAwareParser().parse("a | b\n--- | ---")
  );
  expect(wire.config).toBe(MARKDOWN_GRAMMAR);
  expect(CANONICAL_PROFILE).toBe("commonmark-gfm-strike-task-autolink-table-4");
  for (const config of [
    undefined,
    "commonmark-gfm-strike-task-projection-2",
    CANONICAL_PROFILE,
  ]) {
    const old = structuredClone(wire);
    Object.assign(old, { config });
    expect(() => decodeMarkdownTree(old)).toThrow("grammar");
    const outer = structuredClone(wire);
    outer.children = [old];
    outer.positions = [0];
    expect(() => decodeMarkdownTree(outer)).toThrow("grammar");
  }
});

test("table headers remain raw in editing and source decorations are only color marks", () => {
  const raw = "| alpha | beta |\n| :--- | ---: |\n| one | two |\n\nend";
  const state = createRawEditorState(raw).update({
    selection: { anchor: raw.length },
  }).state;
  const styles: string[] = [];
  liveDecorations(state, [{ from: 0, to: state.doc.length }]).between(
    0,
    state.doc.length,
    (_from, _to, deco) => {
      const spec = deco.spec as {
        class?: string;
        widget?: unknown;
        tagName?: string;
      };
      if (spec.class) styles.push(spec.class);
      expect(spec.widget).toBeUndefined();
      expect(spec.tagName).toBeUndefined();
      expect(spec.class).toBeDefined();
    }
  );
  expect(styles.some((s) => s.includes("cm-live-heading"))).toBe(false);
  const source = state.update({ effects: switchEditorMode("source") }).state;
  const expected: { from: number; to: number; classes: string }[] = [];
  highlightTree(syntaxTree(source), sourceHighlightStyle, (from, to, classes) =>
    expected.push({ from, to, classes })
  );
  const actual: typeof expected = [];
  sourceColorDecorations(
    source,
    syntaxTree(source),
    [{ from: 0, to: source.doc.length }],
    sourceHighlightStyle
  ).between(0, source.doc.length, (from, to, deco) => {
    const spec = deco.spec as { class: string; widget?: unknown };
    expect(spec.widget).toBeUndefined();
    actual.push({ from, to, classes: spec.class });
  });
  expect(actual).toEqual(expected);
  expect(actual.length).toBeGreaterThan(0);
  for (const spec of sourceHighlightStyle.specs) {
    expect(Object.keys(spec).filter((k) => k !== "tag")).toEqual(["color"]);
  }
  expect(source.field(rawText)).toBe(raw);
});
