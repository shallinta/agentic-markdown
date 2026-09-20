"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  LOCAL_STORAGE_KEYS,
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from "../lib/local-storage";
import {
  parseTheme,
  resolveTheme,
  watchSystemTheme,
  type Theme,
  type ResolvedTheme,
} from "../lib/theme";

/** User preference and concrete appearance applied to the document. */
export type { Theme, ResolvedTheme } from "../lib/theme";

/** Accent (as `#rrggbb`) used when nothing is stored — the base `--primary` blue. */
export const DEFAULT_PRIMARY = "#5e80ee";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

interface PrimaryColorContextValue {
  /** The active accent as a `#rrggbb` hex string. */
  primaryColor: string;
  hasPrimaryColorOverride: boolean;
  setPrimaryColor: (hex: string) => void;
  resetPrimaryColor: () => void;
  resetPrimaryColorVersion: number;
}

// Split contexts: the accent updates on every drag tick, while theme consumers
// only read `resolvedTheme`. Keeping accent in its own context avoids unrelated
// re-renders while the color picker is dragged.
const ThemeContext = createContext<ThemeContextValue | null>(null);
const PrimaryColorContext = createContext<PrimaryColorContextValue | null>(
  null
);

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function _readStoredTheme(): Theme {
  const stored = readLocalStorage(LOCAL_STORAGE_KEYS.theme);
  return parseTheme(stored);
}

function _readStoredPrimary(): string {
  const stored = readLocalStorage(LOCAL_STORAGE_KEYS.primaryColor);
  return stored && HEX_RE.test(stored) ? stored : DEFAULT_PRIMARY;
}

/** Pick a readable foreground for an arbitrary accent (WCAG relative luminance). */
function _primaryForeground(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * toLinear((n >> 16) & 255) +
    0.7152 * toLinear((n >> 8) & 255) +
    0.0722 * toLinear(n & 255);
  // Dark ink on bright accents (yellows/ambers), near-white on the rest.
  return luminance > 0.45 ? "oklch(0.216 0.006 56)" : "oklch(0.985 0 0)";
}

/** Apply the accent as inline `--primary`/`--ring`/`--primary-foreground` vars. */
function _applyPrimary(hex: string) {
  const root = document.documentElement;
  root.style.setProperty("--primary", hex);
  root.style.setProperty("--ring", hex);
  root.style.setProperty("--primary-foreground", _primaryForeground(hex));
}

/** Toggle the `.dark` class the Tailwind `dark` variant keys off of. */
function _applyTheme(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(_readStoredTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(
      _readStoredTheme(),
      document.documentElement.classList.contains("dark") ? "dark" : "light",
      (query) => window.matchMedia(query)
    )
  );
  const lastResolved = useRef(resolvedTheme);

  const [primaryColor, setPrimaryState] = useState<string>(_readStoredPrimary);
  const [hasPrimaryColorOverride, setHasPrimaryColorOverride] = useState(() => {
    const stored = readLocalStorage(LOCAL_STORAGE_KEYS.primaryColor);
    return Boolean(stored && HEX_RE.test(stored));
  });
  const [resetPrimaryColorVersion, setResetPrimaryColorVersion] = useState(0);

  const setTheme = useCallback((next: Theme) => {
    const valid = parseTheme(next);
    writeLocalStorage(LOCAL_STORAGE_KEYS.theme, valid);
    setThemeState(valid);
  }, []);

  const setPrimaryColor = useCallback((next: string) => {
    writeLocalStorage(LOCAL_STORAGE_KEYS.primaryColor, next);
    setHasPrimaryColorOverride(true);
    setPrimaryState(next);
  }, []);

  const resetPrimaryColor = useCallback(() => {
    removeLocalStorage(LOCAL_STORAGE_KEYS.primaryColor);
    setHasPrimaryColorOverride(false);
    setPrimaryState(DEFAULT_PRIMARY);
    setResetPrimaryColorVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    _applyPrimary(primaryColor);
  }, [primaryColor]);

  // Apply the resolved theme to the document, and — while following the system
  // — re-resolve when the OS color scheme flips.
  useEffect(() => {
    const apply = (resolved: ResolvedTheme) => {
      lastResolved.current = resolved;
      setResolvedTheme(resolved);
      _applyTheme(resolved);
    };
    apply(
      resolveTheme(theme, lastResolved.current, (query) =>
        window.matchMedia(query)
      )
    );

    if (theme !== "system") {
      return;
    }
    return watchSystemTheme((query) => window.matchMedia(query), apply);
  }, [theme]);

  const themeValue = useMemo(
    (): ThemeContextValue => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  );
  const primaryValue = useMemo(
    (): PrimaryColorContextValue => ({
      primaryColor,
      hasPrimaryColorOverride,
      setPrimaryColor,
      resetPrimaryColor,
      resetPrimaryColorVersion,
    }),
    [
      primaryColor,
      hasPrimaryColorOverride,
      setPrimaryColor,
      resetPrimaryColor,
      resetPrimaryColorVersion,
    ]
  );

  return (
    <ThemeContext.Provider value={themeValue}>
      <PrimaryColorContext.Provider value={primaryValue}>
        {children}
      </PrimaryColorContext.Provider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within <ThemeProvider>");
  }
  return ctx;
}

export function usePrimaryColor(): PrimaryColorContextValue {
  const ctx = useContext(PrimaryColorContext);
  if (!ctx) {
    throw new Error("usePrimaryColor must be used within <ThemeProvider>");
  }
  return ctx;
}
