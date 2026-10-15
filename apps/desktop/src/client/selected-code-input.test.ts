import { expect, test } from "bun:test";

import { redo, undo, undoDepth } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  type Transaction,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { parseReadingMarkdown as parseCanonicalMarkdown } from "./canonical-parser";
import {
  handlePairingInput,
  registerPairingView,
  selectedCodeTransaction,
} from "./contextual-pairing";
import { switchEditorMode } from "./editor-mode";
import { planInlineFormat } from "./inline-format";
import { createRawEditorState, rawText, writePermission } from "./raw-buffer";

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

test("selected code preserves canonical payload, raw EOL and range direction", () => {
  for (const source of [false, true])
    for (const payload of ["中文😀", "a`b", "`a", "a`", " a ", "   "])
      for (const reverse of [false, true]) {
        const raw = "\ufeffHEAD\r\n\r\nSTART " + payload + " END";
        const original = selected(
          raw,
          [reverse ? [13 + payload.length, 13] : [13, 13 + payload.length]],
          source
        );
        let state = selectedCodeTransaction(original)!.state;
        const completed = state.field(rawText);
        const parsed = parseCanonicalMarkdown(completed);
        const codes: string[] = [];
        const visit = (
          node: typeof parsed | (typeof parsed.children)[number]
        ) => {
          if (node.type === "inlineCode") codes.push(node.value);
          if ("children" in node)
            for (const child of node.children) visit(child);
        };
        visit(parsed);
        expect(codes).toEqual([payload]);
        expect(completed.startsWith("\ufeffHEAD\r\n\r\nSTART ")).toBe(true);
        expect(state.selection.main.anchor > state.selection.main.head).toBe(
          reverse
        );
        expect(undoDepth(state)).toBe(1);
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

test("wrap intent does not unwrap or contaminate the default toggle cache", () => {
  const code = selected("`abc`", [[1, 4]]);
  const toggle = planInlineFormat(code, "code")!;
  expect(code.update(toggle).newDoc.toString()).toBe("abc");
  expect(planInlineFormat(code, "code", "wrap-only")).toBeUndefined();
  expect(planInlineFormat(code, "code")).toBe(toggle);
  const full = selected("`abc`", [[0, 5]]);
  expect(selectedCodeTransaction(full)).toBeUndefined();
  expect(planInlineFormat(full, "code")).toBeDefined();
  for (const [raw, ranges] of [
    ["abc", [[1, 1]]],
    ["abc\ndef", [[0, 5]]],
    ["```\nabc\n```", [[4, 7]]],
    ["<div>x</div>", [[5, 6]]],
    [
      "AAA\nBBB",
      [
        [0, 3],
        [7, 7],
      ],
    ],
    ["a".repeat(10001), [[0, 3]]],
  ] as [string, [number, number][]][])
    expect(
      selectedCodeTransaction(selected(raw, ranges, true))
    ).toBeUndefined();
});

test("multiple ranges use one transaction filter and retain main range", () => {
  let calls = 0;
  let state = createRawEditorState(
    "AAA\nBBB",
    EditorState.transactionFilter.of((tx) => {
      calls++;
      return tx;
    })
  );
  state = state.update({ effects: switchEditorMode("source") }).state;
  state = state.update({
    selection: EditorSelection.create(
      [EditorSelection.range(3, 0), EditorSelection.range(4, 7)],
      1
    ),
  }).state;
  calls = 0;
  const tx = selectedCodeTransaction(state)!;
  expect(calls).toBe(1);
  expect(tx.newDoc.toString()).toBe("`AAA`\n`BBB`");
  expect(tx.newSelection.ranges.map((r) => [r.anchor, r.head])).toEqual([
    [4, 1],
    [7, 10],
  ]);
  expect(tx.newSelection.mainIndex).toBe(1);
});

test("wrapping alone isolates prior and subsequent ordinary typing", () => {
  let state = createRawEditorState("a");
  state = state.update({
    changes: { from: 1, insert: "bc" },
    selection: { anchor: 0, head: 3 },
    userEvent: "input.type",
  }).state;
  state = selectedCodeTransaction(state)!.state;
  state = state.update({
    changes: { from: 5, insert: "!" },
    userEvent: "input.type",
  }).state;
  const dispatch = (tx: Transaction) => {
    state = tx.state;
  };
  for (const raw of ["`abc`", "abc", "a"]) {
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.field(rawText)).toBe(raw);
  }
  for (const raw of ["abc", "`abc`", "`abc`!"]) {
    expect(redo({ state, dispatch })).toBe(true);
    expect(state.field(rawText)).toBe(raw);
  }
});

test("public input seam falls through without dispatch for stale or unsupported input", () => {
  let ordinary = true,
    strict = true,
    calls = 0;
  const fake = {
    state: selected("abc", [[0, 3]]),
    compositionStarted: false,
    composing: false,
    dispatch(tx: Transaction) {
      calls++;
      this.state = tx.state;
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
  old(); // An older lifecycle cannot remove a newer registration.
  strict = false;
  expect(handlePairingInput(view, 0, 3, "`")).toBe(false);
  strict = true;
  ordinary = false;
  expect(handlePairingInput(view, 0, 3, "`")).toBe(false);
  ordinary = true;
  fake.compositionStarted = true;
  expect(handlePairingInput(view, 0, 3, "`")).toBe(false);
  fake.compositionStarted = false;
  fake.composing = true;
  expect(handlePairingInput(view, 0, 3, "`")).toBe(false);
  fake.composing = false;
  expect(handlePairingInput(view, 1, 3, "`")).toBe(false);
  expect(handlePairingInput(view, 0, 3, "``")).toBe(false);
  fake.state = fake.state.update({
    effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
  }).state;
  expect(handlePairingInput(view, 0, 3, "`")).toBe(false);
  expect(calls).toBe(0);
  fake.state = selected("abc", [[0, 3]]);
  expect(handlePairingInput(view, 0, 3, "`")).toBe(true);
  expect(calls).toBe(1);
  expect(fake.state.field(rawText)).toBe("`abc`");
  release();
  expect(handlePairingInput(view, 1, 4, "`")).toBe(false);
});

test("selected-code guard does not change old pairing and declined dispatch falls through", () => {
  let calls = 0;
  const fake = {
    state: selected("abc", [[0, 3]]),
    compositionStarted: false,
    dispatch() {
      calls++;
    },
  };
  const view = fake as unknown as EditorView;
  const release = registerPairingView(
    view,
    () => true,
    () => false
  );
  expect(handlePairingInput(view, 0, 3, "`")).toBe(false);
  expect(calls).toBe(0);
  expect(handlePairingInput(view, 0, 3, "(")).toBe(false);
  expect(calls).toBe(1); // The old branch was attempted, not restricted by the new guard.
  release();
  const close = registerPairingView(
    view,
    () => true,
    () => true
  );
  expect(handlePairingInput(view, 0, 3, "`")).toBe(false);
  expect(calls).toBe(2);
  expect(fake.state.field(rawText)).toBe("abc");
  close();
});
