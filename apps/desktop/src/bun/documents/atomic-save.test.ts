import { expect, test } from "bun:test";

import { resolveSaveWorkerEntry } from "./atomic-save";

test("worker entry resolves source checkout and actual Electrobun 2 packaged layout", () => {
  expect(
    resolveSaveWorkerEntry("/repo/apps/desktop/src/bun/documents", () => true)
  ).toBe("/repo/apps/desktop/dist-native/save-worker.js");
  expect(
    resolveSaveWorkerEntry(
      "/Applications/Agentic Markdown.app/Contents/Resources/app/bun",
      () => true
    )
  ).toBe(
    "/Applications/Agentic Markdown.app/Contents/Resources/app/native/save-worker.js"
  );
});
test("missing packaged worker fails closed without trying checkout fallback", () => {
  const checked: string[] = [];
  expect(
    resolveSaveWorkerEntry("/package/Contents/Resources/app/bun", (path) => {
      checked.push(path);
      return path.includes("dist-native");
    })
  ).toBeNull();
  expect(checked).toEqual([
    "/package/Contents/Resources/app/native/save-worker.js",
  ]);
});
