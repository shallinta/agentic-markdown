import { useCallback, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { createCurrentCanonical } from "../client/current-canonical";
import ReaderWorker from "../client/current-canonical.worker?worker&inline";
import "../reading-themes/content.css";
import "../reading-themes/paper/theme.css";
import {
  auditReadingContent,
  commonmarkContent,
  isControlledReadingElement,
} from "../security/commonmark-content";

const fixture = {
  documentId: "reader-lab-fixture",
  revision: 1,
  identity: {},
  text: [
    "# 阅读子窗样本",
    "",
    "这是 **独立阅读** 的固定样本 📖。",
    "",
    "> 这是一段引用。",
    "",
    "- [x] 已完成的任务",
    "- [ ] 待读的任务",
    "",
    "```js",
    'const text = "你好";',
    "```",
    "",
    "[固定链接](https://reader-fixture.invalid/) ![固定图片](https://reader-fixture.invalid/image.png)",
    "",
    "<script>globalThis.__readerFixtureExecuted = true</script>",
    "",
    '<div onclick="globalThis.__readerFixtureExecuted = true">不可信 HTML 样本</div>',
  ].join("\n"),
};

function readProperty(value: unknown, key: string): unknown {
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    const property: unknown = Reflect.get(value, key);
    return property;
  }
}

function checkBridge(name: string, handlerName: string) {
  const present = name in window;
  try {
    const alias = readProperty(window, name);
    const handlers = readProperty(readProperty(window, "webkit"), "messageHandlers");
    const handler = readProperty(handlers, handlerName);
    // The sandboxed preload can initialize an alias to undefined.
    return {
      clear: alias === undefined && handler === undefined,
      details: `${Number(present)}/${typeof alias}/${typeof handler}`,
    };
  } catch {
    return { clear: false, details: `${Number(present)}/unavailable` };
  }
}

function Reader({ content }: { content: ReactNode }) {
  const [auditResult, setAuditResult] = useState<{ safe: boolean; details: string }>();
  const audit = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const domSafe = auditReadingContent(element).safe;
    const executed = "__readerFixtureExecuted" in globalThis;
    const internal = checkBridge("__electrobunInternalBridge", "internalBridge");
    const host = checkBridge("__electrobunHostBridge", "hostBridge");
    const legacy = checkBridge("__electrobunBunBridge", "bunBridge");
    const safe = domSafe && !executed && internal.clear && host.clear && legacy.clear;
    const unexpected = domSafe ? undefined : [...element.querySelectorAll("*")]
      .find((node) => !isControlledReadingElement(node));
    const first = unexpected
      ? `${unexpected.localName}[${unexpected.getAttributeNames().join(",")}]`
      : "none";
    setAuditResult({
      safe,
      details: [
        `DOM=${Number(domSafe)} first=${first} script=${Number(executed)}`,
        `internal=${internal.details}`,
        `host=${host.details}`,
        `legacy=${legacy.details}`,
      ].join(" "),
    });
  }, []);
  return (
    <main>
      <p role="status">
        {!auditResult
          ? "正在检查只读内容…"
          : auditResult.safe
            ? "只读样本 · 安全检查通过"
            : "只读样本 · 安全检查失败"}
      </p>
      {auditResult && !auditResult.safe && <p>{auditResult.details}</p>}
      <article ref={audit}>{content}</article>
    </main>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  const canonical = createCurrentCanonical(
    () => fixture,
    () => new ReaderWorker(),
    "reading-legacy"
  );
  window.addEventListener("pagehide", canonical.dispose, { once: true });
  root.render(<p role="status">正在解析只读样本…</p>);
  void canonical.request().then((result) => {
    if (!result || !canonical.isCurrent(result)) {
      root.render(<p role="alert">无法解析只读样本。</p>);
      return;
    }
    root.render(<Reader content={commonmarkContent(result.tree, fixture.text)} />);
  });
}
