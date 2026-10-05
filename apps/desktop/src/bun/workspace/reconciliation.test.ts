import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { authorizeRoot, type RootAuthorization } from "./authorization";
import {
  createReconciliation,
  type ReconciliationRoot,
} from "./reconciliation";
import type { ScanBatch, ScanFile } from "./scan";

let directory: string, authorization: RootAuthorization;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "reconcile-unit-"));
  authorization = await authorizeRoot(directory);
  directory = authorization.path;
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
const file = (
  name: string,
  fingerprint = "1:2:3",
  chain: ScanFile["chain"] = []
): ScanFile => ({ path: join(directory, name), fingerprint, chain });
const batch = (
  files: ScanFile[],
  extra: Partial<ScanBatch> = {}
): ScanBatch => ({
  files,
  done: true,
  paused: false,
  errors: 0,
  examined: files.length,
  queueBytes: 0,
  ...extra,
});
function fixture(
  initial = [file("keep.md")],
  batches = [batch(initial)],
  limit = 1_000_000
) {
  const handle = randomUUID();
  const nodes = initial.map((f) => ({
    handle: randomUUID(),
    parent: handle,
    name: f.path.slice(directory.length + 1),
    displayPath: f.path,
    kind: "file" as const,
  }));
  let root: ReconciliationRoot | undefined = {
    lifetime: {},
    handle,
    generation: 1,
    showHidden: false,
    authorization,
    nodes,
    files: new Map(initial.map((f, i) => [nodes[i].handle, f])),
  };
  const calls: Record<string, unknown>[] = [];
  let active = 0,
    maximum = 0;
  const worker = {
    async call(message: Record<string, unknown>): Promise<unknown> {
      calls.push(message);
      active++;
      maximum = Math.max(maximum, active);
      try {
        await Promise.resolve();
        return message.op === "next" ? batches.shift() : undefined;
      } finally {
        active--;
      }
    },
    dispose() {
      return undefined;
    },
  };
  let used = 100;
  const service = createReconciliation({
    getRoot: (h) => (h === handle ? root : undefined),
    usedBytes: () => used,
    limit,
    worker,
    wake() {
      return undefined;
    },
  });
  const drain = async () => {
    for (let i = 0; service.hasWork() && i < 50; i++) await service.step();
    expect(service.hasWork()).toBe(false);
  };
  return {
    service,
    handle,
    nodes,
    calls,
    worker,
    drain,
    maximum: () => maximum,
    setRoot: (value: typeof root) => {
      root = value;
    },
    root: () => root,
    setUsed: (value: number) => {
      used = value;
    },
  };
}

test("private candidate joins duplicate requests, reports complete diff, and never mutates baseline", async () => {
  const f = fixture(
    [file("keep.md"), file("gone.md"), file("replace.md")],
    [
      batch([
        file("keep.md"),
        file("new.md"),
        file("replace.md", "1:9:3"),
        file("keep.md"),
      ]),
    ]
  );
  const before = JSON.stringify([...f.root()!.files]);
  const pending = Array.from({ length: 40 }, () => f.service.prepare(f.handle));
  expect(await f.service.prepare("different")).toEqual({
    ok: false,
    reason: "BUSY",
  });
  await f.drain();
  const results = await Promise.all(pending);
  const result = results[0];
  if (!result.ok) throw Error(result.reason);
  expect(result.summary).toMatchObject({
    added: 1,
    removed: 1,
    replaced: 1,
    retainedHandles: [f.nodes[0].handle],
  });
  result.summary.retainedHandles.length = 0;
  expect(f.service.get(result.summary.token)).toMatchObject({
    ok: true,
    summary: { retainedHandles: [f.nodes[0].handle] },
  });
  expect(JSON.stringify([...f.root()!.files])).toBe(before);
  expect(f.root()!.generation).toBe(1);
  expect(f.calls.map((v) => v.op)).toEqual(["start", "next", "close"]);
  expect(f.calls[0].key).not.toBe(`${f.handle}:1`);
  expect(f.maximum()).toBe(1);
  f.service.release(result.summary.token);
  f.service.release(result.summary.token);
  expect(f.service.get(result.summary.token)).toBeUndefined();
  await f.drain();
  expect(f.service.bytes()).toBe(0);
});

