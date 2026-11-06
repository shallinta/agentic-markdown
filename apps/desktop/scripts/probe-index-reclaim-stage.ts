import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, readlink, realpath, rename, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";

import {
  inspectRetiredIndexReclaim, reopenAppIndexCache, retireAppIndexCache, searchAppIndexCache,
} from "../src/bun/index/app-cache";
import { record } from "../src/bun/index/protocol";
import { acquireIndexReuseSlot } from "../src/bun/index/reuse-catalog";

const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fixture = {
  scopeKey: sha("F-064au synthetic stage"),
  rows: [{ id: "probe-a", raw: "\uFEFF😀target\r\n" }, { id: "probe-b", raw: "# 合成记录\n" }],
  query: "target",
};
const retirement = { scopeKey: fixture.scopeKey, generation: 1 };
const current = () => true;
const failed = (error: string) => ({ ok: false, error });
const log = (receipt: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(receipt)}\n`);
type Stage = (...args: unknown[]) => unknown;

async function missing(path: string) {
  await assert.rejects(() => lstat(path), { code: "ENOENT" });
}

function identity(stat: BigIntStats) {
  return [stat.dev, stat.ino, stat.birthtimeNs].map(String);
}

function metadata(stat: BigIntStats) {
  return [
    ...identity(stat),
    ...[stat.uid, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].map(String),
  ];
}

async function fileReceipt(path: string) {
  const stat = await lstat(path, { bigint: true });
  assert(stat.isFile() && stat.nlink === 1n);
  return { metadata: metadata(stat), hash: sha(await readFile(path)) };
}

async function directoryReceipt(path: string) {
  const stat = await lstat(path, { bigint: true });
  assert(stat.isDirectory());
  const names = (await readdir(path)).sort();
  assert(names.length > 0 && names.length <= 128);
  const files = await Promise.all(names.map(async name => [name, await fileReceipt(join(path, name))]));
  return { stat, files };
}

type DirectoryReceipt = Awaited<ReturnType<typeof directoryReceipt>>;
function sameDirectory(left: DirectoryReceipt, right: DirectoryReceipt) {
  assert.deepEqual(metadata(left.stat), metadata(right.stat));
  assert.deepEqual(left.files, right.files);
}

const openDirectory = (path: string) => open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);

async function checkSourceGuards(stage: Stage, scratch: string) {
  const profile = await mkdtemp(join(scratch, "source-guard-"));
  const index = join(profile, "index");
  const parked = join(profile, "parked");
  const pending = join(profile, ".reclaim-pending");
  await mkdir(index, { mode: 0o700 });
  const token = join(index, "original");
  await writeFile(token, "source", { mode: 0o600 });
  const slot = await openDirectory(profile);
  try {
    const source = await openDirectory(index);
    try {
      for (const args of [[], [slot.fd], [-1, source.fd], [slot.fd, 1.5], [slot.fd, "1"]])
        assert.deepEqual(stage(...args), failed("INPUT"));
      assert.deepEqual(stage(slot.fd, slot.fd), failed("INPUT"));
      const regular = await open(token, constants.O_RDONLY | constants.O_NOFOLLOW);
      const closedFd = regular.fd;
      try {
        assert.deepEqual(stage(slot.fd, regular.fd), failed("PRECONDITION"));
      } finally {
        await regular.close();
      }
      assert.deepEqual(stage(slot.fd, closedFd), failed("PRECONDITION"));
      const original = await directoryReceipt(index);
      await rename(index, parked);
      await symlink("parked", index);
      assert.deepEqual(stage(slot.fd, source.fd), failed("PRECONDITION"));
      assert.equal(await readlink(index), "parked");
      assert.deepEqual((await directoryReceipt(parked)).files, original.files);
      await missing(pending);
      await rm(index);
      await mkdir(index, { mode: 0o700 });
      const unrelated = join(index, "unrelated");
      await writeFile(unrelated, "replacement", { mode: 0o600 });
      const replacement = await directoryReceipt(index);
      assert.deepEqual(stage(slot.fd, source.fd), failed("PRECONDITION"));
      sameDirectory(await directoryReceipt(index), replacement);
      assert.deepEqual(identity((await directoryReceipt(parked)).stat), identity(original.stat));
      assert.deepEqual((await directoryReceipt(parked)).files, original.files);
      await missing(pending);
    } finally {
      await source.close();
    }
  } finally {
    await slot.close();
  }
  await rm(profile, { recursive: true });
  log({ phase: "source-guards", result: "preserved" });
}

async function checkCollisions(stage: () => unknown, pending: string, index: string) {
  const before = await directoryReceipt(index);
  await writeFile(pending, "existing file", { mode: 0o600 });
  const file = await fileReceipt(pending);
  assert.deepEqual(stage(), failed("COLLISION"));
  assert.deepEqual(await fileReceipt(pending), file);
  await rm(pending);

  await mkdir(pending, { mode: 0o700 });
  const child = join(pending, "keep");
  await writeFile(child, "existing directory", { mode: 0o600 });
  const directory = await directoryReceipt(pending);
  assert.deepEqual(stage(), failed("COLLISION"));
  sameDirectory(await directoryReceipt(pending), directory);
  await rm(child);
  await rmdir(pending);

  await symlink("index", pending);
  const link = await lstat(pending, { bigint: true });
  assert.deepEqual(stage(), failed("COLLISION"));
  assert.equal(await readlink(pending), "index");
  assert.deepEqual(metadata(await lstat(pending, { bigint: true })), metadata(link));
  await rm(pending);
  sameDirectory(await directoryReceipt(index), before);
  log({ phase: "target-collisions", preserved: ["file", "directory", "symlink"] });
}

async function snapshotDigest(path: string) {
  const directory = await directoryReceipt(join(path, ".reclaim-pending"));
  return sha(JSON.stringify({
    catalog: await fileReceipt(join(path, "catalog.json")),
    directory: metadata(directory.stat),
    files: directory.files,
  }));
}

async function verifyRestart(profile: string, expected: string) {
  assert(/^[a-f0-9]{64}$/.test(expected));
  assert.equal(await snapshotDigest(profile), expected);
  await missing(join(profile, "index"));
  const NativeWorker = globalThis.Worker;
  let workers = 0;
  class RecordingWorker extends NativeWorker {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      workers++;
    }
  }
  Object.defineProperty(globalThis, "Worker", { value: RecordingWorker, configurable: true });
  try {
    const unavailable = { ...failed("SCHEMA"), accepted: false };
    assert.deepEqual(await reopenAppIndexCache(fixture, current), unavailable);
    assert.deepEqual(await searchAppIndexCache(fixture, current), unavailable);
  } finally {
    Object.defineProperty(globalThis, "Worker", { value: NativeWorker, configurable: true });
  }
  assert.equal(workers, 0);
  assert.equal(await snapshotDigest(profile), expected);
  assert.deepEqual((await readdir(profile)).sort(), [".reclaim-pending", "catalog.json"]);
  log({ phase: "fresh-process", result: "confirmed", workers, snapshot: expected });
}

async function main() {
  const [, , scratch, addonPath, verify, expected] = process.argv;
  assert(process.platform === "darwin" && process.arch === "arm64");
  assert(scratch && addonPath && dirname(scratch) === "/private/tmp" && basename(scratch).startsWith("f064au-"));
  assert.equal(await realpath(scratch), scratch);
  const owner = process.getuid?.();
  assert(owner !== undefined);
  const work = await lstat(scratch);
  assert(work.isDirectory() && work.uid === owner && (work.mode & 0o777) === 0o700);
  assert.equal(addonPath, join(scratch, "stage.node"));
  const addonStat = await lstat(addonPath);
  assert(addonStat.isFile() && addonStat.nlink === 1 && addonStat.uid === owner && (addonStat.mode & 0o022) === 0);
  assert.equal(await realpath(addonPath), addonPath);
  assert.equal(await realpath(import.meta.path), join(scratch, "bun", "probe.js"));
  const executable = await realpath(process.execPath);
  assert.equal(basename(executable), "bun");
  assert.equal(basename(dirname(executable)), "MacOS");
  const resources = join(dirname(dirname(executable)), "Resources");
  const version: unknown = JSON.parse(await readFile(join(resources, "version.json"), "utf8"));
  assert(record(version) && version.version === "0.1.0-alpha.231" && version.hash === "3oidbg6m1ait6");
  assert.equal(await realpath(join(scratch, "native")), await realpath(join(resources, "app", "native")));
  const home = join(scratch, "home");
  assert.equal(process.env.AGENTIC_MARKDOWN_HOME, home);
  assert.equal(process.env.TMPDIR, scratch);
  const profile = join(home, "search-index", "limited-v1");
  if (verify !== undefined) {
    assert(verify === "verify-restart" && expected && process.argv.length === 6);
    assert.equal(await realpath(profile), profile);
    await verifyRestart(profile, expected);
    return;
  }
  assert.equal(process.argv.length, 4);
  await missing(home);
  const addon: unknown = createRequire(import.meta.url)(addonPath);
  assert(record(addon) && typeof addon.stageRetiredIndex === "function");
  const stage = addon.stageRetiredIndex as Stage;
  await checkSourceGuards(stage, scratch);

  await mkdir(home, { mode: 0o700 });
  const indexed = await searchAppIndexCache(fixture, current);
  assert.deepEqual(indexed, {
    ok: true, generation: 1, applied: 2, hits: [{ id: "probe-a", from: 3, to: 9 }],
  });
  assert.deepEqual(await retireAppIndexCache(retirement, current, true), { ok: true, alreadyRetired: false });
  const preflight = await inspectRetiredIndexReclaim(retirement, current);
  assert(preflight.ok, JSON.stringify(preflight));
  log({ phase: "formal-fixture", bundleHash: version.hash, bun: Bun.version, ...preflight });

  const index = join(profile, "index");
  const pending = join(profile, ".reclaim-pending");
  const before = await directoryReceipt(index);
  const catalog = await fileReceipt(join(profile, "catalog.json"));
  const slot = await openDirectory(profile);
  try {
    const source = await openDirectory(index);
    try {
      await checkCollisions(() => stage(slot.fd, source.fd), pending, index);
      assert.deepEqual(await inspectRetiredIndexReclaim(retirement, current), preflight);
      const lease = await acquireIndexReuseSlot(profile);
      assert(lease.ok);
      const leasePath = join(profile, ".lease");
      try {
        const originalLease = await lstat(leasePath, { bigint: true });
        const sealed = await lease.slot.readCatalog();
        assert(sealed.status === "retired" && sealed.catalog.version === 2);
        assert.equal(sealed.catalog.inventoryDigest, preflight.inventoryDigest);
        assert.deepEqual(stage(slot.fd, source.fd), { ok: true });
        await missing(index);
        const after = await directoryReceipt(pending);
        assert.deepEqual(identity(after.stat), identity(before.stat));
        assert.deepEqual(metadata(await source.stat({ bigint: true })), metadata(after.stat));
        assert.deepEqual(after.files, before.files);
        assert.deepEqual(await fileReceipt(join(profile, "catalog.json")), catalog);
        assert.deepEqual(metadata(await lstat(leasePath, { bigint: true })), metadata(originalLease));
        assert.deepEqual(stage(slot.fd, source.fd), failed("PRECONDITION"));
        log({
          phase: "stage", result: "moved", nativeFiles: after.files.length,
          files: sha(JSON.stringify(after.files)), identity: sha(JSON.stringify(identity(after.stat))),
          beforeDirectory: metadata(before.stat), afterDirectory: metadata(after.stat),
          catalog: catalog.hash,
        });
      } finally {
        await lease.slot.release();
      }
    } finally {
      await source.close();
    }
  } finally {
    await slot.close();
  }

  const snapshot = await snapshotDigest(profile);
  const child = Bun.spawn([process.execPath, import.meta.path, scratch, addonPath, "verify-restart", snapshot], {
    stdout: "pipe", stderr: "pipe", timeout: 10_000,
  });
  const [exit, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  assert.equal(exit, 0);
  assert.equal(await snapshotDigest(profile), snapshot);
  log({ phase: "complete", result: "confirmed", snapshot });
}

await main();
