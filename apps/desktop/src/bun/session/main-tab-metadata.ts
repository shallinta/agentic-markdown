import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";

import { createSettingsStore } from "@agentic-markdown/shared/server";

import { MAIN_TAB_METADATA_MAX_TABS } from "../../shared/main-tab-checkpoint";
import { validRootRosterId } from "../../shared/root-roster";
import { WORKSPACE_MAX_ROOTS } from "../../shared/workspace";
import { validExpansionPath } from "../workspace/expansion-store";

export { MAIN_TAB_METADATA_MAX_TABS } from "../../shared/main-tab-checkpoint";
export const MAIN_TAB_METADATA_MAX_BYTES = 256 * 1024;
export interface MainTabMetadata {
  rootId: string;
  relativePath: string;
  fingerprint: string;
  pinned: boolean;
  mode: "editing" | "source";
}
export interface MainTabSessionMetadata {
  tabs: MainTabMetadata[];
  activeIndex: number | null;
}
export type MainTabMetadataFailure =
  | "legacy"
  | "future"
  | "corrupt"
  | "too-large"
  | "io"
  | "invalid"
  | "capacity"
  | "closed"
  | "queue-full"
  | "stale"
  | "not-owned";
export type MainTabMetadataRead =
  | { status: "valid"; data: MainTabSessionMetadata }
  | { status: "missing" | MainTabMetadataFailure };
export type MainTabMetadataObservation =
  | { status: "valid"; data: MainTabSessionMetadata; current(): boolean }
  | { status: "missing" | MainTabMetadataFailure };
export type MainTabMetadataWrite =
  | { status: "committed" }
  | { status: "rejected" | "unknown"; reason: MainTabMetadataFailure };
const exact = (value: object, keys: string[]) =>
  Object.keys(value).sort().join() === keys.sort().join();
// fileFingerprint is `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`. Metadata is
// descriptive only; matching it never grants access to the historical file.
const fingerprint = /^(0|[1-9]\d{0,19}):(0|[1-9]\d{0,19}):(0|-?[1-9]\d{0,29})$/;
export function validMainTabSessionMetadata(
  value: unknown
): value is MainTabSessionMetadata {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !exact(value, ["tabs", "activeIndex"])
  )
    return false;
  const data = value as MainTabSessionMetadata;
  if (
    !Array.isArray(data.tabs) ||
    data.tabs.length > MAIN_TAB_METADATA_MAX_TABS
  )
    return false;
  if (
    data.tabs.length === 0
      ? data.activeIndex !== null
      : !Number.isSafeInteger(data.activeIndex) ||
        data.activeIndex === null ||
        data.activeIndex < 0 ||
        data.activeIndex >= data.tabs.length
  )
    return false;
  const paths = new Set<string>(),
    roots = new Set<string>();
  for (const item of data.tabs as unknown[]) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      !exact(item, ["rootId", "relativePath", "fingerprint", "pinned", "mode"])
    )
      return false;
    const tab = item as MainTabMetadata;
    if (
      !validRootRosterId(tab.rootId) ||
      !validExpansionPath(tab.relativePath) ||
      ![".md", ".markdown"].includes(extname(tab.relativePath).toLowerCase()) ||
      typeof tab.fingerprint !== "string" ||
      !fingerprint.test(tab.fingerprint) ||
      typeof tab.pinned !== "boolean" ||
      (tab.mode !== "editing" && tab.mode !== "source")
    )
      return false;
    const key = JSON.stringify([tab.rootId, tab.relativePath]);
    if (paths.has(key)) return false;
    paths.add(key);
    roots.add(tab.rootId);
    if (roots.size > WORKSPACE_MAX_ROOTS) return false;
  }
  return true;
}
export const mainTabMetadataSerializedBytes = (data: MainTabSessionMetadata) =>
  Buffer.byteLength(`${JSON.stringify({ version: 1, data }, null, 2)}\n`);

interface CheckpointObservations {
  token: object;
  pendingWrites: number;
  stores: number;
}
const recoveryWitnesses = new WeakMap<
  object,
  { path: string; bytes: string; current(): boolean }
>();
const checkpointObservations = new Map<string, CheckpointObservations>();

