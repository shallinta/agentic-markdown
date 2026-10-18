import type { FolderRemovalPublication } from "../shared/folder-removal";
import type { TrashPublication } from "../shared/trash-document";
import type {
  WorkspaceNode,
  WorkspaceRequest,
  WorkspaceResponse,
  WorkspaceRoot,
  DirectoryOperation,
  DirectoryReceipt,
} from "../shared/workspace";
import {
  WORKSPACE_PAGE_SIZE,
  WORKSPACE_MAX_ROOTS,
  WORKSPACE_CACHE_BYTES,
  validDirectoryOperation,
} from "../shared/workspace";

const integer = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 4096;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
class WorkspaceError extends Error {}
const metadataBytes = (value: unknown) =>
  2 * JSON.stringify(value).length + 128;
function receipt(value: unknown): DirectoryReceipt {
  if (!object(value)) throw Error("workspace-receipt");
  if (
    value.status === "committed" &&
    Object.keys(value).length === 3 &&
    text(value.root) &&
    integer(value.generation) &&
    Number(value.generation) > 0
  )
    return {
      status: "committed",
      root: value.root,
      generation: Number(value.generation),
    };
  if (
    value.status === "rejected" &&
    Object.keys(value).length === 2 &&
    text(value.reason)
  )
    return { status: "rejected", reason: value.reason };
  if (
    (value.status === "issued" ||
      value.status === "pending" ||
      value.status === "unknown" ||
      value.status === "busy") &&
    Object.keys(value).length === 1
  )
    return { status: value.status };
  throw Error("workspace-receipt");
}
function validResponse(
  value: unknown,
  requestId: string
): value is Extract<WorkspaceResponse, { ok: true }> {
  if (
    !object(value) ||
    value.protocolVersion !== 1 ||
    value.requestId !== requestId ||
    value.ok !== true ||
    !integer(value.cacheBytes) ||
    Number(value.cacheBytes) > WORKSPACE_CACHE_BYTES
  )
    return false;
  if (
    !Array.isArray(value.roots) ||
    value.roots.length > WORKSPACE_MAX_ROOTS ||
    !value.roots.every(
      (root) =>
        object(root) &&
        text(root.handle) &&
        text(root.name) &&
        text(root.displayPath) &&
        integer(root.generation) &&
        (root.showHidden === undefined ||
          typeof root.showHidden === "boolean") &&
        (root.observation === undefined ||
          (typeof root.observation === "string" &&
            ["establishing", "watching", "limited", "unavailable"].includes(
              root.observation
            ))) &&
        Number(root.generation) > 0 &&
        integer(root.entries) &&
        integer(root.errors) &&
        integer(root.examined) &&
        ["scanning", "complete", "partial", "paused", "failed"].includes(
          root.status as string
        )
    )
  )
    return false;
  if (
    value.assetEpochs !== undefined &&
    (!object(value.assetEpochs) ||
      !Object.entries(value.assetEpochs).every(
        ([handle, epoch]) =>
          /^[a-f\d-]{36}$/i.test(handle) &&
          typeof epoch === "string" &&
          /^[a-f\d-]{36}$/i.test(epoch)
      ))
  )
    return false;
  if (
    new Set(value.roots.map((root: Record<string, unknown>) => root.handle))
      .size !== value.roots.length ||
    !Array.isArray(value.coveredHandles) ||
    !value.coveredHandles.every(text)
  )
    return false;
  return (
    value.nodes === undefined ||
    (text(value.root) &&
      integer(value.generation) &&
      integer(value.nextCursor) &&
      Array.isArray(value.nodes) &&
      value.nodes.length <= WORKSPACE_PAGE_SIZE &&
      value.nodes.every(
        (node) =>
          object(node) &&
          text(node.handle) &&
          text(node.parent) &&
          text(node.name) &&
          text(node.displayPath) &&
          ["file", "directory"].includes(node.kind as string)
      ) &&
      new Set(value.nodes.map((node: Record<string, unknown>) => node.handle))
        .size === value.nodes.length)
  );
}

export interface FolderState {
  roots: WorkspaceRoot[];
  nodes: Record<string, WorkspaceNode[]>;
  coveredHandles: string[];
  assetEpochs?: Record<string, string>;
  busy: boolean;
  error: string | null;
}

