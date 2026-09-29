import { expect, spyOn, test } from "bun:test";

import { redo, undo, isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  type EditorState,
  type Transaction,
} from "@codemirror/state";

import { switchEditorMode } from "./editor-mode";
import { liveDecorations } from "./live-formatting";
import { createRawEditorState, rawText } from "./raw-buffer";

const composed =
  "> - **标题** [链接 &amp; `代码`](local.md)\n>   第二行\\\n>   第三行 &copy;\n>   ===\n>\n>   - [**粗体** &NotEqualTilde;](url)  \n>     下一行\\*\n\nend";
function stateFor(text = composed) {
  const state = createRawEditorState(text);
  return state.update({ selection: { anchor: state.doc.length } }).state;
}
function nodes(state: EditorState) {
  const result: [string, number, number][] = [];
  syntaxTree(state).iterate({
    enter(node) {
      result.push([node.name, node.from, node.to]);
    },
  });
  return result;
}
function replacements(
  state: EditorState,
  ranges = [{ from: 0, to: state.doc.length }]
) {
  const items: { from: number; to: number; text: string }[] = [];
  liveDecorations(state, ranges).between(
    0,
    state.doc.length,
    (from, to, value) => {
      if (from < to && !(value.spec as { class?: string }).class)
        items.push({ from, to, text: state.sliceDoc(from, to) });
    }
  );
  return items.sort((a, b) => a.from - b.from || a.to - b.to);
}
function assertSafe(state: EditorState) {
  const values = replacements(state);
  for (let index = 0; index < values.length; index++) {
    expect(values[index].text.includes("\n")).toBe(false);
    if (index)
      expect(values[index - 1].to).toBeLessThanOrEqual(values[index].from);
  }
  return values;
}

test("untouched Setext underline retains the quote prefix presentation", () => {
  const state = stateFor("\uFEFF" + composed.replaceAll("\n", "\r\n"));
  const line = state.doc.line(4);
  const prefix = line.from;
  expect(
    replacements(state).some(
      (value) => value.from === prefix && value.to >= prefix + 1
    )
  ).toBe(true);
});

test("Setext prefix compensation is local, container-bounded and selection-aware", () => {
  for (const text of [
    "> a\n> ===\n\nx",
    "> > a\n> > ===\n\nx",
    "- > a\n  > ===\n\nx",
    "> - a\n>   ===\n\nx",
    ">\ta\n>\t===\n\nx",
  ]) {
    const state = stateFor(text);
    expect(nodes(state).some(([name]) => name === "SetextHeading1")).toBe(true);
    const line = state.doc.line(2);
    const prefixEnd = text.indexOf("===");
    const quotes = [...state.sliceDoc(line.from, prefixEnd).matchAll(/>/g)].map(
      (match) => line.from + match.index
    );
    const local = replacements(state, [{ from: line.from, to: line.to }]);
    for (const position of quotes) {
      expect(
        local.some(
          (value) => value.from === position && value.to <= position + 2
        )
      ).toBe(true);
      expect(
        replacements(
          state.update({ selection: { anchor: position } }).state
        ).some((value) => value.from === position)
      ).toBe(false);
    }
    const heading = nodes(state).find(([name]) => name === "SetextHeading1");
    expect(heading).toBeDefined();
    const touched = state.update({ selection: { anchor: heading![1] } }).state;
    expect(
      replacements(touched).some((value) => quotes.includes(value.from))
    ).toBe(false);
    assertSafe(state);
  }
  const protectedState = stateFor("> a\n> " + "=".repeat(10000) + "\n\nx");
  const line = protectedState.doc.line(2);
  expect(
    replacements(protectedState, [{ from: line.from, to: line.to }])
  ).toEqual([]);
  const literal = stateFor("> a\n> literal ===\n\nx");
  expect(nodes(literal).some(([name]) => name === "SetextHeading1")).toBe(
    false
  );
  expect(
    replacements(literal).some((value) => value.text.includes("literal"))
  ).toBe(false);
});

test("nested quote/list/Setext/link/entity/break replacements never overlap or swallow physical lines", () => {
  const state = stateFor();
  expect(nodes(state).some(([name]) => name === "SetextHeading1")).toBe(true);
  const values = assertSafe(state).map((value) => value.text);
  for (const marker of [
    "===",
    "&amp;",
    "&copy;",
    "&NotEqualTilde;",
    "\\",
    "  ",
    "](local.md)",
  ])
    expect(values).toContain(marker);
  expect(state.field(rawText)).toBe(composed);
  // Every cursor and cross-block selection must remain safe, not merely the
  // first static rendering of this nested corpus.
  for (let pos = 0; pos <= state.doc.length; pos++)
    assertSafe(state.update({ selection: { anchor: pos } }).state);
  const selected = state.update({
    selection: EditorSelection.range(0, state.doc.length),
  }).state;
  expect(replacements(selected)).toEqual([]);
});

test("continuous syntax conversion matches fresh parsing and keeps mode/history/raw fidelity", () => {
  const raw =
    "\uFEFF" + composed.replaceAll("\n", "\r\n").replace("\r\nend", "\nend");
  let state = stateFor(raw);
  const dispatch = (transaction: Transaction) => {
    state = transaction.state;
  };
  const originals: string[] = [raw];
  for (const [find, insert] of [
    ["===", "---"],
    ["&copy;", "&amp;"],
    ["\\\n", "  \n"],
  ]) {
    const from = state.doc.toString().indexOf(find);
    expect(from).toBeGreaterThanOrEqual(0);
    state = state.update({
      changes: { from, to: from + find.length, insert },
      annotations: isolateHistory.of("full"),
    }).state;
    originals.push(state.field(rawText));
    assertSafe(state);
    const fresh = stateFor(state.field(rawText));
    expect(nodes(state)).toEqual(nodes(fresh));
  }
  const selection = EditorSelection.create([
    EditorSelection.range(4, state.doc.length - 2),
  ]);
  state = state.update({
    selection,
    effects: switchEditorMode("source"),
  }).state;
  state = state.update({ effects: switchEditorMode("editing") }).state;
  expect(state.selection.eq(selection)).toBe(true);
  for (let index = originals.length - 2; index >= 0; index--) {
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.field(rawText)).toBe(originals[index]);
    assertSafe(state);
  }
  for (let index = 1; index < originals.length; index++) {
    expect(redo({ state, dispatch })).toBe(true);
    expect(state.field(rawText)).toBe(originals[index]);
    assertSafe(state);
  }
});

test("split viewports remain bounded among repeated combinations and protected long lines", () => {
  const state = stateFor(
    composed +
      "\n\n" +
      "x".repeat(10000) +
      " &amp;  \nnext\n\n" +
      composed.repeat(100)
  );
  const first = state.doc.line(1);
  const spy = spyOn(state.doc, "lineAt");
  try {
    const result = replacements(state, [
      { from: first.from, to: first.to },
      { from: first.from, to: first.to },
    ]);
    expect(
      new Set(result.map((value) => `${value.from}:${value.to}`)).size
    ).toBe(result.length);
    expect(result.every((value) => value.to <= first.to)).toBe(true);
    expect(spy.mock.calls.length).toBeLessThan(100);
  } finally {
    spy.mockRestore();
  }
  const from = state.doc.toString().indexOf("x".repeat(10000));
  expect(replacements(state, [{ from, to: from + 10009 }])).toEqual([]);
});
