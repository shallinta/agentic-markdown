import { join } from "node:path";

import {
  createSettingsStore,
  getSettingsDir,
  isSettingsObject,
} from "@agentic-markdown/shared/server";

export function createSourceWrappingStore(settingsDir: string) {
  const store = createSettingsStore<{ enabled: boolean }>(
    join(settingsDir, "source-wrapping.json"),
    (value) => ({
      enabled:
        isSettingsObject(value) && typeof value.enabled === "boolean"
          ? value.enabled
          : true,
    })
  );
  return {
    async get() {
      return (await store.load()).enabled;
    },
    async set(enabled: boolean) {
      if (typeof enabled !== "boolean") throw Error("Invalid preference");
      await store.update(() => ({ enabled }));
    },
  };
}
export const sourceWrappingStore = createSourceWrappingStore(getSettingsDir());
