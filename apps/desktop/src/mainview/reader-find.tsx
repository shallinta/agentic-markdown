import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { createReadingHighlights, readingHighlightRanges } from "../client/reading-search-highlight";
import { createReadingSearchOwner, type ReadingSearchPresentation, type ReadingSearchState } from "../client/reading-search-owner";
import type { ReadingSearchRegistry } from "../client/reading-search-registry";
import ReadingWorker from "../client/reading-search.worker?worker&inline";
import type { ReadingThemeId } from "../client/reading-theme";
import { SEARCH_LIMIT, type SearchOptions } from "../client/source-search-protocol";

const emptyOptions: SearchOptions = { query: "", caseSensitive: false, wholeWord: false };
const idle: ReadingSearchState = { status: "idle", result: null };

interface ReaderFindFolds {
  presentation(): ReadingSearchPresentation;
  subscribe(listener: () => void): () => void;
  reveal(range: Range): void;
  visible(range: Range): boolean;
}

export function ReaderFind({ article, toolbar, registry, current, theme, folds }: {
  article: RefObject<HTMLElement | null>;
  toolbar: RefObject<HTMLDivElement | null>;
  registry: ReadingSearchRegistry;
  current: () => boolean;
  theme: ReadingThemeId;
  folds?: ReaderFindFolds;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const beforeFind = useRef<HTMLElement | null>(null);
  const composing = useRef(false);
  const owner = useRef<ReturnType<typeof createReadingSearchOwner> | null>(null);
  const updateViewport = useRef<(() => void) | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [options, setOptions] = useState(emptyOptions);
  const [state, setState] = useState(idle);

  const close = useCallback((element: HTMLElement | null) => {
    if (composing.current || !current()) return;
    owner.current?.update(emptyOptions, null, false);
    setOpen(false);
    setDraft("");
    setOptions(emptyOptions);
    const previous = beforeFind.current;
    beforeFind.current = null;
    (previous?.isConnected && !previous.closest("[hidden]") ? previous : element)?.focus({ preventScroll: true });
  }, [current]);

  useEffect(() => {
    const element = article.current;
    if (!element || !current()) return;
    let alive = true;
    let highlights: ReturnType<typeof createReadingHighlights> | undefined;
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    const bounds = {
      getBoundingClientRect: () => {
        const bottom = document.documentElement.clientHeight;
        const toolbarBottom = toolbar.current?.getBoundingClientRect().bottom ?? 0;
        return { top: Math.max(0, Math.min(toolbarBottom, bottom)), bottom };
      },
    };
    const session = createReadingSearchOwner(
      element,
      registry,
      () => alive && current(),
      () => new ReadingWorker(),
      (value) => {
        if (!alive || !current()) return;
        if (value.status !== "ready") highlights?.clear();
        setState(value);
      },
      (result) => {
        if (!alive || !current()) return;
        try {
          const { selected, ranges } = readingHighlightRanges(result, (from, to) => session.range(from, to));
          if (result.kind === "viewport") {
            const visible = selected && (!folds || folds.visible(selected)) ? selected : null;
            if (ranges.length || visible) {
              highlights ??= createReadingHighlights(element.ownerDocument, "independent");
              highlights.paint(ranges, visible);
            } else highlights?.clear();
            return;
          }
          if (result.kind === "navigate" && selected) {
            folds?.reveal(selected);
            if (folds && !folds.visible(selected)) throw Error("阅读查找目标不可见");
            const { top, bottom } = bounds.getBoundingClientRect();
            window.scrollBy(0, selected.getBoundingClientRect().top - top - Math.min(80, (bottom - top) / 3));
          }
          session.viewport(bounds);
        } catch {
          highlights?.clear();
          session.rejectPresentation();
        }
      },
      folds && (() => folds.presentation())
    );
    owner.current = session;
    const refresh = () => {
      if (!input.current) return;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => session.viewport(bounds), 30);
    };
    updateViewport.current = refresh;
    const releaseFolds = folds?.subscribe(() => {
      highlights?.clear();
      refresh();
    });
    const onKey = (event: KeyboardEvent) => {
      if (!current() || composing.current || event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape" && input.current) {
        event.preventDefault();
        event.stopPropagation();
        close(element);
      } else if (event.key.toLowerCase() === "f" && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        if (input.current) input.current.focus({ preventScroll: true });
        else {
          const focused = document.activeElement;
          beforeFind.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
          setOpen(true);
        }
      }
    };
    const dispose = () => {
      if (!alive) return;
      alive = false;
      clearTimeout(scrollTimer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("pagehide", dispose);
      session.dispose();
      releaseFolds?.();
      highlights?.dispose();
      owner.current = null;
      updateViewport.current = undefined;
      beforeFind.current = null;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh);
    window.addEventListener("pagehide", dispose, { once: true });
    return dispose;
  }, [article, toolbar, registry, current, close, folds]);

  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    updateViewport.current?.();
  }, [theme, open]);

  const change = (patch: Partial<SearchOptions>) => {
    if (!current() || composing.current) return;
    const next = { ...options, ...patch };
    setOptions(next);
    owner.current?.update(next, null, true);
  };
  const count = state.result?.count ?? 0;
  const canNavigate = state.status === "ready" && count > 0;
  const navigate = (direction: 1 | -1) => {
    if (canNavigate && current() && !composing.current) owner.current?.navigate(direction);
  };
  if (!open) return null;
  return (
    <div
      className="reader-find"
      role="search"
      aria-label="阅读文内查找"
      onMouseDown={(event) => {
        if (composing.current && event.target !== input.current) event.preventDefault();
      }}
    >
      <textarea
        ref={input}
        rows={1}
        maxLength={SEARCH_LIMIT}
        aria-label="查找文字"
        placeholder="查找文字"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          change({ query: event.target.value });
        }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={(event) => {
          composing.current = false;
          const query = event.currentTarget.value;
          setDraft(query);
          change({ query });
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return;
          event.preventDefault();
          navigate(event.shiftKey ? -1 : 1);
        }}
      />
      <label><input type="checkbox" checked={options.caseSensitive} onChange={(event) => change({ caseSensitive: event.target.checked })} />区分大小写</label>
      <label><input type="checkbox" checked={options.wholeWord} onChange={(event) => change({ wholeWord: event.target.checked })} />全词</label>
      <span aria-live="polite">
        {state.status === "preparing" || state.status === "running" ? "搜索中…" :
          state.status === "failed" ? "查找失败，请重试" :
            state.result ? count ? `${state.result.index + 1} / ${count}${state.result.limited ? " · 高亮受限" : ""}` : "无结果" : "输入查找文字"}
      </span>
      {state.status === "failed" && <button type="button" onClick={() => {
        if (current() && !composing.current) owner.current?.retry();
      }}>重试</button>}
      <button type="button" aria-label="上一个匹配" disabled={!canNavigate} onClick={() => navigate(-1)}>↑</button>
      <button type="button" aria-label="下一个匹配" disabled={!canNavigate} onClick={() => navigate(1)}>↓</button>
      <button type="button" aria-label="关闭查找" onClick={() => close(article.current)}>×</button>
    </div>
  );
}
