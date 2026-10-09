import { expect, test } from "bun:test";

import { undo, redo } from "@codemirror/commands";
import { syntaxTree, highlightingFor } from "@codemirror/language";
import {
  EditorSelection,
  Transaction,
  type EditorState,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import {
  getEditorMode,
  safeSourceEffects,
  sourceWrappingEffect,
  sourceHighlightStyle,
  switchEditorMode,
} from "./editor-mode";
import { createRawEditorState, rawText } from "./raw-buffer";
import { sourceColorDecorations } from "./source-highlighting";

const styleRules = (state: EditorState) =>
  state
    .facet(EditorView.styleModule)
    .map((module) => module.getRules())
    .join("\n");

const wraps = (state: EditorState) =>
  state
    .facet(EditorView.contentAttributes)
    .some(
      (attributes) =>
        typeof attributes !== "function" &&
        attributes.class?.includes("cm-lineWrapping")
    );
test("wrapping compartment only disables ordinary source and safe fallback always wraps", () => {
  const editing = createRawEditorState("long ".repeat(100));
  expect(wraps(editing)).toBe(true);
  const source = editing.update({
    effects: switchEditorMode("source", false),
  }).state;
  expect(wraps(source)).toBe(false);
  const enabled = source.update({
    effects: sourceWrappingEffect(source, true),
  }).state;
  expect(wraps(enabled)).toBe(true);
  expect(
    wraps(source.update({ effects: switchEditorMode("editing", false) }).state)
  ).toBe(true);
  expect(wraps(source.update({ effects: safeSourceEffects() }).state)).toBe(
    true
  );
  const isolated = createRawEditorState("safe", [], true);
  expect(
    wraps(
      isolated.update({ effects: sourceWrappingEffect(isolated, false) }).state
    )
  ).toBe(true);
});

test("source line presentation stays scoped and weaker than selection highlighting", () => {
  const editing = createRawEditorState("first\n\n" + "wrapped ".repeat(80));
  const source = editing.update({ effects: switchEditorMode("source") }).state;
  const styles = styleRules(source);
  expect(styles).toContain(".cm-gutters");
  expect(styles).toContain(".cm-activeLine");
  expect(styles).toContain(".cm-activeLineGutter");
  expect(styles).toContain("var(--foreground) 5%");
  expect(styles).toContain("var(--foreground) 8%");
  expect(styles).toContain("var(--foreground) 20%");
  expect(source.doc).toBe(editing.doc);
  expect(source.doc.lines).toBe(3);
  expect(source.doc.lineAt(source.doc.length).number).toBe(3);
  expect(styleRules(editing)).not.toContain(".cm-activeLineGutter");
  const returned = source.update({
    effects: switchEditorMode("editing"),
  }).state;
  expect(styleRules(returned)).not.toContain(".cm-activeLineGutter");
  expect(returned.doc).toBe(editing.doc);
});

test("fault isolation never loads ordinary source line presentation", () => {
  const isolated = createRawEditorState("safe", undefined, true);
  expect(styleRules(isolated)).not.toContain(".cm-activeLineGutter");
  const source = createRawEditorState("ordinary").update({
    effects: switchEditorMode("source"),
  }).state;
  const safe = source.update({ effects: safeSourceEffects() }).state;
  expect(getEditorMode(safe)).toBe("source");
  expect(styleRules(safe)).not.toContain(".cm-activeLineGutter");
  expect(safe.doc).toBe(source.doc);
  expect(safe.selection).toBe(source.selection);
});

test("source highlighting changes only color, leaving all Markdown uniformly typeset", () => {
  for (const spec of sourceHighlightStyle.specs) {
    expect(Object.keys(spec).sort()).toEqual(["color", "tag"]);
    expect(
      spec.color === "var(--foreground)" ||
        spec.color === "var(--muted-foreground)"
    ).toBe(true);
  }
  const original = "# 标题\n**粗体** *斜体* `code` [链接](local.md)";
  const editing = createRawEditorState(original);
  const source = editing.update({ effects: switchEditorMode("source") }).state;
  expect(source.doc).toBe(editing.doc);
  expect(source.doc.toString()).toBe(original);
  expect(source.field(rawText)).toBe(original);
  for (const tag of [
    tags.heading,
    tags.strong,
    tags.emphasis,
    tags.link,
    tags.url,
    tags.monospace,
    tags.processingInstruction,
  ])
    expect(sourceHighlightStyle.style([tag])).toBeTruthy();
  expect(
    sourceColorDecorations(
      source,
      syntaxTree(source),
      [{ from: 0, to: source.doc.length }],
      sourceHighlightStyle
    ).size
  ).toBeGreaterThan(0);
  // No duplicate built-in highlighter remains installed.
  expect(highlightingFor(source, [tags.heading])).toBeNull();
});

test("presentation switch retains language tree, selection, raw fidelity and undo history", () => {
  const original = "\uFEFF# 标题\r\n**bold**\n<script>alert(1)</script>";
  let state = createRawEditorState(original);
  expect(getEditorMode(state)).toBe("editing");
  state = state.update({
    changes: { from: state.doc.length, insert: "!" },
    userEvent: "input.type",
  }).state;
  state = state.update({ selection: EditorSelection.range(3, 7) }).state;
  const tree = syntaxTree(state),
    selection = state.selection,
    doc = state.doc;
  state = state.update({
    effects: switchEditorMode("source"),
    annotations: Transaction.addToHistory.of(false),
  }).state;
  expect(getEditorMode(state)).toBe("source");
  expect(syntaxTree(state)).toBe(tree);
  expect(state.doc).toBe(doc);
  expect(state.selection).toBe(selection);
  expect(state.field(rawText)).toBe(original + "!");
  expect(
    sourceColorDecorations(
      state,
      tree,
      [{ from: 0, to: state.doc.length }],
      sourceHighlightStyle
    ).size
  ).toBeGreaterThan(0);
  const dispatch = (transaction: Transaction) => {
    state = transaction.state;
  };
  expect(undo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(original);
  expect(getEditorMode(state)).toBe("source");
  state = state.update({ effects: switchEditorMode("editing") }).state;
  expect(highlightingFor(state, [tags.heading])).toBeNull();
  expect(redo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(original + "!");
  expect(getEditorMode(state)).toBe("editing");
});
