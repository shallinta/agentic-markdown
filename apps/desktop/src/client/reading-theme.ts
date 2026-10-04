import ink from "../reading-themes/ink/theme.json";
import paper from "../reading-themes/paper/theme.json";

export const READING_THEMES = [paper, ink] as const;
export type ReadingThemeId = "paper" | "ink";

/** Per-window memory only. Never accepts CSS, paths, or a user-supplied manifest. */
export function createReadingThemeSelection(
  capture: () => void,
  allowed: () => boolean
) {
  let selected: ReadingThemeId = "paper";
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => selected,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select: (id: string): string | null => {
      if (id !== "paper" && id !== "ink")
        return "阅读主题不可用，已保留当前主题。";
      if (!allowed()) return "当前操作进行中，暂时无法切换阅读主题。";
      if (id === selected) return null;
      capture();
      selected = id;
      for (const listener of listeners) listener();
      return null;
    },
  };
}
