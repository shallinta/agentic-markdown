import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { reopenAppIndexCache, searchAppIndexCache } from "./app-cache";
import { record } from "./protocol";

const prefix = "f064ah-index-reopen-";
const isolated = process.env.AGENTIC_MARKDOWN_INDEX_REOPEN_TEST === "1";
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

test.skipIf(isolated)("isolated exact index reopen tests leave no fixture data", async () => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  try {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: {
        ...process.env,
        TMPDIR: scratch,
        AGENTIC_MARKDOWN_HOME: join(scratch, "home"),
        AGENTIC_MARKDOWN_INDEX_REOPEN_TEST: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
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
}, 15_000);

test.skipIf(!isolated)("only exact same-roster storage starts a reader-only native session", async () => {
  const scratch = await realpath(tmpdir());
  const home = join(scratch, "home");
  if (!basename(scratch).startsWith(prefix) ||
      process.env.AGENTIC_MARKDOWN_HOME !== home || (await readdir(scratch)).length)
    throw Error("Missing isolated exact index reopen fixture");
  const cache = join(home, "search-index");
  const profile = join(cache, "limited-v1");
  const catalog = join(profile, "catalog.json");
  const index = join(profile, "index");
  const lease = join(profile, ".lease");
  const first = { id: "fixture-a", raw: "\uFEFF😀target\r\n" };
  const second = { id: "fixture-b", raw: "无匹配" };
  const input = { scopeKey: sha("fixture-exact-index-scope"), rows: [first, second], query: "target" };
  const reopen = (query = input, current = () => true) => reopenAppIndexCache(query, current);
  const success = (applied: number) => ({
    ok: true as const, generation: 1, applied, hits: [{ id: first.id, from: 3, to: 9 }],
  });
  const fail = <E extends "CANCELLED" | "UNAVAILABLE" | "MISSING" | "MISMATCH" | "SCHEMA" | "BUSY">(error: E) =>
    ({ ok: false as const, error, accepted: false });
  const OriginalWorker = globalThis.Worker;
  const commands: unknown[] = [];
  let workers = 0;
  let holdQuery: ((resume: () => void) => void) | undefined;
  class RecordingWorker extends OriginalWorker {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      workers++;
    }
    override postMessage(message: unknown) {
      if (record(message)) {
        const { op, payload } = message;
        commands.push(op === "open" && record(payload) ? [op, payload.mode] : op);
        if (op === "query" && holdQuery) {
          const hold = holdQuery;
          holdQuery = undefined;
          hold(() => super.postMessage(message));
          return;
        }
      }
      super.postMessage(message);
    }
  }
  const noNative = () => {
    expect(workers).toBe(0);
    expect(commands).toEqual([]);
  };
  async function snapshotStorage() {
    const paths = [catalog, ...(await readdir(index)).sort().map((name) => join(index, name))];
    return Promise.all(paths.map(async (path) => {
      const stat = await lstat(path, { bigint: true });
      return {
        path, ino: stat.ino, mode: stat.mode, size: stat.size, mtime: stat.mtimeNs,
        hash: sha(await readFile(path)),
      };
    }));
  }
  async function noLease() {
    expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);
  }

  try {
    Object.defineProperty(globalThis, "Worker", { value: RecordingWorker, configurable: true });
    expect(await reopen()).toEqual(fail("UNAVAILABLE"));
    expect(await readdir(scratch)).toEqual([]);
    await mkdir(home, { mode: 0o700 });
    expect(await reopen()).toEqual(fail("MISSING"));
    expect(await readdir(home)).toEqual([]);
    await mkdir(cache, { mode: 0o700 });
    expect(await reopen()).toEqual(fail("MISSING"));
    expect(await readdir(cache)).toEqual([]);
    await mkdir(profile, { mode: 0o700 });
    expect(await reopen()).toEqual(fail("MISSING"));
    expect(await readdir(profile)).toEqual([]);
    const sentinel = join(profile, "unrelated-existing-file");
    await writeFile(sentinel, "leave alone", { mode: 0o600 });
    expect(await reopen()).toEqual(fail("SCHEMA"));
    expect(await readdir(profile)).toEqual(["unrelated-existing-file"]);
    expect(await readFile(sentinel, "utf8")).toBe("leave alone");
    await rm(sentinel);
    await rmdir(profile);
    await rmdir(cache);
    expect(await reopen(input, () => false)).toEqual(fail("CANCELLED"));
    expect(await reopen(input, () => { throw Error("Synthetic proof failure"); })).toEqual(fail("UNAVAILABLE"));
    expect(await readdir(home)).toEqual([]);
    noNative();

    expect(await searchAppIndexCache(input, () => true)).toEqual(success(2));
    workers = 0;
    commands.length = 0;
    const originalCatalog = await readFile(catalog);
    const originalFiles = await snapshotStorage();
    // Even when the query and offset would be the same, any row hash change is a miss.
    for (const rows of [
      [{ ...first, raw: first.raw + " changed" }, second],
      [first, { ...second, raw: "不同正文" }],
      [first, second, { id: "fixture-c", raw: "no hit" }],
      [first],
      [first, { ...second, id: "different-id" }],
    ]) expect(await reopen({ ...input, rows })).toEqual(fail("MISMATCH"));
    expect(await reopen({ ...input, scopeKey: sha("another-scope") })).toEqual(fail("SCHEMA"));
    expect(await reopen(input, () => false)).toEqual(fail("CANCELLED"));
    expect(await snapshotStorage()).toEqual(originalFiles);
    await noLease();
    noNative();

    await mkdir(lease, { mode: 0o700 });
    const marker = join(lease, "existing-lease");
    await writeFile(marker, "leave lease alone", { mode: 0o600 });
    expect(await reopen()).toEqual(fail("BUSY"));
    expect(await readdir(lease)).toEqual(["existing-lease"]);
    expect(await readFile(marker, "utf8")).toBe("leave lease alone");
    expect(await snapshotStorage()).toEqual(originalFiles);
    noNative();
    await rm(lease, { recursive: true });

    const parsed: unknown = JSON.parse(originalCatalog.toString("utf8"));
    if (!record(parsed)) throw Error("Missing fixture catalog");
    for (const invalid of ["{", JSON.stringify({ ...parsed, version: 2 })]) {
      await writeFile(catalog, invalid);
      const corrupt = await snapshotStorage();
      expect(await reopen()).toEqual(fail("SCHEMA"));
      expect(await snapshotStorage()).toEqual(corrupt);
      await noLease();
    }
    await writeFile(catalog, originalCatalog);
    noNative();
    const stable = await snapshotStorage();

    expect(await reopen({ ...input, rows: [second, first] })).toEqual(success(0));
    expect(workers).toBe(1);
    expect(commands.splice(0)).toEqual([["open", "reader-only"], "query", "close"]);
    expect(await snapshotStorage()).toEqual(stable);
    await noLease();

    let current = true;
    const entered = Promise.withResolvers<() => void>();
    holdQuery = entered.resolve;
    const pending = reopen(input, () => current);
    const resume = await Promise.race([
      entered.promise, pending.then((result) => { throw Error("Expected native query: " + JSON.stringify(result)); }),
    ]);
    try {
      expect(await readdir(profile)).toContain(".lease");
      expect(await reopen()).toEqual(fail("BUSY"));
      expect(workers).toBe(2);
      current = false;
    } finally {
      resume();
    }
    expect(await pending).toEqual(fail("CANCELLED"));
    expect(commands).toEqual([["open", "reader-only"], "query", "close"]);
    expect(await snapshotStorage()).toEqual(stable);
    await noLease();
  } finally {
    Object.defineProperty(globalThis, "Worker", { value: OriginalWorker, configurable: true });
    await rm(home, { recursive: true, force: true });
  }
}, 15_000);
