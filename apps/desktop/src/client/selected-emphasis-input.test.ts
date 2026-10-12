import { expect, test } from "bun:test";

import { redo, undo } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  type Transaction,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { parseCanonicalMarkdown } from "./canonical-parser";
import {
  handlePairingInput,
  registerPairingView,
  selectedInlineTransaction,
} from "./contextual-pairing";
import { switchEditorMode } from "./editor-mode";
import {
  createRawEditorState,
  rawOffset,
  rawText,
  writePermission,
} from "./raw-buffer";

function selected(
  raw: string,
  ranges: [number, number][],
  source = false,
  main = 0
) {
  let state = createRawEditorState(raw);
  if (source)
    state = state.update({ effects: switchEditorMode("source") }).state;
  return state.update({
    selection: EditorSelection.create(
      ranges.map(([a, h]) => EditorSelection.range(a, h)),
      main
    ),
  }).state;
}

test("star wrapping preserves exact emphasis boundaries, untouched text and raw history", () => {
  for (const [raw, from, to] of [
    ["LEFT 中文😀 RIGHT", 5, 9],
    ["(abc)", 1, 4],
    ["abc", 1, 2],
    ["LEFT a,b! RIGHT", 5, 9],
    ["*BEFORE\nabc AFTER", 8, 11],
    ["BEFORE *\nabc AFTER", 9, 12],
    ["> abc END", 2, 5],
    ["- abc END", 2, 5],
    ["\ufeffHEAD\r\n\r\nabc END", 7, 10],
  ] as [string, number, number][])
    for (const source of [false, true])
      for (const reverse of [false, true]) {
        const original = selected(
          raw,
          [reverse ? [to, from] : [from, to]],
          source
        );
        let state = selectedInlineTransaction(original, "italic")!.state;
        const completed = state.field(rawText),
          parsed = parseCanonicalMarkdown(completed);
        type Node = typeof parsed | (typeof parsed.children)[number];
        const text = (node: Node): string =>
          "value" in node
            ? node.value
            : "children" in node
              ? node.children.map(text).join("")
              : "";
        const nodes: Node[] = [];
        const visit = (node: Node) => {
          if (node.type === "emphasis") nodes.push(node);
          if ("children" in node) node.children.forEach(visit);
        };
        visit(parsed);
        expect(text(parsed)).toBe(text(parseCanonicalMarkdown(raw)));
        expect(nodes).toHaveLength(1);
        expect(text(nodes[0])).toBe(original.sliceDoc(from, to));
        expect(nodes[0].position!.start.offset).toBe(
          rawOffset(completed, from)
        );
        expect(nodes[0].position!.end.offset).toBe(
          rawOffset(completed, to + 2)
        );
        expect([
          state.selection.main.anchor,
          state.selection.main.head,
        ]).toEqual(reverse ? [to + 1, from + 1] : [from + 1, to + 1]);
        const dispatch = (tx: Transaction) => {
          state = tx.state;
        };
        expect(undo({ state, dispatch })).toBe(true);
        expect(state.field(rawText)).toBe(raw);
        expect(state.selection.eq(original.selection)).toBe(true);
        expect(redo({ state, dispatch })).toBe(true);
        expect(state.field(rawText)).toBe(completed);
      }
});

test("whole selection group falls through for whitespace, existing syntax and unsupported input", () => {
  for (const [raw, ranges] of [
    ["X  abc Y", [[2, 6]]],
    ["X abc  Y", [[2, 6]]],
    ["X    Y", [[2, 4]]],
    ["*abc*", [[1, 4]]],
    ["*abc*", [[0, 5]]],
    ["**abc**", [[2, 5]]],
    ["*abc", [[1, 4]]],
    ["a\\*b", [[0, 4]]],
    ["`abc`", [[1, 4]]],
    ["[abc](x)", [[1, 4]]],
    ["```\nabc\n```", [[4, 7]]],
    ["<div>abc</div>", [[5, 8]]],
    ["abc", [[1, 1]]],
    ["abc\ndef", [[0, 5]]],
    [
      "AAA\nBBB",
      [
        [0, 3],
        [7, 7],
      ],
    ],
    [
      "AAA *BBB*",
      [
        [0, 3],
        [5, 8],
      ],
    ],
  ] as [string, [number, number][]][]) {
    const state = selected(raw, ranges, true);
    expect(selectedInlineTransaction(state, "italic")).toBeUndefined();
    expect(state.field(rawText)).toBe(raw);
  }
});

