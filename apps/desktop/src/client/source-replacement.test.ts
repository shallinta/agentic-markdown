import { expect, test } from "bun:test";

import { undo, redo, undoDepth } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";

import {
  createRawEditorState,
  rawText,
  editorText,
  writePermission,
} from "./raw-buffer";
import { prepareSourceReplacement } from "./source-replacement";

test("literal replacement is one raw-preserving history event; no-op adds none", () => {
  let state = createRawEditorState("\ufeffaa\r\naa\nEND");
  const original = state.field(rawText);
  const plan = prepareSourceReplacement(state, [1, 3], "$1\nX")!;
  expect(plan.transaction).not.toBeNull();
  state = plan.transaction!.state;
  expect(state.field(rawText)).toBe("\ufeff$1\r\nX\r\naa\nEND");
  expect(plan.exclude).toEqual([1, 5]);
  expect(plan.position).toBe(5);
  expect(undoDepth(state)).toBe(1);
  const target = () => ({
    state,
    dispatch: (tr: Transaction) => {
      state = tr.state;
    },
  });
  expect(undo(target())).toBe(true);
  expect(state.field(rawText)).toBe(original);
  expect(redo(target())).toBe(true);
  const same = prepareSourceReplacement(state, [1, 3], "$1")!;
  expect(same.transaction).toBeNull();
  expect(undoDepth(state)).toBe(1);
});

test("deletion uses final filtered transaction mapping at lone CR/LF seam", () => {
  const state = createRawEditorState("a\rX\nb");
  const plan = prepareSourceReplacement(state, [2, 3], "")!;
  expect(plan.transaction!.state.field(rawText)).toBe("a\r\nb");
  expect(plan.transaction!.state.doc.toString()).toBe(editorText("a\r\nb"));
  expect(plan.position).toBe(plan.transaction!.changes.mapPos(3, 1));
  expect(plan.position).toBe(2);
  expect(plan.exclude).toEqual([2, 2]);
  expect(plan.exclude[0]).toBe(plan.transaction!.changes.mapPos(2, -1));
});

test("readonly, invalid range and UTF8 output limit reject without mutation", () => {
  const state = createRawEditorState("abc");
  expect(prepareSourceReplacement(state, [1, 1], "x")).toBeNull();
  expect(prepareSourceReplacement(state, [0, 9], "x")).toBeNull();
  expect(
    prepareSourceReplacement(state, [0, 1], "字".repeat(400000))
  ).toBeNull();
  const readonly = state.update({
    effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
  }).state;
  expect(prepareSourceReplacement(readonly, [0, 1], "x")).toBeNull();
  expect(state.field(rawText)).toBe("abc");
});

test("deletion can form a new match at the same logical location", () => {
  const state = createRawEditorState("aXb");
  const plan = prepareSourceReplacement(state, [1, 2], "")!;
  expect(plan.transaction!.state.doc.toString()).toBe("ab");
  expect(plan.exclude).toEqual([1, 1]);
  expect(plan.position).toBe(1);
});
