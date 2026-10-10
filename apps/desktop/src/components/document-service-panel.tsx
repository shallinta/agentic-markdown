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
import { runInlineFormat } from "@/client/inline-format-input";
import { longLineProtection } from "@/client/long-line-protection";
import { rawText } from "@/client/raw-buffer";
import { createReadingThemeSelection } from "@/client/reading-theme";
import { routeSourceModeShortcut } from "@/client/source-mode-shortcut";
import { createFolderWorkspace } from "@/client/workspace";
import { useCommands, useRegisterCommands } from "@/commands";
import { useSourceWrapping } from "@/hooks/use-source-wrapping";
import { electrobun } from "@/lib/electrobun";
import { PRODUCT_COMMANDS } from "@/shared/commands";
import type { LocalImageRequest } from "@/shared/local-images";
import { analyzeTextFidelity } from "@/shared/text-fidelity";

import { FocusTraceLab } from "./focus-trace-lab";
import { MemoryEditor } from "./memory-editor";
import { ReadingView } from "./reading-view";
import { TextFidelityDetails } from "./text-fidelity-details";
import { WorkspaceTree } from "./workspace-tree";

const readLocalImage = (request: LocalImageRequest): Promise<unknown> =>
  electrobun.rpc
    ? electrobun.rpc.request.readLocalImage(request, { maxRequestTime: 12000 })
    : Promise.reject(new Error("RPC unavailable"));

