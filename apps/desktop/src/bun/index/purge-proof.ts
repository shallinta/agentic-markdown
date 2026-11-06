import type { captureIndexFootprint } from "./cache-footprint";
import { decodePurgeRoster, reclaimStagingDigest } from "./purge-roster";
import { readPinnedPurgeRoster, readPreparedReclaimCatalog } from "./reclaim-layout";
import type { IndexReclaimIntentTarget } from "./reuse-catalog";

type Footprint = Awaited<ReturnType<typeof captureIndexFootprint>>;
const fail = (error: "UNAVAILABLE" | "SCHEMA" | "MISMATCH") => ({ ok: false as const, error, accepted: false });

export function samePurgeStamp(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Revalidates both records and the exact live subset; callers choose the lease policy. */
export async function verifyPurgeSubset(
  profile: string, footprint: Footprint, target: IndexReclaimIntentTarget, owner: bigint
) {
  footprint.recheck();
  if (footprint.status !== "existing" || !footprint.purgeStat) return fail("UNAVAILABLE");
  const prepared = await readPreparedReclaimCatalog(profile, footprint.catalogStat, footprint.checkIndex);
  footprint.recheck();
  if (prepared?.catalog.scopeKey !== target.scopeKey) return fail("SCHEMA");
  const { catalog, catalogSha256 } = prepared;
  if (catalog.generation !== target.generation || catalog.inventoryDigest !== target.inventoryDigest)
    return fail("MISMATCH");
  const bytes = await readPinnedPurgeRoster(profile, footprint.purgeStat, footprint.checkIndex);
  footprint.recheck();
  if (!bytes) return fail("SCHEMA");
  const roster = decodePurgeRoster(bytes, owner);
  if (!roster) return fail("SCHEMA");
  if (roster.scopeKey !== catalog.scopeKey || roster.generation !== catalog.generation ||
      roster.inventoryDigest !== catalog.inventoryDigest || roster.stagingDigest !== catalog.stagingDigest ||
      roster.catalogSha256 !== catalogSha256 || !samePurgeStamp(roster.directory, footprint.directoryStamp()) ||
      reclaimStagingDigest(roster, roster.directory, roster.files) !== catalog.stagingDigest)
    return fail("MISMATCH");
  const expected = new Map(roster.files);
  const remaining = footprint.fileStamps();
  for (const [name, stamp] of remaining) {
    const historical = expected.get(name);
    if (!historical || !samePurgeStamp(historical, stamp)) return fail("MISMATCH");
  }
  if (footprint.indexBytes > BigInt(Number.MAX_SAFE_INTEGER)) return fail("UNAVAILABLE");
  footprint.recheck();
  return { ok: true as const, footprint, purgeStat: footprint.purgeStat, roster, remaining, catalogSha256, rosterBytes: bytes };
}
