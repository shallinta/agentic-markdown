import { randomUUID } from "node:crypto";
import { basename, join, relative } from "node:path";

import {
  WORKSPACE_CACHE_BYTES,
  WORKSPACE_MAX_ROOTS,
  WORKSPACE_PAGE_SIZE,
  validWorkspaceOpen,
  validWorkspaceRequest,
  type WorkspaceNode,
  type WorkspaceResponse,
  type WorkspaceRoot,
  type WorkspaceService,
} from "../../shared/workspace";
import type {
  TrustedDocumentService,
  DocumentScope,
  AssetScope,
} from "../documents";
import { DocumentPathError } from "../documents/path-authorization";

import {
  authorizeRoot,
  authorizeEntry,
  containsPath,
  verifyRoot,
  visiblePath,
  type RootAuthorization,
} from "./authorization";
import type { HiddenPreferences } from "./preferences";
import { createReconciliation } from "./reconciliation";
import type { ScanFile } from "./scan";
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
  preferences = {
    get: () => Promise.resolve(false),
    set: () => Promise.resolve(),
  },
}: {
  pickDirectory: () => Promise<string | null>;
  documents: TrustedDocumentService;
  worker?: ReturnType<typeof createScanWorker>;
  cacheLimit?: number;
  preferences?: HiddenPreferences;
}): TrustedWorkspaceService {
  const roots: Root[] = [];
  let preferenceTail: Promise<unknown> = Promise.resolve();
  const assetOwners = new Map<string, { root: Root; scope: AssetScope }>();
  function bindAssets(handle: string, root: Root) {
    if (assetOwners.get(handle)?.root === root) return;
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
  const state = (id: string): WorkspaceResponse => {
    syncAssets();
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
    usedBytes: () => cacheBytes,
    limit: cacheLimit,
    worker,
    wake: () => wake(),
    publish(binding, publication) {
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
  let candidateTurn = true;
  const invalidate = (root: Root) => {
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
      if (cacheBytes + reconciliation.bytes() + bytes > cacheLimit)
        reconciliation.invalidate(undefined, true);
      if (cacheBytes + bytes > cacheLimit) {
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
    if (running || disposed) return;
    running = true;
    try {
      while (!disposed || cleanup.length || reconciliation.hasWork()) {
        const stale = cleanup.shift();
        if (stale) {
          await worker.call({ op: "close", key: stale }).catch(() => undefined);
          workerKeys.delete(stale);
          continue;
        }
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
        if (!root) break;
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
      if (disposed) worker.dispose();
    }
  }
  const wake = () => {
    void drain();
  };
  function restart(root: Root) {
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
  return {
    reconciliation: {
      prepare: (handle) => reconciliation.prepare(handle),
      get: (token) => reconciliation.get(token),
      release: (token) => reconciliation.release(token),
      issue: (token) => reconciliation.issue(token),
      accept: (operation) => reconciliation.accept(operation),
      query: (operation) => reconciliation.query(operation),
    },
    async request(value) {
      if (!validWorkspaceRequest(value)) return failure("", "INVALID_REQUEST");
      if (disposed) return failure(value.requestId, "UNAVAILABLE");
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
        preferenceTail = task.catch(() => undefined);
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
    async open(value) {
      const envelope = {
        protocolVersion: 1 as const,
        requestId: validWorkspaceOpen(value) ? value.requestId : "",
      };
      if (!validWorkspaceOpen(value))
        return { ...envelope, ok: false, error: "INVALID_REQUEST" };
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
      reconciliation.dispose();
      await removeAll();
      disposed = true;
      epoch++;
      while (running) await new Promise((resolve) => setTimeout(resolve, 1));
      worker.dispose();
    },
  };
}
