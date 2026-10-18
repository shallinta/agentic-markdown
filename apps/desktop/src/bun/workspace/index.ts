import { randomUUID } from "node:crypto";
import { closeSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative } from "node:path";

import type { CreateTarget, CreateMarkdownResponse } from "../../shared/create-markdown";
import type { FolderRemovalPublication } from "../../shared/folder-removal";
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
import { DocumentPathError } from "../documents/path-authorization";
import { createStandaloneRemoval } from "../documents/standalone-removal";

import {
  authorizeRoot,
  authorizeEntry,
  containsPath,
  verifyRoot,
  visiblePath,
  type RootAuthorization,
} from "./authorization";
import { createAutomaticObservation } from "./automatic-observation";
import { createMarkdownService, type CreationNative, type CreationTarget } from "./create-markdown";
import { createFolderRemoval } from "./folder-removal";
import type { HiddenPreferences } from "./preferences";
import type { HiddenRemoval } from "./preferences";
import { createReconciliation } from "./reconciliation";
import {
  openDirectoryDescriptor,
  type DirectoryNative,
  type ScanFile,
} from "./scan";
import { validScanBatch } from "./scan-protocol";
import { createScanWorker } from "./worker";

interface Root {
  meta: WorkspaceRoot;
  authorization: RootAuthorization;
  nodes: WorkspaceNode[];
  byPath: Map<string, WorkspaceNode>;
  files: Map<string, ScanFile>;
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
  createMarkdown(value: unknown): Promise<CreateMarkdownResponse>;
  duplicateMarkdown(value: unknown): Promise<CreateMarkdownResponse>;
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
  directoryNative,
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
  /** Bounded lifetime for an issued but never accepted manual operation. */
  manualLeaseMs?: number;
  directoryNative?: DirectoryNative;
  preferences?: HiddenPreferences;
}): TrustedWorkspaceService {
  const roots: Root[] = [];
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
      cacheBytes,
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
          }
        : undefined;
    },
    usedBytes: () => cacheBytes + observation.bytes(),
    limit: cacheLimit,
    worker,
    wake: () => wake(),
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
      )
        return false;
      cacheBytes += publication.bytes - root.bytes;
      root.bytes = publication.bytes;
      root.nodes = publication.nodes;
      root.byPath = publication.byPath;
      root.files = publication.files;
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
    budget: () => cacheLimit - cacheBytes - reconciliation.bytes(),
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
  };
  function merge(root: Root, files: ScanFile[]) {
    for (const file of files) {
      if (
        !visiblePath(
          root.authorization.path,
          file.path,
          root.meta.showHidden
        ) ||
        root.byPath.has(file.path)
      )
        continue;
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
          kind: cursor === file.path ? "file" : "directory",
          displayPath: cursor,
        };
        additions.push(node);
        parent = node.handle;
      }
      const bytes =
        Buffer.byteLength(JSON.stringify(additions)) +
        Buffer.byteLength(JSON.stringify(file));
      if (
        cacheBytes + observation.bytes() + reconciliation.bytes() + bytes >
        cacheLimit
      )
        reconciliation.invalidate(undefined, true);
      if (cacheBytes + observation.bytes() + bytes > cacheLimit) {
        root.meta.status = "paused";
        queueCleanup(key(root));
        return;
      }
      for (const node of additions) {
        root.nodes.push(node);
        root.byPath.set(node.displayPath, node);
      }
      root.files.set(parent, file);
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
            workerKeys.add(key(root));
            await worker.call({
              op: "start",
              key: key(root),
              root: root.authorization,
              showHidden: root.meta.showHidden ?? false,
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
          });
          if (!live(root, generation)) continue;
          if (!validScanBatch(batch)) throw Error();
          root.meta.examined += batch.examined;
          root.queueBytes = batch.queueBytes;
          root.meta.errors += batch.errors;
          merge(root, batch.files);
          if (batch.paused) root.meta.status = "paused";
          else if (batch.done && root.meta.status === "scanning")
            root.meta.status = root.meta.errors ? "partial" : "complete";
          if (root.meta.status !== "scanning") queueCleanup(key(root));
          if (root.meta.status !== "scanning") root.queueBytes = 0;
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
      const baseBytes = planBytes + cacheBytes + observation.bytes() + reconciliation.bytes();
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
                root.nodes = []; root.byPath.clear(); root.files.clear();
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
      for (const file of root.files.values()) {
        const index = file.chain.findIndex(item => item.path === path);
        if (index >= 0) { chain = file.chain.slice(0, index + 1); found = true; break; }
        if (++count % 64 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); check(); }
      }
      if (!found) throw Error("Missing directory proof");
    }
    let parent = root.authorization.path;
    if (chain.length > 256 || !chain.every(item => { const valid = dirname(item.path) === parent && containsPath(root.authorization.path, item.path); parent = item.path; return valid; })) throw Error("Incomplete chain");
    check();
    return {root: root.authorization, path, chain, showHidden: root.meta.showHidden ?? false, check, scope() {
      const owner: Owner = {root, release() { this.root.scopes.delete(this); }, async verify() { if (disposed || !this.root.live || !roots.includes(this.root)) throw Error("Root removed"); await verifyRoot(this.root.authorization); if (disposed || !this.root.live) throw Error("Root removed"); }};
      root.scopes.add(owner); return owner;
    }};
  }
  const creationHost: Parameters<typeof createMarkdownService>[0] = {
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
        return {target, release, accept(file: ScanFile) {
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
          if (cacheBytes + observation.bytes() + reconciliation.bytes() + bytes > cacheLimit) return {status: "unavailable" as const};
          root.nodes.push(node); root.byPath.set(file.path, node); root.files.set(node.handle, file); root.bytes += bytes; cacheBytes += bytes; root.meta.entries = root.nodes.length;
          return {status: "accepted" as const, entryHandle: node.handle};
        }};
      } catch (error) { release(); throw error; }
    }
  };
  const creation = createMarkdownService(creationHost);
  const duplication = createMarkdownService(creationHost, true);
  return {
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
      const generation = root.meta.generation;
      openingRoots.set(root, (openingRoots.get(root) ?? 0) + 1);
      try {
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
        const response = await documents.openAuthorized(
          envelope,
          async () => {
            if (!live(root, generation) || root.files.get(value.entry) !== file)
              throw new DocumentPathError("INVALID_HANDLE");
            const candidate = await authorizeEntry(
              root.authorization,
              file.path,
              file.fingerprint,
              file.chain,
              root.meta.showHidden
            );
            if (!live(root, generation)) {
              await candidate.file.close();
              throw new DocumentPathError("INVALID_HANDLE");
            }
            return candidate;
          },
          owner
        );
        if (!response.ok || !response.snapshot) owner.root.scopes.delete(owner);
        else bindAssets(response.snapshot.handle, owner.root);
        return response;
      } finally {
        const count = openingRoots.get(root)! - 1;
        if (count) openingRoots.set(root, count);
        else openingRoots.delete(root);
      }
    },
    async dispose() {
      creation.dispose();
      duplication.dispose();
      releaseCreation?.();
      folderRemoval.dispose();
      releaseFolderRemoval?.();
      observation.dispose();
      reconciliation.dispose();
      await removeAll();
      disposed = true;
      epoch++;
      while (running) await new Promise((resolve) => setTimeout(resolve, 1));
      worker.dispose();
    },
  };
}
