import {
  validMainTabSourceTabs,
  type MainTabSourceInput,
} from "../../shared/main-tab-checkpoint";
export type { MainTabSourceInput } from "../../shared/main-tab-checkpoint";

import {
  MAIN_TAB_METADATA_MAX_BYTES,
  mainTabMetadataSerializedBytes,
  validMainTabSessionMetadata,
  type MainTabSessionMetadata,
} from "./main-tab-metadata";

export interface MainTabSourceProof {
  sources: readonly {
    rootHandle: string;
    rootPath: string;
    relativePath: string;
    fingerprint: string;
  }[];
  current(): boolean;
}
interface Dependencies {
  workspace: {
    captureMainTabSources(
      tabs: readonly MainTabSourceInput[],
      check?: () => void
    ): Promise<MainTabSourceProof | undefined>;
  };
  roster: {
    confirmExpansionIdentity(
      path: string
    ): Promise<{ id: string; current(): boolean } | undefined>;
  };
}
export type BoundMainTabMetadata =
  | { status: "ready"; data: MainTabSessionMetadata; current(): boolean }
  | { status: "invalid" | "stale" | "unavailable" };

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string) =>
  Object.keys(value).sort().join() === keys;

export function captureMainTabMetadataInput(
  value: unknown
): { tabs: MainTabSourceInput[]; activeIndex: number | null } | undefined {
  if (
    !object(value) ||
    !exact(value, "activeIndex,tabs") ||
    !validMainTabSourceTabs(value.tabs)
  )
    return;
  const { activeIndex } = value;
  if (
    value.tabs.length === 0
      ? activeIndex !== null
      : typeof activeIndex !== "number" ||
        !Number.isSafeInteger(activeIndex) ||
        activeIndex < 0 ||
        activeIndex >= value.tabs.length
  )
    return;
  const tabs: MainTabSourceInput[] = [];
  for (const tab of value.tabs) {
    tabs.push({
      handle: tab.handle,
      documentId: tab.documentId,
      revision: tab.revision,
      hash: tab.hash,
      pinned: tab.pinned,
      mode: tab.mode,
    });
  }
  return { tabs, activeIndex: activeIndex as number | null };
}

/** Internal conversion only. A receipt is advisory; it neither opens nor saves documents. */
export function createMainTabMetadataBinder({
  workspace,
  roster,
}: Dependencies) {
  return {
    async bind(
      value: unknown,
      signal?: AbortSignal
    ): Promise<BoundMainTabMetadata> {
      const input = captureMainTabMetadataInput(value);
      if (!input) return { status: "invalid" };
      if (signal?.aborted) return { status: "stale" };
      let valid = true;
      const proofs: { current(): boolean }[] = [];
      const current = () => {
        try {
          valid =
            valid &&
            !signal?.aborted &&
            proofs.every((proof) => proof.current() === true);
        } catch {
          valid = false;
        }
        return valid;
      };
      try {
        const captured = await workspace.captureMainTabSources(
          input.tabs,
          () => {
            if (signal?.aborted) throw Error("SESSION_BIND_ABORTED");
          }
        );
        if (!current()) return { status: "stale" };
        if (!captured) return { status: "unavailable" };
        proofs.push(captured);
        if (!current()) return { status: "stale" };
        if (captured.sources.length !== input.tabs.length)
          return { status: "unavailable" };
        const roots = new Map<string, { path: string; id: string }>();
        const tabs: MainTabSessionMetadata["tabs"] = [];
        for (const [index, source] of captured.sources.entries()) {
          if (!current()) return { status: "stale" };
          let root = roots.get(source.rootHandle);
          if (root && root.path !== source.rootPath)
            return { status: "unavailable" };
          if (!root) {
            const proof = await roster.confirmExpansionIdentity(
              source.rootPath
            );
            if (!current()) return { status: "stale" };
            if (!proof) return { status: "unavailable" };
            proofs.push(proof);
            if (!current()) return { status: "stale" };
            root = { path: source.rootPath, id: proof.id };
            roots.set(source.rootHandle, root);
          }
          tabs.push({
            rootId: root.id,
            relativePath: source.relativePath,
            fingerprint: source.fingerprint,
            pinned: input.tabs[index].pinned,
            mode: input.tabs[index].mode,
          });
        }
        const data = { tabs, activeIndex: input.activeIndex };
        if (!current()) return { status: "stale" };
        if (
          !validMainTabSessionMetadata(data) ||
          mainTabMetadataSerializedBytes(data) > MAIN_TAB_METADATA_MAX_BYTES
        )
          return { status: "unavailable" };
        return { status: "ready", data, current };
      } catch {
        return { status: current() ? "unavailable" : "stale" };
      }
    },
  };
}
