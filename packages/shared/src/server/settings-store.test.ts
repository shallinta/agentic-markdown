import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
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
const createStrict = () => createSettingsStore(path,
  (value) => isSettingsObject(value) ? value : {},
  { maxBytes: 4096, validateData: isSettingsObject });
const version1 = (data: object) => `${JSON.stringify({ version: 1, data }, null, 2)}\n`;
const stagedFile = (name: string) => readdirSync(directory).find((candidate) =>
  candidate.startsWith(`${name}.${process.pid}.`) && candidate.endsWith(".tmp"));
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

test("a stale observed update reads its queue predecessor and never starts writing", async () => {
  const original = version1({ value: "first" });
  const previous = version1({ value: "second" });
  await writeFile(path, original);
  let current = true;
  let seen: unknown;
  const predecessor = createStrict().update(() => {
    current = false;
    return { value: "second" };
  });
  const guarded = createStrict().updateObserved((before) => {
    seen = before;
    return { value: "third" };
  }, () => current);
  await predecessor;
  expect(await guarded).toEqual({ attempted: false, stale: true,
    persisted: { status: "valid", format: "version1", data: { value: "second" } } });
  expect(seen).toEqual({ value: "second" });
  expect(await readFile(path, "utf8")).toBe(previous);
  expect(await readFile(`${path}.bak`, "utf8")).toBe(original);
  expect((await readdir(directory)).sort()).toEqual(["state.json", "state.json.bak"]);
});

test("byte-identical observed updates still require a current condition", async () => {
  const original = version1({ value: "kept" });
  await writeFile(path, original);
  const denied = await createStrict().updateObserved((before) => before, () => false);
  expect(denied).toEqual({ attempted: false, stale: true,
    persisted: { status: "valid", format: "version1", data: { value: "kept" } } });
  const accepted = await createStrict().updateObserved((before) => before, () => true);
  expect(accepted).toMatchObject({ attempted: true, confirmed: true });
  expect(await readFile(path, "utf8")).toBe(original);
  expect(await readdir(directory)).toEqual(["state.json"]);
});

test("guarded publication requires a boolean true and observes the persisted record", async () => {
  const store = createSettingsStore<Record<string, unknown>>(path,
    (value) => isSettingsObject(value) ? { ...value, observed: true } : {},
    { maxBytes: 4096, validateData: isSettingsObject });
  const data = { value: "published" };
  const rejected = await store.updateObserved(() => data,
    // @ts-expect-error The runtime must reject a malformed caller's truthy value.
    () => 1);
  expect(rejected).toEqual({ attempted: false, stale: true, persisted: { status: "missing" } });
  expect(await readdir(directory)).toEqual([]);
  const accepted = await store.updateObserved(() => data, () => true);
  expect(accepted).toMatchObject({ attempted: true, confirmed: true, expected: data,
    persisted: { status: "valid", format: "version1", data: { ...data, observed: true } } });
  expect(await readFile(path, "utf8")).toBe(version1(data));
});

test("invalidation before the backup rename preserves both existing files", async () => {
  const original = version1({ value: "kept" });
  const backup = version1({ value: "older" });
  await writeFile(path, original);
  await writeFile(`${path}.bak`, backup);
  let prepared: string | undefined;
  const result = await createStrict().updateObserved(() => ({ value: "proposed" }), () => {
    const temporary = stagedFile("state.json.bak");
    if (!temporary) return true;
    prepared = readFileSync(join(directory, temporary), "utf8");
    return false;
  });
  expect(prepared).toBe(original);
  expect(result).toEqual({ attempted: false, stale: true,
    persisted: { status: "valid", format: "version1", data: { value: "kept" } } });
  expect(await readFile(path, "utf8")).toBe(original);
  expect(await readFile(`${path}.bak`, "utf8")).toBe(backup);
  expect((await readdir(directory)).sort()).toEqual(["state.json", "state.json.bak"]);
});

test("a condition that throws after temporary write preserves the authoritative bytes", async () => {
  const original = version1({ value: "kept" });
  const next = { value: "proposed" };
  await writeFile(path, original);
  let prepared: string | undefined;
  let authorityAtCheck: string | undefined;
  const result = await createStrict().updateObserved(() => next, () => {
    const temporary = stagedFile("state.json");
    if (!temporary) return true;
    prepared = readFileSync(join(directory, temporary), "utf8");
    authorityAtCheck = readFileSync(path, "utf8");
    throw Error("condition no longer available");
  });
  expect(prepared).toBe(version1(next));
  expect(authorityAtCheck).toBe(original);
  expect(result).toEqual({ attempted: false, stale: true,
    persisted: { status: "valid", format: "version1", data: { value: "kept" } } });
  expect(await readFile(path, "utf8")).toBe(original);
  expect(await readFile(`${path}.bak`, "utf8")).toBe(original);
  expect((await readdir(directory)).sort()).toEqual(["state.json", "state.json.bak"]);
});

test("invalidation after dispatching rename reports the publication without rollback", async () => {
  await writeFile(path, version1({ value: "kept" }));
  const next = { value: "published" };
  let current = true;
  const result = await createStrict().updateObserved(() => next, () => {
    if (stagedFile("state.json")) queueMicrotask(() => { current = false; });
    return current;
  });
  expect(current).toBe(false);
  expect(result).toMatchObject({ attempted: true, confirmed: true,
    persisted: { status: "valid", format: "version1", data: next } });
  expect(await readFile(path, "utf8")).toBe(version1(next));
});
