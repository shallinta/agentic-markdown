import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@agentic-markdown/ui/ui/dialog";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import CurrentCanonicalWorker from "@/client/current-canonical.worker?worker&inline";
import { discardGuard } from "@/client/discard-guard";
import {
  canonicalDiscardParticipant,
  createDocumentCanonical,
} from "@/client/document-canonical";
import {
  documentCapabilitySuffix,
  documentStatusLabel,
} from "@/client/document-status-label";
import {
  createDocumentController,
  type DocumentTransport,
} from "@/client/documents";
import { isExternalTextTarget } from "@/client/history-target";
import { longLineProtection } from "@/client/long-line-protection";
import { rawText } from "@/client/raw-buffer";
import { createReadingThemeSelection } from "@/client/reading-theme";
import { routeSourceModeShortcut } from "@/client/source-mode-shortcut";
import { useCommands, useRegisterCommands } from "@/commands";
import { electrobun } from "@/lib/electrobun";
import { PRODUCT_COMMANDS } from "@/shared/commands";
import type { LocalImageRequest } from "@/shared/local-images";
import { analyzeTextFidelity } from "@/shared/text-fidelity";

import { MemoryEditor } from "./memory-editor";
import { ReadingView } from "./reading-view";
import { TextFidelityDetails } from "./text-fidelity-details";

const readLocalImage = (request: LocalImageRequest): Promise<unknown> =>
  electrobun.rpc
    ? electrobun.rpc.request.readLocalImage(request, { maxRequestTime: 12000 })
    : Promise.reject(new Error("RPC unavailable"));

