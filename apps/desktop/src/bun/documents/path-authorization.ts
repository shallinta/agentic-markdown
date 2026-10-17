import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { dirname, extname, isAbsolute } from "node:path";

import type { DocumentErrorCode } from "../../shared/documents";

export class DocumentPathError extends Error {
  constructor(readonly code: DocumentErrorCode) {
    super(code);
  }
}

export const fileFingerprint = (stat: BigIntStats): string =>
  `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;

interface DirectoryIdentity {
  path: string;
  fingerprint: string;
}

export interface SingleFileAuthorization {
  selectedPath: string;
  path: string;
  selectedParent: string;
  fingerprint: string;
  directories: DirectoryIdentity[];
  file: FileHandle;
}

const isMarkdown = (path: string): boolean =>
  [".md", ".markdown"].includes(extname(path).toLowerCase());

async function rememberDirectoryChain(
  path: string,
  directories: Map<string, DirectoryIdentity>,
  check: () => void = () => undefined
): Promise<void> {
  let cursor = path;
  while (!directories.has(cursor)) {
    const stat = await lstat(cursor, { bigint: true });
    check();
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new DocumentPathError("FILE_CHANGED");
    directories.set(cursor, {
      path: cursor,
      fingerprint: fileFingerprint(stat),
    });
    const next = dirname(cursor);
    if (next === cursor) break;
    cursor = next;
  }
}

export async function canonicalizeSelectedPath(
  path: string,
  directories?: Map<string, DirectoryIdentity>,
  check: () => void = () => undefined
): Promise<string> {
  const components = path.split("/");
  // Bun 1.3.14 realpath collapses symlink/.. lexically. Resolve each ordinary
  // component before interpreting ... Capture the directory before following a
  // link too: its identity is lost if only the final target's ancestors are kept.
  let cursor = "/";
  for (const component of components.slice(1)) {
    const current = await lstat(cursor, { bigint: true });
    check();
    if (!current.isDirectory() || current.isSymbolicLink())
      throw new DocumentPathError("READ_FAILED");
    if (directories) {
      const previous = directories.get(cursor);
      if (previous && previous.fingerprint !== fileFingerprint(current))
        throw new DocumentPathError("FILE_CHANGED");
      await rememberDirectoryChain(cursor, directories, check);
      check();
    }
    if (!component || component === ".") continue;
    cursor =
      component === ".."
        ? dirname(cursor)
        : await realpath(`${cursor}/${component}`);
    check();
  }
  return cursor;
}

/** Check only explicitly selected paths and ancestors, never directory contents. */
export async function verifySingleFileAuthorization(
  grant: SingleFileAuthorization,
  check: () => void = () => undefined
): Promise<BigIntStats> {
  try {
    if (
      (await canonicalizeSelectedPath(grant.selectedPath, undefined, check)) !==
        grant.path ||
      (await canonicalizeSelectedPath(
        dirname(grant.selectedPath),
        undefined,
        check
      )) !== grant.selectedParent
    )
      throw new DocumentPathError("FILE_CHANGED");
    for (const directory of grant.directories) {
      const current = await lstat(directory.path, { bigint: true });
      check();
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        fileFingerprint(current) !== directory.fingerprint
      )
        throw new DocumentPathError("FILE_CHANGED");
    }
    const current = await lstat(grant.path, { bigint: true });
    check();
    const opened = await grant.file.stat({ bigint: true });
    check();
    if (
      !current.isFile() ||
      !opened.isFile() ||
      fileFingerprint(current) !== grant.fingerprint ||
      fileFingerprint(opened) !== grant.fingerprint
    )
      throw new DocumentPathError("FILE_CHANGED");
    return opened;
  } catch {
    // Never forward OS errors containing user paths across the RPC boundary.
    throw new DocumentPathError("FILE_CHANGED");
  }
}

export async function authorizeSingleFile(
  selectedPath: string,
  check: () => void = () => undefined
): Promise<SingleFileAuthorization> {
  if (!isAbsolute(selectedPath) || selectedPath.includes("\0"))
    throw new DocumentPathError("READ_FAILED");
  if (selectedPath.split("/").includes(".git"))
    throw new DocumentPathError("UNSUPPORTED_FILE");
  if (!isMarkdown(selectedPath))
    throw new DocumentPathError("UNSUPPORTED_FILE");
  // Preserve the selected spelling: lexical resolution of symlink/.. changes
  // filesystem semantics. Native realpath supplies volume-aware canonicalization.
  const directories = new Map<string, DirectoryIdentity>();
  const path = await canonicalizeSelectedPath(selectedPath, directories, check);
  check();
  if (path.split("/").includes(".git"))
    throw new DocumentPathError("UNSUPPORTED_FILE");
  if (!isMarkdown(path)) throw new DocumentPathError("UNSUPPORTED_FILE");
  const initial = await lstat(path, { bigint: true });
  check();
  if (!initial.isFile()) throw new DocumentPathError("UNSUPPORTED_FILE");
  const selectedParent = await canonicalizeSelectedPath(
    dirname(selectedPath),
    directories,
    check
  );
  check();
  for (const parent of [dirname(path), selectedParent]) {
    await rememberDirectoryChain(parent, directories, check);
    check();
  }
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    check();
    const grant: SingleFileAuthorization = {
      selectedPath,
      path,
      selectedParent,
      fingerprint: fileFingerprint(initial),
      directories: [...directories.values()],
      file,
    };
    await verifySingleFileAuthorization(grant, check);
    check();
    return grant;
  } catch (error) {
    await file.close().catch(() => undefined);
    throw error;
  }
}
