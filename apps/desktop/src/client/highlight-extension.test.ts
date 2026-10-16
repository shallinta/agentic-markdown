import { expect, test } from "bun:test";

import { undo, redo, isolateHistory } from "@codemirror/commands";
import {
  ensureSyntaxTree,
  syntaxTree,
  foldedRanges,
} from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import type { Nodes } from "mdast";

import {
  CANONICAL_PROFILE,
  EDITING_CANONICAL_PROFILE,
  MARKDOWN_GRAMMAR,
} from "../shared/markdown-profile";

import { calloutInlineBody } from "./callout-inline";
import { parseEditingMarkdown, parseReadingMarkdown } from "./canonical-parser";
import { isCanonicalRequest } from "./current-canonical-protocol";
import {
  sourceHighlightStyle,
  switchEditorMode,
  safeSourceEffects,
} from "./editor-mode";
import {
  headingStructureReady,
  headingToggleTransaction,
} from "./heading-folding";
import { headingStructureSteps } from "./heading-structure";
import { summarizeImages } from "./image-summary";
import { planInlineFormat } from "./inline-format";
import { liveDecorations } from "./live-formatting";
import { encodeMarkdownTree, decodeMarkdownTree } from "./markdown-tree-wire";
import { createRawEditorState, rawText, writePermission } from "./raw-buffer";
import { sourceColorDecorations } from "./source-highlighting";

const fixtures: readonly [string, number[][]][] = [
  ["==a==", [[0, 5]]],
  ["==中文😀==\n\na==😀==b", [[0, 8]]],
  [
    "a==b==c，==中==。",
    [
      [1, 6],
      [8, 13],
    ],
  ],
  ["==a b==\n\n== a==\n\n==a ==", [[0, 7]]],
  ["=a=\n\n===a===\n\n====a====\n\n====\n\n== ==", []],
  ["\\==a==", []],
  ["\\\\==a==", [[2, 7]]],
  ["==unclosed", []],
  [
    "==one== + ==two==",
    [
      [0, 7],
      [10, 17],
    ],
  ],
  [
    "==**b**== ~~==s==~~",
    [
      [0, 9],
      [12, 17],
    ],
  ],
  ["`==code==` ==`x`==\n\n==a `b==`", [[11, 18]]],
  ["```\n==fenced==\n```\n\n    ==indent==\n\n==body==", [[36, 44]]],
  ["---\nx: ==yaml==\n---\n==body==", [[20, 28]]],
  [
    "[==label==](https://x/==url==)\n\n[id]: https://x/==def==\n\n==[x==](u)",
    [[1, 10]],
  ],
  [
    "==![alt](a.png)==\n\n![==caption==](b.png)",
    [
      [0, 17],
      [21, 32],
    ],
  ],
  [
    "> ==q==\n\n- ==l==\n\n| h |\n| - |\n| ==t== |",
    [
      [2, 7],
      [11, 16],
      [32, 37],
    ],
  ],
  ["title\n===\n\n==body==", [[11, 19]]],
  ["==a\nb==", [[0, 7]]],
  ["==a\n\nb==", []],
  [
    "==a ==b== c==",
    [
      [0, 13],
      [4, 9],
    ],
  ],
  ["==a **b== c**\n\n**a ==b** c==", [[0, 9]]],
  ['<a title="==attr==">==text==</a>', [[20, 28]]],
  ["\uFEFF==a\r\nb==", [[1, 9]]],
  ["==a\rb==", [[0, 7]]],
  [
    "a==b==c==d==",
    [
      [1, 6],
      [7, 12],
    ],
  ],
];
function ranges(tree: Tree, name = "Highlight") {
  const result: number[][] = [];
  tree.iterate({
    enter(node) {
      if (node.name === name) result.push([node.from, node.to]);
    },
  });
  return result;
}
function all(node: Nodes): Nodes[] {
  return [node, ...("children" in node ? node.children.flatMap(all) : [])];
}
for (const [index, [raw, expected]] of fixtures.entries())
  test(`highlight fixed semantic ${index + 1} through real CM and wire`, () => {
    const state = createRawEditorState(raw);
    const tree = ensureSyntaxTree(state, state.doc.length, 1000)!;
    expect(tree).not.toBeNull();
    const cm = index === 22 ? [[1, 8]] : expected;
    expect(ranges(tree)).toEqual(cm);
    expect(ranges(tree, "HighlightMark")).toEqual(
      cm
        .flatMap(([from, to]) => [
          [from, from + 2],
          [to - 2, to],
        ])
        .sort((a, b) => a[0] - b[0])
    );
    expect(ranges(decodeMarkdownTree(encodeMarkdownTree(tree)))).toEqual(cm);
    expect(state.field(rawText)).toBe(raw);
    const ast = all(parseEditingMarkdown(raw));
    expect(
      ast
        .filter((n) => n.type === "highlight")
        .map((n) => [n.position!.start.offset, n.position!.end.offset])
    ).toEqual(index === 14 ? [expected[0]] : expected);
    expect(
      all(parseReadingMarkdown(raw)).some((n) => n.type === "highlight")
    ).toBe(false);
    if (index === 14)
      expect(
        ast.filter((n) => n.type === "image").map((n) => [n.url, n.alt])
      ).toEqual([
        ["a.png", "alt"],
        ["b.png", "caption"],
      ]);
    if (index === 10)
      expect(
        ast.filter((n) => n.type === "inlineCode").map((n) => n.value)
      ).toEqual(["==code==", "x", "b=="]);
    if (index === 13) {
      expect(ast.filter((n) => n.type === "link").map((n) => n.url)).toEqual([
        "https://x/==url==",
        "u",
      ]);
      expect(
        ast.filter((n) => n.type === "definition").map((n) => n.url)
      ).toEqual(["https://x/==def=="]);
      expect(
        ast.filter((n) => n.type === "text").map((n) => n.value)
      ).toContain("x==");
    }
    if (index === 19) {
      const outer = ast.find((n) => n.type === "highlight");
      expect(
        outer?.type === "highlight" &&
          outer.children.some((n) => n.type === "highlight")
      ).toBe(true);
    }
    if (index === 20) {
      expect(ast.filter((n) => n.type === "strong")).toHaveLength(1);
      expect(
        ast.filter((n) => n.type === "text").map((n) => n.value)
      ).toContain("a **b");
      expect(
        ast.filter((n) => n.type === "text").map((n) => n.value)
      ).toContain("a ==b");
    }
  });
