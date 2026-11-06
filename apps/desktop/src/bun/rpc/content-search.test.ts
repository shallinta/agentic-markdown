import { expect, test } from "bun:test";

import {
  validContentSearchRequest,
  validContentSearchResponse,
  validContentSearchPrepareRequest,
  validContentSearchPrepareResponse,
  type ContentSearchCandidates,
  type ContentSearchPrepared,
  type ContentSearchRequest,
  type ContentSearchRetainedPrepared,
} from "../../shared/content-search";
import { analyzeTextFidelity } from "../../shared/text-fidelity";

import { createContentSearchRPC } from "./content-search";

const id = () => crypto.randomUUID();
const envelope = () => ({ protocolVersion: 1 as const, requestId: id() });
const query = (handles: string[] = []) => ({
  ...envelope(),
  op: "query" as const,
  root: id(),
  generation: 1,
  query: "😀",
  handles,
});
const queryRoots = () => ({
  ...envelope(),
  op: "query-roots" as const,
  roots: [{ handle: id(), generation: 2 }, { handle: id(), generation: 1 }],
  query: "😀",
  handles: [],
});
const prepareHit = () => ({
  ...envelope(),
  root: id(),
  generation: 1,
  entry: id(),
  expectedHash: "a".repeat(64),
});
const queryWorkspace = () => ({
  ...queryRoots(),
  op: "query-workspace" as const,
  standaloneHandles: [id(), id()],
});
const prepareRetained = () => ({
  ...envelope(),
  op: "prepare-retained" as const,
  roots: [],
  entry: id(),
  expectedHash: "a".repeat(64),
});
function retainedTarget(input: ReturnType<typeof prepareRetained>): ContentSearchRetainedPrepared {
  return {
    ok: true,
    target: {
      kind: "retained",
      snapshot: {
        handle: input.entry,
        documentId: id(),
        revision: 1,
        hash: input.expectedHash,
        text: "sample",
        byteLength: 6,
        fileName: "sample.md",
        explicitStandalone: true,
        locationId: id(),
        fidelity: analyzeTextFidelity("sample"),
        writeCapability: { writable: true, reason: "writable" },
      },
    },
  };
}

test("content search wire rejects unbounded, unknown and inconsistent data", () => {
  const handle = id();
  const request = query([handle]);
  expect(validContentSearchRequest(request)).toBe(true);
  expect(validContentSearchRequest({ ...request, path: "/outside" })).toBe(
    false
  );
  expect(
    validContentSearchRequest({ ...request, handles: [handle, handle] })
  ).toBe(false);
  expect(validContentSearchRequest({ ...request, query: "\ud800" })).toBe(
    false
  );
  const entry = id();
  const response = {
    protocolVersion: 1,
    requestId: request.requestId,
    ok: true,
    op: "query",
    root: request.root,
    generation: request.generation,
    coverage: [
      { entry, hash: "a".repeat(64), bytes: 4, hit: { from: 0, to: 2 } },
    ],
    mappings: [{ handle, kind: "unresolved" }],
  };
  expect(validContentSearchResponse(response, request)).toBe(true);
  expect(
    validContentSearchResponse({ ...response, mappings: [] }, request)
  ).toBe(false);
  expect(validContentSearchResponse({ ...response, root: id() }, request)).toBe(
    false
  );
  expect(
    validContentSearchResponse(
      { ...response, coverage: [response.coverage[0], response.coverage[0]] },
      request
    )
  ).toBe(false);
  expect(
    validContentSearchResponse(
      { ...response, coverage: [{ ...response.coverage[0], bytes: 65_537 }] },
      request
    )
  ).toBe(false);
});

