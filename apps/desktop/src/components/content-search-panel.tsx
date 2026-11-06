import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { mergeContentSearch, type ContentSearchHitGroup } from "@/client/content-search";
import type { ContentSearchLocation } from "@/client/content-search-location";
import { createContentSearchPreview } from "@/client/content-search-preview";
import {
  captureContentSearchScope,
  createContentSearchStandaloneProjection,
  projectContentSearchStandalone,
  resolveContentSearchScope,
  type ContentSearchScopeMode,
} from "@/client/content-search-scope";
import { sameRetainedIdentity, type DocumentEntry, type createDocumentController } from "@/client/documents";
import type { FolderState, createFolderWorkspace } from "@/client/workspace";
import { electrobun } from "@/lib/electrobun";
import {
  CONTENT_SEARCH_LIMITS,
  validContentSearchPrepareResponse,
  validContentSearchRequest,
  validContentSearchResponse,
  type ContentSearchDocumentBinding,
  type ContentSearchError,
  type ContentSearchPrepareRequest,
  type ContentSearchProgress,
  type ContentSearchRequest,
} from "@/shared/content-search";
import {
  CONTENT_SEARCH_FILTER_COUNT_LIMIT,
  CONTENT_SEARCH_FILTER_TEXT_LIMIT,
  formatContentSearchFilter,
  parseContentSearchFilters,
  relativeContentSearchPath,
  selectContentSearchRootFilter,
} from "@/shared/content-search-filters";
import type { ContentSearchFragments } from "@/shared/content-search-fragments";
import type { DocumentRequest } from "@/shared/documents";
import type { WorkspaceRoot } from "@/shared/workspace";

const errors: Record<ContentSearchError, string> = {
  DISABLED: "此窗口暂不提供正文搜索。",
  INVALID: "查询无效，请检查搜索词。",
  STALE: "文件夹或文档状态已变更，请重新查询。",
  NOT_READY: "搜索范围尚未准备好，请等待文件夹扫描完成。",
  LIMIT: "查询超出文件夹数量、目录条目数、文档数量或正文大小上限。",
  BUSY: "上一项查询仍在收尾，请稍后重试。",
  CANCELLED: "查询已取消。",
  UNKNOWN: "索引状态尚未确认。",
  UNAVAILABLE: "暂时无法完整查询此范围。",
};
const incomplete = "查询范围不完整，部分文档的内容版本无法确认。";
const changed = "文件夹或文档状态已变更，请重新查询。";
const initialStatus = "输入字面量后开始查询。";
const emptyStandalone: readonly DocumentEntry[] = [];
const filterErrors = {
  invalid: "筛选条件无效。请检查空值、引号、重复项和路径写法。",
  unsupported: "此处支持 root:、file:、path: 和 -path:。",
  limit: "筛选条件过长或超过 8 条。",
};
const rootErrors = {
  ambiguous: "当前窗口有同名文件夹，请用完整路径区分，或从筛选菜单选择。",
  unknown: "当前窗口没有加入此文件夹。",
  selection: "请在文件树选中顶层文件夹，或添加 root: 筛选条件。",
};
const scopeErrors = {
  ...rootErrors,
  "not-ready": errors.NOT_READY,
  limit: errors.LIMIT,
  incomplete,
};
const filterGroups = [
  { kind: "file", label: "文件名" },
  { kind: "path", label: "包含路径" },
  { kind: "-path", label: "排除路径" },
] as const;
const buttonClass =
  "hover:bg-muted focus-visible:outline-ring rounded border px-2 py-1 text-xs focus-visible:outline-2 disabled:opacity-50";
const fieldClass =
  "bg-background focus-visible:outline-ring w-full min-w-0 rounded border px-2 py-1 text-xs focus-visible:outline-2 disabled:opacity-50";

type Query = Extract<ContentSearchRequest, { op: "query" | "query-workspace" }>;
type SearchMatch = ContentSearchHitGroup["matches"][number];
interface GroupLabel {
  name: string;
  rootLabel: string;
  relativePath?: string;
}
type PresentedGroup = ContentSearchHitGroup & GroupLabel & {
  root: WorkspaceRoot | null;
  retained?: DocumentEntry;
  location: Omit<ContentSearchLocation, "from" | "to">;
  binding?: ContentSearchDocumentBinding;
};
interface Presented {
  covered: number;
  groups: PresentedGroup[];
  search: SearchLifetime;
}
type FocusedHit = Pick<PresentedGroup, "entry" | "name" | "rootLabel" | "relativePath" | "matches">;
interface PresentedPreview {
  query: string;
  processed: number;
  expected: number;
  groups: (GroupLabel & ContentSearchFragments & { entry: string })[];
}
interface SearchLifetime {
  request: Query;
  scopeCurrent(): boolean;
  current(): boolean;
  pending: boolean;
  stopProgress?: () => void;
}
interface LocationIntent {
  current: () => boolean;
  pendingId: string | null;
}

