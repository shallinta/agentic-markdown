import { expect, test } from "bun:test";

import { undo } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { DecorationSet } from "@codemirror/view";
import { highlightTree } from "@lezer/highlight";

import {
  sourceHighlightStyle,
  switchEditorMode,
  safeSourceEffects,
  isSafeSource,
} from "./editor-mode";
import { editingMarkdown } from "./live-formatting";
import { LONG_LINE_UNITS, longLineProtection } from "./long-line-protection";
import { createRawEditorState, rawText } from "./raw-buffer";
import { sourceColorDecorations } from "./source-highlighting";

function ranges(decorations: DecorationSet) {
  const found: { from: number; to: number; classes: string }[] = [];
  const cursor = decorations.iter();
  while (cursor.value) {
    const spec: unknown = cursor.value.spec;
    if (
      !spec ||
      typeof spec !== "object" ||
      !("class" in spec) ||
      typeof spec.class !== "string"
    )
      throw new Error("Expected a color mark");
    found.push({
      from: cursor.from,
      to: cursor.to,
      classes: spec.class,
    });
    cursor.next();
  }
  return found;
}

test("ordinary source ranges exactly match official highlighter with same tree and viewport", () => {
  const state = createRawEditorState(
    "# 中文\n\n**bold** &amp; [link](x)\n\n```js\nx\n```\n"
  );
  const tree = syntaxTree(state);
  for (const visible of [
    [{ from: 0, to: state.doc.length }],
    [{ from: 4, to: 27 }],
  ]) {
    const expected: ReturnType<typeof ranges> = [];
    for (const range of visible)
      highlightTree(
        tree,
        sourceHighlightStyle,
        (from, to, classes) => expected.push({ from, to, classes }),
        range.from,
        range.to
      );
    expect(
      ranges(sourceColorDecorations(state, tree, visible, sourceHighlightStyle))
    ).toEqual(expected);
  }
});

test("protected visible spans never call highlighter and normal neighbours retain colors", () => {
  const state = createRawEditorState(
    "# before\n\n" + "**a** ".repeat(2000) + "\n\n# after"
  );
  const tree = editingMarkdown.parser.parse(state.doc.toString());
  const protectedLine = state.field(longLineProtection)[0];
  let calls = 0;
  const style = {
    style: () => {
      calls++;
      return "measured";
    },
  };
  expect(
    ranges(sourceColorDecorations(state, tree, [protectedLine], style))
  ).toEqual([]);
  expect(calls).toBe(0);
  const marks = ranges(
    sourceColorDecorations(
      state,
      tree,
      [{ from: 0, to: state.doc.length }],
      sourceHighlightStyle
    )
  );
  expect(marks.some((mark) => mark.from < protectedLine.from)).toBe(true);
  expect(marks.some((mark) => mark.to > protectedLine.to)).toBe(true);
  expect(
    marks.every(
      (mark) => mark.to <= protectedLine.from || mark.from >= protectedLine.to
    )
  ).toBe(true);
});

test("threshold crossing and undo preserve BOM mixed endings and restore source marks", () => {
  const raw =
    "\uFEFF# start\r\n\n" +
    "*" +
    "a".repeat(LONG_LINE_UNITS - 3) +
    "*\r\n# end";
  let state = createRawEditorState(raw).update({
    effects: switchEditorMode("source"),
  }).state;
  const position = state.doc.line(3).from + 1;
  state = state.update({
    changes: { from: position, insert: "x" },
    userEvent: "input.type",
    selection: { anchor: position },
  }).state;
  expect(state.field(longLineProtection)).toHaveLength(1);
  const span = state.field(longLineProtection)[0];
  expect(
    ranges(
      sourceColorDecorations(
        state,
        editingMarkdown.parser.parse(state.doc.toString()),
        [span],
        sourceHighlightStyle
      )
    )
  ).toEqual([]);
  expect(
    undo({
      state,
      dispatch: (transaction) => {
        state = transaction.state;
      },
    })
  ).toBe(true);
  expect(state.field(rawText)).toBe(raw);
  expect(state.field(longLineProtection)).toHaveLength(0);
  const line = state.doc.line(3);
  expect(
    ranges(
      sourceColorDecorations(
        state,
        editingMarkdown.parser.parse(state.doc.toString()),
        [{ from: line.from, to: line.to }],
        sourceHighlightStyle
      )
    ).length
  ).toBeGreaterThan(0);
  state = state.update({ effects: safeSourceEffects() }).state;
  expect(isSafeSource(state)).toBe(true);
  expect(syntaxTree(state).length).toBe(0);
  expect(state.field(rawText)).toBe(raw);
});

test("newly published parse tree replaces incomplete source color results", () => {
  const state = createRawEditorState("# first\n\n**later**\n");
  const visible = [{ from: 0, to: state.doc.length }];
  const partial = editingMarkdown.parser.parse(state.doc.sliceString(0, 7));
  const complete = editingMarkdown.parser.parse(state.doc.toString());
  const old = ranges(
    sourceColorDecorations(state, partial, visible, sourceHighlightStyle)
  );
  const next = ranges(
    sourceColorDecorations(state, complete, visible, sourceHighlightStyle)
  );
  expect(next.some((mark) => mark.from >= 9)).toBe(true);
  expect(old.every((mark) => mark.to <= 7)).toBe(true);
});