test("window transition aborts an accepted query and retains the active slot until cleanup", async () => {
  const gate = Promise.withResolvers<ContentSearchCandidates>();
  let signal: AbortSignal | undefined;
  const rpc = createContentSearchRPC({
    searchContentCandidates(_input, abort) {
      signal = abort;
      return gate.promise;
    },
  });
  const request = query();
  expect(await rpc.run(request)).toMatchObject({ error: "NOT_READY" });
  rpc.setReady(true);
  const pending = rpc.run(request);
  const wrongCancel: ContentSearchRequest = {
    ...envelope(),
    op: "cancel",
    targetRequestId: id(),
  };
  expect(await rpc.run(wrongCancel)).toMatchObject({ error: "STALE" });
  expect(signal?.aborted).toBe(false);
  const resume = rpc.suspend();
  expect(signal?.aborted).toBe(true);
  let drained = false;
  const drain = rpc.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  expect(await rpc.run(query())).toMatchObject({ error: "NOT_READY" });
  resume();
  expect(await rpc.run(query())).toMatchObject({ error: "BUSY" });
  gate.resolve({ ok: true, coverage: [], mappings: [] });
  expect(await pending).toMatchObject({ error: "CANCELLED" });
  await drain;
  expect(drained).toBe(true);
});

test("cancellation cannot hide an uncertain accepted native result", async () => {
  const gate = Promise.withResolvers<ContentSearchCandidates>();
  const rpc = createContentSearchRPC({
    searchContentCandidates: () => gate.promise,
  });
  rpc.setReady(true);
  const request = query();
  const pending = rpc.run(request);
  expect(
    await rpc.run({
      ...envelope(),
      op: "cancel",
      targetRequestId: request.requestId,
    })
  ).toMatchObject({ ok: true, op: "cancel" });
  gate.resolve({ ok: false, error: "UNKNOWN" });
  expect(await pending).toMatchObject({ error: "UNKNOWN" });
});

test("multi-root requests use their own scope in the existing query, prepare and cancel lane", async () => {
  const single = Promise.withResolvers<ContentSearchCandidates>();
  const multi = Promise.withResolvers<ContentSearchCandidates>();
  const preparing = Promise.withResolvers<ContentSearchPrepared>();
  const request = queryRoots();
  const empty: ContentSearchCandidates = { ok: true, coverage: [], mappings: [] };
  let calls = 0;
  let signal: AbortSignal | undefined;
  const rpc = createContentSearchRPC({
    searchContentCandidates: () => single.promise,
    searchContentCandidatesForRoots(input, abort) {
      expect(input.roots).toEqual(request.roots);
      signal = abort;
      calls++;
      return multi.promise;
    },
    prepareContentSearchDocument: () => preparing.promise,
  }, () => Promise.resolve(true));

  expect(await rpc.run(request)).toMatchObject({ error: "NOT_READY" });
  rpc.setReady(true);
  expect(await rpc.run({ ...request, roots: [request.roots[0], request.roots[0]] }))
    .toMatchObject({ error: "INVALID" });
  expect(calls).toBe(0);
  const first = rpc.run(query());
  expect(await rpc.run(request)).toMatchObject({ error: "BUSY" });
  single.resolve(empty);
  expect(await first).toMatchObject({ ok: true, op: "query" });

  const prepare = rpc.prepare(prepareHit());
  expect(await rpc.run(request)).toMatchObject({ error: "BUSY" });
  preparing.resolve({ ok: false, error: "STALE" });
  expect(await prepare).toMatchObject({ error: "STALE" });

  const pending = rpc.run(request);
  expect(await rpc.run(query())).toMatchObject({ error: "BUSY" });
  expect(await rpc.prepare(prepareHit())).toMatchObject({ error: "BUSY" });
  expect(await rpc.run({ ...envelope(), op: "cancel", targetRequestId: id() }))
    .toMatchObject({ error: "STALE" });
  expect(signal?.aborted).toBe(false);
  expect(await rpc.run({ ...envelope(), op: "cancel", targetRequestId: request.requestId }))
    .toMatchObject({ ok: true, op: "cancel" });
  expect(signal?.aborted).toBe(true);
  expect(await rpc.run(queryRoots())).toMatchObject({ error: "BUSY" });
  multi.resolve(empty);
  expect(await pending).toMatchObject({ error: "CANCELLED" });
  await rpc.drain();
  const receipt = await rpc.run(request);
  expect(receipt).toEqual({
    ...empty, protocolVersion: 1, requestId: request.requestId,
    op: "query-roots", roots: request.roots,
  });
  expect(calls).toBe(2);
});

