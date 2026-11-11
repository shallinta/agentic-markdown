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
interface CheckpointOptions {
  idleMs?: number;
  includeViewport?: boolean;
  settlementForRecord?: (target: CheckpointTarget) => Promise<boolean> | undefined;
  settlementForClose?: (close: PrimaryTabLastClose) => Promise<boolean> | undefined;
}

/** Persist at most one eligible primary-tab checkpoint at a time. */
export function attachMainTabActivationCheckpoint(
  documents: Documents,
  send: (request: MainTabCheckpointRequest) => Promise<unknown>,
  workspaceScope: () => object | undefined,
  { idleMs = 120, includeViewport = false, settlementForRecord, settlementForClose }: CheckpointOptions = {},
) {
  let pending: CheckpointIntent | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let disposed = false;
  let intentSequence = 0;
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
      const capture = documents.captureCleanPrimaryTabs(includeViewport);
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
      if (!disposed && validMainTabCheckpointResponse(response) && response.status === "committed") {
        capture.confirmViewportResets?.();
        if (workspaceScope() === scope) {
          const confirmedKey = request.tabs.some(tab => tab.resetViewport)
            ? JSON.stringify({ ...request, tabs: request.tabs.map(tab => {
              const captured = { ...tab };
              delete captured.resetViewport;
              return captured;
            }) })
            : key;
          confirmed = { scope, key: confirmedKey };
        }
      }
    } catch {
      // Checkpoint availability never blocks or retries a document action.
    } finally {
      inFlight = false;
      schedule();
    }
  }

  const enqueue = (intent: CheckpointIntent, settlement?: Promise<boolean>) => {
    if (disposed) return;
    const sequence = ++intentSequence;
    if (!settlement) {
      pending = intent;
      schedule();
      return;
    }
    pending = undefined;
    clearTimeout(timer);
    timer = undefined;
    // Other targets can publish while this grant's handoff is in flight.
    void settlement.then((settled) => {
      if (disposed || sequence !== intentSequence) return;
      if (intent.kind === "clear" && ((!settled && !confirmed) || !intent.close.current())) return;
      pending = intent;
      schedule();
    }, () => undefined);
  };
  const record = (target: CheckpointTarget) => enqueue({ kind: "record", target }, settlementForRecord?.(target));
  const unsubscribeActivation = documents.subscribeActivation(record);
  const unsubscribeLayout = documents.subscribePrimaryTabLayoutChange(record);
  const unsubscribeClose = documents.subscribePrimaryTabLastClose((close) => {
    if (disposed) return;
    const settlement = settlementForClose?.(close);
    // A normal write already acknowledged by Bun has its own ownership proof.
    enqueue({ kind: "clear", close }, confirmed ? undefined : settlement);
  });
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
