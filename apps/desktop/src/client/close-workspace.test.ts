import { expect, test } from "bun:test";

import { isolateHistory } from "@codemirror/commands";

import { createDiscardCoordinator } from "../bun/app/discard-coordinator";
import { createLifecycleGuard } from "../bun/app/lifecycle-guard";
import type { BeforeQuitEvent } from "../bun/app/shutdown-coordinator";
import type {
  DocumentSnapshot,
  SaveDocumentRequest,
} from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDiscardGuard } from "./discard-guard";
import { createDocumentController, type DocumentTransport } from "./documents";
import { rawText } from "./raw-buffer";
import { savedReply, waitCaptured } from "./save-test-helper";

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function workspace() {
  const make = (fileName: string, text: string): DocumentSnapshot => ({
    fileName,
    text,
    handle: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    revision: 1,
    hash: "a".repeat(64),
    byteLength: new TextEncoder().encode(text).length,
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: true, reason: "writable" },
  });
  const a = make("甲.md", "\uFEFF甲\r\n保真\n"),
    b = make("乙.md", "乙\n");
  let selected = a,
    writes = 0,
    quits = 0,
    flushes = 0,
    prompts = 0;
  const guard = createDiscardGuard();
  const saved = (req: SaveDocumentRequest) =>
    savedReply(req, req.documentId === a.documentId ? a : b);
  const transport: DocumentTransport = {
    selectDocument: (req) =>
      Promise.resolve({ ...req, ok: true, snapshot: selected }),
    readDocument: (req) =>
      Promise.resolve({ ...req, ok: true, snapshot: selected }),
    cancelDocument: () => Promise.resolve(),
    releaseDocument: () => Promise.resolve(),
    waitForDocumentSaves: (req) => Promise.resolve({ ...req, settled: true }),
    saveDocument: (req) => {
      writes++;
      return Promise.resolve(saved(req));
    },
  };
  const controller = createDocumentController(transport, guard.ask);
  guard.register(controller);
  guard.subscribe(() => {
    if (guard.getSnapshot()) prompts++;
  });
  await controller.select();
  selected = b;
  await controller.select();
  const coordinator = createDiscardCoordinator({
    prepare: (request) => guard.request(request),
    release: guard.release,
  });
  const operations: Promise<boolean>[] = [];
  const lifecycle = createLifecycleGuard({
    guard: (reason, execute) => {
      const operation = coordinator(reason, execute);
      operations.push(operation);
      return operation;
    },
    stop: () => {
      flushes++;
      return Promise.resolve();
    },
    quit: () => {
      const event: BeforeQuitEvent = {};
      lifecycle.beforeQuit(event);
      if (event.response?.allow === false) return false;
      quits++;
      return true;
    },
    reload: () => Promise.resolve(false),
    update: () => Promise.resolve(false),
    beforeUpdate: () => Promise.resolve(),
  });
  const edit = (doc: DocumentSnapshot, text = "修改") => {
    const state = controller.getEditor(doc.documentId)!.state;
    return controller.updateEditor(
      doc.documentId,
      state.update({
        changes: { from: state.doc.length, insert: text },
        annotations: isolateHistory.of("full"),
      })
    );
  };
  return {
    a,
    b,
    controller,
    guard,
    lifecycle,
    transport,
    operations,
    edit,
    saved,
    counts: () => ({ writes, quits, flushes, prompts }),
  };
}

test("closing a background dirty tab asks only its name; cancel keeps state, discard neither writes nor closes another dirty tab", async () => {
  const { a, b, controller: c, guard, edit, counts } = await workspace();
  edit(a);
  await c.closeTab(b.documentId);
  expect(guard.getSnapshot()).toBeNull();
  expect(counts().prompts).toBe(0);
  await c.select(); // Reopen clean B, then make it dirty too.
  edit(b);
  const original = c.getEditor(a.documentId)!.state;
  c.updateEditor(
    a.documentId,
    original.update({ selection: { anchor: 1, head: 3 } })
  );
  const savedState = c.getEditor(a.documentId)!.state;
  const otherState = c.getEditor(b.documentId)!.state;
  const cancel = c.closeTab(a.documentId);
  await nextTurn();
  expect(guard.getSnapshot()?.message).toContain("甲.md");
  expect(guard.getSnapshot()?.message).not.toContain("乙.md");
  guard.respond(false);
  await cancel;
  expect(c.getEditor(a.documentId)!.state).toBe(savedState);
  expect(c.getEditor(b.documentId)!.state).toBe(otherState);
  expect(c.getSnapshot().snapshot?.documentId).toBe(b.documentId);
  const discard = c.closeTab(a.documentId);
  await nextTurn();
  guard.respond(true);
  await discard;
  expect(c.getEditor(a.documentId)).toBeUndefined();
  expect(c.getEditor(b.documentId)!.state).toBe(otherState);
  expect(c.isDirty(b.documentId)).toBe(true);
  expect(counts().writes).toBe(0);
});

