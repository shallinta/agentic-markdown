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

type CatalogRead =
  | { status: "cold" }
  | { status: "existing"; catalog: IndexReuseCatalog }
  | { status: "invalid" };

interface IndexReuseSlot {
  indexPath: string;
  readCatalog(): Promise<CatalogRead>;
  writeCatalog(catalog: IndexReuseCatalog, beforeCommit?: () => void): Promise<void>;
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
    const assertLease = () => {
      const root = present(directory);
      const lease = present(leasePath);
      if (
        released ||
        !root || !privateDirectory(root) || !sameInode(directoryStat, root) ||
        !lease || !privateDirectory(lease) || !sameInode(leaseStat, lease)
      )
        throw Error("Index reuse lease unavailable");
    };
    assertLease();

    return {
      ok: true,
      slot: {
        indexPath,
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
                !latestIndex || !ownedDirectory(latestIndex) || !sameInode(index, latestIndex) ||
                !validCatalog(value))
              return { status: "invalid" };
            return { status: "existing", catalog: value };
          } catch (error) {
            if (error instanceof IndexReuseCleanupError) throw error;
            return { status: "invalid" };
          }
        },
        async writeCatalog(catalog, beforeCommit) {
          assertLease();
          if (!validCatalog(catalog)) throw Error("Invalid index reuse catalog");
          const contents = JSON.stringify(catalog);
          if (Buffer.byteLength(contents) > maxCatalogBytes)
            throw Error("Index reuse catalog exceeds limit");
          const tempPath = join(directory, `.catalog-${randomUUID()}.tmp`);
          let created = false;
          let staged: BigIntStats | undefined;
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
            renameSync(tempPath, catalogPath);
          } catch (error) {
            if (created) cleanStaging();
            throw error;
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
