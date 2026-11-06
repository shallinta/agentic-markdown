import {
  validContentSearchRequest,
  validContentSearchResponse,
  type ContentSearchError,
  type ContentSearchResponse,
} from "../../shared/content-search";
import { perfRecord, perfUuid } from "../../shared/perf-lab";
import type { TrustedWorkspaceService } from "../workspace";

/** Owned by one native window and its workspace. A stale view cannot publish a reply. */
export function createContentSearchRPC(
  workspace: Pick<TrustedWorkspaceService, "searchContentCandidates">
) {
  let ready = false;
  let suspended = 0;
  let active:
    { id: string; abort: AbortController; settled: Promise<void> } | undefined;
  const cancel = () => active?.abort.abort();
  return {
    setReady(value: boolean) {
      cancel();
      ready = value;
    },
    suspend() {
      suspended++;
      cancel();
      let released = false;
      return () => {
        if (!released) suspended--;
        released = true;
      };
    },
    async drain() {
      await active?.settled;
    },
    async run(input: unknown): Promise<ContentSearchResponse> {
      const requestId =
        perfRecord(input) && perfUuid(input.requestId) ? input.requestId : null;
      const fail = (error: ContentSearchError): ContentSearchResponse => ({
        protocolVersion: 1,
        requestId,
        ok: false,
        error,
      });
      if (!validContentSearchRequest(input)) return fail("INVALID");
      if (!ready || suspended) return fail("NOT_READY");
      const envelope = {
        protocolVersion: 1 as const,
        requestId: input.requestId,
      };
      if (input.op === "cancel") {
        if (active?.id !== input.targetRequestId) return fail("STALE");
        cancel();
        return { ...envelope, ok: true, op: "cancel" };
      }
      if (active) return fail("BUSY");
      const completion = Promise.withResolvers<void>();
      const request = {
        id: input.requestId,
        abort: new AbortController(),
        settled: completion.promise,
      };
      active = request;
      try {
        const result = await workspace.searchContentCandidates(
          input,
          request.abort.signal
        );
        if (!result.ok && result.error === "UNKNOWN") return fail("UNKNOWN");
        if (request.abort.signal.aborted || !ready || suspended)
          return fail("CANCELLED");
        if (!result.ok) return fail(result.error);
        const response = {
          ...envelope,
          ...result,
          op: "query" as const,
          root: input.root,
          generation: input.generation,
        };
        return validContentSearchResponse(response, input)
          ? response
          : fail("UNAVAILABLE");
      } catch {
        return fail(request.abort.signal.aborted ? "CANCELLED" : "UNAVAILABLE");
      } finally {
        active = undefined;
        completion.resolve();
      }
    },
  };
}
