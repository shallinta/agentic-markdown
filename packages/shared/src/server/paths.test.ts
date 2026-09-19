import { afterEach, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";

import { getAppHomePath, getWindowStatePath } from "./paths";

const originalHome = process.env.AGENTIC_MARKDOWN_HOME;
const originalStarterHome = process.env.ELECTROBUN_APP_STARTER_HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.AGENTIC_MARKDOWN_HOME;
  else process.env.AGENTIC_MARKDOWN_HOME = originalHome;
  if (originalStarterHome === undefined)
    delete process.env.ELECTROBUN_APP_STARTER_HOME;
  else process.env.ELECTROBUN_APP_STARTER_HOME = originalStarterHome;
});

test("default state belongs to Agentic Markdown and ignores the starter override", () => {
  delete process.env.AGENTIC_MARKDOWN_HOME;
  process.env.ELECTROBUN_APP_STARTER_HOME = "/tmp/starter-must-not-be-used";

  expect(getAppHomePath()).toBe(path.join(os.homedir(), ".agentic-markdown"));
  expect(getWindowStatePath()).toBe(
    path.join(os.homedir(), ".agentic-markdown", "settings", "window.json")
  );
});

test("the product override applies to persisted window state", () => {
  process.env.AGENTIC_MARKDOWN_HOME = "/tmp/agentic-markdown-path-test";

  expect(getAppHomePath()).toBe("/tmp/agentic-markdown-path-test");
  expect(getWindowStatePath()).toBe(
    "/tmp/agentic-markdown-path-test/settings/window.json"
  );
});
