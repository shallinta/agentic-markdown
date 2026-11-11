import { createHash, randomUUID } from "node:crypto";
import { constants, fstatSync, lstatSync, watch, type BigIntStats, type FSWatcher } from "node:fs";
import { open } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { CONTENT_SEARCH_LIMITS } from "../../shared/content-search";
import { validDuplicateVersion, type DuplicateSource } from "../../shared/create-markdown";
import { validObservationRequest, type ObservationBinding, type ObservationEvent } from "../../shared/document-observation";
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
import { localImageReference, validLocalImageRequest, type LocalImageResult } from "../../shared/local-images";
import { MAIN_TAB_METADATA_MAX_TABS, type MainTabSourceInput } from "../../shared/main-tab-checkpoint";
import { READER_IMAGE_SNAPSHOT_MAX_SLOTS, type ReaderImageSnapshotSlot } from "../../shared/reader-image-snapshot";
import { READER_SNAPSHOT_MAX_BYTES } from "../../shared/reader-snapshot";
import { validMirror } from "../../shared/save-content";
import { analyzeTextFidelity } from "../../shared/text-fidelity";

import {
  atomicSave,
  type AtomicSaveInput,
  type AtomicSaveResult,
} from "./atomic-save";
import { createBufferMirrors, validateSaveContent } from "./buffer-mirror";
import { createImageReader } from "./local-images";
import { createObservationQueue } from "./observation-queue";
import { observeFile } from "./observe-file";
import {
  authorizeSingleFile,
  DocumentPathError,
  fileFingerprint,
  verifySingleFileAuthorization,
  type SingleFileAuthorization,
} from "./path-authorization";
import { createRefreshAcceptanceLedger, validRefreshAcceptance, type RefreshAcceptanceResult } from "./refresh-acceptance";
import { createRefreshCandidates, validRefreshBinding, type RefreshResult } from "./refresh-candidates";
import { checkWriteCapability } from "./write-capability";

interface Identity {
  documentId: string;
  hash: string;
  revision: number;
}
interface Grant extends SingleFileAuthorization {
  explicitStandalone?: boolean;
  searchPrepared?: boolean;
  handle: string;
  path: string;
  identityKey: string;
  scope?: DocumentScope;
  assetScope?: AssetScope;
  assetEpoch?: string;
}
export interface AssetScope {
  readonly path: string;
  readonly directories: SingleFileAuthorization["directories"];
  verify(): Promise<void>;
}
export interface DocumentScope {
  verify(): Promise<void>;
  release?(): void;
}
export interface FolderGrantBinding {
  handle: string;
  path: string;
  fingerprint: string;
  directories: SingleFileAuthorization["directories"];
  documentId: string;
  explicitStandalone: boolean;
  observedActive: boolean;
  scope?: DocumentScope;
}
export interface FolderGrantChange {
  handle: string;
  action: "retain" | "standalone" | "migrate" | "revoke";
  scope?: DocumentScope;
  assetScope?: AssetScope;
}
export interface FolderMutationLease {
  current(): boolean;
  bindings(): readonly FolderGrantBinding[];
  prepare(changes: readonly FolderGrantChange[]): Promise<{ assetEpochs: Record<string, string>; commit(markCommitted: () => void): void }>;
  release(): void;
}
interface ContentSearchBinding {
  handle: string;
  path: string;
  fingerprint: string;
  documentId: string;
  revision: number;
  hash: string;
  scope?: DocumentScope;
  verify(check: () => void): Promise<void>;
  readStandalone?(this: void, maxBytes: number, check: () => void): Promise<Buffer>;
  verifyStandalone?(this: void, check: () => void): Promise<void>;
  prepareRetainedSnapshot?(
    this: void,
    requestId: string,
    expectedHash: string,
    check: () => void,
    verifyScope: (check: () => void) => Promise<void>,
    owner?: DocumentScope
  ): Promise<DocumentResponse>;
}
interface ReadingSnapshotSource {
  handle: string;
  documentId: string;
  expectedRevision: number;
  expectedHash: string;
}
type ReadingSnapshotCapture =
  | { ok: true; base64: string; current: () => boolean; readImage?: ReadingSnapshotImageRead }
  | { ok: false; error: DocumentErrorCode };
export type ReadingSnapshotImageRead = (slot: ReaderImageSnapshotSlot, reference: string, childCurrent: () => boolean) => Promise<
  | (Pick<Extract<LocalImageResult, { ok: true }>, "ok" | "mime" | "width" | "height" | "data"> & { current(): boolean; sourceCurrent(): boolean })
  | { ok: false; error: "UNAVAILABLE" | "STALE" }
>;
interface PastedRasterSourceProof { path: string; fingerprint: string }
interface PastedRasterSourceTicket {
  current(this: void): boolean;
  revalidate(this: void): Promise<boolean>;
}
type PastedRasterSourceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DocumentErrorCode | "UNKNOWN" };

export interface TrustedDocumentService extends DocumentService {
  /** Internal recovery snapshots only; stat/identity revalidation, not a second body read. */
  ownsRecoverySnapshot(snapshot: DocumentSnapshot, requestId: string): boolean;
  verifyRecoverySnapshots(snapshots: readonly DocumentSnapshot[], check: () => void): Promise<boolean>;
  /** Final same-tick check after asynchronous verification and before delivery. */
  currentRecoverySnapshot(snapshot: DocumentSnapshot, requestId: string): boolean;
  /** Existing observed grant only. The receipt checks logical ownership after capture. */
  captureReadingSnapshot(
    source: ReadingSnapshotSource,
    current?: () => boolean,
    options?: { includeImage: true }
  ): Promise<ReadingSnapshotCapture>;
  /** Verifies the saved source for a draft image without returning disk body bytes. */
  captureReadingImageProof(source: ReadingSnapshotSource, current: () => boolean): Promise<ReadingSnapshotImageRead | undefined>;
  /** Exact observed saved text and its physical proof for internal anchor calculation. */
  captureViewportSource(tab: MainTabSourceInput, current: () => boolean): Promise<{ raw: string; current(): boolean } | undefined>;
  /** Bun-only ticket for an idle grant registry. It does not freeze editing or prove renderer state. */
  beginSearchAdmission(): { current(): boolean } | undefined;
  /** Captures only grants owned by this service. Missing or uncertain grants remain unresolved. */
  captureContentSearchBindings(handles: readonly string[]): {
    bindings: readonly (ContentSearchBinding | undefined)[];
    current(): boolean;
  } | undefined;
  setTrashGuard(guard: (path: string, fingerprint?: string, directories?: SingleFileAuthorization["directories"]) => boolean): void;
  trashBlocked(path: string, fingerprint?: string, directories?: SingleFileAuthorization["directories"]): boolean;
  inspectTrash(handle: string, documentId: string): Omit<SingleFileAuthorization,"file"> | null;
  withDuplicateBuffer(source: DuplicateSource, payload: { text: string; hash: string }, action: Parameters<TrustedDocumentService["withDuplicateSource"]>[1]): Promise<boolean>;
  withDuplicateSource(source: DuplicateSource, action: (source: { bytes: Uint8Array; hash: string; fileName: string; checkCurrent(): void; revalidate(): Promise<void> }) => Promise<void>): Promise<boolean>;
  /** Requires the caller's exact workspace creation lease, independently of the grant. */
  withPastedRasterSource<T>(
    source: ReadingSnapshotSource,
    expected: PastedRasterSourceProof,
    callerCurrent: () => boolean,
    action: (ticket: PastedRasterSourceTicket) => Promise<T>
  ): Promise<PastedRasterSourceResult<T>>;
  withCreateBarrier(action: () => Promise<void> | void): Promise<boolean>;
  openCreatedAuthorized(request: unknown, authorize: () => Promise<SingleFileAuthorization>, scope: DocumentScope, sink: (snapshot: DocumentSnapshot) => void): Promise<DocumentResponse>;
  acquireFolderMutationLease(): Promise<FolderMutationLease | null>;
  inspectStandaloneRemoval(handle: string, eligible: (path: string) => boolean): object | null;
  commitStandaloneRemoval(handle: string, identity: object, eligible: (path: string) => boolean, committed: () => void): boolean;
  /** Bun-only authority callback; never a renderer-supplied path. */
  revealAuthorized(
    request: unknown,
    authorize: (
      check: () => void
    ) => Promise<{ path: string; close(): Promise<void> }>,
    current: () => void
  ): Promise<DocumentResponse>;

