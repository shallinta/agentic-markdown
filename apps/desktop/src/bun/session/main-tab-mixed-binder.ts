import type { TrustedDocumentService } from "../documents";

import {
  captureMainTabMetadataInput,
  createMainTabMetadataBinder,
} from "./main-tab-binder";
import { MAIN_TAB_METADATA_MAX_BYTES } from "./main-tab-metadata";
import {
  copyMixedMainTabMetadata,
  type MixedMainTabMetadata,
  type MixedMainTabRow,
} from "./main-tab-mixed-metadata";
import { captureMainTabStandaloneSource } from "./main-tab-standalone-source";

type Dependencies = Parameters<typeof createMainTabMetadataBinder>[0] & {
  documents: Pick<TrustedDocumentService, "captureContentSearchBindings">;
};
export type BoundMixedMainTabMetadata =
  | { status: "ready"; data: MixedMainTabMetadata; current(): boolean }
  | { status: "invalid" | "unavailable" | "stale" };

/** Internal candidate only; never opens a historical path or writes settings. */
export function createMainTabMixedMetadataBinder({
  documents,
  workspace,
  roster,
}: Dependencies) {
  return {
    async bind(
      value: unknown,
      signal?: AbortSignal
    ): Promise<BoundMixedMainTabMetadata> {
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
        const input = captureMainTabMetadataInput(value);
        if (!input) return { status: "invalid" };
        if (!current()) return { status: "stale" };
        const captured = documents.captureContentSearchBindings(
          input.tabs.map((tab) => tab.handle)
        );
        if (!current()) return { status: "stale" };
        if (captured?.bindings.length !== input.tabs.length)
          return { status: "unavailable" };
        proofs.push(captured);
        if (!current()) return { status: "stale" };
        const baseline = () => {
          try {
            valid = valid && !signal?.aborted && captured.current() === true;
          } catch {
            valid = false;
          }
          return valid;
        };
        const paths = new Set<string>();
        const roots: number[] = [];
        const standalone: number[] = [];
        for (let index = 0; index < input.tabs.length; index++) {
          const tab = input.tabs[index],
            binding = captured.bindings[index];
          if (
            binding?.handle !== tab.handle ||
            binding.documentId !== tab.documentId ||
            binding.revision !== tab.revision ||
            binding.hash !== tab.hash ||
            paths.has(binding.path)
          )
            return { status: "unavailable" };
          paths.add(binding.path);
          if (binding.scope && !binding.verifyStandalone) roots.push(index);
          else if (!binding.scope && binding.verifyStandalone)
            standalone.push(index);
          else return { status: "unavailable" };
        }
        const tabs: MixedMainTabRow[] = new Array<MixedMainTabRow>(input.tabs.length);
        if (roots.length) {
          const binder = createMainTabMetadataBinder({
            workspace: {
              captureMainTabSources: (sources, check) =>
                workspace.captureMainTabSources(sources, () => {
                  if (!baseline()) throw Error("Mixed source became stale");
                  check?.();
                }),
            },
            roster,
          });
          const bound = await binder.bind(
            { tabs: roots.map((index) => input.tabs[index]), activeIndex: 0 },
            signal
          );
          if (!current()) return { status: "stale" };
          if (bound.status !== "ready") return bound;
          proofs.push(bound);
          if (!current() || bound.data.tabs.length !== roots.length)
            return { status: "stale" };
          roots.forEach((original, index) => {
            tabs[original] = { kind: "root", ...bound.data.tabs[index] };
          });
        }
        for (const index of standalone) {
          if (!current()) return { status: "stale" };
          const tab = input.tabs[index],
            initial = captured.bindings[index]!;
          const bound = await captureMainTabStandaloneSource(
            documents,
            {
              handle: tab.handle,
              documentId: tab.documentId,
              revision: tab.revision,
              hash: tab.hash,
            },
            baseline,
            { path: initial.path, fingerprint: initial.fingerprint }
          );
          if (!current()) return { status: "stale" };
          if (bound.status !== "ready") return bound;
          proofs.push(bound);
          if (!current()) return { status: "stale" };
          tabs[index] = {
            kind: "standalone",
            ...bound.source,
            pinned: tab.pinned,
            mode: tab.mode,
          };
        }
        const data = copyMixedMainTabMetadata({
          schemaVersion: 3,
          tabs,
          activeIndex: input.activeIndex,
        });
        if (
          !data ||
          Buffer.byteLength(
            `${JSON.stringify({ version: 1, data }, null, 2)}\n`
          ) > MAIN_TAB_METADATA_MAX_BYTES
        )
          return { status: "unavailable" };
        if (!current()) return { status: "stale" };
        return { status: "ready", data, current };
      } catch {
        return { status: current() ? "unavailable" : "stale" };
      }
    },
  };
}
