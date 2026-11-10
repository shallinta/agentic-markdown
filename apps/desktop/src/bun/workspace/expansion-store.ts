import { join } from "node:path";

import { createSettingsStore } from "@agentic-markdown/shared/server";

import { validRootRosterId } from "../../shared/root-roster";
import { WORKSPACE_MAX_ROOTS } from "../../shared/workspace";
import {
  EXPANSION_MAX_BYTES,
  EXPANSION_MAX_DIRS,
  EXPANSION_MAX_DIRS_PER_ROOT,
  EXPANSION_MAX_PATH_LENGTH,
} from "../../shared/workspace-expansion";
export {
  EXPANSION_MAX_BYTES,
  EXPANSION_MAX_DIRS,
  EXPANSION_MAX_DIRS_PER_ROOT,
  EXPANSION_MAX_PATH_LENGTH,
} from "../../shared/workspace-expansion";

export interface RootExpansion {
  rootId: string;
  collapsed: boolean;
  expanded: readonly string[];
}
interface ExpansionData {
  roots: RootExpansion[];
}
export type ExpansionFailure =
  | "stale"
  | "invalid"
  | "capacity"
  | "legacy"
  | "future"
  | "corrupt"
  | "too-large"
  | "io"
  | "unknown"
  | "closed"
  | "queue-full";
export interface ExpansionResult {
  committed: boolean;
  roots: readonly RootExpansion[];
  readOnly: boolean;
  failure?: ExpansionFailure;
}

/** POSIX root-relative metadata only; never interpreted as a filesystem authority. */
export function validExpansionPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= EXPANSION_MAX_PATH_LENGTH &&
    !value.includes("\0") &&
    value
      .split("/")
      .every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}
function validData(value: unknown): value is ExpansionData {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).join() !== "roots" ||
    !("roots" in value) ||
    !Array.isArray(value.roots) ||
    value.roots.length > WORKSPACE_MAX_ROOTS
  )
    return false;
  const ids = new Set<string>();
  let count = 0;
  return value.roots.every((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    const root = item as RootExpansion;
    if (
      Object.keys(root).sort().join() !== "collapsed,expanded,rootId" ||
      !validRootRosterId(root.rootId) ||
      ids.has(root.rootId) ||
      typeof root.collapsed !== "boolean" ||
      !Array.isArray(root.expanded) ||
      root.expanded.length > EXPANSION_MAX_DIRS_PER_ROOT ||
      !root.expanded.every(validExpansionPath) ||
      new Set(root.expanded).size !== root.expanded.length
    )
      return false;
    ids.add(root.rootId);
    count += root.expanded.length;
    return count <= EXPANSION_MAX_DIRS;
  });
}
const copy = (data: ExpansionData): ExpansionData => ({
  roots: data.roots.map((root) => ({ ...root, expanded: [...root.expanded] })),
});
const byteLength = (data: ExpansionData) =>
  Buffer.byteLength(`${JSON.stringify({ version: 1, data }, null, 2)}\n`);

