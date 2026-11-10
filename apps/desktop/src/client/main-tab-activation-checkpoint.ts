import {
  validMainTabCheckpointRequest,
  validMainTabCheckpointResponse,
  type MainTabCheckpointRequest,
} from "../shared/main-tab-checkpoint";

import type { createDocumentController } from "./documents";

type Documents = Pick<ReturnType<typeof createDocumentController>,
  "subscribeActivation" | "captureCleanPrimaryTabs">;
type Activation = Pick<MainTabCheckpointRequest["tabs"][number], "documentId" | "handle">;

/** Persist at most one eligible activation at a time, without delaying document actions. */
export function attachMainTabActivationCheckpoint(
  documents: Documents,
  send: (request: MainTabCheckpointRequest) => Promise<unknown>,
  workspaceScope: () => object | undefined,
  idleMs = 120,
) {
  let pending: Activation | undefined;
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
    const target = pending;
    pending = undefined;
    inFlight = true;
    try {
      const scope = workspaceScope();
      if (!scope) return;
      const capture = documents.captureCleanPrimaryTabs();
      if (!capture.ok || capture.activeIndex === null) return;
      const request = { protocolVersion: 1, tabs: capture.tabs, activeIndex: capture.activeIndex } as const;
      if (!validMainTabCheckpointRequest(request)) return;
      const active = request.tabs[request.activeIndex];
      if (active.handle !== target.handle || active.documentId !== target.documentId) return;
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

  const unsubscribe = documents.subscribeActivation((target) => {
    if (disposed) return;
    pending = target;
    schedule();
  });
  return () => {
    disposed = true;
    pending = undefined;
    confirmed = undefined;
    clearTimeout(timer);
    unsubscribe();
  };
}
