import { randomUUID } from "node:crypto";

import {
  validFolderRemovalRequest,
  type FolderRemovalDocument,
  type FolderRemovalOperation,
  type FolderRemovalPublication,
  type FolderRemovalResponse,
  type OpenFolderDocument,
} from "../../shared/folder-removal";

export interface FolderRemovalPlan {
  documents: FolderRemovalDocument[];
  commit(
    decision: "keep" | "close"
  ): Promise<FolderRemovalPublication | "rejected" | "pending">;
  query(): Promise<FolderRemovalPublication | "rejected" | "pending">;
  cancel(): void;
}

/** One process-local directory removal. Its live plan owns both mutation leases. */
export function createFolderRemoval(
  prepare: (
    root: string,
    generation: number,
    documents: OpenFolderDocument[]
  ) => Promise<FolderRemovalPlan>
) {
  const session = randomUUID();
  let acked = 0;
  interface Slot {
    operation: FolderRemovalOperation;
    input: string;
    plan?: FolderRemovalPlan;
    status: "pending" | "issued" | "committed" | "rejected";
    publication?: FolderRemovalPublication;
    busy: boolean;
    decision?: "keep" | "close";
  }
  let slot: Slot | null = null;
  let stopped = false;
  return {
    dispose: () => {
      stopped = true;
      slot?.plan?.cancel();
    },
    busy: () => slot !== null,
    async request(value: unknown): Promise<FolderRemovalResponse> {
      if (!validFolderRemovalRequest(value))
        throw Error("Invalid folder removal request");
      const envelope = {
        protocolVersion: 1 as const,
        requestId: value.requestId,
      };
      if (stopped) throw Error("Folder removal disposed");
      if (value.op === "state")
        return { ...envelope, status: "state", session, sequence: acked + 1 };
      const operation = {
        session: value.session,
        sequence: value.sequence,
        root: value.root,
      };
      const reply = (
        status:
          | "unknown"
          | "busy"
          | "stale-session"
          | "acked"
          | "pending"
          | "rejected"
      ): FolderRemovalResponse => ({ ...envelope, status, operation });
      if (value.session !== session) return reply("stale-session");
      if (value.sequence <= acked)
        return reply(value.op === "ack" ? "acked" : "unknown");
      if (value.sequence !== acked + 1 || !Number.isSafeInteger(acked + 2))
        return reply("unknown");
      if (
        slot &&
        (slot.operation.sequence !== value.sequence ||
          slot.operation.root !== value.root)
      )
        return reply("busy");
      if (value.op === "prepare") {
        const input = JSON.stringify([value.generation, value.documents]);
        if (slot && slot.input !== input) return reply("unknown");
        if (!slot) {
          const current: Slot = {
            operation,
            input,
            status: "pending",
            busy: true,
          };
          slot = current;
          try {
            current.plan = await prepare(
              value.root,
              value.generation,
              value.documents
            );
            if (stopped) {
              current.plan.cancel();
              current.status = "rejected";
            } else current.status = "issued";
          } catch {
            current.status = "rejected";
          } finally {
            current.busy = false;
          }
        }
      }
      const current = slot;
      if (!current) return reply("unknown");
      if (current.busy) return reply("pending");
      if (value.op === "cancel" && current.status === "issued") {
        current.plan!.cancel();
        current.status = "rejected";
      }
      const mayCommit = value.op === "commit" && current.status === "issued";
      const mayQuery = value.op === "query" && current.status === "pending";
      if (mayCommit || mayQuery) {
        current.busy = true;
        if (mayCommit) current.decision = value.decision;
        try {
          const result = mayCommit
            ? await current.plan!.commit(value.decision)
            : await current.plan!.query();
          if (typeof result === "string") current.status = result;
          else {
            current.publication = result;
            current.status = "committed";
          }
        } catch {
          current.status = "pending";
        } finally {
          current.busy = false;
        }
      }
      if (
        value.op === "ack" &&
        (current.status === "committed" || current.status === "rejected")
      ) {
        slot = null;
        acked = value.sequence;
        return reply("acked");
      }
      if (current.status === "committed")
        return {
          ...envelope,
          status: "committed",
          operation,
          publication: structuredClone(current.publication!),
        };
      if (current.status === "issued")
        return {
          ...envelope,
          status: "issued",
          operation,
          documents: structuredClone(current.plan!.documents),
        };
      return reply(current.status);
    },
  };
}