test("same-container ranges map once and do not absorb intervening text", () => {
  let calls = 0;
  let state = createRawEditorState(
    "AAA between BBB",
    EditorState.transactionFilter.of((tx) => {
      calls++;
      return tx;
    })
  );
  state = state.update({ effects: switchEditorMode("source") }).state;
  state = state.update({
    selection: EditorSelection.create(
      [EditorSelection.range(3, 0), EditorSelection.range(12, 15)],
      1
    ),
  }).state;
  calls = 0;
  const tx = selectedInlineTransaction(state, "italic")!;
  expect(calls).toBe(1);
  expect(tx.newDoc.toString()).toBe("*AAA* between *BBB*");
  expect(tx.newSelection.ranges.map((r) => [r.anchor, r.head])).toEqual([
    [4, 1],
    [15, 18],
  ]);
  expect(tx.newSelection.mainIndex).toBe(1);
  const parsed = parseCanonicalMarkdown(tx.state.field(rawText));
  expect(parsed.children[0]).toMatchObject({
    type: "paragraph",
    children: [
      { type: "emphasis", children: [{ type: "text", value: "AAA" }] },
      { type: "text", value: " between " },
      { type: "emphasis", children: [{ type: "text", value: "BBB" }] },
    ],
  });
});

test("star wrapping alone isolates preceding and subsequent ordinary typing", () => {
  let state = createRawEditorState("a");
  state = state.update({
    changes: { from: 1, insert: "bc" },
    selection: { anchor: 0, head: 3 },
    userEvent: "input.type",
  }).state;
  state = selectedInlineTransaction(state, "italic")!.state;
  state = state.update({
    changes: { from: 5, insert: "!" },
    userEvent: "input.type",
  }).state;
  const dispatch = (tx: Transaction) => {
    state = tx.state;
  };
  for (const raw of ["*abc*", "abc", "a"]) {
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.field(rawText)).toBe(raw);
  }
  for (const raw of ["abc", "*abc*", "*abc*!"]) {
    expect(redo({ state, dispatch })).toBe(true);
    expect(state.field(rawText)).toBe(raw);
  }
});

test("star input shares strict lifecycle and leaves the old pair branch independent", () => {
  let ordinary = true,
    strict = true,
    accepted = true,
    calls = 0;
  const fake = {
    state: selected("abc", [[0, 3]]),
    compositionStarted: false,
    composing: false,
    dispatch(tx: Transaction) {
      calls++;
      if (accepted) this.state = tx.state;
    },
  };
  const view = fake as unknown as EditorView;
  const old = registerPairingView(
    view,
    () => ordinary,
    () => strict
  );
  const release = registerPairingView(
    view,
    () => ordinary,
    () => strict
  );
  old();
  strict = false;
  expect(handlePairingInput(view, 0, 3, "*")).toBe(false);
  expect(calls).toBe(0);
  expect(handlePairingInput(view, 0, 3, "(")).toBe(true);
  fake.state = selected("abc", [[0, 3]]);
  strict = true;
  ordinary = false;
  expect(handlePairingInput(view, 0, 3, "*")).toBe(false);
  ordinary = true;
  fake.compositionStarted = true;
  expect(handlePairingInput(view, 0, 3, "*")).toBe(false);
  fake.compositionStarted = false;
  fake.composing = true;
  expect(handlePairingInput(view, 0, 3, "*")).toBe(false);
  fake.composing = false;
  for (const input of ["**", "_"])
    expect(handlePairingInput(view, 0, 3, input)).toBe(false);
  expect(handlePairingInput(view, 1, 3, "*")).toBe(false);
  fake.state = fake.state.update({
    effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
  }).state;
  expect(handlePairingInput(view, 0, 3, "*")).toBe(false);
  expect(calls).toBe(1);
  fake.state = selected("abc", [[0, 3]]);
  accepted = false;
  expect(handlePairingInput(view, 0, 3, "*")).toBe(false);
  accepted = true;
  expect(handlePairingInput(view, 0, 3, "*")).toBe(true);
  expect(fake.state.field(rawText)).toBe("*abc*");
  expect(handlePairingInput(view, 1, 4, "*")).toBe(false); // No repeated-star upgrade or toggle.
  release();
  expect(handlePairingInput(view, 1, 4, "*")).toBe(false);
  expect(calls).toBe(3);
});
