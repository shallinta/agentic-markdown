import { randomUUID } from "node:crypto";

import type { DocumentResponse, DocumentSnapshot } from "../../shared/documents";
import { validRootRosterId } from "../../shared/root-roster";
import type { TrustedDocumentService } from "../documents";
import type { TrustedWorkspaceService } from "../workspace";

import {
  createMainTabCheckpointMetadataStore,
  validMainTabSessionMetadata,
  type MainTabMetadataRead,
  type MainTabMetadataObservation,
} from "./main-tab-metadata";

interface Dependencies {
  workspace: Pick<TrustedWorkspaceService, "captureMainTabCandidates" | "openMainTabCandidate">;
  roster: {
    confirmExpansionIdentity(path: string): Promise<{ id: string; current(): boolean } | undefined>;
  };
  documents: Pick<TrustedDocumentService, "release">;
}

export interface SingleMainTabRecoveryInput {
  requestId: string;
  root: string;
  generation: number;
  expectedRootId: string;
}

type RecoveryRelease = "released" | "unknown";
export type SingleMainTabRecoveryResult =
  | { status: "ready"; snapshot: DocumentSnapshot; mode: "editing" | "source"; pinned: boolean;
      current(): boolean; release(): Promise<RecoveryRelease>; ownership?: MainTabMetadataObservation }
  | { status: "rejected"; reason: "invalid" | "stale" | "unavailable" | "busy" }
  | { status: "unknown"; reason: "io" | "release" };

function singleTab(record: MainTabMetadataRead) {
  if (record.status === "valid" && validMainTabSessionMetadata(record.data) &&
      record.data.activeIndex === 0 && record.data.tabs.length === 1) return record.data.tabs[0];
}

/** Internal recovery read. A historical path never becomes a file authority. */
export function createSingleMainTabRecoveryReader(directory: string, { workspace, roster, documents }: Dependencies) {
  const store = createMainTabCheckpointMetadataStore(directory);
  let running = false;
  let closed = false;

  return {
    async read(input: SingleMainTabRecoveryInput, callerCurrent: () => boolean): Promise<SingleMainTabRecoveryResult> {
      const { requestId, root, generation, expectedRootId } = input;
      if (typeof requestId !== "string" || !requestId.length || requestId.length > 80 ||
          !validRootRosterId(root) || !validRootRosterId(expectedRootId) || !Number.isSafeInteger(generation) || generation < 1)
        return { status: "rejected", reason: "invalid" };
      if (running) return { status: "rejected", reason: "busy" };
      let valid = true;
      let scopeCurrent = () => true;
      let recordCurrent = () => true;
      const current = () => {
        try { valid = valid && !closed && callerCurrent() === true && scopeCurrent() === true && recordCurrent() === true; }
        catch { valid = false; }
        return valid;
      };
      const check = () => {
        if (!current()) throw Error("SESSION_RECOVERY_STALE");
      };
      running = true;
      let opening = false;
      try {
        if (!current()) return { status: "rejected", reason: "stale" };
        const captured = workspace.captureMainTabCandidates(root, generation);
        if (!captured) return { status: "rejected", reason: "stale" };
        scopeCurrent = () => captured.current() === true;
        check();
        const identity = await roster.confirmExpansionIdentity(captured.path);
        check();
        if (identity?.id !== expectedRootId) return { status: "rejected", reason: "unavailable" };
        scopeCurrent = () => captured.current() === true && identity.current() === true;
        check();
        const observed = await store.readObserved();
        check();
        if (observed.status === "stale") return { status: "rejected", reason: "stale" };
        const saved = singleTab(observed);
        if (observed.status !== "valid" || saved?.rootId !== identity.id) return { status: "rejected", reason: "unavailable" };
        recordCurrent = () => observed.current();
        check();
        const { relativePath, fingerprint, mode, pinned } = saved;
        const entry = await captured.resolve(relativePath, fingerprint, check);
        check();
        if (!entry) return { status: "rejected", reason: "unavailable" };

        opening = true;
        const response = await workspace.openMainTabCandidate({ root, generation, entry, fingerprint, requestId }, {
          check,
          async verify(openCurrent) {
            openCurrent();
            const verified = await store.readObserved();
            const latest = singleTab(verified);
            if (verified.status !== "valid" || latest?.rootId !== expectedRootId || latest.relativePath !== relativePath ||
                latest.fingerprint !== fingerprint || latest.mode !== mode || latest.pinned !== pinned ||
                ((observed.positioned || verified.positioned) && !store.sameObservation(observed, verified))) valid = false;
            else recordCurrent = () => observed.current() && verified.current();
            openCurrent();
          },
        });
        if (response.protocolVersion !== 1 || response.requestId !== requestId)
          return { status: "unknown", reason: "io" };
        if (!response.ok) return { status: "rejected", reason: !current() ? "stale" :
          response.error === "BUSY" ? "busy" : "unavailable" };
        const snapshot = response.snapshot;
        if (!snapshot || !validRootRosterId(snapshot.handle) || snapshot.explicitStandalone !== false)
          return { status: "unknown", reason: "io" };

        // This guarded path only returns a newly created grant for this request.
        const handle = snapshot.handle;
        let releasing: Promise<RecoveryRelease> | undefined;
        const release = () => {
          valid = false;
          releasing ??= releaseGrant(documents, handle);
          return releasing;
        };
        if (observed.positioned && !store.exactCurrent(observed)) valid = false;
        if (!current()) return await release() === "released"
          ? { status: "rejected", reason: "stale" }
          : { status: "unknown", reason: "release" };
        return { status: "ready", snapshot, mode, pinned, current, release, ownership: observed };
      } catch {
        return opening ? { status: "unknown", reason: "io" }
          : { status: "rejected", reason: current() ? "unavailable" : "stale" };
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

async function releaseGrant(documents: Dependencies["documents"], handle: string): Promise<RecoveryRelease> {
  const requestId = randomUUID();
  try {
    const released: DocumentResponse = await documents.release({ protocolVersion: 1, requestId, handle });
    return released.protocolVersion === 1 && released.requestId === requestId && released.ok && released.snapshot === null
      ? "released" : "unknown";
  } catch {
    return "unknown";
  }
}
