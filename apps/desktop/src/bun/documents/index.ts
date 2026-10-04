import { createHash, randomUUID } from "node:crypto";
import { constants, watch, type FSWatcher } from "node:fs";
import { open } from "node:fs/promises";
import { basename, dirname } from "node:path";

import {
  DOCUMENT_PROTOCOL_VERSION,
  MAX_DOCUMENT_BYTES,
  type DocumentErrorCode,
  type DocumentResponse,
  type DocumentService,
  type DocumentSnapshot,
  type SaveDocumentRequest,
  type WriteCapability,
} from "../../shared/documents";
import { validLocalImageRequest } from "../../shared/local-images";
import { validMirror } from "../../shared/save-content";
import { analyzeTextFidelity } from "../../shared/text-fidelity";

import {
  atomicSave,
  type AtomicSaveInput,
  type AtomicSaveResult,
} from "./atomic-save";
import { createBufferMirrors, validateSaveContent } from "./buffer-mirror";
import { createImageReader } from "./local-images";
import {
  authorizeSingleFile,
  DocumentPathError,
  fileFingerprint,
  verifySingleFileAuthorization,
  type SingleFileAuthorization,
} from "./path-authorization";
import { checkWriteCapability } from "./write-capability";

interface Identity {
  documentId: string;
  hash: string;
  revision: number;
}
interface Grant extends SingleFileAuthorization {
  handle: string;
  path: string;
  identityKey: string;
  scope?: DocumentScope;
}
export interface DocumentScope {
  verify(): Promise<void>;
  release?(): void;
}
export interface TrustedDocumentService extends DocumentService {
  openAuthorized(
    request: unknown,
    authorize: () => Promise<SingleFileAuthorization>,
    scope: DocumentScope
  ): Promise<DocumentResponse>;
  locations(): { handle: string; path: string; documentId?: string }[];
  revokeScope(scope: DocumentScope): void;
}
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class DocumentFailure extends Error {
  constructor(readonly code: DocumentErrorCode) {
    super(code);
  }
}

