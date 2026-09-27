import { useEffect, useRef, useState } from "react";

import { discardGuard } from "@/client/discard-guard";
import { runEditorViewProbe } from "@/client/editor-view-probe";
import { electrobun } from "@/lib/electrobun";
import type { PerfRow } from "@/shared/perf-lab";

/** Only mounted by the explicit isolated experiment preload, never in a workspace. */
export function EditorProbeLab({ autorun }: { autorun: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const active = useRef<AbortController | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const once = useRef(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("尚未运行");
  const [rows, setRows] = useState<PerfRow[]>([]);
  const [report, setReport] = useState("");
  function run() {
    if (active.current || !container.current || !electrobun.rpc) return;
    const control = new AbortController();
    active.current = control;
    setRunning(true);
    setRows([]);
    setReport("");
    const host = container.current;
    pending.current = (async () => {
      try {
        const result = await runEditorViewProbe(
          host,
          setProgress,
          control.signal
        );
        setRows(result);
        if (control.signal.aborted) {
          setProgress("已取消；未完成项目不表示成功");
          return;
        }
        const response = await electrobun.rpc!.request.perfLabRequest({
          op: "report",
          rows: result,
        });
        if (!response.ok || !response.reportName)
          throw new Error("probe report failed");
        setReport(response.reportName);
        if (control.signal.aborted) {
          setProgress(
            "已取消后续操作；已提交的合成报告可能已写入，不表示验收通过"
          );
          return;
        }
        setProgress("实验结束，请按各项状态判断；不代替人工验收");
      } catch {
        setProgress(
          control.signal.aborted ? "已取消" : "实验或报告写入失败；不代表通过"
        );
      } finally {
        active.current = null;
        pending.current = null;
        setRunning(false);
      }
    })();
  }
  useEffect(() => {
    const unregister = discardGuard.register({
      beginDiscard: () => true,
      endDiscard() {
        /* Synthetic state only; no user documents. */
      },
      hasDirty: () => false,
      waitForSaves: async () => {
        active.current?.abort();
        await pending.current;
      },
    });
    return () => {
      active.current?.abort();
      unregister();
    };
  }, []);
  useEffect(() => {
    if (autorun && !once.current) {
      once.current = true;
      run();
    }
  }, [autorun]);
  return (
    <main className="bg-background text-foreground h-screen overflow-auto p-8 pt-14">
      <h1 className="text-xl font-semibold">编辑视图实验 · 仅合成数据</h1>
      <p>
        真实 EditorView 中合成输入和撤销，不读取或保存用户文档；普通文档仍限 1
        MiB。
      </p>
      <p>
        双帧时间只表示调度机会，不是真实键盘、中文候选或绘制延迟。解析取消有正对照与有限观察窗口；无有效对照时记不支持。
      </p>
      <div className="my-3 flex gap-3">
        <button disabled={running} onClick={run}>
          运行本批 B / C 探针
        </button>
        <button disabled={!running} onClick={() => active.current?.abort()}>
          取消
        </button>
      </div>
      <p role="status">{progress}</p>
      <p>临时报告：{report || "尚未生成"}</p>
      <div
        ref={container}
        className="my-3 h-64 overflow-hidden border"
        aria-label="合成编辑视图"
      />
      <ul>
        {rows.map((row, index) => (
          <li key={index}>
            {row.route === "cm-long-line-view" ? "长行视图" : "解析生命周期"} ·{" "}
            {row.bytes} 字节 ·{" "}
            {
              {
                ok: "成功",
                failed: "失败",
                unsupported: "不支持",
                cancelled: "已取消",
              }[row.status]
            }
            <pre>{JSON.stringify(row.metrics, null, 2)}</pre>
          </li>
        ))}
      </ul>
    </main>
  );
}
