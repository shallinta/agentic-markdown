import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { prepareColdAppIndexCache, reopenAppIndexCache } from "./app-cache";
import { record, type IndexRosterRow } from "./protocol";

const prefix = "f064bg-index-prepare-";
const isolated = process.env.AGENTIC_MARKDOWN_INDEX_PREPARE_TEST === "1";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const input = {
  scopeKey: sha("cold isolated workspace snapshot"),
  rows: [{ id: "fixture-a", raw: "\uFEFF😀target\r\n" }, { id: "fixture-b", raw: "无匹配" }],
};
const failed = <E extends string>(error: E) => ({ ok: false as const, error, accepted: error === "UNKNOWN" });
const guard = { current: () => true, verify: () => Promise.resolve(true) };

async function fixture() {
  const scratch = await realpath(tmpdir());
  const home = join(scratch, "home");
  if (!basename(scratch).startsWith(prefix) || process.env.AGENTIC_MARKDOWN_HOME !== home ||
      (await readdir(scratch)).length)
    throw Error("Missing isolated cold-index fixture");
  const profile = join(home, "search-index", "limited-v1");
  const lease = join(profile, ".lease");
  const catalog = join(profile, "catalog.json");
  const trace: unknown[][] = [];
  const leases = new Set<string>();
  const OriginalWorker = globalThis.Worker;
  let workers = 0;
  let failedClose: number | undefined;
  function noteLease() {
    const stat = lstatSync(lease, { bigint: true });
    if (!stat.isDirectory() || (stat.mode & 0o777n) !== 0o700n)
      throw Error("Cold index operation lacks a private lease");
    leases.add(`${stat.dev}:${stat.ino}:${stat.birthtimeNs}`);
  }
  class RecordingWorker extends OriginalWorker {
    private readonly serial = ++workers;
    private closeId: number | undefined;
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      noteLease();
      this.addEventListener("close", event => {
        noteLease();
        trace.push([this.serial, "exit", "code" in event ? event.code : undefined]);
      });
      Object.defineProperty(this, "onmessage", {
        set: (listener: (event: MessageEvent<unknown>) => void) => {
          super.onmessage = (event: MessageEvent<unknown>) => {
            if (this.serial === failedClose && this.closeId !== undefined &&
                record(event.data) && event.data.id === this.closeId &&
                record(event.data.result) && event.data.result.ok === true) {
              trace.push([this.serial, "close-receipt-injected"]);
              listener(new MessageEvent("message", {
                data: { ...event.data, result: failed("UNKNOWN") },
              }));
            } else listener(event);
          };
        },
      });
    }
    override postMessage(message: unknown) {
      noteLease();
      if (!record(message)) throw Error("Missing native request envelope");
      const { op, payload, id } = message;
      if (op === "close" && typeof id === "number") this.closeId = id;
      const value = op === "open" && record(payload) ? payload.mode
        : op === "verify-roster" ? payload : undefined;
      trace.push(value === undefined ? [this.serial, op] : [this.serial, op, value]);
      super.postMessage(message);
    }
  }
  async function reset() {
    await rm(home, { recursive: true, force: true });
    await mkdir(home, { mode: 0o700 });
    trace.length = 0;
    leases.clear();
    workers = 0;
    failedClose = undefined;
  }
  return {
    home, profile, lease, catalog, trace, leases, noteLease, reset,
    workers: () => workers,
    failClose(serial: number) { failedClose = serial; },
    record() { Object.defineProperty(globalThis, "Worker", { value: RecordingWorker, configurable: true }); },
    async dispose() {
      Object.defineProperty(globalThis, "Worker", { value: OriginalWorker, configurable: true });
      await rm(home, { recursive: true, force: true });
    },
  };
}

function expectedCatalog(rows: readonly IndexRosterRow[]) {
  return {
    version: 1, profile: "limited-v1", scopeKey: input.scopeKey, generation: Number(rows.length > 0),
    entries: rows.map(({ id, raw }) => ({ id, hash: sha(raw) })),
  };
}

