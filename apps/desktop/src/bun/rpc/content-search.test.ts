import { expect, test } from "bun:test";

import {
  validContentSearchRequest,
  validContentSearchResponse,
  validContentSearchPrepareRequest,
  validContentSearchPrepareResponse,
  validContentSearchProgress,
  type ContentSearchCandidates,
  type ContentSearchPrepared,
  type ContentSearchProgress,
  type ContentSearchRequest,
  type ContentSearchRetainedPrepared,
} from "../../shared/content-search";
import { analyzeTextFidelity } from "../../shared/text-fidelity";
import type { ContentSearchFileProgress } from "../workspace";

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
const streamQuery = () => ({ ...query(), fragments: true as const, stream: true as const });
const streamWorkspace = () => ({ ...queryWorkspace(), fragments: true as const, stream: true as const });
const cancelQuery = (targetRequestId: string) => ({ ...envelope(), op: "cancel" as const, targetRequestId });
const emptySearch: ContentSearchCandidates = { ok: true, coverage: [], mappings: [] };
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

test("progress ignores malformed, duplicate and out-of-order file receipts without changing terminal", async () => {
  const gate = Promise.withResolvers<ContentSearchCandidates>();
  const first = id(), second = id(), third = id();
  const fragments = { matches: [{ from: 2, to: 4, before: "前 ", after: " 后" }], more: false };
  const empty: ContentSearchCandidates = { ok: true, coverage: [], mappings: [] };
  const output: ContentSearchProgress[] = [];
  let calls = 0;
  let publish: ((event: ContentSearchFileProgress) => void) | undefined;
  const rpc = createContentSearchRPC({
    searchContentCandidates(_input, _signal, onFile) {
      ++calls;
      if (calls === 1) {
        expect(onFile).toBeUndefined();
        return Promise.resolve(empty);
      }
      publish = onFile;
      return gate.promise;
    },
  }, undefined, (event) => {
    output.push(event);
    if (event.sequence === 2) throw Error("synthetic window-send failure");
  });
  rpc.setReady(true);
  const legacy = { ...query(), fragments: true as const };
  expect(await rpc.run(legacy)).toMatchObject({ ok: true });
  expect(output).toEqual([]);
  const request = { ...legacy, ...envelope(), stream: true as const };
  const pending = rpc.run(request);
  const send = publish;
  if (!send) throw Error("Missing active query progress observer");
  send({ sequence: 2, entry: second, kind: "redacted" });
  send({ sequence: 0, entry: first, kind: "redacted" });
  send({ sequence: 1, entry: "/outside.md", kind: "redacted" });
  send({ sequence: 1, entry: first, kind: "fragments", fragments: {
    ...fragments, matches: [{ ...fragments.matches[0], to: 5 }],
  } });
  expect(output).toEqual([]);
  send({ sequence: 1, entry: first, kind: "fragments", fragments });
  send({ sequence: 1, entry: third, kind: "redacted" });
  send({ sequence: 2, entry: first, kind: "redacted" });
  send({ sequence: 3, entry: third, kind: "redacted" });
  expect(output).toHaveLength(1);
  send({ sequence: 2, entry: second, kind: "redacted" });
  send({ sequence: 3, entry: third, kind: "redacted" });
  expect(output).toHaveLength(2);
  const terminal = {
    ok: true as const,
    coverage: [
      { entry: first, hash: "a".repeat(64), bytes: 20, fragments },
      { entry: second, hash: "b".repeat(64), bytes: 0, fragments: { matches: [], more: false } },
    ],
    mappings: [],
  };
  gate.resolve(terminal);
  expect(await pending).toEqual({
    protocolVersion: 1, requestId: request.requestId, op: "query",
    root: request.root, generation: request.generation, ...terminal,
  });
  send({ sequence: 3, entry: third, kind: "redacted" });
  const next = { ...request, ...envelope() };
  const nextPending = rpc.run(next);
  const sendNext = publish;
  if (!sendNext) throw Error("Missing new query observer");
  send({ sequence: 3, entry: third, kind: "redacted" });
  sendNext({ sequence: 1, entry: first, kind: "redacted" });
  expect(await nextPending).toMatchObject({ ok: true, requestId: next.requestId });
  sendNext({ sequence: 2, entry: second, kind: "redacted" });
  expect(output).toEqual([
    { protocolVersion: 1, requestId: request.requestId, sequence: 1, entry: first, kind: "fragments", fragments },
    { protocolVersion: 1, requestId: request.requestId, sequence: 2, entry: second, kind: "redacted" },
    { protocolVersion: 1, requestId: next.requestId, sequence: 1, entry: first, kind: "redacted" },
  ]);
  expect(output.slice(0, 2).every((event) => validContentSearchProgress(event, request))).toBe(true);
  expect(validContentSearchProgress(output[2], next)).toBe(true);
});

