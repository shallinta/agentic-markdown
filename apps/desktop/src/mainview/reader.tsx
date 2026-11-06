import { useCallback, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { createCurrentCanonical } from "../client/current-canonical";
import ReaderWorker from "../client/current-canonical.worker?worker&inline";
import { firstReadingBlock } from "../client/reading-position";
import { createReadingSearchRegistry, type ReadingSearchRegistry } from "../client/reading-search-registry";
import { READING_THEMES, type ReadingThemeId } from "../client/reading-theme";
import "../reading-themes/content.css";
import "../reading-themes/ink/theme.css";
import "../reading-themes/paper/theme.css";
import {
  auditReadingContent,
  commonmarkContent,
  isControlledReadingElement,
} from "../security/commonmark-content";
import { decodeReaderSnapshot, READER_SNAPSHOT_EVENT } from "../shared/reader-snapshot";

import { ReaderFind } from "./reader-find";

import "./reader.css";

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

function Reader({ content, label, experimental, retainVerifiedArticle, searchRegistry, current }: {
  content: ReactNode;
  label: string;
  experimental: boolean;
  retainVerifiedArticle?: (element: HTMLElement | null) => void;
  searchRegistry?: ReadingSearchRegistry;
  current?: () => boolean;
}) {
  const [auditResult, setAuditResult] = useState<{ safe: boolean; details: string }>();
  const [theme, setTheme] = useState<ReadingThemeId>("paper");
  const article = useRef<HTMLElement>(null);
  const themeControls = useRef<HTMLDivElement>(null);
  const audit = useCallback((element: HTMLElement | null) => {
    article.current = element;
    retainVerifiedArticle?.(null);
    if (!element) return;
    const domSafe = auditReadingContent(element).safe;
    const executed = "__readerFixtureExecuted" in globalThis;
    const internal = checkBridge("__electrobunInternalBridge", "internalBridge");
    const host = checkBridge("__electrobunHostBridge", "hostBridge");
    const legacy = checkBridge("__electrobunBunBridge", "bunBridge");
    const safe = domSafe && !executed && internal.clear && host.clear && legacy.clear;
    if (safe) retainVerifiedArticle?.(element);
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
  }, [retainVerifiedArticle]);
  const selectTheme = (id: string) => {
    if ((id !== "paper" && id !== "ink") || document.body.dataset.readingTheme === id) return;
    const scroller = document.scrollingElement;
    const scrollTop = scroller?.scrollTop ?? 0;
    const viewportTop = () => Math.max(0, themeControls.current?.getBoundingClientRect().bottom ?? 0);
    const top = viewportTop();
    const blocks = article.current?.children;
    const block = blocks?.item(firstReadingBlock(blocks.length, (index) =>
      (blocks.item(index)?.getBoundingClientRect().bottom ?? 0) > top
    ));
    const offset = block?.hasAttribute("data-reading-from")
      ? block.getBoundingClientRect().top - top
      : undefined;
    const ratio = scroller ? scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight) : 0;

    document.body.setAttribute("data-reading-theme", id);
    setTheme(id);
    if (!scroller || scrollTop <= 0) return;
    const nextTop = block && offset !== undefined
      ? scroller.scrollTop + block.getBoundingClientRect().top - viewportTop() - offset
      : ratio * Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTo(scroller.scrollLeft, nextTop);
  };
  if (auditResult?.safe === false && !experimental) {
    return <main><p role="alert">无法安全显示已保存版本。</p></main>;
  }
  return (
    <main>
      <p role="status">
        {!auditResult
          ? "正在检查只读内容…"
          : auditResult.safe
            ? experimental ? `${label} · 安全检查通过` : label
            : `${label} · 安全检查失败`}
      </p>
      {auditResult && !auditResult.safe && <p>{auditResult.details}</p>}
      {!experimental && auditResult?.safe && (
        <div ref={themeControls} className="reader-theme-controls">
          <div className="reader-theme-buttons" role="group" aria-label="阅读主题">
            {READING_THEMES.map(({ id, name }) => (
              <button
                key={id}
                type="button"
                aria-pressed={id === theme}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectTheme(id)}
              >
                {name}
              </button>
            ))}
          </div>
          {searchRegistry && current && (
            <ReaderFind article={article} toolbar={themeControls} registry={searchRegistry} current={current} theme={theme} />
          )}
        </div>
      )}
      <article ref={audit} tabIndex={experimental ? undefined : -1} hidden={!experimental && !auditResult?.safe}>{content}</article>
    </main>
  );
}

function renderReadingContent(root: Root, source: typeof fixture, label: string, experimental: boolean) {
  const searchRegistry = experimental ? undefined : createReadingSearchRegistry();
  const canonical = createCurrentCanonical(
    () => source,
    () => new ReaderWorker(),
    "reading-legacy"
  );
  let closed = false;
  window.addEventListener("pagehide", () => {
    closed = true;
    canonical.dispose();
    searchRegistry?.dispose();
  }, { once: true });
  root.render(<p role="status">正在解析{label}…</p>);
  void canonical.request().then((result) => {
    if (closed) return;
    if (!result || !canonical.isCurrent(result)) {
      root.render(<p role="alert">无法解析{label}。</p>);
      return;
    }
    let verifiedArticle: HTMLElement | null = null;
    const retainVerifiedArticle = experimental ? undefined : (element: HTMLElement | null) => {
      verifiedArticle = element;
    };
    const current = experimental ? undefined : () =>
      !closed && verifiedArticle?.isConnected === true && canonical.isCurrent(result);
    root.render(
      <Reader
        content={commonmarkContent(result.tree, source.text, undefined, current, searchRegistry)}
        label={label}
        experimental={experimental}
        retainVerifiedArticle={retainVerifiedArticle}
        searchRegistry={searchRegistry}
        current={current}
      />
    );
  });
}

function waitForSnapshot(root: Root) {
  const removeReceiver = () => {
    window.clearTimeout(timer);
    window.removeEventListener(READER_SNAPSHOT_EVENT, receive);
    window.removeEventListener("pagehide", removeReceiver);
  };
  const receive = (event: Event) => {
    removeReceiver();
    const text = decodeReaderSnapshot(event instanceof CustomEvent ? event.detail : undefined);
    if (text === undefined) {
      root.render(<p role="alert">已保存版本无效。</p>);
      return;
    }
    renderReadingContent(root, { documentId: "reader-snapshot", revision: 1, identity: {}, text }, "已保存版本", false);
  };
  const timer = window.setTimeout(() => {
    removeReceiver();
    root.render(<p role="alert">未收到已保存版本。</p>);
  }, 5000);
  window.addEventListener(READER_SNAPSHOT_EVENT, receive, { once: true });
  window.addEventListener("pagehide", removeReceiver, { once: true });
  root.render(<p role="status">等待已保存版本…</p>);
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  if (container.hasAttribute("data-reader-snapshot")) waitForSnapshot(root);
  else renderReadingContent(root, fixture, "只读样本", true);
}
