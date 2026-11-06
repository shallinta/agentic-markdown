import { lstatSync, realpathSync, type BigIntStats } from "node:fs";
import { mkdir, opendir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { getAppHomePath } from "@agentic-markdown/shared/server";

import { record } from "./protocol";
import { searchWithIndexReuse, type IndexReuseInput } from "./reuse";

type BoundaryError = "CANCELLED" | "UNAVAILABLE";

const fail = (error: BoundaryError | "BUSY") => ({ ok: false as const, error, accepted: false });
const maxIndexFiles = 128;
const absent = { ok: true as const, present: false, files: 0, catalogBytes: 0, indexBytes: 0, totalBytes: 0 };

function appCacheBoundary(current: () => boolean) {
  let stopped: BoundaryError | undefined;
  const boundaryFailure = () => fail(stopped ?? "UNAVAILABLE");
  const callerCurrent = () => {
    if (stopped) return false;
    try {
      if (current()) return true;
      stopped = "CANCELLED";
    } catch {
      stopped = "UNAVAILABLE";
    }
    return false;
  };
  if (!callerCurrent()) return boundaryFailure();
  const uid = process.getuid?.();
  const home = getAppHomePath();
  if (uid === undefined || !isAbsolute(home) || resolve(home) !== home)
    return fail("UNAVAILABLE");

  const owner = BigInt(uid);
  const pins: { path: string; stat: BigIntStats }[] = [];
  const pin = (path: string, privateMode: boolean, stat = lstatSync(path, { bigint: true })) => {
    if (!stat.isDirectory() || stat.uid !== owner ||
        (privateMode ? (stat.mode & 0o7777n) !== 0o700n : (stat.mode & 0o022n) !== 0n))
      throw Error("Index cache directory unavailable");
    pins.push({ path, stat });
    return stat;
  };
  const cacheCurrent = () => {
    if (!callerCurrent()) return false;
    try {
      if (realpathSync(home) !== home) throw Error("Index cache home unavailable");
      for (const { path, stat } of pins) {
        const latest = lstatSync(path, { bigint: true });
        if (latest.dev !== stat.dev || latest.ino !== stat.ino ||
            latest.uid !== stat.uid || latest.mode !== stat.mode)
          throw Error("Index cache directory changed");
      }
      return true;
    } catch {
      stopped = "UNAVAILABLE";
      return false;
    }
  };

  try {
    pin(home, false);
    return { ok: true as const, home, owner, pin, cacheCurrent, callerCurrent, boundaryFailure };
  } catch {
    callerCurrent();
    return boundaryFailure();
  }
}

/** The supplied rows must come from a fresh authorized snapshot. */
export async function searchAppIndexCache(input: IndexReuseInput, current: () => boolean) {
  const boundary = appCacheBoundary(current);
  if (!boundary.ok) return boundary;
  const { home, pin, cacheCurrent, callerCurrent, boundaryFailure } = boundary;
  try {
    let directory = home;
    for (const name of ["search-index", "limited-v1"]) {
      if (!cacheCurrent()) return boundaryFailure();
      directory = join(directory, name);
      try {
        await mkdir(directory, { mode: 0o700 });
      } catch (error) {
        if (!record(error) || error.code !== "EEXIST") throw error;
      }
      if (!cacheCurrent()) return boundaryFailure();
      pin(directory, true);
    }
    if (!cacheCurrent()) return boundaryFailure();
    const result = await searchWithIndexReuse(directory, input, cacheCurrent);
    if (!result.ok && (result.error === "UNKNOWN" || result.error === "SCHEMA" || result.error === "BUSY"))
      return result;
    return cacheCurrent() ? result : boundaryFailure();
  } catch {
    callerCurrent();
    return boundaryFailure();
  }
}

function present(path: string): BigIntStats | undefined {
  try {
    return lstatSync(path, { bigint: true });
  } catch (error) {
    if (!record(error) || error.code !== "ENOENT") throw error;
  }
}

function sameMetadata(before: BigIntStats, after: BigIntStats) {
  return before.dev === after.dev && before.ino === after.ino &&
    before.uid === after.uid && before.mode === after.mode && before.nlink === after.nlink &&
    before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}

async function readMembers(
  path: string, max: number, check: () => void, observe?: (name: string) => void
) {
  check();
  const dir = await opendir(path, { bufferSize: 16 });
  const names = new Set<string>();
  try {
    check();
    while (true) {
      const entry = await dir.read();
      check();
      if (!entry) return names;
      const { name } = entry;
      if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0") ||
          names.size >= max || names.has(name))
        throw Error("Index cache inventory unavailable");
      names.add(name);
      observe?.(name);
    }
  } finally {
    await dir.close();
  }
}

