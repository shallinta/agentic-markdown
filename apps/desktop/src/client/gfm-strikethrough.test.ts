import { expect, test } from "bun:test";

import { isolateHistory, redo, undo } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import type { Tree } from "@lezer/common";

import {
  CANONICAL_PROFILE,
  MARKDOWN_GRAMMAR,
} from "../shared/markdown-profile";

import { BomAwareParser } from "./bom-aware-parser";
import { parseCanonicalMarkdown } from "./canonical-parser";
import { isCanonicalRequest } from "./current-canonical-protocol";
import { sourceHighlightStyle, switchEditorMode } from "./editor-mode";
import { planInlineFormat } from "./inline-format";
import { liveDecorations } from "./live-formatting";
import { markdownGrammar } from "./markdown-grammar";
import { decodeMarkdownTree, encodeMarkdownTree } from "./markdown-tree-wire";
import {
  createRawEditorState,
  editorText,
  rawOffset,
  rawText,
} from "./raw-buffer";
import { planSourceIndentation } from "./source-indentation";

function editorRanges(tree: Tree, raw: string) {
  const ranges: number[][] = [];
  tree.iterate({
    enter(node) {
      if (node.name === "Strikethrough")
        ranges.push([rawOffset(raw, node.from), rawOffset(raw, node.to)]);
    },
  });
  return ranges;
}
function nodeNames(tree: Tree) {
  const names: string[] = [];
  tree.iterate({
    enter(node) {
      names.push(node.name);
    },
  });
  return names.join(" ");
}
function canonicalRanges(raw: string) {
  const ranges: number[][] = [];
  type Node =
    | ReturnType<typeof parseCanonicalMarkdown>
    | ReturnType<typeof parseCanonicalMarkdown>["children"][number];
  function visit(node: Node) {
    if (node.type === "delete")
      ranges.push([node.position!.start.offset!, node.position!.end.offset!]);
    if ("children" in node) for (const child of node.children) visit(child);
  }
  visit(parseCanonicalMarkdown(raw));
  return ranges;
}

test("fixed double tilde profile reconciles old run failures, escapes and exact raw positions", () => {
  const samples = [
    "~~中文😀~~",
    "~single~",
    "~~a &amp; b~~",
    "~~**bold**~~",
    "*~~text~~*",
    "~~[x](local.md)~~",
    "`~~code~~`",
    "~~`code`~~",
    "~~~\n~~code~~\n~~~",
    "~~one\ntwo~~",
    "~~one\n\ntwo~~",
    "A ~~<i>x</i>~~ B",
    "\ufeffA\r\n\r\n~~one\r\ntwo~~\r\nEND",
  ];
  for (let left = 1; left <= 6; left++)
    for (let right = 1; right <= 6; right++)
      samples.push(`A ${"~".repeat(left)}text${"~".repeat(right)} B`);
  for (let slash = 0; slash <= 3; slash++)
    for (const run of [2, 3, 4, 6]) {
      samples.push(`A ${"\\".repeat(slash)}${"~".repeat(run)}text~~ B`);
      samples.push(`A ~~text${"\\".repeat(slash)}${"~".repeat(run)} B`);
    }
  for (const raw of samples) {
    const tree = new BomAwareParser().parse(editorText(raw));
    expect(editorRanges(tree, raw)).toEqual(canonicalRanges(raw));
    expect(
      editorRanges(
        decodeMarkdownTree(structuredClone(encodeMarkdownTree(tree))),
        raw
      )
    ).toEqual(canonicalRanges(raw));
  }
  expect(canonicalRanges("A ~~~text~~~ B")).toEqual([]);
  expect(canonicalRanges("A \\~~~text~~ B")).toEqual([[4, 12]]);
  const other = nodeNames(
    markdownGrammar.parse(
      "| a | b |\n| - | - |\n\n- [x] task\n\nhttps://example.com\n\n~sub~"
    )
  );
  expect(other).not.toMatch(/Strikethrough|Table|Task|Autolink/);
});

test("wire rejects missing or obsolete grammar before interpreting numeric node ids", () => {
  const wire = encodeMarkdownTree(markdownGrammar.parse("~~x~~"));
  expect(wire.config).toBe(MARKDOWN_GRAMMAR);
  expect(encodeMarkdownTree(decodeMarkdownTree(wire))).toEqual(wire);
  const canonicalWire = structuredClone(wire);
  Object.assign(canonicalWire, { config: CANONICAL_PROFILE });
  expect(() => decodeMarkdownTree(canonicalWire)).toThrow("grammar");
  for (const config of [
    undefined,
    "commonmark-core-1",
    "commonmark-gfm-double-strike-1",
    "future",
  ]) {
    const old = structuredClone(wire);
    Object.assign(old, { config });
    expect(() => decodeMarkdownTree(old)).toThrow("grammar");
    expect(
      isCanonicalRequest({
        config,
        requestId: 1,
        documentId: "doc",
        revision: 0,
        text: "~~x~~",
      })
    ).toBe(false);
  }
  expect(
    isCanonicalRequest({
      config: CANONICAL_PROFILE,
      requestId: 1,
      documentId: "doc",
      revision: 0,
      text: "~~x~~",
    })
  ).toBe(true);
  expect(
    isCanonicalRequest({
      config: MARKDOWN_GRAMMAR,
      requestId: 1,
      documentId: "doc",
      revision: 0,
      text: "~~x~~",
    })
  ).toBe(false);
});

