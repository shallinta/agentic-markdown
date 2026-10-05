import { expect, test } from "bun:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkspaceTree } from "../components/workspace-tree";
import type { WorkspaceNode, WorkspaceRoot } from "../shared/workspace";

import type { DocumentEntry } from "./documents";
import { createFolderWorkspace, type FolderState } from "./workspace";
import {
  projectWorkspaceTree,
  treeExpanded,
  treeFocusFallback,
  treeKeyAction,
  visibleWorkspaceItems,
} from "./workspace-tree-model";

const root = (
  handle: string,
  status: WorkspaceRoot["status"] = "complete"
): WorkspaceRoot => ({
  handle,
  displayPath: `/${handle}`,
  name: handle,
  generation: 1,
  status,
  examined: 1,
  errors: 0,
  entries: 1,
});
const node = (
  handle: string,
  parent: string,
  kind: WorkspaceNode["kind"] = "file",
  displayPath = `/A/${handle}`
): WorkspaceNode => ({ handle, parent, kind, displayPath, name: handle });
const entry = (handle: string, displayPath = `/${handle}`): DocumentEntry => ({
  handle,
  documentId: handle,
  fileName: handle,
  displayPath,
  explicitStandalone: true,
  writeCapability: { writable: true, reason: "writable" },
});
function fixture() {
  const roots = [root("A"), root("B")];
  const nodes = {
    A: [
      node("one.md", "A"),
      node("dir", "A", "directory"),
      node("deep.markdown", "dir"),
    ],
    B: [node("two.md", "B", "file", "/B/two.md")],
  };
  return { roots, nodes, entries: [entry("standalone.md")] };
}

test("one projection preserves source ordering and makes folder/file roots same level", () => {
  const f = fixture(),
    model = projectWorkspaceTree(f.roots, f.nodes, [], f.entries);
  const visible = visibleWorkspaceItems(model, new Set(), new Set());
  expect(visible.map((item) => item.name)).toEqual([
    "A",
    "one.md",
    "dir",
    "B",
    "two.md",
    "standalone.md",
  ]);
  expect(
    visible.filter((item) => item.parent === null).map((item) => item.level)
  ).toEqual([1, 1, 1]);
  expect(visible.find((item) => item.name === "dir")?.level).toBe(2);
  const expanded = visibleWorkspaceItems(
    model,
    new Set(["node:A:dir"]),
    new Set()
  );
  expect(expanded.find((item) => item.name === "deep.markdown")?.level).toBe(3);
  const collapsed = visibleWorkspaceItems(
    model,
    new Set(["node:A:dir"]),
    new Set(["root:A"])
  );
  expect(collapsed.map((item) => item.name)).toEqual([
    "A",
    "B",
    "two.md",
    "standalone.md",
  ]);
  expect(model.items.size).toBe(7); // folding does not remove collection membership
});

test("only covered plus actually discovered Markdown absorbs standalone; explicit hidden exception survives", () => {
  const f = fixture(),
    hidden = entry("hidden", "/A/.hidden.md"),
    ordinary = entry("ordinary", "/A/one.md");
  const entries = [
    hidden,
    ordinary,
    { ...entry("derived"), explicitStandalone: false },
  ];
  const off = projectWorkspaceTree(
    f.roots,
    f.nodes,
    ["hidden", "ordinary"],
    entries
  );
  expect(
    [...off.items.values()]
      .filter((item) => item.kind === "standalone")
      .map((item) => item.name)
  ).toEqual(["hidden"]);
  const on = projectWorkspaceTree(
    f.roots,
    {
      ...f.nodes,
      A: [...f.nodes.A, node(".hidden.md", "A", "file", "/A/.hidden.md")],
    },
    ["hidden", "ordinary"],
    entries
  );
  expect(
    [...on.items.values()].filter((item) => item.kind === "standalone")
  ).toHaveLength(0);
  const notCovered = projectWorkspaceTree([], {}, [], entries);
  expect([...notCovered.items.values()].map((item) => item.name)).toEqual([
    "hidden",
    "ordinary",
  ]);
});

test("navigation crosses roots and standalone, supports Home/End and Space selection without open", () => {
  const f = fixture(),
    model = projectWorkspaceTree(f.roots, f.nodes, [], f.entries);
  const visible = visibleWorkspaceItems(
    model,
    new Set(["node:A:dir"]),
    new Set()
  );
  expect(
    treeKeyAction(visible, "node:A:deep.markdown", "ArrowDown", false)
  ).toEqual({ kind: "focus", key: "root:B" });
  expect(treeKeyAction(visible, "node:B:two.md", "ArrowDown", false)).toEqual({
    kind: "focus",
    key: "file:standalone.md",
  });
  expect(
    treeKeyAction(visible, "file:standalone.md", "ArrowUp", false)
  ).toEqual({ kind: "focus", key: "node:B:two.md" });
  expect(treeKeyAction(visible, "root:A", "End", true)).toEqual({
    kind: "focus",
    key: "file:standalone.md",
  });
  expect(treeKeyAction(visible, "file:standalone.md", "Home", false)).toEqual({
    kind: "focus",
    key: "root:A",
  });
  expect(treeKeyAction(visible, "root:A", "ArrowRight", true)).toEqual({
    kind: "focus",
    key: "node:A:one.md",
  });
  expect(
    treeKeyAction(visible, "node:A:deep.markdown", "ArrowLeft", false)
  ).toEqual({ kind: "focus", key: "node:A:dir" });
  expect(treeKeyAction(visible, "root:A", "ArrowLeft", true)).toEqual({
    kind: "toggle",
  });
  expect(treeKeyAction(visible, "root:A", "ArrowRight", false)).toEqual({
    kind: "toggle",
  });
  expect(treeKeyAction(visible, "file:standalone.md", "Enter", false)).toEqual({
    kind: "open",
  });
  expect(treeKeyAction(visible, "root:A", "Enter", true)).toEqual({
    kind: "toggle",
  });
  expect(treeKeyAction(visible, "root:A", " ", true)).toEqual({
    kind: "focus",
    key: "root:A",
  });
  expect(treeKeyAction(visible, "file:standalone.md", " ", false)).toEqual({
    kind: "focus",
    key: "file:standalone.md",
  });
  expect(treeKeyAction(visible, "root:A", "a", true)).toBeNull();
});

