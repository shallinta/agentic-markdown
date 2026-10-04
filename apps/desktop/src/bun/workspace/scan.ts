import { closeSync, constants, fstatSync, openSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, relative } from "node:path";

import { fileFingerprint } from "../documents/path-authorization";

import {
  verifyRoot,
  type DirectoryIdentity,
  type RootAuthorization,
} from "./authorization";

export const SCAN_BATCH_SIZE = 128;
export const SCAN_QUEUE_BYTES = 2 * 1024 * 1024;
export interface ScanFile {
  path: string;
  fingerprint: string;
  chain: DirectoryIdentity[];
}
export interface ScanBatch {
  files: ScanFile[];
  examined: number;
  errors: number;
  done: boolean;
  paused: boolean;
  queueBytes: number;
}
interface Native {
  openDirectoryAt(fd: number, name: string): number;
  scanOpen(fd: number): object;
  scanBatch(cursor: object, limit: number): { names: string[]; done: boolean };
  scanClose(cursor: object): void;
  scanStat(fd: number, name: string): { kind: string; fingerprint: string };
  scanReadlink(fd: number, name: string): string;
}
interface PendingDirectory {
  path: string;
  chain: DirectoryIdentity[];
}
/** One owned cursor per session; all filtered entries consume batch capacity. */
export function createScan(root: RootAuthorization, nativePath: string) {
  const native = createRequire(import.meta.url)(nativePath) as Native;
  const pending: PendingDirectory[] = [{ path: root.path, chain: [] }];
  let current: {
    directory: PendingDirectory;
    fd: number;
    cursor: object;
  } | null = null;
  let closed = false,
    paused = false,
    queuedBytes = Buffer.byteLength(JSON.stringify(pending[0]));
  const closeCurrent = () => {
    if (current) {
      native.scanClose(current.cursor);
      closeSync(current.fd);
      current = null;
    }
  };
  const queueBytes = () => queuedBytes;
  const close = () => {
    closed = true;
    closeCurrent();
    pending.length = 0;
    queuedBytes = 0;
  };
  function directoryDescriptor(directory: PendingDirectory) {
    let fd = openSync(
      "/",
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    try {
      const identities = [...root.directories, ...directory.chain];
      let path = "/";
      if (
        fileFingerprint(fstatSync(fd, { bigint: true })) !==
        identities.find((d) => d.path === path)?.fingerprint
      )
        throw Error();
      for (const part of directory.path.split("/").filter(Boolean)) {
        const next = native.openDirectoryAt(fd, part);
        closeSync(fd);
        fd = next;
        path = join(path, part);
        if (
          fileFingerprint(fstatSync(fd, { bigint: true })) !==
          identities.find((d) => d.path === path)?.fingerprint
        )
          throw Error();
      }
      return fd;
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }
  function openDirectory(directory: PendingDirectory) {
    const fd = directoryDescriptor(directory);
    try {
      current = { directory, fd, cursor: native.scanOpen(fd) };
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }
  function resolveFileLink(path: string): ScanFile | null {
    const descriptors = [directoryDescriptor({ path: root.path, chain: [] })];
    const names: string[] = [];
    const chain: DirectoryIdentity[] = [];
    let parts = relative(root.path, path).split("/"),
      hops = 0;
    try {
      while (parts.length) {
        const part = parts.shift()!;
        if (!part || part === ".") continue;
        if (part === "..") {
          if (!names.length) return null;
          closeSync(descriptors.pop()!);
          names.pop();
          chain.pop();
          continue;
        }
        if (part.startsWith(".")) return null;
        const fd = descriptors[descriptors.length - 1],
          metadata = native.scanStat(fd, part);
        if (metadata.kind === "link") {
          if (++hops > 32) return null;
          const target = native.scanReadlink(fd, part);
          if (target.includes("\0")) return null;
          if (target.startsWith("/")) {
            // Reject an out-of-scope target before any stat/realpath of it.
            const prefix = root.path === "/" ? "/" : `${root.path}/`;
            if (target !== root.path && !target.startsWith(prefix)) return null;
            while (descriptors.length > 1) closeSync(descriptors.pop()!);
            names.length = 0;
            chain.length = 0;
            parts = [
              ...target
                .slice(target === root.path ? target.length : prefix.length)
                .split("/"),
              ...parts,
            ];
          } else parts = [...target.split("/"), ...parts];
          if (parts.join("/").length > 4096) return null;
          continue;
        }
        const target = join(root.path, ...names, part);
        if (parts.length) {
          if (metadata.kind !== "directory" || names.length >= 128) return null;
          const child = native.openDirectoryAt(fd, part);
          descriptors.push(child);
          if (
            fileFingerprint(fstatSync(child, { bigint: true })) !==
            metadata.fingerprint
          )
            throw Error();
          names.push(part);
          chain.push({ path: target, fingerprint: metadata.fingerprint });
        } else {
          if (
            metadata.kind !== "file" ||
            ![".md", ".markdown"].includes(extname(part).toLowerCase())
          )
            return null;
          return { path: target, fingerprint: metadata.fingerprint, chain };
        }
      }
      return null;
    } finally {
      for (const fd of descriptors.reverse()) closeSync(fd);
    }
  }
  return {
    close,
    queueBytes,
    prioritize(path: string) {
      const index = pending.findIndex((d) => d.path === path);
      if (index > 0) pending.unshift(pending.splice(index, 1)[0]);
    },
    async next(queueLimit = SCAN_QUEUE_BYTES): Promise<ScanBatch> {
      const result: ScanBatch = {
        files: [],
        examined: 0,
        errors: 0,
        done: false,
        paused,
        queueBytes: queueBytes(),
      };
      if (closed || paused) return { ...result, done: closed };
      try {
        await verifyRoot(root);
      } catch {
        close();
        return { ...result, errors: 1, done: true, queueBytes: 0 };
      }
      try {
        if (!current) {
          const directory = pending.shift();
          if (!directory) return { ...result, done: true };
          queuedBytes -= Buffer.byteLength(JSON.stringify(directory));
          openDirectory(directory);
        }
        const active = current!;
        const batch = native.scanBatch(active.cursor, SCAN_BATCH_SIZE);
        result.examined = batch.names.length;
        for (const name of batch.names) {
          if (name.startsWith(".")) continue;
          try {
            const metadata = native.scanStat(active.fd, name),
              path = join(active.directory.path, name);
            if (metadata.kind === "directory") {
              const item = {
                path,
                chain: [
                  ...active.directory.chain,
                  { path, fingerprint: metadata.fingerprint },
                ],
              };
              const bytes = Buffer.byteLength(JSON.stringify(item));
              if (item.chain.length > 128 || queuedBytes + bytes > queueLimit) {
                paused = true;
                break;
              }
              pending.push(item);
              queuedBytes += bytes;
            } else if (
              metadata.kind === "file" &&
              [".md", ".markdown"].includes(extname(name).toLowerCase())
            ) {
              result.files.push({
                path,
                fingerprint: metadata.fingerprint,
                chain: active.directory.chain,
              });
            } else if (
              metadata.kind === "link" &&
              [".md", ".markdown"].includes(extname(name).toLowerCase())
            ) {
              const target = resolveFileLink(path);
              if (!target) continue;
              // The complete non-link walk supplies the target's real spelling
              // and visible owner. Never insert a second alias or infer volume
              // case rules from a readlink string; hidden/failed branches stay so.
            }
          } catch {
            result.errors++;
          }
        }
        await verifyRoot(root);
        for (const directory of active.directory.chain) {
          const stat = await lstat(directory.path, { bigint: true });
          if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            fileFingerprint(stat) !== directory.fingerprint
          )
            throw Error();
        }
        if (batch.done || paused) closeCurrent();
        return {
          ...result,
          done: !current && pending.length === 0 && !paused,
          paused,
          queueBytes: queueBytes(),
        };
      } catch {
        closeCurrent();
        result.files = [];
        result.errors++;
        return {
          ...result,
          done: pending.length === 0,
          queueBytes: queueBytes(),
        };
      }
    },
  };
}
