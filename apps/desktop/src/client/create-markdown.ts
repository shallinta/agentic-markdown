import {
  markdownFileName,
  validCreateMarkdownResponse,
  type CreateMarkdownRequest,
  type CreateMarkdownResponse,
  type CreateOperation,
  type CreateTarget,
  type DuplicateSource,
} from "../shared/create-markdown";

import { isDocumentResponse, type createDocumentController } from "./documents";
import type { FolderState } from "./workspace";

/** Only already authorized, currently projected directories are eligible. */
export function duplicateDefaultTarget(path: string | undefined, folders: FolderState): CreateTarget | null {
  if (!path) return null;
  const parent = path.slice(0, path.lastIndexOf("/")) || "/";
  for (const root of folders.roots) {
    const target = { rootHandle: root.handle, generation: root.generation };
    if (root.displayPath === parent) return target;
    const directory = folders.nodes[root.handle]?.find(node => node.kind === "directory" && node.displayPath === parent);
    if (directory) return { ...target, directoryHandle: directory.handle };
  }
  return null;
}

type Receipt = Extract<CreateMarkdownResponse, { operation: CreateOperation }>;
export interface CreateMarkdownState {
  sourceName?: string;
  visible: boolean;
  name: string;
  target: CreateTarget | null;
  busy: boolean;
  preview:
    "idle" | "checking" | "available" | "invalid" | "conflict" | "unavailable";
  message: string | null;
  receipt: Receipt | null;
}
export function createMarkdownController({
  documents,
  request,
  refresh,
  locate,
  targetCurrent,
  delay = 250,
  duplicate = false,
}: {
  documents: ReturnType<typeof createDocumentController>;
  request: (value: CreateMarkdownRequest) => Promise<unknown>;
  refresh: () => Promise<unknown>;
  locate: (target: CreateTarget, entryHandle: string) => void;
  targetCurrent: (target: CreateTarget) => boolean;
  delay?: number;
  duplicate?: boolean;
}) {
  let state: CreateMarkdownState = {
    visible: false,
    name: "",
    target: null,
    busy: false,
    preview: "idle",
    message: null,
    receipt: null,
  };
  let operation: CreateOperation | null = null,
    intent = 0,
    previewId: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let adoptedHandle: string | null = null;
  let locatedHandle: string | null = null;
  let sourceIdentity: { handle: string; documentId: string; fileName: string } | null = null;
  let sourceGate: DuplicateSource | null = null;
  let adoptionSource: DuplicateSource | null = null;
  let activationAllowed = true;
  let customName = false;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<CreateMarkdownState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const envelope = () => ({
    protocolVersion: 1 as const,
    requestId: crypto.randomUUID(),
  });
  async function send(value: CreateMarkdownRequest) {
    const result = await request(value);
    if (!validCreateMarkdownResponse(result, value))
      throw Error("invalid-create-response");
    return result;
  }
  function cancelPreview() {
    clearTimeout(timer);
    const old = previewId;
    previewId = null;
    if (old)
      void send({ ...envelope(), op: "cancel-preview", previewId: old }).catch(
        () => undefined
      );
  }
  function preview(suggest = false) {
    cancelPreview();
    const name = markdownFileName(state.name),
      target = state.target;
    if (!name.ok) {
      publish({ preview: "invalid", message: name.message });
      return;
    }
    if (!target || !targetCurrent(target)) {
      publish({
        preview: "unavailable",
        message: "请先选择当前已授权的目录。",
      });
      return;
    }
    const id = crypto.randomUUID();
    previewId = id;
    publish({ preview: "checking", message: null });
    timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await send({
            ...envelope(),
            op: "preview",
            target,
            name: suggest && sourceIdentity ? sourceIdentity.fileName : state.name,
            previewId: id,
            ...(suggest ? { suggest: true } : {}),
          });
          if (
            disposed ||
            previewId !== id ||
            !state.visible ||
            response.status !== "preview"
          )
            return;
          if (suggest && response.result === "available" && (!response.fileName || !markdownFileName(response.fileName).ok)) throw Error("invalid-suggested-name");
          publish({
            ...(suggest && response.fileName ? { name: response.fileName } : {}),
            preview: response.result,
            message:
              response.message ??
              (response.result === "available"
                ? null
                : response.result === "conflict"
                  ? "同目录已存在同名或等价名称的项目，请更换名称。"
                  : "无法确认名称可用，请重试。"),
          });
        } catch {
          if (!disposed && previewId === id)
            publish({
              preview: "unavailable",
              message: "名称检查失败，请重试。",
            });
        }
      })();
    }, delay);
  }
  async function acknowledge() {
    if (!operation) return false;
    const result = await send({ ...envelope(), ...operation, op: "ack" });
    if (result.status !== "acked") return false;
    operation = null;
    adoptedHandle = null;
    locatedHandle = null;
    publish({ receipt: null });
    return true;
  }
  async function settle(
    response: CreateMarkdownResponse,
    expectedIntent: number
  ) {
    if (!operation) throw Error("missing-create-operation");
    if (
      !("operation" in response) ||
      response.operation.session !== operation.session ||
      response.operation.sequence !== operation.sequence
    )
      throw Error("create-operation-mismatch");
    publish({ receipt: response, message: response.message ?? null });
    if (duplicate) {
      if (response.working !== false) return;
      if (sourceGate) {
        activationAllowed = activationAllowed && documents.duplicateSourceCurrent(sourceGate);
        adoptionSource = sourceGate;
        documents.releaseDuplicateSource(sourceGate);
        sourceGate = null;
      }
      if (response.status === "unknown") {
        publish({ message: response.message ?? "复制结果未知，不会重复创建。可以查询原结果或正常退出应用；不会自动删除文件。" });
        return;
      }
    }
    if (response.status === "opened" && !response.snapshot)
      throw Error("missing-created-snapshot");
    if (response.status === "acked") {
      operation = null;
      adoptedHandle = null;
      locatedHandle = null;
      publish({ receipt: null, visible: false });
      return;
    }
    if (response.status === "opened" && response.snapshot) {
      const snapshot = response.snapshot;
      if (
        !isDocumentResponse(
          { protocolVersion: 1, requestId: "created", ok: true, snapshot },
          "created"
        )
      )
        throw Error("invalid-created-snapshot");
      const finishLocation = async () => {
        if (locatedHandle !== snapshot.handle) {
          await refresh();
          if (state.target && response.entryHandle) {
            locate(state.target, response.entryHandle);
            locatedHandle = snapshot.handle;
          } else {
            publish({
              message: "文件已打开，文件树定位暂不可用；关闭提示不影响文档。",
            });
            return false;
          }
        }
        return true;
      };
      if (adoptedHandle === snapshot.handle) {
        if (
          !state.visible ||
          !documents
            .getSnapshot()
            .tabs.some((tab) => tab.handle === snapshot.handle) ||
          (await finishLocation())
        )
          if (await acknowledge()) publish({ visible: false });
        return;
      }
      const current = () =>
        !disposed && state.visible && intent === expectedIntent && activationAllowed && (!adoptionSource || documents.matchesDuplicateSource(adoptionSource));
      const adopted =
        current() && (await documents.adoptCreatedDocument(snapshot, current));
      if (adopted) {
        adoptedHandle = snapshot.handle;
        if ((await finishLocation()) && (await acknowledge()))
          publish({ visible: false, message: null });
        return;
      }
      // An input-method/frozen guard can defer adoption. Only an explicitly
      // cancelled intent releases the unpresented grant; retry uses a new intent.
      if (!current()) {
        if (
          !documents
            .getSnapshot()
            .entries.some((entry) => entry.handle === snapshot.handle)
        ) {
          const released = await send({
            ...envelope(),
            ...operation,
            op: "release-unpresented",
          });
          if (!("released" in released) || !released.released)
            throw Error("create-cleanup-unconfirmed");
          publish({ receipt: released });
        }
        await acknowledge();
      } else
        publish({
          message: "文件已创建，当前暂不能切换文档。请稍后重试打开。",
        });
      return;
    }
    if (response.status === "rejected-before-create") {
      await acknowledge();
      return;
    }
    if (response.status === "created" && !state.visible) await acknowledge();
    if (response.status === "created" || response.status === "opened")
      await refresh();
  }
  async function run(op: "create" | "query" | "retry-open") {
    if (state.busy || disposed) return;
    if (op === "create" && operation) return;
    if (
      op === "create" &&
      (!state.target ||
        !targetCurrent(state.target) ||
        state.preview !== "available" ||
        !documents.canSelectFolder())
    )
      return;
    if (op !== "create" && !operation) return;
    cancelPreview();
    const expectedIntent = ++intent;
    if (duplicate && op === "create") {
      if (!sourceIdentity) return;
      sourceGate = documents.acquireDuplicateSource(sourceIdentity.handle, sourceIdentity.documentId);
      if (!sourceGate) { publish({ message: "源文档已变化或暂不可复制，请回到已保存文档后重试。" }); return; }
      activationAllowed = true;
      adoptionSource = null;
    } else if (duplicate && op === "retry-open") {
      activationAllowed = documents.canSelectFolder();
      adoptionSource = null;
    }
    publish({ busy: true, message: null });
    let dispatched = false;
    try {
      if (!operation) {
        const receipt = await send({ ...envelope(), op: "state" });
        if (receipt.status !== "state") throw Error();
        if (!state.visible || disposed || intent !== expectedIntent || (sourceGate && !documents.duplicateSourceCurrent(sourceGate))) return;
        operation = { session: receipt.session, sequence: receipt.sequence };
      }
      const params: CreateMarkdownRequest =
        op === "create"
          ? {
              ...envelope(),
              ...operation,
              op,
              target: state.target!,
              name: state.name,
              ...(sourceGate ? { source: sourceGate } : {}),
            }
          : { ...envelope(), ...operation, op };
      dispatched = true;
      let result = await send(params);
      // A bounded recovery loop never resends create. Remaining uncertainty is
      // kept as a visible recovery action, not silently classified as failure.
      for (let i = 0; result.status === "pending" && i < 3; i++)
        result = await send({ ...envelope(), ...operation, op: "query" });
      await settle(result, expectedIntent);
    } catch {
      publish({
        message: operation
          ? "创建结果或清理尚未确认。请查询结果，不要重复新建。"
          : "无法开始创建，请重试。",
      });
    } finally {
      if (op === "create" && !dispatched && sourceGate) {
        documents.releaseDuplicateSource(sourceGate);
        sourceGate = null;
        operation = null;
      }
      publish({ busy: false });
    }
  }
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach: () => {
      disposed = false;
    },
    getSnapshot: () => state,
    canOpen: () => !disposed && !state.busy && (!!operation || (duplicate ? documents.canDuplicate() : documents.canSelectFolder())),
    hasPending: () => !!operation,
    open(target: CreateTarget | null) {
      if (disposed || state.busy || (!operation && !(duplicate ? documents.canDuplicate() : documents.canSelectFolder()))) return;
      if (duplicate && !operation) {
        sourceIdentity = documents.getSnapshot().snapshot;
        customName = false;
      }
      ++intent;
      publish({
        visible: true,
        ...(duplicate && sourceIdentity ? { sourceName: sourceIdentity.fileName } : {}),
        ...(operation
          ? {}
          : {
              target,
              name: duplicate ? sourceIdentity?.fileName ?? "" : "",
              receipt: null,
              message: null,
              preview: "idle" as const,
            }),
      });
      if (duplicate && !operation && target) preview(true);
    },
    setName(name: string) {
      if (state.busy || operation) return;
      publish({ name });
      customName = true;
      preview();
    },
    setTarget(target: CreateTarget | null) {
      if (state.busy || operation) return;
      publish({ target });
      if (duplicate && !customName && sourceIdentity) publish({ name: sourceIdentity.fileName });
      preview(duplicate && !customName);
    },
    check: () => preview(duplicate && !customName),
    create: () => run("create"),
    query: () => run("query"),
    retry: () => run("retry-open"),
    async close() {
      ++intent;
      cancelPreview();
      publish({ visible: false });
      if (!operation || state.busy) return;
      await run("query");
    },
    dispose() {
      disposed = true;
      ++intent;
      cancelPreview();
      listeners.clear();
    },
  };
}
