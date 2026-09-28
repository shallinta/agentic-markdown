import { useCallback, useEffect, useRef, useState } from "react";

import { runDenseLineProbe } from "@/client/dense-line-probe";
import { discardGuard } from "@/client/discard-guard";
import { runEditorViewProbe } from "@/client/editor-view-probe";
import { runOpenDocumentProbe } from "@/client/open-document-probe";
import { runParserWorkProbe } from "@/client/parser-work-probe";
import { runResponsiveInputProbe } from "@/client/responsive-input-probe";
import { electrobun } from "@/lib/electrobun";
import type { PerfRow } from "@/shared/perf-lab";

/** Only mounted by the explicit isolated experiment preload, never in a workspace. */
export function EditorProbeLab({
  autorun,
  dense = false,
  responsive = false,
  parserWork = false,
  openDocuments = false,
}: {
  autorun: boolean;
  dense?: boolean;
  responsive?: boolean;
  parserWork?: boolean;
  openDocuments?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const active = useRef<AbortController | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const once = useRef(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("尚未运行");
  const [rows, setRows] = useState<PerfRow[]>([]);
  const [report, setReport] = useState("");
  const run = useCallback(() => {
    if (active.current || !container.current || !electrobun.rpc) return;
    const control = new AbortController();
    active.current = control;
    setRunning(true);
    setRows([]);
    setReport("");
    const host = container.current;
    pending.current = (async () => {
      try {
        const result = openDocuments
          ? await runOpenDocumentProbe(
              host,
              setProgress,
              control.signal,
              (request) => electrobun.rpc!.request.perfLabRequest(request)
            )
          : await (
              parserWork
                ? runParserWorkProbe
                : responsive
                  ? runResponsiveInputProbe
                  : dense
                    ? runDenseLineProbe
                    : runEditorViewProbe
            )(host, setProgress, control.signal);
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
  }, [dense, responsive, parserWork, openDocuments]);
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
  }, [autorun, run]);
  return (
    <main className="bg-background text-foreground h-screen overflow-auto p-8 pt-14">
      <h1 className="text-xl font-semibold">编辑视图实验 · 仅合成数据</h1>
      {parserWork && (
        <p>
          同包比较等待旧任务与最新输入优先；记录三次合成输入、停止后的语法就绪及自有派生缓存成本。任务计数不是
          CPU 时间，清理后的成本不代表系统内存回收；未完成与未知不算通过。
        </p>
      )}
      {responsive && (
        <p>
          长行输入响应对照：真实文档控制器与视图的同步/后台解析配置，连续三次合成输入。另检查最终语法一致性；不是自然键盘或中文候选延迟。
        </p>
      )}
      {dense && (
        <p>
          密集长行诊断：首次与公开解析就绪后三次编辑；插桩解析耗时包含在状态或视图更新中，不能重复相加。没有性能门槛，超时表示不支持，不等于通过。
        </p>
      )}
      <p>
        真实 EditorView 中合成输入和撤销，不读取或保存用户文档；普通文档仍限 1
        MiB。
      </p>
      {openDocuments && (
        <p>
          固定临时文件使用真实后台读写与授权；文件生成在计时外，自动选择不是原生选择器。磁盘读时含身份复核，RPC往返包含后台阶段，控制器打开包含RPC与State；这些嵌套区间不能相加。首次事务不是自然输入或绘制时间，系统选择器、IME和视觉体验仍须人工验收。
        </p>
      )}
      <p>
        双帧时间只表示调度机会，不是真实键盘、中文候选或绘制延迟。解析取消有正对照与有限观察窗口；无有效对照时记不支持。
      </p>
      <div className="my-3 flex gap-3">
        <button disabled={running} onClick={run}>
          {openDocuments
            ? "运行真实磁盘打开探针"
            : parserWork
              ? "运行解析任务与缓存对照"
              : responsive
                ? "运行输入响应对照"
                : dense
                  ? "运行密集长行诊断"
                  : "运行编辑视图探针"}
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
            {row.route === "cm-parser-work"
              ? "解析任务与缓存对照"
              : row.route === "cm-responsive-input"
                ? "输入响应对照"
                : row.route === "cm-dense-diagnostic"
                  ? "长行分段诊断"
                  : row.route === "cm-long-line-view"
                    ? "长行视图"
                    : "解析生命周期"}{" "}
            · {row.bytes} 字节 ·{" "}
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
