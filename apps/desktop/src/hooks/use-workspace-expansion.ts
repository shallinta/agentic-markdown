import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { createFolderWorkspace } from "@/client/workspace";
import { createWorkspaceExpansion } from "@/client/workspace-expansion";

export function useWorkspaceExpansion(
  folders: ReturnType<typeof createFolderWorkspace>
) {
  const [writeFailed, setWriteFailed] = useState(false);
  const model = useMemo(
    () =>
      createWorkspaceExpansion(
        folders,
        async (input) => {
          const { electrobun } = await import("@/lib/electrobun");
          if (!electrobun.rpc) throw Error("RPC unavailable");
          return electrobun.rpc.request.workspaceExpansion(input, {
            maxRequestTime: 4000,
          });
        },
        () => setWriteFailed(true)
      ),
    [folders]
  );
  const state = useSyncExternalStore(
    model.subscribe,
    model.getSnapshot,
    model.getSnapshot
  );
  useEffect(() => {
    const detach = model.attach();
    let active = true;
    let unsubscribe: (() => void) | undefined;
    // Load the native bridge only on mount; static rendering has no bridge or effects.
    void import("@/lib/electrobun")
      .then(({ electrobun }) => {
        if (!active) return;
        const rpc = electrobun.rpc;
        rpc?.addMessageListener("workspaceRootRosterChanged", model.refresh);
        unsubscribe = () =>
          rpc?.removeMessageListener(
            "workspaceRootRosterChanged",
            model.refresh
          );
        model.refresh();
      })
      .catch(() => {
        /* Reads can remain unavailable; a manual write reports its own failure. */
      });
    return () => {
      active = false;
      unsubscribe?.();
      detach();
    };
  }, [model]);
  return { model, state, writeFailed };
}
