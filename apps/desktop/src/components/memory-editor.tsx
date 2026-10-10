import {
  addCursorAbove,
  addCursorBelow,
  simplifySelection,
  isolateHistory,
} from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { registerPairingView } from "@/client/contextual-pairing";
import type { createDocumentController } from "@/client/documents";
import {
  editorFaultSession,
  type EditorFaultSession,
} from "@/client/editor-fault";
import { syncCurrentEditorState } from "@/client/editor-view-sync";
import { routeHistoryInput } from "@/client/history-input";
import { registerFormatView } from "@/client/inline-format-input";
import { listContinuationTransaction } from "@/client/list-continuation";
import { registerListInputView, routeListInput } from "@/client/list-input";
import {
  editorOffset,
  rawOffset,
  rawText,
  writePermission,
} from "@/client/raw-buffer";
import { planSourceIndentation } from "@/client/source-indentation";
import {
  registerIndentationView,
  routeIndentationInput,
  routeSourceTabFocus,
} from "@/client/source-indentation-input";
import {
  guardSourceSelectionMouse,
  isOrdinarySourceSelection,
  routeSourceSelectionKey,
} from "@/client/source-selection-input";
import { deferWrappingUpdate } from "@/client/wrapping-measure";
import { useCommands } from "@/commands";

import { SourceSearch } from "./source-search";

