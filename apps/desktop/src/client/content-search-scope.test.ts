import { expect, test } from "bun:test";

import type { WorkspaceNode, WorkspaceRoot } from "../shared/workspace";

import {
  captureContentSearchScope,
  createContentSearchStandaloneProjection,
  resolveContentSearchScope,
} from "./content-search-scope";
import type { DocumentEntry } from "./documents";
import type { FolderState } from "./workspace";

function root(handle: string, displayPath: string, entries = 1): WorkspaceRoot {
  return {
    handle,
    displayPath,
    name: displayPath.slice(displayPath.lastIndexOf("/") + 1),
    status: "complete",
    generation: 3,
    examined: entries,
    errors: 0,
    entries,
  };
}

function file(owner: WorkspaceRoot, handle: string, relative: string): WorkspaceNode {
  return {
    handle,
    parent: owner.handle,
    name: relative.slice(relative.lastIndexOf("/") + 1),
    kind: "file",
    displayPath: owner.displayPath + "/" + relative,
  };
}

const filesFor = (owner: WorkspaceRoot) => Array.from({ length: owner.entries }, (_, index) =>
  file(owner, `${owner.handle}-file-${index}`, `note-${index}.md`)
);

function workspace(roots: WorkspaceRoot[], nodes: FolderState["nodes"]): FolderState {
  return { roots, nodes, coveredHandles: [], busy: false, error: null };
}

function leaf(handle: string, displayPath: string): DocumentEntry {
  return {
    handle,
    documentId: `document-${handle}`,
    locationId: `location-${handle}`,
    displayPath,
    fileName: displayPath.slice(displayPath.lastIndexOf("/") + 1),
    explicitStandalone: true,
    writeCapability: { writable: true, reason: "writable" },
  };
}

function fixture() {
  const a = root("a", "/group-a/笔记");
  const b = root("b", "/group-b/笔记");
  const first = file(a, "first", "项目/纪要.md");
  const second = file(b, "second", "草稿/纪要.md");
  const state = workspace([a, b], { a: [first], b: [second] });
  const selection = { handle: a.handle, revision: 1 };
  return { state, selection, a, b, first, second };
}

test("an explicit alias overrides all mode and no alias uses the chosen scope", () => {
  const { state, a, b } = fixture();
  expect(resolveContentSearchScope(state.roots, "selected", undefined, "b")).toEqual({
    ok: true, kind: "single", roots: [b],
  });
  expect(resolveContentSearchScope(state.roots, "all", undefined, null)).toEqual({
    ok: true, kind: "all", roots: [a, b],
  });
  expect(resolveContentSearchScope(state.roots, "all", a.displayPath, "b")).toEqual({
    ok: true, kind: "single", roots: [a],
  });
  expect(resolveContentSearchScope(state.roots, "all", a.name, "b")).toEqual({
    ok: false, error: "ambiguous",
  });
  expect(resolveContentSearchScope(state.roots, "all", "/missing", "b")).toEqual({
    ok: false, error: "unknown",
  });
  expect(resolveContentSearchScope([], "all", undefined, "b")).toEqual({
    ok: false, error: "selection",
  });
});

test("all scope captures actual owner and relative path before preparing expected filtered coverage", () => {
  const { state, selection, a, b } = fixture();
  const all = captureContentSearchScope(state, "all", undefined, selection, [], []);
  if (!all.ok) throw Error("Missing complete scope");
  expect([...all.entries]).toEqual([
    ["first", { root: a, name: "纪要.md", relativePath: "项目/纪要.md", displayPath: "/group-a/笔记/项目/纪要.md" }],
    ["second", { root: b, name: "纪要.md", relativePath: "草稿/纪要.md", displayPath: "/group-b/笔记/草稿/纪要.md" }],
  ]);
  const filtered = captureContentSearchScope(
    state, "all", undefined, selection, ["纪要"], [{ kind: "-path", value: "草稿/" }]
  );
  if (!filtered.ok) throw Error("Missing filtered scope");
  expect([...filtered.entries.keys()]).toEqual(["first"]);
  const missing = captureContentSearchScope(
    state, "all", undefined, selection, [], [{ kind: "path", value: "group-a" }]
  );
  expect(missing).toMatchObject({ ok: true, entries: new Map() });
});

