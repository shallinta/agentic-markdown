import { expect, test } from "bun:test";

import { isolateHistory, undoDepth, redoDepth } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";

import type { DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDocumentController, type DocumentTransport } from "./documents";
import { reportEditorFault } from "./editor-fault";
import { rawText } from "./raw-buffer";
import { savedReply, waitCaptured } from "./save-test-helper";

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function snapshot(text: string): DocumentSnapshot {
  return {
    documentId: crypto.randomUUID(),
    handle: crypto.randomUUID(),
    fileName: "self.md",
    revision: 1,
    hash: "a".repeat(64),
    text,
    byteLength: new TextEncoder().encode(text).length,
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: true, reason: "writable" },
  };
}
async function setup(text = "ordinary paragraph", readonly = false) {
  const a = snapshot(text),
    b = snapshot("unrelated B");
  if (readonly) a.writeCapability = { writable: false, reason: "readonly" };
  let selected = a;
  const transport: DocumentTransport = {
    selectDocument: (req) =>
      Promise.resolve({ ...req, ok: true, snapshot: selected }),
    readDocument: (req) =>
      Promise.resolve({ ...req, ok: true, snapshot: selected }),
    cancelDocument: () => Promise.resolve(),
    releaseDocument: () => Promise.resolve(),
  };
  const c = createDocumentController(transport, () => Promise.resolve(true));
  await c.select();
  const current = () => c.getEditor(a.documentId)!;
  const edit = (text: string) =>
    c.updateEditor(
      a.documentId,
      current().state.update({
        changes: { from: current().state.doc.length, insert: text },
        selection: EditorSelection.cursor(
          current().state.doc.length + text.length
        ),
        annotations: isolateHistory.of("full"),
      })
    );
  return {
    c,
    a,
    b,
    current,
    edit,
    transport,
    openB: async () => {
      selected = b;
      await c.select();
    },
  };
}

test("reading parser injection recovers through owner, preserving dirty raw, baseline and history", async () => {
  for (const text of [
    "\uFEFFordinary\r\nparagraph\rc",
    "a | b\n--- | ---\nx | y",
  ]) {
    const { c, a, current, edit } = await setup(text);
    try {
      expect(edit("未保存")).toBe(true);
      const before = current(),
        baseline = c.getSnapshot().snapshot;
      const transfer = c.getSaveTransfer(a.documentId);
      expect(c.toggleReadingMode()).toBe(true);
      const modes: string[] = [];
      const off = c.subscribe(() => modes.push(c.getMode(a.documentId)));
      expect(c.injectEditorFault("parser")).toBe(true);
      await settle();
      expect(modes).toEqual(["reading", "source"]);
      expect(c.isSafeSource(a.documentId)).toBe(true);
      expect(current().state.field(rawText)).toBe(before.state.field(rawText));
      expect(current().state.selection.eq(before.state.selection)).toBe(true);
      expect(current().revision).toBe(before.revision);
      expect(c.getSnapshot().snapshot).toBe(baseline);
      expect(c.getSaveTransfer(a.documentId)).toBe(transfer);
      expect(c.isDirty(a.documentId)).toBe(true);
      expect(undoDepth(current().state)).toBe(1);
      expect(redoDepth(current().state)).toBe(0);
      expect(c.runHistory("undo")).toBe(true);
      expect(current().state.field(rawText)).toBe(text);
      expect(c.isDirty(a.documentId)).toBe(false);
      expect(c.runHistory("redo")).toBe(true);
      expect(current().state.field(rawText)).toBe(text + "未保存");
      expect(c.isDirty(a.documentId)).toBe(true);
      expect(c.toggleReadingMode()).toBe(false);
      expect(c.toggleSourceMode()).toBe(false);
      off();
    } finally {
      c.dispose();
    }
  }
});

