import type { BigIntStats } from "node:fs";

import {
  reclaimDirectoryStamp, sameIndexInventoryMetadata, type captureCompletedPlacement, type captureIndexFootprint,
} from "./cache-footprint";
import { decodePurgeRoster, encodePurgeCompletion, reclaimStagingDigest } from "./purge-roster";
import { readPinnedPurgeCompletion, readPinnedPurgeRoster, readPreparedReclaimCatalog } from "./reclaim-layout";
import type { IndexReclaimIntentTarget } from "./reuse-catalog";

type Footprint = Awaited<ReturnType<typeof captureIndexFootprint>>;
const fail = (error: "UNAVAILABLE" | "SCHEMA" | "MISMATCH") => ({ ok: false as const, error, accepted: false });

export function samePurgeStamp(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Revalidates both records and the exact live subset; callers choose the lease policy. */
export async function verifyPurgeHistory(
  profile: string,
  pins: {
    catalogStat: BigIntStats;
    purgeStat: BigIntStats;
    recheck: () => void;
    checkRead?: () => void;
  },
  target: IndexReclaimIntentTarget, owner: bigint
) {
  const { catalogStat, purgeStat, recheck, checkRead = recheck } = pins;
  recheck();
  const prepared = await readPreparedReclaimCatalog(profile, catalogStat, checkRead);
  recheck();
  if (prepared?.catalog.scopeKey !== target.scopeKey) return fail("SCHEMA");
  const { catalog, catalogSha256 } = prepared;
  if (catalog.generation !== target.generation || catalog.inventoryDigest !== target.inventoryDigest)
    return fail("MISMATCH");
  const bytes = await readPinnedPurgeRoster(profile, purgeStat, checkRead);
  recheck();
  if (!bytes) return fail("SCHEMA");
  const roster = decodePurgeRoster(bytes, owner);
  if (!roster) return fail("SCHEMA");
  if (roster.scopeKey !== catalog.scopeKey || roster.generation !== catalog.generation ||
      roster.inventoryDigest !== catalog.inventoryDigest || roster.stagingDigest !== catalog.stagingDigest ||
      roster.catalogSha256 !== catalogSha256 ||
      reclaimStagingDigest(roster, roster.directory, roster.files) !== catalog.stagingDigest)
    return fail("MISMATCH");
  return { ok: true as const, roster, catalogSha256, rosterBytes: bytes };
}

export async function verifyPurgeSubset(
  profile: string, footprint: Footprint, target: IndexReclaimIntentTarget, owner: bigint
) {
  if (footprint.status !== "existing" || !footprint.purgeStat) {
    footprint.recheck();
    return fail("UNAVAILABLE");
  }
  const history = await verifyPurgeHistory(profile, {
    catalogStat: footprint.catalogStat, purgeStat: footprint.purgeStat,
    recheck: footprint.recheck, checkRead: footprint.checkIndex,
  }, target, owner);
  if (!history.ok) return history;
  if (!samePurgeStamp(history.roster.directory, footprint.directoryStamp())) return fail("MISMATCH");
  const expected = new Map(history.roster.files);
  const remaining = footprint.fileStamps();
  for (const [name, stamp] of remaining) {
    const historical = expected.get(name);
    if (!historical || !samePurgeStamp(historical, stamp)) return fail("MISMATCH");
  }
  if (footprint.indexBytes > BigInt(Number.MAX_SAFE_INTEGER)) return fail("UNAVAILABLE");
  footprint.recheck();
  return { ...history, footprint, purgeStat: footprint.purgeStat, remaining };
}

type PurgeProof = Extract<Awaited<ReturnType<typeof verifyPurgeSubset>>, { ok: true }>;
export function samePurgeRecords(before: PurgeProof, after: PurgeProof) {
  return before.catalogSha256 === after.catalogSha256 && before.rosterBytes.equals(after.rosterBytes) &&
    sameIndexInventoryMetadata(before.footprint.catalogStat, after.footprint.catalogStat) &&
    sameIndexInventoryMetadata(before.purgeStat, after.purgeStat);
}

type CompletedPlacement = Awaited<ReturnType<typeof captureCompletedPlacement>>;
export async function verifyCompletedPlacement(
  profile: string, placement: CompletedPlacement, target: IndexReclaimIntentTarget, owner: bigint
) {
  const history = await verifyPurgeHistory(profile, placement, target, owner);
  if (!history.ok) return history;
  const expected = encodePurgeCompletion(history.roster, history.rosterBytes);
  const completion = await readPinnedPurgeCompletion(profile, placement.completionStat, placement.recheck);
  placement.recheck();
  if (!expected || !completion) return fail("UNAVAILABLE");
  if (!completion.equals(expected) || !placement.empty ||
      (placement.pendingStat && !samePurgeStamp(history.roster.directory, reclaimDirectoryStamp(placement.pendingStat))))
    return fail("MISMATCH");
  return { ...history, placement, completion };
}

type CompletedProof = Extract<Awaited<ReturnType<typeof verifyCompletedPlacement>>, { ok: true }>;
export function sameCompletedRecords(before: CompletedProof, after: CompletedProof) {
  return before.catalogSha256 === after.catalogSha256 && before.rosterBytes.equals(after.rosterBytes) &&
    before.completion.equals(after.completion) &&
    sameIndexInventoryMetadata(before.placement.catalogStat, after.placement.catalogStat) &&
    sameIndexInventoryMetadata(before.placement.purgeStat, after.placement.purgeStat) &&
    sameIndexInventoryMetadata(before.placement.completionStat, after.placement.completionStat);
}
