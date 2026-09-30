import { useEffect, useRef, useState } from "react";

import CanonicalWorker from "@/client/canonical-markdown.worker?worker&inline";
import { createCanonicalRunner } from "@/client/canonical-runner";
import { discardGuard } from "@/client/discard-guard";
import { canonicalCorpus, type CanonicalRow } from "@/shared/canonical-corpus";

export function CanonicalLab() {
  const runner = useRef(createCanonicalRunner(() => new CanonicalWorker()));
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("尚未运行");
  const [rows, setRows] = useState<CanonicalRow[]>([]);
  const generation = useRef(0);
  useEffect(() => {
    const currentRunner = runner.current;
    const stop = () => {
      generation.current++;
      currentRunner.cancel();
    };
    const unregister = discardGuard.register({
      hasDirty: () => false,
      beginDiscard: () => true,
      endDiscard() {
        /* Fixed samples have no dirty state. */
      },
      waitForSaves: () => {
        stop();
        return Promise.resolve();
      },
    });
    return () => {
      stop();
      unregister();
    };
  }, []);
  const cancel = () => {
    generation.current++;
    runner.current.cancel();
    setRunning(false);
    setStatus("已取消；未完成项不表示成功");
  };
  const run = async () => {
    const current = ++generation.current;
    setRows([]);
    setRunning(true);
    setStatus("正在解析固定语料…");
    try {
      const result = await runner.current.run((row) => {
        if (current === generation.current)
          setRows((previous) => [...previous, row]);
      });
      if (current === generation.current)
        setStatus(
          result === true
            ? "固定语料检查通过；不是完整规范认证"
            : "检查未通过或取消；请查看各项结果"
        );
    } catch {
      if (current === generation.current)
        setStatus("实验失败或超时，不表示通过");
    } finally {
      if (current === generation.current) setRunning(false);
    }
  };
  return (
    <main className="bg-background text-foreground h-screen overflow-auto p-8 pt-14">
      <h1>CommonMark 规范解析实验</h1>
      <p>仅固定合成语料，不读取用户文件，不生成 HTML，不是阅读模式。</p>
      <p>
        引用候选与有效引用不是同一语义；转义和实体在规范文本中解码，编辑解析保留语法节点。两树不要求同构。规范解析去除
        BOM 后映射回原始 UTF-16 范围；编辑解析按生产方式归一化 LF
        并映射回原文。原始语料不改写。
      </p>
      <button
        className="rounded border px-3 py-2 focus-visible:outline-2 disabled:opacity-50"
        disabled={running}
        onClick={() => void run()}
      >
        运行固定语料
      </button>{" "}
      <button
        className="rounded border px-3 py-2 focus-visible:outline-2 disabled:opacity-50"
        disabled={!running}
        onClick={cancel}
      >
        取消运行
      </button>
      <p role="status">{status}</p>
      {rows.map((row) => (
        <section key={row.id} className="my-3">
          <h2>
            {canonicalCorpus.find((sample) => sample.id === row.id)?.label}：
            {row.passed ? "通过" : "不通过"}
          </h2>
          <p>
            规范摘要：{JSON.stringify(row.canonical)}；编辑摘要：
            {JSON.stringify(row.editor)}
          </p>
          <p>
            实际标题层级：{JSON.stringify(row.headings)}；实际规范链接目标：
            {JSON.stringify(row.targets)}
            （仅固定合成语料；编辑引用候选不代表有效目标）
          </p>
          <p>
            范围校验：{row.rangesValid ? "通过" : "失败"}；字符预期：
            {row.decodedMatches ? "通过" : "失败"}；标题层级及链接目标预期：
            {row.semanticMatches ? "通过" : "失败"}；Worker 内解析与检查：
            {row.milliseconds.toFixed(2)} ms（非输入延迟）
          </p>
        </section>
      ))}
    </main>
  );
}