test("readonly reading recovers without granting write permission", async () => {
  const { c, a, current, edit } = await setup("readonly", true);
  try {
    c.toggleReadingMode();
    expect(c.injectEditorFault("parser")).toBe(true);
    await settle();
    expect(c.getMode(a.documentId)).toBe("source");
    expect(c.canWrite(a.documentId)).toBe(false);
    expect(edit("bad")).toBe(false);
    expect(current().state.field(rawText)).toBe(a.text);
    expect(c.isDirty(a.documentId)).toBe(false);
    expect(undoDepth(current().state)).toBe(0);
  } finally {
    c.dispose();
  }
});

test("frozen and IME interaction barriers publish pending once and resume without another fault", async () => {
  for (const barrier of ["frozen", "interaction"] as const) {
    const { c, a, current } = await setup();
    try {
      c.toggleReadingMode();
      let composing = barrier === "interaction";
      c.setInteractionCheck(() => !composing);
      if (barrier === "frozen") expect(c.beginDiscard()).toBe(true);
      let calls = 0;
      const off = c.subscribe(() => calls++);
      const session = c.getEditorFault(a.documentId)!;
      reportEditorFault(session, "parser");
      await settle();
      expect(calls).toBe(1);
      expect(c.getMode(a.documentId)).toBe("reading");
      const waiting = current().state;
      session.notify?.();
      session.notify?.();
      await settle();
      expect(calls).toBe(1);
      expect(current().state).toBe(waiting);
      if (barrier === "frozen") c.endDiscard();
      else {
        composing = false;
        c.notifyInteraction();
      }
      await settle();
      expect(c.isSafeSource(a.documentId)).toBe(true);
      expect(calls).toBe(3);
      const done = current().state;
      session.notify?.();
      await settle();
      expect(current().state).toBe(done);
      expect(calls).toBe(3);
      off();
    } finally {
      c.dispose();
    }
  }
});

test("busy completion retries the pending reading session, with unrelated tab untouched", async () => {
  const { c, a, b, current, transport, openB } = await setup();
  try {
    c.toggleReadingMode();
    let finish: ((value: unknown) => void) | undefined;
    transport.selectDocument = (req) =>
      new Promise((resolve) => {
        finish = () => resolve({ ...req, ok: true, snapshot: b });
      });
    const loading = openB();
    expect(c.getSnapshot().busy).toBe(true);
    const session = c.getEditorFault(a.documentId)!;
    reportEditorFault(session, "parser");
    await settle();
    expect(c.isSafeSource(a.documentId)).toBe(false);
    finish?.(undefined);
    await loading;
    await settle();
    expect(c.isSafeSource(a.documentId)).toBe(true);
    expect(current().state.field(rawText)).toBe(a.text);
    expect(c.getSnapshot().snapshot?.documentId).toBe(b.documentId);
    expect(c.getMode(b.documentId)).toBe("editing");
    expect(c.getEditorFault(b.documentId)?.fault).toBeNull();
    expect(c.getEditor(b.documentId)!.state.field(rawText)).toBe(b.text);
  } finally {
    c.dispose();
  }
});

test("old view cleanup cannot remove a newer composition check or history dispatcher", async () => {
  const { c, a, current, edit } = await setup();
  try {
    edit("dirty");
    let composing = true,
      oldCalls = 0,
      newCalls = 0;
    const oldCheck = c.setInteractionCheck(() => true);
    const oldDispatch = c.setHistoryDispatch(() => oldCalls++);
    const newCheck = c.setInteractionCheck(() => !composing);
    const newDispatch = c.setHistoryDispatch((tx) => {
      newCalls++;
      c.updateEditor(a.documentId, tx);
    });
    oldCheck();
    oldDispatch();
    reportEditorFault(c.getEditorFault(a.documentId)!, "presentation");
    await settle();
    expect(c.isSafeSource(a.documentId)).toBe(false);
    expect(oldCalls + newCalls).toBe(0);
    composing = false;
    c.notifyInteraction();
    await settle();
    expect(c.isSafeSource(a.documentId)).toBe(true);
    expect(newCalls).toBe(1);
    expect(oldCalls).toBe(0);
    expect(c.runHistory("undo")).toBe(true);
    expect(newCalls).toBe(2);
    expect(current().state.field(rawText)).toBe(a.text);
    newCheck();
    newDispatch();
  } finally {
    c.dispose();
  }
});

