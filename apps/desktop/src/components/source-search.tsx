import { Prec, StateEffect, Transaction } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
} from "@codemirror/view";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import type { createDocumentController } from "@/client/documents";
import { editorFaultSession } from "@/client/editor-fault";
import { rawText, sourceSearchPresentation } from "@/client/raw-buffer";
import {
  createSearchOwner,
  type SearchStatus,
} from "@/client/source-search-owner";
import type { SearchResult } from "@/client/source-search-protocol";
import { SEARCH_LIMIT } from "@/client/source-search-protocol";
import {
  searchDecorations,
  routeSearchQueryKey,
} from "@/client/source-search-view";
import SearchWorker from "@/client/source-search.worker?worker&inline";
import { useCommands, useRegisterCommands } from "@/commands";

const redraw = StateEffect.define<null>();
const emptyMarks = Decoration.none;
export function SourceSearch({
  controller,
  documentId,
  view,
  isMounted,
}: {
  controller: ReturnType<typeof createDocumentController>;
  documentId: string;
  view: EditorView;
  isMounted: () => boolean;
}) {
  const store = controller.search;
  const conditions = useSyncExternalStore(store.subscribe, () =>
    store.get(documentId)
  );
  useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [draft, setDraft] = useState(conditions.query);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [result, setResult] = useState<SearchResult | null>(null);
  const owner = useRef<ReturnType<typeof createSearchOwner> | null>(null);
  const sync = useRef<() => void>(() => undefined);
  const { executeCommand } = useCommands();
  const controllerText = controller.getEditor(documentId)?.state.doc;
  const controllerSession = controller
    .getEditor(documentId)
    ?.state.field(editorFaultSession);
  const mode = controller.getMode(documentId);
  const safe = controller.isSafeSource(documentId);
  const allowed = () =>
    isMounted() &&
    controller.getSnapshot().snapshot?.documentId === documentId &&
    controller.getEditor(documentId)?.state.doc === view.state.doc &&
    controller.getEditor(documentId)?.state.field(editorFaultSession) ===
      view.state.field(editorFaultSession) &&
    controller.getMode(documentId) === "source" &&
    !controller.isSafeSource(documentId) &&
    !controller.getEditorFault(documentId)?.fault;
  const interaction = () =>
    allowed() &&
    !controller.getSnapshot().frozen &&
    !controller.getSnapshot().busy &&
    !controller.isEditorInputBlocked() &&
    !view.compositionStarted &&
    !composing.current;
  const open = () => {
    if (!interaction()) return;
    store.set(documentId, { open: true });
    queueMicrotask(() => input.current?.focus());
  };
  const close = () => {
    if (!interaction()) return;
    store.set(documentId, { open: false });
    owner.current?.cancel();
    view.focus();
  };
  useRegisterCommands(
    {
      openSourceSearch: open,
      closeSourceSearch: close,
      nextSourceMatch: () => owner.current?.navigate(1),
      previousSourceMatch: () => owner.current?.navigate(-1),
    },
    true,
    {
      openSourceSearch: () =>
        interaction() &&
        (view.hasFocus || input.current === document.activeElement),
      closeSourceSearch: () => interaction() && store.get(documentId).open,
      nextSourceMatch: () =>
        interaction() &&
        store.get(documentId).open &&
        status === "ready" &&
        !!result?.count,
      previousSourceMatch: () =>
        interaction() &&
        store.get(documentId).open &&
        status === "ready" &&
        !!result?.count,
    }
  );
  useLayoutEffect(() => {
    let alive = true;
    let marks: DecorationSet = emptyMarks;
    let lastText: object | undefined,
      lastSession: object | undefined,
      lastQuery = "";
    const valid = () => alive && allowed();
    const paint = () => {
      if (alive && isMounted())
        view.dispatch({
          effects: redraw.of(null),
          annotations: Transaction.addToHistory.of(false),
        });
    };
    const viewport = () => {
      if (!valid()) return;
      owner.current?.viewport(
        Math.max(0, (view.visibleRanges[0]?.from ?? view.viewport.from) - 1000),
        Math.min(
          view.state.doc.length,
          (view.visibleRanges[view.visibleRanges.length - 1]?.to ??
            view.viewport.to) + 1000
        )
      );
    };
    const workerOwner = createSearchOwner(
      () => new SearchWorker(),
      () =>
        valid() && store.get(documentId).open
          ? {
              session: view.state.field(editorFaultSession),
              textIdentity: view.state.doc,
              raw: view.state.field(rawText),
              length: view.state.doc.length,
              queryKey: JSON.stringify([
                store.get(documentId).query,
                store.get(documentId).caseSensitive,
                store.get(documentId).wholeWord,
              ]),
            }
          : null,
      (response) => {
        if (!valid()) return;
        setResult(response);
        if (response.kind === "scan") {
          if (response.current)
            store.set(documentId, { position: response.current[0] });
          viewport();
          return;
        }
        if (response.kind === "navigate") {
          if (response.current && interaction()) {
            const [anchor, head] = response.current;
            store.set(documentId, { position: anchor });
            view.dispatch({
              selection: { anchor, head },
              scrollIntoView: true,
              annotations: Transaction.addToHistory.of(false),
            });
          }
          viewport();
          return;
        }
        marks = searchDecorations(response, view.visibleRanges);
        paint();
      },
      (value) => {
        if (alive) {
          setStatus(value);
          if (value === "failed") lastText = undefined;
          if (value !== "ready") {
            setResult(null);
            marks = emptyMarks;
            queueMicrotask(paint);
          }
        }
      }
    );
    owner.current = workerOwner;
    const synchronize = () => {
      if (!alive) return;
      const c = store.get(documentId);
      if (!valid() || !c.open || !c.query) {
        lastText = lastSession = undefined;
        lastQuery = "";
        workerOwner.cancel();
        return;
      }
      const signature = JSON.stringify([c.query, c.caseSensitive, c.wholeWord]);
      const session = view.state.field(editorFaultSession);
      if (
        lastText !== view.state.doc ||
        lastSession !== session ||
        lastQuery !== signature
      ) {
        lastText = view.state.doc;
        lastSession = session;
        lastQuery = signature;
        workerOwner.scan(c, c.position ?? view.state.selection.main.head);
      }
    };
    sync.current = synchronize;
    const plugin = ViewPlugin.fromClass(
      class {
        decorations = marks;
        update(update: import("@codemirror/view").ViewUpdate) {
          this.decorations = update.docChanged ? emptyMarks : marks;
          if (update.docChanged) {
            marks = emptyMarks;
            queueMicrotask(synchronize);
          } else if (update.viewportChanged) queueMicrotask(viewport);
        }
      },
      { decorations: (plugin) => plugin.decorations }
    );
    const extension = [
      plugin,
      Prec.high(
        keymap.of([
          {
            key: "Mod-f",
            run: () => {
              if (!valid() || view.compositionStarted) return false;
              executeCommand({ type: "openSourceSearch", args: {} });
              return true;
            },
          },
        ])
      ),
      EditorView.baseTheme({
        ".cm-sourceSearch-match": {
          backgroundColor: "#d59d2944",
          outline: "1px solid #b5802566",
        },
        ".cm-sourceSearch-current": {
          backgroundColor: "#d0802877",
          outline: "2px solid #b77721",
        },
      }),
    ];
    const session = view.state.field(editorFaultSession);
    view.dispatch({
      effects: sourceSearchPresentation.reconfigure(extension),
      annotations: Transaction.addToHistory.of(false),
    });
    synchronize();
    return () => {
      alive = false;
      workerOwner.dispose();
      if (owner.current === workerOwner) owner.current = null;
      sync.current = () => undefined;
      const released = controller.releaseSearchPresentation(
        documentId,
        session,
        extension
      );
      // Never write a captured state back; the controller has already fenced this owner.
      if (
        released &&
        isMounted() &&
        view.state === released.startState &&
        controller.getEditor(documentId)?.state === released.state
      )
        view.update([released]);
    };
    // The view is the lifecycle owner; all guards read live controller/store state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, documentId, view, controllerSession]);
  useLayoutEffect(() => {
    sync.current();
  }, [conditions, mode, safe, controllerText]);
  useLayoutEffect(() => {
    if (conditions.open) input.current?.focus();
  }, [conditions.open]);
  if (!conditions.open || !allowed()) return null;
  return (
    <div
      className="bg-background/95 absolute top-2 right-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 rounded border p-2 shadow backdrop-blur"
      role="search"
      aria-label="源码文内查找"
    >
      <textarea
        ref={input}
        rows={1}
        maxLength={SEARCH_LIMIT}
        className="w-40 resize-none rounded border bg-transparent px-2 py-1"
        aria-label="查找文字"
        placeholder="查找文字"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (!composing.current)
            store.set(documentId, { query: event.target.value });
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          store.set(documentId, { query: event.currentTarget.value });
        }}
        onKeyDown={(event) =>
          routeSearchQueryKey(
            event.nativeEvent,
            composing.current,
            executeCommand
          )
        }
      />
      <label className="text-xs">
        <input
          type="checkbox"
          checked={conditions.caseSensitive}
          onChange={(event) =>
            store.set(documentId, { caseSensitive: event.target.checked })
          }
        />
        区分大小写
      </label>
      <label className="text-xs">
        <input
          type="checkbox"
          checked={conditions.wholeWord}
          onChange={(event) =>
            store.set(documentId, { wholeWord: event.target.checked })
          }
        />
        全词
      </label>
      <span className="text-xs" aria-live="polite">
        {status === "running"
          ? "搜索中…"
          : status === "failed"
            ? "查找失败，请重试"
            : status === "ready"
              ? result?.count
                ? `${result.index + 1} / ${result.count}${result.limited ? " · 高亮受限" : ""}`
                : "无结果"
              : "输入查找文字"}
      </span>
      {status === "failed" && (
        <button
          onClick={() => {
            owner.current?.cancel();
            sync.current();
          }}
        >
          重试
        </button>
      )}
      <button
        aria-label="上一个匹配"
        disabled={status !== "ready" || !result?.count}
        onClick={() =>
          executeCommand({ type: "previousSourceMatch", args: {} })
        }
      >
        ↑
      </button>
      <button
        aria-label="下一个匹配"
        disabled={status !== "ready" || !result?.count}
        onClick={() => executeCommand({ type: "nextSourceMatch", args: {} })}
      >
        ↓
      </button>
      <button
        aria-label="关闭查找"
        onClick={() => executeCommand({ type: "closeSourceSearch", args: {} })}
      >
        ×
      </button>
    </div>
  );
}
