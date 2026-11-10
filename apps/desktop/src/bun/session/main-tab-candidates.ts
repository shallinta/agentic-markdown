import type { TrustedWorkspaceService } from "../workspace";

import {
  validMainTabSessionMetadata,
  type MainTabMetadataRead,
} from "./main-tab-metadata";

interface Dependencies {
  workspace: Pick<TrustedWorkspaceService, "captureMainTabCandidates">;
  roster: {
    confirmExpansionIdentity(
      path: string
    ): Promise<{ id: string; current(): boolean } | undefined>;
  };
  store: { read(): Promise<MainTabMetadataRead> };
}
export type MainTabCandidates =
  | {
      status: "ready";
      items: { savedIndex: number; entry: string }[];
      current(): boolean;
    }
  | { status: "stale" | "unavailable" };

/** Internal proof only: no document opening or authority derived from persisted paths. */
export function createMainTabCandidateResolver({
  workspace,
  roster,
  store,
}: Dependencies) {
  return {
    async resolve(
      root: string,
      generation: number,
      signal?: AbortSignal
    ): Promise<MainTabCandidates> {
      const capture = workspace.captureMainTabCandidates(root, generation);
      if (!capture || signal?.aborted) return { status: "stale" };
      let current = () => !signal?.aborted && capture.current() === true;
      try {
        if (!current()) return { status: "stale" };
        const identity = await roster.confirmExpansionIdentity(capture.path);
        current = () =>
          !signal?.aborted &&
          capture.current() === true &&
          identity?.current() === true;
        if (!identity || !current()) return { status: "stale" };
        const stored = await store.read();
        if (!current()) return { status: "stale" };
        if (
          stored.status !== "valid" ||
          !validMainTabSessionMetadata(stored.data)
        )
          return { status: "unavailable" };
        const check = () => {
          if (!current()) throw Error("SESSION_CANDIDATE_STALE");
        };
        const items: { savedIndex: number; entry: string }[] = [];
        for (const [savedIndex, tab] of stored.data.tabs.entries()) {
          check();
          if (tab.rootId !== identity.id) continue;
          const entry = await capture.resolve(
            tab.relativePath,
            tab.fingerprint,
            check
          );
          check();
          if (entry) items.push({ savedIndex, entry });
        }
        check();
        return { status: "ready", items, current };
      } catch {
        try {
          if (!current()) return { status: "stale" };
        } catch {
          return { status: "stale" };
        }
        return { status: "unavailable" };
      }
    },
  };
}