test("view removal releases the barrier without removing the session owner", async () => {
  const { c, a } = await setup();
  try {
    c.toggleReadingMode();
    const remove = c.setInteractionCheck(() => false);
    const session = c.getEditorFault(a.documentId)!;
    reportEditorFault(session, "parser");
    await settle();
    expect(c.isSafeSource(a.documentId)).toBe(false);
    remove();
    await settle();
    expect(session.notify).toBeDefined();
    expect(c.isSafeSource(a.documentId)).toBe(true);
  } finally {
    c.dispose();
  }
});

test("old session and queued callbacks cannot recover after close, clear, replacement or dispose", async () => {
  for (const action of ["close", "clear", "reload", "dispose"] as const) {
    const { c, a, current } = await setup();
    try {
      const session = c.getEditorFault(a.documentId)!;
      const oldNotify = session.notify!;
      if (action === "reload") {
        await c.reload();
      } else {
        // Close/clear modify synchronously for this clean document. The queued
        // report callback must not act even if the document ID is later reused.
        reportEditorFault(session, "parser");
        if (action === "close") await c.closeActive();
        else if (action === "clear") await c.clear();
        else c.dispose();
        if (action !== "dispose") await c.select();
      }
      expect(session.notify).toBeUndefined();
      reportEditorFault(session, "presentation");
      oldNotify();
      await settle();
      if (action === "dispose")
        expect(c.getEditor(a.documentId)).toBeUndefined();
      else {
        expect(c.getEditorFault(a.documentId)).not.toBe(session);
        expect(c.getEditorFault(a.documentId)?.fault).toBeNull();
        expect(c.isSafeSource(a.documentId)).toBe(false);
        expect(current().state.field(rawText)).toBe(a.text);
      }
    } finally {
      c.dispose();
    }
  }
});

test("failed safe dispatch reports once, retains reading and stops automatic retries", async () => {
  const { c, a, current, edit } = await setup();
  try {
    edit("dirty");
    c.toggleReadingMode();
    const before = current();
    let attempts = 0;
    c.setHistoryDispatch(() => {
      attempts++;
      throw Error("test dispatcher failure");
    });
    const session = c.getEditorFault(a.documentId)!;
    reportEditorFault(session, "parser");
    await settle();
    expect(attempts).toBe(1);
    expect(session.recoveryFailed).toBe(true);
    expect(c.getMode(a.documentId)).toBe("reading");
    expect(current()).toBe(before);
    expect(c.isDirty(a.documentId)).toBe(true);
    expect(c.getSnapshot().error).toBe(
      "安全源码恢复失败，内存状态已保留；请勿关闭文档。"
    );
    c.notifyInteraction();
    session.notify?.();
    c.endDiscard();
    await settle();
    expect(attempts).toBe(1);
  } finally {
    c.dispose();
  }
});

test("disposal revokes recovery immediately even while a save keeps editor state alive", async () => {
  const { c, a, current, edit, transport } = await setup();
  let finish: (() => void) | undefined;
  transport.saveDocument = (req) =>
    new Promise((resolve) => {
      finish = () => resolve(savedReply(req, a));
    });
  transport.waitForDocumentSaves = (req) =>
    Promise.resolve({ ...req, settled: true });
  edit("unsaved");
  const saving = c.save();
  await waitCaptured(() => !!finish);
  expect(finish).toBeDefined();
  const session = c.getEditorFault(a.documentId)!;
  const notify = session.notify!;
  reportEditorFault(session, "parser");
  c.dispose();
  const before = current();
  expect(before).toBeDefined();
  expect(session.notify).toBeUndefined();
  expect(c.enterSafeSource(a.documentId, session)).toBe(false);
  notify();
  await settle();
  expect(current()).toBe(before);
  expect(c.isSafeSource(a.documentId)).toBe(false);
  finish?.();
  await saving;
  await settle();
  expect(c.getEditor(a.documentId)).toBeUndefined();
});
