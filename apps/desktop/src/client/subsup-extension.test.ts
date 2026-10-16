import { expect, test } from "bun:test";

import {
  ensureSyntaxTree,
  syntaxTree,
  foldedRanges,
} from "@codemirror/language";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import type { Nodes } from "mdast";

import {
  EDITING_CANONICAL_PROFILE,
  MARKDOWN_GRAMMAR,
} from "../shared/markdown-profile";

import { calloutInlineBody } from "./callout-inline";
import { parseEditingMarkdown, parseReadingMarkdown } from "./canonical-parser";
import { isCanonicalRequest } from "./current-canonical-protocol";
import { switchEditorMode, safeSourceEffects } from "./editor-mode";
import {
  headingStructureReady,
  headingToggleTransaction,
} from "./heading-folding";
import { headingStructureSteps } from "./heading-structure";
import { summarizeImages } from "./image-summary";
import { planInlineFormat } from "./inline-format";
import { liveDecorations, LiveFormatting } from "./live-formatting";
import { encodeMarkdownTree, decodeMarkdownTree } from "./markdown-tree-wire";
import { createRawEditorState, rawText, writePermission } from "./raw-buffer";
import {
  subSupBudget,
  subSupPresentation,
  isSubSup,
} from "./subsup-presentation";

// Frozen handwritten semantic expectations, not generated from either parser.
const fixtures: readonly [string, number[][], number[][], string[]][] = [
  ["X^2^ H~2~O", [[1, 4]], [[6, 9]], ["2", "2"]],
  ["~a\\ b~\n\n^a\\qb^", [[8, 14]], [[0, 6]], ["a b", "a\\qb"]],
  ["^**x**^", [[0, 7]], [], ["x"]],
  ["^[x][r]^\n\n[r]: /url", [[0, 8]], [], ["x"]],
  ["[^x^](u)", [[1, 4]], [], ["x"]],
  ["[outer ^[inner](v)^](u)", [[7, 19]], [], ["inner"]],
  ["^**a\\ b**^", [[0, 10]], [], ["a b"]],
  ["^a\\\tb^", [[0, 6]], [], ["a\tb"]],
  ["^`a\\ b`^", [[0, 8]], [], ["a\\ b"]],
  ["a\\ b", [], [], []],
  ["^^x^^\n\n^a^^\n\n~~x~~", [], [], []],
  ["\uFEFF^😀^\r\n~x~", [[1, 5]], [[7, 10]], ["😀", "x"]],
  ["^a\\^b^", [[0, 6]], [], ["a^b"]],
  ["^a~b~c^", [[0, 7]], [[2, 5]], ["abc", "b"]],
  [
    "^a^b^c^",
    [
      [0, 3],
      [4, 7],
    ],
    [],
    ["a", "c"],
  ],
  ["^^\n\n^open", [], [], []],
  ["\\^^x^", [[2, 5]], [], ["x"]],
  ["^中文😀^", [[0, 6]], [], ["中文😀"]],
  ["~a b~", [], [], []],
  ["^a\tb^", [], [], []],
  ["^a\nb^", [], [], []],
  ["^a\\\nb^", [], [], []],
  ["\\^x^", [], [], []],
  ["^&amp;^", [[0, 7]], [], ["&"]],
  ["^a b^", [[0, 5]], [], ["a b"]],
  ["~~~x~~~", [], [], []],
  ["**^x^**", [[2, 5]], [], ["x"]],
  ["`^x^` [^x^](a^b^)", [[7, 10]], [], ["x"]],
  ["![~x~](u)", [], [[2, 5]], []],
  ["\uFEFFX^2^\r\nH~2~O", [[2, 5]], [[8, 11]], ["2", "2"]],
  ["---\nx: ^a^\n---\n\n~~~\n~b~\n~~~\n\n^c^", [[29, 32]], [], ["c"]],
  ["^a^^", [], [], []],
  ["^[x](u)^", [[0, 8]], [], ["x"]],
  ["^`x`^", [[0, 5]], [], ["x"]],
];
function all(node: Nodes): Nodes[] {
  return [node, ...("children" in node ? node.children.flatMap(all) : [])];
}
function plain(node: Nodes): string {
  return "value" in node
    ? String(node.value)
    : "children" in node
      ? node.children.map(plain).join("")
      : "";
}
function ranges(tree: Tree, name: string) {
  const out: number[][] = [];
  tree.iterate({
    enter(n) {
      if (n.name === name) out.push([n.from, n.to]);
    },
  });
  return out;
}
for (const [index, [raw, up, down, texts]] of fixtures.entries())
  test(`SubSup fixed semantics ${index + 1} real factory, canonical, wire`, () => {
    const state = createRawEditorState(raw),
      tree = ensureSyntaxTree(state, state.doc.length, 1000)!;
    expect(tree).not.toBeNull();
    expect(state.field(rawText)).toBe(raw);
    const cmDown = index === 11 ? [[6, 9]] : index === 29 ? [[7, 10]] : down;
    expect(ranges(tree, "Superscript")).toEqual(up);
    expect(ranges(tree, "Subscript")).toEqual(cmDown);
    expect(
      ranges(decodeMarkdownTree(encodeMarkdownTree(tree)), "Superscript")
    ).toEqual(up);
    expect(ranges(tree, "SuperscriptMark")).toEqual(
      up
        .flatMap(([a, b]) => [
          [a, a + 1],
          [b - 1, b],
        ])
        .sort((a, b) => a[0] - b[0])
    );
    const ast = all(parseEditingMarkdown(raw));
    const spans = ast.filter(
      (n) => n.type === "superscript" || n.type === "subscript"
    );
    expect(
      spans
        .filter((n) => n.type === "superscript")
        .map((n) => [n.position!.start.offset, n.position!.end.offset])
    ).toEqual(up);
    expect(
      spans
        .filter((n) => n.type === "subscript")
        .map((n) => [n.position!.start.offset, n.position!.end.offset])
    ).toEqual(index === 28 ? [] : down);
    expect(spans.map(plain)).toEqual(texts);
    expect(
      all(parseReadingMarkdown(raw)).some(
        (n) => n.type === "subscript" || n.type === "superscript"
      )
    ).toBe(false);
    if (index === 3) {
      expect(
        ast.filter((n) => n.type === "linkReference").map((n) => n.identifier)
      ).toEqual(["r"]);
      expect(
        ast.filter((n) => n.type === "definition").map((n) => n.url)
      ).toEqual(["/url"]);
    }
    if (index === 5) {
      expect(ast.filter((n) => n.type === "link").map((n) => n.url)).toEqual([
        "v",
      ]);
      expect(plain(parseEditingMarkdown(raw))).toBe("[outer inner](u)");
    }
    if (index === 2 || index === 6)
      expect(spans[0].type === "superscript" && spans[0].children[0].type).toBe(
        "strong"
      );
    if (index === 8)
      expect(spans[0].type === "superscript" && spans[0].children[0].type).toBe(
        "inlineCode"
      );
    if (index === 10) expect(ranges(tree, "Strikethrough")).toEqual([[13, 18]]);
    if (index === 16) {
      expect(ranges(tree, "Escape")).toEqual([[0, 2]]);
      expect(plain(parseEditingMarkdown(raw))).toBe("^x");
    }
    if (index === 28)
      expect(ast.filter((n) => n.type === "image").map((n) => n.alt)).toEqual([
        "x",
      ]);
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
      out.push({ from, to, className: (d.spec as { class?: string }).class });
    }
  );
  return out;
}
function ready(raw: string) {
  let state = createRawEditorState(raw);
  ensureSyntaxTree(state, state.doc.length, 1000);
  state = state.update({ selection: { anchor: state.doc.length } }).state;
  return state;
}
test("SubSup nested escaped whitespace sources and opaque nodes", () => {
  const state = ready("^**a\\ b**^ ~x\\\ty~ ^`a\\ b`^\n\nend");
  const output = decorations(state);
  expect(
    output.filter((d) => !d.className).map((d) => [d.from, d.to])
  ).toContainEqual([4, 5]);
  expect(
    output.filter((d) => !d.className).map((d) => [d.from, d.to])
  ).toContainEqual([13, 14]);
  expect(output.some((d) => d.className === "cm-live-superscript")).toBe(true);
  expect(
    output.filter((d) => !d.className).map((d) => [d.from, d.to])
  ).not.toContainEqual([23, 24]);
});
test("SubSup ancestor selection reveals nested markers and escape sources", () => {
  let state = ready("^a~b\\ c~d^\n\nend");
  state = state.update({ selection: { anchor: 1 } }).state;
  expect(decorations(state).filter((d) => !d.className)).toHaveLength(0);
  state = state.update({
    effects: StateEffect.appendConfig.of(
      EditorState.allowMultipleSelections.of(true)
    ),
  }).state;
  state = state.update({
    selection: EditorSelection.create([
      EditorSelection.cursor(1),
      EditorSelection.cursor(state.doc.length),
    ]),
  }).state;
  expect(state.selection.ranges).toHaveLength(2);
  expect(decorations(state).filter((d) => !d.className)).toHaveLength(0);
  const strong = ready("^a**b\\ c**d^\n\nend").update({
    selection: { anchor: 1 },
  }).state;
  expect(decorations(strong).filter((d) => !d.className)).toHaveLength(0);
});
test("SubSup multiple visible segments preserve later sources without duplicates", () => {
  const state = ready("^a\\ b\\ c^\n\nend"),
    tree = syntaxTree(state),
    root = tree.topNode.firstChild!.firstChild!;
  const budget = subSupBudget();
  expect(
    subSupPresentation(state, tree, root, { from: 0, to: 5 }, budget)?.slashes
  ).toEqual([{ from: 2, to: 3 }]);
  expect(
    subSupPresentation(state, tree, root, { from: 5, to: 9 }, budget)?.slashes
  ).toEqual([{ from: 5, to: 6 }]);
  const result = decorations(state, [
    { from: 0, to: 5 },
    { from: 5, to: 9 },
  ]);
  expect(result.filter((d) => !d.className && d.from === 5)).toHaveLength(1);
});
test("SubSup shared budget fails raw before committing marks and sources", () => {
  const state = ready("^**a\\ b**^\n\nend"),
    tree = syntaxTree(state),
    root = tree.topNode.firstChild!.firstChild!;
  expect(
    subSupPresentation(
      state,
      tree,
      root,
      { from: 0, to: 10 },
      { nodes: 1, units: 4096 }
    )
  ).toBeNull();
  expect(
    subSupPresentation(
      state,
      tree,
      root,
      { from: 0, to: 10 },
      { nodes: 128, units: 1 }
    )
  ).toBeNull();
  const dense = ready("^x^ ".repeat(512) + "\n\nend");
  const styled = decorations(dense).filter(
    (d) => d.className === "cm-live-superscript"
  );
  expect(styled.length).toBeGreaterThan(0);
  expect(styled.length).toBeLessThan(512);
  const allDecorations = decorations(dense);
  for (let index = 0; index < 512; index++) {
    const from = index * 4,
      complete = styled.some((d) => d.from === from && d.to === from + 3);
    const hidden = allDecorations.filter(
      (d) => !d.className && d.from >= from && d.to <= from + 3
    );
    expect(hidden.map((d) => [d.from, d.to])).toEqual(
      complete
        ? [
            [from, from + 1],
            [from + 2, from + 3],
          ]
        : []
    );
  }
});
test("ordinary 19 and 200 SubSup spans render complete viewport including last markers", () => {
  for (const count of [19, 200]) {
    const state = ready("^x^ ".repeat(count) + "\n\nend"),
      output = decorations(state);
    expect(
      output.filter((d) => d.className === "cm-live-superscript")
    ).toHaveLength(count);
    for (let index = 0; index < count; index++) {
      const from = index * 4;
      expect(
        output.some(
          (d) =>
            d.className === "cm-live-superscript" &&
            d.from === from &&
            d.to === from + 3
        )
      ).toBe(true);
      expect(
        output
          .filter((d) => !d.className && d.from >= from && d.to <= from + 3)
          .map((d) => [d.from, d.to])
      ).toEqual([
        [from, from + 1],
        [from + 2, from + 3],
      ]);
    }
  }
});
const wkFixture = [
  "# 上下标验收",
  "",
  "普通：H~2~O 与 X^2^，中文^上标^和中文~下标~。",
  "",
  "转义：~a\\ b~ 与 ^**a\\ b**^。",
  "",
  "组合：^**粗体**^、~*斜体*~、^==高亮==^、^a~b~c^。",
  "",
  "链接：^[label](https://example.com)^，只检查显示，不打开链接。",
  "",
  "代码：`^literal^ ~literal~` 与 ^`a\\ b`^。",
  "",
  "重复：^^literal^^，~~删除线~~。",
  "",
  "> 引用 H~2~O，X^2^，^**a\\ b**^。",
  "",
  "- 列表 H~2~O，X^2^。",
  "",
  "> [!NOTE]",
  "> H~2~O 与 X^2^。",
  "",
  "## 折叠样本",
  "",
  "这一节包含 X^2^ 与 H~2~O。",
  "",
  "```markdown",
  "^literal^ ~literal~ ==literal==",
  "```",
  "",
  "## 末尾",
  "",
  "copytarget",
  "",
].join("\n");
test("alpha163 actual 568-byte WK sample renders all 22 SubSup and final normal markers", () => {
  expect(new TextEncoder().encode(wkFixture).length).toBe(568);
  const state = ready(wkFixture),
    output = decorations(state);
  expect(
    output.filter(
      (d) =>
        d.className === "cm-live-superscript" ||
        d.className === "cm-live-subscript"
    )
  ).toHaveLength(22);
  const tail = wkFixture.indexOf("这一节包含");
  for (const [marker, style] of [
    ["^2^", "cm-live-superscript"],
    ["~2~", "cm-live-subscript"],
  ]) {
    const from = wkFixture.indexOf(marker, tail);
    expect(
      output.some(
        (d) => d.className === style && d.from === from && d.to === from + 3
      )
    ).toBe(true);
    expect(
      output
        .filter((d) => !d.className && d.from >= from && d.to <= from + 3)
        .map((d) => [d.from, d.to])
    ).toEqual([
      [from, from + 1],
      [from + 2, from + 3],
    ]);
  }
  for (const match of wkFixture.matchAll(/\\ /g)) {
    const position = match.index;
    const inCode = wkFixture.slice(position - 2, position) === "`a";
    expect(
      output.some(
        (d) => !d.className && d.from === position && d.to === position + 1
      )
    ).toBe(!inCode);
  }
});
test("SubSup source/safe readonly and format protections preserve raw", () => {
  const raw = "^a\\ b^\r\n\r\nend";
  let state = ready(raw);
  state = state.update({
    effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
  }).state;
  expect(state.readOnly).toBe(true);
  expect(
    decorations(state).some((d) => d.className === "cm-live-superscript")
  ).toBe(true);
  for (const [from, to] of [
    [0, 6],
    [2, 3],
    [1, 1],
  ]) {
    const selected = state.update({
      selection: { anchor: from, head: to },
    }).state;
    expect(planInlineFormat(selected, "bold")).toBeUndefined();
    expect(selected.field(rawText)).toBe(raw);
  }
  const editable = ready(raw).update({
    selection: { anchor: 1, head: 4 },
  }).state;
  expect(planInlineFormat(editable, "italic")).toBeUndefined();
  state = state.update({ effects: switchEditorMode("source") }).state;
  expect(
    state
      .facet(EditorView.styleModule)
      .map((m) => m.getRules())
      .join("\n")
  ).not.toContain("cm-live-superscript");
  expect(state.field(rawText)).toBe(raw);
  state = state.update({ effects: safeSourceEffects() }).state;
  expect(decorations(state)).toHaveLength(0);
});
test("SubSup real Callout generator handles escaped visible whitespace and normal external slash", () => {
  for (const [raw, wanted] of [
    ["^\\ ^", false],
    // Original false oracle was rejected: whitespace prevents closing emphasis.
    ["^**\\ **^", true],
    ["^**&#32;**^", false],
    ["^\\\t^", false],
    ["^\\q^", true],
    ["\\ ", true],
    ["^`x`^", false],
    ["^x^", true],
  ] as const) {
    const state = createRawEditorState(raw),
      node = syntaxTree(state).topNode.firstChild!;
    const work = calloutInlineBody(state.doc, node, node.from, new Set());
    let step = work.next();
    while (!step.done) step = work.next();
    expect(step.value).toBe(wanted);
  }
});
test("SubSup actual image summary handles nested image, alt and frontmatter definition isolation", () => {
  const raw =
    "---\n[id]: wrong.png\n---\n\n^![a][id]^\n\n![~caption~](b.png)\n\n[id]: right.png";
  const result = summarizeImages(raw);
  expect(result.images.map((i) => i.alt)).toEqual(["a", "caption"]);
  expect(result.images.map((i) => result.sources[i.source].url)).toEqual([
    "right.png",
    "b.png",
  ]);
});
test("SubSup fold range hides source and positioning unfolds current selection", () => {
  const raw = "# A\n^a\\ b^\n# B\nend";
  let state = ready(raw);
  const work = headingStructureSteps(state);
  let next = work.next();
  while (!next.done) next = work.next();
  state = state.update({
    effects: headingStructureReady.of(next.value),
    selection: { anchor: 0 },
  }).state;
  state = headingToggleTransaction(state, next.value.sections[0])!.state;
  expect(foldedRanges(state).size).toBe(1);
  state = state.update({ selection: { anchor: 6 } }).state;
  expect(foldedRanges(state).size).toBe(0);
  expect(state.field(rawText)).toBe(raw);
});
test("SubSup new wire/profile rejects old grammar and editing profile", () => {
  const state = createRawEditorState("^x^"),
    wire = encodeMarkdownTree(syntaxTree(state));
  expect(wire.config).toBe(MARKDOWN_GRAMMAR);
  expect(() =>
    decodeMarkdownTree({
      ...wire,
      config:
        "commonmark-gfm-strike-task-table-frontmatter-highlight-5" as typeof MARKDOWN_GRAMMAR,
    })
  ).toThrow();
  const request = {
    requestId: 1,
    documentId: "subsup",
    revision: 1,
    text: "^x^",
    config: EDITING_CANONICAL_PROFILE,
  };
  expect(isCanonicalRequest(request)).toBe(true);
  expect(
    isCanonicalRequest({
      ...request,
      config:
        "commonmark-gfm-strike-task-autolink-table-callout-frontmatter-highlight-7",
    })
  ).toBe(false);
  expect(isSubSup("Superscript")).toBe(true);
});

