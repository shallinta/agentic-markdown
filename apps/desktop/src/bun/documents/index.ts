import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { basename } from "node:path";

import {
  DOCUMENT_PROTOCOL_VERSION,
  MAX_DOCUMENT_BYTES,
  type DocumentErrorCode,
  type DocumentResponse,
  type DocumentService,
  type DocumentSnapshot,
} from "../../shared/documents";
import { analyzeTextFidelity } from "../../shared/text-fidelity";

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
  authorize = authorizeSingleFile,
  verify = verifySingleFileAuthorization,
}: {
  pickFile: () => Promise<string | null>;
  authorize?: typeof authorizeSingleFile;
  verify?: typeof verifySingleFileAuthorization;
}): DocumentService {
  const grants = new Map<string, Grant>();
  const locations = new Map<string, string>();
  interface Task {
    id: string;
    cancelled: boolean;
    committed: boolean;
    handle?: string;
    resolve: (response: DocumentResponse) => void;
  }
  let selecting: Task | null = null;
  let running: Task | null = null;
  let pending: {
    task: Task;
    operation: () => Promise<DocumentResponse>;
  } | null = null;
  let disposed = false;
  let epoch = 0;
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
  const cancel = (task: Task | null) => {
    if (!task || task.committed) return;
    task.cancelled = true;
    task.resolve(failure(task.id, "CANCELLED"));
  };
  const taskFor = (id: string) => {
    let resolve!: Task["resolve"];
    const promise = new Promise<DocumentResponse>((done) => {
      resolve = done;
    });
    return {
      task: { id, cancelled: false, committed: false, resolve },
      promise,
    };
  };
  const duplicate = (id: string) =>
    [selecting, running, pending?.task].some((task) => task?.id === id);
  function enqueue(task: Task, operation: () => Promise<DocumentResponse>) {
    cancel(running);
    cancel(pending?.task ?? null);
    pending = { task, operation };
    drain();
  }
  function drain() {
    if (running || !pending) return;
    const work = pending;
    pending = null;
    running = work.task;
    void (async () => {
      let response: DocumentResponse;
      try {
        response = await work.operation();
      } catch {
        response = failure(work.task.id, "READ_FAILED");
      }
      running = null;
      work.task.resolve(response);
      drain();
    })();
  }
  const codeOf = (error: unknown): DocumentErrorCode =>
    error instanceof DocumentFailure || error instanceof DocumentPathError
      ? error.code
      : "READ_FAILED";
  const checkTask = (task: Task, generation: number) => {
    checkLive(generation);
    if (task.cancelled) throw new DocumentFailure("CANCELLED");
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
    generation: number,
    task: Task
  ): Promise<DocumentSnapshot> {
    checkTask(task, generation);
    const before = await verify(grant);
    checkTask(task, generation);
    if (before.size > BigInt(MAX_DOCUMENT_BYTES))
      throw new DocumentFailure("TOO_LARGE");
    const bytes = Buffer.alloc(
      Math.min(Number(before.size) + 1, MAX_DOCUMENT_BYTES + 1)
    );
    let length = 0;
    while (length < bytes.length) {
      checkTask(task, generation);
      const read = await grant.file.read(
        bytes,
        length,
        Math.min(bytes.length - length, 64 * 1024),
        length
      );
      checkTask(task, generation);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await verify(grant);
    checkTask(task, generation);
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
    const fidelity = analyzeTextFidelity(text);
    const byteBom =
      content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf;
    if (fidelity.bom !== byteBom) throw new DocumentFailure("INVALID_UTF8");
    const previous = identities.get(grant.identityKey);
    const identity = {
      documentId: previous?.documentId ?? randomUUID(),
      hash,
      revision: previous
        ? previous.revision + Number(previous.hash !== hash)
        : 1,
    };
    return {
      handle: grant.handle,
      ...identity,
      fileName: basename(grant.path),
      displayPath: grant.path,
      locationId: locations.get(grant.path) ?? randomUUID(),
      byteLength: length,
      text,
      fidelity,
    };
  }
  function commit(
    grant: Grant,
    next: DocumentSnapshot,
    task: Task,
    generation: number
  ) {
    checkTask(task, generation);
    task.committed = true;
    identities.set(grant.identityKey, {
      documentId: next.documentId,
      revision: next.revision,
      hash: next.hash,
    });
    locations.set(grant.path, next.locationId!);
  }

  return {
    async select(request) {
      if (!validate(request, false)) return failure("", "INVALID_REQUEST");
      if (disposed) return failure(request.requestId, "INVALID_HANDLE");
      if (selecting || duplicate(request.requestId))
        return failure(request.requestId, "BUSY");
      const { task, promise } = taskFor(request.requestId);
      selecting = task;
      const generation = epoch;
      void (async () => {
        try {
          const selected = await pickFile();
          checkTask(task, generation);
          if (selected === null) {
            task.resolve(result(request.requestId, null));
            return;
          }
          enqueue(task, async () => {
            let candidate: Grant | null = null;
            try {
              checkTask(task, generation);
              const authorization = await authorize(selected);
              candidate = {
                ...authorization,
                handle: randomUUID(),
                identityKey: `${authorization.path}:${authorization.fingerprint}`,
              };
              checkTask(task, generation);
              const next = await snapshot(candidate, generation, task);
              commit(candidate, next, task, generation);
              // The renderer adopts the new grant before releasing its old one.
              // A committed selection can still arrive after it was cancelled.
              grants.set(candidate.handle, candidate);
              return result(request.requestId, next);
            } catch (error) {
              return failure(request.requestId, codeOf(error));
            } finally {
              await close(candidate);
            }
          });
        } catch (error) {
          task.resolve(failure(request.requestId, codeOf(error)));
        } finally {
          if (selecting === task) selecting = null;
        }
      })();
      return promise;
    },
    async read(request) {
      if (!validate(request, true)) return failure("", "INVALID_REQUEST");
      if (duplicate(request.requestId))
        return failure(request.requestId, "BUSY");
      const grant = grants.get(request.handle);
      const generation = epoch;
      if (disposed || request.handle !== grant?.handle)
        return failure(request.requestId, "INVALID_HANDLE");
      const { task, promise } = taskFor(request.requestId);
      const readTask: Task = task;
      readTask.handle = request.handle;
      enqueue(task, async () => {
        if (
          disposed ||
          !grant ||
          grants.get(request.handle) !== grant ||
          request.handle !== grant.handle
        )
          return failure(request.requestId, "INVALID_HANDLE");
        try {
          const file = await open(
            grant.path,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
          ).catch(() => {
            throw new DocumentFailure("FILE_CHANGED");
          });
          let next: DocumentSnapshot;
          try {
            next = await snapshot({ ...grant, file }, generation, task);
          } finally {
            await file.close();
          }
          if (grants.get(request.handle) !== grant)
            throw new DocumentFailure("INVALID_HANDLE");
          commit(grant, next, task, generation);
          return result(request.requestId, next);
        } catch (error) {
          const code = codeOf(error);
          if (code === "FILE_CHANGED") grants.delete(grant.handle);
          return failure(request.requestId, code);
        }
      });
      return promise;
    },
    cancel(request) {
      if (!validate(request, false))
        return Promise.resolve(failure("", "INVALID_REQUEST"));
      for (const task of [selecting, running, pending?.task])
        if (task?.id === request.requestId) cancel(task);
      if (pending?.task.cancelled) pending = null;
      return Promise.resolve(result(request.requestId, null));
    },
    release(request) {
      if (!validate(request, true))
        return Promise.resolve(failure("", "INVALID_REQUEST"));
      if (disposed || !grants.has(request.handle))
        return Promise.resolve(failure(request.requestId, "INVALID_HANDLE"));
      grants.delete(request.handle);
      if (running?.handle === request.handle) cancel(running);
      if (pending?.task.handle === request.handle) {
        cancel(pending.task);
        pending = null;
      }
      return Promise.resolve(result(request.requestId, null));
    },
    dispose() {
      disposed = true;
      epoch++;
      grants.clear();
      cancel(selecting);
      cancel(running);
      cancel(pending?.task ?? null);
      pending = null;
      identities.clear();
      locations.clear();
      return Promise.resolve();
    },
  };
}
