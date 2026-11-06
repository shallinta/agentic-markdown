import { createHash, randomUUID } from "node:crypto";
import { closeSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative } from "node:path";

import type {
  ContentSearchCandidates,
  ContentSearchInput,
  ContentSearchPrepareInput,
  ContentSearchPrepared,
  ContentSearchRetainedPrepareInput,
  ContentSearchRetainedPrepared,
  ContentSearchRootSetInput,
  ContentSearchScopeRoot,
  ContentSearchWorkspaceInput,
  SearchMapping,
} from "../../shared/content-search";
import {
  CONTENT_SEARCH_LIMITS,
  validContentSearchDocumentBinding,
  validContentSearchPrepareRequest,
  validContentSearchScopeRoots,
} from "../../shared/content-search";
import {
  CONTENT_SEARCH_FILTER_COUNT_LIMIT,
  matchesContentSearchFileFilters,
  matchesContentSearchPathFilters,
  relativeContentSearchPath,
  validContentSearchFileFilters,
  validContentSearchPathFilters,
} from "../../shared/content-search-filters";
import type { CreateFolderResponse } from "../../shared/create-folder";
import type { CreateTarget, CreateMarkdownResponse } from "../../shared/create-markdown";
import type { FolderRemovalPublication } from "../../shared/folder-removal";
import { perfUuid } from "../../shared/perf-lab";
import { hashPattern } from "../../shared/save-content";
import {
  WORKSPACE_CACHE_BYTES,
  WORKSPACE_MAX_ROOTS,
  WORKSPACE_PAGE_SIZE,
  validWorkspaceOpen,
  validWorkspaceReveal,
  validWorkspaceDefaultOpen,
  validWorkspaceRequest,
  type WorkspaceNode,
  type WorkspaceResponse,
  type WorkspaceRoot,
  type WorkspaceService,
  type DirectoryOperation,
} from "../../shared/workspace";
import type {
  TrustedDocumentService,
  DocumentScope,
  AssetScope,
  FolderMutationLease,
  FolderGrantChange,
} from "../documents";
import { resolveSaveWorkerEntry } from "../documents/atomic-save";
import { DocumentPathError, authorizeSingleFile } from "../documents/path-authorization";
import { createStandaloneRemoval } from "../documents/standalone-removal";
import { INDEX_LIMITS, keys, record, scalar } from "../index/protocol";

import {
  authorizeRoot,
  authorizeEntry,
  containsPath,
  verifyRoot,
  visiblePath,
  type RootAuthorization,
} from "./authorization";
import { createAutomaticObservation } from "./automatic-observation";
import { createFolderService, type FolderLease } from "./create-folder";
import type { FolderNative } from "./create-folder-disk";
import { createMarkdownService, type CreationNative, type CreationTarget, type CreationLease } from "./create-markdown";
import { createDirectoryRegistry } from "./created-directories";
import { createFolderRemoval } from "./folder-removal";
import type { HiddenPreferences } from "./preferences";
import type { HiddenRemoval } from "./preferences";
import { createReconciliation } from "./reconciliation";
import {
  openDirectoryDescriptor,
  type DirectoryNative,
  type ScanFile,
  type ScanDirectory,
} from "./scan";
import { validScanBatch } from "./scan-protocol";
import {
  readStableSearchBytes,
  searchSnapshot,
  searchSnapshotEvidenceAcrossRoots,
  type SearchSnapshotStandalone,
  type SearchSnapshotStrategy,
} from "./search-snapshot";
import { createTrashService } from "./trash-document";
import { createScanWorker } from "./worker";

