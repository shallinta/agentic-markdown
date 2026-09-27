import { createHash, randomUUID } from "node:crypto";

import {
  MAX_DOCUMENT_BYTES,
  type BufferMirrorIdentity,
  type SaveDocumentRequest,
} from "../../shared/documents";
import {
  hashPattern,
  rawBoundary,
  validMirror,
} from "../../shared/save-content";

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function validateSaveContent(
  value: unknown
): value is SaveDocumentRequest["content"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  const keys =
    c.kind === "patch"
      ? ["kind", "from", "to", "insert", "targetHash"]
      : ["kind", "text", "targetHash"];
  if (
    Object.keys(c).length !== keys.length ||
    !keys.every((key) => key in c) ||
    typeof c.targetHash !== "string" ||
    !hashPattern.test(c.targetHash)
  )
    return false;
  const text = c.kind === "patch" ? c.insert : c.text;
  return (
    (c.kind === "resync" ||
      (c.kind === "patch" &&
        Number.isSafeInteger(c.from) &&
        Number.isSafeInteger(c.to) &&
        (c.from as number) >= 0 &&
        (c.to as number) >= (c.from as number))) &&
    typeof text === "string" &&
    text.length <= MAX_DOCUMENT_BYTES &&
    Buffer.from(text).toString("utf8") === text
  );
}

export function createBufferMirrors(limit = 16) {
  const mirrors = new Map<
    string,
    { identity: BufferMirrorIdentity; text?: string }
  >();
  const recovery = new Map<
    string,
    { identity: BufferMirrorIdentity; baseline: string }
  >();
  function put(handle: string, text: string, revision: number) {
    const identity = { token: randomUUID(), revision, hash: digest(text) };
    mirrors.delete(handle);
    mirrors.set(handle, { identity, text });
    recovery.delete(handle);
    while (mirrors.size > limit) mirrors.delete(mirrors.keys().next().value!);
    return identity;
  }
  return {
    put,
    clear() {
      mirrors.clear();
      recovery.clear();
    },
    release(handle: string) {
      mirrors.delete(handle);
      recovery.delete(handle);
    },
    prepare(
      request: SaveDocumentRequest
    ):
      | { ok: true; text: string }
      | { ok: false; error: "MIRROR_MISMATCH"; recovery: BufferMirrorIdentity }
      | { ok: false; error: "INVALID_REQUEST" | "TOO_LARGE" } {
      const entry = mirrors.get(request.handle);
      const baseline = `${request.documentId}:${request.expectedRevision}:${request.expectedHash}`;
      const pendingRecovery = recovery.get(request.handle);
      const expected =
        request.content.kind === "resync"
          ? pendingRecovery?.baseline === baseline
            ? pendingRecovery.identity
            : undefined
          : entry?.identity;
      if (
        !expected ||
        !validMirror(request.mirror) ||
        expected.token !== request.mirror.token ||
        expected.revision !== request.mirror.revision ||
        expected.hash !== request.mirror.hash
      ) {
        const token = {
          token: randomUUID(),
          revision: request.bufferRevision,
          hash: request.content.targetHash,
        };
        recovery.set(request.handle, { identity: token, baseline });
        while (recovery.size > limit)
          recovery.delete(recovery.keys().next().value!);
        return { ok: false, error: "MIRROR_MISMATCH", recovery: token };
      }
      const c = request.content;
      let text: string;
      if (c.kind === "patch") {
        const base = entry!.text!;
        if (
          c.to > base.length ||
          !rawBoundary(base, c.from) ||
          !rawBoundary(base, c.to) ||
          request.bufferRevision <= expected.revision
        )
          return { ok: false, error: "INVALID_REQUEST" };
        text = base.slice(0, c.from) + c.insert + base.slice(c.to);
      } else {
        if (
          c.targetHash !== expected.hash ||
          request.bufferRevision !== expected.revision
        )
          return { ok: false, error: "INVALID_REQUEST" };
        text = c.text;
        recovery.delete(request.handle);
      }
      if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES)
        return { ok: false, error: "TOO_LARGE" };
      if (digest(text) !== c.targetHash)
        return { ok: false, error: "INVALID_REQUEST" };
      return { ok: true, text };
    },
  };
}
