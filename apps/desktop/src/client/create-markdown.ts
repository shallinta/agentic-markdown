import {
  markdownFileName,
  validCreateMarkdownResponse,
  type CreateMarkdownRequest,
  type CreateMarkdownResponse,
  type CreateOperation,
  type CreateTarget,
} from "../shared/create-markdown";

import { isDocumentResponse, type createDocumentController } from "./documents";

type Receipt = Extract<CreateMarkdownResponse, { operation: CreateOperation }>;
export interface CreateMarkdownState {
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
}: {
  documents: ReturnType<typeof createDocumentController>;
  request: (value: CreateMarkdownRequest) => Promise<unknown>;
  refresh: () => Promise<unknown>;
  locate: (target: CreateTarget, entryHandle: string) => void;
  targetCurrent: (target: CreateTarget) => boolean;
  delay?: number;
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
  function preview() {
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
            name: state.name,
            previewId: id,
          });
          if (
            disposed ||
            previewId !== id ||
            !state.visible ||
            response.status !== "preview"
          )
            return;
          publish({
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
        !disposed && state.visible && intent === expectedIntent;
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
    publish({ busy: true, message: null });
    try {
      if (!operation) {
        const receipt = await send({ ...envelope(), op: "state" });
        if (receipt.status !== "state") throw Error();
        if (!state.visible || disposed || intent !== expectedIntent) return;
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
            }
          : { ...envelope(), ...operation, op };
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
    canOpen: () => !disposed && !state.busy && documents.canSelectFolder(),
    hasPending: () => !!operation,
    open(target: CreateTarget | null) {
      if (disposed || state.busy || !documents.canSelectFolder()) return;
      ++intent;
      publish({
        visible: true,
        ...(operation
          ? {}
          : {
              target,
              name: "",
              receipt: null,
              message: null,
              preview: "idle" as const,
            }),
      });
    },
    setName(name: string) {
      if (state.busy || operation) return;
      publish({ name });
      preview();
    },
    setTarget(target: CreateTarget | null) {
      if (state.busy || operation) return;
      publish({ target });
      preview();
    },
    check: preview,
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
