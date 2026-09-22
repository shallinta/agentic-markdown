import {
  isDiscardResponse,
  type DiscardRequest,
  type DiscardReason,
} from "../../shared/discard";

/** Renderer owns the current buffer and freezes it before making a decision. */
export function createDiscardCoordinator({
  prepare,
  release,
  timeoutMs = 60_000,
}: {
  prepare: (request: DiscardRequest) => Promise<unknown>;
  release: (requestId: string) => void;
  timeoutMs?: number;
}) {
  let active = false;
  return async (
    reason: DiscardReason,
    execute: (requestId: string) => Promise<boolean> | boolean
  ): Promise<boolean> => {
    if (active) return false;
    active = true;
    const requestId = crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let committed = false;
    try {
      const response = await Promise.race([
        prepare({ protocolVersion: 1, requestId, reason }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);
      if (!isDiscardResponse(response, requestId) || !response.allow)
        return false;
      clearTimeout(timer);
      committed = await execute(requestId);
      return committed;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      // Approved destructive commits keep the old renderer frozen until destruction.
      if (!committed) {
        try {
          release(requestId);
        } catch {
          /* Fail closed if renderer transport is lost. */
        }
      }
      active = false;
    }
  };
}
