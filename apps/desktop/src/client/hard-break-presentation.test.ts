import { expect, spyOn, test } from "bun:test";

import { redo, undo } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  type EditorState,
  type Transaction,
} from "@codemirror/state";

import { setMarkdownWorkerFactory } from "./async-markdown";
import { safeSourceEffects, switchEditorMode } from "./editor-mode";
import { liveDecorations } from "./live-formatting";
import { createRawEditorState, rawText } from "./raw-buffer";

function sample(text: string) {
  return createRawEditorState(text + "\n\nend").update({
    selection: { anchor: text.length + 5 },
  }).state;
}
function hidden(
  state: EditorState,
  ranges = [{ from: 0, to: state.doc.length }]
) {
  const values: { from: number; to: number; text: string }[] = [];
  liveDecorations(state, ranges).between(
    0,
    state.doc.length,
    (from, to, value) => {
      const spec = value.spec as { class?: string; widget?: unknown };
      if (!spec.class && !spec.widget)
        values.push({ from, to, text: state.sliceDoc(from, to) });
    }
  );
  return values;
}

test("hard breaks hide only parser markers, preserving newline and soft breaks", () => {
  for (const marker of ["\\", "  ", "    "]) {
    const state = sample(`中文${marker}\n下一行`);
    expect(hidden(state)).toEqual([
      { from: 2, to: 2 + marker.length, text: marker },
    ]);
    expect(state.doc.lines).toBe(4);
    for (let pos = 2; pos <= 2 + marker.length; pos++)
      expect(
        hidden(state.update({ selection: { anchor: pos } }).state)
      ).toEqual([]);
    expect(
      hidden(
        state.update({ selection: EditorSelection.range(0, 3 + marker.length) })
          .state
      )
    ).toEqual([]);
  }
  for (const text of ["a\nb", "a \nb", "a  ", "a\\", "a  \n==="])
    expect(
      hidden(sample(text)).filter((value) => ["  ", "\\"].includes(value.text))
    ).toEqual([]);
});

test("nested containers preserve their prefixes and Setext block touch reveals breaks", () => {
  for (const text of ["> a  \n> b", "- a\\\n  b", "> - a   \n>   b"])
    expect(
      hidden(sample(text))
        .filter((value) => value.text.trim() === "" || value.text === "\\")
        .map((value) => value.text)
    ).toEqual([
      text.includes("\\") ? "\\" : text.includes("   ") ? "   " : "  ",
    ]);
  const text = "a  \nb\n===";
  expect(hidden(sample(text)).map((value) => value.text)).toEqual([
    "  ",
    "===",
  ]);
  for (let pos = 0; pos <= text.length; pos++)
    expect(
      hidden(sample(text).update({ selection: { anchor: pos } }).state)
    ).toEqual([]);
});

test("excluded contexts and protected lines do not receive hard-break replacements", () => {
  for (const text of [
    "[a  \nb](url)",
    "![a  \nb](url)",
    "[a  \nb][ref]",
    "`a  \nb`",
    "```\na  \nb\n```",
    "    a  \n    b",
    "<div>\na  \nb\n</div>",
    '[ref]: url "a  \nb"',
    "x".repeat(10000) + "  \nb",
  ])
    expect(hidden(sample(text)).some((value) => /^ +$/.test(value.text))).toBe(
      false
    );
});

test("visible ranges bound traversal and deduplicate overlapping marker ranges", () => {
  const state = sample("a  \nb\n\n".repeat(2000));
  const line = state.doc.line(1);
  const spy = spyOn(state.doc, "lineAt");
  try {
    expect(
      hidden(state, [
        { from: line.from, to: line.to },
        { from: line.from, to: line.to },
      ])
    ).toEqual([{ from: 1, to: 3, text: "  " }]);
    expect(spy.mock.calls.length).toBeLessThan(30);
  } finally {
    spy.mockRestore();
  }
});

test("pending syntax does not speculate hard breaks or force a parse", () => {
  const previous = setMarkdownWorkerFactory(() => {
    throw new Error("must not start without a view");
  });
  try {
    const state = sample("x".repeat(10000) + "\n\na  \nb");
    expect(syntaxTree(state).topNode.firstChild).toBeNull();
    expect(hidden(state)).toEqual([]);
  } finally {
    setMarkdownWorkerFactory(previous);
  }
});

test("BOM mixed newlines, mode changes and history preserve authoritative raw text", () => {
  const raw = "\uFEFF中文  \r\n第二行\\\n第三行\r\n\r\nend";
  let state = createRawEditorState(raw).update({
    selection: { anchor: raw.length - 4 },
  }).state;
  expect(hidden(state).map((value) => value.text)).toEqual(["  ", "\\"]);
  expect(state.field(rawText)).toBe(raw);
  state = state.update({
    changes: { from: state.doc.length, insert: "!" },
    userEvent: "input.type",
  }).state;
  const dispatch = (transaction: Transaction) => {
    state = transaction.state;
  };
  state = state.update({ effects: switchEditorMode("source") }).state;
  expect(state.field(rawText)).toBe(raw + "!");
  expect(undo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(raw);
  expect(redo({ state, dispatch })).toBe(true);
  state = state.update({ effects: switchEditorMode("editing") }).state;
  expect(hidden(state).map((value) => value.text)).toEqual(["  ", "\\"]);
  state = state.update({ effects: safeSourceEffects() }).state;
  expect(state.field(rawText)).toBe(raw + "!");
});
