import { randomUUID } from "node:crypto";
import { basename, join, normalize } from "node:path";

import { createSettingsStore } from "@agentic-markdown/shared/server";

import type {
  RootRosterEntry,
  RootRosterFailure,
} from "../../shared/root-roster";
import { WORKSPACE_MAX_ROOTS } from "../../shared/workspace";
export type {
  RootRosterEntry,
  RootRosterFailure,
} from "../../shared/root-roster";

interface RosterData {
  entries: RootRosterEntry[];
}
export interface RootRosterState {
  readOnly: boolean;
  pending: readonly RootRosterEntry[];
  live: readonly RootRosterEntry[];
  failure?: RootRosterFailure;
}
export interface RootRosterResult {
  committed: boolean;
  state: RootRosterState;
}
export interface RootRosterIdentityConfirmation {
  readonly id: string;
  current(): boolean;
}
export interface RootRosterSetConfirmation {
  readonly ids: readonly string[];
  current(): boolean;
}
export const ROOT_ROSTER_MAX_BYTES =
  WORKSPACE_MAX_ROOTS * (4096 * 6 + 1024 * 6 + 128) + 128;
const pathValid = (path: unknown): path is string =>
  typeof path === "string" &&
  path.startsWith("/") &&
  path.length <= 4096 &&
  !path.includes("\0") &&
  normalize(path) === path;
function valid(value: unknown): value is RosterData {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).join() !== "entries" ||
    !("entries" in value) ||
    !Array.isArray(value.entries) ||
    value.entries.length > WORKSPACE_MAX_ROOTS
  )
    return false;
  const ids = new Set<string>(),
    paths = new Set<string>();
  return value.entries.every((e: unknown) => {
    if (!e || typeof e !== "object") return false;
    const r = e as RootRosterEntry;
    if (
      Object.keys(r).sort().join() !== "id,name,path" ||
      typeof r.id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        r.id
      ) ||
      !pathValid(r.path) ||
      typeof r.name !== "string" ||
      !r.name.length ||
      r.name.length > 1024 ||
      r.name.includes("\0") ||
      ids.has(r.id) ||
      paths.has(r.path)
    )
      return false;
    ids.add(r.id);
    paths.add(r.path);
    return true;
  });
}

