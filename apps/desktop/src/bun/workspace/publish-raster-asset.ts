import { randomUUID } from "node:crypto";
import { closeSync, fstatSync, fsyncSync, lstatSync, readSync, writeSync, type BigIntStats } from "node:fs";
import { join } from "node:path";

import { RASTER_PASTE_MAX_BYTES } from "../../shared/raster-paste";
import { imageFormat } from "../documents/image-format";
import { fileFingerprint } from "../documents/path-authorization";

import { containsPath } from "./authorization";
import { createFolderOnDisk, verifyFolderTarget, type FolderNative } from "./create-folder-disk";
import type { CreationTarget } from "./create-markdown";
import { openDirectoryDescriptor } from "./directory-descriptor";

const MAX_NAMES = 4;
const CHUNK_BYTES = 64 * 1024;

export interface RasterAssetNative extends FolderNative {
  openDirectoryAt(this: void, fd: number, leaf: string): number;
  createTemp(this: void, fd: number, leaf: string): number;
  openFileAt(this: void, fd: number, leaf: string): number;
  publishExclusive(this: void, fd: number, source: string, target: string): unknown;
  scanStat(this: void, fd: number, leaf: string): { kind: string; fingerprint: string };
}

type RasterAssetResult =
  | { ok: true; relativePath: string }
  | { ok: false; error: "INVALID" | "STALE" | "CONFLICT" | "UNAVAILABLE" | "UNKNOWN" };

class StaleRasterAsset extends Error {}

const errorCode = (error: unknown) =>
  error && typeof error === "object" && "code" in error ? error.code : undefined;

const sameFileVersion = (before: BigIntStats, after: BigIntStats) =>
  fileFingerprint(after) === fileFingerprint(before) && after.nlink === 1n &&
  after.size === before.size && after.mode === before.mode &&
  after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs;

