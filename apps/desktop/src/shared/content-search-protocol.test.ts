import { expect, test } from "bun:test";

import {
  CONTENT_SEARCH_LIMITS,
  validContentSearchPrepareRequest,
  validContentSearchPrepareResponse,
  validContentSearchRequest,
  validContentSearchResponse,
  type ContentSearchRequest,
} from "./content-search";
import { analyzeTextFidelity } from "./text-fidelity";

function queryRoots(): Extract<ContentSearchRequest, { op: "query-roots" }> {
  return {
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    op: "query-roots",
    roots: [
      { handle: crypto.randomUUID(), generation: 4 },
      { handle: crypto.randomUUID(), generation: 7 },
    ],
    query: "😀",
    handles: [crypto.randomUUID()],
    fileFilters: ["纪要"],
    pathFilters: [{ kind: "-path", value: "草稿/" }],
  };
}

test("multi-root query wire requires a bounded dense list of exact root versions", () => {
  const request = queryRoots();
  const [first, second] = request.roots;
  expect(validContentSearchRequest(request)).toBe(true);
  expect(validContentSearchRequest({ ...request, roots: [first] })).toBe(true);
  const max = Array.from({ length: CONTENT_SEARCH_LIMITS.roots }, () => ({
    handle: crypto.randomUUID(), generation: 0,
  }));
  expect(validContentSearchRequest({ ...request, roots: max })).toBe(true);
  const sparse = [first];
  sparse.length = 2;
  for (const roots of [
    undefined, [], [...max, first], [first, { ...first, generation: 8 }],
    [first, { ...second, generation: -1 }], [{ ...first, generation: 1.5 }],
    [{ ...first, generation: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...first, handle: "/tmp/workspace" }], [{ ...first, path: "/tmp/workspace" }],
    [{ ...first, alias: "笔记" }], sparse, Object.assign([first], { extra: true }),
  ]) {
    expect(validContentSearchRequest({ ...request, roots })).toBe(false);
  }
  for (const extra of [
    { root: first.handle }, { generation: first.generation }, { path: "/tmp/workspace" },
    { rootAlias: "笔记" }, { raw: "未保存正文" },
  ]) {
    expect(validContentSearchRequest({ ...request, ...extra })).toBe(false);
  }
});

test("multi-root response must echo the same ordered scope and valid aggregate evidence", () => {
  const request = queryRoots();
  const [first, second] = request.roots;
  const entry = crypto.randomUUID();
  const hash = "b".repeat(64);
  const response = {
    protocolVersion: 1,
    requestId: request.requestId,
    ok: true,
    op: "query-roots",
    roots: request.roots.map((root) => ({ ...root })),
    coverage: [{ entry, hash, bytes: 12, hit: { from: 2, to: 4 } }],
    mappings: [{
      handle: request.handles[0], kind: "matched", entry,
      documentId: crypto.randomUUID(), revision: 2, hash,
    }],
  };
  expect(validContentSearchResponse(response, request)).toBe(true);
  for (const roots of [
    undefined, [second, first], [first], [first, { ...second, generation: 8 }],
    [first, { ...second, handle: crypto.randomUUID() }],
    [first, { ...second, path: "/tmp/workspace" }],
  ]) {
    expect(validContentSearchResponse({ ...response, roots }, request)).toBe(false);
  }
  const row = response.coverage[0];
  for (const change of [
    { op: "query" }, { root: first.handle }, { coverage: [row, row] },
    { coverage: [{ ...row, bytes: CONTENT_SEARCH_LIMITS.bytes + 1 }] },
    { coverage: [{ ...row, hit: { from: 2, to: 3 } }] },
    { mappings: [] }, { mappings: [{ ...response.mappings[0], entry: crypto.randomUUID() }] },
  ]) {
    expect(validContentSearchResponse({ ...response, ...change }, request)).toBe(false);
  }
});

function queryWorkspace() {
  return {
    ...queryRoots(),
    op: "query-workspace" as const,
    standaloneHandles: [crypto.randomUUID(), crypto.randomUUID()],
  };
}

test("mixed query wire requires complete dense roots and opaque retained handles", () => {
  const request = queryWorkspace();
  const [first, second] = request.standaloneHandles;
  expect(validContentSearchRequest(request)).toBe(true);
  expect(validContentSearchRequest({ ...request, roots: [] })).toBe(true);
  expect(validContentSearchRequest({ ...request, standaloneHandles: [] })).toBe(true);
  expect(validContentSearchRequest({ ...request, roots: [], standaloneHandles: [] })).toBe(false);
  const limit = Array.from({ length: CONTENT_SEARCH_LIMITS.documents }, () => crypto.randomUUID());
  expect(validContentSearchRequest({ ...request, standaloneHandles: limit })).toBe(true);
  const sparse = [first];
  sparse.length = 2;
  for (const standaloneHandles of [
    undefined, [first, first], [...limit, first], ["/outside.md"],
    [{ handle: second }], sparse, Object.assign([first], { extra: true }),
  ]) {
    expect(validContentSearchRequest({ ...request, standaloneHandles })).toBe(false);
  }
  for (const roots of [
    undefined, Object.assign([], { extra: true }), [request.roots[0], request.roots[0]],
    [{ ...request.roots[0], generation: -1 }], [{ ...request.roots[0], path: "/outside" }],
  ]) {
    expect(validContentSearchRequest({ ...request, roots })).toBe(false);
  }
  for (const extra of [
    { root: request.roots[0].handle }, { generation: 4 },
    { rootAlias: "笔记" }, { raw: "未保存正文" }, { path: "/outside" },
  ]) {
    expect(validContentSearchRequest({ ...request, ...extra })).toBe(false);
  }
  expect(validContentSearchRequest({ ...queryRoots(), standaloneHandles: [] })).toBe(false);
});