test("SubSup incomplete parse and protected long line keep raw presentation", () => {
  const raw = "^" + "x".repeat(5000) + "^\n\nend",
    state = createRawEditorState(raw),
    tree = syntaxTree(state);
  const node = tree.topNode.firstChild!.firstChild!;
  expect(node.name).toBe("Superscript");
  expect(
    subSupPresentation(state, tree, node, { from: 0, to: 20 }, subSupBudget())
  ).toBeNull();
  expect(
    decorations(state).some((d) => d.className === "cm-live-superscript")
  ).toBe(false);
  const protectedState = createRawEditorState(
    "^" + "x".repeat(10000) + "^\n\nend"
  );
  expect(
    decorations(protectedState).some(
      (d) => d.className === "cm-live-superscript"
    )
  ).toBe(false);
});
test("SubSup nested hyperlink labels project only visible escapes, never URL or code", () => {
  const state = ready("^[a\\ b](u)^ ^`a\\ b`^\n\nend"),
    tree = syntaxTree(state);
  const root = tree.topNode.firstChild!.firstChild!;
  const output = subSupPresentation(
    state,
    tree,
    root,
    { from: 0, to: state.doc.length },
    subSupBudget()
  );
  expect(output?.slashes).toEqual([{ from: 3, to: 4 }]);
  expect(
    decorations(state)
      .filter((d) => !d.className)
      .some((d) => d.from === 16)
  ).toBe(false);
});
test("SubSup ancestor selection reveals link source while ordinary links retain behavior", () => {
  const raw = "^a[b](u)c^\n\nend";
  const hidden = (state: EditorState) =>
    decorations(state)
      .filter((d) => !d.className)
      .map((d) => [d.from, d.to]);
  const outside = ready(raw);
  expect(hidden(outside)).toContainEqual([2, 3]);
  expect(hidden(outside)).toContainEqual([4, 8]);
  const inside = outside.update({ selection: { anchor: 1 } }).state;
  expect(hidden(inside)).toHaveLength(0);
  expect(inside.field(rawText)).toBe(raw);
  const ordinary = ready("a[b](u)c\n\nend");
  expect(hidden(ordinary)).toEqual([
    [1, 2],
    [3, 7],
  ]);
  expect(
    hidden(ordinary.update({ selection: { anchor: 2 } }).state)
  ).toHaveLength(0);
});
test("ordinary link viewport does not consume SubSup budget or reveal later links", () => {
  const state = ready("[x](u) ".repeat(80) + "\n\nend");
  const hidden = decorations(state).filter((d) => !d.className);
  expect(hidden).toHaveLength(160);
  expect(hidden.some((d) => d.from === 553 && d.to === 554)).toBe(true);
  expect(hidden.some((d) => d.from === 555 && d.to === 559)).toBe(true);
});
test("SubSup uses actual live plugin composition lifecycle without dispatch during composition", async () => {
  let state = ready("^a\\ b^\n\nend");
  let dispatched = 0;
  const view = {
    get state() {
      return state;
    },
    get visibleRanges() {
      return [{ from: 0, to: state.doc.length }];
    },
    compositionStarted: false,
    dispatch() {
      dispatched++;
    },
  } as unknown as EditorView;
  const plugin = new LiveFormatting(view),
    before = plugin.decorations;
  plugin.compositionStart();
  const startState = state,
    tr = state.update({ selection: { anchor: 2 } });
  state = tr.state;
  const update = {
    state,
    startState,
    view,
    changes: tr.changes,
    transactions: [tr],
    selectionSet: true,
    docChanged: false,
    viewportChanged: false,
  } as unknown as ViewUpdate;
  plugin.update(update);
  expect(plugin.decorations).toBe(before);
  expect(dispatched).toBe(0);
  plugin.compositionEnd(view);
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(dispatched).toBe(1);
  plugin.update(update);
  expect(plugin.decorations).not.toBe(before);
  const hidden: number[] = [];
  plugin.decorations.between(0, state.doc.length, (from, _to, d) => {
    if (!(d.spec as { class?: string }).class) hidden.push(from);
  });
  expect(hidden).toHaveLength(0);
  plugin.compositionEnd(view);
  plugin.destroy();
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(dispatched).toBe(1);
  expect(state.field(rawText)).toBe("^a\\ b^\n\nend");
});
