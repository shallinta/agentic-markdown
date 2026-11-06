import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, utimesSync, writeFileSync } from "node:fs";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { inspectAppIndexCacheFootprint, searchAppIndexCache } from "./app-cache";
import { record } from "./protocol";

const isolated = process.env.AGENTIC_MARKDOWN_APP_INDEX_CACHE_TEST === "1";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test.skipIf(isolated)("private app index cache exits with a clean fixture", async () => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "f064ac-app-cache-")));
  try {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: {
        ...process.env,
        TMPDIR: temporary,
        AGENTIC_MARKDOWN_HOME: join(temporary, "home"),
        AGENTIC_MARKDOWN_APP_INDEX_CACHE_TEST: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exit, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (exit !== 0) throw Error(stdout + stderr);
    expect(stderr).toContain("1 pass");
    expect(await readdir(temporary)).toEqual([]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}, 15_000);

test.skipIf(!isolated)("opens only the fixed private cache, reuses its native index and refuses unsafe storage", async () => {
  const scratch = await realpath(tmpdir());
  const home = join(scratch, "home");
  const owner = process.getuid?.();
  if (!basename(scratch).startsWith("f064ac-app-cache-") ||
      process.env.AGENTIC_MARKDOWN_HOME !== home || owner === undefined || (await readdir(scratch)).length)
    throw Error("Missing isolated app-cache fixture");
  const cache = join(home, "search-index");
  const profile = join(cache, "limited-v1");
  const catalog = join(profile, "catalog.json");
  const index = join(profile, "index");
  const lease = join(profile, ".lease");
  const outside = join(scratch, "outside");
  const outsideMarker = join(outside, "keep");
  const parked = join(scratch, "parked");
  const first = { id: "fixture-a", raw: "\uFEFF😀target\r\n" };
  const second = { id: "fixture-b", raw: "无匹配" };
  const input = { scopeKey: sha("synthetic-app-cache-scope"), rows: [first, second], query: "target" };
  const run = (current = () => true) => searchAppIndexCache(input, current);
  const inspect = (current = () => true) => inspectAppIndexCacheFootprint(current);
  const success = (applied: number) => ({
    ok: true as const, generation: 1, applied, hits: [{ id: first.id, from: 3, to: 9 }],
  });
  const fail = <E extends "CANCELLED" | "UNAVAILABLE" | "SCHEMA" | "BUSY" | "UNKNOWN">(error: E) =>
    ({ ok: false as const, error, accepted: error === "UNKNOWN" });
  const mode = async (path: string) => (await lstat(path)).mode & 0o777;
  const OriginalWorker = globalThis.Worker;
  const absent = { ok: true as const, present: false, files: 0, catalogBytes: 0, indexBytes: 0, totalBytes: 0 };

  async function inspectUnchanged() {
    const paths = [catalog, ...(await readdir(index)).sort().map((name) => join(index, name))];
    const snapshot = () => Promise.all(paths.map(async (path) => {
      const stat = await lstat(path, { bigint: true });
      const bytes = await readFile(path);
      return {
        dev: stat.dev, ino: stat.ino, size: stat.size, mode: stat.mode,
        mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs,
        hash: createHash("sha256").update(bytes).digest("hex"),
      };
    }));
    const before = await snapshot();
    const catalogBytes = Number(before[0].size);
    const indexBytes = before.slice(1).reduce((sum, { size }) => sum + Number(size), 0);
    expect(await inspect()).toEqual({
      ok: true, present: true, files: paths.length, catalogBytes, indexBytes,
      totalBytes: catalogBytes + indexBytes,
    });
    expect(await snapshot()).toEqual(before);
    expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);
    expect([catalog, ...(await readdir(index)).sort().map((name) => join(index, name))]).toEqual(paths);
  }

  async function refusesSymlink(path: string) {
    await rename(path, parked);
    await symlink(outside, path, "dir");
    try {
      expect(await run()).toEqual(fail("UNAVAILABLE"));
      expect(await inspect()).toEqual(fail("UNAVAILABLE"));
      expect(await readlink(path)).toBe(outside);
      expect(await readFile(outsideMarker, "utf8")).toBe("unrelated");
      expect(await readdir(outside)).toEqual(["keep"]);
    } finally {
      await rm(path);
      await rename(parked, path);
    }
  }

  try {
    expect(await run(() => false)).toEqual(fail("CANCELLED"));
    expect(await inspect(() => false)).toEqual(fail("CANCELLED"));
    expect(await inspect(() => { throw Error("Synthetic footprint authorization failure"); })).toEqual(fail("UNAVAILABLE"));
    expect(await run(() => { throw Error("Synthetic authorization failure"); })).toEqual(fail("UNAVAILABLE"));
    expect(await run()).toEqual(fail("UNAVAILABLE"));
    expect(await inspect()).toEqual(fail("UNAVAILABLE"));
    expect(await readdir(scratch)).toEqual([]);
    await mkdir(home, { mode: 0o700 });
    expect(await run(() => false)).toEqual(fail("CANCELLED"));
    expect(await readdir(home)).toEqual([]);
    expect(await inspect()).toEqual(absent);
    expect(await readdir(home)).toEqual([]);
    await mkdir(cache, { mode: 0o700 });
    expect(await inspect()).toEqual(absent);
    expect(await readdir(cache)).toEqual([]);
    await mkdir(profile, { mode: 0o700 });
    expect(await inspect()).toEqual(absent);
    expect(await readdir(profile)).toEqual([]);
    await rmdir(profile);
    await rmdir(cache);

    expect(await run()).toEqual(success(2));
    expect(await readdir(home)).toEqual(["search-index"]);
    expect(await readdir(cache)).toEqual(["limited-v1"]);
    expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);
    for (const folder of [cache, profile]) {
      expect(await mode(folder)).toBe(0o700);
      expect((await lstat(folder)).uid).toBe(owner);
    }
    const native = await lstat(index);
    expect(native.isDirectory()).toBe(true);
    expect(native.uid).toBe(owner);
    expect(await mode(catalog)).toBe(0o600);
    const originalCatalog = await readFile(catalog);
    const cold = await lstat(catalog, { bigint: true });
    const parsed: unknown = JSON.parse(originalCatalog.toString("utf8"));
    if (!record(parsed)) throw Error("Missing index catalog");
    expect(parsed).toEqual({
      version: 1, profile: "limited-v1", scopeKey: input.scopeKey, generation: 1,
      entries: [{ id: first.id, hash: sha(first.raw) }, { id: second.id, hash: sha(second.raw) }],
    });
    await inspectUnchanged();
    expect(await searchAppIndexCache({ ...input, rows: [second, first] }, () => true)).toEqual(success(0));
    expect(await readFile(catalog)).toEqual(originalCatalog);
    const warm = await lstat(catalog, { bigint: true });
    expect({ ino: warm.ino, mtime: warm.mtimeNs }).toEqual({ ino: cold.ino, mtime: cold.mtimeNs });
    await inspectUnchanged();

    await mkdir(lease, { mode: 0o700 });
    const leaseMarker = join(lease, "owned-by-fixture");
    await writeFile(leaseMarker, "retain", { mode: 0o600 });
    expect(await run()).toEqual(fail("BUSY"));
    expect(await inspect()).toEqual(fail("BUSY"));
    expect(await readFile(leaseMarker, "utf8")).toBe("retain");
    expect(await readFile(catalog)).toEqual(originalCatalog);
    await rm(lease, { recursive: true });

    await rename(catalog, parked);
    try {
      expect(await inspect()).toEqual(fail("UNAVAILABLE"));
      expect(await readdir(profile)).toEqual(["index"]);
    } finally {
      await rename(parked, catalog);
    }
    await rename(index, parked);
    try {
      expect(await inspect()).toEqual(fail("UNAVAILABLE"));
      expect(await readdir(profile)).toEqual(["catalog.json"]);
      await mkdir(index, { mode: 0o700 });
      await writeFile(catalog, "");
      expect(await inspect()).toEqual(fail("UNAVAILABLE"));
      expect(await readFile(catalog, "utf8")).toBe("");
      expect(await readdir(index)).toEqual([]);
    } finally {
      await writeFile(catalog, originalCatalog);
      await rm(index, { recursive: true, force: true });
      await rename(parked, index);
    }
    const unknown = join(profile, "unexpected-layout");
    await writeFile(unknown, "leave this alone", { mode: 0o600 });
    try {
      expect(await inspect()).toEqual(fail("UNAVAILABLE"));
      expect(await readFile(unknown, "utf8")).toBe("leave this alone");
    } finally {
      await rm(unknown);
    }

    for (const bad of ["{", JSON.stringify({ ...parsed, version: 2 })]) {
      await writeFile(catalog, bad);
      expect(await run()).toEqual(fail("SCHEMA"));
      // A footprint measures metadata; it does not parse the catalog.
      expect(await inspect()).toMatchObject({ ok: true, present: true, catalogBytes: Buffer.byteLength(bad) });
      expect(await readFile(catalog, "utf8")).toBe(bad);
      expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);
    }
    await writeFile(catalog, originalCatalog);
    expect(await searchAppIndexCache({ ...input, scopeKey: sha("foreign-scope") }, () => true)).toEqual(fail("SCHEMA"));
    expect(await readFile(catalog)).toEqual(originalCatalog);

    await mkdir(outside, { mode: 0o700 });
    await writeFile(outsideMarker, "unrelated", { mode: 0o600 });
    for (const folder of [home, cache, profile]) await refusesSymlink(folder);
    for (const [folder, hostileMode] of [[home, 0o770], [cache, 0o750], [profile, 0o750]] as const) {
      await chmod(folder, hostileMode);
      try {
        expect(await run()).toEqual(fail("UNAVAILABLE"));
        expect(await inspect()).toEqual(fail("UNAVAILABLE"));
        expect(await mode(folder)).toBe(hostileMode);
        expect(await readFile(catalog)).toEqual(originalCatalog);
      } finally {
        await chmod(folder, 0o700);
      }
    }
    expect(await run()).toEqual(success(0));

    const extra = join(index, "fixture-extra");
    await mkdir(extra);
    try {
      expect(await inspect()).toEqual(fail("UNAVAILABLE"));
      expect(await readdir(extra)).toEqual([]);
    } finally {
      await rmdir(extra);
    }
    await symlink(outsideMarker, extra);
    try {
      expect(await inspect()).toEqual(fail("UNAVAILABLE"));
      expect(await readlink(extra)).toBe(outsideMarker);
    } finally {
      await rm(extra);
    }
    await link(outsideMarker, extra);
    try {
      expect(await inspect()).toEqual(fail("UNAVAILABLE"));
      expect((await lstat(outsideMarker)).nlink).toBe(2);
      expect(await readFile(outsideMarker, "utf8")).toBe("unrelated");
    } finally {
      await rm(extra);
    }
    const catalogLink = join(outside, "linked-catalog");
    await link(catalog, catalogLink);
    try {
      expect(await inspect()).toEqual(fail("UNAVAILABLE"));
      expect(await readFile(catalogLink)).toEqual(originalCatalog);
    } finally {
      await rm(catalogLink);
    }

    const nativeNames = await readdir(index);
    const boundaryFiles = Array.from({ length: 128 - nativeNames.length }, (_, n) => join(index, `fixture-boundary-${n}`));
    await Promise.all(boundaryFiles.map((path) => writeFile(path, "x", { mode: 0o600 })));
    try {
      expect(await inspect()).toMatchObject({ ok: true, present: true, files: 129 });
      await inspectUnchanged();
      await writeFile(extra, "overflow", { mode: 0o600 });
      expect(await inspect()).toEqual(fail("UNAVAILABLE"));
      expect(await readFile(extra, "utf8")).toBe("overflow");
    } finally {
      await Promise.all([...boundaryFiles, extra].map((path) => rm(path, { force: true })));
    }
    await inspectUnchanged();

    let finalCheck = 0;
    expect(await inspect(() => { finalCheck++; return true; })).toMatchObject({ ok: true, present: true });
    expect(finalCheck).toBeGreaterThan(1);
    let checked = 0;
    expect(await inspect(() => ++checked < finalCheck)).toEqual(fail("CANCELLED"));
    const beforeMutation = await lstat(catalog);
    checked = 0;
    expect(await inspect(() => {
      if (++checked === finalCheck) utimesSync(catalog, beforeMutation.atime, new Date(beforeMutation.mtimeMs + 10_000));
      return true;
    })).toEqual(fail("UNAVAILABLE"));
    expect((await lstat(catalog)).mtimeMs).toBeGreaterThan(beforeMutation.mtimeMs);
    expect(await readFile(catalog)).toEqual(originalCatalog);

    checked = 0;
    expect(await inspect(() => {
      if (++checked === finalCheck) mkdirSync(lease, { mode: 0o700 });
      return true;
    })).toEqual(fail("BUSY"));
    expect(await readdir(lease)).toEqual([]);
    await rmdir(lease);

    const footprintMarker = join(profile, "footprint-replacement");
    checked = 0;
    let movedProfile = false;
    try {
      expect(await inspect(() => {
        if (++checked === finalCheck) {
          renameSync(profile, parked);
          movedProfile = true;
          mkdirSync(profile, { mode: 0o700 });
          writeFileSync(footprintMarker, "keep replacement", { mode: 0o600 });
        }
        return true;
      })).toEqual(fail("UNAVAILABLE"));
      expect(await readdir(profile)).toEqual(["footprint-replacement"]);
      expect(await readFile(footprintMarker, "utf8")).toBe("keep replacement");
      expect(await readFile(join(parked, "catalog.json"))).toEqual(originalCatalog);
    } finally {
      if (movedProfile) {
        await rm(profile, { recursive: true, force: true });
        await rename(parked, profile);
      }
    }
    await inspectUnchanged();

    let held: ((resume: () => void) => void) | undefined;
    class PausingWorker extends OriginalWorker {
      override postMessage(message: unknown) {
        if (!held || !record(message) || message.op !== "query") {
          super.postMessage(message);
          return;
        }
        const pause = held;
        held = undefined;
        pause(() => super.postMessage(message));
      }
    }
    async function pauseQuery(current?: () => boolean) {
      const entered = Promise.withResolvers<() => void>();
      held = entered.resolve;
      const pending = run(current);
      const resume = await Promise.race([
        entered.promise, pending.then((result) => { throw Error("Expected native query: " + JSON.stringify(result)); }),
      ]);
      return { pending, resume };
    }
    Object.defineProperty(globalThis, "Worker", { value: PausingWorker, configurable: true });
    let authorized = true;
    const cancelled = await pauseQuery(() => authorized);
    try {
      expect(await readdir(profile)).toContain(".lease");
      authorized = false;
    } finally {
      cancelled.resume();
    }
    expect(await cancelled.pending).toEqual(fail("CANCELLED"));
    expect(await readFile(catalog)).toEqual(originalCatalog);
    expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);

    const replaced = await pauseQuery();
    const replacementMarker = join(profile, "replacement-marker");
    try {
      await rename(profile, parked);
      await mkdir(profile, { mode: 0o700 });
      await writeFile(replacementMarker, "keep replacement", { mode: 0o600 });
    } finally {
      replaced.resume();
    }
    // The old lease cannot be safely released through a replaced path.
    expect(await replaced.pending).toEqual(fail("UNKNOWN"));
    expect(await readdir(profile)).toEqual(["replacement-marker"]);
    expect(await readFile(replacementMarker, "utf8")).toBe("keep replacement");
    expect(await readFile(join(parked, "catalog.json"))).toEqual(originalCatalog);
    expect((await lstat(join(parked, ".lease"))).isDirectory()).toBe(true);
  } finally {
    Object.defineProperty(globalThis, "Worker", { value: OriginalWorker, configurable: true });
    await Promise.all([home, outside, parked].map((path) => rm(path, { recursive: true, force: true })));
  }
}, 15_000);
