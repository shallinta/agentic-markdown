import { expect, spyOn, test } from "bun:test";

import type { MRURecordRequest, MRUResolved } from "../shared/document-mru";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDocumentMRU, type MRUTransport } from "./document-mru";
import { createDocumentController } from "./documents";
import { createQuickOpen } from "./quick-open";
import { createFolderWorkspace } from "./workspace";

async function fixture(overrides: Partial<MRUTransport> = {}, count = 0) {
  const session = crypto.randomUUID();
  const a = { handle: crypto.randomUUID(), documentId: crypto.randomUUID(), fileName: "同名.md", displayPath: "/a/同名.md", text: "原文", byteLength: 6, hash: "a".repeat(64), revision: 1, fidelity: analyzeTextFidelity("原文"), writeCapability: { writable: true, reason: "writable" as const } };
  const b = { ...a, handle: crypto.randomUUID(), documentId: crypto.randomUUID(), displayPath: "/b/同名.md" };
  let selected = a;
  const documents = createDocumentController({ selectDocument: r => Promise.resolve({ ...r, ok: true, snapshot: selected }), readDocument: r => Promise.resolve({ ...r, ok: true, snapshot: r.handle === a.handle ? a : b }), cancelDocument: () => Promise.resolve(), releaseDocument: r => Promise.resolve({ ...r, ok: true, snapshot: null }) });
  const root = { handle: crypto.randomUUID(), name: "根", displayPath: "/root", generation: 1, status: "complete" as const, examined: count, errors: 0, entries: count };
  const nodes = Array.from({ length: count }, (_, index) => ({ handle: crypto.randomUUID(), name: `file${index}.md`, displayPath: `/root/file${index}.md`, parent: root.handle, kind: "file" as const }));
  const folders = createFolderWorkspace(r => Promise.resolve({ protocolVersion: 1, requestId: r.requestId, ok: true, roots: count ? [root] : [], coveredHandles: [], cacheBytes: 0, ...(r.op === "page" ? { root: root.handle, generation: 1, nodes: nodes.slice(r.cursor, (r.cursor ?? 0) + 128), nextCursor: Math.min(count, (r.cursor ?? 0) + 128) } : {}) }));
  await folders.refresh();
  const records: MRURecordRequest[] = [];
  const warnings: string[] = [];
  let items: MRUResolved[] = [], revision = 0;
  const mru = createDocumentMRU({
    begin: r => Promise.resolve({ ...r, available: true, session, sequence: 0, revision }),
    record: r => { records.push(r); revision++; items = [{ kind: "standalone", documentId: r.documentId, handle: r.handle, rank: revision }, ...items.filter(i => i.documentId !== r.documentId)]; return Promise.resolve({ protocolVersion: r.protocolVersion, requestId: r.requestId, session: r.session, sequence: r.sequence, status: "persisted", revision }); },
    resolve: r => Promise.resolve({ ...r, revision, items, incomplete: false }),
    ...overrides,
  }, documents, folders, message => { warnings.push(message); });
  mru.attach();
  const quick = createQuickOpen(folders, documents, undefined, mru);
  return { a, b, documents, folders, mru, quick, records, warnings, async select(value: typeof a) { selected = value; await documents.select(); }, dispose() { quick.dispose(); mru.dispose(); folders.dispose(); documents.dispose(); } };
}
async function settle() { await Bun.sleep(15); }

test("actual accepted activation records ordered MRU, reload and automatic close successor do not", async () => {
  const f = await fixture();
  try {
    await f.select(f.a); await f.select(f.b); f.documents.activateTab(f.a.documentId);
    await f.mru.flush(2000); await settle();
    expect(f.records.map(r => r.documentId)).toEqual([f.a.documentId, f.b.documentId, f.a.documentId]);
    await f.documents.reload(); await f.documents.closeActive(); await f.mru.flush(2000);
    expect(f.records).toHaveLength(3);
    f.quick.open(); await settle();
    expect(f.quick.getSnapshot().results.map(r => r.path)).toEqual([f.a.displayPath, f.b.displayPath]);
    expect(f.warnings).toEqual([]);
    f.quick.setQuery("同名"); await settle();
    expect(f.quick.getSnapshot().results.map(r => r.path)).toEqual([f.a.displayPath, f.b.displayPath]);
  } finally { f.dispose(); }
});

test("bootstrap pending preserves captured events and fixed frontier flush does not wait forever", async () => {
  const bootstrap = Promise.withResolvers<unknown>();
  let requestId = "";
  const f = await fixture({ begin: r => { requestId = r.requestId; return bootstrap.promise; } });
  try {
    await f.select(f.a); await f.select(f.b);
    const before = f.documents.getSnapshot();
    await f.mru.flush(1);
    expect(f.records).toHaveLength(0);
    bootstrap.resolve({ protocolVersion: 1, requestId, available: true, session: crypto.randomUUID(), sequence: 5, revision: 0 });
    await f.mru.flush(2000);
    expect(f.records.map(r => r.sequence)).toEqual([6, 7]);
    expect(f.documents.getSnapshot()).toBe(before);
  } finally { f.dispose(); }
});

