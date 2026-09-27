import { expect, test } from "bun:test";

import type {
  DocumentSnapshot,
  SaveDocumentRequest,
} from "../shared/documents";
import { rawHash, rawPatch } from "../shared/save-content";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { incrementalSave } from "./save-channel";
import { savedReply } from "./save-test-helper";

async function fixture() {
  const text = "\uFEFF中文😀\r\n保留\nCR\r末尾";
  const hash = await rawHash(text);
  const base: DocumentSnapshot = {
    documentId: crypto.randomUUID(),
    handle: crypto.randomUUID(),
    fileName: "sample.md",
    revision: 1,
    text,
    hash,
    byteLength: new TextEncoder().encode(text).length,
    fidelity: analyzeTextFidelity(text),
    mirror: { token: crypto.randomUUID(), revision: 0, hash },
    writeCapability: { writable: true, reason: "writable" },
  };
  const request = {
    protocolVersion: 1 as const,
    requestId: "save",
    handle: base.handle,
    documentId: base.documentId,
    expectedRevision: base.revision,
    expectedHash: base.hash,
    bufferRevision: 1,
  };
  return { base, request };
}
test("raw patch does not split shared emoji surrogate pairs and preserves mixed newline bytes", () => {
  for (const [before, after] of [
    ["😀", "😁"],
    ["😀", ""],
    ["x😀z", "x😁z"],
    ["\uFEFFa\r\nb\nc\r", "\uFEFFa\r\n中\nc\r"],
  ]) {
    const patch = rawPatch(before, after);
    expect(
      before.slice(0, patch.from) + patch.insert + before.slice(patch.to)
    ).toBe(after);
    expect(
      new TextDecoder("utf-8", { ignoreBOM: true }).decode(
        new TextEncoder().encode(patch.insert)
      )
    ).toBe(patch.insert);
  }
});
test("trusted mismatch retries captured text once; no disk baseline or caller state is replaced", async () => {
  const { base, request } = await fixture(),
    text = base.text + "目标";
  const sent: SaveDocumentRequest[] = [];
  const outcome = await incrementalSave(
    request,
    base,
    text,
    (req) => {
      sent.push(req);
      return Promise.resolve(
        sent.length === 1
          ? {
              protocolVersion: 1,
              requestId: req.requestId,
              ok: false,
              error: "MIRROR_MISMATCH",
              recovery: {
                token: crypto.randomUUID(),
                revision: 1,
                hash: req.content.targetHash,
              },
            }
          : savedReply(req, base)
      );
    },
    () => undefined
  );
  expect(sent).toHaveLength(2);
  expect(sent[0].content.kind).toBe("patch");
  expect(sent[1].content).toEqual({
    kind: "resync",
    text,
    targetHash: await rawHash(text),
  });
  expect(sent[1].expectedHash).toBe(base.hash);
  expect(sent[1].requestId).not.toBe(sent[0].requestId);
  expect(outcome.response).toMatchObject({ ok: true, snapshot: { text } });
});
test("conflict, readonly, malformed recovery, repeated mismatch never create unbounded retries", async () => {
  for (const error of [
    "CONFLICT",
    "READ_ONLY",
    "SAVE_UNCERTAIN",
    "MIRROR_MISMATCH",
  ]) {
    const { base, request } = await fixture();
    let calls = 0;
    await incrementalSave(
      request,
      base,
      base.text + "x",
      (req) => {
        calls++;
        return Promise.resolve({
          protocolVersion: 1,
          requestId: req.requestId,
          ok: false,
          error,
          recovery: {
            token: crypto.randomUUID(),
            revision: 1,
            hash: req.content.targetHash,
          },
        });
      },
      () => undefined
    );
    expect(calls).toBe(error === "MIRROR_MISMATCH" ? 2 : 1);
  }
  const { base, request } = await fixture();
  let calls = 0;
  await incrementalSave(
    request,
    base,
    base.text + "x",
    (req) => {
      calls++;
      return Promise.resolve({
        protocolVersion: 1,
        requestId: req.requestId,
        ok: false,
        error: "MIRROR_MISMATCH",
        recovery: {},
      });
    },
    () => undefined
  );
  expect(calls).toBe(1);
});
test("metadata ACK must match captured hash and revision and must not contain a second body", async () => {
  const { base, request } = await fixture();
  for (const corrupt of ["hash", "mirror", "text"] as const) {
    expect(
      await incrementalSave(
        request,
        base,
        base.text + "x",
        (req) => {
          const reply = savedReply(req, base);
          return Promise.resolve({
            ...reply,
            snapshot: {
              ...reply.snapshot,
              [corrupt]:
                corrupt === "mirror"
                  ? { ...reply.snapshot.mirror, revision: 999 }
                  : "forged",
            },
          });
        },
        () => undefined
      ).then(
        () => false,
        () => true
      )
    ).toBe(true);
  }
});
