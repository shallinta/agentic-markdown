import { expect, spyOn, test } from "bun:test";

import { analyzeTextFidelity } from "../shared/text-fidelity";
import type { TrashRequest, TrashResponse } from "../shared/trash-document";

import { createDocumentController } from "./documents";
import { rawText } from "./raw-buffer";
import { createTrashDocument, type TrashChoice, type TrashDialog } from "./trash-document";
import { createFolderWorkspace } from "./workspace";

async function fixture(confirm: (value: TrashDialog) => Promise<TrashChoice>, outcome: "trashed" | "failed" | "unknown" = "trashed", override?: (request: TrashRequest, response: TrashResponse) => Promise<TrashResponse>) {
  const snapshot = { handle: crypto.randomUUID(), documentId: crypto.randomUUID(), fileName: "原文.md", displayPath: "/test/原文.md", text: "原文", byteLength: 6, hash: "a".repeat(64), revision: 1, fidelity: analyzeTextFidelity("原文"), writeCapability: { writable: true, reason: "writable" as const } };
  let saves = 0;
  const documents = createDocumentController({ selectDocument: request => Promise.resolve({ ...request, ok: true, snapshot }), readDocument: request => Promise.resolve({ ...request, ok: true, snapshot }), releaseDocument: request => Promise.resolve({ ...request, ok: true, snapshot: null }), cancelDocument: () => Promise.resolve(), saveDocument: () => { saves++; return Promise.reject(Error("unexpected-save")); } });
  await documents.select();
  const folders = createFolderWorkspace(request => Promise.resolve({ ...request, ok: true, roots: [], coveredHandles: [], cacheBytes: 0 }));
  await folders.refresh();
  const session = crypto.randomUUID(), confirmationToken = crypto.randomUUID(), calls: TrashRequest[] = [];
  let commitCount = 0;
  const transport = (request: TrashRequest): Promise<TrashResponse> => {
    calls.push(request);
    const base = { protocolVersion: 1 as const, requestId: request.requestId, session, sequence: 1 };
    if (request.op === "state") return Promise.resolve({ ...base, status: "state" });
    if (request.op === "prepare") return Promise.resolve({ ...base, status: "prepared", working: false, confirmationToken, canonicalPath: snapshot.displayPath, selectedPath: snapshot.displayPath, affected: [{ handle: snapshot.handle, documentId: snapshot.documentId, fileName: snapshot.fileName }] });
    if (request.op === "ack" || request.op === "cancel") return Promise.resolve({ ...base, status: "acked", working: false });
    if (request.op === "commit") commitCount++;
    return Promise.resolve(outcome === "trashed" ? { ...base, status: "trashed", working: false, publication: { documents: [{ handle: snapshot.handle, documentId: snapshot.documentId }], files: [] } } : { ...base, status: outcome, working: false });
  };
  const wrapped = async (request: TrashRequest) => { const response = await transport(request); return override ? override(request, response) : response; };
  const trash = createTrashDocument(documents, folders, wrapped, confirm);
  const target = { kind: "standalone" as const, handle: snapshot.handle, documentId: snapshot.documentId };
  const edit = () => { const editor = documents.getEditor(snapshot.documentId)!; return documents.updateEditor(snapshot.documentId, editor.state.update({ changes: { from: 0, insert: "x" } })); };
  return { snapshot, documents, folders, trash, target, edit, calls, saves: () => saves, commits: () => commitCount, dispose() { trash.dispose(); folders.dispose(); documents.dispose(); } };
}

test("trash clean requires explicit disk confirmation and swaps both stores before notifying", async () => {
  const stages: string[] = [];
  const f = await fixture(value => { stages.push(value.stage); return Promise.resolve("discard"); });
  const observed: number[] = [];
  const off = f.documents.subscribe(() => { if (!f.documents.getSnapshot().tabs.length) observed.push(Number(f.folders.getSnapshot().busy)); });
  try {
    await f.trash.start(f.target);
    expect(stages).toEqual(["disk"]); expect(f.commits()).toBe(1);
    expect(f.documents.getSnapshot().tabs).toHaveLength(0);
    expect(f.documents.getEditor(f.snapshot.documentId)).toBeUndefined();
    expect(observed.every(value => value === 0)).toBe(true);
    expect(f.trash.getSnapshot().pending).toBe(false);
  } finally { off(); f.dispose(); }
});