test("an uncertain multi-root result survives window retirement and drain", async () => {
  const gate = Promise.withResolvers<ContentSearchCandidates>();
  const rpc = createContentSearchRPC({
    searchContentCandidates: () => Promise.resolve({ ok: false, error: "UNAVAILABLE" }),
    searchContentCandidatesForRoots: () => gate.promise,
  });
  rpc.setReady(true);
  const pending = rpc.run(queryRoots());
  rpc.setReady(false);
  gate.resolve({ ok: false, error: "UNKNOWN" });
  expect(await pending).toMatchObject({ error: "UNKNOWN" });
  await rpc.drain();
});

test("mixed queries use the common active lane and retain uncertain outcome through cancellation", async () => {
  const gate = Promise.withResolvers<ContentSearchCandidates>();
  const empty: ContentSearchCandidates = { ok: true, coverage: [], mappings: [] };
  const request = queryWorkspace();
  let calls = 0;
  let signal: AbortSignal | undefined;
  const rpc = createContentSearchRPC({
    searchContentCandidates: () => Promise.resolve(empty),
    searchContentCandidatesForRoots: () => Promise.resolve(empty),
    prepareContentSearchDocument: () => Promise.resolve({ ok: false, error: "STALE" }),
    prepareRetainedContentSearchDocument: () => Promise.resolve({ ok: false, error: "STALE" }),
    searchContentCandidatesForWorkspace(input, abort) {
      expect(input.roots).toEqual(request.roots);
      expect(input.standaloneHandles).toEqual(request.standaloneHandles);
      signal = abort;
      return ++calls === 1 ? gate.promise : Promise.resolve(empty);
    },
  }, () => Promise.resolve(true));

  expect(await rpc.run(request)).toMatchObject({ error: "NOT_READY" });
  rpc.setReady(true);
  expect(await rpc.run({ ...request, standaloneHandles: [request.standaloneHandles[0], request.standaloneHandles[0]] }))
    .toMatchObject({ error: "INVALID" });
  expect(calls).toBe(0);
  const pending = rpc.run(request);
  expect(await rpc.run(query())).toMatchObject({ error: "BUSY" });
  expect(await rpc.run(queryRoots())).toMatchObject({ error: "BUSY" });
  expect(await rpc.prepare(prepareHit())).toMatchObject({ error: "BUSY" });
  expect(await rpc.prepare(prepareRetained())).toMatchObject({ error: "BUSY" });
  expect(await rpc.run({ ...envelope(), op: "cancel", targetRequestId: request.requestId }))
    .toMatchObject({ ok: true, op: "cancel" });
  expect(signal?.aborted).toBe(true);
  let drained = false;
  const drain = rpc.drain().then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);
  expect(await rpc.run({ ...request, ...envelope() })).toMatchObject({ error: "BUSY" });
  gate.resolve({ ok: false, error: "UNKNOWN" });
  expect(await pending).toMatchObject({ error: "UNKNOWN" });
  await drain;
  expect(drained).toBe(true);
  const next = { ...request, ...envelope() };
  expect(await rpc.run(next)).toEqual({
    ...empty,
    protocolVersion: 1, requestId: next.requestId, op: "query-workspace",
    roots: request.roots, standaloneHandles: request.standaloneHandles,
  });
  expect(calls).toBe(2);
});

