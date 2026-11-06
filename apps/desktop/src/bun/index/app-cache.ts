import { lstatSync, realpathSync, type BigIntStats } from "node:fs";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { getAppHomePath } from "@agentic-markdown/shared/server";

import { captureIndexFootprint } from "./cache-footprint";
import { natural, record } from "./protocol";
import { verifyPurgeSubset } from "./purge-proof";
import { encodePurgeRoster, INDEX_PURGE_ROSTER_NAME } from "./purge-roster";
import { readPinnedPurgeRoster, readPreparedReclaimCatalog, validReclaimLayout } from "./reclaim-layout";
import {
  inspectRetiredIndexReuse, prepareRetiredIndexReuse, reopenWithIndexReuse, retireIndexReuse, searchWithIndexReuse,
  prepareEmptyStagedIndexReuseCompletion, prepareStagedIndexReusePurge, removeStagedIndexReuseMember,
  removeEmptyStagedIndexReuseDirectory, stageRetiredIndexReuse, type IndexReuseInput,
} from "./reuse";
import {
  IndexReuseCleanupError, reclaimDirectoryName, readIndexPurgeMemberTarget, readIndexReclaimIntentTarget,
  readIndexRetirementTarget, type IndexPurgeMemberTarget, type IndexReclaimIntentTarget, type IndexRetirementTarget,
} from "./reuse-catalog";

type BoundaryError = "CANCELLED" | "UNAVAILABLE";

const fail = <Error extends BoundaryError | "BUSY" | "MISSING" | "INPUT" | "SCHEMA" | "MISMATCH">(error: Error) =>
  ({ ok: false as const, error, accepted: false });
const cacheName = "search-index";
const profileName = "limited-v1";
const absent = { ok: true as const, present: false as const, files: 0, catalogBytes: 0, indexBytes: 0, totalBytes: 0 };

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

export async function retireAppIndexCache(input: IndexRetirementTarget, current: () => boolean, seal?: true) {
  if (seal !== undefined && seal !== true) return fail("INPUT");
  return useRetiredAppProfile(
    readIndexRetirementTarget(input), current, (directory, target, check) => retireIndexReuse(directory, target, check, seal)
  );
}

export function inspectRetiredIndexReclaim(input: IndexRetirementTarget, current: () => boolean) {
  return useRetiredAppProfile(readIndexRetirementTarget(input), current, inspectRetiredIndexReuse);
}

export function prepareRetiredIndexReclaim(input: IndexReclaimIntentTarget, current: () => boolean) {
  return useRetiredAppProfile(readIndexReclaimIntentTarget(input), current, prepareRetiredIndexReuse);
}

export function stageRetiredIndexReclaim(input: IndexReclaimIntentTarget, current: () => boolean) {
  return useRetiredAppProfile(readIndexReclaimIntentTarget(input), current, stageRetiredIndexReuse);
}

export function prepareStagedIndexPurge(input: IndexReclaimIntentTarget, current: () => boolean) {
  return useRetiredAppProfile(readIndexReclaimIntentTarget(input), current, prepareStagedIndexReusePurge);
}

export function removeStagedIndexPurgeMember(input: IndexPurgeMemberTarget, current: () => boolean) {
  return useRetiredAppProfile(readIndexPurgeMemberTarget(input), current, removeStagedIndexReuseMember);
}

export function prepareEmptyStagedIndexCompletion(input: IndexReclaimIntentTarget, current: () => boolean) {
  return useRetiredAppProfile(readIndexReclaimIntentTarget(input), current, prepareEmptyStagedIndexReuseCompletion);
}

export function removeEmptyStagedIndexDirectory(input: IndexReclaimIntentTarget, current: () => boolean) {
  return useRetiredAppProfile(readIndexReclaimIntentTarget(input), current, removeEmptyStagedIndexReuseDirectory);
}

async function useRetiredAppProfile<
  Target extends IndexRetirementTarget, Result extends { ok: true } | { ok: false; error: string }
