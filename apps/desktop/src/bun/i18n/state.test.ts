import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocaleStateStore, type LocaleStateStore } from "./state";

let directory: string;
let path: string;
let store: LocaleStateStore;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "locale-settings-"));
  path = join(directory, "locale.json");
  store = createLocaleStateStore(directory, () => "en-US");
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("initializes versioned Chinese preferences and normalizes legacy English", async () => {
  expect(await store.getLocale()).toBe("zh-CN");
  await store.setLocale("en-US");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
    version: 1,
    data: { locale: "zh-CN" },
  });
});

test.each(["zh-CN", "en-US", "fr-FR"])(
  "migrates legacy %s with an exact backup",
  async (locale) => {
    const original = JSON.stringify({ locale });
    await writeFile(path, original);
    expect(await store.getLocale()).toBe("zh-CN");
    expect(await readFile(`${path}.bak`, "utf8")).toBe(original);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      version: 1,
      data: { locale: "zh-CN" },
    });
  }
);

test.each(["{broken", "null", "42", "[]"])(
  "preserves malformed source %s while using defaults",
  async (original) => {
    await writeFile(path, original);
    expect(await store.getLocale()).toBe("zh-CN");
    expect(await readFile(path, "utf8")).toBe(original);
  }
);

test("refuses to overwrite a future locale version", async () => {
  const original = '{"version":2,"data":{"locale":"en-US"}}';
  await writeFile(path, original);
  expect(await store.getLocale()).toBe("zh-CN");
  expect(
    await store.setLocale("zh-CN").catch((error: unknown) => error)
  ).toEqual(new Error("SETTINGS_VERSION_UNSUPPORTED"));
  expect(await readFile(path, "utf8")).toBe(original);
});