function envelope() {
  return { protocolVersion: 1 as const, requestId: crypto.randomUUID() };
}

function matchKey(entry: string, { from, to }: SearchMatch) {
  return `${entry}:${from}:${to}`;
}

function stopSearchProgress(search: SearchLifetime) {
  const stop = search.stopProgress;
  search.stopProgress = undefined;
  stop?.();
}

function ResultGroupLabel({ name, rootLabel, relativePath }: GroupLabel) {
  return (
    <>
      <span className="font-medium">{name}</span>
      <span className="text-muted-foreground block">{rootLabel}</span>
      {relativePath && <span className="text-muted-foreground block">{relativePath}</span>}
    </>
  );
}

function ResultSnippet({ query, match }: { query: string; match: SearchMatch }) {
  return (
    <span className="block whitespace-pre-wrap break-all">
      {match.before}
      <mark className="rounded-sm bg-yellow-200 px-0.5 font-semibold text-neutral-900 dark:bg-yellow-300">
        {query}
      </mark>
      {match.after}
    </span>
  );
}

function cancel(requestId: string) {
  void electrobun.rpc?.request
    .contentSearchRequest({
      ...envelope(),
      op: "cancel",
      targetRequestId: requestId,
    })
    .catch(() => undefined);
}

function pickableFilters(
  roots: readonly WorkspaceRoot[] | undefined,
  nodes: FolderState["nodes"],
  leaves: readonly DocumentEntry[]
) {
  if (!roots || roots.length > CONTENT_SEARCH_LIMITS.roots) return [];
  let count = leaves.length;
  if (count > CONTENT_SEARCH_LIMITS.standaloneHandles ||
      count > CONTENT_SEARCH_LIMITS.coverageDocuments) return [];
  const pages = roots.map(({ handle }) => nodes[handle] ?? []);
  if (roots.some((root, index) => root.status !== "complete" || pages[index].length !== root.entries))
    return [];
  const published = pages.reduce((total, entries) => total + entries.length, leaves.length);
  const limit = published <= CONTENT_SEARCH_LIMITS.filteredEntries
    ? CONTENT_SEARCH_LIMITS.filteredEntries : CONTENT_SEARCH_LIMITS.coverageDocuments;
  const names = new Set(leaves.map(({ fileName }) => fileName));
  const paths = new Set(names);
  for (const [index, root] of roots.entries()) {
    for (const node of pages[index]) {
      if (node.kind !== "file") continue;
      if (++count > limit) return [];
      names.add(node.name);
      const path = relativeContentSearchPath(root.displayPath, node.displayPath);
      if (path) paths.add(path);
    }
  }
  return filterGroups.map(({ kind, label }) => ({
    kind,
    label,
    options: [...(kind === "file" ? names : paths)].flatMap((value) => {
      const token = formatContentSearchFilter(kind, value);
      return parseContentSearchFilters(token).ok ? [{ value, token }] : [];
    }),
  }));
}

