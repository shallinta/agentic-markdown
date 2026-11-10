import { expect, test } from "bun:test";

import { createDualReadonlyEditorLab } from "./dual-readonly-editor-lab";
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
