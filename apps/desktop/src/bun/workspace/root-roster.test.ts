import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WORKSPACE_MAX_ROOTS } from "../../shared/workspace";

import { createRootRoster } from "./root-roster";

const dirs: string[] = [];
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "root-roster-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

test("committed roots restart pending; exact covered pick preserves other descendants and close never clears", async () => {
  const dir = await directory(),
    first = createRootRoster(dir);
  expect(
    (await first.reconcile(["/fixture/parent/a", "/fixture/parent/b"]))
      .committed
  ).toBe(true);
  await first.close();
  const second = createRootRoster(dir);
  const restored = await second.read();
  expect(restored.state.live).toEqual([]);
  expect(restored.state.pending.map((e) => e.path)).toEqual([
    "/fixture/parent/a",
    "/fixture/parent/b",
  ]);
  // Actual parent was selected; unselected historical children remain pending.
  const parent = await second.reconcile(["/fixture/parent"], "/fixture/parent");
  expect(parent.state.pending).toHaveLength(2);
  const exact = await second.reconcile(
    ["/fixture/parent"],
    "/fixture/parent/a"
  );
  expect(exact.state.pending.map((e) => e.path)).toEqual(["/fixture/parent/b"]);
  await second.close();
  const bytes = await readFile(join(dir, "workspace-roots.json"));
  expect((await second.reconcile([])).state.failure).toBe("closed");
  expect(await readFile(join(dir, "workspace-roots.json"))).toEqual(bytes);
  const third = createRootRoster(dir);
  expect((await third.read()).state.pending.map((e) => e.path)).toEqual([
    "/fixture/parent",
    "/fixture/parent/b",
  ]);
  await third.close();
});

test("serialized accepted changes drain; explicit removals and clear persist", async () => {
  const dir = await directory(),
    first = createRootRoster(dir);
  const a = first.reconcile(["/a"]),
    b = first.reconcile(["/a", "/b"]);
  await first.close();
  expect((await a).committed).toBe(true);
  expect((await b).committed).toBe(true);
  const second = createRootRoster(dir),
    loaded = await second.read();
  expect(
    (await second.removePending(loaded.state.pending[0].id)).committed
  ).toBe(true);
  // A committed remove/Trash changes the live roster, without removing unrelated pending.
  await second.reconcile(["/c"], "/c");
  const removed = await second.reconcile([]);
  expect(removed.state.live).toEqual([]);
  expect(removed.state.pending.map((e) => e.path)).toEqual(["/b"]);
  expect((await second.clearExplicit()).committed).toBe(true);
  await second.close();
  expect((await createRootRoster(dir).read()).state.pending).toEqual([]);
});

test("combined pending/live overflow preserves durable bytes and committed live metadata", async () => {
  const dir = await directory(),
    first = createRootRoster(dir);
  await first.reconcile(
    Array.from({ length: WORKSPACE_MAX_ROOTS }, (_, i) => `/old/${i}`)
  );
  await first.close();
  const before = await readFile(join(dir, "workspace-roots.json"));
  const next = createRootRoster(dir),
    result = await next.reconcile(["/new", "/another"], "/new");
  expect(result.committed).toBe(false);
  expect(result.state.failure).toBe("capacity");
  expect((await next.read()).state.failure).toBe("capacity");
  expect(result.state.live.map((e) => e.path)).toEqual(["/new", "/another"]);
  expect(result.state.pending).toHaveLength(WORKSPACE_MAX_ROOTS);
  expect(await readFile(join(dir, "workspace-roots.json"))).toEqual(before);
  expect((await next.removePending(result.state.pending[0].id)).committed).toBe(
    true
  );
  expect((await next.read()).state.failure).toBe("capacity");
  const intermediate = createRootRoster(dir);
  const saved = (await intermediate.read()).state.pending;
  expect(saved.map((e) => e.path)).toEqual(
    result.state.pending.slice(1).map((e) => e.path)
  );
  await intermediate.close();
  expect((await next.removePending(result.state.pending[1].id)).committed).toBe(
    true
  );
  expect((await next.read()).state.failure).toBeUndefined();
  const restored = createRootRoster(dir);
  expect((await restored.read()).state.pending.map((e) => e.path)).toEqual([
    "/new",
    "/another",
    ...result.state.pending.slice(2).map((e) => e.path),
  ]);
  await restored.close();
  await next.close();
});