export function ContentSearchPanel({
  selectedRoot,
  getSelection,
  selectionRevision,
  controller,
  folders,
}: {
  selectedRoot: WorkspaceRoot | undefined;
  getSelection: () => { handle: string | null; revision: number };
  selectionRevision: number;
  controller: ReturnType<typeof createDocumentController>;
  folders: ReturnType<typeof createFolderWorkspace>;
}) {
  const inputId = useId();
  const scopeId = useId();
  const filterId = useId();
  const filterErrorId = useId();
  const pickerId = useId();
  const resultId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<SearchLifetime | null>(null);
  const location = useRef<LocationIntent | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scopeMode, setScopeMode] = useState<ContentSearchScopeMode>("selected");
  const [filterText, setFilterText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [result, setResult] = useState<Presented | null>(null);
  const [preview, setPreview] = useState<PresentedPreview | null>(null);
  // Retain the clicked DOM button when the document load invalidates its results.
  const [focusedHit, setFocusedHit] = useState<FocusedHit | null>(null);
  const filters = useMemo(() => parseContentSearchFilters(filterText), [filterText]);
  const workspace = folders.getSnapshot();
  const { roots, nodes, coveredHandles } = workspace;
  const mode = roots.length ? scopeMode : "all";
  const selectedHandle = selectedRoot?.handle ?? null;
  const canResolve = filters.ok;
  const rootAlias = filters.ok ? filters.root?.alias : undefined;
  const entries = controller.getSnapshot().entries;
  const standalone = useMemo(() => mode === "all" && rootAlias === undefined
    ? projectContentSearchStandalone(roots, nodes, coveredHandles, entries)
    : emptyStandalone, [mode, rootAlias, roots, nodes, coveredHandles, entries]);
  const resolution = useMemo(() => canResolve
    ? resolveContentSearchScope(roots, mode, rootAlias, selectedHandle, standalone.length > 0)
    : undefined, [canResolve, roots, mode, rootAlias, selectedHandle, standalone.length]);
  const effectiveRoots = resolution?.ok ? resolution.roots : undefined;
  const effectiveKind = resolution?.ok ? resolution.kind : undefined;
  const searchRoot = effectiveKind === "single" ? effectiveRoots?.[0] : undefined;
  const ready = !!effectiveRoots && !workspace.busy && !workspace.error &&
    effectiveRoots.every((root) => root.status === "complete" &&
      (nodes[root.handle]?.length ?? 0) === root.entries);
  const filterError = filters.ok
    ? resolution?.ok === false && resolution.error !== "selection" ? rootErrors[resolution.error] : undefined
    : filterErrors[filters.error];
  const rootChoices = useMemo(() => workspace.roots.flatMap((root) => {
    const token = formatContentSearchFilter("root", root.displayPath);
    return parseContentSearchFilters(token).ok
      ? [{ handle: root.handle, alias: root.displayPath, label: `${root.name} · ${root.displayPath}`, token }]
      : [];
  }), [workspace.roots]);
  const rootOptions = useMemo(() => {
    if (!filters.ok) return [];
    const existing = filters.root;
    const room = !!existing ||
      filters.fileFilters.length + filters.pathFilters.length < CONTENT_SEARCH_FILTER_COUNT_LIMIT;
    const separator = filterText && !/\s$/u.test(filterText) ? 1 : 0;
    return rootChoices.map((option) => ({
      ...option,
      available: room && (existing
        ? filterText.length - (existing.to - existing.from) + option.token.length
        : filterText.length + separator + option.token.length) <= CONTENT_SEARCH_FILTER_TEXT_LIMIT,
    }));
  }, [filterText, filters, rootChoices]);
  const pickerGroups = useMemo(
    () => open && ready
      ? pickableFilters(effectiveRoots, nodes, effectiveKind === "all" ? standalone : [])
      : [],
    [open, ready, effectiveRoots, nodes, effectiveKind, standalone]
  );
  const pickerOptions = useMemo(() => {
    const previous = filterText.trimEnd();
    const room = filters.ok &&
      filters.fileFilters.length + filters.pathFilters.length + Number(!!filters.root) <
        CONTENT_SEARCH_FILTER_COUNT_LIMIT;
    return pickerGroups.map((group) => ({
      ...group,
      options: group.options.map((option) => {
        const next = previous ? `${previous} ${option.token}` : option.token;
        const repeated = filters.ok && (group.kind === "file"
          ? filters.fileFilters.includes(option.value)
          : filters.pathFilters.some(({ kind, value }) => kind === group.kind && value === option.value));
        return {
          ...option,
          next,
          available: room && !repeated && next.length <= CONTENT_SEARCH_FILTER_TEXT_LIMIT,
        };
      }),
    }));
  }, [filterText, filters, pickerGroups]);

  const retire = useCallback(() => {
    const previous = active.current;
    active.current = null;
    if (!previous) return;
    stopSearchProgress(previous);
    if (previous.pending) cancel(previous.request.requestId);
  }, []);

  const retireLocation = useCallback(() => {
    const previous = location.current;
    location.current = null;
    if (previous?.pendingId) cancel(previous.pendingId);
  }, []);

  const cancelLocation = useCallback(
    (message: string) => {
      if (!location.current) return;
      retireLocation();
      setStatus(message);
    },
    [retireLocation]
  );

  const reset = useCallback(
    (message: string) => {
      retire();
      setPreview(null);
      setResult(null);
      setBusy(false);
      if (!location.current) setStatus(message);
    },
    [retire]
  );

  useLayoutEffect(() => {
    const check = () => {
      const search = active.current;
      if (search && !search.current()) reset(changed);
      if (location.current && !location.current.current()) cancelLocation(changed);
    };
    const stopDocuments = controller.subscribe(check);
    const stopFolders = folders.subscribe(check);
    check();
    return () => {
      stopDocuments();
      stopFolders();
      retire();
      retireLocation();
    };
  }, [cancelLocation, controller, folders, reset, retire, retireLocation]);

  // Selection can change without a workspace publication.
  useLayoutEffect(() => {
    if (active.current && !active.current.current()) reset(changed);
    if (location.current && !location.current.current()) cancelLocation(changed);
  }, [cancelLocation, reset, selectedRoot, selectionRevision]);

  useLayoutEffect(() => {
    const cancelOnInteraction = () => cancelLocation("已取消定位。");
    window.addEventListener("pointerdown", cancelOnInteraction, true);
    window.addEventListener("keydown", cancelOnInteraction, true);
    window.addEventListener("focusin", cancelOnInteraction, true);
    window.addEventListener("blur", cancelOnInteraction);
    return () => {
      window.removeEventListener("pointerdown", cancelOnInteraction, true);
      window.removeEventListener("keydown", cancelOnInteraction, true);
      window.removeEventListener("focusin", cancelOnInteraction, true);
      window.removeEventListener("blur", cancelOnInteraction);
    };
  }, [cancelLocation]);

  useLayoutEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  function changeFilters(value: string) {
    if (value === filterText) return;
    cancelLocation("已取消定位。");
    setFocusedHit(null);
    setFilterText(value);
    reset(initialStatus);
  }

  function changeScope(value: ContentSearchScopeMode) {
    if (value === scopeMode) return;
    cancelLocation("已取消定位。");
    setFocusedHit(null);
    setScopeMode(value);
    reset(initialStatus);
  }

  async function search() {
    if (!ready || busy) return;
    cancelLocation("已取消定位。");
    setFocusedHit(null);
    reset(initialStatus);
    if (!filters.ok) return;
    const selection = getSelection();
    const workspace = folders.getSnapshot();
    const mixed = mode === "all" && rootAlias === undefined;
    const renderRosterCurrent = (latest: FolderState, latestEntries: readonly DocumentEntry[]) =>
      latest.roots === roots && latest.nodes === nodes &&
      latest.coveredHandles === coveredHandles && latestEntries === entries;
    if (mixed && !renderRosterCurrent(workspace, controller.getSnapshot().entries)) {
      setStatus(changed);
      return;
    }
    const scope = captureContentSearchScope(
      workspace, mode, rootAlias, selection, filters.fileFilters, filters.pathFilters, standalone
    );
    if (!scope.ok) {
      setStatus(scopeErrors[scope.error]);
      return;
    }
    const root = scope.roots[0];
    if ((!root && scope.kind === "single") || scope.kind !== effectiveKind ||
      scope.roots.length !== effectiveRoots?.length ||
      !scope.roots.every(({ handle, generation }, index) =>
        handle === effectiveRoots[index].handle && generation === effectiveRoots[index].generation)
    ) {
      setStatus(changed);
      return;
    }
    const files = scope.entries;
    const capture = controller.captureContentSearch();
    if (!capture.ok) {
      setStatus(capture.reason === "limit" ? errors.LIMIT : incomplete);
      return;
    }
    const params = {
      ...envelope(),
      query,
      fragments: true as const,
      stream: true as const,
      handles: capture.documents.map(({ handle }) => handle),
      ...(filters.fileFilters.length ? { fileFilters: filters.fileFilters } : {}),
      ...(filters.pathFilters.length ? { pathFilters: filters.pathFilters } : {}),
    };
    const request: Query = scope.kind === "all"
      ? { ...params, op: "query-workspace", roots: scope.roots.map(({ handle, generation }) => ({ handle, generation })), standaloneHandles: scope.standaloneHandles }
      : { ...params, op: "query", root: root.handle, generation: root.generation };
    if (!validContentSearchRequest(request)) {
      setStatus(errors.INVALID);
      return;
    }
    const rootNameCounts = new Map<string, number>();
    const fileNameCounts = new Map<string, number>();
    for (const item of scope.roots)
      rootNameCounts.set(item.name, (rootNameCounts.get(item.name) ?? 0) + 1);
    for (const { name } of files.values())
      fileNameCounts.set(name, (fileNameCounts.get(name) ?? 0) + 1);
    const labels = new Map<string, GroupLabel>();
    for (const [entry, file] of files) {
      const rootLabel = file.root
        ? (rootNameCounts.get(file.root.name) ?? 0) > 1
          ? `${file.root.name} · ${file.root.displayPath}`
          : file.root.name
        : (fileNameCounts.get(file.name) ?? 0) > 1 ? `独立文件 · ${file.displayPath}` : "独立文件";
      labels.set(entry, { name: file.name, rootLabel, relativePath: file.relativePath });
    }
    const projectStandalone = createContentSearchStandaloneProjection();
    const search: SearchLifetime = {
      request,
      pending: true,
      scopeCurrent() {
        const workspace = folders.getSnapshot();
        const latestEntries = controller.getSnapshot().entries;
        const latestStandalone = scope.kind === "single" ? emptyStandalone
          : renderRosterCurrent(workspace, latestEntries) ? standalone
            : projectStandalone(workspace, latestEntries);
        return scope.current(
          workspace,
          getSelection(),
          latestStandalone
        );
      },
      current() {
        return this.scopeCurrent() && capture.current();
      },
    };
    if (!search.current()) {
      setStatus(changed);
      return;
    }
    const receiver = createContentSearchPreview(request, files, controller.getSnapshot().tabs.map(({ displayPath }) => displayPath));
    const showPreview = (value: ContentSearchProgress) => {
      if (active.current !== search || !search.pending) return;
      if (!search.current()) {
        reset(changed);
        return;
      }
      const update = receiver.accept(value);
      if (update.kind === "discard") {
        stopSearchProgress(search);
        setPreview(null);
      } else if (update.kind === "update") {
        setPreview({
          query,
          expected: files.size,
          processed: update.snapshot.processed,
          groups: update.snapshot.groups.flatMap(({ entry, fragments }) => {
            const label = labels.get(entry);
            return label ? [{ entry, ...label, ...fragments }] : [];
          }),
        });
      }
    };
    active.current = search;
    setPreview({ query, processed: 0, expected: files.size, groups: [] });
    setBusy(true);
    setStatus("正在查询正文…");
    try {
      const rpc = electrobun.rpc;
      if (rpc) {
        search.stopProgress = () => rpc.removeMessageListener("contentSearchProgress", showPreview);
        rpc.addMessageListener("contentSearchProgress", showPreview);
      }
      const response: unknown = await rpc?.request.contentSearchRequest(request);
      if (active.current !== search) return;
      search.pending = false;
      stopSearchProgress(search);
      setPreview(null);
      if (!search.current()) {
        reset(changed);
        return;
      }
      if (!validContentSearchResponse(response, request)) {
        reset("无法确认查询响应，请重试。");
        return;
      }
      if (!response.ok) {
        reset(errors[response.error]);
        return;
      }
      if (
        response.op !== request.op ||
        response.coverage.length !== files.size ||
        response.coverage.some(({ entry }) => !files.has(entry))
      ) {
        reset(incomplete);
        return;
      }
      const merged = mergeContentSearch(query, capture.documents, response, true);
      if (!merged.ok) {
        reset(merged.reason === "limit" ? errors.LIMIT : incomplete);
        return;
      }
      const coverage = new Map(response.coverage.map((row) => [row.entry, row]));
      const versions = new Map(capture.documents.map((doc) => [doc.handle, doc]));
      const bindings = new Map<string, ContentSearchDocumentBinding>();
      for (const mapping of response.mappings) {
        if (mapping.kind !== "matched") continue;
        const { handle, documentId, revision, hash } = mapping;
        bindings.set(mapping.entry, { handle, documentId, revision, hash });
      }
      const groups: PresentedGroup[] = [];
      const retainedByPath = new Map<string, DocumentEntry | null>();
      for (const entry of controller.getSnapshot().entries) {
        if (!entry.displayPath) continue;
        retainedByPath.set(entry.displayPath,
          retainedByPath.has(entry.displayPath) || typeof entry.explicitStandalone !== "boolean" || !entry.locationId
            ? null : entry);
      }
      let visibleMatches = 0;
      for (const group of merged.groups) {
        const file = files.get(group.entry);
        const label = labels.get(group.entry);
        const diskHash = coverage.get(group.entry)?.hash;
        const binding = bindings.get(group.entry);
        const version = binding && versions.get(binding.handle);
        if (!file || !label?.name || !diskHash || ((binding || group.source === "memory") && !version) ||
            (!file.root && binding && binding.handle !== file.standalone.handle) ||
            (file.root && !binding && retainedByPath.get(file.displayPath) === null)) {
          reset(incomplete);
          return;
        }
        const retained = file.standalone ?? (!binding ? retainedByPath.get(file.displayPath) ?? undefined : undefined);
        groups.push({
          ...group,
          ...label,
          root: file.root,
          retained,
          binding,
          location: { query, source: group.source, diskHash, version },
        });
        visibleMatches += group.matches.length;
      }
      setResult({ covered: merged.covered, groups, search });
      setStatus(groups.length ? `命中 ${groups.length} 篇，显示 ${visibleMatches} 处。` : "未找到匹配正文。");
      setBusy(false);
    } catch {
      if (active.current === search) reset("正文查询通信失败，请重试。");
    }
  }

  async function openHit(
    group: PresentedGroup,
    { from, to }: SearchMatch,
    search: SearchLifetime,
    button: HTMLButtonElement
  ) {
    if (active.current !== search) return;
    if (!search.current()) {
      reset(changed);
      return;
    }
    retireLocation();
    const activation = controller.getContentSearchActivation();
    const { retained, root, entry, binding } = group;
    const targetLocation = { ...group.location, from, to };
    const retainedCurrent = () => {
      if (!retained) return true;
      const peers = controller.getSnapshot().entries.filter((entry) =>
        entry.displayPath === retained.displayPath
      );
      return peers.length === 1 && sameRetainedIdentity(retained, peers[0]);
    };
    let awaitingPrepare = true;
    const intent: LocationIntent = {
      pendingId: null,
      current: () =>
        location.current === intent &&
        search.scopeCurrent() &&
        retainedCurrent() &&
        (!awaitingPrepare ||
          (active.current === search &&
            controller.getContentSearchActivation() === activation &&
            search.current())),
    };
    location.current = intent;
    setFocusedHit(button === document.activeElement ? {
      entry,
      name: group.name,
      rootLabel: group.rootLabel,
      relativePath: group.relativePath,
      matches: [{ from, to, before: "", after: "" }],
    } : null);
    setStatus("正在打开并定位…");
    let failure = "无法定位此命中，请重新查询。";

    async function prepare(params: DocumentRequest) {
      if (!intent.current()) return null;
      const { protocolVersion, requestId } = params;
      const common = {
        protocolVersion,
        requestId,
        expectedHash: targetLocation.diskHash,
        ...(binding ? { binding } : {}),
      };
      const request: ContentSearchPrepareRequest | null = retained
        ? {
          ...common,
          op: "prepare-retained",
          entry: retained.handle,
          roots: root
            ? [{ handle: root.handle, generation: root.generation }]
            : search.request.op === "query-workspace" ? search.request.roots : [],
          ...(root ? { rootEntry: entry } : {}),
        }
        : root ? { ...common, entry, root: root.handle, generation: root.generation } : null;
      if (!request) return null;
      intent.pendingId = requestId;
      try {
        const response: unknown =
          await electrobun.rpc?.request.prepareContentSearchDocument(request);
        if (!validContentSearchPrepareResponse(response, request)) {
          failure = "无法确认定位响应，请重新查询。";
          return null;
        }
        if (!response.ok) {
          failure = errors[response.error];
          return null;
        }
        // Return late open grants to the controller so it can release them.
        return response.target;
      } catch {
        failure = "定位通信失败，请重新查询。";
        return null;
      } finally {
        intent.pendingId = null;
      }
    }

    let positioned = false;
    try {
      if (binding) {
        const target = await prepare(envelope());
        if (intent.current() && target?.kind === "reuse") {
          awaitingPrepare = false;
          positioned = await controller.activateContentSearchLocation(targetLocation, intent.current);
        }
      } else if (retained) {
        positioned = await controller.openRetainedContentSearchLocation(retained, async (params) => {
          const target = await prepare(params);
          if (target?.kind === "retained" && intent.current()) awaitingPrepare = false;
          return target?.kind === "retained"
            ? { ...params, ok: true, snapshot: target.snapshot }
            : { ...params, ok: false, error: intent.current() ? "INVALID_HANDLE" : "CANCELLED" };
        }, targetLocation, intent.current);
      } else {
        positioned = await controller.openContentSearchLocation(async (params) => {
          const target = await prepare(params);
          if (target?.kind === "open" && intent.current()) awaitingPrepare = false;
          return target?.kind === "open"
            ? { ...params, ok: true, snapshot: target.snapshot }
            : { ...params, ok: false, error: intent.current() ? "INVALID_HANDLE" : "CANCELLED" };
        }, targetLocation, intent.current);
      }
    } catch {
      failure = "无法打开文档并定位此命中，请重新查询。";
    }
    if (location.current !== intent) return;
    if (!intent.current()) {
      cancelLocation(changed);
      return;
    }
    location.current = null;
    setStatus(positioned ? "已定位正文命中。" : failure);
  }

  const groups: (PresentedGroup | FocusedHit)[] = result?.groups ?? (focusedHit ? [focusedHit] : []);
  const hasWorkspaceFiles = roots.length > 0 || entries.some(({ explicitStandalone }) => explicitStandalone === true);

  return (
    <div className="min-w-0 shrink-0">
      <button
        type="button"
        ref={trigger}
        className={buttonClass}
        disabled={!hasWorkspaceFiles && !open}
        title={hasWorkspaceFiles ? undefined : "请先加入文件夹或打开独立文件。"}
        aria-expanded={open}
        aria-controls={open ? resultId : undefined}
        onClick={() => {
          if (open) {
            cancelLocation("已取消定位。");
            setFocusedHit(null);
            reset(initialStatus);
          }
          setOpen(!open);
        }}
      >
        搜索正文
      </button>
      {effectiveRoots?.length && !ready && !open ? (
        <p className="text-muted-foreground text-xs">{errors.NOT_READY}</p>
      ) : null}
      {open && (
        <section id={resultId} aria-label="正文搜索" className="mt-2 max-h-[40vh] space-y-2 overflow-auto rounded border p-2">
          <p className="text-muted-foreground break-words text-xs">
            {searchRoot
              ? `搜索范围：${searchRoot.name} · ${searchRoot.displayPath}`
              : effectiveKind === "all"
                ? `搜索范围：当前窗口（${effectiveRoots?.length ?? 0} 个文件夹，${standalone.length} 个独立文件）`
                : resolution?.ok === false && resolution.error === "selection" ? rootErrors.selection : "请确认搜索范围。"}
          </p>
          {effectiveRoots?.length && !ready ? <p className="text-muted-foreground text-xs">{errors.NOT_READY}</p> : null}
          <p className="text-muted-foreground text-xs">
            区分大小写，每篇最多显示前三处命中。普通范围最多 {CONTENT_SEARCH_LIMITS.roots} 个文件夹，筛选前合计 {CONTENT_SEARCH_LIMITS.coverageDocuments} 篇。
            可选择或输入 file:、path: 或 -path: 缩小范围。超过 {CONTENT_SEARCH_LIMITS.coverageDocuments} 篇时，筛选最多检查 {CONTENT_SEARCH_LIMITS.filteredEntries} 个文件、目录和独立文档条目。
            每次最多查询 {CONTENT_SEARCH_LIMITS.coverageDocuments} 篇正文，合计 {CONTENT_SEARCH_LIMITS.aggregateBytes / 1024} KiB。
          </p>
          <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void search(); }}>
            <div className="flex items-center gap-2">
              <label className="shrink-0 text-xs" htmlFor={scopeId}>搜索范围</label>
              <select
                id={scopeId}
                className={fieldClass}
                value={mode}
                onChange={(event) => changeScope(event.target.value === "all" ? "all" : "selected")}
              >
                <option value="selected" disabled={!roots.length}>选中的文件夹</option>
                <option value="all">当前窗口</option>
              </select>
            </div>
            <label className="block text-xs" htmlFor={inputId}>字面量查询</label>
            <input
              id={inputId}
              ref={input}
              className={fieldClass}
              type="search"
              maxLength={CONTENT_SEARCH_LIMITS.query}
              value={query}
              onChange={(event) => {
                cancelLocation("已取消定位。");
                setFocusedHit(null);
                setQuery(event.target.value);
                reset(initialStatus);
              }}
            />
            <label className="block text-xs" htmlFor={filterId}>搜索筛选条件</label>
            <input
              id={filterId}
              className={fieldClass}
              type="text"
              maxLength={CONTENT_SEARCH_FILTER_TEXT_LIMIT}
              placeholder={'root:"项目 甲" file:纪要'}
              value={filterText}
              aria-invalid={!!filterError}
              aria-describedby={filterError ? filterErrorId : undefined}
              onChange={(event) => changeFilters(event.target.value)}
            />
            {filterError && <p id={filterErrorId} role="alert" className="text-destructive text-xs">{filterError}</p>}
            <label className="block text-xs" htmlFor={pickerId}>选择筛选条件</label>
            <select
              id={pickerId}
              className={fieldClass}
              value=""
              disabled={!rootOptions.some(({ available }) => available) &&
                !pickerOptions.some(({ options }) => options.some(({ available }) => available))}
              onChange={(event) => {
                const choice = event.target.value;
                const rootOption = rootOptions.find(({ handle }) => handle === choice);
                if (rootOption?.available) {
                  const next = selectContentSearchRootFilter(filterText, rootOption.alias);
                  if (next !== undefined) changeFilters(next);
                  return;
                }
                const option = pickerOptions.flatMap(({ options }) => options)
                  .find(({ token }) => token === choice);
                if (option?.available) changeFilters(option.next);
              }}
            >
              <option value="">选择后添加到筛选栏</option>
              {rootOptions.length > 0 && (
                <optgroup label="搜索文件夹">
                  {rootOptions.map(({ handle, label, available }) => (
                    <option key={handle} value={handle} disabled={!available}>{label}</option>
                  ))}
                </optgroup>
              )}
              {pickerOptions.map(({ kind, label, options }) => options.length > 0 && (
                <optgroup key={kind} label={label}>
                  {options.map(({ token, value, available }) => (
                    <option key={token} value={token} disabled={!available}>{value}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="flex flex-wrap gap-1">
              <button type="submit" className={buttonClass} disabled={!ready || busy || !query.trim() || !filters.ok}>查询正文</button>
              <button type="button" className={buttonClass} disabled={!busy} onClick={() => reset(errors.CANCELLED)}>取消查询</button>
              <button type="button" className={buttonClass} onClick={() => {
                cancelLocation("已取消定位。");
                setFocusedHit(null);
                reset(initialStatus);
                setOpen(false);
                trigger.current?.focus();
              }}>关闭</button>
            </div>
          </form>
          <p role="status" className="break-words text-xs">{status}</p>
          {busy && preview && (
            <section aria-label="搜索进度" className="space-y-1 rounded border border-dashed p-2 text-xs">
              <h3 className="font-medium">暂定命中</h3>
              <p aria-live="polite" className="text-muted-foreground">
                已核对 {preview.processed} / {preview.expected} 篇文档。
              </p>
              {preview.groups.length > 0 && (
                <ul aria-label="暂定命中片段" className="max-h-32 space-y-2 overflow-y-auto">
                  {preview.groups.map((group) => (
                    <li key={group.entry} className="break-words">
                      <ResultGroupLabel {...group} />
                      <ul className="my-1 space-y-1">
                        {group.matches.map((match) => (
                          <li key={matchKey(group.entry, match)} className="rounded border px-2 py-1">
                            <ResultSnippet query={preview.query} match={match} />
                          </li>
                        ))}
                      </ul>
                      {group.more && <p className="text-muted-foreground">此文件还有更多命中。</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {result && <p className="text-muted-foreground text-xs">本次覆盖 {result.covered} 篇文档。</p>}
          {groups.length > 0 && (
            <ul aria-label="正文搜索命中" className="max-h-32 space-y-2 overflow-y-auto text-xs">
              {groups.map((group) => {
                const current = "location" in group ? group : null;
                return (
                  <li key={group.entry} className="break-words">
                    <ResultGroupLabel {...group} />
                    <ul aria-label={`${group.name}的正文命中`} className="my-1 space-y-1">
                      {group.matches.map((match) => {
                        const key = matchKey(group.entry, match);
                        return (
                          <li key={key}>
                            <button
                              type="button"
                              className={`${buttonClass} w-full text-left`}
                              aria-disabled={!current || undefined}
                              tabIndex={current ? undefined : -1}
                              onBlur={() => {
                                if (focusedHit?.matches.some((item) => matchKey(focusedHit.entry, item) === key))
                                  setFocusedHit(null);
                              }}
                              onClick={(event) => {
                                if (current && result) void openHit(current, match, result.search, event.currentTarget);
                              }}
                            >
                              {current ? (
                                <>
                                  <ResultSnippet query={current.location.query} match={match} />
                                  <span className="text-muted-foreground block">
                                    {current.source === "memory" ? "未保存正文" : "磁盘正文"} · UTF-16 [{match.from}, {match.to})
                                  </span>
                                </>
                              ) : `命中片段 · UTF-16 [${match.from}, ${match.to})`}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {current?.more && <p className="text-muted-foreground">此文件还有更多命中。</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
