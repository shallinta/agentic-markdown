import { randomUUID } from "node:crypto";
import {
  constants,
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
  | { status: "invalid" };

interface IndexReuseSlot {
  indexPath: string;
  assertInventoryLease(this: void): BigIntStats;
  assertCatalogIdentity(identity: IndexReuseInventoryIdentity): void;
  readCatalog(): Promise<CatalogRead>;
  writeCatalog(catalog: IndexReuseCatalog, beforeCommit?: () => void): Promise<void>;
  retireCatalog(
    target: IndexRetirementTarget, identity: IndexReuseInventoryIdentity,
    beforeCommit: () => void, inventoryDigest?: string
  ): Promise<void>;
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
    const assertCatalogIdentity = (identity: IndexReuseInventoryIdentity) => {
      assertLease(true);
      const catalog = present(catalogPath);
      const index = present(indexPath);
      if (!catalog || !privateFile(catalog) || !sameFile(identity.catalog, catalog) ||
          catalog.mode !== identity.catalog.mode ||
          !index || !ownedDirectory(index) || !sameFile(identity.index, index) ||
          index.mode !== identity.index.mode || index.nlink !== identity.index.nlink)
        throw Error("Index reuse catalog or index identity changed");
    };

    async function publishCatalog(
      value: IndexReuseCatalog | RetiredCatalog,
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
        renameSync(tempPath, catalogPath);
      } catch (error) {
        if (created) cleanStaging();
        throw error;
      }
    }

    return {
      ok: true,
      slot: {
        indexPath,
        assertInventoryLease: () => assertLease(true),
        assertCatalogIdentity,
        async readCatalog() {
          try {
            assertLease();
            const index = present(indexPath);
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
            const latestIndex = present(indexPath);
            if (!latestCatalog || !privateFile(latestCatalog) || !sameFile(catalog, latestCatalog) ||
                !latestIndex || !ownedDirectory(latestIndex) || !sameInode(index, latestIndex))
              return { status: "invalid" };
            const identity = { catalog, index };
            if (validCatalog(value)) return { status: "existing", catalog: value, identity };
            if (validRetiredCatalog(value)) return { status: "retired", catalog: value, identity };
            return { status: "invalid" };
          } catch (error) {
            if (error instanceof IndexReuseCleanupError) throw error;
            return { status: "invalid" };
          }
        },
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
