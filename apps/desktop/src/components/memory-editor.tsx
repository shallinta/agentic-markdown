import { EditorView } from "@codemirror/view";
import { useLayoutEffect, useRef } from "react";

import type { createDocumentController } from "@/client/documents";

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
  const editor = controller.getEditor(documentId);
  useLayoutEffect(() => {
    if (!container.current || !editor) return;
    const scrollTo = controller.getScrollSnapshot(documentId);
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
    viewRef.current = view;
    view.contentDOM.setAttribute("aria-label", "原文编辑验证入口");
    if (!scrollTo)
      view.scrollDOM.scrollTop = controller.getScrollPosition(documentId);
    const saveScroll = () =>
      controller.setScrollPosition(documentId, view.scrollDOM.scrollTop);
    view.scrollDOM.addEventListener("scroll", saveScroll);
    controller.setInteractionCheck(() => !view.compositionStarted);
    return () => {
      saveScroll();
      controller.setScrollSnapshot(
        documentId,
        view.state.doc,
        view.scrollSnapshot()
      );
      controller.setInteractionCheck(() => true);
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
    view.contentDOM.contentEditable = frozen ? "false" : "true";
    view.contentDOM.setAttribute("aria-readonly", String(frozen));
  }, [editor, frozen]);
  return (
    <div
      ref={container}
      className="min-h-0 flex-1 overflow-hidden rounded-md border"
    />
  );
}
