import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { parseTheme, resolveTheme, watchSystemTheme } from "./theme";

const html = readFileSync(
  new URL("../../../../apps/desktop/src/mainview/index.html", import.meta.url),
  "utf8"
);
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!bootstrap) throw new Error("Missing first-paint theme script");

test("first paint and runtime agree for valid, absent, invalid and inaccessible preferences", () => {
  for (const stored of [null, "dark", "light", "system", "invalid", "throws"]) {
    for (const system of [true, false, undefined, "throws"]) {
      for (const previous of ["dark", "light"] as const) {
        let dark = previous === "dark";
        const style = { colorScheme: "", setProperty() {} };
        const matchMedia = () => {
          if (system === "throws") throw new Error("unavailable");
          return { matches: system as boolean };
        };
        runInNewContext(bootstrap, {
          document: {
            documentElement: {
              classList: {
                contains: () => dark,
                toggle: (_: string, value: boolean) => {
                  dark = value;
                },
              },
              style,
            },
          },
          localStorage: {
            getItem: () => {
              if (stored === "throws") throw new Error("unavailable");
              return stored;
            },
          },
          window: { matchMedia },
        });
        const expected = resolveTheme(
          parseTheme(stored === "throws" ? null : stored),
          previous,
          matchMedia
        );
        expect(dark).toBe(expected === "dark");
        expect(style.colorScheme).toBe(expected);
      }
    }
  }
});

test("system notifications update only on valid booleans and unsubscribe", () => {
  let listener: ((event: MediaQueryListEvent) => void) | undefined;
  let removed = false;
  const themes: string[] = [];
  const media = {
    addEventListener: (_: string, callback: typeof listener) => {
      listener = callback;
    },
    removeEventListener: (_: string, callback: typeof listener) => {
      removed = callback === listener;
    },
  } as unknown as MediaQueryList;
  const stop = watchSystemTheme(
    () => media,
    (theme) => themes.push(theme)
  );
  listener?.({ matches: true } as MediaQueryListEvent);
  listener?.({ matches: undefined } as unknown as MediaQueryListEvent);
  listener?.({
    get matches(): boolean {
      throw new Error("broken event");
    },
  } as MediaQueryListEvent);
  listener?.({ matches: false } as MediaQueryListEvent);
  expect(themes).toEqual(["dark", "light"]);
  stop();
  listener?.({ matches: true } as MediaQueryListEvent);
  expect(removed).toBe(true);
  expect(themes).toEqual(["dark", "light"]);
});

test("unavailable matchMedia and listener registration fail without losing appearance", () => {
  let calls = 0;
  const fail = () => {
    throw new Error("unavailable");
  };
  expect(resolveTheme("system", "dark", fail)).toBe("dark");
  expect(resolveTheme("system", "light", fail)).toBe("light");
  expect(resolveTheme("dark", "light", fail)).toBe("dark");
  expect(() =>
    watchSystemTheme(fail, () => {
      calls++;
    })()
  ).not.toThrow();
  expect(() =>
    watchSystemTheme(
      () =>
        ({
          addEventListener: fail,
          removeEventListener: fail,
        }) as unknown as MediaQueryList,
      () => {
        calls++;
      }
    )()
  ).not.toThrow();
  expect(calls).toBe(0);
});