test("errors, partial budget and incomplete/conflicting chains yield no deletion set", async () => {
  for (const b of [
    batch([], { errors: 1 }),
    batch([], { paused: true }),
    batch([file("dir/a.md")]),
    batch([file("a.md"), file("a.md", "1:8:3")]),
    batch([
      file("dir/a.md", "1:2:3", [
        { path: join(directory, "dir"), fingerprint: "1:4:3" },
      ]),
      file("dir/b.md", "1:2:3", [
        { path: join(directory, "dir"), fingerprint: "1:5:3" },
      ]),
    ]),
    batch([
      file("dir/a.md", "1:2:3", [
        { path: join(directory, "wrong"), fingerprint: "1:4:3" },
      ]),
    ]),
  ]) {
    const f = fixture(undefined, [b]);
    const pending = f.service.prepare(f.handle);
    await f.drain();
    expect(await pending).toEqual({ ok: false, reason: "FAILED" });
    expect(f.service.bytes()).toBe(0);
  }
  const small = fixture(undefined, undefined, 101);
  expect(await small.service.prepare(small.handle)).toEqual({
    ok: false,
    reason: "BUDGET",
  });
  expect(small.calls).toHaveLength(0);
});

test("complete empty candidate is read-only and lifetime/generation changes invalidate results", async () => {
  const f = fixture(undefined, [batch([])]);
  const pending = f.service.prepare(f.handle);
  await f.drain();
  const result = await pending;
  if (!result.ok) throw Error(result.reason);
  expect(result.summary.removed).toBe(1);
  expect(f.root()!.nodes).toHaveLength(1);
  f.setRoot({ ...f.root()!, generation: 2 });
  expect(f.service.get(result.summary.token)).toBeUndefined();
  await f.drain();
  expect(f.service.bytes()).toBe(0);
  f.setRoot(undefined);
  expect(await f.service.prepare(f.handle)).toEqual({
    ok: false,
    reason: "NOT_READY",
  });
});

test("in-flight invalidation and disposal close the private worker key and settle callers", async () => {
  for (const kind of ["release", "dispose", "budget"] as const) {
    const f = fixture();
    const pending = f.service.prepare(f.handle);
    await f.service.step();
    if (kind === "dispose") f.service.dispose();
    else if (kind === "budget") f.setUsed(1_000_000);
    else f.service.invalidate(f.handle);
    await f.drain();
    expect(await pending).toEqual({ ok: false, reason: "INVALIDATED" });
    expect(f.calls.map((v) => v.op)).toEqual(["start", "close"]);
    expect(f.service.bytes()).toBe(0);
  }
});

test("late worker batch cannot survive invalidation and candidate growth includes baseline budget", async () => {
  const f = fixture();
  const pending = f.service.prepare(f.handle);
  await f.service.step();
  const gate = Promise.withResolvers<unknown>();
  f.worker.call = (message) =>
    message.op === "next" ? gate.promise : Promise.resolve();
  const step = f.service.step();
  f.service.invalidate();
  gate.resolve(batch([file("new.md")]));
  await step;
  await f.drain();
  expect(await pending).toEqual({ ok: false, reason: "INVALIDATED" });
  expect(f.root()!.nodes).toHaveLength(1);

  const constrained = fixture(
    undefined,
    [batch(Array.from({ length: 30 }, (_, i) => file(`new-${i}.md`)))],
    4000
  );
  const growth = constrained.service.prepare(constrained.handle);
  await constrained.drain();
  expect(await growth).toEqual({ ok: false, reason: "BUDGET" });
  expect(constrained.service.bytes()).toBe(0);
});