test("retained preparation works without a release callback and drains cancelled I/O", async () => {
  const request = prepareRetained();
  const gate = Promise.withResolvers<ContentSearchRetainedPrepared>();
  const empty: ContentSearchCandidates = { ok: true, coverage: [], mappings: [] };
  let signal: AbortSignal | undefined;
  const rpc = createContentSearchRPC({
    searchContentCandidates: () => Promise.resolve(empty),
    searchContentCandidatesForWorkspace: () => Promise.resolve(empty),
    prepareRetainedContentSearchDocument(input, requestId, abort) {
      expect(input.entry).toBe(request.entry);
      expect(requestId).toBe(request.requestId);
      signal = abort;
      return gate.promise;
    },
  });
  expect(await rpc.prepare(request)).toMatchObject({ error: "NOT_READY" });
  rpc.setReady(true);
  const pending = rpc.prepare(request);
  expect(await rpc.run(queryWorkspace())).toMatchObject({ error: "BUSY" });
  expect(await rpc.run({ ...envelope(), op: "cancel", targetRequestId: request.requestId }))
    .toMatchObject({ ok: true, op: "cancel" });
  expect(signal?.aborted).toBe(true);
  let drained = false;
  const drain = rpc.drain().then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);
  gate.resolve(retainedTarget(request));
  expect(await pending).toMatchObject({ error: "CANCELLED" });
  await drain;
  const completed = await rpc.prepare(request);
  expect(validContentSearchPrepareResponse(completed, request)).toBe(true);
  expect(completed).toMatchObject({ ok: true, target: { kind: "retained", snapshot: { handle: request.entry } } });
});

test.each([
  { retire: false, forged: true, uncertain: false, expected: "UNAVAILABLE" },
  { retire: true, forged: true, uncertain: false, expected: "CANCELLED" },
  { retire: true, forged: false, uncertain: false, expected: "CANCELLED" },
  { retire: true, forged: false, uncertain: true, expected: "UNKNOWN" },
])("retained preparation never releases an original grant (%j)", async ({ retire, forged, uncertain, expected }) => {
  const gate = Promise.withResolvers<ContentSearchRetainedPrepared>();
  const releaseCalls: string[] = [];
  const request = prepareRetained();
  const rpc = createContentSearchRPC({
    searchContentCandidates: () => Promise.resolve({ ok: false, error: "UNAVAILABLE" }),
    prepareRetainedContentSearchDocument: () => gate.promise,
  }, (handle) => {
    releaseCalls.push(handle);
    return Promise.resolve(true);
  });
  rpc.setReady(true);
  const pending = rpc.prepare(request);
  if (retire) rpc.setReady(false);
  const result = retainedTarget(request);
  if (!result.ok) throw Error("Missing fixture");
  // Deliberately violate the producer's TypeScript contract at the wire boundary.
  if (forged) Object.defineProperty(result.target, "kind", { value: "open" });
  gate.resolve(uncertain ? { ok: false, error: "UNKNOWN" } : result);
  expect(await pending).toMatchObject({ ok: false, error: expected });
  await rpc.drain();
  expect(releaseCalls).toEqual([]);
});

test.each([
  { ready: false, revision: 1, error: "CANCELLED" },
  { ready: true, revision: 0, error: "UNAVAILABLE" },
])(
  "retired or invalid prepare releases a newly published grant before draining (%j)",
  async ({ ready, revision, error }) => {
    const gate = Promise.withResolvers<ContentSearchPrepared>();
    const released: string[] = [];
    const rpc = createContentSearchRPC(
      {
        searchContentCandidates: () =>
          Promise.resolve({ ok: true, coverage: [], mappings: [] }),
        prepareContentSearchDocument: () => gate.promise,
      },
      (handle) => {
        released.push(handle);
        return Promise.resolve(true);
      }
    );
    const hash = "a".repeat(64);
    const input = {
      ...envelope(),
      root: id(),
      generation: 1,
      entry: id(),
      expectedHash: hash,
    };
    expect(validContentSearchPrepareRequest(input)).toBe(true);
    expect(
      validContentSearchPrepareRequest({ ...input, path: "/forged" })
    ).toBe(false);
    rpc.setReady(true);
    const pending = rpc.prepare(input);
    if (!ready) rpc.setReady(false);
    const handle = id();
    gate.resolve({
      ok: true,
      target: {
        kind: "open",
        snapshot: {
          handle,
          documentId: id(),
          revision,
          hash,
          text: "sample",
          byteLength: 6,
          fileName: "sample.md",
          fidelity: analyzeTextFidelity("sample"),
          writeCapability: { writable: true, reason: "writable" },
        },
      },
    });
    await rpc.drain();
    expect(await pending).toMatchObject({ error });
    expect(released).toEqual([handle]);
  }
);
