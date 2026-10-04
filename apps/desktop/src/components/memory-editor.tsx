import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useLayoutEffect, useRef } from "react";

import type { createDocumentController } from "@/client/documents";
import {
  editorFaultSession,
  type EditorFaultSession,
} from "@/client/editor-fault";
import { routeHistoryInput } from "@/client/history-input";
import {
  editorOffset,
  rawOffset,
  rawText,
  writePermission,
} from "@/client/raw-buffer";
import { useCommands } from "@/commands";

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
    if (viewport) {
      const position = editorOffset(editor.state.field(rawText), viewport.from);
      view.dispatch({
        effects: EditorView.scrollIntoView(position, { y: "start" }),
      });
      view.requestMeasure({
        read: () => view.coordsAtPos(position),
        write: (rect) => {
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
        },
      });
    }
    view.focus();
    const saveScroll = () =>
      controller.setScrollPosition(documentId, view.scrollDOM.scrollTop);
    view.scrollDOM.addEventListener("scroll", saveScroll);
    controller.setInteractionCheck(() => !view.compositionStarted);
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
        controller.notifyInteraction();
        recover();
      }, 0);
    view.contentDOM.addEventListener("compositionstart", compositionChanged);
    view.contentDOM.addEventListener("compositionend", compositionChanged);
    return () => {
      alive = false;
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
      controller.setScrollCapture(undefined);
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
    if (!view || !editor) return;
    if (view.state !== editor.state) view.setState(editor.state);
    const fault = editor.state.field(editorFaultSession);
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
  }, [controller, documentId, editor, frozen, readOnly, inputBlocked]);
  return (
    <div
      ref={container}
      className="min-h-0 flex-1 overflow-hidden rounded-md border"
    />
  );
}
