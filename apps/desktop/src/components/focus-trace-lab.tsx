import { useEffect, useRef, useState } from "react";

import { createFocusTrace, type FocusTraceRow } from "@/client/focus-trace";

const buttonClass =
  "rounded border px-2 py-1 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

export function FocusTraceLab() {
  const trace = useRef<ReturnType<typeof createFocusTrace> | null>(null);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<FocusTraceRow[]>([]);
  useEffect(() => {
    const current = createFocusTrace(document);
    trace.current = current;
    return () => {
      current.dispose();
      trace.current = null;
    };
  }, []);
  return (
    <section
      data-focus-trace-lab
      aria-label="焦点事件诊断"
      className="w-full text-xs"
    >
      <div className="flex gap-2">
        <button
          className={buttonClass}
          disabled={running}
          onClick={() => {
            trace.current?.start();
            setRows([]);
            setRunning(true);
          }}
        >
          开始焦点诊断
        </button>
        <button
          className={buttonClass}
          disabled={!running}
          onClick={() => {
            setRows(trace.current?.stop() ?? []);
            setRunning(false);
          }}
        >
          停止并显示记录
        </button>
        <button
          className={buttonClass}
          onClick={() => {
            trace.current?.clear();
            setRows([]);
            setRunning(false);
          }}
        >
          清空诊断记录
        </button>
      </div>
      <p>
        {running
          ? "采集中，仅保留最近 128 条元数据；不会实时刷新记录。"
          : "已停止；仅本地内存，不记录正文或路径。"}
      </p>
      {!running && rows.length > 0 && (
        <>
          <pre className="overflow-auto" aria-label="焦点选区摘要">
            {rows
              .filter((row) => row.type === "focusin")
              .map(
                (row) =>
                  `#${row.sequence} ${row.target} → ${row.active}: ranges=${row.selectionRangeCount ?? "unknown"}, anchor=${row.selectionAnchor ?? "unknown"}, focus=${row.selectionFocus ?? "unknown"}, same=${row.selectionSameEditor ?? "unknown"}`
              )
              .join("\n")}
          </pre>
          <pre className="max-h-64 overflow-auto" aria-label="焦点诊断记录">
            {JSON.stringify(rows, null, 2)}
          </pre>
        </>
      )}
    </section>
  );
}