test.each(["cancel", "suspend"] as const)(
  "interrupting a streamed mixed query silences progress and waits for drain (%s)",
  async (interruption) => {
    const gate = Promise.withResolvers<ContentSearchCandidates>();
    const request = { ...queryWorkspace(), roots: [], fragments: true as const, stream: true as const };
    const [first, second] = request.standaloneHandles;
    const output: ContentSearchProgress[] = [];
    let signal: AbortSignal | undefined;
    let publish: ((event: ContentSearchFileProgress) => void) | undefined;
    const rpc = createContentSearchRPC({
      searchContentCandidates: () => Promise.resolve({ ok: true, coverage: [], mappings: [] }),
      searchContentCandidatesForWorkspace(_input, abort, onFile) {
        signal = abort;
        publish = onFile;
        return gate.promise;
      },
    }, undefined, (event) => output.push(event));
    rpc.setReady(true);
    const pending = rpc.run(request);
    const send = publish;
    if (!send) throw Error("Missing mixed query progress observer");
    send({ sequence: 1, entry: first, kind: "redacted" });
    expect(output).toHaveLength(1);
    expect(await rpc.run({ ...envelope(), op: "cancel", targetRequestId: id() }))
      .toMatchObject({ error: "STALE" });
    expect(signal?.aborted).toBe(false);
    if (interruption === "cancel") {
      expect(await rpc.run({ ...envelope(), op: "cancel", targetRequestId: request.requestId }))
        .toMatchObject({ ok: true, op: "cancel" });
    } else {
      const resume = rpc.suspend();
      expect(await rpc.run(query())).toMatchObject({ error: "NOT_READY" });
      send({ sequence: 2, entry: second, kind: "redacted" });
      resume();
    }
    expect(signal?.aborted).toBe(true);
    send({ sequence: 2, entry: second, kind: "redacted" });
    expect(output).toHaveLength(1);
    let drained = false;
    const drain = rpc.drain().then(() => { drained = true; });
    expect(await rpc.run(query())).toMatchObject({ error: "BUSY" });
    expect(drained).toBe(false);
    gate.resolve({ ok: false, error: interruption === "cancel" ? "UNKNOWN" : "CANCELLED" });
    expect(await pending).toMatchObject({ error: interruption === "cancel" ? "UNKNOWN" : "CANCELLED" });
    await drain;
    expect(drained).toBe(true);
    expect(await rpc.run(query())).toMatchObject({ ok: true });
  }
);

