import { expect, test } from "bun:test";

import { undoDepth } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";

import type { DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDocumentController } from "./documents";
import {
  editorPermissionEffect,
  editorSurfaceEditable,
  prepareEditorViewState,
} from "./editor-view-sync";
import { createRawEditorState, rawText } from "./raw-buffer";

test("permission facets change together without changing raw, selection or history", () => {
  let state = createRawEditorState("\ufeffimmutable\r\n");
  const before = state;
  for (const readonly of [true, false, true]) {
    state = state.update({ effects: editorPermissionEffect(readonly) }).state;
    expect(state.readOnly).toBe(readonly);
    expect(state.facet(EditorView.editable)).toBe(!readonly);
    expect(state.facet(EditorView.contentAttributes)).toContainEqual({
      tabindex: "0",
    });
    expect(state.field(rawText)).toBe(before.field(rawText));
    expect(state.selection.eq(before.selection)).toBe(true);
    expect(undoDepth(state)).toBe(0);
    for (const frozen of [true, false])
      for (const blocked of [true, false]) {
        expect(editorSurfaceEditable(readonly, frozen, blocked)).toBe(
          !readonly && !frozen && !blocked
        );
      }
  }
});

test("initial view uses only actual controller accepted permission state; frozen rejection leaves state intact", async () => {
  const text = "immutable\r\n";
  const snapshot: DocumentSnapshot = {
    handle: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    fileName: "sample.md",
    revision: 1,
    hash: "a".repeat(64),
    text,
    byteLength: text.length,
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: false, reason: "readonly" },
  };
  const controller = createDocumentController({
    selectDocument: (r) => Promise.resolve({ ...r, ok: true, snapshot }),
    readDocument: (r) => Promise.resolve({ ...r, ok: true, snapshot }),
    cancelDocument: () => Promise.resolve(),
    releaseDocument: () => Promise.resolve(),
  });
  await controller.select();
  const id = snapshot.documentId;
  const accepted = prepareEditorViewState(controller, id)!;
  expect(accepted).toBe(controller.getEditor(id)!.state);
  expect(accepted.readOnly).toBe(true);
  expect(accepted.facet(EditorView.editable)).toBe(false);
  expect(controller.isDirty(id)).toBe(false);
  expect(accepted.field(rawText)).toBe(text);
  expect(controller.beginDiscard()).toBe(true);
  expect(prepareEditorViewState(controller, id)).toBeUndefined();
  expect(controller.getEditor(id)!.state).toBe(accepted);
  controller.endDiscard();
  expect(prepareEditorViewState(controller, id)).toBe(
    controller.getEditor(id)!.state
  );
  expect(undoDepth(controller.getEditor(id)!.state)).toBe(0);
});
