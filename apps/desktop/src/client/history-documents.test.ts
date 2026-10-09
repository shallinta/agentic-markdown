import { expect, test } from "bun:test";

import { isolateHistory } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";

import { createCommandRegistry } from "../commands/registry";
import {
  isWriteCapability,
  type DocumentSnapshot,
  type WriteCapability,
} from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDocumentController, type DocumentTransport } from "./documents";
import { getSourceWrapping } from "./editor-mode";
import { syncCurrentEditorState } from "./editor-view-sync";
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
test("cross-tab history command changes content without reporting a command failure at controller seam", async () => {
  const { a, controller: c, edit, openB } = await setup();
  const failures: string[] = [];
  const registry = createCommandRegistry(
    () => {
      throw Error("unexpected forwarding");
    },
    () => failures.push("命令执行失败，请重试。")
  );
  registry.registerCommandHandlers(
    {
      undoDocument: () => {
        c.runHistory("undo");
      },
      redoDocument: () => {
        c.runHistory("redo");
      },
    },
    { undoDocument: c.canUndo, redoDocument: c.canRedo }
  );
  edit("TEMP");
  await openB();
  c.activateTab(a.documentId);
  registry.executeCommand({ type: "undoDocument", args: {} });
  await Promise.resolve();
  expect(c.getEditor(a.documentId)!.state.field(rawText)).toBe(a.text);
  expect(failures).toEqual([]);
  await openB();
  c.activateTab(a.documentId);
  registry.executeCommand({ type: "redoDocument", args: {} });
  await Promise.resolve();
  expect(c.getEditor(a.documentId)!.state.field(rawText)).toBe(a.text + "TEMP");
  expect(failures).toEqual([]);
});

test("mount viewport transaction is not replaced by render-captured editor state", async () => {
  const { a, controller: c, edit, openB } = await setup();
  edit("TEMP");
  await openB();
  c.activateTab(a.documentId);
  const capturedEditor = c.getEditor(a.documentId)!;
  let viewState = capturedEditor.state;
  let notifications = 0;
  const unsubscribe = c.subscribe(() => {
    notifications++;
  });
  // Actual CM effect used by MemoryEditor's first layout effect for a restored viewport.
  const restore = viewState.update({
    effects: EditorView.scrollIntoView(0, { y: "start" }),
  });
  expect(c.updateEditor(a.documentId, restore)).toBe(true);
  viewState = restore.state;
  expect(notifications).toBe(0);
  expect(viewState).toBe(c.getEditor(a.documentId)!.state);
  // Production second-effect seam reads the current owner, not capturedEditor.
  let replacements = 0;
  const current = syncCurrentEditorState(
    {
      get state() {
        return viewState;
      },
      setState(state) {
        replacements++;
        viewState = state;
      },
    },
    c,
    a.documentId
  );
  unsubscribe();
  expect(viewState).toBe(c.getEditor(a.documentId)!.state);
  expect(current).toBe(restore.state);
  expect(replacements).toBe(0);
});

test("diagnostic mount without viewport restoration keeps captured state current", async () => {
  const { a, controller: c, edit, openB } = await setup();
  edit("TEMP");
  await openB();
  c.activateTab(a.documentId);
  const capturedEditor = c.getEditor(a.documentId)!;
  const viewState = capturedEditor.state;
  expect(viewState).toBe(c.getEditor(a.documentId)!.state);
});
test("view synchronization adopts latest owner state and ignores released documents", async () => {
  const { a, controller: c, edit } = await setup();
  let state = c.getEditor(a.documentId)!.state;
  let replacements = 0;
  const view = {
    get state() {
      return state;
    },
    setState(next: typeof state) {
      replacements++;
      state = next;
    },
  };
  edit("latest");
  expect(syncCurrentEditorState(view, c, a.documentId)).toBe(
    c.getEditor(a.documentId)!.state
  );
  expect(replacements).toBe(1);
  expect(state.field(rawText)).toBe(a.text + "latest");
  expect(syncCurrentEditorState(view, c, "not-open")).toBeUndefined();
  expect(replacements).toBe(1);
});

test("global source wrap updates existing and new documents without text revision or history changes", async () => {
  const { a, b, controller: c, edit, openB } = await setup();
  c.toggleSourceMode();
  edit("TEMP");
  const previous = c.getEditor(a.documentId)!;
  c.setSourceWrapping(false);
  const current = c.getEditor(a.documentId)!;
  expect(getSourceWrapping(current.state)).toBe(false);
  expect(current.state.doc).toBe(previous.state.doc);
  expect(current.state.selection).toBe(previous.state.selection);
  expect(current.revision).toBe(previous.revision);
  await openB();
  c.toggleSourceMode();
  expect(getSourceWrapping(c.getEditor(b.documentId)!.state)).toBe(false);
  c.activateTab(a.documentId);
  expect(c.runHistory("undo")).toBe(true);
  expect(c.getEditor(a.documentId)!.state.field(rawText)).toBe(a.text);
  expect(getSourceWrapping(c.getEditor(a.documentId)!.state)).toBe(false);
});

test("source wrap waits for composition and applies only latest value without reviving disposal", async () => {
  const { a, controller: c } = await setup();
  c.toggleSourceMode();
  let composing = true;
  c.setInteractionCheck(() => !composing);
  const original = c.getEditor(a.documentId)!.state;
  c.setSourceWrapping(false);
  c.setSourceWrapping(true);
  c.setSourceWrapping(false);
  expect(c.getEditor(a.documentId)!.state).toBe(original);
  composing = false;
  c.notifyInteraction();
  expect(getSourceWrapping(c.getEditor(a.documentId)!.state)).toBe(false);
  c.dispose();
  c.setSourceWrapping(true);
  c.notifyInteraction();
  expect(c.getEditor(a.documentId)).toBeUndefined();
});
test("wrapping defers hidden cache and fences measured callbacks against tab, state, composition and disposal", async () => {
  const { a, b, controller: c, openB, edit } = await setup();
  c.toggleSourceMode();
  await openB();
  c.toggleSourceMode();
  let scheduled = 0;
  c.setWrappingScheduler(() => {
    scheduled++;
  });
  c.setSourceWrapping(false);
  const bBefore = c.getEditor(b.documentId)!.state;
  expect(scheduled).toBe(1);
  expect(getSourceWrapping(c.getEditor(a.documentId)!.state)).toBe(true);
  expect(c.applySourceWrapping(b.documentId, bBefore)).toBe(true);
  c.activateTab(a.documentId);
  c.setSourceWrapping(false); // The mounted view asks for the latest desired value.
  const aBefore = c.getEditor(a.documentId)!.state;
  expect(scheduled).toBe(2);
  expect(c.applySourceWrapping(b.documentId, bBefore)).toBe(false);
  edit("changed after measurement");
  expect(c.applySourceWrapping(a.documentId, aBefore)).toBe(false);
  const latest = c.getEditor(a.documentId)!.state;
  c.setInteractionCheck(() => false);
  expect(c.applySourceWrapping(a.documentId, latest)).toBe(false);
  c.setInteractionCheck(() => true);
  c.beginDiscard();
  expect(c.applySourceWrapping(a.documentId, latest)).toBe(false);
  c.endDiscard();
  expect(c.applySourceWrapping(a.documentId, latest)).toBe(true);
  expect(getSourceWrapping(c.getEditor(a.documentId)!.state)).toBe(false);
  c.setSourceWrapping(true);
  const last = c.getEditor(a.documentId)!.state;
  c.dispose();
  expect(c.applySourceWrapping(a.documentId, last)).toBe(false);
});
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
