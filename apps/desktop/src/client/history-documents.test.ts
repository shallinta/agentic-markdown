import { expect, test } from "bun:test";

import { isolateHistory } from "@codemirror/commands";

import {
  isWriteCapability,
  type DocumentSnapshot,
  type WriteCapability,
} from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDocumentController, type DocumentTransport } from "./documents";
import { rawText } from "./raw-buffer";
import { savedReply } from "./save-test-helper";

async function setup(capabilityTimeoutMs?: number) {
  const make = (text: string): DocumentSnapshot => ({
    documentId: crypto.randomUUID(),
    handle: crypto.randomUUID(),
    fileName: "sample.md",
    revision: 1,
    hash: "a".repeat(64),
    text,
    byteLength: new TextEncoder().encode(text).length,
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: true, reason: "writable" },
  });
  const a = make("\uFEFFa\r\nb\nc\rd"),
    b = make("second");
  let selected = a;
  const transport: DocumentTransport = {
    selectDocument: (req) =>
      Promise.resolve({ ...req, ok: true, snapshot: selected }),
    readDocument: (req) =>
      Promise.resolve({ ...req, ok: true, snapshot: selected }),
    cancelDocument: () => Promise.resolve(),
    releaseDocument: () => Promise.resolve(),
    waitForDocumentSaves: (req) => Promise.resolve({ ...req, settled: true }),
    saveDocument: (req) => Promise.resolve(savedReply(req, selected)),
  };
  const controller = createDocumentController(
    transport,
    () => Promise.resolve(true),
    capabilityTimeoutMs
  );
  await controller.select();
  const edit = (text: string) => {
    const id = controller.getSnapshot().snapshot!.documentId;
    const state = controller.getEditor(id)!.state;
    controller.updateEditor(
      id,
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
    transport,
    edit,
    openB: async () => {
      selected = b;
      await controller.select();
    },
  };
}
test("readonly refresh preserves dirty raw bytes, selection and history while blocking all mutations", async () => {
  const { a, controller: c, transport, edit } = await setup();
  edit("修改");
  const current = c.getEditor(a.documentId)!.state;
  c.updateEditor(
    a.documentId,
    current.update({ selection: { anchor: 1, head: 3 } })
  );
  const savedState = c.getEditor(a.documentId)!.state;
  let capability: WriteCapability = { writable: false, reason: "readonly" };
  transport.checkDocumentWriteCapability = (req) =>
    Promise.resolve({ ...req, capability });
  await c.refreshWriteCapability();
  expect(c.getEditor(a.documentId)!.state).toBe(savedState);
  expect(c.isDirty(a.documentId)).toBe(true);
  expect(c.canSave()).toBe(false);
  expect(c.canUndo()).toBe(false);
  expect(c.canRedo()).toBe(false);
  expect(c.runHistory("undo")).toBe(false);
  expect(
    c.updateEditor(
      a.documentId,
      savedState.update({ changes: { from: 0, insert: "denied" } })
    )
  ).toBe(false);
  await c.save();
  expect(c.getEditor(a.documentId)!.state.field(rawText)).toBe(
    savedState.field(rawText)
  );
  expect(
    c.updateEditor(
      a.documentId,
      savedState.update({ selection: { anchor: 0, head: 2 } })
    )
  ).toBe(true);
  capability = { writable: true, reason: "writable" };
  await c.refreshWriteCapability();
  expect(c.canUndo()).toBe(true);
  expect(c.canSave()).toBe(true);
  expect(c.runHistory("undo")).toBe(true);
  expect(c.getEditor(a.documentId)!.state.field(rawText)).toBe(a.text);
});

