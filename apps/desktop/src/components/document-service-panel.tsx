import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@agentic-markdown/ui/ui/dialog";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { discardGuard } from "@/client/discard-guard";
import {
  createDocumentController,
  type DocumentTransport,
} from "@/client/documents";
import { rawText } from "@/client/raw-buffer";
import { useCommands, useRegisterCommands } from "@/commands";
import { electrobun } from "@/lib/electrobun";
import { PRODUCT_COMMANDS } from "@/shared/commands";
import { analyzeTextFidelity } from "@/shared/text-fidelity";

import { MemoryEditor } from "./memory-editor";
import { TextFidelityDetails } from "./text-fidelity-details";

export function useDocumentWorkspace() {
  const [controller] = useState(() => {
    const rpc = electrobun.rpc;
    const unavailable = () => Promise.reject(new Error("RPC unavailable"));
    const transport: DocumentTransport = {
      cancelDocument: (request) =>
        rpc ? rpc.request.cancelDocument(request) : unavailable(),
      selectDocument: (request) =>
        rpc ? rpc.request.selectDocument(request) : unavailable(),
      readDocument: (request) =>
        rpc ? rpc.request.readDocument(request) : unavailable(),
      releaseDocument: (request) =>
        rpc ? rpc.request.releaseDocument(request) : unavailable(),
    };
    return createDocumentController(transport, discardGuard.ask);
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
      closeDocument: controller.closeActive,
    },
    true,
    {
      selectDocument: () =>
        !controller.getSnapshot().busy && !controller.getSnapshot().frozen,
      reloadDocument: () =>
        !controller.getSnapshot().busy &&
        !controller.getSnapshot().frozen &&
        !!controller.getSnapshot().snapshot,
      clearDocument: () =>
        !controller.getSnapshot().frozen &&
        (controller.getSnapshot().busy ||
          controller.getSnapshot().entries.length > 0),
      closeDocument: () =>
        !controller.getSnapshot().frozen && !!controller.getSnapshot().snapshot,
    }
  );
  useEffect(
    () => controller.subscribe(notifyCommands),
    [controller, notifyCommands]
  );
  useEffect(() => discardGuard.register(controller), [controller]);
  useEffect(() => () => controller.dispose(), [controller]);
  return { controller, state, executeCommand, isCommandEnabled };
}
type Workspace = ReturnType<typeof useDocumentWorkspace>;

