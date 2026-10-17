import type { DocumentRequest } from "../shared/documents";
import type { WorkspaceRevealRequest, WorkspaceRevealTarget } from "../shared/workspace";

import { isDocumentResponse } from "./documents";
import type { TreeItem } from "./workspace-tree-model";

/** Only an actual selected item may authorize a request shape, never a path. */
export function workspaceRevealTarget(item: TreeItem | undefined): WorkspaceRevealTarget | null {
  if (!item) return null;
  if (item.kind === "standalone") return { type: "document", handle: item.entry.handle };
  return {
    type: "workspace",
    root: item.root.handle,
    generation: item.root.generation,
    ...(item.kind === "node" ? { entry: item.node.handle } : {}),
  };
}

export function createWorkspaceReveal({
  reveal, cancel, available, nextId = () => crypto.randomUUID(),
}: {
  reveal: (request: WorkspaceRevealRequest) => Promise<unknown>;
  cancel: (request: DocumentRequest) => Promise<unknown>;
  available: () => boolean;
  nextId?: () => string;
}) {
  let target: WorkspaceRevealTarget | null = null;
  let pending: WorkspaceRevealRequest | null = null;
  let disposed = false;
  let snapshot = { busy: false, error: "" };
  const listeners = new Set<() => void>();
  const publish = (busy: boolean, error = "") => {
    snapshot = { busy, error };
    for (const listener of listeners) listener();
  };
  const invalidate = () => {
    const old = pending;
    pending = null;
    if (old) void cancel({ protocolVersion: 1, requestId: old.requestId }).catch(() => undefined);
    publish(false);
  };
  const canRun = () => !disposed && !!target && !pending && available();
  return {
    subscribe(this: void, listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    canRun,
    attach() { disposed = false; },
    setTarget(this: void, value: WorkspaceRevealTarget | null) {
      if (JSON.stringify(value) === JSON.stringify(target)) return;
      invalidate();
      target = value;
      publish(false);
    },
    checkAvailability() { if (!available()) invalidate(); },
    async run() {
      if (!canRun() || !target) return;
      const request: WorkspaceRevealRequest = { protocolVersion: 1, requestId: nextId(), target: { ...target } };
      pending = request;
      publish(true);
      try {
        const response = await reveal(request);
        if (disposed || pending !== request || !available()) return;
        if (!isDocumentResponse(response, request.requestId) || !response.ok)
          publish(true, "无法发起 Finder 定位，请确认选中项仍存在且授权有效。");
      } catch {
        if (!disposed && pending === request && available())
          publish(true, "Finder 定位请求失败，请重试。");
      } finally {
        if (pending === request) { pending = null; publish(false, snapshot.error); }
      }
    },
    dispose() { disposed = true; target = null; invalidate(); listeners.clear(); },
  };
}
