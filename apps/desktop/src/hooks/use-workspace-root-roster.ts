import { useEffect, useState, useSyncExternalStore } from "react";

import { createWorkspaceRootRoster } from "@/client/workspace-root-roster";
import { electrobun } from "@/lib/electrobun";

export function useWorkspaceRootRoster() {
  const [model] = useState(() =>
    createWorkspaceRootRoster(
      (input) =>
        electrobun.rpc?.request.workspaceRootRoster(input, {
          maxRequestTime: 4000,
        }) ?? Promise.reject(Error("RPC unavailable"))
    )
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    const detach = model.attach();
    const rpc = electrobun.rpc;
    rpc?.addMessageListener("workspaceRootRosterChanged", model.refresh);
    model.refresh();
    return () => {
      rpc?.removeMessageListener("workspaceRootRosterChanged", model.refresh);
      detach();
    };
  }, [model]);
  return { model, state };
}
