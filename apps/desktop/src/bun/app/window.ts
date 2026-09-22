import {
  DEFAULT_WINDOW_FRAME,
  getWindowFrame,
  getWindowFullScreen,
  getWindowMaximized,
  getWindowZoom,
  loadWindowState,
} from "@agentic-markdown/shared/server";
import { BrowserWindow, Updater } from "electrobun/bun";

import {
  SHELL_PRELOAD,
  shellNavigationRules,
} from "../../security/shell-policy";
import type { Command } from "../../shared/commands";
import { logEvent } from "../logging";
import type { MainWindowRPC } from "../rpc";

import { registerMenuActions } from "./menu";
import {
  attachWindowStates,
  type WindowStatePersistence,
} from "./window-state";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      logEvent("window.development_server");
      return DEV_SERVER_URL;
    } catch {
      // Fall back to the bundled shell when the development server is absent.
    }
  }
  logEvent("window.packaged_assets");
  return "views://mainview/index.html";
}

export interface ManagedMainWindow {
  window: BrowserWindow;
  saveZoom: WindowStatePersistence["saveZoom"];
  flushState: WindowStatePersistence["flush"];
}

export async function createMainWindow({
  rpc,
  executeCommand,
  onWindowCreated,
  onFullScreenChange,
}: {
  rpc: MainWindowRPC;
  executeCommand: (command: Command, window: BrowserWindow) => void;
  onWindowCreated?: (window: BrowserWindow) => void;
  onFullScreenChange?: (isFullScreen: boolean) => void;
}): Promise<ManagedMainWindow> {
  const url = await getMainViewUrl();
  const windowState = await loadWindowState();
  const savedFrame = getWindowFrame(windowState) ?? DEFAULT_WINDOW_FRAME;
  const savedZoom = getWindowZoom(windowState) ?? 1;

  const window = new BrowserWindow({
    title: "Agentic Markdown",
    url,
    navigationRules: shellNavigationRules(url),
    preload: SHELL_PRELOAD,
    titleBarStyle: "hiddenInset",
    rpc,
    trafficLightOffset: { x: 2, y: 16 },
    frame: savedFrame,
  });
  onWindowCreated?.(window);

  const statePersistence = attachWindowStates(window, {
    isMaximized: getWindowMaximized(windowState),
    isFullScreen: getWindowFullScreen(windowState),
    zoom: savedZoom,
    onFullScreenChange,
  });
  registerMenuActions(window, executeCommand);
  return {
    window,
    saveZoom: (zoom) => statePersistence.saveZoom(zoom),
    flushState: () => statePersistence.flush(),
  };
}
