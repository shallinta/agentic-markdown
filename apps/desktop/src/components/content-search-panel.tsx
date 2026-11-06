import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";

import { mergeContentSearch } from "@/client/content-search";
import type { createDocumentController } from "@/client/documents";
import type { createFolderWorkspace } from "@/client/workspace";
import { electrobun } from "@/lib/electrobun";
import {
  CONTENT_SEARCH_LIMITS,
  validContentSearchRequest,
  validContentSearchResponse,
  type ContentSearchError,
  type ContentSearchRequest,
} from "@/shared/content-search";
import type { WorkspaceRoot } from "@/shared/workspace";

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
const buttonClass =
  "hover:bg-muted focus-visible:outline-ring rounded border px-2 py-1 text-xs focus-visible:outline-2 disabled:opacity-50";

type Query = Extract<ContentSearchRequest, { op: "query" }>;
type Merged = Extract<ReturnType<typeof mergeContentSearch>, { ok: true }>;
interface Presented {
  covered: number;
  hits: (Merged["hits"][number] & { name: string })[];
}
interface SearchLifetime {
  request: Query;
  current(): boolean;
  pending: boolean;
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
  const resultId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<SearchLifetime | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [result, setResult] = useState<Presented | null>(null);
  const ready = selectedRoot?.status === "complete";

  const retire = useCallback(() => {
    const previous = active.current;
    active.current = null;
    if (previous?.pending) cancel(previous.request.requestId);
  }, []);

  const reset = useCallback(
    (message: string) => {
      retire();
      setResult(null);
      setBusy(false);
      setStatus(message);
    },
    [retire]
  );

  useLayoutEffect(() => {
    const check = () => {
      const search = active.current;
      if (search && !search.current()) reset(changed);
    };
    const stopDocuments = controller.subscribe(check);
    const stopFolders = folders.subscribe(check);
    check();
    return () => {
      stopDocuments();
      stopFolders();
      retire();
    };
  }, [controller, folders, reset, retire]);

  // Selection can change without a workspace publication.
  useLayoutEffect(() => {
    if (active.current && !active.current.current()) reset(changed);
  }, [reset, selectedRoot, selectionRevision]);

  useLayoutEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  async function search() {
    if (!ready || busy) return;
    reset(initialStatus);
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
    const names = new Map<string, string>();
    for (const node of nodes) {
      if (node.kind !== "file") continue;
      names.set(node.handle, node.name);
      if (names.size > CONTENT_SEARCH_LIMITS.documents) {
        setStatus(errors.LIMIT);
        return;
      }
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
    };
    if (!validContentSearchRequest(request)) {
      setStatus(errors.INVALID);
      return;
    }
    const search: SearchLifetime = {
      request,
      pending: true,
      current() {
        const latest = folders.getSnapshot();
        const latestRoot = latest.roots.find((item) => item.handle === root.handle);
        return (
          getSelection().revision === selection.revision &&
          latestRoot?.generation === root.generation &&
          latestRoot.status === "complete" &&
          latestRoot.showHidden === root.showHidden &&
          latestRoot.observation === root.observation &&
          latestRoot.entries === root.entries &&
          latestRoot.errors === root.errors &&
          latest.nodes[root.handle] === workspace.nodes[root.handle] &&
          !latest.busy &&
          !latest.error &&
          capture.current()
        );
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
        response.coverage.length !== names.size ||
        response.coverage.some(({ entry }) => !names.has(entry))
      ) {
        reset(incomplete);
        return;
      }
      const merged = mergeContentSearch(query, capture.documents, response);
      if (!merged.ok) {
        reset(merged.reason === "limit" ? errors.LIMIT : incomplete);
        return;
      }
      setResult({
        covered: merged.covered,
        hits: merged.hits.map((hit) => ({ ...hit, name: names.get(hit.entry)! })),
      });
      setStatus(merged.hits.length ? `命中 ${merged.hits.length} 篇。` : "未找到匹配正文。");
      setBusy(false);
    } catch {
      if (active.current === search) reset("正文查询通信失败，请重试。");
    }
  }

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
          if (open) reset(initialStatus);
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
            区分大小写，每篇显示首个匹配。最多 16 篇，正文合计 64 KiB。
          </p>
          <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void search(); }}>
            <label className="block text-xs" htmlFor={inputId}>字面量查询</label>
            <input
              id={inputId}
              ref={input}
              className="bg-background focus-visible:outline-ring w-full min-w-0 rounded border px-2 py-1 text-xs focus-visible:outline-2"
              type="search"
              maxLength={CONTENT_SEARCH_LIMITS.query}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                reset(initialStatus);
              }}
            />
            <div className="flex flex-wrap gap-1">
              <button type="submit" className={buttonClass} disabled={!ready || busy || !query.trim()}>查询正文</button>
              <button type="button" className={buttonClass} disabled={!busy} onClick={() => reset(errors.CANCELLED)}>取消查询</button>
              <button type="button" className={buttonClass} onClick={() => {
                reset(initialStatus);
                setOpen(false);
                trigger.current?.focus();
              }}>关闭</button>
            </div>
          </form>
          <p role="status" className="break-words text-xs">{status}</p>
          {result && (
            <>
              <p className="text-muted-foreground text-xs">本次覆盖 {result.covered} 篇文档。</p>
              {result.hits.length > 0 && (
                <ul aria-label="正文搜索命中" className="max-h-32 space-y-1 overflow-y-auto text-xs">
                  {result.hits.map(({ entry, name, source, from, to }) => (
                    <li key={entry} className="break-words">
                      <span className="font-medium">{name}</span>
                      <span className="text-muted-foreground block">
                        {source === "memory" ? "未保存正文" : "磁盘正文"} · UTF-16 [{from}, {to})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
