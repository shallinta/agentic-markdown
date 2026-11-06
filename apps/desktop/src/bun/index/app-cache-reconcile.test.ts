import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  prepareColdAppIndexCache, reconcileActiveAppIndexCache, refreshActiveAppIndexCache, reopenAppIndexCache,
} from "./app-cache";
import { record, type IndexRosterRow } from "./protocol";

const prefix = "f064bj-index-reconcile-";
const isolated = process.env.AGENTIC_MARKDOWN_INDEX_RECONCILE_TEST === "1";
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const scopeKey = sha("isolated interrupted index refresh");
const guard = { current: () => true, verify: () => Promise.resolve(true) };
const fail = <E extends string>(error: E) => ({ ok: false as const, error, accepted: error === "UNKNOWN" });
const original = [{ id: "a", raw: "\uFEFF😀old target\r\n" }, { id: "b", raw: "原始无命中" }] as const;
const edited = [{ id: "a", raw: "\uFEFF😀new target\r\n" }, { id: "b", raw: "新版无命中" }] as const;
const wrongRoster = [edited[0], original[1]];

test.skipIf(isolated)("isolated interrupted index reconciliation leaves no fixture data", async () => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  try {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: {
        ...process.env,
        TMPDIR: scratch,
        AGENTIC_MARKDOWN_HOME: join(scratch, "home"),
        AGENTIC_MARKDOWN_INDEX_RECONCILE_TEST: "1",
      },
      stdout: "pipe", stderr: "pipe",
    });
    const [exit, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (exit !== 0) throw Error(stdout + stderr);
    expect(stderr).toContain("1 pass");
    expect(await readdir(scratch)).toEqual([]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 20_000);

test.skipIf(!isolated)("reconciliation only publishes a catalog for the complete authorized next native generation", async () => {
  const scratch = await realpath(tmpdir());
  const home = join(scratch, "home");
  if (!basename(scratch).startsWith(prefix) ||
      process.env.AGENTIC_MARKDOWN_HOME !== home || (await readdir(scratch)).length)
    throw Error("Missing isolated index reconciliation fixture");
  const profile = join(home, "search-index", "limited-v1");
  const catalog = join(profile, "catalog.json");
  const index = join(profile, "index");
  const lease = join(profile, ".lease");
  const operations: unknown[][] = [];
  const leases = new Set<string>();
  const OriginalWorker = globalThis.Worker;
  let workers = 0;
  function observeLease() {
    const stat = lstatSync(lease, { bigint: true });
    if (!stat.isDirectory() || (stat.mode & 0o777n) !== 0o700n)
      throw Error("Missing private reconciliation lease");
    leases.add(`${stat.dev}:${stat.ino}:${stat.birthtimeNs}`);
  }
  class RecordingWorker extends OriginalWorker {
    private readonly serial = ++workers;
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      observeLease();
      this.addEventListener("close", event => {
        observeLease();
        operations.push([this.serial, "exit", "code" in event ? event.code : undefined]);
      });
    }
    override postMessage(message: unknown) {
      observeLease();
      if (!record(message)) throw Error("Missing native request");
      const { op, payload } = message;
      const extra = op === "open" && record(payload) ? payload.mode : op === "verify-roster" ? payload : undefined;
      operations.push(extra === undefined ? [this.serial, op] : [this.serial, op, extra]);
      super.postMessage(message);
    }
  }
  function resetTrace() {
    workers = 0;
    operations.length = 0;
    leases.clear();
  }
  async function seed() {
    await rm(home, { recursive: true, force: true });
    await mkdir(home, { mode: 0o700 });
    expect(await prepareColdAppIndexCache({ scopeKey, rows: original }, guard)).toEqual({
      ok: true, generation: 1, documents: 2,
    });
    resetTrace();
  }
  async function identity(path: string) {
    const stat = await lstat(path, { bigint: true });
    const stamp = [stat.dev, stat.ino, stat.mode, stat.uid, stat.nlink, stat.size,
      stat.birthtimeNs, stat.mtimeNs, stat.ctimeNs];
    return { stamp, hash: stat.isFile() ? sha(await readFile(path)) : undefined };
  }
  async function nativeInventory() {
    const files = (await readdir(index)).sort();
    return { directory: await identity(index),
      files: await Promise.all(files.map(async name => ({ name, ...(await identity(join(index, name))) }))) };
  }
  const target = { scopeKey, expectedGeneration: 1, rows: edited };
  const reconcile = (rows: readonly IndexRosterRow[] = edited, expectedGeneration = 1) =>
    reconcileActiveAppIndexCache({ scopeKey, expectedGeneration, rows }, guard);
  async function interrupted() {
    await seed();
    const prior = await identity(catalog);
    let checks = 0;
    expect(await refreshActiveAppIndexCache(target, {
      ...guard, verify: () => Promise.resolve(++checks !== 2),
    })).toEqual(fail("STALE"));
    expect(checks).toBe(2);
    expect(await identity(catalog)).toEqual(prior);
    expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);
    expect(await reopenAppIndexCache({ scopeKey, rows: original, query: "target" }, guard.current))
      .toEqual(fail("SCHEMA"));
    resetTrace();
    return { catalog: prior, native: await nativeInventory() };
  }
  function expectReader(rows: readonly IndexRosterRow[]) {
    expect(workers).toBe(1);
    expect(leases.size).toBe(1);
    expect(operations).toEqual([
      [1, "open", "reader-only"], [1, "verify-roster", rows],
      [1, "close"], [1, "exit", 0],
    ]);
  }
  async function expectRestored() {
    expect(JSON.parse(await readFile(catalog, "utf8"))).toEqual({
      version: 1, profile: "limited-v1", scopeKey, generation: 2,
      entries: edited.map(({ id, raw }) => ({ id, hash: sha(raw) })),
    });
    expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);
  }

  Object.defineProperty(globalThis, "Worker", { value: RecordingWorker, configurable: true });
  try {
    await mkdir(home, { mode: 0o700 });
    expect(await reconcile()).toEqual(fail("MISSING"));
    expect(await readdir(home)).toEqual([]);
    expect(await reconcile(edited, Number.MAX_SAFE_INTEGER)).toEqual(fail("LIMIT"));
    expect(await readdir(home)).toEqual([]);
    expect(workers).toBe(0);

    await seed();
    const sameGeneration = { catalog: await identity(catalog), native: await nativeInventory() };
    expect(await reconcile(original)).toEqual(fail("SCHEMA"));
    expect(workers).toBe(0);
    expect(await identity(catalog)).toEqual(sameGeneration.catalog);
    expect(await nativeInventory()).toEqual(sameGeneration.native);

    const split = await interrupted();
    expect(await reconcileActiveAppIndexCache({ ...target, scopeKey: sha("foreign") }, guard))
      .toEqual(fail("SCHEMA"));
    expect(await reconcile(edited, 2)).toEqual(fail("MISMATCH"));
    expect(await reconcileActiveAppIndexCache(target, { ...guard, current: () => false })).toEqual(fail("CANCELLED"));
    expect(await reconcileActiveAppIndexCache(target, { ...guard, verify: () => Promise.resolve(false) }))
      .toEqual(fail("STALE"));
    expect(workers).toBe(0);
    expect(await identity(catalog)).toEqual(split.catalog);
    expect(await nativeInventory()).toEqual(split.native);

    expect(await reconcile(wrongRoster)).toEqual(fail("SCHEMA"));
    expectReader(wrongRoster);
    expect(await identity(catalog)).toEqual(split.catalog);
    expect(await nativeInventory()).toEqual(split.native);
    resetTrace();
    let checks = 0;
    expect(await reconcileActiveAppIndexCache(target, {
      ...guard, verify: () => Promise.resolve(++checks !== 2),
    })).toEqual(fail("STALE"));
    expect(checks).toBe(2);
    expectReader(edited);
    expect(await identity(catalog)).toEqual(split.catalog);
    expect(await nativeInventory()).toEqual(split.native);
    resetTrace();

    expect(await reconcile()).toEqual({ ok: true, generation: 2, documents: 2 });
    expectReader(edited);
    await expectRestored();
    expect(await nativeInventory()).toEqual(split.native);
    const restored = await identity(catalog);
    resetTrace();
    expect(await reconcile()).toEqual(fail("MISMATCH"));
    expect(workers).toBe(0);
    expect(await identity(catalog)).toEqual(restored);
    expect(await reopenAppIndexCache({ scopeKey, rows: edited, query: "new target" }, guard.current))
      .toMatchObject({ ok: true, generation: 2, hits: [{ id: "a", from: 3, to: 13 }] });
    expect(await nativeInventory()).toEqual(split.native);

    const lateSplit = await interrupted();
    checks = 0;
    expect(await reconcileActiveAppIndexCache(target, {
      ...guard, verify: () => Promise.resolve(++checks !== 3),
    })).toEqual(fail("STALE"));
    expect(checks).toBe(3);
    expectReader(edited);
    await expectRestored();
    expect(await nativeInventory()).toEqual(lateSplit.native);

    await seed();
    const oldBytes = await readFile(catalog);
    expect(await refreshActiveAppIndexCache(target, guard)).toEqual({ ok: true, generation: 2, documents: 2, applied: 2 });
    expect(await refreshActiveAppIndexCache({ ...target, expectedGeneration: 2, rows: original }, guard))
      .toEqual({ ok: true, generation: 3, documents: 2, applied: 2 });
    await writeFile(catalog, oldBytes);
    const jumped = { catalog: await identity(catalog), native: await nativeInventory() };
    resetTrace();
    expect(await reconcile(original)).toEqual(fail("SCHEMA"));
    expect(workers).toBe(0);
    expect(await identity(catalog)).toEqual(jumped.catalog);
    expect(await nativeInventory()).toEqual(jumped.native);
    expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);
  } finally {
    Object.defineProperty(globalThis, "Worker", { value: OriginalWorker, configurable: true });
    await rm(home, { recursive: true, force: true });
  }
}, 15_000);