/** Caller supplies already validated stable root IDs, never renderer-selected paths. */
export function createExpansionStore(settingsDir: string) {
  const store = createSettingsStore<ExpansionData>(
    join(settingsDir, "workspace-expansion.json"),
    (value) => (validData(value) ? value : { roots: [] }),
    { maxBytes: EXPANSION_MAX_BYTES, validateData: validData }
  );
  let tail: Promise<unknown> = Promise.resolve();
  let queued = 0,
    closed = false,
    warning: ExpansionFailure | undefined;
  let warningEpoch = 0,
    activeEpoch = 0;
  let last: ExpansionData = { roots: [] };
  let readOnly = false;
  const response = (
    committed: boolean,
    failure = warning
  ): ExpansionResult => ({
    committed,
    roots: copy(last).roots,
    readOnly: readOnly || closed,
    ...(failure ? { failure } : {}),
  });
  async function inspect() {
    const persisted = await store.readPersisted();
    if (persisted.status === "valid" && persisted.format === "version1") {
      last = persisted.data;
      readOnly = false;
    } else if (persisted.status === "missing") {
      last = { roots: [] };
      readOnly = false;
    } else {
      readOnly = true;
      return persisted.status === "valid"
        ? ("legacy" as const)
        : persisted.status;
    }
    return undefined;
  }
  function enqueue(
    operation: () => Promise<ExpansionResult>
  ): Promise<ExpansionResult> {
    if (closed) return Promise.resolve(response(false, "closed"));
    if (queued >= 64) {
      warning = "queue-full";
      warningEpoch++;
      return Promise.resolve(response(false));
    }
    queued++;
    const epoch = warningEpoch;
    const task = tail
      .then(() => {
        activeEpoch = epoch;
        return operation();
      })
      .catch(() => {
        warning = "io";
        return response(false);
      });
    tail = task.finally(() => {
      queued--;
    });
    return task;
  }
  function mutate(
    change: (data: ExpansionData) => ExpansionData,
    inputValid: boolean,
    admitted: () => boolean = () => true
  ) {
    return enqueue(async () => {
      if (!inputValid) return response(false, "invalid");
      let rejection: ExpansionFailure | undefined;
      const result = await store.updateObserved((previous, format) => {
        let current = false;
        try {
          current = admitted() === true;
        } catch {
          /* Stale capabilities reject metadata mutation. */
        }
        if (!current) {
          rejection = "stale";
          throw Error("Expansion admission expired");
        }
        if (format === "legacy") {
          rejection = "legacy";
          throw Error("Legacy expansion metadata");
        }
        const next = change(copy(previous));
        if (!validData(next) || byteLength(next) > EXPANSION_MAX_BYTES) {
          rejection = "capacity";
          throw Error("Expansion metadata capacity");
        }
        return next;
      });
      if (
        result.attempted &&
        result.persisted.status === "valid" &&
        result.persisted.format === "version1" &&
        JSON.stringify(result.persisted.data) ===
          JSON.stringify(result.expected)
      ) {
        last = result.persisted.data;
        readOnly = false;
        if (activeEpoch === warningEpoch) warning = undefined;
        return response(true);
      }
      const protectedFailure = await inspect();
      if (rejection === "stale" && !protectedFailure)
        return response(false, "stale");
      warning = protectedFailure ?? rejection ?? "unknown";
      return response(false);
    });
  }
  function updateRoot(
    rootId: string,
    change: (root: RootExpansion) => RootExpansion,
    inputValid: boolean,
    admitted?: () => boolean
  ) {
    return mutate(
      (data) => {
        const current = data.roots.find((root) => root.rootId === rootId) ?? {
          rootId,
          collapsed: false,
          expanded: [],
        };
        const next = change(current);
        const index = data.roots.findIndex((root) => root.rootId === rootId);
        if (!next.collapsed && !next.expanded.length) {
          if (index >= 0) data.roots.splice(index, 1);
        } else if (index < 0) data.roots.push(next);
        else data.roots[index] = next;
        return data;
      },
      validRootRosterId(rootId) && inputValid,
      admitted
    );
  }
  return {
    read() {
      return enqueue(async () => response(false, (await inspect()) ?? warning));
    },
    setRootCollapsed(
      rootId: string,
      collapsed: boolean,
      admitted?: () => boolean
    ) {
      return updateRoot(
        rootId,
        (root) => ({ ...root, collapsed }),
        typeof collapsed === "boolean",
        admitted
      );
    },
    setDirectoryExpanded(
      rootId: string,
      path: string,
      expanded: boolean,
      admitted?: () => boolean
    ) {
      return updateRoot(
        rootId,
        (root) => ({
          ...root,
          expanded: expanded
            ? root.expanded.includes(path)
              ? root.expanded
              : [...root.expanded, path]
            : root.expanded.filter((entry) => entry !== path),
        }),
        validExpansionPath(path) && typeof expanded === "boolean",
        admitted
      );
    },
    removeRoot(rootId: string, admitted?: () => boolean) {
      return mutate(
        (data) => ({
          roots: data.roots.filter((root) => root.rootId !== rootId),
        }),
        validRootRosterId(rootId),
        admitted
      );
    },
    prune(confirmedRootIds: readonly string[], admitted?: () => boolean) {
      const ids = [...confirmedRootIds];
      return mutate(
        (data) => ({
          roots: data.roots.filter((root) => ids.includes(root.rootId)),
        }),
        ids.length <= WORKSPACE_MAX_ROOTS &&
          ids.every(validRootRosterId) &&
          new Set(ids).size === ids.length,
        admitted
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
