import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";

import {
  MAX_IMAGE_BYTES,
  localImageReference,
  type LocalImageResult,
} from "../../shared/local-images";

import { imageFormat } from "./image-format";
import {
  canonicalizeSelectedPath,
  fileFingerprint,
  type SingleFileAuthorization,
} from "./path-authorization";

export interface ImageJob {
  authorization: Omit<SingleFileAuthorization, "file">;
  reference: string;
  assetRoot?: {
    path: string;
    directories: SingleFileAuthorization["directories"];
  };
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
    const target = await canonicalizeSelectedPath(`${source}/${ref}`);
    const parts = relative(root, target).split("/");
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
    const verifyDirectory = () => {
      const expected = directories.find((d) => d.path === path);
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
      before.size > BigInt(MAX_IMAGE_BYTES)
    )
      throw Error();
    const bytes = Buffer.alloc(
      Math.min(Number(before.size) + 1, MAX_IMAGE_BYTES + 1)
    );
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
    if ((await canonicalizeSelectedPath(`${source}/${ref}`)) !== target)
      throw Error();
    const { lstat } = await import("node:fs/promises");
    if (
      fileFingerprint(await lstat(target, { bigint: true })) !==
      fileFingerprint(before)
    )
      throw Error();
    for (const dir of [
      ...job.authorization.directories,
      ...directories,
      ...chain,
    ])
      if (
        fileFingerprint(await lstat(dir.path, { bigint: true })) !==
        dir.fingerprint
      )
        throw Error();
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