/** Only opaque backend capabilities cross this boundary; display paths are never requests. */
export function createFolderWorkspace(
  transport: (request: WorkspaceRequest) => Promise<WorkspaceResponse>
) {
  let state: FolderState = {
    roots: [],
    nodes: {},
    coveredHandles: [],
    busy: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  const queryListeners = new Set<() => void>();
  let disposed = false;
  let tail = Promise.resolve();
  let epoch = 0;
  let activeEpoch = 0;
  let refreshPending: Promise<void> | undefined;
  let pendingRescan:
    { root: string; operation: DirectoryOperation } | undefined;
  let rescanNotice: string | null = null;
  let confirmedCommit = false;
  let metadataOwners = 0;
  let mruBytes = 0;
  let probing = false;
  let queryRevision = 0;
  let queryLease: { cancel(): void; bytes: number } | undefined;
  let queryBaseCost = metadataBytes(state);
  let queryHeaderCost = metadataBytes([state.roots, state.coveredHandles, state.assetEpochs]);
  const invalidateQuery = () => { const old = queryLease; queryLease = undefined; old?.cancel(); };
  const invalidateMetadata = () => { queryRevision++; invalidateQuery(); };
  let removalPaused = false;
  const publish = (next: FolderState) => {
    if (disposed) return;
    invalidateMetadata();
    state = next;
    queryBaseCost = metadataBytes(next);
    queryHeaderCost = metadataBytes([next.roots, next.coveredHandles, next.assetEpochs]);
    listeners.forEach((listener) => listener());
  };
  async function request(
    input: Omit<WorkspaceRequest, "requestId" | "protocolVersion">
  ) {
    const expectedEpoch = activeEpoch;
    if (disposed || expectedEpoch !== epoch) return;
    const requestId = crypto.randomUUID();
    const response = await transport({
      ...input,
      requestId,
      protocolVersion: 1,
    });
    if (disposed || expectedEpoch !== epoch) return;
    if (!validResponse(response, requestId))
      throw new Error("workspace-request");
    if (metadataBytes(response) > WORKSPACE_CACHE_BYTES)
      throw Error("workspace-response-budget");
    if (
      input.op === "page" &&
      (response.root !== input.root ||
        response.generation !== input.generation ||
        !response.nodes ||
        response.nextCursor !== input.cursor! + response.nodes.length)
    )
      throw new Error("workspace-page");
    return response;
  }
  function enqueue(action: () => Promise<void>, busy = false) {
    if (removalPaused) return Promise.resolve();
    const expectedEpoch = epoch;
    if (busy) publish({ ...state, busy: true });
    const operation = tail.then(async () => {
      if (!disposed && expectedEpoch === epoch) {
        activeEpoch = expectedEpoch;
        probing = action === refresh && !pendingRescan && !confirmedCommit && !busy;
        metadataOwners++;
        if (probing) queryRevision++; else invalidateMetadata();
        try {
          if (probing && mruBytes + queryBaseCost + (queryLease?.bytes ?? 0) + 1024 > WORKSPACE_CACHE_BYTES) throw Error("workspace-probe-budget");
          await action();
        } catch (error) {
          if (!disposed && expectedEpoch === epoch) publish({ ...state, error: error instanceof WorkspaceError ? error.message : "目录更新未完成，保留上次可见结果；请重试。" });
          throw error;
        } finally { probing = false; metadataOwners--; for (const listener of queryListeners) listener(); }
      }
    });
    tail = operation
      .catch(() => undefined)
      .finally(() => {
        if (busy && !disposed && expectedEpoch === epoch) publish({ ...state, busy: false });
      });
    return operation;
  }
  async function refreshSnapshot() {
    const captured = await request({ op: "state" });
    if (!captured) return;
    if (probing && mruBytes + queryBaseCost + (queryLease?.bytes ?? 0) + 1024 + queryHeaderCost + 3 * metadataBytes(captured) > WORKSPACE_CACHE_BYTES) throw Error("workspace-probe-response-budget");
    if (
      JSON.stringify([
        captured.roots,
        captured.coveredHandles,
        captured.assetEpochs,
      ]) ===
      JSON.stringify([state.roots, state.coveredHandles, state.assetEpochs]) &&
      captured.roots.every(root => (state.nodes[root.handle]?.length ?? 0) === root.entries)
    ) {
      if (state.error !== rescanNotice)
        publish({ ...state, error: rescanNotice });
      return;
    }
    if (probing) { probing = false; invalidateMetadata(); }
    const compatible = (response: typeof captured) => {
      if (
        response.roots.length !== captured.roots.length ||
        captured.roots.some((root) => {
          const current = response.roots.find(
            (item) => item.handle === root.handle
          );
          return (
            current?.generation !== root.generation ||
            current.showHidden !== root.showHidden ||
            current.entries < root.entries
          );
        })
      )
        throw Error("workspace-changed");
    };
    const nodes: FolderState["nodes"] = {};
    const known = new Set(captured.roots.map((root) => root.handle));
    let bytes = mruBytes + metadataBytes(state) + metadataBytes(captured);
    const charge = (value: unknown) => {
      bytes += metadataBytes(value);
      if (bytes > WORKSPACE_CACHE_BYTES)
        throw Error("workspace-staging-budget");
    };
    charge(null);
    for (const root of captured.roots) {
      const prior = state.roots.find((item) => item.handle === root.handle);
      if (
        prior?.generation === root.generation &&
        prior.showHidden !== root.showHidden
      )
        throw Error("workspace-policy-without-generation");
      const reusable =
        prior?.generation === root.generation
          ? (state.nodes[root.handle] ?? [])
          : [];
      if (reusable.length > root.entries) throw Error("workspace-shrunk");
      const collected: WorkspaceNode[] = reusable.slice();
      const parents = new Set([root.handle]);
      nodes[root.handle] =
        reusable.length === root.entries ? reusable : collected;
      for (const node of reusable) {
        if (known.has(node.handle) || !parents.has(node.parent))
          throw Error("workspace-node-identity");
        charge([node.handle, node.parent]);
        known.add(node.handle);
        if (node.kind === "directory") parents.add(node.handle);
      }
      while (collected.length < root.entries) {
        const page = await request({
          op: "page",
          root: root.handle,
          generation: root.generation,
          cursor: collected.length,
        });
        if (!page) return;
        compatible(page);
        if (bytes + metadataBytes(page) > WORKSPACE_CACHE_BYTES)
          throw Error("workspace-staging-page-budget");
        if (
          !page.nodes?.length ||
          page.nextCursor! >
            page.roots.find((item) => item.handle === root.handle)!.entries
        )
          throw Error("workspace-page-empty");
        // Same-generation scans append immutable nodes. Ignore only the validated
        // newer suffix, never mix its coverage/metadata into this captured view.
        for (const node of page.nodes.slice(
          0,
          root.entries - collected.length
        )) {
          if (known.has(node.handle) || !parents.has(node.parent))
            throw Error("workspace-node-identity");
          charge(node);
          known.add(node.handle);
          if (node.kind === "directory") parents.add(node.handle);
          collected.push(node);
        }
      }
    }
    const final = await request({ op: "state" });
    if (!final) return;
    compatible(final);
    publish({
      ...state,
      roots: captured.roots,
      nodes,
      coveredHandles: captured.coveredHandles,
      assetEpochs: captured.assetEpochs,
      error: rescanNotice,
    });
  }
  async function refresh() {
    if (pendingRescan) {
      try {
        const queried = await request({
          op: "queryRescan",
          operation: pendingRescan.operation,
        });
        if (!queried) return;
        const result = receipt(queried.receipt);
        if (
          result.status === "committed" &&
          result.root === pendingRescan.root
        ) {
          pendingRescan = undefined;
          confirmedCommit = true;
          rescanNotice = null;
        } else if (result.status === "rejected" || result.status === "busy") {
          pendingRescan = undefined;
          rescanNotice = "本次重扫未提交；当前目录显示可继续更新。";
        } else
          rescanNotice =
            "上次重扫结果仍未确认；当前目录可读状态不代表该操作结果，重试仅核对原操作。";
      } catch {
        rescanNotice = "上次重扫结果仍未确认；保留原操作，稍后继续核对。";
      }
    }
    try {
      await refreshSnapshot();
      confirmedCommit = false;
    } catch (error) {
      if (confirmedCommit)
        throw new WorkspaceError(
          "后台重扫已完成，但目录显示更新失败；旧树已保留，请稍后刷新。"
        );
      throw error;
    }
  }
  async function rescan(root: string) {
    if (pendingRescan && pendingRescan.root !== root)
      throw new WorkspaceError(
        "上次重扫结果尚未确认，请先重试该目录以查询原操作。"
      );
    if (!pendingRescan) {
      if (
        state.roots.find((item) => item.handle === root)?.status !== "complete"
      ) {
        const restarted = await request({ op: "rescan", root });
        if (!restarted) return;
        rescanNotice = null;
        return refresh();
      }
      const prepared = await request({ op: "prepareRescan", root });
      if (!prepared) return;
      if (!validDirectoryOperation(prepared.operation))
        throw Error("workspace-operation");
      pendingRescan = { root, operation: { ...prepared.operation } };
      rescanNotice = null;
    } else {
      const queried = await request({
        op: "queryRescan",
        operation: pendingRescan.operation,
      });
      if (!queried) return;
      return finishRescan(queried.receipt!);
    }
    try {
      const accepted = await request({
        op: "acceptRescan",
        operation: pendingRescan.operation,
      });
      if (accepted) await finishRescan(accepted.receipt!);
    } catch (error) {
      if (pendingRescan)
        throw new WorkspaceError(
          "重扫结果尚未确认，旧树已保留；重试将只核对原操作，不重新提交。"
        );
      throw error;
    }
  }
  async function finishRescan(value: DirectoryReceipt) {
    const result = receipt(value);
    if (result.status === "committed") {
      if (result.root !== pendingRescan?.root)
        throw Error("workspace-receipt-root");
      pendingRescan = undefined;
      confirmedCommit = true;
      rescanNotice = null;
      try {
        await refresh();
      } catch {
        throw new WorkspaceError(
          "后台重扫已完成，但目录显示更新失败；旧树已保留，请稍后刷新。"
        );
      }
    } else if (result.status === "rejected" || result.status === "busy") {
      pendingRescan = undefined;
      rescanNotice = "本次重扫未提交，保留原目录；请稍后重试。";
      throw new WorkspaceError("本次重扫未提交，保留原目录；请稍后重试。");
    } else
      throw new WorkspaceError(
        "重扫结果尚未确认，旧树已保留；重试将只核对原操作。"
      );
  }
  return {
    setMRUCost(bytes: number) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || (bytes > 0 && (disposed || metadataOwners || removalPaused))) return false;
      if (bytes > 0 && queryBaseCost + mruBytes + (queryLease?.bytes ?? 0) + bytes > WORKSPACE_CACHE_BYTES) return false;
      invalidateQuery();
      mruBytes = bytes;
      return true;
    },
    queryVersion: () => queryRevision,
    subscribeQueryAvailability(listener: () => void) {
      queryListeners.add(listener);
      return () => { queryListeners.delete(listener); };
    },
    queryAvailable: () => !disposed && !metadataOwners && !removalPaused && !state.busy && !state.error,
    acquireQueryBudget(cancel: () => void) {
      if (disposed || metadataOwners || removalPaused || state.busy || state.error) return null;
      invalidateQuery();
      const base = queryBaseCost + mruBytes;
      const lease = { cancel, bytes: 0 }; queryLease = lease;
      return {
        current: () => queryLease === lease && !disposed && !removalPaused,
        runnable: () => queryLease === lease && !disposed && !metadataOwners && !removalPaused,
        reserve: (bytes: number) => {
          if (queryLease !== lease || metadataOwners || !Number.isSafeInteger(bytes) || bytes < 0 || base + bytes > WORKSPACE_CACHE_BYTES) return false;
          lease.bytes = bytes; return true;
        },
        release: () => { if (queryLease === lease) queryLease = undefined; },
      };
    },
    beginFolderRemoval() {
      if (disposed || removalPaused || state.busy || pendingRescan) return false;
      removalPaused = true;
      invalidateMetadata();
      epoch++;
      refreshPending = undefined;
      publish({ ...state, busy: true });
      return true;
    },
    prepareFolderRemoval(result: FolderRemovalPublication) {
      invalidateMetadata();
      if (disposed || !removalPaused || !state.roots.some(root => root.handle === result.root)) throw Error("folder-removal-binding");
      if (result.roots.length !== state.roots.length - 1 || result.roots.some(root => {
        const old = state.roots.find(item => item.handle === root.handle);
        return !old || root.handle === result.root || root.generation < old.generation || (root.generation === old.generation && (root.entries < old.entries || old.showHidden !== root.showHidden));
      })) throw Error("folder-removal-roots");
      // Existing node arrays are shared, not copied. Charge the incoming
      // publication and the new shallow container while old metadata/MRU live.
      const preparedCost = 3 * metadataBytes(result) + 1024 + Object.keys(state.nodes).reduce((bytes, key) => bytes + 64 + key.length * 2, 0);
      if (queryBaseCost + mruBytes + preparedCost > WORKSPACE_CACHE_BYTES) throw Error("folder-removal-budget");
      const nodes = { ...state.nodes };
      delete nodes[result.root];
      for (const root of result.roots) {
        if (state.roots.find(item => item.handle === root.handle)?.generation !== root.generation) nodes[root.handle] = [];
      }
      const next: FolderState = { ...state, roots: result.roots, nodes, coveredHandles: result.coveredHandles, assetEpochs: result.assetEpochs, busy: false, error: null };
      return { next, epoch };
    },
    prepareTrashedDocument(result: TrashPublication) {
      invalidateMetadata();
      if (disposed || !removalPaused) throw Error("trash-workspace-owner");
      // Charge the incoming publication and shallow containers before copying
      // any arrays. Existing node objects remain shared; affected node arrays,
      // roots and covered-handle arrays are additional retained references.
      const preparedCost = 3 * metadataBytes(result) + 1024
        + Object.keys(state.nodes).reduce((bytes, key) => bytes + 64 + key.length * 2, 0)
        + result.files.reduce((bytes, item) => bytes + (state.nodes[item.root]?.length ?? 0) * 8, 0)
        + state.roots.length * 256 + state.coveredHandles.length * 8;
      if (queryBaseCost + mruBytes + preparedCost > WORKSPACE_CACHE_BYTES) throw Error("trash-publication-budget");
      const changed = new Map(result.files.map(item => [item.root, item]));
      if (changed.size !== result.files.length || result.files.some(item => item.generation <= item.previousGeneration || !state.roots.some(root => root.handle === item.root && root.generation === item.previousGeneration))) throw Error("trash-workspace-binding");
      const nodes = { ...state.nodes };
      for (const item of result.files) {
        const removed = new Set(item.entries);
        if (removed.size !== item.entries.length || item.entries.some(handle => !nodes[item.root]?.some(node => node.handle === handle && node.kind === "file"))) throw Error("trash-entry-binding");
        nodes[item.root] = (nodes[item.root] ?? []).filter(node => !removed.has(node.handle));
      }
      const removedHandles = new Set(result.documents.map(item => item.handle));
      const next: FolderState = { ...state, roots: state.roots.map(root => { const update = changed.get(root.handle); return update ? { ...root, generation: update.generation, entries: Math.max(0, root.entries - update.entries.length) } : root; }), nodes, coveredHandles: state.coveredHandles.filter(handle => !removedHandles.has(handle)), busy: false, error: null };
      if (queryBaseCost + mruBytes + 3 * metadataBytes(result) + metadataBytes(next) > WORKSPACE_CACHE_BYTES) throw Error("trash-publication-budget");
      return { next, epoch };
    },
    swapPrepared(prepared: { next: FolderState; epoch: number }) {
      invalidateMetadata();
      state = prepared.next;
      queryBaseCost = metadataBytes(state);
      queryHeaderCost = metadataBytes([state.roots, state.coveredHandles, state.assetEpochs]);
    },
    flushPreparedEffects() {
      removalPaused = false;
      for (const listener of listeners) { try { listener(); } catch { console.error("folder-removal-listener"); } }
      void enqueue(refresh).catch(() => undefined);
    },
    cancelFolderRemoval() {
      if (!removalPaused) return;
      removalPaused = false;
      publish({ ...state, busy: false });
    },
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    refresh: () => {
      if (removalPaused) return Promise.resolve();
      if (!refreshPending) {
        const refreshing = enqueue(refresh);
        refreshPending = refreshing;
        void refreshing
          .finally(() => {
            if (refreshPending === refreshing) refreshPending = undefined;
          })
          .catch(() => undefined);
      }
      return refreshPending;
    },
    select: () =>
      enqueue(async () => {
        await request({ op: "select" });
        await refresh();
      }, true),
    setHidden: (root: string, showHidden: boolean) =>
      enqueue(async () => {
        await request({ op: "hidden", root, showHidden });
        await refresh();
      }, true),
    rescan: (root: string) =>
      enqueue(async () => {
        try {
          await rescan(root);
        } catch (error) {
          // Passive polling may update the tree, but is not a retry of this
          // explicit action and must not erase its failure acknowledgement.
          rescanNotice =
            error instanceof WorkspaceError
              ? error.message
              : pendingRescan
                ? "重扫结果尚未确认；稍后重试将只核对原操作。"
                : "目录重扫未完成，保留上次可见结果；请检查目录是否仍可访问后重试。";
          throw new WorkspaceError(rescanNotice);
        }
      }, true),
    prioritize: (root: string, entry: string) =>
      enqueue(async () => {
        await request({ op: "prioritize", root, entry });
        await refresh();
      }),
    clear: () => {
      if (removalPaused) return Promise.resolve();
      epoch++;
      return enqueue(async () => {
        await request({ op: "clear" });
        pendingRescan = undefined;
        confirmedCommit = false;
        rescanNotice = null;
        await refresh();
      }, true);
    },
    dispose() {
      invalidateQuery();
      disposed = true;
      epoch++;
      listeners.clear();
      queryListeners.clear();
    },
  };
}
