import { expect, test } from "bun:test";

import { undo, redo } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, Text } from "@codemirror/state";

import { liveDecorations } from "./live-formatting";
import {
  LONG_LINE_UNITS,
  detectLongLines,
  longLineProtection,
  protectedPosition,
  touchesProtected,
  unprotectedParts,
} from "./long-line-protection";
import { createRawEditorState, rawText } from "./raw-buffer";

test("threshold counts UTF-16 units, not bytes; empty and ordinary lines remain normal", () => {
  const doc = Text.of([
    "",
    "中".repeat(LONG_LINE_UNITS - 1),
    "🙂".repeat(5000),
    "ok",
  ]);
  expect(detectLongLines(doc)).toEqual([
    { from: doc.line(3).from, to: doc.line(3).to },
  ]);
});

test("selection keeps state identity; shortening, undo-shaped changes, splitting and merging restore protection", () => {
  let state = EditorState.create({
    doc: "before\n" + "x".repeat(LONG_LINE_UNITS) + "\nafter",
    extensions: longLineProtection,
  });
  const original = state.field(longLineProtection);
  state = state.update({ selection: { anchor: 1 } }).state;
  expect(state.field(longLineProtection)).toBe(original);
  const start = state.doc.line(2).from;
  state = state.update({ changes: { from: start, to: start + 1 } }).state;
  expect(state.field(longLineProtection)).toEqual([]);
  state = state.update({ changes: { from: start, insert: "x" } }).state;
  expect(state.field(longLineProtection)).toEqual(original);
  state = state.update({ changes: { from: start + 5000, insert: "\n" } }).state;
  expect(state.field(longLineProtection)).toEqual([]);
  state = state.update({
    changes: { from: start + 5000, to: start + 5001 },
  }).state;
  expect(state.field(longLineProtection)).toEqual(original);
});

test("incremental updates equal a fresh scan across deterministic multi-edit and boundary cases", () => {
  let seed = 173;
  const random = (max: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % max;
  };
  let state = EditorState.create({
    doc: ["x".repeat(10010), "short", "y".repeat(10005)].join("\n"),
    extensions: longLineProtection,
  });
  for (let i = 0; i < 150; i++) {
    const a = random(state.doc.length + 1);
    const b = a + random(state.doc.length - a + 1);
    state = state.update({
      changes: [
        {
          from: a,
          to: Math.min(a + random(20), b),
          insert: i % 3 ? "\n中文" : "x".repeat(10001),
        },
        ...(b > a + 20 ? [{ from: b, insert: "\n" }] : []),
      ],
    }).state;
    expect(state.field(longLineProtection)).toEqual(detectLongLines(state.doc));
  }
});

test("local edits inspect only affected physical lines and never read Line.text", () => {
  let state = EditorState.create({
    doc: "short\n".repeat(10000) + "x".repeat(10000),
    extensions: longLineProtection,
  });
  const proto = Object.getPrototypeOf(state.doc) as { lineAt: Text["lineAt"] };
  const original = proto.lineAt;
  let calls = 0;
  proto.lineAt = function (pos: number) {
    calls++;
    return original.call(this, pos);
  };
  try {
    state = state.update({ changes: { from: 3, insert: "a" } }).state;
    expect(calls).toBeLessThanOrEqual(4);
    expect(state.field(longLineProtection)).toHaveLength(1);
    calls = 0;
    state = state.update({ selection: { anchor: 2 } }).state;
    expect(calls).toBe(0);
  } finally {
    proto.lineAt = original;
  }
});

test("marks split around protected lines while replacements can be rejected intact", () => {
  const spans = [
    { from: 10, to: 20 },
    { from: 30, to: 40 },
  ];
  expect(unprotectedParts(spans, 0, 50)).toEqual([
    { from: 0, to: 10 },
    { from: 20, to: 30 },
    { from: 40, to: 50 },
  ]);
  expect(unprotectedParts(spans, 12, 18)).toEqual([]);
  expect(touchesProtected(spans, 5, 12)).toBe(true);
  expect(touchesProtected(spans, 0, 10)).toBe(false);
  expect(protectedPosition(spans, 10)).toBe(true);
  expect(protectedPosition(spans, 20)).toBe(true);
});

