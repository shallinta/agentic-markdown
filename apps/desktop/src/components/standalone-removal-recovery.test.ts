import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("removal retry is owned by the always-mounted main panel, not the inert sidebar", () => {
  const panel = readFileSync(
    new URL("./document-service-panel.tsx", import.meta.url),
    "utf8"
  );
  const page = readFileSync(
    new URL("../app/page.tsx", import.meta.url),
    "utf8"
  );
  const sidebar = panel.slice(
    panel.indexOf("export function StandaloneFileList"),
    panel.indexOf("export function DocumentServicePanel")
  );
  const main = panel.slice(
    panel.indexOf("export function DocumentServicePanel")
  );
  expect(sidebar).not.toContain("retryStandaloneRemoval");
  expect(main).toContain("{state.removalPending && (");
  const recoveryStart = main.indexOf("{state.removalPending && (");
  const recoveryEnd = main.indexOf("</button>", recoveryStart);
  expect(recoveryEnd).toBeGreaterThan(recoveryStart);
  const recovery = main.slice(recoveryStart, recoveryEnd + "</button>".length);
  expect(recovery).toContain("controller.retryStandaloneRemoval()");
  expect(recovery).not.toContain("disabled=");
  expect(recovery).not.toContain("inert=");
  expect(recovery).not.toContain("state.frozen");
  const content = page.slice(
    page.lastIndexOf("<ResizablePanel\n"),
    page.indexOf("</ResizablePanelGroup>")
  );
  expect(content).toContain("<DocumentServicePanel workspace={workspace} />");
  expect(content).not.toContain("inert=");
  expect(content).not.toContain("hidden={!visible}");
});

test("trash receipt query stays in the always-mounted main panel with only its query-in-flight guard", () => {
  const panel = readFileSync(new URL("./document-service-panel.tsx", import.meta.url), "utf8");
  const mainStart = panel.indexOf("export function DocumentServicePanel");
  expect(mainStart).toBeGreaterThan(0);
  const sidebar = panel.slice(panel.indexOf("export function StandaloneFileList"), mainStart);
  const main = panel.slice(mainStart);
  expect(sidebar).not.toContain("workspace.trash.retry()");
  const start = main.indexOf("{workspace.trashState.pending &&");
  expect(start).toBeGreaterThan(0);
  const end = main.indexOf("</button>", start);
  expect(end).toBeGreaterThan(start);
  const query = main.slice(start, end + "</button>".length);
  expect(query).toContain("workspace.trash.retry()");
  expect(query).toContain("查询废纸篓操作结果");
  expect(query).toContain("disabled={!workspace.trashState.canQuery}");
  expect(query).not.toContain("state.frozen");
  expect(query).not.toContain("inert=");
  expect(query).not.toContain("hidden=");
});
