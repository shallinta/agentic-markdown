import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

import type { createDocumentController } from "@/client/documents";
import {
  createReadingHighlights,
  readingHighlightRanges,
} from "@/client/reading-search-highlight";
import {
  createReadingSearchOwner,
  type ReadingSearchState,
} from "@/client/reading-search-owner";
import type { ReadingSearchRegistry } from "@/client/reading-search-registry";
import ReadingWorker from "@/client/reading-search.worker?worker&inline";
import { SEARCH_LIMIT } from "@/client/source-search-protocol";
import { routeSearchQueryKey } from "@/client/source-search-view";
import { useCommands, useRegisterCommands } from "@/commands";

export function ReadingSearch({
  controller,
  documentId,
  registry,
  root,
  scroller,
  current,
}: {
  controller: ReturnType<typeof createDocumentController>;
  documentId: string;
  registry: ReadingSearchRegistry;
  root: RefObject<HTMLDivElement | null>;
  scroller: RefObject<HTMLDivElement | null>;
  current: () => boolean;
}) {
  const store = controller.search;
  const conditions = useSyncExternalStore(store.subscribe, () =>
    store.get(documentId)
  );
  const documents = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot
  );
  const input = useRef<HTMLTextAreaElement>(null),
    composing = useRef(false);
  const [draft, setDraft] = useState(conditions.query);
  const [state, setState] = useState<ReadingSearchState>({
    status: "idle",
    result: null,
  });
  const owner = useRef<ReturnType<typeof createReadingSearchOwner> | null>(
    null
  );
  const synchronize = useRef(() => undefined as void);
  const currentRef = useRef(current);
  currentRef.current = current;
  const { executeCommand } = useCommands();
  const interaction = () =>
    currentRef.current() &&
    !composing.current &&
    !controller.isEditorInputBlocked();
  const open = () => {
    if (interaction()) {
      store.set(documentId, { open: true });
      queueMicrotask(() => input.current?.focus());
    }
  };
  const close = () => {
    if (interaction()) {
      store.set(documentId, { open: false });
      scroller.current?.focus({ preventScroll: true });
    }
  };
  useRegisterCommands(
    {
      openSourceSearch: open,
      closeSourceSearch: close,
      nextSourceMatch: () => {
        if (interaction()) owner.current?.navigate(1);
      },
      previousSourceMatch: () => {
        if (interaction()) owner.current?.navigate(-1);
      },
    },
    true,
    {
      openSourceSearch: interaction,
      closeSourceSearch: () => interaction() && store.get(documentId).open,
      nextSourceMatch: () =>
        interaction() &&
        conditions.open &&
        state.status === "ready" &&
        !!state.result?.count,
      previousSourceMatch: () =>
        interaction() &&
        conditions.open &&
        state.status === "ready" &&
        !!state.result?.count,
    }
  );
  useEffect(() => {
    const element = root.current,
      scroll = scroller.current;
    if (!element || !scroll) return;
    let alive = true;
    let highlights: ReturnType<typeof createReadingHighlights> | undefined;
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    const session = createReadingSearchOwner(
      element,
      registry,
      () => alive && currentRef.current(),
      () => new ReadingWorker(),
      (value) => {
        if (!alive) return;
        if (value.status !== "ready") highlights?.clear();
        setState(value);
      },
      (result) => {
        if (!alive || !currentRef.current()) return;
        try {
          highlights ??= createReadingHighlights(element.ownerDocument);
          const { selected, ranges } = readingHighlightRanges(
            result,
            (from, to) => session.range(from, to)
          );
          if (result.kind !== "viewport") {
            if (result.current) {
              const anchor = session.anchor(result.current[0]);
              const content = controller.getEditor(documentId)?.state.doc;
              if (anchor && content)
                store.set(documentId, {
                  readingPosition: { ...anchor, content },
                });
            }
            if (selected && result.kind === "navigate") {
              const rect = selected.getBoundingClientRect(),
                outer = scroll.getBoundingClientRect();
              scroll.scrollTop +=
                rect.top - outer.top - Math.min(80, scroll.clientHeight / 3);
            }
            session.viewport(scroll);
          } else {
            highlights.paint(ranges, selected);
          }
        } catch {
          highlights?.clear();
          session.rejectPresentation();
        }
      }
    );
    owner.current = session;
    const sync = () => {
      const c = store.get(documentId);
      session.update(
        {
          query: c.query,
          caseSensitive: c.caseSensitive,
          wholeWord: c.wholeWord,
        },
        c.readingPosition?.content ===
          controller.getEditor(documentId)?.state.doc
          ? c.readingPosition
          : null,
        c.open && currentRef.current()
      );
    };
    synchronize.current = sync;
    const releaseStore = store.subscribe(sync),
      releaseController = controller.subscribe(sync);
    const onScroll = () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => session.viewport(scroll), 30);
    };
    scroll.addEventListener("scroll", onScroll, { passive: true });
    sync();
    return () => {
      alive = false;
      clearTimeout(scrollTimer);
      releaseStore();
      releaseController();
      scroll.removeEventListener("scroll", onScroll);
      session.dispose();
      highlights?.dispose();
      if (owner.current === session) owner.current = null;
      synchronize.current = () => undefined;
    };
  }, [controller, documentId, registry, root, scroller, store]);
  useEffect(() => {
    synchronize.current();
  }, [documents, current]);
  useEffect(() => {
    if (!composing.current) setDraft(conditions.query);
  }, [conditions.query]);
  useEffect(() => {
    if (conditions.open) input.current?.focus();
  }, [conditions.open]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "f" ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing ||
        !interaction()
      )
        return;
      const target = event.target;
      if (
        !(target instanceof Node) ||
        (!scroller.current?.contains(target) && target !== input.current)
      )
        return;
      event.preventDefault();
      executeCommand({ type: "openSourceSearch", args: {} });
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  if (!conditions.open) return null;
  return (
    <div
      role="search"
      aria-label="阅读文内查找"
      className="bg-background/95 absolute top-2 right-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 rounded border p-2 shadow backdrop-blur"
    >
      <textarea
        ref={input}
        rows={1}
        maxLength={SEARCH_LIMIT}
        aria-label="查找文字"
        placeholder="查找文字"
        className="w-40 resize-none rounded border bg-transparent px-2 py-1"
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
          disabled={!interaction()}
          onChange={(event) => {
            if (interaction())
              store.set(documentId, { caseSensitive: event.target.checked });
          }}
        />
        区分大小写
      </label>
      <label className="text-xs">
        <input
          type="checkbox"
          checked={conditions.wholeWord}
          disabled={!interaction()}
          onChange={(event) => {
            if (interaction())
              store.set(documentId, { wholeWord: event.target.checked });
          }}
        />
        全词
      </label>
      <span aria-live="polite" className="text-xs">
        {state.status === "preparing" || state.status === "running"
          ? "搜索中…"
          : state.status === "failed"
            ? "查找失败，请重试"
            : state.status === "ready"
              ? state.result?.count
                ? `${state.result.index + 1} / ${state.result.count}${state.result.limited ? " · 高亮受限" : ""}`
                : "无结果"
              : "输入查找文字"}
      </span>
      {state.status === "failed" && (
        <button
          onClick={() => {
            if (interaction()) owner.current?.retry();
          }}
        >
          重试
        </button>
      )}
      <button
        aria-label="上一个匹配"
        disabled={
          !interaction() || state.status !== "ready" || !state.result?.count
        }
        onClick={() =>
          executeCommand({ type: "previousSourceMatch", args: {} })
        }
      >
        ↑
      </button>
      <button
        aria-label="下一个匹配"
        disabled={
          !interaction() || state.status !== "ready" || !state.result?.count
        }
        onClick={() => executeCommand({ type: "nextSourceMatch", args: {} })}
      >
        ↓
      </button>
      <button
        aria-label="关闭查找"
        disabled={!interaction()}
        onClick={() => executeCommand({ type: "closeSourceSearch", args: {} })}
      >
        ×
      </button>
    </div>
  );
}
