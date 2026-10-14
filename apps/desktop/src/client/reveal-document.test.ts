import { expect, test } from "bun:test";

import type { ObservationRequest } from "../shared/document-observation";
import type { DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDocumentController } from "./documents";
import { rawText } from "./raw-buffer";

test("default application open preserves dirty buffer and history without save or reread", async () => {
  const tab: DocumentSnapshot = {
    handle: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    fileName: "a.md",
    revision: 1,
    hash: "a".repeat(64),
    byteLength: 3,
    text: "old",
    fidelity: analyzeTextFidelity("old"),
    writeCapability: { writable: true, reason: "writable" },
  };
  let writes = 0,
    reads = 0,
    opens = 0;
  const controller = createDocumentController({
    selectDocument: (request) =>
      Promise.resolve({ ...request, ok: true, snapshot: tab }),
    readDocument: () => {
      reads++;
      return Promise.resolve();
    },
    saveDocument: () => {
      writes++;
      return Promise.resolve();
    },
    releaseDocument: () => Promise.resolve(),
    cancelDocument: () => Promise.resolve(),
    openDefaultDocument: (request) => {
      opens++;
      return Promise.resolve({ ...request, ok: true, snapshot: null });
    },
  });
  await controller.select();
  const initial = controller.getEditor(tab.documentId)!;
  expect(
    controller.updateEditor(
      tab.documentId,
      initial.state.update({ changes: { from: 0, insert: "dirty " } })
    )
  ).toBe(true);
  const dirty = controller.getEditor(tab.documentId)!;
  expect(controller.isDirty(tab.documentId)).toBe(true);
  await controller.openDefaultDocument();
  expect(opens).toBe(1);
  expect(writes).toBe(0);
  expect(reads).toBe(0);
  expect(controller.getEditor(tab.documentId)).toBe(dirty);
  expect(dirty.state.field(rawText)).toBe("dirty old");
  expect(controller.isDirty(tab.documentId)).toBe(true);
  controller.dispose();
});

for (const action of [
  "revealCurrentDocument",
  "openDefaultDocument",
] as const) {
  test(`${action} publishes new snapshots, preserves readonly, cancels IME and ignores stale failure`, async () => {
    const tab: DocumentSnapshot = {
      handle: crypto.randomUUID(),
      documentId: crypto.randomUUID(),
      fileName: "a.md",
      revision: 1,
      hash: "a".repeat(64),
      byteLength: 3,
      text: "old",
      fidelity: analyzeTextFidelity("old"),
      writeCapability: { writable: false, reason: "readonly" },
    };
    const observed: ObservationRequest[] = [],
      cancelled: string[] = [];
    let resolve!: (value: unknown) => void,
      allowed = true;
    const controller = createDocumentController({
      selectDocument: (request) =>
        Promise.resolve({ ...request, ok: true, snapshot: tab }),
      readDocument: (request) =>
        Promise.resolve({ ...request, ok: true, snapshot: tab }),
      releaseDocument: () => Promise.resolve(),
      cancelDocument: (request) => {
        cancelled.push(request.requestId);
        return Promise.resolve();
      },
      observeDocument: (request) => {
        observed.push(request);
        return Promise.resolve({ ok: true, requestId: request.requestId });
      },
      revealDocument: () =>
        new Promise((done) => {
          resolve = done;
        }),
      openDefaultDocument: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    await controller.select();
    controller.setInteractionCheck(() => allowed);
    expect(controller.canRevealDocument()).toBe(true);
    const before = controller.getSnapshot();
    const pending = controller[action]();
    expect(controller.canRevealDocument()).toBe(false);
    expect(controller.getSnapshot()).not.toBe(before);
    allowed = false;
    controller.notifyInteraction();
    expect(cancelled.length).toBe(1);
    resolve({ ok: false });
    await pending;
    expect(controller.getSnapshot().error).toBeNull();
    allowed = true;
    controller.notifyInteraction();
    expect(controller.canRevealDocument()).toBe(true);
    const { active: _active, requestId: _request, ...binding } = observed[0];
    void _active;
    void _request;
    controller.applyExternalObservation({
      ...binding,
      status: "content-changed",
      generation: 1,
    });
    expect(controller.canRevealDocument()).toBe(true);
    controller.applyExternalObservation({
      ...binding,
      status: "missing",
      generation: 2,
    });
    expect(controller.canRevealDocument()).toBe(false);
    expect(controller.getSnapshot().snapshot?.text).toBe("old");
    controller.dispose();
  });
}
