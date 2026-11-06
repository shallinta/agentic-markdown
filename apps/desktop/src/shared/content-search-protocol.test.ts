import { expect, test } from "bun:test";

import {
  CONTENT_SEARCH_LIMITS,
  validContentSearchPrepareRequest,
  validContentSearchPrepareResponse,
  validContentSearchProgress,
  validContentSearchRequest,
  validContentSearchResponse,
  type ContentSearchRequest,
} from "./content-search";
import { contentSearchFragments } from "./content-search-fragments";
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

test("fragments preserve raw BOM and CRLF offsets, exclude overlaps and cap context safely", () => {
  expect(contentSearchFragments("\uFEFFa\r\n😀aa😀aa😀aa😀aa", "😀aa")).toEqual({
    matches: [
      { from: 4, to: 8, before: "\uFEFFa\r\n", after: "😀aa😀aa😀aa" },
      { from: 8, to: 12, before: "\uFEFFa\r\n😀aa", after: "😀aa😀aa" },
      { from: 12, to: 16, before: "\uFEFFa\r\n😀aa😀aa", after: "😀aa" },
    ],
    more: true,
  });
  expect(contentSearchFragments("aaaaaaa", "aa").matches.map(({ from, to }) => [from, to]))
    .toEqual([[0, 2], [2, 4], [4, 6]]);
  const middle = "x".repeat(31);
  expect(contentSearchFragments(`😀${middle}hit${middle}😀`, "hit")).toEqual({
    matches: [{ from: 33, to: 36, before: middle, after: middle }], more: false,
  });
  for (const query of ["", "absent", "\uD83D"])
    expect(contentSearchFragments("😀", query)).toEqual({ matches: [], more: false });
});

test("fragments wire requires explicit opt-in and exact bounded evidence per covered document", () => {
  const legacy = { ...queryWorkspace(), roots: [], handles: [], query: "aa" };
  const request = { ...legacy, fragments: true as const };
  expect(validContentSearchRequest(request)).toBe(true);
  for (const fragments of [false, undefined, 1, "true"])
    expect(validContentSearchRequest({ ...legacy, fragments })).toBe(false);
  expect(validContentSearchRequest({ ...queryRoots(), fragments: true })).toBe(false);
  const raw = "😀aaaaaa\r\naa";
  const row = {
    entry: request.standaloneHandles[0], hash: "c".repeat(64),
    bytes: Buffer.byteLength(raw), fragments: contentSearchFragments(raw, request.query),
  };
  const { protocolVersion, requestId, op, roots, standaloneHandles } = request;
  const response = {
    protocolVersion, requestId, op, roots, standaloneHandles, ok: true,
    coverage: [row], mappings: [],
  };
  expect(validContentSearchResponse(response, request)).toBe(true);
  expect(validContentSearchResponse(response, legacy)).toBe(false);
  const { fragments, ...evidence } = row;
  expect(validContentSearchResponse({ ...response, coverage: [
    { ...evidence, fragments: { matches: [], more: false } },
  ] }, request)).toBe(true);
  const [first, second, third] = fragments.matches;
  const sparse = [first];
  sparse.length = 3;
  for (const forged of [
    evidence,
    { ...evidence, hit: { from: 2, to: 4 } },
    { ...row, hit: { from: 2, to: 4 } },
    { ...row, entry: crypto.randomUUID() },
    { ...row, fragments: { ...fragments, raw } },
    { ...row, fragments: { matches: fragments.matches.slice(0, 2), more: true } },
    { ...row, fragments: { ...fragments, matches: [...fragments.matches, fragments.matches[0]] } },
    { ...row, fragments: { ...fragments, matches: sparse } },
  ]) {
    expect(validContentSearchResponse({ ...response, coverage: [forged] }, request)).toBe(false);
  }
  for (const change of [
    { from: second.from - 1, to: second.to - 1 },
    { to: second.to - 1 },
    { before: "\uD83D" }, { after: "\uDE00" },
    { after: "x".repeat(33) }, { before: "x".repeat(second.from + 1) },
    { after: "x".repeat(row.bytes - second.to + 1) }, { raw },
  ]) {
    const bad = { ...row, fragments: { ...fragments, matches: [first, { ...second, ...change }, third] } };
    expect(validContentSearchResponse({ ...response, coverage: [bad] }, request)).toBe(false);
  }
});

