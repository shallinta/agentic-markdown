import { useEffect, useRef, useState } from "react";

import { discardGuard } from "@/client/discard-guard";
import { createPerfRunner } from "@/client/perf-runner";
import { electrobun } from "@/lib/electrobun";
import { PERF_SIZES, type PerfRow } from "@/shared/perf-lab";

const routeLabels: Record<PerfRow["route"], string> = {
  "rpc-binary-probe": "RPC 二进制能力探测",
  "full-text": "全文上传",
  "full-text-downlink": "全文下行（含小请求往返）",
  chunks: "分块上传",
  patch: "增量修改",
  "worker-clone": "Worker 克隆",
  "worker-transfer": "Worker 转移",
  "cm-state": "CM6 状态层",
  "cm-viewport": "CM6 视口",
  "cm-long-line-view": "编辑视图长行探针",
  "cm-parser-lifecycle": "解析生命周期探针",
  cancel: "取消回收",
};
const statusLabels: Record<PerfRow["status"], string> = {
  ok: "成功",
  failed: "失败",
  unsupported: "不支持",
  cancelled: "已取消",
};

export function PerformanceLab({ autorun }: { autorun: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  const runner = useRef<ReturnType<typeof createPerfRunner> | null>(null);
  const once = useRef(false);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<PerfRow[]>([]);
  const [progress, setProgress] = useState("尚未运行");
  const [report, setReport] = useState("");
  async function run(sizes: readonly number[]) {
    if (runner.current || !viewport.current || !electrobun.rpc) return;
    setRunning(true);
    setRows([]);
    setReport("");
    const current = createPerfRunner(
      (request) =>
        electrobun.rpc!.request.perfLabRequest(request, {
          maxRequestTime: 125_000,
        }),
      (row) => setRows((previous) => [...previous, row]),
      setProgress,
      viewport.current
    );
    runner.current = current;
    try {
      const result = await current.run(sizes);
      setReport(result.reportName ?? "报告未写入");
      setProgress("实验结束（请按每项状态判断）");
    } catch {
      setProgress("实验中断；未完成项目不代表成功");
    } finally {
      runner.current = null;
      setRunning(false);
    }
  }
  useEffect(
    () =>
      discardGuard.register({
        beginDiscard: () => true,
        endDiscard() {
          /* No user document or editable workspace in this lab. */
        },
        hasDirty: () => false,
        waitForSaves: async () => {
          await runner.current?.cancel();
        },
      }),
    []
  );
  useEffect(() => {
    if (autorun && !once.current) {
      once.current = true;
      void run(PERF_SIZES);
    }
  }, [autorun]);
  return (
    <main className="bg-background text-foreground h-screen overflow-auto p-8 pt-14">
      <h1 className="text-xl font-semibold">大文档实验 · 仅合成数据</h1>
      <p>MB 为十进制；正常文档仍限 1 MiB。实验不读取或修改用户文件。</p>
      <p>
        全文/分块/patch 为 renderer → Bun → Worker，上行正文、回程仅摘要
        ACK；全文下行由 Bun 生成并返回完整合成正文，客户端校验原文、长度和摘要。
        Worker clone/transfer 只测 Bun → Worker。分块 Worker/host
        时间为各块累计；patch CPU/内存包含基线建立，patch RTT 不含。应用对象
        JSON 探针记录 stringify、UTF-8 编码耗时与字节，不是 SDK
        封装或实际线传字节；探针分配成本包含在测量中。
      </p>
      <p>
        CPU、RSS、heap 为 Bun 进程采样，不含 WebView；不是峰值。实际复制次数与
        WebView heap 与严格单向时间不可观测，保持 null。下行 RTT
        包含小请求、后台生成/编码探针及全文回程，客户端验证另外记录。JSON
        二进制探测与 Worker transfer 分开。
      </p>
      <p>
        CM6：1 MB 展示真实视口；10/50 MB
        仅状态层。双帧机会不是绘制完成时间。同步工作期间取消可能延迟；退出确认不等于
        RSS 立即回收。
      </p>
      <div className="my-4 flex gap-3">
        {PERF_SIZES.map((size) => (
          <button
            className="rounded border px-3 py-2"
            key={size}
            disabled={running}
            onClick={() => void run([size])}
          >
            运行 {size / 1_000_000} MB
          </button>
        ))}
        <button disabled={running} onClick={() => void run(PERF_SIZES)}>
          运行全部
        </button>
        <button
          disabled={!running}
          onClick={() => {
            setProgress("正在请求取消…");
            void runner.current?.cancel();
          }}
        >
          取消
        </button>
        <button
          disabled={!rows.length}
          onClick={() =>
            void navigator.clipboard
              .writeText(JSON.stringify(rows, null, 2))
              .catch(() => setProgress("复制失败，请使用临时 JSON 报告"))
          }
        >
          复制结果
        </button>
      </div>
      <p role="status">{progress}</p>
      <p>临时目录报告：{report || "尚未生成"}</p>
      <div
        ref={viewport}
        className="my-3 h-48 overflow-hidden border"
        aria-label="合成文档实验视口"
      />
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th>MB / 形态</th>
            <th>路径</th>
            <th>状态</th>
            <th>往返 ms</th>
            <th>Worker ms</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td>
                {row.bytes / 1_000_000} /{" "}
                {row.shape === "lines" ? "多短行" : "单长行"}
              </td>
              <td>{routeLabels[row.route]}</td>
              <td>{statusLabels[row.status]}</td>
              <td>{row.metrics.roundTripMs?.toFixed(1) ?? "—"}</td>
              <td>{row.metrics.workerMs?.toFixed(1) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
