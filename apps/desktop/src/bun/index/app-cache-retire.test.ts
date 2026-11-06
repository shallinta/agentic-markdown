import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  inspectAppIndexCacheFootprint, reopenAppIndexCache, retireAppIndexCache, searchAppIndexCache,
} from "./app-cache";

const prefix = "f064ar-index-retire-";
const mode = process.env.AGENTIC_MARKDOWN_INDEX_RETIRE_TEST;
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const input = {
  scopeKey: sha("synthetic retirement scope"),
  rows: [{ id: "fixture-a", raw: "\uFEFF😀target\r\n" }],
  query: "target",
};
const retirement = { scopeKey: input.scopeKey, generation: 1 };
const wrongScope = { ...retirement, scopeKey: sha("foreign retirement scope") };
const wrongGeneration = { ...retirement, generation: 2 };
const failed = <E extends string>(error: E) => ({ ok: false as const, error, accepted: false });
const current = () => true;

async function runFixture(scratch: string, childMode: "owner" | "reopen") {
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: {
      ...process.env,
      TMPDIR: scratch,
      AGENTIC_MARKDOWN_HOME: join(scratch, "home"),
      AGENTIC_MARKDOWN_INDEX_RETIRE_TEST: childMode,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  if (exit !== 0) throw Error(stdout + stderr);
  expect(stderr).toContain("1 pass");
}

async function fixture() {
  const scratch = await realpath(tmpdir());
  const home = join(scratch, "home");
  if (!basename(scratch).startsWith(prefix) || process.env.AGENTIC_MARKDOWN_HOME !== home)
    throw Error("Missing isolated index retirement fixture");
  const cache = join(home, "search-index");
  const profile = join(cache, "limited-v1");
  const catalog = join(profile, "catalog.json");
  const index = join(profile, "index");
  const lease = join(profile, ".lease");
  const originalWorker = globalThis.Worker;
  let workers = 0;
  class RecordingWorker extends originalWorker {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      workers++;
    }
  }
  const startRecording = () =>
    Object.defineProperty(globalThis, "Worker", { value: RecordingWorker, configurable: true });
  const stopRecording = () =>
    Object.defineProperty(globalThis, "Worker", { value: originalWorker, configurable: true });
  const fingerprint = async (path: string) => {
    const stat = await lstat(path, { bigint: true });
    return {
      dev: stat.dev, ino: stat.ino, mode: stat.mode, uid: stat.uid, links: stat.nlink,
      size: stat.size, mtime: stat.mtimeNs, ctime: stat.ctimeNs,
      hash: stat.isFile() ? sha(await readFile(path)) : undefined,
    };
  };
  const nativeFiles = async () => Promise.all((await readdir(index)).sort().map(async name => ({
    name, ...await fingerprint(join(index, name)),
  })));
  return {
    scratch, home, cache, profile, catalog, index, lease, startRecording, stopRecording,
    workers: () => workers, fingerprint, nativeFiles,
    async cleanSlot() { expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]); },
  };
}