function decorations(
  state: EditorState,
  visible = [{ from: 0, to: state.doc.length }]
) {
  const out: { from: number; to: number; className?: string }[] = [];
  liveDecorations(state, visible).between(
    0,
    state.doc.length,
    (from, to, d) => {
      const spec = d.spec as { class?: string };
      out.push({ from, to, className: spec.class });
    }
  );
  return out;
}
test("highlight markers follow selection; source/safe remain raw without editing presentation", () => {
  const raw = "\uFEFF==中文==\r\n\r\nend";
  let state = createRawEditorState(raw);
  state = state.update({
    selection: EditorSelection.cursor(state.doc.length),
  }).state;
  expect(
    decorations(state)
      .filter((d) => !d.className)
      .map((d) => [d.from, d.to])
  ).toEqual([
    [1, 3],
    [5, 7],
  ]);
  expect(
    decorations(state).some((d) => d.className === "cm-live-highlight")
  ).toBe(true);
  state = state.update({ selection: EditorSelection.range(3, 5) }).state;
  expect(decorations(state).filter((d) => !d.className)).toHaveLength(0);
  state = state.update({ effects: switchEditorMode("source") }).state;
  expect(state.field(rawText)).toBe(raw);
  expect(
    state
      .facet(EditorView.styleModule)
      .map((m) => m.getRules())
      .join("\n")
  ).not.toContain("cm-live-highlight");
  sourceColorDecorations(
    state,
    syntaxTree(state),
    [{ from: 0, to: state.doc.length }],
    sourceHighlightStyle
  ).between(0, state.doc.length, (_from, _to, d) => {
    const spec = d.spec as { class?: string };
    expect(typeof spec.class).toBe("string");
  });
  for (const style of sourceHighlightStyle.specs)
    expect(
      Object.keys(style).every((key) => ["tag", "color"].includes(key))
    ).toBe(true);
  state = state.update({ effects: safeSourceEffects() }).state;
  expect(decorations(state)).toHaveLength(0);
  expect(state.field(rawText)).toBe(raw);
});
test("highlight protects existing format commands and readonly raw content", () => {
  for (const [from, to] of [
    [3, 3],
    [0, 7],
    [3, 4],
  ]) {
    let state = createRawEditorState("==abc==").update({
      effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
    }).state;
    expect(state.readOnly).toBe(true);
    state = state.update({ selection: EditorSelection.range(from, to) }).state;
    for (const kind of ["bold", "italic", "code"] as const)
      expect(planInlineFormat(state, kind)).toBeUndefined();
    expect(state.field(rawText)).toBe("==abc==");
  }
  let editable = createRawEditorState("==abc==");
  editable = editable.update({ selection: EditorSelection.range(3, 4) }).state;
  expect(planInlineFormat(editable, "bold")).toBeUndefined();
});
test("real Callout inline body excludes highlight shell around ignored inline code", () => {
  for (const [raw, wanted] of [
    ["==`x`==", false],
    ["==x==", true],
  ] as const) {
    const state = createRawEditorState(raw),
      node = syntaxTree(state).topNode.firstChild!;
    const work = calloutInlineBody(state.doc, node, node.from, new Set());
    let result = work.next();
    while (!result.done) result = work.next();
    expect(result.value).toBe(wanted);
  }
});
test("real image summary retains nested highlight image and excludes frontmatter definitions", () => {
  const raw =
    "---\n[id]: wrong.png\n---\n\n==![a][id]==\n\n![==caption==](b.png)\n\n[id]: right.png";
  const result = summarizeImages(raw);
  expect(result.images.map((i) => i.alt)).toEqual(["a", "caption"]);
  expect(result.images.map((i) => result.sources[i.source].url)).toEqual([
    "right.png",
    "b.png",
  ]);
});
test("highlight selection/history and containing heading fold preserve raw", () => {
  const raw = "# Title\r\n==one ==two== three==\r\n# Next\r\nlast";
  let state = createRawEditorState(raw);
  const task = headingStructureSteps(state);
  let next = task.next();
  while (!next.done) next = task.next();
  state = state.update({
    effects: headingStructureReady.of(next.value),
    selection: { anchor: 0 },
  }).state;
  const folded = headingToggleTransaction(state, next.value.sections[0])!;
  state = folded.state;
  const hidden: { from: number; to: number }[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    hidden.push({ from, to });
  });
  expect(hidden).toHaveLength(1);
  // Pure decoration seam receives visible ranges, as the real view does.
  const visible = [
    { from: 0, to: hidden[0].from },
    { from: hidden[0].to, to: state.doc.length },
  ];
  // Nearby-line expansion may retain marks under the fold replacement; none
  // may escape the hidden interval. Pixel visibility is a real-view check.
  for (const mark of decorations(state, visible).filter(
    (d) => d.className === "cm-live-highlight"
  )) {
    expect(mark.from).toBeGreaterThanOrEqual(hidden[0].from);
    expect(mark.to).toBeLessThanOrEqual(hidden[0].to);
  }
  state = state.update({ selection: EditorSelection.range(11, 14) }).state;
  expect(foldedRanges(state).size).toBe(0);
  expect(
    decorations(state).some((d) => d.className === "cm-live-highlight")
  ).toBe(true);
  expect(state.field(rawText)).toBe(raw);
  const before = state;
  const edit = state.update({
    changes: { from: 11, insert: "X" },
    annotations: isolateHistory.of("full"),
  });
  state = edit.state;
  const target = {
    get state() {
      return state;
    },
    dispatch(t: typeof edit) {
      state = t.state;
    },
  };
  expect(undo(target)).toBe(true);
  expect(state.field(rawText)).toBe(raw);
  expect(state.selection.eq(before.selection)).toBe(true);
  expect(redo(target)).toBe(true);
  expect(state.field(rawText)).not.toBe(raw);
});
test("highlight wire/profile reject stale editing grammar while legacy reading stays supported", () => {
  const state = createRawEditorState("==x=="),
    wire = encodeMarkdownTree(syntaxTree(state));
  expect(wire.config).toBe(MARKDOWN_GRAMMAR);
  expect(() =>
    decodeMarkdownTree({
      ...wire,
      config:
        "commonmark-gfm-strike-task-table-frontmatter-4" as typeof MARKDOWN_GRAMMAR,
    })
  ).toThrow("Invalid Markdown grammar");
  const request = {
    requestId: 1,
    documentId: "highlight",
    revision: 1,
    text: "==x==",
    config: EDITING_CANONICAL_PROFILE,
  };
  expect(isCanonicalRequest(request)).toBe(true);
  expect(
    isCanonicalRequest({
      ...request,
      config: "commonmark-gfm-strike-task-autolink-table-callout-frontmatter-6",
    })
  ).toBe(false);
  expect(isCanonicalRequest({ ...request, config: CANONICAL_PROFILE })).toBe(
    true
  );
});
