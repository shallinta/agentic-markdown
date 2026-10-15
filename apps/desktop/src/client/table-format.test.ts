import { expect, test } from "bun:test";

import { isolateHistory, redo, undo, undoDepth } from "@codemirror/commands";
import {
  ensureSyntaxTree,
  syntaxTree,
  syntaxTreeAvailable,
} from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  type Transaction,
} from "@codemirror/state";

import { parseReadingMarkdown as parseCanonicalMarkdown } from "./canonical-parser";
import { switchEditorMode } from "./editor-mode";
import { inlineFormatTransaction, planInlineFormat } from "./inline-format";
import { planListIndentation } from "./list-indentation";
import { longLineProtection } from "./long-line-protection";
import { planQuoteIndentation } from "./quote-indentation";
import { createRawEditorState, editorOffset, rawText } from "./raw-buffer";
import { tableGapIndex } from "./table-format";

type Node =
  | ReturnType<typeof parseCanonicalMarkdown>
  | ReturnType<typeof parseCanonicalMarkdown>["children"][number];
function text(node: Node): string {
  if ("value" in node) return node.value;
  return "children" in node ? node.children.map(text).join("") : "";
}
function tables(raw: string) {
  const result: { depth: number; align: unknown; rows: string[][] }[] = [];
  function visit(node: Node, depth: number) {
    if (node.type === "table")
      result.push({
        depth,
        align: node.align,
        rows: node.children.map((r) => r.children.map(text)),
      });
    if ("children" in node)
      for (const child of node.children)
        visit(child, depth + (node.type === "blockquote" ? 1 : 0));
  }
  visit(parseCanonicalMarkdown(raw), 0);
  return result;
}
function selected(raw: string, ranges: number[][], source = false) {
  let state = createRawEditorState(raw, [
    EditorState.allowMultipleSelections.of(true),
  ]);
  if (source)
    state = state.update({ effects: switchEditorMode("source") }).state;
  expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull();
  return state.update({
    selection: EditorSelection.create(
      ranges.map((r) => EditorSelection.range(r[0], r[1] ?? r[0])),
      ranges.length - 1
    ),
  }).state;
}
function roundTrip(initial: EditorState, transaction: Transaction) {
  let state = transaction.state;
  const output = state.field(rawText);
  const target = {
    get state() {
      return state;
    },
    dispatch(t: Transaction) {
      state = t.state;
    },
  };
  expect(undo(target)).toBe(true);
  expect(state.field(rawText)).toBe(initial.field(rawText));
  expect(state.selection.eq(initial.selection)).toBe(true);
  expect(redo(target)).toBe(true);
  expect(state.field(rawText)).toBe(output);
  return transaction.state;
}
const basic = "a | b\n--- | ---\nalpha | beta";

test("single cell formats, reverse selection, headers and existing toggles retain cells", () => {
  for (const kind of ["bold", "italic", "code"] as const)
    for (const range of [
      [16, 21],
      [21, 16],
      [0, 1],
      [24, 28],
    ]) {
      const state = selected(basic, [range]);
      const transaction = inlineFormatTransaction(state, kind);
      expect(transaction).toBeDefined();
      const result = roundTrip(state, transaction!);
      expect(tables(result.field(rawText))).toEqual(tables(basic));
      expect(
        result.sliceDoc(result.selection.main.from, result.selection.main.to)
      ).toBe(
        state.sliceDoc(state.selection.main.from, state.selection.main.to)
      );
      expect(result.selection.main.anchor > result.selection.main.head).toBe(
        range[0] > range[1]
      );
    }
  const raw = "a | b\n--- | ---\n**alpha** | beta",
    state = selected(raw, [[20]]);
  const transaction = inlineFormatTransaction(state, "bold")!;
  expect(roundTrip(state, transaction).field(rawText)).toBe(basic);
  expect(planInlineFormat(state, "bold", "wrap-only")).toBeUndefined();
  const code = "a | b\n--- | ---\n`a\\|b` | beta",
    codeState = selected(code, [[18]]);
  expect(
    tables(
      roundTrip(codeState, inlineFormatTransaction(codeState, "code")!).field(
        rawText
      )
    )
  ).toEqual(tables(code));
});