test("late resolved metadata after removal cannot republish old authorized items", async () => {
  const delayed = Promise.withResolvers<unknown>();
  let captured: Parameters<MRUTransport["resolve"]>[0] | undefined;
  const f = await fixture({ resolve: r => { captured = r; return delayed.promise; } });
  try {
    await f.select(f.a); await f.mru.flush(2000); await settle();
    expect(captured).toBeDefined();
    f.mru.dispose();
    delayed.resolve({ ...captured!, revision: 1, items: [{ kind: "standalone", documentId: f.a.documentId, handle: f.a.handle, rank: 1 }], incomplete: false });
    await settle();
    expect(f.mru.getSnapshot().items).toHaveLength(0);
  } finally { f.dispose(); }
});

test("MRU retained response costs participate in query and probe budget", async () => {
  const f = await fixture();
  try {
    expect(f.folders.setMRUCost(4 * 1024 * 1024)).toBe(false);
    expect(f.folders.setMRUCost(1024 * 1024)).toBe(true);
    const lease = f.folders.acquireQueryBudget(() => undefined)!;
    expect(lease.reserve(3 * 1024 * 1024)).toBe(false);
    expect(lease.reserve(2 * 1024 * 1024)).toBe(true);
    expect(f.folders.setMRUCost(2 * 1024 * 1024)).toBe(false);
    expect(lease.current()).toBe(true);
    lease.release();
    expect(f.folders.setMRUCost(0)).toBe(true);
  } finally { f.dispose(); }
});

test("failed initial bootstrap retries on explicit open without a background retry loop", async () => {
  let calls = 0;
  const f = await fixture({ begin: r => { calls++; return Promise.resolve({ ...r, available: calls > 1, session: calls > 1 ? crypto.randomUUID() : "", sequence: 0, revision: 0 }); } });
  try {
    await settle(); expect(calls).toBe(1);
    await f.folders.refresh(); await settle(); expect(calls).toBe(1);
    f.quick.open(); await settle(); expect(calls).toBe(2);
  } finally { f.dispose(); }
});

test("folder removal preparation accounts retained MRU and its shallow publication", async () => {
  const f = await fixture({}, 1);
  try {
    f.mru.dispose();
    const before = f.folders.getSnapshot();
    const base = 2 * JSON.stringify(before).length + 128;
    expect(f.folders.setMRUCost(4 * 1024 * 1024 - base - 256)).toBe(true);
    expect(f.folders.beginFolderRemoval()).toBe(true);
    const result = { root: before.roots[0].handle, roots: [], closed: [], revoked: [], standalone: [], coveredHandles: [], assetEpochs: {}, cacheBytes: 0, queueBytes: 0 };
    expect(() => f.folders.prepareFolderRemoval(result)).toThrow("folder-removal-budget");
    expect(f.folders.getSnapshot().roots).toHaveLength(1);
    expect(f.folders.setMRUCost(0)).toBe(true);
    expect(f.folders.prepareFolderRemoval(result).next.roots).toHaveLength(0);
  } finally { f.folders.cancelFolderRemoval(); f.dispose(); }
});

test("typing and input gate notifications do not trigger descriptor resolution", async () => {
  let resolves = 0;
  const f = await fixture({ resolve: r => { resolves++; return Promise.resolve({ ...r, revision: 100, items: [], incomplete: false }); } });
  try {
    await f.select(f.a); await f.mru.flush(2000); await settle(); resolves = 0;
    for (let i = 0; i < 40; i++) {
      const editor = f.documents.getEditor(f.a.documentId)!;
      f.documents.updateEditor(f.a.documentId, editor.state.update({ changes: { from: 0, insert: "x" } }));
    }
    f.documents.setEditorInputBlocked(true); f.documents.setEditorInputBlocked(false);
    await settle(); expect(resolves).toBe(0);
  } finally { f.dispose(); }
});

test("empty MRU query walks existing metadata in batches without charging every unrelated file", async () => {
  const f = await fixture({}, 1024);
  const acquire = f.folders.acquireQueryBudget.bind(f.folders);
  let peak = 0;
  const spy = spyOn(f.folders, "acquireQueryBudget").mockImplementation(cancel => {
    const lease = acquire(cancel);
    return lease && { ...lease, reserve: bytes => { peak = Math.max(peak, bytes); return lease.reserve(bytes); } };
  });
  try {
    await f.select(f.a); await f.mru.flush(2000); await settle();
    f.quick.open(); await Bun.sleep(60);
    expect(f.quick.getSnapshot().results.map(item => item.path)).toEqual([f.a.displayPath]);
    expect(peak).toBeLessThan(280000);
  } finally { spy.mockRestore(); f.dispose(); }
});
