import { getSettingsDir } from "@agentic-markdown/shared/server";
import Electrobun, {
  BrowserWindow,
  type ElectrobunEvent,
  Utils,
} from "electrobun/bun";

import {
  PACKAGED_READER_SNAPSHOT_URL,
  PACKAGED_READER_URL,
  readerNavigationRules,
} from "../../security/reader-policy";
import { PACKAGED_VIEW_URL } from "../../security/shell-policy";
import type { Command } from "../../shared/commands";
import { isReloadCommitResponse } from "../../shared/discard";
import { MRU_EXIT_MS } from "../../shared/document-mru";
import {
  validWorkspaceExpansionRequest,
  type WorkspaceExpansionResponse,
} from "../../shared/workspace-expansion";
import { executeCommandInBun } from "../commands";
import { createDocumentMRU } from "../document-mru";
import { createMRUService } from "../document-mru-service";
import { createDocumentService } from "../documents";
import { findReaderImageCandidates } from "../documents/reader-image-candidate";
import { createLocaleController } from "../i18n/controller";
import { createLocaleStateStore } from "../i18n/state";
import { logEvent } from "../logging";
import { createNativeFileCapabilities } from "../native-files";
import { createRecentFiles } from "../recent-files";
import { createRecentReopener } from "../reopen-recent-file";
import { createMainWindowRPC, type MainWindowRPC } from "../rpc";
import { createContentSearchRPC } from "../rpc/content-search";
import { UpdaterService } from "../updates";
import { createWorkspaceService } from "../workspace";
import { createExpansionService } from "../workspace/expansion-service";
import { createExpansionStore } from "../workspace/expansion-store";
import { createHiddenPreferences } from "../workspace/preferences";
import { createRootRosterService } from "../workspace/root-roster-service";

import { createDiscardCoordinator } from "./discard-coordinator";
import { createLifecycleGuard } from "./lifecycle-guard";
import { setLocaleInMenu, setReaderCloseAvailabilityInMenu } from "./menu";
import { createReaderLab } from "./reader-lab";
import { createMainWindow, type ManagedMainWindow } from "./window";

export interface DesktopAppRuntime {
  stop(): Promise<void>;
}

