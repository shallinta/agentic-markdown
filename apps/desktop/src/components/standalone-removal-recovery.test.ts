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
  const recovery = main.slice(
    main.indexOf("{state.removalPending && ("),
    main.indexOf("{snapshot && controller.externalMessage")
  );
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
