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
  reveal, openDefault, cancel, available, nextId = () => crypto.randomUUID(),
}: {
  reveal: (request: WorkspaceRevealRequest) => Promise<unknown>;
  openDefault?: (request: WorkspaceRevealRequest) => Promise<unknown>;
  cancel: (request: DocumentRequest) => Promise<unknown>;
  available: () => boolean;
  nextId?: () => string;
}) {
  let target: WorkspaceRevealTarget | null = null;
  let selectedFile = false;
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
  const canRunDefault = () => canRun() && selectedFile && !!openDefault;
  const run = async (action: "reveal" | "open-default") => {
    if (!(action === "reveal" ? canRun() : canRunDefault()) || !target) return;
    const request: WorkspaceRevealRequest = { protocolVersion: 1, requestId: nextId(), target: { ...target } };
    pending = request;
    publish(true);
    try {
      const response = await (action === "reveal" ? reveal(request) : openDefault!(request));
      if (disposed || pending !== request || !available()) return;
      if (!isDocumentResponse(response, request.requestId) || !response.ok)
        publish(true, action === "reveal" ? "无法发起 Finder 定位，请确认选中项仍存在且授权有效。" : "无法用默认应用打开选中文件，请确认文件仍存在且授权有效。");
    } catch {
      if (!disposed && pending === request && available())
        publish(true, action === "reveal" ? "Finder 定位请求失败，请重试。" : "默认应用打开请求失败，请重试。");
    } finally {
      if (pending === request) { pending = null; publish(false, snapshot.error); }
    }
  };
  return {
    subscribe(this: void, listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    canRun,
    canRunDefault,
    attach() { disposed = false; },
    setTarget(this: void, value: WorkspaceRevealTarget | null, isFile = false) {
      if (JSON.stringify(value) === JSON.stringify(target) && selectedFile === isFile) return;
      invalidate();
      target = value;
      selectedFile = !!value && isFile;
      publish(false);
    },
    checkAvailability() { if (!available()) invalidate(); },
    run: () => run("reveal"),
    runDefault: () => run("open-default"),
    dispose() { disposed = true; target = null; invalidate(); listeners.clear(); },
  };
}
