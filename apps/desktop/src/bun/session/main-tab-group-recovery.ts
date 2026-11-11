import { randomUUID } from "node:crypto";

import type { DocumentSnapshot } from "../../shared/documents";
import { MAIN_TAB_METADATA_MAX_TABS } from "../../shared/main-tab-checkpoint";
import { validRootRosterId } from "../../shared/root-roster";
import { WORKSPACE_MAX_ROOTS } from "../../shared/workspace";
import type { TrustedDocumentService } from "../documents";
import type { TrustedWorkspaceService } from "../workspace";

import {
  type MainTabMetadataObservation,
  createMainTabCheckpointMetadataStore,
} from "./main-tab-metadata";
import type { SingleMainTabRecoveryInput } from "./main-tab-single-recovery";

const isArray = (value: unknown): boolean => Array.isArray(value);

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

/** Single-root group recovery for the ordinary window. */
export function createMainTabGroupRecoveryReader(
  directory: string,
  dependencies: MainTabGroupRecoveryDependencies
) {
  return createMainTabRecoveryReaderCore(directory, dependencies, false);
}

export interface MainTabMultiRootRecoveryInput {
  requestId: string;
  roots: readonly {
    root: string;
    generation: number;
    expectedRootId: string;
  }[];
}

/** Bun-only; every supplied root must already be authorized in this workspace. */
export function createMainTabMultiRootRecoveryReader(
  directory: string,
  dependencies: MainTabGroupRecoveryDependencies
) {
  return createRecoveryGroupCore(directory, dependencies, false, 2);
}

/** Keeps both existing single-root entry points isolated from multi-root input. */
export function createMainTabRecoveryReaderCore(
  directory: string,
  dependencies: MainTabGroupRecoveryDependencies,
  exactPair: boolean
) {
  const core = createRecoveryGroupCore(directory, dependencies, exactPair, 1);
  return {
    read(input: SingleMainTabRecoveryInput, current: () => boolean) {
      const { requestId, root, generation, expectedRootId } = input;
      return core.read(
        { requestId, roots: [{ root, generation, expectedRootId }] },
        current
      );
    },
    close: () => core.close(),
  };
}

function createRecoveryGroupCore(
  directory: string,
  { workspace, roster, documents }: MainTabGroupRecoveryDependencies,
  exactPair: boolean,
  minimumRoots: 1 | 2
) {
  const store = createMainTabCheckpointMetadataStore(directory);
  let running = false;
  let closed = false;
  return {
    async read(
      input: MainTabMultiRootRecoveryInput,
      callerCurrent: () => boolean
    ): Promise<MainTabGroupRecoveryResult> {
      const { requestId } = input;
      if (
        typeof requestId !== "string" ||
        !requestId.length ||
        requestId.length > 80 ||
        !isArray(input.roots) ||
        input.roots.length < minimumRoots ||
        input.roots.length > WORKSPACE_MAX_ROOTS
      )
        return { status: "rejected", reason: "invalid" };
      // Copy only primitives before the first await; caller mutation cannot retarget a read.
      const roots: MainTabMultiRootRecoveryInput["roots"][number][] = [];
      const handles = new Set<string>();
      const rootIds = new Set<string>();
      for (const item of input.roots) {
        if (
          !item ||
          typeof item !== "object" ||
          Array.isArray(item) ||
          !validRootRosterId(item.root) ||
          !validRootRosterId(item.expectedRootId) ||
          !Number.isSafeInteger(item.generation) ||
          item.generation < 1 ||
          handles.has(item.root) ||
          rootIds.has(item.expectedRootId)
        )
          return { status: "rejected", reason: "invalid" };
        handles.add(item.root);
        rootIds.add(item.expectedRootId);
        roots.push({
          root: item.root,
          generation: item.generation,
          expectedRootId: item.expectedRootId,
        });
      }
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
        const captured = new Map<
          string,
          {
            root: string;
            generation: number;
            scope: NonNullable<
              ReturnType<typeof workspace.captureMainTabCandidates>
            >;
          }
        >();
        // Capture every participant before asynchronous identity or filesystem checks.
        for (const item of roots) {
          const scope = workspace.captureMainTabCandidates(
            item.root,
            item.generation
          );
          if (!scope)
            return await fail({ status: "rejected", reason: "stale" });
          guards.push(() => scope.current());
          captured.set(item.expectedRootId, {
            root: item.root,
            generation: item.generation,
            scope,
          });
        }
        for (const item of roots) {
          check();
          const selected = captured.get(item.expectedRootId)!;
          const identity = await roster.confirmExpansionIdentity(
            selected.scope.path
          );
          check();
          if (identity?.id !== item.expectedRootId)
            return await fail({ status: "rejected", reason: "unavailable" });
          guards.push(() => identity.current());
        }
        const observed = await store.readObserved();
        check();
        if (
          observed.status !== "valid" ||
          (exactPair
            ? observed.data.tabs.length !== 2
            : observed.data.tabs.length < 2 ||
              observed.data.tabs.length > MAIN_TAB_METADATA_MAX_TABS) ||
          observed.data.activeIndex === null ||
          observed.data.tabs.some((tab) => !captured.has(tab.rootId)) ||
          new Set(observed.data.tabs.map((tab) => tab.rootId)).size !==
            captured.size
        )
          return await fail({ status: "rejected", reason: "unavailable" });
        guards.push(() => observed.current());
        const saved = observed.data.tabs;
        if (
          new Set(
            saved.map((tab) => JSON.stringify([tab.rootId, tab.relativePath]))
          ).size !== saved.length ||
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
            JSON.stringify(latest.data) !== encoded ||
            ((observed.positioned || latest.positioned) &&
              !store.sameObservation(observed, latest))
          )
            throw Error("PAIR_RECORD_CHANGED");
          verifiedObservation = latest;
          verifiedCurrent = () => latest.current();
        };
        const entries: string[] = [];
        for (const tab of saved) {
          const entry = await captured
            .get(tab.rootId)!
            .scope.resolve(tab.relativePath, tab.fingerprint, check);
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
              root: captured.get(tab.rootId)!.root,
              generation: captured.get(tab.rootId)!.generation,
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
              source.rootHandle !== captured.get(saved[index].rootId)!.root ||
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
        if (
          (!exactPair || observed.positioned !== undefined) &&
          !store.exactCurrent(verifiedObservation)
        )
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
              if (
                (!exactPair || observed.positioned !== undefined) &&
                !store.exactCurrent(verifiedObservation)
              ) {
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
