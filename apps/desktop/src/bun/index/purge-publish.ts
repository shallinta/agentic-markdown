import { randomUUID } from "node:crypto";
import { closeSync, fstatSync, fsyncSync, lstatSync, opendirSync, writeSync, type BigIntStats, type Dir } from "node:fs";
import { join } from "node:path";

import { sameIndexInventoryMetadata } from "./cache-footprint";
import { INDEX_RECLAIM_RECORD_NAMES, type ReclaimRecord } from "./purge-roster";
import { loadReclaimPublisher } from "./reclaim-stage";
import { IndexReuseCleanupError, reclaimDirectoryName, type HeldCompletionPlacement, type HeldIndexPlacement } from "./reuse-catalog";

type Destination = ReclaimRecord | "catalog";
interface HeldProfile {
  profileFd: number;
  check: () => void;
  checkProfile: () => void;
}

function closeProfile(directory: Dir) {
  try {
    directory.closeSync();
  } catch {
    throw new IndexReuseCleanupError("Purge roster profile close unconfirmed");
  }
}

function assertStagedLayout(profile: string, temporary: string, held: HeldProfile, destination: Destination) {
  held.check();
  const names = new Set(["catalog.json", ".lease", temporary]);
  if (destination === "catalog") names.add(INDEX_RECLAIM_RECORD_NAMES.complete);
  else names.add(reclaimDirectoryName("pending"));
  if (destination !== "purge") names.add(INDEX_RECLAIM_RECORD_NAMES.purge);
  const directory = opendirSync(profile, { bufferSize: names.size });
  try {
    while (names.size) {
      const entry = directory.readSync();
      if (!entry || !names.delete(entry.name)) throw Error("Purge roster staging layout changed");
    }
    if (directory.readSync()) throw Error("Purge roster staging layout changed");
  } finally {
    closeProfile(directory);
  }
  held.check();
}

function sameOwnedFile(original: BigIntStats, current: BigIntStats) {
  return current.isFile() && original.dev === current.dev && original.ino === current.ino &&
    original.birthtimeNs === current.birthtimeNs && original.uid === current.uid &&
    original.mode === current.mode && current.nlink === 1n;
}

function closeTemporary(fd: number) {
  try {
    closeSync(fd);
  } catch {
    throw new IndexReuseCleanupError("Purge roster temporary close unconfirmed");
  }
}

export function publishReclaimRecord(
  profile: string, held: HeldIndexPlacement, contents: Buffer, beforeCommit: () => void, destination: ReclaimRecord
) {
  return publishIndexRecord(profile, { ...held, check: () => held.check("pending") }, contents, beforeCommit, destination);
}

export function replaceReclaimCatalog(
  profile: string, held: HeldCompletionPlacement, contents: Buffer, beforeCommit: () => void
) {
  return publishIndexRecord(profile, { ...held, check: held.checkAbsent }, contents, beforeCommit, "catalog");
}

function publishIndexRecord(
  profile: string, held: HeldProfile, contents: Buffer, beforeCommit: () => void, destination: Destination
) {
  const native = loadReclaimPublisher(destination);
  if (!native) return { ok: false as const, error: "UNAVAILABLE" as const };
  const temporary = `.agentic-save-${randomUUID()}`;
  const path = join(profile, temporary);
  held.check();
  const owner = fstatSync(held.profileFd, { bigint: true }).uid;
  const fd = native.create(held.profileFd, temporary);
  let initial: BigIntStats | undefined;
  let cleanup = true;
  const clean = () => {
    try {
      held.checkProfile();
      if (initial?.uid !== owner || (initial.mode & 0o7777n) !== 0o600n ||
          !sameOwnedFile(initial, lstatSync(path, { bigint: true })))
        throw Error("Purge roster temporary identity changed");
      native.remove(held.profileFd, temporary);
    } catch {
      throw new IndexReuseCleanupError("Purge roster temporary cleanup unconfirmed");
    }
  };
  try {
    initial = fstatSync(fd, { bigint: true });
    if (!initial.isFile() || initial.uid !== owner || initial.nlink !== 1n || initial.size !== 0n ||
        (initial.mode & 0o7777n) !== 0o600n)
      throw Error("Purge roster temporary unavailable");
    let written = 0;
    while (written < contents.length) {
      const size = writeSync(fd, contents, written, contents.length - written, written);
      if (size <= 0) throw Error("Purge roster temporary short write");
      written += size;
    }
    fsyncSync(fd);
    const staged = fstatSync(fd, { bigint: true });
    beforeCommit();
    assertStagedLayout(profile, temporary, held, destination);
    if (!sameOwnedFile(initial, staged) || staged.size !== BigInt(contents.length) ||
        !sameIndexInventoryMetadata(staged, fstatSync(fd, { bigint: true })) ||
        !sameIndexInventoryMetadata(staged, lstatSync(path, { bigint: true })))
      throw Error("Purge roster staging identity changed");
    const outcome = native.publish(held.profileFd, temporary);
    if (outcome === "UNKNOWN") cleanup = false;
    if (outcome !== "published") return { ok: false as const, error: outcome };
    cleanup = false;
    try {
      const installed = fstatSync(fd, { bigint: true });
      const name = destination === "catalog" ? "catalog.json" : INDEX_RECLAIM_RECORD_NAMES[destination];
      if (!sameOwnedFile(staged, installed) || staged.size !== installed.size || staged.mtimeNs !== installed.mtimeNs ||
          !sameIndexInventoryMetadata(installed, lstatSync(join(profile, name), { bigint: true })))
        throw Error("Purge roster publication changed");
      return { ok: true as const, installed };
    } catch {
      throw new IndexReuseCleanupError("Purge roster publication unconfirmed");
    }
  } finally {
    try {
      if (cleanup) clean();
    } finally {
      closeTemporary(fd);
    }
  }
}
