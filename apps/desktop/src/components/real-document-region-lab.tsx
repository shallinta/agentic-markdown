import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";

import { discardGuard } from "@/client/discard-guard";
import { createDocumentController, type DocumentViewState } from "@/client/documents";
import { isExternalTextTarget } from "@/client/history-target";
import { moveRealRegionDocument, projectRealRegionDocuments, reorderRealRegionDocuments, type RealRegionAllocation } from "@/client/real-document-region-lab";
import { resizeSecondaryPaneDivider } from "@/client/secondary-pane-divider";
import { SECONDARY_MIN_HEIGHT } from "@/client/secondary-pane-height";
import { routeSourceModeShortcut } from "@/client/source-mode-shortcut";
import { CommandProvider, useCommands, useRegisterCommands } from "@/commands";
import { electrobun } from "@/lib/electrobun";
import { createNativeDocumentTransport } from "@/lib/native-document-transport";

import { DocumentDiscardDialog } from "./document-discard-dialog";
import { MainSideLayout } from "./main-side-layout";
import { MemoryEditor } from "./memory-editor";

const buttonClass = "electrobun-webkit-app-region-no-drag rounded border px-2 py-1 focus-visible:outline-2 disabled:opacity-50";
const saveLabel = { saving: "保存中…", saved: "已保存", dirty: "未保存", failed: "保存失败", uncertain: "保存结果未确认" };
const heightPresets = [65, 66, 320] as const;
const cssPixels = (value: number) => Math.round(value * 100) / 100;
const modalOpen = () => !!document.querySelector('[role="dialog"], [role="alertdialog"]');

interface DividerDrag {
  element: HTMLDivElement;
  pointerId: number;
  beforeIndex: number;
  startY: number;
  allocation: RealRegionAllocation;
  activeId: string | undefined;
}

interface TitleDrag {
  element: HTMLButtonElement;
  pointerId: number;
  sourceId: string;
  startX: number;
  startY: number;
  moved: boolean;
  allocation: RealRegionAllocation;
  state: DocumentViewState;
  bounds: DOMRect;
  focus: Element | null;
}

interface TitleInsertion {
  targetId: string;
  placement: "before" | "after";
}

function sameBounds(before: DOMRect, after: DOMRect) {
  return before.left === after.left && before.top === after.top &&
    before.width === after.width && before.height === after.height;
}

export function RealDocumentRegionLab() {
  return <CommandProvider><RealDocumentRegionViews /></CommandProvider>;
}