test("capture fails closed on missing pages, duplicate identities and invalid relative paths", () => {
  const { state, selection, a, b, first, second } = fixture();
  const capture = (next: FolderState) =>
    captureContentSearchScope(next, "all", undefined, selection, ["unlikely"], []);
  expect(capture({ ...state, roots: [a, { ...b, status: "scanning" }] }))
    .toEqual({ ok: false, error: "not-ready" });
  expect(capture({ ...state, nodes: { a: [first] } })).toEqual({
    ok: false, error: "not-ready",
  });
  expect(capture({ ...state, roots: [a, a] })).toEqual({
    ok: false, error: "incomplete",
  });
  expect(capture({ ...state, roots: [a, { ...b, displayPath: a.displayPath + "/child" }] }))
    .toEqual({ ok: false, error: "incomplete" });
  for (const bad of [
    { ...second, handle: first.handle },
    { ...second, displayPath: first.displayPath },
    { ...second, displayPath: "/elsewhere/纪要.md" },
  ]) {
    expect(capture({ ...state, nodes: { a: [first], b: [bad] } })).toEqual({
      ok: false, error: "incomplete",
    });
  }
  const malformed = { ...state, nodes: { ...state.nodes, a: [{ ...first, displayPath: "" }] } };
  expect(captureContentSearchScope(malformed, "selected", undefined, selection, [], []))
    .toMatchObject({ ok: true });
  expect(captureContentSearchScope(
    malformed, "selected", undefined, selection, [], [{ kind: "path", value: "项目" }]
  )).toEqual({ ok: false, error: "incomplete" });
});

test("scope enforces total root and file limits before filters can exclude them", () => {
  const selection = { handle: null, revision: 1 };
  const manyRoots = Array.from({ length: 17 }, (_, index) => root(String(index), "/" + index, 0));
  expect(captureContentSearchScope(workspace(manyRoots, {}), "all", undefined, selection, [], []))
    .toEqual({ ok: false, error: "limit" });
  const a = root("a", "/a", 17);
  const b = root("b", "/b", 16);
  expect(captureContentSearchScope(
    workspace([a, b], { a: filesFor(a), b: filesFor(b) }), "all", undefined, selection, ["note-1"], []
  )).toEqual({ ok: false, error: "limit" });
  const exact = { ...a, entries: 16 };
  const captured = captureContentSearchScope(
    workspace([exact, b], { a: filesFor(exact), b: filesFor(b) }), "all", undefined, selection, [], []
  );
  if (!captured.ok) throw Error("Missing exact two-root scope");
  expect(captured.entries.size).toBe(32);
  expect(captured.entries.get("b-file-15")).toMatchObject({ root: b, name: "note-15.md" });
});

test("single filtered scope admits up to 32 matches beyond the ordinary root coverage limit", () => {
  const wide = root("wide", "/wide", 33);
  const state = workspace([wide], { wide: filesFor(wide) });
  const selection = { handle: wide.handle, revision: 1 };
  const single = captureContentSearchScope(state, "selected", undefined, selection, ["note-32.md"], []);
  if (!single.ok) throw Error("Missing narrowed single scope");
  expect([...single.entries.keys()]).toEqual(["wide-file-32"]);
  expect(single.current(state, selection)).toBe(true);
  expect(single.current({ ...state, roots: [{ ...wide, generation: wide.generation + 1 }] }, selection)).toBe(false);
  const explicit = captureContentSearchScope(state, "all", wide.displayPath, selection, [], [
    { kind: "path", value: ".md" }, { kind: "-path", value: "note-32.md" },
  ]);
  if (!explicit.ok) throw Error("Missing narrowed explicit scope");
  expect(explicit.kind).toBe("single");
  expect(explicit.entries.size).toBe(32);
  expect(explicit.entries.has("wide-file-32")).toBe(false);
  expect(captureContentSearchScope(state, "selected", undefined, selection, [], []))
    .toEqual({ ok: false, error: "limit" });
  expect(captureContentSearchScope(state, "selected", undefined, selection, [".md"], []))
    .toEqual({ ok: false, error: "limit" });
  expect(captureContentSearchScope(state, "all", undefined, selection, ["note-32.md"], []))
    .toEqual({ ok: false, error: "limit" });
});

