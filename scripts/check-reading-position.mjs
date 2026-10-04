// Actual React/layout/controller/canonical Worker regression, not desktop UI.
// Requires project dependencies, external Playwright and installed Chrome.
// PLAYWRIGHT_PACKAGE=/absolute/path/to/playwright node scripts/check-reading-position.mjs
// Optional CHROME_EXECUTABLE; default is Playwright's installed Chrome channel.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const desktopRequire = createRequire(path.resolve("apps/desktop/package.json"));
const { createServer } = await import(desktopRequire.resolve("vite"));
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright");
const parser = desktopRequire.resolve("mdast-util-from-markdown");
const decoder = createRequire(parser).resolve(
  "decode-named-character-reference"
);
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  resolve: {
    alias: {
      "@": path.resolve("apps/desktop/src"),
      "decode-named-character-reference": decoder,
      "mdast-util-from-markdown": parser,
    },
  },
  // Avoid dependency discovery reloads during assertions. Pre-optimize mdast's
  // CJS dependencies for the real dev Worker and use its pure decoder export.
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom/client",
      "mdast-util-from-markdown",
    ],
  },
  server: { host: "127.0.0.1", port: 0 },
  esbuild: { jsx: "automatic" },
  plugins: [
    {
      name: "position-harness",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url === "/favicon.ico") {
            response.statusCode = 204;
            response.end();
            return;
          }
          if (request.url !== "/position-harness") return next();
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(
            '<div id="root"></div><style>[aria-label="Markdown 阅读区"]{overflow:auto;flex:1;min-height:0}</style><script type="module" src="/apps/desktop/scripts/reading-position-fixture.tsx"></script>'
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
  const ready = (id) =>
    page.waitForFunction(
      (id) =>
        document
          .querySelector("[data-reading-content]")
          ?.textContent?.startsWith(`${id}0`),
      id
    );
  const start = async () => {
    await page.goto(`${server.resolvedUrls.local[0]}position-harness`, {
      waitUntil: "domcontentloaded",
    });
    await ready("A");
  };
  const scroll = (top) =>
    page.evaluate((top) => {
      document.querySelector('[aria-label="Markdown 阅读区"]').scrollTop = top;
    }, top);
  const position = () =>
    page.evaluate(() => ({
      saved: window.positionHarness.controller.getViewport(
        "00000000-0000-4000-8000-000000000001"
      ),
      scroll: document.querySelector('[aria-label="Markdown 阅读区"]')
        .scrollTop,
    }));
  await start();
  await scroll(1600);
  await page.evaluate(() =>
    window.positionHarness.controller.activateTab(
      "00000000-0000-4000-8000-000000000002"
    )
  );
  await ready("B");
  const departure = await position();
  await page.evaluate(() =>
    window.positionHarness.controller.activateTab(
      "00000000-0000-4000-8000-000000000001"
    )
  );
  await ready("A");
  assert.ok(
    departure.saved.from > 0,
    "departure anchor survives old layout cleanup"
  );
  assert.equal(
    (await position()).scroll,
    1600,
    "reading A/B/A restores actual scroll"
  );
  for (const themeChange of [false, true]) {
    await start();
    await page.evaluate(() =>
      window.positionHarness.controller.activateTab(
        "00000000-0000-4000-8000-000000000002"
      )
    );
    await ready("B");
    await page.evaluate(async () => {
      await window.positionHarness.controller.closeActive();
    });
    await ready("A");
    await scroll(2200);
    await page.evaluate(async () => {
      await window.positionHarness.controller.select();
    });
    await ready("A");
    assert.equal(
      (await position()).scroll,
      2200,
      "duplicate select captures before busy"
    );
    await page.evaluate(async () => {
      await window.positionHarness.controller.select();
    });
    await page.waitForSelector("[data-editor-placeholder]");
    await page.evaluate(async (themeChange) => {
      const { controller, themes } = window.positionHarness;
      if (themeChange) themes.select("ink");
      await controller.closeActive();
    }, themeChange);
    await ready("A");
    assert.ok(
      (await position()).scroll > 1000,
      "close editor B restores A rather than title"
    );
  }
  for (const outcome of ["cancel", "failure"]) {
    await start();
    await scroll(1800);
    await page.evaluate(async (outcome) => {
      window.positionHarness.setOutcome(outcome);
      await window.positionHarness.controller.select();
    }, outcome);
    await ready("A");
    assert.equal(
      (await position()).scroll,
      1800,
      `${outcome} preserves reading position`
    );
  }
  assert.deepEqual(errors, [], "no uncaught browser errors");
  console.info(
    "PASS: A/B/A; duplicate select; new editor B/close with and without theme; select cancel/failure. Actual Chrome React DOM + canonical Worker; not WKWebView or CodeMirror interaction."
  );
} finally {
  await browser?.close();
  await server.close();
}