function validateSave(value: unknown): value is SaveDocumentRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  const keys = [
    "protocolVersion",
    "requestId",
    "handle",
    "documentId",
    "expectedRevision",
    "expectedHash",
    "bufferRevision",
    "mirror",
    "content",
  ];
  return (
    Object.keys(r).length === keys.length &&
    Object.keys(r).every((k) => keys.includes(k)) &&
    r.protocolVersion === 1 &&
    typeof r.requestId === "string" &&
    r.requestId.length > 0 &&
    r.requestId.length <= 80 &&
    typeof r.handle === "string" &&
    uuidPattern.test(r.handle) &&
    typeof r.documentId === "string" &&
    uuidPattern.test(r.documentId) &&
    typeof r.expectedRevision === "number" &&
    Number.isSafeInteger(r.expectedRevision) &&
    r.expectedRevision > 0 &&
    typeof r.bufferRevision === "number" &&
    Number.isSafeInteger(r.bufferRevision) &&
    r.bufferRevision >= 0 &&
    typeof r.expectedHash === "string" &&
    /^[a-f0-9]{64}$/.test(r.expectedHash) &&
    validMirror(r.mirror) &&
    validateSaveContent(r.content)
  );
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
  verify: verifyFile = verifySingleFileAuthorization,
  write = atomicSave,
  capability: checkCapability = checkWriteCapability,
  onCapabilityChanged = () => undefined,
  onTiming,
}: {
  pickFile: () => Promise<string | null>;
  authorize?: typeof authorizeSingleFile;
  verify?: typeof verifySingleFileAuthorization;
  write?: (input: AtomicSaveInput) => Promise<AtomicSaveResult>;
  capability?: typeof checkWriteCapability;
  onCapabilityChanged?: (handle: string) => void;
  onTiming?: (
    phase: "pickerMs" | "authorizeMs" | "diskReadMs" | "decodeAnalyzeMs",
    ms: number
  ) => void;
}): TrustedDocumentService {
  const verify = (
    grant: SingleFileAuthorization & { scope?: DocumentScope }
  ) => {
    if (!grant.scope) return verifyFile(grant);
    return (async () => {
      await grant.scope!.verify();
      const result = await verifyFile(grant);
      await grant.scope!.verify();
      return result;
    })();
  };
  const capability = (
    grant: Omit<SingleFileAuthorization, "file"> & { scope?: DocumentScope }
  ) => {
    if (!grant.scope) return checkCapability(grant);
    return (async () => {
      await grant.scope!.verify();
      const result = await checkCapability(grant);
      await grant.scope!.verify();
      return result;
    })();
  };
  const grants = new Map<string, Grant>();
  const images = createImageReader();
  let imageJobs = 0;
  const mirrors = createBufferMirrors();
  const capabilityJobs = new Map<string, Promise<WriteCapability>>();
  const capabilityVersions = new Map<string, number>();
  let capabilityVersion = 0;
  const watchers = new Map<string, FSWatcher[]>();
  const hints = new Map<string, ReturnType<typeof setTimeout>>();
  const unwatch = (handle: string) => {
    capabilityVersions.delete(handle);
    watchers.get(handle)?.forEach((watcher) => watcher.close());
    watchers.delete(handle);
    clearTimeout(hints.get(handle));
    hints.delete(handle);
  };
  const watchGrant = (grant: Grant) => {
    unwatch(grant.handle);
    capabilityVersions.set(grant.handle, ++capabilityVersion);
    const attached: FSWatcher[] = [];
    const hint = () => {
      capabilityVersions.set(grant.handle, ++capabilityVersion);
      if (hints.has(grant.handle)) return;
      hints.set(
        grant.handle,
        setTimeout(() => {
          hints.delete(grant.handle);
          if (grants.has(grant.handle)) onCapabilityChanged(grant.handle);
        }, 60)
      );
    };
    for (const path of [grant.path, dirname(grant.path)]) {
      try {
        // Non-recursive metadata hints only. Never consume names as authority.
        const watcher = watch(path, { persistent: false }, hint);
        watcher.on("error", hint);
        attached.push(watcher);
      } catch {
        /* Focus/poll fallback still revalidates permissions. */
      }
    }
    watchers.set(grant.handle, attached);
  };
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
  let saveTail: Promise<void> = Promise.resolve();
  let saving = 0;
  let writeBarrier = false;
  const uncertain = new Set<string>();
  const savingRequests = new Set<string>();
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
  ): Extract<DocumentResponse, { ok: false }> => ({
    protocolVersion: 1,
    requestId,
    ok: false,
    error,
  });
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
    const readStart = onTiming ? performance.now() : 0;
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
    onTiming?.("diskReadMs", performance.now() - readStart);
    const decodeStart = onTiming ? performance.now() : 0;
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
    onTiming?.("decodeAnalyzeMs", performance.now() - decodeStart);
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
      writeCapability: await capability(grant),
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
    // Explicit successful re-read/reselection establishes a fresh baseline.
    uncertain.delete(next.documentId);
    next.mirror = mirrors.put(grant.handle, next.text, 0);
  }

  return {
    locations: () =>
      [...grants.values()].map((grant) => ({
        handle: grant.handle,
        path: grant.path,
        documentId: identities.get(grant.identityKey)?.documentId,
      })),
    revokeScope(scope) {
      for (const [handle, grant] of grants)
        if (grant.scope === scope) {
          grants.delete(handle);
          mirrors.release(handle);
          unwatch(handle);
          if (running?.handle === handle) cancel(running);
          if (pending?.task.handle === handle) {
            cancel(pending.task);
            pending = null;
          }
        }
      scope.release?.();
    },
    async openAuthorized(request, getAuthorization, scope) {
      if (!validate(request, false)) return failure("", "INVALID_REQUEST");
      if (disposed) return failure(request.requestId, "INVALID_HANDLE");
      if (saving || writeBarrier || selecting || duplicate(request.requestId))
        return failure(request.requestId, "BUSY");
      const { task, promise } = taskFor(request.requestId),
        generation = epoch;
      enqueue(task, async () => {
        let candidate: Grant | null = null;
        try {
          checkTask(task, generation);
          await scope.verify();
          const authorization = await getAuthorization();
          candidate = {
            ...authorization,
            handle: randomUUID(),
            identityKey: `${authorization.path}:${authorization.fingerprint}`,
            scope,
          };
          checkTask(task, generation);
          await scope.verify();
          const next = await snapshot(candidate, generation, task);
          await scope.verify();
          checkTask(task, generation);
          commit(candidate, next, task, generation);
          grants.set(candidate.handle, candidate);
          watchGrant(candidate);
          return result(request.requestId, next);
        } catch (error) {
          return failure(request.requestId, codeOf(error));
        } finally {
          await close(candidate);
        }
      });
      return promise;
    },
    async readLocalImage(request) {
      const valid = validLocalImageRequest(request);
      const envelope = {
        protocolVersion: 1 as const,
        requestId: valid ? request.requestId : "",
      };
      if (!valid) return { ...envelope, ok: false, error: "INVALID_REQUEST" };
      const grant = grants.get(request.handle),
        generation = epoch;
      if (!grant || disposed || saving || writeBarrier)
        return { ...envelope, ok: false, error: "UNAVAILABLE" };
      const identityKey = grant.identityKey;
      if (imageJobs >= 9) return { ...envelope, ok: false, error: "BUSY" };
      imageJobs++;
      const stillCurrent = () =>
        !disposed &&
        generation === epoch &&
        grants.get(request.handle) === grant &&
        grant.identityKey === identityKey &&
        !saving &&
        !writeBarrier;
      try {
        const verifyCurrent = async () => {
          const file = await open(
            grant.path,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
          );
          try {
            await verify({ ...grant, file });
          } finally {
            await file.close();
          }
          if (!stillCurrent()) throw Error();
        };
        await verifyCurrent();
        const authorization = {
          selectedPath: grant.selectedPath,
          selectedParent: grant.selectedParent,
          path: grant.path,
          fingerprint: grant.fingerprint,
          directories: grant.directories,
        };
        const result = await images.read({
          authorization,
          reference: request.reference,
        });
        await verifyCurrent();
        return { ...envelope, ...result };
      } catch {
        return { ...envelope, ok: false, error: "UNAVAILABLE" };
      } finally {
        imageJobs--;
      }
    },
    async checkWriteCapability(request) {
      const valid = validate(request, true);
      const response = {
        protocolVersion: 1 as const,
        requestId: valid ? request.requestId : "",
        handle: valid ? request.handle : "",
      };
      const grant = valid && grants.get(request.handle);
      if (disposed || !grant)
        return {
          ...response,
          capability: { writable: false, reason: "invalid" },
        };
      let job = capabilityJobs.get(grant.handle);
      if (!job) {
        if (capabilityJobs.size >= 2)
          return {
            ...response,
            capability: { writable: false, reason: "unavailable" },
          };
        job = (async (): Promise<WriteCapability> => {
          await saveTail;
          if (disposed || grants.get(grant.handle) !== grant)
            return { writable: false, reason: "invalid" };
          const fingerprint = grant.fingerprint;
          const version = capabilityVersions.get(grant.handle);
          try {
            const checked = await capability(grant);
            if (
              disposed ||
              grants.get(grant.handle) !== grant ||
              grant.fingerprint !== fingerprint ||
              capabilityVersions.get(grant.handle) !== version
            )
              return { writable: false, reason: "unavailable" };
            return checked;
          } catch {
            return { writable: false, reason: "unavailable" };
          }
        })();
        capabilityJobs.set(grant.handle, job);
        void job.finally(() => {
          if (capabilityJobs.get(grant.handle) === job)
            capabilityJobs.delete(grant.handle);
        });
      }
      const checked = await job;
      if (disposed || grants.get(grant.handle) !== grant)
        return {
          ...response,
          capability: { writable: false, reason: "unavailable" },
        };
      return { ...response, capability: checked };
    },
    async waitForSaves(request) {
      if (!validate(request, false))
        return { protocolVersion: 1, requestId: "", settled: false };
      // Renderer has frozen local mutation before this handshake. If a new writer
      // was nevertheless admitted meanwhile, wait for its published outcome too.
      do {
        await saveTail;
      } while (saving > 0);
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        settled: !disposed,
      };
    },
    async save(request) {
      if (!validateSave(request)) return failure("", "INVALID_REQUEST");
      if (disposed || !grants.has(request.handle))
        return failure(request.requestId, "INVALID_HANDLE");
      if (
        writeBarrier ||
        savingRequests.has(request.requestId) ||
        saving >= 2 ||
        running ||
        pending ||
        selecting
      )
        return failure(request.requestId, "BUSY");
      saving++;
      savingRequests.add(request.requestId);
      const previous = saveTail;
      let finish!: () => void;
      saveTail = new Promise<void>((resolve) => {
        finish = resolve;
      });
      try {
        await previous;
        const grant = grants.get(request.handle);
        if (!grant || disposed)
          return failure(request.requestId, "INVALID_HANDLE");
        const identity = identities.get(grant.identityKey);
        if (identity?.documentId !== request.documentId)
          return failure(request.requestId, "INVALID_HANDLE");
        if (uncertain.has(identity.documentId))
          return failure(request.requestId, "SAVE_UNCERTAIN");
        if (
          identity.revision !== request.expectedRevision ||
          identity.hash !== request.expectedHash
        )
          return failure(request.requestId, "CONFLICT");
        let checked: WriteCapability;
        try {
          checked = await capability(grant);
        } catch (error) {
          return failure(request.requestId, codeOf(error));
        }
        if (!checked.writable) return failure(request.requestId, "READ_ONLY");
        const prepared = mirrors.prepare(request);
        if (!prepared.ok && prepared.error === "MIRROR_MISMATCH") {
          // Never classify a changed disk baseline as a recoverable mirror miss.
          const file = await open(
            grant.path,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
          ).catch(() => null);
          if (!file) return failure(request.requestId, "CONFLICT");
          try {
            const before = await verify({ ...grant, file });
            if (before.size > BigInt(MAX_DOCUMENT_BYTES))
              return failure(request.requestId, "CONFLICT");
            const bytes = Buffer.alloc(Number(before.size) + 1);
            let count = 0;
            while (count < bytes.length) {
              const part = await file.read(
                bytes,
                count,
                bytes.length - count,
                count
              );
              if (!part.bytesRead) break;
              count += part.bytesRead;
            }
            const after = await verify({ ...grant, file });
            if (
              fileFingerprint(before) !== fileFingerprint(after) ||
              BigInt(count) !== before.size ||
              before.size !== after.size ||
              before.mtimeNs !== after.mtimeNs ||
              before.ctimeNs !== after.ctimeNs ||
              createHash("sha256")
                .update(bytes.subarray(0, count))
                .digest("hex") !== request.expectedHash
            )
              return failure(request.requestId, "CONFLICT");
          } catch {
            return failure(request.requestId, "CONFLICT");
          } finally {
            await file.close();
          }
        }
        if (!prepared.ok)
          return {
            ...failure(request.requestId, prepared.error),
            ...(prepared.error === "MIRROR_MISMATCH"
              ? { recovery: prepared.recovery }
              : {}),
          };
        const text = prepared.text;
        const authorization = {
          selectedPath: grant.selectedPath,
          path: grant.path,
          selectedParent: grant.selectedParent,
          fingerprint: grant.fingerprint,
          directories: grant.directories,
        };
        const written = await write({
          authorization,
          expectedHash: request.expectedHash,
          text,
        });
        if (!written.ok) {
          if (written.error === "SAVE_UNCERTAIN")
            uncertain.add(identity.documentId);
          return failure(request.requestId, written.error);
        }
        const oldKey = grant.identityKey;
        const newKey = `${grant.path}:${written.fingerprint}`;
        const nextIdentity = {
          documentId: identity.documentId,
          revision: identity.revision + 1,
          hash: written.hash,
        };
        identities.delete(oldKey);
        identities.set(newKey, nextIdentity);
        for (const owned of grants.values())
          if (owned.identityKey === oldKey) {
            owned.fingerprint = written.fingerprint;
            owned.identityKey = newKey;
            watchGrant(owned);
          }
        return {
          protocolVersion: 1,
          requestId: request.requestId,
          ok: true,
          savedBufferRevision: request.bufferRevision,
          snapshot: {
            ...nextIdentity,
            handle: grant.handle,
            locationId: locations.get(grant.path),
            displayPath: grant.path,
            fileName: basename(grant.path),
            byteLength: written.byteLength,
            mirror: mirrors.put(grant.handle, text, request.bufferRevision),
            fidelity: analyzeTextFidelity(text),
            writeCapability: await capability(grant),
          },
        };
      } catch {
        // A thrown transport/worker outcome cannot prove a replacement did not occur.
        uncertain.add(request.documentId);
        return failure(request.requestId, "SAVE_UNCERTAIN");
      } finally {
        saving--;
        savingRequests.delete(request.requestId);
        finish();
      }
    },
    async withWriteBarrier(action) {
      if (writeBarrier || disposed) return false;
      writeBarrier = true;
      try {
        await saveTail;
        return await action();
      } finally {
        writeBarrier = false;
      }
    },
    async select(request) {
      if (!validate(request, false)) return failure("", "INVALID_REQUEST");
      if (saving || writeBarrier) return failure(request.requestId, "BUSY");
      if (disposed) return failure(request.requestId, "INVALID_HANDLE");
      if (selecting || duplicate(request.requestId))
        return failure(request.requestId, "BUSY");
      const { task, promise } = taskFor(request.requestId);
      selecting = task;
      const generation = epoch;
      void (async () => {
        try {
          const pickerStart = onTiming ? performance.now() : 0;
          const selected = await pickFile();
          onTiming?.("pickerMs", performance.now() - pickerStart);
          checkTask(task, generation);
          if (selected === null) {
            task.resolve(result(request.requestId, null));
            return;
          }
          enqueue(task, async () => {
            let candidate: Grant | null = null;
            try {
              checkTask(task, generation);
              const authorizeStart = onTiming ? performance.now() : 0;
              const authorization = await authorize(selected);
              onTiming?.("authorizeMs", performance.now() - authorizeStart);
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
              watchGrant(candidate);
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
      if (saving || writeBarrier) return failure(request.requestId, "BUSY");
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
          if (code === "FILE_CHANGED") {
            grants.delete(grant.handle);
            mirrors.release(grant.handle);
            unwatch(grant.handle);
            grant.scope?.release?.();
          }
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
      if (saving || writeBarrier)
        return Promise.resolve(failure(request.requestId, "BUSY"));
      if (disposed || !grants.has(request.handle))
        return Promise.resolve(failure(request.requestId, "INVALID_HANDLE"));
      grants.get(request.handle)?.scope?.release?.();
      grants.delete(request.handle);
      mirrors.release(request.handle);
      unwatch(request.handle);
      if (running?.handle === request.handle) cancel(running);
      if (pending?.task.handle === request.handle) {
        cancel(pending.task);
        pending = null;
      }
      return Promise.resolve(result(request.requestId, null));
    },
    async dispose() {
      writeBarrier = true;
      await saveTail;
      disposed = true;
      images.dispose();
      epoch++;
      for (const grant of grants.values()) grant.scope?.release?.();
      grants.clear();
      mirrors.clear();
      for (const handle of watchers.keys()) unwatch(handle);
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
