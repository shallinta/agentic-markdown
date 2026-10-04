import { BrowserView, Utils, type BrowserWindow } from "electrobun/bun";

import type { Command } from "../../shared/commands";
import type { DocumentService } from "../../shared/documents";
import type { DesktopRPCType } from "../../shared/rpc";
import type { WorkspaceService } from "../../shared/workspace";
import { setCommandAvailabilityInMenu } from "../app/menu";
import type { LocaleController } from "../i18n/controller";
import type { UpdaterService } from "../updates";

export type MainWindowRPC = ReturnType<
  typeof BrowserView.defineRPC<DesktopRPCType>
>;

export interface MainWindowRPCDependencies {
  documents: DocumentService;
  workspace?: WorkspaceService;
  executeCommand: (command: Command) => void;
  getMainWindow: () => BrowserWindow;
  locale: LocaleController;
  updater: UpdaterService;
}

const MAX_REQUEST_TIME_MS = 5 * 60_000 + 10_000;

export function createMainWindowRPC({
  documents,
  workspace,
  executeCommand,
  getMainWindow,
  locale,
  updater,
}: MainWindowRPCDependencies): MainWindowRPC {
  const enabled = process.env.AGENTIC_MARKDOWN_PERF_LAB === "1";
  const autorun = enabled && process.env.AGENTIC_MARKDOWN_PERF_AUTO === "1";
  let lab:
    | Promise<
        ReturnType<(typeof import("../perf-lab"))["createPerfLabService"]>
      >
    | undefined;
  return BrowserView.defineRPC<DesktopRPCType>({
    maxRequestTime: MAX_REQUEST_TIME_MS,
    handlers: {
      requests: {
        workspaceRequest: (request) =>
          workspace
            ? workspace.request(request)
            : Promise.resolve({
                protocolVersion: 1 as const,
                requestId: request.requestId,
                ok: false as const,
                error: "UNAVAILABLE" as const,
              }),
        openWorkspaceDocument: (request) =>
          workspace
            ? workspace.open(request)
            : Promise.resolve({
                protocolVersion: 1 as const,
                requestId: request.requestId,
                ok: false as const,
                error: "INVALID_HANDLE" as const,
              }),
        perfLabStatus: () => ({ enabled, autorun }),
        perfLabRequest: async (request) => {
          if (!enabled) return { ok: false, error: "DISABLED" as const };
          lab ??= import("../perf-lab").then((module) =>
            module.createPerfLabService({
              enabled,
              openEnabled: process.env.AGENTIC_MARKDOWN_PERF_OPEN === "1",
            })
          );
          const result = await (await lab).run(request);
          if (
            result.ok &&
            request.op === "report" &&
            autorun &&
            process.env.AGENTIC_MARKDOWN_PERF_AUTO_EXIT === "1"
          )
            setTimeout(() => Utils.quit(), 1000);
          return result;
        },
        checkDocumentWriteCapability: (request) =>
          documents.checkWriteCapability(request),
        saveDocument: (request) => documents.save(request),
        waitForDocumentSaves: (request) => documents.waitForSaves(request),
        selectDocument: (request) => documents.select(request),
        cancelDocument: (request) => documents.cancel(request),
        readDocument: (request) => documents.read(request),
        readLocalImage: (request) => documents.readLocalImage(request),
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
