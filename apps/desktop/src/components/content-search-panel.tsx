import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { mergeContentSearch } from "@/client/content-search";
import type { ContentSearchLocation } from "@/client/content-search-location";
import type { createDocumentController } from "@/client/documents";
import type { createFolderWorkspace } from "@/client/workspace";
import { electrobun } from "@/lib/electrobun";
import {
  CONTENT_SEARCH_LIMITS,
  validContentSearchPrepareResponse,
  validContentSearchRequest,
  validContentSearchResponse,
  type ContentSearchDocumentBinding,
  type ContentSearchError,
  type ContentSearchPrepareRequest,
  type ContentSearchRequest,
} from "@/shared/content-search";
import {
  CONTENT_SEARCH_FILTER_COUNT_LIMIT,
  CONTENT_SEARCH_FILTER_TEXT_LIMIT,
  formatContentSearchFilter,
  matchesContentSearchFileFilters,
  matchesContentSearchPathFilters,
  parseContentSearchFilters,
  relativeContentSearchPath,
} from "@/shared/content-search-filters";
import type { DocumentRequest } from "@/shared/documents";
import type { WorkspaceNode, WorkspaceRoot } from "@/shared/workspace";

const errors: Record<ContentSearchError, string> = {
  DISABLED: "此窗口暂不提供正文搜索。",
  INVALID: "查询无效，请检查搜索词。",
  STALE: "文件夹或文档状态已变更，请重新查询。",
  NOT_READY: "此文件夹的扫描尚未完成。",
  LIMIT: "查询超出文档数量或正文大小上限。",
  BUSY: "上一项查询仍在收尾，请稍后重试。",
  CANCELLED: "查询已取消。",
  UNKNOWN: "索引状态尚未确认。",
  UNAVAILABLE: "暂时无法完整查询此文件夹。",
};
const incomplete = "查询范围不完整，部分文档的内容版本无法确认。";
const changed = "文件夹或文档状态已变更，请重新查询。";
const initialStatus = "输入字面量后开始查询。";
const filterErrors = {
  invalid: "筛选条件无效。请检查空值、引号、重复项和路径写法。",
  unsupported: "此处支持 file:、path: 和 -path:。",
  limit: "筛选条件过长或超过 8 条。",
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

type Query = Extract<ContentSearchRequest, { op: "query" }>;
type Merged = Extract<ReturnType<typeof mergeContentSearch>, { ok: true }>;
type PresentedHit = Merged["hits"][number] & {
  name: string;
  relativePath?: string;
  location: ContentSearchLocation;
  binding?: ContentSearchDocumentBinding;
};
interface Presented {
  covered: number;
  hits: PresentedHit[];
  search: SearchLifetime;
}
interface SearchLifetime {
  request: Query;
  scopeCurrent(): boolean;
  current(): boolean;
  pending: boolean;
}
interface LocationIntent {
  current: () => boolean;
  pendingId: string | null;
}

function envelope() {
  return { protocolVersion: 1 as const, requestId: crypto.randomUUID() };
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
  nodes: readonly WorkspaceNode[] | undefined,
  entries: number | undefined,
  rootPath: string | undefined
) {
  if (!nodes || nodes.length !== entries) return [];
  let count = 0;
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== "file") continue;
    if (++count > CONTENT_SEARCH_LIMITS.documents) return [];
    names.add(node.name);
    if (rootPath) {
      const path = relativeContentSearchPath(rootPath, node.displayPath);
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
  const [filterText, setFilterText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [result, setResult] = useState<Presented | null>(null);
  // Retain the clicked DOM button when the document load invalidates its results.
  const [focusedHit, setFocusedHit] = useState<Pick<PresentedHit, "entry" | "name"> | null>(null);
  const ready = selectedRoot?.status === "complete";
  const filters = useMemo(() => parseContentSearchFilters(filterText), [filterText]);
  const filterError = filters.ok ? undefined : filterErrors[filters.error];
  const rootNodes = open && ready ? folders.getSnapshot().nodes[selectedRoot.handle] : undefined;
  const entryCount = selectedRoot?.entries;
  const rootPath = selectedRoot?.displayPath;
  const pickerGroups = useMemo(
    () => pickableFilters(rootNodes, entryCount, rootPath),
    [rootNodes, entryCount, rootPath]
  );
  const pickerOptions = useMemo(() => {
    const previous = filterText.trimEnd();
    const room = filters.ok &&
      filters.fileFilters.length + filters.pathFilters.length < CONTENT_SEARCH_FILTER_COUNT_LIMIT;
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
    if (previous?.pending) cancel(previous.request.requestId);
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

  async function search() {
    if (!ready || busy) return;
    cancelLocation("已取消定位。");
    setFocusedHit(null);
    reset(initialStatus);
    if (!filters.ok) return;
    const selection = getSelection();
    const workspace = folders.getSnapshot();
    const root = workspace.roots.find((item) => item.handle === selection.handle);
    if (
      root?.handle !== selectedRoot.handle ||
      root.status !== "complete" ||
      workspace.busy ||
      workspace.error
    ) {
      setStatus(errors.NOT_READY);
      return;
    }
    const nodes = workspace.nodes[root.handle] ?? [];
    if (nodes.length !== root.entries) {
      setStatus(errors.NOT_READY);
      return;
    }
    const files = new Map<string, { name: string; path: string | undefined }>();
    const nameCounts = new Map<string, number>();
    let rootFileCount = 0;
    for (const node of nodes) {
      if (node.kind !== "file") continue;
      if (++rootFileCount > CONTENT_SEARCH_LIMITS.documents) {
        setStatus(errors.LIMIT);
        return;
      }
      const path = relativeContentSearchPath(root.displayPath, node.displayPath);
      nameCounts.set(node.name, (nameCounts.get(node.name) ?? 0) + 1);
      if (filters.pathFilters.length) {
        if (!path) {
          setStatus("查询范围不完整，无法确认文件的相对路径。");
          return;
        }
        if (!matchesContentSearchPathFilters(path, filters.pathFilters)) continue;
      }
      if (matchesContentSearchFileFilters(node.name, filters.fileFilters))
        files.set(node.handle, { name: node.name, path });
    }
    const capture = controller.captureContentSearch();
    if (!capture.ok) {
      setStatus(capture.reason === "limit" ? errors.LIMIT : incomplete);
      return;
    }
    const request: Query = {
      ...envelope(),
      op: "query",
      root: root.handle,
      generation: root.generation,
      query,
      handles: capture.documents.map(({ handle }) => handle),
      ...(filters.fileFilters.length ? { fileFilters: filters.fileFilters } : {}),
      ...(filters.pathFilters.length ? { pathFilters: filters.pathFilters } : {}),
    };
    if (!validContentSearchRequest(request)) {
      setStatus(errors.INVALID);
      return;
    }
    const search: SearchLifetime = {
      request,
      pending: true,
      scopeCurrent() {
        const latest = folders.getSnapshot();
        const latestRoot = latest.roots.find((item) => item.handle === root.handle);
        return (
          getSelection().revision === selection.revision &&
          latestRoot?.generation === root.generation &&
          latestRoot.displayPath === root.displayPath &&
          latestRoot.status === "complete" &&
          latestRoot.showHidden === root.showHidden &&
          latestRoot.observation === root.observation &&
          latestRoot.entries === root.entries &&
          latestRoot.errors === root.errors &&
          latest.nodes[root.handle] === workspace.nodes[root.handle] &&
          !latest.busy &&
          !latest.error
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
    active.current = search;
    setBusy(true);
    setStatus("正在查询正文…");
    try {
      const response: unknown = await electrobun.rpc?.request.contentSearchRequest(request);
      if (active.current !== search) return;
      if (!search.current()) {
        reset(changed);
        return;
      }
      if (!validContentSearchResponse(response, request)) {
        reset("无法确认查询响应，请重试。");
        return;
      }
      search.pending = false;
      if (!response.ok) {
        reset(errors[response.error]);
        return;
      }
      if (
        response.op !== "query" ||
        response.coverage.length !== files.size ||
        response.coverage.some(({ entry }) => !files.has(entry))
      ) {
        reset(incomplete);
        return;
      }
      const merged = mergeContentSearch(query, capture.documents, response);
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
      const hits: PresentedHit[] = [];
      for (const hit of merged.hits) {
        const file = files.get(hit.entry);
        const diskHash = coverage.get(hit.entry)?.hash;
        const binding = bindings.get(hit.entry);
        const version = binding && versions.get(binding.handle);
        if (!file?.name || !diskHash || ((binding || hit.source === "memory") && !version)) {
          reset(incomplete);
          return;
        }
        const { from, to, source } = hit;
        hits.push({
          ...hit,
          name: file.name,
          relativePath: (nameCounts.get(file.name) ?? 0) > 1 ? file.path : undefined,
          binding,
          location: { query, from, to, source, diskHash, version },
        });
      }
      setResult({ covered: merged.covered, hits, search });
      setStatus(merged.hits.length ? `命中 ${merged.hits.length} 篇。` : "未找到匹配正文。");
      setBusy(false);
    } catch {
      if (active.current === search) reset("正文查询通信失败，请重试。");
    }
  }

  async function openHit(hit: PresentedHit, search: SearchLifetime, button: HTMLButtonElement) {
    if (active.current !== search) return;
    if (!search.current()) {
      reset(changed);
      return;
    }
    retireLocation();
    const activation = controller.getContentSearchActivation();
    let awaitingPrepare = true;
    const intent: LocationIntent = {
      pendingId: null,
      current: () =>
        location.current === intent &&
        search.scopeCurrent() &&
        (!awaitingPrepare ||
          (active.current === search &&
            controller.getContentSearchActivation() === activation &&
            search.current())),
    };
    location.current = intent;
    setFocusedHit(button === document.activeElement ? { entry: hit.entry, name: hit.name } : null);
    setStatus("正在打开并定位…");
    let failure = "无法定位此命中，请重新查询。";

    async function prepare(params: DocumentRequest) {
      if (!intent.current()) return null;
      const { protocolVersion, requestId } = params;
      const request: ContentSearchPrepareRequest = {
        protocolVersion,
        requestId,
        root: search.request.root,
        generation: search.request.generation,
        entry: hit.entry,
        expectedHash: hit.location.diskHash,
        ...(hit.binding ? { binding: hit.binding } : {}),
      };
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
      if (hit.binding) {
        const target = await prepare(envelope());
        if (intent.current() && target?.kind === "reuse") {
          awaitingPrepare = false;
          positioned = await controller.activateContentSearchLocation(hit.location, intent.current);
        }
      } else {
        positioned = await controller.openContentSearchLocation(async (params) => {
          const target = await prepare(params);
          if (target?.kind === "open" && intent.current()) awaitingPrepare = false;
          return target?.kind === "open"
            ? { ...params, ok: true, snapshot: target.snapshot }
            : { ...params, ok: false, error: intent.current() ? "INVALID_HANDLE" : "CANCELLED" };
        }, hit.location, intent.current);
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

  const hits: (PresentedHit | (NonNullable<typeof focusedHit> & { location?: undefined }))[] =
    result?.hits ?? (focusedHit ? [focusedHit] : []);

  return (
    <div className="min-w-0 shrink-0">
      <button
        type="button"
        ref={trigger}
        className={buttonClass}
        disabled={!ready && !open}
        title={selectedRoot ? undefined : "请先在文件树选中顶层文件夹。"}
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
        在此文件夹中搜索正文
      </button>
      {selectedRoot && !ready && !open && (
        <p className="text-muted-foreground text-xs">{errors.NOT_READY}</p>
      )}
      {open && (
        <section id={resultId} aria-label="文件夹正文搜索" className="mt-2 max-h-[40vh] space-y-2 overflow-auto rounded border p-2">
          <p className="text-muted-foreground break-words text-xs">
            {selectedRoot ? `搜索范围：${selectedRoot.name}` : "请先在文件树选中顶层文件夹。"}
          </p>
          <p className="text-muted-foreground text-xs">
            区分大小写，每篇显示首个匹配。文件夹最多 16 篇，查询正文合计 64 KiB。
          </p>
          <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void search(); }}>
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
            <label className="block text-xs" htmlFor={filterId}>文件名与路径筛选</label>
            <input
              id={filterId}
              className={fieldClass}
              type="text"
              maxLength={CONTENT_SEARCH_FILTER_TEXT_LIMIT}
              placeholder={'path:"项目 甲/" -path:草稿'}
              value={filterText}
              aria-invalid={!!filterError}
              aria-describedby={filterError ? filterErrorId : undefined}
              onChange={(event) => changeFilters(event.target.value)}
            />
            {filterError && <p id={filterErrorId} role="alert" className="text-destructive text-xs">{filterError}</p>}
            <label className="block text-xs" htmlFor={pickerId}>从文件夹选择筛选条件</label>
            <select
              id={pickerId}
              className={fieldClass}
              value=""
              disabled={!pickerOptions.some(({ options }) => options.some(({ available }) => available))}
              onChange={(event) => {
                const option = pickerOptions.flatMap(({ options }) => options)
                  .find(({ token }) => token === event.target.value);
                if (option?.available) changeFilters(option.next);
              }}
            >
              <option value="">选择后添加到筛选栏</option>
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
          {result && <p className="text-muted-foreground text-xs">本次覆盖 {result.covered} 篇文档。</p>}
          {hits.length > 0 && (
            <ul aria-label="正文搜索命中" className="max-h-32 space-y-1 overflow-y-auto text-xs">
              {hits.map((hit) => {
                const match = result && hit.location ? hit : null;
                return (
                  <li key={hit.entry} className="break-words">
                    <button
                      type="button"
                      className={`${buttonClass} w-full text-left`}
                      aria-disabled={!match || undefined}
                      tabIndex={match ? undefined : -1}
                      onBlur={() => {
                        if (focusedHit?.entry === hit.entry) setFocusedHit(null);
                      }}
                      onClick={(event) => {
                        if (match && result) void openHit(match, result.search, event.currentTarget);
                      }}
                    >
                      <span className="font-medium">{hit.name}</span>
                      {match?.relativePath && (
                        <span className="text-muted-foreground block">{match.relativePath}</span>
                      )}
                      {match && (
                        <span className="text-muted-foreground block">
                          {match.source === "memory" ? "未保存正文" : "磁盘正文"} · UTF-16 [{match.from}, {match.to})
                        </span>
                      )}
                    </button>
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
