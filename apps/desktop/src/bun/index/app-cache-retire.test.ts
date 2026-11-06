import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { constants, existsSync, mkdirSync, readdirSync, renameSync, utimesSync, writeFileSync } from "node:fs";
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, readlink, realpath, rename, rm, rmdir, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  inspectAppIndexCacheFootprint, inspectRetiredIndexReclaim, inspectStagedIndexPurgeProgress, reopenAppIndexCache,
  prepareEmptyStagedIndexCompletion, prepareRetiredIndexReclaim, prepareStagedIndexPurge,
  removeEmptyStagedIndexDirectory, removeStagedIndexPurgeMember, retireAppIndexCache, searchAppIndexCache,
  stageRetiredIndexReclaim,
} from "./app-cache";
import { record } from "./protocol";

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

function footprintOf(catalog: { size: bigint }, files: readonly { size: bigint }[]) {
  const indexBytes = files.reduce((sum, file) => sum + file.size, 0n);
  return {
    ok: true as const, present: true as const, files: files.length + 1,
    catalogBytes: Number(catalog.size), indexBytes: Number(indexBytes),
    totalBytes: Number(catalog.size + indexBytes),
  };
}

async function inventoryStamps(directory: string) {
  const stat = await lstat(directory, { bigint: true });
  const files = await Promise.all((await readdir(directory)).sort().map(async name => {
    const s = await lstat(join(directory, name), { bigint: true });
    return [name, [s.birthtimeNs, s.dev, s.ino, s.mode, s.uid, s.nlink, s.size, s.mtimeNs, s.ctimeNs].map(String)] as const;
  }));
  return {
    directory: [stat.dev, stat.ino, stat.birthtimeNs, stat.uid, stat.mode].map(String),
    files,
  };
}

async function preparedDigest(directory: string, target: typeof retirement & { inventoryDigest: string }) {
  return digestStamps(target, await inventoryStamps(directory));
}

function digestStamps(target: typeof retirement & { inventoryDigest: string }, stamps: Awaited<ReturnType<typeof inventoryStamps>>) {
  return sha(JSON.stringify([
    3, "agentic-markdown-index-reclaim-intent", "limited-v1", target.scopeKey, target.generation,
    target.inventoryDigest, stamps.directory, stamps.files,
  ]));
}

async function purgeRoster(directory: string, target: typeof retirement & { inventoryDigest: string }, catalog: Buffer) {
  return JSON.stringify({
    version: 1, profile: "limited-v1", state: "purge-prepared", ...target,
    stagingDigest: await preparedDigest(directory, target),
    catalogSha256: sha(catalog), ...await inventoryStamps(directory),
  });
}

function purgeFootprint(catalog: { size: bigint }, files: readonly { size: bigint }[], purge: { size: bigint }) {
  const regular = footprintOf(catalog, files);
  return {
    ...regular, placement: "pending" as const, files: regular.files + 1,
    purgeBytes: Number(purge.size), totalBytes: regular.totalBytes + Number(purge.size),
  };
}

async function emptyCompletionBytes(
  pending: string, target: typeof retirement & { inventoryDigest: string },
  stagingDigest: string, catalog: Buffer, roster: Buffer, expectedFiles: number
) {
  return JSON.stringify({
    version: 1, profile: "limited-v1", state: "empty-confirmed", ...target, stagingDigest,
    catalogSha256: sha(catalog), rosterSha256: sha(roster),
    directory: (await inventoryStamps(pending)).directory, expectedFiles,
  });
}

function progressOf(expectedFiles: number, files: readonly { size: bigint }[]) {
  return {
    ok: true as const, expectedFiles, remainingFiles: files.length, missingFiles: expectedFiles - files.length,
    remainingIndexBytes: Number(files.reduce((sum, file) => sum + file.size, 0n)),
  };
}

const nativeSegment = (name: string) => /^[a-f0-9]{32}\./.test(name);
const removalOrder = (names: readonly string[]) => [
  ...names.filter(nativeSegment).sort(),
  ...names.filter(name => !nativeSegment(name)).sort(),
];

