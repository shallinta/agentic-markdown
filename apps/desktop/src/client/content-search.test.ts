import { expect, test } from "bun:test";

import type { SearchMapping } from "../shared/content-search";
import type { DocumentRequest, DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import {
  mergeContentSearch,
  type ContentSearchDocument,
} from "./content-search";
import { createDocumentController } from "./documents";

const hash = "a".repeat(64);
const document = {
  handle: "opened",
  documentId: "document",
  revision: 2,
  bufferRevision: 1,
  hash,
};
const mapping: SearchMapping = {
  handle: document.handle,
  kind: "matched",
  entry: "matched",
  documentId: document.documentId,
  revision: document.revision,
  hash,
};

test("dirty raw text replaces disk hits and can match a disk-zero entry", () => {
  const query = "😀中文";
  const dirty = (raw: string): ContentSearchDocument => ({
    ...document,
    status: "dirty",
    raw,
  });
  expect(
    mergeContentSearch(query, [dirty("删除了命中")], {
      coverage: [
        { entry: "matched", hash, bytes: 32, hit: { from: 1, to: 5 } },
        { entry: "disk", hash, bytes: 32, hit: { from: 2, to: 6 } },
      ],
      mappings: [mapping],
    })
  ).toEqual({
    ok: true,
    covered: 2,
    hits: [{ entry: "disk", from: 2, to: 6, source: "disk" }],
  });
  expect(
    mergeContentSearch(query, [dirty("\uFEFFa\r\n😀中文")], {
      coverage: [{ entry: "matched", hash, bytes: 12 }],
      mappings: [mapping],
    })
  ).toEqual({
    ok: true,
    covered: 1,
    hits: [{ entry: "matched", from: 4, to: 8, source: "memory" }],
  });
});

test("fragment mode replaces every disk match, context, and overflow flag with dirty evidence", () => {
  const query = "😀中文";
  const disk = {
    matches: [
      { from: 0, to: 4, before: "", after: "disk context" },
      { from: 5, to: 9, before: "disk context", after: "disk context" },
      { from: 10, to: 14, before: "disk context", after: "" },
    ],
    more: true,
  };
  const sibling = {
    matches: [{ from: 2, to: 6, before: "另 ", after: "磁盘正文" }],
    more: false,
  };
  const evidence = {
    coverage: [
      { entry: "matched", hash, bytes: 32, fragments: disk },
      { entry: "sibling", hash, bytes: 32, fragments: sibling },
    ],
    mappings: [mapping],
  };
  const dirty = (raw: string): ContentSearchDocument => ({ ...document, status: "dirty", raw });
  expect(mergeContentSearch(query, [dirty("\uFEFFa\r\n😀中文/<x>😀中文")], evidence, true))
    .toEqual({
      ok: true,
      covered: 2,
      groups: [
        {
          entry: "matched", source: "memory", more: false,
          matches: [
            { from: 4, to: 8, before: "\uFEFFa\r\n", after: "/<x>😀中文" },
            { from: 12, to: 16, before: "\uFEFFa\r\n😀中文/<x>", after: "" },
          ],
        },
        { entry: "sibling", source: "disk", ...sibling },
      ],
    });
  expect(mergeContentSearch(query, [dirty("")], evidence, true))
    .toEqual({ ok: true, covered: 2, groups: [{ entry: "sibling", source: "disk", ...sibling }] });
  expect(mergeContentSearch(query, [dirty(query.repeat(4))], {
    ...evidence,
    coverage: [{ ...evidence.coverage[0], fragments: { matches: [], more: false } }],
  }, true)).toMatchObject({
    ok: true,
    covered: 1,
    groups: [{
      entry: "matched", source: "memory", more: true,
      matches: [{ from: 0, to: 4 }, { from: 4, to: 8 }, { from: 8, to: 12 }],
    }],
  });
});

test("fragment mode refuses legacy shapes and applies the same disk and dirty limits", () => {
  const dirty: ContentSearchDocument = { ...document, status: "dirty", raw: "😀😀" };
  const fragments = { matches: [], more: false };
  const legacy = { entry: "matched", hash, bytes: 1, hit: { from: 0, to: 2 } };
  for (const coverage of [[legacy], [legacy, { entry: "disk", hash, bytes: 1, fragments }]]) {
    expect(mergeContentSearch("😀", [dirty], { coverage, mappings: [mapping] }, true))
      .toEqual({ ok: false, reason: "incomplete" });
  }
  const evidence = {
    coverage: [
      { entry: "matched", hash, bytes: 1, fragments },
      { entry: "disk", hash, bytes: 65_530, fragments },
    ],
    mappings: [mapping],
  };
  expect(mergeContentSearch("😀", [dirty], evidence, true)).toEqual({ ok: false, reason: "limit" });
  expect(mergeContentSearch("😀", [dirty], {
    ...evidence,
    coverage: [{ ...evidence.coverage[0], hash: "b".repeat(64) }],
  }, true)).toEqual({ ok: false, reason: "incomplete" });
});

test("unresolved, risky or different disk baselines cannot yield complete hits", () => {
  const risky = { ...document, status: "risky" as const };
  const clean = { ...document, status: "clean" as const };
  const coverage = [{ entry: "matched", hash, bytes: 12 }];
  const incomplete = { ok: false, reason: "incomplete" } as const;
  expect(
    mergeContentSearch("x", [risky], { coverage, mappings: [mapping] })
  ).toEqual(incomplete);
  expect(mergeContentSearch("x", [clean], { coverage, mappings: [] })).toEqual(
    incomplete
  );
  expect(
    mergeContentSearch("x", [clean], {
      coverage,
      mappings: [{ handle: document.handle, kind: "unresolved" }],
    })
  ).toEqual(incomplete);
  expect(
    mergeContentSearch("x", [clean], {
      coverage: [{ ...coverage[0], hash: "b".repeat(64) }],
      mappings: [mapping],
    })
  ).toEqual(incomplete);
  expect(
    mergeContentSearch("x", [risky], {
      coverage,
      mappings: [{ handle: document.handle, kind: "outside" }],
    })
  ).toEqual({ ok: true, covered: 1, hits: [] });
});

test("memory overrides count UTF-8 bytes and reject invalid Unicode", () => {
  const evidence = {
    coverage: [
      { entry: "matched", hash, bytes: 1 },
      { entry: "other", hash, bytes: 65_530 },
    ],
    mappings: [mapping],
  };
  expect(
    mergeContentSearch(
      "😀",
      [{ ...document, status: "dirty", raw: "😀😀" }],
      evidence
    )
  ).toEqual({ ok: false, reason: "limit" });
  expect(
    mergeContentSearch(
      "😀",
      [{ ...document, status: "dirty", raw: "\ud800" }],
      evidence
    )
  ).toEqual({ ok: false, reason: "incomplete" });
});

test("a document outside the filtered scope cannot contribute a memory hit", () => {
  const dirty: ContentSearchDocument = {
    ...document,
    status: "dirty",
    raw: "筛选命中".repeat(20_000),
  };
  const coverage = [
    { entry: "included", hash, bytes: 12, hit: { from: 0, to: 4 } },
  ];
  expect(
    mergeContentSearch("筛选命中", [dirty], {
      coverage,
      mappings: [{ handle: document.handle, kind: "outside" }],
    })
  ).toEqual({
    ok: true,
    covered: 1,
    hits: [{ entry: "included", from: 0, to: 4, source: "disk" }],
  });
});

function fixture(): DocumentSnapshot {
  return {
    handle: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    fileName: "sample.md",
    revision: 1,
    hash,
    byteLength: 4,
    text: "text",
    fidelity: analyzeTextFidelity("text"),
    writeCapability: { writable: true, reason: "writable" },
  };
}

test("all tabs are captured and publication invalidates an older capture before edit and undo can restore it", async () => {
  const a = fixture();
  const b = fixture();
  const files = [a, b];
  const success = (request: DocumentRequest) =>
    Promise.resolve({ ...request, ok: true, snapshot: null });
  const documents = createDocumentController({
    cancelDocument: success,
    releaseDocument: success,
    readDocument: success,
    selectDocument: (request) =>
      Promise.resolve({
        ...request,
        ok: true,
        snapshot: files.shift() ?? null,
      }),
  });
  try {
    await documents.select();
    await documents.select();
    const capture = documents.captureContentSearch();
    if (!capture.ok) throw Error("Missing search capture");
    expect(capture.documents.map((entry) => entry.documentId)).toEqual([
      a.documentId,
      b.documentId,
    ]);
    documents.notifyInteraction();
    expect(capture.current()).toBe(true);
    const seen: boolean[] = [];
    const unsubscribe = documents.subscribe(() => seen.push(capture.current()));
    const { state } = documents.getEditor(b.documentId)!;
    expect(
      documents.updateEditor(
        b.documentId,
        state.update({
          changes: { from: 0, to: 4, insert: "modified" },
        })
      )
    ).toBe(true);
    expect(documents.runHistory("undo", b.documentId)).toBe(true);
    unsubscribe();
    expect(seen).toEqual([false, false]);
    expect(capture.current()).toBe(false);

    const restored = documents.captureContentSearch();
    if (!restored.ok) throw Error("Missing restored search capture");
    expect(restored.documents.map((entry) => entry.status)).toEqual([
      "clean",
      "clean",
    ]);
    documents.markTrashUncertain([{ documentId: a.documentId }]);
    expect(restored.current()).toBe(false);
    const risky = documents.captureContentSearch();
    if (!risky.ok) throw Error("Missing risky search capture");
    expect(risky.documents.map((entry) => entry.status)).toEqual([
      "risky",
      "clean",
    ]);
  } finally {
    documents.dispose();
  }
});
