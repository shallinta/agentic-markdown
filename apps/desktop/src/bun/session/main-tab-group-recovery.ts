import { randomUUID } from "node:crypto";

import type { DocumentSnapshot } from "../../shared/documents";
import { MAIN_TAB_METADATA_MAX_TABS } from "../../shared/main-tab-checkpoint";
import { validRootRosterId } from "../../shared/root-roster";
import type { TrustedDocumentService } from "../documents";
import type { TrustedWorkspaceService } from "../workspace";

import {
  type MainTabMetadataObservation,
  createMainTabCheckpointMetadataStore,
} from "./main-tab-metadata";
import type { SingleMainTabRecoveryInput } from "./main-tab-single-recovery";

type Release = "released" | "unknown";
export interface MainTabGroupRecoveryDependencies {
  workspace: Pick<
    TrustedWorkspaceService,
    | "captureMainTabCandidates"
    | "openMainTabCandidate"
    | "captureMainTabSources"
  >;
  roster: {
    confirmExpansionIdentity(
      path: string
    ): Promise<{ id: string; current(): boolean } | undefined>;
  };
  documents: Pick<
    TrustedDocumentService,
    "release" | "verifyRecoverySnapshots" | "ownsRecoverySnapshot"
  >;
}
export type MainTabGroupRecoveryResult =
  | {
      status: "ready";
      tabs: readonly {
        snapshot: DocumentSnapshot;
        mode: "editing" | "source";
        pinned: boolean;
      }[];
      activeIndex: number;
      ownership: MainTabMetadataObservation;
      revalidate(): Promise<boolean>;
      current(): boolean;
      release(): Promise<Release>;
    }
  | { status: "rejected"; reason: "invalid" | "busy" | "stale" | "unavailable" }
  | { status: "unknown"; reason: "io" | "release" };

/** Internal group entry; ordinary window callers retain the exact-two wrapper. */
export function createMainTabGroupRecoveryReader(
  directory: string,
  dependencies: MainTabGroupRecoveryDependencies
) {
  return createMainTabRecoveryReaderCore(directory, dependencies, false);
}