interface Root {
  meta: WorkspaceRoot;
  authorization: RootAuthorization;
  nodes: WorkspaceNode[];
  byPath: Map<string, WorkspaceNode>;
  files: Map<string, ScanFile>;
  directories: Map<string, ScanDirectory>;
  registry: ReturnType<typeof createDirectoryRegistry>;
  scanVersion: number;
  bytes: number;
  started: boolean;
  live: boolean;
  scopes: Set<Owner>;
  priorities: string[];
  queueBytes: number;
}
interface Owner extends DocumentScope {
  root: Root;
}
export interface TrustedWorkspaceService extends WorkspaceService {
  searchSnapshot(
    root: string,
    generation: number,
    query: string,
    signal?: AbortSignal
  ): ReturnType<typeof searchSnapshot>;
  searchContentCandidates(
    input: ContentSearchInput,
    signal?: AbortSignal
  ): Promise<ContentSearchCandidates>;
  searchContentCandidatesForRoots(
    input: ContentSearchRootSetInput,
    signal?: AbortSignal
  ): Promise<ContentSearchCandidates>;
  searchContentCandidatesForWorkspace(
    input: ContentSearchWorkspaceInput,
    signal?: AbortSignal
  ): Promise<ContentSearchCandidates>;
  prepareContentSearchDocument(
    input: ContentSearchPrepareInput,
    requestId: string,
    signal?: AbortSignal
  ): Promise<ContentSearchPrepared>;
  prepareRetainedContentSearchDocument(
    input: ContentSearchRetainedPrepareInput,
    requestId: string,
    signal?: AbortSignal
  ): Promise<ContentSearchRetainedPrepared>;
  trashLifecycle: Pick<ReturnType<typeof createTrashService>,"beforeExit"|"cancelExit"|"finishExit">;
  resolveMRU(entries: readonly import("../../shared/document-mru").MRUEntry[], check: () => void): Promise<{ items: import("../../shared/document-mru").MRUResolved[]; incomplete: boolean; current():void }>;
  createMarkdown(value: unknown): Promise<CreateMarkdownResponse>;
  duplicateMarkdown(value: unknown): Promise<CreateMarkdownResponse>;
  createFolder(value: unknown): Promise<CreateFolderResponse>;
  trashDocument(value: unknown): Promise<import("../../shared/trash-document").TrashResponse>;
  reconciliation: Pick<
    ReturnType<typeof createReconciliation>,
    "prepare" | "get" | "release" | "issue" | "accept" | "query"
  >;
}
export function createWorkspaceService({
  pickDirectory,
  documents,
  worker = createScanWorker(),
  cacheLimit = WORKSPACE_CACHE_BYTES,
  manualLeaseMs = 30_000,
  contentSearchStrategy = "native",
  directoryNative,
  trashRun,
  preferences = {
    get: () => Promise.resolve(false),
    set: () => Promise.resolve(),
    remove: () => Promise.resolve({ status: "committed" as const, query: () => Promise.resolve("committed" as const) }),
  },
}: {
  pickDirectory: () => Promise<string | null>;
  documents: TrustedDocumentService;
  worker?: ReturnType<typeof createScanWorker>;
  cacheLimit?: number;
  contentSearchStrategy?: SearchSnapshotStrategy;
  /** Bounded lifetime for an issued but never accepted manual operation. */
  manualLeaseMs?: number;
  directoryNative?: DirectoryNative;
  trashRun?: (input: import("../documents/trash-operation").TrashInput) => Promise<import("../documents/trash-operation").TrashResult>;
  preferences?: HiddenPreferences;
}): TrustedWorkspaceService {
  const roots: Root[] = [];
  let trashReceiptBytes=0;
  let preferenceTail: Promise<unknown> = Promise.resolve();
  let preferencePending = 0;
  let removalAdmission = false;
  let scanParked = false;
  let reachedPark: (() => void) | undefined;
  let releaseFolderRemoval: (() => void) | undefined;
  let createOwner: object | undefined;
  let releaseCreation: (() => void) | undefined;
  const assetOwners = new Map<string, { root: Root; scope: AssetScope }>();
  function makeAssetScope(root: Root) {
    const scope: AssetScope = {
      path: root.authorization.path,
      directories: root.authorization.directories.map((directory) => ({
        ...directory,
      })),
      async verify() {
        if (disposed || !root.live || !roots.includes(root))
          throw new DocumentPathError("INVALID_HANDLE");
        await verifyRoot(root.authorization);
        if (disposed || !root.live || !roots.includes(root))
          throw new DocumentPathError("INVALID_HANDLE");
      },
    };
    return scope;
  }
  function bindAssets(handle: string, root: Root) {
    if (assetOwners.get(handle)?.root === root) return;
    const scope = makeAssetScope(root);
    assetOwners.set(handle, { root, scope });
    documents.setAssetScope(handle, scope);
  }
  function syncAssets() {
    const locations = documents.locations();
    const active = new Set(locations.map((file) => file.handle));
    for (const handle of assetOwners.keys())
      if (!active.has(handle)) assetOwners.delete(handle);
    for (const file of locations) {
      if (assetOwners.has(file.handle)) continue;
      for (const root of roots) {
        const node = root.byPath.get(file.path);
        const scanned = node && root.files.get(node.handle);
        if (scanned?.fingerprint === file.fingerprint) {
          bindAssets(file.handle, root);
          break;
        }
      }
    }
  }
  let selecting = false,
    searchSelectionGeneration = 0,
    workerStopped = false,
    disposed = false,
    epoch = 0,
    running = false,
    cacheBytes = 0,
    turn = 0;
  const cleanup: string[] = [];
  const workerKeys = new Set<string>();
  const queueCleanup = (value: string) => {
    if (workerKeys.has(value) && !cleanup.includes(value)) cleanup.push(value);
  };
  const key = (root: Root) => `${root.meta.handle}:${root.meta.generation}`;
  const state = (id: string, sync = true): WorkspaceResponse => {
    if (sync && !removalAdmission) syncAssets();
    return {
      protocolVersion: 1,
      requestId: id,
      ok: true,
      roots: roots.map((root) => ({ ...root.meta })),
      cacheBytes:cacheBytes+trashReceiptBytes,
      assetEpochs: documents.assetEpochs(),
      queueBytes: roots.reduce((sum, root) => sum + root.queueBytes, 0),
      coveredHandles: documents
        .locations()
        .filter((file) =>
          roots.some((root) => root.byPath.get(file.path)?.kind === "file")
        )
        .map((file) => file.handle),
    };
  };
  const failure = (
    id: string,
    error: "INVALID_REQUEST" | "INVALID_HANDLE" | "UNAVAILABLE" | "BUSY"
  ): WorkspaceResponse => ({
    protocolVersion: 1,
    requestId: id,
    ok: false,
    error,
  });
  const live = (root: Root, generation: number) =>
    !disposed &&
    root.live &&
    root.meta.generation === generation &&
    roots.includes(root);
  const openingRoots = new Map<Root, number>();
  let indexTask: Promise<unknown> | undefined;
  let indexDisposing = false;
  function captureIndexRoot(handle: string, generation: number, signal?: AbortSignal) {
    const root = roots.find((candidate) => candidate.meta.handle === handle);
    if (!root || !live(root, generation)) return { ok: false, error: "STALE" } as const;
    if (root.meta.status !== "complete") return { ok: false, error: "NOT_READY" } as const;
    const eligible = () =>
      live(root, generation) &&
      root.meta.status === "complete" &&
      !removalAdmission &&
      !scanParked &&
      !preferencePending &&
      !indexDisposing &&
      !signal?.aborted;
    if (!eligible()) return { ok: false, error: "UNAVAILABLE" } as const;
    const files = root.files;
    if (files.size > INDEX_LIMITS.documents) return { ok: false, error: "LIMIT" } as const;
    const entries = new Map(files);
    const showHidden = root.meta.showHidden ?? false;
    const scanVersion = root.registry.version();
    const current = () => {
      if (!eligible() || root.files !== files || files.size !== entries.size ||
          (root.meta.showHidden ?? false) !== showHidden ||
          root.registry.version() !== scanVersion) return false;
      for (const [entry, file] of entries)
        if (files.get(entry) !== file) return false;
      return true;
    };
    return { ok: true as const, root, entries, showHidden, current };
  }
  async function openWorkspaceFile(
    root: Root,
    entry: string,
    file: ScanFile,
    envelope: { protocolVersion: 1; requestId: string },
    proof?: Parameters<TrustedDocumentService["openAuthorized"]>[3]
  ) {
    const generation = root.meta.generation;
    openingRoots.set(root, (openingRoots.get(root) ?? 0) + 1);
    const owner: Owner = {
      root,
      release() {
        this.root.scopes.delete(this);
      },
      async verify() {
        if (disposed || !this.root.live || !roots.includes(this.root))
          throw new DocumentPathError("INVALID_HANDLE");
        await verifyRoot(this.root.authorization);
        if (!this.root.live) throw new DocumentPathError("INVALID_HANDLE");
      },
    };
    root.scopes.add(owner);
    try {
      const response = await documents.openAuthorized(
        envelope,
        async () => {
          if (!live(root, generation) || root.files.get(entry) !== file)
            throw new DocumentPathError("INVALID_HANDLE");
          const candidate = await authorizeEntry(
            root.authorization,
            file.path,
            file.fingerprint,
            file.chain,
            root.meta.showHidden,
            proof?.check
          );
          if (!live(root, generation)) {
            await candidate.file.close();
            throw new DocumentPathError("INVALID_HANDLE");
          }
          return candidate;
        },
        owner,
        proof
      );
      if (response.ok && response.snapshot) bindAssets(response.snapshot.handle, owner.root);
      else owner.root.scopes.delete(owner);
      return response;
    } finally {
      const count = openingRoots.get(root)! - 1;
      if (count) openingRoots.set(root, count);
      else openingRoots.delete(root);
    }
  }
  const manualCandidates = new Map<
    string,
    { operation?: DirectoryOperation; token?: string; expires: number }
  >();
  const reconciliation = createReconciliation({
    getRoot(handle) {
      const root = roots.find((item) => item.meta.handle === handle);
      return !disposed && root?.live && root.meta.status === "complete"
        ? {
            lifetime: root,
            handle,
            generation: root.meta.generation,
            showHidden: root.meta.showHidden ?? false,
            authorization: root.authorization,
            nodes: root.nodes,
            files: root.files,
            directories: root.directories,
            exceptions: root.registry.snapshot(),
          }
        : undefined;
    },
    usedBytes: () => workspaceUsed(),
    limit: cacheLimit,
    worker,
    wake: () => wake(),
    confirmDirectories(binding,seen){
      const root=roots.find(item=>item===binding.lifetime);
      if(!root||!live(root,binding.generation)||root.registry.version()!==binding.exceptions?.version||(root.meta.showHidden??false)!==binding.showHidden)return undefined;
      root.registry.reconcile(seen,binding.showHidden);
      return root.registry.snapshot();
    },
    publish(binding, publication) {
      if (scanParked && !running) return "busy";
      const root = roots.find((item) => item.meta.handle === binding.handle);
      if (root && openingRoots.has(root)) return "busy";
      if (
        disposed ||
        root !== binding.lifetime ||
        !root.live ||
        root.meta.status !== "complete" ||
        root.meta.generation !== binding.generation ||
        (root.meta.showHidden ?? false) !== binding.showHidden
        || root.registry.version() !== binding.exceptions?.version
      )
        return false;
      cacheBytes += publication.bytes - root.bytes;
      root.bytes = publication.bytes;
      root.nodes = publication.nodes;
      root.byPath = publication.byPath;
      root.files = publication.files;
      root.directories = publication.directories;
      root.registry.reconcile(root.directories.values(), root.meta.showHidden ?? false);
      root.meta = {
        ...root.meta,
        generation: publication.generation,
        entries: publication.nodes.length,
        examined: publication.examined,
        errors: 0,
        status: "complete",
      };
      root.started = false;
      root.priorities = [];
      root.queueBytes = 0;
      return true;
    },
  });
  const observation = createAutomaticObservation({
    list: () => roots.filter((root) => root.live),
    call: (request) => worker.call(request),
    reconciliation,
    wake: () => wake(),
    budget: () => cacheLimit - cacheBytes - scanQueues() - reconciliation.bytes() - trashReceiptBytes,
    terminate: () => {
      workerStopped = true;
      reconciliation.invalidate();
      for (const root of roots) {
        root.meta.observation = "unavailable";
        if (root.meta.status === "scanning") root.meta.status = "failed";
      }
      worker.dispose();
    },
    canStart: () => {
      for (const [handle, record] of manualCandidates) {
        if (!record.operation) continue;
        const receipt = reconciliation.query(record.operation);
        if (receipt.status === "committed" || receipt.status === "rejected")
          manualCandidates.delete(handle);
        else if (
          receipt.status === "unknown" ||
          (receipt.status === "issued" && Date.now() >= record.expires)
        ) {
          // Fence before releasing the slot: a late accept cannot commit.
          if (record.token) reconciliation.release(record.token);
          manualCandidates.delete(handle);
        }
      }
      return manualCandidates.size === 0;
    },
  });
  let candidateTurn = true;
  function scanQueues(){return roots.reduce((sum,root)=>sum+root.queueBytes,0);}
  function workspaceUsed(){return cacheBytes+observation.bytes()+scanQueues()+trashReceiptBytes;}
  const invalidate = (root: Root) => {
    manualCandidates.delete(root.meta.handle);
    observation.cancel(root.meta.handle, true);
    reconciliation.invalidate(root.meta.handle);
    queueCleanup(key(root));
    root.live = false;
    cacheBytes -= root.bytes;
    root.bytes = 0;
    root.queueBytes = 0;
    root.nodes = [];
    root.byPath.clear();
    root.files.clear();
    root.directories.clear();
    root.registry.dispose();
  };
  function merge(root: Root, files: ScanFile[], kind: "file" | "directory" = "file") {
    for (const file of files) {
      if (
        !visiblePath(
          root.authorization.path,
          file.path,
          root.meta.showHidden
        )
      )
        continue;
      const existing=root.byPath.get(file.path);
      if(existing){
        if(kind==="directory"&&existing.kind==="directory"&&!root.directories.has(existing.handle)){
          const bytes=Buffer.byteLength(JSON.stringify(file));
          if(workspaceUsed()+reconciliation.bytes()+bytes>cacheLimit){root.meta.status="paused";queueCleanup(key(root));return;}
          root.directories.set(existing.handle,file);root.bytes+=bytes;cacheBytes+=bytes;
        }
        continue;
      }
      const additions: WorkspaceNode[] = [];
      let cursor = root.authorization.path,
        parent = root.meta.handle;
      for (const part of relative(root.authorization.path, file.path).split(
        "/"
      )) {
        cursor = join(cursor, part);
        const previous = root.byPath.get(cursor);
        if (previous) {
          parent = previous.handle;
          continue;
        }
        const node: WorkspaceNode = {
          handle: randomUUID(),
          parent,
          name: part,
          kind: cursor === file.path ? kind : "directory",
          displayPath: cursor,
        };
        additions.push(node);
        parent = node.handle;
      }
      const bytes =
        Buffer.byteLength(JSON.stringify(additions)) +
        Buffer.byteLength(JSON.stringify(file));
      if (
        workspaceUsed() + reconciliation.bytes() + bytes >
        cacheLimit
      )
        reconciliation.invalidate(undefined, true);
      if (workspaceUsed() + bytes > cacheLimit) {
        root.meta.status = "paused";
        queueCleanup(key(root));
        return;
      }
      for (const node of additions) {
        root.nodes.push(node);
        root.byPath.set(node.displayPath, node);
      }
      (kind === "file" ? root.files : root.directories).set(parent, file);
      root.bytes += bytes;
      cacheBytes += bytes;
      root.meta.entries = root.nodes.length;
    }
    syncAssets();
  }
  async function drain() {
    if (running || disposed || scanParked) return;
    running = true;
    try {
      let observationTurn = true;
      while (
        !disposed ||
        cleanup.length ||
        reconciliation.hasWork() ||
        observation.hasCleanup()
      ) {
        if (scanParked) break;
        const stale = cleanup.shift();
        if (stale) {
          await worker.call({ op: "close", key: stale }).catch(() => undefined);
          workerKeys.delete(stale);
          continue;
        }
        if (
          observation.hasWork() &&
          (observation.hasCleanup() || observationTurn)
        ) {
          observationTurn = false;
          await observation.step();
          await new Promise((resolve) => setTimeout(resolve, 0));
          continue;
        }
        observationTurn = true;
        const scheduled = Array.from(
          { length: roots.length },
          (_, index) => roots[(turn + index) % roots.length]
        );
        const root = scheduled.find((item) => item.meta.status === "scanning");
        if (reconciliation.hasWork() && (candidateTurn || !root)) {
          candidateTurn = false;
          await reconciliation.step();
          await new Promise((resolve) => setTimeout(resolve, 0));
          continue;
        }
        if (!root) {
          if (observation.hasWork()) continue;
          break;
        }
        candidateTurn = true;
        turn = (roots.indexOf(root) + 1) % roots.length;
        const generation = root.meta.generation;
        try {
          if (!root.started) {
            const exceptions=root.registry.snapshot();root.scanVersion=exceptions.version;
            const snapshotBytes=2*Buffer.byteLength(JSON.stringify(exceptions))+Buffer.byteLength(JSON.stringify({path:root.authorization.path,chain:[]}));
            if(workspaceUsed()+reconciliation.bytes()+snapshotBytes>cacheLimit){root.meta.status="paused";queueCleanup(key(root));root.queueBytes=0;continue;}
            root.queueBytes=snapshotBytes;
            workerKeys.add(key(root));
            await worker.call({
              op: "start",
              key: key(root),
              root: root.authorization,
              showHidden: root.meta.showHidden ?? false,
              exceptions,
            });
            if (!live(root, generation)) continue;
            root.started = true;
          }
          const priority = root.priorities.shift();
          if (priority)
            await worker.call({
              op: "prioritize",
              key: key(root),
              path: priority,
            });
          const batch = await worker.call({
            op: "next",
            key: key(root),
            budget:Math.max(0,Math.min(2*1024*1024,cacheLimit-workspaceUsed()+root.queueBytes-reconciliation.bytes())),
          });
          if (!live(root, generation) || root.scanVersion!==root.registry.version()) continue;
          if (!validScanBatch(batch)) throw Error();
          root.meta.examined += batch.examined;
          root.queueBytes = batch.queueBytes;
          if(workspaceUsed()+reconciliation.bytes()>cacheLimit){root.meta.status="paused";queueCleanup(key(root));root.queueBytes=0;continue;}
          root.meta.errors += batch.errors;
          merge(root, batch.files);
          const directories=batch.directories.filter(proof=>JSON.stringify(root.registry.get(proof.path)?.proof)===JSON.stringify(proof));
          if(directories.length!==batch.directories.length)throw Error("Unclaimed directory");
          merge(root,directories,"directory");
          if (batch.paused) root.meta.status = "paused";
          else if (batch.done && root.meta.status === "scanning")
            root.meta.status = root.meta.errors ? "partial" : "complete";
          if (root.meta.status !== "scanning") queueCleanup(key(root));
          if (root.meta.status !== "scanning") root.queueBytes = 0;
          if(root.meta.status === "complete")root.registry.reconcile(root.directories.values(),root.meta.showHidden ?? false);
        } catch {
          if (live(root, generation)) {
            root.meta.status = "failed";
            root.meta.errors++;
            queueCleanup(key(root));
          }
        }
        // A macrotask allows picker/open/save RPCs between metadata batches.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      running = false;
      reachedPark?.(); reachedPark = undefined;
      if (disposed) worker.dispose();
    }
  }
  const wake = () => {
    void drain();
  };
  function restart(root: Root) {
    manualCandidates.delete(root.meta.handle);
    observation.cancel(root.meta.handle, true);
    reconciliation.invalidate(root.meta.handle);
    queueCleanup(key(root));
    cacheBytes -= root.bytes;
    root.bytes = 0;
    root.queueBytes = 0;
    root.nodes = [];
    root.files.clear();
    root.directories.clear();
    root.byPath.clear();
    root.started = false;
    root.priorities = [];
    root.meta = {
      ...root.meta,
      generation: root.meta.generation + 1,
      status: "scanning",
      errors: 0,
      examined: 0,
      entries: 0,
    };
    wake();
  }
  async function removeAll() {
    const accepted = await documents.withWriteBarrier(() => {
      epoch++;
      for (const root of roots) {
        invalidate(root);
        for (const owner of root.scopes) documents.revokeScope(owner);
        root.scopes.clear();
      }
      roots.length = 0;
      for (const handle of assetOwners.keys())
        documents.setAssetScope(handle, undefined);
      assetOwners.clear();
      return Promise.resolve(true);
    });
    wake();
    return accepted;
  }
  async function dispatchWorkspacePath(
    value: unknown,
    action: "reveal" | "open-default"
  ) {
    const validate =
      action === "reveal" ? validWorkspaceReveal : validWorkspaceDefaultOpen;
    const envelope = {
      protocolVersion: 1 as const,
      requestId: validate(value) ? value.requestId : "",
    };
    if (!validate(value))
      return {
        ...envelope,
        ok: false as const,
        error: "INVALID_REQUEST" as const,
      };
    if (removalAdmission) return { ...envelope, ok: false as const, error: "BUSY" as const };
    if (disposed)
      return {
        ...envelope,
        ok: false as const,
        error: "INVALID_HANDLE" as const,
      };
    const target = value.target;
    if (target.type === "document")
      return documents[action === "reveal" ? "reveal" : "openDefault"]({
        ...envelope,
        handle: target.handle,
      });
    const root = roots.find((item) => item.meta.handle === target.root);
    const node = target.entry
      ? root?.nodes.find((item) => item.handle === target.entry)
      : undefined;
    if (!root || !live(root, target.generation) || (target.entry && !node))
      return {
        ...envelope,
        ok: false as const,
        error: "INVALID_HANDLE" as const,
      };
    if (action === "open-default" && node?.kind !== "file")
      return {
        ...envelope,
        ok: false as const,
        error: "INVALID_HANDLE" as const,
      };
    const files = root.files,
      byPath = root.byPath;
    let witness: { handle: string; file: ScanFile } | undefined;
    const path = node ? node.displayPath : root.authorization.path;
    const current = () => {
      if (
        !live(root, target.generation) ||
        root.files !== files ||
        root.byPath !== byPath ||
        (node && byPath.get(path) !== node) ||
        (witness && files.get(witness.handle) !== witness.file) ||
        !visiblePath(root.authorization.path, path, root.meta.showHidden)
      )
        throw new DocumentPathError("INVALID_HANDLE");
    };
    return documents[
      action === "reveal" ? "revealAuthorized" : "openDefaultAuthorized"
    ](
      envelope,
      async (check) => {
        check();
        if (node?.kind === "file") {
          const file = files.get(node.handle);
          if (file?.path !== path)
            throw new DocumentPathError("INVALID_HANDLE");
          witness = { handle: node.handle, file };
          const authorized = await authorizeEntry(
            root.authorization,
            file.path,
            file.fingerprint,
            file.chain,
            root.meta.showHidden,
            check
          );
          try {
            check();
            return {
              path: authorized.path,
              close: () => authorized.file.close(),
            };
          } catch (error) {
            await authorized.file.close();
            throw error;
          }
        }
        let chain: ScanFile["chain"] = [];
        if (node) {
          let found = false,
            count = 0;
          for (const [handle, file] of files) {
            const index = file.chain.findIndex(
              (directory) => directory.path === path
            );
            if (index >= 0) {
              const prefix = file.chain.slice(0, index + 1);
              let parent = root.authorization.path;
              const complete =
                prefix.length <= 256 &&
                prefix.every((directory) => {
                  const valid =
                    dirname(directory.path) === parent &&
                    containsPath(root.authorization.path, directory.path);
                  parent = directory.path;
                  return valid;
                });
              if (complete) {
                chain = prefix;
                witness = { handle, file };
                found = true;
                break;
              }
            }
            if (++count % 64 === 0) {
              await new Promise((resolve) => setTimeout(resolve, 0));
              check();
            }
          }
          if (!found) throw new DocumentPathError("INVALID_HANDLE");
        }
        check();
        const entry = directoryNative
          ? null
          : resolveSaveWorkerEntry(join(import.meta.dir, "../documents"));
        const native =
          directoryNative ??
          (entry &&
            (createRequire(import.meta.url)(
              join(dirname(entry), "save-primitives.node")
            ) as DirectoryNative));
        if (!native) throw new DocumentPathError("READ_FAILED");
        const fd = openDirectoryDescriptor(
          root.authorization,
          { path, chain },
          native
        );
        try {
          check();
          return {
            path,
            close: () => {
              closeSync(fd);
              return Promise.resolve();
            },
          };
        } catch (error) {
          closeSync(fd);
          throw error;
        }
      },
      current
    );
  }

  const standaloneEligible = (path: string) => !disposed && !selecting && !removalAdmission && !roots.some(root => root.live && root.byPath.get(path)?.kind === "file");
  const removeStandalone = createStandaloneRemoval(
    handle => documents.inspectStandaloneRemoval(handle, standaloneEligible),
    (handle, identity, committed) => documents.commitStandaloneRemoval(handle, identity, standaloneEligible, () => { assetOwners.delete(handle); committed(); })
  );
  const folderRemoval = createFolderRemoval(async (rootHandle, generation, opened) => {
    const root = roots.find(item => item.meta.handle === rootHandle);
    if (disposed || removeStandalone.busy() || removalAdmission || selecting || preferencePending || openingRoots.size || manualCandidates.size || !root?.live || root.meta.generation !== generation || !preferences.remove)
      throw Error("Folder removal busy");
    removalAdmission = true;
    scanParked = true;
    let lease: FolderMutationLease | null = null;
    let released = false;
    const release = () => {
      if (released) return;
      released = true; lease?.release(); removalAdmission = false; scanParked = false;
      if (releaseFolderRemoval === release) releaseFolderRemoval = undefined;
      wake();
    };
    releaseFolderRemoval = release;
    try {
      if (running) await new Promise<void>(resolve => { reachedPark = resolve; });
      if (disposed || !root.live || !roots.includes(root) || root.meta.generation !== generation) throw Error("Root changed");
      lease = await documents.acquireFolderMutationLease();
      if (released) { lease?.release(); throw Error("Removal disposed"); }
      if (!lease) throw Error("Document mutation busy");
      const bindings = lease.bindings();
      const byHandle = new Map(bindings.map(binding => [binding.handle, binding]));
      for (const item of opened) if (byHandle.get(item.handle)?.documentId !== item.documentId) throw Error("Open binding changed");
      const openHandles = new Set(opened.map(item => item.handle));
      if (bindings.some(binding => binding.observedActive && !openHandles.has(binding.handle))) throw Error("Registered open binding omitted");
      const remaining = roots.filter(item => item !== root);
      const entries = bindings.filter(binding => root.scopes.has(binding.scope as Owner) || assetOwners.get(binding.handle)?.root === root || (binding.explicitStandalone && root.byPath.get(binding.path)?.kind === "file"));
      const destinations = new Map<string, Root>();
      for (const binding of entries) {
        const destination = remaining.find(item => item.live && visiblePath(item.authorization.path, binding.path, item.meta.showHidden));
        if (destination) { await verifyRoot(destination.authorization); destinations.set(binding.handle, destination); }
      }
      const exclusive = entries.filter(binding => openHandles.has(binding.handle) && !destinations.has(binding.handle));
      const listed = exclusive.map(binding => ({ handle: binding.handle, documentId: binding.documentId, fileName: basename(binding.path), explicitStandalone: binding.explicitStandalone }));
      // Charge all retained metadata, including unrelated binding references and
      // the ledger's serialized request. No document text is copied by this plan.
      const planBytes = JSON.stringify([opened, listed, bindings.map(({ scope: _scope, ...binding }) => { void _scope; return binding; })]).length * 4
        + bindings.length * 256 + entries.length * 128 + roots.length * 256;
      const baseBytes = planBytes + workspaceUsed() + reconciliation.bytes();
      if (baseBytes > cacheLimit) throw Error("Removal budget");
      let settingsBudget = cacheLimit - baseBytes;
      let setting: HiddenRemoval | undefined;
      let publication: FolderRemovalPublication | undefined;
      let apply: (() => void) | undefined;
      let terminal: "rejected" | undefined;
      const settle = (status: HiddenRemoval["status"]): FolderRemovalPublication | "rejected" | "pending" => {
        if (status === "unknown") return "pending";
        if (status === "rejected") { terminal = "rejected"; release(); return terminal; }
        try { apply!(); }
        finally { if (publication) release(); }
        return publication!;
      };
      return {
        documents: listed,
        cancel: release,
        async commit(decision) {
          if (released || !lease?.current()) return "rejected";
          try {
            const changes: FolderGrantChange[] = [];
            const newOwners: { root: Root; owner: Owner }[] = [];
            const nextAssets = new Map(assetOwners);
            const closed: string[] = [], revoked: string[] = [], standalone: string[] = [];
            for (const binding of entries) {
              const destination = destinations.get(binding.handle);
              const close = decision === "close" && openHandles.has(binding.handle) && !destination;
              if (close) closed.push(binding.handle);
              if (destination) {
                const owner: Owner = { root: destination, release() { this.root.scopes.delete(this); }, async verify() { if (!this.root.live || !roots.includes(this.root)) throw Error("Invalid destination"); await verifyRoot(this.root.authorization); } };
                const assetScope = makeAssetScope(destination);
                if (!binding.explicitStandalone) newOwners.push({ root: destination, owner });
                changes.push({ handle: binding.handle, action: binding.explicitStandalone ? "retain" : "migrate", scope: owner, assetScope });
                nextAssets.set(binding.handle, { root: destination, scope: assetScope });
              } else {
                nextAssets.delete(binding.handle);
                if (binding.explicitStandalone) changes.push({ handle: binding.handle, action: "retain" });
                else if (decision === "keep" && openHandles.has(binding.handle)) { changes.push({ handle: binding.handle, action: "standalone" }); standalone.push(binding.handle); }
                else { changes.push({ handle: binding.handle, action: "revoke" }); revoked.push(binding.handle); }
              }
            }
            const prepared = await lease.prepare(changes);
            if (!lease.current() || !root.live || root.meta.generation !== generation) throw Error("Plan changed");
            const revokedSet = new Set(revoked);
            const result: FolderRemovalPublication = {
              root: rootHandle, closed, revoked, standalone,
              roots: remaining.map(item => ({ ...item.meta })),
              coveredHandles: bindings.filter(binding => !revokedSet.has(binding.handle) && remaining.some(item => item.byPath.get(binding.path)?.kind === "file")).map(binding => binding.handle),
              assetEpochs: prepared.assetEpochs,
              cacheBytes: cacheBytes - root.bytes,
              queueBytes: remaining.reduce((sum, item) => sum + item.queueBytes, 0),
            };
            const commitBytes = JSON.stringify(result).length * 4 + nextAssets.size * 128 + changes.length * 192 + newOwners.length * 128;
            settingsBudget = cacheLimit - baseBytes - commitBytes;
            if (settingsBudget < 0) throw Error("Removal commit metadata budget");
            apply = () => {
              prepared.commit(() => {
                for (const item of newOwners) item.root.scopes.add(item.owner);
                root.scopes.clear();
                assetOwners.clear(); for (const [handle, asset] of nextAssets) assetOwners.set(handle, asset);
                roots.splice(roots.indexOf(root), 1);
                root.live = false;
                cacheBytes -= root.bytes; root.bytes = 0; root.queueBytes = 0;
                root.nodes = []; root.byPath.clear(); root.files.clear();root.directories.clear();root.registry.dispose();
                manualCandidates.delete(root.meta.handle);
                queueCleanup(key(root));
                publication = result;
              });
              for (const cleanup of [() => observation.cancel(root.meta.handle, true), () => reconciliation.invalidate(root.meta.handle)]) {
                try { cleanup(); } catch { console.warn("Folder removal workspace cleanup failed"); }
              }
            };
          } catch { terminal = "rejected"; release(); return terminal; }
          // From this point failure may be post-rename: keep both leases until queried.
          setting = await preferences.remove!(root.authorization.path, settingsBudget);
          return settle(setting.status);
        },
        async query() {
          if (publication) { release(); return publication; }
          if (terminal) return terminal;
          if (!setting) return "pending";
          return settle(await setting.query());
        },
      };
    } catch (error) { release(); throw error; }
  });
  async function creationTarget(value: CreateTarget): Promise<CreationTarget> {
    const root = roots.find(item => item.meta.handle === value.rootHandle);
    if (!root?.live || disposed || root.meta.generation !== value.generation) throw Error("Invalid target");
    const node = value.directoryHandle ? root.nodes.find(item => item.handle === value.directoryHandle) : undefined;
    if (value.directoryHandle && node?.kind !== "directory") throw Error("Not a directory");
    const path = node?.displayPath ?? root.authorization.path;
    let chain: ScanFile["chain"] = [];
    const check = () => { if (disposed || !root.live || !roots.includes(root) || root.meta.generation !== value.generation || (node && root.byPath.get(path) !== node)) throw Error("Target changed"); };
    if (node) {
      let count = 0, found = false;
      const directory=root.directories.get(node.handle);
      if(directory && root.registry.get(path)?.proof.fingerprint===directory.fingerprint){chain=[...directory.chain,{path:directory.path,fingerprint:directory.fingerprint}];found=true;}
      if(!found)for(const proof of root.directories.values()){
        if(JSON.stringify(root.registry.get(proof.path)?.proof)!==JSON.stringify(proof))continue;
        const index=proof.chain.findIndex(item=>item.path===path);
        if(index>=0){chain=proof.chain.slice(0,index+1);found=true;break;}
        if(++count%64===0){await new Promise(resolve=>setTimeout(resolve,0));check();}
      }
      for (const file of root.files.values()) {
        if(found)break;
        const index = file.chain.findIndex(item => item.path === path);
        if (index >= 0) { chain = file.chain.slice(0, index + 1); found = true; break; }
        if (++count % 64 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); check(); }
      }
      if (!found) throw Error("Missing directory proof");
    }
    let parent = root.authorization.path;
    if (chain.length > 128 || !chain.every(item => { const valid = dirname(item.path) === parent && containsPath(root.authorization.path, item.path); parent = item.path; return valid; })) throw Error("Incomplete chain");
    check();
    return {root: root.authorization, path, chain, showHidden: root.meta.showHidden ?? false, check, scope() {
      const owner: Owner = {root, release() { this.root.scopes.delete(this); }, async verify() { if (disposed || !this.root.live || !roots.includes(this.root)) throw Error("Root removed"); await verifyRoot(this.root.authorization); if (disposed || !this.root.live) throw Error("Root removed"); }};
      root.scopes.add(owner); return owner;
    }};
  }
  const creationHost: Omit<Parameters<typeof createMarkdownService>[0],"acquire"> & {acquire(value:CreateTarget):Promise<CreationLease & FolderLease>} = {
    documents,
    native() {
      if (directoryNative) return directoryNative as CreationNative;
      const entry = resolveSaveWorkerEntry(join(import.meta.dir, "../documents"));
      if (!entry) throw Error("Native unavailable");
      return createRequire(import.meta.url)(join(dirname(entry), "save-primitives.node")) as CreationNative;
    },
    resolve: creationTarget,
    async acquire(value) {
      if (disposed || removalAdmission || removeStandalone.busy() || folderRemoval.busy() || selecting || preferencePending || openingRoots.size || manualCandidates.size) throw Error("Workspace busy");
      const owner = {}; createOwner = owner; removalAdmission = true; scanParked = true;
      let released = false;
      const release = () => { if (released) return; released = true; if (createOwner === owner) { createOwner = undefined; removalAdmission = false; scanParked = false; releaseCreation = undefined; wake(); } };
      releaseCreation = release;
      try {
        if (running) await new Promise<void>(resolve => { reachedPark = resolve; });
        if (disposed || createOwner !== owner) throw Error("Creation disposed");
        const target = await creationTarget(value);
        const root = roots.find(item => item.meta.handle === value.rootHandle)!;
        let expectedVersion=root.registry.version();
        const checkDirectory=()=>{if(disposed||createOwner!==owner||!scanParked||root.registry.version()!==expectedVersion)throw Error("Directory owner changed");target.check();};
        return {target, release,lifetime:root,
          reserve(proof){checkDirectory();return root.registry.reserve(proof);},
          cancel(reservation){root.registry.cancel(reservation);},
          acceptDirectory(proof,reservation,token){
            checkDirectory();
            if(dirname(proof.path)!==target.path||JSON.stringify(proof.chain)!==JSON.stringify(target.chain)||!visiblePath(root.authorization.path,proof.path,root.meta.showHidden))return {status:"unavailable"};
            const record=root.registry.get(proof.path),previous=root.byPath.get(proof.path);
            if(token){
              if(record?.token!==token||JSON.stringify(record.proof)!==JSON.stringify(proof)||previous?.kind!=="directory")return {status:"unavailable"};
              return {status:"same-identity",entryHandle:previous.handle,registrationToken:token,committedVersion:expectedVersion};
            }
            if(!reservation||record||previous)return {status:"unavailable"};
            const parent=target.path===root.authorization.path?root.meta.handle:root.byPath.get(target.path)?.handle;
            if(!parent)return {status:"unavailable"};
            const node:WorkspaceNode={handle:randomUUID(),parent,name:basename(proof.path),kind:"directory",displayPath:proof.path};
            const bytes=Buffer.byteLength(JSON.stringify([node]))+Buffer.byteLength(JSON.stringify(proof));
            if(workspaceUsed()+reconciliation.bytes()+bytes>cacheLimit)return {status:"unavailable"};
            const nodes=[...root.nodes,node],byPath=new Map(root.byPath),directories=new Map(root.directories);
            byPath.set(proof.path,node);directories.set(node.handle,proof);checkDirectory();
            const receipt=root.registry.commit(reservation,proof,expectedVersion);expectedVersion=receipt.committedVersion;
            root.nodes=nodes;root.byPath=byPath;root.directories=directories;root.bytes+=bytes;cacheBytes+=bytes;root.meta.entries=nodes.length;
            // The owner advances its own version; old scans and candidates do not.
            queueCleanup(key(root));root.started=false;root.meta.generation++;root.scanVersion=expectedVersion;
            reconciliation.invalidate(root.meta.handle);manualCandidates.delete(root.meta.handle);observation.cancel(root.meta.handle,true);
            return {status:"accepted",entryHandle:node.handle,...receipt};
          },accept(file: ScanFile) {
          if (disposed || createOwner !== owner || !scanParked) return {status: "unavailable" as const};
          target.check();
          if (dirname(file.path) !== target.path || JSON.stringify(file.chain) !== JSON.stringify(target.chain) || !visiblePath(root.authorization.path, file.path, root.meta.showHidden)) return {status: "unavailable" as const};
          const previous = root.byPath.get(file.path);
          if (previous) {
            const old = root.files.get(previous.handle);
            return previous.kind === "file" && old?.fingerprint === file.fingerprint && JSON.stringify(old.chain) === JSON.stringify(file.chain) ? {status: "same-identity" as const, entryHandle: previous.handle} : {status: "unavailable" as const};
          }
          const parent = target.path === root.authorization.path ? root.meta.handle : root.byPath.get(target.path)?.handle;
          if (!parent || (target.path !== root.authorization.path && root.byPath.get(target.path)?.kind !== "directory")) return {status: "unavailable" as const};
          const node: WorkspaceNode = {handle: randomUUID(), parent, name: basename(file.path), kind: "file", displayPath: file.path};
          const bytes = Buffer.byteLength(JSON.stringify([node])) + Buffer.byteLength(JSON.stringify(file));
          if (workspaceUsed() + reconciliation.bytes() + bytes > cacheLimit) return {status: "unavailable" as const};
          root.nodes.push(node); root.byPath.set(file.path, node); root.files.set(node.handle, file); root.bytes += bytes; cacheBytes += bytes; root.meta.entries = root.nodes.length;
          return {status: "accepted" as const, entryHandle: node.handle};
        }};
      } catch (error) { release(); throw error; }
    }
  };
  const creation = createMarkdownService(creationHost);
  const duplication = createMarkdownService(creationHost, true);
  const trash=createTrashService({documents,run:trashRun,receiptBytes(bytes){if(workspaceUsed()-trashReceiptBytes+reconciliation.bytes()+bytes>cacheLimit)throw Error("Trash receipt budget");trashReceiptBytes=bytes;},async acquire(target){
    if(disposed||removalAdmission||removeStandalone.busy()||folderRemoval.busy()||selecting||preferencePending||openingRoots.size||manualCandidates.size)throw Error("Workspace busy");
    const owner={};createOwner=owner;removalAdmission=true;scanParked=true;
    let released=false;
    const release=()=>{if(released)return;released=true;if(createOwner===owner){createOwner=undefined;removalAdmission=false;scanParked=false;releaseCreation=undefined;wake();}};
    releaseCreation=release;
    const current=()=>{if(disposed||released||createOwner!==owner||!scanParked)throw Error("Trash owner changed");};
    try{
      if(running)await new Promise<void>(resolve=>{reachedPark=resolve;});current();
      let input:import("../documents/trash-operation").TrashInput;
      let checkTarget:()=>void;
      if(target.kind==="directory"){
        const directory=await creationTarget({rootHandle:target.root,generation:target.generation,...(target.entry?{directoryHandle:target.entry}:{})});
        checkTarget=()=>{current();directory.check();};
        const identities=[...directory.root.directories,...directory.chain];
        if(identities.length>256)throw Error("Directory proof depth");
        const fd=openDirectoryDescriptor(directory.root,{path:directory.path,chain:directory.chain},creationHost.native());
        try{await verifyRoot({path:directory.path,directories:identities});checkTarget();}finally{closeSync(fd);}
        const identity=identities[identities.length-1];
        if(identity?.path!==directory.path)throw Error("Missing directory identity");
        input={kind:"directory",path:directory.path,selectedPath:directory.path,selectedParent:dirname(directory.path),fingerprint:identity.fingerprint,directories:identities};
      }else if(target.kind==="root"){
        const root=roots.find(item=>item.meta.handle===target.root),file=root?.files.get(target.entry);
        if(!root||!file||!live(root,target.generation))throw Error("Stale target");
        checkTarget=()=>{current();if(!live(root,target.generation)||root.files.get(target.entry)!==file)throw Error("Stale trash target");};
        const auth=await authorizeEntry(root.authorization,file.path,file.fingerprint,file.chain,root.meta.showHidden,checkTarget);
        try{checkTarget();input={path:auth.path,selectedPath:auth.selectedPath,selectedParent:auth.selectedParent,fingerprint:auth.fingerprint,directories:auth.directories};}finally{await auth.file.close();}
      }else{
        const captured=documents.inspectTrash(target.handle,target.documentId);if(!captured)throw Error("Unknown document");
        checkTarget=()=>{current();const now=documents.inspectTrash(target.handle,target.documentId);if(now?.path!==captured.path||now.fingerprint!==captured.fingerprint)throw Error("Changed document");};
        const auth=await authorizeSingleFile(captured.selectedPath);
        try{checkTarget();if(auth.path!==captured.path||auth.fingerprint!==captured.fingerprint)throw Error("Replaced target");input=captured;}finally{await auth.file.close();}
      }
      checkTarget();
      const projections:{root:Root;selected:WorkspaceNode[];removed:boolean;generation:number;original:WorkspaceNode[]}[]=[];
      const available=cacheLimit-workspaceUsed()-reconciliation.bytes();let reservation=1024;
      if(reservation>available)throw Error("Trash projection budget");
      for(const root of roots){
        const removed=input.kind==="directory"&&containsPath(input.path,root.authorization.path);
        const selected:WorkspaceNode[]=[];let examined=0;
        if(!removed)for(const node of root.nodes){
          const file=root.files.get(node.handle);
          if(input.kind==="directory"?containsPath(input.path,node.displayPath):node.displayPath===input.path&&file?.fingerprint===input.fingerprint){
            if(selected.length>=1024||reservation+192>available)throw Error("Trash publication entry capacity or budget");
            reservation+=192;selected.push(node);
          }
          if(++examined%64===0){await new Promise(resolve=>setTimeout(resolve,0));checkTarget();}
        }
        if(!removed&&selected.length>1024)throw Error("Trash publication entry capacity");
        if(removed||selected.length){
          const extra=removed?256:root.nodes.length*16+256;
          if(projections.length>=32||reservation+extra>available)throw Error("Trash projection budget");
          reservation+=extra;projections.push({root,selected,removed,generation:root.meta.generation,original:root.nodes});
        }
      }
      if(projections.length>32||workspaceUsed()+reconciliation.bytes()+reservation>cacheLimit)throw Error("Trash projection budget");
      const prepared=projections.map(p=>{const selected=new Set(p.selected);return {...p,nodes:p.removed?[]:p.root.nodes.filter(item=>!selected.has(item)),oldKey:key(p.root)};});
      const check=()=>{checkTarget();for(const p of projections)if(!live(p.root,p.generation)||p.root.nodes!==p.original)throw Error("Projection changed");};
      return {input,current:check,release,publicationBytes:1024+prepared.reduce((sum,p)=>sum+256+(p.removed?0:p.selected.length*192),0),reserveBindings(bytes){if(workspaceUsed()+reconciliation.bytes()+reservation+bytes>cacheLimit)throw Error("Trash binding budget");},publish(){
        check();
        const files=prepared.map(({root,selected,removed,generation,nodes})=>{
          for(const node of selected){root.files.delete(node.handle);root.directories.delete(node.handle);root.byPath.delete(node.displayPath);}
          root.nodes=nodes;
          if(removed){
            roots.splice(roots.indexOf(root),1);root.live=false;root.scopes.clear();
            root.registry.dispose();cacheBytes-=root.bytes;root.bytes=0;root.queueBytes=0;
            root.nodes=[];root.files.clear();root.directories.clear();root.byPath.clear();
          }else if(input.kind==="directory")root.registry.revokeSubtree(input.path);
          // Retain the previous conservative charge until the normal rescan
          // rebuilds the graph; do not undercount retained ancestor proofs.
          root.meta.entries=root.nodes.length;root.meta.generation++;root.started=false;
          return {root:root.meta.handle,previousGeneration:generation,generation:root.meta.generation,entries:removed?[]:selected.map(node=>node.handle),...(removed?{removed:true as const}:{})};
        });
        return {files,effects(){for(const {root,oldKey,removed}of prepared){queueCleanup(oldKey);reconciliation.invalidate(root.meta.handle);manualCandidates.delete(root.meta.handle);observation.cancel(root.meta.handle,true);if(removed&&preferences.remove)void preferences.remove(root.authorization.path,Math.max(0,cacheLimit-workspaceUsed())).then(async result=>{if(await result.query()!=="committed")console.warn("Trash preference cleanup incomplete");}).catch(()=>console.warn("Trash preference cleanup failed"));}}};
      }};
    }catch(error){release();throw error;}
  }});
  const folders=createFolderService({
    ...creationHost,native:()=>creationHost.native() as FolderNative,
    registered(lifetime,token){const root=roots.find(item=>item===lifetime);return !!root?.live&&root.registry.has(token);},
    async acquire(value,retry){
      if(!retry)return creationHost.acquire(value);
      const root=roots.find(item=>item===retry.lifetime);
      if(!root?.live||root.meta.handle!==value.rootHandle)throw Error("Original root removed");
      const parentPath=dirname(retry.proof.path),node=root.byPath.get(parentPath);
      if(parentPath!==root.authorization.path&&node?.kind!=="directory")throw Error("Original parent unavailable");
      const lease=await creationHost.acquire({rootHandle:root.meta.handle,generation:root.meta.generation,...(node?{directoryHandle:node.handle}:{})});
      if(lease.target.path!==parentPath||JSON.stringify(lease.target.chain)!==JSON.stringify(retry.proof.chain)){lease.release();throw Error("Original parent changed");}
      return lease;
    }
  });
  function captureSearchRoster(requested: readonly ContentSearchScopeRoot[], signal?: AbortSignal, exact = true) {
    const roster = [...roots];
    const workspaceEpoch = epoch;
    const selectionGeneration = searchSelectionGeneration;
    const ready = () => !disposed && !indexDisposing && !workerStopped &&
      !selecting && !removalAdmission && !scanParked && !preferencePending &&
      !removeStandalone.busy() && !folderRemoval.busy() && !signal?.aborted;
    if (disposed || indexDisposing || workerStopped)
      return { ok: false, error: "UNAVAILABLE" } as const;
    if (!ready()) return { ok: false, error: "BUSY" } as const;
    if (exact && (requested.length !== roster.length || requested.some(({ handle, generation }, index) =>
      roster[index]?.meta.handle !== handle || roster[index]?.meta.generation !== generation)))
      return { ok: false, error: "STALE" } as const;
    return {
      ok: true as const,
      current: () => ready() && workspaceEpoch === epoch &&
        selectionGeneration === searchSelectionGeneration && roots.length === roster.length &&
        roster.every((root, index) => roots[index] === root),
    };
  }
  async function searchContentCandidatesForRoots(
    input: ContentSearchRootSetInput & Pick<ContentSearchInput, "fragments">,
    signal?: AbortSignal,
    mixed?: { standaloneHandles: readonly string[] }
  ): Promise<ContentSearchCandidates> {
    if (signal?.aborted) return { ok: false, error: "CANCELLED" };
    if (indexTask) return { ok: false, error: "BUSY" };
    const { fileFilters, pathFilters, fragments } = input;
    const requestedRoots: unknown = input.roots;
    const openHandles: unknown = input.handles;
    const standaloneInput: unknown = mixed?.standaloneHandles;
    const validHandles = (value: unknown): value is readonly string[] =>
      Array.isArray(value) && Object.keys(value).length === value.length &&
      Array.from(value).every(perfUuid) && new Set(value).size === value.length;
    let retainedHandles: readonly string[] = [];
    if (mixed) {
      if ((Array.isArray(standaloneInput) && standaloneInput.length > INDEX_LIMITS.documents) ||
          (Array.isArray(openHandles) && openHandles.length > INDEX_LIMITS.documents))
        return { ok: false, error: "LIMIT" };
      if (!validHandles(standaloneInput) || !validHandles(openHandles))
        return { ok: false, error: "INVALID" };
      retainedHandles = standaloneInput;
    }
    if (!scalar(input.query, INDEX_LIMITS.query) || !input.query.trim() ||
        new Set(input.handles).size !== input.handles.length ||
        ("fragments" in input && fragments !== true) ||
        (fileFilters !== undefined && !validContentSearchFileFilters(fileFilters)) ||
        (pathFilters !== undefined && !validContentSearchPathFilters(pathFilters)) ||
        (fileFilters?.length ?? 0) + (pathFilters?.length ?? 0) > CONTENT_SEARCH_FILTER_COUNT_LIMIT)
      return { ok: false, error: "INVALID" };
    if (input.handles.length > INDEX_LIMITS.documents ||
        (Array.isArray(requestedRoots) && requestedRoots.length > CONTENT_SEARCH_LIMITS.roots))
      return { ok: false, error: "LIMIT" };
    const rootless = mixed && retainedHandles.length > 0 && Array.isArray(requestedRoots) &&
      requestedRoots.length === 0 && Object.keys(requestedRoots).length === 0;
    if (!rootless && !validContentSearchScopeRoots(requestedRoots))
      return { ok: false, error: "INVALID" };
    const requested = rootless ? [] : input.roots;
    const roster = mixed ? captureSearchRoster(requested, signal) : undefined;
    if (roster?.ok === false) return roster;

    const captures: (Extract<ReturnType<typeof captureIndexRoot>, { ok: true }> & {
      searched: ReadonlyMap<string, ScanFile>;
    })[] = [];
    const entryHandles = new Set<string>();
    const filesByPath = new Map<string, { file: ScanFile; root: Root; showHidden: boolean }>();
    for (const { handle, generation } of requested) {
      const snapshot = captureIndexRoot(handle, generation, signal);
      if (!snapshot.ok) return snapshot;
      const { root, entries } = snapshot;
      const rootPath = root.authorization.path;
      if (captures.some(({ root }) =>
        containsPath(root.authorization.path, rootPath) ||
        containsPath(rootPath, root.authorization.path)
      )) return { ok: false, error: "INVALID" };
      if (entryHandles.size + entries.size > INDEX_LIMITS.documents)
        return { ok: false, error: "LIMIT" };
      const filtered = fileFilters || pathFilters ? new Map<string, ScanFile>() : undefined;
      for (const [entry, file] of entries) {
        if (entryHandles.has(entry) || filesByPath.has(file.path))
          return { ok: false, error: "INVALID" };
        entryHandles.add(entry);
        filesByPath.set(file.path, { file, root, showHidden: snapshot.showHidden });
        if (pathFilters) {
          const path = relativeContentSearchPath(rootPath, file.path);
          if (path === undefined) return { ok: false, error: "UNAVAILABLE" };
          if (!matchesContentSearchPathFilters(path, pathFilters)) continue;
        }
        if (filtered &&
            (!fileFilters || matchesContentSearchFileFilters(basename(file.path), fileFilters)))
          filtered.set(entry, file);
      }
      captures.push({ ...snapshot, searched: filtered ?? entries });
    }
    const handles = [...input.handles];
    const admittedHandles = [...new Set([...handles, ...retainedHandles])];
    const admission = documents.captureContentSearchBindings(admittedHandles);
    if (!admission) return { ok: false, error: "UNAVAILABLE" };
    const current = () => (!roster || roster.current()) && admission.current() &&
      captures.every((capture) => capture.current());
    const check = () => {
      if (!current()) throw Error("Content search invalidated");
    };
    const initialRetainedChecks: (() => Promise<void>)[] = [];
    const retainedChecks: (() => Promise<void>)[] = [];
    const standalone: SearchSnapshotStandalone[] | undefined = mixed ? [] : undefined;
    const standaloneByPath = new Map<string, { entry: string; fingerprint: string; included: boolean }>();
    if (standalone) {
      const bindings = new Map(admittedHandles.map((handle, index) => [handle, admission.bindings[index]]));
      const seenPaths = new Set<string>();
      for (const entry of retainedHandles) {
        const binding = bindings.get(entry);
        if (!binding?.readStandalone || !binding.verifyStandalone)
          return { ok: false, error: "STALE" };
        if (entryHandles.has(entry) || seenPaths.has(binding.path))
          return { ok: false, error: "INVALID" };
        seenPaths.add(binding.path);
        const { path, fingerprint, readStandalone, verifyStandalone } = binding;
        const covered = filesByPath.get(path);
        if (covered && covered.file.fingerprint !== fingerprint)
          return { ok: false, error: "STALE" };
        const verify = async () => {
          await verifyStandalone(check);
          if (covered) {
            const { file, root, showHidden } = covered;
            const authorized = await authorizeEntry(
              root.authorization, file.path, file.fingerprint, file.chain, showHidden, check
            );
            await authorized.file.close();
            check();
          }
        };
        retainedChecks.push(verify);
        if (covered) {
          initialRetainedChecks.push(verify);
          continue;
        }
        if (entryHandles.size + standaloneByPath.size >= INDEX_LIMITS.documents)
          return { ok: false, error: "LIMIT" };
        const name = basename(path);
        const included = (!fileFilters || matchesContentSearchFileFilters(name, fileFilters)) &&
          (!pathFilters || matchesContentSearchPathFilters(name, pathFilters));
        standaloneByPath.set(path, { entry, fingerprint, included });
        if (included) standalone.push({ entry, path, read: readStandalone });
        else initialRetainedChecks.push(verify);
      }
    }
    const task = (async (): Promise<ContentSearchCandidates> => {
      const authorityFailure = (error: unknown): ContentSearchCandidates => {
        const code = mixed && record(error) ? error.code : undefined;
        return {
          ok: false,
          error: !current() || code === "CANCELLED" ? "CANCELLED"
            : code === "BUSY" ? "BUSY" : "UNAVAILABLE",
        };
      };
      try {
        for (const verify of initialRetainedChecks) await verify();
      } catch (error) {
        return authorityFailure(error);
      }
      const result = await searchSnapshotEvidenceAcrossRoots(
        captures.map(({ root, searched, showHidden }) => ({
          authorization: root.authorization, files: searched, showHidden,
        })),
        input.query,
        current,
        mixed || fragments ? "direct" : contentSearchStrategy,
        standalone,
        fragments
      );
      if (!result.ok) {
        const error = result.error;
        if (error === "INPUT") return { ok: false, error: "INVALID" };
        return {
          ok: false,
          error: error === "LIMIT" || error === "BUSY" || error === "CANCELLED" || error === "UNKNOWN"
            ? error
            : "UNAVAILABLE",
        };
      }
      const mappings: SearchMapping[] = [];
      const matchedCounts = new Map<string, number>();
      try {
        for (const [index, handle] of handles.entries()) {
          check();
          const binding = admission.bindings[index];
          if (!binding) {
            mappings.push({ handle, kind: "unresolved" });
            continue;
          }
          try {
            await binding.verify(check);
          } catch {
            mappings.push({ handle, kind: "unresolved" });
            continue;
          }
          check();
          const independent = standaloneByPath.get(binding.path);
          if (independent) {
            if (independent.entry !== handle || independent.fingerprint !== binding.fingerprint)
              mappings.push({ handle, kind: "unresolved" });
            else if (!independent.included)
              mappings.push({ handle, kind: "outside" });
            else {
              const { entry } = independent;
              matchedCounts.set(entry, (matchedCounts.get(entry) ?? 0) + 1);
              mappings.push({
                handle, kind: "matched", entry,
                documentId: binding.documentId, revision: binding.revision, hash: binding.hash,
              });
            }
            continue;
          }
          const capture = captures.find(({ root }) => containsPath(root.authorization.path, binding.path));
          if (!capture) {
            mappings.push({ handle, kind: "outside" });
            continue;
          }
          const { root, entries, searched, showHidden } = capture;
          const node = root.byPath.get(binding.path);
          const file = node && entries.get(node.handle);
          if (!node || file?.fingerprint !== binding.fingerprint) {
            mappings.push({ handle, kind: "unresolved" });
            continue;
          }
          if (!searched.has(node.handle)) {
            try {
              // Prove the scanned directory chain without reading excluded content.
              const authorization = await authorizeEntry(
                root.authorization, file.path, file.fingerprint, file.chain, showHidden, check
              );
              await authorization.file.close();
              check();
              const blocked = documents.trashBlocked(
                authorization.path, authorization.fingerprint, authorization.directories
              );
              mappings.push({ handle, kind: blocked ? "unresolved" : "outside" });
            } catch {
              mappings.push({ handle, kind: "unresolved" });
            }
            continue;
          }
          matchedCounts.set(node.handle, (matchedCounts.get(node.handle) ?? 0) + 1);
          mappings.push({
            handle, kind: "matched", entry: node.handle,
            documentId: binding.documentId, revision: binding.revision, hash: binding.hash,
          });
        }
        for (const { root } of captures) await verifyRoot(root.authorization, check);
        for (const verify of retainedChecks) await verify();
        check();
      } catch (error) {
        return authorityFailure(error);
      }
      return {
        ok: true,
        coverage: result.coverage,
        mappings: mappings.map((mapping) =>
          mapping.kind === "matched" && matchedCounts.get(mapping.entry) !== 1
            ? { handle: mapping.handle, kind: "unresolved" }
            : mapping
        ),
      };
    })();
    indexTask = task;
    try {
      const result = await task;
      return result.ok && !current() ? { ok: false, error: "CANCELLED" } : result;
    } finally {
      indexTask = undefined;
    }
  }
  return {
    async resolveMRU(entries, check) {
      const items:import("../../shared/document-mru").MRUResolved[]=[];
      const validations:(()=>void)[]=[];
      let incomplete=false;
      for(const entry of entries.slice(0,20)) {
        check();
        const identityCurrent=documents.inspectMRU(entry);
        if(!identityCurrent){incomplete=true;continue;}
        let found=false;
        for(const root of roots) {
          const node=root.byPath.get(entry.path),file=node&&root.files.get(node.handle);
          if(!node||file?.fingerprint!==entry.fingerprint)continue;
          const generation=root.meta.generation;
          const current=()=>{check();identityCurrent();if(disposed||!live(root,generation)||root.files.get(node.handle)!==file||root.byPath.get(entry.path)!==node)throw Error("MRU_STALE");};
          try {
            current();const opened=await authorizeEntry(root.authorization,file.path,file.fingerprint,file.chain,root.meta.showHidden,current);
            try{current();items.push({documentId:entry.documentId,rank:entry.rank,kind:"root",root:root.meta.handle,generation,entry:node.handle});validations.push(current);found=true;}finally{await opened.file.close();}
          }catch{incomplete=true;check();}
          if(found)break;
        }
        if(!found){try{const result=await documents.resolveMRUIndependent(entry,()=>{check();identityCurrent();});if(result){items.push({documentId:entry.documentId,rank:entry.rank,kind:"standalone",handle:result.handle});validations.push(result.current);}}catch{incomplete=true;check();}}
        await new Promise<void>(resolve=>setTimeout(resolve,0));
      }
      const current=()=>{check();for(const validate of validations)validate();};current();return {items,incomplete:incomplete||roots.some(root=>root.meta.status!=="complete"),current};
    },
    async searchSnapshot(handle, generation, query, signal) {
      if (signal?.aborted) return { ok: false, error: "CANCELLED", accepted: false };
      if (indexTask) return { ok: false, error: "BUSY", accepted: false };
      const snapshot = captureIndexRoot(handle, generation, signal);
      if (!snapshot.ok)
        return { ok: false, error: snapshot.error === "LIMIT" && documents.beginSearchAdmission() ? "LIMIT" : "UNAVAILABLE", accepted: false };
      const admission = documents.beginSearchAdmission();
      if (!admission) return { ok: false, error: "UNAVAILABLE", accepted: false };
      const current = () => admission.current() && snapshot.current();
      const task = searchSnapshot(
        snapshot.root.authorization,
        snapshot.entries,
        snapshot.showHidden,
        query,
        current
      );
      indexTask = task;
      try {
        const result = await task;
        return result.ok && !current()
          ? { ok: false, error: "CANCELLED", accepted: false }
          : result;
      } finally {
        indexTask = undefined;
      }
    },
    searchContentCandidates({ root, generation, ...input }, signal) {
      return searchContentCandidatesForRoots({ ...input, roots: [{ handle: root, generation }] }, signal);
    },
    async searchContentCandidatesForRoots(input, signal) {
      if ("fragments" in input) return { ok: false, error: "INVALID" };
      return searchContentCandidatesForRoots(input, signal);
    },
    searchContentCandidatesForWorkspace({ standaloneHandles, ...input }, signal) {
      return searchContentCandidatesForRoots(input, signal, { standaloneHandles });
    },
    async prepareContentSearchDocument(input, requestId, signal) {
      if (signal?.aborted) return { ok: false, error: "CANCELLED" };
      if (!validContentSearchPrepareRequest({ ...input, protocolVersion: 1, requestId }))
        return { ok: false, error: "INVALID" };
      const { root: handle, generation, entry, expectedHash, binding } = input;
      const captured = captureIndexRoot(handle, generation, signal);
      if (!captured.ok) return captured;
      const { root, entries, showHidden } = captured;
      const file = entries.get(entry);
      if (!file) return { ok: false, error: "STALE" };
      const check = () => {
        if (signal?.aborted) throw new DocumentPathError("CANCELLED");
        if (!captured.current()) throw new DocumentPathError("FILE_CHANGED");
      };
      const checkTrash = (authorization: Parameters<typeof readStableSearchBytes>[0]) => {
        if (documents.trashBlocked(authorization.path, authorization.fingerprint, authorization.directories))
          throw new DocumentPathError("BUSY");
      };
      const verifyVersion = async (
        authorization: Parameters<typeof readStableSearchBytes>[0],
        current: () => void
      ) => {
        checkTrash(authorization);
        const bytes = await readStableSearchBytes(authorization, INDEX_LIMITS.bytes, current);
        current();
        checkTrash(authorization);
        if (!bytes) throw new DocumentPathError("TOO_LARGE");
        if (createHash("sha256").update(bytes).digest("hex") !== expectedHash)
          throw new DocumentPathError("FILE_CHANGED");
      };
      const failure = (error: string): ContentSearchPrepared => ({
        ok: false,
        error: signal?.aborted || error === "CANCELLED" ? "CANCELLED"
          : error === "BUSY" ? "BUSY"
          : error === "TOO_LARGE" ? "LIMIT"
          : !captured.current() || ["FILE_CHANGED", "INVALID_HANDLE", "INVALID_UTF8"].includes(error)
            ? "STALE" : "UNAVAILABLE",
      });
      try {
        if (!binding) {
          const opened = await openWorkspaceFile(root, entry, file, { protocolVersion: 1, requestId }, {
            maxBytes: INDEX_LIMITS.bytes,
            check,
            async verify(authorization, snapshot, current) {
              if (snapshot.hash !== expectedHash) throw new DocumentPathError("FILE_CHANGED");
              await verifyVersion(authorization, current);
            },
          });
          if (!opened.ok) return failure(opened.error);
          return opened.snapshot
            ? { ok: true, target: { kind: "open", snapshot: opened.snapshot } }
            : { ok: false, error: "UNAVAILABLE" };
        }
        const admission = documents.captureContentSearchBindings([binding.handle]);
        if (!admission) return { ok: false, error: "BUSY" };
        const grant = admission.bindings[0];
        const peers = documents.locations().filter((item) => item.path === file.path);
        if (!grant || peers.length !== 1 ||
            grant.path !== file.path || grant.fingerprint !== file.fingerprint ||
            grant.documentId !== binding.documentId ||
            grant.revision !== binding.revision || grant.hash !== binding.hash)
          return { ok: false, error: "STALE" };
        const current = () => {
          check();
          if (!admission.current()) throw new DocumentPathError("FILE_CHANGED");
        };
        await grant.verify(current);
        const authorization = await authorizeEntry(
          root.authorization, file.path, file.fingerprint, file.chain, showHidden, current
        );
        try {
          await verifyVersion(authorization, current);
        } finally {
          await authorization.file.close();
        }
        current();
        checkTrash(authorization);
        return {
          ok: true,
          target: {
            kind: "reuse", handle: grant.handle, documentId: grant.documentId,
            revision: grant.revision, hash: grant.hash,
          },
        };
      } catch (error) {
        return failure(error instanceof DocumentPathError ? error.code : "UNAVAILABLE");
      }
    },
    async prepareRetainedContentSearchDocument(input, requestId, signal) {
      if (signal?.aborted) return { ok: false, error: "CANCELLED" };
      if (indexTask) return { ok: false, error: "BUSY" };
      if (!record(input)) return { ok: false, error: "INVALID" };
      const { entry, expectedHash, rootEntry } = input;
      const anchored = "rootEntry" in input;
      const hasBinding = Object.prototype.hasOwnProperty.call(input, "binding");
      const binding = hasBinding ? input.binding : undefined;
      const expectedKeys = anchored ? "entry,expectedHash,rootEntry,roots"
        : hasBinding ? "binding,entry,expectedHash,roots" : "entry,expectedHash,roots";
      if (!keys(input, expectedKeys) ||
          !perfUuid(requestId) || !perfUuid(entry) ||
          typeof expectedHash !== "string" || !hashPattern.test(expectedHash) ||
          (anchored && (!perfUuid(rootEntry) || "binding" in input)) ||
          (hasBinding && (!validContentSearchDocumentBinding(binding) ||
            binding.handle !== entry || binding.hash !== expectedHash)))
        return { ok: false, error: "INVALID" };
      const requested: unknown = input.roots;
      if (!validContentSearchScopeRoots(requested, !anchored) || (anchored && requested.length !== 1))
        return { ok: false, error: "INVALID" };
      const roster = captureSearchRoster(requested, signal, !anchored);
      if (!roster.ok) return roster;
      const captures: Extract<ReturnType<typeof captureIndexRoot>, { ok: true }>[] = [];
      for (const { handle, generation } of requested) {
        const captured = captureIndexRoot(handle, generation, signal);
        if (!captured.ok) return captured;
        captures.push(captured);
      }
      const admission = documents.captureContentSearchBindings([entry]);
      if (!admission) return { ok: false, error: "BUSY" };
      const retained = admission.bindings[0];
      if (!retained?.prepareRetainedSnapshot)
        return { ok: false, error: "STALE" };
      const { path, fingerprint, documentId, revision, hash, scope, readStandalone, prepareRetainedSnapshot } = retained;
      const anchor = rootEntry ? captures[0] : undefined;
      const anchorFile = rootEntry ? anchor?.entries.get(rootEntry) : undefined;
      const owner = scope && anchor
        ? [...anchor.root.scopes].find((owner) => owner === scope && owner.root === anchor.root)
        : undefined;
      if (scope ? !owner : !readStandalone) return { ok: false, error: "STALE" };
      if (anchored && (anchorFile?.path !== path ||
          anchorFile.fingerprint !== fingerprint || anchor?.root.byPath.get(path)?.handle !== rootEntry))
        return { ok: false, error: "STALE" };
      const visible = () => captures.some(({ root, entries }) => {
        const node = root.byPath.get(path);
        return node !== undefined && entries.has(node.handle);
      });
      const peers = documents.locations().filter((item) => item.path === path);
      if ((!anchored && visible()) || peers.length !== 1 || peers[0].handle !== entry ||
          (binding && (binding.documentId !== documentId || binding.revision !== revision || binding.hash !== hash)))
        return { ok: false, error: "STALE" };
      const check = () => {
        if (signal?.aborted) throw new DocumentPathError("CANCELLED");
        if (!roster.current() || captures.some((captured) => !captured.current()) ||
            (owner && (owner.root !== anchor?.root || !owner.root.scopes.has(owner))) ||
            (anchored ? anchor?.root.byPath.get(path)?.handle !== rootEntry : visible()))
          throw new DocumentPathError("FILE_CHANGED");
      };
      const verifyScope = async (current: () => void) => {
        try {
          if (anchor && anchorFile) {
            const proof = await authorizeEntry(
              anchor.root.authorization, path, fingerprint, anchorFile.chain, anchor.showHidden, current
            );
            await proof.file.close();
            current();
            if (documents.trashBlocked(proof.path, proof.fingerprint, proof.directories))
              throw new DocumentPathError("BUSY");
          } else {
            for (const { root } of captures) await verifyRoot(root.authorization, current);
          }
          current();
        } catch (error) {
          if (record(error) && (error.code === "ENOENT" || error.code === "ENOTDIR"))
            throw new DocumentPathError("FILE_CHANGED");
          throw error;
        }
      };
      const failRetained = (code: unknown): ContentSearchRetainedPrepared => ({
        ok: false,
        error: signal?.aborted || code === "CANCELLED" ? "CANCELLED"
          : code === "BUSY" ? "BUSY"
          : code === "TOO_LARGE" ? "LIMIT"
          : code === "FILE_CHANGED" || code === "INVALID_HANDLE" || code === "INVALID_UTF8"
            ? "STALE" : "UNAVAILABLE",
      });
      const task = Promise.resolve().then(async (): Promise<ContentSearchRetainedPrepared> => {
        if (!binding) {
          const prepared = await prepareRetainedSnapshot(requestId, expectedHash, check, verifyScope, owner);
          if (!prepared.ok) return failRetained(prepared.error);
          return prepared.snapshot
            ? { ok: true, target: { kind: "retained", snapshot: prepared.snapshot } }
            : { ok: false, error: "UNAVAILABLE" };
        }
        if (!readStandalone) return { ok: false, error: "STALE" };
        const current = () => {
          check();
          if (!admission.current()) throw new DocumentPathError("FILE_CHANGED");
        };
        await verifyScope(current);
        const bytes = await readStandalone(INDEX_LIMITS.bytes, current);
        if (createHash("sha256").update(bytes).digest("hex") !== expectedHash)
          throw new DocumentPathError("FILE_CHANGED");
        current();
        return { ok: true, target: { kind: "reuse", handle: entry, documentId, revision, hash } };
      });
      indexTask = task;
      try {
        const prepared = await task;
        if (prepared.ok) {
          check();
          const currentPeers = documents.locations().filter((item) => item.path === path);
          if (currentPeers.length !== 1 || currentPeers[0].handle !== entry ||
              currentPeers[0].fingerprint !== fingerprint || currentPeers[0].documentId !== documentId ||
              (prepared.target.kind === "reuse" && !admission.current()))
            return { ok: false, error: "STALE" };
        }
        return prepared;
      } catch (error) {
        return failRetained(record(error) ? error.code : undefined);
      } finally {
        indexTask = undefined;
      }
    },
    createFolder:(value)=>folders.request(value),
    trashDocument:(value)=>trash.request(value),
    trashLifecycle:trash,
    createMarkdown: (value) => creation.request(value),
    duplicateMarkdown: (value) => duplication.request(value),
    removeStandalone,
    removeFolderRoot: (value) => folderRemoval.request(value),
    reconciliation: {
      prepare: (handle) => removalAdmission ? Promise.resolve({ ok: false as const, reason: "NOT_READY" as const }) : reconciliation.prepare(handle),
      get: (token) => reconciliation.get(token),
      release: (token) => reconciliation.release(token),
      issue: (token) => removalAdmission ? undefined : reconciliation.issue(token),
      accept: (operation) => removalAdmission ? Promise.resolve({ status: "busy" as const }) : reconciliation.accept(operation),
      query: (operation) => reconciliation.query(operation),
    },
    async request(value) {
      if (!validWorkspaceRequest(value)) return failure("", "INVALID_REQUEST");
      if (disposed) return failure(value.requestId, "UNAVAILABLE");
      if (removalAdmission && !["state", "page", "queryRescan"].includes(value.op)) return failure(value.requestId, "BUSY");
      if (
        workerStopped &&
        !["state", "page", "queryRescan", "clear"].includes(value.op)
      )
        return failure(value.requestId, "UNAVAILABLE");
      if (value.op === "prepareRescan") {
        const previous = manualCandidates.get(value.root!);
        if (!previous && manualCandidates.size)
          return failure(value.requestId, "BUSY");
        if (previous) {
          if (!previous.operation) return failure(value.requestId, "BUSY");
          const receipt = reconciliation.query(previous.operation);
          if (receipt.status === "pending")
            return failure(value.requestId, "BUSY");
          if (
            receipt.status === "issued" &&
            Date.now() < previous.expires &&
            previous.token &&
            reconciliation.get(previous.token)
          )
            return {
              ...state(value.requestId, false),
              operation: { ...previous.operation },
            };
          if (previous.token) reconciliation.release(previous.token);
          manualCandidates.delete(value.root!);
        }
        const record: {
          operation?: DirectoryOperation;
          token?: string;
          expires: number;
        } = { expires: Date.now() + manualLeaseMs };
        manualCandidates.set(value.root!, record);
        const preempted = observation.preempt();
        observation.cancel(value.root!);
        await observation.settle();
        if (preempted)
          while (reconciliation.hasWork() && !disposed)
            await new Promise((resolve) => setTimeout(resolve, 0));
        if (disposed || manualCandidates.get(value.root!) !== record)
          return failure(value.requestId, "INVALID_HANDLE");
        const candidate = await reconciliation.prepare(value.root!);
        if (manualCandidates.get(value.root!) !== record) {
          if (candidate.ok) reconciliation.release(candidate.summary.token);
          return failure(value.requestId, "INVALID_HANDLE");
        }
        if (!candidate.ok) {
          manualCandidates.delete(value.root!);
          return failure(
            value.requestId,
            candidate.reason === "BUSY" ? "BUSY" : "UNAVAILABLE"
          );
        }
        const operation = reconciliation.issue(candidate.summary.token);
        if (!operation) {
          reconciliation.release(candidate.summary.token);
          manualCandidates.delete(value.root!);
          return failure(value.requestId, "BUSY");
        }
        record.operation = operation;
        record.token = candidate.summary.token;
        record.expires = Date.now() + manualLeaseMs;
        return { ...state(value.requestId, false), operation };
      }
      if (value.op === "acceptRescan" || value.op === "queryRescan") {
        const receipt =
          value.op === "acceptRescan"
            ? await reconciliation.accept(value.operation!)
            : reconciliation.query(value.operation!);
        if (receipt.status === "committed" || receipt.status === "rejected")
          for (const [handle, record] of manualCandidates)
            if (
              record.operation?.sequence === value.operation!.sequence &&
              record.operation.session === value.operation!.session
            )
              manualCandidates.delete(handle);
        return { ...state(value.requestId, false), receipt };
      }
      if (value.op === "state") return state(value.requestId);
      if (value.op === "clear")
        return (await removeAll())
          ? state(value.requestId)
          : failure(value.requestId, "BUSY");
      if (value.op === "select") {
        if (selecting) return failure(value.requestId, "BUSY");
        selecting = true;
        searchSelectionGeneration++;
        const generation = epoch;
        try {
          const selected = await pickDirectory();
          if (disposed || generation !== epoch)
            return failure(value.requestId, "INVALID_HANDLE");
          if (selected === null) return state(value.requestId);
          const authorization = await authorizeRoot(selected);
          const showHidden = await preferences.get(authorization.path);
          if (disposed || generation !== epoch)
            return failure(value.requestId, "INVALID_HANDLE");
          const existing = roots.find((root) =>
            containsPath(root.authorization.path, authorization.path)
          );
          if (existing) {
            await verifyRoot(existing.authorization);
            return state(value.requestId);
          }
          const covered = roots.filter((root) =>
            containsPath(authorization.path, root.authorization.path)
          );
          if (roots.length - covered.length >= WORKSPACE_MAX_ROOTS)
            return failure(value.requestId, "BUSY");
          const root: Root = {
            meta: {
              handle: randomUUID(),
              name: basename(authorization.path) || "/",
              showHidden,
              displayPath: authorization.path,
              generation: 1,
              status: "scanning",
              examined: 0,
              errors: 0,
              entries: 0,
            },
            authorization,
            nodes: [],
            byPath: new Map(),
            files: new Map(),
            directories: new Map(),
            registry:createDirectoryRegistry(authorization.path,delta=>{if(delta>0&&workspaceUsed()+reconciliation.bytes()+delta>cacheLimit)throw Error("Directory registry budget");cacheBytes+=delta;}),
            scanVersion:1,
            bytes: 0,
            started: false,
            live: true,
            scopes: new Set(),
            priorities: [],
            queueBytes: 0,
          };
          for (const child of covered) {
            for (const [handle, owner] of assetOwners)
              if (owner.root === child) bindAssets(handle, root);
            // The new parent retains every still-open derived grant's authority.
            for (const owner of child.scopes) {
              owner.root = root;
              root.scopes.add(owner);
            }
            child.scopes.clear();
            invalidate(child);
            roots.splice(roots.indexOf(child), 1);
          }
          roots.push(root);
          wake();
          return state(value.requestId);
        } catch {
          return failure(value.requestId, "UNAVAILABLE");
        } finally {
          selecting = false;
        }
      }
      const root = roots.find((item) => item.meta.handle === value.root);
      if (!root) return failure(value.requestId, "INVALID_HANDLE");
      if (value.op === "hidden") {
        preferencePending++;
        observation.cancel(root.meta.handle, true);
        const currentEpoch = epoch;
        const task = preferenceTail.then(async () => {
          if (
            disposed ||
            currentEpoch !== epoch ||
            !root.live ||
            !roots.includes(root)
          )
            return failure(value.requestId, "INVALID_HANDLE");
          try {
            await verifyRoot(root.authorization);
            await preferences.set(root.authorization.path, value.showHidden!);
            if (
              disposed ||
              currentEpoch !== epoch ||
              !root.live ||
              !roots.includes(root)
            )
              return failure(value.requestId, "INVALID_HANDLE");
            root.meta.showHidden = value.showHidden!;
            restart(root);
            return state(value.requestId);
          } catch {
            return failure(value.requestId, "UNAVAILABLE");
          }
        });
        preferenceTail = task.catch(() => undefined).finally(() => { preferencePending--; });
        return task;
      }
      if (value.op === "page") {
        if (
          root.meta.generation !== value.generation ||
          value.cursor! > root.nodes.length
        )
          return failure(value.requestId, "INVALID_HANDLE");
        return {
          ...state(value.requestId),
          root: root.meta.handle,
          generation: root.meta.generation,
          nodes: root.nodes.slice(
            value.cursor,
            value.cursor! + WORKSPACE_PAGE_SIZE
          ),
          nextCursor: Math.min(
            root.nodes.length,
            value.cursor! + WORKSPACE_PAGE_SIZE
          ),
        } as WorkspaceResponse;
      }
      if (value.op === "prioritize") {
        const node = root.nodes.find((item) => item.handle === value.entry);
        if (node?.kind !== "directory")
          return failure(value.requestId, "INVALID_HANDLE");
        root.priorities = [node.displayPath];
        wake();
        return state(value.requestId);
      }
      try {
        await verifyRoot(root.authorization);
      } catch {
        return failure(value.requestId, "UNAVAILABLE");
      }
      if (!root.live) return failure(value.requestId, "INVALID_HANDLE");
      restart(root);
      return state(value.requestId);
    },
    reveal: (value) => dispatchWorkspacePath(value, "reveal"),
    openDefault: (value) => dispatchWorkspacePath(value, "open-default"),
    async open(value) {
      const envelope = {
        protocolVersion: 1 as const,
        requestId: validWorkspaceOpen(value) ? value.requestId : "",
      };
      if (!validWorkspaceOpen(value))
        return { ...envelope, ok: false, error: "INVALID_REQUEST" };
      if (removalAdmission) return { ...envelope, ok: false, error: "BUSY" };
      const root = roots.find((item) => item.meta.handle === value.root),
        file = root?.files.get(value.entry);
      if (disposed || !root || !file)
        return { ...envelope, ok: false, error: "INVALID_HANDLE" };
      return openWorkspaceFile(root, value.entry, file, envelope);
    },
    async dispose() {
      indexDisposing = true;
      trash.dispose();
      creation.dispose();
      duplication.dispose();
      folders.dispose();
      releaseCreation?.();
      folderRemoval.dispose();
      releaseFolderRemoval?.();
      observation.dispose();
      reconciliation.dispose();
      await removeAll();
      disposed = true;
      epoch++;
      while (running) await new Promise((resolve) => setTimeout(resolve, 1));
      await indexTask;
      worker.dispose();
    },
  };
}
