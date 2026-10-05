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
  let disposed = false;
  let tail = Promise.resolve();
  let epoch = 0;
  let activeEpoch = 0;
  let refreshPending: Promise<void> | undefined;
  let pendingRescan:
    { root: string; operation: DirectoryOperation } | undefined;
  let rescanNotice: string | null = null;
  let confirmedCommit = false;
  const publish = (next: FolderState) => {
    if (disposed) return;
    state = next;
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
    const expectedEpoch = epoch;
    if (busy) publish({ ...state, busy: true });
    const operation = tail.then(async () => {
      if (!disposed && expectedEpoch === epoch) {
        activeEpoch = expectedEpoch;
        await action();
      }
    });
    tail = operation
      .catch((error: unknown) => {
        publish({
          ...state,
          error:
            error instanceof WorkspaceError
              ? error.message
              : "目录更新未完成，保留上次可见结果；请重试。",
        });
      })
      .finally(() => {
        if (busy) publish({ ...state, busy: false });
      });
    return operation;
  }
  async function refreshSnapshot() {
    const captured = await request({ op: "state" });
    if (!captured) return;
    if (
      JSON.stringify([
        captured.roots,
        captured.coveredHandles,
        captured.assetEpochs,
      ]) ===
      JSON.stringify([state.roots, state.coveredHandles, state.assetEpochs])
    ) {
      if (state.error !== rescanNotice)
        publish({ ...state, error: rescanNotice });
      return;
    }
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
    let bytes = metadataBytes(state) + metadataBytes(captured);
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
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    refresh: () => {
      if (!refreshPending) {
        refreshPending = enqueue(refresh);
        void refreshPending
          .finally(() => {
            refreshPending = undefined;
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
      disposed = true;
      epoch++;
      listeners.clear();
    },
  };
}
