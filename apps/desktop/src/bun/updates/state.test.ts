import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createUpdatesStateStore, type UpdatesStateStore } from "./state";

let settingsDir: string;
let statePath: string;
let store: UpdatesStateStore;

beforeEach(async () => {
  settingsDir = await mkdtemp(join(tmpdir(), "electrobun-update-state-"));
  statePath = join(settingsDir, "updates.json");
  store = createUpdatesStateStore(settingsDir);
});

afterEach(async () => {
  await rm(settingsDir, { recursive: true, force: true });
});

describe("update state persistence", () => {
  test("uses defaults when persisted JSON is malformed", async () => {
    await mkdir(settingsDir, { recursive: true });
    await Bun.write(statePath, "{not-json");

    expect(await store.getUpdateMode()).toBe("automatic");
    expect(await store.getLastSeenHash("app.test")).toBeUndefined();
  });

  test("serializes concurrent patches without losing either field", async () => {
    await Promise.all([
      store.setUpdateMode("manual"),
      store.setLastSeenHash("app.test", "hash-1"),
    ]);

    expect(await store.getUpdateMode()).toBe("manual");
    expect(await store.getLastSeenHash("app.test")).toBe("hash-1");
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
      version: 1,
      data: { mode: "manual", lastSeenHashes: { "app.test": "hash-1" } },
    });
  });
  test("migrates valid legacy updater preferences", async () => {
    const legacy = JSON.stringify({
      mode: "off",
      lastSeenHashes: { "app.test": "hash-old" },
    });
    await Bun.write(statePath, legacy);
    expect(await store.getUpdateMode()).toBe("off");
    expect(await store.getLastSeenHash("app.test")).toBe("hash-old");
    expect(await readFile(`${statePath}.bak`, "utf8")).toBe(legacy);
  });

  test("future updater settings remain protected", async () => {
    const future = '{"version":4,"data":{"mode":"off"}}';
    await Bun.write(statePath, future);
    expect(await store.getUpdateMode()).toBe("automatic");
    expect(
      await store.setUpdateMode("manual").catch((error: unknown) => error)
    ).toEqual(new Error("SETTINGS_VERSION_UNSUPPORTED"));
    expect(await readFile(statePath, "utf8")).toBe(future);
  });
});