test("streaming is opt-in only on bounded fragment queries and does not change terminal response", () => {
  const mixed = { ...queryWorkspace(), roots: [], handles: [], query: "aa" };
  const single = {
    protocolVersion: 1 as const, requestId: crypto.randomUUID(), op: "query" as const,
    root: crypto.randomUUID(), generation: 3, query: "aa", handles: [],
  };
  for (const legacy of [single, mixed]) {
    expect(validContentSearchRequest(legacy)).toBe(true);
    expect(validContentSearchRequest({ ...legacy, stream: true })).toBe(false);
    const fragments = { ...legacy, fragments: true as const };
    const stream = { ...fragments, stream: true as const };
    expect(validContentSearchRequest(stream)).toBe(true);
    for (const value of [false, undefined, 1, "true"])
      expect(validContentSearchRequest({ ...fragments, stream: value })).toBe(false);
    const { protocolVersion, requestId, op } = stream;
    const terminal = {
      protocolVersion, requestId, op, ok: true, coverage: [], mappings: [],
      ...(legacy.op === "query"
        ? { root: legacy.root, generation: legacy.generation }
        : { roots: legacy.roots, standaloneHandles: legacy.standaloneHandles }),
    };
    expect(validContentSearchResponse(terminal, stream)).toBe(true);
    expect(validContentSearchResponse({ ...terminal, stream: true }, stream)).toBe(false);
  }
  expect(validContentSearchRequest({ ...queryRoots(), stream: true, fragments: true })).toBe(false);
  expect(validContentSearchRequest({ ...mixed, standaloneHandles: [], fragments: true, stream: true })).toBe(false);
});

test("progress wire accepts only bounded same-request redaction or exact fragments", () => {
  const request = {
    ...queryWorkspace(), roots: [], handles: [], query: "aa", fragments: true as const, stream: true as const,
  };
  const redacted = {
    protocolVersion: 1, requestId: request.requestId, sequence: 1,
    entry: request.standaloneHandles[0], kind: "redacted",
  };
  const fragments = contentSearchFragments("😀aaaaaa\r\naa", request.query);
  const progress = { ...redacted, kind: "fragments", fragments };
  expect(validContentSearchProgress(redacted, request)).toBe(true);
  expect(validContentSearchProgress(progress, request)).toBe(true);
  expect(validContentSearchProgress({
    ...progress, sequence: CONTENT_SEARCH_LIMITS.documents,
    fragments: { matches: [], more: false },
  }, request)).toBe(true);
  const { stream, ...nonStreaming } = request;
  expect(stream).toBe(true);
  expect(validContentSearchProgress(progress, nonStreaming)).toBe(false);
  expect(validContentSearchProgress(progress, { ...request, requestId: crypto.randomUUID() })).toBe(false);
  for (const sequence of [0, -1, 1.5, CONTENT_SEARCH_LIMITS.documents + 1, Number.NaN])
    expect(validContentSearchProgress({ ...progress, sequence }, request)).toBe(false);
  for (const malformed of [
    { ...progress, protocolVersion: 2 }, { ...progress, entry: "/outside" },
    { ...progress, entry: crypto.randomUUID() },
    { ...progress, kind: "unrecognized" }, { ...redacted, fragments },
    { ...redacted, bytes: 4 }, { ...progress, path: "/outside" }, { ...progress, hash: "a".repeat(64) },
    { ...progress, fragments: { ...fragments, raw: "uncapped" } },
    { ...progress, fragments: { matches: fragments.matches.slice(0, 2), more: true } },
    { ...progress, fragments: { matches: [fragments.matches[0], fragments.matches[0]], more: false } },
    { ...progress, fragments: { matches: [{ ...fragments.matches[0], before: "\ud800" }], more: false } },
    { ...progress, fragments: { matches: [{ ...fragments.matches[0], after: "x".repeat(33) }], more: false } },
  ]) expect(validContentSearchProgress(malformed, request)).toBe(false);
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
  const anchored = { ...request, roots: [queryRoots().roots[0]], rootEntry: crypto.randomUUID() };
  expect(validContentSearchPrepareRequest(anchored)).toBe(true);
  expect(validContentSearchPrepareResponse(response, anchored)).toBe(true);
  const scoped = { ...response, target: {
    kind: "retained", snapshot: { ...snapshot, explicitStandalone: false },
  } };
  expect(validContentSearchPrepareResponse(scoped, anchored)).toBe(true);
  expect(validContentSearchPrepareResponse(scoped, request)).toBe(false);
  expect(validContentSearchPrepareResponse({ ...scoped, target: {
    ...scoped.target, snapshot: { ...scoped.target.snapshot, explicitStandalone: undefined },
  } }, anchored)).toBe(false);
  expect(validContentSearchPrepareRequest({ ...anchored, roots: [] })).toBe(false);
  expect(validContentSearchPrepareRequest({ ...anchored, roots: queryRoots().roots })).toBe(false);
  expect(validContentSearchPrepareRequest({ ...anchored, rootEntry: "/tmp/file.md" })).toBe(false);
  expect(validContentSearchPrepareRequest({ ...anchored, binding })).toBe(false);

  const old = {
    protocolVersion: 1 as const, requestId: request.requestId, root: crypto.randomUUID(),
    generation: 1, entry: crypto.randomUUID(), expectedHash: request.expectedHash,
  };
  expect(validContentSearchPrepareRequest(old)).toBe(true);
  expect(validContentSearchPrepareResponse({ ...response, target: { kind: "open", snapshot } }, old)).toBe(true);
  expect(validContentSearchPrepareResponse(response, old)).toBe(false);
});
