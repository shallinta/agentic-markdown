import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { searchAppIndexCache } from "./app-cache";
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
  const success = (applied: number) => ({
    ok: true as const, generation: 1, applied, hits: [{ id: first.id, from: 3, to: 9 }],
  });
  const fail = (error: "CANCELLED" | "UNAVAILABLE" | "SCHEMA" | "BUSY" | "UNKNOWN") =>
    ({ ok: false as const, error, accepted: error === "UNKNOWN" });
  const mode = async (path: string) => (await lstat(path)).mode & 0o777;
  const OriginalWorker = globalThis.Worker;

  async function refusesSymlink(path: string) {
    await rename(path, parked);
    await symlink(outside, path, "dir");
    try {
      expect(await run()).toEqual(fail("UNAVAILABLE"));
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
    expect(await run(() => { throw Error("Synthetic authorization failure"); })).toEqual(fail("UNAVAILABLE"));
    expect(await run()).toEqual(fail("UNAVAILABLE"));
    expect(await readdir(scratch)).toEqual([]);
    await mkdir(home, { mode: 0o700 });
    expect(await run(() => false)).toEqual(fail("CANCELLED"));
    expect(await readdir(home)).toEqual([]);

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
    expect(await searchAppIndexCache({ ...input, rows: [second, first] }, () => true)).toEqual(success(0));
    expect(await readFile(catalog)).toEqual(originalCatalog);
    const warm = await lstat(catalog, { bigint: true });
    expect({ ino: warm.ino, mtime: warm.mtimeNs }).toEqual({ ino: cold.ino, mtime: cold.mtimeNs });

    await mkdir(lease, { mode: 0o700 });
    const leaseMarker = join(lease, "owned-by-fixture");
    await writeFile(leaseMarker, "retain", { mode: 0o600 });
    expect(await run()).toEqual(fail("BUSY"));
    expect(await readFile(leaseMarker, "utf8")).toBe("retain");
    expect(await readFile(catalog)).toEqual(originalCatalog);
    await rm(lease, { recursive: true });

    for (const bad of ["{", JSON.stringify({ ...parsed, version: 2 })]) {
      await writeFile(catalog, bad);
      expect(await run()).toEqual(fail("SCHEMA"));
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
        expect(await mode(folder)).toBe(hostileMode);
        expect(await readFile(catalog)).toEqual(originalCatalog);
      } finally {
        await chmod(folder, 0o700);
      }
    }
    expect(await run()).toEqual(success(0));

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
