import { expect, test } from "bun:test";

import type { WorkspaceRoot } from "../shared/workspace";

import { resolveContentSearchRoot } from "./content-search-root";

function root(name: string, displayPath: string): WorkspaceRoot {
  return {
    handle: crypto.randomUUID(),
    name,
    displayPath,
    generation: 1,
    status: "complete",
    examined: 0,
    errors: 0,
    entries: 0,
  };
}

test("no alias follows the selected handle only while its root remains present", () => {
  const first = root("Notes", "/a/Notes");
  const second = root("Notes", "/b/Notes");
  expect(resolveContentSearchRoot([first, second], undefined, second.handle))
    .toEqual({ ok: true, root: second });
  expect(resolveContentSearchRoot([first, second], undefined, null))
    .toEqual({ ok: false, error: "selection" });
  expect(resolveContentSearchRoot([first], undefined, second.handle))
    .toEqual({ ok: false, error: "selection" });
});

test("an explicit alias matches an exact root name or full display path", () => {
  const first = root("Notes", "/a/Notes");
  const second = root("Notes", "/b/Notes");
  const unique = root("项目 甲", "/other/项目 甲");
  const roots = [first, second, unique];
  expect(resolveContentSearchRoot(roots, "Notes", first.handle))
    .toEqual({ ok: false, error: "ambiguous" });
  expect(resolveContentSearchRoot(roots, second.displayPath, first.handle))
    .toEqual({ ok: true, root: second });
  expect(resolveContentSearchRoot(roots, "项目 甲", null))
    .toEqual({ ok: true, root: unique });
  for (const alias of ["notes", "a/Notes", "/a/Notes/", "/a/../b/Notes", "/unknown/Notes"])
    expect(resolveContentSearchRoot(roots, alias, first.handle))
      .toEqual({ ok: false, error: "unknown" });
  const volume = root("/", "/");
  expect(resolveContentSearchRoot([volume], "/", null)).toEqual({ ok: true, root: volume });
});

test("resolving again exposes alias removal, new handle, new generation and ambiguity", () => {
  const first = root("Notes", "/a/Notes");
  const readded = { ...first, handle: crypto.randomUUID() };
  const scanning: WorkspaceRoot = { ...readded, generation: 2, status: "scanning" };
  const other = root("Notes", "/b/Notes");
  expect(resolveContentSearchRoot([first], "Notes", null))
    .toEqual({ ok: true, root: first });
  expect(resolveContentSearchRoot([], first.displayPath, first.handle))
    .toEqual({ ok: false, error: "unknown" });
  expect(resolveContentSearchRoot([readded], first.displayPath, first.handle))
    .toEqual({ ok: true, root: readded });
  expect(resolveContentSearchRoot([scanning], first.displayPath, first.handle))
    .toEqual({ ok: true, root: scanning });
  expect(resolveContentSearchRoot([scanning, other], "Notes", null))
    .toEqual({ ok: false, error: "ambiguous" });
});
