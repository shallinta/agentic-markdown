import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  futimesSync,
  writeSync,
} from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";

import { MAX_DOCUMENT_BYTES } from "../../shared/documents";

import type { AtomicSaveInput, AtomicSaveResult } from "./atomic-save";
import {
  fileFingerprint,
  verifySingleFileAuthorization,
  DocumentPathError,
} from "./path-authorization";

export interface NativeSave {
  createTemp(this: void, fd: number, name: string): number;
  copyMetadata(this: void, source: number, target: number): void;
  fullSync(this: void, fd: number): void;
  replace(this: void, fd: number, source: string, target: string): void;
  removeTemp(this: void, fd: number, name: string): void;
}

/** Isolated worker only. Never import this entrypoint into the main process. */
export async function runAtomicSave(
  input: AtomicSaveInput,
  loadNative: () => NativeSave = () =>
    createRequire(import.meta.url)(
      join(import.meta.dir, "save-primitives.node")
    ) as NativeSave
): Promise<AtomicSaveResult> {
  let directory: FileHandle | undefined;
  let source: FileHandle | undefined;
  let writable: FileHandle | undefined;
  let tempFd: number | undefined;
  let temporary: string | undefined;
  let replaced = false;
  let native: NativeSave | undefined;
  let result: AtomicSaveResult;
  try {
    native = loadNative();
    const grant = input.authorization;
    directory = await open(
      dirname(grant.path),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    const held = await directory.stat({ bigint: true });
    if (
      !grant.directories.some(
        (d) =>
          d.path === dirname(grant.path) &&
          d.fingerprint === fileFingerprint(held)
      )
    )
      throw new DocumentPathError("FILE_CHANGED");
    source = await open(
      grant.path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    const authorization = { ...grant, file: source };
    const before = await verifySingleFileAuthorization(authorization);
    if (before.nlink !== 1n) throw new DocumentPathError("UNSUPPORTED_SAVE");
    // Opening without O_TRUNC honors file write permissions and ACL even when the
    // parent permits rename. Explicit mode rejection also protects root-run tests.
    if ((before.mode & 0o222n) === 0n)
      throw new DocumentPathError("SAVE_FAILED");
    writable = await open(
      grant.path,
      constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    if (
      fileFingerprint(await writable.stat({ bigint: true })) !==
      grant.fingerprint
    )
      throw new DocumentPathError("FILE_CHANGED");
    async function verifyBaseline() {
      const first = await verifySingleFileAuthorization(authorization);
      if (first.size > BigInt(MAX_DOCUMENT_BYTES))
        throw new DocumentPathError("CONFLICT");
      const bytes = Buffer.alloc(Number(first.size) + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await source!.read(
          bytes,
          length,
          bytes.length - length,
          length
        );
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      const last = await verifySingleFileAuthorization(authorization);
      if (
        first.size !== last.size ||
        first.mtimeNs !== last.mtimeNs ||
        first.ctimeNs !== last.ctimeNs ||
        BigInt(length) !== last.size ||
        createHash("sha256").update(bytes.subarray(0, length)).digest("hex") !==
          input.expectedHash
      )
        throw new DocumentPathError("CONFLICT");
      return last;
    }
    await verifyBaseline();
    const bytes = Buffer.from(input.text, "utf8");
    if (bytes.length > MAX_DOCUMENT_BYTES)
      throw new DocumentPathError("TOO_LARGE");
    temporary = `.agentic-save-${randomUUID()}`;
    tempFd = native.createTemp(directory.fd, temporary);
    let written = 0;
    while (written < bytes.length) {
      const count = writeSync(
        tempFd,
        bytes,
        written,
        bytes.length - written,
        written
      );
      if (count === 0) throw new Error("Short write");
      written += count;
    }
    native.copyMetadata(source.fd, tempFd);
    const copied = fstatSync(tempFd, { bigint: true });
    if (
      copied.uid !== before.uid ||
      copied.gid !== before.gid ||
      (copied.mode & 0o7777n) !== (before.mode & 0o7777n)
    )
      throw new Error("Metadata mismatch");
    futimesSync(tempFd, Number(before.atimeNs) / 1e9, Date.now() / 1000);
    native.fullSync(tempFd);
    const latest = await verifyBaseline();
    if (
      latest.mode !== before.mode ||
      latest.uid !== before.uid ||
      latest.gid !== before.gid ||
      latest.nlink !== 1n ||
      latest.ctimeNs !== before.ctimeNs
    )
      throw new DocumentPathError("CONFLICT");
    // Held dirfd confines the operation if a path component is swapped. This is
    // not a cross-process compare-and-swap against a simultaneous external writer.
    native.replace(directory.fd, temporary, basename(grant.path));
    replaced = true;
    native.fullSync(directory.fd);
    const next = fstatSync(tempFd, { bigint: true });
    // Detect late directory/path substitution before claiming a current saved path.
    const confirmed = await open(
      grant.path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      await verifySingleFileAuthorization({
        ...grant,
        fingerprint: fileFingerprint(next),
        file: confirmed,
      });
    } finally {
      await confirmed.close();
    }
    result = {
      ok: true,
      fingerprint: fileFingerprint(next),
      hash: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.length,
    };
  } catch (error) {
    result = {
      ok: false,
      error: replaced
        ? "SAVE_UNCERTAIN"
        : error instanceof DocumentPathError
          ? error.code
          : "SAVE_FAILED",
    };
  } finally {
    if (tempFd !== undefined) {
      try {
        closeSync(tempFd);
      } catch {
        /* Already closed/failed cleanup cannot become saved. */
      }
    }
    if (temporary && !replaced && native && directory) {
      try {
        native.removeTemp(directory.fd, temporary);
      } catch {
        /* Only our exclusive random temp is eligible. */
      }
    }
    await Promise.all(
      [source, writable, directory].map(async (file) => {
        await file?.close().catch(() => undefined);
      })
    );
  }
  return result;
}
