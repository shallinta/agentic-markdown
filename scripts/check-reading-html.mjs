// Real Chrome React + DOMPurify. No network isolation or request abortion.
// PLAYWRIGHT_PACKAGE=/absolute/path/to/playwright node scripts/check-reading-html.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const desktopRequire = createRequire(path.resolve("apps/desktop/package.json"));
const { createServer } = await import(desktopRequire.resolve("vite"));
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright");
const parser = desktopRequire.resolve("mdast-util-from-markdown");
let resourceRequests = 0;
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  resolve: {
    alias: {
      "@": path.resolve("apps/desktop/src"),
      "mdast-util-from-markdown": parser,
      dompurify: desktopRequire.resolve("dompurify"),
      "tailwindcss/preflight.css": desktopRequire.resolve(
        "tailwindcss/preflight.css"
      ),
      "decode-named-character-reference": createRequire(parser).resolve(
        "decode-named-character-reference"
      ),
    },
  },
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client",
      "mdast-util-from-markdown",
      "dompurify",
    ],
  },
  server: { host: "127.0.0.1", port: 0 },
  esbuild: { jsx: "automatic" },
  plugins: [
    {
      name: "html-harness",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url?.startsWith("/resource-probe")) {
            resourceRequests++;
            response.statusCode = 204;
            response.end();
            return;
          }
          if (request.url === "/favicon.ico") {
            response.statusCode = 204;
            response.end();
            return;
          }
          if (request.url !== "/html-harness") return next();
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(
            '<div id="root"></div><script type="module" src="/apps/desktop/scripts/reading-html-fixture.tsx"></script>'
          );
        });
      },
    },
  ],
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    ...(process.env.CHROME_EXECUTABLE
      ? { executablePath: process.env.CHROME_EXECUTABLE }
      : { channel: "chrome" }),
    headless: true,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const base = server.resolvedUrls.local[0];
  await page.goto(`${base}html-harness`);
  await page.waitForFunction(() => !!window.htmlHarness);
  const result = await page.evaluate(async (base) => {
    const harness = window.htmlHarness;
    const content = document.getElementById("reading-content");
    const demand = (value, message) => {
      if (!value) throw Error(message);
    };
    const cases = [];
    for (const source of [
      "<p>安全 <strong>粗体</strong> &lt;img&gt;</p>",
      "<ul><li>一</li><li>二</li></ul>",
      "<blockquote><p>引用</p></blockquote>",
      "<pre><code>代码</code></pre>",
    ]) {
      const result = harness.prepare(source);
      demand(
        result.mode === "sanitized" && result.calls === 1,
        `safe ${source}`
      );
      cases.push(result);
      harness.source(source);
      demand(!content.querySelector('[role="status"]'), "safe not fallback");
      demand(harness.audit().safe, "mounted safe DOM audit");
    }
    const source = "<p>原文 <strong>不变</strong></p>";
    harness.source(
      "<ul><li>一</li></ul>\n\n<ol><li>二</li></ol>\n\n<blockquote><p>引用</p></blockquote>\n\n<hr>\n\n<pre><code>代码</code></pre>"
    );
    const computed = {};
    for (const theme of ["paper", "ink"]) {
      harness.theme(theme);
      const style = (tag) => getComputedStyle(content.querySelector(tag));
      demand(
        style("ul").listStyleType === "disc" &&
          parseFloat(style("ul").paddingInlineStart) > 0,
        "ul survives production preflight"
      );
      demand(
        style("ol").listStyleType === "decimal",
        "ol survives production preflight"
      );
      demand(
        parseFloat(style("blockquote").borderInlineStartWidth) > 0 &&
          parseFloat(style("blockquote").paddingInlineStart) > 0,
        "quote survives reset"
      );
      demand(parseFloat(style("hr").borderTopWidth) > 0, "hr survives reset");
      demand(
        parseFloat(style("pre").paddingTop) > 0 &&
          style("pre").overflowX === "auto",
        "pre survives reset"
      );
      computed[theme] = {
        ul: style("ul").listStyleType,
        ol: style("ol").listStyleType,
        quote: style("blockquote").borderInlineStartWidth,
        hr: style("hr").borderTopWidth,
        pre: style("pre").backgroundColor,
      };
    }
    harness.source(source);
    const before = [...content.querySelectorAll("*")];
    for (const theme of ["ink", "paper", "ink"]) {
      harness.theme(theme);
      demand(
        [...content.querySelectorAll("*")].every(
          (node, index) => node === before[index]
        ),
        "theme rebuilt HTML DOM"
      );
    }
    const probe = `${base}resource-probe`;
    for (const source of [
      `<img src="${probe}">`,
      `<iframe src="${probe}"></iframe>`,
      `<link rel="stylesheet" href="${probe}">`,
      `<p style="background:url(${probe})">x</p>`,
      "<script>window.__htmlExecuted=true</script>",
      '<p><svg><image href="x"></image></svg></p>',
      '<p onclick="bad()">x</p>',
    ]) {
      const result = harness.prepare(source);
      demand(
        result.mode === "source" && result.calls === 0,
        "unsafe called sanitizer"
      );
      harness.source(source);
      demand(
        content.querySelector("pre")?.textContent === source,
        `full source fallback: ${source} -> ${content.innerHTML}`
      );
      demand(
        harness.audit().safe &&
          !content.querySelector("script,img,iframe,link,svg"),
        "unsafe mounted DOM"
      );
      cases.push(result);
    }
    for (const source of ["<p><p>normalized</p></p>", "<p>\r\nline</p>"]) {
      const result = harness.prepare(source);
      demand(
        result.mode === "source" && result.calls === 1,
        "normalization should preserve source"
      );
      harness.source(source);
      demand(
        content.querySelector("pre")?.textContent === source,
        "normalization full source"
      );
    }
    harness.source("before <strong>inline</strong> after");
    demand(
      content.textContent.includes("<strong>inline</strong>") &&
        !content.querySelector("strong"),
      "inline raw"
    );
    harness.source("<p>new revision</p>");
    demand(
      content.textContent === "new revision",
      "new source replaces old fragment"
    );
    const many = Array.from(
      { length: 256 },
      (_, i) => `<p>安全小块 ${i}</p>`
    ).join("\n\n");
    const manyStart = performance.now();
    harness.source(many);
    const manyElapsedMs = performance.now() - manyStart;
    demand(
      content.querySelectorAll("p").length === 256 && harness.audit().safe,
      "many small blocks"
    );
    harness.source(many + "\n\n<p>第257块保留</p>");
    demand(
      content.querySelector("pre")?.textContent === "<p>第257块保留</p>",
      "257th full fallback"
    );
    const full = Array.from({ length: 15000 }, () => `<hr>\n\n`).join("");
    const fullStart = performance.now();
    harness.source(full);
    const fullElapsedMs = performance.now() - fullStart;
    demand(
      content.querySelectorAll("hr").length === 256,
      "full source caps sanitizer blocks"
    );
    demand(
      content.querySelectorAll("pre").length === 15000 - 256,
      "remaining blocks full fallback"
    );
    const changeStart = performance.now();
    harness.source("<p>source switched after budget case</p>");
    const sourceChangeElapsedMs = performance.now() - changeStart;
    demand(
      content.textContent === "source switched after budget case",
      "old blocks released"
    );
    demand(!window.__htmlExecuted, "script executed");
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      cases,
      manyBlocks: 256,
      manySourceUtf16: many.length,
      manyElapsedMs,
      computed,
      fullBlocks: 15000,
      fullSourceUtf16: full.length,
      fullElapsedMs,
      sourceChangeElapsedMs,
      domElements: content.querySelectorAll("*").length,
      audit: harness.audit(),
    };
  }, base);
  assert.equal(
    resourceRequests,
    0,
    "malicious HTML never fetched local probe endpoint"
  );
  assert.deepEqual(errors, [], "no browser errors");
  console.info(
    JSON.stringify({
      result,
      resourceRequests,
      evidence:
        "Actual Chrome React DOMPurify; not WKWebView, not offline, not a memory/timing guarantee",
    })
  );
} finally {
  await browser?.close();
  await server.close();
}