test("known failed or applied success never regresses after ack transport failure", async () => {
  for (const outcome of ["failed", "trashed"] as const) {
    let failAck = true;
    const f = await fixture(() => Promise.resolve("discard"), outcome, (request, response) => {
      if (request.op === "ack" && failAck) return Promise.reject(Error("lost-ack"));
      return Promise.resolve(response);
    });
    try {
      f.edit(); await f.trash.start(f.target);
      expect(f.trash.getSnapshot().working).toBe(false);
      expect(f.trash.getSnapshot().message).toContain(outcome === "failed" ? "未移入" : "已移入");
      expect(f.documents.getSnapshot().frozen).toBe(false);
      expect(f.documents.getSnapshot().tabs.length).toBe(outcome === "failed" ? 1 : 0);
      if (outcome === "failed") expect(f.documents.canSave()).toBe(true);
      failAck = false; await f.trash.retry(); expect(f.commits()).toBe(1);
      expect(f.trash.getSnapshot().pending).toBe(false);
    } finally { f.dispose(); }
  }
});

test("lost commit followed by prepared query never asks again or repeats commit", async () => {
  let prepared: TrashResponse | undefined, confirmations = 0;
  const f = await fixture(() => { confirmations++; return Promise.resolve("discard"); }, "trashed", (request, response) => {
    if (request.op === "prepare") prepared = response;
    if (request.op === "commit") return Promise.reject(Error("lost-commit"));
    if (request.op === "query" && prepared) return Promise.resolve({ ...prepared, requestId: request.requestId });
    return Promise.resolve(response);
  });
  try {
    await f.trash.start(f.target); await f.trash.retry(); await f.trash.retry();
    expect(f.commits()).toBe(1); expect(confirmations).toBe(1);
    expect(f.documents.getSnapshot().tabs).toHaveLength(1);
    expect(f.documents.getSnapshot().frozen).toBe(false);
  } finally { f.dispose(); }
});

test("late successful receipt after quit protection never discards original dirty memory", async () => {
  const waiting = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  const f = await fixture(() => Promise.resolve("discard"), "trashed", async (request, response) => {
    if (request.op === "commit") { waiting.resolve(); await finish.promise; }
    return response;
  });
  try {
    f.edit(); const before = f.documents.getEditor(f.snapshot.documentId);
    const pending = f.trash.start(f.target); await waiting.promise;
    f.trash.beforeWindowDiscard(); expect(f.documents.beginWindowDiscard()).toBe(true);
    f.documents.endDiscard(); finish.resolve(); await pending;
    expect(f.documents.getEditor(f.snapshot.documentId)).toBe(before);
    expect(f.documents.hasDirty()).toBe(true); expect(f.trash.getSnapshot().message).toContain("系统已完成");
    await f.trash.retry(); expect(f.commits()).toBe(1);
    expect(f.documents.getEditor(f.snapshot.documentId)).toBe(before);
  } finally { finish.resolve(); f.dispose(); }
});

test("reload recovery only queries existing unknown operation and does not freeze another owner", async () => {
  let confirmations = 0;
  const f = await fixture(() => { confirmations++; return Promise.resolve("discard"); }, "unknown");
  try {
    expect(f.folders.beginFolderRemoval()).toBe(true);
    await f.trash.recover(); await f.trash.retry();
    expect(f.calls.map(call => call.op)).toEqual(["state", "query", "query"]);
    expect(confirmations).toBe(0); expect(f.commits()).toBe(0);
    expect(f.folders.getSnapshot().busy).toBe(true);
    expect(f.documents.getSnapshot().frozen).toBe(false);
  } finally { f.folders.cancelFolderRemoval(); f.dispose(); }
});

