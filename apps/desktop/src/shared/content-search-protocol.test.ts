import { expect, test } from "bun:test";

import {
  CONTENT_SEARCH_LIMITS,
  validContentSearchRequest,
  validContentSearchResponse,
  type ContentSearchRequest,
} from "./content-search";

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