test("single filtered scope counts directories in the metadata limit", () => {
  const wide = root("wide", "/wide", 256);
  const nodes: WorkspaceNode[] = Array.from({ length: 128 }, (_, index) => {
    const folder = { ...file(wide, `folder-${index}`, `folder-${index}`), kind: "directory" as const };
    const node = file(wide, `note-${index}`, `folder-${index}/note.md`);
    return [folder, { ...node, parent: folder.handle }];
  }).flat();
  const selection = { handle: wide.handle, revision: 1 };
  const narrow = (owner: WorkspaceRoot, page: WorkspaceNode[]) =>
    captureContentSearchScope(workspace([owner], { wide: page }), "selected", undefined, selection, [], [
      { kind: "path", value: "folder-0/" },
    ]);
  const accepted = narrow(wide, nodes);
  if (!accepted.ok) throw Error("Missing exact-limit filtered scope");
  expect([...accepted.entries.keys()]).toEqual(["note-0"]);
  expect(narrow({ ...wide, entries: 257 }, [...nodes, file(wide, "new", "new.md")]))
    .toEqual({ ok: false, error: "limit" });
});

test("legacy single filtered scope remains available with many directories and few files", () => {
  const deep = root("deep", "/deep", 288);
  const nodes: WorkspaceNode[] = [];
  for (let branch = 0; branch < 16; branch++) {
    let parent = deep.handle;
    let relative = `branch-${branch}`;
    for (let depth = 0; depth < 17; depth++) {
      const folder = file(deep, `dir-${branch}-${depth}`, relative);
      nodes.push({ ...folder, parent, kind: "directory" });
      parent = folder.handle;
      relative += "/nested";
    }
    nodes.push({ ...file(deep, `note-${branch}`, relative + ".md"), parent });
  }
  expect(nodes).toHaveLength(deep.entries);
  const captured = captureContentSearchScope(
    workspace([deep], { deep: nodes }), "selected", undefined, { handle: deep.handle, revision: 1 }, [],
    [{ kind: "path", value: "branch-0/" }],
  );
  if (!captured.ok) throw Error("Missing legacy filtered scope");
  expect([...captured.entries.keys()]).toEqual(["note-0"]);
});

test("scope stays current only for the same ordered roots, metadata, and exact page refs", () => {
  const { state, selection, a, b } = fixture();
  const empty = root("empty", "/empty", 0);
  const initial = { ...state, roots: [a, b, empty] };
  const all = captureContentSearchScope(initial, "all", undefined, selection, [], []);
  if (!all.ok) throw Error("Missing complete scope");
  const moved = { handle: "b", revision: 2 };
  expect(all.current(initial, moved)).toBe(true);
  expect(all.current({ ...initial, roots: initial.roots.map((item) => ({ ...item })) }, moved))
    .toBe(true);
  for (const latest of [
    { ...initial, roots: [b, a, empty] },
    { ...initial, roots: [a, b] },
    { ...initial, roots: [...initial.roots, root("c", "/c", 0)] },
    { ...initial, roots: [a, b, { ...empty, generation: 4 }] },
    { ...initial, roots: [a, { ...b, observation: "limited" as const }, empty] },
    { ...initial, roots: [a, { ...b, showHidden: true }, empty] },
    { ...initial, nodes: { ...initial.nodes, b: [...initial.nodes.b] } },
    { ...initial, busy: true },
    { ...initial, error: "refresh failed" },
  ]) expect(all.current(latest, moved)).toBe(false);
});

test("single scope watches implicit selection and re-resolves explicit aliases", () => {
  const { state, selection, a, b } = fixture();
  const implicit = captureContentSearchScope(state, "selected", undefined, selection, [], []);
  const explicit = captureContentSearchScope(state, "all", a.displayPath, selection, [], []);
  const exactName = captureContentSearchScope(
    { ...state, roots: [a] }, "all", a.name, selection, [], []
  );
  if (!implicit.ok || !explicit.ok || !exactName.ok) throw Error("Missing single scopes");
  const moved = { handle: b.handle, revision: 2 };
  expect(implicit.current(state, moved)).toBe(false);
  expect(implicit.current(state, { ...selection, revision: 3 })).toBe(false);
  expect(explicit.current(state, moved)).toBe(true);
  expect(explicit.current({ ...state, roots: [b, { ...a, handle: "readded" }] }, moved))
    .toBe(false);
  expect(exactName.current(state, moved)).toBe(false);
});

