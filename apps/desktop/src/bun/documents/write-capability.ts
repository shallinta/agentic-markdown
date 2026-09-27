import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";

import type { WriteCapability } from "../../shared/documents";

import { resolveSaveWorkerEntry } from "./atomic-save";
import {
  fileFingerprint,
  verifySingleFileAuthorization,
  type SingleFileAuthorization,
} from "./path-authorization";

export async function checkWriteCapability(
  grant: Omit<SingleFileAuthorization, "file">
): Promise<WriteCapability> {
  // Grants retain identity, not an open descriptor. Atomic save changes the inode.
  let file, directory;
  try {
    file = await open(
      grant.path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    await verifySingleFileAuthorization({ ...grant, file });
    directory = await open(
      dirname(grant.path),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    const parent = await directory.stat({ bigint: true });
    if (
      !grant.directories.some(
        (d) =>
          d.path === dirname(grant.path) &&
          d.fingerprint === fileFingerprint(parent)
      )
    )
      return { writable: false, reason: "invalid" };
    const entry = resolveSaveWorkerEntry(import.meta.dir);
    if (!entry || process.platform !== "darwin")
      return { writable: false, reason: "unavailable" };
    const native = createRequire(import.meta.url)(
      join(dirname(entry), "save-primitives.node")
    ) as {
      writeCapability(directory: number, file: number, name: string): number;
    };
    const value = native.writeCapability(
      directory.fd,
      file.fd,
      basename(grant.path)
    );
    await verifySingleFileAuthorization({ ...grant, file });
    return value === 0
      ? { writable: true, reason: "writable" }
      : { writable: false, reason: value === 1 ? "readonly" : "unavailable" };
  } catch (error) {
    return {
      writable: false,
      reason:
        error instanceof Error && error.message === "FILE_CHANGED"
          ? "invalid"
          : "unavailable",
    };
  } finally {
    await file?.close().catch(() => undefined);
    await directory?.close().catch(() => undefined);
  }
}
