import { expect, test } from "bun:test";

import { redo, undo } from "@codemirror/commands";
import {
  EditorSelection,
  type EditorState,
  type Transaction,
} from "@codemirror/state";

import { liveDecorations } from "./live-formatting";
import { createRawEditorState, rawText } from "./raw-buffer";

function inspect(text: string, selection = text.length + 5, head = selection) {
  const state = createRawEditorState(text + "\n\nend").update({
    selection: EditorSelection.range(selection, head),
  }).state;
  return { state, ...collect(state) };
}
function collect(
  state: EditorState,
  ranges = [{ from: 0, to: state.doc.length }]
) {
  const hidden: string[] = [],
    marks: { from: number; to: number; spec: Record<string, unknown> }[] = [];
  liveDecorations(state, ranges).between(
    0,
    state.doc.length,
    (from, to, value) => {
      const spec = value.spec as Record<string, unknown>;
      if (!spec.class) hidden.push(state.sliceDoc(from, to));
      else marks.push({ from, to, spec });
    }
  );
  return { hidden, marks };
}

test("single-line inline links hide only source around nonempty labels including empty targets", () => {
  for (const text of [
    "[中文](local.md)",
    "[label]()",
    "[label](<>)",
    '[label](https://example.com "title")',
    "[label](javascript:alert)",
  ]) {
    const { hidden, marks, state } = inspect(text);
    expect(hidden).toEqual(["[", text.slice(text.indexOf("]"))]);
    const link = marks.find((mark) => mark.spec.class === "cm-live-link")!;
    expect(link.spec.tagName).toBe("span");
    expect(link.spec.attributes).toBeUndefined();
    expect(link.spec.widget).toBeUndefined();
    expect(state.field(rawText)).toBe(text + "\n\nend");
  }
});

test("CommonMark autolinks hide angles only and do not recognize bare GFM URLs", () => {
  for (const text of ["<https://example.com>", "<a@example.com>"]) {
    expect(inspect(text).hidden).toEqual(["<", ">"]);
  }
  expect(inspect("https://example.com").hidden).toEqual([]);
});

test("reference, images, empty label and multiline entire subtrees stay raw", () => {
  for (const text of [
    "[**label**][missing]",
    "[**label**][id]\n\n[id]: /url",
    "[id][]\n\n[id]: /url",
    "[id]\n\n[id]: /url",
    "[id]",
    "[]()",
    "![alt **text** [link](url)](img)",
    "[![alt](img)](url)",
    "[first\n**second**](url)",
    "[**label**](\nurl\n)",
  ]) {
    const { hidden, marks } = inspect(text);
    expect(hidden).toEqual([]);
    expect(marks.filter((mark) => mark.spec.class === "cm-live-link")).toEqual(
      []
    );
  }
});

test("touching any point or inclusive edge of link reveals all nested syntax", () => {
  const text = "[**bold** and `code`](url)";
  expect(inspect(text).hidden).toContain("**");
  for (let position = 0; position <= text.length; position++) {
    expect(inspect(text, position).hidden).toEqual([]);
  }
  expect(inspect(text, 0, text.length).hidden).toEqual([]);
});

test("viewport clipping deduplicates spans and long-line protection keeps links raw", () => {
  expect(inspect("[label](url) ![image](x)").hidden).toEqual(["[", "](url)"]);
  const text = "[**bold**](url)";
  const { state } = inspect(text);
  const values = collect(state, [
    { from: 0, to: 4 },
    { from: 5, to: text.length },
  ]);
  expect(
    values.marks.filter((mark) => mark.spec.class === "cm-live-link")
  ).toHaveLength(1);
  expect(values.hidden.filter((value) => value === "[")).toHaveLength(1);
  expect(inspect(text + "x".repeat(10000)).hidden).toEqual([]);
  expect(
    inspect("```\n[link](url)\n```").marks.filter(
      (mark) => mark.spec.class === "cm-live-link"
    )
  ).toEqual([]);
});

test("BOM mixed-newline raw text, selection and edit history stay authoritative", () => {
  const raw = "\uFEFF[label](target)\r\n\nend";
  let state = createRawEditorState(raw);
  const original = state.doc.toString();
  const start = original.indexOf("target");
  state = state.update({
    changes: { from: start, to: start + 6, insert: "next" },
    selection: { anchor: start + 4 },
  }).state;
  collect(state);
  expect(state.field(rawText)).toBe(raw.replace("target", "next"));
  const dispatch = (transaction: Transaction) => {
    state = transaction.state;
  };
  expect(undo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(raw);
  expect(redo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(raw.replace("target", "next"));
});
