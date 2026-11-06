import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";

import {
  reclaimDirectoryStamp, reclaimFileStamp, sameIndexInventoryMetadata, type captureCompletedPlacement,
  type captureFinalizingPlacement, type captureIndexFootprint,
} from "./cache-footprint";
import { record } from "./protocol";
import {
  decodeFinalizingCatalog, decodePurgeRoster, encodeFinalizingCatalog, encodePurgeCompletion, reclaimStagingDigest,
} from "./purge-roster";
import {
  readPinnedPurgeCompletion, readPinnedPurgeRoster, readPinnedReclaimCatalog, readPreparedReclaimCatalog,
} from "./reclaim-layout";
import { INDEX_REUSE_CATALOG_BYTES, validPreparedCatalog, type IndexReclaimIntentTarget } from "./reuse-catalog";

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

export async function verifyFinalizationPlacement(
  profile: string, placement: CompletedPlacement, target: IndexReclaimIntentTarget, owner: bigint
) {
  if (placement.pendingStat) return fail("MISMATCH");
  const { catalogStat, purgeStat, completionStat, recheck } = placement;
  const catalog = await readPinnedReclaimCatalog(profile, catalogStat, recheck);
  recheck();
  if (!catalog) return fail("UNAVAILABLE");
  const { value } = catalog;
  const alreadyPrepared = record(value) && value.version === 4 &&
    value.profile === "limited-v1" && value.state === "reclaim-finalizing";
  if (!alreadyPrepared && !validPreparedCatalog(value)) return fail("SCHEMA");
  if (value.scopeKey !== target.scopeKey) return fail("SCHEMA");
  if (value.generation !== target.generation || value.inventoryDigest !== target.inventoryDigest)
    return fail("MISMATCH");

  const rosterBytes = await readPinnedPurgeRoster(profile, purgeStat, recheck);
  recheck();
  const roster = rosterBytes && decodePurgeRoster(rosterBytes, owner);
  if (!rosterBytes || !roster) return fail("SCHEMA");
  if (roster.scopeKey !== target.scopeKey || roster.generation !== target.generation ||
      roster.inventoryDigest !== target.inventoryDigest || roster.stagingDigest !== value.stagingDigest ||
      reclaimStagingDigest(roster, roster.directory, roster.files) !== value.stagingDigest ||
      (!alreadyPrepared && createHash("sha256").update(catalog.bytes).digest("hex") !== roster.catalogSha256))
    return fail("MISMATCH");
  const completion = await readPinnedPurgeCompletion(profile, completionStat, recheck);
  recheck();
  const expected = encodePurgeCompletion(roster, rosterBytes);
  if (!completion || !expected) return fail("UNAVAILABLE");
  if (!completion.equals(expected)) return fail("MISMATCH");

  const contents = encodeFinalizingCatalog(
    roster, rosterBytes, reclaimFileStamp(purgeStat), completion, reclaimFileStamp(completionStat)
  );
  if (contents.length > INDEX_REUSE_CATALOG_BYTES) return fail("UNAVAILABLE");
  if (alreadyPrepared && !catalog.bytes.equals(contents)) return fail("MISMATCH");
  return { ok: true as const, alreadyPrepared, contents, rosterBytes, completion };
}

type FinalizingPlacement = Awaited<ReturnType<typeof captureFinalizingPlacement>>;
export async function verifyFinalizingSidecars(
  profile: string, placement: FinalizingPlacement, target: IndexReclaimIntentTarget, owner: bigint
) {
  const { catalogStat, roster, completion, recheck } = placement;
  if (roster && !completion) return fail("MISMATCH");
  const catalog = await readPinnedReclaimCatalog(profile, catalogStat, recheck);
  recheck();
  if (!catalog) return fail("SCHEMA");
  const marker = decodeFinalizingCatalog(catalog.bytes, catalog.value, owner);
  if (marker?.scopeKey !== target.scopeKey) return fail("SCHEMA");
  if (marker.generation !== target.generation || marker.inventoryDigest !== target.inventoryDigest)
    return fail("MISMATCH");
  for (const [pinned, expected, read] of [
    [roster, marker.roster, readPinnedPurgeRoster], [completion, marker.completion, readPinnedPurgeCompletion],
  ] as const) {
    if (!pinned) continue;
    if (!samePurgeStamp(reclaimFileStamp(pinned), expected.stamp)) return fail("MISMATCH");
    const bytes = await read(profile, pinned, recheck);
    recheck();
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== expected.sha256)
      return fail("MISMATCH");
  }
  return { ok: true as const, catalogBytes: catalog.bytes };
}
