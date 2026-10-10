import { expect, test } from "bun:test";

import { isolateHistory, redo, undo, undoDepth } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  type Transaction,
} from "@codemirror/state";

import {
  getEditorMode,
  safeSourceEffects,
  switchEditorMode,
} from "./editor-mode";
import { createRawEditorState, rawText, writePermission } from "./raw-buffer";
import {
  INDENT_BOUNDARY_CHANGE,
  planSourceIndentation,
} from "./source-indentation";
import {
  isOrdinaryIndentation,
  routeIndentationInput,
} from "./source-indentation-input";

test("default editing state uses one multi-line range and one reversible raw transaction", () => {
  for (const marker of ["```ts", "~~~~lang"])
    for (let baseline = 0; baseline <= 3; baseline++) {
      const raw =
        "\ufeff" +
        " ".repeat(baseline) +
        marker +
        "\r\nword\r\n\tword\n" +
        " ".repeat(baseline) +
        marker.replace(/[a-z]+$/, "");
      let filters = 0;
      let state = createRawEditorState(
        raw,
        EditorState.transactionFilter.of((tx) => {
          filters++;
          return tx;
        })
      );
      expect(getEditorMode(state)).toBe("editing");
      expect(state.selection.ranges).toHaveLength(1);
      state = state.update({
        selection: EditorSelection.range(
          state.doc.line(4).from,
          state.doc.line(2).from
        ),
      }).state;
      const before = state,
        plan = planSourceIndentation(state, true);
      expect(plan.reason).toBeUndefined();
      filters = 0;
      const transaction = state.update({
        changes: plan.changes,
        annotations: isolateHistory.of("full"),
      });
      state = transaction.state;
      expect(filters).toBe(1);
      expect(state.selection.ranges).toHaveLength(1);
      expect(
        state.selection.eq(before.selection.map(transaction.changes))
      ).toBe(true);
      const changed = state.field(rawText);
      expect(changed.startsWith(raw.slice(0, raw.indexOf("\r\n") + 2))).toBe(
        true
      );
      expect(changed.endsWith(raw.slice(raw.lastIndexOf("\n")))).toBe(true);
      state = state.update({ effects: switchEditorMode("source") }).state;
      const target = {
        get state() {
          return state;
        },
        dispatch: (tx: Transaction) => {
          state = tx.state;
        },
      };
      expect(undo(target)).toBe(true);
      expect(state.field(rawText)).toBe(raw);
      expect(state.selection.eq(before.selection)).toBe(true);
      state = state.update({ effects: switchEditorMode("editing") }).state;
      expect(redo(target)).toBe(true);
      expect(state.field(rawText)).toBe(changed);
      expect(state.selection.ranges).toHaveLength(1);
    }
});

test("editing paragraphs, empty lines and zero code indent keep raw/history unchanged", () => {
  for (const [raw, position] of [
    ["ordinary paragraph", 5],
    ["", 0],
    ["   ```\n   word\n   ```", 8],
  ] as const) {
    const state = createRawEditorState(raw).update({
      selection: { anchor: position },
    }).state;
    expect(getEditorMode(state)).toBe("editing");
    expect(planSourceIndentation(state, false)).toEqual({ changes: [] });
    expect(state.field(rawText)).toBe(raw);
    expect(undoDepth(state)).toBe(0);
  }
  let state = createRawEditorState("  ```\n\n  ```").update({
    selection: { anchor: 6 },
  }).state;
  const plan = planSourceIndentation(state, true);
  expect(plan.reason).toBeUndefined();
  state = state.update({ changes: plan.changes }).state;
  expect(state.field(rawText)).toBe("  ```\n    \n  ```");
});

test("editing selection-only state changes preserve raw and reject marker or hazard ranges", () => {
  for (const [raw, from, to] of [
    ["```ts\nword\n```", 0, 9],
    ["> ```\n> word\n> ```", 8, 9],
    ["```\nword", 4, 4],
  ] as const) {
    const state = createRawEditorState(raw).update({
      selection: EditorSelection.range(from, to),
    }).state;
    expect(state.field(rawText)).toBe(raw);
    expect(planSourceIndentation(state, true).reason).toBeDefined();
    expect(undoDepth(state)).toBe(0);
  }
  const raw = "````ts\n    ````\nword\n````",
    state = createRawEditorState(raw).update({
      selection: { anchor: 8 },
    }).state;
  expect(planSourceIndentation(state, false).reason).toBe(
    INDENT_BOUNDARY_CHANGE
  );
  const readonly = state.update({
    effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
  }).state;
  expect(planSourceIndentation(readonly, true).reason).toBeDefined();
});

test("production consumer predicate admits editing but not reading or dynamic safe", () => {
  const calls: string[] = [];
  const event = {
    key: "Tab",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
  };
  for (const mode of ["editing", "source"]) {
    expect(
      routeIndentationInput(
        event,
        isOrdinaryIndentation(mode, false),
        true,
        false,
        crypto.randomUUID(),
        (c) => calls.push(c.type)
      )
    ).toBe(true);
    expect(isOrdinaryIndentation(mode, true)).toBe(false);
  }
  expect(calls).toEqual(["indentSource", "indentSource"]);
  expect(isOrdinaryIndentation("reading", false)).toBe(false);
  expect(isOrdinaryIndentation(undefined, false)).toBe(false);
  const state = createRawEditorState("```\nword\n```").update({
    effects: safeSourceEffects(),
  }).state;
  expect(planSourceIndentation(state, true).reason).toBeDefined();
});
