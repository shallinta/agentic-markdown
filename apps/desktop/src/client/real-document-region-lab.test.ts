import { expect, test } from "bun:test";

import { createDocumentController } from "./documents";
import { createDualActiveEditorLab } from "./dual-readonly-editor-lab";
import { rawText } from "./raw-buffer";
import { canMoveRealRegionDocument, moveRealRegionDocument, projectRealRegionDocuments, reconcileRealRegionAllocation, reorderRealRegionDocuments, prepareSecondaryReturn, prepareMainTransferToSecondary, routeWorkspaceOpenReceipt, type RealRegionAllocation } from "./real-document-region-lab";

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

test("secondary reorder carries asymmetric heights without activating or changing drafts", async () => {
  const { controller: c, documents: [a, b, d] } = await threeDocuments();
  try {
    c.activateTab(a.documentId);
    const state = c.getEditor(a.documentId)!.state;
    c.updateEditor(a.documentId, state.update({ changes: { from: 0, insert: "main draft" } }));
    const before = c.getSnapshot();
    const editors = [a, b, d].map(doc => c.getEditor(doc.documentId));
    const original: RealRegionAllocation = Object.freeze({ ids: Object.freeze([b.documentId, d.documentId]), heights: Object.freeze([100, 220]), totalHeight: 320 });
    const reordered = reorderRealRegionDocuments(c, original, d.documentId, b.documentId, "before");
    expect(reordered.ok).toBe(true);
    if (!reordered.ok) throw Error(reordered.reason);
    expect(reordered.allocation).toEqual({ ids: [d.documentId, b.documentId], heights: [220, 100], totalHeight: 320 });
    expect(c.getSnapshot()).toBe(before);
    for (const [index, doc] of [a, b, d].entries()) expect(c.getEditor(doc.documentId)).toBe(editors[index]);
    const restored = reorderRealRegionDocuments(c, reordered.allocation, d.documentId, b.documentId, "after");
    expect(restored).toEqual({ ok: true, allocation: original });
    const noop = reorderRealRegionDocuments(c, original, b.documentId, d.documentId, "before");
    expect(noop.ok && noop.allocation === original).toBe(true);
    expect(reorderRealRegionDocuments(c, original, a.documentId, b.documentId, "after")).toEqual({ ok: false, reason: "invalid" });
    expect(reorderRealRegionDocuments(c, original, b.documentId, "absent", "after")).toEqual({ ok: false, reason: "invalid" });
    const composition = c.registerEditorInteraction(a.documentId, () => false);
    expect(reorderRealRegionDocuments(c, original, b.documentId, d.documentId, "after")).toEqual({ ok: false, reason: "blocked" });
    composition.release();
    c.beginDiscard();
    expect(reorderRealRegionDocuments(c, original, b.documentId, d.documentId, "after")).toEqual({ ok: false, reason: "blocked" });
    c.endDiscard();
    expect(reorderRealRegionDocuments({ ...c, hasSaves: () => true }, original, b.documentId, d.documentId, "after")).toEqual({ ok: false, reason: "blocked" });
    await c.closeTab(d.documentId);
    expect(reorderRealRegionDocuments(c, original, b.documentId, d.documentId, "after")).toEqual({ ok: false, reason: "invalid" });
    expect(original.ids).toEqual([b.documentId, d.documentId]);
    expect(original.heights).toEqual([100, 220]);
  } finally { c.dispose(); }
});

