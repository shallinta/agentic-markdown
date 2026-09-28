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
import { editorFaultSession, reportEditorFault } from "./editor-fault";
import { rawText } from "./raw-buffer";
import { savedReply, waitCaptured } from "./save-test-helper";

type Mode = "editing" | "source" | "safe";
async function setup(mode: Mode) {
  const make = (fileName: string, text: string): DocumentSnapshot => ({
    fileName,
    text,
    documentId: crypto.randomUUID(),
    handle: crypto.randomUUID(),
    revision: 1,
    hash: "a".repeat(64),
    byteLength: new TextEncoder().encode(text).length,
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: true, reason: "writable" },
  });
  const a = make("目标.md", "\uFEFF# 原文\r\n尾🙂"),
    b = make("另一个.md", "不变");
  let selected = a,
    writes = 0,
    quits = 0;
  const transport: DocumentTransport = {
    selectDocument: (req) =>
      Promise.resolve({ ...req, ok: true, snapshot: selected }),
    readDocument: (req) =>
      Promise.resolve({ ...req, ok: true, snapshot: selected }),
    releaseDocument: () => Promise.resolve(),
    cancelDocument: () => Promise.resolve(),
    waitForDocumentSaves: (req) => Promise.resolve({ ...req, settled: true }),
    saveDocument: (req) => {
      writes++;
      return Promise.resolve(savedReply(req, a));
    },
  };
  const guard = createDiscardGuard(),
    c = createDocumentController(transport, guard.ask);
  guard.register(c);
  await c.select();
  selected = b;
  await c.select();
  c.activateTab(a.documentId);
  if (mode === "source") expect(c.toggleSourceMode()).toBe(true);
  if (mode === "safe") {
    const session = c.getEditor(a.documentId)!.state.field(editorFaultSession);
    reportEditorFault(session, "presentation");
    expect(c.enterSafeSource(a.documentId, session)).toBe(true);
  }
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
    stop: () => Promise.resolve(),
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
  const state = () => c.getEditor(a.documentId)!.state;
  const edit = (text: string) =>
    c.updateEditor(
      a.documentId,
      state().update({
        changes: { from: state().doc.length, insert: text },
        selection: { anchor: 1, head: 4 },
        annotations: isolateHistory.of("full"),
      })
    );
  return {
    a,
    b,
    c,
    state,
    edit,
    transport,
    guard,
    lifecycle,
    operations,
    writes: () => writes,
    quits: () => quits,
  };
}