/** Private observation only: bounded synchronous terminal byte check, never a restore source. */
function exactRecoveryObservation(
  receipt: MainTabMetadataObservation,
  path: string
): boolean {
  const witness = recoveryWitnesses.get(receipt);
  if (witness?.path !== path) return false;
  let fd: number | undefined;
  try {
    if (!witness.current()) return false;
    const expected = Buffer.from(witness.bytes);
    if (expected.length > MAIN_TAB_METADATA_MAX_BYTES) return false;
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size !== BigInt(expected.length))
      return false;
    const bytes = Buffer.alloc(expected.length + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, length);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(fd, { bigint: true });
    const named = lstatSync(path, { bigint: true });
    const matches = [after, named].every(
      (value) =>
        value.isFile() &&
        value.dev === before.dev &&
        value.ino === before.ino &&
        value.size === before.size &&
        value.mtimeNs === before.mtimeNs &&
        value.ctimeNs === before.ctimeNs &&
        value.mode === before.mode &&
        value.nlink === before.nlink
    );
    return (
      matches &&
      length === expected.length &&
      bytes.subarray(0, length).equals(expected) &&
      witness.current()
    );
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* Read-only FD; no ownership is acquired. */
      }
    }
  }
}

/** Isolated precursor only. No startup consumer, path lookup, or authority restoration. */
export function createMainTabMetadataStore(isolatedDir: string) {
  return createMetadataStore(join(isolatedDir, "main-tab-session-probe.json"));
}

/** Internal checkpoint storage; callers must supply a live authority guard. */
export function createMainTabCheckpointMetadataStore(directory: string) {
  const path = resolve(directory, "main-tab-session-checkpoint.json");
  const observed = checkpointObservations.get(path) ?? {
    token: {},
    pendingWrites: 0,
    stores: 0,
  };
  observed.stores++;
  checkpointObservations.set(path, observed);
  const store = createMetadataStore(path, observed);
  let closed = false;
  return {
    ...store,
    exactCurrent(receipt: MainTabMetadataObservation): boolean {
      return !closed && exactRecoveryObservation(receipt, path);
    },
    async readObserved(): Promise<MainTabMetadataObservation> {
      const token = observed.token;
      const current = () =>
        !closed && !observed.pendingWrites && observed.token === token;
      if (!current()) return { status: "stale" };
      const { record, bytes } = await store.readExact();
      if (!current()) return { status: "stale" };
      if (record.status !== "valid") return record;
      if (bytes === undefined) return { status: "io" };
      const receipt = { ...record, current };
      recoveryWitnesses.set(receipt, { path, bytes, current });
      return receipt;
    },
    write(
      value: unknown,
      current: () => boolean
    ): Promise<MainTabMetadataWrite> {
      if (typeof current !== "function")
        return Promise.resolve({ status: "rejected", reason: "stale" });
      return store.write(value, current);
    },
    async close() {
      if (closed) return store.close();
      closed = true;
      try {
        await store.close();
      } finally {
        if (--observed.stores === 0) checkpointObservations.delete(path);
      }
    },
  };
}