test("protected lines retain cheap block structure while inline decorations are omitted", () => {
  for (const raw of [
    "outside\n\n**normal\n" + "x".repeat(10000) + "\nnormal**\n\n# ordinary",
    "outside\n\n```md\nnormal\n" +
      "x".repeat(10000) +
      "\nnormal\n```\n\n# ordinary",
    "outside\n\n> normal\n> " +
      "**x** ".repeat(2000) +
      "\n> normal\n\n# ordinary",
    "outside\n\n- normal\n  " + "x".repeat(10000) + "\n  normal\n\n# ordinary",
  ]) {
    let state = createRawEditorState(raw);
    ensureSyntaxTree(state, state.doc.length, 1000);
    state = state.update({}).state;
    const protectedLines = state.field(longLineProtection);
    expect(protectedLines).toHaveLength(1);
    let decorations = 0;
    liveDecorations(state, [{ from: 0, to: state.doc.length }]).between(
      0,
      state.doc.length,
      (from, to, value) => {
        decorations++;
        const spec = value.spec as {
          class?: string;
          widget?: { kind?: string };
        };
        if (
          spec.class?.includes("cm-live-code-block") ||
          spec.class?.includes("cm-live-quote-line") ||
          spec.widget?.kind === "quote"
        )
          return;
        expect(
          from === to
            ? protectedPosition(protectedLines, from)
            : touchesProtected(protectedLines, from, to)
        ).toBe(false);
      }
    );
    expect(decorations).toBeGreaterThan(1);
    expect(state.field(rawText)).toBe(raw);
  }
});

test("real raw-buffer history restores threshold protection without changing BOM or mixed line endings", () => {
  const raw = "\uFEFFhead\r\n" + "x".repeat(10000) + "\ntail";
  let state = createRawEditorState(raw);
  const from = state.doc.line(2).from;
  state = state.update({
    changes: { from, to: from + 1 },
    userEvent: "input",
  }).state;
  expect(state.field(longLineProtection)).toHaveLength(0);
  expect(state.field(rawText)).toBe(raw.replace("x", ""));
  const dispatch = (tr: import("@codemirror/state").Transaction) => {
    state = tr.state;
  };
  expect(undo({ state, dispatch })).toBe(true);
  expect(state.field(longLineProtection)).toHaveLength(1);
  expect(state.field(rawText)).toBe(raw);
  expect(redo({ state, dispatch })).toBe(true);
  expect(state.field(longLineProtection)).toHaveLength(0);
});

test("different protected endpoints never prune ordinary middle lines or their ancestors", () => {
  const long = "x".repeat(10000);
  for (const raw of [
    `${long}\n\n**middle**\n\n${long}`,
    `> ${long}\n> **middle**\n> ${long}`,
    `- ${long}\n  **middle**\n  ${long}`,
    `~~~${long}\nnormal\n~~~${long}`,
  ]) {
    let state = createRawEditorState(raw);
    ensureSyntaxTree(state, state.doc.length, 1000);
    state = state.update({}).state;
    expect(state.field(longLineProtection)).toHaveLength(2);
    const middle = state.doc.line(raw.includes("\n\n") ? 3 : 2);
    for (const visible of [
      [{ from: middle.from, to: middle.to }],
      [{ from: 0, to: state.doc.length }],
    ]) {
      const decorations = liveDecorations(state, visible);
      let middleDecorations = 0;
      decorations.between(middle.from, middle.to, (from, to, value) => {
        if (
          from <= middle.to &&
          to >= middle.from &&
          (value.spec as { class?: string }).class
        )
          middleDecorations++;
      });
      expect(middleDecorations).toBeGreaterThan(0);
    }
  }
});

test("middle-only viewports on protected code and quotes retain their block structure", () => {
  let state = createRawEditorState(
    "outside\n\n```\n" +
      "x".repeat(18000) +
      "\n```\n\n> " +
      "**x** ".repeat(2000)
  );
  ensureSyntaxTree(state, state.doc.length, 1000);
  state = state.update({}).state;
  for (const [lineNumber, expected] of [
    [4, "cm-live-code-block"],
    [7, "cm-live-quote-line"],
  ] as const) {
    const line = state.doc.line(lineNumber);
    const classes: string[] = [];
    liveDecorations(state, [
      { from: line.from + 5000, to: line.from + 5100 },
    ]).between(0, state.doc.length, (_from, _to, value) => {
      const spec = value.spec as { class?: string };
      if (spec.class) classes.push(spec.class);
    });
    expect(classes.some((value) => value.includes(expected))).toBe(true);
    expect(classes.join(" ")).not.toContain("cm-live-strong");
  }
});
