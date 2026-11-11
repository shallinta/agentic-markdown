import {
  addCursorAbove,
  addCursorBelow,
  simplifySelection,
  isolateHistory,
} from "@codemirror/commands";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { registerCalloutView } from "@/client/callout-presentation";
import { CALLOUT_SUMMARY_CONFIG } from "@/client/callout-summary-protocol";
import { registerPairingView } from "@/client/contextual-pairing";
import { recoveredViewportEditorOffset, type createDocumentController } from "@/client/documents";
import {
  registerEditingImages,
  observeEditingImages,
} from "@/client/editing-images";
import {
  editorFaultSession,
  type EditorFaultSession,
} from "@/client/editor-fault";
import {
  syncCurrentEditorState,
  prepareEditorViewState,
  editorPermissionEffect,
  editorSurfaceEditable,
} from "@/client/editor-view-sync";
import {
  registerEmojiCompletion,
  observeEmojiCompletion,
} from "@/client/emoji-completion";
import {
  fenceCompletionTransaction,
  isCurrentFenceCompletion,
} from "@/client/fence-completion";
import {
  isHeadingShortcut,
  observeHeadingFolding,
  registerHeadingView,
  toggleCurrentHeading,
} from "@/client/heading-folding";
import { routeHistoryInput } from "@/client/history-input";
import {
  registerFormatView,
  bindNativeFormatMenu,
} from "@/client/inline-format-input";
import { listContinuationTransaction } from "@/client/list-continuation";
import { registerListInputView, routeListInput } from "@/client/list-input";
import type { ImageTransport } from "@/client/local-images";
import {
  createRasterPasteIntent,
  type AuthorizeRasterPaste,
  type RasterPasteTransport,
} from "@/client/raster-paste-intent";
import { editorOffset, rawOffset, rawText } from "@/client/raw-buffer";
import { planSourceIndentation } from "@/client/source-indentation";
import {
  isOrdinaryIndentation,
  registerIndentationView,
  routeIndentationInput,
  routeSourceTabFocus,
} from "@/client/source-indentation-input";
import {
  guardSourceSelectionMouse,
  isOrdinarySourceSelection,
  routeSourceSelectionKey,
} from "@/client/source-selection-input";
import { registerTaskView } from "@/client/task-marker-input";
import { deferWrappingUpdate } from "@/client/wrapping-measure";
import { useCommands } from "@/commands";

import { observeFrontmatter } from "../client/frontmatter-presentation";

import { EditingCodeMenu } from "./editing-code-menu";
import { SourceSearch } from "./source-search";

const rasterPasteMessages = {
  busy: "正在处理上一张粘贴图片，请稍后再试。",
  size: "只能粘贴不超过 1 MiB 的 PNG 或 JPEG 图片。",
  save: "请先保存当前文档，再粘贴图片。",
  unavailable: "当前文档无法粘贴图片，请确认文档可写且已纳入工作区。",
  position: "请将光标放在普通单行段落或独立空行中，再粘贴图片。",
  rejected: "图片粘贴未完成，正文未更改。",
  unknown: "无法确认图片是否已保存，正文未更改。请检查文档旁的 assets 文件夹。",
  unlinked: "图片已保存到文档旁的 assets 文件夹，链接未插入。",
};