test("stream replacements retain only the latest admitted snapshot until the active query settles", async () => {
  const firstGate = Promise.withResolvers<ContentSearchCandidates>();
  const lastGate = Promise.withResolvers<ContentSearchCandidates>();
  type ProgressSink = (event: ContentSearchFileProgress) => void;
  const firstStarted = Promise.withResolvers<{ signal: AbortSignal; emit?: ProgressSink }>();
  const lastStarted = Promise.withResolvers<{ signal: AbortSignal; emit?: ProgressSink }>();
  const first = streamQuery();
  const middle = streamWorkspace();
  const last = {
    ...streamWorkspace(), query: "新😀", handles: [id()],
    fileFilters: ["笔记"], pathFilters: [{ kind: "path" as const, value: "小组" }],
  };
  const snapshot = structuredClone(last);
  const calls: string[] = [];
  const output: ContentSearchProgress[] = [];
  const rpc = createContentSearchRPC({
    searchContentCandidates(input, signal, emit) {
      if (!signal) throw Error("Missing active stream abort signal");
      calls.push(input.query);
      firstStarted.resolve({ signal, emit });
      return firstGate.promise;
    },
    searchContentCandidatesForWorkspace(input, signal, emit) {
      if (!signal) throw Error("Missing latest stream abort signal");
      calls.push(input.query);
      expect(input).toMatchObject(snapshot);
      lastStarted.resolve({ signal, emit });
      return lastGate.promise;
    },
    prepareRetainedContentSearchDocument: () => Promise.resolve({ ok: false, error: "STALE" }),
  }, undefined, event => output.push(event));
  rpc.setReady(true);
  const firstResult = rpc.run(first);
  const active = await Promise.race([
    firstStarted.promise, firstResult.then(() => { throw Error("Initial stream settled without entering workspace"); }),
  ]);
  if (!active.emit) throw Error("Missing active stream progress");
  const firstEntry = id();
  active.emit({ sequence: 1, entry: firstEntry, kind: "redacted" });
  expect(await rpc.run(first)).toMatchObject({ error: "BUSY" });
  expect(active.signal.aborted).toBe(false);

  const middleResult = rpc.run(middle);
  expect(active.signal.aborted).toBe(true);
  expect(await rpc.run(middle)).toMatchObject({ error: "BUSY" });
  const lastResult = rpc.run(last);
  expect(await middleResult).toMatchObject({ requestId: middle.requestId, error: "CANCELLED" });
  expect(await rpc.run(cancelQuery(middle.requestId))).toMatchObject({ error: "STALE" });
  expect(await rpc.run(cancelQuery(first.requestId))).toMatchObject({ ok: true, op: "cancel" });
  expect(await rpc.run(query())).toMatchObject({ error: "BUSY" });
  expect(await rpc.run(queryRoots())).toMatchObject({ error: "BUSY" });
  expect(await rpc.prepare(prepareRetained())).toMatchObject({ error: "BUSY" });
  active.emit({ sequence: 2, entry: id(), kind: "redacted" });
  expect(output).toHaveLength(1);
  expect(calls).toEqual([first.query]);

  last.query = "已修改";
  last.roots[0].handle = id();
  last.roots[1].generation++;
  last.standaloneHandles.reverse();
  last.handles[0] = id();
  last.fileFilters[0] = "无关";
  last.pathFilters[0].value = "其他目录";
  let drained = false;
  const drain = rpc.drain().then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);
  firstGate.resolve(emptySearch);
  expect(await firstResult).toMatchObject({ requestId: first.requestId, error: "CANCELLED" });
  const latest = await Promise.race([
    lastStarted.promise, lastResult.then(() => { throw Error("Latest stream settled without entering workspace"); }),
  ]);
  expect(calls).toEqual([first.query, snapshot.query]);
  expect(await rpc.run(cancelQuery(first.requestId))).toMatchObject({ error: "STALE" });
  expect(drained).toBe(false);
  expect(latest.signal.aborted).toBe(false);
  active.emit({ sequence: 2, entry: id(), kind: "redacted" });
  if (!latest.emit) throw Error("Missing latest stream progress");
  const lastEntry = id();
  latest.emit({ sequence: 1, entry: lastEntry, kind: "redacted" });
  const terminal = {
    ok: true as const, coverage: [],
    mappings: [{ handle: snapshot.handles[0], kind: "unresolved" as const }],
  };
  lastGate.resolve(terminal);
  expect(await lastResult).toEqual({
    ...terminal, protocolVersion: 1, requestId: snapshot.requestId, op: "query-workspace",
    roots: snapshot.roots, standaloneHandles: snapshot.standaloneHandles,
  });
  await drain;
  expect(drained).toBe(true);
  latest.emit({ sequence: 2, entry: id(), kind: "redacted" });
  expect(output).toEqual([
    { protocolVersion: 1, requestId: first.requestId, sequence: 1, entry: firstEntry, kind: "redacted" },
    { protocolVersion: 1, requestId: snapshot.requestId, sequence: 1, entry: lastEntry, kind: "redacted" },
  ]);
});

