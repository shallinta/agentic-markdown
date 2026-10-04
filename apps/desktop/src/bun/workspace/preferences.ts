import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  createSettingsStore,
  isSettingsObject,
} from "@agentic-markdown/shared/server";

export interface HiddenPreferences {
  get(path: string): Promise<boolean>;
  set(path: string, value: boolean): Promise<void>;
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
  const key = (path: string) => createHash("sha256").update(path).digest("hex");
  return {
    async get(path) {
      return (await store.load())[key(path)] === true;
    },
    async set(path, value) {
      await store.update((previous) => ({ ...previous, [key(path)]: value }));
    },
  };
}
