import { randomUUID } from "node:crypto";

import {
  validRemovalRequest,
  type RemovalOperation,
  type RemovalResponse,
} from "../../shared/standalone-removal";

/** One unacknowledged operation for this process/window. No disk or recovery log. */
export function createStandaloneRemoval<Identity>(
  inspect: (handle: string) => Identity | null,
  commit: (handle: string, identity: Identity, committed: () => void) => boolean
) {
  const session = randomUUID();
  let ackedThrough = 0;
  let slot: {
    operation: RemovalOperation;
    identity: Identity;
    status: "issued" | "committed" | "rejected";
  } | null = null;
  return (value: unknown): RemovalResponse => {
    if (!validRemovalRequest(value)) throw Error("Invalid removal request");
    const envelope = {
      protocolVersion: 1 as const,
      requestId: value.requestId,
    };
    if (value.op === "state")
      return {
        ...envelope,
        status: "state",
        session,
        sequence: ackedThrough + 1,
      };
    const operation = {
      session: value.session,
      sequence: value.sequence,
      handle: value.handle,
    };
    const reply = (
      status: Exclude<RemovalResponse["status"], "state">
    ): RemovalResponse => ({ ...envelope, status, operation });
    if (value.session !== session) return reply("stale-session");
    if (value.sequence <= ackedThrough)
      return reply(value.op === "ack" ? "acked" : "unknown");
    if (
      value.sequence !== ackedThrough + 1 ||
      !Number.isSafeInteger(ackedThrough + 2)
    )
      return reply("unknown");
    const matches =
      slot?.operation.sequence === value.sequence &&
      slot.operation.handle === value.handle;
    if (slot && !matches) return reply("busy");
    if (value.op === "begin" && !slot) {
      const identity = inspect(value.handle);
      if (!identity) return reply("rejected");
      slot = { operation, identity, status: "issued" };
    }
    if (!slot) return reply("unknown");
    if (value.op === "commit" && slot.status === "issued") {
      const captured = slot;
      // Authority owner marks the receipt at its synchronous commit point.
      try {
        if (
          !commit(value.handle, slot.identity, () => {
            captured.status = "committed";
          })
        )
          captured.status = "rejected";
      } catch {
        if (captured.status !== "committed")
          throw Error("Removal commit unconfirmed");
      }
    }
    if (value.op === "ack" && slot.status !== "issued") {
      slot = null;
      ackedThrough = value.sequence;
      return reply("acked");
    }
    return reply(slot.status);
  };
}
