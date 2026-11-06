import { CONTENT_SEARCH_LIMITS } from "../shared/content-search";
import {
  matchesContentSearchFileFilters,
  matchesContentSearchPathFilters,
  relativeContentSearchPath,
  type ContentSearchPathFilter,
} from "../shared/content-search-filters";
import type { WorkspaceRoot } from "../shared/workspace";

import { resolveContentSearchRoot } from "./content-search-root";
import type { DocumentEntry } from "./documents";
import type { FolderState } from "./workspace";
import { projectWorkspaceTree } from "./workspace-tree-model";

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
type ScopeEntry = {
  name: string;
  relativePath?: string;
  displayPath: string;
} & (
  | { root: WorkspaceRoot; standalone?: never }
  | { root: null; standalone: DocumentEntry }
);

export function createContentSearchStandaloneProjection() {
  let previous: { workspace: FolderState; entries: readonly DocumentEntry[] } | undefined;
  let standalone: readonly DocumentEntry[] = [];
  return (workspace: FolderState, entries: readonly DocumentEntry[]) => {
    if (previous?.workspace.roots === workspace.roots &&
        previous.workspace.nodes === workspace.nodes &&
        previous.workspace.coveredHandles === workspace.coveredHandles &&
        previous.entries === entries)
      return standalone;
    previous = { workspace, entries };
    standalone = projectContentSearchStandalone(workspace.roots, workspace.nodes, workspace.coveredHandles, entries);
    return standalone;
  };
}

export function projectContentSearchStandalone(
  roots: FolderState["roots"],
  nodes: FolderState["nodes"],
  coveredHandles: FolderState["coveredHandles"],
  entries: readonly DocumentEntry[]
): readonly DocumentEntry[] {
  const explicit = entries.filter((entry) => entry.explicitStandalone === true);
  if (!roots.length || !coveredHandles.length || !explicit.length) return explicit;
  // Only entries with possible coverage need a full visible-tree projection.
  const covered = new Set(coveredHandles);
  if (!explicit.some(({ handle }) => covered.has(handle))) return explicit;
  const tree = projectWorkspaceTree(roots, nodes, coveredHandles, explicit);
  return (tree.children.get(null) ?? []).flatMap((key) => {
    const item = tree.items.get(key);
    return item?.kind === "standalone" ? [item.entry] : [];
  });
}

export function sameContentSearchStandalone(left: DocumentEntry, right?: DocumentEntry) {
  return right?.explicitStandalone === true && left.explicitStandalone === true &&
    left.handle === right.handle && left.documentId === right.documentId &&
    left.locationId === right.locationId && left.fileName === right.fileName &&
    left.displayPath === right.displayPath;
}

export function resolveContentSearchScope(
  roots: readonly WorkspaceRoot[],
  mode: ContentSearchScopeMode,
  alias: string | undefined,
  selectedHandle: string | null,
  hasStandalone = false
): SearchScope | RootFailure {
  if (alias !== undefined || mode === "selected") {
    const resolved = resolveContentSearchRoot(roots, alias, selectedHandle);
    return resolved.ok ? { ok: true, kind: "single", roots: [resolved.root] } : resolved;
  }
  return roots.length || hasStandalone
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
      standaloneHandles: readonly string[];
      current(latest: FolderState, selection: ScopeSelection, standalone?: readonly DocumentEntry[]): boolean;
    })
  | RootFailure
  | { ok: false; error: "not-ready" | "limit" | "incomplete" };

