import { expect, test } from "bun:test";

import {
  insertNewlineAndIndent,
  redo,
  undo,
  undoDepth,
} from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, type Transaction } from "@codemirror/state";

import { parseReadingMarkdown as parseCanonicalMarkdown } from "./canonical-parser";
import { switchEditorMode } from "./editor-mode";
import { listContinuationTransaction } from "./list-continuation";
import { createRawEditorState, rawText } from "./raw-buffer";
import { taskContinuationContext } from "./task-continuation-context";

function setup(raw: string, points: number[][], source = true, parse = true) {
  let state = createRawEditorState(raw);
  if (source)
    state = state.update({ effects: switchEditorMode("source") }).state;
  if (parse) ensureSyntaxTree(state, state.doc.length, 1000);
  return state.update({
    selection: EditorSelection.create(
      points.map(([a, h]) => EditorSelection.range(a, h ?? a)),
      points.length - 1
    ),
  }).state;
}
function roundtrip(
  state: ReturnType<typeof setup>,
  soft: boolean,
  expected: string,
  carets: number[]
) {
  const original = state;
  state = listContinuationTransaction(state, soft).state;
  expect(state.field(rawText)).toBe(expected);
  expect(state.selection.ranges.map((r) => [r.anchor, r.head])).toEqual(
    carets.map((p) => [p, p])
  );
  expect(state.selection.mainIndex).toBe(carets.length - 1);
  expect(undoDepth(state)).toBe(1);
  const target = () => ({
    state,
    dispatch: (tx: Transaction) => {
      state = tx.state;
    },
  });
  expect(undo(target())).toBe(true);
  expect(state.field(rawText)).toBe(original.field(rawText));
  expect(state.selection.eq(original.selection)).toBe(true);
  expect(redo(target())).toBe(true);
  expect(state.field(rawText)).toBe(expected);
  return state;
}

test("task continuation raw/selection/history in editing and source", () => {
  const samples: [string, number[][], boolean, string, number[]][] = [
    ["- [x] AAA", [[9]], false, "- [x] AAA\n- [ ] ", [16]],
    ["+ [X] AAA", [[9]], false, "+ [X] AAA\n+ [ ] ", [16]],
    [
      "1. [x] AAA\n2. [ ] BBB",
      [[10]],
      false,
      "1. [x] AAA\n2. [ ] \n3. [ ] BBB",
      [18],
    ],
    [
      "1. [x] AAA\n7. [ ] BBB",
      [[10]],
      false,
      "1. [x] AAA\n2. [ ] \n7. [ ] BBB",
      [18],
    ],
    ["- A\n  + [x] BBB", [[15]], false, "- A\n  + [x] BBB\n  + [ ] ", [24]],
    ["- [ ] ", [[6]], false, "", [0]],
    ["- [ ]", [[5]], false, "", [0]],
    ["- A\n  + [ ] ", [[12]], false, "- A\n- ", [6]],
    ["- [x] AAA", [[9]], true, "- [x] AAA\n  ", [12]],
    [
      "\ufeff- [X] AAA\r\n- BBB",
      [[10]],
      false,
      "\ufeff- [X] AAA\r\n- [ ] \r\n- BBB",
      [17],
    ],
    ["A\r\r- [x] AAA", [[12]], false, "A\r\r- [x] AAA\n- [ ] ", [19]],
    ["- [x] AAA", [[9, 7]], false, "- [x] A\n- [ ] ", [14]],
    ["- [x] AAA", [[8]], false, "- [x] AA\n- [ ] A", [15]],
  ];
  for (const source of [false, true])
    for (const [raw, ranges, soft, out, carets] of samples)
      roundtrip(setup(raw, ranges, source), soft, out, carets);
});

test("source mixed task/list/plain and canonical new-item parent/state", () => {
  roundtrip(
    setup("- [x] AAA\n\nPLAIN", [[9], [16]]),
    false,
    "- [x] AAA\n- [ ] \n\nPLAIN\n",
    [16, 24]
  );
  roundtrip(
    setup("- [x] AAA\n- BBB", [[9], [15]]),
    false,
    "- [x] AAA\n- [ ] \n- BBB\n- ",
    [16, 25]
  );
  const state = roundtrip(
    setup("- A\n  + [x] BBB", [[15]]),
    false,
    "- A\n  + [x] BBB\n  + [ ] ",
    [24]
  );
  const filled = state
    .update({ changes: { from: 24, insert: "NEW" } })
    .state.field(rawText);
  const root = parseCanonicalMarkdown(filled),
    items: { depth: number; checked: boolean | null }[] = [];
  function visit(
    node: typeof root | (typeof root.children)[number],
    depth = -1
  ) {
    const next = node.type === "list" ? depth + 1 : depth;
    if (node.type === "listItem")
      items.push({ depth: next, checked: node.checked ?? null });
    if ("children" in node)
      for (const child of node.children) visit(child, next);
  }
  visit(root);
  expect(items).toEqual([
    { depth: 0, checked: null },
    { depth: 1, checked: true },
    { depth: 1, checked: false },
  ]);
});

