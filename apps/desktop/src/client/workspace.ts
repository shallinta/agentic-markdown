import type {
  WorkspaceNode,
  WorkspaceRequest,
  WorkspaceResponse,
  WorkspaceRoot,
} from "../shared/workspace";
import {
  WORKSPACE_PAGE_SIZE,
  WORKSPACE_MAX_ROOTS,
  WORKSPACE_CACHE_BYTES,
} from "../shared/workspace";

const integer = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 4096;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
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
    if (
      input.op === "page" &&
      (response.root !== input.root ||
        response.generation !== input.generation ||
        !response.nodes ||
        response.nextCursor !== input.cursor! + response.nodes.length)
    )
      throw new Error("workspace-page");
    const nodes: FolderState["nodes"] = {};
    for (const root of response.roots) {
      nodes[root.handle] =
        state.roots.find((old) => old.handle === root.handle)?.generation ===
        root.generation
          ? (state.nodes[root.handle] ?? [])
          : [];
    }
    if (
      response.root &&
      response.nodes &&
      response.generation ===
        response.roots.find((root) => root.handle === response.root)?.generation
    ) {
      const old = nodes[response.root] ?? [];
      const known = new Set(old.map((node) => node.handle));
      nodes[response.root] = [
        ...old,
        ...response.nodes.filter((node) => !known.has(node.handle)),
      ];
    }
    publish({
      ...state,
      roots: response.roots,
      coveredHandles: response.coveredHandles,
      assetEpochs: response.assetEpochs,
      nodes,
      error: null,
    });
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
      .catch(() => {
        publish({ ...state, error: "文件夹操作失败，请重新扫描或重试。" });
      })
      .finally(() => {
        if (busy) publish({ ...state, busy: false });
      });
    return operation;
  }
  async function refresh() {
    await request({ op: "state" });
    for (const root of state.roots) {
      const cursor = state.nodes[root.handle]?.length ?? 0;
      if (cursor < root.entries)
        await request({
          op: "page",
          root: root.handle,
          generation: root.generation,
          cursor,
        });
    }
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
    rescan: (root: string) =>
      enqueue(async () => {
        await request({ op: "rescan", root });
        await refresh();
      }, true),
    prioritize: (root: string, entry: string) =>
      enqueue(() => request({ op: "prioritize", root, entry })),
    clear: () => {
      epoch++;
      return enqueue(() => request({ op: "clear" }), true);
    },
    dispose() {
      disposed = true;
      epoch++;
      listeners.clear();
    },
  };
}
