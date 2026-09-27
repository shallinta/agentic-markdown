import { expect, test } from "bun:test";

import { undoDepth } from "@codemirror/commands";
import { language, syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";

import type {
  DocumentSnapshot,
  SaveDocumentRequest,
} from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDocumentController, type DocumentTransport } from "./documents";
import { editorFaultSession, reportEditorFault } from "./editor-fault";
import { rawText } from "./raw-buffer";

function setup() {
  const values: DocumentSnapshot[] = [0, 1, 2].map((index) => {
    const text = `\uFEFF# doc ${index}\r\n中文🙂`;
    return {
      handle: crypto.randomUUID(),
      documentId: crypto.randomUUID(),
      fileName: `${index}.md`,
      revision: 1,
      hash: "a".repeat(64),
      text,
      byteLength: new TextEncoder().encode(text).length,
      fidelity: analyzeTextFidelity(text),
      writeCapability: { writable: true, reason: "writable" },
    };
  });
  let index = 0;
  const transport: DocumentTransport = {
    selectDocument: (request) =>
      Promise.resolve({
        ...request,
        ok: true,
        snapshot: values[index++ % values.length],
      }),
    readDocument: (request) =>
      Promise.resolve({
        ...request,
        ok: true,
        snapshot: values.find((value) => value.handle === request.handle),
      }),
    cancelDocument: () => Promise.resolve(null),
    releaseDocument: () => Promise.resolve(null),
  };
  const controller = createDocumentController(transport, () =>
    Promise.resolve(true)
  );
  return { controller, values, transport };
}

test("inactive parser cache is removed without losing raw, revision, history, selection or mode", async () => {
  const { controller, values } = setup();
  await controller.select();
  const id = values[0].documentId;
  const initial = controller.getEditor(id)!;
  controller.updateEditor(
    id,
    initial.state.update({
      changes: { from: initial.state.doc.length, insert: "!" },
      selection: EditorSelection.range(2, 5),
      userEvent: "input.type",
    })
  );
  controller.toggleSourceMode();
  const before = controller.getEditor(id)!;
  const fault = before.state.field(editorFaultSession);
  const staleTransaction = before.state.update({
    changes: { from: 0, insert: "stale" },
  });
  await controller.select();
  await controller.select();
  const states = values.map(
    (value) => controller.getEditor(value.documentId)!.state
  );
  expect(states.map((value) => !!value.facet(language))).toEqual([
    false,
    false,
    true,
  ]);
  expect(states.slice(0, 2).map((value) => syntaxTree(value).length)).toEqual([
    0, 0,
  ]);
  const asleep = controller.getEditor(id)!;
  expect(asleep.state.doc).toBe(before.state.doc);
  expect(asleep.state.selection).toBe(before.state.selection);
  expect(asleep.state.field(rawText)).toBe(before.state.field(rawText));
  expect(asleep.state.field(editorFaultSession)).toBe(fault);
  expect(asleep.revision).toBe(before.revision);
  expect(undoDepth(asleep.state)).toBe(undoDepth(before.state));
  expect(controller.getMode(id)).toBe("source");
  expect(controller.isDirty(id)).toBe(true);
  expect(controller.updateEditor(id, staleTransaction)).toBe(false);
  for (let i = 0; i < 5; i++) {
    controller.activateTab(id);
    expect(controller.getEditor(id)!.state.facet(language)).not.toBeNull();
    expect(syntaxTree(controller.getEditor(id)!.state).length).toBe(
      before.state.doc.length
    );
    expect(controller.getEditor(id)!.revision).toBe(before.revision);
    controller.activateTab(values[1].documentId);
    expect(syntaxTree(controller.getEditor(id)!.state).length).toBe(0);
  }
  controller.activateTab(id);
  expect(controller.runHistory("undo")).toBe(true);
  expect(controller.getEditor(id)!.state.field(rawText)).toBe(values[0].text);
});