export function captureContentSearchScope(
  workspace: FolderState,
  mode: ContentSearchScopeMode,
  alias: string | undefined,
  selection: ScopeSelection,
  fileFilters: readonly string[],
  pathFilters: readonly ContentSearchPathFilter[],
  standalone: readonly DocumentEntry[] = []
): Capture {
  const resolved = resolveContentSearchScope(workspace.roots, mode, alias, selection.handle, standalone.length > 0);
  if (!resolved.ok) return resolved;
  if (resolved.roots.length > CONTENT_SEARCH_LIMITS.roots)
    return { ok: false, error: "limit" };
  if (workspace.busy || workspace.error)
    return { ok: false, error: "not-ready" };

  const { kind } = resolved;
  const expanded = kind === "single" && fileFilters.length + pathFilters.length > 0 &&
    resolved.roots[0].entries <= CONTENT_SEARCH_LIMITS.filteredRootEntries;
  const leaves = kind === "all" ? standalone : [];
  if (leaves.length > CONTENT_SEARCH_LIMITS.standaloneHandles ||
      leaves.length > CONTENT_SEARCH_LIMITS.coverageDocuments)
    return { ok: false, error: "limit" };
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
  const needsPath = kind === "all" || pathFilters.length > 0 || expanded;
  let fileCount = leaves.length;
  for (const [index, root] of roots.entries()) {
    for (const node of pages[index] ?? []) {
      if (!expanded && node.kind !== "file") continue;
      if (!expanded && ++fileCount > CONTENT_SEARCH_LIMITS.coverageDocuments)
        return { ok: false, error: "limit" };
      if (handles.has(node.handle) || paths.has(node.displayPath))
        return { ok: false, error: "incomplete" };
      handles.add(node.handle);
      paths.add(node.displayPath);
      const path = relativeContentSearchPath(root.displayPath, node.displayPath);
      if (needsPath && path === undefined)
        return { ok: false, error: "incomplete" };
      if (expanded && path !== undefined && node.name !== path.slice(path.lastIndexOf("/") + 1))
        return { ok: false, error: "incomplete" };
      if (node.kind !== "file") continue;
      if (
        matchesContentSearchFileFilters(node.name, fileFilters) &&
        (path === undefined || matchesContentSearchPathFilters(path, pathFilters))
      ) {
        if (expanded && entries.size >= CONTENT_SEARCH_LIMITS.coverageDocuments)
          return { ok: false, error: "limit" };
        entries.set(node.handle, { root, name: node.name, relativePath: path, displayPath: node.displayPath });
      }
    }
  }

  const locations = new Set<string>();
  const documents = new Set<string>();
  for (const leaf of leaves) {
    const { handle, locationId, documentId, displayPath, fileName } = leaf;
    const path = displayPath && relativeContentSearchPath("/", displayPath);
    if (leaf.explicitStandalone !== true || !path || !handle || !documentId || !locationId ||
        fileName !== path.slice(path.lastIndexOf("/") + 1) ||
        handles.has(handle) || paths.has(displayPath) ||
        locations.has(locationId) || documents.has(documentId))
      return { ok: false, error: "incomplete" };
    handles.add(handle);
    paths.add(displayPath);
    locations.add(locationId);
    documents.add(documentId);
    if (matchesContentSearchFileFilters(fileName, fileFilters) &&
        matchesContentSearchPathFilters(fileName, pathFilters))
      entries.set(handle, { root: null, standalone: leaf, name: fileName, displayPath });
  }

  const selectionRevision = selection.revision;
  return {
    ok: true,
    kind,
    roots,
    entries,
    standaloneHandles: leaves.map(({ handle }) => handle),
    current(latest, selection, currentLeaves = []) {
      if (latest.busy || latest.error ||
          (mode === "selected" && alias === undefined && selection.revision !== selectionRevision))
        return false;
      const current = resolveContentSearchScope(latest.roots, mode, alias, selection.handle, currentLeaves.length > 0);
      return current.ok && current.kind === kind && current.roots.length === roots.length &&
        roots.every((root, index) =>
          sameRoot(root, current.roots[index]) && latest.nodes[root.handle] === pages[index]
        ) && (kind === "single" || (
          currentLeaves.length === leaves.length &&
          leaves.every((leaf, index) => sameContentSearchStandalone(leaf, currentLeaves[index]))
        ));
    },
  };
}
