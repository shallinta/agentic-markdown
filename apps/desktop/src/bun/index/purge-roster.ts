import { createHash } from "node:crypto";

import { natural, record } from "./protocol";

export const INDEX_PURGE_ROSTER_NAME = ".reclaim-purge.json";
export const INDEX_PURGE_ROSTER_BYTES = 64 * 1024;
export const INDEX_PURGE_ROSTER_FILES = 128;
export const INDEX_SEGMENT_EXTENSIONS = ["idx", "pos", "term", "store", "fast", "fieldnorm"];
export const INDEX_UNMANAGED_CONTROLS = [".managed.json", "bridge.schema", ".tantivy-meta.lock", ".tantivy-writer.lock"];

interface ReclaimTargetStamp {
  scopeKey: string;
  generation: number;
  inventoryDigest: string;
}
interface PurgeRosterSource extends ReclaimTargetStamp {
  stagingDigest: string;
}
type FileStamp = readonly [string, readonly string[]];
interface PurgeRoster extends PurgeRosterSource {
  catalogSha256: string;
  directory: readonly string[];
  files: readonly FileStamp[];
}

export function reclaimStagingDigest(
  { scopeKey, generation, inventoryDigest }: ReclaimTargetStamp,
  directory: readonly string[],
  files: readonly FileStamp[]
) {
  return createHash("sha256").update(JSON.stringify([
    3, "agentic-markdown-index-reclaim-intent", "limited-v1", scopeKey, generation, inventoryDigest, directory, files,
  ])).digest("hex");
}

/** Equality with these bounded canonical bytes also rejects all other layouts. */
export function encodePurgeRoster(
  { scopeKey, generation, inventoryDigest, stagingDigest }: PurgeRosterSource,
  catalogSha256: string,
  directory: readonly string[],
  files: readonly FileStamp[]
) {
  if (files.length > INDEX_PURGE_ROSTER_FILES) return;
  const bytes = Buffer.from(JSON.stringify({
    version: 1, profile: "limited-v1", state: "purge-prepared",
    scopeKey, generation, inventoryDigest, stagingDigest, catalogSha256, directory, files,
  }));
  if (bytes.length <= INDEX_PURGE_ROSTER_BYTES) return bytes;
}

const digest = /^[a-f0-9]{64}$/;
const unsigned = /^(0|[1-9][0-9]{0,19})$/;
const signed = /^(0|-?[1-9][0-9]{0,18})$/;
const signedMin = -(1n << 63n);
const signedMax = (1n << 63n) - 1n;
const unsignedMax = (1n << 64n) - 1n;
const controls = new Set([...INDEX_UNMANAGED_CONTROLS, "meta.json"]);
const zeroLocks = new Set([".tantivy-meta.lock", ".tantivy-writer.lock"]);
const segmentName = /^([a-f0-9]{32})\.(?:([a-z]+)|(0|[1-9][0-9]{0,15})\.del)$/;

function validNumber(value: unknown, time: boolean): value is string {
  if (typeof value !== "string" || !(time ? signed : unsigned).test(value)) return false;
  const number = BigInt(value);
  return time ? number >= signedMin && number <= signedMax : number <= unsignedMax;
}

function validStamp(value: unknown, kind: "directory" | "file", owner: string): value is string[] {
  const directory = kind === "directory";
  if (!Array.isArray(value) || value.length !== (directory ? 5 : 9)) return false;
  const stamp: unknown[] = value;
  if (!stamp.every((item, i): item is string => validNumber(item, directory ? i === 2 : i === 0 || i === 7 || i === 8)))
    return false;
  const mode = BigInt(stamp[directory ? 4 : 3]);
  if (mode > 0o177777n) return false;
  return directory
    ? stamp[3] === owner && (mode & 0o170022n) === 0o040000n
    : stamp[4] === owner && stamp[5] === "1" && (mode & 0o170000n) === 0o100000n;
}

function validFiles(value: unknown, owner: string): value is FileStamp[] {
  if (!Array.isArray(value) || value.length < controls.size || value.length > INDEX_PURGE_ROSTER_FILES)
    return false;
  const found = new Set<string>();
  const segments = new Map<string, Set<string>>();
  let previous: string | undefined;
  for (const item of value) {
    const row: unknown = item;
    if (!Array.isArray(row) || row.length !== 2) return false;
    const pair: unknown[] = row;
    const [name, stamp] = pair;
    if (typeof name !== "string" || (previous !== undefined && name <= previous) || !validStamp(stamp, "file", owner))
      return false;
    previous = name;
    if (controls.has(name)) {
      if (zeroLocks.has(name) !== (stamp[6] === "0")) return false;
      found.add(name);
      continue;
    }
    const match = segmentName.exec(name);
    if (!match) return false;
    const [, segment, extension, deletion] = match;
    if (deletion === undefined ? !INDEX_SEGMENT_EXTENSIONS.includes(extension) : !natural(Number(deletion)))
      return false;
    const component = deletion === undefined ? extension : "del";
    const members = segments.get(segment) ?? new Set<string>();
    if (members.has(component)) return false;
    members.add(component);
    segments.set(segment, members);
  }
  return found.size === controls.size &&
    [...segments.values()].every((members) => INDEX_SEGMENT_EXTENSIONS.every((extension) => members.has(extension)));
}

export function decodePurgeRoster(bytes: Buffer, owner: bigint): PurgeRoster | undefined {
  if (bytes.length > INDEX_PURGE_ROSTER_BYTES) return;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    return;
  }
  if (!record(value) || value.version !== 1 || value.profile !== "limited-v1" || value.state !== "purge-prepared")
    return;
  const { scopeKey, generation, inventoryDigest, stagingDigest, catalogSha256, directory, files } = value;
  if (typeof scopeKey !== "string" || !digest.test(scopeKey) || !natural(generation) ||
      typeof inventoryDigest !== "string" || !digest.test(inventoryDigest) ||
      typeof stagingDigest !== "string" || !digest.test(stagingDigest) ||
      typeof catalogSha256 !== "string" || !digest.test(catalogSha256) ||
      !validStamp(directory, "directory", String(owner)) || !validFiles(files, String(owner)))
    return;
  if (generation === 0 && files.length !== controls.size) return;
  const roster = { scopeKey, generation, inventoryDigest, stagingDigest, catalogSha256, directory, files };
  if (encodePurgeRoster(roster, catalogSha256, directory, files)?.equals(bytes)) return roster;
}