test("nonempty cell caret endpoints and true ASCII gaps preserve every other cell and alignment", () => {
  for (const position of [16, 18, 21]) {
    const state = selected(basic, [[position]]);
    const next = roundTrip(state, inlineFormatTransaction(state, "bold")!);
    expect(tables(next.field(rawText))[0].rows).toEqual([
      ["a", "b"],
      [
        "alpha".slice(0, position - 16) + "文本" + "alpha".slice(position - 16),
        "beta",
      ],
    ]);
    expect(
      next.sliceDoc(next.selection.main.from, next.selection.main.to)
    ).toBe("文本");
    expect(planInlineFormat(state, "bold", "wrap-only")).toBeUndefined();
  }
  const samples: [string, number, number, number][] = [
    ["| a | b |\n| :-- | --: |\n| | beta |", 25, 1, 0],
    ["| | b |\n| :-: | --- |\n| x | y |", 1, 0, 0],
    ["| a | b |\n| --- | --- |\n|\t| beta |", 25, 1, 0],
    ["a | b | c\n--- | --- | ---\nx | | y", 29, 1, 1],
    ["| a | b |\n| --- | --- |\n| | |", 25, 1, 0],
  ];
  for (const [raw, position, row, column] of samples)
    for (const kind of ["bold", "italic", "code"] as const) {
      const state = selected(raw, [[position]]),
        before = tables(raw);
      const transaction = inlineFormatTransaction(state, kind);
      expect(transaction).toBeDefined();
      const next = roundTrip(state, transaction!);
      expect(before[0].rows[row][column]).toBe("");
      before[0].rows[row][column] = "文本";
      expect(tables(next.field(rawText))).toEqual(before);
      expect(
        next.sliceDoc(next.selection.main.from, next.selection.main.to)
      ).toBe("文本");
    }
});

test("outside pipes, absent trailing columns, structural and mixed ranges refuse atomically", () => {
  for (const [raw, ranges] of [
    ["a | b\n--- | ---\n | beta", [[16]]],
    ["a | b\n--- | ---\nalpha | ", [[24]]],
    [basic, [[6, 15]]],
    [basic, [[16, 28]]],
    [basic, [[18], [6, 15]]],
    ["| a | b |\n| --- | --- |\n|   | beta |", [[25], [26]]],
    ["a | b\n--- | ---\na\\|b | beta", [[16, 20]]],
  ] as [string, number[][]][]) {
    const state = selected(raw, ranges, true),
      selection = state.selection;
    expect(inlineFormatTransaction(state, "bold")).toBeUndefined();
    expect(state.field(rawText)).toBe(raw);
    expect(state.selection).toBe(selection);
    expect(undoDepth(state)).toBe(0);
  }
});

test("two cells and independent table windows preserve main direction and exact BOM/EOL history", () => {
  for (const [raw, ranges] of [
    [
      basic,
      [
        [16, 21],
        [28, 24],
      ],
    ],
    [
      basic + "\n\n" + basic,
      [
        [16, 21],
        [51, 46],
      ],
    ],
  ] as [string, number[][]][]) {
    const state = selected(raw, ranges, true),
      next = roundTrip(state, inlineFormatTransaction(state, "bold")!);
    expect(next.selection.mainIndex).toBe(1);
    expect(next.selection.main.anchor).toBeGreaterThan(
      next.selection.main.head
    );
    expect(tables(next.field(rawText))).toEqual(tables(raw));
  }
  const raw = "\ufeffa | b\r\n--- | ---\ralpha | beta\n";
  const from = editorOffset(raw, raw.indexOf("alpha"));
  const state = selected(raw, [[from, from + 5]]);
  expect(
    roundTrip(state, inlineFormatTransaction(state, "bold")!).field(rawText)
  ).toBe("\ufeffa | b\r\n--- | ---\r**alpha** | beta\n");
});

test("quote tables use whole block units and keep neighbouring paragraphs and tables", () => {
  const quote = "> a | b\n> --- | ---\n> c | d";
  for (const more of [true, false]) {
    const state = selected(
      quote,
      [
        [2, 3],
        [22, 23],
      ],
      true
    );
    const plan = planQuoteIndentation(state, more)!;
    expect(plan.reason).toBeUndefined();
    const next = roundTrip(
      state,
      state.update({
        changes: plan.changes,
        annotations: isolateHistory.of("full"),
      })
    );
    const expected = tables(quote);
    expected[0].depth += more ? 1 : -1;
    expect(tables(next.field(rawText))).toEqual(expected);
  }
  const raw = "> before\n>\n" + quote + "\n>\n> after",
    state = selected(raw, [[13, 14]]);
  const plan = planQuoteIndentation(state, true)!;
  expect(plan.reason).toBeUndefined();
  const next = roundTrip(
    state,
    state.update({
      changes: plan.changes,
      annotations: isolateHistory.of("full"),
    })
  );
  expect(next.field(rawText)).toBe(
    "> before\n>\n> > a | b\n> > --- | ---\n> > c | d\n>\n> after"
  );
  const sep = "\n\np1\n\np2\n\np3\n\n",
    both = quote + sep + quote;
  const multiple = selected(
    both,
    [
      [2, 3],
      [quote.length + sep.length + 2, quote.length + sep.length + 3],
    ],
    true
  );
  const multiPlan = planQuoteIndentation(multiple, true)!;
  expect(multiPlan.reason).toBeUndefined();
  const result = roundTrip(
    multiple,
    multiple.update({
      changes: multiPlan.changes,
      annotations: isolateHistory.of("full"),
    })
  );
  expect(tables(result.field(rawText)).map((t) => t.depth)).toEqual([2, 2]);
});

