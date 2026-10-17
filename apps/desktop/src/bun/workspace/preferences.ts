import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  createSettingsStore,
  isSettingsObject,
  type PersistedSettings,
} from "@agentic-markdown/shared/server";

import { WORKSPACE_CACHE_BYTES } from "../../shared/workspace";

type HiddenMap = Record<string, boolean>;
export interface HiddenRemoval {
  status: "committed" | "rejected" | "unknown";
  query(): Promise<HiddenRemoval["status"]>;
}

export interface HiddenPreferences {
  get(path: string): Promise<boolean>;
  set(path: string, value: boolean): Promise<void>;
  remove?(path: string, remainingMetadataBytes?: number): Promise<HiddenRemoval>;
}
/** Preference identifiers never authorize paths or restore a workspace. */
export function createHiddenPreferences(
  settingsDir: string
): HiddenPreferences {
  const store = createSettingsStore<Record<string, boolean>>(
    join(settingsDir, "hidden-files.json"),
    (value) =>
      Object.fromEntries(
        isSettingsObject(value)
          ? Object.entries(value)
              .filter(
                ([key, flag]) =>
                  /^[a-f0-9]{64}$/.test(key) && typeof flag === "boolean"
              )
              .map(([key, flag]) => [key, flag === true])
          : []
      )
  );
  const strict = createSettingsStore<HiddenMap>(
    join(settingsDir, "hidden-files.json"),
    (value) => (isSettingsObject(value) ? (value as HiddenMap) : {}),
    {
      maxBytes: WORKSPACE_CACHE_BYTES,
      validateData: (value) =>
        isSettingsObject(value) &&
        Object.entries(value).every(
          ([key, flag]) =>
            /^[a-f0-9]{64}$/.test(key) && typeof flag === "boolean"
        ),
    }
  );
  const key = (path: string) => createHash("sha256").update(path).digest("hex");
  const same = (a: HiddenMap, b: HiddenMap) =>
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(
      (k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]
    );
  return {
    async get(path) {
      return (await store.load())[key(path)] === true;
    },
    async set(path, value) {
      await store.update((previous) => ({ ...previous, [key(path)]: value }));
    },
    async remove(path, remainingMetadataBytes = WORKSPACE_CACHE_BYTES) {
      const name = key(path);
      const initial = await strict.readPersisted();
      const terminal = (status: "committed" | "rejected"): HiddenRemoval => ({
        status,
        query: () => Promise.resolve(status),
      });
      if (initial.status === "missing") return terminal("committed");
      if (initial.status !== "valid") return terminal("rejected");
      // Bound retained initial/old/expected/observation/query maps and their keys.
      // This is conservative metadata charging, not a claim about VM heap layout.
      const charge = (value: HiddenMap) => JSON.stringify(value).length * 16 + Object.keys(value).length * 256;
      if (charge(initial.data) > remainingMetadataBytes) return terminal("rejected");
      if (!Object.prototype.hasOwnProperty.call(initial.data, name))
        return terminal("committed");
      const outcome = await strict.updateObserved((previous, format) => {
        if (format !== initial.format || !same(previous, initial.data))
          throw Error("Settings changed");
        if (charge(previous) > remainingMetadataBytes) throw Error("Settings metadata budget");
        const next = { ...previous };
        delete next[name];
        return next;
      });
      if (!outcome.attempted) return terminal("rejected");
      if (outcome.confirmed) return terminal("committed");
      const classify = (
        value: PersistedSettings<HiddenMap>
      ): HiddenRemoval["status"] =>
        value.status !== "valid"
          ? "unknown"
          : value.format === "version1" && same(value.data, outcome.expected)
            ? "committed"
            : value.format === outcome.beforeFormat &&
                same(value.data, outcome.before)
              ? "rejected"
              : "unknown";
      let status = classify(outcome.persisted);
      let querying: Promise<HiddenRemoval["status"]> | undefined;
      return {
        status,
        query: () => {
          if (status !== "unknown") return Promise.resolve(status);
          querying ??= strict.readPersisted().then(value => {
            if (status === "unknown") status = classify(value);
            return status;
          }).finally(() => { querying = undefined; });
          return querying;
        },
      };
    },
  };
}
