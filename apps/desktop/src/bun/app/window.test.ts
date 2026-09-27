import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  browserWindowListeners,
  electrobunBunMock,
  fakeBrowserWindow,
  resetFakeBrowserWindow,
  setFakeBrowserWindowFullScreen,
} from "../test-electrobun-mock";

await mock.module("electrobun/bun", () => electrobunBunMock);

const { createMainWindow } = await import("./window");

let previousAppHome: string | undefined;
let testAppHome: string;
const windows: Awaited<ReturnType<typeof createMainWindow>>[] = [];
beforeEach(async () => {
  previousAppHome = process.env.AGENTIC_MARKDOWN_HOME;
  testAppHome = await mkdtemp(join(tmpdir(), "agentic-window-test-"));
  process.env.AGENTIC_MARKDOWN_HOME = testAppHome;
});
afterEach(async () => {
  try {
    // Drain debounce timers before restoring the environment: otherwise a delayed
    // resize write could escape this fixture into actual user preferences.
    await Promise.all(windows.splice(0).map((window) => window.flushState()));
    await rm(testAppHome, { recursive: true, force: true });
  } finally {
    if (previousAppHome === undefined) delete process.env.AGENTIC_MARKDOWN_HOME;
    else process.env.AGENTIC_MARKDOWN_HOME = previousAppHome;
  }
});
async function createTestWindow(
  options: Parameters<typeof createMainWindow>[0]
) {
  const window = await createMainWindow(options);
  windows.push(window);
  return window;
}

test("creates a managed window whose pending state can be flushed", async () => {
  resetFakeBrowserWindow();
  const managedWindow = (await createTestWindow({
    rpc: {} as never,
    executeCommand: () => undefined,
  })) as unknown as {
    window?: unknown;
    saveZoom?: unknown;
    flushState?: unknown;
  };

  expect(managedWindow.window).toBe(fakeBrowserWindow);
  expect(managedWindow.saveZoom).toBeFunction();
  expect(managedWindow.flushState).toBeFunction();
});

test("reports the created window before the initial full-screen state", async () => {
  resetFakeBrowserWindow();
  const events: string[] = [];
  let createdWindow: unknown;

  await createTestWindow({
    rpc: {} as never,
    executeCommand: () => undefined,
    onWindowCreated: (window: unknown) => {
      createdWindow = window;
      events.push("window-created");
    },
    onFullScreenChange: () => events.push("full-screen-change"),
  });

  expect(createdWindow).toBe(fakeBrowserWindow);
  expect(events).toEqual(["window-created", "full-screen-change"]);
});

test("forwards observed full-screen changes", async () => {
  resetFakeBrowserWindow();
  const observed: boolean[] = [];

  await createTestWindow({
    rpc: {} as never,
    executeCommand: () => undefined,
    onFullScreenChange: (fullScreen: boolean) => observed.push(fullScreen),
  });

  expect(observed).toEqual([false]);
  setFakeBrowserWindowFullScreen(true);
  browserWindowListeners.get("resize")?.();
  expect(observed).toEqual([false, true]);
});
