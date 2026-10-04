import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { isCommand, PRODUCT_COMMANDS } from "../shared/commands";

import { createReadingThemeSelection, READING_THEMES } from "./reading-theme";

test("window theme selection captures before publish and is isolated, idempotent and disposable", () => {
  const events: string[] = [];
  const first = createReadingThemeSelection(
    () => events.push(`capture:${first.getSnapshot()}`),
    () => true
  );
  const second = createReadingThemeSelection(
    () => {
      throw Error("other window");
    },
    () => true
  );
  const unsubscribe = first.subscribe(() =>
    events.push(`publish:${first.getSnapshot()}`)
  );
  expect(first.getSnapshot()).toBe("paper");
  expect(first.select("ink")).toBeNull();
  expect(first.select("ink")).toBeNull();
  expect(events).toEqual(["capture:paper", "publish:ink"]);
  expect(second.getSnapshot()).toBe("paper");
  unsubscribe();
  first.select("paper");
  first.select("ink");
  expect(events).toEqual([
    "capture:paper",
    "publish:ink",
    "capture:ink",
    "capture:paper",
  ]);
  expect(
    createReadingThemeSelection(
      () => undefined,
      () => true
    ).getSnapshot()
  ).toBe("paper");
});

test("invalid IDs and frozen/IME guards preserve current theme without capture", () => {
  let allowed = false;
  let captures = 0;
  const themes = createReadingThemeSelection(
    () => captures++,
    () => allowed
  );
  expect(themes.select("ink")).toContain("当前操作进行中");
  allowed = true;
  expect(themes.select("../theme.css")).toContain("已保留当前主题");
  expect(themes.getSnapshot()).toBe("paper");
  expect(captures).toBe(0);
  themes.select("ink");
  expect(captures).toBe(1);
});

test("bundled manifests and styles are finite, scoped and resource-free", () => {
  expect(READING_THEMES.map((theme) => theme.id)).toEqual(["paper", "ink"]);
  expect(new Set(READING_THEMES.map((theme) => theme.id)).size).toBe(2);
  for (const theme of READING_THEMES) {
    expect(Object.keys(theme).sort()).toEqual(["id", "name", "version"]);
    expect(theme.version).toBe("1.0.0");
    expect(theme.name).toMatch(/[\u4e00-\u9fff]/);
  }
  for (const path of ["paper/theme.css", "ink/theme.css", "content.css"]) {
    const css = readFileSync(
      new URL(`../reading-themes/${path}`, import.meta.url),
      "utf8"
    );
    expect(css).not.toMatch(
      /@import|url\s*\(|@font-face|https?:|<script|expression\s*\(/i
    );
    for (const match of css.matchAll(/([^{}]+)\{/g)) {
      expect(match[1].trim().startsWith("[data-reading-theme")).toBe(true);
    }
  }
});

test("theme commands are fixed Chinese palette actions with no arbitrary payload", () => {
  for (const type of ["readingThemePaper", "readingThemeInk"] as const) {
    expect(isCommand({ type, args: {} })).toBe(true);
    expect(isCommand({ type, args: { css: "evil" } })).toBe(false);
    expect(PRODUCT_COMMANDS[type]?.label).toMatch(/^阅读主题：/);
  }
});
