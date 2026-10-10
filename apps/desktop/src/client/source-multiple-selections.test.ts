import { expect, test } from "bun:test";

import { undo, redo } from "@codemirror/commands";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";

import { isCommand } from "../shared/commands";

import { safeSourceEffects, switchEditorMode } from "./editor-mode";
import { createRawEditorState, rawText } from "./raw-buffer";
import {
  guardSourceSelectionMouse,
  isOrdinarySourceSelection,
  routeSourceSelectionKey,
} from "./source-selection-input";

test("production ordinary-source predicate leaves safe Escape and mouse to the original path", () => {
  let intercepted = 0;
  const event = {
    key: "Escape",
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    isComposing: false,
    preventDefault: () => {
      intercepted++;
    },
    stopImmediatePropagation: () => {
      intercepted++;
    },
  };
  expect(isOrdinarySourceSelection("source", false)).toBe(true);
  expect(isOrdinarySourceSelection("editing", false)).toBe(false);
  const ordinary = isOrdinarySourceSelection("source", true);
  expect(
    routeSourceSelectionKey(event, ordinary, false, crypto.randomUUID(), () => {
      intercepted++;
    })
  ).toBe(false);
  expect(
    guardSourceSelectionMouse(
      { ...event, button: 0, metaKey: true },
      ordinary,
      false
    )
  ).toBe(false);
  expect(intercepted).toBe(0);
});

test("ordinary source multi-range changes preserve raw bytes and one history step", () => {
  const raw = "\ufeff甲😀\r\n乙\n丙\r\n末";
  let state = createRawEditorState(raw);
  expect(state.facet(EditorState.allowMultipleSelections)).toBe(false);
  state = state.update({ effects: switchEditorMode("source") }).state;
  state = state.update({
    selection: EditorSelection.create(
      [EditorSelection.cursor(1), EditorSelection.cursor(6)],
      1
    ),
  }).state;
  expect(state.selection.ranges).toHaveLength(2);
  state = state.update(state.replaceSelection("中\n"), {
    userEvent: "input.type",
  }).state;
  expect(state.field(rawText)).toBe("\ufeff中\r\n甲😀\r\n乙中\n\n丙\r\n末");
  const after = state.field(rawText);
  const dispatch = (tr: Transaction) => {
    state = tr.state;
  };
  expect(undo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(raw);
  expect(redo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(after);
});

test("exiting source explicitly retains main range and history cannot revive multiple ranges", () => {
  for (const effects of [switchEditorMode("editing"), safeSourceEffects()]) {
    let state = createRawEditorState("one\ntwo");
    state = state.update({ effects: switchEditorMode("source") }).state;
    state = state.update({
      selection: EditorSelection.create(
        [EditorSelection.range(0, 3), EditorSelection.range(7, 4)],
        1
      ),
    }).state;
    state = state.update(state.replaceSelection("X"), {
      userEvent: "input.type",
    }).state;
    const main = state.selection.main;
    state = state.update({
      effects,
      selection: state.selection.asSingle(),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    expect(state.selection.ranges).toHaveLength(1);
    expect(state.selection.main).toEqual(main);
    expect(state.facet(EditorState.allowMultipleSelections)).toBe(false);
    const dispatch = (tr: Transaction) => {
      state = tr.state;
    };
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.field(rawText)).toBe("one\ntwo");
    expect(state.selection.ranges).toHaveLength(1);
    expect(redo({ state, dispatch })).toBe(true);
    expect(state.selection.ranges).toHaveLength(1);
  }
  expect(
    createRawEditorState("isolated", [], true).facet(
      EditorState.allowMultipleSelections
    )
  ).toBe(false);
});

test("local source key routing is guarded and never falls through to default cursor actions", () => {
  const documentId = crypto.randomUUID();
  let calls = 0,
    prevented = 0,
    stopped = 0;
  const event = {
    key: "ArrowUp",
    metaKey: true,
    altKey: true,
    ctrlKey: false,
    shiftKey: false,
    isComposing: false,
    preventDefault: () => {
      prevented++;
    },
    stopImmediatePropagation: () => {
      stopped++;
    },
  };
  const execute = () => {
    calls++;
  };
  expect(routeSourceSelectionKey(event, true, true, documentId, execute)).toBe(
    true
  );
  expect(calls).toBe(1);
  routeSourceSelectionKey(event, true, false, documentId, execute);
  routeSourceSelectionKey(
    { ...event, isComposing: true },
    true,
    true,
    documentId,
    execute
  );
  expect(calls).toBe(1);
  expect(prevented).toBe(2);
  expect(stopped).toBe(3);
  expect(routeSourceSelectionKey(event, false, true, documentId, execute)).toBe(
    false
  );
  expect(
    routeSourceSelectionKey(
      { ...event, key: "a" },
      true,
      true,
      documentId,
      execute
    )
  ).toBe(false);
  expect(prevented).toBe(2);
  for (const type of [
    "addSourceCursorAbove",
    "addSourceCursorBelow",
    "simplifySourceSelection",
  ]) {
    expect(isCommand({ type, args: { documentId } })).toBe(true);
    expect(isCommand({ type, args: {} })).toBe(false);
    expect(isCommand({ type, args: { documentId, extra: 1 } })).toBe(false);
  }
});

test("mouse guard blocks only source meta-add while denied, leaving read-only selection to CM", () => {
  let prevented = 0,
    stopped = 0;
  const event = {
    button: 0,
    metaKey: true,
    preventDefault: () => {
      prevented++;
    },
    stopImmediatePropagation: () => {
      stopped++;
    },
  };
  expect(guardSourceSelectionMouse(event, true, false)).toBe(true);
  expect(prevented).toBe(1);
  expect(stopped).toBe(1);
  expect(guardSourceSelectionMouse(event, true, true)).toBe(false);
  expect(guardSourceSelectionMouse(event, false, false)).toBe(false);
  expect(
    guardSourceSelectionMouse({ ...event, metaKey: false }, true, false)
  ).toBe(false);
  expect(guardSourceSelectionMouse({ ...event, button: 2 }, true, false)).toBe(
    false
  );
  expect(prevented).toBe(1);
});
