export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const DARK_QUERY = "(prefers-color-scheme: dark)";

export function parseTheme(value: unknown): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(
  theme: Theme,
  previous: ResolvedTheme,
  matchMedia: (query: string) => Pick<MediaQueryList, "matches">
): ResolvedTheme {
  if (theme !== "system") return theme;
  try {
    const matches = matchMedia(DARK_QUERY).matches;
    return typeof matches === "boolean"
      ? matches
        ? "dark"
        : "light"
      : previous;
  } catch {
    return previous;
  }
}

/** Only a valid notification can change the last known system appearance. */
export function watchSystemTheme(
  matchMedia: (query: string) => MediaQueryList,
  onTheme: (theme: ResolvedTheme) => void
): () => void {
  let active = true;
  let media: MediaQueryList | undefined;
  const onChange = (event: MediaQueryListEvent) => {
    if (!active) return;
    try {
      if (typeof event.matches === "boolean") {
        onTheme(event.matches ? "dark" : "light");
      }
    } catch {
      // Invalid host notifications retain the last applied appearance.
    }
  };
  try {
    media = matchMedia(DARK_QUERY);
    media.addEventListener("change", onChange);
  } catch {
    // Some embedded webviews cannot register media listeners.
  }
  return () => {
    active = false;
    try {
      media?.removeEventListener("change", onChange);
    } catch {
      // Deactivation above also fences a host that cannot remove its listener.
    }
  };
}
