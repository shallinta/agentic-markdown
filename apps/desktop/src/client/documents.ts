import {
  MAX_DOCUMENT_BYTES,
  type DocumentErrorCode,
  type DocumentHandleRequest,
  type DocumentRequest,
  type DocumentResponse,
  type DocumentSnapshot,
} from "../shared/documents";

export interface DocumentTransport {
  selectDocument(request: DocumentRequest): Promise<unknown>;
  readDocument(request: DocumentHandleRequest): Promise<unknown>;
  releaseDocument(request: DocumentHandleRequest): Promise<unknown>;
}

export interface DocumentViewState {
  snapshot: DocumentSnapshot | null;
  busy: boolean;
  error: string | null;
  stale: boolean;
  elapsedMs: number | null;
}

const ERROR_TEXT: Record<DocumentErrorCode, string> = {
  INVALID_REQUEST: "文档请求无效，请重试。",
  INVALID_HANDLE: "读取授权已失效，请重新选择文件。",
  UNSUPPORTED_FILE: "请选择普通的 .md 或 .markdown 文件。",
  TOO_LARGE: "文件超过本轮验证入口的 1 MiB 限制，未读取或截断内容。",
  INVALID_UTF8: "文件不是有效的 UTF-8 文本，未转换内容。",
  FILE_CHANGED: "文件已被替换或读取期间发生变化，请重新选择文件。",
  READ_FAILED: "无法读取文件，请检查文件是否存在及读取权限。",
  BUSY: "文件选择器正在使用中，请稍后重试。",
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Validate the trust boundary in both directions, not just TS call sites. */
export function isDocumentResponse(
  value: unknown,
  requestId: string
): value is DocumentResponse {
  if (
    !record(value) ||
    value.protocolVersion !== 1 ||
    value.requestId !== requestId
  )
    return false;
  if (value.ok === false)
    return (
      typeof value.error === "string" &&
      Object.prototype.hasOwnProperty.call(ERROR_TEXT, value.error)
    );
  if (value.ok !== true) return false;
  if (value.snapshot === null) return true;
  const s = value.snapshot;
  return (
    record(s) &&
    typeof s.handle === "string" &&
    UUID.test(s.handle) &&
    typeof s.documentId === "string" &&
    UUID.test(s.documentId) &&
    typeof s.fileName === "string" &&
    s.fileName.length > 0 &&
    s.fileName.length <= 4096 &&
    typeof s.revision === "number" &&
    Number.isSafeInteger(s.revision) &&
    s.revision > 0 &&
    typeof s.hash === "string" &&
    /^[a-f0-9]{64}$/.test(s.hash) &&
    typeof s.byteLength === "number" &&
    Number.isInteger(s.byteLength) &&
    s.byteLength >= 0 &&
    s.byteLength <= MAX_DOCUMENT_BYTES &&
    typeof s.text === "string" &&
    s.text.length <= MAX_DOCUMENT_BYTES &&
    new TextEncoder().encode(s.text).length === s.byteLength
  );
}

/** Small external store keeps request ordering independently testable from React. */
export function createDocumentController(transport: DocumentTransport) {
  let state: DocumentViewState = {
    snapshot: null,
    busy: false,
    error: null,
    stale: false,
    elapsedMs: null,
  };
  let generation = 0;
  const listeners = new Set<() => void>();
  const request = (): DocumentRequest => ({
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
  });
  function publish(next: DocumentViewState) {
    state = next;
    listeners.forEach((listener) => listener());
  }
  async function release(handle: string) {
    try {
      await transport.releaseDocument({ ...request(), handle });
    } catch {
      /* Backend also releases on replacement and process shutdown. */
    }
  }
  async function load(select: boolean) {
    const previous = state.snapshot;
    if (!select && !previous) return;
    const current = ++generation;
    const params = request();
    const start = performance.now();
    publish({ ...state, busy: true, error: null });
    try {
      const response = select
        ? await transport.selectDocument(params)
        : await transport.readDocument({ ...params, handle: previous!.handle });
      if (!isDocumentResponse(response, params.requestId))
        throw new Error("invalid-response");
      if (current !== generation) {
        if (select && response.ok && response.snapshot)
          await release(response.snapshot.handle);
        return;
      }
      if (!response.ok) {
        publish({
          ...state,
          busy: false,
          error: ERROR_TEXT[response.error],
          stale: select ? state.stale : !!state.snapshot,
        });
        return;
      }
      const snapshot = response.snapshot;
      if (!snapshot) {
        if (!select) throw new Error("empty-read");
        publish({ ...state, busy: false });
        return;
      }
      if (
        !select &&
        previous &&
        (snapshot.handle !== previous.handle ||
          snapshot.documentId !== previous.documentId ||
          snapshot.revision < previous.revision ||
          (snapshot.revision === previous.revision &&
            snapshot.hash !== previous.hash))
      )
        throw new Error("stale-response");
      publish({
        snapshot,
        busy: false,
        error: null,
        stale: false,
        elapsedMs: performance.now() - start,
      });
      if (previous && previous.handle !== snapshot.handle)
        void release(previous.handle);
    } catch {
      if (current === generation)
        publish({
          ...state,
          busy: false,
          error: "文档通信失败或返回结果无效，请重试或重新选择文件。",
          stale: select ? state.stale : !!state.snapshot,
        });
    }
  }
  function clear() {
    ++generation;
    const previous = state.snapshot;
    publish({
      snapshot: null,
      busy: false,
      error: null,
      stale: false,
      elapsedMs: null,
    });
    if (previous) void release(previous.handle);
  }
  return {
    getSnapshot: () => state,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select: () => load(true),
    reload: () => load(false),
    clear,
  };
}
