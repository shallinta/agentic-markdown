import { lstatSync, type BigIntStats, type Dir } from "node:fs";
import { opendir } from "node:fs/promises";
import { join } from "node:path";

import { IndexReuseCleanupError, type IndexReuseInventoryIdentity } from "./reuse-catalog";

const maxIndexFiles = 128;

function sameMetadata(before: BigIntStats, after: BigIntStats) {
  return before.dev === after.dev && before.ino === after.ino &&
    before.uid === after.uid && before.mode === after.mode && before.nlink === after.nlink &&
    before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
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
  expected?: IndexReuseInventoryIdentity
) {
  const checkInspection = () => {
    check();
    checkLease();
  };
  const inventory = [{ path: profile, stat: profileStat }];
  const recheck = () => {
    checkInspection();
    for (const { path, stat } of inventory)
      if (!sameMetadata(stat, lstatSync(path, { bigint: true })))
        throw Error("Index cache inventory changed");
    checkLease();
  };
  const readFileMetadata = (path: string, expected?: BigIntStats, privateMode = false) => {
    const stat = lstatSync(path, { bigint: true });
    if (!stat.isFile() || stat.uid !== owner || stat.nlink !== 1n || stat.size < 0n ||
        (privateMode && (stat.mode & 0o077n) !== 0n) || (expected && !sameMetadata(expected, stat)))
      throw Error("Index cache file unavailable");
    inventory.push({ path, stat });
    return stat.size;
  };

  const memberLimit = expected ? 3 : 2;
  const members = await readMembers(profile, memberLimit, checkInspection);
  checkInspection();
  if (!members.size && !expected) return { status: "empty" as const, recheck };
  if (members.size !== memberLimit || !members.has("catalog.json") || !members.has("index") ||
      (expected && !members.has(".lease")))
    throw Error("Index cache layout unavailable");

  const catalogBytes = readFileMetadata(join(profile, "catalog.json"), expected?.catalog, true);
  if (catalogBytes === 0n) throw Error("Index cache catalog unavailable");
  const index = join(profile, "index");
  const indexStat = lstatSync(index, { bigint: true });
  if (!indexStat.isDirectory() || indexStat.uid !== owner || (indexStat.mode & 0o022n) !== 0n ||
      (expected && !sameMetadata(expected.index, indexStat)))
    throw Error("Index cache directory unavailable");
  inventory.push({ path: index, stat: indexStat });
  const checkIndex = () => {
    checkInspection();
    if (!sameMetadata(indexStat, lstatSync(index, { bigint: true })))
      throw Error("Index cache directory changed");
  };
  let indexBytes = 0n;
  const names = await readMembers(index, maxIndexFiles, checkIndex, (name) => {
    indexBytes += readFileMetadata(join(index, name));
  });
  return {
    status: "existing" as const, recheck, files: names.size + 1,
    catalogBytes, indexBytes, totalBytes: catalogBytes + indexBytes,
  };
}
