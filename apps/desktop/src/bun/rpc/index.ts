import { BrowserView, type BrowserWindow } from "electrobun/bun";

import type { Command } from "../../shared/commands";
import type { DocumentService } from "../../shared/documents";
import type { DesktopRPCType } from "../../shared/rpc";
import { setCommandAvailabilityInMenu } from "../app/menu";
import type { LocaleController } from "../i18n/controller";
import type { UpdaterService } from "../updates";

export type MainWindowRPC = ReturnType<
  typeof BrowserView.defineRPC<DesktopRPCType>
>;

export interface MainWindowRPCDependencies {
  documents: DocumentService;
  executeCommand: (command: Command) => void;
  getMainWindow: () => BrowserWindow;
  locale: LocaleController;
  updater: UpdaterService;
}

const MAX_REQUEST_TIME_MS = 5 * 60_000 + 10_000;

export function createMainWindowRPC({
  documents,
  executeCommand,
  getMainWindow,
  locale,
  updater,
}: MainWindowRPCDependencies): MainWindowRPC {
  return BrowserView.defineRPC<DesktopRPCType>({
    maxRequestTime: MAX_REQUEST_TIME_MS,
    handlers: {
      requests: {
        selectDocument: (request) => documents.select(request),
        cancelDocument: (request) => documents.cancel(request),
        readDocument: (request) => documents.read(request),
        releaseDocument: (request) => documents.release(request),
        updateMode: () => updater.getUpdateModeSetting(),
        setUpdateMode: async ({ mode }) => {
          await updater.setUpdateModeSetting(mode);
          return null;
        },
        getLocale: () => locale.getLocale(),
        setLocale: async ({ locale: nextLocale }) => {
          await locale.setLocale(nextLocale);
          return null;
        },
        pendingInstalledVersion: () => updater.getInstalledVersion(),
        isFullScreen: () => ({
          fullScreen: getMainWindow().isFullScreen(),
        }),
      },
      messages: {
        executeCommand,
        commandAvailabilityChanged: setCommandAvailabilityInMenu,
      },
    },
  });
}
