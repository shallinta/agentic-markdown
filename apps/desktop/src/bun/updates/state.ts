import { join } from "node:path";

import {
  createSettingsStore,
  getSettingsDir,
  isSettingsObject,
} from "@agentic-markdown/shared/server";

import { DEFAULT_UPDATE_MODE, type UpdateMode } from "../../shared/updates";

interface UpdatesState {
  mode?: UpdateMode;
  lastSeenHashes?: Record<string, string>;
}

const VALID_MODES: readonly UpdateMode[] = ["automatic", "manual", "off"];

export interface UpdatesStateStore {
  getUpdateMode(): Promise<UpdateMode>;
  setUpdateMode(mode: UpdateMode): Promise<void>;
  getLastSeenHash(identifier: string): Promise<string | undefined>;
  setLastSeenHash(identifier: string, hash: string): Promise<void>;
}

/** Persist existing updater preferences; this does not validate update delivery. */
export function createUpdatesStateStore(
  settingsDir: string
): UpdatesStateStore {
  const store = createSettingsStore<UpdatesState>(
    join(settingsDir, "updates.json"),
    (value) => {
      if (!isSettingsObject(value)) return {};
      const state: UpdatesState = {};
      if (VALID_MODES.includes(value.mode as UpdateMode))
        state.mode = value.mode as UpdateMode;
      if (isSettingsObject(value.lastSeenHashes)) {
        state.lastSeenHashes = Object.fromEntries(
          Object.entries(value.lastSeenHashes).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        );
      }
      return state;
    }
  );
  return {
    async getUpdateMode() {
      return (await store.load()).mode ?? DEFAULT_UPDATE_MODE;
    },
    setUpdateMode(mode) {
      return store.update((state) => ({ ...state, mode }));
    },
    async getLastSeenHash(identifier) {
      const hashes = (await store.load()).lastSeenHashes;
      return hashes && Object.prototype.hasOwnProperty.call(hashes, identifier)
        ? hashes[identifier]
        : undefined;
    },
    setLastSeenHash(identifier, hash) {
      return store.update((state) => ({
        ...state,
        lastSeenHashes: { ...state.lastSeenHashes, [identifier]: hash },
      }));
    },
  };
}

const defaultStore = createUpdatesStateStore(getSettingsDir());
export const getUpdateMode = () => defaultStore.getUpdateMode();
export const setUpdateMode = (mode: UpdateMode) =>
  defaultStore.setUpdateMode(mode);
export const getLastSeenHash = (identifier: string) =>
  defaultStore.getLastSeenHash(identifier);
export const setLastSeenHash = (identifier: string, hash: string) =>
  defaultStore.setLastSeenHash(identifier, hash);