export function useDocumentWorkspace() {
  const [controller] = useState(() => {
    const rpc = electrobun.rpc;
    const unavailable = () => Promise.reject(new Error("RPC unavailable"));
    const transport: DocumentTransport = {
      checkDocumentWriteCapability: (request) =>
        rpc
          ? rpc.request.checkDocumentWriteCapability(request, {
              maxRequestTime: 4000,
            })
          : unavailable(),
      cancelDocument: (request) =>
        rpc ? rpc.request.cancelDocument(request) : unavailable(),
      selectDocument: (request) =>
        rpc ? rpc.request.selectDocument(request) : unavailable(),
      readDocument: (request) =>
        rpc ? rpc.request.readDocument(request) : unavailable(),
      saveDocument: (request) =>
        rpc ? rpc.request.saveDocument(request) : unavailable(),
      waitForDocumentSaves: (request) =>
        rpc ? rpc.request.waitForDocumentSaves(request) : unavailable(),
      releaseDocument: (request) =>
        rpc ? rpc.request.releaseDocument(request) : unavailable(),
    };
    return createDocumentController(transport, discardGuard.ask);
  });
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot
  );
  const [canonical] = useState(() =>
    createDocumentCanonical(controller, () => new CurrentCanonicalWorker())
  );
  const [readingThemes] = useState(() =>
    createReadingThemeSelection(
      controller.captureCurrentViewport,
      controller.canChangeReadingTheme
    )
  );
  const readingTheme = useSyncExternalStore(
    readingThemes.subscribe,
    readingThemes.getSnapshot
  );
  const chooseReadingTheme = (id: string) => {
    const error = readingThemes.select(id);
    if (error) toast.error(error);
  };
  useEffect(() => {
    const unsubscribe = controller.subscribe(canonical.invalidate);
    return () => {
      unsubscribe();
      canonical.cancel();
    };
  }, [controller, canonical]);
  const { executeCommand, isCommandEnabled } = useCommands();
  const notifyCommands = useRegisterCommands(
    {
      readingThemePaper: () => chooseReadingTheme("paper"),
      readingThemeInk: () => chooseReadingTheme("ink"),
      toggleReadingMode: () => {
        controller.toggleReadingMode();
      },
      toggleSourceMode: () => {
        controller.toggleSourceMode();
      },
      selectDocument: controller.select,
      reloadDocument: controller.reload,
      saveDocument: controller.save,
      clearDocument: controller.clear,
      closeDocument: controller.closeActive,
      undoDocument: ({ documentId }) => {
        if (documentId || !isExternalTextTarget(document.activeElement))
          controller.runHistory("undo", documentId);
      },
      redoDocument: ({ documentId }) => {
        if (documentId || !isExternalTextTarget(document.activeElement))
          controller.runHistory("redo", documentId);
      },
    },
    true,
    {
      readingThemePaper: controller.canChangeReadingTheme,
      readingThemeInk: controller.canChangeReadingTheme,
      toggleReadingMode: controller.canToggleReadingMode,
      toggleSourceMode: () =>
        controller.canToggleSourceMode() &&
        !isExternalTextTarget(document.activeElement) &&
        !document.querySelector('[role="dialog"], [role="alertdialog"]'),
      selectDocument: () =>
        !controller.getSnapshot().busy &&
        !controller.getSnapshot().frozen &&
        !controller.hasSaves(),
      saveDocument: controller.canSave,
      undoDocument: controller.canUndo,
      redoDocument: controller.canRedo,
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
  useEffect(
    () =>
      discardGuard.register(canonicalDiscardParticipant(controller, canonical)),
    [controller, canonical]
  );
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) =>
      routeSourceModeShortcut(
        event,
        document.activeElement,
        !!document.querySelector('[role="dialog"], [role="alertdialog"]'),
        isCommandEnabled("toggleSourceMode"),
        executeCommand
      );
    window.addEventListener("keydown", shortcut, true);
    return () => window.removeEventListener("keydown", shortcut, true);
  }, [executeCommand, isCommandEnabled]);
  useEffect(() => {
    const refresh = () => {
      void controller.refreshWriteCapability();
    };
    const changed = (value: unknown) => {
      if (
        value &&
        typeof value === "object" &&
        Object.keys(value).length === 1 &&
        "handle" in value &&
        typeof value.handle === "string"
      )
        void controller.refreshWriteCapability(value.handle, true);
    };
    electrobun.rpc?.addMessageListener("documentCapabilityChanged", changed);
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 3000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      electrobun.rpc?.removeMessageListener(
        "documentCapabilityChanged",
        changed
      );
    };
  }, [controller]);
  useEffect(() => {
    void controller.refreshWriteCapability();
  }, [controller, state.snapshot?.handle]);
  useEffect(() => () => controller.dispose(), [controller]);
  return {
    controller,
    state,
    canonical,
    readingTheme,
    executeCommand,
    isCommandEnabled,
  };
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
                {documentCapabilitySuffix(entry.writeCapability)}
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
  const canonicalState = useSyncExternalStore(
    workspace.canonical.subscribe,
    workspace.canonical.getSnapshot
  );
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
              {documentCapabilitySuffix(tab.writeCapability)}
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
            ? controller.isSafeSource(snapshot.documentId)
              ? "安全源码 · 解析与排版已停用 · 手动保存 ⌘S · 单文件限 1 MiB"
              : controller.getMode(snapshot.documentId) === "source"
                ? "基础源码模式 · 完整原文与基础高亮 · 手动保存 ⌘S · 单文件限 1 MiB"
                : controller.getMode(snapshot.documentId) === "reading"
                  ? "阅读模式 · 只读当前内存正文 · 本地静态 PNG/JPEG · 远程图片默认不加载"
                  : "基础编辑模式 · 标题、粗体、斜体与行内代码 · 手动保存 ⌘S · 单文件限 1 MiB"
            : "打开本地 Markdown 文件，开始查看。文件只会加入当前窗口，不会加入其父目录。"}
        </p>
      </div>
      {editor &&
        snapshot &&
        !controller.isSafeSource(snapshot.documentId) &&
        editor.state.field(longLineProtection).length > 0 && (
          <p role="status" className="text-muted-foreground text-sm">
            {controller.getMode(snapshot.documentId) === "source"
              ? "部分超长行已暂停语法着色；缩短后恢复，自动折行、原文与保存不变。"
              : "部分超长行已简化行内排版，代码与引用结构保留；缩短后恢复，软换行与保存不变。"}
          </p>
        )}
      {snapshot && controller.getEditorFault(snapshot.documentId)?.fault && (
        <p role="status">
          {controller.getEditorFault(snapshot.documentId)?.recoveryFailed
            ? "安全源码恢复失败，内存状态已保留；请勿关闭文档。"
            : controller.isSafeSource(snapshot.documentId)
              ? "编辑呈现发生异常，已切换为安全源码；内存内容已保留。关闭后重新打开才会重新尝试。"
              : "编辑呈现发生异常，正在等待当前输入或操作结束后切换安全源码。"}
        </p>
      )}
      {(
        globalThis as typeof globalThis & {
          __AGENTIC_MARKDOWN_EDITOR_FAULT_LAB__?: boolean;
        }
      ).__AGENTIC_MARKDOWN_EDITOR_FAULT_LAB__ === true && (
        <div className="flex flex-wrap gap-2" aria-label="编辑故障实验">
          <button
            className={buttonClass}
            disabled={!snapshot || state.busy || state.frozen}
            onClick={() => void workspace.canonical.request()}
          >
            实验：解析当前文档
          </button>
          <button
            className={buttonClass}
            disabled={canonicalState.status !== "running"}
            onClick={workspace.canonical.cancel}
          >
            取消当前解析
          </button>
          <p role="status">
            规范解析：
            {canonicalState.status === "ready"
              ? `完成 · revision ${canonicalState.result.revision} · ${canonicalState.result.tree.children.length} 个顶层块 · ${canonicalState.result.milliseconds.toFixed(2)} ms（仅 Worker 内解析）`
              : canonicalState.status === "running"
                ? "进行中"
                : canonicalState.status === "failed"
                  ? "失败，原文未改变"
                  : "尚无当前结果"}
          </p>
          <button
            className={buttonClass}
            disabled={
              !controller.canToggleSourceMode() ||
              (!!snapshot &&
                controller.getMode(snapshot.documentId) !== "editing")
            }
            onClick={() => controller.injectEditorFault("presentation")}
          >
            实验：呈现故障
          </button>
          <button
            className={buttonClass}
            disabled={!controller.canToggleSourceMode()}
            onClick={() => controller.injectEditorFault("parser")}
          >
            实验：解析故障
          </button>
        </div>
      )}
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
        <button
          className={buttonClass}
          disabled={!isCommandEnabled("saveDocument")}
          onClick={() => executeCommand({ type: "saveDocument", args: {} })}
        >
          保存当前文档
        </button>
      </div>
      {snapshot && (
        <p role="status" aria-live="polite" className="text-sm">
          {documentStatusLabel(
            controller.getMode(snapshot.documentId),
            snapshot.writeCapability
          )}
          {
            {
              saving: "保存中…",
              saved: "已保存（与读取/保存基线一致）",
              dirty: "未保存",
              failed: "保存失败",
              uncertain: "保存结果未确认",
            }[controller.getSaveStatus(snapshot.documentId).status]
          }
          {controller.getSaveStatus(snapshot.documentId).message
            ? ` · ${controller.getSaveStatus(snapshot.documentId).message}`
            : ""}
        </p>
      )}
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
              <dt>最近保存传输</dt>
              <dd>
                {controller.getSaveTransfer(snapshot.documentId)
                  ? `${controller.getSaveTransfer(snapshot.documentId)!.mode === "patch" ? "增量" : "权威全文重同步"} · JSON 应用载荷 ${controller.getSaveTransfer(snapshot.documentId)!.payloadBytes} 字节（不含底层协议开销）`
                  : "尚未保存"}
              </dd>
              <dt>权限</dt>
              <dd>仅当前已授权文档可读取/手动保存，不授权任意路径或相邻文件</dd>
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
          <div className="relative flex min-h-0 flex-1 flex-col">
            {controller.getMode(snapshot.documentId) !== "source" &&
              !controller.isSafeSource(snapshot.documentId) && (
                <button
                  className="bg-background/60 absolute top-2 right-3 z-10 rounded border p-2 opacity-50 backdrop-blur hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 disabled:opacity-30"
                  title={
                    controller.getMode(snapshot.documentId) === "reading"
                      ? "切换为编辑模式"
                      : "切换为阅读模式"
                  }
                  aria-label={
                    controller.getMode(snapshot.documentId) === "reading"
                      ? "切换为编辑模式"
                      : "切换为阅读模式"
                  }
                  disabled={!isCommandEnabled("toggleReadingMode")}
                  onClick={() =>
                    executeCommand({ type: "toggleReadingMode", args: {} })
                  }
                >
                  <span aria-hidden="true">
                    {controller.getMode(snapshot.documentId) === "reading"
                      ? "✎"
                      : "▤"}
                  </span>
                </button>
              )}
            {controller.getMode(snapshot.documentId) === "reading" ? (
              <ReadingView
                readLocalImage={readLocalImage}
                theme={workspace.readingTheme}
                controller={controller}
                canonical={workspace.canonical}
                documentId={snapshot.documentId}
                frozen={state.frozen || state.busy}
              />
            ) : (
              <MemoryEditor
                controller={controller}
                documentId={snapshot.documentId}
                frozen={state.frozen || state.busy}
              />
            )}
          </div>
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