test("format toggles and wrapping cannot rewrite strike ancestors or descendants", () => {
  for (const [raw, from, to] of [
    ["**~~x~~**", 0, 9],
    ["**~~x~~**", 2, 7],
    ["*~~x~~*", 0, 7],
    ["*~~x~~*", 1, 6],
    ["~~**x**~~", 4, 5],
    ["~~x~~", 2, 3],
    ["A ~~x~~ B", 0, 9],
  ] as const) {
    const s = createRawEditorState(raw).update({
      selection: EditorSelection.range(from, to),
    }).state;
    for (const kind of ["bold", "italic", "code"] as const)
      for (const intent of ["toggle", "wrap-only"] as const)
        expect(planInlineFormat(s, kind, intent)).toBeUndefined();
  }
  const ordinary = createRawEditorState("abc").update({
    selection: EditorSelection.range(0, 3),
  }).state;
  expect(planInlineFormat(ordinary, "bold")).toBeDefined();
});

test("editing marker visibility, source colour-only and raw history retain fixed semantics", () => {
  const raw = "\ufeff~~中文~~\r\n\r\nend";
  let s = createRawEditorState(raw);
  s = s.update({ selection: EditorSelection.cursor(s.doc.length) }).state;
  ensureSyntaxTree(s, s.doc.length, 100);
  function decorations(state: typeof s) {
    const entries: {
      from: number;
      to: number;
      hidden: boolean;
      className?: string;
    }[] = [];
    liveDecorations(state, [{ from: 0, to: state.doc.length }]).between(
      0,
      state.doc.length,
      (from, to, d) => {
        const spec = d.spec as { class?: string };
        entries.push({
          from,
          to,
          hidden: !spec.class,
          className: spec.class,
        });
      }
    );
    return entries;
  }
  expect(
    decorations(s)
      .filter((x) => x.hidden)
      .map((x) => [x.from, x.to])
  ).toEqual([
    [1, 3],
    [5, 7],
  ]);
  expect(decorations(s).some((x) => x.className === "cm-live-strike")).toBe(
    true
  );
  s = s.update({ selection: EditorSelection.cursor(4) }).state;
  expect(decorations(s).filter((x) => x.hidden)).toHaveLength(0);
  const before = s;
  const tx = s.update({
    changes: { from: 4, insert: "X" },
    annotations: isolateHistory.of("full"),
  });
  s = tx.state;
  const updated = s.field(rawText);
  expect(updated).toBe("\ufeff~~中X文~~\r\n\r\nend");
  const target = {
    get state() {
      return s;
    },
    dispatch(t: typeof tx) {
      s = t.state;
    },
  };
  expect(undo(target)).toBe(true);
  expect(s.field(rawText)).toBe(raw);
  expect(s.selection.eq(before.selection)).toBe(true);
  expect(redo(target)).toBe(true);
  expect(s.field(rawText)).toBe(updated);
  s = s.update({ effects: switchEditorMode("source") }).state;
  expect(s.field(rawText)).toBe(updated);
  expect(nodeNames(syntaxTree(s))).toContain("Strikethrough");
  for (const spec of sourceHighlightStyle.specs)
    expect(Object.keys(spec).every((k) => ["tag", "color"].includes(k))).toBe(
      true
    );
});

test("quote and list transformations retain strike content under the same grammar", () => {
  for (const [raw, position] of [
    ["> ~~x~~", 4],
    ["- A\n- ~~x~~", 8],
  ] as const) {
    let s = createRawEditorState(raw);
    s = s.update({ selection: EditorSelection.cursor(position) }).state;
    ensureSyntaxTree(s, s.doc.length, 100);
    const plan = planSourceIndentation(s, true);
    expect(plan.reason).toBeUndefined();
    const next = s.update({ changes: plan.changes }).state;
    expect(canonicalRanges(next.field(rawText))).toHaveLength(1);
    expect(nodeNames(syntaxTree(next))).toContain("Strikethrough");
    expect(next.field(rawText)).toContain("~~x~~");
  }
});
