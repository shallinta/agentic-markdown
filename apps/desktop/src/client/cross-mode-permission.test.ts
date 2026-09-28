import { expect, test } from "bun:test";

import { isolateHistory } from "@codemirror/commands";

import { createCommandRegistry } from "../commands/registry";
import type {
  DocumentHandleRequest,
  DocumentSnapshot,
  WriteCapability,
} from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDocumentController, type DocumentTransport } from "./documents";
import { editorFaultSession, reportEditorFault } from "./editor-fault";
import { rawText } from "./raw-buffer";
import { savedReply } from "./save-test-helper";

type Mode = "editing" | "source" | "safe";
async function setup(mode: Mode) {
  const text = "\uFEFF# 权限\r\n原文🙂";
  const snapshot: DocumentSnapshot = {
    text,
    documentId: crypto.randomUUID(),
    handle: crypto.randomUUID(),
    fileName: "permission.markdown",
    revision: 1,
    hash: "a".repeat(64),
    byteLength: new TextEncoder().encode(text).length,
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: true, reason: "writable" },
  };
  let saves = 0;
  const transport: DocumentTransport = {
    selectDocument: (req) => Promise.resolve({ ...req, ok: true, snapshot }),
    readDocument: (req) => Promise.resolve({ ...req, ok: true, snapshot }),
    releaseDocument: () => Promise.resolve(),
    cancelDocument: () => Promise.resolve(),
    waitForDocumentSaves: (req) => Promise.resolve({ ...req, settled: true }),
    saveDocument: (req) => {
      saves++;
      return Promise.resolve(savedReply(req, snapshot));
    },
  };
  const c = createDocumentController(transport);
  await c.select();
  const state = () => c.getEditor(snapshot.documentId)!.state;
  const safe = () => {
    const session = state().field(editorFaultSession);
    reportEditorFault(session, "presentation");
    return c.enterSafeSource(snapshot.documentId, session);
  };
  if (mode === "source") expect(c.toggleSourceMode()).toBe(true);
  if (mode === "safe") expect(safe()).toBe(true);
  const capability = async (value: WriteCapability) => {
    transport.checkDocumentWriteCapability = (req) =>
      Promise.resolve({ ...req, capability: value });
    await c.refreshWriteCapability();
  };
  const edit = (insert: string) =>
    c.updateEditor(
      snapshot.documentId,
      state().update({
        changes: { from: state().doc.length, insert },
        annotations: isolateHistory.of("full"),
        selection: { anchor: 1, head: 4 },
      })
    );
  return {
    c,
    snapshot,
    state,
    safe,
    capability,
    edit,
    transport,
    saves: () => saves,
  };
}