export function MemoryEditor({
  controller,
  documentId,
  frozen,
}: {
  controller: ReturnType<typeof createDocumentController>;
  documentId: string;
  frozen: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [searchSlot, setSearchSlot] = useState<{
    view: EditorView;
    session: EditorFaultSession;
  } | null>(null);
  const faultSessionRef = useRef<EditorFaultSession | null>(null);
  const recoverRef = useRef<(() => void) | undefined>(undefined);
  const editor = controller.getEditor(documentId);
  const readOnly = !controller.canWrite(documentId);
  const inputBlocked = controller.isEditorInputBlocked();
  const { executeCommand } = useCommands();
  useLayoutEffect(() => {
    if (!container.current || !editor) return;
    const scrollTo = controller.getScrollSnapshot(documentId);
    const session = editor.state.field(editorFaultSession);
    let alive = true;
    const recover = () => {
      // Prefer the accepted controller state, not a potentially lagging view.
      const currentSession = controller.getEditorFault(documentId);
      if (alive && currentSession?.fault && !view.compositionStarted)
        controller.enterSafeSource(documentId, currentSession);
    };
    const view = new EditorView({
      state: editor.state,
      parent: container.current,
      scrollTo,
      dispatchTransactions(transactions) {
        for (const transaction of transactions) {
          if (controller.updateEditor(documentId, transaction))
            view.update([transaction]);
        }
      },
    });
    session.notify = recover;
    faultSessionRef.current = session;
    recoverRef.current = recover;
    queueMicrotask(recover);
    viewRef.current = view;
    view.dom.dataset.documentEditor = documentId;
    controller.setHistoryDispatch((transaction) => view.dispatch(transaction));
    controller.setScrollCapture(() => view.scrollSnapshot());
    view.contentDOM.setAttribute("aria-label", "Markdown 编辑区");
    if (!scrollTo)
      view.scrollDOM.scrollTop = controller.getScrollPosition(documentId);
    const captureViewport = () => {
      const top = view.scrollDOM.getBoundingClientRect().top;
      const block = view.lineBlockAtHeight(Math.max(0, top - view.documentTop));
      const current = controller.getEditor(documentId);
      if (current)
        controller.setViewport(documentId, {
          from: rawOffset(current.state.field(rawText), block.from),
          offset: view.documentTop + block.top - top,
          ratio:
            view.scrollDOM.scrollTop /
            Math.max(
              1,
              view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight
            ),
          revision: current.revision,
        });
    };
    controller.setViewportCapture(captureViewport);
    const viewport = controller.getViewport(documentId);
    let wrappingReady = !viewport;
    const currentView = () =>
      alive &&
      viewRef.current === view &&
      controller.getSnapshot().snapshot?.documentId === documentId;
    const removePairing = registerPairingView(view, () => {
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
    });
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
    controller.setWrappingScheduler(scheduleWrapping);
    if (viewport) {
      const position = editorOffset(editor.state.field(rawText), viewport.from);
      view.dispatch({
        effects: EditorView.scrollIntoView(position, { y: "start" }),
      });
      view.requestMeasure({
        read: () => view.coordsAtPos(position),
        write: (rect) => {
          if (!currentView()) return;
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
        },
      });
    }
    view.focus();
    const saveScroll = () =>
      controller.setScrollPosition(documentId, view.scrollDOM.scrollTop);
    view.scrollDOM.addEventListener("scroll", saveScroll);
    controller.setInteractionCheck(() => !view.compositionStarted);
    controller.setSourceSelectionTarget({
      documentId,
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
    });
    controller.setListInputTarget({
      documentId,
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
        const transaction = listContinuationTransaction(view.state, soft);
        view.dispatch(transaction);
        return view.state === transaction.state;
      },
    });
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
    const currentIndentationView = () =>
      currentView() &&
      controller.getEditor(documentId)?.state === view.state &&
      view.state.field(editorFaultSession) === session;
    controller.setIndentationTarget({
      documentId,
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
    });
    const removeIndentation = registerIndentationView(
      view,
      (event) =>
        currentView() &&
        (routeSourceTabFocus(
          event,
          view,
          currentIndentationView() &&
            controller.getMode(documentId) === "source" &&
            !controller.isSafeSource(documentId)
        ) ||
          routeIndentationInput(
            event,
            controller.getMode(documentId) === "source" &&
              !controller.isSafeSource(documentId),
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
    const compositionChanged = () =>
      setTimeout(() => {
        if (!currentView()) return;
        controller.notifyInteraction();
        recover();
      }, 0);
    view.contentDOM.addEventListener("compositionstart", compositionChanged);
    view.contentDOM.addEventListener("compositionend", compositionChanged);
    return () => {
      alive = false;
      removePairing();
      removeFormat();
      removeListInput();
      removeIndentation();
      if (faultSessionRef.current) faultSessionRef.current.notify = undefined;
      faultSessionRef.current = null;
      recoverRef.current = undefined;
      captureViewport();
      controller.setViewportCapture(undefined);
      saveScroll();
      controller.setScrollSnapshot(
        documentId,
        view.state.doc,
        view.scrollSnapshot()
      );
      controller.setInteractionCheck(() => true);
      controller.setHistoryDispatch(undefined);
      controller.setSourceSelectionTarget(undefined);
      controller.setListInputTarget(undefined);
      controller.setIndentationTarget(undefined);
      view.contentDOM.removeEventListener("keydown", sourceSelectionKey, true);
      view.contentDOM.removeEventListener(
        "mousedown",
        sourceSelectionMouse,
        true
      );
      controller.setScrollCapture(undefined);
      controller.setWrappingScheduler(undefined);
      view.contentDOM.removeEventListener("keydown", historyKey, true);
      view.contentDOM.removeEventListener("beforeinput", historyInput, true);
      view.contentDOM.removeEventListener(
        "compositionstart",
        compositionChanged
      );
      view.contentDOM.removeEventListener("compositionend", compositionChanged);
      view.scrollDOM.removeEventListener("scroll", saveScroll);
      view.destroy();
      viewRef.current = null;
    };
    // A new view only on document switch; transactions preserve its DOM/IME.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, documentId]);
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = syncCurrentEditorState(view, controller, documentId);
    if (!current) return;
    const fault = current.field(editorFaultSession);
    if (faultSessionRef.current !== fault) {
      if (faultSessionRef.current) faultSessionRef.current.notify = undefined;
      faultSessionRef.current = fault;
      fault.notify = recoverRef.current;
    }
    if (fault.fault) queueMicrotask(() => fault.notify?.());
    if (view.state.facet(EditorState.readOnly) !== readOnly)
      view.dispatch({
        effects: writePermission.reconfigure(EditorState.readOnly.of(readOnly)),
      });
    view.contentDOM.contentEditable = frozen || inputBlocked ? "false" : "true";
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
  }, [controller, documentId, editor, frozen, readOnly, inputBlocked]);
  return (
    <>
      <div
        ref={container}
        className="min-h-0 flex-1 overflow-hidden rounded-md border"
      />
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