test("capability stale/forged replies cannot unlock a document after a newer invalidation", async () => {
  const { a, controller: c, transport } = await setup();
  let finish!: (value: unknown) => void;
  let firstRequest: unknown;
  transport.checkDocumentWriteCapability = (req) => {
    firstRequest = req;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const pending = c.refreshWriteCapability();
  await c.refreshWriteCapability(a.handle, true);
  expect(c.canWrite(a.documentId)).toBe(false);
  transport.checkDocumentWriteCapability = (req) =>
    Promise.resolve({
      ...req,
      capability: { writable: false, reason: "readonly" },
    });
  finish({
    ...(firstRequest as object),
    capability: { writable: true, reason: "writable" },
  });
  await pending;
  await Promise.resolve();
  expect(c.canWrite(a.documentId)).toBe(false);
  transport.checkDocumentWriteCapability = (req) =>
    Promise.resolve({
      ...req,
      handle: crypto.randomUUID(),
      capability: { writable: true, reason: "writable" },
    });
  await c.refreshWriteCapability();
  expect(c.canWrite(a.documentId)).toBe(false);
  expect(isWriteCapability({ writable: false, reason: ["readonly"] })).toBe(
    false
  );
  expect(
    isWriteCapability({ writable: true, reason: "writable", forged: true })
  ).toBe(false);
});
test("document history isolates tabs, executes one group, and invalidates redo branch", async () => {
  const { a, b, controller: c, edit, openB } = await setup();
  expect(c.canUndo()).toBe(false);
  edit("1");
  edit("2");
  await openB();
  edit("B");
  expect(c.runHistory("undo", a.documentId)).toBe(false);
  expect(c.getEditor(b.documentId)!.state.field(rawText)).toBe("secondB");
  c.activateTab(a.documentId);
  expect(c.runHistory("undo")).toBe(true);
  expect(c.getEditor(a.documentId)!.state.field(rawText)).toBe(a.text + "1");
  expect(c.runHistory("redo")).toBe(true);
  expect(c.getEditor(a.documentId)!.state.field(rawText)).toBe(a.text + "12");
  c.runHistory("undo");
  edit("new");
  expect(c.canRedo()).toBe(false);
  expect(c.getEditor(b.documentId)!.state.field(rawText)).toBe("secondB");
});
test("save baseline and raw bytes survive undo/redo; reread resets history", async () => {
  const { a, controller: c, edit, transport } = await setup();
  edit("中文");
  await c.save();
  expect(c.isDirty(a.documentId)).toBe(false);
  c.runHistory("undo");
  expect(c.isDirty(a.documentId)).toBe(true);
  expect(c.getEditor(a.documentId)!.state.field(rawText)).toBe(a.text);
  c.runHistory("redo");
  expect(c.isDirty(a.documentId)).toBe(false);
  expect(c.getEditor(a.documentId)!.state.field(rawText)).toBe(a.text + "中文");
  transport.readDocument = (req) =>
    Promise.resolve({ ...req, ok: true, snapshot: c.getSnapshot().snapshot });
  await c.reload();
  expect(c.canUndo()).toBe(false);
  expect(c.canRedo()).toBe(false);
});
test("composition and frozen confirmation block history/save and destructive transitions", async () => {
  const { a, controller: c, edit, openB } = await setup();
  edit("before");
  await openB();
  edit("second");
  c.activateTab(a.documentId);
  c.setInteractionCheck(() => false);
  expect(c.canUndo()).toBe(false);
  expect(c.canSave()).toBe(false);
  expect(c.runHistory("undo")).toBe(false);
  await c.closeActive();
  expect(c.getSnapshot().tabs).toHaveLength(2);
  c.setInteractionCheck(() => true);
  c.beginDiscard();
  expect(c.runHistory("undo")).toBe(false);
  c.endDiscard();
  expect(c.runHistory("undo")).toBe(true);
});
test("live view dispatcher receives history transaction without replacing editor view", async () => {
  const { a, controller: c, edit } = await setup();
  edit("edit");
  let calls = 0;
  c.setHistoryDispatch((transaction) => {
    calls++;
    c.updateEditor(a.documentId, transaction);
  });
  c.runHistory("undo");
  c.runHistory("redo");
  expect(calls).toBe(2);
  await c.closeActive();
  await c.select();
  expect(c.canUndo()).toBe(false);
});

test("hung capability request releases its slot at deadline and late replies cannot override retry", async () => {
  const { a, controller: c, transport } = await setup(10);
  let finish!: (value: unknown) => void;
  let request: object = {};
  transport.checkDocumentWriteCapability = (req) => {
    request = req;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const old = c.refreshWriteCapability();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(c.canWrite(a.documentId)).toBe(false);
  transport.checkDocumentWriteCapability = (req) =>
    Promise.resolve({
      ...req,
      capability: { writable: false, reason: "readonly" },
    });
  await c.refreshWriteCapability();
  finish({ ...request, capability: { writable: true, reason: "writable" } });
  await old;
  expect(c.canWrite(a.documentId)).toBe(false);
  transport.checkDocumentWriteCapability = (req) =>
    Promise.resolve({
      ...req,
      capability: { writable: true, reason: "writable" },
    });
  await c.refreshWriteCapability();
  expect(c.canWrite(a.documentId)).toBe(true);
}, 10000);