test.skipIf(mode !== undefined)("isolated cache retirement and reopen leave no fixture data", async () => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  try {
    await runFixture(scratch, "owner");
    expect(await readdir(scratch)).toEqual([]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 15_000);

test.skipIf(mode !== "owner")("retirement publishes only a matching marker and preserves index files", async () => {
  const f = await fixture();
  expect(await readdir(f.scratch)).toEqual([]);
  f.startRecording();
  try {
    let calls = 0;
    expect(await retireAppIndexCache({ ...retirement, generation: -1 }, () => { calls++; return true; }))
      .toEqual(failed("INPUT"));
    expect(calls).toBe(0);
    expect(await retireAppIndexCache(retirement, current)).toEqual(failed("UNAVAILABLE"));
    await mkdir(f.home, { mode: 0o700 });
    expect(await retireAppIndexCache(retirement, current)).toEqual(failed("MISSING"));
    expect(await readdir(f.home)).toEqual([]);
    await mkdir(f.cache, { mode: 0o700 });
    await mkdir(f.profile, { mode: 0o700 });
    expect(await retireAppIndexCache(retirement, current)).toEqual(failed("MISSING"));
    expect(await readdir(f.profile)).toEqual([]);
    expect(await retireAppIndexCache(retirement, () => false)).toEqual(failed("CANCELLED"));
    expect(f.workers()).toBe(0);

    expect(await searchAppIndexCache(input, current)).toEqual({
      ok: true, generation: 1, applied: 1, hits: [{ id: "fixture-a", from: 3, to: 9 }],
    });
    const catalogBytes = await readFile(f.catalog);
    await writeFile(f.catalog, "{broken");
    const malformed = await f.fingerprint(f.catalog);
    expect(await retireAppIndexCache(retirement, current)).toEqual(failed("SCHEMA"));
    expect(await f.fingerprint(f.catalog)).toEqual(malformed);
    await writeFile(f.catalog, catalogBytes);
    const original = await f.fingerprint(f.catalog);
    const native = await f.nativeFiles();
    const nativeWorkers = f.workers();
    expect(nativeWorkers).toBe(1);
    const activeFootprint = await inspectAppIndexCacheFootprint(current);
    if (!activeFootprint.ok) throw Error("Could not inspect active fixture");
    const isStagedCatalog = (name: string) => /^\.catalog-[a-f0-9-]+\.tmp$/.test(name);
    const beforePublish = (action: () => boolean) => {
      let visited = false;
      return {
        current: () => {
          if (visited || !readdirSync(f.profile).some(isStagedCatalog)) return true;
          visited = true;
          return action();
        },
        visited: () => visited,
      };
    };
    expect(await retireAppIndexCache(wrongScope, current)).toEqual(failed("SCHEMA"));
    expect(await retireAppIndexCache(wrongGeneration, current)).toEqual(failed("MISMATCH"));

    const existingLease = join(f.lease, "busy");
    await mkdir(f.lease, { mode: 0o700 });
    await writeFile(existingLease, "keep", { mode: 0o600 });
    expect(await retireAppIndexCache(retirement, current)).toEqual(failed("BUSY"));
    expect(await readFile(existingLease, "utf8")).toBe("keep");
    await rm(existingLease);
    await rmdir(f.lease);

    const cancelled = beforePublish(() => false);
    expect(await retireAppIndexCache(retirement, cancelled.current)).toEqual(failed("CANCELLED"));
    expect(cancelled.visited()).toBe(true);
    expect(await f.fingerprint(f.catalog)).toEqual(original);
    await f.cleanSlot();

    const parked = join(f.scratch, "parked-index");
    const unrelated = join(f.index, "sentinel");
    const swapped = beforePublish(() => {
      renameSync(f.index, parked);
      mkdirSync(f.index, { mode: 0o700 });
      writeFileSync(unrelated, "unrelated");
      return true;
    });
    expect(await retireAppIndexCache(retirement, swapped.current)).toEqual(failed("UNAVAILABLE"));
    expect(swapped.visited()).toBe(true);
    expect(await readFile(unrelated, "utf8")).toBe("unrelated");
    expect(await f.fingerprint(f.catalog)).toEqual(original);
    await f.cleanSlot();
    await rm(unrelated);
    await rmdir(f.index);
    await rename(parked, f.index);

    const blocked = join(f.lease, "fixture-blocks-release");
    const uncertain = beforePublish(() => {
      writeFileSync(blocked, "retain", { flag: "wx", mode: 0o600 });
      return false;
    });
    expect(await retireAppIndexCache(retirement, uncertain.current))
      .toEqual({ ok: false, error: "UNKNOWN", accepted: true });
    expect(uncertain.visited()).toBe(true);
    expect(await readFile(blocked, "utf8")).toBe("retain");
    expect(await f.fingerprint(f.catalog)).toEqual(original);
    expect(await retireAppIndexCache(retirement, current)).toEqual(failed("BUSY"));
    await rm(blocked);
    await rmdir(f.lease);
    expect(await f.nativeFiles()).toEqual(native);
    await f.cleanSlot();

    const nativeDirectory = await f.fingerprint(f.index);
    expect(await retireAppIndexCache(retirement, current)).toEqual({ ok: true, alreadyRetired: false });
    await f.cleanSlot();
    const marker = await f.fingerprint(f.catalog);
    expect(JSON.parse(await readFile(f.catalog, "utf8"))).toEqual({
      version: 1, profile: "limited-v1", state: "retired", ...retirement,
    });
    expect(marker.ino).not.toBe(original.ino);
    expect(marker.mode & 0o777n).toBe(0o600n);
    expect(marker.links).toBe(1n);
    expect(await f.fingerprint(f.index)).toEqual(nativeDirectory);
    expect(await f.nativeFiles()).toEqual(native);
    expect(await inspectAppIndexCacheFootprint(current)).toEqual({
      ok: true, present: true, files: activeFootprint.files,
      catalogBytes: Number(marker.size), indexBytes: activeFootprint.indexBytes,
      totalBytes: Number(marker.size) + activeFootprint.indexBytes,
    });
    expect(await retireAppIndexCache(retirement, current)).toEqual({ ok: true, alreadyRetired: true });
    expect(await retireAppIndexCache(wrongScope, current)).toEqual(failed("SCHEMA"));
    expect(await retireAppIndexCache(wrongGeneration, current)).toEqual(failed("MISMATCH"));
    expect(await f.fingerprint(f.catalog)).toEqual(marker);
    expect(f.workers()).toBe(nativeWorkers);

    await runFixture(f.scratch, "reopen");
    expect(await f.fingerprint(f.catalog)).toEqual(marker);
    expect(await f.fingerprint(f.index)).toEqual(nativeDirectory);
    expect(await f.nativeFiles()).toEqual(native);
    expect(f.workers()).toBe(nativeWorkers);
    await f.cleanSlot();
  } finally {
    f.stopRecording();
    await rm(f.home, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(mode !== "reopen")("a fresh process refuses to reopen a retired cache before creating a Worker", async () => {
  const f = await fixture();
  expect(await readdir(f.scratch)).toEqual(["home"]);
  const marker = await f.fingerprint(f.catalog);
  const native = await f.nativeFiles();
  f.startRecording();
  try {
    expect(await reopenAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
    expect(await reopenAppIndexCache(input, current, 0)).toEqual(failed("SCHEMA"));
    expect(await searchAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
    expect(await searchAppIndexCache({ ...input, rows: [] }, current)).toEqual(failed("SCHEMA"));
    expect(f.workers()).toBe(0);
    expect(await f.fingerprint(f.catalog)).toEqual(marker);
    expect(await f.nativeFiles()).toEqual(native);
    await f.cleanSlot();
  } finally {
    f.stopRecording();
  }
});