test("every task failure returns the exact whole ordinary Enter transaction", () => {
  const samples: [string, number[][], boolean?][] = [
    ["- [x] AAA\n- [ ] BBB", [[3], [19]]],
    ["PLAIN\n\n- [x] AAA", [[0, 12], [16]]],
    ["- [x] AAA\n- [ ] BBB", [[8, 12], [19]]],
    ["999999999. [x] AAA", [[17]]],
    ["- [x] OK\n\n999999999. [x] AAA", [[8], [27]]],
    ["- [x] AAA\n- [ ] BBB", [[9], [10]]],
    ["- [x] AAA\n\n" + "x".repeat(10000), [[9], [20]]],
    ["- [x] AAA\n".repeat(4000), [[9], [39999]], false],
  ];
  for (const [raw, ranges, parse] of samples)
    for (const soft of [false, true]) {
      if (soft && raw.includes("999999999.")) continue; // Soft break creates no number.
      const before = setup(raw, ranges, true, parse !== false);
      let ordinary: Transaction | undefined;
      insertNewlineAndIndent({
        state: before,
        dispatch: (tx) => {
          ordinary = tx;
        },
      });
      const actual = listContinuationTransaction(before, soft);
      expect(actual.state.field(rawText)).toBe(ordinary!.state.field(rawText));
      expect(actual.state.selection.eq(ordinary!.state.selection)).toBe(true);
      expect(undoDepth(actual.state)).toBe(undoDepth(ordinary!.state));
    }
  expect(taskContinuationContext(setup("PLAIN\n\n- [x] AAA", [[0, 12]]))).toBe(
    "task"
  );
  expect(taskContinuationContext(setup("plain", [[5]]))).toBe("none");
});

test("retired task group cannot revive through recursive planning", () => {
  const state = setup("- [x] AAA\n- [ ] BBB", [[9], [19]]);
  let expected: Transaction | undefined;
  insertNewlineAndIndent({
    state,
    dispatch: (tx) => {
      expected = tx;
    },
  });
  const actual = listContinuationTransaction(state, false, new Set([0]));
  expect(actual.state.field(rawText)).toBe(expected!.state.field(rawText));
  expect(actual.state.selection.eq(expected!.state.selection)).toBe(true);
});

test("reliable no-gap bracket text retains ordinary list continuation", () => {
  for (const raw of ["- [x](url)", "- [x]suffix", "- [ ]x"]) {
    const state = setup(raw, [[raw.length]]);
    expect(taskContinuationContext(state)).toBe("none");
    roundtrip(state, false, raw + "\n- ", [raw.length + 3]);
  }
});

test("unsupported blocks inside task ancestors abort all tasks, independent code does not", () => {
  for (const block of [
    "  ```\n  code\n  ```",
    "      code",
    "  <div>\n  code\n  </div>",
  ]) {
    const raw = "- [x] A\n\n" + block + "\n\n- [x] B";
    const state = setup(raw, [[raw.indexOf("code") + 2], [raw.length]]);
    let expected: Transaction | undefined;
    insertNewlineAndIndent({
      state,
      dispatch: (tx) => {
        expected = tx;
      },
    });
    const tx = listContinuationTransaction(state, false);
    expect(tx.state.field(rawText)).toBe(expected!.state.field(rawText));
    expect(tx.state.selection.eq(expected!.state.selection)).toBe(true);
    let restored = tx.state;
    expect(
      undo({
        state: restored,
        dispatch: (t) => {
          restored = t.state;
        },
      })
    ).toBe(true);
    expect(restored.field(rawText)).toBe(raw);
  }
  const raw = "```\ncode\n```\n\n- [x] B";
  const result = listContinuationTransaction(
    setup(raw, [[6], [raw.length]]),
    false
  ).state.field(rawText);
  expect(result).toBe("```\nco\nde\n```\n\n- [x] B\n- [ ] ");
});

test("task Enter isolates itself from adjacent ordinary typing", () => {
  let state = setup("- [x] AA", [[8]]);
  state = state.update({
    changes: { from: 8, insert: "A" },
    selection: EditorSelection.cursor(9),
    userEvent: "input.type",
  }).state;
  state = listContinuationTransaction(state, false).state;
  state = state.update({
    changes: { from: 16, insert: "Z" },
    selection: EditorSelection.cursor(17),
    userEvent: "input.type",
  }).state;
  const target = () => ({
    state,
    dispatch: (tx: Transaction) => {
      state = tx.state;
    },
  });
  expect(undo(target())).toBe(true);
  expect(state.field(rawText)).toBe("- [x] AAA\n- [ ] ");
  expect(undo(target())).toBe(true);
  expect(state.field(rawText)).toBe("- [x] AAA");
  expect(undo(target())).toBe(true);
  expect(state.field(rawText)).toBe("- [x] AA");
  expect(redo(target())).toBe(true);
  expect(redo(target())).toBe(true);
  expect(state.field(rawText)).toBe("- [x] AAA\n- [ ] ");
});