function createMetadataStore(path: string, observed?: CheckpointObservations) {
  const ownedCheckpoint = !!observed;
  let owner: { encoded: string; bytes: string } | undefined;
  const store = createSettingsStore<MainTabSessionMetadata>(
    path,
    (value) =>
      validMainTabSessionMetadata(value)
        ? value
        : { tabs: [], activeIndex: null },
    {
      maxBytes: MAIN_TAB_METADATA_MAX_BYTES,
      validateData: validMainTabSessionMetadata,
    }
  );
  let closed = false,
    queued = 0;
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(
    operation: () => Promise<T>,
    reject: (reason: MainTabMetadataFailure) => T,
    writesCheckpoint = false
  ): Promise<T> {
    if (closed || queued >= 64)
      return Promise.resolve(reject(closed ? "closed" : "queue-full"));
    const writing = writesCheckpoint ? observed : undefined;
    if (writing) {
      // A queued writer can reach the settings store after a read from another instance.
      writing.token = {};
      writing.pendingWrites++;
    }
    queued++;
    const next = tail.then(operation).catch(() => reject("io"));
    tail = next.finally(() => {
      queued--;
      if (writing) writing.pendingWrites--;
    });
    return next;
  }
  async function read(): Promise<MainTabMetadataRead> {
    const result = await store.readPersisted();
    return result.status === "valid"
      ? result.format === "version1"
        ? { status: "valid", data: result.data }
        : { status: "legacy" }
      : result;
  }
  return {
    read() {
      return enqueue(read, (status) => ({ status }));
    },
    readExact() {
      return enqueue<{
        record: MainTabMetadataRead;
        bytes: string | undefined;
      }>(
        () =>
          store.observePersisted((value, bytes) => ({
            record:
              value.status === "valid"
                ? value.format === "version1"
                  ? { status: "valid" as const, data: value.data }
                  : { status: "legacy" as const }
                : value,
            bytes,
          })),
        (status) => ({ record: { status }, bytes: undefined })
      );
    },
    claimObservation(
      receipt: MainTabMetadataObservation,
      current: () => boolean
    ): Promise<boolean> {
      const witness = recoveryWitnesses.get(receipt);
      if (!ownedCheckpoint || witness?.path !== path)
        return Promise.resolve(false);
      const valid = () => {
        try {
          return !closed && current() === true && witness.current() === true;
        } catch {
          return false;
        }
      };
      return enqueue(
        () =>
          store.observePersisted((value, bytes) => {
            if (
              !valid() ||
              value.status !== "valid" ||
              value.format !== "version1" ||
              bytes !== witness.bytes ||
              (value.data.tabs.length !== 1 && value.data.tabs.length !== 2) ||
              value.data.activeIndex === null
            )
              return false;
            owner = { encoded: JSON.stringify(value.data), bytes };
            return true;
          }),
        () => false
      );
    },
    write(
      value: unknown,
      current?: () => boolean
    ): Promise<MainTabMetadataWrite> {
      if (!validMainTabSessionMetadata(value))
        return Promise.resolve({ status: "rejected", reason: "invalid" });
      if (mainTabMetadataSerializedBytes(value) > MAIN_TAB_METADATA_MAX_BYTES)
        return Promise.resolve({ status: "rejected", reason: "capacity" });
      const captured: MainTabSessionMetadata = {
        tabs: value.tabs.map((tab) => ({ ...tab })),
        activeIndex: value.activeIndex,
      };
      return enqueue(
        async () => {
          let legacy = false;
          let changedBytes = false;
          const bytes = `${JSON.stringify({ version: 1, data: captured }, null, 2)}\n`;
          const result = await store.updateObserved(
            (_previous, format, original) => {
              changedBytes = original !== bytes;
              if (format === "legacy") {
                legacy = true;
                throw Error("Legacy session metadata");
              }
              return captured;
            },
            current
          );
          if ("stale" in result && result.stale)
            return { status: "rejected" as const, reason: "stale" as const };
          if (
            result.attempted &&
            result.persisted.status === "valid" &&
            result.persisted.format === "version1" &&
            JSON.stringify(result.persisted.data) === JSON.stringify(captured)
          ) {
            if (ownedCheckpoint) {
              const encoded = JSON.stringify(captured);
              if (result.confirmed && changedBytes)
                owner = {
                  encoded,
                  bytes,
                };
              else if (!result.confirmed || owner?.encoded !== encoded)
                owner = undefined;
            }
            return { status: "committed" as const };
          }
          if (ownedCheckpoint) owner = undefined;
          // A guarded publication may already have started. Its queue-owned
          // observation is final; a later read cannot prove it was rejected.
          if (current && result.attempted)
            return { status: "unknown" as const, reason: "io" as const };
          const observed = await read();
          if (legacy)
            return { status: "rejected" as const, reason: "legacy" as const };
          if (observed.status !== "valid" && observed.status !== "missing")
            return { status: "rejected" as const, reason: observed.status };
          return { status: "unknown" as const, reason: "io" as const };
        },
        (reason) => ({ status: "rejected" as const, reason }),
        true
      );
    },
    clearOwned(current: () => boolean): Promise<MainTabMetadataWrite> {
      const capturedOwner = owner;
      if (!ownedCheckpoint || !capturedOwner)
        return Promise.resolve({ status: "rejected", reason: "not-owned" });
      let valid = true;
      const admitted = () => {
        try {
          valid =
            valid &&
            owner === capturedOwner &&
            typeof current === "function" &&
            current() === true;
        } catch {
          valid = false;
        }
        return valid;
      };
      return enqueue<MainTabMetadataWrite>(
        async () => {
          if (!admitted()) return { status: "rejected", reason: "stale" };
          let matched = false;
          let stale = false;
          const empty: MainTabSessionMetadata = { tabs: [], activeIndex: null };
          const result = await store.updateObserved(
            (previous, format, original) => {
              stale = !admitted();
              if (
                stale ||
                format !== "version1" ||
                original !== capturedOwner.bytes ||
                JSON.stringify(previous) !== capturedOwner.encoded
              )
                throw Error("Checkpoint ownership changed");
              matched = true;
              return empty;
            },
            admitted
          );
          if (stale || ("stale" in result && result.stale))
            return { status: "rejected" as const, reason: "stale" as const };
          if (result.attempted) {
            owner = undefined;
            if (
              result.persisted.status === "valid" &&
              result.persisted.format === "version1" &&
              JSON.stringify(result.persisted.data) === JSON.stringify(empty)
            )
              return { status: "committed" as const };
            return { status: "unknown" as const, reason: "io" as const };
          }
          owner = undefined;
          return {
            status: "rejected" as const,
            reason: matched ? ("io" as const) : ("not-owned" as const),
          };
        },
        (reason) => ({ status: "rejected" as const, reason }),
        true
      );
    },
    async drain() {
      await tail;
    },
    async close() {
      closed = true;
      await tail;
    },
  };
}
