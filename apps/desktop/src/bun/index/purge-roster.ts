export const INDEX_PURGE_ROSTER_NAME = ".reclaim-purge.json";
export const INDEX_PURGE_ROSTER_BYTES = 64 * 1024;
export const INDEX_PURGE_ROSTER_FILES = 128;

interface PurgeRosterSource {
  scopeKey: string;
  generation: number;
  inventoryDigest: string;
  stagingDigest: string;
}

/** Equality with these bounded canonical bytes also rejects all other layouts. */
export function encodePurgeRoster(
  { scopeKey, generation, inventoryDigest, stagingDigest }: PurgeRosterSource,
  catalogSha256: string,
  directory: readonly string[],
  files: readonly (readonly [string, readonly string[]])[]
) {
  if (files.length > INDEX_PURGE_ROSTER_FILES) return;
  const bytes = Buffer.from(JSON.stringify({
    version: 1, profile: "limited-v1", state: "purge-prepared",
    scopeKey, generation, inventoryDigest, stagingDigest, catalogSha256, directory, files,
  }));
  if (bytes.length <= INDEX_PURGE_ROSTER_BYTES) return bytes;
}
