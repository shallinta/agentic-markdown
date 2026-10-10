import { Decoration } from "@codemirror/view";

import type { Command } from "../shared/commands";

import { SEARCH_MARK_LIMIT, type SearchResult } from "./source-search-protocol";
import type { createSearchStore } from "./source-search-store";

/** A notice belongs to one text/query session, not to viewport paint results. */
export function createReplacementNotice(publish: (message: string) => void) {
  let text: object | undefined;
  let signature: string | undefined;
  return {
    show: publish,
    clear: () => publish(""),
    sync(
      nextText: object,
      conditions: {
        query: string;
        caseSensitive: boolean;
        wholeWord: boolean;
        open: boolean;
      }
    ) {
      const next = JSON.stringify([
        conditions.query,
        conditions.caseSensitive,
        conditions.wholeWord,
        conditions.open,
      ]);
      if (text !== undefined && (text !== nextText || signature !== next))
        publish("");
      text = nextText;
      signature = next;
    },
  };
}

/** Preserve the current match within the same bounded decoration budget. */
export function searchDecorations(
  response: SearchResult,
  visible: readonly { from: number; to: number }[]
) {
  const positions: { from: number; to: number; current: boolean }[] = [];
  for (let i = 0; i < response.ranges.length; i += 2)
    positions.push({
      from: response.ranges[i],
      to: response.ranges[i + 1],
      current: response.ranges[i] === response.current?.[0],
    });
  if (
    response.current &&
    visible.some(
      (r) => r.from < response.current![1] && r.to > response.current![0]
    ) &&
    !positions.some((p) => p.current)
  ) {
    if (positions.length >= SEARCH_MARK_LIMIT) positions.pop();
    positions.push({
      from: response.current[0],
      to: response.current[1],
      current: true,
    });
  }
  return Decoration.set(
    positions.map((p) =>
      Decoration.mark({
        class: p.current ? "cm-sourceSearch-current" : "cm-sourceSearch-match",
      }).range(p.from, p.to)
    ),
    true
  );
}
export function routeSearchQueryKey(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "shiftKey"
    | "isComposing"
    | "keyCode"
    | "preventDefault"
    | "stopPropagation"
  >,
  composing: boolean,
  execute: (command: Command) => void
) {
  if (
    event.isComposing ||
    composing ||
    event.keyCode === 229 ||
    (event.key !== "Enter" && event.key !== "Escape")
  )
    return false;
  event.preventDefault();
  event.stopPropagation();
  execute({
    type:
      event.key === "Escape"
        ? "closeSourceSearch"
        : event.shiftKey
          ? "previousSourceMatch"
          : "nextSourceMatch",
    args: {},
  });
  return true;
}

/** Closing the UI ends its pending navigation intent, even if conditions survive. */
export function closeSearchSession(
  store: ReturnType<typeof createSearchStore>,
  documentId: string,
  intent: { current: unknown },
  cancel: () => void
) {
  intent.current = null;
  cancel();
  store.set(documentId, { open: false });
}

/** Observe synchronously, so changing a condition away and back cannot revive intent. */
export function watchReplacementIntent(
  store: ReturnType<typeof createSearchStore>,
  documentId: string,
  intent: { current: { queryKey: string } | null }
) {
  return store.subscribe(() => {
    const value = store.get(documentId);
    if (
      !value.open ||
      !value.query ||
      (intent.current &&
        intent.current.queryKey !==
          JSON.stringify([value.query, value.caseSensitive, value.wholeWord]))
    )
      intent.current = null;
  });
}
