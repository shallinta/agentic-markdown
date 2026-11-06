import { lstatSync, realpathSync, type BigIntStats } from "node:fs";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { getAppHomePath } from "@agentic-markdown/shared/server";

import { captureIndexFootprint } from "./cache-footprint";
import { natural, record } from "./protocol";
import { reopenWithIndexReuse, retireIndexReuse, searchWithIndexReuse, type IndexReuseInput } from "./reuse";
import { readIndexRetirementTarget, type IndexRetirementTarget } from "./reuse-catalog";

type BoundaryError = "CANCELLED" | "UNAVAILABLE";

const fail = <Error extends BoundaryError | "BUSY" | "MISSING" | "INPUT">(error: Error) =>
  ({ ok: false as const, error, accepted: false });
const cacheName = "search-index";
const profileName = "limited-v1";
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
export function searchAppIndexCache(input: IndexReuseInput, current: () => boolean) {
  return queryAppIndexCache(input, current, false);
}

export function reopenAppIndexCache(input: IndexReuseInput, current: () => boolean, maxLogicalBytes?: number) {
  if (maxLogicalBytes !== undefined && !natural(maxLogicalBytes))
    return Promise.resolve(fail("INPUT"));
  return queryAppIndexCache(input, current, true, maxLogicalBytes);
}

type CacheBoundary = Extract<ReturnType<typeof appCacheBoundary>, { ok: true }>;
function existingProfile({ home, pin, cacheCurrent, boundaryFailure }: CacheBoundary) {
  let directory = home;
  for (const name of [cacheName, profileName]) {
    if (!cacheCurrent()) return boundaryFailure();
    directory = join(directory, name);
    const stat = present(directory);
    if (!stat) {
      if (!cacheCurrent()) return boundaryFailure();
      return fail(present(directory) ? "UNAVAILABLE" : "MISSING");
    }
    pin(directory, true, stat);
  }
  return { ok: true as const, directory };
}

export async function retireAppIndexCache(input: IndexRetirementTarget, current: () => boolean) {
  const target = readIndexRetirementTarget(input);
  if (!target) return fail("INPUT");
  const boundary = appCacheBoundary(current);
  if (!boundary.ok) return boundary;
  const { cacheCurrent, callerCurrent, boundaryFailure } = boundary;
  try {
    const profile = existingProfile(boundary);
    if (!profile.ok) return profile;
    const result = await retireIndexReuse(profile.directory, target, cacheCurrent);
    return !result.ok && result.error === "CANCELLED" ? boundaryFailure() : result;
  } catch {
    callerCurrent();
    return boundaryFailure();
  }
}

function queryAppIndexCache(input: IndexReuseInput, current: () => boolean, exact: false): ReturnType<typeof searchWithIndexReuse>;
function queryAppIndexCache(input: IndexReuseInput, current: () => boolean, exact: true, maxLogicalBytes?: number): ReturnType<typeof reopenWithIndexReuse>;
async function queryAppIndexCache(input: IndexReuseInput, current: () => boolean, exact: boolean, maxLogicalBytes?: number) {
  const boundary = appCacheBoundary(current);
  if (!boundary.ok) return boundary;
  const { home, pin, cacheCurrent, callerCurrent, boundaryFailure } = boundary;
  try {
    let directory = home;
    if (exact) {
      const profile = existingProfile(boundary);
      if (!profile.ok) return profile;
      directory = profile.directory;
    } else {
      for (const name of [cacheName, profileName]) {
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
    }
    if (!cacheCurrent()) return boundaryFailure();
    const result = exact
      ? await reopenWithIndexReuse(directory, input, cacheCurrent, maxLogicalBytes)
      : await searchWithIndexReuse(directory, input, cacheCurrent);
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
  const cache = join(home, cacheName);
  const profile = join(cache, profileName);
  const lease = join(profile, ".lease");
  const checkLease = () => {
    if (present(lease)) throw new CacheBusy();
  };
  try {
    check();
    const cacheStat = present(cache);
    if (!cacheStat) return absentAt(cache);
    pin(cache, true, cacheStat);
    const profileStat = present(profile);
    if (!profileStat) return absentAt(profile);
    pin(profile, true, profileStat);
    const footprint = await captureIndexFootprint(profile, profileStat, owner, check, checkLease);
    footprint.recheck();
    if (footprint.status === "empty") return { ...absent };
    const { files, catalogBytes, indexBytes, totalBytes } = footprint;
    if (totalBytes > BigInt(Number.MAX_SAFE_INTEGER)) return fail("UNAVAILABLE");
    return {
      ok: true as const, present: true, files,
      catalogBytes: Number(catalogBytes), indexBytes: Number(indexBytes), totalBytes: Number(totalBytes),
    };
  } catch (error) {
    if (error instanceof CacheBusy) return fail("BUSY");
    callerCurrent();
    return boundaryFailure();
  }
}
