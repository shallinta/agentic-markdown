import {
  folderName, validCreateFolderRequest, validCreateFolderResponse,
  type CreateFolderRequest, type CreateFolderResponse,
} from "../shared/create-folder";
import {
  markdownFileName,
  validCreateMarkdownRequest,
  validCreateMarkdownResponse,
  type CreateMarkdownRequest,
  type CreateMarkdownResponse,
  type CreateOperation,
  type CreateTarget,
  type DuplicateSource,
  type DuplicateVersion,
} from "../shared/create-markdown";
import { rawHash } from "../shared/save-content";

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

type CreationResponse = CreateMarkdownResponse | CreateFolderResponse;
type CreationRequest = CreateMarkdownRequest | CreateFolderRequest;
type Receipt = Extract<CreationResponse, { operation: CreateOperation }>;
export type CreationMode = "markdown" | "duplicate" | "folder";
export interface CreateMarkdownState {
  mode: CreationMode;
  sourceName?: string;
  duplicateVersion: "disk" | "buffer" | null;
  visible: boolean;
  name: string;
  target: CreateTarget | null;
  busy: boolean;
  preview:
    "idle" | "checking" | "available" | "invalid" | "conflict" | "unavailable";
  message: string | null;
  receipt: Receipt | null;
}
type CreationOptions = {
  documents: ReturnType<typeof createDocumentController>;
  refresh: () => Promise<unknown>;
  locate: (target: CreateTarget, entryHandle: string) => void;
  targetCurrent: (target: CreateTarget) => boolean;
  delay?: number;
} & ({ mode?: "markdown" | "duplicate"; request: (value: CreateMarkdownRequest) => Promise<unknown> } | { mode: "folder"; request: (value: CreateFolderRequest) => Promise<unknown>; directoryCurrent: (target: CreateTarget, entryHandle: string) => boolean });
export function createMarkdownController(options: CreationOptions) {
  const { documents, refresh, locate, targetCurrent, delay = 250 } = options;
  const mode = options.mode ?? "markdown", duplicate = mode === "duplicate", folder = mode === "folder";
  const validateName = folder ? folderName : markdownFileName;
  let state: CreateMarkdownState = {
    mode,
    duplicateVersion: null,
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
  let creationGate: string | null = null;
  let adoptionSource: DuplicateSource | null = null;
  let activationAllowed = true;
  let customName = false;
  let explicitVersion = false;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<CreateMarkdownState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const syncVersion = () => {
    if (duplicate && state.visible && !operation && !state.busy && !explicitVersion && sourceIdentity && documents.getSaveStatus(sourceIdentity.documentId).status === "dirty" && state.duplicateVersion !== null)
      publish({ duplicateVersion: null });
  };
  let unsubscribeDocuments: (() => void) | undefined = documents.subscribe(syncVersion);
  const envelope = () => ({
    protocolVersion: 1 as const,
    requestId: crypto.randomUUID(),
  });
  async function send(value: CreationRequest): Promise<CreationResponse> {
    if (options.mode === "folder") {
      if (!validCreateFolderRequest(value)) throw Error("invalid-folder-request");
      const result = await options.request(value);
      if (!validCreateFolderResponse(result, value)) throw Error("invalid-folder-response");
      return result;
    }
    if (!validCreateMarkdownRequest(value)) throw Error("invalid-create-request");
    const result = await options.request(value);
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
    const name = validateName(state.name),
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
          const suggestedName = "fileName" in response ? response.fileName : undefined;
          if (suggest && response.result === "available" && (!suggestedName || !markdownFileName(suggestedName).ok)) throw Error("invalid-suggested-name");
          publish({
            ...(suggest && suggestedName ? { name: suggestedName } : {}),
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
    response: CreationResponse,
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
    if (folder) {
      if (response.status === "pending" || response.working !== false) return;
      if (creationGate) {
        activationAllowed = activationAllowed && documents.creationGateCurrent(creationGate);
        documents.releaseCreationGate(creationGate);
        creationGate = null;
      }
      if (response.status === "unknown") {
        publish({ message: response.message ?? "文件夹创建结果未知，不会重复创建。请查询原结果，或正常退出应用；不会自动删除目录。" });
        return;
      }
      if (response.status === "created") {
        const current = () => !disposed && state.visible && intent === expectedIntent && activationAllowed && documents.canSelectFolder();
        if (!current()) {
          // Hiding/closing invalidates presentation, not a completed disk write.
          if (!state.visible || disposed || !activationAllowed) await acknowledge();
          return;
        }
        await refresh();
        if (!current()) return;
        if (state.target && response.entryHandle && options.mode === "folder" && options.directoryCurrent(state.target, response.entryHandle)) {
          locate(state.target, response.entryHandle);
          if (await acknowledge()) publish({ visible: false, message: null });
        } else publish({ message: "文件夹已创建，但文件树暂时无法定位；可重试定位，不会重复创建。" });
        return;
      }
    }
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
  async function run(op: "create" | "query" | "retry-open" | "retry-locate") {
    if (state.busy || disposed) return;
    if (op === "create" && operation) return;
    if (op === "create" && state.target && !targetCurrent(state.target)) {
      publish({ preview: "unavailable", message: "目标目录已变化，请重新选择当前已授权目录。" });
      return;
    }
    if (
      op === "create" &&
      (!state.target ||
        !targetCurrent(state.target) ||
        state.preview !== "available" ||
        !documents.canSelectFolder())
    )
      return;
    if (op !== "create" && !operation) return;
    syncVersion();
    if (duplicate && op === "create" && !state.duplicateVersion) {
      publish({ message: "请选择复制当前未保存内容或磁盘版本。" });
      return;
    }
    cancelPreview();
    const expectedIntent = ++intent;
    if (folder && op === "create") {
      creationGate = documents.acquireCreationGate();
      if (!creationGate) return;
      activationAllowed = true;
    } else if (folder && op === "retry-locate") activationAllowed = documents.canSelectFolder();
    if (duplicate && op === "create") {
      if (!sourceIdentity) return;
      sourceGate = documents.acquireDuplicateSource(sourceIdentity.handle, sourceIdentity.documentId);
      if (!sourceGate) { publish({ message: "源文档已变化或暂不可复制，请回到可用文档后重试。" }); return; }
      activationAllowed = true;
      adoptionSource = null;
    } else if (duplicate && op === "retry-open") {
      activationAllowed = documents.canSelectFolder();
      adoptionSource = null;
    }
    publish({ busy: true, message: null });
    let dispatched = false;
    let version: DuplicateVersion | undefined;
    let params: CreationRequest | undefined;
    try {
      if (duplicate && op === "create" && sourceGate) {
        if (state.duplicateVersion === "buffer") {
          let text: string | null = documents.duplicateRawText(sourceGate);
          if (text === null) throw Error("source-changed");
          try { version = { kind: "buffer", text, hash: await rawHash(text) }; }
          finally { text = null; }
        } else version = { kind: "disk" };
        if (!state.visible || disposed || intent !== expectedIntent || !documents.duplicateSourceCurrent(sourceGate)) return;
      }
      if (!operation) {
        const receipt = await send({ ...envelope(), op: "state" });
        if (receipt.status !== "state") throw Error();
        if (!state.visible || disposed || intent !== expectedIntent || (sourceGate && !documents.duplicateSourceCurrent(sourceGate)) || (creationGate && !documents.creationGateCurrent(creationGate))) return;
        operation = { session: receipt.session, sequence: receipt.sequence };
      }
      params =
        op === "create"
          ? {
              ...envelope(),
              ...operation,
              op,
              target: state.target!,
              name: state.name,
              ...(sourceGate ? { source: sourceGate, version } : {}),
            }
          : { ...envelope(), ...operation, op };
      dispatched = true;
      let result: CreationResponse;
      try {
        if (!params) throw Error("missing-request");
        result = await send(params);
      }
      finally { params = undefined; version = undefined; }
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
      // Release raw payload references even when state/hash fails before send.
      // eslint-disable-next-line no-useless-assignment
      params = undefined;
      // eslint-disable-next-line no-useless-assignment
      version = undefined;
      if (op === "create" && !dispatched && creationGate) {
        documents.releaseCreationGate(creationGate);
        creationGate = null;
        operation = null;
      }
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
      unsubscribeDocuments ??= documents.subscribe(syncVersion);
    },
    getSnapshot: () => state,
    canOpen: () => !disposed && !state.busy && (!!operation || (duplicate ? documents.canDuplicate() : documents.canSelectFolder())),
    hasPending: () => !!operation,
    open(target: CreateTarget | null) {
      if (disposed || state.busy || (!operation && !(duplicate ? documents.canDuplicate() : documents.canSelectFolder()))) return;
      if (duplicate && !operation) {
        sourceIdentity = documents.getSnapshot().snapshot;
        customName = false;
        explicitVersion = false;
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
              duplicateVersion: duplicate && sourceIdentity && documents.getSaveStatus(sourceIdentity.documentId).status === "saved" ? "disk" : null,
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
    setDuplicateVersion(version: "disk" | "buffer") {
      if (!duplicate || state.busy || operation) return;
      explicitVersion = true;
      publish({ duplicateVersion: version });
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
    retry: () => run(folder ? "retry-locate" : "retry-open"),
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
      unsubscribeDocuments?.();
      unsubscribeDocuments = undefined;
    },
  };
}
