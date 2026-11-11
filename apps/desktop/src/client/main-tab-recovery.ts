import {
  validMainTabRecoveryRequest,
  validMainTabRecoveryResponse,
  type MainTabRecoveryRequest,
} from "../shared/main-tab-recovery";

import type { createDocumentController, PrimaryTabLastClose } from "./documents";
import type { createFolderWorkspace, WorkspaceSelectionReceipt } from "./workspace";

type Documents = Pick<ReturnType<typeof createDocumentController>,
  "canRestorePrimaryTab" | "adoptRecoveredPrimaryTab" | "runWorkspaceAction" | "subscribe">;
type Folders = Pick<ReturnType<typeof createFolderWorkspace>, "getSnapshot" | "select" | "selectWithReceipt" | "subscribe">;
interface Intent { cancel?: () => void }
interface AdoptionSettlement {
  documentId: string;
  handle: string;
  pending: boolean;
  result: Promise<boolean>;
}
type Target = Pick<PrimaryTabLastClose, "documentId" | "handle">;

/** The existing folder selection succeeds independently of optional tab recovery. */
export function createMainTabRecovery(
  documents: Documents,
  folders: Folders,
  send: (request: MainTabRecoveryRequest) => Promise<unknown>,
  available: () => boolean,
) {
  let active: Intent | undefined;
  let adoption: AdoptionSettlement | undefined;
  const matchingAdoption = ({ documentId, handle }: Target) =>
    adoption?.documentId === documentId && adoption.handle === handle ? adoption : undefined;

  function cancel() {
    const previous = active;
    active = undefined;
    previous?.cancel?.();
  }

  function waitForScan(intent: Intent, selected: WorkspaceSelectionReceipt, current: () => boolean) {
    return new Promise<boolean>((resolve) => {
      let finished = false;
      const finish = (complete: boolean) => {
        if (finished) return;
        finished = true;
        intent.cancel = undefined;
        offFolders();
        offDocuments();
        resolve(complete);
      };
      const check = () => {
        if (!current() || !documents.canRestorePrimaryTab()) { finish(false); return; }
        const root = folders.getSnapshot().roots.find(root => root.handle === selected.handle);
        if (root?.status !== "scanning") finish(root?.status === "complete");
      };
      const offFolders = folders.subscribe(check);
      const offDocuments = documents.subscribe(check);
      intent.cancel = () => finish(false);
      check();
    });
  }

  async function recover(intent: Intent, selected: WorkspaceSelectionReceipt, expectedRootId: string, current: () => boolean) {
    const requestId = crypto.randomUUID();
    const envelope = { protocolVersion: 1, requestId } as const;
    const open = { ...envelope, op: "open", root: selected.handle, generation: selected.generation, expectedRootId } as const;
    if (!validMainTabRecoveryRequest(open) || !current() || !documents.canRestorePrimaryTab()) return;
    let finishing: Promise<unknown> | undefined;
    const finish = (adopted: boolean) => {
      finishing ??= Promise.resolve().then(() => send({ ...envelope, op: "finish", adopted })).catch(() => undefined);
      return finishing;
    };
    const invalidate = () => {
      if (!current() || !documents.canRestorePrimaryTab()) void finish(false);
    };
    const offFolders = folders.subscribe(invalidate);
    const offDocuments = documents.subscribe(invalidate);
    const detach = () => { intent.cancel = undefined; offFolders(); offDocuments(); };
    intent.cancel = () => { void finish(false); };
    let adopted = false;
    try {
      const reply = await send(open);
      detach();
      if (finishing || !current() || !documents.canRestorePrimaryTab() ||
          !validMainTabRecoveryResponse(reply, requestId) || reply.status !== "ready") return;
      adopted = await documents.adoptRecoveredPrimaryTab(reply.snapshot, reply.mode, reply.pinned, current, () => {
        const result = finish(true).then((acknowledgement) => {
          ticket.pending = false;
          return validMainTabRecoveryResponse(acknowledgement, requestId) && acknowledgement.status === "finished";
        });
        const ticket = { documentId: reply.snapshot.documentId, handle: reply.snapshot.handle, pending: true, result };
        adoption = ticket;
      });
    } finally {
      detach();
      await finish(adopted);
    }
  }

  return {
    cancel,
    settlementForRecord(this: void, target: Target) {
      const matching = matchingAdoption(target);
      return matching?.pending ? matching.result : undefined;
    },
    settlementForClose(this: void, close: PrimaryTabLastClose) {
      const matching = matchingAdoption(close);
      if (!matching) return;
      adoption = undefined;
      return matching.result;
    },
    async reselect(expectedRootId: string) {
      cancel();
      if (folders.getSnapshot().busy) return;
      const intent: Intent = {};
      let selected: WorkspaceSelectionReceipt | undefined;
      try {
        if (!available() || folders.getSnapshot().roots.length || !documents.canRestorePrimaryTab()) {
          await documents.runWorkspaceAction(folders.select);
          return;
        }
        active = intent;
        await documents.runWorkspaceAction(async () => { selected = await folders.selectWithReceipt(); });
        if (!selected || active !== intent) return;
        const receipt = selected;
        const current = () => active === intent && receipt.current() &&
          folders.getSnapshot().roots.length === 1 && folders.getSnapshot().roots[0].handle === receipt.handle &&
          folders.getSnapshot().roots[0].generation === receipt.generation;
        if (await waitForScan(intent, receipt, current)) await recover(intent, receipt, expectedRootId, current);
      } catch {
        // An optional recovery does not change the outcome of joining the directory.
      } finally {
        if (active === intent) active = undefined;
      }
    },
  };
}
