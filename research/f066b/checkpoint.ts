import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync,
  readFileSync, readSync, realpathSync, writeSync, type BigIntStats,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";

import { checkpoint, header, limits, replay } from "../f066a/journal";

export const leaf = "checkpoint";
export const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const maxCheckpointBytes = header.length + checkpoint(1, Buffer.alloc(0)).length + limits.body;
const bunSha = "539598c775882420b9d8deb7dc14d845f20f7d26f5600c50ab067dde6ac3f3bf";
const addonSha = "da67bd1538d61fe704911dcb92b3dfe0d66d51f2422d06f86532f2236808bb2d";

interface Native {
  openDirectoryAt(fd: number, name: string): number;
  openFileAt(fd: number, name: string): number;
  scanStat(fd: number, name: string): { kind: string; fingerprint: string };
  createTemp(fd: number, name: string): number;
  publishExclusive(fd: number, stage: string, name: string): number;
}

function versionReceipt(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("version" in value) || !("hash" in value)) return;
  if (value.version === "0.1.0-alpha.257" && value.hash === "jjlf01wccju2") return value.version;
  if (value.version === "0.1.0-alpha.263" && value.hash === "28g0jfzp8nal4") return value.version;
}

export function loadPackagedNative() {
  const executable = realpathSync(process.execPath);
  const contents = dirname(dirname(executable));
  if (process.platform !== "darwin" || process.arch !== "arm64" || Bun.version !== "1.4.0" ||
      basename(dirname(contents)) !== "Agentic Markdown-canary.app" ||
      executable !== join(contents, "MacOS", "bun") || digest(readFileSync(executable)) !== bunSha)
    throw Error("Run with the pinned packaged Bun");
  const resources = join(contents, "Resources");
  const version = versionReceipt(JSON.parse(readFileSync(join(resources, "version.json"), "utf8")));
  const addon = join(resources, "app", "native", "save-primitives.node");
  if (!version || realpathSync(addon) !== addon || digest(readFileSync(addon)) !== addonSha)
    throw Error("Packaged native receipt mismatch");
  const loaded: unknown = createRequire(import.meta.url)(addon);
  if (typeof loaded !== "object" || loaded === null ||
      !["openDirectoryAt", "openFileAt", "scanStat", "createTemp", "publishExclusive"].every(
        (name) => typeof Reflect.get(loaded, name) === "function"
      )) throw Error("Packaged native methods unavailable");
  return { native: loaded as Native, version, bunSha, addonSha };
}

type ErrorCode = "MISSING" | "BUSY" | "CORRUPT" | "FUTURE" | "LIMIT" | "UNAVAILABLE" | "UNKNOWN" | "INJECTED_BEFORE_PUBLISH";
interface Receipt { ok: true; revision: number; bytes: number; sha256: string }
export type Result = Receipt | { ok: false; error: ErrorCode };
class Fault extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}
const statFd = (fd: number) => fstatSync(fd, { bigint: true });
const fingerprint = (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
const identity = (a: BigIntStats, b: BigIntStats) =>
  fingerprint(a) === fingerprint(b) && a.uid === b.uid && a.mode === b.mode;
const sameFile = (a: BigIntStats, b: BigIntStats) => identity(a, b) && a.nlink === b.nlink &&
  a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const isPrivate = (stat: BigIntStats, mode: bigint) =>
  process.geteuid?.() !== undefined && stat.uid === BigInt(process.geteuid()) && (stat.mode & 0o7777n) === mode;

function closeKnown(fd: number): void {
  try { closeSync(fd); } catch { throw new Fault("UNKNOWN"); }
}

function decode(bytes: Buffer) {
  const decoded = replay(bytes);
  if (!decoded.ok) throw new Fault(decoded.error);
  if (decoded.state !== "complete" || decoded.records !== 1 || decoded.verifiedBytes !== bytes.length)
    throw new Fault("CORRUPT");
  return decoded;
}

interface HeldSlot { native: Native; fd: number; path: string; check(): void }

function withSlot(native: Native, path: string, action: (slot: HeldSlot) => Receipt): Result {
  try {
    const root = dirname(path);
    if (realpathSync(path) !== path) throw new Fault("UNAVAILABLE");
    const rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const rootStat = statFd(rootFd);
      if (!rootStat.isDirectory() || !isPrivate(rootStat, 0o700n)) throw new Fault("UNAVAILABLE");
      const name = basename(path);
      const fd = native.openDirectoryAt(rootFd, name);
      try {
        const stat = statFd(fd);
        const check = () => {
          if (realpathSync(root) !== root || !identity(rootStat, statFd(rootFd)) ||
              !identity(rootStat, lstatSync(root, { bigint: true })) || !identity(stat, statFd(fd)) ||
              !identity(stat, lstatSync(path, { bigint: true })) ||
              native.scanStat(rootFd, name).fingerprint !== fingerprint(stat)) throw new Fault("UNAVAILABLE");
        };
        if (!stat.isDirectory() || !isPrivate(stat, 0o700n)) throw new Fault("UNAVAILABLE");
        check();
        return action({ native, fd, path, check });
      } finally { closeKnown(fd); }
    } finally { closeKnown(rootFd); }
  } catch (error) {
    return { ok: false, error: error instanceof Fault ? error.code : "UNAVAILABLE" };
  }
}