test("red close and quit share one all-dirty confirmation, cancellation preserves history, approval quits without saving", async () => {
  const {
    a,
    b,
    controller: c,
    guard,
    lifecycle,
    operations,
    counts,
    edit,
  } = await workspace();
  edit(a);
  edit(b);
  const firstState = c.getEditor(a.documentId)!.state,
    secondState = c.getEditor(b.documentId)!.state;
  const red: BeforeQuitEvent = {},
    quit: BeforeQuitEvent = {};
  lifecycle.beforeClose(red);
  lifecycle.beforeQuit(quit);
  expect(red.response?.allow).toBe(false);
  expect(quit.response?.allow).toBe(false);
  await nextTurn();
  expect(guard.getSnapshot()?.message).toContain("全部");
  expect(counts().prompts).toBe(1);
  expect(edit(a, "blocked")).toBe(false);
  guard.respond(false);
  await Promise.all(operations);
  expect(c.getEditor(a.documentId)!.state).toBe(firstState);
  expect(c.getEditor(b.documentId)!.state).toBe(secondState);
  expect(c.canUndo()).toBe(true);
  expect(counts().quits).toBe(0);
  lifecycle.beforeQuit({});
  await nextTurn();
  guard.respond(true);
  await Promise.all(operations);
  expect(counts()).toEqual({ writes: 0, quits: 1, flushes: 1, prompts: 2 });
});

test("clean workspace closes without a dialog through either native entry", async () => {
  for (const method of ["beforeClose", "beforeQuit"] as const) {
    const { lifecycle, operations, counts, guard } = await workspace();
    lifecycle[method]({});
    await Promise.all(operations);
    expect(guard.getSnapshot()).toBeNull();
    expect(counts()).toEqual({ writes: 0, quits: 1, flushes: 1, prompts: 0 });
  }
});

test("global close waits for save; success rechecks latest buffer, failure and newer edits still require confirmation", async () => {
  for (const outcome of ["saved", "failed", "newer-edit"] as const) {
    const {
      b,
      controller: c,
      transport,
      edit,
      guard,
      lifecycle,
      operations,
      counts,
      saved,
    } = await workspace();
    edit(b);
    const pending = deferred<unknown>();
    let params!: SaveDocumentRequest;
    transport.saveDocument = (req) => {
      params = req;
      return pending.promise;
    };
    const saving = c.save();
    await waitCaptured(() => !!params);
    if (outcome === "newer-edit") edit(b, "较新");
    lifecycle.beforeQuit({});
    await nextTurn();
    expect(c.getSnapshot().frozen).toBe(true);
    expect(guard.getSnapshot()).toBeNull();
    expect(counts().quits).toBe(0);
    pending.resolve(
      outcome === "failed"
        ? {
            protocolVersion: 1,
            requestId: params.requestId,
            ok: false,
            error: "SAVE_FAILED",
          }
        : saved(params)
    );
    await saving;
    await nextTurn();
    if (outcome === "saved") {
      await Promise.all(operations);
      expect(counts().quits).toBe(1);
      expect(counts().prompts).toBe(0);
    } else {
      expect(guard.getSnapshot()?.message).toContain("全部");
      const retained = c.getEditor(b.documentId)!.state;
      guard.respond(false);
      await Promise.all(operations);
      expect(c.getEditor(b.documentId)!.state).toBe(retained);
      expect(c.isDirty(b.documentId)).toBe(true);
      expect(counts().quits).toBe(0);
    }
  }
});

test("unknown save settlement visibly cancels quit; readonly dirty and active composition remain protected", async () => {
  const {
    b,
    controller: c,
    transport,
    edit,
    guard,
    lifecycle,
    operations,
    counts,
  } = await workspace();
  edit(b);
  transport.saveDocument = () => Promise.reject(Error("private file error"));
  await c.save();
  transport.waitForDocumentSaves = () =>
    Promise.reject(Error("/private/user/document.md"));
  lifecycle.beforeQuit({});
  await Promise.all(operations);
  expect(counts().quits).toBe(0);
  expect(guard.getSnapshot()).toBeNull();
  expect(c.getSnapshot().error).toContain("无法确认后台保存已结束");
  expect(c.getSnapshot().error).not.toContain("/private/");
  expect(c.getSnapshot().frozen).toBe(false);
  transport.waitForDocumentSaves = (req) =>
    Promise.resolve({ ...req, settled: true });
  transport.checkDocumentWriteCapability = (req) =>
    Promise.resolve({
      ...req,
      capability: { writable: false, reason: "readonly" },
    });
  await c.refreshWriteCapability();
  c.setInteractionCheck(() => false);
  lifecycle.beforeClose({});
  await Promise.all(operations);
  expect(guard.getSnapshot()).toBeNull();
  expect(counts().quits).toBe(0);
  expect(c.getEditor(b.documentId)!.state.field(rawText)).not.toBe(b.text);
  c.setInteractionCheck(() => true);
  lifecycle.beforeQuit({});
  await nextTurn();
  expect(guard.getSnapshot()?.message).toContain("全部");
  guard.respond(false);
  await Promise.all(operations);
  expect(c.isDirty(b.documentId)).toBe(true);
});