test("a queued stream can be cancelled by its own ID while the retired stream drains", async () => {
  const gate = Promise.withResolvers<ContentSearchCandidates>();
  const first = streamWorkspace();
  const queued = streamQuery();
  let started = 0;
  const rpc = createContentSearchRPC({
    searchContentCandidates() { started++; return Promise.resolve(emptySearch); },
    searchContentCandidatesForWorkspace: () => gate.promise,
  });
  rpc.setReady(true);
  const active = rpc.run(first);
  const pending = rpc.run(queued);
  expect(await rpc.run(cancelQuery(id()))).toMatchObject({ error: "STALE" });
  expect(await rpc.run(cancelQuery(queued.requestId))).toMatchObject({ ok: true, op: "cancel" });
  expect(await pending).toMatchObject({ requestId: queued.requestId, error: "CANCELLED" });
  expect(await rpc.run(cancelQuery(queued.requestId))).toMatchObject({ error: "STALE" });
  expect(await rpc.run(query())).toMatchObject({ error: "BUSY" });
  expect(started).toBe(0);
  gate.resolve(emptySearch);
  expect(await active).toMatchObject({ requestId: first.requestId, error: "CANCELLED" });
  await rpc.drain();
  expect(started).toBe(0);
});

test.each(["suspend", "setReady"] as const)("window transition retires both stream slots and preserves drain (%s)", async transition => {
  const gate = Promise.withResolvers<ContentSearchCandidates>();
  let calls = 0;
  const rpc = createContentSearchRPC({
    searchContentCandidates() { return ++calls === 1 ? gate.promise : Promise.resolve(emptySearch); },
  });
  rpc.setReady(true);
  const active = rpc.run(streamQuery());
  const pending = rpc.run(streamQuery());
  let resume = () => rpc.setReady(true);
  if (transition === "suspend") resume = rpc.suspend();
  else rpc.setReady(false);
  expect(await pending).toMatchObject({ error: "CANCELLED" });
  expect(await rpc.run(streamQuery())).toMatchObject({ error: "NOT_READY" });
  let drained = false;
  const drain = rpc.drain().then(() => { drained = true; });
  resume();
  expect(await rpc.run(query())).toMatchObject({ error: "BUSY" });
  expect(drained).toBe(false);
  expect(calls).toBe(1);
  gate.resolve(emptySearch);
  expect(await active).toMatchObject({ error: "CANCELLED" });
  await drain;
  expect(drained).toBe(true);
  expect(calls).toBe(1);
  expect(await rpc.run(streamQuery())).toMatchObject({ ok: true });
  expect(calls).toBe(2);
});

test("uncertain active stream rejects the queued replacement without starting it", async () => {
  const gate = Promise.withResolvers<ContentSearchCandidates>();
  let calls = 0;
  const rpc = createContentSearchRPC({
    searchContentCandidates() { return ++calls === 1 ? gate.promise : Promise.resolve(emptySearch); },
  });
  rpc.setReady(true);
  const first = streamQuery();
  const queued = streamQuery();
  const active = rpc.run(first);
  const pending = rpc.run(queued);
  expect(calls).toBe(1);
  gate.resolve({ ok: false, error: "UNKNOWN" });
  expect(await active).toMatchObject({ requestId: first.requestId, error: "UNKNOWN" });
  expect(await pending).toMatchObject({ requestId: queued.requestId, error: "UNAVAILABLE" });
  await rpc.drain();
  expect(calls).toBe(1);
});

test("stream requests cannot replace an active nonstream query or a prepare operation", async () => {
  const queryGate = Promise.withResolvers<ContentSearchCandidates>();
  const prepareGate = Promise.withResolvers<ContentSearchRetainedPrepared>();
  let signal: AbortSignal | undefined;
  let calls = 0;
  const rpc = createContentSearchRPC({
    searchContentCandidates(_input, abort) { signal = abort; calls++; return queryGate.promise; },
    prepareRetainedContentSearchDocument(_input, _requestId, abort) { signal = abort; return prepareGate.promise; },
  });
  rpc.setReady(true);
  const nonstream = rpc.run(query());
  expect(await rpc.run(streamQuery())).toMatchObject({ error: "BUSY" });
  expect(signal?.aborted).toBe(false);
  queryGate.resolve(emptySearch);
  expect(await nonstream).toMatchObject({ ok: true });
  const prepare = rpc.prepare(prepareRetained());
  expect(await rpc.run(streamQuery())).toMatchObject({ error: "BUSY" });
  expect(signal?.aborted).toBe(false);
  prepareGate.resolve({ ok: false, error: "STALE" });
  expect(await prepare).toMatchObject({ error: "STALE" });
  expect(calls).toBe(1);
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
