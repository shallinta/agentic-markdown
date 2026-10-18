import { expect, test } from "bun:test";

import type { CreateFolderRequest, CreateFolderResponse } from "../shared/create-folder";
import type { DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createMarkdownController } from "./create-markdown";
import { createDiscardGuard } from "./discard-guard";
import { canonicalDiscardParticipant } from "./document-canonical";
import { createDocumentController } from "./documents";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture() {
  const original: DocumentSnapshot = { handle: crypto.randomUUID(), documentId: crypto.randomUUID(), fileName: "原文.md", displayPath: "/test/原文.md", text: "original", byteLength: 8, revision: 1, hash: "a".repeat(64), fidelity: analyzeTextFidelity("original"), writeCapability: { writable: true, reason: "writable" } };
  let selected = 0, saves = 0;
  const documents = createDocumentController({
    selectDocument: request => { selected++; return Promise.resolve({ ...request, ok: true, snapshot: original }); },
    readDocument: request => Promise.resolve({ ...request, ok: true, snapshot: original }),
    cancelDocument: () => Promise.resolve(),
    releaseDocument: () => Promise.reject(Error("must not release source")),
    saveDocument: () => { saves++; return Promise.reject(Error("must not save during folder creation")); },
  }, () => Promise.reject(Error("must not discard")));
  await documents.select();
  const editor = documents.getEditor(original.documentId)!;
  documents.updateEditor(original.documentId, editor.state.update({ changes: { from: 8, insert: " dirty" }, selection: { anchor: 2, head: 5 } }));
  const target = { rootHandle: crypto.randomUUID(), generation: 1 }, entry = crypto.randomUUID(), session = crypto.randomUUID();
  let sequence = 1, located = 0, valid = true;
  let refresh: () => Promise<unknown> = () => Promise.resolve();
  let intercept: ((request: CreateFolderRequest) => Promise<unknown> | undefined) | undefined;
  const calls: CreateFolderRequest[] = [];
  const response = (request: Extract<CreateFolderRequest, { session: string }>, status: "created" | "pending" | "unknown" = "created", working = false): CreateFolderResponse => ({ protocolVersion: 1, requestId: request.requestId, operation: { session: request.session, sequence: request.sequence }, status, working, ...(status === "created" ? { entryHandle: entry, name: "中文目录" } : {}) });
  const controller = createMarkdownController({
    mode: "folder", documents, delay: 0, targetCurrent: () => true,
    directoryCurrent: (_target, handle) => valid && handle === entry,
    locate: () => { located++; }, refresh: () => refresh(),
    request: async request => {
      calls.push(request);
      const custom = intercept?.(request);
      if (custom) return custom;
      const base = { protocolVersion: 1 as const, requestId: request.requestId };
      if (request.op === "state") return { ...base, status: "state", session, sequence };
      if (request.op === "preview") return { ...base, status: "preview", previewId: request.previewId, result: "available", name: request.name };
      if (request.op === "cancel-preview") return { ...base, status: "cancelled-preview", previewId: request.previewId };
      if (request.op === "ack") { sequence++; return { ...base, operation: { session: request.session, sequence: request.sequence }, status: "acked", working: false }; }
      return response(request);
    },
  });
  const ready = async () => { controller.open(target); controller.setName("中文目录"); await Bun.sleep(10); expect(controller.getSnapshot().preview).toBe("available"); };
  return { controller, documents, original, target, calls, response, ready, located: () => located, selected: () => selected, saves: () => saves, intercept: (fn: typeof intercept) => { intercept = fn; }, refresh: (fn: typeof refresh) => { refresh = fn; }, valid: (value: boolean) => { valid = value; } };
}

test("folder mode does not append an extension, grant or open a document; dirty selection and undo survive", async () => {
  const f = await fixture();
  const before = f.documents.getEditor(f.original.documentId)!;
  await f.ready(); await f.controller.create();
  expect(f.controller.getSnapshot().mode).toBe("folder");
  expect(f.calls.find(request => request.op === "create")).toMatchObject({ name: "中文目录" });
  expect(f.calls.every(request => !["source", "snapshot", "suggest"].some(key => key in request))).toBe(true);
  expect(f.documents.getSnapshot().tabs).toEqual([f.original]);
  expect(f.documents.getSnapshot().snapshot?.handle).toBe(f.original.handle);
  const after = f.documents.getEditor(f.original.documentId)!;
  expect(after.state.doc.toString()).toBe(before.state.doc.toString());
  expect(after.state.selection.toJSON()).toEqual(before.state.selection.toJSON());
  expect(after.revision).toBe(before.revision);
  expect(f.documents.isDirty(f.original.documentId)).toBe(true);
  expect(f.located()).toBe(1); expect(f.selected()).toBe(1);
  expect(f.controller.hasPending()).toBe(false);
  expect(f.documents.runHistory("undo")).toBe(true);
  expect(f.documents.getEditor(f.original.documentId)?.state.doc.toString()).toBe("original");
});

test("folder owner freezes actual edit/history and close while pending; closing dialog cannot cancel disk result", async () => {
  const f = await fixture(), held = deferred<unknown>();
  f.intercept(request => request.op === "create" ? held.promise : undefined);
  await f.ready(); expect(f.documents.canSave()).toBe(true);
  const pending = f.controller.create(); await Bun.sleep(0);
  expect(f.documents.getSnapshot().frozen).toBe(true);
  const editor = f.documents.getEditor(f.original.documentId)!;
  expect(f.documents.updateEditor(f.original.documentId, editor.state.update({ changes: { from: 0, insert: "blocked" } }))).toBe(false);
  expect(f.documents.runHistory("undo")).toBe(false);
  expect(f.documents.canSave()).toBe(false); await f.documents.save(); expect(f.saves()).toBe(0);
  await f.documents.closeActive();
  expect(f.documents.getSnapshot().tabs).toHaveLength(1);
  await f.controller.close();
  const request = f.calls.find(request => request.op === "create")!;
  if (request.op !== "create") throw Error();
  held.resolve(f.response(request)); await pending;
  expect(f.documents.getSnapshot().frozen).toBe(false);
  expect(f.located()).toBe(0); expect(f.controller.hasPending()).toBe(false);
  expect(f.documents.isDirty(f.original.documentId)).toBe(true);
});