/** Backend-only metadata. Paths supplied here must already have committed authority. */
export function createRootRoster(settingsDir: string) {
  const store = createSettingsStore<RosterData>(
    join(settingsDir, "workspace-roots.json"),
    (value) => (valid(value) ? value : { entries: [] }),
    { maxBytes: ROOT_ROSTER_MAX_BYTES, validateData: valid }
  );
  let pending: RootRosterEntry[] = [],
    live: RootRosterEntry[] = [];
  let loaded = false,
    disabled: RootRosterFailure | undefined,
    closed = false,
    queued = 0;
  let tail: Promise<unknown> = Promise.resolve();
  let warning: RootRosterFailure | undefined;
  let missedSnapshot = false;
  let admissionWarningEpoch = 0,
    activeAdmissionEpoch = 0;
  let identityEpoch = 0;
  const state = (
    failure = missedSnapshot ? ("queue-full" as const) : warning
  ): RootRosterState => ({
    readOnly: disabled !== undefined || closed,
    pending: pending.map((e) => ({ ...e })),
    live: live.map((e) => ({ ...e })),
    ...(failure ? { failure } : {}),
  });
  async function load() {
    if (loaded) return;
    const result = await store.readPersisted();
    loaded = true;
    if (result.status === "valid") {
      if (result.format === "legacy") disabled = "legacy";
      else pending = result.data.entries;
    } else if (result.status !== "missing") disabled = result.status;
  }
  function queue<T>(
    operation: () => Promise<T>,
    fallback: (failure: RootRosterFailure) => T
  ): Promise<T> {
    if (closed || queued >= 64) {
      return Promise.resolve(fallback(closed ? "closed" : "queue-full"));
    }
    queued++;
    const admittedEpoch = admissionWarningEpoch;
    const next = tail
      .then(() => {
        activeAdmissionEpoch = admittedEpoch;
        return operation();
      })
      .catch(() => fallback("io"));
    tail = next.finally(() => {
      queued--;
    });
    return next;
  }
  function enqueue(operation: () => Promise<RootRosterResult>) {
    return queue(operation, (failure) => {
      if (failure === "queue-full") {
        missedSnapshot = true;
        warning = "queue-full";
        admissionWarningEpoch++;
      }
      if (failure === "io") warning = "io";
      return {
        committed: false,
        state: state(failure === "io" ? undefined : failure),
      };
    });
  }
  function confirmDurable<T>(
    match: (
      entries: readonly RootRosterEntry[],
      current: () => boolean
    ) => T | undefined
  ) {
    const epoch = identityEpoch;
    const current = () =>
      !closed && !disabled && !missedSnapshot && identityEpoch === epoch;
    return queue(
      async () => {
        await load();
        if (!current()) return;
        const persisted = await store.readPersisted();
        if (
          !current() ||
          persisted.status !== "valid" ||
          persisted.format !== "version1"
        )
          return;
        return match(persisted.data.entries, current);
      },
      () => undefined
    );
  }
  async function persist(
    authoritative = false,
    removedPendingId?: string
  ): Promise<RootRosterResult> {
    const failed = (reason: RootRosterFailure): RootRosterResult => {
      warning = reason;
      return { committed: false, state: state() };
    };
    if (disabled) return { committed: false, state: state(disabled) };
    let entries = [
      ...live,
      ...pending.filter((e) => !live.some((l) => l.path === e.path)),
    ];
    const removalOnly =
      entries.length > WORKSPACE_MAX_ROOTS && removedPendingId !== undefined;
    if (entries.length > WORKSPACE_MAX_ROOTS && !removalOnly)
      return failed("capacity");
    if (!removalOnly && !valid({ entries })) return failed("invalid");
    let legacy = false;
    const result = await store.updateObserved((before, format) => {
      if (format === "legacy") {
        legacy = true;
        throw Error("LEGACY");
      }
      // Progressively free capacity without discarding other durable roots or
      // publishing an incomplete new live roster.
      if (removalOnly)
        entries = before.entries.filter(
          (entry) => entry.id !== removedPendingId
        );
      return { entries };
    });
    if (
      result.attempted &&
      result.persisted.status === "valid" &&
      result.persisted.format === "version1" &&
      JSON.stringify(result.persisted.data) === JSON.stringify({ entries })
    ) {
      if (activeAdmissionEpoch === admissionWarningEpoch) {
        if (authoritative) missedSnapshot = false;
        if (!missedSnapshot) warning = removalOnly ? "capacity" : undefined;
      }
      return { committed: true, state: state() };
    }
    const observed = await store.readPersisted();
    const failure: RootRosterFailure = legacy
      ? "legacy"
      : observed.status === "valid" || observed.status === "missing"
        ? "unknown"
        : observed.status;
    if (["legacy", "future", "corrupt", "too-large"].includes(failure))
      disabled = failure;
    return failed(failure);
  }
  return {
    read() {
      return enqueue(async () => {
        await load();
        return { committed: false, state: state(disabled) };
      });
    },
    confirmExpansionIdentity(
      path: string
    ): Promise<RootRosterIdentityConfirmation | undefined> {
      return confirmDurable((entries, current) => {
        const entry = live.find((item) => item.path === path);
        if (
          entry &&
          entries.some((item) => item.path === path && item.id === entry.id)
        )
          return { id: entry.id, current };
      });
    },
    confirmExpansionRoster(): Promise<RootRosterSetConfirmation | undefined> {
      return confirmDurable((entries, current) => {
        // A partial durable roster cannot justify pruning unrelated preferences.
        const expected = new Map(
          [...live, ...pending].map(({ path, id }) => [path, id])
        );
        if (
          expected.size !== entries.length ||
          entries.some(({ path, id }) => expected.get(path) !== id)
        )
          return;
        return { ids: Object.freeze(entries.map(({ id }) => id)), current };
      });
    },
    /** Call only after a committed add/remove/Trash. Exact selectedPath also covers verified parent-covered picks.
     * Failed persistence does not undo live authority or successful selection; `committed` refers only to metadata storage.
     */
    reconcile(paths: readonly string[], selectedPath?: string) {
      identityEpoch++;
      const captured = [...paths];
      return enqueue(async () => {
        await load();
        if (
          !captured.every(pathValid) ||
          new Set(captured).size !== captured.length ||
          (selectedPath !== undefined && !pathValid(selectedPath))
        )
          return { committed: false, state: state("invalid") };
        const previous = [...live, ...pending];
        live = captured.map(
          (path) =>
            previous.find((e) => e.path === path) ?? {
              id: randomUUID(),
              path,
              name: basename(path) || "/",
            }
        );
        pending = pending.filter(
          (e) => e.path !== selectedPath && !captured.includes(e.path)
        );
        return persist(true);
      });
    },
    removePending(id: string, admitted: () => boolean = () => true) {
      identityEpoch++;
      return enqueue(async () => {
        await load();
        if (!admitted()) return { committed: false, state: state("busy") };
        if (disabled) return { committed: false, state: state(disabled) };
        if (!pending.some((e) => e.id === id))
          return { committed: false, state: state("invalid") };
        const before = pending;
        pending = pending.filter((e) => e.id !== id);
        const result = await persist(false, id);
        if (!result.committed) {
          pending = before;
          return { ...result, state: state(result.state.failure) };
        }
        return result;
      });
    },
    /** Only after explicit user clear committed; never call from dispose/removeAll. */
    clearExplicit() {
      identityEpoch++;
      return enqueue(async () => {
        await load();
        live = [];
        if (disabled) return { committed: false, state: state(disabled) };
        const before = pending;
        pending = [];
        const result = await persist(true);
        if (!result.committed) {
          pending = before;
          return { ...result, state: state(result.state.failure) };
        }
        return result;
      });
    },
    /** Caller suspends workspace mutation admission before a reversible lifecycle drain. */
    async drain() {
      await tail;
    },
    async close() {
      closed = true;
      await tail;
    },
  };
}
