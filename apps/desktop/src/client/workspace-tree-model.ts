import type { WorkspaceNode, WorkspaceRoot } from "../shared/workspace";

import type { DocumentEntry } from "./documents";
import type { FolderState } from "./workspace";

export type TreeItem = {
  key: string;
  parent: string | null;
  rootKey: string | null;
  level: number;
  name: string;
  path: string;
  directory: boolean;
} & (
  | { kind: "root"; root: WorkspaceRoot }
  | { kind: "node"; root: WorkspaceRoot; node: WorkspaceNode }
  | { kind: "standalone"; entry: DocumentEntry }
);
export interface WorkspaceTreeModel {
  items: Map<string, TreeItem>;
  children: Map<string | null, string[]>;
}

/** Display projection only: paths here never authorize an operation. */
export function projectWorkspaceTree(
  roots: FolderState["roots"],
  nodes: FolderState["nodes"],
  coveredHandles: readonly string[],
  entries: readonly DocumentEntry[]
): WorkspaceTreeModel {
  const items = new Map<string, TreeItem>(),
    children = new Map<string | null, string[]>();
  const covered = new Set(coveredHandles),
    visibleFiles = new Set<string>();
  const add = (item: TreeItem) => {
    items.set(item.key, item);
    const siblings = children.get(item.parent) ?? [];
    siblings.push(item.key);
    children.set(item.parent, siblings);
  };
  for (const root of roots) {
    const rootKey = `root:${root.handle}`;
    add({
      kind: "root",
      key: rootKey,
      parent: null,
      rootKey,
      level: 1,
      name: root.name,
      path: root.displayPath,
      directory: true,
      root,
    });
    const childrenByHandle = new Map<string, WorkspaceNode[]>();
    for (const node of nodes[root.handle] ?? []) {
      const siblings = childrenByHandle.get(node.parent) ?? [];
      siblings.push(node);
      childrenByHandle.set(node.parent, siblings);
    }
    // Iterative traversal avoids deep-directory recursion; retain source order.
    const work = (childrenByHandle.get(root.handle) ?? [])
      .map((node) => ({ node, parent: rootKey, level: 2 }))
      .reverse();
    const visited = new Set<string>();
    while (work.length) {
      const { node, parent, level } = work.pop()!;
      if (visited.has(node.handle)) continue;
      visited.add(node.handle);
      const key = `node:${root.handle}:${node.handle}`;
      add({
        kind: "node",
        key,
        parent,
        rootKey,
        level,
        name: node.name,
        path: node.displayPath,
        directory: node.kind === "directory",
        root,
        node,
      });
      if (node.kind === "file") visibleFiles.add(node.displayPath);
      else
        for (const child of [
          ...(childrenByHandle.get(node.handle) ?? []),
        ].reverse())
          work.push({ node: child, parent: key, level: level + 1 });
    }
  }
  for (const entry of entries) {
    if (
      entry.explicitStandalone === false ||
      (covered.has(entry.handle) &&
        entry.displayPath &&
        visibleFiles.has(entry.displayPath))
    )
      continue;
    add({
      kind: "standalone",
      key: `file:${entry.locationId ?? entry.documentId}`,
      parent: null,
      rootKey: null,
      level: 1,
      name: entry.fileName,
      path: entry.displayPath ?? entry.fileName,
      directory: false,
      entry,
    });
  }
  return { items, children };
}
export function treeExpanded(
  item: TreeItem,
  expanded: ReadonlySet<string>,
  collapsedRoots: ReadonlySet<string>
) {
  return item.kind === "root"
    ? !collapsedRoots.has(item.key)
    : expanded.has(item.key);
}
export function visibleWorkspaceItems(
  model: WorkspaceTreeModel,
  expanded: ReadonlySet<string>,
  collapsedRoots: ReadonlySet<string>
) {
  const result: TreeItem[] = [],
    work = [...(model.children.get(null) ?? [])].reverse();
  while (work.length) {
    const item = model.items.get(work.pop()!);
    if (!item) continue;
    result.push(item);
    if (item.directory && treeExpanded(item, expanded, collapsedRoots)) {
      const children = model.children.get(item.key) ?? [];
      for (let index = children.length - 1; index >= 0; index--)
        work.push(children[index]);
    }
  }
  return result;
}
export function treeKeyAction(
  items: readonly TreeItem[],
  key: string,
  pressed: string,
  expanded: boolean
): { kind: "focus"; key: string } | { kind: "toggle" | "open" } | null {
  const index = items.findIndex((item) => item.key === key),
    item = items[index];
  if (!item) return null;
  if (pressed === "Enter") return { kind: item.directory ? "toggle" : "open" };
  if (pressed === " ") return { kind: "focus", key }; // selection only, no scroll/open
  if (pressed === "Home" || pressed === "End")
    return {
      kind: "focus",
      key: items[pressed === "Home" ? 0 : items.length - 1].key,
    };
  if (pressed === "ArrowDown" || pressed === "ArrowUp")
    return {
      kind: "focus",
      key: items[index + (pressed === "ArrowDown" ? 1 : -1)]?.key ?? key,
    };
  if (pressed === "ArrowRight" && item.directory)
    return !expanded
      ? { kind: "toggle" }
      : {
          kind: "focus",
          key: items[index + 1]?.parent === key ? items[index + 1].key : key,
        };
  if (pressed === "ArrowLeft")
    return item.directory && expanded
      ? { kind: "toggle" }
      : item.parent
        ? { kind: "focus", key: item.parent }
        : null;
  return null;
}
export function treeFocusFallback(
  old: TreeItem | undefined,
  visible: readonly TreeItem[]
) {
  return (
    visible.find((item) => item.key === old?.key)?.key ??
    visible.find((item) => item.key === old?.parent)?.key ??
    visible.find((item) => item.key === old?.rootKey)?.key ??
    visible[0]?.key ??
    null
  );
}
