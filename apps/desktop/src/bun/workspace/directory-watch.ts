import { closeSync } from "node:fs";
import { createRequire } from "node:module";

import { verifyRoot, type RootAuthorization } from "./authorization";
import {
  createScan,
  openDirectoryDescriptor,
  type DirectoryNative,
  type PendingDirectory,
} from "./scan";

// Resource protection, not a performance target. Includes retained + staging.
export const WATCH_DIRECTORY_LIMIT = 512;
export const WATCH_METADATA_BYTES = 2 * 1024 * 1024;
export type ObservationStatus = "establishing" | "watching" | "limited";
interface Native extends DirectoryNative {
  watchCreate(limit: number): object;
  watchAdd(instance: object, fd: number): number;
  watchRemove(instance: object, id: number): void;
  watchPoll(
    instance: object,
    limit: number
  ): { events: { id: number; flags: number }[]; saturated: boolean };
  watchClose(instance: object): void;
}
interface Registration {
  directory: PendingDirectory;
  id: number;
  proof: string;
  bytes: number;
}
interface Root {
  key: string;
  authorization: RootAuthorization;
  hidden: boolean;
  state: ObservationStatus;
  registrations: Map<string, Registration>;
  refresh: boolean;
  dirty: boolean;
  installed: boolean;
}

