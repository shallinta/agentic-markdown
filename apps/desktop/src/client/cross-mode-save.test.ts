import { expect, test } from "bun:test";

import { isolateHistory } from "@codemirror/commands";

import type {
  DocumentSnapshot,
  SaveDocumentRequest,
} from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDocumentController, type DocumentTransport } from "./documents";
import { editorFaultSession, reportEditorFault } from "./editor-fault";
import { rawText } from "./raw-buffer";
import { requestText, savedReply, waitCaptured } from "./save-test-helper";

type Mode = "editing" | "source" | "safe";

test("reading saves captured dirty text without mode/history/selection loss", async () => {
  const { a, c, state, edit, finish, request } = await setup("editing");
  edit("阅读保存");
  const before = state();
  const raw = before.field(rawText);
  expect(c.toggleReadingMode()).toBe(true);
  expect(c.canSave()).toBe(true);
  expect(c.canUndo()).toBe(false);
  const saving = c.save();
  await waitCaptured(() => !!request());
  expect(requestText(request(), a)).toBe(raw);
  finish(savedReply(request(), a));
  await saving;
  expect(c.getMode(a.documentId)).toBe("reading");
  expect(state()).toBe(before);
  expect(c.isDirty(a.documentId)).toBe(false);
  expect(c.toggleReadingMode()).toBe(true);
  expect(c.runHistory("undo")).toBe(true);
  expect(state().field(rawText)).toBe(a.text);
  expect(c.isDirty(a.documentId)).toBe(true);
});
async function setup(mode: Mode) {
  const make = (text: string): DocumentSnapshot => ({
    documentId: crypto.randomUUID(),
    handle: crypto.randomUUID(),
    fileName: "cross-mode.md",
    revision: 1,
    hash: "a".repeat(64),
    text,
    byteLength: new TextEncoder().encode(text).length,
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: true, reason: "writable" },
  });
  const a = make("\uFEFF# 原文\r\n保真\n尾🙂"),
    b = make("另一文档");
  let selected = a;
  const transport: DocumentTransport = {
    selectDocument: (req) =>
      Promise.resolve({ ...req, ok: true, snapshot: selected }),
    readDocument: (req) =>
      Promise.resolve({ ...req, ok: true, snapshot: selected }),
    releaseDocument: () => Promise.resolve(),
    cancelDocument: () => Promise.resolve(),
    waitForDocumentSaves: (req) => Promise.resolve({ ...req, settled: true }),
  };
  const c = createDocumentController(transport);
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
  let finish!: (value: unknown) => void;
  let request: SaveDocumentRequest | undefined;
  const reply = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  transport.saveDocument = (req) => {
    request = req;
    return reply;
  };
  return { a, b, c, state, edit, finish, request: () => request! };
}

for (const mode of ["editing", "source", "safe"] as const) {
  test(`${mode}: delayed save acknowledges only captured revision across mode change and later typing`, async () => {
    const { a, c, state, edit, finish, request } = await setup(mode);
    expect(edit("第一笔")).toBe(true);
    const captured = state().field(rawText);
    const revision = c.getEditor(a.documentId)!.revision;
    const saving = c.save();
    await waitCaptured(() => !!request());
    expect(request().bufferRevision).toBe(revision);
    expect(request().documentId).toBe(a.documentId);
    expect(requestText(request(), a)).toBe(captured);
    if (mode === "safe") expect(c.toggleSourceMode()).toBe(false);
    else expect(c.toggleSourceMode()).toBe(true);
    expect(c.getEditor(a.documentId)!.revision).toBe(revision);
    expect(edit("后来输入")).toBe(true);
    const newest = state(),
      nextRevision = c.getEditor(a.documentId)!.revision;
    finish(savedReply(request(), a));
    await saving;
    expect(state()).toBe(newest);
    expect(c.getEditor(a.documentId)!.revision).toBe(nextRevision);
    expect(c.getSnapshot().snapshot!.text).toBe(captured);
    expect(c.getSnapshot().snapshot!.revision).toBe(a.revision + 1);
    expect(c.isDirty(a.documentId)).toBe(true);
    expect(c.isSafeSource(a.documentId)).toBe(mode === "safe");
    expect(c.getMode(a.documentId)).toBe(
      mode === "source" ? "editing" : "source"
    );
    expect(state().selection.main.anchor).toBe(1);
    expect(state().selection.main.head).toBe(4);
    expect(c.runHistory("undo")).toBe(true);
    expect(state().field(rawText)).toBe(captured);
    expect(c.isDirty(a.documentId)).toBe(false);
    expect(c.runHistory("redo")).toBe(true);
    expect(state().field(rawText)).toBe(captured + "后来输入");
    expect(c.isSafeSource(a.documentId)).toBe(mode === "safe");
  });

  for (const outcome of ["success", "failure"] as const) {
    test(`${mode}: inactive ${outcome} save reply preserves the active document and target mode`, async () => {
      const { a, b, c, state, edit, finish, request } = await setup(mode);
      edit("待保存");
      const expectedRaw = state().field(rawText);
      const saving = c.save();
      await waitCaptured(() => !!request());
      c.activateTab(b.documentId);
      expect(c.toggleSourceMode()).toBe(true);
      let other = c.getEditor(b.documentId)!.state;
      c.updateEditor(
        b.documentId,
        other.update({
          changes: { from: 0, insert: "独立修改" },
          selection: { anchor: 1, head: 3 },
        })
      );
      other = c.getEditor(b.documentId)!.state;
      const target = state(),
        targetRevision = c.getEditor(a.documentId)!.revision;
      finish(
        outcome === "success"
          ? savedReply(request(), a)
          : {
              protocolVersion: 1,
              requestId: request().requestId,
              ok: false,
              error: "CONFLICT",
            }
      );
      await saving;
      expect(c.getSnapshot().snapshot!.documentId).toBe(b.documentId);
      expect(c.getEditor(b.documentId)!.state).toBe(other);
      expect(c.getMode(b.documentId)).toBe("source");
      expect(c.isDirty(b.documentId)).toBe(true);
      expect(state()).toBe(target);
      expect(c.getEditor(a.documentId)!.revision).toBe(targetRevision);
      expect(c.getMode(a.documentId)).toBe(
        mode === "editing" ? "editing" : "source"
      );
      expect(c.isSafeSource(a.documentId)).toBe(mode === "safe");
      expect(c.isDirty(a.documentId)).toBe(outcome === "failure");
      const baseline = c
        .getSnapshot()
        .tabs.find((tab) => tab.documentId === a.documentId)!;
      expect(baseline.text).toBe(outcome === "success" ? expectedRaw : a.text);
      expect(baseline.revision).toBe(outcome === "success" ? 2 : 1);
      expect(c.getSaveStatus(a.documentId).status).toBe(
        outcome === "success" ? "saved" : "failed"
      );
      c.activateTab(a.documentId);
      expect(c.runHistory("undo")).toBe(true);
      expect(state().field(rawText)).toBe(a.text);
    });
  }
}
