import { useEffect, useState, useSyncExternalStore } from "react";

import {
  createDocumentController,
  type DocumentTransport,
} from "@/client/documents";
import { useCommands, useRegisterCommands } from "@/commands";
import { electrobun } from "@/lib/electrobun";
import { PRODUCT_COMMANDS } from "@/shared/commands";

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
  const { executeCommand, isCommandEnabled } = useCommands();
  const notifyCommands = useRegisterCommands(
    {
      selectDocument: controller.select,
      reloadDocument: controller.reload,
      clearDocument: controller.clear,
    },
    true,
    {
      selectDocument: () => !controller.getSnapshot().busy,
      reloadDocument: () =>
        !controller.getSnapshot().busy && !!controller.getSnapshot().snapshot,
      clearDocument: () =>
        controller.getSnapshot().busy || !!controller.getSnapshot().snapshot,
    }
  );
  useEffect(
    () => controller.subscribe(notifyCommands),
    [controller, notifyCommands]
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
          F-004a · 单文件路径与只读授权验证 · 本轮限 1 MiB
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className={buttonClass}
          disabled={!isCommandEnabled("selectDocument")}
          onClick={() => executeCommand({ type: "selectDocument", args: {} })}
        >
          {PRODUCT_COMMANDS.selectDocument?.label}
        </button>
        <button
          className={buttonClass}
          disabled={!isCommandEnabled("reloadDocument")}
          onClick={() => executeCommand({ type: "reloadDocument", args: {} })}
        >
          {PRODUCT_COMMANDS.reloadDocument?.label}
        </button>
        <button
          className={buttonClass}
          disabled={!isCommandEnabled("clearDocument")}
          onClick={() => executeCommand({ type: "clearDocument", args: {} })}
        >
          {PRODUCT_COMMANDS.clearDocument?.label}
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
            <dt>权限</dt>
            <dd>仅当前文件只读，不授权父目录或相邻文件</dd>
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