export function StandaloneFileList({ workspace }: { workspace: Workspace }) {
  const { state, controller, executeCommand, isCommandEnabled } = workspace;
  return (
    <nav
      aria-label="独立 Markdown 文件"
      className="flex size-full min-w-0 flex-col gap-3 px-3 pt-16 pb-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">文件</h2>
        <button
          className="hover:bg-muted rounded border px-2 py-1 text-xs disabled:opacity-50"
          disabled={!isCommandEnabled("selectDocument")}
          onClick={() => executeCommand({ type: "selectDocument", args: {} })}
        >
          打开文件
        </button>
      </div>
      {state.entries.length === 0 ? (
        <p className="text-muted-foreground text-xs">打开的文件将在这里显示</p>
      ) : (
        <ul className="min-h-0 overflow-auto">
          {state.entries.map((entry) => (
            <li key={entry.locationId ?? entry.documentId}>
              <button
                disabled={state.frozen}
                title={entry.displayPath ?? entry.fileName}
                aria-current={
                  state.snapshot?.handle === entry.handle ? "page" : undefined
                }
                className="hover:bg-muted aria-[current=page]:bg-muted w-full truncate rounded px-2 py-2 text-left text-sm disabled:opacity-50"
                onClick={() => void controller.activate(entry)}
              >
                {entry.fileName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

export function DocumentServicePanel({ workspace }: { workspace: Workspace }) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const { state, controller, executeCommand, isCommandEnabled } = workspace;
  const snapshot = state.snapshot;
  const dialog = useSyncExternalStore(
    discardGuard.subscribe,
    discardGuard.getSnapshot
  );
  const editor = snapshot && controller.getEditor(snapshot.documentId);
  const buttonClass =
    "rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50";

  return (
    <section
      className="flex size-full min-w-0 flex-col gap-3 px-6 pt-16 pb-6"
      aria-label="文档工作区"
    >
      <nav
        aria-label="已打开的文档"
        className="flex shrink-0 gap-1 overflow-x-auto"
      >
        {state.tabs.map((tab) => (
          <div
            key={tab.documentId}
            className={`flex shrink-0 items-center rounded border ${snapshot?.documentId === tab.documentId ? "bg-muted" : ""}`}
          >
            <button
              disabled={state.frozen}
              aria-current={
                snapshot?.documentId === tab.documentId ? "page" : undefined
              }
              title={tab.displayPath ?? tab.fileName}
              className="max-w-48 truncate px-3 py-2 text-sm"
              onClick={() => controller.activateTab(tab.documentId)}
            >
              {tab.fileName}
              {controller.isDirty(tab.documentId) ? " ● 未保存" : ""}
            </button>
            <button
              disabled={state.frozen}
              aria-label={`关闭 ${tab.fileName}`}
              title={`关闭 ${tab.fileName}`}
              className="hover:bg-muted rounded px-2 py-2 text-sm"
              onClick={() => controller.closeTab(tab.documentId)}
            >
              ×
            </button>
          </div>
        ))}
      </nav>
      <div>
        <h1 className="text-xl font-semibold">
          {snapshot?.fileName ?? "欢迎使用 Agentic Markdown"}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {snapshot
            ? "原文编辑验证入口 · 当前编辑尚不支持保存 · 非正式编辑/源码模式 · 单文件限 1 MiB"
            : "打开本地 Markdown 文件，开始查看。文件只会加入当前窗口，不会加入其父目录。"}
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
          清空窗口
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
          <details
            className="text-muted-foreground text-sm"
            onToggle={(event) => setDiagnosticsOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer">
              文档诊断信息（磁盘快照与内存分别显示）
            </summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm break-all">
              <dt>文件</dt>
              <dd>{snapshot.fileName}</dd>
              <dt>documentId</dt>
              <dd className="font-mono">{snapshot.documentId}</dd>
              <dt>磁盘 revision</dt>
              <dd>{snapshot.revision}</dd>
              <dt>权限</dt>
              <dd>仅当前文件只读，不授权父目录或相邻文件</dd>
              <TextFidelityDetails fidelity={snapshot.fidelity} />
            </dl>
            {editor && diagnosticsOpen && (
              <>
                <p className="mt-3">
                  当前内存 · bufferRevision {editor.revision} ·{" "}
                  {controller.isDirty(snapshot.documentId)
                    ? "未保存"
                    : "与读取基线一致"}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3">
                  <TextFidelityDetails
                    fidelity={analyzeTextFidelity(editor.state.field(rawText))}
                  />
                </dl>
              </>
            )}
          </details>
          <MemoryEditor
            controller={controller}
            documentId={snapshot.documentId}
            frozen={state.frozen || state.busy}
          />
        </>
      )}
      <Dialog
        open={!!dialog}
        onOpenChange={(open) => {
          if (!open) discardGuard.respond(false);
        }}
      >
        <DialogContent
          showCloseButton={false}
          role="alertdialog"
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={() => {
            previousFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (previousFocus.current?.isConnected)
              previousFocus.current.focus();
          }}
        >
          <DialogTitle>确认放弃修改</DialogTitle>
          <DialogDescription>{dialog?.message}</DialogDescription>
          <div className="mt-2 flex justify-end gap-3">
            <button
              className={buttonClass}
              onClick={() => discardGuard.respond(false)}
            >
              继续编辑
            </button>
            <button
              className={buttonClass}
              onClick={() => discardGuard.respond(true)}
            >
              放弃变更
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
