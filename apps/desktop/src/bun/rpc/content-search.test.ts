import { expect, test } from "bun:test";

import {
  validContentSearchRequest,
  validContentSearchResponse,
  validContentSearchPrepareRequest,
  type ContentSearchCandidates,
  type ContentSearchPrepared,
  type ContentSearchRequest,
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
