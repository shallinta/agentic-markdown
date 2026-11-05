import { useCallback, useEffect, useRef, useState } from "react";

import { discardGuard } from "@/client/discard-guard";
import { electrobun } from "@/lib/electrobun";
import {
  SEARCH_LAB_QUERY_LIMIT,
  validSearchLabRequest,
  validSearchLabResponse,
  type SearchLabRequest,
  type SearchLabResponse,
} from "@/shared/search-lab";

interface Scope {
  root: string;
  generation: number;
}
interface ActiveRequest {
  id: string;
  discard?: "cancel" | "stop";
}
type QueryResult = Extract<SearchLabResponse, { ok: true; op: "query" }>;
type SearchError = Extract<SearchLabResponse, { ok: false }>["error"];
const statusLabels: Record<SearchError, string> = {
  DISABLED: "正文查询实验未启用。",
  INVALID: "请求格式无效。",
  NOT_READY: "测试目录尚未扫描完成。",
  STALE: "目录授权或扫描代数已失效。",
  LIMIT: "超出本实验的查询或索引限额。",
  BUSY: "上一项操作仍在收尾。",
  CANCELLED: "查询已取消。",
  UNKNOWN: "索引状态未知。",
  UNAVAILABLE: "正文查询暂不可用。",
};
const envelope = () => ({
  protocolVersion: 1 as const,
  requestId: crypto.randomUUID(),
});

async function request(input: SearchLabRequest) {
  const response: unknown =
    await electrobun.rpc?.request.searchLabRequest(input);
  if (!validSearchLabResponse(response, input))
    throw Error("Invalid search lab response");
  return response;
}

export function SearchLab() {
  const [scope, setScope] = useState<Scope>();
  const [query, setQuery] = useState("😀可检索");
  const [hits, setHits] = useState<QueryResult["hits"]>([]);
  const [status, setStatus] = useState("请先准备测试目录。");
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const active = useRef<ActiveRequest | null>(null);
  const stopPending = useRef<Promise<void> | null>(null);
  const leaving = useRef(false);

  async function run(input: SearchLabRequest) {
    if (active.current || stopPending.current || leaving.current) return;
    if (!validSearchLabRequest(input)) {
      setStatus("请输入有效的非空字面量。");
      return;
    }
    const current: ActiveRequest = {
      id: input.requestId,
    };
    active.current = current;
    setBusy(true);
    setHits([]);
    setStatus(input.op === "prepare" ? "正在扫描测试目录…" : "正在查询…");
    try {
      const response = await request(input);
      if (current.discard) return;
      if (!response.ok) {
        if (response.error === "STALE") setScope(undefined);
        setStatus(statusLabels[response.error]);
      } else if (response.op === "prepare") {
        setScope({ root: response.root, generation: response.generation });
        setStatus("测试目录已就绪。");
      } else if (response.op === "query") {
        setHits(response.hits);
        setStatus(`命中 ${response.hits.length} 项。`);
      }
    } catch {
      if (!current.discard) setStatus("查询通信失败或返回无效。");
    } finally {
      if (current.discard === "cancel") setStatus("已取消显示。");
      active.current = null;
      setBusy(false);
    }
  }

  function cancel() {
    const current = active.current;
    if (!current || current.discard) return;
    current.discard = "cancel";
    setHits([]);
    setStatus("已取消显示，后台正在收尾。");
    void request({
      ...envelope(),
      op: "cancel",
      targetRequestId: current.id,
    }).catch(() => {
      // A late response remains hidden even if the cancel acknowledgement is lost.
    });
  }

  const stop = useCallback(() => {
    if (stopPending.current) return stopPending.current;
    if (active.current) active.current.discard = "stop";
    setScope(undefined);
    setHits([]);
    setClosing(true);
    setStatus("正在关闭实验…");
    const pending = (async () => {
      try {
        const response = await request({ ...envelope(), op: "stop" });
        if (!response.ok) throw Error(statusLabels[response.error]);
        setStatus("实验已关闭。");
      } catch (error) {
        setStatus("实验关闭未确认，请重试。");
        throw error;
      } finally {
        stopPending.current = null;
        setClosing(false);
      }
    })();
    stopPending.current = pending;
    return pending;
  }, []);

  useEffect(
    () =>
      discardGuard.register({
        beginDiscard: () => {
          leaving.current = true;
          return true;
        },
        endDiscard: () => {
          leaving.current = false;
        },
        hasDirty: () => false,
        waitForSaves: stop,
      }),
    [stop]
  );

  return (
    <main className="bg-background text-foreground h-screen overflow-auto p-8 pt-14">
      <h1 className="text-xl font-semibold">正文查询实验 · 仅合成数据</h1>
      <p className="my-2">测试目录包含一篇正文为「😀可检索」的合成文档。</p>
      <button
        type="button"
        className="rounded border px-3 py-2"
        disabled={busy || closing || !!scope}
        onClick={() => void run({ ...envelope(), op: "prepare" })}
      >
        准备测试目录
      </button>
      <form
        className="my-4 flex flex-wrap items-center gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (scope) void run({ ...envelope(), op: "query", ...scope, query });
        }}
      >
        <label htmlFor="search-lab-query">字面量查询</label>
        <input
          id="search-lab-query"
          className="bg-background rounded border px-3 py-2"
          value={query}
          maxLength={SEARCH_LAB_QUERY_LIMIT}
          disabled={!scope || closing}
          onChange={(event) => {
            setQuery(event.target.value);
            setHits([]);
            if (active.current) cancel();
            else setStatus("查询词已更新。");
          }}
        />
        <button
          className="rounded border px-3 py-2"
          disabled={!scope || busy || closing || !query.trim()}
        >
          查询
        </button>
        <button
          type="button"
          className="rounded border px-3 py-2"
          disabled={!busy || closing}
          onClick={cancel}
        >
          取消查询
        </button>
        <button
          type="button"
          className="rounded border px-3 py-2"
          disabled={closing}
          onClick={() => void stop().catch(() => undefined)}
        >
          关闭实验
        </button>
      </form>
      <p role="status">{status}</p>
      {hits.length > 0 && (
        <ul className="my-2 list-inside list-disc" aria-label="查询命中">
          {hits.map(({ entry, from, to }) => (
            <li key={entry}>
              UTF-16 区间 [{from}, {to})
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
