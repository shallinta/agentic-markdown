import { expect, test } from "bun:test";

import { undo, redo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import {
  pairingTransaction,
  handlePairingInput,
  registerPairingView,
} from "./contextual-pairing";
import { switchEditorMode } from "./editor-mode";
import { createRawEditorState, rawText, writePermission } from "./raw-buffer";

test("fixed pairs and existing closures use exact local rules", () => {
  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ["'", "'"],
    ['"', '"'],
  ]) {
    const empty = createRawEditorState("");
    expect(pairingTransaction(empty, open)!.newDoc.toString()).toBe(
      open + close
    );
    const existing = createRawEditorState(close);
    const skip = pairingTransaction(existing, close)!;
    expect(skip.docChanged).toBe(false);
    expect(skip.newSelection.main.head).toBe(1);
    const selected = createRawEditorState("中文").update({
      selection: EditorSelection.single(2, 0),
    }).state;
    const wrap = pairingTransaction(selected, open)!;
    expect(wrap.newDoc.toString()).toBe(open + "中文" + close);
    expect(wrap.newSelection.main.anchor).toBe(3);
    expect(wrap.newSelection.main.head).toBe(1);
  }
  const word = createRawEditorState("cant").update({
    selection: { anchor: 3 },
  }).state;
  expect(pairingTransaction(word, "'")!.newDoc.toString()).toBe("can't");
  for (let n = 0; n < 4; n++) {
    const raw = "\\".repeat(n) + '"';
    const state = createRawEditorState(raw).update({
      selection: { anchor: n },
    }).state;
    const tx = pairingTransaction(state, '"')!;
    expect(tx.newDoc.toString()).toBe("\\".repeat(n) + (n % 2 ? '""' : '"'));
    expect(tx.docChanged).toBe(n % 2 === 1);
  }
  expect(pairingTransaction(createRawEditorState(""), "`")).toBeUndefined();
});

test("mixed range transaction has exact text, direction, raw bytes and unified history", () => {
  const raw = '\ufeff"\r\n\\"\nAB😀\r\n';
  let state = createRawEditorState(raw).update({
    effects: switchEditorMode("source"),
  }).state;
  state = state.update({
    selection: EditorSelection.create(
      [
        EditorSelection.cursor(1),
        EditorSelection.cursor(4),
        EditorSelection.range(10, 6),
        EditorSelection.cursor(11),
      ],
      2
    ),
  }).state;
  const tx = pairingTransaction(state, '"')!;
  state = tx.state;
  const expected = '\ufeff"\r\n\\""\n"AB😀"\r\n""';
  expect(state.field(rawText)).toBe(expected);
  expect(state.selection.mainIndex).toBe(2);
  expect(state.selection.main.anchor).toBeGreaterThan(
    state.selection.main.head
  );
  expect(
    undo({
      state,
      dispatch: (tx) => {
        state = tx.state;
      },
    })
  ).toBe(true);
  expect(state.field(rawText)).toBe(raw);
  expect(
    redo({
      state,
      dispatch: (tx) => {
        state = tx.state;
      },
    })
  ).toBe(true);
  expect(state.field(rawText)).toBe(expected);
});

test("input lifecycle seam accepts only current allowed matching transactions", () => {
  let allowed = true,
    accepted = true,
    calls = 0;
  const fake = {
    state: createRawEditorState(""),
    compositionStarted: false,
    dispatch(tx: ReturnType<NonNullable<typeof pairingTransaction>>) {
      calls++;
      if (accepted && tx) this.state = tx.state;
    },
  };
  const view = fake as unknown as EditorView;
  expect(handlePairingInput(view, 0, 0, "(")).toBe(false);
  const release = registerPairingView(view, () => allowed);
  expect(handlePairingInput(view, 1, 1, "(")).toBe(false);
  fake.compositionStarted = true;
  expect(handlePairingInput(view, 0, 0, "(")).toBe(false);
  fake.compositionStarted = false;
  allowed = false;
  expect(handlePairingInput(view, 0, 0, "(")).toBe(false);
  allowed = true;
  accepted = false;
  expect(handlePairingInput(view, 0, 0, "(")).toBe(false);
  accepted = true;
  expect(handlePairingInput(view, 0, 0, "(")).toBe(true);
  expect(fake.state.doc.toString()).toBe("()");
  expect(calls).toBe(2);
  release();
  expect(handlePairingInput(view, 1, 1, ")")).toBe(false);
  fake.state = createRawEditorState("").update({
    effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
  }).state;
  const close = registerPairingView(view, () => true);
  expect(handlePairingInput(view, 0, 0, "(")).toBe(false);
  expect(calls).toBe(2);
  close();
});

test("mixed closers and nearby ranges use one target update without semantic replacements", () => {
  let state = createRawEditorState(")\nx").update({
    effects: switchEditorMode("source"),
  }).state;
  state = state.update({
    selection: EditorSelection.create(
      [EditorSelection.cursor(0), EditorSelection.cursor(2)],
      1
    ),
  }).state;
  const tx = pairingTransaction(state, ")")!;
  expect(tx.newDoc.toString()).toBe(")\n)x");
  expect(tx.changes.toJSON()).toEqual([2, [0, ")"], 1]);
  expect(tx.newSelection.ranges.map((range) => range.head)).toEqual([1, 3]);
  const adjacent = createRawEditorState("ab").update({
    effects: switchEditorMode("source"),
    selection: EditorSelection.create([
      EditorSelection.cursor(0),
      EditorSelection.cursor(1),
    ]),
  }).state;
  // Explicitly enable before installing multiple ranges (CM uses start-state facet).
  const multiple = adjacent.update({
    selection: EditorSelection.create([
      EditorSelection.cursor(0),
      EditorSelection.cursor(1),
    ]),
  }).state;
  expect(pairingTransaction(multiple, "(")!.newDoc.toString()).toBe("(a(b");
});

test("many ranges on a 1 MiB buffer run one target transaction filter", () => {
  let updates = 0;
  let state = createRawEditorState(
    " ".repeat(1024 * 1024),
    EditorState.transactionFilter.of((tx) => {
      updates++;
      return tx;
    })
  );
  state = state.update({ effects: switchEditorMode("source") }).state;
  state = state.update({
    selection: EditorSelection.create(
      Array.from({ length: 64 }, (_, i) => EditorSelection.cursor(i * 100))
    ),
  }).state;
  updates = 0;
  const tx = pairingTransaction(state, "(")!;
  expect(updates).toBe(1);
  expect(tx.newSelection.ranges).toHaveLength(64);
  expect(tx.newDoc.length).toBe(state.doc.length + 128);
});
