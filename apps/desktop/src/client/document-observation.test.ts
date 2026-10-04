import { expect, test } from "bun:test";

import type { ObservationRequest } from "../shared/document-observation";
import type { DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDiscardGuard } from "./discard-guard";
import { canonicalDiscardParticipant } from "./document-canonical";
import { createDocumentObservation } from "./document-observation";
import { createDocumentController } from "./documents";

const snapshot = (): DocumentSnapshot => ({ handle: crypto.randomUUID(), documentId: crypto.randomUUID(), fileName: "a.md", revision: 1, hash: "a".repeat(64), byteLength: 3, text: "old", fidelity: analyzeTextFidelity("old"), writeCapability: { writable: true, reason: "writable" } });
test("transport coalesces queued revisions behind four in-flight handles and prioritizes cancellation", async () => {
  const tabs = Array.from({ length: 6 }, snapshot), sent: ObservationRequest[] = [];
  const releases: (() => void)[] = [];
  const service = createDocumentObservation(request => {
    sent.push(request);
    if (sent.length <= 4) return new Promise(resolve => releases.push(() => resolve({ ok: true, requestId: request.requestId })));
    return Promise.resolve({ ok: true, requestId: request.requestId });
  }, () => undefined, 1000);
  service.sync(tabs); expect(sent.length).toBe(4);
  for (let revision = 2; revision <= 301; revision++) service.sync(tabs.map((tab, i) => i === 4 ? { ...tab, revision } : tab));
  service.sync(tabs.slice(0, 5).map((tab, i) => i === 4 ? { ...tab, revision: 301 } : tab));
  expect(sent.length).toBe(4);
  releases[0](); await Bun.sleep(5);
  expect(sent[4].handle).toBe(tabs[5].handle); expect(sent[4].active).toBe(false);
  const delivered = sent.filter(item => item.handle === tabs[4].handle);
  expect(delivered.length).toBe(1); expect(delivered[0].revision).toBe(301);
  for (const release of releases) release();
  service.dispose(); await Bun.sleep(5);
});
test("strict lifetime/generation and sticky external risk survive unavailable/same; accepted baseline renews", async () => {
  const sent: ObservationRequest[] = [];
  const service = createDocumentObservation(request => { sent.push(request); return Promise.resolve({ ok: true, requestId: request.requestId }); }, () => undefined);
  const tab = snapshot(); service.sync([tab]); await Bun.sleep(0);
  const { active: _active, requestId: _request, ...binding } = sent[0];
  void _active; void _request;
  service.apply({ ...binding, generation: 1, status: "content-changed" }); expect(service.atRisk(tab.documentId)).toBe(true);
  service.apply({ ...binding, generation: 2, status: "unavailable" }); expect(service.atRisk(tab.documentId)).toBe(true);
  service.apply({ ...binding, generation: 3, status: "unchanged" }); expect(service.atRisk(tab.documentId)).toBe(true);
  service.apply({ ...binding, generation: 2, status: "missing" }); expect(service.status(tab.documentId)).toBe("unchanged");
  expect(service.message(tab.documentId)).toContain("尚未确认");
  service.apply({ ...binding, generation: 4, status: "missing", extra: true }); expect(service.status(tab.documentId)).toBe("unchanged");
  service.accept(tab.documentId); service.sync([tab]);
  service.apply({ ...binding, generation: 99, status: "missing" }); expect(service.atRisk(tab.documentId)).toBe(false);
  service.dispose();
});
test("clean external-risk document protects close, clear and reload without falsifying dirty or replacing editor", async () => {
  for (const status of ["content-changed", "missing", "replaced"] as const) {
    const tab = snapshot(), sent: ObservationRequest[] = [], prompts: string[] = [];
    let reads = 0;
    const controller = createDocumentController({
      observeDocument: request => { sent.push(request); return Promise.resolve({ ok: true, requestId: request.requestId }); },
      selectDocument: request => Promise.resolve({ ...request, ok: true, snapshot: tab }),
      readDocument: request => { reads++; return Promise.resolve({ ...request, ok: true, snapshot: tab }); },
      cancelDocument: request => Promise.resolve({ ...request, ok: true, snapshot: null }),
      releaseDocument: request => Promise.resolve({ ...request, ok: true, snapshot: null }),
    }, message => { prompts.push(message); return Promise.resolve(false); });
    await controller.select(); await Bun.sleep(0);
    const { active: _active, requestId: _request, ...binding } = sent[0];
    void _active; void _request;
    controller.applyExternalObservation({ ...binding, status, generation: 1 });
    const editor = controller.getEditor(tab.documentId);
    expect(controller.isDirty(tab.documentId)).toBe(false); expect(controller.getSaveStatus(tab.documentId).status).toBe("saved");
    expect(controller.hasDiscardable()).toBe(true);
    await controller.closeActive(); await controller.clear(); await controller.reload();
    expect(prompts.length).toBe(3); expect(reads).toBe(0); expect(controller.getEditor(tab.documentId)).toBe(editor);
    expect(controller.getSnapshot().tabs.length).toBe(1);
    controller.dispose();
  }
});