function assertName(slot: HeldSlot, name: string, stat: BigIntStats) {
  const entry = slot.native.scanStat(slot.fd, name);
  if (entry.kind !== "file" || entry.fingerprint !== fingerprint(stat)) throw new Fault("UNAVAILABLE");
}

function read(slot: HeldSlot) {
  slot.check();
  const named = lstatSync(join(slot.path, leaf), { bigint: true, throwIfNoEntry: false });
  if (!named) {
    slot.check();
    throw new Fault("MISSING");
  }
  if (!named.isFile() || !isPrivate(named, 0o600n) || named.nlink !== 1n) throw new Fault("UNAVAILABLE");
  if (named.size > BigInt(maxCheckpointBytes)) throw new Fault("LIMIT");
  const fd = slot.native.openFileAt(slot.fd, leaf);
  let bytes: Buffer;
  try {
    if (!sameFile(named, statFd(fd))) throw new Fault("UNAVAILABLE");
    const storage = Buffer.alloc(Number(named.size) + 1);
    let length = 0;
    while (length < storage.length) {
      const count = readSync(fd, storage, length, storage.length - length, length);
      if (!count) break;
      length += count;
    }
    if (BigInt(length) !== named.size || !sameFile(named, statFd(fd))) throw new Fault("UNAVAILABLE");
    bytes = storage.subarray(0, length);
  } finally { closeKnown(fd); }
  slot.check();
  assertName(slot, leaf, named);
  if (!sameFile(named, lstatSync(join(slot.path, leaf), { bigint: true }))) throw new Fault("UNAVAILABLE");
  const draft = decode(bytes);
  return { receipt: { ok: true as const, revision: draft.revision, bytes: draft.body.length, sha256: draft.hash.toString("hex") }, bytes, stat: named };
}

export function readCheckpoint(native: Native, path: string): Result {
  return withSlot(native, path, (slot) => read(slot).receipt);
}

export function publishCheckpoint(
  native: Native, path: string, revision: number, body: Buffer,
  fault?: "before-publish" | "before-directory-sync"
): Result {
  if (body.length > limits.body) return { ok: false, error: "LIMIT" };
  if (!Number.isInteger(revision) || revision < 1 || revision > 0xffff_ffff)
    return { ok: false, error: "CORRUPT" };
  const bytes = Buffer.concat([header, checkpoint(revision, body)]);
  return withSlot(native, path, (slot) => {
    decode(bytes);
    const stage = `.agentic-save-${randomUUID()}`;
    const fd = slot.native.createTemp(slot.fd, stage);
    let staged: BigIntStats;
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset, offset);
        if (!written) throw new Fault("UNAVAILABLE");
        offset += written;
      }
      fsyncSync(fd);
      staged = statFd(fd);
      if (!staged.isFile() || !isPrivate(staged, 0o600n) || staged.nlink !== 1n || staged.size !== BigInt(bytes.length))
        throw new Fault("UNAVAILABLE");
    } finally { closeKnown(fd); }
    slot.check();
    assertName(slot, stage, staged);
    if (!sameFile(staged, lstatSync(join(slot.path, stage), { bigint: true })))
      throw new Fault("UNAVAILABLE");
    if (fault === "before-publish") throw new Fault("INJECTED_BEFORE_PUBLISH");
    // On failure the private experiment retains staging evidence for the parent.
    try {
      if (slot.native.publishExclusive(slot.fd, stage, leaf) !== 0) throw new Fault("UNKNOWN");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "PUBLISH_EXISTS") throw new Fault("BUSY");
      if (error instanceof Error && "code" in error && error.code === "PUBLISH_UNSUPPORTED") throw new Fault("UNAVAILABLE");
      throw new Fault("UNKNOWN");
    }
    try {
      if (fault === "before-directory-sync") throw new Fault("UNKNOWN");
      fsyncSync(slot.fd);
      const installed = read(slot);
      if (!identity(staged, installed.stat) || !bytes.equals(installed.bytes)) throw new Fault("UNKNOWN");
      return installed.receipt;
    } catch { throw new Fault("UNKNOWN"); }
  });
}
