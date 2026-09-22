import { getSettingsDir } from "@agentic-markdown/shared/server";
import Electrobun, {
  type BrowserWindow,
  type ElectrobunEvent,
  Utils,
} from "electrobun/bun";

import type { Command } from "../../shared/commands";
import { isReloadCommitResponse } from "../../shared/discard";
import { executeCommandInBun } from "../commands";
import { createDocumentService } from "../documents";
import { createLocaleController } from "../i18n/controller";
import { createLocaleStateStore } from "../i18n/state";
import { logEvent } from "../logging";
import { createNativeFileCapabilities } from "../native-files";
import { createMainWindowRPC, type MainWindowRPC } from "../rpc";
import { UpdaterService } from "../updates";

import { createDiscardCoordinator } from "./discard-coordinator";
import { createLifecycleGuard } from "./lifecycle-guard";
import { setLocaleInMenu } from "./menu";
import { createMainWindow, type ManagedMainWindow } from "./window";

export interface DesktopAppRuntime {
  stop(): Promise<void>;
}

export async function startDesktopApp(): Promise<DesktopAppRuntime> {
  let mainWindow: ManagedMainWindow | null = null;
  let browserWindow: BrowserWindow | null = null;
  let rpc: MainWindowRPC | null = null;
  const nativeFiles = createNativeFileCapabilities();
  const documents = createDocumentService({
    pickFile: () => nativeFiles.pickFile(),
  });

  const getRpc = (): MainWindowRPC => {
    if (!rpc) throw new Error("Main window RPC is not ready.");
    return rpc;
  };
  const getMainWindow = (): BrowserWindow => {
    if (!browserWindow) throw new Error("Main window is not ready.");
    return browserWindow;
  };

  const updater = new UpdaterService((message) =>
    getRpc().send.updateStatusChanged(message)
  );
  const guard = createDiscardCoordinator({
    prepare: (request) => getRpc().request.prepareDiscard(request),
    release: (requestId) => getRpc().send.finishDiscard({ requestId }),
  });
  const lifecycle = createLifecycleGuard({
    guard,
    // Flush is non-destructive. Another SDK listener can still veto quit;
    // never dispose document grants until the process actually exits.
    stop: async () => {
      await mainWindow?.flushState();
    },
    quit: () => Utils.quit(),
    reload: async (requestId) => {
      const response: unknown = await getRpc().request.commitReload({
        protocolVersion: 1,
        requestId,
      });
      return isReloadCommitResponse(response, requestId) && response.committed;
    },
    update: () => updater.applyUpdateAndRestart(),
    beforeUpdate: async () => {
      await mainWindow?.flushState();
    },
  });
  const commandDependencies = {
    openExternal: Utils.openExternal,
    sendToWebview: (command: Command) => getRpc().send.executeCommand(command),
    saveZoom: (zoom: number) => mainWindow?.saveZoom(zoom),
    updater,
    lifecycle,
  };
  const executeCommand = (command: Command, window: BrowserWindow): void =>
    executeCommandInBun(command, window, commandDependencies);

  let stopPromise: Promise<void> | null = null;
  const runtime: DesktopAppRuntime = {
    stop() {
      stopPromise ??= stopDesktopApp([
        ["documents", () => documents.dispose()],
        ["window state", () => mainWindow?.flushState()],
        ["updater", () => updater.stop()],
      ]);
      return stopPromise;
    },
  };

  // Install the veto before creating a renderer that can become editable.
  Electrobun.events.on(
    "before-quit",
    (event: ElectrobunEvent<{}, { allow: boolean }>) =>
      lifecycle.beforeQuit(event)
  );

  try {
    const locale = createLocaleController({
      store: createLocaleStateStore(
        getSettingsDir(),
        () => Intl.DateTimeFormat().resolvedOptions().locale
      ),
      activateLocale: setLocaleInMenu,
      onLocaleChanged: (nextLocale) =>
        getRpc().send.localeChanged({ locale: nextLocale }),
    });
    await locale.initialize();
    rpc = createMainWindowRPC({
      documents,
      executeCommand: (command) => executeCommand(command, getMainWindow()),
      getMainWindow,
      locale,
      updater,
    });
    mainWindow = await createMainWindow({
      rpc,
      executeCommand,
      onWindowCreated: (window) => {
        browserWindow = window;
        window.on("will-close", (event) =>
          lifecycle.beforeClose(
            event as ElectrobunEvent<{}, { allow: boolean }>
          )
        );
      },
      onFullScreenChange: (fullScreen) =>
        getRpc().send.fullScreenChanged({ fullScreen }),
    });
    void updater.start();

    logEvent("app.started");
    return runtime;
  } catch (error) {
    logEvent("app.start_failed");
    await runtime.stop();
    throw error;
  }
}

async function stopDesktopApp(
  cleanups: readonly [name: string, cleanup: () => Promise<void> | void][]
): Promise<void> {
  for (const [, cleanup] of cleanups) {
    try {
      await cleanup();
    } catch {
      logEvent("app.cleanup_failed");
    }
  }
  logEvent("app.stopped");
}
