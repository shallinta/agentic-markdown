import { useEffect, useRef, useState } from "react";

import { discardGuard } from "@/client/discard-guard";
import { classifyContentURL } from "@/security/content-url";
import {
  auditContentDOM,
  blockContentDefaults,
  createSafeContent,
} from "@/security/safe-content";
import { securityCorpus, securityURLs } from "@/shared/security-corpus";

export function SecurityLab() {
  const host = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const [status, setStatus] = useState("尚未运行");
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const stop = () => {
      generation.current++;
    };
    const unregister = discardGuard.register({
      hasDirty: () => false,
      beginDiscard: () => true,
      endDiscard() {
        /* No user state. */
      },
      waitForSaves() {
        stop();
        return Promise.resolve();
      },
    });
    return () => {
      stop();
      unregister();
    };
  }, []);
  const run = async () => {
    if (!host.current) return;
    const current = ++generation.current;
    const mount = host.current;
    mount.replaceChildren();
    setRunning(true);
    setStatus("检查固定语料…");
    const sanitize = createSafeContent(window);
    const sentinel = globalThis as typeof globalThis & {
      __f020executed?: boolean;
    };
    sentinel.__f020executed = false;
    let passed = 0;
    try {
      for (const sample of securityCorpus) {
        // Yield between bounded fixed samples. Cancellation does not interrupt
        // a synchronous sanitize call, and is not claimed to terminate one.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        );
        if (current !== generation.current) return;
        const start = performance.now();
        const result = sanitize(sample.html);
        const area = document.createElement("div");
        area.className =
          "rounded border p-3 my-2 [&_strong]:font-bold [&_em]:italic [&_h1]:text-2xl [&_h2]:text-xl [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:font-mono [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 whitespace-pre-wrap";
        if (result.mode === "source") area.classList.add("font-mono");
        blockContentDefaults(area);
        area.append(result.fragment);
        const domOK = auditContentDOM(area);
        const preserved =
          result.mode !== "source" || area.textContent === sample.html;
        const eventsOK = ["click", "auxclick", "submit", "dragstart"].every(
          (type) =>
            !area.dispatchEvent(
              new Event(type, { bubbles: true, cancelable: true })
            )
        );
        const executionOK = sentinel.__f020executed === false;
        const ok =
          executionOK &&
          result.mode === sample.mode &&
          domOK &&
          preserved &&
          eventsOK;
        if (ok) passed++;
        const summary = document.createElement("p");
        summary.textContent = `${sample.label}：${ok ? "通过" : "失败"}；${result.mode === "source" ? "源码降级" : "净化显示"}；${result.reason}；DOM审计${domOK ? "通过" : "失败"}；默认入口${eventsOK ? "阻止" : "失败"}；${(performance.now() - start).toFixed(2)} ms`;
        mount.append(summary, area);
      }
      if (sentinel.__f020executed !== false)
        throw new Error("Fixed execution sentinel changed");
      setStatus(
        `固定语料 ${passed}/${securityCorpus.length} 通过；不代表原生下载分支已修复`
      );
    } catch {
      if (current === generation.current) setStatus("实验失败，不表示通过");
    } finally {
      if (current === generation.current) setRunning(false);
    }
  };
  const cancel = () => {
    generation.current++;
    setRunning(false);
    setStatus("已取消后续样本；未完成项不算通过");
  };
  return (
    <main className="bg-background text-foreground h-screen overflow-auto p-8 pt-14">
      <h1>富内容安全实验 · 仅固定语料</h1>
      <p>
        不读取文件、不打开链接、不下载。仅允许有限HTML结构，全部属性禁止；格式规范化也可能整段源码降级。本片不是正式阅读或完整HTML策略。
      </p>
      <p>
        解析阶段通用资源行为及原生下载风险仍待后续消费者复核。取消只阻止后续固定样本，不中断正在同步净化的一项。
      </p>
      <button
        className="rounded border px-3 py-2 focus-visible:outline-2 disabled:opacity-50"
        disabled={running}
        onClick={() => void run()}
      >
        运行安全语料
      </button>{" "}
      <button
        className="rounded border px-3 py-2 focus-visible:outline-2 disabled:opacity-50"
        disabled={!running}
        onClick={cancel}
      >
        取消
      </button>
      <p role="status">{status}</p>
      <div ref={host} />
      <h2>URL纯分类（不打开）</h2>
      {securityURLs.map((url, index) => (
        <p key={index}>
          {url}：
          {
            {
              anchor: "锚点候选",
              "local-candidate": "本地候选",
              "external-candidate": "系统应用候选",
              rejected: "拒绝",
            }[classifyContentURL(url).kind]
          }
          ；{classifyContentURL(url).reason}
        </p>
      ))}
    </main>
  );
}