test("current-window scope accepts rootless retained entries and fences their exact ordered roster", () => {
  const { a, selection } = fixture();
  const state = workspace([], {});
  const first = leaf("leaf-a", "/甲/独立.md");
  const second = leaf("leaf-b", "/乙/独立.md");
  const scoped = captureContentSearchScope(state, "all", undefined, selection, [], [], [first, second]);
  if (!scoped.ok) throw Error("Missing rootless scope");
  expect(scoped.standaloneHandles).toEqual([first.handle, second.handle]);
  expect(scoped.entries.get(first.handle)).toMatchObject({ root: null, standalone: first });
  expect(scoped.current(state, selection, [{ ...first }, second])).toBe(true);
  expect(scoped.current(state, selection, [second, first])).toBe(false);
  expect(scoped.current(state, selection, [{ ...first, locationId: "changed" }, second])).toBe(false);
  expect(scoped.current({ ...state, roots: [a] }, selection, [first, second])).toBe(false);
  expect(captureContentSearchScope(state, "all", "笔记", selection, [], [], [first]))
    .toEqual({ ok: false, error: "unknown" });
  for (const malformed of [
    [first, first],
    [first, { ...second, documentId: first.documentId }],
    [first, { ...second, locationId: first.locationId }],
    [first, { ...second, displayPath: first.displayPath }],
    [{ ...first, explicitStandalone: false }],
    [{ ...first, displayPath: "/甲/../独立.md" }],
    [{ ...first, fileName: "错名.md" }],
  ]) expect(captureContentSearchScope(state, "all", undefined, selection, [], [], malformed))
    .toEqual({ ok: false, error: "incomplete" });
});

test("mixed coverage shares prefilter count and filters retained files by logical basename", () => {
  const { state, selection, first } = fixture();
  const retained = leaf("independent", "/甲/单篇.md");
  const scoped = captureContentSearchScope(
    state, "all", undefined, selection, ["单篇"], [{ kind: "path", value: "单篇.md" }], [retained]
  );
  if (!scoped.ok) throw Error("Missing mixed scope");
  expect(scoped.standaloneHandles).toEqual([retained.handle]);
  expect([...scoped.entries.keys()]).toEqual([retained.handle]);
  const excluded = captureContentSearchScope(
    state, "all", undefined, selection, [], [{ kind: "path", value: "甲/" }], [retained]
  );
  if (!excluded.ok) throw Error("Missing filtered scope");
  expect(excluded.standaloneHandles).toEqual([retained.handle]);
  expect(excluded.entries.size).toBe(0);
  expect(captureContentSearchScope(
    state, "all", undefined, selection, [], [], [leaf("duplicate", first.displayPath)]
  )).toEqual({ ok: false, error: "incomplete" });
});

test("the independent retained-handle cap still applies within the larger mixed coverage", () => {
  const selection = { handle: null, revision: 1 };
  const leaves = Array.from({ length: 16 }, (_, index) => leaf(`leaf-${index}`, `/leaf-${index}.md`));
  const wide = root("wide", "/wide", 17);
  expect(captureContentSearchScope(
    workspace([wide], { wide: filesFor(wide) }), "all", undefined, selection, ["nothing"], [], leaves
  )).toEqual({ ok: false, error: "limit" });
  const exact = { ...wide, entries: 16 };
  const scoped = captureContentSearchScope(
    workspace([exact], { wide: filesFor(exact) }), "all", undefined, selection, [], [], leaves
  );
  if (!scoped.ok) throw Error("Missing exact mixed scope");
  expect(scoped.entries.size).toBe(32);
  expect(scoped.standaloneHandles).toEqual(leaves.map(({ handle }) => handle));
  expect(captureContentSearchScope(
    workspace([], {}), "all", undefined, selection, [], [], [...leaves, leaf("extra", "/extra.md")]
  )).toEqual({ ok: false, error: "limit" });
});

test("retained projection follows visible tree absorption and does not discard hidden entries", () => {
  const { state, selection, first } = fixture();
  const absorbed = leaf("independent-first", first.displayPath);
  const hidden = leaf("independent-hidden", "/group-a/笔记/.hidden.md");
  const derived = { ...leaf("derived", "/other.md"), explicitStandalone: false };
  const entries = [absorbed, hidden, derived];
  const project = createContentSearchStandaloneProjection();
  const before = project(state, entries);
  expect(before).toEqual([absorbed, hidden]);
  expect(project({ ...state, busy: true }, entries)).toBe(before);
  const covered = { ...state, coveredHandles: [absorbed.handle, hidden.handle] };
  expect(project(covered, entries)).toEqual([hidden]);
  const scoped = captureContentSearchScope(covered, "all", undefined, selection, [], [], project(covered, entries));
  if (!scoped.ok) throw Error("Missing projected scope");
  expect([...scoped.entries.keys()]).toEqual(["first", "second", hidden.handle]);
  expect(scoped.current(state, selection, project(state, entries))).toBe(false);
});
