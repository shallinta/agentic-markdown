import {
  validMainTabRecoveryRequest,
  validMainTabRecoveryResponse,
  type MainTabRecoveryRequest,
} from "../shared/main-tab-recovery";

import type { createDocumentController, PrimaryTabLastClose } from "./documents";
import type { createFolderWorkspace, WorkspaceSelectionReceipt } from "./workspace";

type Documents = Pick<ReturnType<typeof createDocumentController>,
  "canRestorePrimaryTab" | "adoptRecoveredPrimaryTab" | "adoptRecoveredPrimaryGroup" | "runWorkspaceAction" | "subscribe">;
type Folders = Pick<ReturnType<typeof createFolderWorkspace>, "getSnapshot" | "select" | "selectWithReceipt" | "subscribe">;
interface Intent { cancel?: () => void }
type RootParticipant = Extract<MainTabRecoveryRequest, { op: "open-multi" }>["roots"][number];
interface Collection {
  roots: RootParticipant[];
  selecting: boolean;
  adoptingSingle: boolean;
  stop: () => void;
}
interface AdoptionSettlement {
  targets: readonly Target[];
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
  let collection: Collection | undefined;
  let active: Intent | undefined;
  let previousCleanup: Promise<boolean> | undefined;
  let adoption: AdoptionSettlement | undefined;
  const matchingAdoption = ({ documentId, handle }: Target) =>
    adoption?.targets.some((target) => target.documentId === documentId && target.handle === handle) ? adoption : undefined;

  function stopAttempt() {
    const previous = active;
    active = undefined;
    previous?.cancel?.();
  }
  function stopCollection() {
    const previous = collection;
    collection = undefined;
    previous?.stop();
  }
  function cancel() {
    stopCollection();
    stopAttempt();
  }

  function rootsCurrent(gathered: Collection) {
    const workspace = folders.getSnapshot();
    const additional = workspace.roots.length - gathered.roots.length;
    return !workspace.error && (additional === 0 || (gathered.selecting && additional === 1)) &&
      gathered.roots.every(({ root, generation }) => workspace.roots.some((item) =>
        item.handle === root && item.generation === generation && (item.status === "complete" || item.status === "scanning")));
  }
  function beginCollection() {
    const check = () => {
      if (collection === gathered && (!available() || !rootsCurrent(gathered) ||
          (!gathered.adoptingSingle && !documents.canRestorePrimaryTab()))) cancel();
    };
    const offFolders = folders.subscribe(check);
    const offDocuments = documents.subscribe(check);
    const gathered: Collection = {
      roots: [], selecting: false, adoptingSingle: false,
      stop() { offFolders(); offDocuments(); },
    };
    collection = gathered;
    return gathered;
  }

  function waitForScan(intent: Intent, current: () => boolean) {
    return new Promise<boolean>((resolve) => {
      let finished = false;
      const finish = (complete: boolean) => {
        if (finished) return;
        finished = true;
        intent.cancel = undefined;
        offFolders();
        resolve(complete);
      };
      const check = () => {
        if (!current() || !documents.canRestorePrimaryTab()) { finish(false); return; }
        if (folders.getSnapshot().roots.every(root => root.status === "complete")) finish(true);
      };
      const offFolders = folders.subscribe(check);
      intent.cancel = () => finish(false);
      check();
    });
  }

  async function recover(intent: Intent, gathered: Collection, current: () => boolean) {
    const requestId = crypto.randomUUID();
    const envelope = { protocolVersion: 1, requestId } as const;
    const multi = gathered.roots.length > 1;
    const open = multi
      ? { ...envelope, op: "open-multi", roots: [...gathered.roots] } as const
      : { ...envelope, op: "open", ...gathered.roots[0] } as const;
    if (!validMainTabRecoveryRequest(open) || !current() || !documents.canRestorePrimaryTab()) return;
    let finishing: Promise<unknown> | undefined;
    const finish = (adopted: boolean) => {
      if (!finishing) {
        finishing = Promise.resolve().then(() => send({ ...envelope, op: "finish", adopted })).catch(() => undefined);
        if (!adopted) previousCleanup = finishing.then(isFinished);
      }
      return finishing;
    };
    const isFinished = (reply: unknown) => validMainTabRecoveryResponse(reply, requestId) && reply.status === "finished";
    intent.cancel = () => { void finish(false); };
    const eligible = () => !finishing && current() && documents.canRestorePrimaryTab();
    async function groupItem(index: number) {
      if (!eligible()) return;
      const item = await send({ ...envelope, op: "group-item", index });
      if (eligible() && validMainTabRecoveryResponse(item, requestId) && item.status === "group-item" && item.index === index)
        return item;
    }
    const registerAdoption = (items: readonly Target[]) => {
      intent.cancel = undefined;
      stopCollection();
      const result = finish(true).then((acknowledgement) => {
        ticket.pending = false;
        return isFinished(acknowledgement);
      });
      const targets = items.map(({ documentId, handle }) => ({ documentId, handle }));
      const ticket = { targets, pending: true, result };
      adoption = ticket;
    };
    let adopted = false;
    try {
      const reply = await send(open);
      if (!eligible() || !validMainTabRecoveryResponse(reply, requestId)) return;
      if (reply.status === "ready" && !multi) {
        gathered.adoptingSingle = true;
        adopted = await documents.adoptRecoveredPrimaryTab(reply.snapshot, reply.mode, reply.pinned, current,
          () => registerAdoption([reply.snapshot]), reply.viewport);
      } else if (reply.status === "group") {
        adopted = await documents.adoptRecoveredPrimaryGroup(reply.count, reply.activeIndex, groupItem,
          () => !finishing && current(), registerAdoption);
      }
    } finally {
      gathered.adoptingSingle = false;
      intent.cancel = undefined;
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
    async reselect(expectedRootId: string, expectedPath?: string) {
      if (folders.getSnapshot().busy || collection?.selecting) return;
      try {
        if (!available() || !documents.canRestorePrimaryTab() || (!collection && folders.getSnapshot().roots.length)) {
          cancel();
          await documents.runWorkspaceAction(folders.select);
          return;
        }
        const gathered = collection ?? beginCollection();
        stopAttempt();
        let selected: WorkspaceSelectionReceipt | undefined;
        gathered.selecting = true;
        try {
          await documents.runWorkspaceAction(async () => { selected = await folders.selectWithReceipt(); });
        } finally { gathered.selecting = false; }
        if (collection !== gathered) return;
        if (!selected) {
          if (!rootsCurrent(gathered)) cancel();
          else if (!gathered.roots.length) stopCollection();
          return;
        }
        const root = folders.getSnapshot().roots.find(root => root.handle === selected?.handle);
        if (!selected.current() || !root || (expectedPath !== undefined && root.displayPath !== expectedPath) ||
            gathered.roots.some(candidate => candidate.expectedRootId === expectedRootId)) { cancel(); return; }
        gathered.roots.push({ root: selected.handle, generation: selected.generation, expectedRootId });
        if (!rootsCurrent(gathered)) { cancel(); return; }
        const intent: Intent = {};
        active = intent;
        const current = () => active === intent && collection === gathered && available() && rootsCurrent(gathered);
        try {
          if (!(await waitForScan(intent, current))) return;
          if (previousCleanup && !(await previousCleanup)) return;
          if (current()) await recover(intent, gathered, current);
        } finally {
          if (active === intent) active = undefined;
        }
      } catch {
        // An optional recovery does not change the outcome of joining the directory.
      }
    },
  };
}