async function runFixture(
  scratch: string,
  childMode: "owner" | "sealed" | "reopen" | "preflight" | "preflight-reopen" | "intent" | "intent-reopen"
    | "stage" | "stage-reopen" | "purge" | "purge-reopen" | "progress" | "progress-reopen"
    | "remove-member" | "remove-member-reopen" | "empty-completion" | "empty-completion-reopen"
    | "remove-empty-directory" | "remove-empty-directory-reopen",
  entry = import.meta.path
) {
  const child = Bun.spawn([process.execPath, "test", entry], {
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

async function runFixtureWithoutNative(
  scratch: string, childMode: "stage-reopen" | "empty-completion-reopen" | "remove-empty-directory-reopen"
) {
  const retry = join(scratch, "retry");
  try {
    const outdir = join(retry, "bun");
    const built = await Bun.build({
      entrypoints: [import.meta.path], outdir, target: "bun", naming: "stage-retry.test.js",
    });
    if (!built.success) throw new AggregateError(built.logs, "Cache retry fixture bundling failed");
    await runFixture(scratch, childMode, join(outdir, "stage-retry.test.js"));
  } finally {
    await rm(retry, { recursive: true, force: true });
  }
}

const isStagedCatalog = (name: string) => /^\.catalog-[a-f0-9-]+\.tmp$/.test(name);
function beforePublish(profile: string, action: () => boolean, isStaged = isStagedCatalog) {
  let visited = false;
  return {
    current: () => {
      if (visited || !readdirSync(profile).some(isStaged)) return true;
      visited = true;
      return action();
    },
    visited: () => visited,
  };
}

async function refuseDirectorySync<T>(directory: string, refuse: () => Promise<boolean>, operation: () => Promise<T>) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const stat = await handle.stat({ bigint: true });
  const prototype = Object.getPrototypeOf(handle) as Pick<typeof handle, "sync">;
  const sync = prototype.sync;
  await handle.close();
  let injected = false;
  prototype.sync = async function(this: typeof handle) {
    const current = await this.stat({ bigint: true });
    if (current.dev === stat.dev && current.ino === stat.ino && await refuse()) {
      injected = true;
      throw Error("Fixture directory sync failure");
    }
    await sync.call(this);
  };
  try {
    const result = await operation();
    expect(injected).toBe(true);
    return result;
  } finally {
    prototype.sync = sync;
  }
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
      birth: stat.birthtimeNs, size: stat.size, mtime: stat.mtimeNs, ctime: stat.ctimeNs,
      hash: stat.isFile() ? sha(await readFile(path)) : undefined,
    };
  };
  const nativeFiles = async (directory = index) => Promise.all((await readdir(directory)).sort().map(async name => ({
    name, ...await fingerprint(join(directory, name)),
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
    await runFixture(scratch, "sealed");
    expect(await readdir(scratch)).toEqual([]);
    await runFixture(scratch, "preflight");
    expect(await readdir(scratch)).toEqual([]);
    await runFixture(scratch, "intent");
    expect(await readdir(scratch)).toEqual([]);
    await runFixture(scratch, "stage");
    expect(await readdir(scratch)).toEqual([]);
    await runFixture(scratch, "purge");
    expect(await readdir(scratch)).toEqual([]);
    await runFixture(scratch, "progress");
    expect(await readdir(scratch)).toEqual([]);
    await runFixture(scratch, "remove-member");
    expect(await readdir(scratch)).toEqual([]);
    await runFixture(scratch, "empty-completion");
    expect(await readdir(scratch)).toEqual([]);
    await runFixture(scratch, "remove-empty-directory");
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
    expect(await retireAppIndexCache(wrongScope, current)).toEqual(failed("SCHEMA"));
    expect(await retireAppIndexCache(wrongGeneration, current)).toEqual(failed("MISMATCH"));

    const existingLease = join(f.lease, "busy");
    await mkdir(f.lease, { mode: 0o700 });
    await writeFile(existingLease, "keep", { mode: 0o600 });
    expect(await retireAppIndexCache(retirement, current)).toEqual(failed("BUSY"));
    expect(await readFile(existingLease, "utf8")).toBe("keep");
    await rm(existingLease);
    await rmdir(f.lease);

    const cancelled = beforePublish(f.profile, () => false);
    expect(await retireAppIndexCache(retirement, cancelled.current)).toEqual(failed("CANCELLED"));
    expect(cancelled.visited()).toBe(true);
    expect(await f.fingerprint(f.catalog)).toEqual(original);
    await f.cleanSlot();

    const parked = join(f.scratch, "parked-index");
    const unrelated = join(f.index, "sentinel");
    const swapped = beforePublish(f.profile, () => {
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
    const uncertain = beforePublish(f.profile, () => {
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
    expect(await retireAppIndexCache(retirement, current, true)).toEqual(failed("SCHEMA"));
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

test.skipIf(mode !== "sealed")("a sealed marker binds the native directory and files to their exact identities", async () => {
  const f = await fixture();
  expect(await readdir(f.scratch)).toEqual([]);
  f.startRecording();
  try {
    let calls = 0;
    expect(await retireAppIndexCache(retirement, () => { calls++; return true; }, false as unknown as true))
      .toEqual(failed("INPUT"));
    expect(calls).toBe(0);
    expect(await readdir(f.scratch)).toEqual([]);
    await mkdir(f.home, { mode: 0o700 });
    expect(await searchAppIndexCache(input, current)).toMatchObject({ ok: true, generation: 1 });
    const originalCatalog = await f.fingerprint(f.catalog);
    const nativeWorkers = f.workers();
    expect(nativeWorkers).toBe(1);

    const existingLease = join(f.lease, "keep");
    await mkdir(f.lease, { mode: 0o700 });
    await writeFile(existingLease, "fixture", { mode: 0o600 });
    expect(await retireAppIndexCache(retirement, current, true)).toEqual(failed("BUSY"));
    expect(await readFile(existingLease, "utf8")).toBe("fixture");
    await rm(existingLease);
    await rmdir(f.lease);
    const target = join(f.scratch, "symlink-target");
    const link = join(f.index, "fixture-symlink");
    await writeFile(target, "do not touch", { mode: 0o600 });
    await symlink(target, link);
    expect(await retireAppIndexCache(retirement, current, true)).toEqual(failed("UNAVAILABLE"));
    expect(await readlink(link)).toBe(target);
    expect(await readFile(target, "utf8")).toBe("do not touch");
    await rm(link);
    await rm(target);
    await f.cleanSlot();

    const cancelled = beforePublish(f.profile, () => false);
    expect(await retireAppIndexCache(retirement, cancelled.current, true)).toEqual(failed("CANCELLED"));
    expect(cancelled.visited()).toBe(true);
    expect(await f.fingerprint(f.catalog)).toEqual(originalCatalog);
    await f.cleanSlot();

    const parked = join(f.scratch, "parked-index");
    const swapped = beforePublish(f.profile, () => {
      renameSync(f.index, parked);
      mkdirSync(f.index, { mode: 0o700 });
      return true;
    });
    expect(await retireAppIndexCache(retirement, swapped.current, true)).toEqual(failed("UNAVAILABLE"));
    expect(swapped.visited()).toBe(true);
    expect(await readdir(f.index)).toEqual([]);
    expect(await f.fingerprint(f.catalog)).toEqual(originalCatalog);
    await rmdir(f.index);
    await rename(parked, f.index);
    await f.cleanSlot();

    const firstMember = (await readdir(f.index)).sort()[0];
    if (!firstMember) throw Error("Native fixture files missing");
    const firstFile = join(f.index, firstMember);
    const beforeTouch = await lstat(firstFile);
    const touched = beforePublish(f.profile, () => {
      utimesSync(firstFile, beforeTouch.atime, new Date(beforeTouch.mtimeMs + 10_000));
      return true;
    });
    expect(await retireAppIndexCache(retirement, touched.current, true)).toEqual(failed("UNAVAILABLE"));
    expect(touched.visited()).toBe(true);
    expect(await f.fingerprint(f.catalog)).toEqual(originalCatalog);
    expect((await lstat(firstFile)).mtimeMs).toBeGreaterThan(beforeTouch.mtimeMs);
    await f.cleanSlot();

    const blocked = join(f.lease, "fixture-blocks-release");
    const uncertain = beforePublish(f.profile, () => {
      writeFileSync(blocked, "retain", { flag: "wx", mode: 0o600 });
      return true;
    });
    expect(await retireAppIndexCache(retirement, uncertain.current, true))
      .toEqual({ ok: false, error: "UNKNOWN", accepted: true });
    expect(uncertain.visited()).toBe(true);
    expect(await readFile(blocked, "utf8")).toBe("retain");
    expect(await f.fingerprint(f.catalog)).toEqual(originalCatalog);
    await rm(blocked);
    await rmdir(f.lease);
    await f.cleanSlot();

    const nativeFiles = await f.nativeFiles();
    const nativeDirectory = await f.fingerprint(f.index);
    const metadata = async (path: string) => {
      const s = await lstat(path, { bigint: true });
      return [s.birthtimeNs, s.dev, s.ino, s.mode, s.uid, s.nlink, s.size, s.mtimeNs, s.ctimeNs].map(String);
    };
    const members = await Promise.all((await readdir(f.index)).sort().map(async name => [
      name, await metadata(join(f.index, name)),
    ]));
    const inventoryDigest = sha(JSON.stringify([
      2, "agentic-markdown-index-retirement-inventory", "limited-v1",
      retirement.scopeKey, retirement.generation, await metadata(f.index), members,
    ]));
    expect(await retireAppIndexCache(retirement, current, true)).toEqual({ ok: true, alreadyRetired: false });
    expect(JSON.parse(await readFile(f.catalog, "utf8"))).toEqual({
      version: 2, profile: "limited-v1", state: "retired", ...retirement, inventoryDigest,
    });
    const marker = await f.fingerprint(f.catalog);
    const indexBytes = Number(nativeFiles.reduce((sum, file) => sum + file.size, 0n));
    expect(await inspectAppIndexCacheFootprint(current)).toEqual({
      ok: true, present: true, files: nativeFiles.length + 1, catalogBytes: Number(marker.size),
      indexBytes, totalBytes: Number(marker.size) + indexBytes,
    });
    expect(await retireAppIndexCache(retirement, current, true)).toEqual({ ok: true, alreadyRetired: true });
    await runFixture(f.scratch, "reopen");
    expect(await f.fingerprint(f.catalog)).toEqual(marker);
    expect(await f.fingerprint(f.index)).toEqual(nativeDirectory);
    expect(await f.nativeFiles()).toEqual(nativeFiles);

    const changed = nativeFiles[0];
    if (!changed) throw Error("Native fixture files missing");
    const changedPath = join(f.index, changed.name);
    const stat = await lstat(changedPath);
    await utimes(changedPath, stat.atime, new Date(stat.mtimeMs + 10_000));
    const modified = await f.fingerprint(changedPath);
    expect(modified).toMatchObject({ ino: changed.ino, size: changed.size, hash: changed.hash });
    expect(modified.mtime).not.toBe(changed.mtime);
    expect(await retireAppIndexCache(retirement, current, true)).toEqual(failed("MISMATCH"));
    expect(await f.fingerprint(f.catalog)).toEqual(marker);
    expect(await f.fingerprint(changedPath)).toEqual(modified);
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

test.skipIf(mode !== "preflight")("only a sealed matching index with known native files passes reclaim preflight", async () => {
  const f = await fixture();
  expect(await readdir(f.scratch)).toEqual([]);
  f.startRecording();
  const preflight = (target = retirement, guard = current) => inspectRetiredIndexReclaim(target, guard);
  async function seed() {
    await mkdir(f.home, { mode: 0o700 });
    expect(await searchAppIndexCache(input, current)).toEqual({
      ok: true, generation: 1, applied: 1, hits: [{ id: "fixture-a", from: 3, to: 9 }],
    });
  }
  async function refuseSealedFixture(install: () => Promise<void>) {
    await seed();
    await install();
    expect(await retireAppIndexCache(retirement, current, true)).toEqual({ ok: true, alreadyRetired: false });
    const files = await f.nativeFiles();
    const marker = await f.fingerprint(f.catalog);
    const workers = f.workers();
    expect(await preflight()).toEqual(failed("SCHEMA"));
    expect(await f.fingerprint(f.catalog)).toEqual(marker);
    expect(await f.nativeFiles()).toEqual(files);
    expect(f.workers()).toBe(workers);
    await f.cleanSlot();
    await rm(f.home, { recursive: true, force: true });
  }
  try {
    expect(await preflight(retirement, () => false)).toEqual(failed("CANCELLED"));
    expect(await preflight()).toEqual(failed("UNAVAILABLE"));
    expect(await readdir(f.scratch)).toEqual([]);
    await seed();
    const active = await f.fingerprint(f.catalog);
    const files = await f.nativeFiles();
    expect(await preflight()).toEqual(failed("SCHEMA"));
    expect(await f.fingerprint(f.catalog)).toEqual(active);
    expect(await retireAppIndexCache(retirement, current)).toEqual({ ok: true, alreadyRetired: false });
    const legacy = await f.fingerprint(f.catalog);
    expect(await preflight()).toEqual(failed("SCHEMA"));
    expect(await f.fingerprint(f.catalog)).toEqual(legacy);
    expect(await f.nativeFiles()).toEqual(files);
    expect(f.workers()).toBe(1);
    await f.cleanSlot();
    await rm(f.home, { recursive: true, force: true });

    await refuseSealedFixture(() => writeFile(join(f.index, "foreign.txt"), "keep outside reclaim", { mode: 0o600 }));
    await refuseSealedFixture(async () => {
      const meta = join(f.index, "meta.json");
      const original = await readFile(meta, "utf8");
      const mismatched = original.replace("bridge-v1:1", "bridge-v1:2");
      expect(mismatched).not.toBe(original);
      await writeFile(meta, mismatched);
    });
    await refuseSealedFixture(() => writeFile(join(f.index, "bridge.schema"), "invalid bridge format\n"));
    await refuseSealedFixture(async () => {
      const managed = join(f.index, ".managed.json");
      const original = await readFile(managed, "utf8");
      const unsafe = original.replace('"meta.json"', '"../meta.json"');
      expect(unsafe).not.toBe(original);
      await writeFile(managed, unsafe);
    });

    await mkdir(f.home, { mode: 0o700 });
    const emptyTarget = { ...retirement, generation: 0 };
    expect(await searchAppIndexCache({ ...input, rows: [] }, current)).toEqual({
      ok: true, generation: 0, applied: 0, hits: [],
    });
    expect(await retireAppIndexCache(emptyTarget, current, true)).toEqual({ ok: true, alreadyRetired: false });
    const emptyFiles = await f.nativeFiles();
    const emptyMarker = await f.fingerprint(f.catalog);
    const emptyWorkers = f.workers();
    expect(await preflight(emptyTarget)).toMatchObject({
      ok: true, files: emptyFiles.length + 1,
      logicalBytes: Number(emptyFiles.reduce((sum, file) => sum + file.size, emptyMarker.size)),
    });
    expect(f.workers()).toBe(emptyWorkers);
    expect(await f.nativeFiles()).toEqual(emptyFiles);
    expect(await f.fingerprint(f.catalog)).toEqual(emptyMarker);
    await f.cleanSlot();
    await rm(f.home, { recursive: true, force: true });

    await seed();
    expect(await retireAppIndexCache(retirement, current, true)).toEqual({ ok: true, alreadyRetired: false });
    const marker = await f.fingerprint(f.catalog);
    const nativeDirectory = await f.fingerprint(f.index);
    const native = await f.nativeFiles();
    const workers = f.workers();
    expect(await preflight(wrongScope)).toEqual(failed("SCHEMA"));
    expect(await preflight(wrongGeneration)).toEqual(failed("MISMATCH"));
    await mkdir(f.lease, { mode: 0o700 });
    const busy = join(f.lease, "keep");
    await writeFile(busy, "busy", { mode: 0o600 });
    expect(await preflight()).toEqual(failed("BUSY"));
    expect(await readFile(busy, "utf8")).toBe("busy");
    await rm(busy);
    await rmdir(f.lease);
    await runFixture(f.scratch, "preflight-reopen");

    let guards = 0;
    expect(await preflight(retirement, () => { guards++; return true; })).toMatchObject({ ok: true });
    expect(guards).toBeGreaterThan(1);
    let checks = 0;
    expect(await preflight(retirement, () => ++checks < guards)).toEqual(failed("CANCELLED"));
    expect(checks).toBe(guards);
    expect(await f.fingerprint(f.catalog)).toEqual(marker);
    expect(await f.fingerprint(f.index)).toEqual(nativeDirectory);
    expect(await f.nativeFiles()).toEqual(native);
    await f.cleanSlot();

    const file = native[0];
    if (!file) throw Error("Native fixture files missing");
    const filePath = join(f.index, file.name);
    const stat = await lstat(filePath);
    await utimes(filePath, stat.atime, new Date(stat.mtimeMs + 10_000));
    const changed = await f.fingerprint(filePath);
    expect(await preflight()).toEqual(failed("MISMATCH"));
    expect(await f.fingerprint(filePath)).toEqual(changed);
    expect(await f.fingerprint(f.catalog)).toEqual(marker);
    const link = join(f.index, "foreign-link");
    await symlink(f.catalog, link);
    expect(await preflight()).toEqual(failed("UNAVAILABLE"));
    expect(await readlink(link)).toBe(f.catalog);
    expect(await f.fingerprint(f.catalog)).toEqual(marker);
    await rm(link);
    expect(f.workers()).toBe(workers);
    await f.cleanSlot();
  } finally {
    f.stopRecording();
    await rm(f.home, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(mode !== "preflight-reopen")("a new process confirms the reclaim digest and logical size without starting native", async () => {
  const f = await fixture();
  expect(await readdir(f.scratch)).toEqual(["home"]);
  const parsed: unknown = JSON.parse(await readFile(f.catalog, "utf8"));
  if (!record(parsed) || typeof parsed.inventoryDigest !== "string") throw Error("Sealed fixture missing");
  const native = await f.nativeFiles();
  const catalog = await f.fingerprint(f.catalog);
  const directory = await f.fingerprint(f.index);
  f.startRecording();
  try {
    expect(await inspectRetiredIndexReclaim(retirement, current)).toEqual({
      ok: true, inventoryDigest: parsed.inventoryDigest,
      files: native.length + 1,
      logicalBytes: Number(native.reduce((sum, file) => sum + file.size, catalog.size)),
    });
    expect(f.workers()).toBe(0);
    expect(await f.fingerprint(f.catalog)).toEqual(catalog);
    expect(await f.fingerprint(f.index)).toEqual(directory);
    expect(await f.nativeFiles()).toEqual(native);
    await f.cleanSlot();
  } finally {
    f.stopRecording();
  }
});

test.skipIf(mode !== "intent")("preparing a reclaim intent seals the original placement without moving native files", async () => {
  const f = await fixture();
  expect(await readdir(f.scratch)).toEqual([]);
  f.startRecording();
  const candidate = { ...retirement, inventoryDigest: sha("unrelated sealed inventory") };
  const prepared = (target = candidate, guard = current) => prepareRetiredIndexReclaim(target, guard);
  async function seed() {
    await mkdir(f.home, { mode: 0o700 });
    expect(await searchAppIndexCache(input, current)).toEqual({
      ok: true, generation: 1, applied: 1, hits: [{ id: "fixture-a", from: 3, to: 9 }],
    });
  }
  try {
    let guards = 0;
    expect(await prepared({ ...candidate, inventoryDigest: "wrong" }, () => { guards++; return true; }))
      .toEqual(failed("INPUT"));
    expect(guards).toBe(0);
    expect(await prepared(candidate, () => false)).toEqual(failed("CANCELLED"));
    expect(await prepared()).toEqual(failed("UNAVAILABLE"));
    expect(await readdir(f.scratch)).toEqual([]);
    await seed();
    const active = await f.fingerprint(f.catalog);
    expect(await prepared()).toEqual(failed("SCHEMA"));
    expect(await f.fingerprint(f.catalog)).toEqual(active);
    expect(await retireAppIndexCache(retirement, current)).toEqual({ ok: true, alreadyRetired: false });
    const legacy = await f.fingerprint(f.catalog);
    expect(await prepared()).toEqual(failed("SCHEMA"));
    expect(await f.fingerprint(f.catalog)).toEqual(legacy);
    expect(f.workers()).toBe(1);
    await f.cleanSlot();
    await rm(f.home, { recursive: true, force: true });

    await seed();
    expect(await retireAppIndexCache(retirement, current, true)).toEqual({ ok: true, alreadyRetired: false });
    const preflight = await inspectRetiredIndexReclaim(retirement, current);
    if (!preflight.ok) throw Error("Fixture sealed preflight refused: " + preflight.error);
    const target = { ...retirement, inventoryDigest: preflight.inventoryDigest };
    const sealed = await f.fingerprint(f.catalog);
    const files = await f.nativeFiles();
    const directory = await f.fingerprint(f.index);
    const nativeWorkers = f.workers();
    expect(await prepared(candidate)).toEqual(failed("MISMATCH"));
    expect(await prepared({ ...target, ...wrongScope })).toEqual(failed("SCHEMA"));
    expect(await prepared({ ...target, ...wrongGeneration })).toEqual(failed("MISMATCH"));

    const occupied = join(f.lease, "keep");
    await mkdir(f.lease, { mode: 0o700 });
    await writeFile(occupied, "busy", { mode: 0o600 });
    expect(await prepared(target)).toEqual(failed("BUSY"));
    expect(await readFile(occupied, "utf8")).toBe("busy");
    await rm(occupied);
    await rmdir(f.lease);
    const pending = join(f.profile, ".reclaim-pending");
    await mkdir(pending, { mode: 0o700 });
    const keep = join(pending, "keep");
    await writeFile(keep, "separate", { mode: 0o600 });
    expect(await prepared(target)).toEqual(failed("UNAVAILABLE"));
    expect(await readFile(keep, "utf8")).toBe("separate");
    await rm(keep);
    await rmdir(pending);

    const cancelled = beforePublish(f.profile, () => false);
    expect(await prepared(target, cancelled.current)).toEqual(failed("CANCELLED"));
    expect(cancelled.visited()).toBe(true);
    expect(await f.fingerprint(f.catalog)).toEqual(sealed);
    await f.cleanSlot();

    const collided = beforePublish(f.profile, () => {
      mkdirSync(pending, { mode: 0o700 });
      writeFileSync(keep, "late", { mode: 0o600 });
      return true;
    });
    expect(await prepared(target, collided.current)).toEqual(failed("UNAVAILABLE"));
    expect(collided.visited()).toBe(true);
    expect(await readFile(keep, "utf8")).toBe("late");
    expect(await f.fingerprint(f.catalog)).toEqual(sealed);
    await rm(keep);
    await rmdir(pending);
    await f.cleanSlot();

    const stagingDigest = await preparedDigest(f.index, target);
    expect(await prepared(target)).toEqual({ ok: true, alreadyPrepared: false });
    expect(JSON.parse(await readFile(f.catalog, "utf8"))).toEqual({
      version: 3, profile: "limited-v1", state: "reclaim-prepared", ...target, stagingDigest,
    });
    const intent = await f.fingerprint(f.catalog);
    expect(intent.ino).not.toBe(sealed.ino);
    expect(intent.links).toBe(1n);
    expect(await inspectAppIndexCacheFootprint(current)).toEqual({
      ok: true, present: true, files: preflight.files, catalogBytes: Number(intent.size),
      indexBytes: Number(files.reduce((sum, file) => sum + file.size, 0n)),
      totalBytes: Number(files.reduce((sum, file) => sum + file.size, intent.size)),
    });
    await runFixture(f.scratch, "intent-reopen");
    expect(await f.fingerprint(f.catalog)).toEqual(intent);
    expect(await f.fingerprint(f.index)).toEqual(directory);
    expect(await f.nativeFiles()).toEqual(files);
    await f.cleanSlot();

    const member = files[0];
    if (!member) throw Error("Fixture native file missing");
    const changed = join(f.index, member.name);
    const stat = await lstat(changed);
    await utimes(changed, stat.atime, new Date(stat.mtimeMs + 10_000));
    const changedFile = await f.fingerprint(changed);
    expect(await prepared(target)).toEqual(failed("MISMATCH"));
    expect(await f.fingerprint(changed)).toEqual(changedFile);
    expect(await f.fingerprint(f.catalog)).toEqual(intent);
    expect(f.workers()).toBe(nativeWorkers);
    await f.cleanSlot();

    await rm(f.home, { recursive: true, force: true });
    await seed();
    expect(await retireAppIndexCache(retirement, current, true)).toEqual({ ok: true, alreadyRetired: false });
    const secondPreflight = await inspectRetiredIndexReclaim(retirement, current);
    if (!secondPreflight.ok) throw Error("Second sealed fixture refused: " + secondPreflight.error);
    const second = { ...retirement, inventoryDigest: secondPreflight.inventoryDigest };
    const secondFiles = await f.nativeFiles();
    const secondWorkers = f.workers();
    const result = await refuseDirectorySync(f.profile, async () => {
      const afterPublish: unknown = JSON.parse(await readFile(f.catalog, "utf8"));
      return record(afterPublish) && afterPublish.version === 3;
    }, () => prepared(second));
    expect(result).toEqual({ ok: false, error: "UNKNOWN", accepted: true });
    expect(JSON.parse(await readFile(f.catalog, "utf8"))).toMatchObject({
      version: 3, state: "reclaim-prepared", ...second,
    });
    const uncertain = await f.fingerprint(f.catalog);
    expect(await f.nativeFiles()).toEqual(secondFiles);
    await f.cleanSlot();
    expect(await prepared(second)).toEqual({ ok: true, alreadyPrepared: true });
    expect(await f.fingerprint(f.catalog)).toEqual(uncertain);
    expect(await f.nativeFiles()).toEqual(secondFiles);
    expect(f.workers()).toBe(secondWorkers);
    await f.cleanSlot();
  } finally {
    f.stopRecording();
    await rm(f.home, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(mode !== "intent-reopen")("a fresh process confirms a prepared record without reopening native", async () => {
  const f = await fixture();
  expect(await readdir(f.scratch)).toEqual(["home"]);
  const marker: unknown = JSON.parse(await readFile(f.catalog, "utf8"));
  if (!record(marker) || marker.version !== 3 || typeof marker.inventoryDigest !== "string")
    throw Error("Prepared fixture missing");
  const target = { ...retirement, inventoryDigest: marker.inventoryDigest };
  const catalog = await f.fingerprint(f.catalog);
  const directory = await f.fingerprint(f.index);
  const files = await f.nativeFiles();
  f.startRecording();
  try {
    expect(await prepareRetiredIndexReclaim(target, current)).toEqual({ ok: true, alreadyPrepared: true });
    expect(await reopenAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
    expect(await reopenAppIndexCache(input, current, 0)).toEqual(failed("SCHEMA"));
    expect(await searchAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
    expect(await retireAppIndexCache(retirement, current)).toEqual(failed("SCHEMA"));
    expect(await retireAppIndexCache(retirement, current, true)).toEqual(failed("SCHEMA"));
    expect(await inspectRetiredIndexReclaim(retirement, current)).toEqual(failed("SCHEMA"));
    expect(f.workers()).toBe(0);
    expect(await f.fingerprint(f.catalog)).toEqual(catalog);
    expect(await f.fingerprint(f.index)).toEqual(directory);
    expect(await f.nativeFiles()).toEqual(files);
    await f.cleanSlot();
  } finally {
    f.stopRecording();
  }
});

test.skipIf(mode !== "stage")("a prepared index moves exclusively and a sync fault preserves the staged files", async () => {
  const f = await fixture();
  expect(await readdir(f.scratch)).toEqual([]);
  const pending = join(f.profile, ".reclaim-pending");
  const parked = join(f.profile, "fixture-parked");
  const unrelated = join(f.scratch, "unrelated");
  const invalid = { ...retirement, inventoryDigest: sha("wrong staged inventory") };
  f.startRecording();
  async function seed() {
    await mkdir(f.home, { mode: 0o700 });
    expect(await searchAppIndexCache(input, current)).toMatchObject({ ok: true, generation: 1, applied: 1 });
    expect(await retireAppIndexCache(retirement, current, true)).toEqual({ ok: true, alreadyRetired: false });
    const proof = await inspectRetiredIndexReclaim(retirement, current);
    if (!proof.ok) throw Error("Stage preflight fixture unavailable: " + proof.error);
    const target = { ...retirement, inventoryDigest: proof.inventoryDigest };
    expect(await stageRetiredIndexReclaim(target, current)).toEqual(failed("SCHEMA"));
    expect(await prepareRetiredIndexReclaim(target, current)).toEqual({ ok: true, alreadyPrepared: false });
    return target;
  }
  async function absent(path: string) {
    expect(await lstat(path).catch((error: unknown) => error)).toMatchObject({ code: "ENOENT" });
  }
  try {
    expect(await stageRetiredIndexReclaim({ ...invalid, inventoryDigest: "wrong" }, current)).toEqual(failed("INPUT"));
    expect(await stageRetiredIndexReclaim(invalid, () => false)).toEqual(failed("CANCELLED"));
    const target = await seed();
    const marker = await f.fingerprint(f.catalog);
    const original = await f.fingerprint(f.index);
    const files = await f.nativeFiles();
    const workers = f.workers();
    const originalFootprint = footprintOf(marker, files);
    const pendingFootprint = { ...originalFootprint, placement: "pending" as const };
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(originalFootprint);
    expect(await stageRetiredIndexReclaim(invalid, current)).toEqual(failed("MISMATCH"));
    expect(await stageRetiredIndexReclaim({ ...target, ...wrongScope }, current)).toEqual(failed("SCHEMA"));
    expect(await stageRetiredIndexReclaim({ ...target, ...wrongGeneration }, current)).toEqual(failed("MISMATCH"));

    await mkdir(f.lease, { mode: 0o700 });
    const occupied = join(f.lease, "keep");
    await writeFile(occupied, "busy", { mode: 0o600 });
    expect(await stageRetiredIndexReclaim(target, current)).toEqual(failed("BUSY"));
    expect(await readFile(occupied, "utf8")).toBe("busy");
    await rm(occupied);
    await rmdir(f.lease);
    await writeFile(unrelated, "outside pending", { mode: 0o600 });
    await symlink(unrelated, pending);
    expect(await stageRetiredIndexReclaim(target, current)).toEqual(failed("SCHEMA"));
    expect(await readlink(pending)).toBe(unrelated);
    expect(await readFile(unrelated, "utf8")).toBe("outside pending");
    await rm(pending);
    await rm(unrelated);
    expect(await f.fingerprint(f.catalog)).toEqual(marker);
    expect(await f.fingerprint(f.index)).toEqual(original);
    expect(await f.nativeFiles()).toEqual(files);
    await f.cleanSlot();

    let preMoveChecks = 0;
    expect(await stageRetiredIndexReclaim(target, () => {
      if (existsSync(f.index)) preMoveChecks++;
      return true;
    })).toEqual({ ok: true, alreadyStaged: false });
    expect(preMoveChecks).toBeGreaterThan(1);
    await absent(f.index);
    const moved = await f.fingerprint(pending);
    expect(moved).toMatchObject({ dev: original.dev, ino: original.ino, birth: original.birth, uid: original.uid, mode: original.mode });
    expect(await f.nativeFiles(pending)).toEqual(files);
    expect(await f.fingerprint(f.catalog)).toEqual(marker);
    expect(f.workers()).toBe(workers);
    let inspectionChecks = 0;
    let sawLease = false;
    expect(await inspectAppIndexCacheFootprint(() => {
      inspectionChecks++;
      sawLease ||= existsSync(f.lease);
      return true;
    })).toEqual(pendingFootprint);
    expect(inspectionChecks).toBeGreaterThan(1);
    expect(sawLease).toBe(false);
    let checked = 0;
    expect(await inspectAppIndexCacheFootprint(() => ++checked < inspectionChecks)).toEqual(failed("CANCELLED"));
    expect(checked).toBe(inspectionChecks);
    await absent(f.lease);

    await mkdir(f.lease, { mode: 0o700 });
    await writeFile(occupied, "keep during stats", { mode: 0o600 });
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(failed("BUSY"));
    expect(await readFile(occupied, "utf8")).toBe("keep during stats");
    await rm(occupied);
    await rmdir(f.lease);
    checked = 0;
    expect(await inspectAppIndexCacheFootprint(() => {
      if (++checked === inspectionChecks) mkdirSync(f.lease, { mode: 0o700 });
      return true;
    })).toEqual(failed("BUSY"));
    expect(await readdir(f.lease)).toEqual([]);
    await rmdir(f.lease);
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(pendingFootprint);
    expect(await f.fingerprint(f.catalog)).toEqual(marker);
    await runFixtureWithoutNative(f.scratch, "stage-reopen");
    expect(await f.fingerprint(pending)).toEqual(moved);
    expect(await f.nativeFiles(pending)).toEqual(files);

    await mkdir(f.index, { mode: 0o700 });
    const other = join(f.index, "unrelated");
    await writeFile(other, "new original name", { mode: 0o600 });
    expect(await stageRetiredIndexReclaim(target, current)).toEqual(failed("SCHEMA"));
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(failed("UNAVAILABLE"));
    expect(await readFile(other, "utf8")).toBe("new original name");
    expect(await f.fingerprint(pending)).toEqual(moved);
    await rm(other);
    await rmdir(f.index);
    await rename(pending, parked);
    expect(await stageRetiredIndexReclaim(target, current)).toEqual(failed("SCHEMA"));
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(failed("UNAVAILABLE"));
    expect(await f.nativeFiles(parked)).toEqual(files);
    await symlink("fixture-parked", pending);
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(failed("UNAVAILABLE"));
    expect(await readlink(pending)).toBe("fixture-parked");
    expect(await f.nativeFiles(parked)).toEqual(files);
    await rm(pending);
    await rename(parked, pending);
    expect(await stageRetiredIndexReclaim(target, current)).toEqual({ ok: true, alreadyStaged: true });
    const member = files[0];
    if (!member) throw Error("Native stage fixture missing files");
    const changed = join(pending, member.name);
    const stat = await lstat(changed);
    await utimes(changed, stat.atime, new Date(stat.mtimeMs + 10_000));
    expect(await stageRetiredIndexReclaim(target, current)).toEqual(failed("MISMATCH"));
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(failed("UNAVAILABLE"));
    expect(await f.fingerprint(f.catalog)).toEqual(marker);
    await absent(f.lease);
    const parkedMarker = join(f.scratch, "parked-marker");
    const remaining = await f.nativeFiles(pending);
    await rename(f.catalog, parkedMarker);
    try {
      expect(await searchAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
      expect(await reopenAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
      expect(await inspectAppIndexCacheFootprint(current)).toEqual(failed("UNAVAILABLE"));
      expect(f.workers()).toBe(workers);
      await absent(f.index);
      await absent(f.catalog);
      expect(await f.nativeFiles(pending)).toEqual(remaining);
      expect(await readdir(f.profile)).toEqual([".reclaim-pending"]);
    } finally {
      await rename(parkedMarker, f.catalog);
    }
    await rm(f.home, { recursive: true, force: true });

    const second = await seed();
    const secondMarker = await f.fingerprint(f.catalog);
    const secondOriginal = await f.fingerprint(f.index);
    const secondFiles = await f.nativeFiles();
    const secondWorkers = f.workers();
    let checks = 0;
    expect(await stageRetiredIndexReclaim(second, () => ++checks < preMoveChecks)).toEqual(failed("CANCELLED"));
    expect(checks).toBe(preMoveChecks);
    expect(await f.fingerprint(f.index)).toEqual(secondOriginal);
    await absent(pending);
    await f.cleanSlot();

    checks = 0;
    const collision = join(pending, "keep");
    expect(await stageRetiredIndexReclaim(second, () => {
      if (++checks === preMoveChecks) {
        mkdirSync(pending, { mode: 0o700 });
        writeFileSync(collision, "late destination", { mode: 0o600 });
      }
      return true;
    })).toEqual(failed("UNAVAILABLE"));
    expect(await readFile(collision, "utf8")).toBe("late destination");
    expect(await f.fingerprint(f.index)).toEqual(secondOriginal);
    expect(await f.fingerprint(f.catalog)).toEqual(secondMarker);
    await rm(collision);
    await rmdir(pending);
    await f.cleanSlot();

    const uncertain = await refuseDirectorySync(f.profile, () => Promise.resolve(!existsSync(f.index) && existsSync(pending)),
      () => stageRetiredIndexReclaim(second, current));
    expect(uncertain).toEqual({ ok: false, error: "UNKNOWN", accepted: true });
    await absent(f.index);
    await absent(f.lease);
    const recovered = await f.fingerprint(pending);
    expect(recovered).toMatchObject({ dev: secondOriginal.dev, ino: secondOriginal.ino, birth: secondOriginal.birth });
    expect(await f.nativeFiles(pending)).toEqual(secondFiles);
    expect(await stageRetiredIndexReclaim(second, current)).toEqual({ ok: true, alreadyStaged: true });
    expect(await f.fingerprint(pending)).toEqual(recovered);
    expect(await f.fingerprint(f.catalog)).toEqual(secondMarker);
    expect(f.workers()).toBe(secondWorkers);

    const goodCatalog = await readFile(f.catalog);
    await writeFile(f.catalog, "{bad staged record");
    const malformed = await f.fingerprint(f.catalog);
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(failed("UNAVAILABLE"));
    expect(await f.fingerprint(f.catalog)).toEqual(malformed);
    await writeFile(f.catalog, goodCatalog);
    expect(await inspectAppIndexCacheFootprint(current)).toEqual({
      ...footprintOf(await f.fingerprint(f.catalog), secondFiles), placement: "pending",
    });
    const inspectMember = secondFiles[0];
    if (!inspectMember) throw Error("Pending statistics fixture missing files");
    const inspectPath = join(pending, inspectMember.name);
    const inspectBefore = await lstat(inspectPath);
    checked = 0;
    expect(await inspectAppIndexCacheFootprint(() => {
      if (++checked === inspectionChecks)
        utimesSync(inspectPath, inspectBefore.atime, new Date(inspectBefore.mtimeMs + 10_000));
      return true;
    })).toEqual(failed("UNAVAILABLE"));
    expect((await lstat(inspectPath)).mtimeMs).toBeGreaterThan(inspectBefore.mtimeMs);
    const foreign = join(pending, "foreign.txt");
    await writeFile(foreign, "preserve foreign", { mode: 0o600 });
    const markerBody: unknown = JSON.parse(goodCatalog.toString());
    if (!record(markerBody)) throw Error("Prepared fixture record missing");
    await writeFile(f.catalog, JSON.stringify({ ...markerBody, stagingDigest: await preparedDigest(pending, second) }));
    const foreignFiles = await f.nativeFiles(pending);
    const foreignCatalog = await f.fingerprint(f.catalog);
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(failed("UNAVAILABLE"));
    expect(await f.fingerprint(f.catalog)).toEqual(foreignCatalog);
    expect(await f.nativeFiles(pending)).toEqual(foreignFiles);
    expect(await readFile(foreign, "utf8")).toBe("preserve foreign");
    await absent(f.lease);
    expect(f.workers()).toBe(secondWorkers);
  } finally {
    f.stopRecording();
    await rm(f.home, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(mode !== "stage-reopen")("fresh process validates a staged directory and all old entries fail closed", async () => {
  const f = await fixture();
  expect((await readdir(f.scratch)).sort()).toEqual(["home", "retry"]);
  expect(import.meta.dir).toBe(join(f.scratch, "retry", "bun"));
  expect(existsSync(join(f.scratch, "retry", "native", "save-primitives.node"))).toBe(false);
  const pending = join(f.profile, ".reclaim-pending");
  const marker: unknown = JSON.parse(await readFile(f.catalog, "utf8"));
  if (!record(marker) || marker.version !== 3 || typeof marker.inventoryDigest !== "string")
    throw Error("Staged marker missing");
  const target = { ...retirement, inventoryDigest: marker.inventoryDigest };
  const catalog = await f.fingerprint(f.catalog);
  const directory = await f.fingerprint(pending);
  const files = await f.nativeFiles(pending);
  f.startRecording();
  try {
    expect(await stageRetiredIndexReclaim(target, current)).toEqual({ ok: true, alreadyStaged: true });
    expect(await prepareRetiredIndexReclaim(target, current)).toEqual(failed("SCHEMA"));
    expect(await inspectRetiredIndexReclaim(retirement, current)).toEqual(failed("SCHEMA"));
    expect(await inspectAppIndexCacheFootprint(current)).toEqual({
      ...footprintOf(catalog, files), placement: "pending",
    });
    expect(await reopenAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
    expect(await searchAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
    expect(await retireAppIndexCache(retirement, current, true)).toEqual(failed("SCHEMA"));
    expect(f.workers()).toBe(0);
    expect(await f.fingerprint(f.catalog)).toEqual(catalog);
    expect(await f.fingerprint(pending)).toEqual(directory);
    expect(await f.nativeFiles(pending)).toEqual(files);
    expect((await readdir(f.profile)).sort()).toEqual([".reclaim-pending", "catalog.json"]);
  } finally {
    f.stopRecording();
  }
});

test.skipIf(mode !== "purge")("a purge roster records a staged index without changing any existing file", async () => {
  const f = await fixture();
  expect(await readdir(f.scratch)).toEqual([]);
  const pending = join(f.profile, ".reclaim-pending");
  const roster = join(f.profile, ".reclaim-purge.json");
  const unavailable = failed("UNAVAILABLE");
  const mismatch = failed("MISMATCH");
  f.startRecording();
  async function seed() {
    await mkdir(f.home, { mode: 0o700 });
    expect(await searchAppIndexCache(input, current)).toMatchObject({ ok: true, generation: 1, applied: 1 });
    expect(await retireAppIndexCache(retirement, current, true)).toEqual({ ok: true, alreadyRetired: false });
    const proof = await inspectRetiredIndexReclaim(retirement, current);
    if (!proof.ok) throw Error("Purge preflight fixture unavailable: " + proof.error);
    const target = { ...retirement, inventoryDigest: proof.inventoryDigest };
    expect(await prepareRetiredIndexReclaim(target, current)).toEqual({ ok: true, alreadyPrepared: false });
    expect(await prepareStagedIndexPurge(target, current)).toEqual(failed("SCHEMA"));
    expect(await stageRetiredIndexReclaim(target, current)).toEqual({ ok: true, alreadyStaged: false });
    return target;
  }
  async function emptyRoster() {
    expect((await readdir(f.profile)).sort()).toEqual([".reclaim-pending", "catalog.json"]);
  }
  try {
    const target = await seed();
    const catalog = await f.fingerprint(f.catalog);
    const catalogRaw = await readFile(f.catalog);
    const files = await f.nativeFiles(pending);
    const workers = f.workers();
    expect(await prepareStagedIndexPurge({ ...target, ...wrongScope }, current)).toEqual(failed("SCHEMA"));
    expect(await prepareStagedIndexPurge({ ...target, ...wrongGeneration }, current)).toEqual(mismatch);
    expect(await prepareStagedIndexPurge({ ...target, inventoryDigest: sha("wrong purge digest") }, current)).toEqual(mismatch);
    expect(await prepareStagedIndexPurge({ ...target, inventoryDigest: "wrong" }, current)).toEqual(failed("INPUT"));
    expect(await prepareStagedIndexPurge(target, () => false)).toEqual(failed("CANCELLED"));
    expect(await inspectAppIndexCacheFootprint(current)).toEqual({ ...footprintOf(catalog, files), placement: "pending" });

    await mkdir(f.lease, { mode: 0o700 });
    const busy = join(f.lease, "keep");
    await writeFile(busy, "busy", { mode: 0o600 });
    expect(await prepareStagedIndexPurge(target, current)).toEqual(failed("BUSY"));
    expect(await readFile(busy, "utf8")).toBe("busy");
    await rm(busy);
    await rmdir(f.lease);

    const outside = join(f.scratch, "unrelated-roster");
    try {
      await writeFile(outside, "do not follow", { mode: 0o600 });
      await symlink(outside, roster);
      expect(await prepareStagedIndexPurge(target, current)).toEqual(unavailable);
      expect(await inspectAppIndexCacheFootprint(current)).toEqual(unavailable);
      expect(await readlink(roster)).toBe(outside);
      expect(await readFile(outside, "utf8")).toBe("do not follow");
      await rm(roster);
      await link(outside, roster);
      expect(await prepareStagedIndexPurge(target, current)).toEqual(unavailable);
      expect(await inspectAppIndexCacheFootprint(current)).toEqual(unavailable);
      expect((await lstat(outside)).nlink).toBe(2);
      expect(await readFile(outside, "utf8")).toBe("do not follow");
      await rm(roster);
    } finally {
      await rm(outside, { force: true });
    }
    const foreign = join(pending, "foreign.txt");
    await writeFile(foreign, "keep foreign", { mode: 0o600 });
    expect(await prepareStagedIndexPurge(target, current)).toEqual(failed("SCHEMA"));
    expect(await readFile(foreign, "utf8")).toBe("keep foreign");
    await rm(foreign);
    await emptyRoster();
    expect(await f.nativeFiles(pending)).toEqual(files);
    expect(await f.fingerprint(f.catalog)).toEqual(catalog);

    const expected = await purgeRoster(pending, target, catalogRaw);
    const directory = await f.fingerprint(pending);
    expect(await prepareStagedIndexPurge(target, current)).toEqual({ ok: true, alreadyPrepared: false });
    expect(await readFile(roster, "utf8")).toBe(expected);
    const marker = await f.fingerprint(roster);
    expect(marker.mode & 0o777n).toBe(0o600n);
    expect(marker.links).toBe(1n);
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(purgeFootprint(catalog, files, marker));
    await runFixture(f.scratch, "purge-reopen");
    expect(await f.fingerprint(roster)).toEqual(marker);
    expect(await f.fingerprint(f.catalog)).toEqual(catalog);
    expect(await f.fingerprint(pending)).toEqual(directory);
    expect(await f.nativeFiles(pending)).toEqual(files);
    expect(f.workers()).toBe(workers);

    await writeFile(roster, expected.replace(sha(catalogRaw), sha("wrong catalog bytes")));
    const wrong = await f.fingerprint(roster);
    expect(await prepareStagedIndexPurge(target, current)).toEqual(mismatch);
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(unavailable);
    expect(await f.fingerprint(roster)).toEqual(wrong);
    await writeFile(roster, Buffer.alloc(65_537, 0x61));
    const oversized = await f.fingerprint(roster);
    expect(await prepareStagedIndexPurge(target, current)).toEqual(unavailable);
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(unavailable);
    expect(await f.fingerprint(roster)).toEqual(oversized);
    expect(await f.nativeFiles(pending)).toEqual(files);
    expect(await f.fingerprint(f.catalog)).toEqual(catalog);
    await rm(f.home, { recursive: true, force: true });

    const second = await seed();
    const secondCatalog = await f.fingerprint(f.catalog);
    const secondExpected = await purgeRoster(pending, second, await readFile(f.catalog));
    const secondFiles = await f.nativeFiles(pending);
    const secondDirectory = await f.fingerprint(pending);
    const secondWorkers = f.workers();
    const stagedRoster = (name: string) => /^\.agentic-save-[a-f0-9-]+$/.test(name);
    const cancelled = beforePublish(f.profile, () => false, stagedRoster);
    expect(await prepareStagedIndexPurge(second, cancelled.current)).toEqual(failed("CANCELLED"));
    expect(cancelled.visited()).toBe(true);
    await emptyRoster();
    expect(await f.fingerprint(f.catalog)).toEqual(secondCatalog);

    const collided = beforePublish(f.profile, () => {
      writeFileSync(roster, "late name", { flag: "wx", mode: 0o600 });
      return true;
    }, stagedRoster);
    expect(await prepareStagedIndexPurge(second, collided.current)).toEqual(unavailable);
    expect(collided.visited()).toBe(true);
    expect(await readFile(roster, "utf8")).toBe("late name");
    await rm(roster);
    await emptyRoster();

    const unknown = await refuseDirectorySync(f.profile, () => Promise.resolve(existsSync(roster)),
      () => prepareStagedIndexPurge(second, current));
    expect(unknown).toEqual({ ok: false, error: "UNKNOWN", accepted: true });
    expect(await readFile(roster, "utf8")).toBe(secondExpected);
    const uncertain = await f.fingerprint(roster);
    expect(await prepareStagedIndexPurge(second, current)).toEqual({ ok: true, alreadyPrepared: true });
    expect(await f.fingerprint(roster)).toEqual(uncertain);
    expect(await f.fingerprint(f.catalog)).toEqual(secondCatalog);
    expect(await f.fingerprint(pending)).toEqual(secondDirectory);
    expect(await f.nativeFiles(pending)).toEqual(secondFiles);
    expect(f.workers()).toBe(secondWorkers);
    expect((await readdir(f.profile)).sort()).toEqual([".reclaim-pending", ".reclaim-purge.json", "catalog.json"]);
    const member = secondFiles[0];
    if (!member) throw Error("Purge fixture missing native file");
    const changed = join(pending, member.name);
    const original = await lstat(changed);
    await utimes(changed, original.atime, new Date(original.mtimeMs + 10_000));
    expect(await prepareStagedIndexPurge(second, current)).toEqual(mismatch);
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(unavailable);
    expect(await f.fingerprint(roster)).toEqual(uncertain);
    expect(await f.fingerprint(f.catalog)).toEqual(secondCatalog);

    const parkedPending = join(f.scratch, "parked-pending");
    const parkedCatalog = join(f.scratch, "parked-catalog");
    await rename(pending, parkedPending);
    try {
      await rename(f.catalog, parkedCatalog);
      try {
        const parkedFiles = await f.nativeFiles(parkedPending);
        expect(await searchAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
        expect(await reopenAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
        expect(await inspectAppIndexCacheFootprint(current)).toEqual(unavailable);
        expect(await f.fingerprint(roster)).toEqual(uncertain);
        expect(await f.nativeFiles(parkedPending)).toEqual(parkedFiles);
        expect(await readdir(f.profile)).toEqual([".reclaim-purge.json"]);
        expect(f.workers()).toBe(secondWorkers);
      } finally {
        await rename(parkedCatalog, f.catalog);
      }
    } finally {
      await rename(parkedPending, pending);
    }
  } finally {
    f.stopRecording();
    await rm(f.home, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(mode !== "purge-reopen")("a fresh process confirms an existing purge roster without rewriting it", async () => {
  const f = await fixture();
  expect(await readdir(f.scratch)).toEqual(["home"]);
  const pending = join(f.profile, ".reclaim-pending");
  const roster = join(f.profile, ".reclaim-purge.json");
  const catalogRaw = await readFile(f.catalog);
  const parsed: unknown = JSON.parse(catalogRaw.toString());
  if (!record(parsed) || parsed.version !== 3 || typeof parsed.inventoryDigest !== "string")
    throw Error("Staged fixture missing");
  const target = { ...retirement, inventoryDigest: parsed.inventoryDigest };
  const catalog = await f.fingerprint(f.catalog);
  const files = await f.nativeFiles(pending);
  const directory = await f.fingerprint(pending);
  const marker = await f.fingerprint(roster);
  f.startRecording();
  try {
    expect(await readFile(roster, "utf8")).toBe(await purgeRoster(pending, target, catalogRaw));
    expect(await prepareStagedIndexPurge(target, current)).toEqual({ ok: true, alreadyPrepared: true });
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(purgeFootprint(catalog, files, marker));
    expect(await stageRetiredIndexReclaim(target, current)).toEqual(failed("UNAVAILABLE"));
    expect(await prepareRetiredIndexReclaim(target, current)).toEqual(failed("SCHEMA"));
    expect(await inspectRetiredIndexReclaim(retirement, current)).toEqual(failed("SCHEMA"));
    expect(await reopenAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
    expect(await searchAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
    expect(f.workers()).toBe(0);
    expect(await f.fingerprint(roster)).toEqual(marker);
    expect(await f.fingerprint(f.catalog)).toEqual(catalog);
    expect(await f.fingerprint(pending)).toEqual(directory);
    expect(await f.nativeFiles(pending)).toEqual(files);
    expect((await readdir(f.profile)).sort()).toEqual([".reclaim-pending", ".reclaim-purge.json", "catalog.json"]);
  } finally {
    f.stopRecording();
  }
});

test.skipIf(mode !== "progress")("purge progress audits intact, partial and empty synthetic inventory without writing", async () => {
  const f = await fixture();
  expect(await readdir(f.scratch)).toEqual([]);
  const pending = join(f.profile, ".reclaim-pending");
  const roster = join(f.profile, ".reclaim-purge.json");
  const unavailable = failed("UNAVAILABLE");
  const mismatch = failed("MISMATCH");
  const schema = failed("SCHEMA");
  f.startRecording();
  try {
    await mkdir(f.home, { mode: 0o700 });
    expect(await searchAppIndexCache(input, current)).toMatchObject({ ok: true, generation: 1, applied: 1 });
    expect(await retireAppIndexCache(retirement, current, true)).toEqual({ ok: true, alreadyRetired: false });
    const preflight = await inspectRetiredIndexReclaim(retirement, current);
    if (!preflight.ok) throw Error("Progress fixture preflight unavailable: " + preflight.error);
    const target = { ...retirement, inventoryDigest: preflight.inventoryDigest };
    const inspect = (proof = target, guard = current) => inspectStagedIndexPurgeProgress(proof, guard);
    expect(await prepareRetiredIndexReclaim(target, current)).toEqual({ ok: true, alreadyPrepared: false });
    expect(await inspect()).toEqual(unavailable);
    expect(await stageRetiredIndexReclaim(target, current)).toEqual({ ok: true, alreadyStaged: false });
    expect(await inspect()).toEqual(unavailable);
    expect(await prepareStagedIndexPurge(target, current)).toEqual({ ok: true, alreadyPrepared: false });
    const files = await f.nativeFiles(pending);
    const stamps = await inventoryStamps(pending);
    const catalogStat = await f.fingerprint(f.catalog);
    const rosterStat = await f.fingerprint(roster);
    const catalogBytes = await readFile(f.catalog);
    const rosterBytes = await readFile(roster);
    const workers = f.workers();
    expect(await inspect({ ...target, ...wrongScope })).toEqual(schema);
    expect(await inspect({ ...target, ...wrongGeneration })).toEqual(mismatch);
    expect(await inspect({ ...target, inventoryDigest: sha("wrong progress digest") })).toEqual(mismatch);
    expect(await inspect({ ...target, inventoryDigest: "malformed" })).toEqual(failed("INPUT"));
    expect(await inspect(target, () => false)).toEqual(failed("CANCELLED"));
    const full = progressOf(files.length, files);
    let checks = 0;
    let sawLease = false;
    expect(await inspect(target, () => {
      checks++;
      sawLease ||= existsSync(f.lease);
      return true;
    })).toEqual(full);
    expect(checks).toBeGreaterThan(1);
    expect(sawLease).toBe(false);
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(purgeFootprint(catalogStat, files, rosterStat));

    let observed = 0;
    expect(await inspect(target, () => ++observed < checks)).toEqual(failed("CANCELLED"));
    expect(observed).toBe(checks);
    observed = 0;
    expect(await inspect(target, () => {
      if (++observed === checks) mkdirSync(f.lease, { mode: 0o700 });
      return true;
    })).toEqual(failed("BUSY"));
    expect(await readdir(f.lease)).toEqual([]);
    expect(await inspect()).toEqual(failed("BUSY"));
    await rmdir(f.lease);

    await mkdir(f.index, { mode: 0o700 });
    expect(await inspect()).toEqual(unavailable);
    expect(await readdir(f.index)).toEqual([]);
    await rmdir(f.index);
    const foreign = join(pending, "unknown-fixture.txt");
    await writeFile(foreign, "preserve extra", { mode: 0o600 });
    expect(await inspect()).toEqual(mismatch);
    expect(await readFile(foreign, "utf8")).toBe("preserve extra");
    await rm(foreign);
    expect(await f.nativeFiles(pending)).toEqual(files);
    expect(await inspect()).toEqual(full);

    // Mutate only the synthetic fixture. A missing control file is still an
    // auditable subset because the complete history is held by both records.
    const removed = join(pending, "bridge.schema");
    const time = await lstat(removed);
    await utimes(removed, time.atime, new Date(time.mtimeMs + 10_000));
    const changed = await f.fingerprint(removed);
    expect(await inspect()).toEqual(mismatch);
    expect(await f.fingerprint(removed)).toEqual(changed);
    await rm(removed);
    await symlink(f.catalog, removed);
    expect(await inspect()).toEqual(unavailable);
    expect(await readlink(removed)).toBe(f.catalog);
    await rm(removed);
    const survivors = files.filter(file => file.name !== "bridge.schema");
    expect(survivors.length).toBe(files.length - 1);
    const partial = progressOf(files.length, survivors);
    expect(await inspect()).toEqual(partial);
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(unavailable);
    await runFixture(f.scratch, "progress-reopen");
    expect(await f.nativeFiles(pending)).toEqual(survivors);
    expect(await f.fingerprint(f.catalog)).toEqual(catalogStat);
    expect(await f.fingerprint(roster)).toEqual(rosterStat);

    for (const member of survivors) await rm(join(pending, member.name));
    const emptyDir = await f.fingerprint(pending);
    expect(await inspect()).toEqual(progressOf(files.length, []));
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(unavailable);
    expect(await f.fingerprint(pending)).toEqual(emptyDir);
    expect(await f.fingerprint(f.catalog)).toEqual(catalogStat);
    expect(await f.fingerprint(roster)).toEqual(rosterStat);
    expect(await readdir(pending)).toEqual([]);

    async function refuseRoster(bytes: string | Buffer, error: typeof schema | typeof mismatch) {
      await writeFile(roster, bytes);
      const supplied = await f.fingerprint(roster);
      expect(await inspect()).toEqual(error);
      expect(await f.fingerprint(roster)).toEqual(supplied);
    }
    await refuseRoster(rosterBytes.toString() + "\n", schema);
    await refuseRoster(Buffer.alloc(65_537, 0x61), schema);
    await refuseRoster(rosterBytes.toString().replace(sha(catalogBytes), sha("wrong catalog raw bytes")), mismatch);

    const originalCatalog: unknown = JSON.parse(catalogBytes.toString());
    const originalRoster: unknown = JSON.parse(rosterBytes.toString());
    if (!record(originalCatalog) || !record(originalRoster)) throw Error("Fixture markers missing");
    const firstSegment = stamps.files.find(([name]) => /^[a-f0-9]{32}\.idx$/.test(name));
    if (!firstSegment) throw Error("Fixture segment missing");
    const badNames = [...stamps.files, [`../${firstSegment[0]}`, firstSegment[1]] as const]
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    for (const badFiles of [badNames, stamps.files.filter(([name]) => name !== ".managed.json")]) {
      const stagingDigest = digestStamps(target, { ...stamps, files: badFiles });
      const forged = JSON.stringify({ ...originalCatalog, stagingDigest });
      await writeFile(f.catalog, forged);
      const suppliedCatalog = await f.fingerprint(f.catalog);
      await refuseRoster(JSON.stringify({
        ...originalRoster, stagingDigest, catalogSha256: sha(forged), files: badFiles,
      }), schema);
      expect(await f.fingerprint(f.catalog)).toEqual(suppliedCatalog);
    }
    expect(await f.fingerprint(pending)).toEqual(emptyDir);
    expect(await readdir(pending)).toEqual([]);
    expect(f.workers()).toBe(workers);
    expect((await readdir(f.profile)).sort()).toEqual([".reclaim-pending", ".reclaim-purge.json", "catalog.json"]);
  } finally {
    f.stopRecording();
    await rm(f.home, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(mode !== "progress-reopen")("a fresh process reads partial progress without touching the roster or survivors", async () => {
  const f = await fixture();
  expect(await readdir(f.scratch)).toEqual(["home"]);
  const pending = join(f.profile, ".reclaim-pending");
  const roster = join(f.profile, ".reclaim-purge.json");
  const parsed: unknown = JSON.parse(await readFile(roster, "utf8"));
  if (!record(parsed) || typeof parsed.inventoryDigest !== "string" || !Array.isArray(parsed.files))
    throw Error("Progress fixture missing roster");
  const target = { ...retirement, inventoryDigest: parsed.inventoryDigest };
  const files = await f.nativeFiles(pending);
  const catalog = await f.fingerprint(f.catalog);
  const marker = await f.fingerprint(roster);
  const directory = await f.fingerprint(pending);
  f.startRecording();
  try {
    const expected = progressOf(parsed.files.length, files);
    expect(expected.missingFiles).toBe(1);
    expect(await inspectStagedIndexPurgeProgress(target, current)).toEqual(expected);
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(failed("UNAVAILABLE"));
    expect(await f.fingerprint(f.catalog)).toEqual(catalog);
    expect(await f.fingerprint(roster)).toEqual(marker);
    expect(await f.fingerprint(pending)).toEqual(directory);
    expect(await f.nativeFiles(pending)).toEqual(files);
    expect(f.workers()).toBe(0);
    expect((await readdir(f.profile)).sort()).toEqual([".reclaim-pending", ".reclaim-purge.json", "catalog.json"]);
  } finally {
    f.stopRecording();
  }
});

test.skipIf(mode !== "remove-member")("one ordinal removes exactly one native member and uncertain sync allows the same ordinal only", async () => {
  const f = await fixture();
  expect(await readdir(f.scratch)).toEqual([]);
  const pending = join(f.profile, ".reclaim-pending");
  const roster = join(f.profile, ".reclaim-purge.json");
  const mismatch = failed("MISMATCH");
  const unavailable = failed("UNAVAILABLE");
  const receipt = (alreadyMissing: boolean, remainingFiles: number) =>
    ({ ok: true as const, alreadyMissing, remainingFiles });
  const unknown = { ok: false, error: "UNKNOWN", accepted: true } as const;
  f.startRecording();
  async function seed() {
    await mkdir(f.home, { mode: 0o700 });
    expect(await searchAppIndexCache(input, current)).toMatchObject({ ok: true, generation: 1, applied: 1 });
    expect(await retireAppIndexCache(retirement, current, true)).toEqual({ ok: true, alreadyRetired: false });
    const preflight = await inspectRetiredIndexReclaim(retirement, current);
    if (!preflight.ok) throw Error("Removal fixture preflight unavailable: " + preflight.error);
    const target = { ...retirement, inventoryDigest: preflight.inventoryDigest };
    expect(await prepareRetiredIndexReclaim(target, current)).toEqual({ ok: true, alreadyPrepared: false });
    expect(await stageRetiredIndexReclaim(target, current)).toEqual({ ok: true, alreadyStaged: false });
    expect(await prepareStagedIndexPurge(target, current)).toEqual({ ok: true, alreadyPrepared: false });
    const files = await f.nativeFiles(pending);
    const order = removalOrder(files.map(({ name }) => name));
    const first = order[0];
    const next = order[1];
    if (!first || !next || !nativeSegment(first) || !nativeSegment(next))
      throw Error("Native fixture does not have two segment components");
    return {
      target, files, order, first, next,
      catalog: await f.fingerprint(f.catalog), marker: await f.fingerprint(roster),
      directory: await f.fingerprint(pending), workers: f.workers(),
      remove: (ordinal: number, guard = current) => removeStagedIndexPurgeMember({ ...target, ordinal }, guard),
    };
  }
  async function absent(path: string) {
    expect(await lstat(path).catch((error: unknown) => error)).toMatchObject({ code: "ENOENT" });
  }
  async function verifyMarkers(snapshot: Awaited<ReturnType<typeof seed>>) {
    expect(await f.fingerprint(f.catalog)).toEqual(snapshot.catalog);
    expect(await f.fingerprint(roster)).toEqual(snapshot.marker);
    expect(await f.fingerprint(pending)).toMatchObject({
      dev: snapshot.directory.dev, ino: snapshot.directory.ino, birth: snapshot.directory.birth,
      uid: snapshot.directory.uid, mode: snapshot.directory.mode,
    });
    expect(f.workers()).toBe(snapshot.workers);
  }
  try {
    const initial = await seed();
    const { target, files, order, first, next, remove } = initial;
    expect(await remove(-1)).toEqual(failed("INPUT"));
    expect(await remove(1.5)).toEqual(failed("INPUT"));
    expect(await remove(files.length)).toEqual(failed("INPUT"));
    expect(await removeStagedIndexPurgeMember({ ...target, ...wrongGeneration, ordinal: 0 }, current)).toEqual(mismatch);
    expect(await remove(0, () => false)).toEqual(failed("CANCELLED"));
    expect(await remove(1)).toEqual(mismatch);
    const firstControl = order.findIndex(name => !nativeSegment(name));
    expect(firstControl).toBeGreaterThan(1);
    expect(await remove(firstControl)).toEqual(mismatch);
    await mkdir(f.lease, { mode: 0o700 });
    const busy = join(f.lease, "keep");
    await writeFile(busy, "busy", { mode: 0o600 });
    expect(await remove(0)).toEqual(failed("BUSY"));
    expect(await readFile(busy, "utf8")).toBe("busy");
    await rm(busy);
    await rmdir(f.lease);
    const foreign = join(pending, "unrelated.txt");
    await writeFile(foreign, "keep foreign", { mode: 0o600 });
    expect(await remove(0)).toEqual(mismatch);
    expect(await readFile(foreign, "utf8")).toBe("keep foreign");
    await rm(foreign);
    expect(await f.nativeFiles(pending)).toEqual(files);
    await verifyMarkers(initial);

    const selectedPath = join(pending, first);
    const selected = await open(selectedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let beforeUnlink = 0;
    try {
      const original = await selected.stat({ bigint: true });
      expect(await remove(0, () => {
        if (existsSync(selectedPath)) beforeUnlink++;
        return true;
      })).toEqual(receipt(false, files.length - 1));
      const after = await selected.stat({ bigint: true });
      expect({ dev: after.dev, ino: after.ino, birth: after.birthtimeNs, links: after.nlink })
        .toEqual({ dev: original.dev, ino: original.ino, birth: original.birthtimeNs, links: 0n });
    } finally {
      await selected.close();
    }
    expect(beforeUnlink).toBeGreaterThan(1);
    await absent(selectedPath);
    const survivors = files.filter(({ name }) => name !== first);
    expect(await remove(0)).toEqual(receipt(true, survivors.length));
    expect(await f.nativeFiles(pending)).toEqual(survivors);
    expect(await inspectStagedIndexPurgeProgress(target, current)).toEqual(progressOf(files.length, survivors));
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(unavailable);
    await runFixture(f.scratch, "remove-member-reopen");
    await absent(join(pending, next));
    expect(await f.nativeFiles(pending)).toEqual(survivors.filter(({ name }) => name !== next));
    await verifyMarkers(initial);

    // Skip the rest of the segment group only in this disposable fixture.
    const laterOrdinal = 3;
    const later = order[laterOrdinal];
    if (!later || !nativeSegment(later)) throw Error("Native fixture missing later segment component");
    await rm(join(pending, later));
    const beforeMissingRetry = await f.nativeFiles(pending);
    expect(await remove(laterOrdinal)).toEqual(receipt(true, beforeMissingRetry.length));
    expect(await f.nativeFiles(pending)).toEqual(beforeMissingRetry);
    for (const name of order.slice(2, firstControl)) {
      if (name !== later) await rm(join(pending, name));
    }
    const controls = files.filter(({ name }) => !nativeSegment(name));
    expect(await f.nativeFiles(pending)).toEqual(controls);
    expect(await remove(firstControl + 1)).toEqual(mismatch);
    expect(await remove(firstControl)).toEqual(receipt(false, controls.length - 1));
    expect(await f.nativeFiles(pending)).toEqual(controls.filter(({ name }) => name !== order[firstControl]));
    await verifyMarkers(initial);
    await absent(f.lease);
    await rm(f.home, { recursive: true, force: true });

    const second = await seed();
    const secondPath = join(pending, second.first);
    let checks = 0;
    expect(await second.remove(0, () => ++checks < beforeUnlink)).toEqual(failed("CANCELLED"));
    expect(checks).toBe(beforeUnlink);
    expect(await f.nativeFiles(pending)).toEqual(second.files);
    await absent(f.lease);

    const parkedLease = join(f.profile, "parked-lease");
    const replacementMarker = join(f.lease, "late-lease");
    checks = 0;
    expect(await second.remove(0, () => {
      if (++checks === beforeUnlink) {
        renameSync(f.lease, parkedLease);
        mkdirSync(f.lease, { mode: 0o700 });
        writeFileSync(replacementMarker, "preserve lease", { mode: 0o600 });
      }
      return true;
    })).toEqual(unknown);
    expect(await readFile(replacementMarker, "utf8")).toBe("preserve lease");
    expect(await readdir(parkedLease)).toEqual([]);
    expect(await f.nativeFiles(pending)).toEqual(second.files);
    await rm(replacementMarker);
    await rmdir(f.lease);
    await rmdir(parkedLease);

    const failedSync = await refuseDirectorySync(pending, () => Promise.resolve(!existsSync(secondPath)),
      () => second.remove(0));
    expect(failedSync).toEqual(unknown);
    await absent(secondPath);
    const secondSurvivors = second.files.filter(({ name }) => name !== second.first);
    expect(await f.nativeFiles(pending)).toEqual(secondSurvivors);
    await absent(f.lease);
    const failedRetrySync = await refuseDirectorySync(pending, () => Promise.resolve(true), () => second.remove(0));
    expect(failedRetrySync).toEqual(unknown);
    expect(await f.nativeFiles(pending)).toEqual(secondSurvivors);
    expect(await second.remove(0)).toEqual(receipt(true, secondSurvivors.length));
    expect(await f.nativeFiles(pending)).toEqual(secondSurvivors);
    expect(await inspectStagedIndexPurgeProgress(second.target, current))
      .toEqual(progressOf(second.files.length, secondSurvivors));
    await verifyMarkers(second);

    const nextPath = join(pending, second.next);
    const originalBytes = await readFile(nextPath);
    const parked = join(f.scratch, "parked-member");
    await rename(nextPath, parked);
    try {
      await writeFile(nextPath, originalBytes, { mode: 0o600, flag: "wx" });
      const replacement = await f.fingerprint(nextPath);
      expect(await second.remove(1)).toEqual(mismatch);
      expect(await f.fingerprint(nextPath)).toEqual(replacement);
      await rm(nextPath);
      await symlink(parked, nextPath);
      expect(await second.remove(1)).toEqual(unavailable);
      expect(await readlink(nextPath)).toBe(parked);
      expect(await readFile(parked)).toEqual(originalBytes);
      await rm(nextPath);
    } finally {
      await rename(parked, nextPath);
    }
    await verifyMarkers(second);
    expect((await readdir(f.profile)).sort()).toEqual([".reclaim-pending", ".reclaim-purge.json", "catalog.json"]);
  } finally {
    f.stopRecording();
    await rm(f.home, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(mode !== "remove-member-reopen")("a new process retries the prior ordinal and removes only the next member", async () => {
  const f = await fixture();
  expect(await readdir(f.scratch)).toEqual(["home"]);
  const pending = join(f.profile, ".reclaim-pending");
  const roster = join(f.profile, ".reclaim-purge.json");
  const parsed: unknown = JSON.parse(await readFile(roster, "utf8"));
  if (!record(parsed) || typeof parsed.inventoryDigest !== "string" || !Array.isArray(parsed.files))
    throw Error("Removal fixture missing roster");
  const names = parsed.files.map((pair: unknown) => {
    if (!Array.isArray(pair) || typeof pair[0] !== "string") throw Error("Removal fixture missing name");
    return pair[0];
  });
  const order = removalOrder(names);
  const first = order[0], second = order[1];
  if (!first || !second) throw Error("Removal fixture missing members");
  const target = { ...retirement, inventoryDigest: parsed.inventoryDigest };
  const initial = await f.nativeFiles(pending);
  expect(initial.map(({ name }) => name)).toEqual(names.filter(name => name !== first));
  const catalog = await f.fingerprint(f.catalog);
  const marker = await f.fingerprint(roster);
  f.startRecording();
  try {
    expect(await removeStagedIndexPurgeMember({ ...target, ordinal: 0 }, current))
      .toEqual({ ok: true, alreadyMissing: true, remainingFiles: initial.length });
    expect(await f.nativeFiles(pending)).toEqual(initial);
    expect(await removeStagedIndexPurgeMember({ ...target, ordinal: 1 }, current))
      .toEqual({ ok: true, alreadyMissing: false, remainingFiles: initial.length - 1 });
    const remaining = initial.filter(({ name }) => name !== second);
    expect(await f.nativeFiles(pending)).toEqual(remaining);
    expect(await inspectStagedIndexPurgeProgress(target, current)).toEqual(progressOf(names.length, remaining));
    expect(await f.fingerprint(f.catalog)).toEqual(catalog);
    expect(await f.fingerprint(roster)).toEqual(marker);
    expect(f.workers()).toBe(0);
    expect((await readdir(f.profile)).sort()).toEqual([".reclaim-pending", ".reclaim-purge.json", "catalog.json"]);
  } finally {
    f.stopRecording();
  }
});

test.skipIf(mode !== "empty-completion")("an empty staged index is confirmed without removing its directory or records", async () => {
  const f = await fixture();
  expect(await readdir(f.scratch)).toEqual([]);
  const pending = join(f.profile, ".reclaim-pending");
  const roster = join(f.profile, ".reclaim-purge.json");
  const completion = join(f.profile, ".reclaim-complete.json");
  const unavailable = failed("UNAVAILABLE");
  const mismatch = failed("MISMATCH");
  const unknown = { ok: false, error: "UNKNOWN", accepted: true } as const;
  const stagedRecord = (name: string) => /^\.agentic-save-[a-f0-9-]+$/.test(name);
  f.startRecording();
  async function seedEmpty() {
    await mkdir(f.home, { mode: 0o700 });
    expect(await searchAppIndexCache(input, current)).toMatchObject({ ok: true, generation: 1, applied: 1 });
    expect(await retireAppIndexCache(retirement, current, true)).toEqual({ ok: true, alreadyRetired: false });
    const preflight = await inspectRetiredIndexReclaim(retirement, current);
    if (!preflight.ok) throw Error("Completion fixture preflight refused: " + preflight.error);
    const target = { ...retirement, inventoryDigest: preflight.inventoryDigest };
    const complete = (guard = current) => prepareEmptyStagedIndexCompletion(target, guard);
    expect(await prepareRetiredIndexReclaim(target, current)).toEqual({ ok: true, alreadyPrepared: false });
    expect(await stageRetiredIndexReclaim(target, current)).toEqual({ ok: true, alreadyStaged: false });
    expect(await complete()).toEqual(unavailable);
    expect(await prepareStagedIndexPurge(target, current)).toEqual({ ok: true, alreadyPrepared: false });
    const files = await f.nativeFiles(pending);
    const catalogRaw = await readFile(f.catalog);
    const rosterRaw = await readFile(roster);
    const original = await f.fingerprint(f.catalog);
    const history = await f.fingerprint(roster);
    const stagingDigest = await preparedDigest(pending, target);
    expect(await complete()).toEqual(mismatch);
    expect(await f.nativeFiles(pending)).toEqual(files);
    for (let ordinal = 0; ordinal < files.length; ordinal++)
      expect(await removeStagedIndexPurgeMember({ ...target, ordinal }, current))
        .toEqual({ ok: true, alreadyMissing: false, remainingFiles: files.length - ordinal - 1 });
    expect(await inspectStagedIndexPurgeProgress(target, current)).toEqual(progressOf(files.length, []));
    expect(await f.fingerprint(f.catalog)).toEqual(original);
    expect(await f.fingerprint(roster)).toEqual(history);
    return {
      complete, target, original, history,
      directory: await f.fingerprint(pending), workers: f.workers(),
      expected: await emptyCompletionBytes(pending, target, stagingDigest, catalogRaw, rosterRaw, files.length),
    };
  }
  async function noCompletion() {
    expect((await readdir(f.profile)).sort()).toEqual([".reclaim-pending", ".reclaim-purge.json", "catalog.json"]);
  }
  async function checkPreservation(snapshot: Awaited<ReturnType<typeof seedEmpty>>) {
    expect(await f.fingerprint(f.catalog)).toEqual(snapshot.original);
    expect(await f.fingerprint(roster)).toEqual(snapshot.history);
    expect(await f.fingerprint(pending)).toEqual(snapshot.directory);
    expect(await readdir(pending)).toEqual([]);
    expect(f.workers()).toBe(snapshot.workers);
  }
  try {
    const first = await seedEmpty();
    expect(await prepareEmptyStagedIndexCompletion({ ...first.target, ...wrongScope }, current)).toEqual(failed("SCHEMA"));
    expect(await prepareEmptyStagedIndexCompletion({ ...first.target, ...wrongGeneration }, current)).toEqual(mismatch);
    expect(await prepareEmptyStagedIndexCompletion({ ...first.target, inventoryDigest: sha("different completion target") }, current))
      .toEqual(mismatch);
    expect(await prepareEmptyStagedIndexCompletion({ ...first.target, inventoryDigest: "invalid" }, current))
      .toEqual(failed("INPUT"));
    expect(await first.complete(() => false)).toEqual(failed("CANCELLED"));
    const occupied = join(f.lease, "keep");
    await mkdir(f.lease, { mode: 0o700 });
    await writeFile(occupied, "busy", { mode: 0o600 });
    expect(await first.complete()).toEqual(failed("BUSY"));
    expect(await readFile(occupied, "utf8")).toBe("busy");
    await rm(occupied);
    await rmdir(f.lease);
    await symlink(roster, completion);
    expect(await first.complete()).toEqual(unavailable);
    expect(await readlink(completion)).toBe(roster);
    await rm(completion);

    const failedPendingSync = await refuseDirectorySync(pending, () => Promise.resolve(true), first.complete);
    expect(failedPendingSync).toEqual(unavailable);
    await noCompletion();
    await checkPreservation(first);
    const cancelled = beforePublish(f.profile, () => false, stagedRecord);
    expect(await first.complete(cancelled.current)).toEqual(failed("CANCELLED"));
    expect(cancelled.visited()).toBe(true);
    await noCompletion();
    const collision = beforePublish(f.profile, () => {
      writeFileSync(completion, "late completion", { flag: "wx", mode: 0o600 });
      return true;
    }, stagedRecord);
    expect(await first.complete(collision.current)).toEqual(unavailable);
    expect(collision.visited()).toBe(true);
    expect(await readFile(completion, "utf8")).toBe("late completion");
    const invalid = await f.fingerprint(completion);
    expect(await first.complete()).toEqual(mismatch);
    expect(await f.fingerprint(completion)).toEqual(invalid);
    await rm(completion);
    await noCompletion();
    await checkPreservation(first);

    expect(await first.complete()).toEqual({ ok: true, alreadyPrepared: false });
    expect(await readFile(completion, "utf8")).toBe(first.expected);
    const marker = await f.fingerprint(completion);
    expect(marker.mode & 0o777n).toBe(0o600n);
    expect(marker.links).toBe(1n);
    await runFixtureWithoutNative(f.scratch, "empty-completion-reopen");
    expect(await f.fingerprint(completion)).toEqual(marker);
    await checkPreservation(first);

    // Park only these fixture-owned records to check an orphan completion.
    const names = [pending, roster, f.catalog];
    const parked = await mkdtemp(join(f.scratch, "parked-completion-"));
    const moved: string[] = [];
    try {
      for (const name of names) {
        await rename(name, join(parked, basename(name)));
        moved.push(name);
      }
      expect(await searchAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
      expect(await reopenAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
      expect(await inspectAppIndexCacheFootprint(current)).toEqual(unavailable);
      expect(await f.fingerprint(completion)).toEqual(marker);
      expect(f.workers()).toBe(first.workers);
      expect(await readdir(f.profile)).toEqual([".reclaim-complete.json"]);
    } finally {
      for (const name of moved) await rename(join(parked, basename(name)), name);
      await rmdir(parked);
    }
    await rm(f.home, { recursive: true, force: true });

    const second = await seedEmpty();
    const failedProfileSync = await refuseDirectorySync(f.profile, () => Promise.resolve(existsSync(completion)), second.complete);
    expect(failedProfileSync).toEqual(unknown);
    expect(await readFile(completion, "utf8")).toBe(second.expected);
    const uncertain = await f.fingerprint(completion);
    expect(await second.complete()).toEqual({ ok: true, alreadyPrepared: true });
    expect(await f.fingerprint(completion)).toEqual(uncertain);
    await checkPreservation(second);
    expect((await readdir(f.profile)).sort()).toEqual([
      ".reclaim-complete.json", ".reclaim-pending", ".reclaim-purge.json", "catalog.json",
    ]);
  } finally {
    f.stopRecording();
    await rm(f.home, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(mode !== "empty-completion-reopen")("fresh process confirms the empty marker without native publication", async () => {
  const f = await fixture();
  expect((await readdir(f.scratch)).sort()).toEqual(["home", "retry"]);
  expect(existsSync(join(f.scratch, "retry", "native", "save-primitives.node"))).toBe(false);
  const pending = join(f.profile, ".reclaim-pending");
  const roster = join(f.profile, ".reclaim-purge.json");
  const completion = join(f.profile, ".reclaim-complete.json");
  const catalogRaw = await readFile(f.catalog);
  const rosterRaw = await readFile(roster);
  const catalog: unknown = JSON.parse(catalogRaw.toString());
  const history: unknown = JSON.parse(rosterRaw.toString());
  if (!record(catalog) || typeof catalog.inventoryDigest !== "string" || typeof catalog.stagingDigest !== "string" ||
      !record(history) || !Array.isArray(history.files))
    throw Error("Empty completion fixture records missing");
  const target = { ...retirement, inventoryDigest: catalog.inventoryDigest };
  const snapshots = [f.catalog, roster, pending, completion];
  const before = await Promise.all(snapshots.map(f.fingerprint));
  f.startRecording();
  try {
    expect(await readFile(completion, "utf8"))
      .toBe(await emptyCompletionBytes(pending, target, catalog.stagingDigest, catalogRaw, rosterRaw, history.files.length));
    expect(await prepareEmptyStagedIndexCompletion(target, current)).toEqual({ ok: true, alreadyPrepared: true });
    expect(await reopenAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
    expect(await searchAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
    expect(await readdir(pending)).toEqual([]);
    expect(await Promise.all(snapshots.map(f.fingerprint))).toEqual(before);
    expect(f.workers()).toBe(0);
    expect((await readdir(f.profile)).sort()).toEqual([
      ".reclaim-complete.json", ".reclaim-pending", ".reclaim-purge.json", "catalog.json",
    ]);
  } finally {
    f.stopRecording();
  }
});

test.skipIf(mode !== "remove-empty-directory")("only the confirmed empty directory is removed and all three records survive", async () => {
  const f = await fixture();
  expect(await readdir(f.scratch)).toEqual([]);
  const pending = join(f.profile, ".reclaim-pending");
  const roster = join(f.profile, ".reclaim-purge.json");
  const completion = join(f.profile, ".reclaim-complete.json");
  const markers = [f.catalog, roster, completion];
  const unavailable = failed("UNAVAILABLE");
  const mismatch = failed("MISMATCH");
  const unknown = { ok: false, error: "UNKNOWN", accepted: true } as const;
  f.startRecording();
  async function seed() {
    await mkdir(f.home, { mode: 0o700 });
    expect(await searchAppIndexCache(input, current)).toMatchObject({ ok: true, generation: 1, applied: 1 });
    expect(await retireAppIndexCache(retirement, current, true)).toEqual({ ok: true, alreadyRetired: false });
    const preflight = await inspectRetiredIndexReclaim(retirement, current);
    if (!preflight.ok) throw Error("Empty-directory removal fixture unavailable: " + preflight.error);
    const target = { ...retirement, inventoryDigest: preflight.inventoryDigest };
    const remove = (guard = current) => removeEmptyStagedIndexDirectory(target, guard);
    expect(await prepareRetiredIndexReclaim(target, current)).toEqual({ ok: true, alreadyPrepared: false });
    expect(await stageRetiredIndexReclaim(target, current)).toEqual({ ok: true, alreadyStaged: false });
    expect(await prepareStagedIndexPurge(target, current)).toEqual({ ok: true, alreadyPrepared: false });
    const files = await f.nativeFiles(pending);
    for (let ordinal = 0; ordinal < files.length; ordinal++)
      expect(await removeStagedIndexPurgeMember({ ...target, ordinal }, current))
        .toEqual({ ok: true, alreadyMissing: false, remainingFiles: files.length - ordinal - 1 });
    expect(await remove()).toEqual(unavailable);
    expect(await prepareEmptyStagedIndexCompletion(target, current)).toEqual({ ok: true, alreadyPrepared: false });
    return {
      target, remove, snapshots: await Promise.all(markers.map(f.fingerprint)),
      profile: await f.fingerprint(f.profile), workers: f.workers(),
    };
  }
  async function noDirectory() {
    expect(await lstat(pending).catch((error: unknown) => error)).toMatchObject({ code: "ENOENT" });
  }
  async function checkRemoved(snapshot: Awaited<ReturnType<typeof seed>>) {
    await noDirectory();
    expect(await Promise.all(markers.map(f.fingerprint))).toEqual(snapshot.snapshots);
    expect(await f.fingerprint(f.profile)).toMatchObject({
      dev: snapshot.profile.dev, ino: snapshot.profile.ino, birth: snapshot.profile.birth,
      uid: snapshot.profile.uid, mode: snapshot.profile.mode,
    });
    expect((await readdir(f.profile)).sort()).toEqual([".reclaim-complete.json", ".reclaim-purge.json", "catalog.json"]);
    expect(f.workers()).toBe(snapshot.workers);
  }
  try {
    const initial = await seed();
    expect(await removeEmptyStagedIndexDirectory({ ...initial.target, ...wrongScope }, current)).toEqual(failed("SCHEMA"));
    expect(await removeEmptyStagedIndexDirectory({ ...initial.target, ...wrongGeneration }, current)).toEqual(mismatch);
    expect(await removeEmptyStagedIndexDirectory({ ...initial.target, inventoryDigest: sha("wrong removal target") }, current))
      .toEqual(mismatch);
    expect(await removeEmptyStagedIndexDirectory({ ...initial.target, inventoryDigest: "invalid" }, current)).toEqual(failed("INPUT"));
    expect(await initial.remove(() => false)).toEqual(failed("CANCELLED"));
    await mkdir(f.lease, { mode: 0o700 });
    const occupied = join(f.lease, "keep");
    await writeFile(occupied, "busy", { mode: 0o600 });
    expect(await initial.remove()).toEqual(failed("BUSY"));
    expect(await readFile(occupied, "utf8")).toBe("busy");
    await rm(occupied);
    await rmdir(f.lease);

    const canonical = await readFile(completion, "utf8");
    const altered = canonical.replace(sha(await readFile(roster)), sha("wrong completion binding"));
    expect(altered).not.toBe(canonical);
    await writeFile(completion, altered);
    const mismatchedMarker = await f.fingerprint(completion);
    expect(await initial.remove()).toEqual(mismatch);
    expect(await f.fingerprint(completion)).toEqual(mismatchedMarker);
    expect(await readdir(pending)).toEqual([]);
    await writeFile(completion, canonical);
    initial.snapshots[2] = await f.fingerprint(completion);

    const extra = join(f.profile, "extra-fixture");
    await writeFile(extra, "extra", { mode: 0o600 });
    expect(await initial.remove()).toEqual(unavailable);
    expect(await readFile(extra, "utf8")).toBe("extra");
    await rm(extra);
    await mkdir(f.index, { mode: 0o700 });
    expect(await initial.remove()).toEqual(unavailable);
    expect(await readdir(f.index)).toEqual([]);
    await rmdir(f.index);
    const member = join(pending, "reappeared");
    await writeFile(member, "nonempty", { mode: 0o600 });
    expect(await initial.remove()).toEqual(mismatch);
    expect(await readFile(member, "utf8")).toBe("nonempty");
    await rm(member);

    const parked = join(f.scratch, "parked-pending");
    await rename(pending, parked);
    try {
      await symlink(parked, pending);
      expect(await initial.remove()).toEqual(unavailable);
      expect(await readlink(pending)).toBe(parked);
      await rm(pending);
      await mkdir(pending, { mode: 0o700 });
      const replacement = await f.fingerprint(pending);
      expect(await initial.remove()).toEqual(mismatch);
      expect(await f.fingerprint(pending)).toEqual(replacement);
      expect(await readdir(pending)).toEqual([]);
      await rmdir(pending);
    } finally {
      await rm(pending, { recursive: true, force: true });
      await rename(parked, pending);
    }
    expect(await Promise.all(markers.map(f.fingerprint))).toEqual(initial.snapshots);
    const handle = await open(pending, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    let beforeRemoval = 0;
    try {
      const before = await handle.stat({ bigint: true });
      expect(await initial.remove(() => {
        if (existsSync(pending)) beforeRemoval++;
        return true;
      })).toEqual({ ok: true, alreadyAbsent: false });
      const after = await handle.stat({ bigint: true });
      expect({ dev: after.dev, ino: after.ino, birth: after.birthtimeNs, uid: after.uid, mode: after.mode })
        .toEqual({ dev: before.dev, ino: before.ino, birth: before.birthtimeNs, uid: before.uid, mode: before.mode });
    } finally {
      await handle.close();
    }
    expect(beforeRemoval).toBeGreaterThan(1);
    await checkRemoved(initial);
    await runFixtureWithoutNative(f.scratch, "remove-empty-directory-reopen");
    await checkRemoved(initial);
    await rm(f.home, { recursive: true, force: true });

    const second = await seed();
    const directory = await f.fingerprint(pending);
    let checks = 0;
    expect(await second.remove(() => ++checks < beforeRemoval)).toEqual(failed("CANCELLED"));
    expect(checks).toBe(beforeRemoval);
    expect(await f.fingerprint(pending)).toEqual(directory);

    const parkedLease = join(f.profile, "parked-lease");
    const lateLease = join(f.lease, "late-lease");
    checks = 0;
    expect(await second.remove(() => {
      if (++checks === beforeRemoval) {
        renameSync(f.lease, parkedLease);
        mkdirSync(f.lease, { mode: 0o700 });
        writeFileSync(lateLease, "preserve", { mode: 0o600 });
      }
      return true;
    })).toEqual(unknown);
    expect(await readFile(lateLease, "utf8")).toBe("preserve");
    expect(await readdir(parkedLease)).toEqual([]);
    expect(await f.fingerprint(pending)).toEqual(directory);
    await rm(lateLease);
    await rmdir(f.lease);
    await rmdir(parkedLease);
    expect(await Promise.all(markers.map(f.fingerprint))).toEqual(second.snapshots);

    const uncertain = await refuseDirectorySync(f.profile, () => Promise.resolve(!existsSync(pending)), second.remove);
    expect(uncertain).toEqual(unknown);
    await checkRemoved(second);
    expect(await second.remove()).toEqual({ ok: true, alreadyAbsent: true });
    await checkRemoved(second);
  } finally {
    f.stopRecording();
    await rm(f.home, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(mode !== "remove-empty-directory-reopen")("fresh process confirms the fixed directory remains absent without a native addon", async () => {
  const f = await fixture();
  expect((await readdir(f.scratch)).sort()).toEqual(["home", "retry"]);
  expect(existsSync(join(f.scratch, "retry", "native", "save-primitives.node"))).toBe(false);
  const pending = join(f.profile, ".reclaim-pending");
  const markers = [f.catalog, join(f.profile, ".reclaim-purge.json"), join(f.profile, ".reclaim-complete.json")];
  const catalog: unknown = JSON.parse(await readFile(f.catalog, "utf8"));
  if (!record(catalog) || typeof catalog.inventoryDigest !== "string")
    throw Error("Directory removal fixture missing catalog");
  const target = { ...retirement, inventoryDigest: catalog.inventoryDigest };
  const before = await Promise.all(markers.map(f.fingerprint));
  f.startRecording();
  try {
    expect(await removeEmptyStagedIndexDirectory(target, current)).toEqual({ ok: true, alreadyAbsent: true });
    expect(await lstat(pending).catch((error: unknown) => error)).toMatchObject({ code: "ENOENT" });
    expect(await reopenAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
    expect(await searchAppIndexCache(input, current)).toEqual(failed("SCHEMA"));
    expect(await inspectAppIndexCacheFootprint(current)).toEqual(failed("UNAVAILABLE"));
    expect(await Promise.all(markers.map(f.fingerprint))).toEqual(before);
    expect(f.workers()).toBe(0);
    expect((await readdir(f.profile)).sort()).toEqual([".reclaim-complete.json", ".reclaim-purge.json", "catalog.json"]);
  } finally {
    f.stopRecording();
  }
});
