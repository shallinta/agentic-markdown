import {
  validContentSearchRequest,
  validContentSearchResponse,
  validContentSearchPrepareRequest,
  validContentSearchPrepareResponse,
  validContentSearchProgress,
  type ContentSearchError,
  type ContentSearchFileProgress,
  type ContentSearchInput,
  type ContentSearchPrepareResponse,
  type ContentSearchProgress,
  type ContentSearchRequest,
  type ContentSearchResponse,
  type ContentSearchScopeRoot,
} from "../../shared/content-search";
import { perfRecord, perfUuid } from "../../shared/perf-lab";
import type { TrustedWorkspaceService } from "../workspace";

const copyRoots = (roots: readonly ContentSearchScopeRoot[]) =>
  roots.map(({ handle, generation }) => ({ handle, generation }));
const copySelection = (input: Pick<ContentSearchInput, "handles" | "fileFilters" | "pathFilters">) => ({
  handles: [...input.handles],
  ...(input.fileFilters ? { fileFilters: [...input.fileFilters] } : {}),
  ...(input.pathFilters ? { pathFilters: input.pathFilters.map((filter) => ({ ...filter })) } : {}),
});
type Query = Exclude<ContentSearchRequest, { op: "cancel" }>;
function copyQuery(input: Query): Query {
  if (input.op === "query") return input.stream ? { ...input, ...copySelection(input) } : input;
  const roots = copyRoots(input.roots);
  if (input.op === "query-roots") return { ...input, roots };
  return { ...input, roots, standaloneHandles: [...input.standaloneHandles], ...copySelection(input) };
}

function queryFailure(requestId: string | null, error: ContentSearchError): ContentSearchResponse {
  return { protocolVersion: 1, requestId, ok: false, error };
}

/** Owned by one native window and its workspace. A stale view cannot publish a reply. */
export function createContentSearchRPC(
  workspace: Pick<TrustedWorkspaceService, "searchContentCandidates"> &
    Partial<Pick<TrustedWorkspaceService,
      "prepareContentSearchDocument" | "prepareRetainedContentSearchDocument" |
      "searchContentCandidatesForRoots" | "searchContentCandidatesForWorkspace">>,
  release?: (handle: string) => Promise<boolean>,
  sendProgress?: (progress: ContentSearchProgress) => void
) {
  let ready = false;
  let suspended = 0;
  let active:
    { id: string; streaming: boolean; abort: AbortController; settled: Promise<void> } | undefined;
  let pending: { query: Query; resolve: (response: ContentSearchResponse) => void } | undefined;
  function cancelPending() {
    const queued = pending;
    pending = undefined;
    if (queued) queued.resolve(queryFailure(queued.query.requestId, "CANCELLED"));
  }
  function cancelAll() {
    cancelPending();
    active?.abort.abort();
  }
  function begin(id: string, streaming = false) {
    const completion = Promise.withResolvers<void>();
    const request = {
      id,
      streaming,
      abort: new AbortController(),
      settled: completion.promise,
    };
    active = request;
    return {
      signal: request.abort.signal,
      current: () => active === request && ready && !suspended && !request.abort.signal.aborted,
      finish() {
        active = undefined;
        completion.resolve();
      },
    };
  }

  function promotePending(uncertain: boolean) {
    // Promote synchronously so the drain loop cannot miss an admitted successor.
    const queued = pending;
    pending = undefined;
    if (queued) {
      if (uncertain)
        queued.resolve(queryFailure(queued.query.requestId, "UNAVAILABLE"));
      else if (!ready || suspended)
        queued.resolve(queryFailure(queued.query.requestId, "CANCELLED"));
      else void executeQuery(queued.query).then(queued.resolve);
    }
  }

  async function executeQuery(query: Query): Promise<ContentSearchResponse> {
    const request = begin(query.requestId, query.stream === true);
    let uncertain = false;
    const envelope = { protocolVersion: 1 as const, requestId: query.requestId };
    const fail = (error: ContentSearchError) => queryFailure(query.requestId, error);
    const onFile = query.stream && sendProgress ? (() => {
      const emitted = new Set<string>();
      let progressFailed = false;
      return (update: ContentSearchFileProgress) => {
        if (progressFailed || !request.current()) return;
        try {
          if (!perfRecord(update) || "protocolVersion" in update || "requestId" in update)
            return;
          const progress = { ...envelope, ...update };
          if (!validContentSearchProgress(progress, query) || progress.sequence !== emitted.size + 1 ||
              emitted.has(progress.entry) || !request.current()) return;
          emitted.add(progress.entry);
          sendProgress(progress);
        } catch {
          // Delivery is uncertain. Keep the terminal reply, but do not risk a gap.
          progressFailed = true;
        }
      };
    })() : undefined;
    try {
      const result = query.op === "query" ? await workspace.searchContentCandidates(query, request.signal, onFile)
        : query.op === "query-roots" ? await workspace.searchContentCandidatesForRoots?.(query, request.signal)
        : await workspace.searchContentCandidatesForWorkspace?.(query, request.signal, onFile);
      if (!result) return fail("UNAVAILABLE");
      if (!result.ok && result.error === "UNKNOWN") {
        uncertain = true;
        return fail("UNKNOWN");
      }
      if (!request.current()) return fail("CANCELLED");
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
      promotePending(uncertain);
    }
  }

  return {
    setReady(value: boolean) {
      ready = false;
      cancelAll();
      ready = value;
    },
    suspend() {
      suspended++;
      cancelAll();
      let released = false;
      return () => {
        if (!released) suspended--;
        released = true;
      };
    },
    async drain() {
      while (active) await active.settled;
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
              ...(prepare.rootEntry ? { rootEntry: prepare.rootEntry } : {}),
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
      const fail = (error: ContentSearchError) => queryFailure(requestId, error);
      if (!validContentSearchRequest(input)) return fail("INVALID");
      if (!ready || suspended) return fail("NOT_READY");
      const envelope = {
        protocolVersion: 1 as const,
        requestId: input.requestId,
      };
      if (input.op === "cancel") {
        if (active?.id === input.targetRequestId) active.abort.abort();
        else if (pending?.query.requestId === input.targetRequestId) cancelPending();
        else return fail("STALE");
        return { ...envelope, ok: true, op: "cancel" };
      }
      if (!active) return executeQuery(copyQuery(input));
      if (!input.stream || !active.streaming || active.id === input.requestId || pending?.query.requestId === input.requestId ||
          (input.op === "query-workspace" && !workspace.searchContentCandidatesForWorkspace))
        return fail("BUSY");
      const query = copyQuery(input);
      const queued = Promise.withResolvers<ContentSearchResponse>();
      cancelPending();
      pending = { query, resolve: queued.resolve };
      active.abort.abort();
      return queued.promise;
    },
  };
}
