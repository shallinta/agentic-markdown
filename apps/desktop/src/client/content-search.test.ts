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