test("removed generation focus falls back to live root, parent or first entry without path authorization", () => {
  const f = fixture(),
    before = projectWorkspaceTree(f.roots, f.nodes, [], f.entries);
  const old = before.items.get("node:A:deep.markdown");
  const after = projectWorkspaceTree(
    [{ ...f.roots[0], generation: 2 }, f.roots[1]],
    { A: [], B: f.nodes.B },
    [],
    f.entries
  );
  const visible = visibleWorkspaceItems(after, new Set(), new Set());
  expect(treeFocusFallback(old, visible)).toBe("root:A");
  expect(
    treeFocusFallback(
      old,
      visible.filter((item) => item.rootKey !== "root:A")
    )
  ).toBe("root:B");
  expect(treeFocusFallback(old, [])).toBeNull();
  expect(treeExpanded(after.items.get("root:A")!, new Set(), new Set())).toBe(
    true
  );
  expect(after.items.has(old!.key)).toBe(false);
});

test("wide and deep source projections avoid recursive stack or argument-spread limits", () => {
  const wide = Array.from({ length: 150000 }, (_, index) =>
    node(`f${index}`, "A")
  );
  const model = projectWorkspaceTree([root("A")], { A: wide }, [], []);
  expect(visibleWorkspaceItems(model, new Set(), new Set())).toHaveLength(
    150001
  );
  const deep = Array.from({ length: 5000 }, (_, index) =>
    node(`d${index}`, index ? `d${index - 1}` : "A", "directory")
  );
  const tree = projectWorkspaceTree([root("A")], { A: deep }, [], []);
  expect(
    visibleWorkspaceItems(
      tree,
      new Set(deep.map((item) => `node:A:${item.handle}`)),
      new Set()
    )
  ).toHaveLength(5001);
});

test("rendered unified tree has one scroll container, one roving entry, and separate root controls", () => {
  const f = fixture();
  const state: FolderState = {
    roots: [f.roots[0], { ...f.roots[1], status: "partial" }],
    nodes: f.nodes,
    coveredHandles: [],
    assetEpochs: {},
    busy: false,
    error: null,
  };
  const folders = createFolderWorkspace(() =>
    Promise.reject(Error("unexpected service call"))
  );
  const html = renderToStaticMarkup(
    createElement(WorkspaceTree, {
      folders,
      state,
      entries: f.entries,
      disabled: false,
      standaloneDisabled: false,
      runAction: (action) => action(),
      open: () => undefined,
      openStandalone: () => undefined,
      setHidden: () => undefined,
    })
  );
  expect(html.match(/role="tree"/g)).toHaveLength(1);
  expect(html.match(/overflow-auto/g)).toHaveLength(1);
  expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  expect(html.match(/aria-level="1"/g)).toHaveLength(3);
  expect(html.match(/role="switch"/g)).toHaveLength(2);
  expect(html.match(/<li[^>]*role="treeitem"/g)).toHaveLength(6);
  expect(html).not.toMatch(/<button[^>]*role="treeitem"/);
  expect(html).toMatch(
    /<li[^>]*aria-label="A"[^>]*><div[^>]*><span[^>]*>▾ A<\/span><button[^>]*role="switch"/
  );
  expect(html).toContain("部分项目无法访问，结果未完整");
  expect(html).toContain("B：重新扫描");
  expect(html).not.toMatch(/<button[^>]*>[^<]*<button/);
  const saving = renderToStaticMarkup(
    createElement(WorkspaceTree, {
      folders,
      state,
      entries: f.entries,
      disabled: true,
      standaloneDisabled: false,
      runAction: (action) => action(),
      open: () => undefined,
      openStandalone: () => undefined,
      setHidden: () => undefined,
    })
  );
  const standalone = /<li[^>]*data-tree-key="file:standalone.md"[^>]*>/.exec(
    saving
  )?.[0];
  expect(standalone).toBeDefined();
  expect(standalone).not.toContain('disabled=""');
  expect(standalone).toContain('aria-disabled="false"');
  expect(standalone).toContain('tabindex="0"');
  expect(saving.match(/tabindex="0"/g)).toHaveLength(1);
  expect(saving.match(/<button[^>]*disabled=""/g)).toHaveLength(4);
  const busy = renderToStaticMarkup(
    createElement(WorkspaceTree, {
      folders,
      state: { ...state, busy: true },
      entries: f.entries,
      disabled: false,
      standaloneDisabled: false,
      runAction: (action) => action(),
      open: () => undefined,
      openStandalone: () => undefined,
      setHidden: () => undefined,
    })
  );
  expect(busy.match(/<button[^>]*aria-disabled="true"/g)).toHaveLength(4);
  expect(busy).not.toMatch(/<button[^>]* disabled=""/);
  expect(busy.match(/aria-expanded="true"/g)).toHaveLength(2);
  expect(busy).not.toContain('aria-selected="true"');
  folders.dispose();
});