/** Publish under a live creation lease into the fixed assets child. */
export async function publishRasterAsset(options: {
  native: RasterAssetNative;
  target: CreationTarget;
  bytes: Uint8Array;
  current(): boolean;
  revalidate(): Promise<boolean>;
}): Promise<RasterAssetResult> {
  const { native, target } = options;
  if (!options.bytes.length || options.bytes.length > RASTER_PASTE_MAX_BYTES ||
      !containsPath(target.root.path, target.path))
    return { ok: false, error: "INVALID" };
  const bytes = Buffer.from(options.bytes);
  let extension: "png" | "jpg";
  try {
    extension = imageFormat(bytes).mime === "image/png" ? "png" : "jpg";
  } catch {
    return { ok: false, error: "INVALID" };
  }

  let parent: number | undefined, assets: number | undefined;
  let staged: number | undefined, published: number | undefined;
  let mayHavePublished = false, directoryUnconfirmed = false, closeFailed = false;
  const checkCurrent = () => {
    if (!options.current()) throw new StaleRasterAsset();
  };
  const verifySource = async () => {
    checkCurrent();
    if (!await options.revalidate()) throw new StaleRasterAsset();
    checkCurrent();
  };
  const descriptor = (fd: number) => {
    if (!Number.isInteger(fd) || fd < 0 || fd > 2147483647)
      throw Error("Invalid descriptor");
    return fd;
  };
  const verifyBytes = (fd: number) => {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || (before.mode & 0o777n) !== 0o600n ||
        before.size !== BigInt(bytes.length))
      throw Error("Asset changed");
    const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, bytes.length));
    for (let offset = 0; offset < bytes.length;) {
      checkCurrent();
      const length = readSync(fd, buffer, 0, Math.min(buffer.length, bytes.length - offset), offset);
      if (!length || !buffer.subarray(0, length).equals(bytes.subarray(offset, offset + length)))
        throw Error("Asset bytes changed");
      offset += length;
    }
    if (!sameFileVersion(before, fstatSync(fd, { bigint: true })))
      throw Error("Asset changed during verification");
    return before;
  };

  async function execute(): Promise<RasterAssetResult> {
    await verifySource();
    verifyFolderTarget(target);
    const parentFd = parent = openDirectoryDescriptor(target.root, target, native);
    const parentFingerprint = fileFingerprint(fstatSync(parentFd, { bigint: true }));
    const checkParent = () => {
      checkCurrent();
      verifyFolderTarget(target);
      const heldParent = fstatSync(parentFd, { bigint: true });
      if (!heldParent.isDirectory() || fileFingerprint(heldParent) !== parentFingerprint)
        throw Error("Asset parent changed");
    };
    checkParent();
    let existing: BigIntStats | undefined;
    try { existing = lstatSync(join(target.path, "assets"), { bigint: true }); }
    catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
    checkParent();
    if (existing && !existing.isDirectory()) throw Error("Invalid assets child");

    let assetsFingerprint: string;
    if (existing) assetsFingerprint = fileFingerprint(existing);
    else {
      const folderNative: FolderNative = {
        openDirectoryAt: native.openDirectoryAt,
        createFileExclusive: (fd, leaf) => native.createFileExclusive(fd, leaf),
        scanOpen: fd => native.scanOpen(fd),
        scanBatch: (cursor, limit) => native.scanBatch(cursor, limit),
        scanClose: cursor => native.scanClose(cursor),
        createPrivateDirectory: (fd, leaf) => native.createPrivateDirectory(fd, leaf),
        publishDirectoryExclusive(fd, source, leaf) {
          directoryUnconfirmed = true;
          try { return native.publishDirectoryExclusive(fd, source, leaf); }
          catch (error) {
            const code = errorCode(error);
            if (code === "PUBLISH_EXISTS" || code === "PUBLISH_INVALID" || code === "PUBLISH_UNSUPPORTED")
              directoryUnconfirmed = false;
            throw error;
          }
        },
      };
      try {
        const proof = createFolderOnDisk({
          native: folderNative, target, name: "assets", check: checkParent,
          committed: () => undefined,
          unknown: () => { directoryUnconfirmed = true; },
        });
        assetsFingerprint = proof.fingerprint;
      } catch (error) {
        if (!directoryUnconfirmed && errorCode(error) === "PUBLISH_EXISTS")
          return { ok: false, error: "CONFLICT" };
        throw error;
      }
      fsyncSync(parentFd);
      checkParent();
    }

    const assetsFd = assets = descriptor(native.openDirectoryAt(parentFd, "assets"));
    const checkDirectory = () => {
      checkParent();
      const heldAssets = fstatSync(assetsFd, { bigint: true });
      const namedAssets = native.scanStat(parentFd, "assets");
      if (!heldAssets.isDirectory() || fileFingerprint(heldAssets) !== assetsFingerprint ||
          namedAssets.kind !== "directory" || namedAssets.fingerprint !== assetsFingerprint)
        throw Error("Asset directory changed");
    };
    const verifyName = (name: string, fd: number, proof: BigIntStats) => {
      const named = native.scanStat(assetsFd, name);
      if (named.kind !== "file" || named.fingerprint !== fileFingerprint(proof) ||
          !sameFileVersion(proof, fstatSync(fd, { bigint: true })))
        throw Error("Named asset changed");
    };

    checkDirectory();
    if (directoryUnconfirmed) {
      await verifySource();
      checkDirectory();
      directoryUnconfirmed = false;
    }
    const id = randomUUID();
    const temporary = `.agentic-save-${id}`;
    const stagedFd = staged = descriptor(native.createTemp(assetsFd, temporary));
    for (let offset = 0; offset < bytes.length;) {
      checkCurrent();
      const length = writeSync(stagedFd, bytes, offset, Math.min(CHUNK_BYTES, bytes.length - offset), offset);
      if (!length) throw Error("Short asset write");
      offset += length;
    }
    fsyncSync(stagedFd);
    const fingerprint = fileFingerprint(fstatSync(stagedFd, { bigint: true }));

    for (let attempt = 0; attempt < MAX_NAMES; attempt++) {
      const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
      const name = `image-${id}${suffix}.${extension}`;
      await verifySource();
      checkDirectory();
      const proof = verifyBytes(stagedFd);
      if (fileFingerprint(proof) !== fingerprint) throw Error("Staged asset changed");
      checkDirectory();
      verifyName(temporary, stagedFd, proof);
      mayHavePublished = true;
      try {
        if (native.publishExclusive(assetsFd, temporary, name) !== 0)
          return { ok: false, error: "UNKNOWN" };
      } catch (error) {
        const code = errorCode(error);
        if (code === "PUBLISH_EXISTS") {
          mayHavePublished = false;
          continue;
        }
        if (code === "PUBLISH_INVALID" || code === "PUBLISH_UNSUPPORTED") {
          mayHavePublished = false;
          return { ok: false, error: "UNAVAILABLE" };
        }
        throw error;
      }
      fsyncSync(assetsFd);
      await verifySource();
      checkDirectory();
      const publishedFd = published = descriptor(native.openFileAt(assetsFd, name));
      const final = verifyBytes(publishedFd);
      if (fileFingerprint(final) !== fingerprint) throw Error("Published asset changed");
      checkDirectory();
      verifyName(name, publishedFd, final);
      return { ok: true, relativePath: `./assets/${name}` };
    }
    return { ok: false, error: "CONFLICT" };
  }

  let result: RasterAssetResult;
  try {
    result = await execute();
  } catch (error) {
    result = { ok: false, error: mayHavePublished || directoryUnconfirmed ? "UNKNOWN" : error instanceof StaleRasterAsset ? "STALE" : "UNAVAILABLE" };
  } finally {
    // Named entries may have been replaced. Closing owned descriptors is the
    // only cleanup here, including on failures and exhausted collisions.
    for (const fd of [published, staged, assets, parent]) {
      if (fd === undefined) continue;
      try { closeSync(fd); } catch { closeFailed = true; }
    }
  }
  return closeFailed ? { ok: false, error: "UNKNOWN" } : result;
}
