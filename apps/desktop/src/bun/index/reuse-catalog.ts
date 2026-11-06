import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  renameSync,
  unlinkSync,
  type BigIntStats,
} from "node:fs";
import { lstat, mkdir, open, rmdir, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { INDEX_LIMITS, keys, natural, record } from "./protocol";

const maxCatalogBytes = 4096;
const digest = /^[a-f0-9]{64}$/;
const indexId = /^[A-Za-z0-9-]{1,32}$/;

export class IndexReuseCleanupError extends Error {}

export interface IndexReuseCatalog {
  version: 1;
  profile: "limited-v1";
  scopeKey: string;
  generation: number;
  entries: readonly { id: string; hash: string }[];
}

export interface IndexRetirementTarget { scopeKey: string; generation: number }
export interface IndexReclaimIntentTarget extends IndexRetirementTarget { inventoryDigest: string }
export interface PreparedReclaimCatalog extends IndexReclaimIntentTarget {
  version: 3;
  profile: "limited-v1";
  state: "reclaim-prepared";
  stagingDigest: string;
}
export type ReclaimPlacement = "original" | "pending";
export const reclaimDirectoryName = (placement: ReclaimPlacement) =>
  placement === "original" ? "index" : ".reclaim-pending";
interface RetiredCatalogBase extends IndexRetirementTarget {
  profile: "limited-v1";
  state: "retired";
}
type RetiredCatalog = RetiredCatalogBase &
  ({ version: 1 } | { version: 2; inventoryDigest: string });

export interface IndexReuseInventoryIdentity {
  catalog: BigIntStats;
  index: BigIntStats;
}

type CatalogRead =
  | { status: "cold" }
  | { status: "existing"; catalog: IndexReuseCatalog; identity: IndexReuseInventoryIdentity }
  | { status: "retired"; catalog: RetiredCatalog; identity: IndexReuseInventoryIdentity }
  | { status: "prepared"; catalog: PreparedReclaimCatalog; identity: IndexReuseInventoryIdentity; placement: ReclaimPlacement }
  | { status: "invalid" };

interface IndexReuseSlot {
  indexPath: string;
  assertInventoryLease(this: void): BigIntStats;
  assertCatalogIdentity(identity: IndexReuseInventoryIdentity): void;
  readCatalog(): Promise<CatalogRead>;
  readPrepareCatalog(): Promise<CatalogRead>;
  readStageCatalog(): Promise<CatalogRead>;
  writeCatalog(catalog: IndexReuseCatalog, beforeCommit?: () => void): Promise<void>;
  retireCatalog(
    target: IndexRetirementTarget, identity: IndexReuseInventoryIdentity,
    beforeCommit: () => void, inventoryDigest?: string
  ): Promise<void>;
  prepareReclaimCatalog(
    marker: PreparedReclaimCatalog,
    identity: IndexReuseInventoryIdentity,
    proof: { alreadyPrepared: boolean; beforeCommit: () => void; verifyNative: () => void }
  ): Promise<void>;
  withStageDirectories<Result>(
    placement: ReclaimPlacement, identity: IndexReuseInventoryIdentity,
    openOriginal: ((profileFd: number) => number) | undefined,
    use: (held: {
      profileFd: number; indexFd: number;
      check: (placement: ReclaimPlacement) => void;
      sync: () => Promise<void>;
    }) => Promise<Result>
  ): Promise<Result>;
  release(): Promise<void>;
}

type AcquireResult =
  | { ok: true; slot: IndexReuseSlot }
  | { ok: false; error: "BUSY" | "UNAVAILABLE" | "UNKNOWN" };

function validCatalog(value: unknown): value is IndexReuseCatalog {
  if (
    !record(value) ||
    !keys(value, "entries,generation,profile,scopeKey,version") ||
    value.version !== 1 ||
    value.profile !== "limited-v1" ||
    typeof value.scopeKey !== "string" ||
    !digest.test(value.scopeKey) ||
    !natural(value.generation) ||
    !Array.isArray(value.entries) ||
    (value.generation === 0 && value.entries.length > 0) ||
    value.entries.length > INDEX_LIMITS.documents ||
    Object.keys(value.entries).length !== value.entries.length
  )
    return false;
  const seen = new Set<string>();
  for (let index = 0; index < value.entries.length; index++) {
    const item: unknown = value.entries[index];
    if (
      !Object.prototype.hasOwnProperty.call(value.entries, index) ||
      !record(item) ||
      !keys(item, "hash,id") ||
      typeof item.id !== "string" ||
      !indexId.test(item.id) ||
      typeof item.hash !== "string" ||
      !digest.test(item.hash) ||
      seen.has(item.id)
    )
      return false;
    seen.add(item.id);
  }
  return true;
}

export function readIndexRetirementTarget(value: unknown): IndexRetirementTarget | undefined {
  if (!record(value) || !keys(value, "generation,scopeKey")) return;
  const { scopeKey, generation } = value;
  if (typeof scopeKey === "string" && digest.test(scopeKey) && natural(generation))
    return { scopeKey, generation };
}

export function readIndexReclaimIntentTarget(value: unknown): IndexReclaimIntentTarget | undefined {
  if (!record(value) || !keys(value, "generation,inventoryDigest,scopeKey")) return;
  const { scopeKey, generation, inventoryDigest } = value;
  if (typeof scopeKey === "string" && digest.test(scopeKey) && natural(generation) &&
      typeof inventoryDigest === "string" && digest.test(inventoryDigest))
    return { scopeKey, generation, inventoryDigest };
}

function validPreparedCatalog(value: unknown): value is PreparedReclaimCatalog {
  return record(value) && keys(value, "generation,inventoryDigest,profile,scopeKey,stagingDigest,state,version") &&
    value.version === 3 && value.profile === "limited-v1" && value.state === "reclaim-prepared" &&
    typeof value.scopeKey === "string" && digest.test(value.scopeKey) && natural(value.generation) &&
    typeof value.inventoryDigest === "string" && digest.test(value.inventoryDigest) &&
    typeof value.stagingDigest === "string" && digest.test(value.stagingDigest);
}

function validRetiredCatalog(value: unknown): value is RetiredCatalog {
  if (!record(value) || value.profile !== "limited-v1" || value.state !== "retired" ||
      typeof value.scopeKey !== "string" || !digest.test(value.scopeKey) || !natural(value.generation))
    return false;
  if (value.version === 1) return keys(value, "generation,profile,scopeKey,state,version");
  return value.version === 2 && keys(value, "generation,inventoryDigest,profile,scopeKey,state,version") &&
    typeof value.inventoryDigest === "string" && digest.test(value.inventoryDigest);
}

function hasCode(error: unknown, code: string) {
  return record(error) && error.code === code;
}

function present(path: string): BigIntStats | undefined {
  try {
    return lstatSync(path, { bigint: true });
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}

function sameInode(left: BigIntStats, right: BigIntStats) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFile(left: BigIntStats, right: BigIntStats) {
  return sameInode(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

function sameRenameStableMetadata(before: BigIntStats, after: BigIntStats) {
  return sameInode(before, after) && before.birthtimeNs === after.birthtimeNs &&
    before.uid === after.uid && before.mode === after.mode && before.nlink === after.nlink &&
    before.size === after.size && before.mtimeNs === after.mtimeNs;
}

async function closeCatalogFile(file: FileHandle) {
  try {
    await file.close();
  } catch {
    throw new IndexReuseCleanupError("Index reuse catalog file close unconfirmed");
  }
}

export async function acquireIndexReuseSlot(directory: string): Promise<AcquireResult> {
  const uid = process.getuid?.();
  if (uid === undefined || !isAbsolute(directory) || resolve(directory) !== directory)
    return { ok: false, error: "UNAVAILABLE" };
  const owner = BigInt(uid);
  const leasePath = join(directory, ".lease");
  const catalogPath = join(directory, "catalog.json");
  const indexPath = join(directory, "index");
  const pendingPath = join(directory, ".reclaim-pending");
  const placementPath = (placement: ReclaimPlacement) => join(directory, reclaimDirectoryName(placement));
  const ownedDirectory = (stat: BigIntStats) => stat.isDirectory() && stat.uid === owner;
  const privateDirectory = (stat: BigIntStats) =>
    ownedDirectory(stat) && (stat.mode & 0o077n) === 0n;
  const privateFile = (stat: BigIntStats) =>
    stat.isFile() && stat.uid === owner && stat.nlink === 1n &&
    (stat.mode & 0o077n) === 0n;

  let leaseCreated = false;
  try {
    const directoryStat = await lstat(directory, { bigint: true });
    if (!privateDirectory(directoryStat)) return { ok: false, error: "UNAVAILABLE" };
    try {
      await mkdir(leasePath, { mode: 0o700 });
      leaseCreated = true;
    } catch (error) {
      return { ok: false, error: hasCode(error, "EEXIST") ? "BUSY" : "UNAVAILABLE" };
    }
    const leaseStat = await lstat(leasePath, { bigint: true });
    let released = false;
    const assertLease = (inventory = false) => {
      const root = present(directory);
      const lease = present(leasePath);
      if (
        released ||
        !root || !privateDirectory(root) || !sameInode(directoryStat, root) ||
        !lease || !privateDirectory(lease) || !sameInode(leaseStat, lease) ||
        (inventory && (lease.mode !== leaseStat.mode || lease.nlink !== leaseStat.nlink || !sameFile(leaseStat, lease)))
      )
        throw Error("Index reuse lease unavailable");
      return root;
    };
    assertLease();
    const assertCatalogFile = (expected: BigIntStats) => {
      const catalog = present(catalogPath);
      if (!catalog || !privateFile(catalog) || !sameFile(expected, catalog) || catalog.mode !== expected.mode)
        throw Error("Index reuse catalog identity changed");
    };
    const assertCatalogIdentity = (identity: IndexReuseInventoryIdentity) => {
      assertLease(true);
      assertCatalogFile(identity.catalog);
      const index = present(indexPath);
      if (!index || !ownedDirectory(index) || !sameFile(identity.index, index) ||
          index.mode !== identity.index.mode || index.nlink !== identity.index.nlink)
        throw Error("Index reuse catalog or index identity changed");
    };

    async function publishCatalog(
      value: IndexReuseCatalog | RetiredCatalog | PreparedReclaimCatalog,
      beforeCommit?: () => void,
      identity?: IndexReuseInventoryIdentity
    ) {
      assertLease();
      const contents = JSON.stringify(value);
      if (Buffer.byteLength(contents) > maxCatalogBytes)
        throw Error("Index reuse catalog exceeds limit");
      const tempPath = join(directory, `.catalog-${randomUUID()}.tmp`);
      let created = false;
      let staged: BigIntStats | undefined;
      let written: BigIntStats | undefined;
      const cleanStaging = () => {
        try {
          const root = present(directory);
          if (!staged || !root || !sameInode(directoryStat, root))
            throw Error("Index reuse staging identity changed");
          const temp = present(tempPath);
          if (temp) {
            if (!sameInode(staged, temp))
              throw Error("Index reuse staging identity changed");
            unlinkSync(tempPath);
          }
        } catch {
          throw new IndexReuseCleanupError("Index reuse staging cleanup unconfirmed");
        }
      };
      try {
        const file = await open(
          tempPath,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600
        );
        created = true;
        try {
          staged = await file.stat({ bigint: true });
          if (!privateFile(staged)) throw Error("Index reuse catalog staging unavailable");
          await file.writeFile(contents);
          await file.sync();
          if (identity) written = await file.stat({ bigint: true });
        } finally {
          await closeCatalogFile(file);
        }
        assertLease();
        const temp = present(tempPath);
        const target = present(catalogPath);
        const index = present(indexPath);
        if (!temp || !privateFile(temp) || !sameInode(staged, temp) ||
            (target && !privateFile(target)) || !index || !ownedDirectory(index))
          throw Error("Index reuse catalog publication unavailable");
        beforeCommit?.();
        if (identity) {
          assertCatalogIdentity(identity);
          const latest = present(tempPath);
          if (!written || !latest || !privateFile(written) || !privateFile(latest) ||
              !sameInode(staged, written) || !sameFile(written, latest) ||
              latest.size !== BigInt(Buffer.byteLength(contents)))
            throw Error("Index retirement staging changed");
        }
        try {
          renameSync(tempPath, catalogPath);
        } catch (error) {
          if (value.version === 3) throw new IndexReuseCleanupError("Index reclaim preparation publication unconfirmed");
          throw error;
        }
        return written;
      } catch (error) {
        if (created) cleanStaging();
        throw error;
      }
    }

    async function readCatalog(mode: "ordinary" | "prepare" | "stage" = "ordinary"): Promise<CatalogRead> {
      try {
        assertLease();
        const original = present(indexPath);
        const pending = present(pendingPath);
        if (pending && (mode === "ordinary" || (mode === "stage" ? original : !original)))
          return { status: "invalid" };
        const placement = pending && !original ? "pending" : "original";
        const index = original ?? pending;
        const catalog = present(catalogPath);
        if (!index && !catalog) return { status: "cold" };
        if (!index || !ownedDirectory(index) || !catalog || !privateFile(catalog) ||
            catalog.size > BigInt(maxCatalogBytes))
          return { status: "invalid" };
        const file = await open(
          catalogPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
        );
        let value: unknown;
        try {
          const opened = await file.stat({ bigint: true });
          if (!privateFile(opened) || !sameFile(opened, catalog))
            return { status: "invalid" };
          const bytes = Buffer.alloc(Number(opened.size) + 1);
          let length = 0;
          while (length < bytes.length) {
            const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
            if (!bytesRead) break;
            length += bytesRead;
          }
          const after = await file.stat({ bigint: true });
          if (!privateFile(after) || !sameFile(opened, after) || BigInt(length) !== opened.size)
            return { status: "invalid" };
          value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
            .decode(bytes.subarray(0, length)));
        } finally {
          await closeCatalogFile(file);
        }
        assertLease();
        const latestCatalog = present(catalogPath);
        const latestIndex = present(placementPath(placement));
        if (!latestCatalog || !privateFile(latestCatalog) || !sameFile(catalog, latestCatalog) ||
            !latestIndex || !ownedDirectory(latestIndex) || !sameInode(index, latestIndex) ||
            (mode !== "prepare" && present(placement === "original" ? pendingPath : indexPath)))
          return { status: "invalid" };
        const identity = { catalog, index };
        if (validPreparedCatalog(value)) return { status: "prepared", catalog: value, identity, placement };
        if (placement === "original" && validCatalog(value)) return { status: "existing", catalog: value, identity };
        if (placement === "original" && validRetiredCatalog(value)) return { status: "retired", catalog: value, identity };
        return { status: "invalid" };
      } catch (error) {
        if (error instanceof IndexReuseCleanupError) throw error;
        return { status: "invalid" };
      }
    }

    function assertProfileDescriptor(profile: FileHandle) {
      const current = assertLease(true);
      const held = fstatSync(profile.fd, { bigint: true });
      if (!privateDirectory(held) || !sameInode(current, held) ||
          directoryStat.birthtimeNs !== held.birthtimeNs || directoryStat.mode !== held.mode ||
          current.mode !== held.mode)
        throw Error("Index reclaim profile unavailable");
    }

    function assertReclaimProfile(profile: FileHandle) {
      assertProfileDescriptor(profile);
      if (present(pendingPath)) throw Error("Index reclaim alternate already present");
    }

    function closeStageDescriptor(fd: number) {
      try {
        closeSync(fd);
      } catch {
        throw new IndexReuseCleanupError("Index staging descriptor close unconfirmed");
      }
    }

    async function syncReclaimCatalog(
      profile: FileHandle, expected: PreparedReclaimCatalog, staged: BigIntStats, verifyNative: () => void
    ) {
      try {
        assertReclaimProfile(profile);
        await profile.sync();
        const saved = await readCatalog();
        if (saved.status !== "prepared" ||
            saved.catalog.scopeKey !== expected.scopeKey || saved.catalog.generation !== expected.generation ||
            saved.catalog.inventoryDigest !== expected.inventoryDigest || saved.catalog.stagingDigest !== expected.stagingDigest ||
            !sameRenameStableMetadata(staged, saved.identity.catalog))
          throw Error("Index reclaim preparation changed");
        assertReclaimProfile(profile);
        assertCatalogIdentity(saved.identity);
        verifyNative();
      } catch {
        throw new IndexReuseCleanupError("Index reclaim preparation sync or confirmation unconfirmed");
      }
    }

    return {
      ok: true,
      slot: {
        indexPath,
        assertInventoryLease: () => assertLease(true),
        assertCatalogIdentity,
        readCatalog: () => readCatalog(),
        readPrepareCatalog: () => readCatalog("prepare"),
        readStageCatalog: () => readCatalog("stage"),
        async writeCatalog(catalog, beforeCommit) {
          if (!validCatalog(catalog)) throw Error("Invalid index reuse catalog");
          await publishCatalog(catalog, beforeCommit);
        },
        async retireCatalog(target, identity, beforeCommit, inventoryDigest) {
          const { scopeKey, generation } = target;
          const base = { profile: "limited-v1", state: "retired", scopeKey, generation } as const;
          const marker = inventoryDigest === undefined
            ? { version: 1 as const, ...base }
            : { version: 2 as const, ...base, inventoryDigest };
          if (!validRetiredCatalog(marker)) throw Error("Invalid index retirement marker");
          assertCatalogIdentity(identity);
          await publishCatalog(marker, beforeCommit, identity);
        },
        async prepareReclaimCatalog(marker, identity, { alreadyPrepared, beforeCommit, verifyNative }) {
          if (!validPreparedCatalog(marker)) throw Error("Invalid index reclaim intent");
          const profile = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          try {
            assertReclaimProfile(profile);
            assertCatalogIdentity(identity);
            const guard = () => {
              beforeCommit();
              assertReclaimProfile(profile);
            };
            let staged = identity.catalog;
            if (alreadyPrepared) {
              guard();
              assertCatalogIdentity(identity);
            } else {
              const written = await publishCatalog(marker, guard, identity);
              if (!written) throw new IndexReuseCleanupError("Index reclaim preparation publication unconfirmed");
              staged = written;
            }
            await syncReclaimCatalog(profile, marker, staged, verifyNative);
          } finally {
            await closeCatalogFile(profile);
          }
        },
        async withStageDirectories(placement, identity, openOriginal, use) {
          const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
          const profile = await open(directory, flags);
          try {
            assertProfileDescriptor(profile);
            const index = placement === "pending" ? await open(pendingPath, flags) : undefined;
            const indexFd = index?.fd ?? openOriginal?.(profile.fd);
            if (indexFd === undefined) throw Error("Index staging addon unavailable");
            try {
              const check = (target: ReclaimPlacement) => {
                assertProfileDescriptor(profile);
                assertCatalogFile(identity.catalog);
                const held = fstatSync(indexFd, { bigint: true });
                const named = present(placementPath(target));
                if (!named || !ownedDirectory(held) || (held.mode & 0o022n) !== 0n ||
                    !sameRenameStableMetadata(identity.index, held) ||
                    (target === placement && !sameFile(identity.index, held)) ||
                    !sameRenameStableMetadata(held, named) || !sameFile(held, named) ||
                    present(target === "original" ? pendingPath : indexPath))
                  throw Error("Index staging placement unavailable");
              };
              check(placement);
              return await use({ profileFd: profile.fd, indexFd, check, sync: () => profile.sync() });
            } finally {
              if (index) await closeCatalogFile(index);
              else closeStageDescriptor(indexFd);
            }
          } finally {
            await closeCatalogFile(profile);
          }
        },
        async release() {
          if (released) return;
          try {
            assertLease();
            await rmdir(leasePath);
            released = true;
          } catch {
            throw new IndexReuseCleanupError("Index reuse lease release unconfirmed");
          }
        },
      },
    };

  } catch {
    return { ok: false, error: leaseCreated ? "UNKNOWN" : "UNAVAILABLE" };
  }
}
