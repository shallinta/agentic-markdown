import { expect, test } from "bun:test";

import { createDocumentController } from "./documents";
import { createDualActiveEditorLab } from "./dual-readonly-editor-lab";
import { rawText } from "./raw-buffer";
import { canMoveRealRegionDocument, moveRealRegionDocument, projectRealRegionDocuments, reconcileRealRegionAllocation, type RealRegionAllocation } from "./real-document-region-lab";

const empty = (totalHeight = 320): RealRegionAllocation => ({ ids: [], heights: [], totalHeight });

async function threeDocuments() {
  const source = await createDualActiveEditorLab();
  const [a, b] = source.documents;
  source.dispose();
  const third = { ...a, documentId: crypto.randomUUID(), handle: crypto.randomUUID(), fileName: "third.md" };
  const documents = [a, b, third];
  let next = 0;
  const controller = createDocumentController({
    selectDocument: request => Promise.resolve({ ...request, ok: true, snapshot: documents[next++] ?? null }),
    readDocument: request => Promise.resolve({ ...request, ok: true, snapshot: null }),
    cancelDocument: request => Promise.resolve({ ...request, ok: true, snapshot: null }),
    releaseDocument: request => Promise.resolve({ ...request, ok: true, snapshot: null }),
  });
  await controller.select(); await controller.select(); await controller.select();
  return { controller, documents };
}

function moved(controller: ReturnType<typeof createDocumentController>, allocation: RealRegionAllocation, target: "main" | "secondary") {
  const result = moveRealRegionDocument(controller, allocation, target);
  if (!result.ok) throw Error(result.reason);
  return result.allocation;
}

test("projection preserves ordered identities, preferred main and close-height transfers", () => {
  const a = { documentId: "a" }, b = { documentId: "b" }, c = { documentId: "c" };
  const tabs = [a, b, c];
  const allocation = { ids: ["c", "b"], heights: [100, 220], totalHeight: 320 };
  const split = projectRealRegionDocuments(tabs, "b", allocation, "a")!;
  expect(split.main).toEqual([a]); expect(split.mainCurrent).toBe(a);
  expect(split.secondary[0]).toBe(c); expect(split.secondary[1]).toBe(b);
  expect(split.allocation).toBe(allocation);
  const single = { ids: ["c"], heights: [320], totalHeight: 320 };
  expect(projectRealRegionDocuments(tabs, "c", single, "b")!.mainCurrent).toBe(b);
  expect(projectRealRegionDocuments(tabs, "a", single, "b")!.mainCurrent).toBe(a);
  expect(reconcileRealRegionAllocation([a, b], allocation)).toEqual({ ids: ["b"], heights: [320], totalHeight: 320 });
  expect(reconcileRealRegionAllocation([a, c], allocation)).toEqual({ ids: ["c"], heights: [320], totalHeight: 320 });
  expect(reconcileRealRegionAllocation([], allocation)).toEqual(empty());
  expect(projectRealRegionDocuments([b, c], "b", allocation)!.mainCurrent).toBeNull();
  expect(reconcileRealRegionAllocation([a, a], empty())).toBeUndefined();
});

for (const height of [65, 66, 320]) {
  test(`real controller allocation at ${height}px preserves drafts and explicit capacity reasons`, async () => {
    const { controller: c, documents: [a, b, d] } = await threeDocuments();
    try {
      c.activateTab(b.documentId);
      const state = c.getEditor(b.documentId)!.state;
      c.updateEditor(b.documentId, state.update({ changes: { from: 0, insert: "draft" } }));
      const before = c.getSnapshot(), editor = c.getEditor(b.documentId);
      const first = moved(c, empty(height), "secondary");
      expect(first).toEqual({ ids: [b.documentId], heights: [height], totalHeight: height });
      expect(c.getSnapshot()).toBe(before); expect(c.getEditor(b.documentId)).toBe(editor);
      c.activateTab(d.documentId);
      const second = moveRealRegionDocument(c, first, "secondary");
      if (height === 65) {
        expect(second).toEqual({ ok: false, reason: "full" });
        expect(first).toEqual({ ids: [b.documentId], heights: [65], totalHeight: 65 });
      } else {
        expect(second.ok).toBe(true);
        if (!second.ok) throw Error(second.reason);
        expect(second.allocation.heights).toEqual([height / 2, height / 2]);
        expect(second.allocation.ids).toEqual([b.documentId, d.documentId]);
        c.activateTab(a.documentId);
        expect(moveRealRegionDocument(c, second.allocation, "secondary")).toEqual({ ok: false, reason: "lab-limit" });
        await c.closeTab(a.documentId);
        c.activateTab(d.documentId);
        expect(moved(c, second.allocation, "main")).toEqual({ ids: [b.documentId], heights: [height], totalHeight: height });
      }
      expect(c.getEditor(b.documentId)!.state.field(rawText)).toBe("draft" + b.text);
    } finally { c.dispose(); }
  });
}

test("move guards reject invalid geometry and barriers without changing allocations", async () => {
  const f = await createDualActiveEditorLab();
  const c = f.controller;
  try {
    const allocation: RealRegionAllocation = Object.freeze({ ids: Object.freeze([] as string[]), heights: Object.freeze([] as number[]), totalHeight: 320 });
    const first = moved(c, allocation, "secondary");
    c.activateTab(f.documents[1].documentId);
    expect(moveRealRegionDocument(c, first, "secondary")).toEqual({ ok: false, reason: "keep-main" });
    const interaction = c.registerEditorInteraction(f.documents[1].documentId, () => false);
    expect(moveRealRegionDocument(c, allocation, "secondary")).toEqual({ ok: false, reason: "blocked" });
    interaction.release();
    c.beginDiscard(); expect(canMoveRealRegionDocument(c, allocation, "secondary")).toBe(false); c.endDiscard();
    c.setEditorInputBlocked(true); expect(canMoveRealRegionDocument(c, allocation, "secondary")).toBe(false); c.setEditorInputBlocked(false);
    expect(canMoveRealRegionDocument({ ...c, hasSaves: () => true }, allocation, "secondary")).toBe(false);
    expect(moveRealRegionDocument(c, { ids: ["x"], heights: [33], totalHeight: 320 }, "secondary")).toEqual({ ok: false, reason: "invalid" });
    expect(moveRealRegionDocument(c, { ...allocation, totalHeight: NaN }, "secondary")).toEqual({ ok: false, reason: "invalid" });
    expect(allocation).toEqual(empty());
    await c.closeActive();
    expect(moved(c, first, "main")).toEqual(empty());
  } finally { f.dispose(); }
});
