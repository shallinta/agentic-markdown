import { expect, test } from "bun:test";

import { undo } from "@codemirror/commands";
import type { StateEffect } from "@codemirror/state";

import { createDualActiveEditorLab, createDualReadonlyEditorLab } from "./dual-readonly-editor-lab";
import { prepareEditorViewState } from "./editor-view-sync";
import { rawText } from "./raw-buffer";

test("dual lab uses real isolated readonly states and preserves per-document selection", async () => {
  const fixture = await createDualReadonlyEditorLab();
  const { controller: c, documents: [a, b] } = fixture;
  try {
    expect(c.getSnapshot().tabs.map(value => value.documentId)).toEqual([a.documentId, b.documentId]);
    expect(c.getSnapshot().snapshot?.documentId).toBe(a.documentId);
    for (const value of [a, b]) {
      const state = prepareEditorViewState(c, value.documentId)!;
      expect(state.readOnly).toBe(true);
      expect(c.canWrite(value.documentId)).toBe(false);
      expect(c.updateEditor(value.documentId, state.update({ changes: { from: 0, insert: "forbidden" } }))).toBe(false);
      expect(c.updateEditor(value.documentId, state.update({ selection: { anchor: 2, head: value === a ? 7 : 10 } }))).toBe(true);
      expect(c.getEditor(value.documentId)!.state.field(rawText)).toBe(value.text);
      expect(c.isDirty(value.documentId)).toBe(false);
    }
    c.activateTab(b.documentId);
    expect(c.getSnapshot().snapshot?.documentId).toBe(b.documentId);
    c.activateTab(a.documentId);
    expect(c.getEditor(a.documentId)!.state.selection.main.to).toBe(7);
    expect(c.getEditor(b.documentId)!.state.selection.main.to).toBe(10);
    expect(c.canSave()).toBe(false);
    const oldB = c.getEditor(b.documentId);
    await c.reload();
    expect(c.getEditor(b.documentId)).toBe(oldB);
    expect(c.getEditor(a.documentId)!.state.field(rawText)).toBe(a.text);
  } finally {
    fixture.dispose();
  }
});

test("separate dual lab controllers never share state despite fixed synthetic IDs", async () => {
  const first = await createDualReadonlyEditorLab();
  const second = await createDualReadonlyEditorLab();
  try {
    const id = first.documents[0].documentId;
    const state = first.controller.getEditor(id)!.state;
    expect(first.controller.updateEditor(id, state.update({ selection: { anchor: 5 } }))).toBe(true);
    expect(second.controller.getEditor(id)!.state.selection.main.head).toBe(0);
    first.dispose();
    expect(second.controller.getEditor(id)!.state.field(rawText)).toBe(second.documents[0].text);
  } finally {
    first.dispose(); second.dispose();
  }
});


test("active-only lab rejects passive raw and document changes but permits independent view state", async () => {
  const f = await createDualActiveEditorLab();
  const { controller: c, documents: [a, b] } = f;
  try {
    expect(a.fileName).toBe("双草稿合成-A.md");
    expect(c.canWrite(a.documentId)).toBe(true);
    expect(c.canWrite(b.documentId)).toBe(true);
    let aState = c.getEditor(a.documentId)!.state;
    expect(c.updateEditor(a.documentId, aState.update({ changes: { from: 0, insert: "草稿" } }))).toBe(true);
    aState = c.getEditor(a.documentId)!.state;
    let inverse: readonly StateEffect<unknown>[] = [];
    expect(undo({ state: aState, dispatch: transaction => { inverse = transaction.effects; } })).toBe(true);
    expect(inverse.length).toBeGreaterThan(0);
    const composing = c.registerEditorInteraction(a.documentId, () => false);
    expect(c.updateEditor(a.documentId, aState.update({ changes: { from: aState.doc.length, insert: "候选" }, selection: { anchor: 2 }, userEvent: "input.type.compose" }))).toBe(true);
    c.activateTab(b.documentId);
    expect(c.getSnapshot().snapshot?.documentId).toBe(a.documentId);
    composing.release();
    c.activateTab(b.documentId);
    aState = c.getEditor(a.documentId)!.state;
    const rawOnly = aState.update({ effects: inverse });
    expect(rawOnly.docChanged).toBe(false);
    expect(rawOnly.state.field(rawText)).not.toBe(aState.field(rawText));
    expect(c.updateEditor(a.documentId, rawOnly)).toBe(false);
    expect(c.updateEditor(a.documentId, aState.update({ changes: { from: 0, insert: "拒绝" } }))).toBe(false);
    expect(c.updateEditor(a.documentId, aState.update({ selection: { anchor: 3 } }))).toBe(true);
    const bState = c.getEditor(b.documentId)!.state;
    expect(c.updateEditor(b.documentId, bState.update({ changes: { from: 0, insert: "乙" } }))).toBe(true);
    expect(c.runHistory("undo", b.documentId)).toBe(true);
    expect(c.getEditor(b.documentId)!.state.field(rawText)).toBe(b.text);
    expect(c.getEditor(a.documentId)!.state.field(rawText)).toBe("草稿" + a.text + "候选");
  } finally { f.dispose(); }
});
