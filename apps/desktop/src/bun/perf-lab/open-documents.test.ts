import { expect, test } from "bun:test";

import {
  createDocumentController,
  isDocumentResponse,
  type DocumentTransport,
} from "../../client/documents";
import { rawText } from "../../client/raw-buffer";
import type { DocumentResponse } from "../../shared/documents";
import { OPEN_PROBE_CASES, openProbeText } from "../../shared/open-probe";

import { createOpenDocumentLab } from "./open-documents";

test("open lab is disabled by default and rejects paths, bodies, sample IDs and foreign handles", async () => {
  const disabled = createOpenDocumentLab(false);
  expect((await disabled.run({ op: "open-start" })).error).toBe("DISABLED");
  const lab = createOpenDocumentLab(true);
  try {
    expect(
      (await lab.run({ op: "open-start", path: "/etc/passwd" })).error
    ).toBe("INVALID");
    const { runId } = await lab.run({ op: "open-start" });
    expect(runId).toBeDefined();
    for (const sample of [-1, 6, 0.5, "0"])
      expect((await lab.run({ op: "open-prepare", runId, sample })).error).toBe(
        "INVALID"
      );
    expect(
      (
        await lab.run({
          op: "open-prepare",
          runId,
          sample: 0,
          text: "injected",
        })
      ).error
    ).toBe("INVALID");
    const response = await lab.run({
      op: "open-call",
      runId,
      action: "read",
      sample: 0,
      request: {
        protocolVersion: 1,
        requestId: "foreign",
        handle: crypto.randomUUID(),
      },
    });
    expect(response.document).toMatchObject({
      ok: false,
      error: "INVALID_HANDLE",
    });
  } finally {
    await lab.dispose();
  }
});

test("six bounded real disk samples traverse service and controller, save and reread exact raw", async () => {
  const lab = createOpenDocumentLab(true);
  const { runId } = await lab.run({ op: "open-start" });
  try {
    for (let sample = 0; sample < OPEN_PROBE_CASES; sample++) {
      const raw = openProbeText(sample);
      expect(new TextEncoder().encode(raw).length).toBeLessThan(1024 * 1024);
      expect((await lab.run({ op: "open-prepare", runId, sample })).ok).toBe(
        true
      );
      let metrics: Record<string, number> | undefined;
      const call = async (action: string, request: unknown) => {
        const response = await lab.run({
          op: "open-call",
          runId,
          action,
          sample,
          request,
        });
        expect(response.ok).toBe(true);
        if (action === "select") metrics = response.openMetrics;
        return response.document;
      };
      const transport: DocumentTransport = {
        selectDocument: (request) => call("select", request),
        readDocument: (request) => call("read", request),
        saveDocument: (request) => call("save", request),
        cancelDocument: (request) => call("cancel", request),
        releaseDocument: (request) => call("release", request),
        checkDocumentWriteCapability: (request) =>
          call("checkWriteCapability", request),
        waitForDocumentSaves: (request) => call("waitForSaves", request),
      };
      let stateMs = -1;
      const controller = createDocumentController(
        transport,
        () => Promise.resolve(false),
        5000,
        (_key, ms) => {
          stateMs = ms;
        }
      );
      await controller.select();
      const snapshot = controller.getSnapshot().snapshot;
      expect(snapshot?.text).toBe(raw);
      if (!snapshot) throw new Error("No real snapshot");
      expect(stateMs).toBeGreaterThanOrEqual(0);
      for (const key of [
        "pickerMs",
        "authorizeMs",
        "diskReadMs",
        "decodeAnalyzeMs",
        "backendDocumentMs",
      ])
        expect(metrics?.[key]).toBeGreaterThanOrEqual(0);
      expect(metrics?.pickerNative).toBe(0);
      const editor = controller.getEditor(snapshot.documentId);
      if (!editor) throw new Error("No editor");
      expect(
        controller.updateEditor(
          snapshot.documentId,
          editor.state.update({
            changes: { from: editor.state.doc.length, insert: "!" },
          })
        )
      ).toBe(true);
      await controller.save();
      expect(controller.isDirty(snapshot.documentId)).toBe(false);
      expect(controller.runHistory("undo")).toBe(true);
      expect(
        controller.getEditor(snapshot.documentId)?.state.field(rawText)
      ).toBe(raw);
      expect(controller.runHistory("redo")).toBe(true);
      await controller.reload();
      expect(controller.getSnapshot().snapshot?.text).toBe(raw + "!");
      const released = await lab.run({
        op: "open-call",
        runId,
        action: "release",
        sample,
        request: {
          protocolVersion: 1,
          requestId: "release",
          handle: snapshot.handle,
        },
      });
      expect((released.document as DocumentResponse).ok).toBe(true);
      // Service teardown below releases remaining re-read grants. No user documents.
    }
  } finally {
    await lab.dispose();
  }
}, 30_000);

test("failed reload cannot pass using the saved but retained old snapshot", async () => {
  const lab = createOpenDocumentLab(true);
  const { runId } = await lab.run({ op: "open-start" });
  const pending: Promise<unknown>[] = [];
  const raw = openProbeText(0);
  let failRead = true;
  let readSucceeded = false;
  const call = async (action: string, request: unknown) => {
    const operation = lab.run({
      op: "open-call",
      runId,
      sample: 0,
      action,
      request,
    });
    pending.push(operation);
    const result = await operation;
    if (!result.ok) throw new Error("Lab request failed");
    return result.document;
  };
  const controller = createDocumentController({
    waitForDocumentSaves: (request) => call("waitForSaves", request),
    selectDocument: (request) => call("select", request),
    saveDocument: (request) => call("save", request),
    releaseDocument: (request) => call("release", request),
    cancelDocument: (request) => call("cancel", request),
    readDocument: async (request) => {
      readSucceeded = false;
      const result = failRead
        ? {
            protocolVersion: 1,
            requestId: request.requestId,
            ok: false,
            error: "READ_FAILED",
          }
        : await call("read", request);
      readSucceeded =
        isDocumentResponse(result, request.requestId) &&
        result.ok &&
        result.snapshot?.text === raw + "!";
      return result;
    },
  });
  try {
    await lab.run({ op: "open-prepare", runId, sample: 0 });
    await controller.select();
    const snapshot = controller.getSnapshot().snapshot!;
    const state = controller.getEditor(snapshot.documentId)!.state;
    controller.updateEditor(
      snapshot.documentId,
      state.update({ changes: { from: state.doc.length, insert: "!" } })
    );
    await controller.save();
    expect(controller.isDirty(snapshot.documentId)).toBe(false);
    await controller.reload();
    // These two old equality checks alone would incorrectly report success.
    expect(controller.getSnapshot().snapshot?.text).toBe(raw + "!");
    expect(
      controller.getEditor(snapshot.documentId)?.state.field(rawText)
    ).toBe(raw + "!");
    expect(readSucceeded).toBe(false);
    expect(controller.getSnapshot().error).not.toBeNull();
    expect(controller.getSnapshot().stale).toBe(true);
    failRead = false;
    await controller.reload();
    expect(readSucceeded).toBe(true);
    expect(controller.getSnapshot().error).toBeNull();
    expect(controller.getSnapshot().stale).toBe(false);
    expect(controller.getSnapshot().snapshot?.text).toBe(raw + "!");
  } finally {
    controller.dispose();
    await Promise.allSettled(pending);
    await lab.dispose();
  }
});