test("mixed response echoes both scope lists and rejects cross-operation or partial evidence", () => {
  const request = queryWorkspace();
  const [first, second] = request.standaloneHandles;
  const [root1, root2] = request.roots;
  const entry = first;
  const hash = "c".repeat(64);
  const response = {
    protocolVersion: 1,
    requestId: request.requestId,
    ok: true,
    op: "query-workspace",
    roots: [root1, root2],
    standaloneHandles: [first, second],
    coverage: [{ entry, hash, bytes: 4, hit: { from: 0, to: 2 } }],
    mappings: [{
      handle: request.handles[0], kind: "matched", entry, documentId: crypto.randomUUID(), revision: 1, hash,
    }],
  };
  expect(validContentSearchResponse(response, request)).toBe(true);
  const rootless = { ...request, roots: [] };
  expect(validContentSearchResponse({ ...response, roots: [] }, rootless)).toBe(true);
  for (const change of [
    { roots: [root2, root1] }, { roots: [{ ...root1, generation: root1.generation + 1 }, root2] },
    { standaloneHandles: [second, first] }, { standaloneHandles: [first] },
    { standaloneHandles: [first, first] }, { standaloneHandles: [first, crypto.randomUUID()] },
    { op: "query-roots" }, { op: "query" }, { op: "cancel" }, { path: "/outside.md" },
    { coverage: [] }, { mappings: [] },
    { coverage: [{ ...response.coverage[0], bytes: CONTENT_SEARCH_LIMITS.bytes + 1 }] },
  ]) {
    expect(validContentSearchResponse({ ...response, ...change }, request)).toBe(false);
  }
});

test("retained prepare wire distinguishes original handles from directory open receipts", () => {
  const request = {
    protocolVersion: 1 as const,
    requestId: crypto.randomUUID(),
    op: "prepare-retained" as const,
    roots: [] as const,
    entry: crypto.randomUUID(),
    expectedHash: "d".repeat(64),
  };
  const binding = {
    handle: request.entry, documentId: crypto.randomUUID(), revision: 1, hash: request.expectedHash,
  };
  expect(validContentSearchPrepareRequest(request)).toBe(true);
  expect(validContentSearchPrepareRequest({ ...request, binding })).toBe(true);
  expect(validContentSearchPrepareRequest({ ...request, roots: queryRoots().roots })).toBe(true);
  for (const change of [
    { op: undefined }, { op: "query-workspace" }, { roots: undefined },
    { roots: Object.assign([], { extra: true }) },
    { roots: [queryRoots().roots[0], { handle: "/tmp/scope", generation: 1 }] },
    { root: crypto.randomUUID() }, { generation: 0 }, { path: "/tmp/file.md" },
    { standaloneHandles: [request.entry] }, { raw: "untrusted" },
    { binding: undefined }, { binding: { ...binding, handle: crypto.randomUUID() } },
    { binding: { ...binding, hash: "e".repeat(64) } },
  ]) {
    expect(validContentSearchPrepareRequest({ ...request, ...change })).toBe(false);
  }

  const text = "\uFEFF😀\r\n正文";
  const snapshot = {
    ...binding,
    explicitStandalone: true,
    locationId: crypto.randomUUID(),
    fileName: "retained.md",
    byteLength: Buffer.byteLength(text),
    text,
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: true, reason: "writable" },
  };
  const response = {
    protocolVersion: 1,
    requestId: request.requestId,
    ok: true,
    target: { kind: "retained", snapshot },
  };
  expect(validContentSearchPrepareResponse(response, request)).toBe(true);
  expect(validContentSearchPrepareResponse({ ...response, op: request.op }, request)).toBe(false);
  for (const change of [
    { explicitStandalone: false }, { explicitStandalone: undefined },
    { handle: crypto.randomUUID() }, { documentId: "bad" }, { hash: "e".repeat(64) },
    { locationId: "bad" }, { byteLength: CONTENT_SEARCH_LIMITS.bytes + 1 },
  ]) {
    expect(validContentSearchPrepareResponse({
      ...response, target: { kind: "retained", snapshot: { ...snapshot, ...change } },
    }, request)).toBe(false);
  }
  expect(validContentSearchPrepareResponse({ ...response, target: { kind: "open", snapshot } }, request))
    .toBe(false);
  const reuse = { ...response, target: { kind: "reuse", ...binding } };
  expect(validContentSearchPrepareResponse(reuse, request)).toBe(false);
  expect(validContentSearchPrepareResponse(reuse, { ...request, binding })).toBe(true);
  expect(validContentSearchPrepareResponse({ ...reuse, target: { ...reuse.target, revision: 2 } }, { ...request, binding }))
    .toBe(false);
  expect(validContentSearchPrepareResponse(response, { ...request, binding })).toBe(false);

  const old = {
    protocolVersion: 1 as const, requestId: request.requestId, root: crypto.randomUUID(),
    generation: 1, entry: crypto.randomUUID(), expectedHash: request.expectedHash,
  };
  expect(validContentSearchPrepareRequest(old)).toBe(true);
  expect(validContentSearchPrepareResponse({ ...response, target: { kind: "open", snapshot } }, old)).toBe(true);
  expect(validContentSearchPrepareResponse(response, old)).toBe(false);
});
