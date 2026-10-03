import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { createDocumentCanonical } from "@/client/document-canonical";
import type { createDocumentController } from "@/client/documents";
import { rawText } from "@/client/raw-buffer";
import { firstReadingBlock } from "@/client/reading-position";
import {
  auditReadingContent,
  commonmarkContent,
} from "@/security/commonmark-content";

export function ReadingView({
  controller,
  canonical,
  documentId,
  frozen,
}: {
  controller: ReturnType<typeof createDocumentController>;
  canonical: ReturnType<typeof createDocumentCanonical>;
  documentId: string;
  frozen: boolean;
}) {
  const state = useSyncExternalStore(
    canonical.subscribe,
    canonical.getSnapshot
  );
  const editor = controller.getEditor(documentId)!;
  const session = controller.getEditorFault(documentId);
  const raw = editor.state.field(rawText);
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [audit, setAudit] = useState("尚未检查");
  const diagnostic =
    (
      globalThis as typeof globalThis & {
        __AGENTIC_MARKDOWN_EDITOR_FAULT_LAB__?: boolean;
      }
    ).__AGENTIC_MARKDOWN_EDITOR_FAULT_LAB__ === true;
  const ready =
    state.status === "ready" &&
    canonical.isCurrent(state.result) &&
    state.result.documentId === documentId &&
    state.result.revision === editor.revision;
  const nodes = useMemo(
    () =>
      ready && state.status === "ready"
        ? commonmarkContent(state.result.tree, raw)
        : null,
    [ready, state, raw]
  );
  useEffect(() => {
    if (!frozen) void canonical.request();
    return () => canonical.cancel();
  }, [canonical, documentId, editor.revision, session, frozen]);
  useLayoutEffect(() => {
    const scroller = container.current;
    if (!scroller || !ready) return;
    const saved = controller.getViewport(documentId);
    const blocks = [
      ...scroller.querySelectorAll<HTMLElement>("[data-reading-from]"),
    ];
    if (saved) {
      const target =
        blocks[
          firstReadingBlock(
            blocks.length,
            (index) => Number(blocks[index].dataset.readingTo) >= saved.from
          )
        ];
      if (target)
        scroller.scrollTop +=
          target.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          saved.offset;
      else
        scroller.scrollTop =
          saved.ratio *
          Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    }
    scroller.focus({ preventScroll: true });
    const capture = () => {
      const top = scroller.getBoundingClientRect().top;
      const block =
        blocks[
          firstReadingBlock(
            blocks.length,
            (index) => blocks[index].getBoundingClientRect().bottom > top
          )
        ];
      controller.setViewport(documentId, {
        from: Number(block?.dataset.readingFrom ?? 0),
        offset: block ? block.getBoundingClientRect().top - top : 0,
        revision: editor.revision,
        ratio:
          scroller.scrollTop /
          Math.max(1, scroller.scrollHeight - scroller.clientHeight),
      });
    };
    controller.setViewportCapture(capture);
    if (diagnostic && content.current) {
      const report = auditReadingContent(content.current);
      setAudit(
        `${report.safe && !scroller.querySelector(".cm-editor,[contenteditable]") ? "通过" : "失败"} · ${report.elements} 个受控元素 · 无编辑 DOM · revision ${editor.revision}`
      );
    }
    return () => {
      capture();
      controller.setViewportCapture(undefined);
    };
  }, [controller, documentId, editor.revision, ready, nodes, diagnostic]);
  return (
    <div
      ref={container}
      tabIndex={0}
      aria-label="Markdown 阅读区"
      className="bg-background text-foreground min-h-0 flex-1 overflow-auto rounded border p-5 break-words focus-visible:outline-2"
    >
      {diagnostic && (
        <p role="status" className="text-muted-foreground text-xs">
          阅读 DOM 审计：{ready ? audit : "无当前呈现"}
        </p>
      )}
      {ready ? (
        <div
          ref={content}
          onClick={(event) => event.preventDefault()}
          onAuxClick={(event) => event.preventDefault()}
          onDragStart={(event) => event.preventDefault()}
          onSubmit={(event) => event.preventDefault()}
        >
          {nodes}
        </div>
      ) : (
        <div>
          <p role="status">
            {frozen
              ? "文档操作进行中"
              : state.status === "failed"
                ? "阅读解析失败；原文已保留，可切回编辑重试。"
                : state.status === "idle"
                  ? "阅读解析尚未完成或已取消，可重新尝试。"
                  : "正在准备阅读内容…"}
          </p>
          {!frozen &&
            (state.status === "idle" || state.status === "failed") && (
              <button
                className="rounded border px-3 py-2 focus-visible:outline-2"
                onClick={() => void canonical.request()}
              >
                重新解析阅读内容
              </button>
            )}
          {state.status === "failed" && (
            <pre className="break-words whitespace-pre-wrap">{raw}</pre>
          )}
        </div>
      )}
    </div>
  );
}