/** Shared implementation, not a transport or authorization entry. */
export function createMainTabRecoveryReaderCore(
  directory: string,
  { workspace, roster, documents }: MainTabGroupRecoveryDependencies,
  exactPair: boolean
) {
  const store = createMainTabCheckpointMetadataStore(directory);
  let running = false;
  let closed = false;
  return {
    async read(
      input: SingleMainTabRecoveryInput,
      callerCurrent: () => boolean
    ): Promise<MainTabGroupRecoveryResult> {
      const { requestId, root, generation, expectedRootId } = input;
      if (
        typeof requestId !== "string" ||
        !requestId.length ||
        requestId.length > 80 ||
        !validRootRosterId(root) ||
        !validRootRosterId(expectedRootId) ||
        !Number.isSafeInteger(generation) ||
        generation < 1
      )
        return { status: "rejected", reason: "invalid" };
      if (running) return { status: "rejected", reason: "busy" };
      running = true;
      let valid = true;
      const guards: (() => boolean)[] = [];
      const current = () => {
        try {
          valid =
            valid &&
            !closed &&
            callerCurrent() === true &&
            guards.every((guard) => guard() === true);
        } catch {
          valid = false;
        }
        return valid;
      };
      const check = () => {
        if (!current()) throw Error("PAIR_RECOVERY_STALE");
      };
      const owned: DocumentSnapshot[] = [];
      let releasing: Promise<Release> | undefined;
      const release = () => {
        valid = false;
        releasing ??= (async () => {
          let outcome: Release = "released";
          for (const snapshot of owned) {
            try {
              const id = randomUUID();
              const result = await documents.release({
                protocolVersion: 1,
                requestId: id,
                handle: snapshot.handle,
              });
              if (
                result.protocolVersion !== 1 ||
                result.requestId !== id ||
                !result.ok ||
                result.snapshot !== null
              )
                outcome = "unknown";
            } catch {
              outcome = "unknown";
            }
          }
          return outcome;
        })();
        return releasing;
      };
      const fail = async (
        result: Exclude<MainTabGroupRecoveryResult, { status: "ready" }>
      ): Promise<MainTabGroupRecoveryResult> =>
        (await release()) === "released"
          ? result
          : { status: "unknown", reason: "release" };
      let opening = false;
      try {
        check();
        const scope = workspace.captureMainTabCandidates(root, generation);
        if (!scope) return await fail({ status: "rejected", reason: "stale" });
        guards.push(() => scope.current());
        const identity = await roster.confirmExpansionIdentity(scope.path);
        check();
        if (identity?.id !== expectedRootId)
          return await fail({ status: "rejected", reason: "unavailable" });
        guards.push(() => identity.current());
        const observed = await store.readObserved();
        check();
        if (
          observed.status !== "valid" ||
          (exactPair
            ? observed.data.tabs.length !== 2
            : observed.data.tabs.length < 2 ||
              observed.data.tabs.length > MAIN_TAB_METADATA_MAX_TABS) ||
          observed.data.activeIndex === null ||
          observed.data.tabs.some((tab) => tab.rootId !== expectedRootId)
        )
          return await fail({ status: "rejected", reason: "unavailable" });
        guards.push(() => observed.current());
        const saved = observed.data.tabs;
        if (
          new Set(saved.map((tab) => tab.relativePath)).size !== saved.length ||
          new Set(saved.map((tab) => tab.fingerprint)).size !== saved.length
        )
          return await fail({ status: "rejected", reason: "unavailable" });
        const encoded = JSON.stringify(observed.data);
        let verifiedObservation: MainTabMetadataObservation = observed;
        let verifiedCurrent = () => true;
        guards.push(() => verifiedCurrent());
        const verifyRecord = async () => {
          const latest = await store.readObserved();
          check();
          if (
            latest.status !== "valid" ||
            JSON.stringify(latest.data) !== encoded
          )
            throw Error("PAIR_RECORD_CHANGED");
          verifiedObservation = latest;
          verifiedCurrent = () => latest.current();
        };
        const entries: string[] = [];
        for (const tab of saved) {
          const entry = await scope.resolve(
            tab.relativePath,
            tab.fingerprint,
            check
          );
          check();
          if (!entry || entries.includes(entry))
            return await fail({ status: "rejected", reason: "unavailable" });
          entries.push(entry);
        }
        for (const [index, tab] of saved.entries()) {
          check();
          opening = true;
          const id = randomUUID();
          const response = await workspace.openMainTabCandidate(
            {
              root,
              generation,
              entry: entries[index],
              fingerprint: tab.fingerprint,
              requestId: id,
            },
            {
              retainRecoveryStamp: true,
              check,
              async verify(openCurrent) {
                openCurrent();
                if (exactPair) await verifyRecord();
                openCurrent();
              },
            }
          );
          opening = false;
          if (response.protocolVersion !== 1 || response.requestId !== id)
            return await fail({ status: "unknown", reason: "io" });
          if (!response.ok)
            return await fail({
              status: "rejected",
              reason: current() ? "unavailable" : "stale",
            });
          const snapshot = response.snapshot;
          if (
            !snapshot ||
            !validRootRosterId(snapshot.handle) ||
            snapshot.explicitStandalone !== false
          )
            return await fail({ status: "unknown", reason: "io" });
          if (!documents.ownsRecoverySnapshot(snapshot, id))
            return await fail({ status: "unknown", reason: "io" });
          if (owned.some((other) => other.handle === snapshot.handle))
            return await fail({ status: "unknown", reason: "io" });
          owned.push(snapshot);
          check();
          if (
            owned.some(
              (other, otherIndex) =>
                otherIndex !== index &&
                (other.handle === snapshot.handle ||
                  other.documentId === snapshot.documentId)
            )
          )
            return await fail({ status: "rejected", reason: "unavailable" });
        }
        const sources = await workspace.captureMainTabSources(
          owned.map((snapshot, index) => ({
            handle: snapshot.handle,
            documentId: snapshot.documentId,
            revision: snapshot.revision,
            hash: snapshot.hash,
            mode: saved[index].mode,
            pinned: saved[index].pinned,
          })),
          check
        );
        check();
        if (
          sources?.sources.length !== saved.length ||
          sources.sources.some(
            (source, index) =>
              source.rootHandle !== root ||
              source.relativePath !== saved[index].relativePath ||
              source.fingerprint !== saved[index].fingerprint
          )
        )
          return await fail({ status: "rejected", reason: "unavailable" });
        await verifyRecord();
        if (!(await documents.verifyRecoverySnapshots(owned, check)))
          return await fail({
            status: "rejected",
            reason: current() ? "unavailable" : "stale",
          });
        if (!exactPair && !store.exactCurrent(verifiedObservation))
          return await fail({ status: "rejected", reason: "stale" });
        check();
        if (!sources.current())
          return await fail({ status: "rejected", reason: "stale" });
        const resultCurrent = () => {
          valid = current() && sources.current();
          return valid;
        };
        return {
          status: "ready",
          tabs: owned.map((snapshot, index) => ({
            snapshot,
            mode: saved[index].mode,
            pinned: saved[index].pinned,
          })),
          activeIndex: observed.data.activeIndex,
          current: resultCurrent,
          ownership: observed,
          async revalidate() {
            try {
              if (!resultCurrent()) return false;
              await verifyRecord();
              if (!(await documents.verifyRecoverySnapshots(owned, check))) {
                valid = false;
                return false;
              }
              if (!exactPair && !store.exactCurrent(verifiedObservation)) {
                valid = false;
                return false;
              }
              return resultCurrent();
            } catch {
              valid = false;
              return false;
            }
          },
          release,
        };
      } catch {
        return await fail(
          opening
            ? { status: "unknown", reason: "io" }
            : {
                status: "rejected",
                reason: current() ? "unavailable" : "stale",
              }
        );
      } finally {
        running = false;
      }
    },
    async close() {
      closed = true;
      await store.close();
    },
  };
}
