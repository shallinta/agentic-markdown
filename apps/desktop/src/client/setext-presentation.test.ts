import { expect, spyOn, test } from "bun:test";

import { redo, undo } from "@codemirror/commands";
import {
  EditorSelection,
  type EditorState,
  type Transaction,
} from "@codemirror/state";

import { liveDecorations } from "./live-formatting";
import { createRawEditorState, rawText } from "./raw-buffer";

function sample(text: string, position = text.length + 5) {
  return createRawEditorState(text + "\n\nend").update({
    selection: { anchor: position },
  }).state;
}
function collect(
  state: EditorState,
  ranges = [{ from: 0, to: state.doc.length }]
) {
  const items: { from: number; to: number; className: string; text: string }[] =
    [];
  liveDecorations(state, ranges).between(
    0,
    state.doc.length,
    (from, to, decoration) => {
      const spec = decoration.spec as { class?: string };
      items.push({
        from,
        to,
        className: spec.class ?? "",
        text: state.sliceDoc(from, to),
      });
    }
  );
  return items;
}

test("Setext body uses H1/H2 line styles while only underline characters are replaced", () => {
  for (const [marker, level] of [
    ["===", 1],
    ["---", 2],
  ] as const) {
    const state = sample(`中文\n第二行\n  ${marker}`);
    const values = collect(state);
    expect(
      values
        .filter((v) => v.className === `cm-live-heading cm-live-h${level}`)
        .map((v) => v.from)
    ).toEqual([0, 3]);
    expect(values.filter((v) => !v.className).map((v) => v.text)).toEqual([
      marker,
    ]);
    expect(
      values.some(
        (v) =>
          v.from === state.doc.line(3).from &&
          v.className.includes("cm-live-heading")
      )
    ).toBe(false);
    expect(values.some((v) => !v.className && v.text.includes("\n"))).toBe(
      false
    );
  }
});

test("every inclusive heading position and cross-block selection reveals all nested marks", () => {
  const text = "**bold** `code` [label](url) <a@example.com>\nnext\n===";
  expect(
    collect(sample(text)).filter((v) => !v.className).length
  ).toBeGreaterThan(0);
  for (let position = 0; position <= text.length; position++) {
    expect(collect(sample(text, position)).filter((v) => !v.className)).toEqual(
      []
    );
  }
  const state = sample(text).update({
    selection: EditorSelection.range(0, text.length + 2),
  }).state;
  expect(collect(state).filter((v) => !v.className)).toEqual([]);
});

test("split viewports style each visible body line without traversing every physical line", () => {
  const state = sample("body\n".repeat(2000) + "===");
  const a = state.doc.line(100),
    b = state.doc.line(1500);
  const spy = spyOn(state.doc, "lineAt");
  try {
    const values = collect(state, [
      { from: a.from, to: a.to },
      { from: b.from, to: b.to },
    ]);
    expect(
      values
        .filter((v) => v.className.includes("cm-live-heading"))
        .map((v) => v.from)
    ).toEqual([a.from, b.from]);
    expect(values.filter((v) => !v.className)).toEqual([]);
    expect(spy.mock.calls.length).toBeLessThan(30);
  } finally {
    spy.mockRestore();
  }
});

test("parser controls rules, nested quote/list headings and literal code", () => {
  for (const text of ["> title\n> ===", "- title\n  ---"]) {
    const state = sample(text);
    expect(
      collect(state).filter((v) => v.className.includes("cm-live-heading"))
    ).toHaveLength(1);
    expect(
      collect(state)
        .filter((v) => !v.className && /===|---/.test(v.text))
        .map((v) => v.text)
    ).toEqual([text.endsWith("===") ? "===" : "---"]);
  }
  for (const text of [
    "---",
    "title\n\n---",
    "```\ntitle\n===\n```",
    "    title\n    ===",
    "title\n= = =",
  ]) {
    expect(
      collect(sample(text)).filter((v) =>
        v.className.includes("cm-live-heading")
      )
    ).toEqual([]);
  }
});

test("protected long body lines are not styled and no replacement crosses their newline", () => {
  const state = sample("x".repeat(10000) + "\n===");
  const values = collect(state);
  expect(values.filter((v) => v.className.includes("cm-live-heading"))).toEqual(
    []
  );
  expect(
    values.filter((v) => !v.className).every((v) => v.text === "===")
  ).toBe(true);
});

test("Setext decorations preserve BOM, untouched mixed endings and undo/redo", () => {
  const raw = "\uFEFF标题\r\n===\n\nend";
  let state = createRawEditorState(raw);
  state = state.update({ changes: { from: 1, to: 3, insert: "新标题" } }).state;
  collect(state);
  expect(state.field(rawText)).toBe(raw.replace("标题", "新标题"));
  const dispatch = (transaction: Transaction) => {
    state = transaction.state;
  };
  expect(undo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(raw);
  expect(redo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(raw.replace("标题", "新标题"));
});