test("legacy, future, malformed, duplicate keys and invalid schema remain untouched", async () => {
  for (const [source, reason] of [
    ['{"entries":[]}', "legacy"],
    ['{"version":2,"data":{"entries":[]}}', "future"],
    ["{broken", "corrupt"],
    ['{"version":1,"version":1,"data":{"entries":[]}}', "corrupt"],
    [
      '{"version":1,"data":{"entries":[{"id":"bad","path":"/a","name":"a"}]}}',
      "corrupt",
    ],
  ] as const) {
    const dir = await directory(),
      file = join(dir, "workspace-roots.json");
    await writeFile(file, source);
    const roster = createRootRoster(dir);
    expect((await roster.read()).state.failure).toBe(reason);
    expect((await roster.reconcile(["/authorized"])).state.failure).toBe(
      reason
    );
    expect((await roster.clearExplicit()).committed).toBe(false);
    expect((await roster.read()).state.live).toEqual([]);
    expect(await readFile(file, "utf8")).toBe(source);
    await roster.close();
  }
});

test("post-load future version is protected; invalid paths never create a file", async () => {
  const dir = await directory(),
    roster = createRootRoster(dir);
  expect((await roster.reconcile(["relative"])).state.failure).toBe("invalid");
  expect((await roster.read()).state.pending).toEqual([]);
  const file = join(dir, "workspace-roots.json"),
    future = '{"version":9,"data":{"entries":[]}}';
  await writeFile(file, future);
  expect((await roster.reconcile(["/a"])).state.failure).toBe("future");
  expect(await readFile(file, "utf8")).toBe(future);
  await roster.close();
});

test("failed backup preserves durable original without rolling back a committed open; drain is reversible", async () => {
  const dir = await directory(),
    roster = createRootRoster(dir);
  await roster.reconcile(["/a"]);
  const file = join(dir, "workspace-roots.json"),
    before = await readFile(file);
  await mkdir(`${file}.bak`);
  const result = await roster.reconcile(["/a", "/b"], "/b");
  expect(result.committed).toBe(false);
  expect(result.state.failure).toBe("unknown");
  expect((await roster.read()).state.failure).toBe("unknown");
  expect(result.state.live.map((e) => e.path)).toEqual(["/a", "/b"]);
  expect(await readFile(file)).toEqual(before);
  await roster.drain();
  await rm(`${file}.bak`, { recursive: true });
  expect((await roster.reconcile(["/a", "/b"])).committed).toBe(true);
  expect((await roster.read()).state.failure).toBeUndefined();
  const committed = await readFile(file);
  expect((await roster.removePending("missing")).state.failure).toBe("invalid");
  expect(await readFile(file)).toEqual(committed);
  await roster.close();
});

test("queue saturation remains visible after older accepted writes drain", async () => {
  const dir = await directory(),
    seed = createRootRoster(dir);
  await seed.reconcile(["/pending"]);
  await seed.close();
  const roster = createRootRoster(dir);
  const pending = (await roster.read()).state.pending[0];
  const accepted = Array.from({ length: 64 }, () => roster.reconcile(["/old"]));
  expect((await roster.reconcile(["/new"])).state.failure).toBe("queue-full");
  await Promise.all(accepted);
  await roster.drain();
  expect((await roster.read()).state.failure).toBe("queue-full");
  expect((await roster.removePending(pending.id)).committed).toBe(true);
  expect((await roster.read()).state.failure).toBe("queue-full");
  expect((await roster.reconcile(["/new"])).committed).toBe(true);
  expect((await roster.read()).state.failure).toBeUndefined();
  await roster.close();
});