function expectedTrace(rows: readonly IndexRosterRow[]) {
  return [
    [1, "open", "create-new"], ...(rows.length ? [[1, "apply"]] : []), [1, "close"], [1, "exit", 0],
    [2, "open", "reader-only"], [2, "verify-roster", rows], [2, "close"], [2, "exit", 0],
  ];
}

test.skipIf(isolated)("isolated cold preparation verifies the roster and leaves no fixture data", async () => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  try {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: {
        ...process.env, TMPDIR: scratch, AGENTIC_MARKDOWN_HOME: join(scratch, "home"),
        AGENTIC_MARKDOWN_INDEX_PREPARE_TEST: "1",
      },
      stdout: "pipe", stderr: "pipe",
    });
    const [exit, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (exit !== 0) throw Error(stdout + stderr);
    expect(stderr).toContain("3 pass");
    expect(await readdir(scratch)).toEqual([]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 15_000);

test.skipIf(!isolated)("cold prepare uses one lease for the writer, full reader verification and readback", async () => {
  const f = await fixture();
  f.record();
  try {
    for (const rows of [input.rows, []]) {
      await f.reset();
      const phases: { calls: number; catalog: boolean }[] = [];
      const callerRows = rows.map(row => ({ ...row }));
      expect(await prepareColdAppIndexCache({ ...input, rows: callerRows }, {
        current: guard.current,
        verify: () => {
          f.noteLease();
          phases.push({ calls: f.trace.length, catalog: existsSync(f.catalog) });
          if (phases.length === 1) {
            for (const row of callerRows) row.raw = "changed after admission";
            callerRows.push({ id: "late", raw: "changed roster" });
          }
          return Promise.resolve(true);
        },
      })).toEqual({ ok: true, generation: Number(rows.length > 0), documents: rows.length });
      expect(f.workers()).toBe(2);
      expect(f.trace).toEqual(expectedTrace(rows));
      expect(phases).toEqual([
        { calls: 0, catalog: false },
        { calls: f.trace.length, catalog: false },
        { calls: f.trace.length, catalog: true },
      ]);
      expect(f.leases.size).toBe(1);
      expect(JSON.parse(await readFile(f.catalog, "utf8"))).toEqual(expectedCatalog(rows));
      expect((await lstat(f.catalog)).mode & 0o777).toBe(0o600);
      expect((await readdir(f.profile)).sort()).toEqual(["catalog.json", "index"]);

      const catalog = await readFile(f.catalog);
      const before = await lstat(f.catalog, { bigint: true });
      expect(await prepareColdAppIndexCache({ ...input, rows }, guard)).toEqual(failed("SCHEMA"));
      expect(await readFile(f.catalog)).toEqual(catalog);
      const after = await lstat(f.catalog, { bigint: true });
      expect({ ino: after.ino, mtime: after.mtimeNs, ctime: after.ctimeNs })
        .toEqual({ ino: before.ino, mtime: before.mtimeNs, ctime: before.ctimeNs });
      expect(f.workers()).toBe(2);
      expect(await reopenAppIndexCache({ ...input, rows, query: "target" }, guard.current)).toMatchObject({
        ok: true, generation: Number(rows.length > 0),
        hits: rows.length ? [{ id: "fixture-a", from: 3, to: 9 }] : [],
      });
    }
  } finally {
    await f.dispose();
  }
});

test.skipIf(!isolated)("cold prepare fences invalid requests and each authorization stage", async () => {
  const f = await fixture();
  f.record();
  try {
    expect(await prepareColdAppIndexCache({ ...input, scopeKey: "invalid" }, guard)).toEqual(failed("INPUT"));
    expect(await prepareColdAppIndexCache({ ...input, rows: [{ id: "a", raw: "x".repeat(65_537) }] }, guard))
      .toEqual(failed("LIMIT"));
    expect(await prepareColdAppIndexCache(input, { ...guard, current: () => false })).toEqual(failed("CANCELLED"));
    expect(f.workers()).toBe(0);
    for (const phase of [1, 2, 3]) {
      await f.reset();
      let checks = 0;
      expect(await prepareColdAppIndexCache(input, {
        current: guard.current, verify: () => Promise.resolve(++checks !== phase),
      })).toEqual(failed("STALE"));
      expect(checks).toBe(phase);
      expect(f.trace).toEqual(phase === 1 ? [] : expectedTrace(input.rows));
      expect((await readdir(f.profile)).sort()).toEqual(
        phase === 1 ? [] : phase === 2 ? ["index"] : ["catalog.json", "index"]
      );
    }
    await f.reset();
    let authorized = true, checks = 0;
    expect(await prepareColdAppIndexCache(input, {
      current: () => authorized,
      verify: () => {
        if (++checks === 2) authorized = false;
        return Promise.resolve(true);
      },
    })).toEqual(failed("CANCELLED"));
    expect(checks).toBe(2);
    expect(f.trace).toEqual(expectedTrace(input.rows));
    expect(await readdir(f.profile)).toEqual(["index"]);

    await f.reset();
    expect(await prepareColdAppIndexCache(input, {
      ...guard, verify: () => Promise.reject(Error("fixture verification unavailable")),
    })).toEqual(failed("UNAVAILABLE"));
    expect(await readdir(f.profile)).toEqual([]);
    expect(f.workers()).toBe(0);
    await mkdir(f.lease, { mode: 0o700 });
    expect(await prepareColdAppIndexCache(input, guard)).toEqual(failed("BUSY"));
    expect(await readdir(f.lease)).toEqual([]);
    await rmdir(f.lease);
    const foreign = join(f.profile, "foreign");
    await writeFile(foreign, "preserve", { mode: 0o600 });
    expect(await prepareColdAppIndexCache(input, guard)).toEqual(failed("SCHEMA"));
    expect(await readFile(foreign, "utf8")).toBe("preserve");
    expect(await readdir(f.profile)).toEqual(["foreign"]);
    expect(f.workers()).toBe(0);
  } finally {
    await f.dispose();
  }
});

test.skipIf(!isolated)("uncertain close retains the lease and a competing catalog is never overwritten", async () => {
  const f = await fixture();
  f.record();
  try {
    for (const serial of [1, 2]) {
      await f.reset();
      f.failClose(serial);
      expect(await prepareColdAppIndexCache(input, guard)).toEqual(failed("UNKNOWN"));
      expect(f.workers()).toBe(serial);
      expect(f.trace).toContainEqual([serial, "close-receipt-injected"]);
      expect(f.trace).toContainEqual([serial, "exit", 0]);
      expect(f.leases.size).toBe(1);
      expect((await readdir(f.profile)).sort()).toEqual([".lease", "index"]);
      expect(await prepareColdAppIndexCache(input, guard)).toEqual(failed("BUSY"));
      expect(f.workers()).toBe(serial);
    }
    await f.reset();
    let checks = 0;
    expect(await prepareColdAppIndexCache(input, {
      ...guard,
      verify: async () => {
        if (++checks === 2) await writeFile(f.catalog, "competing catalog", { flag: "wx", mode: 0o600 });
        return true;
      },
    })).toEqual(failed("UNAVAILABLE"));
    expect(checks).toBe(2);
    expect(await readFile(f.catalog, "utf8")).toBe("competing catalog");
    expect((await readdir(f.profile)).sort()).toEqual(["catalog.json", "index"]);
    expect(f.trace).toEqual(expectedTrace(input.rows));

    await f.reset();
    checks = 0;
    const foreign = join(f.profile, "index", "foreign");
    expect(await prepareColdAppIndexCache(input, {
      ...guard,
      verify: async () => {
        if (++checks === 2) await writeFile(foreign, "preserve", { flag: "wx", mode: 0o600 });
        return true;
      },
    })).toEqual(failed("UNAVAILABLE"));
    expect(checks).toBe(2);
    expect(await readFile(foreign, "utf8")).toBe("preserve");
    expect(await readdir(f.profile)).toEqual(["index"]);
    expect(f.trace).toEqual(expectedTrace(input.rows));
  } finally {
    await f.dispose();
  }
});
