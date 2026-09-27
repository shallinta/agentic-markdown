import { expect, test } from "bun:test";

import { createCommandRegistry } from "../commands/registry";
import type { DocumentSnapshot, WriteCapability } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDocumentController, type DocumentTransport } from "./documents";
import { editorFaultSession, reportEditorFault } from "./editor-fault";
import { rawText } from "./raw-buffer";
import { savedReply } from "./save-test-helper";

async function setup() {
  const text = "\uFEFF# lifecycle\r\n正文🙂";
  const snapshot: DocumentSnapshot = {
    documentId: crypto.randomUUID(),
    handle: crypto.randomUUID(),
    fileName: "lifecycle.md",
    revision: 1,
    hash: "a".repeat(64),
    text,
    byteLength: new TextEncoder().encode(text).length,
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: true, reason: "writable" },
  };
  let capability: WriteCapability = { writable: true, reason: "writable" };
  const transport: DocumentTransport = {
    selectDocument: (request) =>
      Promise.resolve({ ...request, ok: true, snapshot }),
    readDocument: (request) =>
      Promise.resolve({ ...request, ok: true, snapshot }),
    cancelDocument: () => Promise.resolve(),
    releaseDocument: () => Promise.resolve(),
    waitForDocumentSaves: (request) =>
      Promise.resolve({ ...request, settled: true }),
    saveDocument: (request) => Promise.resolve(savedReply(request, snapshot)),
    checkDocumentWriteCapability: (request) =>
      Promise.resolve({ ...request, capability }),
  };
  const c = createDocumentController(transport, () => Promise.resolve(true));
  await c.select();
  const state = () => c.getEditor(snapshot.documentId)!.state;
  return {
    c,
    snapshot,
    state,
    readonly: async () => {
      capability = { writable: false, reason: "readonly" };
      await c.refreshWriteCapability();
    },
  };
}

test("superseded controller transactions cannot replace newer text or mode", async () => {
  const { c, snapshot, state } = await setup();
  const before = state();
  const stale = before.update({ changes: { from: 0, insert: "stale" } });
  expect(
    c.updateEditor(
      snapshot.documentId,
      before.update({ changes: { from: before.doc.length, insert: "fresh" } })
    )
  ).toBe(true);
  const accepted = state();
  expect(c.updateEditor(snapshot.documentId, stale)).toBe(false);
  expect(state()).toBe(accepted);
  const priorMode = state().update({ selection: { anchor: 0 } });
  expect(c.toggleSourceMode()).toBe(true);
  expect(c.updateEditor(snapshot.documentId, priorMode)).toBe(false);
  expect(c.getMode(snapshot.documentId)).toBe("source");
  expect(state().field(rawText)).toBe(snapshot.text + "fresh");
});

test("closed and reopened document identity rejects the previous editor lifetime", async () => {
  const { c, snapshot, state } = await setup();
  const old = state().update({ changes: { from: 0, insert: "late" } });
  await c.closeActive();
  expect(c.getEditor(snapshot.documentId)).toBeUndefined();
  expect(c.updateEditor(snapshot.documentId, old)).toBe(false);
  await c.select();
  expect(c.updateEditor(snapshot.documentId, old)).toBe(false);
  expect(state().field(rawText)).toBe(snapshot.text);
});

test("safe-source transition rejects outstanding transactions and old fault sessions", async () => {
  const { c, snapshot, state } = await setup();
  const old = state().update({ changes: { from: 0, insert: "late" } });
  const session = state().field(editorFaultSession);
  reportEditorFault(session, "parser");
  expect(c.enterSafeSource(snapshot.documentId, session)).toBe(true);
  expect(c.updateEditor(snapshot.documentId, old)).toBe(false);
  expect(c.canToggleSourceMode()).toBe(false);
  await c.closeActive();
  await c.select();
  expect(c.enterSafeSource(snapshot.documentId, session)).toBe(false);
  expect(c.getMode(snapshot.documentId)).toBe("editing");
  expect(state().field(rawText)).toBe(snapshot.text);
});

test("registry consults current composition and write capability at dispatch", async () => {
  const { c, snapshot, state, readonly } = await setup();
  expect(
    c.updateEditor(
      snapshot.documentId,
      state().update({ changes: { from: 0, insert: "edit" } })
    )
  ).toBe(true);
  let invoked = 0;
  const registry = createCommandRegistry(
    () => {
      throw new Error("unexpected forward");
    },
    () => {
      throw new Error("unexpected failure");
    }
  );
  registry.registerCommandHandlers(
    {
      undoDocument: () => {
        invoked++;
        c.runHistory("undo");
      },
      saveDocument: () => {
        invoked++;
      },
      toggleSourceMode: () => {
        invoked++;
        c.toggleSourceMode();
      },
    },
    {
      undoDocument: c.canUndo,
      saveDocument: c.canSave,
      toggleSourceMode: c.canToggleSourceMode,
    }
  );
  expect(registry.isCommandEnabled("undoDocument")).toBe(true);
  c.setInteractionCheck(() => false);
  for (const type of [
    "undoDocument",
    "saveDocument",
    "toggleSourceMode",
  ] as const) {
    expect(registry.isCommandEnabled(type)).toBe(false);
    registry.executeCommand({ type, args: {} });
  }
  expect(invoked).toBe(0);
  c.setInteractionCheck(() => true);
  await readonly();
  for (const type of ["undoDocument", "saveDocument"] as const) {
    expect(registry.isCommandEnabled(type)).toBe(false);
    registry.executeCommand({ type, args: {} });
  }
  expect(invoked).toBe(0);
  expect(registry.isCommandEnabled("toggleSourceMode")).toBe(true);
  registry.executeCommand({ type: "toggleSourceMode", args: {} });
  expect(invoked).toBe(1);
  expect(c.getMode(snapshot.documentId)).toBe("source");
  expect(state().field(rawText)).toBe("edit" + snapshot.text);
});
