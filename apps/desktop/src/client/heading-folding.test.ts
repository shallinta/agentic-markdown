import { expect, test } from "bun:test";

import { undoDepth } from "@codemirror/commands";
import { foldedRanges, unfoldEffect } from "@codemirror/language";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";

import {
  pauseEditorParser,
  resumeEditorParser,
  safeSourceEffects,
  switchEditorMode,
} from "./editor-mode";
import {
  currentFoldTarget,
  isHeadingShortcut,
  headingStructureReady,
  headingStructureState,
  headingToggleTransaction,
} from "./heading-folding";
import { headingStructureSteps } from "./heading-structure";
import { createRawEditorState, rawText } from "./raw-buffer";

function prepared() {
  let state = createRawEditorState("# A\nbody\n## B\ninside\n# C\nlast");
  const task = headingStructureSteps(state);
  let next = task.next();
  while (!next.done) next = task.next();
  state = state.update({ effects: headingStructureReady.of(next.value) }).state;
  return { state, sections: next.value.sections };
}
function folds(state: EditorState) {
  const ranges: number[][] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    ranges.push([from, to]);
  });
  return ranges;
}
test("explicit single caret fold relocates to title end without modifying raw/history", () => {
  const { state: initial, sections } = prepared();
  let state = initial.update({ selection: { anchor: 6 } }).state;
  const before = state.field(rawText),
    history = undoDepth(state);
  state = headingToggleTransaction(state, sections[0])!.state;
  expect(state.selection.main.head).toBe(3);
  expect(folds(state)).toEqual([[3, 20]]);
  expect(state.field(rawText)).toBe(before);
  expect(undoDepth(state)).toBe(history);
  expect(folds(headingToggleTransaction(state, sections[0])!.state)).toEqual(
    []
  );
});
test("nonempty and secondary intersecting selections reject atomically", () => {
  const { state: initial, sections } = prepared();
  for (const selection of [
    EditorSelection.single(2, 7),
    EditorSelection.create([
      EditorSelection.cursor(0),
      EditorSelection.cursor(6),
    ]),
  ]) {
    const state = initial
      .update({ effects: switchEditorMode("source") })
      .state.update({ selection }).state;
    expect(state.selection.ranges.length).toBe(selection.ranges.length);
    expect(headingToggleTransaction(state, sections[0])).toBeNull();
    expect(folds(state)).toEqual([]);
  }
});
test("secondary selection and nonempty intersections expand every containing fold", () => {
  const { state: initial, sections } = prepared();
  let state = initial.update({ effects: switchEditorMode("source") }).state;
  state = headingToggleTransaction(state, sections[1])!.state;
  state = headingToggleTransaction(state, sections[0])!.state;
  expect(folds(state)).toHaveLength(2);
  state = state.update({
    selection: EditorSelection.create([
      EditorSelection.cursor(0),
      EditorSelection.cursor(16),
    ]),
  }).state;
  expect(folds(state)).toEqual([]);
});
test("mode/readonly preserve display fold; changes/parser pause/safe clear it", () => {
  for (const action of ["change", "pause", "safe"]) {
    const { state: initial, sections } = prepared();
    let state = headingToggleTransaction(initial, sections[0])!.state;
    state = state.update({
      effects: [...switchEditorMode("source"), StateEffectReadOnly()],
    }).state;
    expect(folds(state)).toHaveLength(1);
    state = state.update(
      action === "change"
        ? { changes: { from: 0, insert: "x" } }
        : {
            effects:
              action === "pause" ? pauseEditorParser() : safeSourceEffects(),
          }
    ).state;
    expect(folds(state)).toEqual([]);
    expect(state.field(headingStructureState)).toBeNull();
  }
});
function StateEffectReadOnly() {
  return StateEffect.appendConfig.of(EditorState.readOnly.of(true));
}
test("stale structure cannot publish into changed document", () => {
  const { state, sections } = prepared();
  expect(sections.length).toBeGreaterThan(0);
  const stale = state.field(headingStructureState)!;
  const changed = state.update({
    changes: { from: 0, insert: "x" },
    effects: headingStructureReady.of(stale),
  }).state;
  expect(changed.field(headingStructureState)).toBeNull();
});

test("placeholder revalidates same Text and range after inactive pause/resume", () => {
  const { state: initial, sections } = prepared();
  let state = headingToggleTransaction(initial, sections[0])!.state;
  const stamp = { doc: state.doc, from: sections[0].from, to: sections[0].to };
  expect(currentFoldTarget(state, stamp)).toBeDefined();
  state = state.update({ effects: pauseEditorParser(true) }).state;
  expect(folds(state)).toHaveLength(1);
  expect(currentFoldTarget(state, stamp)).toBeDefined();
  state = state.update({ effects: resumeEditorParser(state) }).state;
  const task = headingStructureSteps(state);
  let next = task.next();
  while (!next.done) next = task.next();
  state = state.update({ effects: headingStructureReady.of(next.value) }).state;
  expect(currentFoldTarget(state, stamp)).toBeDefined();
  state = state.update({
    effects: unfoldEffect.of(currentFoldTarget(state, stamp)!),
  }).state;
  expect(folds(state)).toEqual([]);
  expect(currentFoldTarget(state, stamp)).toBeUndefined();
  const changed = state.update({ changes: { from: 6, insert: "x" } }).state;
  expect(currentFoldTarget(changed, stamp)).toBeUndefined();
});
test("fold shortcut is exact and refuses composition and normal find chord", () => {
  const key = {
    code: "KeyF",
    metaKey: true,
    altKey: true,
    ctrlKey: false,
    shiftKey: false,
    isComposing: false,
  };
  expect(isHeadingShortcut(key)).toBe(true);
  for (const extra of [
    { altKey: false },
    { ctrlKey: true },
    { shiftKey: true },
    { isComposing: true },
    { metaKey: false },
    { code: "KeyG" },
  ])
    expect(isHeadingShortcut({ ...key, ...extra })).toBe(false);
});
test("full document replacement cannot leave mapped hidden ranges", () => {
  const { state, sections } = prepared();
  const folded = headingToggleTransaction(state, sections[0])!.state;
  expect(
    folds(
      folded.update({
        changes: { from: 0, to: folded.doc.length, insert: "new" },
      }).state
    )
  ).toEqual([]);
});