function RealDocumentRegionViews() {
  const [controller] = useState(() => createDocumentController(createNativeDocumentTransport(), discardGuard.ask,
    undefined, undefined, { activeDocumentInputOnly: true }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [allocation, setAllocation] = useState<RealRegionAllocation>({ ids: [], heights: [], totalHeight: 320 });
  const [preferredMainId, setPreferredMainId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ documentId: string }>();
  const [receipt, setReceipt] = useState("");
  const sideCanvas = useRef<HTMLOListElement>(null);
  const dividerLine = useRef<HTMLDivElement>(null);
  const dividerHit = useRef<HTMLDivElement>(null);
  const drag = useRef<DividerDrag | null>(null);
  const titleDrag = useRef<TitleDrag | null>(null);
  const suppressTitleClick = useRef<Pick<TitleDrag, "element" | "pointerId"> | null>(null);
  const [insertion, setInsertion] = useState<TitleInsertion>();
  const [reorderFocus, setReorderFocus] = useState<{
    allocation: RealRegionAllocation;
    element: HTMLElement;
    wasDivider: boolean;
  }>();
  const [measured, setMeasured] = useState<{
    allocation: RealRegionAllocation;
    height: number;
    width: number;
    rows: number[];
    divider?: { line: number; hit: number; above: number; below: number };
  }>();
  const activeId = state.snapshot?.documentId;
  const projection = projectRealRegionDocuments(state.tabs, activeId, allocation, preferredMainId);
  const liveAllocation = projection?.allocation;
  const liveSecondaryIds = liveAllocation?.ids;
  const mainCurrent = projection ? projection.mainCurrent : state.snapshot;
  const mainCurrentId = mainCurrent?.documentId ?? null;
  const moveIn = moveRealRegionDocument(controller, allocation, "secondary");
  const moveOut = moveRealRegionDocument(controller, allocation, "main");
  const { executeCommand, isCommandEnabled } = useCommands();
  const canSelect = () => {
    const current = controller.getSnapshot();
    return current.tabs.length < 3 && controller.canSelectFolder() && !controller.hasSaves();
  };
  const notifyCommands = useRegisterCommands({
    toggleSourceMode: () => { controller.toggleSourceMode(); },
    selectDocument: controller.select,
    saveDocument: controller.save,
    closeDocument: () => {
      const current = controller.getSnapshot().snapshot;
      if (current && liveSecondaryIds?.includes(current.documentId) && isDividerFocused())
        return closeSecondary(current.documentId, current.fileName, true);
      return controller.closeActive();
    },
    undoDocument: ({ documentId }) => { controller.runHistory("undo", documentId); },
    redoDocument: ({ documentId }) => { controller.runHistory("redo", documentId); },
  }, true, {
    toggleSourceMode: () => controller.canToggleSourceMode() &&
      !isExternalTextTarget(document.activeElement) && !modalOpen(),
    selectDocument: canSelect,
    saveDocument: controller.canSave,
    closeDocument: () => !controller.getSnapshot().frozen && !!controller.getSnapshot().snapshot,
    undoDocument: controller.canUndo,
    redoDocument: controller.canRedo,
  });

  useEffect(() => controller.subscribe(notifyCommands), [controller, notifyCommands]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => routeSourceModeShortcut(
      event, document.activeElement, modalOpen(), isCommandEnabled("toggleSourceMode"), executeCommand,
    );
    window.addEventListener("keydown", shortcut, true);
    return () => window.removeEventListener("keydown", shortcut, true);
  }, [executeCommand, isCommandEnabled]);
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

  const stopDrag = useCallback((event?: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || (event && (current.pointerId !== event.pointerId || current.element !== event.currentTarget))) return;
    drag.current = null;
    if (current.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
  }, []);
  useLayoutEffect(() => () => stopDrag(), [activeId, liveSecondaryIds, stopDrag]);

  const stopTitleDrag = useCallback((suppressClick = true) => {
    const current = titleDrag.current;
    if (!current) return;
    titleDrag.current = null;
    if (suppressClick) suppressTitleClick.current = { element: current.element, pointerId: current.pointerId };
    if (current.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
    setInsertion(undefined);
  }, []);
  useLayoutEffect(() => {
    const current = titleDrag.current;
    if (current && (current.state !== state || current.allocation !== liveAllocation)) stopTitleDrag();
  }, [state, liveAllocation, stopTitleDrag]);
  useEffect(() => {
    const cancel = () => stopTitleDrag();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !titleDrag.current?.moved) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      cancel();
    };
  }, [stopTitleDrag]);

  useLayoutEffect(() => {
    if (liveAllocation && liveAllocation !== allocation) setAllocation(liveAllocation);
  }, [allocation, liveAllocation]);
  useLayoutEffect(() => { setPreferredMainId(mainCurrentId); }, [mainCurrentId]);
  useLayoutEffect(() => {
    const canvas = sideCanvas.current;
    if (!canvas || !liveAllocation) return;
    const read = () => {
      const bounds = canvas.getBoundingClientRect();
      const { height, width } = bounds;
      if (titleDrag.current && !sameBounds(titleDrag.current.bounds, bounds)) stopTitleDrag();
      const line = dividerLine.current?.getBoundingClientRect();
      const hit = dividerHit.current?.getBoundingClientRect();
      setMeasured({ allocation: liveAllocation, height: cssPixels(height), width: cssPixels(width),
        rows: Array.from(canvas.children, (row) => cssPixels(row.getBoundingClientRect().height)),
        divider: line && hit ? {
          line: cssPixels(line.height), hit: cssPixels(hit.height),
          above: cssPixels(line.top - hit.top), below: cssPixels(hit.bottom - line.bottom),
        } : undefined });
    };
    const observer = new ResizeObserver(read);
    observer.observe(canvas);
    read();
    return () => observer.disconnect();
  }, [liveAllocation, stopTitleDrag]);
  useLayoutEffect(() => {
    if (!reorderFocus) return;
    const { element, wasDivider } = reorderFocus;
    if (reorderFocus.allocation === liveAllocation && element.ownerDocument.activeElement === element.ownerDocument.body) {
      const target = element.isConnected ? element : wasDivider ? dividerHit.current : null;
      target?.focus({ preventScroll: true });
    }
    setReorderFocus(undefined);
  }, [liveAllocation, reorderFocus]);
  useLayoutEffect(() => {
    if (!focusRequest) return;
    const { documentId } = focusRequest;
    if (controller.getSnapshot().snapshot?.documentId === documentId) {
      const index = liveAllocation?.ids.indexOf(documentId) ?? -1;
      if (index >= 0 && liveAllocation?.heights[index] === SECONDARY_MIN_HEIGHT) {
        const titles = sideCanvas.current?.querySelectorAll<HTMLButtonElement>("[data-secondary-document]");
        if (titles) Array.from(titles).find((title) => title.dataset.secondaryDocument === documentId)?.focus();
      } else controller.focusQuickDocument(documentId);
    }
    setFocusRequest(undefined);
  }, [controller, focusRequest, liveAllocation]);

  function activate(documentId: string) {
    stopTitleDrag();
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

  function isDividerFocused() {
    const hit = dividerHit.current;
    return !!hit && hit.ownerDocument.activeElement === hit;
  }

  function canUseSecondaryAllocation(current: RealRegionAllocation) {
    const { tabs, snapshot } = controller.getSnapshot();
    return snapshot?.documentId === activeId && current.ids === liveSecondaryIds &&
      current.ids.every((id) => tabs.some((tab) => tab.documentId === id)) &&
      controller.canSelectFolder() && !controller.isEditorInputBlocked();
  }

  function adjustDivider(beforeIndex: number, delta: number, initial?: DividerDrag) {
    const current = initial?.allocation ?? liveAllocation;
    if (!current || !canUseSecondaryAllocation(current)) return false;
    setAllocation((previous) => {
      if (previous.ids !== current.ids) return previous;
      const heights = resizeSecondaryPaneDivider(initial?.allocation.heights ?? previous.heights, beforeIndex, delta);
      if (!heights || (heights[beforeIndex] === previous.heights[beforeIndex] &&
          heights[beforeIndex + 1] === previous.heights[beforeIndex + 1])) return previous;
      return { ...previous, heights };
    });
    return true;
  }

  function beginDrag(event: PointerEvent<HTMLDivElement>, beforeIndex: number) {
    if (event.button !== 0 || event.pointerType !== "mouse" || !event.isPrimary) return;
    // Keep the current editor focused when a native composition blocks the drag.
    event.preventDefault();
    const canvas = sideCanvas.current;
    if (drag.current || titleDrag.current || !canvas || !liveAllocation || !canUseSecondaryAllocation(liveAllocation)) return;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    drag.current = { element, pointerId: event.pointerId, beforeIndex,
      startY: event.clientY - canvas.getBoundingClientRect().top, allocation: liveAllocation,
      activeId: controller.getSnapshot().snapshot?.documentId };
    element.focus({ preventScroll: true });
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    const canvas = sideCanvas.current;
    if (!canvas || current?.pointerId !== event.pointerId || current.element !== event.currentTarget) return;
    if (controller.getSnapshot().snapshot?.documentId !== current.activeId) {
      stopDrag(event);
      return;
    }
    const y = event.clientY - canvas.getBoundingClientRect().top;
    if (!adjustDivider(current.beforeIndex, y - current.startY, current)) stopDrag(event);
  }

  function reorder(current: RealRegionAllocation, sourceId: string, target: TitleInsertion, focus: Element | null) {
    if (drag.current || current !== liveAllocation || !canUseSecondaryAllocation(current)) return;
    const result = reorderRealRegionDocuments(controller, current, sourceId, target.targetId, target.placement);
    if (!result.ok || result.allocation === current) return;
    setAllocation((previous) => previous === current ? result.allocation : previous);
    if (focus instanceof HTMLElement)
      setReorderFocus({ allocation: result.allocation, element: focus, wasDivider: focus === dividerHit.current });
  }

  function beginTitleDrag(event: PointerEvent<HTMLButtonElement>, sourceId: string) {
    if (event.isPrimary) suppressTitleClick.current = null;
    if (event.button !== 0 || event.pointerType !== "mouse" || !event.isPrimary) return;
    const canvas = sideCanvas.current;
    if (!canvas || !liveAllocation || liveAllocation.ids.length < 2 || titleDrag.current || drag.current ||
        !canUseSecondaryAllocation(liveAllocation)) return;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    titleDrag.current = { element, pointerId: event.pointerId, sourceId,
      startX: event.clientX, startY: event.clientY, moved: false, allocation: liveAllocation,
      state: controller.getSnapshot(), bounds: canvas.getBoundingClientRect(), focus: element.ownerDocument.activeElement };
  }

  function titleDragFor(event: PointerEvent<HTMLButtonElement>) {
    const current = titleDrag.current;
    if (current?.pointerId === event.pointerId && current.element === event.currentTarget) return current;
  }

  function titleInsertion(event: PointerEvent<HTMLButtonElement>, current: TitleDrag, canvas: HTMLOListElement): TitleInsertion | undefined {
    const hit = canvas.ownerDocument.elementFromPoint(event.clientX, event.clientY);
    if (hit?.closest('[role="separator"]')) return;
    const row = hit?.closest<HTMLElement>("[data-secondary-row]");
    const targetId = row?.dataset.secondaryRow;
    if (row?.parentElement !== canvas || !targetId || targetId === current.sourceId) return;
    const title = row.querySelector<HTMLElement>("[data-secondary-title]")?.getBoundingClientRect();
    if (!title) return;
    const placement = event.clientY < title.top + title.height / 2 ? "before" : "after";
    const sourceIndex = current.allocation.ids.indexOf(current.sourceId);
    const targetIndex = current.allocation.ids.indexOf(targetId);
    if (targetIndex < 0 || targetIndex + (placement === "before" ? -1 : 1) === sourceIndex) return;
    return { targetId, placement };
  }

  function trackTitleDrag(event: PointerEvent<HTMLButtonElement>, finished = false) {
    const current = titleDragFor(event);
    if (!current) return;
    const canvas = sideCanvas.current;
    if (!canvas || controller.getSnapshot() !== current.state || current.allocation !== liveAllocation ||
        !sameBounds(current.bounds, canvas.getBoundingClientRect()) || !canUseSecondaryAllocation(current.allocation)) {
      stopTitleDrag();
      return;
    }
    if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 5) {
      current.moved = true;
    }
    if (!current.moved) {
      if (finished) {
        const released = canvas.ownerDocument.elementFromPoint(event.clientX, event.clientY);
        stopTitleDrag(!current.element.contains(released));
      }
      return;
    }
    const target = titleInsertion(event, current, canvas);
    if (finished) {
      stopTitleDrag();
      if (target) reorder(current.allocation, current.sourceId, target, current.focus);
    } else {
      setInsertion((previous) => previous?.targetId === target?.targetId && previous?.placement === target?.placement ? previous : target);
    }
  }

  function cancelTitlePointer(event: PointerEvent<HTMLButtonElement>) {
    if (titleDragFor(event)) stopTitleDrag();
  }

  function move(target: "main" | "secondary") {
    const document = controller.getSnapshot().snapshot;
    const result = moveRealRegionDocument(controller, allocation, target);
    if (!result.ok && result.reason === "full") {
      setReceipt("空间不足，文档留在原区域。");
      return;
    }
    if (!document || !result.ok) {
      setReceipt("暂未移区，请完成当前操作后重试。");
      return;
    }
    stopDrag();
    stopTitleDrag();
    setAllocation(result.allocation);
    setReceipt(`已将 ${document.fileName} 移${target === "main" ? "回主区" : "入副区"}`);
    setFocusRequest({ documentId: document.documentId });
  }

  async function closeSecondary(documentId: string, fileName: string, restoreFocus: boolean) {
    const wasActive = controller.getSnapshot().snapshot?.documentId === documentId;
    const keepFocus = restoreFocus || isDividerFocused();
    stopDrag();
    stopTitleDrag();
    await controller.closeTab(documentId);
    const current = controller.getSnapshot();
    if (current.tabs.some((tab) => tab.documentId === documentId)) return;
    setReceipt(`已关闭 ${fileName} · 活动文档 ${current.snapshot?.fileName ?? "无"}`);
    if ((wasActive || keepFocus) && current.snapshot) setFocusRequest({ documentId: current.snapshot.documentId });
  }

  function changeHeight(totalHeight: number) {
    if (!liveAllocation || liveAllocation.ids.length) return;
    setAllocation({ ids: [], heights: [], totalHeight });
    setReceipt("");
  }

  const modeLabel = (documentId: string) => controller.getMode(documentId) === "source" ? "源码模式" : "编辑模式";
  const editor = (documentId: string) => (
    <div key={documentId} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <MemoryEditor controller={controller} documentId={documentId}
        frozen={state.frozen || state.busy} passive={activeId !== documentId}
        autoFocusOnMount={false} preserveViewportOnSync />
    </div>
  );
  const activeStatus = activeId ? controller.getSaveStatus(activeId) : null;
  return (
    <main className="bg-background text-foreground flex h-screen flex-col" aria-label="真实文件移区实验">
      <div aria-hidden="true" className="electrobun-webkit-app-region-drag h-12 shrink-0 select-none" />
      <section className="space-y-2 px-4 pb-3 text-sm">
        <h1 className="text-lg font-semibold">真实文件移区实验</h1>
        <p>请只选择测试文件。保存会写入磁盘，本实验最多打开三篇 Markdown，副区最多两篇。⌘⇧M 切换活动文档模式。</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="副区实验高度">
          {heightPresets.map((height) => (
            <button key={height} type="button" className={buttonClass} aria-pressed={allocation.totalHeight === height}
              disabled={!liveAllocation || liveAllocation.ids.length > 0}
              onClick={() => changeHeight(height)}>副区高度 {height}px</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={!isCommandEnabled("selectDocument")}
            onClick={() => executeCommand({ type: "selectDocument", args: {} })}>打开 Markdown 文件</button>
          <button type="button" className={buttonClass} disabled={!isCommandEnabled("saveDocument")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => executeCommand({ type: "saveDocument", args: {} })}>保存活动文档</button>
          <button type="button" className={buttonClass} disabled={!isCommandEnabled("closeDocument")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => executeCommand({ type: "closeDocument", args: {} })}>关闭活动文档</button>
          <button type="button" className={buttonClass} disabled={!moveIn.ok && moveIn.reason !== "full"}
            onMouseDown={(event) => event.preventDefault()} onClick={() => move("secondary")}>将活动文档移入副区</button>
          <button type="button" className={buttonClass} disabled={!moveOut.ok}
            onMouseDown={(event) => event.preventDefault()} onClick={() => move("main")}>将活动文档移回主区</button>
        </div>
        <p role="status">{state.busy ? "正在等待文件选择或读取…" :
          `活动文档 ${state.snapshot?.fileName ?? "无"}${activeStatus ? ` · ${saveLabel[activeStatus.status]}` : ""}`}</p>
        {receipt && <p role="status">{receipt}</p>}
        {!projection && <p role="alert">副区分配不可用。</p>}
        {liveAllocation && (
          <p className="overflow-x-auto whitespace-nowrap tabular-nums">副区模型 {liveAllocation.totalHeight} CSS px，文档 {liveAllocation.heights.map(cssPixels).join(" / ") || "无"}</p>
        )}
        {measured && measured.allocation === liveAllocation && (
          <p className="overflow-x-auto whitespace-nowrap tabular-nums">副区实测总高 {measured.height} CSS px，文档 {measured.rows.join(" / ")}，宽度 {measured.width} CSS px</p>
        )}
        {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
        {activeStatus?.message && <p role="status">{activeStatus.message}</p>}
        {activeId && controller.externalMessage(activeId) && <p role="status">{controller.externalMessage(activeId)}</p>}
      </section>
      <div className="min-h-0 grow overflow-x-auto border-t">
        <MainSideLayout sideVisible={!!projection?.secondary.length} main={
          <section aria-label="实验主区" className="flex size-full min-w-0 flex-col gap-2 p-3">
            <h2 className="font-medium">主区{mainCurrentId && ` · ${modeLabel(mainCurrentId)}`}</h2>
            <nav aria-label="实验主区标签" className="flex flex-wrap gap-1">
              {(projection?.main ?? state.tabs).map((document) => (
                <button key={document.documentId} type="button" className={buttonClass}
                  aria-pressed={activeId === document.documentId}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => activate(document.documentId)}>{document.fileName}{controller.isDirty(document.documentId) ? " · 未保存" : ""}</button>
              ))}
            </nav>
            {mainCurrent ? editor(mainCurrent.documentId) : <p>主区暂无文档</p>}
          </section>
        } side={projection && projection.secondary.length > 0 && (
          <section aria-label="实验副区" className="size-full min-w-0 overflow-y-auto">
            <h2 className="px-3 py-2 font-medium">副区</h2>
            <ol ref={sideCanvas} aria-label="副区文档顺序" className="min-w-[160px] overflow-hidden"
              style={{ height: projection.allocation.totalHeight }}>
              {projection.secondary.map(({ documentId, fileName }, index) => {
                const height = projection.allocation.heights[index];
                const name = `${fileName}${controller.isDirty(documentId) ? " · 未保存" : ""}`;
                const next = projection.secondary[index + 1];
                const nextHeight = projection.allocation.heights[index + 1];
                const placement = insertion?.targetId === documentId ? insertion.placement : undefined;
                return (
                  <li key={documentId} id={`region-lab-row-${documentId}`} data-secondary-row={documentId}
                    className="relative flex min-w-0 flex-col" style={{ height }}>
                    <div data-secondary-title="" className="bg-sidebar flex shrink-0 items-center gap-1 px-1" style={{ height: SECONDARY_MIN_HEIGHT - 1 }}>
                      <button type="button" className={`${buttonClass} min-w-0 grow truncate py-0 text-left text-sm${projection.secondary.length > 1 ? " cursor-grab active:cursor-grabbing" : ""}`}
                        aria-pressed={activeId === documentId} aria-label={`激活副区 ${name}`} data-secondary-document={documentId}
                        aria-keyshortcuts={projection.secondary.length > 1 ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                        onMouseDown={(event) => event.preventDefault()}
                        onPointerDown={(event) => beginTitleDrag(event, documentId)}
                        onPointerMove={trackTitleDrag}
                        onPointerUp={(event) => trackTitleDrag(event, true)}
                        onPointerCancel={cancelTitlePointer} onLostPointerCapture={cancelTitlePointer}
                        onClick={(event) => {
                          const suppressed = suppressTitleClick.current;
                          const pointerId = "pointerId" in event.nativeEvent ? event.nativeEvent.pointerId : undefined;
                          if (event.detail > 0 && suppressed?.element === event.currentTarget &&
                              (typeof pointerId !== "number" || pointerId <= 0 || pointerId === suppressed.pointerId)) {
                            suppressTitleClick.current = null;
                            return;
                          }
                          activate(documentId);
                        }}
                        onKeyDown={(event) => {
                          if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing || titleDrag.current ||
                              (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                          const direction = event.key === "ArrowUp" ? -1 : 1;
                          const target = projection.secondary[index + direction];
                          event.preventDefault();
                          event.stopPropagation();
                          if (target) reorder(projection.allocation, documentId, { targetId: target.documentId,
                            placement: direction === -1 ? "before" : "after" }, event.currentTarget);
                        }}>{name}</button>
                      <span className="text-muted-foreground shrink-0 text-xs">{modeLabel(documentId)}</span>
                      <button type="button" className={`${buttonClass} size-6 shrink-0 p-0`} aria-label={`关闭副区 ${fileName}`}
                        disabled={!controller.canSelectFolder() || controller.isEditorInputBlocked()}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => void closeSecondary(documentId, fileName,
                          event.currentTarget.ownerDocument.activeElement === event.currentTarget)}>×</button>
                    </div>
                    {height > SECONDARY_MIN_HEIGHT && editor(documentId)}
                    <div ref={next ? dividerLine : undefined} aria-hidden="true" className="bg-border h-px shrink-0" />
                    {placement && <>
                      <div aria-hidden="true" className={`bg-primary pointer-events-none absolute inset-x-0 z-20 h-0.5 ${placement === "before" ? "top-0" : "bottom-0"}`} />
                      <span role="status" className="sr-only">插入到 {fileName} {placement === "before" ? "之前" : "之后"}</span>
                    </>}
                    {next && (
                      <div key={next.documentId} ref={dividerHit} role="separator" tabIndex={0} aria-orientation="horizontal"
                        aria-label={`${fileName} 和 ${next.fileName} 分隔线`} aria-controls={`region-lab-row-${documentId}`}
                        aria-valuemin={SECONDARY_MIN_HEIGHT} aria-valuemax={cssPixels(height + nextHeight - SECONDARY_MIN_HEIGHT)}
                        aria-valuenow={cssPixels(height)} aria-valuetext={`上方 ${cssPixels(height)} CSS px，下方 ${cssPixels(nextHeight)} CSS px`}
                        className="electrobun-webkit-app-region-no-drag focus-visible:bg-ring absolute inset-x-0 -bottom-px z-10 h-[3px] cursor-row-resize touch-none select-none focus-visible:outline-2 focus-visible:outline-offset-1"
                        onKeyDown={(event) => {
                          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing || drag.current || titleDrag.current) return;
                          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                          event.preventDefault();
                          event.stopPropagation();
                          adjustDivider(index, event.key === "ArrowDown" ? 8 : -8);
                        }}
                        onPointerDown={(event) => beginDrag(event, index)}
                        onPointerMove={moveDrag}
                        onPointerUp={(event) => {
                          moveDrag(event);
                          stopDrag(event);
                        }}
                        onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
            {measured?.allocation === projection.allocation && measured.divider && (
              <p className="px-2 py-1 text-sm tabular-nums">
                副区分隔线实测 {measured.divider.line} CSS px，命中区 {measured.divider.hit} CSS px（上 {measured.divider.above} / 下 {measured.divider.below}）
              </p>
            )}
          </section>
        )} />
      </div>
      <DocumentDiscardDialog buttonClass={buttonClass} />
    </main>
  );
}
