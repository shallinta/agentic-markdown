import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { reopenAppIndexCache, searchAppIndexCache } from "./app-cache";
import { record } from "./protocol";
import { createIndexSession } from "./session";

const prefix = "f064ah-index-reopen-";
const isolated = process.env.AGENTIC_MARKDOWN_INDEX_REOPEN_TEST === "1";
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const failed = <E extends string>(error: E) => ({ ok: false as const, error, accepted: false });
const generation = (generation: number) => ({ ok: true as const, generation });

async function fixtureDirectory() {
  const scratch = await realpath(tmpdir());
  if (!basename(scratch).startsWith(prefix) ||
      process.env.AGENTIC_MARKDOWN_HOME !== join(scratch, "home") || (await readdir(scratch)).length)
    throw Error("Missing isolated exact index reopen fixture");
  return scratch;
}

async function makeIndex(path: string, rows: readonly { id: string; raw: string; path?: string }[]) {
  const writer = createIndexSession();
  try {
    expect(await writer.open(path, "create-new")).toEqual(generation(0));
    if (rows.length)
      expect(await writer.applyAndCommit(rows.map(({ id, raw, path = id }) => ({ kind: "put", id, raw, path }))))
        .toEqual(generation(1));
  } finally {
    expect(await writer.close()).toEqual(generation(Number(rows.length > 0)));
  }
}

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
    expect(stderr).toContain("2 pass");
    expect(await readdir(scratch)).toEqual([]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 15_000);

test.skipIf(!isolated)("only exact same-roster storage starts a reader-only native session", async () => {
  const scratch = await fixtureDirectory();
  const home = join(scratch, "home");
  const cache = join(home, "search-index");
  const profile = join(cache, "limited-v1");
  const catalog = join(profile, "catalog.json");
  const index = join(profile, "index");
  const lease = join(profile, ".lease");
  const paired = join(scratch, "paired-index");
  const parked = join(scratch, "parked-index");
  const first = { id: "fixture-a", raw: "\uFEFF😀target\r\n" };
  const second = { id: "fixture-b", raw: "无匹配" };
  const input = { scopeKey: sha("fixture-exact-index-scope"), rows: [first, second], query: "target" };
  const reopen = (query = input, current = () => true) => reopenAppIndexCache(query, current);
  const success = (applied: number) => ({
    ok: true as const, generation: 1, applied, hits: [{ id: first.id, from: 3, to: 9 }],
  });
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
    expect(await reopen()).toEqual(failed("UNAVAILABLE"));
    expect(await readdir(scratch)).toEqual([]);
    await mkdir(home, { mode: 0o700 });
    expect(await reopen()).toEqual(failed("MISSING"));
    expect(await readdir(home)).toEqual([]);
    await mkdir(cache, { mode: 0o700 });
    expect(await reopen()).toEqual(failed("MISSING"));
    expect(await readdir(cache)).toEqual([]);
    await mkdir(profile, { mode: 0o700 });
    expect(await reopen()).toEqual(failed("MISSING"));
    expect(await readdir(profile)).toEqual([]);
    const sentinel = join(profile, "unrelated-existing-file");
    await writeFile(sentinel, "leave alone", { mode: 0o600 });
    expect(await reopen()).toEqual(failed("SCHEMA"));
    expect(await readdir(profile)).toEqual(["unrelated-existing-file"]);
    expect(await readFile(sentinel, "utf8")).toBe("leave alone");
    await rm(sentinel);
    await rmdir(profile);
    await rmdir(cache);
    expect(await reopen(input, () => false)).toEqual(failed("CANCELLED"));
    expect(await reopen(input, () => { throw Error("Synthetic proof failure"); })).toEqual(failed("UNAVAILABLE"));
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
    ]) expect(await reopen({ ...input, rows })).toEqual(failed("MISMATCH"));
    expect(await reopen({ ...input, scopeKey: sha("another-scope") })).toEqual(failed("SCHEMA"));
    expect(await reopen(input, () => false)).toEqual(failed("CANCELLED"));
    expect(await snapshotStorage()).toEqual(originalFiles);
    await noLease();
    noNative();

    await mkdir(lease, { mode: 0o700 });
    const marker = join(lease, "existing-lease");
    await writeFile(marker, "leave lease alone", { mode: 0o600 });
    expect(await reopen()).toEqual(failed("BUSY"));
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
      expect(await reopen()).toEqual(failed("SCHEMA"));
      expect(await snapshotStorage()).toEqual(corrupt);
      await noLease();
    }
    await writeFile(catalog, originalCatalog);
    noNative();
    const stable = await snapshotStorage();

    expect(await reopen({ ...input, rows: [second, first] })).toEqual(success(0));
    expect(workers).toBe(1);
    expect(commands.splice(0)).toEqual([["open", "reader-only"], "verify-roster", "query", "close"]);
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
      expect(await reopen()).toEqual(failed("BUSY"));
      expect(workers).toBe(2);
      current = false;
    } finally {
      resume();
    }
    expect(await pending).toEqual(failed("CANCELLED"));
    expect(commands).toEqual([["open", "reader-only"], "verify-roster", "query", "close"]);
    expect(await snapshotStorage()).toEqual(stable);
    await noLease();

    // Build a real index at the same generation. Only the nonmatching row is
    // different, so a legacy hit-and-offset oracle alone accepts this index.
    await makeIndex(paired, [first, { ...second, raw: "不同正文" }]);
    const control = createIndexSession();
    try {
      expect(await control.open(paired, "reader-only")).toEqual(generation(1));
      expect(await control.query(input.query)).toEqual({
        ...generation(1), hits: [{ id: first.id, from: 3, to: 9 }],
      });
    } finally {
      expect(await control.close()).toEqual(generation(1));
    }
    await rename(index, parked);
    await rename(paired, index);
    const swapped = await snapshotStorage();
    expect(await readFile(catalog)).toEqual(originalCatalog);
    expect(swapped).not.toEqual(stable);
    workers = 0;
    commands.length = 0;
    expect(await reopen()).toEqual(failed("SCHEMA"));
    expect(workers).toBe(1);
    expect(commands.splice(0)).toEqual([["open", "reader-only"], "verify-roster", "close"]);
    expect(await snapshotStorage()).toEqual(swapped);
    await noLease();

    await rm(index, { recursive: true });
    await rename(parked, index);
    expect(await reopen()).toEqual(success(0));
    expect(await snapshotStorage()).toEqual(stable);
    await noLease();
  } finally {
    Object.defineProperty(globalThis, "Worker", { value: OriginalWorker, configurable: true });
    await Promise.all([home, paired, parked].map((path) => rm(path, { recursive: true, force: true })));
  }
}, 15_000);

