import { expect, test } from "bun:test";

import { createDualActiveEditorLab } from "./dual-readonly-editor-lab";
import { rawText } from "./raw-buffer";
import { canMoveRealRegionDocument, moveRealRegionDocument, projectRealRegionDocuments } from "./real-document-region-lab";

test("region projection retains real tab references and never duplicates the secondary document", () => {
  const a = { documentId: "a" }, b = { documentId: "b" };
  const tabs = [a, b];
  const split = projectRealRegionDocuments(tabs, "b", "b");
  expect(split.main).toEqual([a]);
  expect(split.mainCurrent).toBe(a);
  expect(split.secondary).toBe(b);
  expect(projectRealRegionDocuments(tabs, "b", null).mainCurrent).toBe(b);
  expect(projectRealRegionDocuments([a], "a", "b").secondaryId).toBeNull();
  expect(projectRealRegionDocuments([], null, "b").mainCurrent).toBeNull();
});

test("real-controller move decisions preserve drafts and reject operation barriers or occupied secondary", async () => {
  const f = await createDualActiveEditorLab();
  const { controller: c, documents: [a, b] } = f;
  try {
    c.activateTab(b.documentId);
    const state = c.getEditor(b.documentId)!.state;
    c.updateEditor(b.documentId, state.update({ changes: { from: 0, insert: "draft" } }));
    const before = c.getSnapshot(), editor = c.getEditor(b.documentId);
    expect(moveRealRegionDocument(c, null, "secondary")).toEqual({ ok: true, secondaryId: b.documentId });
    expect(c.getSnapshot()).toBe(before);
    expect(c.getEditor(b.documentId)).toBe(editor);
    expect(moveRealRegionDocument(c, b.documentId, "main")).toEqual({ ok: true, secondaryId: null });
    expect(c.getEditor(b.documentId)!.state.field(rawText)).toBe("draft" + b.text);
    const interaction = c.registerEditorInteraction(b.documentId, () => false);
    expect(canMoveRealRegionDocument(c, null, "secondary")).toBe(false);
    interaction.release();
    c.beginDiscard(); expect(canMoveRealRegionDocument(c, null, "secondary")).toBe(false); c.endDiscard();
    c.setEditorInputBlocked(true); expect(canMoveRealRegionDocument(c, null, "secondary")).toBe(false); c.setEditorInputBlocked(false);
    expect(canMoveRealRegionDocument({ ...c, hasSaves: () => true }, null, "secondary")).toBe(false);
    c.activateTab(a.documentId);
    expect(moveRealRegionDocument(c, b.documentId, "secondary")).toEqual({ ok: false });
    expect(moveRealRegionDocument(c, b.documentId, "main")).toEqual({ ok: false });
    await c.closeTab(a.documentId);
    expect(moveRealRegionDocument(c, b.documentId, "main")).toEqual({ ok: true, secondaryId: null });
    expect(canMoveRealRegionDocument(c, null, "secondary")).toBe(false);
  } finally { f.dispose(); }
});
