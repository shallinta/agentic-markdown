import { createHash } from "node:crypto";
import { lstatSync, type BigIntStats, type Dir } from "node:fs";
import { opendir } from "node:fs/promises";
import { basename, join } from "node:path";

import { INDEX_PURGE_ROSTER_FILES, INDEX_PURGE_ROSTER_NAME } from "./purge-roster";
import {
  IndexReuseCleanupError, reclaimDirectoryName, type IndexReclaimIntentTarget,
  type IndexRetirementTarget, type IndexReuseInventoryIdentity, type ReclaimPlacement,
} from "./reuse-catalog";


export function sameIndexInventoryMetadata(before: BigIntStats, after: BigIntStats) {
  return before.dev === after.dev && before.ino === after.ino &&
    before.uid === after.uid && before.mode === after.mode && before.nlink === after.nlink &&
    before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs &&
    before.birthtimeNs === after.birthtimeNs;
}

function identityStamp(stat: BigIntStats) {
  return [
    stat.birthtimeNs, stat.dev, stat.ino, stat.mode, stat.uid, stat.nlink,
    stat.size, stat.mtimeNs, stat.ctimeNs,
  ].map(String);
}

async function closeDirectory(dir: Dir) {
  try {
    await dir.close();
  } catch {
    throw new IndexReuseCleanupError("Index cache directory close unconfirmed");
  }
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
    await closeDirectory(dir);
  }
}

/** Capture only metadata; recheck after the last await before using the totals. */
export async function captureIndexFootprint(
  profile: string,
  profileStat: BigIntStats,
  owner: bigint,
  check: () => void,
  checkLease: () => void,
  expected?: IndexReuseInventoryIdentity,
  placement: ReclaimPlacement = "original",
  includePurge = false
) {
  const checkInspection = () => {
    check();
    checkLease();
  };
  const inventory = [{ path: profile, stat: profileStat }];
  const recheckMembers = (start: number) => {
    for (let index = start; index < inventory.length; index++) {
      const { path, stat } = inventory[index];
      if (!sameIndexInventoryMetadata(stat, lstatSync(path, { bigint: true })))
        throw Error("Index cache inventory changed");
    }
  };
  const recheckInventory = (start: number) => {
    checkInspection();
    recheckMembers(start);
    checkLease();
  };
  const recheck = () => recheckInventory(0);
  const readFileMetadata = (path: string, expected?: BigIntStats, privateMode = false) => {
    const stat = lstatSync(path, { bigint: true });
    if (!stat.isFile() || stat.uid !== owner || stat.nlink !== 1n || stat.size < 0n ||
        (privateMode && (stat.mode & 0o077n) !== 0n) || (expected && !sameIndexInventoryMetadata(expected, stat)))
      throw Error("Index cache file unavailable");
    inventory.push({ path, stat });
    return stat;
  };

  const memberLimit = (expected ? 3 : 2) + Number(includePurge);
  const indexName = reclaimDirectoryName(placement);
  const members = await readMembers(profile, memberLimit, checkInspection);
  checkInspection();
  if (!members.size && !expected && placement === "original") return { status: "empty" as const, recheck };
  if (members.size !== memberLimit || !members.has("catalog.json") || !members.has(indexName) ||
      (expected && !members.has(".lease")) ||
      (includePurge && (placement !== "pending" || !members.has(INDEX_PURGE_ROSTER_NAME))))
    throw Error("Index cache layout unavailable");

  const catalogStat = readFileMetadata(join(profile, "catalog.json"), expected?.catalog, true);
  const catalogBytes = catalogStat.size;
  if (catalogBytes === 0n) throw Error("Index cache catalog unavailable");
  const purgeStat = includePurge ? readFileMetadata(join(profile, INDEX_PURGE_ROSTER_NAME), undefined, true) : undefined;
  const index = join(profile, indexName);
  const indexStat = lstatSync(index, { bigint: true });
  if (!indexStat.isDirectory() || indexStat.uid !== owner || (indexStat.mode & 0o022n) !== 0n ||
      (expected && !sameIndexInventoryMetadata(expected.index, indexStat)))
    throw Error("Index cache directory unavailable");
  const nativeStart = inventory.length;
  inventory.push({ path: index, stat: indexStat });
  const checkIndex = () => {
    checkInspection();
    if (!sameIndexInventoryMetadata(indexStat, lstatSync(index, { bigint: true })))
      throw Error("Index cache directory changed");
  };
  let indexBytes = 0n;
  const names = await readMembers(index, INDEX_PURGE_ROSTER_FILES, checkIndex, (name) => {
    indexBytes += readFileMetadata(join(index, name)).size;
  });
  const nativeFiles = () => inventory.slice(nativeStart + 1).map(({ path, stat }) => [basename(path), stat] as const);
  const fileStamps = () => nativeFiles()
    .map(([name, stat]) => [name, identityStamp(stat)] as const)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const directoryStamp = () => {
    const { dev, ino, birthtimeNs, uid, mode } = indexStat;
    return [dev, ino, birthtimeNs, uid, mode].map(String);
  };
  return {
    status: "existing" as const, recheck, files: names.size + 1 + Number(includePurge),
    catalogStat, purgeStat, catalogBytes, indexBytes, totalBytes: catalogBytes + indexBytes + (purgeStat?.size ?? 0n),
    recheckAfterStaging: () => recheckInventory(1),
    recheckNative: () => {
      checkLease();
      recheckMembers(nativeStart);
      checkLease();
    },
    checkIndex,
    nativeFiles,
    fileStamps,
    directoryStamp,
    inventoryDigest({ scopeKey, generation }: IndexRetirementTarget) {
      return createHash("sha256").update(JSON.stringify([
        2, "agentic-markdown-index-retirement-inventory", "limited-v1",
        scopeKey, generation, identityStamp(indexStat), fileStamps(),
      ])).digest("hex");
    },
    stagingDigest({ scopeKey, generation, inventoryDigest }: IndexReclaimIntentTarget) {
      return createHash("sha256").update(JSON.stringify([
        3, "agentic-markdown-index-reclaim-intent", "limited-v1", scopeKey, generation, inventoryDigest,
        directoryStamp(), fileStamps(),
      ])).digest("hex");
    },
  };
}