test.skipIf(!isolated)("typed native roster accepts empty and exact limits, and rejects malformed or divergent rows", async () => {
  const scratch = await fixtureDirectory();
  const empty = join(scratch, "empty-index");
  const bounded = join(scratch, "bounded-index");
  const wrongPath = join(scratch, "wrong-path-index");
  const rows = Array.from({ length: 16 }, (_, n) => ({
    id: `row-${n}`,
    raw: n === 0 ? "\uFEFF😀".padEnd(65_532, "x") : "",
  }));
  try {
    await makeIndex(empty, []);
    const emptyReader = createIndexSession();
    try {
      expect(await emptyReader.open(empty, "reader-only")).toEqual(generation(0));
      expect(await emptyReader.verifyRoster([])).toEqual(generation(0));
      expect(await emptyReader.verifyRoster([{ id: "missing", raw: "" }])).toEqual(failed("SCHEMA"));
      expect(await emptyReader.verifyRoster([])).toEqual(generation(0));
    } finally {
      expect(await emptyReader.close()).toEqual(generation(0));
    }

    expect(rows.reduce((bytes, row) => bytes + Buffer.byteLength(row.raw), 0)).toBe(65_536);
    await makeIndex(bounded, rows);
    const reader = createIndexSession();
    try {
      expect(await reader.open(bounded, "reader-only")).toEqual(generation(1));
      expect(await reader.verifyRoster([...rows].reverse())).toEqual(generation(1));
      for (const invalid of [
        [{ id: "spaces forbidden", raw: "" }],
        [{ id: "unicode", raw: "\ud800" }],
        [rows[0], rows[0]],
      ]) expect(await reader.verifyRoster(invalid)).toEqual(failed("INPUT"));
      expect(await reader.verifyRoster([...rows, { id: "one-extra", raw: "" }])).toEqual(failed("LIMIT"));
      expect(await reader.verifyRoster([{ ...rows[0], raw: rows[0].raw + "x" }])).toEqual(failed("LIMIT"));
      expect(await reader.verifyRoster(rows.slice(0, -1))).toEqual(failed("SCHEMA"));
      expect(await reader.verifyRoster(rows)).toEqual(generation(1));
    } finally {
      expect(await reader.close()).toEqual(generation(1));
    }

    const writer = createIndexSession();
    try {
      expect(await writer.open(bounded, "writer-existing")).toEqual(generation(1));
      expect(await writer.verifyRoster(rows)).toEqual(failed("INPUT"));
    } finally {
      expect(await writer.close()).toEqual(generation(1));
    }

    const row = { id: "opaque", raw: "same raw" };
    await makeIndex(wrongPath, [{ ...row, path: "not-the-id" }]);
    const wrong = createIndexSession();
    try {
      expect(await wrong.open(wrongPath, "reader-only")).toEqual(generation(1));
      expect(await wrong.verifyRoster([row])).toEqual(failed("SCHEMA"));
    } finally {
      expect(await wrong.close()).toEqual(generation(1));
    }
  } finally {
    await Promise.all([empty, bounded, wrongPath].map((path) => rm(path, { recursive: true, force: true })));
  }
}, 15_000);