export function MemoryEditor({
  controller,
  documentId,
  frozen,
  readLocalImage,
  assetEpoch,
  publishRaster,
  authorizeRaster,
  autoFocusOnMount = true,
  preserveViewportOnSync = false,
  passive = false,
  checkpointOnScroll = false,
}: {
  controller: ReturnType<typeof createDocumentController>;
  documentId: string;
  frozen: boolean;
  readLocalImage?: ImageTransport;
  assetEpoch?: string;
  publishRaster?: RasterPasteTransport;
  authorizeRaster?: AuthorizeRasterPaste;
  autoFocusOnMount?: boolean;
  preserveViewportOnSync?: boolean;
  passive?: boolean;
  checkpointOnScroll?: boolean;
}) {
  const imageInputs = useRef({ readLocalImage, assetEpoch });
  imageInputs.current = { readLocalImage, assetEpoch };
  const rasterInputs = useRef({ publishRaster, authorizeRaster });
  rasterInputs.current = { publishRaster, authorizeRaster };
  const checkRaster = useRef<(() => void) | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const refreshViewSession = useRef<((session: EditorFaultSession) => () => void) | null>(null);
  useLayoutEffect(() => {
    checkRaster.current?.();
    if (viewRef.current) {
      observeEditingImages(viewRef.current);
      observeHeadingFolding(viewRef.current);
      observeFrontmatter(viewRef.current);
      observeEmojiCompletion(viewRef.current);
    }
  });
  const [mountAttempt, setMountAttempt] = useState(0);
  const [searchSlot, setSearchSlot] = useState<{
    view: EditorView;
    session: EditorFaultSession;
  } | null>(null);
  const editor = controller.getEditor(documentId);
  const readOnly = passive || !controller.canWrite(documentId);
  const inputBlocked = controller.isEditorInputBlocked();
  const { executeCommand } = useCommands();
  useLayoutEffect(() => {
    if (!container.current || !editor) return;
    const initialState = prepareEditorViewState(passive ? {
      getEditor: controller.getEditor,
      updateEditor: controller.updateEditor,
      canWrite: () => false,
    } : controller, documentId);
    if (!initialState) {
      // A frozen/busy controller may refuse the facet-only transaction.
      // Wait for its next state notification; never mount an unaccepted state.
      return controller.subscribe(() => setMountAttempt((value) => value + 1));
    }
    const scrollTo = controller.getScrollSnapshot(documentId);
    const session = initialState.field(editorFaultSession);
    let alive = true;
    let checkRasterTransaction: (() => void) | undefined;
    const view = new EditorView({
      state: initialState,
      parent: container.current,
      scrollTo,
      dispatchTransactions(transactions) {
        for (const transaction of transactions) {
          if (controller.updateEditor(documentId, transaction)) {
            view.update([transaction]);
            checkRasterTransaction?.();
          }
        }
      },
    });
    viewRef.current = view;
    view.contentDOM.contentEditable = String(
      editorSurfaceEditable(initialState.readOnly, frozen, inputBlocked)
    );
    view.dom.dataset.documentEditor = documentId;
    const currentView = () =>
      alive &&
      viewRef.current === view &&
      controller.getSnapshot().snapshot?.documentId === documentId;
    const dispatchOwnedTransaction = (transaction: Transaction) => {
      if (currentView() && view.contentDOM.isConnected && view.state === transaction.startState)
        view.dispatch(transaction);
    };
    view.contentDOM.setAttribute("aria-label", "Markdown 编辑区");
    if (!scrollTo)
      view.scrollDOM.scrollTop = controller.getScrollPosition(documentId);
    let scrollIntent: { offset: number; direction?: 1 | -1; expires: number; checkpoint: boolean } | undefined;
    const consumeScrollMovement = (offset: number) => {
      const intent = scrollIntent;
      if (!intent) return;
      if (performance.now() > intent.expires) {
        scrollIntent = undefined;
        return;
      }
      const delta = offset - intent.offset;
      if ((intent.direction ? delta * intent.direction : Math.abs(delta)) < 1) return;
      scrollIntent = undefined;
      return intent;
    };
    const collectViewport = () => {
      const current = controller.getEditor(documentId);
      const viewState = view.state;
      if (!view.scrollDOM.isConnected || current?.state !== viewState) return;
      const beforeMeasure = view.scrollDOM.scrollTop;
      const top = view.scrollDOM.getBoundingClientRect().top;
      const documentTop = view.documentTop;
      const block = view.lineBlockAtHeight(Math.max(0, top - documentTop));
      if (view.state !== viewState) return;
      const offset = view.scrollDOM.scrollTop;
      if (consumeScrollMovement(beforeMeasure)) scrollCapture.savePosition(viewState, offset, true);
      return {
        from: rawOffset(viewState.field(rawText), block.from),
        offset: view.documentTop + block.top - top,
        ratio:
          offset /
          Math.max(1, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight),
        revision: current.revision,
      };
    };
    const collectScroll = () => {
      const state = view.state;
      if (!view.scrollDOM.isConnected || controller.getEditor(documentId)?.state !== state) return;
      const offset = view.scrollDOM.scrollTop;
      let effect: ReturnType<EditorView["scrollSnapshot"]> | undefined;
      try {
        effect = view.scrollSnapshot();
      } catch {
        if (!Number.isFinite(offset) || offset < 0) return;
      }
      if (view.scrollDOM.isConnected && view.state === state)
        return effect ? { state, offset, effect } : { state, offset };
    };
    let registeredSession = session;
    let viewportCapture = controller.registerViewportCapture(documentId, collectViewport);
    let scrollCapture = controller.registerEditorScroll(documentId, collectScroll);
    let scrollCheckpointTimer: ReturnType<typeof setTimeout> | undefined;
    const clearScrollCheckpoint = () => {
      if (scrollCheckpointTimer !== undefined) clearTimeout(scrollCheckpointTimer);
      scrollCheckpointTimer = undefined;
    };
    const checkpointReady = () => currentView() && view.scrollDOM.isConnected &&
      !view.compositionStarted && !view.composing && controller.getEditor(documentId)?.state === view.state;
    const armScrollCheckpoint = () => {
      if (!checkpointOnScroll) return;
      clearScrollCheckpoint();
      if (!checkpointReady()) return;
      const owner = viewportCapture;
      const expectedSession = registeredSession;
      scrollCheckpointTimer = setTimeout(() => {
        scrollCheckpointTimer = undefined;
        if (owner === viewportCapture && expectedSession === registeredSession && checkpointReady())
          owner.checkpoint(view.state);
      }, 250);
    };
    let releaseEditorDispatch = controller.registerEditorDispatch(documentId, dispatchOwnedTransaction);
    const checkInteraction = () => !view.compositionStarted;
    let interaction = controller.registerEditorInteraction(documentId, checkInteraction);
    const recovery = viewportCapture.recover();
    const viewport = recovery?.position ?? controller.getViewport(documentId);
    let wrappingReady = !viewport;
    const calloutToast = `callout-${documentId}`;
    const headingReady = () => {
      const snapshot = controller.getSnapshot();
      return (
        currentView() &&
        controller.getEditor(documentId)?.state === view.state &&
        !snapshot.busy &&
        !snapshot.frozen &&
        !controller.isEditorInputBlocked() &&
        !controller.hasSaves() &&
        !view.state.field(editorFaultSession).fault &&
        !controller.isSafeSource(documentId) &&
        controller.getMode(documentId) !== "reading" &&
        !view.compositionStarted &&
        !view.composing
      );
    };
    const raster = createRasterPasteIntent(controller, {
      capture: () => {
        const editor = controller.getEditor(documentId);
        if (!currentView() || !view.hasFocus || !view.contentDOM.isConnected ||
            editor?.state.field(editorFaultSession) !== session ||
            session.fault || editor.state.readOnly ||
            controller.getMode(documentId) !== "editing" || controller.isSafeSource(documentId) ||
            !controller.canWrite(documentId) || controller.hasSaves() ||
            view.compositionStarted || view.composing)
          return undefined;
        const source = controller.captureReadingSnapshotSource();
        const location = controller.getSnapshot().snapshot?.displayPath;
        return source?.documentId === documentId && location ? {
          source, location, state: editor.state, bufferRevision: editor.revision,
          activation: controller.getContentSearchActivation(),
        } : undefined;
      },
      transport: () => rasterInputs.current.publishRaster,
      authorize: () => rasterInputs.current.authorizeRaster,
      dirty: () => controller.isDirty(documentId),
      dispatch: transaction => {
        if (view.state !== transaction.startState) return false;
        view.dispatch(transaction);
        return view.state === transaction.state;
      },
      report: reason => toast.info(rasterPasteMessages[reason], { id: `raster-paste-${documentId}` }),
    });
    checkRaster.current = checkRasterTransaction = raster.check;
    const releaseRasterCheck = controller.subscribe(raster.check);
    const pasteRaster = (event: ClipboardEvent) => {
      if (view.hasFocus && controller.getMode(documentId) === "editing" &&
          controller.getEditor(documentId)?.state === view.state)
        raster.paste(event);
    };
    view.contentDOM.addEventListener("paste", pasteRaster, true);
    view.contentDOM.addEventListener("compositionstart", raster.invalidate, true);
    view.contentDOM.addEventListener("blur", raster.invalidate, true);
    view.dom.ownerDocument.defaultView?.addEventListener("blur", raster.invalidate);
    const removeEmojiCompletion = registerEmojiCompletion(
      view,
      () =>
        headingReady() &&
        controller.canWrite(documentId) &&
        controller.getMode(documentId) === "editing"
    );
    const removeHeading = registerHeadingView(view, {
      ready: headingReady,
      run: ({ kind, ...action }) =>
        executeCommand({
          type:
            kind === "frontmatter"
              ? "toggleFrontmatterFold"
              : kind === "fencedCode"
                ? "toggleCodeFold"
                : "toggleHeadingFold",
          args: action,
        }),
      rejected: () =>
        toast.info("选区跨入待折叠内容，请先调整选区再折叠。", {
          id: `heading-${documentId}`,
        }),
    });
    const headingKey = (event: KeyboardEvent) => {
      if (!isHeadingShortcut(event) || !view.hasFocus || !headingReady())
        return;
      event.preventDefault();
      event.stopPropagation();
      executeCommand({ type: "toggleHeadingFold", args: {} });
    };
    view.contentDOM.addEventListener("keydown", headingKey, true);
    const imageToast = `images-${documentId}`;
    const removeImages = registerEditingImages(
      view,
      {
        current: () => {
          const snapshot = controller.getSnapshot(),
            current = controller.getEditor(documentId);
          if (
            !imageInputs.current.readLocalImage ||
            !currentView() ||
            current?.state !== view.state ||
            current.state.field(editorFaultSession) !== session ||
            session.fault ||
            controller.getMode(documentId) !== "editing" ||
            controller.isSafeSource(documentId) ||
            snapshot.busy ||
            snapshot.frozen ||
            controller.isEditorInputBlocked() ||
            view.compositionStarted ||
            view.composing ||
            !snapshot.snapshot
          )
            return null;
          return {
            documentId,
            revision: current.revision,
            doc: current.state.doc,
            rawText: current.state.field(rawText),
            identity: session,
            handle: snapshot.snapshot.handle,
            assetEpoch: String(imageInputs.current.assetEpoch ?? ""),
          };
        },
        transport: (request) => imageInputs.current.readLocalImage!(request),
        failed: (retry) =>
          toast.error("图片呈现失败，已保留原文", {
            id: imageToast,
            action: { label: "重试", onClick: retry },
          }),
      },
      controller.subscribe
    );
    const removeCallout = registerCalloutView(
      view,
      () => {
        const snapshot = controller.getSnapshot();
        const current = controller.getEditor(documentId);
        if (
          !currentView() ||
          current?.state !== view.state ||
          current.state.field(editorFaultSession) !== session ||
          session.fault ||
          controller.getMode(documentId) !== "editing" ||
          controller.isSafeSource(documentId) ||
          snapshot.busy ||
          snapshot.frozen ||
          controller.isEditorInputBlocked() ||
          view.compositionStarted ||
          view.composing
        )
          return null;
        return {
          documentId,
          revision: current.revision,
          doc: current.state.doc,
          rawText: current.state.field(rawText),
          identity: session,
          config: CALLOUT_SUMMARY_CONFIG,
        };
      },
      (retry) =>
        toast.error("提示块呈现失败，已保留原文", {
          id: calloutToast,
          action: { label: "重试", onClick: retry },
        }),
      controller.subscribe
    );
    const removeTask = registerTaskView(
      view,
      () => {
        const current = controller.getSnapshot();
        return currentView() &&
          controller.getEditor(documentId)?.state === view.state &&
          view.state.field(editorFaultSession) === session &&
          controller.getMode(documentId) === "editing" &&
          !controller.isSafeSource(documentId) &&
          !controller.getEditorFault(documentId)?.fault &&
          controller.canWrite(documentId) &&
          !current.frozen &&
          !current.busy &&
          !controller.isEditorInputBlocked() &&
          !view.compositionStarted &&
          !view.composing &&
          !view.state.readOnly
          ? view.state
          : undefined;
      },
      (transaction) => {
        view.dispatch(transaction);
        return view.state === transaction.state;
      },
      controller.subscribe
    );
    const removePairing = registerPairingView(
      view,
      () => {
        const current = controller.getSnapshot();
        return (
          currentView() &&
          view.hasFocus &&
          controller.canWrite(documentId) &&
          !current.frozen &&
          !current.busy &&
          !controller.isEditorInputBlocked() &&
          controller.getMode(documentId) !== "reading" &&
          !controller.isSafeSource(documentId) &&
          !controller.getEditorFault(documentId)?.fault
        );
      },
      () =>
        currentView() &&
        controller.getEditor(documentId)?.state === view.state &&
        view.state.field(editorFaultSession) === session
    );
    const removeFormat = registerFormatView(
      view,
      documentId,
      () => {
        const current = controller.getSnapshot();
        return (
          currentView() &&
          controller.canWrite(documentId) &&
          !current.frozen &&
          !current.busy &&
          !controller.isEditorInputBlocked() &&
          controller.getMode(documentId) !== "reading" &&
          !controller.isSafeSource(documentId) &&
          !controller.getEditorFault(documentId)?.fault
        );
      },
      () =>
        currentView() &&
        controller.getMode(documentId) !== "reading" &&
        !controller.isSafeSource(documentId),
      executeCommand
    );
    const removeNativeFormat = bindNativeFormatMenu(
      view,
      () =>
        currentView() ? controller.getEditor(documentId)?.state : undefined,
      controller.subscribe
    );
    const scheduleWrapping = () => {
      if (
        !currentView() ||
        !wrappingReady ||
        !controller.needsSourceWrapping(documentId)
      )
        return;
      view.requestMeasure({
        key: scheduleWrapping,
        read: () => {
          if (!currentView()) return undefined;
          // Capture a visible character, not merely a logical line and stale pixel offset.
          const box = view.scrollDOM.getBoundingClientRect();
          const content = view.contentDOM.getBoundingClientRect();
          const position = view.posAtCoords({
            x: Math.max(box.left, content.left) + 4,
            y: Math.max(box.top, content.top) + 4,
          });
          const rect = position === null ? null : view.coordsAtPos(position);
          return {
            state: view.state,
            scroll:
              position !== null && rect
                ? EditorView.scrollIntoView(position, {
                    y: "start",
                    yMargin: Math.max(0, rect.top - box.top),
                    x: "start",
                    xMargin: Math.max(0, rect.left - box.left),
                  })
                : view.scrollSnapshot(),
          };
        },
        write: (measured) => {
          if (!currentView() || !measured) return;
          deferWrappingUpdate(measured.state, {
            current: currentView,
            state: () => view.state,
            remeasure: scheduleWrapping,
            apply: () => {
              controller.applySourceWrapping(
                documentId,
                measured.state,
                measured.scroll
              );
            },
          });
        },
      });
    };
    type CommandTargets = Parameters<typeof controller.registerEditorCommandTargets>[1];
    const sourceSelection: NonNullable<CommandTargets["sourceSelection"]> = {
      ready: () => currentView() && !view.compositionStarted && view.hasFocus,
      run: (action) => {
        if (!currentView() || !view.hasFocus || view.compositionStarted)
          return false;
        return (
          action === "above"
            ? addCursorAbove
            : action === "below"
              ? addCursorBelow
              : simplifySelection
        )(view);
      },
    };
    const listInput: NonNullable<CommandTargets["listInput"]> = {
      ready: () =>
        currentView() &&
        view.hasFocus &&
        !view.compositionStarted &&
        !view.composing,
      run: (soft) => {
        if (
          !currentView() ||
          !view.hasFocus ||
          view.compositionStarted ||
          view.composing ||
          view.state.readOnly
        )
          return false;
        const completion = isCurrentFenceCompletion(
          view.state,
          controller.getEditor(documentId)?.state,
          registeredSession,
          controller.getMode(documentId) !== "reading" &&
            !controller.isSafeSource(documentId)
        )
          ? fenceCompletionTransaction(view.state, soft)
          : undefined;
        const transaction =
          completion ?? listContinuationTransaction(view.state, soft);
        view.dispatch(transaction);
        return view.state === transaction.state;
      },
    };
    const currentIndentationView = () =>
      currentView() &&
      controller.getEditor(documentId)?.state === view.state &&
      view.state.field(editorFaultSession) === registeredSession;
    const indentation: NonNullable<CommandTargets["indentation"]> = {
      ready: () =>
        currentIndentationView() &&
        view.hasFocus &&
        !view.compositionStarted &&
        !view.composing,
      run: (more) => {
        if (
          !currentIndentationView() ||
          !view.hasFocus ||
          view.compositionStarted ||
          view.composing ||
          view.state.readOnly
        )
          return false;
        const plan = planSourceIndentation(view.state, more);
        if (plan.reason) {
          toast.info(plan.reason);
          return false;
        }
        if (!plan.changes?.length) return true;
        const transaction = view.state.update({
          changes: plan.changes,
          annotations: isolateHistory.of("full"),
          userEvent: "input.indent",
        });
        view.dispatch(transaction);
        return view.state === transaction.state;
      },
    };
    const folding: NonNullable<CommandTargets["folding"]> = {
      ready: (kind) => headingReady() &&
        (kind !== "frontmatter" || controller.getMode(documentId) === "editing"),
      run: (action) => toggleCurrentHeading(view, action),
    };
    const commandTargets = { sourceSelection, listInput, indentation, scheduleWrapping, folding };
    let releaseCommandTargets = controller.registerEditorCommandTargets(documentId, commandTargets);
    const viewportPosition = viewport && (recovery
      ? recoveredViewportEditorOffset(view.state.field(rawText), viewport.from)
      : editorOffset(editor.state.field(rawText), viewport.from));
    if (!recovery && viewportPosition !== undefined)
      view.dispatch({
        effects: EditorView.scrollIntoView(viewportPosition, { y: "start" }),
      });
    if (autoFocusOnMount && controller.shouldAutoFocusEditor(documentId)) view.focus();
    const searchTarget: Parameters<typeof controller.registerContentSearchTarget>[1] = {
      ready: () =>
        currentView() &&
        wrappingReady &&
        !controller.needsSourceWrapping(documentId) &&
        view.contentDOM.isConnected &&
        !view.compositionStarted &&
        !view.composing &&
        controller.getEditor(documentId)?.state === view.state,
      select: ({ from, to }, state) => {
        if (view.state !== state) return false;
        const selection = EditorSelection.single(from, to);
        const transaction = state.update({
          selection,
          effects: EditorView.scrollIntoView(selection.main, { y: "center" }),
          annotations: Transaction.addToHistory.of(false),
        });
        view.dispatch(transaction);
        return view.state === transaction.state;
      },
    };
    const quickFocusTarget = {
      ready: () => currentView() && view.contentDOM.isConnected && !view.compositionStarted && !view.composing && controller.getEditor(documentId)?.state === view.state,
      focus: () => view.focus(),
    };
    let contentSearch = controller.registerContentSearchTarget(documentId, searchTarget);
    let releaseQuickFocus = controller.registerQuickFocusTarget(documentId, quickFocusTarget);
    const refreshSession = (nextSession: EditorFaultSession) => {
      if (nextSession === registeredSession) return contentSearch.notifyReady;
      // The same EditorView can adopt a new session after a reload.
      clearScrollCheckpoint();
      viewportCapture.release();
      scrollCapture.release();
      releaseEditorDispatch();
      interaction.release();
      releaseCommandTargets();
      contentSearch.release();
      releaseQuickFocus();
      registeredSession = nextSession;
      scrollIntent = undefined;
      // Initial viewport measurement belongs to the old editor session.
      wrappingReady = true;
      viewportCapture = controller.registerViewportCapture(documentId, collectViewport);
      scrollCapture = controller.registerEditorScroll(documentId, collectScroll);
      releaseEditorDispatch = controller.registerEditorDispatch(documentId, dispatchOwnedTransaction);
      interaction = controller.registerEditorInteraction(documentId, checkInteraction);
      releaseCommandTargets = controller.registerEditorCommandTargets(documentId, commandTargets);
      contentSearch = controller.registerContentSearchTarget(documentId, searchTarget);
      releaseQuickFocus = controller.registerQuickFocusTarget(documentId, quickFocusTarget);
      return contentSearch.notifyReady;
    };
    refreshViewSession.current = refreshSession;
    let recoveryFrame: number | undefined;
    const readyAfterRecovery = () => {
      if (wrappingReady) return;
      wrappingReady = true;
      scheduleWrapping();
      contentSearch.notifyReady();
    };
    if (recovery) {
      const mounted = () => currentView() && view.scrollDOM.isConnected && view.state.field(editorFaultSession) === session;
      recoveryFrame = requestAnimationFrame(() => {
        recoveryFrame = undefined;
        if (!mounted()) return;
        const scroller = view.scrollDOM;
        try {
          if (!recovery.current(view.state) || !scroller.clientHeight) return;
          let anchor: number | undefined;
          if (viewportPosition !== undefined) {
            try {
              view.dispatch({ effects: EditorView.scrollIntoView(viewportPosition, { y: "start" }) });
              // The public geometry read flushes CodeMirror's queued anchor while the view is idle.
              if (mounted() && recovery.current(view.state) && view.coordsAtPos(viewportPosition))
                anchor = scroller.scrollTop + view.documentTop + view.lineBlockAt(viewportPosition).top -
                  scroller.getBoundingClientRect().top - recovery.position.offset;
            } catch { /* The actual scroll range remains available if anchor geometry fails. */ }
          }
          if (mounted() && recovery.consume(view.state))
            scroller.scrollTop = anchor ?? recovery.position.ratio * Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        } finally {
          if (mounted()) readyAfterRecovery();
        }
      });
    } else if (viewport && viewportPosition !== undefined) {
      const owner = contentSearch;
      const currentRestore = () => currentView() &&
        view.state.field(editorFaultSession) === session &&
        controller.getEditor(documentId)?.state.field(editorFaultSession) === session;
      view.requestMeasure({
        read: () => currentRestore() ? view.coordsAtPos(viewportPosition) : undefined,
        write: (rect) => {
          if (!currentRestore()) return;
          if (rect)
            view.scrollDOM.scrollTop +=
              rect.top -
              view.scrollDOM.getBoundingClientRect().top -
              viewport.offset;
          else
            view.scrollDOM.scrollTop =
              viewport.ratio *
              Math.max(
                0,
                view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight
              );
          wrappingReady = true;
          scheduleWrapping();
          owner.notifyReady();
        },
      });
    }
    const noteScrollIntent = (event: Event, direction?: 1 | -1) => {
      if (!event.isTrusted || event.defaultPrevented || !currentView() ||
        controller.getEditor(documentId)?.state !== view.state) return;
      const offset = view.scrollDOM.scrollTop;
      const movement = consumeScrollMovement(offset);
      if (movement) scrollCapture.savePosition(view.state, offset, true);
      if (movement?.checkpoint) armScrollCheckpoint();
      scrollIntent = {
        offset, direction, expires: performance.now() + 1000,
        checkpoint: checkpointOnScroll && !view.compositionStarted && !view.composing,
      };
      if (recovery?.consume(view.state)) {
        if (recoveryFrame !== undefined) cancelAnimationFrame(recoveryFrame);
        recoveryFrame = undefined;
        readyAfterRecovery();
      }
    };
    const wheelIntent = (event: WheelEvent) => {
      if (event.deltaY && !event.ctrlKey) noteScrollIntent(event, event.deltaY < 0 ? -1 : 1);
    };
    const keyboardIntent = (event: KeyboardEvent) => {
      if (event.isComposing || view.compositionStarted) return;
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) noteScrollIntent(event, -1);
      else if (["ArrowDown", "PageDown", "End"].includes(event.key)) noteScrollIntent(event, 1);
    };
    const scrollbarIntent = (event: PointerEvent) => {
      const scroller = view.scrollDOM;
      if (event.isPrimary && event.button === 0 && event.target === scroller &&
        event.clientX >= scroller.getBoundingClientRect().left + scroller.clientLeft + scroller.clientWidth)
        noteScrollIntent(event);
    };
    const trackScrollIntent = checkpointOnScroll || scrollCapture.requiresUserMovement;
    if (trackScrollIntent) {
      view.scrollDOM.addEventListener("wheel", wheelIntent, { capture: true, passive: true });
      view.scrollDOM.addEventListener("keydown", keyboardIntent, true);
      view.scrollDOM.addEventListener("pointerdown", scrollbarIntent, true);
    }
    const saveScroll = () => {
      if (view.scrollDOM.isConnected) {
        const offset = view.scrollDOM.scrollTop;
        const movement = consumeScrollMovement(offset);
        scrollCapture.savePosition(view.state, offset, !!movement);
        return movement;
      }
    };
    const onScroll = () => {
      const movement = saveScroll();
      if (movement?.checkpoint || scrollCheckpointTimer !== undefined) armScrollCheckpoint();
    };
    view.scrollDOM.addEventListener("scroll", onScroll);
    const listKey = (event: KeyboardEvent) =>
      routeListInput(
        event,
        controller.getMode(documentId) !== "reading" &&
          !controller.isSafeSource(documentId),
        controller.canRunListInput(),
        view.compositionStarted || view.composing,
        documentId,
        executeCommand
      );
    const removeListInput = registerListInputView(
      view,
      (event) => currentView() && listKey(event)
    );
    const removeIndentation = registerIndentationView(
      view,
      (event) =>
        currentView() &&
        (routeSourceTabFocus(
          event,
          view,
          currentIndentationView() &&
            isOrdinaryIndentation(
              controller.getMode(documentId),
              controller.isSafeSource(documentId)
            )
        ) ||
          routeIndentationInput(
            event,
            isOrdinaryIndentation(
              controller.getMode(documentId),
              controller.isSafeSource(documentId)
            ),
            controller.canIndentSource(),
            view.compositionStarted || view.composing,
            documentId,
            executeCommand
          ))
    );
    const sourceSelectionKey = (event: KeyboardEvent) => {
      routeSourceSelectionKey(
        event,
        isOrdinarySourceSelection(
          controller.getMode(documentId),
          controller.isSafeSource(documentId)
        ),
        controller.canRunSourceSelection(),
        documentId,
        executeCommand,
        view.compositionStarted
      );
    };
    const sourceSelectionMouse = (event: MouseEvent) => {
      guardSourceSelectionMouse(
        event,
        isOrdinarySourceSelection(
          controller.getMode(documentId),
          controller.isSafeSource(documentId)
        ),
        currentView() && controller.canSelectSource(documentId)
      );
    };
    view.contentDOM.addEventListener("keydown", sourceSelectionKey, true);
    view.contentDOM.addEventListener("mousedown", sourceSelectionMouse, true);
    scheduleWrapping();
    const historyKey = (event: KeyboardEvent) => {
      if (
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey ||
        event.key.toLowerCase() !== "z" ||
        event.isComposing ||
        view.compositionStarted
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      executeCommand({
        type: event.shiftKey ? "redoDocument" : "undoDocument",
        args: { documentId },
      });
    };
    view.contentDOM.addEventListener("keydown", historyKey, true);
    const historyInput = (event: InputEvent) =>
      routeHistoryInput(
        event,
        view.compositionStarted,
        documentId,
        executeCommand
      );
    view.contentDOM.addEventListener("beforeinput", historyInput, true);
    const compositionChanged = (event: CompositionEvent) => {
      if (event.type === "compositionstart") {
        clearScrollCheckpoint();
        if (scrollIntent) scrollIntent.checkpoint = false;
      }
      const owner = interaction;
      setTimeout(() => {
        if (!currentView()) return;
        owner.notify();
      }, 0);
    };
    view.contentDOM.addEventListener("compositionstart", compositionChanged);
    view.contentDOM.addEventListener("compositionend", compositionChanged);
    return () => {
      alive = false;
      clearScrollCheckpoint();
      raster.dispose();
      checkRaster.current = undefined;
      releaseRasterCheck();
      view.contentDOM.removeEventListener("paste", pasteRaster, true);
      view.contentDOM.removeEventListener("compositionstart", raster.invalidate, true);
      view.contentDOM.removeEventListener("blur", raster.invalidate, true);
      view.dom.ownerDocument.defaultView?.removeEventListener("blur", raster.invalidate);
      contentSearch.release();
      releaseQuickFocus();
      removeEmojiCompletion();
      removeCallout();
      removeImages();
      toast.dismiss(imageToast);
      toast.dismiss(calloutToast);
      removeTask();
      removeHeading();
      view.contentDOM.removeEventListener("keydown", headingKey, true);
      removePairing();
      removeFormat();
      removeNativeFormat();
      removeListInput();
      removeIndentation();
      if (recoveryFrame !== undefined) cancelAnimationFrame(recoveryFrame);
      viewportCapture.capture();
      viewportCapture.release();
      if (refreshViewSession.current === refreshSession)
        refreshViewSession.current = null;
      saveScroll();
      scrollCapture.captureSnapshot();
      scrollCapture.release();
      interaction.release();
      releaseEditorDispatch();
      releaseCommandTargets();
      view.contentDOM.removeEventListener("keydown", sourceSelectionKey, true);
      view.contentDOM.removeEventListener(
        "mousedown",
        sourceSelectionMouse,
        true
      );
      view.contentDOM.removeEventListener("keydown", historyKey, true);
      view.contentDOM.removeEventListener("beforeinput", historyInput, true);
      view.contentDOM.removeEventListener(
        "compositionstart",
        compositionChanged
      );
      view.contentDOM.removeEventListener("compositionend", compositionChanged);
      if (trackScrollIntent) {
        view.scrollDOM.removeEventListener("wheel", wheelIntent, true);
        view.scrollDOM.removeEventListener("keydown", keyboardIntent, true);
        view.scrollDOM.removeEventListener("pointerdown", scrollbarIntent, true);
      }
      view.scrollDOM.removeEventListener("scroll", onScroll);
      view.destroy();
      viewRef.current = null;
    };
    // A new view only on document switch; transactions preserve its DOM/IME.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, documentId, mountAttempt, checkpointOnScroll]);
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const next = preserveViewportOnSync ? controller.getEditor(documentId)?.state : undefined;
    const previous = view.state;
    let scroll: ReturnType<EditorView["scrollSnapshot"]> | undefined;
    if (next && next !== previous && next.doc === previous.doc && view.scrollDOM.isConnected &&
        next.field(editorFaultSession) === previous.field(editorFaultSession)) {
      try {
        scroll = view.scrollSnapshot();
      } catch {
        // State synchronization still applies when old geometry is unavailable.
      }
    }
    const current = syncCurrentEditorState(view, controller, documentId);
    if (!current) return;
    if (scroll && current === next && view.state === current && view.scrollDOM.isConnected &&
        controller.getEditor(documentId)?.state === current) {
      view.dispatch({ effects: scroll, annotations: Transaction.addToHistory.of(false) });
    }
    const fault = current.field(editorFaultSession);
    const notifySearchReady = refreshViewSession.current?.(fault);
    if (
      view.state.facet(EditorState.readOnly) !== readOnly ||
      view.state.facet(EditorView.editable) !== !readOnly
    )
      view.dispatch({
        effects: editorPermissionEffect(readOnly),
      });
    view.contentDOM.contentEditable = String(
      editorSurfaceEditable(
        readOnly || view.state.readOnly,
        frozen,
        inputBlocked
      )
    );
    view.contentDOM.setAttribute(
      "aria-readonly",
      String(frozen || inputBlocked || readOnly)
    );
    view.contentDOM.setAttribute(
      "aria-label",
      controller.getMode(documentId) === "source"
        ? "Markdown 源码编辑区"
        : "Markdown 编辑区"
    );
    const searchable =
      controller.getMode(documentId) === "source" &&
      !controller.isSafeSource(documentId) &&
      !fault.fault;
    setSearchSlot((old) =>
      searchable
        ? old?.view === view && old.session === fault
          ? old
          : { view, session: fault }
        : null
    );
    notifySearchReady?.();
  }, [controller, documentId, editor, frozen, readOnly, inputBlocked, preserveViewportOnSync]);
  return (
    <>
      <EditingCodeMenu
        controller={controller}
        documentId={documentId}
        getView={() => viewRef.current}
      >
        <div
          ref={container}
          className="min-h-0 flex-1 overflow-hidden rounded-md border"
        />
      </EditingCodeMenu>
      {searchSlot?.view.dom.dataset.documentEditor === documentId &&
        searchSlot.session === editor?.state.field(editorFaultSession) &&
        controller.getMode(documentId) === "source" &&
        !controller.isSafeSource(documentId) && (
          <SourceSearch
            key={documentId}
            controller={controller}
            documentId={documentId}
            view={searchSlot.view}
            isMounted={() => viewRef.current === searchSlot.view}
          />
        )}
    </>
  );
}
