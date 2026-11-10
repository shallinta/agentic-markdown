import { expect, test } from "bun:test";

import {
  applyDocumentRegionWorkspace as apply,
  type DocumentRegionWorkspace,
  type RegionDocument,
} from "./document-region-workspace";

const a = Object.freeze({ documentId: "a" }),
  b = Object.freeze({ documentId: "b" }),
  c = Object.freeze({ documentId: "c" });
const empty: DocumentRegionWorkspace = Object.freeze({
  main: [],
  secondary: [],
  secondaryHeights: [],
  secondaryHeight: 66,
  secondaryOpen: false,
  activeRegion: null,
  mainActiveId: null,
});
const open = (state: DocumentRegionWorkspace, document: RegionDocument) =>
  apply(state, { kind: "open", document });
function invariant(state: DocumentRegionWorkspace) {
  const ids = [...state.main, ...state.secondary].map(
    (document) => document.documentId
  );
  expect(new Set(ids).size).toBe(ids.length);
  expect(state.secondaryHeights).toHaveLength(state.secondary.length);
  if (state.secondary.length)
    expect(
      state.secondaryHeights.reduce((sum, height) => sum + height, 0)
    ).toBeCloseTo(state.secondaryHeight, 12);
  expect(state.secondaryHeights.every((height) => height >= 33)).toBe(true);
}

test("atomic open full fallback, identity reuse and explicit move failure", () => {
  let state = apply(empty, { kind: "visibility", expanded: true }).state;
  state = open(state, a).state;
  expect(state.secondaryHeights).toEqual([66]);
  state = open(state, b).state;
  expect(state.secondaryHeights).toEqual([33, 33]);
  const reused = open(state, { documentId: "a" });
  expect(reused.receipt).toEqual({
    kind: "activated",
    documentId: "a",
    region: "secondary",
  });
  expect(reused.state).toBe(state);
  expect(reused.state.secondary[0]).toBe(a);
  const fallback = open(state, c);
  expect(fallback.receipt).toEqual({
    kind: "opened",
    documentId: "c",
    region: "main",
    notice: "secondary-full",
  });
  state = fallback.state;
  expect(state.main[0]).toBe(c);
  const rejected = apply(state, {
    kind: "move",
    documentId: "c",
    target: "secondary",
  });
  expect(rejected.receipt).toEqual({
    kind: "blocked",
    reason: "secondary-full",
  });
  expect(rejected.state).toBe(state);
  invariant(state);
});

test("move transfers neighbor height, last departure collapses, refs and main selection stay explicit", () => {
  let state = open(
    open(apply(empty, { kind: "visibility", expanded: true }).state, a).state,
    b
  ).state;
  state = apply(state, { kind: "move", documentId: "a", target: "main" }).state;
  expect(state.main).toEqual([a]);
  expect(state.main[0]).toBe(a);
  expect(state.secondary[0]).toBe(b);
  expect(state.secondaryHeights).toEqual([66]);
  expect(state.mainActiveId).toBe("a");
  state = apply(state, {
    kind: "move",
    documentId: "a",
    target: "secondary",
  }).state;
  expect(state.secondary).toEqual([b, a]);
  expect(state.mainActiveId).toBeNull();
  invariant(state);
  state = apply(state, { kind: "move", documentId: "a", target: "main" }).state;
  state = apply(state, { kind: "move", documentId: "b", target: "main" }).state;
  expect(state.main).toEqual([a, b]);
  expect(state.secondary).toEqual([]);
  expect(state.secondaryHeights).toEqual([]);
  expect(state.secondaryOpen).toBe(false);
  expect(state.activeRegion).toBe("main");
  expect(state.mainActiveId).toBe("b");
  invariant(state);
});

test("closed secondary defers hidden instances and rejects moves without changing state", () => {
  let state = open(
    apply(empty, { kind: "visibility", expanded: true }).state,
    a
  ).state;
  state = apply(state, { kind: "visibility", expanded: false }).state;
  const hidden = open(state, a);
  expect(hidden.state).toBe(state);
  expect(hidden.receipt).toEqual({
    kind: "defer",
    reason: "hidden-existing",
    documentId: "a",
  });
  expect(
    apply(state, { kind: "move", documentId: "a", target: "main" }).state
  ).toBe(state);
  state = open(state, b).state;
  expect(state.main).toEqual([b]);
  const rejected = apply(state, {
    kind: "move",
    documentId: "b",
    target: "secondary",
  });
  expect(rejected.state).toBe(state);
  expect(rejected.receipt).toEqual({
    kind: "blocked",
    reason: "secondary-closed",
  });
  const expanded = apply(state, { kind: "visibility", expanded: true }).state;
  expect(expanded.main).toBe(state.main);
  expect(expanded.secondary).toBe(state.secondary);
  expect(expanded.mainActiveId).toBe("b");
  invariant(expanded);
});

test("invalid allocation and duplicate ownership never become full fallbacks", () => {
  for (const bad of [
    { ...empty, main: [a], secondary: [a], secondaryHeights: [66] },
    { ...empty, secondary: [a], secondaryHeights: [65] },
    { ...empty, secondary: [a], secondaryHeights: [] },
    { ...empty, secondaryHeight: NaN },
    { ...empty, mainActiveId: "missing" },
  ]) {
    const result = open(bad, b);
    expect(result.state).toBe(bad);
    expect(result.receipt).toEqual({ kind: "blocked", reason: "invalid" });
  }
  const missing = apply(empty, {
    kind: "move",
    documentId: "missing",
    target: "main",
  });
  expect(missing.state).toBe(empty);
  expect(missing.receipt).toEqual({ kind: "blocked", reason: "not-open" });
  expect(empty.secondary).toEqual([]);
});

test("moving the active main item leaves other main references intact without choosing a successor", () => {
  const state: DocumentRegionWorkspace = Object.freeze({
    ...empty,
    main: Object.freeze([a, b]),
    mainActiveId: "b",
    activeRegion: "main",
    secondaryOpen: true,
  });
  const moved = apply(state, {
    kind: "move",
    documentId: "b",
    target: "secondary",
  });
  expect(moved.state.main).toEqual([a]);
  expect(moved.state.main[0]).toBe(a);
  expect(moved.state.mainActiveId).toBeNull();
  expect(moved.state.secondary[0]).toBe(b);
  expect(state.mainActiveId).toBe("b");
  const opened = open({ ...state, activeRegion: "secondary" }, c);
  expect(opened.state.main).toBe(state.main);
  expect(opened.state.mainActiveId).toBe("b");
  const reused = open(state, { documentId: "a" });
  expect(reused.state.main).toBe(state.main);
  expect(reused.state.mainActiveId).toBe("a");
  expect(reused.state.main[0]).toBe(a);
});
