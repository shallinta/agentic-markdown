import { afterEach, expect, test } from "bun:test";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  symlink,
  mkdir,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSettingsStore, isSettingsObject } from "./settings-store";
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "strict-store-"));
  dirs.push(dir);
  const path = join(dir, "s.json");
  const store = createSettingsStore(
    path,
    (value) => (isSettingsObject(value) ? value : { x: 0 }),
    {
      maxBytes: 128,
      validateData: (value) =>
        isSettingsObject(value) &&
        Object.keys(value).join() === "x" &&
        typeof value.x === "number",
    }
  );
  return { dir, path, store };
}
test("strict legacy exact backup, invalid output and envelope never overwrite", async () => {
  const { path, store } = await setup();
  const original = '{ "x" : 1 }\n';
  await writeFile(path, original);
  expect((await store.inspectState()).available).toBe(true);
  expect(await readFile(path + ".bak", "utf8")).toBe(original);
  const migrated = await readFile(path, "utf8");
  expect(
    await store
      .update(() => ({ wrong: true }))
      .then(
        () => false,
        () => true
      )
  ).toBe(true);
  expect(await readFile(path, "utf8")).toBe(migrated);
  for (const raw of [
    '{"version":1,"data":{"x":1},"extra":true}',
    '\ufeff{"x":1}',
    "x".repeat(129),
  ]) {
    await writeFile(path, raw);
    expect((await store.inspectState()).available).toBe(false);
    expect(
      await store
        .update(() => ({ x: 2 }))
        .then(
          () => false,
          () => true
        )
    ).toBe(true);
    expect(await readFile(path, "utf8")).toBe(raw);
  }
});
test("strict reader rejects directory, symlink and FIFO without blocking", async () => {
  const { dir, path, store } = await setup();
  await mkdir(path);
  expect((await store.inspectState()).available).toBe(false);
  await rm(path, { recursive: true });
  const other = join(dir, "target");
  await writeFile(other, '{"x":1}');
  await symlink(other, path);
  expect((await store.inspectState()).available).toBe(false);
  await rm(path);
  expect(await Bun.spawn(["mkfifo", path]).exited).toBe(0);
  expect((await store.inspectState()).available).toBe(false);
});
test("invalid UTF8 refuses overwrite; read-only directory write failure preserves original and backup", async () => {
  const { dir, path, store } = await setup();
  const bad = Buffer.from([0xc3, 0x28]);
  await writeFile(path, bad);
  expect(await store.inspectState()).toEqual({
    available: false,
    reason: "corrupt",
  });
  expect(
    await store
      .update(() => ({ x: 2 }))
      .then(
        () => false,
        () => true
      )
  ).toBe(true);
  expect(await readFile(path)).toEqual(bad);
  await writeFile(path, '{"version":1,"data":{"x":1}}');
  await writeFile(path + ".bak", "previous backup");
  const before = await readFile(path);
  await chmod(dir, 0o555);
  try {
    expect(
      await store
        .update(() => ({ x: 2 }))
        .then(
          () => false,
          () => true
        )
    ).toBe(true);
    expect(await readFile(path)).toEqual(before);
    expect(await readFile(path + ".bak", "utf8")).toBe("previous backup");
  } finally {
    await chmod(dir, 0o755);
  }
});
