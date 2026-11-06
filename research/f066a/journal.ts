import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

export const limits = { body: 1_048_576, insert: 65_536, records: 16, journal: 2_101_248 } as const;
const magic = Buffer.from("AMDRFT", "ascii");
export const header = Buffer.concat([magic, Buffer.of(1)]);
const frameHeader = 40;
const checkpointHeader = 41;
const replacementHeader = 85;
const journalName = "journal";
const stageName = ".journal-stage";
const noFollow = constants.O_NOFOLLOW | constants.O_NONBLOCK;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest();
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

interface Invalid { ok: false; error: "CORRUPT" | "FUTURE" | "LIMIT" }
interface Draft {
  revision: number;
  body: Buffer;
  hash: Buffer;
}
type Replay = Invalid | ({
  ok: true;
  state: "complete" | "degraded";
  records: number;
  verifiedBytes: number;
} & Draft);

const bad = (error: Invalid["error"]): Invalid => ({ ok: false, error });
function validUtf8(body: Buffer) {
  try {
    utf8.decode(body);
    return true;
  } catch {
    return false;
  }
}

export function frame(payload: Buffer) {
  const length = Buffer.alloc(8);
  length.writeUInt32LE(payload.length);
  length.writeUInt32LE((~payload.length) >>> 0, 4);
  return Buffer.concat([length, sha(payload), payload]);
}

export function checkpoint(revision: number, body: Buffer) {
  const prefix = Buffer.alloc(checkpointHeader);
  prefix.writeUInt8(0);
  prefix.writeUInt32LE(revision, 1);
  prefix.writeUInt32LE(body.length, 5);
  sha(body).copy(prefix, 9);
  return frame(Buffer.concat([prefix, body]));
}

export function replacement(
  revision: number, previous: number, from: number, to: number,
  insert: Buffer, base: Buffer, result: Buffer
) {
  const prefix = Buffer.alloc(replacementHeader);
  prefix.writeUInt8(1);
  prefix.writeUInt32LE(revision, 1);
  prefix.writeUInt32LE(previous, 5);
  prefix.writeUInt32LE(from, 9);
  prefix.writeUInt32LE(to, 13);
  prefix.writeUInt32LE(insert.length, 17);
  sha(base).copy(prefix, 21);
  sha(result).copy(prefix, 53);
  return frame(Buffer.concat([prefix, insert]));
}

function decodeCheckpoint(payload: Buffer): Draft | Invalid {
  const revision = payload.readUInt32LE(1);
  const body = payload.subarray(checkpointHeader);
  if (payload[0] !== 0 || !revision || payload.readUInt32LE(5) !== body.length || !validUtf8(body))
    return bad("CORRUPT");
  const hash = sha(body);
  return hash.equals(payload.subarray(9, checkpointHeader)) ? { revision, body, hash } : bad("CORRUPT");
}

function atBoundary(bytes: Buffer, offset: number) {
  return offset === bytes.length || (bytes.readUInt8(offset) & 0xc0) !== 0x80;
}

function decodeReplacement(payload: Buffer, base: Draft): Draft | Invalid {
  const revision = payload.readUInt32LE(1);
  const from = payload.readUInt32LE(9);
  const to = payload.readUInt32LE(13);
  const insert = payload.subarray(replacementHeader);
  if (payload[0] !== 1 || revision !== base.revision + 1 || payload.readUInt32LE(5) !== base.revision ||
      from > to || to > base.body.length || !atBoundary(base.body, from) || !atBoundary(base.body, to) ||
      payload.readUInt32LE(17) !== insert.length || !payload.subarray(21, 53).equals(base.hash) || !validUtf8(insert))
    return bad("CORRUPT");
  if (base.body.length - (to - from) + insert.length > limits.body) return bad("LIMIT");
  const body = Buffer.concat([base.body.subarray(0, from), insert, base.body.subarray(to)]);
  const hash = sha(body);
  return hash.equals(payload.subarray(53, replacementHeader)) ? { revision, body, hash } : bad("CORRUPT");
}