for (const mode of ["editing", "source", "safe"] as const) {
  test(`${mode}: dirty readonly close cancel retains state; explicit discard closes only target without saving`, async () => {
    const { a, b, c, state, edit, transport, guard, writes } =
      await setup(mode);
    edit("保留");
    transport.checkDocumentWriteCapability = (req) =>
      Promise.resolve({
        ...req,
        capability: { writable: false, reason: "readonly" },
      });
    await c.refreshWriteCapability();
    const retained = state(),
      revision = c.getEditor(a.documentId)!.revision;
    c.setScrollPosition(a.documentId, 123);
    const closing = c.closeActive();
    await waitCaptured(() => !!guard.getSnapshot());
    expect(guard.getSnapshot()!.message).toContain(a.fileName);
    expect(guard.getSnapshot()!.message).not.toContain(b.fileName);
    guard.respond(false);
    await closing;
    expect(state()).toBe(retained);
    expect(c.getEditor(a.documentId)!.revision).toBe(revision);
    expect(c.getScrollPosition(a.documentId)).toBe(123);
    expect(c.getSnapshot().snapshot!.documentId).toBe(a.documentId);
    expect(c.isSafeSource(a.documentId)).toBe(mode === "safe");
    expect(c.isDirty(a.documentId)).toBe(true);
    expect(c.getSnapshot().frozen).toBe(false);
    const discard = c.closeActive();
    await waitCaptured(() => !!guard.getSnapshot());
    guard.respond(true);
    await discard;
    expect(c.getEditor(a.documentId)).toBeUndefined();
    expect(c.getSnapshot().tabs.map((tab) => tab.documentId)).toEqual([
      b.documentId,
    ]);
    expect(c.getEditor(b.documentId)!.state.field(rawText)).toBe(b.text);
    expect(writes()).toBe(0);
    await c.closeActive();
    expect(guard.getSnapshot()).toBeNull();
    expect(c.getSnapshot().tabs).toHaveLength(0);
  });

  for (const outcome of ["saved", "newer", "failed", "unsettled"] as const) {
    test(`${mode}: quit waits for ${outcome} save and never mistakes an old/unknown baseline for clean`, async () => {
      const {
        a,
        b,
        c,
        state,
        edit,
        transport,
        guard,
        lifecycle,
        operations,
        quits,
      } = await setup(mode);
      edit("捕获");
      let request!: SaveDocumentRequest,
        finish!: (value: unknown) => void,
        dispatched = 0;
      transport.saveDocument = (req) => {
        request = req;
        dispatched++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      };
      if (outcome === "unsettled")
        transport.waitForDocumentSaves = (req) =>
          Promise.resolve({ ...req, settled: false });
      const saving = c.save();
      await waitCaptured(() => !!request);
      if (outcome === "newer") edit("后续输入");
      const retained = state(),
        other = c.getEditor(b.documentId)!.state;
      const closeEvent: BeforeQuitEvent = {},
        quitEvent: BeforeQuitEvent = {};
      lifecycle.beforeClose(closeEvent);
      lifecycle.beforeQuit(quitEvent);
      expect(closeEvent.response?.allow).toBe(false);
      expect(quitEvent.response?.allow).toBe(false);
      expect(c.getSnapshot().frozen).toBe(true);
      expect(guard.getSnapshot()).toBeNull();
      expect(quits()).toBe(0);
      expect(edit("屏障拒绝")).toBe(false);
      finish(
        outcome === "failed" || outcome === "unsettled"
          ? {
              protocolVersion: 1,
              requestId: request.requestId,
              ok: false,
              error: outcome === "failed" ? "CONFLICT" : "SAVE_UNCERTAIN",
            }
          : savedReply(request, a)
      );
      await saving;
      if (outcome === "saved" || outcome === "unsettled") {
        await Promise.all(operations);
        expect(guard.getSnapshot()).toBeNull();
        expect(quits()).toBe(outcome === "saved" ? 1 : 0);
        if (outcome === "unsettled") {
          expect(c.getSnapshot().error).toContain("无法确认后台保存已结束");
          expect(c.getSnapshot().frozen).toBe(false);
          expect(c.isDirty(a.documentId)).toBe(true);
        }
      } else {
        await waitCaptured(() => !!guard.getSnapshot());
        expect(guard.getSnapshot()!.message).toContain("全部");
        guard.respond(false);
        await Promise.all(operations);
        expect(quits()).toBe(0);
        expect(c.getSnapshot().frozen).toBe(false);
        expect(c.isDirty(a.documentId)).toBe(true);
        expect(state()).toBe(retained);
        expect(c.getEditor(b.documentId)!.state).toBe(other);
        expect(c.getSnapshot().snapshot!.documentId).toBe(a.documentId);
        expect(c.isSafeSource(a.documentId)).toBe(mode === "safe");
        expect(c.runHistory("undo")).toBe(true);
        expect(c.runHistory("redo")).toBe(true);
        expect(state().field(rawText)).toBe(retained.field(rawText));
        lifecycle.beforeQuit({});
        await waitCaptured(() => !!guard.getSnapshot());
        guard.respond(true);
        await Promise.all(operations);
        expect(quits()).toBe(1);
      }
      expect(dispatched).toBe(1);
      expect(c.getEditor(b.documentId)!.state.field(rawText)).toBe(b.text);
    });
  }
}