test("workspace preparation failure preserves both stores and retries only local acceptance", async () => {
  const f = await fixture(() => Promise.resolve("discard"));
  const prepare = spyOn(f.folders, "prepareTrashedDocument").mockImplementationOnce(() => { throw Error("injected-preparation"); });
  try {
    f.edit(); const before = f.documents.getEditor(f.snapshot.documentId);
    await f.trash.start(f.target);
    expect(f.documents.getEditor(f.snapshot.documentId)).toBe(before);
    expect(f.documents.getSnapshot().tabs).toHaveLength(1);
    expect(f.trash.getSnapshot().working).toBe(false);
    expect(f.trash.getSnapshot().message).toContain("系统已完成");
    expect(f.documents.getSnapshot().frozen).toBe(false);
    await f.trash.retry(); expect(f.commits()).toBe(1);
    expect(f.documents.getSnapshot().tabs).toHaveLength(0);
  } finally { prepare.mockRestore(); f.dispose(); }
});

test("new memory changes after unfreezing a successful pending acceptance are never discarded", async () => {
  const f = await fixture(() => Promise.resolve("discard"));
  const prepare = spyOn(f.folders, "prepareTrashedDocument").mockImplementationOnce(() => { throw Error("injected-preparation"); });
  try {
    await f.trash.start(f.target); expect(f.edit()).toBe(true);
    const before = f.documents.getEditor(f.snapshot.documentId);
    await f.trash.retry(); expect(f.commits()).toBe(1);
    expect(f.documents.getEditor(f.snapshot.documentId)).toBe(before);
    expect(before?.state.field(rawText)).toBe("x原文");
    expect(f.documents.getSnapshot().frozen).toBe(false);
  } finally { prepare.mockRestore(); f.dispose(); }
});

test("a changed confirmation owner after await sends cancel instead of disk commit", async () => {
  const choice = Promise.withResolvers<TrashChoice>(), entered = Promise.withResolvers<void>();
  const f = await fixture(() => { entered.resolve(); return choice.promise; });
  try {
    const pending = f.trash.start(f.target); await entered.promise;
    f.trash.beforeWindowDiscard(); expect(f.documents.beginWindowDiscard()).toBe(true);
    f.documents.endDiscard(); expect(f.edit()).toBe(true);
    choice.resolve("discard"); await pending;
    expect(f.commits()).toBe(0); expect(f.calls.some(call => call.op === "cancel")).toBe(true);
    expect(f.documents.getEditor(f.snapshot.documentId)?.state.field(rawText)).toBe("x原文");
  } finally { choice.resolve("cancel"); f.dispose(); }
});

test("root publication deletes only matching old entries and advances its generation", () => {
  const folders = createFolderWorkspace(request => Promise.resolve({ ...request, ok: true, roots: [], coveredHandles: [], cacheBytes: 0 }));
  const root = crypto.randomUUID(), entry = crypto.randomUUID(), other = crypto.randomUUID();
  try {
    const state = folders.getSnapshot();
    // This is the public two-store acceptance seam, using the actual tree shape.
    folders.swapPrepared({ epoch: 0, next: { ...state, roots: [{ handle: root, displayPath: "/root", name: "root", generation: 1, status: "complete", examined: 2, errors: 0, entries: 2 }], nodes: { [root]: [{ handle: entry, parent: root, name: "一.md", displayPath: "/root/一.md", kind: "file" }, { handle: other, parent: root, name: "二.md", displayPath: "/root/二.md", kind: "file" }] } } });
    const before = folders.getSnapshot(), base = 2 * JSON.stringify(before).length + 128;
    expect(folders.setMRUCost(4 * 1024 * 1024 - base - 256)).toBe(true);
    expect(folders.beginFolderRemoval()).toBe(true);
    const publication = { documents: [], files: [{ root, previousGeneration: 1, generation: 2, entries: [entry] }] };
    expect(() => folders.prepareTrashedDocument(publication)).toThrow("trash-publication-budget");
    expect(folders.getSnapshot().nodes).toBe(before.nodes);
    expect(folders.getSnapshot().roots).toBe(before.roots);
    expect(folders.setMRUCost(0)).toBe(true);
    const prepared = folders.prepareTrashedDocument(publication);
    expect(folders.getSnapshot().nodes[root]).toHaveLength(2);
    folders.swapPrepared(prepared);
    expect(folders.getSnapshot().roots[0]?.generation).toBe(2);
    expect(folders.getSnapshot().nodes[root]?.map(node => node.handle)).toEqual([other]);
    expect(() => folders.prepareTrashedDocument(publication)).toThrow("trash-workspace-binding");
  } finally { folders.dispose(); }
});

