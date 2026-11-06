import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type BigIntStats } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";

import {
  MAX_IMAGE_BYTES,
  localImageReference,
  type LocalImageResult,
} from "../../shared/local-images";
import { READER_IMAGE_SNAPSHOT_MAX_BYTES } from "../../shared/reader-image-snapshot";

import { imageFormat } from "./image-format";
import {
  canonicalizeSelectedPath,
  fileFingerprint,
  type SingleFileAuthorization,
} from "./path-authorization";

export interface ImageJob {
  authorization: Omit<SingleFileAuthorization, "file">;
  reference: string;
  profile?: "reader-snapshot";
  assetRoot?: {
    path: string;
    directories: SingleFileAuthorization["directories"];
  };
}

function readerPath(reference: string, ref: string, root: string, source: string) {
  const rawParts = reference.split("/");
  const parts = ref.split("/");
  if (parts.length !== rawParts.length || parts.length > 128 ||
      parts.some((part, i) => !part || ((part === "." || part === "..") && part !== rawParts[i]))) throw Error();
  let parents = 0;
  while (parts[parents] === "..") parents++;
  const sourceRelative = relative(root, source);
  const sourceParts = sourceRelative ? sourceRelative.split("/") : [];
  const assetParts = parts.slice(parts[0] === "." ? 1 : parents);
  const ancestorDepth = sourceParts.length - parents;
  if (sourceParts[0] === ".." || sourceParts.length > 128 || ancestorDepth < 0 ||
      !assetParts.length || ancestorDepth + assetParts.length > 128 ||
      assetParts.some((part) => part === "." || part === "..") ||
      !/\.(?:png|jpe?g)$/i.test(assetParts[assetParts.length - 1])) throw Error();
  return { sourceParts, ancestorDepth, assetParts };
}

function sameNamedImage(before: BigIntStats, named: BigIntStats) {
  return named.isFile() && named.nlink === 1n &&
    fileFingerprint(named) === fileFingerprint(before) &&
    named.size === before.size && named.mtimeNs === before.mtimeNs && named.ctimeNs === before.ctimeNs;
}

export async function readLocalImage(
  job: ImageJob,
  nativePath: string,
  afterResolve?: () => Promise<void>
): Promise<LocalImageResult> {
  const descriptors: number[] = [];
  try {
    const ref = localImageReference(job.reference);
    if (ref === null) throw Error();
    const source = dirname(job.authorization.path);
    const root = job.assetRoot?.path ?? source;
    const directories =
      job.assetRoot?.directories ?? job.authorization.directories;
    const reader = job.profile === "reader-snapshot" ? readerPath(job.reference, ref, root, source) : undefined;
    const maxBytes = reader ? READER_IMAGE_SNAPSHOT_MAX_BYTES : MAX_IMAGE_BYTES;
    const target = reader
      ? join(root, ...reader.sourceParts.slice(0, reader.ancestorDepth), ...reader.assetParts)
      : await canonicalizeSelectedPath(`${source}/${ref}`);
    const parts = reader?.assetParts ?? relative(root, target).split("/");
    if (
      !parts.length ||
      parts.length > 128 ||
      parts.some((p) => !p || p === ".." || p === ".")
    )
      throw Error();
    await afterResolve?.();
    const native = createRequire(import.meta.url)(nativePath) as {
      openDirectoryAt(fd: number, name: string): number;
      openFileAt(fd: number, name: string): number;
    };
    let fd = openSync(
      "/",
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    descriptors.push(fd);
    let path = "/";
    const verifyDirectory = (proof = directories) => {
      const expected = proof.find((d) => d.path === path);
      if (
        fileFingerprint(fstatSync(fd, { bigint: true })) !==
        expected?.fingerprint
      )
        throw Error();
    };
    verifyDirectory();
    for (const part of root.split("/").filter(Boolean)) {
      fd = native.openDirectoryAt(fd, part);
      descriptors.push(fd);
      path = join(path, part);
      verifyDirectory();
    }
    if (reader) {
      // Pin the actual source route before using a held ancestor for leading ../.
      // A path with an intermediate link must never be normalized into a read.
      const sourceChain = [{ fd, path }];
      for (const part of reader.sourceParts) {
        fd = native.openDirectoryAt(fd, part);
        descriptors.push(fd);
        path = join(path, part);
        verifyDirectory(job.authorization.directories);
        sourceChain.push({ fd, path });
      }
      ({ fd, path } = sourceChain[reader.ancestorDepth]);
    }
    const chain: { fd: number; path: string; fingerprint: string }[] = [];
    for (const part of parts.slice(0, -1)) {
      fd = native.openDirectoryAt(fd, part);
      descriptors.push(fd);
      path = join(path, part);
      chain.push({
        fd,
        path,
        fingerprint: fileFingerprint(fstatSync(fd, { bigint: true })),
      });
    }
    fd = native.openFileAt(fd, parts[parts.length - 1]);
    descriptors.push(fd);
    const before = fstatSync(fd, { bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size > BigInt(maxBytes)
    )
      throw Error();
    const bytes = Buffer.alloc(reader
      ? Number(before.size)
      : Math.min(Number(before.size) + 1, maxBytes + 1));
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(
        fd,
        bytes,
        length,
        Math.min(65536, bytes.length - length),
        length
      );
      if (!count) break;
      length += count;
    }
    const after = fstatSync(fd, { bigint: true });
    if (
      BigInt(length) !== before.size ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      after.nlink !== 1n
    )
      throw Error();
    const proof = [
      ...job.authorization.directories,
      ...directories,
      ...chain,
    ];
    if (reader) {
      for (const dir of proof) {
        const named = lstatSync(dir.path, { bigint: true });
        if (!named.isDirectory() || named.isSymbolicLink() || fileFingerprint(named) !== dir.fingerprint) throw Error();
      }
      if (!sameNamedImage(before, lstatSync(target, { bigint: true }))) throw Error();
    } else {
      if ((await canonicalizeSelectedPath(`${source}/${ref}`)) !== target) throw Error();
      const { lstat } = await import("node:fs/promises");
      if (
        fileFingerprint(await lstat(target, { bigint: true })) !== fileFingerprint(before)
      )
        throw Error();
      for (const dir of proof)
        if (fileFingerprint(await lstat(dir.path, { bigint: true })) !== dir.fingerprint) throw Error();
    }
    const body = bytes.subarray(0, length),
      format = imageFormat(body);
    return {
      ok: true,
      ...format,
      data: body.toString("base64"),
      identity: createHash("sha256")
        .update(fileFingerprint(before))
        .update(body)
        .digest("hex"),
    };
  } catch {
    return { ok: false, error: "UNAVAILABLE" };
  } finally {
    for (const fd of descriptors.reverse()) {
      try {
        closeSync(fd);
      } catch {
        /* Best effort after OS failure. */
      }
    }
  }
}
