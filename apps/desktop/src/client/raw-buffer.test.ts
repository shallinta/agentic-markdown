import { expect, test } from "bun:test";

import { undo, redo } from "@codemirror/commands";
import { type EditorState } from "@codemirror/state";

import {
  applyEditorChanges,
  createRawEditorState,
  editorText,
  rawOffset,
  rawText,
} from "./raw-buffer";

test("raw offsets retain BOM, UTF16 emoji, CRLF and lone CR", () => {
  const raw = "\uFEFFa😀\r\nb\rc\n";
  expect(editorText(raw)).toBe("\uFEFFa😀\nb\nc\n");
  for (let i = 0; i <= editorText(raw).length; i++)
    expect(editorText(raw.slice(0, rawOffset(raw, i))).length).toBe(i);
});
test("contextual newline only changes inserted spans", () => {
  const raw = "\uFEFFa\r\nb\nc\rd";
  const state = createRawEditorState(raw);
  const transaction = state.update({
    changes: [
      { from: 2, insert: "\nx" },
      { from: 6, insert: "\ny" },
    ],
  });
  expect(applyEditorChanges(raw, transaction.changes)).toBe(
    "\uFEFFa\r\nx\r\nb\nc\ny\rd"
  );
  expect(transaction.state.field(rawText)).toBe(
    applyEditorChanges(raw, transaction.changes)
  );
});
test("mixed spans deletion, paste, grouping undo and redo restore exact bytes", () => {
  const samples = [
    "\uFEFFa😀\r\nb\rc\nlast",
    "a\r\nb\n",
    "\uFEFF",
    "a\r\r\nb",
    "a\n\uFEFF",
    "",
  ];
  for (const original of samples) {
    let state = createRawEditorState(original);
    const dispatch = (transaction: ReturnType<EditorState["update"]>) => {
      state = transaction.state;
    };
    dispatch(
      state.update({
        changes: {
          from: Math.min(1, state.doc.length),
          to: state.doc.length,
          insert: "中\n😀\npaste",
        },
        userEvent: "input.type",
      })
    );
    dispatch(
      state.update({
        changes: { from: state.doc.length, insert: "\nend" },
        userEvent: "input.type",
      })
    );
    const edited = state.field(rawText);
    expect(editorText(edited)).toBe(state.doc.toString());
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.field(rawText)).toBe(original);
    expect(editorText(state.field(rawText))).toBe(state.doc.toString());
    expect(redo({ state, dispatch })).toBe(true);
    expect(state.field(rawText)).toBe(edited);
    expect(editorText(edited)).toBe(state.doc.toString());
  }
});

test("many nonadjacent mixed-newline edits undo completely and redo identically", () => {
  const original = "\uFEFF甲😀\r\n乙\n丙\r丁\r\nlast";
  let state = createRawEditorState(original);
  let seed = 42;
  const random = (max: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % max;
  };
  const dispatch = (transaction: ReturnType<EditorState["update"]>) => {
    state = transaction.state;
  };
  for (let index = 0; index < 150; index++) {
    const from = random(state.doc.length + 1);
    const to = from + random(state.doc.length - from + 1);
    dispatch(
      state.update({
        changes: { from, to, insert: ["😀", "a\nb", "\n", ""][random(4)] },
        userEvent: "input.type",
      })
    );
    expect(editorText(state.field(rawText))).toBe(state.doc.toString());
  }
  const edited = state.field(rawText);
  while (undo({ state, dispatch }))
    expect(editorText(state.field(rawText))).toBe(state.doc.toString());
  expect(state.field(rawText)).toBe(original);
  while (redo({ state, dispatch }))
    expect(editorText(state.field(rawText))).toBe(state.doc.toString());
  expect(state.field(rawText)).toBe(edited);
});

test("deleting between lone CR and LF reconciles CM coordinates without losing raw undo", () => {
  let state = createRawEditorState("a\rb\nc");
  const dispatch = (transaction: ReturnType<EditorState["update"]>) => {
    state = transaction.state;
  };
  dispatch(
    state.update({
      changes: { from: 2, to: 3 },
      selection: { anchor: 3 },
      userEvent: "delete",
    })
  );
  expect(state.field(rawText)).toBe("a\r\nc");
  expect(state.doc.toString()).toBe("a\nc");
  expect(state.selection.main.anchor).toBeLessThanOrEqual(state.doc.length);
  expect(undo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe("a\rb\nc");
  expect(state.doc.toString()).toBe("a\nb\nc");
  expect(redo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe("a\r\nc");
  dispatch(state.update({ changes: { from: 2, insert: "X" } }));
  expect(state.field(rawText)).toBe("a\r\nXc");
});
