import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";

import { discardGuard } from "@/client/discard-guard";
import { createDocumentController } from "@/client/documents";
import { canMoveRealRegionDocument, moveRealRegionDocument, projectRealRegionDocuments } from "@/client/real-document-region-lab";
import { CommandProvider, useCommands, useRegisterCommands } from "@/commands";
import { electrobun } from "@/lib/electrobun";
import { createNativeDocumentTransport } from "@/lib/native-document-transport";

import { DocumentDiscardDialog } from "./document-discard-dialog";
import { MainSideLayout } from "./main-side-layout";
import { MemoryEditor } from "./memory-editor";

const buttonClass = "electrobun-webkit-app-region-no-drag rounded border px-2 py-1 focus-visible:outline-2 disabled:opacity-50";
const saveLabel = { saving: "保存中…", saved: "已保存", dirty: "未保存", failed: "保存失败", uncertain: "保存结果未确认" };

export function RealDocumentRegionLab() {
  return <CommandProvider><RealDocumentRegionViews /></CommandProvider>;
}

function RealDocumentRegionViews() {
  const [controller] = useState(() => createDocumentController(createNativeDocumentTransport(), discardGuard.ask,
    undefined, undefined, { activeDocumentInputOnly: true }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [secondaryId, setSecondaryId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ documentId: string }>();
  const [receipt, setReceipt] = useState("");
  const activeId = state.snapshot?.documentId;
  const projection = projectRealRegionDocuments(state.tabs, activeId, secondaryId);
  const { executeCommand, isCommandEnabled } = useCommands();
  const canSelect = () => {
    const current = controller.getSnapshot();
    return current.tabs.length < 2 && controller.canSelectFolder() && !controller.hasSaves();
  };
  const notifyCommands = useRegisterCommands({
    selectDocument: controller.select,
    saveDocument: controller.save,
    closeDocument: controller.closeActive,
    undoDocument: ({ documentId }) => { controller.runHistory("undo", documentId); },
    redoDocument: ({ documentId }) => { controller.runHistory("redo", documentId); },
  }, true, {
    selectDocument: canSelect,
    saveDocument: controller.canSave,
    closeDocument: () => !controller.getSnapshot().frozen && !!controller.getSnapshot().snapshot,
    undoDocument: controller.canUndo,
    redoDocument: controller.canRedo,
  });

  useEffect(() => controller.subscribe(notifyCommands), [controller, notifyCommands]);
  useEffect(() => {
    const rpc = electrobun.rpc;
    rpc?.addMessageListener("executeCommand", executeCommand);
    return () => rpc?.removeMessageListener("executeCommand", executeCommand);
  }, [executeCommand]);
  useEffect(() => {
    const unregister = discardGuard.register({
      beginDiscard: controller.beginWindowDiscard,
      endDiscard: controller.endDiscard,
      hasDirty: controller.hasDiscardable,
      waitForSaves: controller.waitForSaves,
      reportDiscardFailure: controller.reportDiscardFailure,
    });
    const rpc = electrobun.rpc;
    const changed = (value: unknown) => {
      if (value && typeof value === "object" && Object.keys(value).length === 1 &&
          "handle" in value && typeof value.handle === "string")
        void controller.refreshWriteCapability(value.handle, true);
    };
    const refresh = () => {
      void controller.refreshWriteCapability();
      controller.refreshExternalObservations();
    };
    rpc?.addMessageListener("documentCapabilityChanged", changed);
    rpc?.addMessageListener("documentExternalChanged", controller.applyExternalObservation);
    window.addEventListener("focus", refresh);
    const timer = setInterval(() => void controller.refreshWriteCapability(), 3000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      rpc?.removeMessageListener("documentCapabilityChanged", changed);
      rpc?.removeMessageListener("documentExternalChanged", controller.applyExternalObservation);
      unregister();
      controller.dispose();
    };
  }, [controller]);
  useEffect(() => { void controller.refreshWriteCapability(); }, [controller, state.snapshot?.handle]);

  useLayoutEffect(() => {
    if (secondaryId && projection.secondaryId === null) setSecondaryId(null);
  }, [projection.secondaryId, secondaryId]);
  useLayoutEffect(() => {
    if (!focusRequest) return;
    if (controller.getSnapshot().snapshot?.documentId === focusRequest.documentId)
      controller.focusQuickDocument(focusRequest.documentId);
    setFocusRequest(undefined);
  }, [controller, focusRequest]);

  function activate(documentId: string) {
    if (!controller.canSelectFolder() || controller.isEditorInputBlocked()) {
      setReceipt("暂未切换文档，请完成当前操作后重试。");
      return;
    }
    controller.activateTab(documentId);
    if (controller.getSnapshot().snapshot?.documentId !== documentId) {
      setReceipt("暂未切换文档，请完成当前操作后重试。");
      return;
    }
    setReceipt("");
    setFocusRequest({ documentId });
  }

  function move(target: "main" | "secondary") {
    const document = controller.getSnapshot().snapshot;
    const result = moveRealRegionDocument(controller, secondaryId, target);
    if (!document || !result.ok) {
      setReceipt("暂未移区，请完成当前操作后重试。");
      return;
    }
    setSecondaryId(result.secondaryId);
    setReceipt(`已将 ${document.fileName} 移${target === "main" ? "回主区" : "入副区"}`);
    setFocusRequest({ documentId: document.documentId });
  }

  const editor = (documentId: string) => (
    <MemoryEditor key={documentId} controller={controller} documentId={documentId}
      frozen={state.frozen || state.busy} passive={activeId !== documentId}
      autoFocusOnMount={false} preserveViewportOnSync />
  );
  const activeStatus = activeId ? controller.getSaveStatus(activeId) : null;
  return (
    <main className="bg-background text-foreground flex h-screen flex-col" aria-label="真实文件移区实验">
      <div aria-hidden="true" className="electrobun-webkit-app-region-drag h-12 shrink-0 select-none" />
      <section className="space-y-2 px-4 pb-3 text-sm">
        <h1 className="text-lg font-semibold">真实文件移区实验</h1>
        <p>请只选择测试文件。保存会写入磁盘，本实验最多打开两篇 Markdown。</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={!isCommandEnabled("selectDocument")}
            onClick={() => executeCommand({ type: "selectDocument", args: {} })}>打开 Markdown 文件</button>
          <button type="button" className={buttonClass} disabled={!isCommandEnabled("saveDocument")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => executeCommand({ type: "saveDocument", args: {} })}>保存活动文档</button>
          <button type="button" className={buttonClass} disabled={!isCommandEnabled("closeDocument")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => executeCommand({ type: "closeDocument", args: {} })}>关闭活动文档</button>
          <button type="button" className={buttonClass} disabled={!canMoveRealRegionDocument(controller, secondaryId, "secondary")}
            onMouseDown={(event) => event.preventDefault()} onClick={() => move("secondary")}>将活动文档移入副区</button>
          <button type="button" className={buttonClass} disabled={!canMoveRealRegionDocument(controller, secondaryId, "main")}
            onMouseDown={(event) => event.preventDefault()} onClick={() => move("main")}>将活动文档移回主区</button>
        </div>
        <p role="status">{state.busy ? "正在等待文件选择或读取…" :
          `活动文档 ${state.snapshot?.fileName ?? "无"}${activeStatus ? ` · ${saveLabel[activeStatus.status]}` : ""}`}</p>
        {receipt && <p role="status">{receipt}</p>}
        {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
        {activeStatus?.message && <p role="status">{activeStatus.message}</p>}
        {activeId && controller.externalMessage(activeId) && <p role="status">{controller.externalMessage(activeId)}</p>}
      </section>
      <div className="min-h-0 grow overflow-x-auto border-t">
        <MainSideLayout sideVisible={!!projection.secondary} main={
          <section aria-label="实验主区" className="flex size-full min-w-0 flex-col gap-2 p-3">
            <h2 className="font-medium">主区</h2>
            <nav aria-label="实验主区标签" className="flex flex-wrap gap-1">
              {projection.main.map((document) => (
                <button key={document.documentId} type="button" className={buttonClass}
                  aria-pressed={activeId === document.documentId}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => activate(document.documentId)}>{document.fileName}{controller.isDirty(document.documentId) ? " · 未保存" : ""}</button>
              ))}
            </nav>
            {projection.mainCurrent ? editor(projection.mainCurrent.documentId) : <p>主区暂无文档</p>}
          </section>
        } side={projection.secondary && (
          <section aria-label="实验副区" className="flex size-full min-w-0 flex-col gap-2 p-3">
            <h2 className="font-medium">副区</h2>
            <button type="button" className={buttonClass} aria-pressed={activeId === projection.secondary.documentId}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { if (projection.secondary) activate(projection.secondary.documentId); }}>
              激活副区 {projection.secondary.fileName}{controller.isDirty(projection.secondary.documentId) ? " · 未保存" : ""}
            </button>
            {editor(projection.secondary.documentId)}
          </section>
        )} />
      </div>
      <DocumentDiscardDialog buttonClass={buttonClass} />
    </main>
  );
}
