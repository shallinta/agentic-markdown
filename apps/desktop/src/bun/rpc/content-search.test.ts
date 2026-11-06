import { expect, test } from "bun:test";

import {
  validContentSearchRequest,
  validContentSearchResponse,
  type ContentSearchCandidates,
  type ContentSearchRequest,
} from "../../shared/content-search";

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
