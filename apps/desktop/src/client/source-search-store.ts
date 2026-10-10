import type { SearchOptions } from "./source-search-protocol";
export interface SearchConditions extends SearchOptions {
  open: boolean;
  position: number | null;
}
const empty: SearchConditions = Object.freeze({
  query: "",
  caseSensitive: false,
  wholeWord: false,
  open: false,
  position: null,
});
/** Owned by one document controller, never a module singleton. */
export function createSearchStore(
  accept: (id: string) => boolean = () => true
) {
  const entries = new Map<string, SearchConditions>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    get: (id: string) => entries.get(id) ?? empty,
    set: (id: string, update: Partial<SearchConditions>) => {
      if (!accept(id)) return;
      const previous = entries.get(id) ?? empty;
      const changed =
        (update.query !== undefined && update.query !== previous.query) ||
        (update.caseSensitive !== undefined &&
          update.caseSensitive !== previous.caseSensitive) ||
        (update.wholeWord !== undefined &&
          update.wholeWord !== previous.wholeWord);
      entries.set(id, {
        ...previous,
        ...update,
        ...(changed ? { position: null } : {}),
      });
      notify();
    },
    delete: (id: string) => {
      if (entries.delete(id)) notify();
    },
    clear: () => {
      entries.clear();
      notify();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
