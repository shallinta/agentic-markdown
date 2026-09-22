import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSettingsStore, isSettingsObject } from "./settings-store";

let directory: string;
let path: string;
const create = () =>
  createSettingsStore(path, (value) => (isSettingsObject(value) ? value : {}));
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "versioned-settings-"));
  path = join(directory, "state.json");
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("legacy migration is idempotent across store instances and repeated updates", async () => {
  const legacy = '{ "preference": "retained" }';
  await writeFile(path, legacy);
  expect(await create().load()).toEqual({ preference: "retained" });
  const migrated = await readFile(path, "utf8");
  const info = await stat(path);
  await Promise.all([
    create().load(),
    create().load(),
    create().update((state) => state),
  ]);
  expect(await readFile(path, "utf8")).toBe(migrated);
  expect((await stat(path)).mtimeMs).toBe(info.mtimeMs);
  expect(await readFile(`${path}.bak`, "utf8")).toBe(legacy);
});

test("concurrent store instances serialize read-modify-write", async () => {
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      create().update((state) => ({ ...state, [index]: index }))
    )
  );
  expect(Object.keys(await create().load())).toHaveLength(20);
  expect((await readdir(directory)).sort()).toEqual([
    "state.json",
    "state.json.bak",
  ]);
  expect((await readdir(directory)).some((name) => name.endsWith(".tmp"))).toBe(
    false
  );
});

test("failed backup commit leaves source intact and removes temporary files", async () => {
  const legacy = '{"preference":"retained"}';
  await writeFile(path, legacy);
  await mkdir(`${path}.bak`);
  expect(await create().load()).toEqual({ preference: "retained" });
  expect(
    await create()
      .update(() => ({ preference: "changed" }))
      .catch((error: unknown) => error)
  ).toBeInstanceOf(Error);
  expect(await readFile(path, "utf8")).toBe(legacy);
  expect((await readdir(directory)).some((name) => name.endsWith(".tmp"))).toBe(
    false
  );
  await rm(`${path}.bak`, { recursive: true });
  expect(await create().load()).toEqual({ preference: "retained" });
});

test.each([
  "{corrupt",
  "null",
  "[]",
  '{"version":1}',
  '{"version":1,"data":null}',
  '{"version":1,"data":[]}',
])(
  "corrupt source %s and valid backup survive repeated updates",
  async (original) => {
    const backup = '{ "version": 1, "data": {"preference": "recoverable"} }';
    await writeFile(path, original);
    await writeFile(`${path}.bak`, backup);
    expect(await create().load()).toEqual({});
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(
        await create()
          .update(() => ({ preference: true }))
          .catch((error: unknown) => error)
      ).toEqual(new Error("SETTINGS_CORRUPT"));
    }
    expect(await readFile(path, "utf8")).toBe(original);
    expect(await readFile(`${path}.bak`, "utf8")).toBe(backup);
    expect((await readdir(directory)).sort()).toEqual([
      "state.json",
      "state.json.bak",
    ]);
  }
);

test("read-only settings directory still serves valid legacy preferences", async () => {
  const original = '{"preference":"retained"}';
  const backup = '{"preference":"older"}';
  await writeFile(path, original);
  await writeFile(`${path}.bak`, backup);
  await chmod(directory, 0o500);
  try {
    expect(await create().load()).toEqual({ preference: "retained" });
    expect(
      await create()
        .update(() => ({ preference: "changed" }))
        .catch((error: unknown) => error)
    ).toBeInstanceOf(Error);
    expect(await readFile(path, "utf8")).toBe(original);
    expect(await readFile(`${path}.bak`, "utf8")).toBe(backup);
  } finally {
    await chmod(directory, 0o700);
  }
});

test.each([2, 99, "future", null])(
  "unknown version %p is read-only",
  async (version) => {
    const future = JSON.stringify({ version, data: { secret: "retained" } });
    await writeFile(path, future);
    expect(await create().load()).toEqual({});
    expect(
      await create()
        .update(() => ({}))
        .catch((error: unknown) => error)
    ).toEqual(new Error("SETTINGS_VERSION_UNSUPPORTED"));
    expect(await readFile(path, "utf8")).toBe(future);
    expect(await readdir(directory)).toEqual(["state.json"]);
  }
);
