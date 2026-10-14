import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRecentFiles } from "./recent-files";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function create() {
  const dir = await mkdtemp(join(tmpdir(), "recent-files-test-"));
  dirs.push(dir);
  return { dir, store: createRecentFiles(dir) };
}
test("recent records bound to twenty, dedupe, survive reload and clear in enqueue order", async () => {
  const { dir, store } = await create();
  for (let i = 0; i < 21; i++)
    await store.recordSelected({ path: `/tmp/${i}.md`, accessedAt: i });
  await store.recordSelected({ path: "/tmp/5.md", accessedAt: 100 });
  const first = await store.request({ op: "list" });
  expect(first.available).toBe(true);
  if (!first.available) return;
  expect(first.entries.length).toBe(20);
  expect(first.entries[0].path).toBe("/tmp/5.md");
  expect(first.entries.some((e) => e.path === "/tmp/0.md")).toBe(false);
  expect(await createRecentFiles(dir).request({ op: "list" })).toEqual(first);
  await store.request({ op: "remove", id: first.entries[0].id });
  const before = store.recordSelected({
    path: "/tmp/before.md",
    accessedAt: 101,
  });
  const cleared = store.request({ op: "clear" });
  const after = store.recordSelected({
    path: "/tmp/after.md",
    accessedAt: 102,
  });
  await Promise.all([before, cleared, after]);
  await store.drain();
  const final = await store.request({ op: "list" });
  expect(final.available && final.entries.map((e) => e.path)).toEqual([
    "/tmp/after.md",
  ]);
});
test("invalid update cannot normalize away prior entries; corrupt and future bytes remain untouched", async () => {
  const { dir, store } = await create();
  await store.recordSelected({ path: "/tmp/good.md", accessedAt: 1 });
  const path = join(dir, "recent-files.json"),
    before = await readFile(path, "utf8");
  await store.recordSelected({
    path: "/" + "a".repeat(4096) + ".md",
    accessedAt: 2,
  });
  expect(await readFile(path, "utf8")).toBe(before);
  for (const bad of [
    '{"version":2,"data":{"entries":[]}}',
    '{"version":1,"data":{"entries":[{}]}}',
    "{broken",
  ]) {
    await writeFile(path, bad);
    expect((await store.request({ op: "list" })).available).toBe(false);
    expect((await store.request({ op: "clear" })).available).toBe(false);
    expect(await readFile(path, "utf8")).toBe(bad);
  }
});
test("bounded pending queue reports overflow without unhandled rejection and rejects renderer paths", async () => {
  const { store } = await create();
  const work = Array.from({ length: 70 }, (_, i) =>
    store.recordSelected({ path: `/tmp/${i}.md`, accessedAt: i })
  );
  await Promise.all(work);
  await store.drain();
  const result = await store.request({ op: "list" });
  expect(result.available && result.warning).toBe("queue-full");
  expect(await store.request({ op: "clear", path: "/tmp/other.md" })).toEqual({
    available: false,
    reason: "invalid",
  });
});