test("prepared return activates a background draft without changing mode selection or history", async () => {
  const { controller: c, documents: [a, b, d] } = await threeDocuments();
  try {
    c.activateTab(b.documentId); c.toggleSourceMode();
    const state = c.getEditor(b.documentId)!.state;
    c.updateEditor(b.documentId, state.update({ changes: { from: 0, insert: "draft" }, selection: { anchor: 2, head: 5 } }));
    c.activateTab(a.documentId);
    const original: RealRegionAllocation = { ids: [b.documentId, d.documentId], heights: [100, 220], totalHeight: 320 };
    const before = c.getSnapshot();
    const prepared = prepareSecondaryReturn(c, original, b.documentId);
    expect(prepared.ok).toBe(true);
    expect(c.getSnapshot()).toBe(before);
    if (!prepared.ok) throw Error(prepared.reason);
    expect(prepared.plan.allocation).toEqual({ ids: [d.documentId], heights: [320], totalHeight: 320 });
    expect(prepared.plan.commit(() => original)).toBe(true);
    expect(prepared.plan.commit(() => original)).toBe(false);
    expect(c.getSnapshot().snapshot?.documentId).toBe(b.documentId);
    expect(c.getMode(b.documentId)).toBe("source");
    expect(c.getEditor(b.documentId)!.state.selection.main.from).toBe(2);
    expect(c.getEditor(b.documentId)!.state.selection.main.to).toBe(5);
    expect(c.getEditor(b.documentId)!.state.field(rawText)).toBe("draft" + b.text);
    expect(c.runHistory("undo", b.documentId)).toBe(true);
    expect(c.getEditor(b.documentId)!.state.field(rawText)).toBe(b.text);
    expect(original.heights).toEqual([100, 220]);
  } finally { c.dispose(); }
});

for (const invalidate of ["allocation", "close", "composition", "save", "during-activation"] as const) {
  test(`prepared return rejects ${invalidate} without publishing region allocation`, async () => {
    const { controller: c, documents: [a, b] } = await threeDocuments();
    try {
      c.activateTab(a.documentId);
      let live: RealRegionAllocation = { ids: [b.documentId], heights: [320], totalHeight: 320 };
      const original = live;
      let saving = false;
      const target = { ...c, hasSaves: () => saving || c.hasSaves() };
      const prepared = prepareSecondaryReturn(target, original, b.documentId);
      if (!prepared.ok) throw Error(prepared.reason);
      let off: () => void = () => undefined;
      if (invalidate === "allocation") live = { ...original };
      if (invalidate === "close") await c.closeTab(b.documentId);
      if (invalidate === "composition") c.registerEditorInteraction(a.documentId, () => false);
      if (invalidate === "save") saving = true;
      if (invalidate === "during-activation") off = c.subscribe(() => { live = { ...original }; });
      expect(prepared.plan.commit(() => live)).toBe(false);
      expect(original.ids).toEqual([b.documentId]);
      expect(original.heights).toEqual([320]);
      off();
    } finally { c.dispose(); }
  });
}


test("return of an already active secondary skips activation publication", async () => {
  const { controller: c, documents: [, b] } = await threeDocuments();
  try {
    c.activateTab(b.documentId);
    const allocation = { ids: [b.documentId], heights: [320], totalHeight: 320 };
    const before = c.getSnapshot(), editor = c.getEditor(b.documentId);
    const prepared = prepareSecondaryReturn(c, allocation, b.documentId);
    if (!prepared.ok) throw Error(prepared.reason);
    expect(prepared.plan.commit(() => allocation)).toBe(true);
    expect(c.getSnapshot()).toBe(before);
    expect(c.getEditor(b.documentId)).toBe(editor);
  } finally { c.dispose(); }
});

for (const height of [65, 66, 320]) {
  test(`prepared main transfer respects ${height}px capacity and activates the unchanged background draft`, async () => {
    const { controller: c, documents: [a, b, d] } = await threeDocuments();
    try {
      c.activateTab(b.documentId); c.toggleSourceMode();
      const state = c.getEditor(b.documentId)!.state;
      c.updateEditor(b.documentId, state.update({ changes: { from: 0, insert: "draft" }, selection: { anchor: 2, head: 5 } }));
      c.activateTab(a.documentId);
      const allocation: RealRegionAllocation = { ids: [d.documentId], heights: [height], totalHeight: height };
      const before = c.getSnapshot();
      const prepared = prepareMainTransferToSecondary(c, allocation, b.documentId);
      expect(c.getSnapshot()).toBe(before);
      if (height === 65) {
        expect(prepared).toEqual({ ok: false, reason: "full" });
      } else {
        if (!prepared.ok) throw Error(prepared.reason);
        expect(prepared.plan.allocation).toEqual({ ids: [d.documentId, b.documentId], heights: [height / 2, height / 2], totalHeight: height });
        expect(prepared.plan.commit(() => allocation)).toBe(true);
        expect(prepared.plan.commit(() => allocation)).toBe(false);
        expect(c.getSnapshot().snapshot?.documentId).toBe(b.documentId);
        expect(c.getMode(b.documentId)).toBe("source");
        expect(c.getEditor(b.documentId)!.state.selection.main.to).toBe(5);
        expect(c.runHistory("undo", b.documentId)).toBe(true);
        expect(c.getEditor(b.documentId)!.state.field(rawText)).toBe(b.text);
      }
      expect(allocation.heights).toEqual([height]);
    } finally { c.dispose(); }
  });
}

