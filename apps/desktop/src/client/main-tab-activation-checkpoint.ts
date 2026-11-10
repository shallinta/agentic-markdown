import {
  validMainTabCheckpointRequest,
  validMainTabCheckpointResponse,
  type MainTabCheckpointRequest,
  type MainTabSourceInput,
} from "../shared/main-tab-checkpoint";

import type { createDocumentController, PrimaryTabLastClose } from "./documents";

type Documents = Pick<ReturnType<typeof createDocumentController>,
  "subscribeActivation" | "subscribePrimaryTabLayoutChange" | "subscribePrimaryTabLastClose" | "captureCleanPrimaryTabs">;
type CheckpointTarget = Pick<MainTabSourceInput, "documentId" | "handle">;
type CheckpointIntent = { kind: "record"; target: CheckpointTarget } | { kind: "clear"; close: PrimaryTabLastClose };

/** Persist at most one eligible primary-tab checkpoint at a time. */
export function attachMainTabActivationCheckpoint(
  documents: Documents,
  send: (request: MainTabCheckpointRequest) => Promise<unknown>,
  workspaceScope: () => object | undefined,
  idleMs = 120,
) {
  let pending: CheckpointIntent | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let disposed = false;
  let confirmed: { scope: object; key: string } | undefined;

  function schedule() {
    if (disposed || inFlight || !pending) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void publishLatest(); }, idleMs);
  }

  async function publishLatest() {
    timer = undefined;
    if (disposed || inFlight || !pending) return;
    const intent = pending;
    pending = undefined;
    inFlight = true;
    try {
      if (intent.kind === "clear") {
        if (!intent.close.current()) return;
        const empty = documents.captureCleanPrimaryTabs();
        if (!empty.ok || empty.tabs.length || empty.activeIndex !== null ||
            !empty.current() || !intent.close.current() || disposed || pending) return;
        confirmed = undefined;
        await send({ protocolVersion: 1, op: "clear" });
        return;
      }
      const scope = workspaceScope();
      if (!scope) return;
      const capture = documents.captureCleanPrimaryTabs();
      if (!capture.ok || capture.activeIndex === null) return;
      const request = { protocolVersion: 1, tabs: capture.tabs, activeIndex: capture.activeIndex } as const;
      if (!validMainTabCheckpointRequest(request)) return;
      const active = request.tabs[request.activeIndex];
      if (active.handle !== intent.target.handle || active.documentId !== intent.target.documentId) return;
      const key = JSON.stringify(request);
      if (confirmed?.scope === scope && confirmed.key === key) return;
      if (!capture.current() || disposed || pending || workspaceScope() !== scope) return;

      // An unknown publication can supersede the previously confirmed record.
      confirmed = undefined;
      const response = await send(request);
      if (!disposed && workspaceScope() === scope &&
          validMainTabCheckpointResponse(response) && response.status === "committed")
        confirmed = { scope, key };
    } catch {
      // Checkpoint availability never blocks or retries a document action.
    } finally {
      inFlight = false;
      schedule();
    }
  }

  const enqueue = (intent: CheckpointIntent) => {
    if (disposed) return;
    pending = intent;
    schedule();
  };
  const record = (target: CheckpointTarget) => enqueue({ kind: "record", target });
  const unsubscribeActivation = documents.subscribeActivation(record);
  const unsubscribeLayout = documents.subscribePrimaryTabLayoutChange(record);
  const unsubscribeClose = documents.subscribePrimaryTabLastClose((close) => enqueue({ kind: "clear", close }));
  return () => {
    disposed = true;
    pending = undefined;
    confirmed = undefined;
    clearTimeout(timer);
    unsubscribeActivation();
    unsubscribeLayout();
    unsubscribeClose();
  };
}