test("native reload/quit/update all protect external-only risk and cancel preserves clean buffer", async () => {
  const tab = snapshot(), sent: ObservationRequest[] = [];
  const controller = createDocumentController({
    observeDocument: request => { sent.push(request); return Promise.resolve({ ok: true, requestId: request.requestId }); },
    selectDocument: request => Promise.resolve({ ...request, ok: true, snapshot: tab }),
    readDocument: request => Promise.resolve({ ...request, ok: true, snapshot: tab }),
    cancelDocument: request => Promise.resolve({ ...request, ok: true, snapshot: null }),
    releaseDocument: request => Promise.resolve({ ...request, ok: true, snapshot: null }),
  });
  await controller.select(); await Bun.sleep(0);
  const { active: _active, requestId: _request, ...binding } = sent[0];
  void _active; void _request;
  controller.applyExternalObservation({ ...binding, status: "missing", generation: 1 });
  const guard = createDiscardGuard();
  guard.register(canonicalDiscardParticipant(controller, { cancel: () => undefined }, undefined, controller.hasDiscardable));
  for (const reason of ["reload", "quit", "update"] as const) {
    const pending = guard.request({ protocolVersion: 1, requestId: crypto.randomUUID(), reason });
    await Bun.sleep(0); expect(guard.getSnapshot()?.message).toContain("内存内容");
    guard.respond(false); expect((await pending).allow).toBe(false);
    expect(controller.getSnapshot().frozen).toBe(false); expect(controller.isDirty(tab.documentId)).toBe(false);
  }
  controller.dispose();
});

test("same-location replacement needs confirmation even when old buffer is clean", async () => {
  const tab = { ...snapshot(), locationId: crypto.randomUUID() }, sent: ObservationRequest[] = [];
  let selected = tab, prompts = 0;
  const controller = createDocumentController({
    observeDocument: request => { sent.push(request); return Promise.resolve({ ok: true, requestId: request.requestId }); },
    selectDocument: request => Promise.resolve({ ...request, ok: true, snapshot: selected }),
    readDocument: request => Promise.resolve({ ...request, ok: true, snapshot: tab }),
    cancelDocument: request => Promise.resolve({ ...request, ok: true, snapshot: null }),
    releaseDocument: request => Promise.resolve({ ...request, ok: true, snapshot: null }),
  }, () => { prompts++; return Promise.resolve(false); });
  await controller.select(); await Bun.sleep(0);
  selected = { ...snapshot(), locationId: tab.locationId };
  await controller.select(); expect(prompts).toBe(1);
  expect(controller.getSnapshot().snapshot?.documentId).toBe(tab.documentId);
  expect(controller.hasDiscardable()).toBe(true); controller.dispose();
});

test("timed out subscription does not block retry or cancellation, late acknowledgement cannot clear risk", async () => {
  const tab = snapshot(), sent: ObservationRequest[] = [];
  let resolve!: (value: unknown) => void;
  const service = createDocumentObservation(request => {
    sent.push(request);
    return sent.length === 1 ? new Promise(r => { resolve = r; }) : Promise.resolve({ ok: true, requestId: request.requestId });
  }, () => undefined, 5);
  service.sync([tab]); await Bun.sleep(20);
  expect(service.status(tab.documentId)).toBe("unavailable");
  service.refresh(); await Bun.sleep(5); expect(sent.length).toBe(2);
  const { active: _active, requestId: _request, ...binding } = sent[1];
  void _active; void _request;
  service.apply({ ...binding, generation: 2, status: "missing" });
  resolve({ ok: true, requestId: sent[0].requestId }); await Bun.sleep(5);
  expect(service.atRisk(tab.documentId)).toBe(true);
  service.dispose(); await Bun.sleep(5); expect(sent[2].active).toBe(false);
});

test("verified refresh recovers unavailable after a previous event without clearing retained risk", async () => {
  const tab = snapshot(), sent: ObservationRequest[] = [];
  let fail = false;
  const service = createDocumentObservation(request => {
    sent.push(request);
    return fail ? new Promise(() => undefined) : Promise.resolve({ ok: true, requestId: request.requestId });
  }, () => undefined, 5);
  service.sync([tab]); await Bun.sleep(0);
  const { active, requestId, ...binding } = sent[0]; void active; void requestId;
  service.apply({ ...binding, status: "content-changed", generation: 1 });
  service.apply({ ...binding, status: "unchanged", generation: 2 });
  fail = true; service.refresh(); await Bun.sleep(15);
  expect(service.status(tab.documentId)).toBe("unavailable");
  fail = false; service.refresh(); await Bun.sleep(1);
  expect(service.status(tab.documentId)).toBe("unavailable"); // ACK is not content verification.
  service.apply({ ...binding, status: "unchanged", generation: 3 });
  expect(service.status(tab.documentId)).toBe("unchanged");
  expect(service.atRisk(tab.documentId)).toBe(true);
  expect(service.message(tab.documentId)).toContain("尚未确认");
  service.dispose();
});
