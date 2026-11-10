import {
  validWorkspaceExpansionRequest,
  validWorkspaceExpansionResponse,
  type WorkspaceExpansionResponse,
} from "../../shared/workspace-expansion";

import type { createExpansionStore } from "./expansion-store";

export interface ExpansionCapture {
  path: string;
  relativePath?: string;
  current(): boolean;
  project(expanded: readonly string[]): string[] | undefined;
}
export interface ExpansionServiceDependencies {
  workspace: {
    captureExpansion(
      root: string,
      generation: number,
      directory?: string
    ): ExpansionCapture | undefined;
  };
  roster: {
    confirmExpansionIdentity(
      path: string
    ): Promise<{ id: string; current(): boolean } | undefined>;
  };
  store: Pick<
    ReturnType<typeof createExpansionStore>,
    "read" | "setRootCollapsed" | "setDirectoryExpanded"
  >;
}
export function createExpansionService({
  workspace,
  roster,
  store,
}: ExpansionServiceDependencies) {
  const fail = (
    error: "stale" | "unavailable"
  ): WorkspaceExpansionResponse => ({ protocolVersion: 1, ok: false, error });
  return {
    async request(input: unknown): Promise<WorkspaceExpansionResponse> {
      if (!validWorkspaceExpansionRequest(input)) return fail("unavailable");
      try {
        const capture = workspace.captureExpansion(
          input.root,
          input.generation,
          input.op === "set" ? input.directory : undefined
        );
        if (!capture) return fail("stale");
        const live = () => {
          try {
            return capture.current() === true;
          } catch {
            return false;
          }
        };
        if (!live()) return fail("stale");
        const identity = await roster.confirmExpansionIdentity(capture.path);
        const current = () => {
          try {
            return live() && identity?.current() === true;
          } catch {
            return false;
          }
        };
        if (!current() || !identity) return fail("stale");
        if (input.op === "read") {
          const stored = await store.read();
          if (!current()) return fail("stale");
          if (stored.readOnly || stored.failure) return fail("unavailable");
          const root = stored.roots.find(
            (entry) => entry.rootId === identity.id
          );
          const expanded = capture.project(root?.expanded ?? []);
          if (!expanded || !current()) return fail("stale");
          const result: WorkspaceExpansionResponse = {
            protocolVersion: 1,
            ok: true,
            op: "read",
            root: input.root,
            generation: input.generation,
            collapsed: root?.collapsed ?? false,
            expanded,
          };
          return validWorkspaceExpansionResponse(result, input)
            ? result
            : fail("unavailable");
        }
        if (input.directory !== undefined && capture.relativePath === undefined)
          return fail("stale");
        const written =
          input.directory === undefined
            ? await store.setRootCollapsed(
                identity.id,
                !input.expanded,
                current
              )
            : await store.setDirectoryExpanded(
                identity.id,
                capture.relativePath!,
                input.expanded,
                current
              );
        if (!current() || written.failure === "stale") return fail("stale");
        if (!written.committed || written.readOnly || written.failure)
          return fail("unavailable");
        return {
          protocolVersion: 1,
          ok: true,
          op: "set",
          root: input.root,
          generation: input.generation,
        };
      } catch {
        return fail("unavailable");
      }
    },
  };
}
