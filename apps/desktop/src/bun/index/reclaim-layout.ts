import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { sameIndexInventoryMetadata } from "./cache-footprint";
import { INDEX_LIMITS, keys, natural, record } from "./protocol";
import { INDEX_PURGE_ROSTER_BYTES, INDEX_PURGE_ROSTER_NAME } from "./purge-roster";
import { INDEX_REUSE_CATALOG_BYTES, IndexReuseCleanupError, validPreparedCatalog } from "./reuse-catalog";

const bridgeConfig = Buffer.from("bridge=1\nschema=1\ntantivy=0.27.0\nprofile=literal-gram-v1\n");
const maxControlBytes = 32 * 1024;
const segmentID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
// Tantivy 0.27.0 SegmentMeta::relative_path. Temporary/custom files are outside this profile.
const extensions = ["idx", "pos", "term", "store", "fast", "fieldnorm"];
const unmanaged = new Set([".managed.json", "bridge.schema", ".tantivy-meta.lock", ".tantivy-writer.lock"]);

async function closeControl(file: FileHandle) {
  try {
    await file.close();
  } catch {
    throw new IndexReuseCleanupError("Index control file close unconfirmed");
  }
}

async function readControl(path: string, pinned: BigIntStats, max: number, check: () => void) {
  if (pinned.size < 1n || pinned.size > BigInt(max)) return;
  check();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    check();
    const before = await file.stat({ bigint: true });
    check();
    if (!sameIndexInventoryMetadata(pinned, before)) throw Error("Index control identity changed");
    const bytes = Buffer.alloc(Number(pinned.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      check();
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    check();
    if (!sameIndexInventoryMetadata(pinned, after) || BigInt(length) !== pinned.size)
      throw Error("Index control identity changed");
    return bytes.subarray(0, length);
  } finally {
    await closeControl(file);
  }
}

function parseControl(bytes: Buffer | undefined): unknown {
  if (!bytes) return;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    return;
  }
}

export async function readPreparedReclaimCatalog(profile: string, pinned: BigIntStats, check: () => void) {
  const bytes = await readControl(join(profile, "catalog.json"), pinned, INDEX_REUSE_CATALOG_BYTES, check);
  if (!bytes) return;
  const catalog = parseControl(bytes);
  return validPreparedCatalog(catalog) ? { catalog, catalogSha256: createHash("sha256").update(bytes).digest("hex") } : undefined;
}

export function readPinnedPurgeRoster(profile: string, pinned: BigIntStats, check: () => void) {
  return readControl(join(profile, INDEX_PURGE_ROSTER_NAME), pinned, INDEX_PURGE_ROSTER_BYTES, check);
}

function validSchema(value: unknown) {
  if (!Array.isArray(value) || value.length !== 4) return false;
  return ["id", "path", "raw", "gram"].every((name, position) => {
    const field: unknown = value[position];
    if (!record(field) || !keys(field, "name,options,type") || field.name !== name || field.type !== "text")
      return false;
    const { options } = field;
    if (!record(options) || options.fast !== false || options.stored !== (name !== "gram")) return false;
    if (name === "path" || name === "raw") return keys(options, "fast,stored");
    const { indexing } = options;
    return keys(options, "fast,indexing,stored") && record(indexing) &&
      keys(indexing, "fieldnorms,record,tokenizer") &&
      indexing.fieldnorms === true && indexing.record === "basic" && indexing.tokenizer === "raw";
  });
}

function committedFiles(value: unknown, generation: number) {
  if (!record(value) || !keys(value, generation === 0
    ? "index_settings,opstamp,schema,segments" : "index_settings,opstamp,payload,schema,segments") ||
      !natural(value.opstamp) || !Array.isArray(value.segments) || value.segments.length > 128 ||
      !validSchema(value.schema))
    return;
  const settings = value.index_settings;
  if (!record(settings) || !keys(settings, "docstore_blocksize,docstore_compression") ||
      settings.docstore_blocksize !== 16_384 || settings.docstore_compression !== "lz4" ||
      (generation === 0 ? value.opstamp !== 0 || value.segments.length !== 0
        : value.payload !== `bridge-v1:${generation}`))
    return;
  const files = new Set(["meta.json"]);
  const segments = new Set<string>();
  let live = 0;
  for (const item of value.segments) {
    const row: unknown = item;
    if (!record(row) || !keys(row, "deletes,max_doc,segment_id") ||
        typeof row.segment_id !== "string" || !segmentID.test(row.segment_id) ||
        segments.has(row.segment_id) || !natural(row.max_doc) || row.max_doc < 1 || row.max_doc > 0xffff_ffff)
      return;
    segments.add(row.segment_id);
    const prefix = row.segment_id.replaceAll("-", "");
    for (const extension of extensions) files.add(`${prefix}.${extension}`);
    let deleted = 0;
    if (row.deletes !== null) {
      const { deletes } = row;
      if (!record(deletes) || !keys(deletes, "num_deleted_docs,opstamp") ||
          !natural(deletes.num_deleted_docs) || deletes.num_deleted_docs < 1 || deletes.num_deleted_docs > row.max_doc ||
          !natural(deletes.opstamp) || deletes.opstamp > value.opstamp)
        return;
      deleted = deletes.num_deleted_docs;
      files.add(`${prefix}.${deletes.opstamp}.del`);
    }
    live += row.max_doc - deleted;
    if (live > INDEX_LIMITS.documents) return;
  }
  return files;
}

/** Prove the closed, committed layout only; stale GC or temporary files require separate handling. */
export async function validReclaimLayout(
  index: string, files: ReadonlyMap<string, BigIntStats>, generation: number, check: () => void
) {
  const bridge = files.get("bridge.schema");
  const meta = files.get("meta.json");
  const managed = files.get(".managed.json");
  if (!bridge || !meta || !managed ||
      files.get(".tantivy-meta.lock")?.size !== 0n || files.get(".tantivy-writer.lock")?.size !== 0n)
    return false;
  const config = await readControl(join(index, "bridge.schema"), bridge, bridgeConfig.length, check);
  if (!config?.equals(bridgeConfig)) return false;
  const expected = committedFiles(parseControl(await readControl(join(index, "meta.json"), meta, maxControlBytes, check)), generation);
  if (!expected || expected.size + unmanaged.size !== files.size) return false;
  const manifest = parseControl(await readControl(join(index, ".managed.json"), managed, maxControlBytes, check));
  if (!Array.isArray(manifest) || manifest.length !== expected.size) return false;
  for (const value of manifest) {
    if (typeof value !== "string" || !expected.delete(value) || !files.has(value)) return false;
  }
  return expected.size === 0 && [...unmanaged].every((name) => files.has(name));
}