export async function startDesktopApp(): Promise<DesktopAppRuntime> {
  let mainWindow: ManagedMainWindow | null = null;
  let browserWindow: BrowserWindow | null = null;
  let rpc: MainWindowRPC | null = null;
  const syntheticReader = process.env.AGENTIC_MARKDOWN_READER_LAB === "1";
  const perfLabEnabled = process.env.AGENTIC_MARKDOWN_PERF_LAB === "1";
  const searchLabEnabled = process.env.AGENTIC_MARKDOWN_SEARCH_LAB === "1";
  const readerSnapshotEnabled = !syntheticReader && !perfLabEnabled && !searchLabEnabled;
  const openReaderWindow = (url: typeof PACKAGED_READER_URL | typeof PACKAGED_READER_SNAPSHOT_URL) =>
    new BrowserWindow({
      title: url === PACKAGED_READER_URL ? "独立阅读窗口实验" : "独立阅读窗口",
      url,
      renderer: "native",
      sandbox: true,
      navigationRules: readerNavigationRules(url),
      titleBarStyle: "default",
      hidden: true,
      activate: false,
      frame: { width: 680, height: 720 },
    });
  const nativeFiles = createNativeFileCapabilities();
  const recent = createRecentFiles(getSettingsDir(), (reason) =>
    rpc?.send.recentFilesFailed({ reason })
  );
  const mru = createDocumentMRU(getSettingsDir(), () => logEvent("mru.unavailable"));
  await mru.initialize();
  let mruDeadline = 0;
  const documents = createDocumentService({
    mru,
    revealPath: (path) => Utils.showItemInFolder(path),
    openDefaultPath: (path) => Utils.openPath(path),
    onExternalChanged: (event) => rpc?.send.documentExternalChanged(event),
    pickFile: (startingFolder) => nativeFiles.pickFile(startingFolder),
    onStandaloneSelected: (metadata) => recent.recordSelected(metadata),
    onCapabilityChanged: (handle) =>
      rpc?.send.documentCapabilityChanged({ handle }),
  });
  const readerLab = readerSnapshotEnabled
    ? createReaderLab(undefined, {
        capture: (source, current, options) => documents.captureReadingSnapshot(source, current, options),
        captureImageProof: (source, current) => documents.captureReadingImageProof(source, current),
        candidate: findReaderImageCandidates,
        open: () => openReaderWindow(PACKAGED_READER_SNAPSHOT_URL),
      }, setReaderCloseAvailabilityInMenu)
    : syntheticReader
      ? createReaderLab(() => openReaderWindow(PACKAGED_READER_URL), undefined, setReaderCloseAvailabilityInMenu)
      : undefined;
  const workspace = createWorkspaceService({
    onRootRosterCommitted: event => rootRoster.committed(event),
    preferences: createHiddenPreferences(getSettingsDir()),
    pickDirectory: () => nativeFiles.pickDirectory(),
    documents,
    contentSearchStrategy: "direct",
  });
  const expansionStore = createExpansionStore(getSettingsDir());
  const rootRoster = createRootRosterService(
    getSettingsDir(),
    () => workspace.rootMutationsSuspended(),
    () => rpc?.send.workspaceRootRosterChanged({}),
    () => workspace.rootMutationGeneration(),
    () => {
      void pruneExpansion().catch(() => undefined);
    }
  );
  const expansion = createExpansionService({
    workspace,
    roster: rootRoster,
    store: expansionStore,
  });
  let expansionAdmissionSuspensions = 0;
  let expansionWriteCount = 0;
  let expansionWriteTail: Promise<void> | undefined;
  const expansionUnavailable = (): Promise<WorkspaceExpansionResponse> =>
    Promise.resolve({ protocolVersion: 1, ok: false, error: "unavailable" });
  function requestExpansion(input: unknown): Promise<WorkspaceExpansionResponse> {
    if (expansionAdmissionSuspensions || !validWorkspaceExpansionRequest(input))
      return expansionUnavailable();
    if (input.op === "read") return expansion.request(input);
    if (expansionWriteCount >= 64) return expansionUnavailable();
    expansionWriteCount++;
    const result = expansionWriteTail
      ? expansionWriteTail.then(() => expansion.request(input))
      : expansion.request(input);
    const complete = () => {
      expansionWriteCount--;
      if (!expansionWriteCount) expansionWriteTail = undefined;
    };
    expansionWriteTail = result.then(complete, complete);
    return result;
  }
  async function pruneExpansion() {
    const proof = await rootRoster.confirmExpansionRoster();
    if (!proof?.current()) return;
    const saved = await expansionStore.read();
    if (
      !proof.current() ||
      saved.readOnly ||
      saved.failure ||
      !saved.roots.some(({ rootId }) => !proof.ids.includes(rootId))
    )
      return;
    await expansionStore.prune(proof.ids, proof.current);
  }
  const searchLab = searchLabEnabled
    ? (await import("../perf-lab/search")).createSearchLab()
    : undefined;
  const contentSearch = !searchLab && !perfLabEnabled
    ? createContentSearchRPC(workspace, async (handle) => {
        const result = await documents.release({
          protocolVersion: 1, requestId: crypto.randomUUID(), handle,
        });
        return result.ok;
      }, (progress) => rpc?.send.contentSearchProgress(progress))
    : undefined;

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
    prepare: (request) => {
      if (request.reason === "quit" && browserWindow)
        readerLab?.activateMainForDiscard(browserWindow);
      mruDeadline = performance.now() + MRU_EXIT_MS;
      return getRpc().request.prepareDiscard({...request,mruBudgetMs:Math.max(0,mruDeadline-performance.now())});
    },
    release: (requestId) => getRpc().send.finishDiscard({ requestId }),
  });
  const lifecycle = createLifecycleGuard({
    guard: async (reason, execute) => {
      expansionAdmissionSuspensions++;
      try {
        if (expansionWriteTail) await expansionWriteTail;
        const resumeRootMutations = workspace.suspendRootMutations();
        const resumeSearch = contentSearch?.suspend();
        const resumeSnapshots = readerSnapshotEnabled && browserWindow?.url === PACKAGED_VIEW_URL
          ? readerLab?.suspendSnapshots() : undefined;
        workspace.trashLifecycle.beforeExit();
        try {
          // A canceled search may still need to release an unclaimed grant.
          await contentSearch?.drain();
          return await documents.withWriteBarrier(() =>
            guard(reason, async (requestId) => {
              const settled=await workspace.trashLifecycle.finishExit(Date.now()+2_000);
              if(!settled){console.warn("Trash operation result remains unknown during exit");try{getRpc().send.trashNotice({reason:"exit-pending"});}catch{/* Exit notice is best effort; never restart the receipt deadline. */}}
              await recent.drain();
              await rootRoster.drain();
              await expansionStore.drain();
              await mru.drainUntil(mruDeadline);
              return execute(requestId);
            })
          );
        } finally { workspace.trashLifecycle.cancelExit(); resumeRootMutations(); resumeSearch?.(); resumeSnapshots?.(); }
      } finally {
        expansionAdmissionSuspensions--;
      }
    },
    // Flush is non-destructive. Another SDK listener can still veto quit;
    // never dispose document grants until the process actually exits.
    stop: async () => {
      await mainWindow?.flushState();
      await searchLab?.close();
    },
    quit: () => Utils.quit(),
    reload: async (requestId) => {
      await searchLab?.close();
      const transition=mru.beginTransition();
      contentSearch?.setReady(false);
      const response: unknown = await getRpc().request.commitReload({
        protocolVersion: 1,
        requestId,
      });
      if(isReloadCommitResponse(response, requestId)&&!response.committed){
        mru.cancelTransition(transition);
        contentSearch?.setReady(true);
      }
      return isReloadCommitResponse(response, requestId)&&response.committed;
    },
    update: () => updater.applyUpdateAndRestart(),
    beforeUpdate: async () => {
      await mainWindow?.flushState();
      await searchLab?.close();
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
        ["reader lab", () => readerLab?.dispose()],
        ["content search", async () => {
          contentSearch?.setReady(false);
          await contentSearch?.drain();
        }],
        ["search lab", () => searchLab?.dispose()],
        ["workspace", () => workspace.dispose()],
        ["workspace expansion", () => expansionStore.close()],
        ["root roster", () => rootRoster.close()],
        ["documents", () => documents.dispose()],
        ["recent files", () => recent.drain()],
        ["document MRU", async () => {await mru.drainUntil(mruDeadline || performance.now()+MRU_EXIT_MS);mru.dispose();}],
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
      sourceWrapping: (await import("../source-wrapping")).sourceWrappingStore,
      sidebar: {
        get: () => mainWindow?.getSidebar(),
        save: (layout) =>
          mainWindow
            ? mainWindow.saveSidebar(layout)
            : Promise.reject(Error("WINDOW_NOT_READY")),
      },
      documents,
      documentMRU: createMRUService(mru,documents,workspace),
      recentFiles: {
        request: (input) => recent.request(input),
        reopen: createRecentReopener(documents, (id) => recent.find(id)),
      },
      workspace,
      workspaceRootRoster: input => rootRoster.request(input),
      workspaceExpansion: requestExpansion,
      searchLab,
      contentSearch,
      openReadingSnapshot: readerSnapshotEnabled && readerLab
        ? async (input) => browserWindow?.url === PACKAGED_VIEW_URL
          ? readerLab.openReadingSnapshot(input, browserWindow)
          : { ok: false, error: "UNAVAILABLE" }
        : undefined,
      executeCommand: (command) => executeCommand(command, getMainWindow()),
      getMainWindow,
      locale,
      updater,
    });
    mainWindow = await createMainWindow({
      rpc,
      readerSnapshotEnabled,
      executeCommand: (command, window) => {
        if (!readerLab?.interceptMenu(command)) executeCommand(command, window);
      },
      onWindowCreated: (window) => {
        browserWindow = window;
        if (window.url === PACKAGED_VIEW_URL) readerLab?.bindMain(window);
        mru.bindWindow();
        if (readerSnapshotEnabled && window.url === PACKAGED_VIEW_URL)
          window.webview.on("did-commit-navigation", () => readerLab?.retireMainReady(window));
        window.webview.on("dom-ready",(event)=>{
          mru.domReady();
          contentSearch?.setReady(true);
          readerLab?.openAfterMainReady(window, event);
        });
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
