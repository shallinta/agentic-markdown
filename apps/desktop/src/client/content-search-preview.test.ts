import { expect, test } from "bun:test";

import type { ContentSearchRequest } from "../shared/content-search";

import { createContentSearchPreview } from "./content-search-preview";

function fixture() {
  const request = {
    protocolVersion: 1, requestId: crypto.randomUUID(), op: "query",
    root: crypto.randomUUID(), generation: 1, query: "x", handles: [],
    fragments: true, stream: true,
  } satisfies ContentSearchRequest;
  const [first, second, third, fourth] = Array.from({ length: 4 }, () => crypto.randomUUID());
  const files = new Map([
    [first, { displayPath: "/root/first.md" }],
    [second, { displayPath: "/root/second.md" }],
    [third, { displayPath: "/root/third.md" }],
    [fourth, { displayPath: "/root/fourth.md" }],
  ]);
  const redacted = (sequence: number, entry: string) => ({
    protocolVersion: 1, requestId: request.requestId, kind: "redacted", entry, sequence,
  });
  const progress = (sequence: number, entry: string) => ({
    ...redacted(sequence, entry),
    kind: "fragments",
    fragments: { matches: [{ from: 1, to: 2, before: "a", after: "b" }], more: false },
  });
  return { request, files, first, second, third, fourth, progress, redacted };
}

test("counts all valid files and lists only matched closed files in stream order", () => {
  const { request, files, first, second, third, fourth, progress, redacted } = fixture();
  const preview = createContentSearchPreview(request, files, ["/root/first.md"]);
  expect(preview.accept(progress(1, first))).toEqual({
    kind: "update", snapshot: { processed: 1, groups: [] },
  });
  expect(preview.accept(redacted(2, second))).toEqual({
    kind: "update", snapshot: { processed: 2, groups: [] },
  });
  expect(preview.accept({ ...progress(3, third), fragments: { matches: [], more: false } })).toEqual({
    kind: "update", snapshot: { processed: 3, groups: [] },
  });
  const result = preview.accept(progress(4, fourth));
  expect(result).toEqual({
    kind: "update", snapshot: { processed: 4, groups: [{ entry: fourth, fragments: progress(4, fourth).fragments }] },
  });
  for (const unknown of [undefined, "", "../unknown.md", "/root/../unknown.md"]) {
    const unavailable = createContentSearchPreview(request, files, [unknown]);
    expect(unavailable.accept(progress(1, fourth))).toEqual({
      kind: "update", snapshot: { processed: 1, groups: [] },
    });
  }
});

test("ignores unrelated requests and permanently discards malformed, duplicate, skipped or out-of-scope current events", () => {
  const { request, files, first, second, progress } = fixture();
  for (const invalid of [
    progress(2, first),
    progress(1, crypto.randomUUID()),
    { ...progress(1, first), path: "/outside.md" },
    { ...progress(1, first), protocolVersion: 2 },
  ]) {
    const preview = createContentSearchPreview(request, files, []);
    expect(preview.accept({ ...invalid, requestId: crypto.randomUUID() })).toEqual({ kind: "ignored" });
    expect(preview.accept(invalid)).toEqual({ kind: "discard" });
    expect(preview.accept(progress(1, first))).toEqual({ kind: "ignored" });
  }
  const fresh = createContentSearchPreview(request, files, []);
  expect(fresh.accept(progress(1, first))).toMatchObject({ kind: "update" });
  expect(fresh.accept(progress(2, first))).toEqual({ kind: "discard" });
  expect(fresh.accept(progress(2, second))).toEqual({ kind: "ignored" });
});

test("captures scope and paths and detaches incoming and previously displayed fragment data", () => {
  const { request, files, first, second, progress } = fixture();
  const openedPaths: string[] = [];
  const preview = createContentSearchPreview(request, files, openedPaths);
  const a = progress(1, first);
  const b = progress(2, second);
  openedPaths.push("/root/first.md");
  files.get(second)!.displayPath = "/root/changed.md";
  files.delete(second);
  const accepted = preview.accept(a);
  if (accepted.kind !== "update") throw Error("Expected initial preview");
  a.fragments.matches[0].before = "tampered incoming";
  accepted.snapshot.groups[0].fragments.matches[0].after = "tampered snapshot";
  expect(preview.accept(b)).toEqual({
    kind: "update",
    snapshot: {
      processed: 2,
      groups: [
        { entry: first, fragments: progress(1, first).fragments },
        { entry: second, fragments: b.fragments },
      ],
    },
  });
});
