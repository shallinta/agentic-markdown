import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";

import {
  DOCUMENT_PROTOCOL_VERSION,
  MAX_DOCUMENT_BYTES,
  type DocumentErrorCode,
  type DocumentResponse,
  type DocumentService,
  type DocumentSnapshot,
} from "../../shared/documents";

import {
  authorizeSingleFile,
  DocumentPathError,
  fileFingerprint,
  verifySingleFileAuthorization,
  type SingleFileAuthorization,
} from "./path-authorization";

interface Identity {
  documentId: string;
  hash: string;
  revision: number;
}
interface Grant extends SingleFileAuthorization {
  handle: string;
  path: string;
  identityKey: string;
}
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class DocumentFailure extends Error {
  constructor(readonly code: DocumentErrorCode) {
    super(code);
  }
}

function validate(
  value: unknown,
  needsHandle: boolean
): value is {
  protocolVersion: 1;
  requestId: string;
  handle: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  const allowed = needsHandle
    ? ["protocolVersion", "requestId", "handle"]
    : ["protocolVersion", "requestId"];
  return (
    Object.keys(request).every((key) => allowed.includes(key)) &&
    request.protocolVersion === DOCUMENT_PROTOCOL_VERSION &&
    typeof request.requestId === "string" &&
    request.requestId.length > 0 &&
    request.requestId.length <= 80 &&
    (!needsHandle ||
      (typeof request.handle === "string" && uuidPattern.test(request.handle)))
  );
}

/** Session-only, read-only grants. No caller-supplied path can authorize a read. */
export function createDocumentService({
  pickFile,
}: {
  pickFile: () => Promise<string | null>;
}): DocumentService {
  let active: Grant | null = null;
  let selecting = false;
  let disposed = false;
  let epoch = 0;
  let queue = Promise.resolve();
  const identities = new Map<string, Identity>();
  const result = (
    requestId: string,
    snapshot: DocumentSnapshot | null
  ): DocumentResponse => ({
    protocolVersion: 1,
    requestId,
    ok: true,
    snapshot,
  });
  const failure = (
    requestId: string,
    error: DocumentErrorCode
  ): DocumentResponse => ({ protocolVersion: 1, requestId, ok: false, error });
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation);
    queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };
  const close = async (grant: Grant | null) => {
    await grant?.file.close().catch(() => undefined);
  };
  const checkLive = (generation: number) => {
    if (disposed || generation !== epoch)
      throw new DocumentFailure("INVALID_HANDLE");
  };

  async function snapshot(
    grant: Grant,
    generation: number
  ): Promise<DocumentSnapshot> {
    checkLive(generation);
    const before = await verifySingleFileAuthorization(grant);
    if (before.size > BigInt(MAX_DOCUMENT_BYTES))
      throw new DocumentFailure("TOO_LARGE");
    const bytes = Buffer.alloc(
      Math.min(Number(before.size) + 1, MAX_DOCUMENT_BYTES + 1)
    );
    let length = 0;
    while (length < bytes.length) {
      const read = await grant.file.read(
        bytes,
        length,
        bytes.length - length,
        length
      );
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await verifySingleFileAuthorization(grant);
    checkLive(generation);
    if (
      fileFingerprint(before) !== fileFingerprint(after) ||
      before.size !== after.size ||
      BigInt(length) !== before.size ||
      BigInt(length) !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw new DocumentFailure("FILE_CHANGED");
    }
    if (length > MAX_DOCUMENT_BYTES) throw new DocumentFailure("TOO_LARGE");
    const content = bytes.subarray(0, length);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        content
      );
    } catch {
      throw new DocumentFailure("INVALID_UTF8");
    }
    const hash = createHash("sha256").update(content).digest("hex");
    const previous = identities.get(grant.identityKey);
    const identity = {
      documentId: previous?.documentId ?? randomUUID(),
      hash,
      revision: previous
        ? previous.revision + Number(previous.hash !== hash)
        : 1,
    };
    identities.set(grant.identityKey, identity);
    return {
      handle: grant.handle,
      ...identity,
      fileName: basename(grant.path),
      byteLength: length,
      text,
    };
  }

  return {
    async select(request) {
      if (!validate(request, false)) return failure("", "INVALID_REQUEST");
      if (disposed) return failure(request.requestId, "INVALID_HANDLE");
      if (selecting) return failure(request.requestId, "BUSY");
      selecting = true;
      const generation = epoch;
      try {
        const selected = await pickFile();
        checkLive(generation);
        if (selected === null) return result(request.requestId, null);
        return await serialize(async () => {
          let candidate: Grant | null = null;
          try {
            checkLive(generation);
            const authorization = await authorizeSingleFile(selected);
            candidate = {
              ...authorization,
              handle: randomUUID(),
              identityKey: `${authorization.path}:${authorization.fingerprint}`,
            };
            const next = await snapshot(candidate, generation);
            checkLive(generation);
            const previous = active;
            active = candidate;
            candidate = null;
            await close(previous);
            checkLive(generation);
            return result(request.requestId, next);
          } finally {
            await close(candidate);
          }
        });
      } catch (error) {
        return failure(
          request.requestId,
          error instanceof DocumentFailure || error instanceof DocumentPathError
            ? error.code
            : "READ_FAILED"
        );
      } finally {
        selecting = false;
      }
    },
    async read(request) {
      if (!validate(request, true)) return failure("", "INVALID_REQUEST");
      const grant = active;
      const generation = epoch;
      return serialize(async () => {
        if (
          disposed ||
          !grant ||
          active !== grant ||
          request.handle !== grant.handle
        )
          return failure(request.requestId, "INVALID_HANDLE");
        try {
          return result(request.requestId, await snapshot(grant, generation));
        } catch (error) {
          const code =
            error instanceof DocumentFailure ||
            error instanceof DocumentPathError
              ? error.code
              : "READ_FAILED";
          if (code === "FILE_CHANGED" && active === grant) {
            active = null;
            await close(grant);
          }
          return failure(request.requestId, code);
        }
      });
    },
    async release(request) {
      if (!validate(request, true)) return failure("", "INVALID_REQUEST");
      if (disposed || active?.handle !== request.handle)
        return failure(request.requestId, "INVALID_HANDLE");
      const grant = active;
      active = null;
      epoch++;
      await serialize(() => close(grant));
      return result(request.requestId, null);
    },
    async dispose() {
      disposed = true;
      epoch++;
      const grant = active;
      active = null;
      await serialize(() => close(grant));
      identities.clear();
    },
  };
}
