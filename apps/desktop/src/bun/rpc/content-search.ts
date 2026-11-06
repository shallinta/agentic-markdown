import {
  validContentSearchRequest,
  validContentSearchResponse,
  validContentSearchPrepareRequest,
  validContentSearchPrepareResponse,
  type ContentSearchError,
  type ContentSearchPrepareResponse,
  type ContentSearchResponse,
  type ContentSearchScopeRoot,
} from "../../shared/content-search";
import { perfRecord, perfUuid } from "../../shared/perf-lab";
import type { TrustedWorkspaceService } from "../workspace";

const copyRoots = (roots: readonly ContentSearchScopeRoot[]) =>
  roots.map(({ handle, generation }) => ({ handle, generation }));

/** Owned by one native window and its workspace. A stale view cannot publish a reply. */
export function createContentSearchRPC(
  workspace: Pick<TrustedWorkspaceService, "searchContentCandidates"> &
    Partial<Pick<TrustedWorkspaceService,
      "prepareContentSearchDocument" | "prepareRetainedContentSearchDocument" |
      "searchContentCandidatesForRoots" | "searchContentCandidatesForWorkspace">>,
  release?: (handle: string) => Promise<boolean>
) {
  let ready = false;
  let suspended = 0;
  let active:
    { id: string; abort: AbortController; settled: Promise<void> } | undefined;
  const cancel = () => active?.abort.abort();
  function begin(id: string) {
    const completion = Promise.withResolvers<void>();
    const request = {
      id,
      abort: new AbortController(),
      settled: completion.promise,
    };
    active = request;
    return {
      signal: request.abort.signal,
      finish() {
        active = undefined;
        completion.resolve();
      },
    };
  }
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
    async prepare(input: unknown): Promise<ContentSearchPrepareResponse> {
      const requestId =
        perfRecord(input) && perfUuid(input.requestId) ? input.requestId : null;
      const fail = (
        error: ContentSearchError
      ): ContentSearchPrepareResponse => ({
        protocolVersion: 1,
        requestId,
        ok: false,
        error,
      });
      if (!validContentSearchPrepareRequest(input)) return fail("INVALID");
      if (!ready || suspended) return fail("NOT_READY");
      const prepare = "op" in input
        ? {
            ...input,
            roots: copyRoots(input.roots),
            ...(input.binding ? { binding: { ...input.binding } } : {}),
          }
        : input;
      const retained = "op" in prepare;
      if (retained ? !workspace.prepareRetainedContentSearchDocument
        : !workspace.prepareContentSearchDocument || !release)
        return fail("UNAVAILABLE");
      if (active) return fail("BUSY");
      const request = begin(prepare.requestId);
      try {
        const result = retained
          ? await workspace.prepareRetainedContentSearchDocument?.({
              roots: prepare.roots, entry: prepare.entry, expectedHash: prepare.expectedHash,
              ...(prepare.binding ? { binding: prepare.binding } : {}),
            }, prepare.requestId, request.signal)
          : await workspace.prepareContentSearchDocument?.(prepare, prepare.requestId, request.signal);
        if (!result) return fail("UNAVAILABLE");
        if (!result.ok && result.error === "UNKNOWN") return fail("UNKNOWN");
        const cancelled = request.signal.aborted || !ready || suspended;
        const response = {
          protocolVersion: 1 as const,
          requestId: prepare.requestId,
          ...result,
        };
        if (!cancelled && validContentSearchPrepareResponse(response, prepare))
          return response;
        if (!retained && release && result.ok && result.target.kind === "open") {
          const released = await release(result.target.snapshot.handle).catch(
            () => false
          );
          if (!released) return fail("UNKNOWN");
        }
        return fail(cancelled ? "CANCELLED" : "UNAVAILABLE");
      } catch {
        return fail(request.signal.aborted ? "CANCELLED" : "UNAVAILABLE");
      } finally {
        request.finish();
      }
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
      const query = input.op === "query" ? input
        : input.op === "query-roots" ? { ...input, roots: copyRoots(input.roots) }
        : {
            ...input,
            roots: copyRoots(input.roots),
            standaloneHandles: [...input.standaloneHandles],
            handles: [...input.handles],
            ...(input.fileFilters ? { fileFilters: [...input.fileFilters] } : {}),
            ...(input.pathFilters ? { pathFilters: input.pathFilters.map((filter) => ({ ...filter })) } : {}),
          };
      const request = begin(input.requestId);
      try {
        const result = query.op === "query" ? await workspace.searchContentCandidates(query, request.signal)
          : query.op === "query-roots" ? await workspace.searchContentCandidatesForRoots?.(query, request.signal)
          : await workspace.searchContentCandidatesForWorkspace?.(query, request.signal);
        if (!result) return fail("UNAVAILABLE");
        if (!result.ok && result.error === "UNKNOWN") return fail("UNKNOWN");
        if (request.signal.aborted || !ready || suspended)
          return fail("CANCELLED");
        if (!result.ok) return fail(result.error);
        const scope = query.op === "query" ? { op: query.op, root: query.root, generation: query.generation }
          : query.op === "query-roots" ? { op: query.op, roots: query.roots }
          : { op: query.op, roots: query.roots, standaloneHandles: query.standaloneHandles };
        const response = { ...envelope, ...result, ...scope };
        return validContentSearchResponse(response, query)
          ? response
          : fail("UNAVAILABLE");
      } catch {
        return fail(request.signal.aborted ? "CANCELLED" : "UNAVAILABLE");
      } finally {
        request.finish();
      }
    },
  };
}