test("unknown followed by authoritative failure restores save eligibility", async () => {
  let queried = false;
  const f = await fixture(() => Promise.resolve("discard"), "unknown", (request, response) => {
    if (request.op === "query") { queried = true; return Promise.resolve({ protocolVersion: 1, requestId: request.requestId, session: request.session, sequence: request.sequence, status: "failed", working: false }); }
    return Promise.resolve(response);
  });
  try {
    f.edit(); await f.trash.start(f.target); expect(f.documents.canSave()).toBe(false);
    await f.trash.retry(); expect(queried).toBe(true); expect(f.documents.canSave()).toBe(true);
    expect(f.commits()).toBe(1); expect(f.documents.hasDirty()).toBe(true);
  } finally { f.dispose(); }
});

test("dispose and immediate reattach cannot revive old response and perform fresh read-only recovery", async () => {
  const entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>(), recovered = Promise.withResolvers<void>();
  let first = true;
  const f = await fixture(() => Promise.resolve("discard"), "unknown", async (request, response) => {
    if (request.op === "state" && first) { first = false; entered.resolve(); await finish.promise; }
    if (request.op === "query") recovered.resolve();
    return response;
  });
  try {
    f.trash.attach(); await entered.promise;
    f.trash.dispose(); f.trash.attach(); finish.resolve(); await recovered.promise;
    await Promise.resolve(); await Promise.resolve();
    expect(f.calls.map(call => call.op)).toEqual(["state", "state", "query"]);
    expect(f.commits()).toBe(0); expect(f.documents.getSnapshot().tabs).toHaveLength(1);
  } finally { finish.resolve(); f.dispose(); }
});

test("first dirty confirmation already freezes edits, cancellation preserves exact state and sends no commit", async () => {
  const choice = Promise.withResolvers<TrashChoice>(), entered = Promise.withResolvers<void>();
  const f = await fixture(value => { expect(value.stage).toBe("dirty"); entered.resolve(); return choice.promise; });
  try {
    f.edit(); const before = f.documents.getEditor(f.snapshot.documentId)!;
    const pending = f.trash.start(f.target); await entered.promise;
    expect(f.edit()).toBe(false); expect(f.documents.getSnapshot().frozen).toBe(true);
    choice.resolve("cancel"); await pending;
    expect(f.commits()).toBe(0); expect(f.documents.getEditor(f.snapshot.documentId)).toBe(before);
    expect(f.documents.hasDirty()).toBe(true); expect(f.documents.getSnapshot().frozen).toBe(false);
  } finally { choice.resolve("cancel"); f.dispose(); }
});

test("failed system operation retains dirty buffer/history while unknown remains single-shot and permits normal exit", async () => {
  for (const outcome of ["failed", "unknown"] as const) {
    const f = await fixture(() => Promise.resolve("discard"), outcome);
    try {
      f.edit(); const before = f.documents.getEditor(f.snapshot.documentId)!;
      await f.trash.start(f.target);
      expect(f.documents.getEditor(f.snapshot.documentId)).toBe(before);
      expect(before.state.field(rawText)).toBe("x原文"); expect(f.documents.hasDirty()).toBe(true);
      expect(f.documents.getSnapshot().frozen).toBe(false);
      if (outcome === "unknown") {
        expect(f.documents.canSave()).toBe(false); await f.documents.save(); expect(f.saves()).toBe(0);
        await f.trash.retry(); expect(f.commits()).toBe(1); expect(f.trash.canStart(f.target)).toBe(false);
        f.trash.beforeWindowDiscard(); expect(f.documents.beginWindowDiscard()).toBe(true);
        f.documents.endDiscard(); expect(f.documents.getEditor(f.snapshot.documentId)).toBe(before);
      }
    } finally { f.dispose(); }
  }
});

test("save-first ends the entire confirmation without saving or entering disk confirmation", async () => {
  const stages: string[] = [];
  const f = await fixture(value => { stages.push(value.stage); return Promise.resolve("save-first"); });
  try { f.edit(); await f.trash.start(f.target); expect(stages).toEqual(["dirty"]); expect(f.commits()).toBe(0); expect(f.documents.hasDirty()).toBe(true); expect(f.documents.getSnapshot().frozen).toBe(false); }
  finally { f.dispose(); }
});