>(
  target: Target | undefined, current: () => boolean,
  use: (directory: string, target: Target, current: () => boolean) => Promise<Result>
) {
  if (!target) return fail("INPUT");
  const boundary = appCacheBoundary(current);
  if (!boundary.ok) return boundary;
  const { cacheCurrent, callerCurrent, boundaryFailure } = boundary;
  try {
    const profile = existingProfile(boundary);
    if (!profile.ok) return profile;
    const result = await use(profile.directory, target, cacheCurrent);
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

function assertNoCacheLease(profile: string) {
  if (present(join(profile, ".lease"))) throw new CacheBusy();
}

function inspectionFailure(boundary: CacheBoundary, error: unknown, pendingProfile?: string) {
  if (error instanceof CacheBusy) return fail("BUSY");
  // A failed async read may have skipped its next lease check.
  if (pendingProfile && !(error instanceof IndexReuseCleanupError) && boundary.cacheCurrent()) {
    try {
      assertNoCacheLease(pendingProfile);
    } catch (leaseError) {
      if (leaseError instanceof CacheBusy) return fail("BUSY");
    }
  }
  boundary.callerCurrent();
  return boundary.boundaryFailure();
}

export async function inspectStagedIndexPurgeProgress(input: IndexReclaimIntentTarget, current: () => boolean) {
  const target = readIndexReclaimIntentTarget(input);
  if (!target) return fail("INPUT");
  const boundary = appCacheBoundary(current);
  if (!boundary.ok) return boundary;
  let profile: string | undefined;
  try {
    const path = existingProfile(boundary);
    if (!path.ok) return path;
    profile = path.directory;
    const check = () => {
      if (!boundary.cacheCurrent()) throw Error("Index purge inspection invalidated");
    };
    check();
    const profileStat = present(profile);
    if (!profileStat) return fail("UNAVAILABLE");
    const checkLease = () => assertNoCacheLease(path.directory);
    const footprint = await captureIndexFootprint(
      profile, profileStat, boundary.owner, check, checkLease, undefined, "pending", true
    );
    const proof = await verifyPurgeSubset(profile, footprint, target, boundary.owner);
    if (!proof.ok) return proof;
    proof.footprint.recheck();
    return {
      ok: true as const,
      expectedFiles: proof.roster.files.length,
      remainingFiles: proof.remaining.length,
      missingFiles: proof.roster.files.length - proof.remaining.length,
      remainingIndexBytes: Number(proof.footprint.indexBytes),
    };
  } catch (error) {
    return inspectionFailure(boundary, error, profile);
  }
}

/** Read metadata from only the fixed cache profile and its immediate index files. */
export async function inspectAppIndexCacheFootprint(current: () => boolean) {
  const boundary = appCacheBoundary(current);
  if (!boundary.ok) return boundary;
  const { home, owner, pin, cacheCurrent } = boundary;
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
  const pendingPath = join(profile, reclaimDirectoryName("pending"));
  const checkLease = () => assertNoCacheLease(profile);
  let pending = false;
  try {
    check();
    const cacheStat = present(cache);
    if (!cacheStat) return absentAt(cache);
    pin(cache, true, cacheStat);
    const profileStat = present(profile);
    if (!profileStat) return absentAt(profile);
    pin(profile, true, profileStat);
    checkLease();
    pending = present(pendingPath) !== undefined;
    const hasPurge = pending && present(join(profile, INDEX_PURGE_ROSTER_NAME)) !== undefined;
    const footprint = await captureIndexFootprint(
      profile, profileStat, owner, check, checkLease, undefined, pending ? "pending" : "original", hasPurge
    );
    footprint.recheck();
    if (footprint.status === "empty") return { ...absent };
    if (pending) {
      const prepared = await readPreparedReclaimCatalog(profile, footprint.catalogStat, footprint.checkIndex);
      footprint.recheck();
      if (!prepared) return fail("UNAVAILABLE");
      const { catalog, catalogSha256 } = prepared;
      if (footprint.stagingDigest(catalog) !== catalog.stagingDigest) return fail("UNAVAILABLE");
      const valid = await validReclaimLayout(
        pendingPath, new Map(footprint.nativeFiles()), catalog.generation, footprint.checkIndex
      );
      footprint.recheck();
      if (!valid) return fail("UNAVAILABLE");
      if (footprint.purgeStat) {
        const expected = encodePurgeRoster(catalog, catalogSha256, footprint.directoryStamp(), footprint.fileStamps());
        const actual = await readPinnedPurgeRoster(profile, footprint.purgeStat, footprint.checkIndex);
        footprint.recheck();
        if (!expected || !actual?.equals(expected)) return fail("UNAVAILABLE");
      }
    }
    const { files, catalogBytes, indexBytes, totalBytes } = footprint;
    if (totalBytes > BigInt(Number.MAX_SAFE_INTEGER)) return fail("UNAVAILABLE");
    return {
      ok: true as const, present: true as const, files,
      catalogBytes: Number(catalogBytes), indexBytes: Number(indexBytes), totalBytes: Number(totalBytes),
      ...(pending ? { placement: "pending" as const } : {}),
      ...(footprint.purgeStat ? { purgeBytes: Number(footprint.purgeStat.size) } : {}),
    };
  } catch (error) {
    return inspectionFailure(boundary, error, pending ? profile : undefined);
  }
}
