import {
  validRootRosterRequest,
  type RootRosterResponse,
} from "../../shared/root-roster";

import { createRootRoster } from "./root-roster";

/** Metadata only: the workspace supplies committed authority; RPC never supplies paths. */
export function createRootRosterService(
  settingsDir: string,
  suspended: () => boolean,
  notify: () => void,
  generation: () => number = () => 0
) {
  const roster = createRootRoster(settingsDir);
  const changed = () => {
    try {
      notify();
    } catch {
      /* Notifications never undo committed workspace operations. */
    }
  };
  return {
    committed(
      event: Readonly<{
        paths: readonly string[];
        selectedPath?: string;
        explicitClear?: boolean;
      }>
    ) {
      const operation = event.explicitClear
        ? roster.clearExplicit()
        : roster.reconcile(event.paths, event.selectedPath);
      void operation.then(changed);
    },
    async request(input: unknown): Promise<RootRosterResponse> {
      if (!validRootRosterRequest(input))
        return {
          protocolVersion: 1,
          pending: [],
          readOnly: true,
          failure: "invalid",
        };
      const ticket = generation(),
        blocked = suspended();
      const result =
        input.op === "remove" && !blocked
          ? await roster.removePending(
              input.id,
              () => !suspended() && ticket === generation()
            )
          : await roster.read();
      return {
        protocolVersion: 1,
        pending: result.state.pending,
        readOnly: result.state.readOnly,
        ...(input.op === "remove" && blocked
          ? { failure: "busy" as const }
          : result.state.failure
            ? { failure: result.state.failure }
            : {}),
      };
    },
    drain: () => roster.drain(),
    close: () => roster.close(),
  };
}