/** Worker-only owned state. One scan batch per tick, no unbounded wait. */
export function createDirectoryWatch(
  nativePath: string,
  inspectRegistration?: (directory: PendingDirectory, fd: number) => void
) {
  const native = createRequire(import.meta.url)(nativePath) as Native;
  const instance = native.watchCreate(WATCH_DIRECTORY_LIMIT);
  const roots = new Map<string, Root>();
  let disposed = false,
    turn = 0,
    verifyTurn = 0;
  let job:
    | {
        root: Root;
        scan: ReturnType<typeof createScan>;
        pending: Map<string, PendingDirectory>;
        bytes: number;
        installing?: boolean;
        added?: boolean;
      }
    | undefined;
  const bytes = () =>
    [...roots.values()].reduce(
      (sum, root) =>
        sum +
        [...root.registrations.values()].reduce(
          (n, item) => n + item.bytes,
          0
        ) +
        Buffer.byteLength(JSON.stringify(root.authorization)),
      0
    ) + (job?.bytes ?? 0);
  const count = () =>
    [...roots.values()].reduce(
      (sum, root) => sum + root.registrations.size,
      0
    ) + (job?.pending.size ?? 0);
  function cancelJob(root: Root) {
    if (job?.root === root) {
      job.scan.close();
      job = undefined;
    }
  }
  function clear(root: Root) {
    cancelJob(root);
    for (const item of root.registrations.values())
      native.watchRemove(instance, item.id);
    root.registrations.clear();
  }
  function limited(root: Root) {
    clear(root);
    root.state = "limited";
    root.refresh = false;
    root.dirty = false;
  }
  function validate(root: Root, directory: PendingDirectory) {
    const fd = openDirectoryDescriptor(root.authorization, directory, native);
    closeSync(fd);
  }
  return {
    bytes,
    queueBytes: () => job?.scan.queueBytes() ?? 0,
    add(key: string, authorization: RootAuthorization, hidden: boolean) {
      if (disposed) throw Error();
      if (roots.has(key)) return;
      if (
        roots.size >= 32 ||
        bytes() + Buffer.byteLength(JSON.stringify(authorization)) >
          WATCH_METADATA_BYTES
      )
        throw Error();
      roots.set(key, {
        key,
        authorization,
        hidden,
        state: "establishing",
        registrations: new Map(),
        refresh: true,
        dirty: false,
        installed: false,
      });
    },
    remove(key: string) {
      const root = roots.get(key);
      if (root) {
        clear(root);
        roots.delete(key);
      }
    },
    async tick(queueLimit: number, metadataLimit = WATCH_METADATA_BYTES) {
      if (disposed) throw Error();
      const dirty = new Set<string>();
      const events = native.watchPoll(instance, 64);
      for (const root of roots.values()) {
        if (root.state === "limited") continue;
        const changed =
          events.saturated ||
          events.events.some((event) =>
            [...root.registrations.values()].some(
              (entry) => entry.id === event.id
            )
          );
        if (changed) {
          try {
            await verifyRoot(root.authorization);
            for (const item of root.registrations.values()) {
              if (!events.events.some((event) => event.id === item.id))
                continue;
              try {
                validate(root, item.directory);
              } catch {
                native.watchRemove(instance, item.id);
                root.registrations.delete(item.directory.path);
              }
            }
            root.refresh = true;
            root.dirty = true;
          } catch {
            limited(root);
          }
        }
      }
      if (!job) {
        const ordered = [...roots.values()];
        const root = Array.from(
          { length: ordered.length },
          (_, i) => ordered[(turn + i) % ordered.length]
        ).find((item) => item.refresh);
        if (root) {
          root.state = "establishing";
          turn = (ordered.indexOf(root) + 1) % ordered.length;
          root.refresh = false;
          const pending = new Map<string, PendingDirectory>();
          const scan = createScan(
            root.authorization,
            nativePath,
            root.hidden,
            (directory) => {
              const size = Buffer.byteLength(JSON.stringify(directory)) + 128;
              if (
                count() >= WATCH_DIRECTORY_LIMIT ||
                bytes() + size > Math.min(metadataLimit, WATCH_METADATA_BYTES)
              )
                throw Error();
              pending.set(directory.path, directory);
              job!.bytes += size;
            }
          );
          job = { root, scan, pending, bytes: 0 };
        }
      }
      if (job) {
        const active = job;
        try {
          const batch = active.installing
            ? { errors: 0, paused: false, done: true }
            : await active.scan.next(queueLimit);
          if (batch.errors || batch.paused) throw Error();
          if (batch.done) {
            await verifyRoot(active.root.authorization);
            if (!active.installing) {
              active.scan.close();
              active.installing = true;
              for (const [path, item] of active.root.registrations) {
                const next = active.pending.get(path);
                if (!next || JSON.stringify(next) !== item.proof) {
                  native.watchRemove(instance, item.id);
                  active.root.registrations.delete(path);
                }
              }
            }
            // A finite descriptor chain batch lets cleanup and ordinary scans run.
            for (const [path, directory] of [...active.pending].slice(0, 16)) {
              validate(active.root, directory);
              active.pending.delete(path);
              active.bytes -=
                Buffer.byteLength(JSON.stringify(directory)) + 128;
              if (active.root.registrations.has(path)) continue;
              const fd = openDirectoryDescriptor(
                active.root.authorization,
                directory,
                native
              );
              try {
                const proof = JSON.stringify(directory);
                active.root.registrations.set(path, {
                  directory,
                  proof,
                  bytes: Buffer.byteLength(proof) + 128,
                  id: native.watchAdd(instance, fd),
                });
                inspectRegistration?.(directory, fd);
                active.added = true;
              } finally {
                closeSync(fd);
              }
            }
            if (active.pending.size)
              return {
                roots: [...roots.values()].map((root) => ({
                  key: root.key,
                  status: root.state,
                  dirty: false,
                })),
                bytes: bytes(),
                queueBytes: 0,
              };
            job = undefined;
            const catchup = !active.root.installed || active.added;
            active.root.installed = true;
            active.root.state = catchup ? "establishing" : "watching";
            if (active.root.dirty || catchup) dirty.add(active.root.key);
            active.root.dirty = false;
            if (catchup) active.root.refresh = true;
          }
        } catch {
          limited(active.root);
        }
      }
      // Root ancestors may move without an event on a descendant descriptor.
      const root = [...roots.values()][verifyTurn++ % Math.max(1, roots.size)];
      if (root && root.state !== "limited") {
        try {
          await verifyRoot(root.authorization);
        } catch {
          limited(root);
        }
      }
      return {
        roots: [...roots.values()].map((root) => ({
          key: root.key,
          status: root.state,
          dirty: dirty.has(root.key),
        })),
        bytes: bytes(),
        queueBytes: job?.scan.queueBytes() ?? 0,
      };
    },
    close() {
      if (disposed) return;
      for (const root of roots.values()) clear(root);
      roots.clear();
      native.watchClose(instance);
      disposed = true;
    },
  };
}