export function replay(bytes: Buffer): Replay {
  if (bytes.length > limits.journal) return bad("LIMIT");
  if (bytes.length < header.length || !bytes.subarray(0, magic.length).equals(magic)) return bad("CORRUPT");
  const version = bytes.readUInt8(magic.length);
  if (version !== 1) return bad(version > 1 ? "FUTURE" : "CORRUPT");
  let cursor = header.length;
  let records = 0;
  let current: Draft | undefined;
  const degraded = (): Replay => current
    ? { ok: true, state: "degraded", records, verifiedBytes: cursor, ...current }
    : bad("CORRUPT");
  while (cursor < bytes.length) {
    if (records === limits.records) return bad("LIMIT");
    const remaining = bytes.length - cursor;
    if (remaining < 4) return degraded();
    const length = bytes.readUInt32LE(cursor);
    const inverse = (~length) >>> 0;
    for (let index = 0; index < Math.min(remaining - 4, 4); index++)
      if (bytes[cursor + 4 + index] !== ((inverse >>> (8 * index)) & 0xff)) return bad("CORRUPT");
    const minimum = current ? replacementHeader : checkpointHeader;
    if (length < minimum) return bad("CORRUPT");
    if (length > minimum + (current ? limits.insert : limits.body)) return bad("LIMIT");
    if (remaining < 8) return degraded();
    const end = cursor + frameHeader + length;
    if (end > bytes.length) return degraded();
    const payload = bytes.subarray(cursor + frameHeader, end);
    if (!sha(payload).equals(bytes.subarray(cursor + 8, cursor + frameHeader))) return bad("CORRUPT");
    const decoded = current ? decodeReplacement(payload, current) : decodeCheckpoint(payload);
    if ("error" in decoded) return decoded;
    current = decoded;
    records++;
    cursor = end;
  }
  return current ? { ok: true, state: "complete", records, verifiedBytes: cursor, ...current } : bad("CORRUPT");
}

class StorageFault extends Error {
  constructor(readonly code: "LIMIT" | "UNAVAILABLE" | "UNKNOWN") { super(code); }
}

function sameIdentity(a: BigIntStats, b: BigIntStats) {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs &&
    a.uid === b.uid && a.mode === b.mode;
}
function sameFile(a: BigIntStats, b: BigIntStats) {
  return sameIdentity(a, b) && a.size === b.size && a.nlink === b.nlink &&
    a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function privateFile(stat: BigIntStats) {
  return stat.isFile() && stat.nlink === 1n && stat.uid === BigInt(process.geteuid!()) && (stat.mode & 0o7777n) === 0o600n;
}
function privateDirectory(stat: BigIntStats) {
  return stat.isDirectory() && stat.uid === BigInt(process.geteuid!()) && (stat.mode & 0o7777n) === 0o700n;
}
async function closeKnown(file: FileHandle) {
  try { await file.close(); }
  catch { throw new StorageFault("UNKNOWN"); }
}

async function readExact(path: string) {
  const named = await lstat(path, { bigint: true });
  if (!privateFile(named)) throw new StorageFault("UNAVAILABLE");
  if (named.size > BigInt(limits.journal)) throw new StorageFault("LIMIT");
  const file = await open(path, constants.O_RDONLY | noFollow);
  try {
    const before = await file.stat({ bigint: true });
    if (!sameFile(named, before)) throw new StorageFault("UNAVAILABLE");
    const storage = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < storage.length) {
      const { bytesRead } = await file.read(storage, length, storage.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (BigInt(length) !== before.size || !sameFile(before, after) ||
        !sameFile(after, await lstat(path, { bigint: true }))) throw new StorageFault("UNAVAILABLE");
    return { bytes: storage.subarray(0, length), stat: after };
  } finally {
    await closeKnown(file);
  }
}

async function holdDirectory(directory: string) {
  const expected = await lstat(directory, { bigint: true });
  if (!privateDirectory(expected)) throw new StorageFault("UNAVAILABLE");
  const dir = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | noFollow);
  const check = async () => {
    if (!sameIdentity(expected, await dir.stat({ bigint: true })) ||
        !sameIdentity(expected, await lstat(directory, { bigint: true })))
      throw new StorageFault("UNAVAILABLE");
  };
  try {
    await check();
    return { dir, check };
  } catch (error) {
    await closeKnown(dir);
    throw error;
  }
}

async function writeAll(file: FileHandle, bytes: Buffer, position: number) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset, position + offset);
    if (!bytesWritten) throw new StorageFault("UNKNOWN");
    offset += bytesWritten;
  }
}