  reveal(request: unknown): Promise<DocumentResponse>;
  openDefaultAuthorized(
    request: unknown,
    authorize: (check: () => void) => Promise<{ path: string; close(): Promise<void> }>,
    current: () => void
  ): Promise<DocumentResponse>;
  openDefault(request: unknown): Promise<DocumentResponse>;
  select(request: unknown, prepareStartingFolder?: (check: () => void) => Promise<string | undefined>): Promise<DocumentResponse>;
  acceptRefreshCandidate(request: unknown): Promise<RefreshAcceptanceResult>;
  queryRefreshAcceptance(request: unknown): RefreshAcceptanceResult;
  readRefreshCandidate(request: unknown): Promise<RefreshResult>;
  checkRefreshCandidateBinding(token: unknown): Promise<boolean>;
  discardRefreshCandidate(handle: string): void;
  openAuthorized(
    request: unknown,
    authorize: () => Promise<SingleFileAuthorization>,
    scope: DocumentScope,
    proof?: {
      maxBytes: number;
      retainRecoveryStamp?: boolean;
      check(this: void): void;
      verify(
        authorization: SingleFileAuthorization,
        snapshot: DocumentSnapshot,
        check: () => void
      ): Promise<void>;
    }
  ): Promise<DocumentResponse>;
  locations(): {
    handle: string;
    path: string;
    fingerprint: string;
    documentId?: string;
  }[];
  captureMRU(this:void, handle: string, documentId: string): import("../../shared/document-mru").MRUEntry | undefined;
  inspectMRU(entry: import("../../shared/document-mru").MRUEntry): (() => void) | undefined;
  resolveMRUIndependent(this:void, entry: import("../../shared/document-mru").MRUEntry, check: () => void): Promise<{handle:string;current(this:void):void} | undefined>;
  setAssetScope(handle: string, scope: AssetScope | undefined): void;
  assetEpochs(): Record<string, string>;
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
  onExternalChanged = () => undefined,
  probe = observeFile,
  onTiming,
  imageReader,
  onStandaloneSelected,
  mru,
  revealPath,
  openDefaultPath,
}: {
  pickFile: (startingFolder?: string) => Promise<string | null>;
  onStandaloneSelected?: (metadata: Readonly<{ path: string; accessedAt: number }>) => void | Promise<void>;
  mru?: { lookup(path: string, fingerprint: string): string | undefined; migrate(documentId: string, path: string, oldFingerprint: string, newFingerprint: string): void };
  revealPath?: (path: string) => void;
  openDefaultPath?: (path: string) => boolean;
  authorize?: typeof authorizeSingleFile;
  verify?: typeof verifySingleFileAuthorization;
  write?: (input: AtomicSaveInput) => Promise<AtomicSaveResult>;
  capability?: typeof checkWriteCapability;
  onCapabilityChanged?: (handle: string) => void;
  onExternalChanged?: (event: ObservationEvent) => void;
  probe?: typeof observeFile;
  imageReader?: Pick<ReturnType<typeof createImageReader>, "read" | "dispose">;
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
  const recoveryStamps = new WeakMap<DocumentSnapshot, { stamp: BigIntStats; grant: Grant; scope: DocumentScope | undefined; requestId: string }>();
  let trashGuard: (path: string, fingerprint?: string, directories?: SingleFileAuthorization["directories"]) => boolean = () => false;
  const observations = new Map<string, ObservationBinding & { last?: string }>();
  const observationEpochs = new Map<string, { epoch: number; token: string; active: boolean }>();
  const commits = new Map<string, { token: string; fingerprint: string; revision: number; hash: string }>();
  let observationGeneration = 0;
  const observationQueue = createObservationQueue(async handle => {
    const binding = observations.get(handle), grant = grants.get(handle);
    if (!binding || !grant) return;
    const identity = identities.get(grant.identityKey);
    if (identity?.documentId !== binding.documentId || identity.hash !== binding.hash || identity.revision !== binding.revision) return;
    const fingerprint = grant.fingerprint, commit = commits.get(identity.documentId);
    const barrierGeneration = selectBarrierGeneration;
    const live = () => !disposed && !saving && !writeBarrier && selectBarrierGeneration === barrierGeneration && observations.get(handle) === binding && grants.get(handle) === grant && grant.fingerprint === fingerprint && identities.get(grant.identityKey) === identity;
    const checked = await probe({ ...grant }, identity.hash, live).catch(() => ({ status: "unavailable" as const, hash: undefined, fingerprint: undefined }));
    if (!live()) { observationQueue.hint(handle); return; }
    // A recorded durable transaction is only an echo after actual identity/hash verification.
    const selfEcho = commit && commits.get(identity.documentId)?.token === commit.token && commit.revision === identity.revision && checked.hash === commit.hash && checked.fingerprint === commit.fingerprint;
    const status = selfEcho ? "unchanged" : checked.status;
    if (binding.last === status) return;
    binding.last = status;
    const { last: _last, ...captured } = binding;
    void _last;
    try { onExternalChanged({ ...captured, generation: ++observationGeneration, status }); }
    catch { binding.last = undefined; }
  }, () => !saving && !writeBarrier && !disposed);
  const forgetObservation = (handle: string) => { observations.delete(handle); observationQueue.remove(handle); };
  const releaseObservation = (handle: string) => {
    acceptance.release(handle);
    candidates.discardHandle(handle);
    forgetObservation(handle); observationEpochs.delete(handle);
    for (const id of commits.keys()) if (![...grants.values()].some(grant => identities.get(grant.identityKey)?.documentId === id)) commits.delete(id);
  };
  const images = imageReader ?? createImageReader();
  let imageJobs = 0;
  const mirrors = createBufferMirrors();
  const capabilityJobs = new Map<string, Promise<WriteCapability>>();
  const capabilityVersions = new Map<string, number>();
  let capabilityVersion = 0;
  const watchers = new Map<string, FSWatcher[]>();
  const hints = new Map<string, ReturnType<typeof setTimeout>>();
  const unwatch = (handle: string) => {
    capabilityVersions.delete(handle);
    const attached = watchers.get(handle);
    watchers.delete(handle);
    clearTimeout(hints.get(handle));
    hints.delete(handle);
    for (const watcher of attached ?? []) {
      try { watcher.close(); }
      catch { console.warn("Document watcher cleanup failed"); }
    }
  };
  const watchGrant = (grant: Grant) => {
    unwatch(grant.handle);
    capabilityVersions.set(grant.handle, ++capabilityVersion);
    const attached: FSWatcher[] = [];
    const hint = () => {
      observationQueue.hint(grant.handle);
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
  let revealing: Task | null = null;
  let running: Task | null = null;
  let pending: {
    task: Task;
    operation: () => Promise<DocumentResponse>;
  } | null = null;
  let disposed = false;
  let disposing = false;
  let createAdmissionOwner: object | null = null;
  let epoch = 0;
  const identities = new Map<string, Identity>();
  let saveTail: Promise<void> = Promise.resolve();
  let saving = 0;
  const acceptance = createRefreshAcceptanceLedger();
  let writeBarrier = false;
  let releaseBarrier: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  const wakeSearchReleases = () => {
    const waiting = releaseBarrier;
    releaseBarrier = undefined;
    waiting?.resolve();
  };
  let folderMutationLease: object | null = null;
  let selectBarrierGeneration = 0;
  let searchAdmissionGeneration = 0;
  let saveStartGeneration = 0;
  const uncertain = new Set<string>();
  const savingRequests = new Set<string>();
  const searchIdle = () =>
    !disposed &&
    !disposing &&
    !selecting &&
    !revealing &&
    !running &&
    !pending &&
    saving === 0 &&
    !acceptance.busy() &&
    !writeBarrier &&
    !createAdmissionOwner &&
    !folderMutationLease;
  const searchAdmissible = () => grants.size === 0 && searchIdle();
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
  const taskFor = (id: string): { task: Task; promise: Promise<DocumentResponse> } => {
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
    [selecting, running, pending?.task, revealing].some((task) => task?.id === id);
  function enqueue(task: Task, operation: () => Promise<DocumentResponse>, owner?: object) {
    if (disposing || (createAdmissionOwner && createAdmissionOwner !== owner)) {
      task.resolve(failure(task.id, "BUSY")); return;
    }
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
      candidates.wake();
    })();
  }
  const codeOf = (error: unknown): DocumentErrorCode =>
    error instanceof DocumentFailure || error instanceof DocumentPathError
      ? error.code
      : "READ_FAILED";
  const candidates = createRefreshCandidates(
    () => !disposed && !saving && !writeBarrier && !running && !pending && !selecting && !acceptance.busy(),
    codeOf
  );
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

  function sameReadingStamp(expected: BigIntStats, actual: BigIntStats) {
    return actual.isFile() && fileFingerprint(actual) === fileFingerprint(expected) &&
      actual.size === expected.size && actual.mtimeNs === expected.mtimeNs &&
      actual.ctimeNs === expected.ctimeNs && actual.mode === expected.mode && actual.nlink === expected.nlink;
  }

  async function stableBytes(grant: Grant, check: () => void, maxBytes = MAX_DOCUMENT_BYTES, captureStamp?: (stamp: BigIntStats) => void) {
    const readStart = onTiming ? performance.now() : 0;
    check();
    const before = await verify(grant);
    check();
    const fdBefore = captureStamp ? fstatSync(grant.file.fd, { bigint: true }) : undefined;
    if (fdBefore && !sameReadingStamp(before, fdBefore)) throw new DocumentFailure("FILE_CHANGED");
    if (before.size > BigInt(maxBytes))
      throw new DocumentFailure("TOO_LARGE");
    const bytes = Buffer.alloc(
      Math.min(Number(before.size) + 1, maxBytes + 1)
    );
    let length = 0;
    while (length < bytes.length) {
      check();
      const read = await grant.file.read(
        bytes,
        length,
        Math.min(bytes.length - length, 64 * 1024),
        length
      );
      check();
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await verify(grant);
    check();
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
    if (length > maxBytes) throw new DocumentFailure("TOO_LARGE");
    if (captureStamp && fdBefore) {
      const fdAfter = fstatSync(grant.file.fd, { bigint: true });
      if (!sameReadingStamp(fdBefore, fdAfter) || !sameReadingStamp(after, fdAfter))
        throw new DocumentFailure("FILE_CHANGED");
      captureStamp(fdAfter);
    }
    const content = bytes.subarray(0, length);
    onTiming?.("diskReadMs", performance.now() - readStart);
    return content;
  }
  async function withPastedRasterSource<T>(
    source: ReadingSnapshotSource,
    expected: PastedRasterSourceProof,
    callerCurrent: () => boolean,
    action: (ticket: PastedRasterSourceTicket) => Promise<T>
  ): Promise<PastedRasterSourceResult<T>> {
    const { handle, documentId, expectedRevision, expectedHash } = source;
    const { path: expectedPath, fingerprint: expectedFingerprint } = expected;
    if (typeof handle !== "string" || handle.length !== 36 || !uuidPattern.test(handle) ||
        typeof documentId !== "string" || documentId.length !== 36 || !uuidPattern.test(documentId) ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 ||
        typeof expectedHash !== "string" || expectedHash.length !== 64 || !/^[a-f0-9]{64}$/.test(expectedHash))
      return { ok: false, error: "INVALID_REQUEST" };
    let outcome: { ok: true; value: T } | undefined;
    let actionStarted = false;
    try {
      const entered = await service.withCreateBarrier(async () => {
        const owner = createAdmissionOwner;
        const grant = grants.get(handle);
        if (!grant) throw new DocumentFailure("INVALID_HANDLE");
        const { identityKey, path, fingerprint, directories, scope } = grant;
        if (path !== expectedPath || fingerprint !== expectedFingerprint)
          throw new DocumentFailure("FILE_CHANGED");
        const identity = identities.get(identityKey);
        const observed = observations.get(handle);
        if (identity?.documentId !== documentId || identity.revision !== expectedRevision ||
            identity.hash !== expectedHash || observed?.documentId !== documentId ||
            observed.revision !== expectedRevision || observed.hash !== expectedHash)
          throw new DocumentFailure("CONFLICT");
        const generation = epoch;
        const currentCaller = () => {
          try { return callerCurrent(); }
          catch { return false; }
        };
        const checkLogical = () => {
          if (!currentCaller() || disposed || disposing || createAdmissionOwner !== owner || epoch !== generation)
            throw new DocumentFailure("CANCELLED");
          if (grants.get(handle) !== grant || grant.identityKey !== identityKey ||
              grant.path !== path || grant.fingerprint !== fingerprint ||
              grant.directories !== directories || grant.scope !== scope ||
              identities.get(identityKey) !== identity || uncertain.has(documentId) ||
              observations.get(handle) !== observed ||
              (observed.last !== undefined && observed.last !== "unchanged"))
            throw new DocumentFailure("CONFLICT");
          if (trashGuard(path, fingerprint, directories)) throw new DocumentFailure("BUSY");
        };
        checkLogical();
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        let active = true;
        try {
          const stamp = await file.stat({ bigint: true });
          const checkPhysical = () => {
            if (!active) throw new DocumentFailure("CANCELLED");
            checkLogical();
            const now = fstatSync(file.fd, { bigint: true });
            if (!now.isFile() || fileFingerprint(now) !== fingerprint ||
                now.size !== stamp.size || now.mtimeNs !== stamp.mtimeNs ||
                now.ctimeNs !== stamp.ctimeNs || now.mode !== stamp.mode)
              throw new DocumentFailure("FILE_CHANGED");
          };
          const verifySaved = async () => {
            checkPhysical();
            const writable = await capability(grant);
            checkPhysical();
            if (!writable.writable) throw new DocumentFailure("READ_ONLY");
            const bytes = await stableBytes({ ...grant, file }, checkLogical);
            if (createHash("sha256").update(bytes).digest("hex") !== expectedHash)
              throw new DocumentFailure("CONFLICT");
            checkPhysical();
          };
          await verifySaved();
          const current = () => {
            if (!active) return false;
            try { checkPhysical(); return true; }
            catch { active = false; return false; }
          };
          const revalidate = async () => {
            if (!current()) return false;
            try { await verifySaved(); return current(); }
            catch { active = false; return false; }
          };
          actionStarted = true;
          outcome = { ok: true, value: await action({ current, revalidate }) };
          if (!active) throw new DocumentFailure("CANCELLED");
          await verify({ ...grant, file });
          checkPhysical();
        } finally {
          active = false;
          await file.close();
        }
        checkLogical();
      });
      return entered && outcome ? outcome : { ok: false, error: "BUSY" };
    } catch (error) {
      return { ok: false, error: actionStarted ? "UNKNOWN" : codeOf(error) };
    }
  }
  async function snapshot(
    grant: Grant, generation: number, task: Task, maxBytes?: number, guard?: () => void, captureStamp?: (stamp: BigIntStats) => void
  ): Promise<DocumentSnapshot> {
    if (trashGuard(grant.path, grant.fingerprint, grant.directories)) throw new DocumentFailure("BUSY");
    const content = await stableBytes(grant, guard ?? (() => checkTask(task, generation)), maxBytes, captureStamp);
    const length = content.length;
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
    guard?.();
    const writeCapability = await capability(grant);
    guard?.();
    const previous = identities.get(grant.identityKey);
    const recovered = !previous ? mru?.lookup(grant.path, grant.fingerprint) : undefined;
    const occupied = recovered && [...identities.entries()].some(([key, value]) => value.documentId === recovered && key !== grant.identityKey);
    const identity = {
      documentId: previous?.documentId ?? (recovered && !occupied ? recovered : randomUUID()),
      hash,
      revision: previous
        ? previous.revision + Number(previous.hash !== hash)
        : 1,
    };
    return {
      handle: grant.handle,
      explicitStandalone: grant.explicitStandalone === true,
      ...identity,
      fileName: basename(grant.path),
      displayPath: grant.path,
      locationId: locations.get(grant.path) ?? randomUUID(),
      byteLength: length,
      text,
      fidelity,
      writeCapability,
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
    candidates.invalidate(next.documentId);
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

  function dispatchAuthorizedPath(
    request: unknown,
    action: "reveal" | "open-default",
    authorize: (
      check: () => void
    ) => Promise<{ path: string; close(): Promise<void> }>,
    current: () => void,
    handle?: string
  ): Promise<DocumentResponse> {
    if (!validate(request, false))
      return Promise.resolve(failure("", "INVALID_REQUEST"));
    if (disposed)
      return Promise.resolve(failure(request.requestId, "INVALID_HANDLE"));
    if (disposing || createAdmissionOwner || revealing || duplicate(request.requestId) || saving || writeBarrier)
      return Promise.resolve(failure(request.requestId, "BUSY"));
    const { task, promise } = taskFor(request.requestId);
    task.handle = handle;
    revealing = task;
    const generation = epoch,
      barrier = selectBarrierGeneration,
      saveGeneration = saveStartGeneration;
    const check = () => {
      checkTask(task, generation);
      if (
        writeBarrier ||
        saving ||
        barrier !== selectBarrierGeneration ||
        saveGeneration !== saveStartGeneration
      )
        throw new DocumentPathError("FILE_CHANGED");
      current();
    };
    void (async () => {
      let resource: { path: string; close(): Promise<void> } | undefined;
      let response: DocumentResponse;
      try {
        check();
        resource = await authorize(check);
        check();
        if (action === "reveal") {
          if (!revealPath) throw Error("Unavailable");
          revealPath(resource.path);
        } else if (
          !openDefaultPath ||
          openDefaultPath(resource.path) !== true
        ) {
          throw Error("Unavailable");
        }
        task.committed = true;
        response = result(task.id, null);
      } catch {
        response = failure(
          task.id,
          task.cancelled ? "CANCELLED" : "READ_FAILED"
        );
      } finally {
        await resource?.close().catch(() => undefined);
        if (revealing === task) revealing = null;
      }
      task.resolve(response);
    })();
    return promise;
  }

  function dispatchDocumentPath(
    request: unknown,
    action: "reveal" | "open-default"
  ): Promise<DocumentResponse> {
    if (!validate(request, true))
      return Promise.resolve(failure("", "INVALID_REQUEST"));
    const grant = grants.get(request.handle);
    if (disposed || !grant)
      return Promise.resolve(failure(request.requestId, "INVALID_HANDLE"));
    const fingerprint = grant.fingerprint;
    const identityKey = grant.identityKey;
    const scope = grant.scope;
    const current = () => {
      if (
        grants.get(request.handle) !== grant ||
        grant.fingerprint !== fingerprint ||
        grant.identityKey !== identityKey ||
        grant.scope !== scope
      )
        throw new DocumentPathError("FILE_CHANGED");
    };
    return dispatchAuthorizedPath(
      { protocolVersion: 1, requestId: request.requestId },
      action,
      async (check) => {
        let file: Awaited<ReturnType<typeof open>> | undefined;
        try {
          check();
          file = await open(
            grant.path,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
          );
          check();
          await verify({ ...grant, file });
          check();
          const owned = file;
          return { path: grant.path, close: () => owned.close() };
        } catch (error) {
          await file?.close().catch(() => undefined);
          throw error;
        }
      },
      current,
      request.handle
    );
  }
  async function captureReadingSource(
    source: ReadingSnapshotSource,
    callerCurrent: () => boolean,
    mode?: "saved" | "proof" | "viewport"
  ) {
    const { handle, documentId, expectedRevision, expectedHash } = source;
    const reject = (error: DocumentErrorCode) => ({ ok: false as const, error });
    if (
      typeof handle !== "string" || !uuidPattern.test(handle) ||
      typeof documentId !== "string" || !uuidPattern.test(documentId) ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 ||
      typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash)
    ) return reject("INVALID_REQUEST");
    const grant = grants.get(handle);
    if (!grant || (mode === "viewport" && (!grant.scope || grant.explicitStandalone !== false)))
      return reject("INVALID_HANDLE");
    const { identityKey, path, fingerprint, directories, scope, assetScope, assetEpoch } = grant;
    const identity = identities.get(identityKey);
    const observation = observations.get(handle);
    if (
      identity?.documentId !== documentId || identity.revision !== expectedRevision ||
      identity.hash !== expectedHash || observation?.documentId !== documentId ||
      observation.revision !== expectedRevision || observation.hash !== expectedHash
    ) return reject("CONFLICT");
    const generation = epoch;
    const authorization = searchAdmissionGeneration;
    const barrier = selectBarrierGeneration;
    const save = saveStartGeneration;
    const check = (isCurrent = callerCurrent) => {
      let callerIsCurrent: boolean;
      try {
        callerIsCurrent = isCurrent();
      } catch {
        callerIsCurrent = false;
      }
      if (!callerIsCurrent) throw new DocumentFailure("CANCELLED");
      if (!searchIdle()) throw new DocumentFailure("BUSY");
      if (
        epoch !== generation || searchAdmissionGeneration !== authorization ||
        selectBarrierGeneration !== barrier || saveStartGeneration !== save ||
        grants.get(handle) !== grant || grant.identityKey !== identityKey ||
        grant.path !== path || grant.fingerprint !== fingerprint ||
        grant.directories !== directories || grant.scope !== scope ||
        identities.get(identityKey) !== identity || uncertain.has(documentId) ||
        observations.get(handle) !== observation ||
        (observation.last !== undefined && observation.last !== "unchanged")
      ) throw new DocumentFailure("CONFLICT");
      if (mode === "proof" && (grant.assetScope !== assetScope || grant.assetEpoch !== assetEpoch))
        throw new DocumentFailure("CONFLICT");
      if (mode === "viewport" && grant.explicitStandalone !== false)
        throw new DocumentFailure("CONFLICT");
      if (trashGuard(path, fingerprint, directories)) throw new DocumentFailure("BUSY");
    };
    try {
      check();
      const file = await open(
        path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      );
      let bytes: Buffer;
      let stamp: BigIntStats | undefined;
      try {
        bytes = await stableBytes({ ...grant, file }, check, READER_SNAPSHOT_MAX_BYTES,
          mode ? (observed) => { stamp = observed; } : undefined);
      } finally {
        await file.close();
      }
      check();
      if (createHash("sha256").update(bytes).digest("hex") !== expectedHash)
        return reject("CONFLICT");
      try {
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        return reject("INVALID_UTF8");
      }
      let retired = false;
      let nextImageSlot = 0, imageActive = false, imageTicketRetired = false;
      const savedStamp = stamp;
      const readImage: ReadingSnapshotImageRead = async (slot, reference, childCurrent) => {
        const unavailable = { ok: false as const, error: "UNAVAILABLE" as const };
        const stale = { ok: false as const, error: "STALE" as const };
        if (!savedStamp || imageTicketRetired) return stale;
        if (imageActive || slot !== nextImageSlot || slot >= READER_IMAGE_SNAPSHOT_MAX_SLOTS) return unavailable;
        nextImageSlot++;
        const checkSource = () => {
          check(childCurrent);
          if (grant.assetScope !== assetScope || grant.assetEpoch !== assetEpoch)
            throw new DocumentFailure("CONFLICT");
        };
        const sourceCurrent = () => {
          if (imageTicketRetired) return false;
          try {
            checkSource();
            if (sameReadingStamp(savedStamp, lstatSync(path, { bigint: true }))) return true;
          } catch { /* A retired ticket cannot admit another slot. */ }
          imageTicketRetired = true;
          return false;
        };
        if (!sourceCurrent()) return stale;
        const decoded = typeof reference === "string" ? localImageReference(reference) : null;
        if (decoded === null || imageJobs >= 9) return unavailable;
        const assetPath = resolve(dirname(path), decoded);
        if (trashGuard(assetPath)) return unavailable;
        imageActive = true;
        imageJobs++;
        try {
          const sourceFile = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          let image: LocalImageResult;
          try {
            const verifySource = async () => {
              checkSource();
              await assetScope?.verify();
              checkSource();
              const observed = await verify({ ...grant, file: sourceFile });
              checkSource();
              if (!sameReadingStamp(savedStamp, observed) ||
                  !sameReadingStamp(savedStamp, fstatSync(sourceFile.fd, { bigint: true })))
                throw new DocumentFailure("FILE_CHANGED");
            };
            await verifySource();
            if (trashGuard(assetPath)) return unavailable;
            image = await images.read({
              authorization: { selectedPath: grant.selectedPath, selectedParent: grant.selectedParent, path, fingerprint, directories },
              reference,
              profile: "reader-snapshot",
              ...(assetScope ? { assetRoot: { path: assetScope.path, directories: assetScope.directories } } : {}),
            }).catch(() => unavailable);
            await verifySource();
          } finally {
            await sourceFile.close();
          }
          if (!sourceCurrent()) return stale;
          if (!image.ok || trashGuard(assetPath)) return unavailable;
          let imageRetired = false;
          const current = () => {
            if (imageRetired) return false;
            try {
              if (sourceCurrent() && !trashGuard(assetPath)) return true;
            } catch { /* A retired result stays unavailable. */ }
            imageRetired = true;
            return false;
          };
          const { mime, width, height, data } = image;
          return { ok: true, mime, width, height, data, current, sourceCurrent };
        } catch {
          imageTicketRetired = true;
          return stale;
        } finally {
          imageJobs--;
          imageActive = false;
        }
      };
      return {
        ok: true as const,
        bytes,
        current(this: void) {
          if (retired) return false;
          try {
            check();
            if (mode !== "viewport" ||
              (savedStamp && sameReadingStamp(savedStamp, lstatSync(path, { bigint: true })))) return true;
          } catch {
            // A changed grant or physical source retires the receipt.
          }
          retired = true;
          return false;
        },
        ...(savedStamp && (mode === "proof" || (mode === "saved" && bytes.includes("!["))) ? { readImage } : {}),
      };
    } catch (error) {
      return reject(codeOf(error));
    }
  }
  const service: TrustedDocumentService = {
    ownsRecoverySnapshot(value, requestId) {
      const proof = recoveryStamps.get(value);
      return !!proof && proof.requestId === requestId && grants.get(value.handle) === proof.grant;
    },
    async verifyRecoverySnapshots(snapshots, check) {
      if (snapshots.length < 1 || snapshots.length > MAIN_TAB_METADATA_MAX_TABS) return false;
      const bindings = service.captureContentSearchBindings(snapshots.map(value => value.handle));
      if (!bindings) return false;
      const verifyCurrent = () => {
        check();
        if (!bindings.current()) throw Error("RECOVERY_STALE");
      };
      try {
        for (const [index, value] of snapshots.entries()) {
          verifyCurrent();
          const proof = recoveryStamps.get(value);
          const binding = bindings.bindings[index];
          if (!proof || grants.get(value.handle) !== proof.grant ||
              binding?.documentId !== value.documentId || binding.hash !== value.hash ||
              binding.revision !== value.revision) return false;
          const file = await open(proof.grant.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            verifyCurrent();
            const stamp = await verify({ ...proof.grant, file });
            verifyCurrent();
            if (!sameReadingStamp(proof.stamp, stamp) ||
                !sameReadingStamp(proof.stamp, fstatSync(file.fd, { bigint: true }))) return false;
          } finally { await file.close(); }
          verifyCurrent();
        }
        // No await between these terminal observations and the logical fence.
        // This closes JS-await races, not concurrent external filesystem writes.
        for (const value of snapshots) {
          const proof = recoveryStamps.get(value);
          if (!proof || grants.get(value.handle) !== proof.grant ||
              !sameReadingStamp(proof.stamp, lstatSync(proof.grant.path, { bigint: true }))) return false;
        }
        verifyCurrent();
        return true;
      } catch { return false; }
    },
    currentRecoverySnapshot(value, requestId) {
      try {
        const proof = recoveryStamps.get(value);
        if (proof?.requestId !== requestId || !searchIdle()) return false;
        const { grant, scope, stamp } = proof;
        const identity = identities.get(grant.identityKey);
        return grants.get(value.handle) === grant && !!scope && grant.scope === scope &&
          grant.explicitStandalone === false && identity?.documentId === value.documentId &&
          identity.revision === value.revision && identity.hash === value.hash &&
          !uncertain.has(value.documentId) && !trashGuard(grant.path, grant.fingerprint, grant.directories) &&
          sameReadingStamp(stamp, lstatSync(grant.path, { bigint: true }));
      } catch { return false; }
    },
    async captureReadingSnapshot(source, callerCurrent = () => true, options) {
      const captured = await captureReadingSource(source, callerCurrent, options?.includeImage ? "saved" : undefined);
      if (!captured.ok) return captured;
      const { bytes, ...receipt } = captured;
      return { ...receipt, base64: bytes.toString("base64") };
    },
    async captureReadingImageProof(source, current) {
      const captured = await captureReadingSource(source, current, "proof");
      return captured.ok ? captured.readImage : undefined;
    },
    async captureViewportSource({ handle, documentId, revision, hash }, current) {
      const captured = await captureReadingSource(
        { handle, documentId, expectedRevision: revision, expectedHash: hash },
        () => current() === true,
        "viewport"
      );
      if (!captured.ok || !captured.current()) return;
      const { bytes, current: revalidate } = captured;
      return { raw: bytes.toString("utf8"), current: revalidate };
    },
    beginSearchAdmission() {
      if (!searchAdmissible()) return undefined;
      const authorization = searchAdmissionGeneration;
      const barrier = selectBarrierGeneration;
      return {
        current: () =>
          authorization === searchAdmissionGeneration &&
          barrier === selectBarrierGeneration &&
          searchAdmissible(),
      };
    },
    captureContentSearchBindings(handles) {
      if (!searchIdle()) return;
      const authorization = searchAdmissionGeneration;
      const barrier = selectBarrierGeneration;
      const save = saveStartGeneration;
      const grantCount = grants.size;
      const captured = handles.map((handle) => {
        const grant = grants.get(handle);
        const identityKey = grant?.identityKey;
        const identity = identityKey === undefined
          ? undefined
          : identities.get(identityKey);
        const scope = grant?.scope;
        const path = grant?.path;
        const fingerprint = grant?.fingerprint;
        const isUncertain = identity !== undefined && uncertain.has(identity.documentId);
        const current = () =>
          grants.get(handle) === grant &&
          grant?.identityKey === identityKey &&
          grant?.scope === scope &&
          grant?.path === path &&
          grant?.fingerprint === fingerprint &&
          (identityKey === undefined || identities.get(identityKey) === identity) &&
          (identity === undefined || uncertain.has(identity.documentId) === isUncertain);
        let binding: ContentSearchBinding | undefined;
        if (grant && path !== undefined && fingerprint !== undefined && identity && !isUncertain) {
          binding = {
            handle, path, fingerprint, ...identity, scope,
            async verify(check) {
              check();
              const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
              try {
                check();
                await scope?.verify();
                check();
                await verifySingleFileAuthorization({ ...grant, file }, check);
              } finally {
                await file.close();
              }
              check();
            },
          };
          const explicit = grant.explicitStandalone;
          const standalone = explicit === true && !scope;
          if (standalone || (explicit === false && scope)) {
            const directories = grant.directories;
            const checkBinding = () => {
              if (!current() || grant.explicitStandalone !== explicit || grant.directories !== directories)
                throw new DocumentFailure("INVALID_HANDLE");
            };
            const checkTrash = () => {
              if (trashGuard(path, fingerprint, directories)) throw new DocumentFailure("BUSY");
            };
            const checkRead = (callerCheck: () => void) => () => {
              try {
                callerCheck();
              } catch {
                throw new DocumentFailure("CANCELLED");
              }
              checkBinding();
              if (!admissionCurrent()) throw new DocumentFailure("CANCELLED");
              checkTrash();
            };
            const withRetained = async <T>(
              check: () => void,
              action: (opened: Grant) => Promise<T>
            ) => {
              try {
                check();
                const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
                  .catch(() => { throw new DocumentFailure("FILE_CHANGED"); });
                let result: T;
                try {
                  check();
                  result = await action({ ...grant, file });
                  check();
                } finally {
                  await file.close();
                }
                check();
                return result;
              } catch (error) {
                throw new DocumentFailure(codeOf(error));
              }
            };
            if (standalone) {
              binding.readStandalone = async (maxBytes, check) => {
                if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > CONTENT_SEARCH_LIMITS.fileBytes)
                  throw new DocumentFailure("INVALID_REQUEST");
                const current = checkRead(check);
                return withRetained(current, (opened) => stableBytes(opened, current, maxBytes));
              };
              binding.verifyStandalone = (check) =>
                withRetained(checkRead(check), async (opened) => { await verify(opened); });
            }
            binding.prepareRetainedSnapshot = async (requestId, expectedHash, callerCheck, verifyScope, owner) => {
              if (!validate({ protocolVersion: 1, requestId, handle }, true) ||
                  !/^[a-f0-9]{64}$/.test(expectedHash))
                return failure(requestId, "INVALID_REQUEST");
              // A scoped grant may only reopen through a proof from its exact owner.
              if (owner !== scope) return failure(requestId, "INVALID_HANDLE");
              if (!admissionCurrent()) return failure(requestId, "CANCELLED");
              const isObserved = () => observations.get(handle)?.documentId === identity.documentId;
              if (isObserved()) return failure(requestId, "BUSY");
              const watchEpoch = observationEpochs.get(handle)?.epoch;
              const generation = epoch;
              const ownAuthorization = ++searchAdmissionGeneration;
              const { task, promise } = taskFor(requestId);
              task.handle = handle;
              // A superseding document action resolves cancellation early. The
              // workspace still owns this preparation until its descriptor closes.
              const finished = Promise.withResolvers<void>();
              enqueue(task, async () => {
                const check = () => {
                  callerCheck();
                  checkTask(task, generation);
                  checkBinding();
                  if (isObserved()) throw new DocumentFailure("BUSY");
                  if (disposing || running !== task || selecting || revealing ||
                      saving || writeBarrier || createAdmissionOwner || folderMutationLease ||
                      acceptance.busy() ||
                      searchAdmissionGeneration !== ownAuthorization || saveStartGeneration !== save ||
                      selectBarrierGeneration !== barrier || observationEpochs.get(handle)?.epoch !== watchEpoch ||
                      grants.size !== grantCount || !captured.every((binding) => binding.current()))
                    throw new DocumentFailure("CANCELLED");
                  checkTrash();
                };
                try {
                  check();
                  await verifyScope(check);
                  const next = await withRetained(check, async (opened) => {
                    const snapshotValue = await snapshot(opened, generation, task, CONTENT_SEARCH_LIMITS.fileBytes, check);
                    if (snapshotValue.hash !== expectedHash) throw new DocumentFailure("FILE_CHANGED");
                    await verifyScope(check);
                    const bytes = await stableBytes(opened, check, CONTENT_SEARCH_LIMITS.fileBytes);
                    if (createHash("sha256").update(bytes).digest("hex") !== expectedHash)
                      throw new DocumentFailure("FILE_CHANGED");
                    return snapshotValue;
                  });
                  check();
                  commit(grant, next, task, generation);
                  return result(requestId, next);
                } catch (error) {
                  return failure(requestId, codeOf(error));
                } finally {
                  finished.resolve();
                }
              });
              const response = await promise;
              await finished.promise;
              return response;
            };
          }
        }
        return { binding, current };
      });
      const admissionCurrent = (): boolean =>
        searchIdle() &&
        authorization === searchAdmissionGeneration &&
        barrier === selectBarrierGeneration &&
        save === saveStartGeneration &&
        grantCount === grants.size &&
        captured.every((binding) => binding.current());
      return {
        bindings: captured.map(({ binding }) => binding),
        current: admissionCurrent,
      };
    },
    setTrashGuard(guard) { trashGuard = guard; },
    trashBlocked(path, fingerprint, directories) { return trashGuard(path, fingerprint, directories); },
    inspectTrash(handle, documentId) {
      const grant=grants.get(handle);
      if(!grant||identities.get(grant.identityKey)?.documentId!==documentId)return null;
      return {path:grant.path,selectedPath:grant.selectedPath,selectedParent:grant.selectedParent,fingerprint:grant.fingerprint,directories:grant.directories};
    },
    async acquireFolderMutationLease() {
      if (disposed || disposing || createAdmissionOwner || writeBarrier || folderMutationLease || running || pending || selecting || revealing) return null;
      const token = {};
      // Initialize missing legacy metadata before read-only leased state requests.
      for (const grant of grants.values()) grant.assetEpoch ??= randomUUID();
      folderMutationLease = token;
      writeBarrier = true;
      selectBarrierGeneration++;
      const current = () => !disposed && folderMutationLease === token;
      const release = () => {
        if (folderMutationLease !== token) return;
        folderMutationLease = null; writeBarrier = false; wakeSearchReleases(); candidates.wake();
      };
      try {
        await saveTail;
        await acceptance.settled();
        if (!current() || running || pending || selecting || revealing) { release(); return null; }
        const captured = new Map(grants);
        const bindings: FolderGrantBinding[] = [];
        for (const grant of captured.values()) {
          const identity = identities.get(grant.identityKey);
          if (!identity) { release(); return null; }
          bindings.push({ handle: grant.handle, path: grant.path, fingerprint: grant.fingerprint, directories: grant.directories, documentId: identity.documentId, explicitStandalone: grant.explicitStandalone === true, observedActive: observations.get(grant.handle)?.documentId === identity.documentId, scope: grant.scope });
        }
        return {
          current,
          bindings: () => bindings,
          release,
          async prepare(changes) {
            if (!current()) throw Error("Invalid folder mutation lease");
            const seen = new Set<string>();
            const prepared: { change: FolderGrantChange; grant: Grant; assetEpoch: string }[] = [];
            for (const change of changes) {
              const grant = captured.get(change.handle);
              if (!grant || seen.has(change.handle) || grants.get(change.handle) !== grant) throw Error("Invalid folder grant binding");
              seen.add(change.handle);
              if (change.action === "migrate" && !change.scope) throw Error("Missing destination scope");
              if (change.action === "standalone" || change.action === "migrate") {
                await grant.scope?.verify();
                const file = await open(grant.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                try { await verify({ ...grant, file }); } finally { await file.close(); }
                await change.scope?.verify();
              }
              if (!current() || grants.get(change.handle) !== grant) throw Error("Stale folder mutation");
              prepared.push({ change, grant, assetEpoch: randomUUID() });
            }
            let committed = false;
            const assetEpochs = Object.fromEntries([...grants.values()].map(grant => [grant.handle, grant.assetEpoch!])) as Record<string, string>;
            for (const { change, grant, assetEpoch } of prepared) {
              if (change.action === "revoke") delete assetEpochs[grant.handle];
              else assetEpochs[grant.handle] = assetEpoch;
            }
            return { assetEpochs, commit(markCommitted) {
              if (committed || !current()) throw Error("Stale folder commit");
              for (const { grant } of prepared) if (grants.get(grant.handle) !== grant) throw Error("Stale folder binding");
              for (const { change, grant, assetEpoch } of prepared) {
                if (change.action === "revoke") grants.delete(grant.handle);
                else {
                  if (change.action === "standalone") { grant.scope = undefined; grant.explicitStandalone = true; }
                  else if (change.action === "migrate") grant.scope = change.scope;
                  grant.assetScope = change.assetScope;
                  grant.assetEpoch = assetEpoch;
                }
              }
              committed = true; markCommitted();
              for (const { change, grant } of prepared) {
                candidates.discardHandle(grant.handle);
                acceptance.release(grant.handle);
                if (change.action !== "revoke") continue;
                for (const cleanup of [() => releaseObservation(grant.handle), () => mirrors.release(grant.handle), () => unwatch(grant.handle)]) {
                  try { cleanup(); } catch { console.warn("Folder removal document cleanup failed"); }
                }
              }
            } };
          },
        };
      } catch { release(); return null; }
    },
    inspectStandaloneRemoval(handle, eligible) {
      const grant = grants.get(handle);
      return !disposed && !saving && !writeBarrier && !selecting && !running && !pending && !acceptance.busy() && grant?.explicitStandalone === true && !grant.scope && eligible(grant.path) ? grant : null;
    },
    commitStandaloneRemoval(handle, identity, eligible, committed) {
      const grant = grants.get(handle);
      if (disposed || saving || writeBarrier || selecting || running || pending || acceptance.busy() || grant !== identity || grant?.explicitStandalone !== true || grant.scope || !eligible(grant.path)) return false;
      // Synchronous authority revocation: no await between final binding check and removal.
      grants.delete(handle);
      committed();
      if (revealing?.handle === handle) cancel(revealing);
      releaseObservation(handle);
      mirrors.release(handle);
      unwatch(handle);
      return true;
    },
    revealAuthorized: (request, authorize, current) =>
      dispatchAuthorizedPath(request, "reveal", authorize, current),
    openDefaultAuthorized: (request, authorize, current) =>
      dispatchAuthorizedPath(request, "open-default", authorize, current),
    reveal: (request) => dispatchDocumentPath(request, "reveal"),
    openDefault: (request) => dispatchDocumentPath(request, "open-default"),
    async acceptRefreshCandidate(request) {
      if (!validRefreshAcceptance(request)) return { status: "rejected", error: "INVALID_REQUEST" };
      const params = { ...request };
      if (disposed || !grants.has(params.handle)) return { status: "unknown" };
      const blockedGrant=grants.get(params.handle)!;
      if(trashGuard(blockedGrant.path,blockedGrant.fingerprint,blockedGrant.directories))return {status:"unknown"};
      const result = await acceptance.run(params, !disposing && !createAdmissionOwner && !saving && !writeBarrier && !running && !pending && !selecting, async () => {
        const lease = candidates.acquire(params.token, params.handle), grant = grants.get(params.handle);
        if (!lease || !grant) return { status: "rejected", error: "INVALID_HANDLE" };
        const identity = identities.get(grant.identityKey), generation = epoch;
        const current = () => !disposed && !saving && !writeBarrier && epoch === generation && grants.get(params.handle) === grant &&
          identities.get(grant.identityKey) === identity && lease.current();
        const task: Task = { id: params.operationId, get cancelled() { return !current(); }, committed: false, resolve: () => undefined };
        try {
          checkTask(task, generation);
          const file = await open(grant.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          let next: DocumentSnapshot;
          try {
            const before = await verify({ ...grant, file });
            next = await snapshot({ ...grant, file }, generation, task);
            const after = await verify({ ...grant, file });
            if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || next.hash !== lease.candidate.hash)
              throw new DocumentFailure("FILE_CHANGED");
          } finally { await file.close(); }
          // All asynchronous verification is complete. No await between this
          // lifetime/CAS check and the accepted in-memory baseline publication.
          checkTask(task, generation);
          if (identity?.documentId !== lease.candidate.documentId || identity.revision !== lease.candidate.expectedRevision || identity.hash !== lease.candidate.expectedHash)
            throw new DocumentFailure("CONFLICT");
          commit(grant, next, task, generation);
          observationQueue.hint(grant.handle);
          return { status: "committed", snapshot: next };
        } catch (error) {
          // Once publication starts, even an unexpected local failure must not
          // masquerade as proof that no baseline change happened.
          return task.committed ? { status: "unknown" } : { status: "rejected", error: codeOf(error) };
        }
      });
      candidates.wake();
      return result;
    },
    queryRefreshAcceptance(request) {
      if (!validRefreshAcceptance(request)) return { status: "rejected", error: "INVALID_REQUEST" };
      if (disposed || !grants.has(request.handle)) return { status: "unknown" };
      return acceptance.query(request);
    },
    async readRefreshCandidate(request) {
      if (!validRefreshBinding(request)) return { ok: false, error: "INVALID_REQUEST" };
      const binding = { ...request }, grant = grants.get(binding.handle);
      const identity = grant && identities.get(grant.identityKey);
      if (disposed || !grant || identity?.documentId !== binding.documentId)
        return { ok: false, error: "INVALID_HANDLE" };
      if (identity.revision !== binding.expectedRevision || identity.hash !== binding.expectedHash)
        return { ok: false, error: "CONFLICT" };
      if (saving || writeBarrier || acceptance.busy() || uncertain.has(identity.documentId)) return { ok: false, error: "BUSY" };
      const fingerprint = grant.fingerprint, generation = epoch, barrierGeneration = selectBarrierGeneration;
      const current = () => !disposed && epoch === generation && selectBarrierGeneration === barrierGeneration && !saving && !writeBarrier &&
        grants.get(binding.handle) === grant && grant.fingerprint === fingerprint &&
        identities.get(grant.identityKey) === identity && !uncertain.has(identity.documentId);
      return candidates.request({
        binding, current,
        verify: async () => {
          const file = await open(grant.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try { await verify({ ...grant, file }); } finally { await file.close(); }
        },
        read: async alive => {
          const task: Task = { id: randomUUID(), get cancelled() { return !alive(); }, committed: false, resolve: () => undefined };
          checkTask(task, generation);
          const file = await open(grant.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const content = await snapshot({ ...grant, file }, generation, task);
            checkTask(task, generation);
            return { text: content.text, hash: content.hash, byteLength: content.byteLength, fidelity: content.fidelity };
          } finally { await file.close(); }
        },
      });
    },
    checkRefreshCandidateBinding: candidates.checkBinding,
    discardRefreshCandidate: candidates.discardHandle,
    observe(request) {
      if (!validObservationRequest(request)) return Promise.resolve({ ok: false, requestId: "" });
      const { active, requestId, ...binding } = request;
      const grant = grants.get(binding.handle), identity = grant && identities.get(grant.identityKey);
      if (disposed || !grant) return Promise.resolve({ ok: false, requestId });
      const prior = observationEpochs.get(binding.handle);
      if (prior && (binding.watchEpoch < prior.epoch || (binding.watchEpoch === prior.epoch && (binding.watchToken !== prior.token || (!prior.active && active))))) return Promise.resolve({ ok: false, requestId });
      if (!active) {
        observationEpochs.set(binding.handle, { epoch: binding.watchEpoch, token: binding.watchToken, active: false });
        forgetObservation(binding.handle);
        return Promise.resolve({ ok: true, requestId });
      }
      if (folderMutationLease) return Promise.resolve({ ok: false, requestId });
      if (disposed || !grant || identity?.documentId !== binding.documentId || identity.revision !== binding.revision || identity.hash !== binding.hash) return Promise.resolve({ ok: false, requestId });
      observationEpochs.set(binding.handle, { epoch: binding.watchEpoch, token: binding.watchToken, active: true });
      const old = observations.get(binding.handle);
      if (old?.watchEpoch !== binding.watchEpoch || old.watchToken !== binding.watchToken || old.revision !== binding.revision || old.hash !== binding.hash) observations.set(binding.handle, binding);
      else old.last = undefined; // An explicit retry must report a freshly verified state, not only its ACK.
      observationQueue.add(binding.handle);
      return Promise.resolve({ ok: true, requestId });
    },
    locations: () =>
      [...grants.values()].map((grant) => ({
        handle: grant.handle,
        path: grant.path,
        fingerprint: grant.fingerprint,
        documentId: identities.get(grant.identityKey)?.documentId,
      })),
    inspectMRU(entry) {
      const generation=epoch;
      const current=()=>{
        if(disposed||disposing||saving||writeBarrier||createAdmissionOwner||folderMutationLease||epoch!==generation)throw Error("MRU_STALE");
        const key=`${entry.path}:${entry.fingerprint}`;
        for(const [identityKey,identity] of identities){
          if((identity.documentId===entry.documentId&&identityKey!==key)||(identityKey===key&&identity.documentId!==entry.documentId))throw Error("MRU_IDENTITY");
        }
      };
      try{current();return current;}catch{return undefined;}
    },
    captureMRU(handle, documentId) {
      const grant=grants.get(handle);
      if(disposed||disposing||!grant||identities.get(grant.identityKey)?.documentId!==documentId)return;
      return {documentId,path:grant.path,fingerprint:grant.fingerprint,rank:0};
    },
    async resolveMRUIndependent(entry, check) {
      if(disposed||disposing||saving||writeBarrier)return;
      const grant=[...grants.values()].find(g=>g.explicitStandalone&&g.path===entry.path&&g.fingerprint===entry.fingerprint);
      if(!grant)return;
      const generation=epoch;
      const live=()=>{check();if(disposed||disposing||saving||writeBarrier||epoch!==generation||grants.get(grant.handle)!==grant||grant.fingerprint!==entry.fingerprint)throw Error("MRU_STALE");};
      live();const opened=await authorizeSingleFile(grant.path,live);
      try{live();if(opened.fingerprint!==entry.fingerprint)return;await verifySingleFileAuthorization(opened,live);live();return {handle:grant.handle,current:live};}finally{await opened.file.close();}
    },
    setAssetScope(handle, scope) {
      if (folderMutationLease) return;
      const grant = grants.get(handle);
      if (grant && grant.assetScope !== scope) {
        grant.assetScope = scope;
        grant.assetEpoch = randomUUID();
      }
    },
    assetEpochs: () =>
      Object.fromEntries(
        [...grants.values()].map((grant) => [
          grant.handle,
          folderMutationLease ? grant.assetEpoch! : (grant.assetEpoch ??= randomUUID()),
        ])
      ),
    revokeScope(scope) {
      if (folderMutationLease) return;
      for (const [handle, grant] of grants)
        if (grant.scope === scope) {
          grants.delete(handle);
          releaseObservation(handle);
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
    async withDuplicateBuffer(source, payload, action) {
      if (!validDuplicateVersion({ kind: "buffer", ...payload })) throw new DocumentFailure("INVALID_REQUEST");
      const bytes = new TextEncoder().encode(payload.text);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (hash !== payload.hash) throw new DocumentFailure("INVALID_REQUEST");
      return service.withCreateBarrier(async () => {
        const owner = createAdmissionOwner, grant = grants.get(source.handle), generation = epoch;
        const check = () => {
          const identity = grant && identities.get(grant.identityKey);
          if (!grant || disposed || disposing || epoch !== generation || createAdmissionOwner !== owner || grants.get(source.handle) !== grant || identity?.documentId !== source.documentId || identity.revision !== source.expectedRevision || identity.hash !== source.expectedHash || uncertain.has(source.documentId)) throw new DocumentFailure("CONFLICT");
          const observation = observations.get(source.handle);
          if (observation?.documentId === source.documentId && observation.revision === source.expectedRevision && observation.hash === source.expectedHash && observation.last && observation.last !== "unchanged") throw new DocumentFailure("CONFLICT");
        };
        check();
        await action({ bytes, hash, fileName: basename(grant!.path), checkCurrent: check, revalidate: () => { check(); return Promise.resolve(); } });
      });
    },
    async withDuplicateSource(source, action) {
      return service.withCreateBarrier(async () => {
        const owner = createAdmissionOwner;
        const grant = grants.get(source.handle);
        const generation = epoch;
        const check = () => {
          const identity = grant && identities.get(grant.identityKey);
          if (!grant || disposed || disposing || epoch !== generation || createAdmissionOwner !== owner || grants.get(source.handle) !== grant || identity?.documentId !== source.documentId || identity.revision !== source.expectedRevision || identity.hash !== source.expectedHash || uncertain.has(source.documentId)) throw new DocumentFailure("CONFLICT");
        };
        check();
        const file = await open(grant!.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const read = async () => { const bytes = await stableBytes({...grant!, file}, check); if (createHash("sha256").update(bytes).digest("hex") !== source.expectedHash) throw new DocumentFailure("CONFLICT"); return bytes; };
          const bytes = await read(); check();
          await action({bytes, hash: source.expectedHash, fileName: basename(grant!.path), checkCurrent: check, revalidate: async () => { await read(); check(); }});
        } finally { await file.close(); }
      });
    },
    withPastedRasterSource,
    async withCreateBarrier(action) {
      if (disposed || disposing || createAdmissionOwner || writeBarrier || folderMutationLease || running || pending || selecting || revealing) return false;
      const owner = {}; createAdmissionOwner = owner; writeBarrier = true; selectBarrierGeneration++;
      try {
        await saveTail; await acceptance.settled();
        if (disposed || disposing || createAdmissionOwner !== owner || running || pending || selecting || revealing || folderMutationLease) return false;
        await action(); return true;
      } finally {
        if (createAdmissionOwner === owner && !disposing) { createAdmissionOwner = null; writeBarrier = false; wakeSearchReleases(); candidates.wake(); }
      }
    },
    async openCreatedAuthorized(request, getAuthorization, scope, sink) {
      if (!validate(request, false)) return failure("", "INVALID_REQUEST");
      if (disposed || disposing || createAdmissionOwner || running || pending || selecting || revealing || saving || writeBarrier || folderMutationLease || acceptance.busy()) return failure(request.requestId, "BUSY");
      const owner = {}; createAdmissionOwner = owner;
      const { task, promise } = taskFor(request.requestId), generation = epoch;
      searchAdmissionGeneration++;
      enqueue(task, async () => {
        let candidate: Grant | null = null;
        const check = () => { checkTask(task, generation); if (disposing || createAdmissionOwner !== owner) throw new DocumentFailure("CANCELLED"); };
        try {
          check(); await scope.verify(); check();
          const authorization = await getAuthorization();
          candidate = { ...authorization, handle: randomUUID(), identityKey: `${authorization.path}:${authorization.fingerprint}`, explicitStandalone: false, assetEpoch: randomUUID(), scope };
          check(); const next = await snapshot(candidate, generation, task);
          await scope.verify(); check();
          commit(candidate, next, task, generation); grants.set(candidate.handle, candidate); sink(next);
          watchGrant(candidate);
          return result(request.requestId, next);
        } catch (error) { return failure(request.requestId, codeOf(error)); }
        finally { await close(candidate); if (createAdmissionOwner === owner && !disposing) createAdmissionOwner = null; }
      }, owner);
      return promise;
    },
    async openAuthorized(request, getAuthorization, scope, proof) {
      if (!validate(request, false)) return failure("", "INVALID_REQUEST");
      if (disposed) return failure(request.requestId, "INVALID_HANDLE");
      if (saving || writeBarrier || acceptance.busy() || selecting || duplicate(request.requestId))
        return failure(request.requestId, "BUSY");
      if (proof && !searchIdle()) return failure(request.requestId, "BUSY");
      const { task, promise } = taskFor(request.requestId),
        generation = epoch;
      const barrier = selectBarrierGeneration;
      searchAdmissionGeneration++;
      enqueue(task, async () => {
        let candidate: Grant | null = null;
        try {
          const check = () => {
            checkTask(task, generation);
            if (proof && (writeBarrier || barrier !== selectBarrierGeneration))
              throw new DocumentFailure("BUSY");
            proof?.check();
          };
          check();
          await scope.verify();
          const authorization = await getAuthorization();
          candidate = {
            ...authorization,
            handle: randomUUID(),
            identityKey: `${authorization.path}:${authorization.fingerprint}`,
            explicitStandalone: [...grants.values()].some(
              (existing) =>
                existing.identityKey ===
                  `${authorization.path}:${authorization.fingerprint}` &&
                existing.explicitStandalone
            ),
            ...(proof ? { searchPrepared: true } : {}),
            assetEpoch: randomUUID(),
            scope,
          };
          // Reopening through a tree must not replace prior explicit authority
          // with a root-dependent grant when the old handle is released.
          if (candidate.explicitStandalone) candidate.scope = undefined;
          const checkFreshTarget = (path: string) => {
            if ([...grants.values()].some((grant) => grant.path === path))
              throw new DocumentFailure("FILE_CHANGED");
          };
          if (proof) checkFreshTarget(candidate.path);
          check();
          await scope.verify();
          let recoveryStamp: BigIntStats | undefined;
          const next = await snapshot(candidate, generation, task, proof?.maxBytes, proof ? check : undefined,
            proof?.retainRecoveryStamp ? stamp => { recoveryStamp = stamp; } : undefined);
          await scope.verify();
          check();
          if (proof) {
            await proof.verify(candidate, next, check);
            check();
            checkFreshTarget(candidate.path);
          }
          commit(candidate, next, task, generation);
          grants.set(candidate.handle, candidate);
          if (recoveryStamp) recoveryStamps.set(next, {
            stamp: recoveryStamp, grant: candidate, scope: candidate.scope, requestId: request.requestId,
          });
          if (candidate.explicitStandalone) scope.release?.();
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
      const assetScope = grant.assetScope,
        assetEpoch = grant.assetEpoch;
      if (imageJobs >= 9) return { ...envelope, ok: false, error: "BUSY" };
      imageJobs++;
      const stillCurrent = () =>
        !disposed &&
        generation === epoch &&
        grants.get(request.handle) === grant &&
        grant.identityKey === identityKey &&
        grant.assetScope === assetScope &&
        grant.assetEpoch === assetEpoch &&
        !saving &&
        !writeBarrier;
      try {
        const verifyCurrent = async () => {
          await assetScope?.verify();
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
          ...(assetScope
            ? {
                assetRoot: {
                  path: assetScope.path,
                  directories: assetScope.directories,
                },
              }
            : {}),
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
      const barrierGeneration = selectBarrierGeneration;
      const blocked = () => folderMutationLease !== null || selectBarrierGeneration !== barrierGeneration;
      if (disposed || !grant)
        return {
          ...response,
          capability: { writable: false, reason: "invalid" },
        };
      if (blocked()) return { ...response, capability: { writable: false, reason: "unavailable" } };
      let job = capabilityJobs.get(grant.handle);
      if (!job) {
        if (capabilityJobs.size >= 2)
          return {
            ...response,
            capability: { writable: false, reason: "unavailable" },
          };
        job = (async (): Promise<WriteCapability> => {
          await saveTail;
          if (disposed || blocked() || grants.get(grant.handle) !== grant)
            return { writable: false, reason: "invalid" };
          const fingerprint = grant.fingerprint;
          const version = capabilityVersions.get(grant.handle);
          try {
            const checked = await capability(grant);
            if (
              disposed ||
              blocked() ||
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
      if (disposed || blocked() || grants.get(grant.handle) !== grant)
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
        await acceptance.settled();
      } while (saving > 0 || acceptance.busy());
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
        disposing || createAdmissionOwner ||
        writeBarrier ||
        savingRequests.has(request.requestId) ||
        saving >= 2 ||
        running ||
        pending ||
        selecting
      )
        return failure(request.requestId, "BUSY");
      saving++;
      saveStartGeneration++;
      candidates.invalidate(request.documentId);
      savingRequests.add(request.requestId);
      const previous = saveTail;
      let finish!: () => void;
      saveTail = new Promise<void>((resolve) => {
        finish = resolve;
      });
      try {
        await previous;
        // A foreground save invalidates the candidate and lets an in-flight
        // acceptance settle before inspecting its authoritative baseline.
        await acceptance.settled();
        const grant = grants.get(request.handle);
        if (!grant || disposed)
          return failure(request.requestId, "INVALID_HANDLE");
        if(trashGuard(grant.path,grant.fingerprint,grant.directories))return failure(request.requestId,"BUSY");
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
        try { mru?.migrate(identity.documentId, grant.path, grant.fingerprint, written.fingerprint); } catch { /* Optional metadata cannot change save durability. */ }
        commits.set(identity.documentId, { token: randomUUID(), fingerprint: written.fingerprint, revision: nextIdentity.revision, hash: written.hash });
        for (const owned of grants.values())
          if (owned.identityKey === oldKey) {
            owned.fingerprint = written.fingerprint;
            owned.identityKey = newKey;
            owned.assetEpoch = randomUUID();
            watchGrant(owned);
            observationQueue.hint(owned.handle);
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
        candidates.wake();
      }
    },
    async withWriteBarrier(action) {
      if (writeBarrier || disposed || disposing || createAdmissionOwner) return false;
      writeBarrier = true;
      selectBarrierGeneration++;
      try {
        await saveTail;
        await acceptance.settled();
        return await action();
      } finally {
        writeBarrier = false;
        wakeSearchReleases();
        candidates.wake();
      }
    },
    async select(request, prepareStartingFolder) {
      if (!validate(request, false)) return failure("", "INVALID_REQUEST");
      if (disposing || createAdmissionOwner || saving || writeBarrier || acceptance.busy()) return failure(request.requestId, "BUSY");
      if (disposed) return failure(request.requestId, "INVALID_HANDLE");
      if (selecting || duplicate(request.requestId))
        return failure(request.requestId, "BUSY");
      const { task, promise } = taskFor(request.requestId);
      selecting = task;
      searchAdmissionGeneration++;
      const generation = epoch;
      const selectedBarrier = selectBarrierGeneration;
      void (async () => {
        try {
          const checkSelection = () => { checkTask(task, generation); if (writeBarrier || selectedBarrier !== selectBarrierGeneration) throw new DocumentPathError("BUSY"); };
          const startingFolder = prepareStartingFolder ? await prepareStartingFolder(checkSelection) : undefined;
          checkTask(task, generation);
          if (writeBarrier || selectedBarrier !== selectBarrierGeneration) {
            task.resolve(failure(request.requestId, "BUSY"));
            return;
          }
          const pickerStart = onTiming ? performance.now() : 0;
          const selected = await pickFile(startingFolder);
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
                explicitStandalone: true,
                assetEpoch: randomUUID(),
              };
              checkTask(task, generation);
              const next = await snapshot(candidate, generation, task);
              if (writeBarrier || selectedBarrier !== selectBarrierGeneration) return failure(request.requestId, "BUSY");
              commit(candidate, next, task, generation);
              // The renderer adopts the new grant before releasing its old one.
              // A committed selection can still arrive after it was cancelled.
              grants.set(candidate.handle, candidate);
              try {
                const recorded = onStandaloneSelected?.(Object.freeze({ path: candidate.path, accessedAt: Date.now() }));
                if (recorded) void recorded.catch(() => undefined);
              } catch { /* Ancillary metadata must not turn a successful open into failure. */ }
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
          candidates.wake();
        }
      })();
      return promise;
    },
    async read(request) {
      if (!validate(request, true)) return failure("", "INVALID_REQUEST");
      if (saving || writeBarrier || acceptance.busy()) return failure(request.requestId, "BUSY");
      if (duplicate(request.requestId))
        return failure(request.requestId, "BUSY");
      const grant = grants.get(request.handle);
      const generation = epoch;
      if(grant&&trashGuard(grant.path,grant.fingerprint,grant.directories))return failure(request.requestId,"BUSY");
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
            releaseObservation(grant.handle);
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
      for (const task of [selecting, running, pending?.task, revealing])
        if (task?.id === request.requestId) cancel(task);
      if (pending?.task.cancelled) pending = null;
      return Promise.resolve(result(request.requestId, null));
    },
    async release(request) {
      if (!validate(request, true))
        return failure("", "INVALID_REQUEST");
      const grant = grants.get(request.handle);
      // A late search receipt may need cleanup after another operation began.
      // Keep the ordinary release barrier and wait only for these exact grants.
      while (grant?.searchPrepared && (saving || writeBarrier) && !disposing &&
             grants.get(request.handle) === grant) {
        if (writeBarrier) {
          releaseBarrier ??= Promise.withResolvers<void>();
          await releaseBarrier.promise;
        } else {
          await saveTail;
        }
      }
      if (saving || writeBarrier)
        return failure(request.requestId, "BUSY");
      if (disposed || !grant || grants.get(request.handle) !== grant)
        return failure(request.requestId, "INVALID_HANDLE");
      grant.scope?.release?.();
      grants.delete(request.handle);
      if (revealing?.handle === request.handle) cancel(revealing);
      releaseObservation(request.handle);
      mirrors.release(request.handle);
      unwatch(request.handle);
      if (running?.handle === request.handle) cancel(running);
      if (pending?.task.handle === request.handle) {
        cancel(pending.task);
        pending = null;
      }
      return result(request.requestId, null);
    },
    async dispose() {
      disposing = true;
      wakeSearchReleases();
      createAdmissionOwner = null;
      writeBarrier = true;
      cancel(revealing);
      candidates.dispose();
      await saveTail;
      await acceptance.settled();
      acceptance.clear();
      disposed = true;
      observationQueue.dispose();
      observations.clear();
      observationEpochs.clear();
      commits.clear();
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
  return service;
}