test("list moves retain the full table value, markers and task status", () => {
  for (const raw of [
    "- first\n- a | b\n  :-- | --:\n  `a\\|b` | &amp;",
    "- first\n- [x] done\n\n  a | b\n  :-: | ---\n  c | d",
  ]) {
    const state = selected(raw, [[10]]);
    const plan = planListIndentation(state, true)!;
    expect(plan.reason).toBeUndefined();
    const result = roundTrip(
      state,
      state.update({
        changes: plan.changes,
        annotations: isolateHistory.of("full"),
      })
    );
    expect(tables(result.field(rawText))).toEqual(tables(raw));
    if (raw.includes("[x]"))
      expect(result.field(rawText)).toContain("[x] done");
  }
});

test("partial, protected and aggregate-budget table operations are rejected before mutation", () => {
  let state = createRawEditorState(
    "a | b\n--- | ---\n" + "x".repeat(10000) + " | y"
  );
  expect(state.field(longLineProtection).length).toBeGreaterThan(0);
  state = state.update({ selection: { anchor: 16, head: 17 } }).state;
  expect(planInlineFormat(state, "bold")).toBeUndefined();
  const block = "a | b\n--- | ---\n" + "x".repeat(5100) + " | y";
  state = selected(
    block + "\n\n" + block,
    [
      [16, 17],
      [block.length + 18, block.length + 19],
    ],
    true
  );
  expect(state.field(longLineProtection)).toEqual([]);
  expect(planInlineFormat(state, "bold")).toBeUndefined();
  const large = "paragraph\n\n".repeat(20000) + basic;
  state = createRawEditorState(large);
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
  state = state.update({
    selection: { anchor: state.doc.length - 4, head: state.doc.length },
  }).state;
  expect(planInlineFormat(state, "bold")).toBeUndefined();
  expect(state.field(rawText)).toBe(large);
  expect(undoDepth(state)).toBe(0);
});

test("command-local row index reuses one direct-child scan for many gap queries", () => {
  const row = "|" + " |".repeat(400);
  const raw = row + "\n|" + " --- |".repeat(400);
  const state = selected(raw, [[1]]);
  const header = syntaxTree(state).topNode.firstChild!.firstChild!;
  const lookup = tableGapIndex(state.doc);
  for (let i = 0; i < 400; i++)
    expect(lookup(header, 1 + i * 2)?.from).toBe(1 + i * 2);
  // Identical gap objects demonstrate reuse inside this command, not parser work.
  expect(lookup(header, 1)).toBe(lookup(header, 1));
  const ranges = Array.from({ length: 100 }, (_, i) => [1 + i * 2]);
  const many = selected(raw, ranges, true);
  const started = performance.now(),
    plan = planInlineFormat(many, "bold");
  expect(plan).toBeDefined();
  expect(plan!.selection.mainIndex).toBe(99);
  console.info(
    "F045h bounded wide row / 100 carets ms",
    performance.now() - started
  );
});

test("table format is isolated from adjacent typing without replacing raw history", () => {
  let state = createRawEditorState("a | b\n--- | ---\nalpha | bet");
  state = state.update({
    changes: { from: state.doc.length, insert: "a" },
    userEvent: "input.type",
  }).state;
  state = state.update({ selection: { anchor: 16, head: 21 } }).state;
  const transaction = inlineFormatTransaction(state, "bold")!;
  expect(transaction).toBeDefined();
  state = transaction.state;
  const formatted = state.field(rawText);
  state = state.update({
    changes: { from: state.doc.length, insert: "Q" },
    userEvent: "input.type",
  }).state;
  const target = {
    get state() {
      return state;
    },
    dispatch(t: Transaction) {
      state = t.state;
    },
  };
  for (const expected of [formatted, basic, "a | b\n--- | ---\nalpha | bet"]) {
    expect(undo(target)).toBe(true);
    expect(state.field(rawText)).toBe(expected);
  }
  for (const expected of [basic, formatted, formatted + "Q"]) {
    expect(redo(target)).toBe(true);
    expect(state.field(rawText)).toBe(expected);
  }
});
