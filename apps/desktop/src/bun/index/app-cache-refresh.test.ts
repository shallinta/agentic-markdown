import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { prepareColdAppIndexCache, refreshActiveAppIndexCache, reopenAppIndexCache } from "./app-cache";
import { record, type IndexRosterRow } from "./protocol";
import { acquireIndexReuseSlot } from "./reuse-catalog";
import { createIndexSession } from "./session";

const prefix = "f064bi-index-refresh-";
const isolated = process.env.AGENTIC_MARKDOWN_INDEX_REFRESH_TEST === "1";
const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");
const scopeKey = hash("isolated active index refresh");
const guard = { current: () => true, verify: () => Promise.resolve(true) };
const fail = <E extends string>(error: E) => ({ ok: false as const, error, accepted: error === "UNKNOWN" });
const original = [{ id: "a", raw: "\uFEFF😀old term\r\n" }, { id: "b", raw: "原始无命中" }] as const;
const edited = [{ id: "a", raw: "\uFEFF😀new term\r\n" }, { id: "b", raw: "预期无命中" }] as const;
const put = ({ id, raw }: IndexRosterRow) => ({ kind: "put", id, path: id, raw });

test.skipIf(isolated)("isolated active cache refresh exits with a clean fixture", async () => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  try {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: {
        ...process.env,
        TMPDIR: scratch,
        AGENTIC_MARKDOWN_HOME: join(scratch, "home"),
        AGENTIC_MARKDOWN_INDEX_REFRESH_TEST: "1",
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

test.skipIf(!isolated)("active refresh commits a bounded delta and independently verifies the entire new native roster", async () => {
  const scratch = await realpath(tmpdir());
  const home = join(scratch, "home");
  if (!basename(scratch).startsWith(prefix) ||
      process.env.AGENTIC_MARKDOWN_HOME !== home || (await readdir(scratch)).length)
    throw Error("Missing isolated active cache refresh fixture");
  const profile = join(home, "search-index", "limited-v1");
  const catalog = join(profile, "catalog.json");
  const lease = join(profile, ".lease");
  const operations: unknown[][] = [];
  const leases = new Set<string>();
  const OriginalWorker = globalThis.Worker;
  let workers = 0;
  function observeLease() {
    const stat = lstatSync(lease, { bigint: true });
    if (!stat.isDirectory() || (stat.mode & 0o777n) !== 0o700n)
      throw Error("Missing private active index lease");
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
      const extra = op === "open" && record(payload) ? payload.mode
        : op === "apply" || op === "verify-roster" ? payload : undefined;
      operations.push(extra === undefined ? [this.serial, op] : [this.serial, op, extra]);
      super.postMessage(message);
    }
  }
  function resetTrace() {
    workers = 0;
    operations.length = 0;
    leases.clear();
  }
  async function seed(rows: readonly IndexRosterRow[] = original) {
    await rm(home, { recursive: true, force: true });
    await mkdir(home, { mode: 0o700 });
    expect(await prepareColdAppIndexCache({ scopeKey, rows }, guard)).toEqual({
      ok: true, generation: Number(rows.length > 0), documents: rows.length,
    });
    resetTrace();
  }
  async function catalogIdentity() {
    const stat = await lstat(catalog, { bigint: true });
    return { ino: stat.ino, mode: stat.mode, size: stat.size, mtime: stat.mtimeNs, ctime: stat.ctimeNs,
      bytes: await readFile(catalog, "utf8") };
  }
  async function expectCatalog(generation: number, rows: readonly IndexRosterRow[]) {
    expect(JSON.parse((await catalogIdentity()).bytes)).toEqual({
      version: 1, profile: "limited-v1", scopeKey, generation,
      entries: rows.map(({ id, raw }) => ({ id, hash: hash(raw) }))
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    });
    expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);
  }
  const refresh = (expectedGeneration: number, rows: readonly IndexRosterRow[] = edited) =>
    refreshActiveAppIndexCache({ scopeKey, expectedGeneration, rows }, guard);
  function readerTrace(serial: number, rows: readonly IndexRosterRow[]) {
    return [
      [serial, "open", "reader-only"], [serial, "verify-roster", rows],
      [serial, "close"], [serial, "exit", 0],
    ];
  }
  function expectDelta(rows: readonly IndexRosterRow[], delta: readonly unknown[]) {
    expect(workers).toBe(2);
    expect(leases.size).toBe(1);
    const actualDelta = operations[1]?.[2];
    expect(actualDelta).toHaveLength(delta.length);
    expect(actualDelta).toEqual(expect.arrayContaining(delta));
    expect(operations).toEqual([
      [1, "open", "writer-existing"], [1, "apply", actualDelta], [1, "close"], [1, "exit", 0],
      ...readerTrace(2, rows),
    ]);
  }
  async function verifyNative(generation: number, rows: readonly IndexRosterRow[]) {
    const acquired = await acquireIndexReuseSlot(profile);
    if (!acquired.ok) throw Error("Fixture cannot independently acquire index lease");
    const session = createIndexSession();
    try {
      expect(await session.open(acquired.slot.indexPath, "reader-only")).toEqual({ ok: true, generation });
      expect(await session.verifyRoster(rows)).toEqual({ ok: true, generation });
    } finally {
      try { expect(await session.close()).toEqual({ ok: true, generation }); }
      finally { await acquired.slot.release(); }
    }
  }

  Object.defineProperty(globalThis, "Worker", { value: RecordingWorker, configurable: true });
  try {
    await mkdir(home, { mode: 0o700 });
    expect(await refresh(1)).toEqual(fail("MISSING"));
    expect(await readdir(home)).toEqual([]);
    expect(workers).toBe(0);
    await seed();
    const initial = await catalogIdentity();
    expect(await refreshActiveAppIndexCache({ scopeKey: hash("foreign"), expectedGeneration: 1, rows: edited }, guard))
      .toEqual(fail("SCHEMA"));
    expect(await refresh(2)).toEqual(fail("MISMATCH"));
    expect(await refreshActiveAppIndexCache({ scopeKey, expectedGeneration: 1, rows: edited }, {
      ...guard, current: () => false,
    })).toEqual(fail("CANCELLED"));
    expect(workers).toBe(0);
    expect(await catalogIdentity()).toEqual(initial);

    expect(await refresh(1)).toEqual({ ok: true, generation: 2, documents: 2, applied: 2 });
    expectDelta(edited, edited.map(put));
    await expectCatalog(2, edited);
    resetTrace();
    const replacement = [edited[0], { id: "c", raw: "另一篇文档" }] as const;
    expect(await refresh(2, replacement)).toEqual({ ok: true, generation: 3, documents: 2, applied: 2 });
    expectDelta(replacement, [{ kind: "delete", id: "b" }, put(replacement[1])]);
    await expectCatalog(3, replacement);
    resetTrace();
    const stable = await catalogIdentity();
    const reordered = [...replacement].reverse();
    expect(await refresh(3, reordered)).toEqual({ ok: true, generation: 3, documents: 2, applied: 0 });
    expect(operations).toEqual(readerTrace(1, reordered));
    expect(leases.size).toBe(1);
    expect(await catalogIdentity()).toEqual(stable);
    expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);
    expect(await reopenAppIndexCache({ scopeKey, rows: replacement, query: "new term" }, guard.current))
      .toMatchObject({ ok: true, generation: 3, hits: [{ id: "a", from: 3, to: 11 }] });
    resetTrace();
    expect(await refresh(3, [])).toEqual({ ok: true, generation: 4, documents: 0, applied: 2 });
    expectDelta([], [{ kind: "delete", id: "a" }, { kind: "delete", id: "c" }]);
    await expectCatalog(4, []);

    await seed(Array.from({ length: 9 }, (_, n) => ({ id: `old-${n}`, raw: "old" })));
    const overBudget = Array.from({ length: 9 }, (_, n) => ({ id: `new-${n}`, raw: "new" }));
    const budgetBaseline = await catalogIdentity();
    expect(await refresh(1, overBudget)).toEqual(fail("LIMIT"));
    expect(operations).toEqual([]);
    expect(workers).toBe(0);
    expect(await catalogIdentity()).toEqual(budgetBaseline);
    expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);

    await seed();
    await writeFile(catalog, (await readFile(catalog, "utf8")).replace(hash(original[1].raw), hash(edited[1].raw)));
    const forged = await catalogIdentity();
    expect(await refresh(1)).toEqual(fail("SCHEMA"));
    expectDelta(edited, [put(edited[0])]);
    expect(await catalogIdentity()).toEqual(forged);
    expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);
    expect(await reopenAppIndexCache({ scopeKey, rows: [original[0], edited[1]], query: "term" }, guard.current))
      .toEqual(fail("SCHEMA"));
    await verifyNative(2, [edited[0], original[1]]);
    expect(await catalogIdentity()).toEqual(forged);

    await seed();
    const beforeStale = await catalogIdentity();
    let checks = 0;
    expect(await refreshActiveAppIndexCache({ scopeKey, expectedGeneration: 1, rows: edited }, {
      ...guard, verify: () => Promise.resolve(++checks !== 2),
    })).toEqual(fail("STALE"));
    expect(checks).toBe(2);
    expectDelta(edited, edited.map(put));
    expect(await catalogIdentity()).toEqual(beforeStale);
    expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);
    await verifyNative(2, edited);
  } finally {
    Object.defineProperty(globalThis, "Worker", { value: OriginalWorker, configurable: true });
    await rm(home, { recursive: true, force: true });
  }
}, 15_000);
