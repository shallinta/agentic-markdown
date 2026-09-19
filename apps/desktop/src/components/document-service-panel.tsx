import { useEffect, useState, useSyncExternalStore } from "react";

import {
  createDocumentController,
  type DocumentTransport,
} from "@/client/documents";
import { electrobun } from "@/lib/electrobun";

export function DocumentServicePanel() {
  const [controller] = useState(() => {
    const rpc = electrobun.rpc;
    const unavailable = () => Promise.reject(new Error("RPC unavailable"));
    const transport: DocumentTransport = {
      selectDocument: (request) =>
        rpc ? rpc.request.selectDocument(request) : unavailable(),
      readDocument: (request) =>
        rpc ? rpc.request.readDocument(request) : unavailable(),
      releaseDocument: (request) =>
        rpc ? rpc.request.releaseDocument(request) : unavailable(),
    };
    return createDocumentController(transport);
  });
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot
  );
  useEffect(() => () => controller.clear(), [controller]);
  const snapshot = state.snapshot;
  const buttonClass =
    "rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50";

  return (
    <section
      className="flex size-full min-w-0 flex-col gap-3 px-6 pt-16 pb-6"
      aria-label="文档服务验证"
    >
      <div>
        <h1 className="text-xl font-semibold">文档服务验证</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          F-003a · 仅只读原文，不是正式阅读或编辑模式 · 本轮限 1 MiB
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className={buttonClass}
          disabled={state.busy}
          onClick={() => void controller.select()}
        >
          选择 Markdown 文件
        </button>
        <button
          className={buttonClass}
          disabled={state.busy || !snapshot}
          onClick={() => void controller.reload()}
        >
          重新读取
        </button>
        <button
          className={buttonClass}
          disabled={!snapshot && !state.busy}
          onClick={controller.clear}
        >
          清空
        </button>
      </div>
      <div
        className="text-muted-foreground text-sm"
        role="status"
        aria-live="polite"
      >
        {state.busy
          ? "正在等待文件选择或读取…"
          : snapshot
            ? `已读取 ${snapshot.byteLength.toLocaleString()} 字节 · 最近一次请求 ${state.elapsedMs?.toFixed(1) ?? "—"} ms`
            : "请选择本地 .md 或 .markdown 文件。"}
      </div>
      {state.error && (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      )}
      {state.stale && (
        <p className="text-sm">
          以下为上次成功读取的旧快照，不代表当前磁盘内容。
        </p>
      )}
      {snapshot && (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm break-all">
            <dt>文件</dt>
            <dd>{snapshot.fileName}</dd>
            <dt>documentId</dt>
            <dd className="font-mono">{snapshot.documentId}</dd>
            <dt>revision</dt>
            <dd>{snapshot.revision}</dd>
          </dl>
          <pre
            aria-label="Markdown 原文（只读）"
            className="bg-muted/40 min-h-0 flex-1 overflow-auto rounded-md border p-4 font-mono text-sm break-words whitespace-pre-wrap"
          >
            {snapshot.text}
          </pre>
        </>
      )}
    </section>
  );
}
