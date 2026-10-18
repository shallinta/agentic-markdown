import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@agentic-markdown/ui/ui/dialog";
import { useCallback, useId, useRef, useState, useSyncExternalStore } from "react";

import { restorePaletteFocus } from "../client/palette-focus";
import type { createQuickOpen, QuickResult } from "../client/quick-open";

export const QUICK_ROW_HEIGHT = 64;
export const QUICK_VIEW_HEIGHT = 320;
const OVERSCAN = 3;

/** Keep the active descendant mounted even when the user scrolls away from it. */
export function quickVisibleRows(count: number, scrollTop: number, active: number) {
  const start = Math.max(0, Math.floor(scrollTop / QUICK_ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(count, Math.ceil((scrollTop + QUICK_VIEW_HEIGHT) / QUICK_ROW_HEIGHT) + OVERSCAN);
  const rows: number[] = [];
  for (let index = start; index < end; index++) rows.push(index);
  if (active >= 0 && active < count && !rows.includes(active)) rows.push(active);
  return rows;
}

export function quickNavigation(key: string, active: number, count: number, composing: boolean): number | "choose" | undefined {
  if (composing || !count) return;
  if (key === "Enter") return "choose";
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return Math.min(count - 1, active + 1);
  if (key === "ArrowUp") return Math.max(0, active - 1);
}

export function QuickOpenResults({ results, active, scrollTop, id, choose }: {
  results: readonly QuickResult[]; active: number; scrollTop: number; id: string; choose: (index: number) => void;
}) {
  return <div role="listbox" aria-label="匹配文件" id={id} style={{ height: results.length * QUICK_ROW_HEIGHT, position: "relative" }}>
    {quickVisibleRows(results.length, scrollTop, active).map(index => {
      const result = results[index];
      return <div role="option" id={`${id}-${index}`} aria-selected={active === index} aria-posinset={index + 1} aria-setsize={results.length}
        key={result.key} className={`absolute inset-x-0 cursor-pointer rounded px-3 py-2 text-sm ${active === index ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
        style={{ top: index * QUICK_ROW_HEIGHT, height: QUICK_ROW_HEIGHT }}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <div className="truncate font-medium" title={result.name}>{result.name}</div>
        <div className="text-muted-foreground truncate text-xs" title={`${result.rootName} · ${result.path}`}>{result.rootName} · {result.path}</div>
      </div>;
    })}
  </div>;
}

export function QuickOpenDialog({ controller }: { controller: ReturnType<typeof createQuickOpen> }) {
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  const state = useSyncExternalStore(subscribe, controller.getSnapshot, controller.getSnapshot);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const composing = useRef(false);
  const confirmed = useRef(false);
  const [scrollTop, setScrollTop] = useState(0);
  const choose = (index: number) => {
    if (composing.current || state.searching || !controller.canOpen()) return;
    void controller.choose(index);
    confirmed.current = !controller.getSnapshot().visible;
  };
  return <Dialog open={state.visible} onOpenChange={open => { if (!open && !composing.current) controller.close(); }}>
    <DialogContent key={state.scope} className="sm:max-w-xl" onOpenAutoFocus={event => {
      event.preventDefault();
      previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      composing.current = false;
      confirmed.current = false;
      setScrollTop(0);
      input.current?.focus({ preventScroll: true });
    }} onCloseAutoFocus={event => {
      event.preventDefault();
      if (state.scope !== controller.getSnapshot().scope) return;
      if (!confirmed.current) restorePaletteFocus(previous.current);
      else controller.scopeClosed(state.scope);
    }} onEscapeKeyDown={event => {
      if (composing.current || event.isComposing || event.keyCode === 229) event.preventDefault();
    }}>
      <DialogTitle>快速打开</DialogTitle>
      <DialogDescription>输入文件名或路径。方向键选择，Enter 打开，Escape 取消。</DialogDescription>
      <input ref={input} role="combobox" aria-label="文件名或路径" aria-autocomplete="list" aria-expanded={state.visible} aria-controls={id}
        aria-activedescendant={state.results[state.active] ? `${id}-${state.active}` : undefined}
        className="bg-background rounded border p-2 text-sm" value={state.query}
        placeholder="输入文件名或路径" onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onChange={event => { if (viewport.current) viewport.current.scrollTop = 0; setScrollTop(0); controller.setQuery(event.target.value); }}
        onKeyDown={event => {
          const action = quickNavigation(event.key, state.active, state.results.length, composing.current || event.nativeEvent.isComposing || event.keyCode === 229);
          if (action === undefined) return;
          event.preventDefault();
          if (action === "choose") { choose(state.active); return; }
          const view = viewport.current;
          if (view) {
            const top = action * QUICK_ROW_HEIGHT;
            if (top < view.scrollTop) view.scrollTop = top;
            else if (top + QUICK_ROW_HEIGHT > view.scrollTop + view.clientHeight) view.scrollTop = top + QUICK_ROW_HEIGHT - view.clientHeight;
            setScrollTop(view.scrollTop);
          }
          controller.move(action);
        }} />
      <p role="status" className="text-muted-foreground min-h-4 text-xs">{state.message || `${state.results.length} 个匹配文件`}</p>
      <div ref={viewport} className="overflow-auto" style={{ height: QUICK_VIEW_HEIGHT }} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
        <QuickOpenResults results={state.results} active={state.active} scrollTop={scrollTop} id={id} choose={choose} />
      </div>
    </DialogContent>
  </Dialog>;
}