test("folder transport pending remains recoverable; terminal unknown unlocks but cannot recreate", async () => {
  const f = await fixture(); let terminal = false;
  f.intercept(request => request.op === "create" ? Promise.reject(Error("lost")) : request.op === "query" ? Promise.resolve(f.response(request, terminal ? "unknown" : "pending", !terminal)) : undefined);
  await f.ready(); await f.controller.create(); await f.controller.close();
  expect(f.documents.getSnapshot().frozen).toBe(true);
  expect(f.controller.canOpen()).toBe(true);
  f.controller.open(f.target); terminal = true; await f.controller.query();
  expect(f.documents.getSnapshot().frozen).toBe(false);
  expect(f.controller.hasPending()).toBe(true);
  expect(f.controller.getSnapshot().message).toContain("未知");
  await f.controller.create();
  expect(f.calls.filter(request => request.op === "create")).toHaveLength(1);
  expect(f.located()).toBe(0);
});

test("folder late refresh cannot select after dialog closes; retry locates only a current directory", async () => {
  const f = await fixture(), held = deferred<void>();
  f.refresh(() => held.promise);
  await f.ready(); const pending = f.controller.create(); await Bun.sleep(0);
  await f.controller.close(); held.resolve(); await pending;
  expect(f.located()).toBe(0);
  f.refresh(() => Promise.resolve()); f.valid(false); f.controller.open(f.target);
  await f.controller.retry(); expect(f.located()).toBe(0); expect(f.controller.hasPending()).toBe(true);
  f.valid(true); await f.controller.retry(); expect(f.located()).toBe(1); expect(f.controller.hasPending()).toBe(false);
  expect(f.calls.filter(request => request.op === "create")).toHaveLength(1);
  expect(f.calls.filter(request => request.op === "retry-locate")).toHaveLength(2);
});

test("folder window exit asks about existing dirty content and cancelling never revives late locate", async () => {
  const f = await fixture(), held = deferred<unknown>();
  f.intercept(request => request.op === "create" ? held.promise : undefined);
  await f.ready(); const pending = f.controller.create(); await Bun.sleep(0);
  const guard = createDiscardGuard(); guard.register(canonicalDiscardParticipant(f.documents, { cancel: () => undefined }));
  const exiting = guard.request({ protocolVersion: 1, requestId: crypto.randomUUID(), reason: "quit" });
  await Bun.sleep(0); expect(guard.getSnapshot()?.message).toContain("未保存"); guard.respond(false);
  expect((await exiting).allow).toBe(false); expect(f.documents.getSnapshot().frozen).toBe(true);
  const request = f.calls.find(request => request.op === "create")!; if (request.op !== "create") throw Error();
  held.resolve(f.response(request)); await pending;
  expect(f.located()).toBe(0); expect(f.documents.getSnapshot().frozen).toBe(false);
  expect(f.documents.isDirty(f.original.documentId)).toBe(true);
});

test("folder protocol refuses snapshots and does not unfreeze on an untrusted response", async () => {
  const f = await fixture();
  f.intercept(request => request.op === "create" ? Promise.resolve({ ...f.response(request), snapshot: f.original }) : undefined);
  await f.ready(); await f.controller.create();
  expect(f.documents.getSnapshot().frozen).toBe(true); expect(f.controller.hasPending()).toBe(true);
  expect(f.located()).toBe(0); await f.controller.query();
  expect(f.documents.getSnapshot().frozen).toBe(false); expect(f.located()).toBe(1);
});

test("folder gate is owner-specific; active exit stays frozen after operation completion", async () => {
  const f = await fixture();
  const first = f.documents.acquireCreationGate()!;
  f.documents.releaseCreationGate("not-owner"); expect(f.documents.getSnapshot().frozen).toBe(true);
  f.documents.releaseCreationGate(first);
  const second = f.documents.acquireCreationGate()!;
  f.documents.releaseCreationGate(first); expect(f.documents.getSnapshot().frozen).toBe(true);
  expect(f.documents.beginWindowDiscard()).toBe(true);
  f.documents.releaseCreationGate(second); expect(f.documents.getSnapshot().frozen).toBe(true);
  f.documents.endDiscard(); expect(f.documents.getSnapshot().frozen).toBe(false);
});

test("folder IME guard blocks initiation, and closing before state response never submits", async () => {
  const f = await fixture(); await f.ready();
  const release = f.documents.setInteractionCheck(() => false);
  await f.controller.create(); expect(f.calls.some(request => request.op === "state")).toBe(false);
  release();
  const held = deferred<unknown>(); f.intercept(request => request.op === "state" ? held.promise : undefined);
  const pending = f.controller.create(); await f.controller.close();
  const request = f.calls.find(request => request.op === "state")!;
  held.resolve({ protocolVersion: 1, requestId: request.requestId, status: "state", session: crypto.randomUUID(), sequence: 1 }); await pending;
  expect(f.calls.some(request => request.op === "create")).toBe(false);
  expect(f.controller.hasPending()).toBe(false); expect(f.documents.getSnapshot().frozen).toBe(false);
  expect(f.documents.isDirty(f.original.documentId)).toBe(true);
});
