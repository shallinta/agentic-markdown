import { expect, test } from "bun:test";

import { undoDepth } from "@codemirror/commands";
import { foldedRanges } from "@codemirror/language";
import { EditorState } from "@codemirror/state";

import { editorFaultSession, reportEditorFault } from "./editor-fault";
import { editorFoldEntries } from "./editor-fold-state";
import { safeSourceEffects, switchEditorMode } from "./editor-mode";
import {
  headingStructureReady,
  frontmatterToggleTransaction,
  headingToggleTransaction,
  codeToggleTransaction,
} from "./heading-folding";
import { headingStructureSteps } from "./heading-structure";
import { createRawEditorState, rawText, writePermission } from "./raw-buffer";

const raw = "---\na: 1\n---\n# Title\n```js\nx\n```\nbody";
function prepare(text = raw, readonly = false) {
  let state = createRawEditorState(text);
  if (readonly)
    state = state.update({
      effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
    }).state;
  const task = headingStructureSteps(state);
  let step = task.next();
  while (!step.done) step = task.next();
  state = state.update({ effects: headingStructureReady.of(step.value) }).state;
  return { state, structure: step.value };
}
test("frontmatter readonly fold applies without modifying raw/history and source only removes its kind", () => {
  const p = prepare(raw, true),
    original = p.state.field(rawText),
    depth = undoDepth(p.state);
  let state = frontmatterToggleTransaction(
    p.state,
    p.structure.frontmatter!
  )!.state;
  state = codeToggleTransaction(state, p.structure.code[0])!.state;
  state = headingToggleTransaction(state, p.structure.sections[0])!.state;
  expect(foldedRanges(state).size).toBe(3);
  expect(state.field(rawText)).toBe(original);
  expect(undoDepth(state)).toBe(depth);
  expect(state.readOnly).toBe(true);
  state = state.update({ effects: switchEditorMode("source") }).state;
  expect(foldedRanges(state).size).toBe(2);
  expect(
    [...state.field(editorFoldEntries).values()].map((x) => x.kind).sort()
  ).toEqual(["fencedCode", "heading"]);
  expect(
    frontmatterToggleTransaction(state, p.structure.frontmatter!)
  ).toBeNull();
  state = state.update({ effects: switchEditorMode("editing") }).state;
  expect(foldedRanges(state).size).toBe(2);
  expect(state.field(rawText)).toBe(original);
});
test("existing three kinds clear directly on safe and fault without a prior content edit", () => {
  for (const fault of [false, true]) {
    const p = prepare();
    let state = frontmatterToggleTransaction(
      p.state,
      p.structure.frontmatter!
    )!.state;
    state = codeToggleTransaction(state, p.structure.code[0])!.state;
    state = headingToggleTransaction(state, p.structure.sections[0])!.state;
    expect(foldedRanges(state).size).toBe(3);
    if (fault)
      reportEditorFault(state.field(editorFaultSession), "presentation");
    state = state.update({ effects: safeSourceEffects() }).state;
    expect(foldedRanges(state).size).toBe(0);
    expect(state.field(rawText)).toBe(raw);
  }
});
test("empty header is not foldable; one actual blank line is foldable", () => {
  for (const [text, expected] of [
    ["---\n---\nbody", 0],
    ["---\n\n---\nbody", 1],
  ] as const) {
    const p = prepare(text);
    expect(p.structure.frontmatter?.lineCount).toBe(expected);
    expect(
      frontmatterToggleTransaction(p.state, p.structure.frontmatter!) !== null
    ).toBe(expected > 0);
  }
});
test("nonempty selection rejects and navigation unfolds; stale structure cannot fold a changed document", () => {
  const p = prepare(),
    section = p.structure.frontmatter!;
  expect(
    frontmatterToggleTransaction(
      p.state.update({ selection: { anchor: 4, head: 7 } }).state,
      section
    )
  ).toBeNull();
  let state = frontmatterToggleTransaction(p.state, section)!.state;
  state = state.update({ selection: { anchor: 5 } }).state;
  expect(foldedRanges(state).size).toBe(0);
  state = state.update({ changes: { from: 5, insert: "x" } }).state;
  expect(frontmatterToggleTransaction(state, section)).toBeNull();
});
