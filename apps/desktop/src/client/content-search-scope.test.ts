import { expect, test } from "bun:test";

import type { WorkspaceNode, WorkspaceRoot } from "../shared/workspace";

import {
  captureContentSearchScope,
  resolveContentSearchScope,
} from "./content-search-scope";
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

function workspace(roots: WorkspaceRoot[], nodes: FolderState["nodes"]): FolderState {
  return { roots, nodes, coveredHandles: [], busy: false, error: null };
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
    ["first", { root: a, name: "纪要.md", relativePath: "项目/纪要.md" }],
    ["second", { root: b, name: "纪要.md", relativePath: "草稿/纪要.md" }],
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
  const a = root("a", "/a", 9);
  const b = root("b", "/b", 8);
  const nodes = (owner: WorkspaceRoot) => Array.from({ length: owner.entries }, (_, index) =>
    file(owner, owner.handle + index, "note-" + index + ".md")
  );
  expect(captureContentSearchScope(
    workspace([a, b], { a: nodes(a), b: nodes(b) }), "all", undefined, selection, ["note-1"], []
  )).toEqual({ ok: false, error: "limit" });
  const exact = { ...a, entries: 8 };
  expect(captureContentSearchScope(
    workspace([exact, b], { a: nodes(exact), b: nodes(b) }), "all", undefined, selection, [], []
  )).toMatchObject({ ok: true });
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
