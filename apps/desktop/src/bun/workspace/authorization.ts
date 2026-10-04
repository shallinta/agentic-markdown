import { lstat } from "node:fs/promises";
import { dirname, relative } from "node:path";

import {
  canonicalizeSelectedPath,
  fileFingerprint,
  authorizeSingleFile,
  DocumentPathError,
} from "../documents/path-authorization";

export interface DirectoryIdentity {
  path: string;
  fingerprint: string;
}
export interface RootAuthorization {
  path: string;
  directories: DirectoryIdentity[];
}
export const containsPath = (root: string, path: string) => {
  const tail = relative(root, path);
  return (
    tail === "" ||
    (tail !== ".." && !tail.startsWith("../") && !tail.startsWith("/"))
  );
};
export const visiblePath = (root: string, path: string) =>
  containsPath(root, path) &&
  relative(root, path)
    .split("/")
    .every((part) => !part.startsWith("."));
export async function authorizeRoot(
  selected: string
): Promise<RootAuthorization> {
  if (
    !selected.startsWith("/") ||
    selected.includes("\0") ||
    selected.length > 4096 ||
    selected.split("/").includes(".git")
  )
    throw Error();
  const path = await canonicalizeSelectedPath(selected);
  if (path.split("/").includes(".git")) throw Error();
  const directories: DirectoryIdentity[] = [];
  for (let cursor = path; ; cursor = dirname(cursor)) {
    const stat = await lstat(cursor, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error();
    directories.push({ path: cursor, fingerprint: fileFingerprint(stat) });
    if (cursor === "/") break;
  }
  const grant = { path, directories: directories.reverse() };
  await verifyRoot(grant);
  return grant;
}
export async function verifyRoot(root: RootAuthorization): Promise<void> {
  for (const dir of root.directories) {
    const stat = await lstat(dir.path, { bigint: true });
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      fileFingerprint(stat) !== dir.fingerprint
    )
      throw new DocumentPathError("FILE_CHANGED");
  }
}
export async function authorizeEntry(
  root: RootAuthorization,
  path: string,
  fingerprint: string,
  chain: DirectoryIdentity[]
) {
  await verifyRoot(root);
  if (!visiblePath(root.path, path))
    throw new DocumentPathError("INVALID_HANDLE");
  const candidate = await authorizeSingleFile(path);
  try {
    if (candidate.path !== path || candidate.fingerprint !== fingerprint)
      throw new DocumentPathError("FILE_CHANGED");
    for (const expected of [...root.directories, ...chain])
      if (
        !candidate.directories.some(
          (dir) =>
            dir.path === expected.path &&
            dir.fingerprint === expected.fingerprint
        )
      )
        throw new DocumentPathError("FILE_CHANGED");
    await verifyRoot(root);
    return candidate;
  } catch (error) {
    await candidate.file.close();
    throw error;
  }
}
