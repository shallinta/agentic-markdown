import { expect, test } from "bun:test";

import type { ObservationRequest } from "../shared/document-observation";
import type { DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDocumentController } from "./documents";

test("reveal availability publishes new snapshots, preserves readonly, cancels IME and ignores stale failure", async () => {
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
  });
  await controller.select();
  controller.setInteractionCheck(() => allowed);
  expect(controller.canRevealDocument()).toBe(true);
  const before = controller.getSnapshot();
  const pending = controller.revealCurrentDocument();
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