class CacheBusy extends Error {}

/** Read metadata from only the fixed cache profile and its immediate index files. */
export async function inspectAppIndexCacheFootprint(current: () => boolean) {
  const boundary = appCacheBoundary(current);
  if (!boundary.ok) return boundary;
  const { home, owner, pin, cacheCurrent, callerCurrent, boundaryFailure } = boundary;
  const check = () => {
    if (!cacheCurrent()) throw Error("Index cache inspection invalidated");
  };
  const absentAt = (path: string) => {
    check();
    if (present(path)) throw Error("Index cache path appeared");
    return { ...absent };
  };
  const cache = join(home, "search-index");
  const profile = join(cache, "limited-v1");
  const lease = join(profile, ".lease");
  const checkLease = () => {
    if (present(lease)) throw new CacheBusy();
  };
  const checkInspection = () => {
    check();
    checkLease();
  };
  const inventory: { path: string; stat: BigIntStats }[] = [];
  const readFileMetadata = (path: string, privateMode = false) => {
    const stat = lstatSync(path, { bigint: true });
    if (!stat.isFile() || stat.uid !== owner || stat.nlink !== 1n || stat.size < 0n ||
        (privateMode && (stat.mode & 0o077n) !== 0n))
      throw Error("Index cache file unavailable");
    inventory.push({ path, stat });
    return stat.size;
  };
  const recheckInventory = () => {
    checkInspection();
    for (const { path, stat } of inventory)
      if (!sameMetadata(stat, lstatSync(path, { bigint: true })))
        throw Error("Index cache inventory changed");
    checkLease();
  };

  try {
    check();
    const cacheStat = present(cache);
    if (!cacheStat) return absentAt(cache);
    pin(cache, true, cacheStat);
    const profileStat = present(profile);
    if (!profileStat) return absentAt(profile);
    pin(profile, true, profileStat);
    inventory.push({ path: profile, stat: profileStat });
    const members = await readMembers(profile, 2, checkInspection);
    checkInspection();
    if (!members.size) {
      recheckInventory();
      return { ...absent };
    }
    if (members.size !== 2 || !members.has("catalog.json") || !members.has("index"))
      return fail("UNAVAILABLE");

    const catalogBytes = readFileMetadata(join(profile, "catalog.json"), true);
    if (catalogBytes === 0n) return fail("UNAVAILABLE");
    const index = join(profile, "index");
    inventory.push({ path: index, stat: pin(index, false) });
    let indexBytes = 0n;
    const names = await readMembers(index, maxIndexFiles, checkInspection, (name) => {
      indexBytes += readFileMetadata(join(index, name));
    });
    const totalBytes = catalogBytes + indexBytes;
    if (totalBytes > BigInt(Number.MAX_SAFE_INTEGER)) return fail("UNAVAILABLE");
    recheckInventory();
    return {
      ok: true as const, present: true, files: names.size + 1,
      catalogBytes: Number(catalogBytes), indexBytes: Number(indexBytes), totalBytes: Number(totalBytes),
    };
  } catch (error) {
    if (error instanceof CacheBusy) return fail("BUSY");
    callerCurrent();
    return boundaryFailure();
  }
}
