import {
  isSidebarLayout,
  type SidebarLayout,
} from "@agentic-markdown/shared/sidebar-layout";
import { BrowserView, Utils, type BrowserWindow } from "electrobun/bun";

import type { Command } from "../../shared/commands";
import type { DocumentService } from "../../shared/documents";
import type { DesktopRPCType } from "../../shared/rpc";
import { isSourceWrappingRequest } from "../../shared/source-wrapping";
import type { WorkspaceService } from "../../shared/workspace";
import { setCommandAvailabilityInMenu } from "../app/menu";
import type { LocaleController } from "../i18n/controller";
import type { UpdaterService } from "../updates";

export type MainWindowRPC = ReturnType<
  typeof BrowserView.defineRPC<DesktopRPCType>
>;

export interface MainWindowRPCDependencies {
  documentMRU?: {
    begin(input: unknown): Promise<import("../../shared/document-mru").MRUSessionResponse>;
    record(input: unknown): Promise<import("../../shared/document-mru").MRUAck>;
    resolve(input: unknown): Promise<import("../../shared/document-mru").MRUResolveResponse>;
  };
  recentFiles?: {
    request(
      input: unknown
    ): Promise<import("../../shared/recent-files").RecentResponse>;
    reopen(
      input: unknown
    ): Promise<import("../../shared/documents").DocumentResponse>;
  };
  sourceWrapping?: {
    get(): Promise<boolean>;
    set(enabled: boolean): Promise<void>;
  };
  sidebar?: {
    get(): SidebarLayout | undefined;
    save(layout: SidebarLayout): Promise<void>;
  };
  documents: DocumentService & { reveal?: (request: unknown) => Promise<import("../../shared/documents").DocumentResponse>; openDefault?: (request: unknown) => Promise<import("../../shared/documents").DocumentResponse> };
  workspace?: WorkspaceService;
  executeCommand: (command: Command) => void;
  getMainWindow: () => BrowserWindow;
  locale: LocaleController;
  updater: UpdaterService;
}

const MAX_REQUEST_TIME_MS = 5 * 60_000 + 10_000;

export function createMainWindowRPC({
  documents,
  documentMRU,
  recentFiles,
  sidebar,
  sourceWrapping,
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
        beginMRUSession: input => documentMRU ? documentMRU.begin(input) : Promise.reject(Error("MRU unavailable")),
        recordDocumentActivation: input => documentMRU ? documentMRU.record(input) : Promise.reject(Error("MRU unavailable")),
        resolveDocumentMRU: input => documentMRU ? documentMRU.resolve(input) : Promise.reject(Error("MRU unavailable")),
        recentFiles: (input) =>
          recentFiles
            ? recentFiles.request(input)
            : Promise.resolve({
                available: false as const,
                reason: "io" as const,
              }),
        reopenRecentFile: (input) =>
          recentFiles
            ? recentFiles.reopen(input)
            : Promise.resolve({
                protocolVersion: 1 as const,
                requestId: input.requestId,
                ok: false as const,
                error: "INVALID_REQUEST" as const,
              }),
        getSourceWrapping: async (request) => {
          if (
            !sourceWrapping ||
            !request ||
            typeof request !== "object" ||
            Array.isArray(request) ||
            Object.keys(request).length
          )
            return { ok: false };
          try {
            return { ok: true, enabled: await sourceWrapping.get() };
          } catch {
            return { ok: false };
          }
        },
        setSourceWrapping: async (request) => {
          if (!sourceWrapping || !isSourceWrappingRequest(request))
            return { ok: false };
          try {
            await sourceWrapping.set(request.enabled);
            return { ok: true, enabled: request.enabled };
          } catch {
            return { ok: false };
          }
        },
        getSidebarLayout: (request) => {
          if (
            !request ||
            typeof request !== "object" ||
            Array.isArray(request) ||
            Object.keys(request).length ||
            !sidebar
          )
            return { ok: false };
          return { ok: true, layout: sidebar.get() };
        },
        saveSidebarLayout: async (request) => {
          if (!sidebar || !isSidebarLayout(request)) return { ok: false };
          try {
            await sidebar.save(request);
            return { ok: true };
          } catch {
            return { ok: false };
          }
        },
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
        revealWorkspaceItem: (request) =>
          workspace
            ? workspace.reveal(request)
            : Promise.resolve({
                protocolVersion: 1 as const,
                requestId: request.requestId,
                ok: false as const,
                error: "INVALID_HANDLE" as const,
              }),
        openDefaultWorkspaceItem: (request) => workspace
          ? workspace.openDefault(request)
          : Promise.resolve({ protocolVersion: 1 as const, requestId: request.requestId, ok: false as const, error: "INVALID_HANDLE" as const }),
        removeFolderRoot: (request) => {
          if (!workspace) throw Error("Workspace unavailable");
          return workspace.removeFolderRoot(request);
        },
        createMarkdown: (request) => {
          if (!workspace?.createMarkdown) throw Error("Workspace unavailable");
          return workspace.createMarkdown(request);
        },
        duplicateMarkdown: (request) => {
          if (!workspace?.duplicateMarkdown) throw Error("Workspace unavailable");
          return workspace.duplicateMarkdown(request);
        },
        createFolder: (request) => {
          if (!workspace?.createFolder) throw Error("Workspace unavailable");
          return workspace.createFolder(request);
        },
        removeStandalone: (request) => {
          if (!workspace) throw Error("Workspace unavailable");
          return workspace.removeStandalone(request);
        },
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
        observeDocument: (request) => documents.observe(request),
        saveDocument: (request) => documents.save(request),
        waitForDocumentSaves: (request) => documents.waitForSaves(request),
        selectDocument: (request) => documents.select(request),
        revealDocument: (request) => documents.reveal ? documents.reveal(request) : Promise.resolve({ protocolVersion: 1, requestId: request.requestId, ok: false, error: "READ_FAILED" }),
        openDefaultDocument: (request) => documents.openDefault ? documents.openDefault(request) : Promise.resolve({ protocolVersion: 1, requestId: request.requestId, ok: false, error: "READ_FAILED" }),
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