export function useDocumentWorkspace(beforeDiscard?: () => Promise<void>) {
  const [controller] = useState(() => {
    const rpc = electrobun.rpc;
    const unavailable = () => Promise.reject(new Error("RPC unavailable"));
    const transport: DocumentTransport = {
      observeDocument: (request) =>
        rpc
          ? rpc.request.observeDocument(request, { maxRequestTime: 4000 })
          : unavailable(),
      openWorkspaceDocument: (request) =>
        rpc ? rpc.request.openWorkspaceDocument(request) : unavailable(),
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
  const [folders] = useState(() =>
    createFolderWorkspace((request) => {
      if (!electrobun.rpc) return Promise.reject(new Error("RPC unavailable"));
      return electrobun.rpc.request.workspaceRequest(request);
    })
  );
  const folderState = useSyncExternalStore(
    folders.subscribe,
    folders.getSnapshot
  );
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await folders.refresh();
      } catch {
        /* State exposes the fixed error. */
      }
      if (!stopped) timer = setTimeout(poll, 350);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [folders]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot
  );
  const wrapping = useSourceWrapping();
  useEffect(() => {
    controller.setSourceWrapping(wrapping.enabled);
  }, [
    controller,
    wrapping.enabled,
    state.busy,
    state.frozen,
    state.snapshot?.documentId,
  ]);
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
      selectFolder: () => controller.runWorkspaceAction(folders.select),
      setRootHidden: ({ root, showHidden }) =>
        controller.runWorkspaceAction(() =>
          folders.setHidden(root, showHidden)
        ),
      reloadDocument: controller.reload,
      saveDocument: controller.save,
      clearDocument: () => controller.clear(folders.clear),
      closeDocument: controller.closeActive,
      undoDocument: ({ documentId }) => {
        if (documentId || !isExternalTextTarget(document.activeElement))
          controller.runHistory("undo", documentId);
      },
      redoDocument: ({ documentId }) => {
        if (documentId || !isExternalTextTarget(document.activeElement))
          controller.runHistory("redo", documentId);
      },
      addSourceCursorAbove: ({ documentId }) => {
        controller.runSourceSelection("above", documentId);
      },
      addSourceCursorBelow: ({ documentId }) => {
        controller.runSourceSelection("below", documentId);
      },
      simplifySourceSelection: ({ documentId }) => {
        controller.runSourceSelection("simplify", documentId);
      },
      continueList: ({ documentId }) => {
        controller.runListInput(false, documentId);
      },
      listSoftBreak: ({ documentId }) => {
        controller.runListInput(true, documentId);
      },
      formatBold: ({ documentId, token }) => {
        runInlineFormat("formatBold", documentId, token);
      },
      formatItalic: ({ documentId, token }) => {
        runInlineFormat("formatItalic", documentId, token);
      },
      formatCode: ({ documentId, token }) => {
        runInlineFormat("formatCode", documentId, token);
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
      selectFolder: () =>
        controller.canSelectFolder() && !folders.getSnapshot().busy,
      setRootHidden: () =>
        controller.canSelectFolder() && !folders.getSnapshot().busy,
      saveDocument: controller.canSave,
      undoDocument: controller.canUndo,
      redoDocument: controller.canRedo,
      addSourceCursorAbove: controller.canRunSourceSelection,
      addSourceCursorBelow: controller.canRunSourceSelection,
      simplifySourceSelection: controller.canRunSourceSelection,
      continueList: controller.canRunListInput,
      listSoftBreak: controller.canRunListInput,
      reloadDocument: () =>
        !controller.getSnapshot().busy &&
        !controller.getSnapshot().frozen &&
        !!controller.getSnapshot().snapshot,
      clearDocument: () =>
        !controller.getSnapshot().frozen &&
        (controller.getSnapshot().busy ||
          controller.getSnapshot().entries.length > 0 ||
          folders.getSnapshot().roots.length > 0),
      closeDocument: () =>
        !controller.getSnapshot().frozen && !!controller.getSnapshot().snapshot,
    }
  );
  useEffect(
    () => controller.subscribe(notifyCommands),
    [controller, notifyCommands]
  );
  useEffect(() => folders.subscribe(notifyCommands), [folders, notifyCommands]);
  useEffect(
    () =>
      discardGuard.register(
        canonicalDiscardParticipant(
          controller,
          canonical,
          beforeDiscard,
          controller.hasDiscardable
        )
      ),
    [controller, canonical, beforeDiscard]
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
      controller.refreshExternalObservations();
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
    electrobun.rpc?.addMessageListener(
      "documentExternalChanged",
      controller.applyExternalObservation
    );
    window.addEventListener("focus", refresh);
    const timer = setInterval(() => {
      void controller.refreshWriteCapability();
    }, 3000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      electrobun.rpc?.removeMessageListener(
        "documentExternalChanged",
        controller.applyExternalObservation
      );
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
    folders,
    folderState,
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
      aria-label="工作区文件树"
      className="flex size-full min-w-0 flex-col gap-3 px-3 pt-16 pb-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">工作区</h2>
        <button
          className="hover:bg-muted rounded border px-2 py-1 text-xs disabled:opacity-50"
          disabled={!isCommandEnabled("selectFolder")}
          onClick={() => executeCommand({ type: "selectFolder", args: {} })}
        >
          加入文件夹
        </button>
        <button
          className="hover:bg-muted rounded border px-2 py-1 text-xs disabled:opacity-50"
          disabled={!isCommandEnabled("selectDocument")}
          onClick={() => executeCommand({ type: "selectDocument", args: {} })}
        >
          打开文件
        </button>
      </div>
      <WorkspaceTree
        setHidden={(root, showHidden) =>
          executeCommand({ type: "setRootHidden", args: { root, showHidden } })
        }
        folders={workspace.folders}
        state={workspace.folderState}
        entries={state.entries}
        activeHandle={state.snapshot?.handle}
        openStandalone={(entry) => {
          void controller.activate(entry);
        }}
        disabled={!controller.canSelectFolder()}
        standaloneDisabled={state.frozen}
        runAction={controller.runWorkspaceAction}
        runRescan={controller.runMetadataRescan}
        open={(root, node) => {
          const existing = state.entries.find(
            (entry) => entry.displayPath === node.displayPath
          );
          if (existing) void controller.activate(existing);
          else void controller.openWorkspaceEntry(root, node.handle);
        }}
      />
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
          {snapshot?.fileName ??
            (workspace.folderState.roots.length
              ? "文件夹工作区"
              : "欢迎使用 Agentic Markdown")}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {snapshot
            ? controller.isSafeSource(snapshot.documentId)
              ? "安全源码 · 解析与排版已停用 · 文内查找暂不可用 · 手动保存 ⌘S · 单文件限 1 MiB"
              : controller.getMode(snapshot.documentId) === "source"
                ? "基础源码模式 · 完整原文与基础高亮 · 手动保存 ⌘S · 单文件限 1 MiB"
                : controller.getMode(snapshot.documentId) === "reading"
                  ? "阅读模式 · 只读当前内存正文 · 本地静态 PNG/JPEG · 远程图片默认不加载"
                  : "基础编辑模式 · 标题、粗体、斜体与行内代码 · 手动保存 ⌘S · 单文件限 1 MiB"
            : "打开本地 Markdown 文件或加入文件夹。侧栏单击选择，双击或按 Enter 打开文档。"}
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
          <FocusTraceLab />
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
          disabled={!isCommandEnabled("selectFolder")}
          onClick={() => executeCommand({ type: "selectFolder", args: {} })}
        >
          加入文件夹
        </button>
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
      {snapshot && controller.externalMessage(snapshot.documentId) && (
        <p role="status" className="text-muted-foreground text-sm">
          {controller.externalMessage(snapshot.documentId)}
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
                assetEpoch={
                  workspace.folderState.assetEpochs?.[snapshot.handle]
                }
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