test("safe source, reload, close fallback and composition gating preserve isolation", async () => {
  const { controller, values } = setup();
  await controller.select();
  const id = values[0].documentId;
  const session = controller.getEditorFault(id)!;
  reportEditorFault(session, "presentation");
  expect(controller.enterSafeSource(id, session)).toBe(true);
  await controller.select();
  controller.setInteractionCheck(() => false);
  controller.activateTab(id);
  expect(controller.getSnapshot().snapshot?.documentId).toBe(
    values[1].documentId
  );
  controller.setInteractionCheck(() => true);
  controller.activateTab(id);
  expect(controller.isSafeSource(id)).toBe(true);
  expect(controller.getEditor(id)!.state.facet(language)).toBeNull();
  await controller.reload();
  expect(controller.isSafeSource(id)).toBe(true);
  expect(controller.getEditor(id)!.state.facet(language)).toBeNull();
  await controller.closeTab(id);
  expect(controller.getSnapshot().snapshot?.documentId).toBe(
    values[1].documentId
  );
  expect(
    controller.getEditor(values[1].documentId)!.state.facet(language)
  ).not.toBeNull();
  const before = controller.getEditor(values[1].documentId)!.state;
  controller.notifyInteraction();
  controller.activateTab(values[1].documentId);
  expect(controller.getEditor(values[1].documentId)!.state).toBe(before);
});

test("save capture continues while parser cache is inactive and response does not reactivate it", async () => {
  const { controller, values, transport } = setup();
  let finish!: (value: unknown) => void;
  let saved!: SaveDocumentRequest;
  transport.saveDocument = (request) => {
    saved = request;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  await controller.select();
  await controller.select();
  const id = values[0].documentId;
  controller.activateTab(id);
  const initial = controller.getEditor(id)!;
  controller.updateEditor(
    id,
    initial.state.update({ changes: { from: 0, insert: "x" } })
  );
  const text = controller.getEditor(id)!.state.field(rawText);
  const operation = controller.save();
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.activateTab(values[1].documentId);
  expect(controller.getSaveStatus(id).status).toBe("saving");
  expect(controller.getEditor(id)!.state.facet(language)).toBeNull();
  const snapshot = {
    ...values[0],
    fidelity: analyzeTextFidelity(text),
    byteLength: new TextEncoder().encode(text).length,
    revision: 2,
    hash: saved.content.targetHash,
    mirror: {
      token: crypto.randomUUID(),
      revision: saved.bufferRevision,
      hash: saved.content.targetHash,
    },
  };
  const { text: _source, ...receipt } = snapshot;
  expect(_source).toBe(values[0].text);
  finish({
    protocolVersion: 1,
    requestId: saved.requestId,
    ok: true,
    snapshot: receipt,
    savedBufferRevision: saved.bufferRevision,
  });
  await operation;
  expect(controller.getSaveStatus(id).status).toBe("saved");
  expect(controller.getEditor(id)!.state.facet(language)).toBeNull();
  expect(controller.getEditor(id)!.revision).toBe(1);
  expect(controller.getEditor(id)!.state.field(rawText)).toBe(text);
});

test("read-only content and per-document source mode survive pause, reselection and reload", async () => {
  const { controller, values } = setup();
  const id = values[0].documentId;
  values[0].writeCapability = { writable: false, reason: "readonly" };
  await controller.select();
  expect(controller.toggleSourceMode()).toBe(true);
  await controller.select();
  await controller.select();
  await controller.select(); // select same identity, not a new document
  expect(controller.getSnapshot().tabs).toHaveLength(3);
  expect(controller.getMode(id)).toBe("source");
  expect(controller.getEditor(id)!.state.facet(language)).not.toBeNull();
  const current = controller.getEditor(id)!;
  expect(
    controller.updateEditor(
      id,
      current.state.update({ changes: { from: 0, insert: "forbidden" } })
    )
  ).toBe(false);
  expect(controller.getEditor(id)!.revision).toBe(0);
  await controller.reload();
  expect(controller.getMode(id)).toBe("source");
  expect(controller.getEditor(id)!.state.field(rawText)).toBe(values[0].text);
  expect(controller.canWrite(id)).toBe(false);
});