test("prepared main transfer rejects closed region, stale plan and composition without changing ownership", async () => {
  const { controller: c, documents: [a, b, d] } = await threeDocuments();
  try {
    c.activateTab(a.documentId);
    const allocation: RealRegionAllocation = { ids: [d.documentId], heights: [320], totalHeight: 320 };
    expect(prepareMainTransferToSecondary(c, empty(), b.documentId)).toEqual({ ok: false, reason: "closed" });
    expect(prepareMainTransferToSecondary(c, allocation, d.documentId)).toEqual({ ok: false, reason: "invalid" });
    const prepared = prepareMainTransferToSecondary(c, allocation, b.documentId);
    if (!prepared.ok) throw Error(prepared.reason);
    const composition = c.registerEditorInteraction(a.documentId, () => false);
    expect(prepared.plan.commit(() => allocation)).toBe(false);
    expect(c.getSnapshot().snapshot?.documentId).toBe(a.documentId);
    expect(prepareMainTransferToSecondary(c, allocation, b.documentId)).toEqual({ ok: false, reason: "blocked" });
    composition.release();
    const stale = prepareMainTransferToSecondary(c, allocation, b.documentId);
    if (!stale.ok) throw Error(stale.reason);
    c.activateTab(d.documentId);
    expect(stale.plan.commit(() => allocation)).toBe(false);
    expect(allocation.ids).toEqual([d.documentId]);
    await c.closeTab(a.documentId);
    expect(prepareMainTransferToSecondary(c, allocation, b.documentId)).toEqual({ ok: false, reason: "keep-main" });
  } finally { c.dispose(); }
});


test("tree receipts route new documents by captured region and reuse without moving", async () => {
  const { controller: c, documents: [a, b, d] } = await threeDocuments();
  try {
    const receipt = { documentId: d.documentId, handle: d.handle, kind: "opened" as const };
    const allocation = { ids: [b.documentId], heights: [66], totalHeight: 66 };
    expect(routeWorkspaceOpenReceipt(c, receipt, allocation, allocation, "secondary")).toEqual({ allocation: { ids: [b.documentId, d.documentId], heights: [33, 33], totalHeight: 66 }, region: "secondary" });
    expect(routeWorkspaceOpenReceipt(c, { ...receipt, kind: "reused" }, allocation, allocation, "secondary")).toEqual({ allocation, region: "main" });
    const full = { ids: [b.documentId], heights: [65], totalHeight: 65 };
    expect(routeWorkspaceOpenReceipt(c, receipt, full, full, "secondary")).toMatchObject({ allocation: full, region: "main", reason: "full", notice: "空间不足，已在主区域打开" });
    expect(routeWorkspaceOpenReceipt(c, receipt, allocation, { ...allocation }, "secondary")).toBeUndefined();
    c.activateTab(a.documentId);
    expect(routeWorkspaceOpenReceipt(c, receipt, allocation, allocation, "secondary")).toBeUndefined();
    const two = { ids: [b.documentId, d.documentId], heights: [33, 33], totalHeight: 66 };
    const aReceipt = { documentId: a.documentId, handle: a.handle, kind: "opened" as const };
    expect(routeWorkspaceOpenReceipt(c, aReceipt, two, two, "secondary")?.reason).toBe("full");
    const large = { ...two, heights: [160, 160], totalHeight: 320 };
    expect(routeWorkspaceOpenReceipt(c, aReceipt, large, large, "secondary")?.reason).toBe("lab-limit");
  } finally { c.dispose(); }
});
