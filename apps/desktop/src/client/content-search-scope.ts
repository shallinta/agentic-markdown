import { CONTENT_SEARCH_LIMITS } from "../shared/content-search";
import {
  matchesContentSearchFileFilters,
  matchesContentSearchPathFilters,
  relativeContentSearchPath,
  type ContentSearchPathFilter,
} from "../shared/content-search-filters";
import type { WorkspaceRoot } from "../shared/workspace";

import { resolveContentSearchRoot } from "./content-search-root";
import type { FolderState } from "./workspace";

export type ContentSearchScopeMode = "selected" | "all";

type RootFailure = Extract<ReturnType<typeof resolveContentSearchRoot>, { ok: false }>;
interface SearchScope {
  ok: true;
  kind: "single" | "all";
  roots: readonly WorkspaceRoot[];
}
interface ScopeSelection {
  handle: string | null;
  revision: number;
}
interface ScopeEntry {
  root: WorkspaceRoot;
  name: string;
  relativePath?: string;
}

export function resolveContentSearchScope(
  roots: readonly WorkspaceRoot[],
  mode: ContentSearchScopeMode,
  alias: string | undefined,
  selectedHandle: string | null
): SearchScope | RootFailure {
  if (alias !== undefined || mode === "selected") {
    const resolved = resolveContentSearchRoot(roots, alias, selectedHandle);
    return resolved.ok ? { ok: true, kind: "single", roots: [resolved.root] } : resolved;
  }
  return roots.length
    ? { ok: true, kind: "all", roots }
    : { ok: false, error: "selection" };
}

function sameRoot(left: WorkspaceRoot, right: WorkspaceRoot) {
  return (
    left.handle === right.handle &&
    left.name === right.name &&
    left.displayPath === right.displayPath &&
    left.generation === right.generation &&
    left.status === right.status &&
    left.showHidden === right.showHidden &&
    left.observation === right.observation &&
    left.entries === right.entries &&
    left.errors === right.errors &&
    left.examined === right.examined
  );
}

type Capture =
  | (SearchScope & {
      entries: ReadonlyMap<string, ScopeEntry>;
      current(latest: FolderState, selection: ScopeSelection): boolean;
    })
  | RootFailure
  | { ok: false; error: "not-ready" | "limit" | "incomplete" };

export function captureContentSearchScope(
  workspace: FolderState,
  mode: ContentSearchScopeMode,
  alias: string | undefined,
  selection: ScopeSelection,
  fileFilters: readonly string[],
  pathFilters: readonly ContentSearchPathFilter[]
): Capture {
  const resolved = resolveContentSearchScope(workspace.roots, mode, alias, selection.handle);
  if (!resolved.ok) return resolved;
  if (resolved.roots.length > CONTENT_SEARCH_LIMITS.roots)
    return { ok: false, error: "limit" };
  if (workspace.busy || workspace.error)
    return { ok: false, error: "not-ready" };

  const { kind } = resolved;
  const roots = resolved.roots.map((root) => ({ ...root }));
  const pages = roots.map(({ handle }) => workspace.nodes[handle]);
  if (roots.some((root, index) =>
    root.status !== "complete" || (pages[index]?.length ?? 0) !== root.entries
  ))
    return { ok: false, error: "not-ready" };

  const handles = new Set(roots.map(({ handle }) => handle));
  const paths = new Set(roots.map(({ displayPath }) => displayPath));
  if (handles.size !== roots.length || paths.size !== roots.length)
    return { ok: false, error: "incomplete" };
  for (const [index, root] of roots.entries()) {
    for (const other of roots.slice(index + 1)) {
      if (relativeContentSearchPath(root.displayPath, other.displayPath) !== undefined ||
          relativeContentSearchPath(other.displayPath, root.displayPath) !== undefined)
        return { ok: false, error: "incomplete" };
    }
  }

  const entries = new Map<string, ScopeEntry>();
  const needsPath = kind === "all" || pathFilters.length > 0;
  let fileCount = 0;
  for (const [index, root] of roots.entries()) {
    for (const node of pages[index] ?? []) {
      if (node.kind !== "file") continue;
      if (++fileCount > CONTENT_SEARCH_LIMITS.documents)
        return { ok: false, error: "limit" };
      if (handles.has(node.handle) || paths.has(node.displayPath))
        return { ok: false, error: "incomplete" };
      handles.add(node.handle);
      paths.add(node.displayPath);
      const path = relativeContentSearchPath(root.displayPath, node.displayPath);
      if (needsPath && path === undefined)
        return { ok: false, error: "incomplete" };
      if (
        matchesContentSearchFileFilters(node.name, fileFilters) &&
        (path === undefined || matchesContentSearchPathFilters(path, pathFilters))
      )
        entries.set(node.handle, { root, name: node.name, relativePath: path });
    }
  }

  const selectionRevision = selection.revision;
  return {
    ok: true,
    kind,
    roots,
    entries,
    current(latest, selection) {
      if (latest.busy || latest.error ||
          (mode === "selected" && alias === undefined && selection.revision !== selectionRevision))
        return false;
      const current = resolveContentSearchScope(latest.roots, mode, alias, selection.handle);
      return current.ok && current.kind === kind && current.roots.length === roots.length &&
        roots.every((root, index) =>
          sameRoot(root, current.roots[index]) && latest.nodes[root.handle] === pages[index]
        );
    },
  };
}