for (const mode of ["editing", "source", "safe"] as const) {
  for (const reason of ["readonly", "unavailable", "invalid"] as const) {
    test(`${mode}: runtime ${reason} blocks mutations and commands without losing state; writable restores history`, async () => {
      const { c, snapshot, state, capability, edit, saves } = await setup(mode);
      edit("保留");
      const first = state().field(rawText);
      edit("撤销分支");
      expect(c.runHistory("undo")).toBe(true);
      const before = state(),
        revision = c.getEditor(snapshot.documentId)!.revision;
      expect(c.canUndo()).toBe(true);
      expect(c.canRedo()).toBe(true);
      await capability({ writable: false, reason });
      expect(state()).toBe(before);
      expect(c.getSnapshot().snapshot!.writeCapability).toEqual({
        writable: false,
        reason,
      });
      expect(c.isDirty(snapshot.documentId)).toBe(true);
      const registry = createCommandRegistry(
        () => {
          throw Error("unexpected forwarding");
        },
        () => {
          throw Error("unexpected command failure");
        }
      );
      let calls = 0;
      registry.registerCommandHandlers(
        {
          saveDocument: () => {
            calls++;
            void c.save();
          },
          undoDocument: () => {
            calls++;
            c.runHistory("undo");
          },
          redoDocument: () => {
            calls++;
            c.runHistory("redo");
          },
        },
        {
          saveDocument: c.canSave,
          undoDocument: c.canUndo,
          redoDocument: c.canRedo,
        }
      );
      for (const type of [
        "saveDocument",
        "undoDocument",
        "redoDocument",
      ] as const) {
        expect(registry.isCommandEnabled(type)).toBe(false);
        registry.executeCommand({ type, args: {} });
      }
      expect(calls).toBe(0);
      for (const userEvent of [
        "input.type",
        "input.paste",
        "delete.backward",
      ]) {
        expect(
          c.updateEditor(
            snapshot.documentId,
            state().update({
              changes:
                userEvent === "delete.backward"
                  ? { from: 0, to: 1 }
                  : { from: 0, insert: "拒绝" },
              userEvent,
            })
          )
        ).toBe(false);
      }
      await c.save();
      expect(saves()).toBe(0);
      expect(c.runHistory("undo")).toBe(false);
      expect(c.runHistory("redo")).toBe(false);
      expect(state()).toBe(before);
      expect(c.getEditor(snapshot.documentId)!.revision).toBe(revision);
      expect(
        c.updateEditor(
          snapshot.documentId,
          state().update({ selection: { anchor: 0, head: 3 } })
        )
      ).toBe(true);
      expect(state().sliceDoc(0, 3)).toBe(before.sliceDoc(0, 3));
      if (mode === "safe") expect(c.toggleSourceMode()).toBe(false);
      else {
        expect(c.toggleSourceMode()).toBe(true);
        expect(c.toggleSourceMode()).toBe(true);
      }
      expect(edit("仍拒绝")).toBe(false);
      expect(state().field(rawText)).toBe(first);
      expect(c.isSafeSource(snapshot.documentId)).toBe(mode === "safe");
      await capability({ writable: true, reason: "writable" });
      expect(c.canUndo()).toBe(true);
      expect(c.canRedo()).toBe(true);
      expect(c.runHistory("redo")).toBe(true);
      expect(state().field(rawText)).toBe(first + "撤销分支");
      expect(c.runHistory("undo")).toBe(true);
      expect(state().field(rawText)).toBe(first);
      expect(edit("恢复输入")).toBe(true);
      await c.save();
      expect(saves()).toBe(1);
      expect(c.isDirty(snapshot.documentId)).toBe(false);
      expect(c.isSafeSource(snapshot.documentId)).toBe(mode === "safe");
    });
  }

  test(`${mode}: wrong-handle and invalidated capability replies cannot unlock protected state`, async () => {
    const { c, snapshot, state, capability, edit, transport } =
      await setup(mode);
    edit("dirty");
    await capability({ writable: false, reason: "readonly" });
    const memory = state();
    transport.checkDocumentWriteCapability = (req) =>
      Promise.resolve({
        ...req,
        handle: crypto.randomUUID(),
        capability: { writable: true, reason: "writable" },
      });
    await c.refreshWriteCapability();
    expect(c.canWrite(snapshot.documentId)).toBe(false);
    let request!: DocumentHandleRequest, finish!: (value: unknown) => void;
    transport.checkDocumentWriteCapability = (req) => {
      request = req;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const old = c.refreshWriteCapability();
    await c.refreshWriteCapability(snapshot.handle, true);
    transport.checkDocumentWriteCapability = (req) =>
      Promise.resolve({
        ...req,
        capability: { writable: false, reason: "readonly" },
      });
    finish({ ...request, capability: { writable: true, reason: "writable" } });
    await old;
    await Promise.resolve();
    expect(c.canWrite(snapshot.documentId)).toBe(false);
    expect(state()).toBe(memory);
    expect(c.isDirty(snapshot.documentId)).toBe(true);
    expect(c.isSafeSource(snapshot.documentId)).toBe(mode === "safe");
  });
}

test("entering safe source while readonly and restoring permission never bypasses or clears isolation", async () => {
  const { c, snapshot, state, safe, capability, edit } = await setup("source");
  edit("保留");
  await capability({ writable: false, reason: "readonly" });
  const raw = state().field(rawText),
    selection = state().selection;
  expect(safe()).toBe(true);
  expect(edit("拒绝")).toBe(false);
  expect(state().field(rawText)).toBe(raw);
  expect(state().selection).toBe(selection);
  await capability({ writable: true, reason: "writable" });
  expect(c.isSafeSource(snapshot.documentId)).toBe(true);
  expect(c.canToggleSourceMode()).toBe(false);
  expect(edit("恢复")).toBe(true);
});
