import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { createDocumentController } from "@/client/documents";
import { electrobun } from "@/lib/electrobun";
import {
  isRecentResponse,
  type RecentRequest,
  type RecentResponse,
  type RecentFailure,
} from "@/shared/recent-files";

export const recentFailureText = (reason: RecentFailure) =>
  ({
    future: "最近记录来自较新版本，当前不可修改",
    corrupt: "最近记录损坏，已保留原数据",
    "too-large": "最近记录超过容量，已保留原数据",
    io: "最近记录读写失败，普通打开仍可使用",
    "queue-full": "最近记录操作繁忙，请稍后重试",
    invalid: "最近记录不可用，请重新打开文件",
  })[reason];

export function RecentFiles({
  controller,
  disabled,
}: {
  controller: ReturnType<typeof createDocumentController>;
  disabled: boolean;
}) {
  const [state, setState] = useState<RecentResponse | null>(null),
    [busy, setBusy] = useState(false);
  const epoch = useRef(0),
    mounted = useRef(false);
  async function request(input: RecentRequest) {
    const id = ++epoch.current;
    setBusy(true);
    try {
      const next = await electrobun.rpc?.request.recentFiles(input);
      if (!mounted.current || epoch.current !== id) return;
      if (!isRecentResponse(next)) throw Error();
      if (!next.available && input.op !== "list")
        toast.error(recentFailureText(next.reason));
      else setState(next);
    } catch {
      if (mounted.current && epoch.current === id) {
        if (input.op === "list") setState({ available: false, reason: "io" });
        toast.error("最近记录读取失败，普通打开仍可使用");
      }
    } finally {
      if (mounted.current && epoch.current === id) setBusy(false);
    }
  }
  useEffect(() => {
    const requestEpoch = epoch;
    mounted.current = true;
    void request({ op: "list" });
    return () => {
      mounted.current = false;
      requestEpoch.current++;
    };
  }, []);
  return (
    <section
      aria-label="最近独立文件"
      className="flex min-h-0 flex-1 flex-col gap-2"
    >
      <div className="flex shrink-0 items-center justify-between">
        <h2>最近独立文件</h2>
        <button
          className="rounded border px-2 py-1 disabled:opacity-50"
          disabled={
            busy || disabled || !state?.available || !state.entries.length
          }
          onClick={() => void request({ op: "clear" })}
        >
          清空最近记录
        </button>
      </div>
      <p className="text-muted-foreground shrink-0 text-sm">
        重新选择并打开会显示系统选择器，请重新选择文件以授权；记录不是当前可用性保证。
      </p>
      {!state ? (
        <p role="status">正在读取最近记录…</p>
      ) : !state.available ? (
        <div>
          <p role="status">{recentFailureText(state.reason)}</p>
          <button
            disabled={busy || disabled}
            onClick={() => void request({ op: "list" })}
          >
            重试读取最近记录
          </button>
        </div>
      ) : (
        <>
          {state.warning && (
            <p role="status">{recentFailureText(state.warning)}</p>
          )}
          {!state.entries.length && (
            <p className="text-muted-foreground text-sm">暂无最近记录</p>
          )}
          <ul className="min-h-0 space-y-2 overflow-y-auto">
            {state.entries.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded border p-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-all">{item.name}</p>
                  <p className="text-muted-foreground text-xs break-all">
                    {item.path}
                  </p>
                </div>
                <button
                  className="rounded border px-2 py-1 disabled:opacity-50"
                  disabled={busy || disabled}
                  onClick={() =>
                    void controller.selectWith((params) =>
                      electrobun.rpc
                        ? electrobun.rpc.request.reopenRecentFile({
                            ...params,
                            id: item.id,
                          })
                        : Promise.reject(Error("RPC unavailable"))
                    )
                  }
                >
                  重新选择并打开
                </button>
                <button
                  className="rounded border px-2 py-1 disabled:opacity-50"
                  aria-label={`移除最近记录 ${item.name}`}
                  disabled={busy || disabled}
                  onClick={() => void request({ op: "remove", id: item.id })}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