export async function writeJournal(directory: string, frames: readonly Buffer[]) {
  if (frames.length > limits.records ||
      header.length + frames.reduce((size, bytes) => size + bytes.length, 0) > limits.journal)
    return { ok: false as const, error: "LIMIT" };
  const expected = replay(Buffer.concat([header, ...frames]));
  if (!expected.ok || expected.state !== "complete" || expected.records !== frames.length)
    return { ok: false as const, error: expected.ok ? "CORRUPT" : expected.error };
  let attempted = false;
  try {
    const { dir, check } = await holdDirectory(directory);
    try {
      const file = await open(join(directory, journalName), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
      attempted = true;
      try {
        await writeAll(file, header, 0);
        let position = header.length;
        for (const bytes of frames) {
          await writeAll(file, bytes, position);
          await file.sync();
          position += bytes.length;
        }
      } finally {
        await closeKnown(file);
      }
      await check();
      await dir.sync();
      await check();
      return { ok: true as const, bytes: expected.verifiedBytes, records: expected.records, fileSyncs: frames.length, directorySynced: true };
    } finally {
      await closeKnown(dir);
    }
  } catch (error) {
    return { ok: false as const, error: attempted ? "UNKNOWN" : error instanceof StorageFault ? error.code : "UNAVAILABLE" };
  }
}

export async function readJournal(directory: string) {
  try {
    const { bytes } = await readExact(join(directory, journalName));
    return { ...replay(bytes), journalBytes: bytes.length, journalSha256: sha(bytes).toString("hex") };
  } catch (error) {
    return { ok: false as const, error: error instanceof StorageFault ? error.code : "UNAVAILABLE" };
  }
}

export async function compactJournal(directory: string, fault?: "before-rename" | "before-directory-sync") {
  const path = join(directory, journalName);
  const stage = join(directory, stageName);
  let renameAttempted = false;
  try {
    const { dir, check } = await holdDirectory(directory);
    try {
      const original = await readExact(path);
      const restored = replay(original.bytes);
      if (!restored.ok) return restored;
      if (restored.state !== "complete") return { ok: false as const, error: "DEGRADED" };
      const contents = Buffer.concat([header, checkpoint(restored.revision, restored.body)]);
      const file = await open(stage, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
      let pinnedStage: BigIntStats | undefined;
      let stageClosed = false;
      const cleanup = async () => {
        try {
          await check();
          const named = await lstat(stage, { bigint: true });
          if (!pinnedStage || !privateFile(named) || !sameIdentity(pinnedStage, named)) throw Error();
          await unlink(stage);
        } catch {
          throw new StorageFault("UNKNOWN");
        }
      };
      try {
        try {
          pinnedStage = await file.stat({ bigint: true });
          if (!privateFile(pinnedStage)) throw new StorageFault("UNAVAILABLE");
          await writeAll(file, contents, 0);
          await file.sync();
          pinnedStage = await file.stat({ bigint: true });
        } finally {
          await closeKnown(file);
          stageClosed = true;
        }
        await check();
        if (!sameFile(pinnedStage, await lstat(stage, { bigint: true })) ||
            !sameFile(original.stat, await lstat(path, { bigint: true }))) throw new StorageFault("UNAVAILABLE");
        if (fault === "before-rename") return { ok: false as const, error: "INJECTED_BEFORE_RENAME" };
        renameAttempted = true;
        await rename(stage, path);
        if (fault === "before-directory-sync") return { ok: false as const, error: "UNKNOWN" };
        await check();
        await dir.sync();
        const installed = await readExact(path);
        await check();
        if (!sameIdentity(pinnedStage, installed.stat) || !installed.bytes.equals(contents)) throw new StorageFault("UNKNOWN");
        return { ok: true as const, bytes: contents.length, fileSynced: true, directorySynced: true };
      } finally {
        if (!renameAttempted && stageClosed) await cleanup();
      }
    } finally {
      await closeKnown(dir);
    }
  } catch (error) {
    return { ok: false as const, error: renameAttempted ? "UNKNOWN" : error instanceof StorageFault ? error.code : "UNAVAILABLE" };
  }
}
