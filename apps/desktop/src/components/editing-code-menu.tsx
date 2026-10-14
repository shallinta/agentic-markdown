import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@agentic-markdown/ui/ui/context-menu";
import type { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { codeCopyTarget } from "@/client/code-copy-target";
import { guardCodeMenuInput } from "@/client/code-menu-input";
import CurrentCanonicalWorker from "@/client/current-canonical.worker?worker&inline";
import { createDocumentCanonical } from "@/client/document-canonical";
import type { createDocumentController } from "@/client/documents";
import {
  createEditingCodeCopy,
  type CodeMenuStatus,
} from "@/client/editing-code-copy";
import { editorFaultSession } from "@/client/editor-fault";
import { rawText } from "@/client/raw-buffer";
import { writeCodeClipboard } from "@/client/reading-code-copy";

export function EditingCodeMenu({
  children,
  controller,
  documentId,
  getView,
}: {
  children: ReactNode;
  controller: ReturnType<typeof createDocumentController>;
  documentId: string;
  getView: () => EditorView | null;
}) {
  const [open, setOpen] = useState(false),
    [status, setStatus] = useState<CodeMenuStatus>("preparing");
  const owner = useRef<ReturnType<typeof createEditingCodeCopy> | null>(null),
    outside = useRef(false);
  const menu = useRef<HTMLDivElement | null>(null),
    openRef = useRef(false);
  const removeInput = useRef<(() => void) | null>(null);
  function allowed() {
    const view = getView(),
      snapshot = controller.getSnapshot(),
      editor = controller.getEditor(documentId);
    return view &&
      editor?.state === view.state &&
      snapshot.snapshot?.documentId === documentId &&
      !snapshot.busy &&
      !snapshot.frozen &&
      !controller.isEditorInputBlocked() &&
      !view.composing &&
      !view.compositionStarted &&
      !view.state.field(editorFaultSession).fault &&
      controller.getMode(documentId) === "editing" &&
      !controller.isSafeSource(documentId)
      ? view
      : null;
  }
  useEffect(() => {
    const current = createEditingCodeCopy(
      createDocumentCanonical(controller, () => new CurrentCanonicalWorker()),
      writeCodeClipboard,
      setStatus,
      (result) => {
        if (result === "success") toast.success("已复制", { duration: 1800 });
        if (result === "failed") toast.error("复制失败，请重新打开菜单重试");
      }
    );
    owner.current = current;
    let alive = true;
    const remove = controller.subscribe(() => {
      queueMicrotask(() => {
        if (alive && !current.valid()) {
          openRef.current = false;
          removeInput.current?.();
          removeInput.current = null;
          current.invalidate();
          setOpen(false);
        }
      });
    });
    return () => {
      alive = false;
      openRef.current = false;
      removeInput.current?.();
      removeInput.current = null;
      remove();
      current.dispose();
      if (owner.current === current) owner.current = null;
    };
  }, [controller]);
  return (
    <ContextMenu
      modal={false}
      open={open}
      onOpenChange={(value) => {
        openRef.current = value;
        setOpen(value);
        if (!value) {
          removeInput.current?.();
          removeInput.current = null;
          owner.current?.close();
        }
      }}
    >
      <div
        className="contents"
        onPointerDownCapture={(event) => {
          if (event.button !== 2 && !(event.button === 0 && event.ctrlKey))
            return;
          const view = allowed();
          if (view && codeCopyTarget(view, event.clientX, event.clientY))
            event.preventDefault();
        }}
        onContextMenuCapture={(event) => {
          const view = allowed(),
            target = view && codeCopyTarget(view, event.clientX, event.clientY);
          if (!view || !target) {
            openRef.current = false;
            removeInput.current?.();
            removeInput.current = null;
            owner.current?.invalidate();
            setOpen(false);
            event.stopPropagation();
            return;
          }
          outside.current = false;
          const editor = controller.getEditor(documentId)!,
            doc = view.state.doc,
            raw = view.state.field(rawText),
            session = view.state.field(editorFaultSession),
            revision = editor.revision;
          owner.current?.open({
            target,
            raw,
            valid: () => {
              const now = allowed(),
                current = controller.getEditor(documentId);
              return (
                now === view &&
                current?.revision === revision &&
                view.state.doc === doc &&
                view.state.field(rawText) === raw &&
                view.state.field(editorFaultSession) === session
              );
            },
          });
          removeInput.current?.();
          const inputOwner = owner.current;
          const guard = (event: InputEvent) => {
            const current =
              owner.current === inputOwner &&
              !!inputOwner?.valid() &&
              allowed() === view;
            if (!current) {
              view.contentDOM.removeEventListener("beforeinput", guard, true);
              return;
            }
            guardCodeMenuInput(event, {
              open: openRef.current,
              current,
              menu: menu.current,
              editor: view.contentDOM,
              activeElement: view.dom.ownerDocument.activeElement,
            });
          };
          view.contentDOM.addEventListener("beforeinput", guard, true);
          removeInput.current = () =>
            view.contentDOM.removeEventListener("beforeinput", guard, true);
        }}
      >
        <ContextMenuTrigger asChild className="select-text">
          {children}
        </ContextMenuTrigger>
      </div>
      <ContextMenuContent
        ref={menu}
        onInteractOutside={() => {
          outside.current = true;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!outside.current && owner.current?.valid()) getView()?.focus();
        }}
      >
        <ContextMenuItem
          disabled={status === "preparing"}
          onSelect={(event) => {
            if (status === "failed") {
              event.preventDefault();
              owner.current?.retry();
              return;
            }
            owner.current?.select();
          }}
        >
          {status === "preparing"
            ? "正在准备代码内容…"
            : status === "failed"
              ? "准备失败，重新准备"
              : "复制代码块内容"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
