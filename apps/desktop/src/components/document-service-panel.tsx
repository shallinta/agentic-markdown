import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@agentic-markdown/ui/ui/dialog";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { createMarkdownController, duplicateDefaultTarget } from "@/client/create-markdown";
import CurrentCanonicalWorker from "@/client/current-canonical.worker?worker&inline";
import { discardGuard } from "@/client/discard-guard";
import {
  canonicalDiscardParticipant,
  createDocumentCanonical,
} from "@/client/document-canonical";
import { createDocumentMRU } from "@/client/document-mru";
import {
  documentCapabilitySuffix,
  documentStatusLabel,
} from "@/client/document-status-label";
import {
  createDocumentController,
} from "@/client/documents";
import { createFolderRemoval } from "@/client/folder-removal";
import { isExternalTextTarget } from "@/client/history-target";
import {
  runInlineFormat,
  runNativeInlineFormat,
} from "@/client/inline-format-input";
import { longLineProtection } from "@/client/long-line-protection";
import { attachMainTabActivationCheckpoint } from "@/client/main-tab-activation-checkpoint";
import { createQuickOpen } from "@/client/quick-open";
import type { RasterPasteSource } from "@/client/raster-paste-intent";
import { captureRasterWorkspaceAuthority, createRasterPasteTransport } from "@/client/raster-paste-workspace";
import { rawText } from "@/client/raw-buffer";
import { routeRecentTabKey } from "@/client/recent-tab-shortcut";
import { routeSourceModeShortcut } from "@/client/source-mode-shortcut";
import { createTrashDocument, type TrashChoice, type TrashDialog } from "@/client/trash-document";
import { createFolderWorkspace } from "@/client/workspace";
import { createWorkspaceReveal } from "@/client/workspace-reveal";
import { createWorkspaceRootOrder } from "@/client/workspace-root-order";
import { projectWorkspaceTree } from "@/client/workspace-tree-model";
import { useCommands, useRegisterCommands } from "@/commands";
import { useSourceWrapping } from "@/hooks/use-source-wrapping";
import { useWorkspaceRootRoster } from "@/hooks/use-workspace-root-roster";
import { electrobun } from "@/lib/electrobun";
import { createNativeDocumentTransport } from "@/lib/native-document-transport";
import { PACKAGED_VIEW_URL } from "@/security/shell-policy";
import { PRODUCT_COMMANDS } from "@/shared/commands";
import type { CreateTarget } from "@/shared/create-markdown";
import type { FolderRemovalDocument } from "@/shared/folder-removal";
import type { LocalImageRequest } from "@/shared/local-images";
import { analyzeTextFidelity } from "@/shared/text-fidelity";
import type { TrashTarget } from "@/shared/trash-document";
import type { WorkspaceRevealTarget } from "@/shared/workspace";

import { ContentSearchPanel } from "./content-search-panel";
import { CreateMarkdownDialog } from "./create-markdown-dialog";
import { DocumentDiscardDialog } from "./document-discard-dialog";
import { FocusTraceLab } from "./focus-trace-lab";
import { MemoryEditor } from "./memory-editor";
import { canClearPendingWorkspaceRoots, PendingWorkspaceRoots } from "./pending-workspace-roots";
import { QuickOpenDialog } from "./quick-open-dialog";
import { RecentFiles, recentFailureText } from "./recent-files";
import { TextFidelityDetails } from "./text-fidelity-details";
import { WorkspaceTree, type RootOrderActions } from "./workspace-tree";

const readLocalImage = (request: LocalImageRequest): Promise<unknown> =>
  electrobun.rpc
    ? electrobun.rpc.request.readLocalImage(request, { maxRequestTime: 12000 })
    : Promise.reject(new Error("RPC unavailable"));

const recentTabContextAvailable = () =>
  !isExternalTextTarget(document.activeElement) &&
  !document.querySelector('[role="dialog"], [role="alertdialog"]');

export function useDocumentWorkspace(beforeDiscard?: () => Promise<void>) {
  const rootRoster = useWorkspaceRootRoster();
  const [trashDialog, setTrashDialog] = useState<(TrashDialog & { respond(choice: TrashChoice): void }) | null>(null);
  const cancelTrashDialog = useRef<(() => void) | null>(null);
  useEffect(() => {
    const notice = (event: { reason: "exit-pending" }) => { if (event.reason === "exit-pending") toast.warning("系统操作可能已完成或仍在收尾，请在系统中核对。", { id: "trash-exit-pending" }); };
    electrobun.rpc?.addMessageListener("trashNotice", notice);
    return () => { electrobun.rpc?.removeMessageListener("trashNotice", notice); };
  }, []);
  const [folderRemovalDialog, setFolderRemovalDialog] = useState<{ documents: FolderRemovalDocument[]; respond: (choice: "keep" | "close" | "cancel") => void } | null>(null);
  const [rootOrder] = useState(createWorkspaceRootOrder);
  useEffect(() => {
    const report = ({
      reason,
    }: {
      reason: import("@/shared/recent-files").RecentFailure;
    }) => toast.error(recentFailureText(reason));
    electrobun.rpc?.addMessageListener("recentFilesFailed", report);
    return () => {
      electrobun.rpc?.removeMessageListener("recentFilesFailed", report);
    };
  }, []);
  const [controller] = useState(() => {
    const transport = createNativeDocumentTransport();
    return createDocumentController(transport, discardGuard.ask);
  });
  const [folders] = useState(() =>
    createFolderWorkspace((request) => {
      if (!electrobun.rpc) return Promise.reject(new Error("RPC unavailable"));
      return electrobun.rpc.request.workspaceRequest(request);
    })
  );
  const folderState = useSyncExternalStore(
    folders.subscribe,
    folders.getSnapshot
  );
  useEffect(() => {
    const flags = globalThis as typeof globalThis & { __AGENTIC_MARKDOWN_EDITOR_FAULT_LAB__?: boolean };
    if (window.location.href !== PACKAGED_VIEW_URL || flags.__AGENTIC_MARKDOWN_EDITOR_FAULT_LAB__) return;
    const rpc = electrobun.rpc;
    if (!rpc) return;
    const tokens = new WeakMap<ReturnType<typeof folders.getSnapshot>, object>();
    return attachMainTabActivationCheckpoint(controller,
      (request) => rpc.request.mainTabCheckpoint(request, { maxRequestTime: 4000 }),
      () => {
        const workspace = folders.getSnapshot();
        if (!workspace.roots.length || workspace.busy || workspace.error) return undefined;
        let token = tokens.get(workspace);
        if (!token) {
          token = {};
          tokens.set(workspace, token);
        }
        return token;
      });
  }, [controller, folders]);
  const [publishRaster] = useState(() => createRasterPasteTransport({
    getFloor: async () => electrobun.rpc?.request.getRasterPasteSequence({}, { maxRequestTime: 4000 }),
    publish: async request => {
      const rpc = electrobun.rpc;
      if (!rpc) return { ok: false, requestId: request.requestId, error: "UNAVAILABLE" };
      return rpc.request.publishRasterPaste(request, { maxRequestTime: 12000 });
    },
  }));
  const authorizeRaster = useCallback((source: RasterPasteSource) => {
    const active = controller.getSnapshot().snapshot;
    if (active?.handle !== source.handle || active.documentId !== source.documentId)
      return undefined;
    return captureRasterWorkspaceAuthority(folders, source.handle, active.displayPath);
  }, [controller, folders]);
  const [mru] = useState(() => createDocumentMRU({
    begin: request => electrobun.rpc ? electrobun.rpc.request.beginMRUSession(request, { maxRequestTime: 4000 }) : Promise.reject(Error("RPC unavailable")),
    record: request => electrobun.rpc ? electrobun.rpc.request.recordDocumentActivation(request, { maxRequestTime: 4000 }) : Promise.reject(Error("RPC unavailable")),
    resolve: request => electrobun.rpc ? electrobun.rpc.request.resolveDocumentMRU(request, { maxRequestTime: 4000 }) : Promise.reject(Error("RPC unavailable")),
  }, controller, folders, message => toast.warning(message, { id: "document-mru-warning" })));
  useEffect(() => { mru.attach(); return () => mru.dispose(); }, [mru]);
  const [quickOpen] = useState(() => createQuickOpen(folders, controller, rootOrder, mru));
  useEffect(() => { quickOpen.attach(); return () => quickOpen.dispose(); }, [quickOpen]);
  const notifyQuick = useRegisterCommands({ quickOpen: () => quickOpen.open() }, true, { quickOpen: () => quickOpen.canOpen() });
  useLayoutEffect(() => { const off = controller.subscribe(notifyQuick); notifyQuick(); return off; }, [controller, notifyQuick]);
  const creationTarget = useRef<CreateTarget | null>(null);
  const setCreationTarget = useCallback((target: CreateTarget | null) => { creationTarget.current = target; }, []);
  const [createdLocation, setCreatedLocation] = useState<{ root: string; entry: string; intent: number } | null>(null);
  const nextCreatedLocation = useRef(0);
  const clearCreatedLocation = useCallback((intent: number) => setCreatedLocation(old => old?.intent === intent ? null : old), []);
  const [creation] = useState(() => createMarkdownController({
    documents: controller,
    request: request => electrobun.rpc ? electrobun.rpc.request.createMarkdown(request) : Promise.reject(Error("RPC unavailable")),
    refresh: () => folders.refresh(),
    targetCurrent: target => {
      const latest = folders.getSnapshot();
      return latest.roots.some(root => root.handle === target.rootHandle && root.generation === target.generation) && (!target.directoryHandle || !!latest.nodes[target.rootHandle]?.some(node => node.handle === target.directoryHandle && node.kind === "directory"));
    },
    locate: (target, entry) => setCreatedLocation({ root: target.rootHandle, entry, intent: ++nextCreatedLocation.current }),
  }));
  const creationState = useSyncExternalStore(creation.subscribe, creation.getSnapshot);
  const [duplication] = useState(() => createMarkdownController({
    documents: controller, mode: "duplicate",
    request: request => electrobun.rpc ? electrobun.rpc.request.duplicateMarkdown(request) : Promise.reject(Error("RPC unavailable")),
    refresh: () => folders.refresh(),
    targetCurrent: target => {
      const latest = folders.getSnapshot();
      return latest.roots.some(root => root.handle === target.rootHandle && root.generation === target.generation) && (!target.directoryHandle || !!latest.nodes[target.rootHandle]?.some(node => node.handle === target.directoryHandle && node.kind === "directory"));
    },
    locate: (target, entry) => setCreatedLocation({ root: target.rootHandle, entry, intent: ++nextCreatedLocation.current }),
  }));
  const duplicationState = useSyncExternalStore(duplication.subscribe, duplication.getSnapshot);
  const [folderCreation] = useState(() => createMarkdownController({
    documents: controller, mode: "folder",
    request: request => electrobun.rpc ? electrobun.rpc.request.createFolder(request) : Promise.reject(Error("RPC unavailable")),
    refresh: () => folders.refresh(),
    targetCurrent: target => {
      const latest = folders.getSnapshot();
      return latest.roots.some(root => root.handle === target.rootHandle && root.generation === target.generation) && (!target.directoryHandle || !!latest.nodes[target.rootHandle]?.some(node => node.handle === target.directoryHandle && node.kind === "directory"));
    },
    directoryCurrent: (target, entry) => {
      const latest = folders.getSnapshot();
      return latest.roots.some(root => root.handle === target.rootHandle) && !!latest.nodes[target.rootHandle]?.some(node => node.handle === entry && node.kind === "directory");
    },
    locate: (target, entry) => setCreatedLocation({ root: target.rootHandle, entry, intent: ++nextCreatedLocation.current }),
  }));
  const folderCreationState = useSyncExternalStore(folderCreation.subscribe, folderCreation.getSnapshot);
  useEffect(() => { folderCreation.attach(); return () => folderCreation.dispose(); }, [folderCreation]);
  useEffect(() => { duplication.attach(); return () => duplication.dispose(); }, [duplication]);
  useEffect(() => { creation.attach(); return () => creation.dispose(); }, [creation]);
  const notifyCreation = useRegisterCommands({ createMarkdown: () => creation.open(creationTarget.current), createFolder: () => folderCreation.open(creationTarget.current), duplicateMarkdown: () => duplication.open(duplicateDefaultTarget(controller.getSnapshot().snapshot?.displayPath, folders.getSnapshot())) }, true, { createMarkdown: () => creation.canOpen() && folders.getSnapshot().roots.length > 0, createFolder: () => folderCreation.canOpen() && (folderCreation.hasPending() || folders.getSnapshot().roots.length > 0), duplicateMarkdown: () => duplication.canOpen() && folders.getSnapshot().roots.length > 0 });
  useLayoutEffect(() => {
    const a = controller.subscribe(notifyCreation), b = folders.subscribe(notifyCreation), c = creation.subscribe(notifyCreation), d = duplication.subscribe(notifyCreation), e = folderCreation.subscribe(notifyCreation);
    notifyCreation(); return () => { a(); b(); c(); d(); e(); };
  }, [controller, folders, creation, duplication, folderCreation, notifyCreation]);
  const [folderRemoval] = useState(() => createFolderRemoval(controller, folders, request => electrobun.rpc ? electrobun.rpc.request.removeFolderRoot(request) : Promise.reject(Error("RPC unavailable")), documents => new Promise(resolve => setFolderRemovalDialog({ documents, respond: choice => { setFolderRemovalDialog(null); resolve(choice); } }))));
  const [trash] = useState(() => createTrashDocument(controller, folders, request => electrobun.rpc ? electrobun.rpc.request.trashDocument(request, { maxRequestTime: 5000 }) : Promise.reject(Error("RPC unavailable")), dialog => new Promise(resolve => {
    const respond = (choice: TrashChoice) => { cancelTrashDialog.current = null; setTrashDialog(null); resolve(choice); };
    cancelTrashDialog.current = () => respond("cancel");
    setTrashDialog({ ...dialog, respond });
  })));
  const trashState = useSyncExternalStore(trash.subscribe, trash.getSnapshot);
  useEffect(() => { trash.attach(); return () => { cancelTrashDialog.current?.(); trash.dispose(); }; }, [trash]);
  useEffect(() => () => folderRemoval.dispose(), [folderRemoval]);
  useLayoutEffect(() => {
    let previous: { folder: ReturnType<typeof folders.getSnapshot>; entries: ReturnType<typeof controller.getSnapshot>["entries"] } | null = null;
    let standaloneHandles = new Set<string>();
    controller.setStandaloneRemovalEligibility(handle => {
      const latest = folders.getSnapshot();
      if (latest.busy) return false;
      const entries = controller.getSnapshot().entries;
      if (previous?.folder.roots !== latest.roots || previous.folder.nodes !== latest.nodes || previous.folder.coveredHandles !== latest.coveredHandles || previous.entries !== entries) {
        const model = projectWorkspaceTree(latest.roots, latest.nodes, latest.coveredHandles, entries);
        standaloneHandles = new Set((model.children.get(null) ?? []).flatMap(key => { const item = model.items.get(key); return item?.kind === "standalone" ? [item.entry.handle] : []; }));
        previous = { folder: latest, entries };
      }
      return standaloneHandles.has(handle);
    });
    return () => controller.setStandaloneRemovalEligibility(() => false);
  }, [controller, folders]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await folders.refresh();
      } catch {
        /* State exposes the fixed error. */
      }
      if (!stopped) timer = setTimeout(poll, 350);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [folders]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot
  );
  const wrapping = useSourceWrapping();
  useEffect(() => {
    controller.setSourceWrapping(wrapping.enabled);
  }, [
    controller,
    wrapping.enabled,
    state.busy,
    state.frozen,
    state.snapshot?.documentId,
  ]);
  const [canonical] = useState(() =>
    createDocumentCanonical(
      controller,
      () => new CurrentCanonicalWorker(),
      "reading-legacy"
    )
  );
  useEffect(() => {
    const unsubscribe = controller.subscribe(canonical.invalidate);
    return () => {
      unsubscribe();
      canonical.cancel();
    };
  }, [controller, canonical]);
  const { executeCommand, isCommandEnabled } = useCommands();
  const notifyCommands = useRegisterCommands(
    {
      toggleSourceMode: () => {
        controller.toggleSourceMode();
      },
      selectDocument: controller.select,
      revealDocument: () => controller.revealCurrentDocument(),
      openDefaultDocument: () => controller.openDefaultDocument(),
      selectFolder: () => controller.runWorkspaceAction(folders.select),
      setRootHidden: ({ root, showHidden }) =>
        controller.runWorkspaceAction(() =>
          folders.setHidden(root, showHidden)
        ),
      reloadDocument: controller.reload,
      saveDocument: controller.save,
      clearDocument: () => controller.clear(folders.clear),
      closeDocument: controller.closeActive,
      pinCurrentTab: () => { controller.setActiveTabPinned(true); },
      moveCurrentTabLeft: () => { controller.moveActiveTab(-1); },
      moveCurrentTabRight: () => { controller.moveActiveTab(1); },
      unpinCurrentTab: () => { controller.setActiveTabPinned(false); },
      cycleRecentTabs: () => { controller.cycleRecentTabs(); },
      undoDocument: ({ documentId }) => {
        if (documentId || !isExternalTextTarget(document.activeElement))
          controller.runHistory("undo", documentId);
      },
      redoDocument: ({ documentId }) => {
        if (documentId || !isExternalTextTarget(document.activeElement))
          controller.runHistory("redo", documentId);
      },
      addSourceCursorAbove: ({ documentId }) => {
        controller.runSourceSelection("above", documentId);
      },
      addSourceCursorBelow: ({ documentId }) => {
        controller.runSourceSelection("below", documentId);
      },
      simplifySourceSelection: ({ documentId }) => {
        controller.runSourceSelection("simplify", documentId);
      },
      continueList: ({ documentId }) => {
        controller.runListInput(false, documentId);
      },
      listSoftBreak: ({ documentId }) => {
        controller.runListInput(true, documentId);
      },
      indentSource: ({ documentId }) => {
        controller.runSourceIndentation(true, documentId);
      },
      dedentSource: ({ documentId }) => {
        controller.runSourceIndentation(false, documentId);
      },
      toggleHeadingFold: (action) => {
        controller.runEditorFold(action);
      },
      toggleCodeFold: (action) => {
        controller.runEditorFold({ ...action, kind: "fencedCode" });
      },
      toggleFrontmatterFold: (action) => {
        controller.runEditorFold({ ...action, kind: "frontmatter" });
      },
      formatBold: ({ documentId, token, nativeToken }) => {
        if (nativeToken !== undefined)
          runNativeInlineFormat("formatBold", documentId, nativeToken);
        else runInlineFormat("formatBold", documentId, token);
      },
      formatItalic: ({ documentId, token, nativeToken }) => {
        if (nativeToken !== undefined)
          runNativeInlineFormat("formatItalic", documentId, nativeToken);
        else runInlineFormat("formatItalic", documentId, token);
      },
      formatCode: ({ documentId, token, nativeToken }) => {
        if (nativeToken !== undefined)
          runNativeInlineFormat("formatCode", documentId, nativeToken);
        else runInlineFormat("formatCode", documentId, token);
      },
    },
    true,
    {
      toggleSourceMode: () =>
        controller.canToggleSourceMode() &&
        !isExternalTextTarget(document.activeElement) &&
        !document.querySelector('[role="dialog"], [role="alertdialog"]'),
      selectDocument: () =>
        !controller.getSnapshot().busy &&
        !controller.getSnapshot().frozen &&
        !controller.hasSaves(),
      selectFolder: () =>
        controller.canSelectFolder() && !folders.getSnapshot().busy,
      setRootHidden: () =>
        controller.canSelectFolder() && !folders.getSnapshot().busy,
      saveDocument: controller.canSave,
      revealDocument: controller.canRevealDocument,
      openDefaultDocument: controller.canRevealDocument,
      undoDocument: controller.canUndo,
      redoDocument: controller.canRedo,
      addSourceCursorAbove: controller.canRunSourceSelection,
      addSourceCursorBelow: controller.canRunSourceSelection,
      simplifySourceSelection: controller.canRunSourceSelection,
      continueList: controller.canRunListInput,
      listSoftBreak: controller.canRunListInput,
      indentSource: controller.canIndentSource,
      dedentSource: controller.canIndentSource,
      toggleHeadingFold: () => controller.canRunEditorFold(),
      toggleCodeFold: () => controller.canRunEditorFold("fencedCode"),
      toggleFrontmatterFold: () => controller.canRunEditorFold("frontmatter"),
      reloadDocument: () =>
        !controller.getSnapshot().busy &&
        !controller.getSnapshot().frozen &&
        !!controller.getSnapshot().snapshot,
      clearDocument: () =>
        !controller.getSnapshot().frozen &&
        (controller.getSnapshot().busy ||
          controller.getSnapshot().entries.length > 0 ||
          folders.getSnapshot().roots.length > 0 ||
          canClearPendingWorkspaceRoots(rootRoster.model.getSnapshot())),
      closeDocument: () =>
        !controller.getSnapshot().frozen && !!controller.getSnapshot().snapshot,
      pinCurrentTab: () => controller.canSetActiveTabPinned(true),
      moveCurrentTabLeft: () => controller.canMoveActiveTab(-1),
      moveCurrentTabRight: () => controller.canMoveActiveTab(1),
      unpinCurrentTab: () => controller.canSetActiveTabPinned(false),
      cycleRecentTabs: () => controller.canCycleRecentTabs() && recentTabContextAvailable(),
    }
  );
  useEffect(
    () => controller.subscribe(notifyCommands),
    [controller, notifyCommands]
  );
  useEffect(() => folders.subscribe(notifyCommands), [folders, notifyCommands]);
  useEffect(
    () => rootRoster.model.subscribe(notifyCommands),
    [rootRoster.model, notifyCommands]
  );
  useEffect(
    () => {
      const participant = canonicalDiscardParticipant(
          controller,
          canonical,
          beforeDiscard,
          controller.hasDiscardable,
          budgetMs => mru.flush(budgetMs)
        );
      return discardGuard.register({ ...participant, beginDiscard: () => { trash.beforeWindowDiscard(); cancelTrashDialog.current?.(); return participant.beginDiscard(); } });
    },
    [controller, canonical, beforeDiscard, mru, trash]
  );
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) =>
      routeSourceModeShortcut(
        event,
        document.activeElement,
        !!document.querySelector('[role="dialog"], [role="alertdialog"]'),
        isCommandEnabled("toggleSourceMode"),
        executeCommand
      );
    window.addEventListener("keydown", shortcut, true);
    return () => window.removeEventListener("keydown", shortcut, true);
  }, [executeCommand, isCommandEnabled]);
  useEffect(() => {
    // Once canceled, this held chord cannot start a new candidate sequence.
    let advancedInHold = false;
    const hasCandidate = () => controller.getRecentTabCandidate() !== null;
    const actions = {
      canCycle: () => (!advancedInHold || hasCandidate()) && isCommandEnabled("cycleRecentTabs"),
      hasCandidate,
      advance: () => {
        executeCommand({ type: "cycleRecentTabs", args: {} });
        advancedInHold ||= hasCandidate();
      },
      finish: () => controller.finishRecentTabSwitch(),
      cancel: () => controller.cancelRecentTabSwitch(),
    };
    const down = (event: KeyboardEvent) => routeRecentTabKey(event, "keydown", actions);
    const up = (event: KeyboardEvent) => {
      routeRecentTabKey(event, "keyup", actions);
      if (event.key === "Control" && !event.ctrlKey) advancedInHold = false;
    };
    const blur = () => {
      actions.cancel();
      advancedInHold = false;
    };
    const focus = () => {
      if (actions.hasCandidate() && !recentTabContextAvailable()) actions.cancel();
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    window.addEventListener("compositionstart", actions.cancel, true);
    document.addEventListener("focusin", focus);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("compositionstart", actions.cancel, true);
      document.removeEventListener("focusin", focus);
      actions.cancel();
    };
  }, [controller, executeCommand, isCommandEnabled]);
  useEffect(() => {
    const refresh = () => {
      void controller.refreshWriteCapability();
      controller.refreshExternalObservations();
    };
    const changed = (value: unknown) => {
      if (
        value &&
        typeof value === "object" &&
        Object.keys(value).length === 1 &&
        "handle" in value &&
        typeof value.handle === "string"
      )
        void controller.refreshWriteCapability(value.handle, true);
    };
    electrobun.rpc?.addMessageListener("documentCapabilityChanged", changed);
    electrobun.rpc?.addMessageListener(
      "documentExternalChanged",
      controller.applyExternalObservation
    );
    window.addEventListener("focus", refresh);
    const timer = setInterval(() => {
      void controller.refreshWriteCapability();
    }, 3000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      electrobun.rpc?.removeMessageListener(
        "documentExternalChanged",
        controller.applyExternalObservation
      );
      electrobun.rpc?.removeMessageListener(
        "documentCapabilityChanged",
        changed
      );
    };
  }, [controller]);
  useEffect(() => {
    void controller.refreshWriteCapability();
  }, [controller, state.snapshot?.handle]);
  useEffect(() => () => controller.dispose(), [controller]);
  return {
    quickOpen, creation, creationState, duplication, duplicationState, folderCreation, folderCreationState, setCreationTarget, createdLocation, clearCreatedLocation,
    folderRemoval,
    trash, trashState, trashDialog,
    folderRemovalDialog,
    rootOrder,
    rootRoster,
    controller,
    folders,
    folderState,
    publishRaster,
    authorizeRaster,
    state,
    canonical,
    executeCommand,
    isCommandEnabled,
  };
}
type Workspace = ReturnType<typeof useDocumentWorkspace>;

export function StandaloneFileList({ workspace, visible }: { workspace: Workspace; visible: boolean }) {
  const { state, controller, executeCommand, isCommandEnabled, folders, setCreationTarget } = workspace;
  const [removalHandle, setRemovalHandle] = useState<string | null>(null);
  const contentSearchSelection = useRef<{ handle: string | null; revision: number }>({ handle: null, revision: 0 });
  const getContentSearchSelection = useCallback(() => contentSearchSelection.current, []);
  const [{ handle: folderRemovalHandle, revision: contentSearchSelectionRevision }, setSelectedFolder] = useState({ handle: null as string | null, revision: 0 });
  const [trashTarget, setTrashTarget] = useState<TrashTarget | null>(null);
  const [orderActions, setOrderActions] = useState<RootOrderActions | null>(null);
  const notifyOrder = useRegisterCommands({ moveWorkspaceRootUp: () => orderActions?.up(), moveWorkspaceRootDown: () => orderActions?.down() }, true, { moveWorkspaceRootUp: () => orderActions?.canUp() ?? false, moveWorkspaceRootDown: () => orderActions?.canDown() ?? false });
  useLayoutEffect(() => { notifyOrder(); }, [orderActions, notifyOrder]);
  const [reveal] = useState(() => createWorkspaceReveal({
    available: () => controller.canSelectFolder() && !workspace.folders.getSnapshot().busy,
    reveal: (request) => electrobun.rpc ? electrobun.rpc.request.revealWorkspaceItem(request) : Promise.reject(new Error("RPC unavailable")),
    openDefault: (request) => electrobun.rpc ? electrobun.rpc.request.openDefaultWorkspaceItem(request) : Promise.reject(new Error("RPC unavailable")),
    cancel: (request) => electrobun.rpc ? electrobun.rpc.request.cancelDocument(request) : Promise.reject(new Error("RPC unavailable")),
  }));
  const revealState = useSyncExternalStore(reveal.subscribe, reveal.getSnapshot);
  const selectTreeItem = useCallback((target: WorkspaceRevealTarget | null, isFile: boolean) => {
    reveal.setTarget(target, isFile);
    setRemovalHandle(target?.type === "document" && isFile ? target.handle : null);
    const selectedRoot = target?.type === "workspace" && !target.entry ? target.root : null;
    if (contentSearchSelection.current.handle !== selectedRoot) {
      contentSearchSelection.current = { handle: selectedRoot, revision: contentSearchSelection.current.revision + 1 };
      setSelectedFolder(contentSearchSelection.current);
    }
    const entry = target?.type === "document" ? controller.getSnapshot().entries.find(entry => entry.handle === target.handle) : undefined;
    const fileRoot = target?.type === "workspace" ? folders.getSnapshot().roots.find(root => root.handle === target.root) : undefined;
    setTrashTarget(!isFile && target?.type === "workspace" && fileRoot ? { kind: "directory", root: fileRoot.handle, generation: fileRoot.generation, ...(target.entry ? { entry: target.entry } : {}) } : isFile && entry ? { kind: "standalone", handle: entry.handle, documentId: entry.documentId } : isFile && target?.type === "workspace" && target.entry && fileRoot ? { kind: "root", root: fileRoot.handle, entry: target.entry, generation: fileRoot.generation } : null);
    const root = target?.type === "workspace" && !isFile ? folders.getSnapshot().roots.find(root => root.handle === target.root) : undefined;
    setCreationTarget(root && target?.type === "workspace" ? { rootHandle: root.handle, generation: root.generation, ...(target.entry ? { directoryHandle: target.entry } : {}) } : null);
  }, [reveal, folders, setCreationTarget, controller]);
  const notifyTrash = useRegisterCommands({ trashDocument: () => trashTarget ? workspace.trash.start(trashTarget) : undefined }, true, { trashDocument: () => workspace.trash.canStart(trashTarget) });
  useLayoutEffect(() => { notifyTrash(); }, [state, workspace.folderState, workspace.trashState, trashTarget, notifyTrash]);
  const notifyRemoval = useRegisterCommands({ removeStandaloneRoot: () => removalHandle ? controller.removeStandalone(removalHandle) : undefined }, true, { removeStandaloneRoot: () => controller.canRemoveStandalone(removalHandle) });
  useLayoutEffect(() => { notifyRemoval(); }, [state, workspace.folderState, removalHandle, notifyRemoval]);
  const notifyFolderRemoval = useRegisterCommands({ removeFolderRoot: () => folderRemovalHandle ? workspace.folderRemoval.remove(folderRemovalHandle) : undefined }, true, { removeFolderRoot: () => workspace.folderRemoval.canRemove(folderRemovalHandle) });
  useLayoutEffect(() => { notifyFolderRemoval(); }, [state, workspace.folderState, folderRemovalHandle, notifyFolderRemoval]);
  const notifyReveal = useRegisterCommands({ revealWorkspaceItem: () => reveal.run(), openDefaultWorkspaceItem: () => reveal.runDefault() }, true, { revealWorkspaceItem: reveal.canRun, openDefaultWorkspaceItem: reveal.canRunDefault });
  useLayoutEffect(() => { reveal.attach(); return () => reveal.dispose(); }, [reveal]);
  useLayoutEffect(() => {
    const update = () => { reveal.checkAvailability(); notifyReveal(); };
    const a = controller.subscribe(update), b = workspace.folders.subscribe(update);
    return () => { a(); b(); };
  }, [controller, workspace.folders, reveal, notifyReveal]);
  useLayoutEffect(() => { notifyReveal(); }, [revealState, notifyReveal]);
  return (
    <nav
      aria-label="工作区文件树"
      className="flex size-full min-w-0 flex-col gap-3 px-3 pt-16 pb-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">工作区</h2>
        <button
          className="hover:bg-muted rounded border px-2 py-1 text-xs disabled:opacity-50"
          disabled={!isCommandEnabled("selectFolder")}
          onClick={() => executeCommand({ type: "selectFolder", args: {} })}
        >
          加入文件夹
        </button>
        <button
          className="hover:bg-muted rounded border px-2 py-1 text-xs disabled:opacity-50"
          disabled={!isCommandEnabled("selectDocument")}
          onClick={() => executeCommand({ type: "selectDocument", args: {} })}
        >
          打开文件
        </button>
      </div>
      <WorkspaceTree
        createdLocation={workspace.createdLocation}
        onCreatedLocated={workspace.clearCreatedLocation}
        rootOrder={workspace.rootOrder}
        canOrder={controller.canSelectFolder}
        subscribeOrderAvailability={controller.subscribe}
        onOrderActions={setOrderActions}
        setHidden={(root, showHidden) =>
          executeCommand({ type: "setRootHidden", args: { root, showHidden } })
        }
        folders={workspace.folders}
        onRevealSelection={selectTreeItem}
        state={workspace.folderState}
        entries={state.entries}
        activeHandle={state.snapshot?.handle}
        openStandalone={(entry) => {
          void controller.activate(entry);
        }}
        disabled={!controller.canSelectFolder()}
        standaloneDisabled={state.frozen}
        runAction={controller.runWorkspaceAction}
        runRescan={controller.runMetadataRescan}
        open={(root, node) => {
          const existing = state.entries.find(
            (entry) => entry.displayPath === node.displayPath
          );
          if (existing) void controller.activate(existing);
          else void controller.openWorkspaceEntry(root, node.handle);
        }}
      />
      {visible && (
        <ContentSearchPanel
          controller={controller}
          folders={folders}
          getSelection={getContentSearchSelection}
          selectionRevision={contentSearchSelectionRevision}
          selectedRoot={workspace.folderState.roots.find((root) => root.handle === folderRemovalHandle)}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="text-destructive hover:bg-muted rounded border px-2 py-1 text-xs disabled:opacity-50" disabled={!isCommandEnabled("trashDocument")} onClick={() => executeCommand({ type: "trashDocument", args: {} })}>移入废纸篓</button>
        <button type="button" className="hover:bg-muted rounded border px-2 py-1 text-xs disabled:opacity-50" disabled={!isCommandEnabled("createMarkdown")} onClick={() => executeCommand({ type: "createMarkdown", args: {} })}>新建 Markdown 文件</button>
        <button type="button" className="hover:bg-muted rounded border px-2 py-1 text-xs disabled:opacity-50" disabled={!isCommandEnabled("duplicateMarkdown")} onClick={() => executeCommand({ type: "duplicateMarkdown", args: {} })}>复制当前文档</button>
        <button type="button" className="hover:bg-muted rounded border px-2 py-1 text-xs disabled:opacity-50" disabled={!isCommandEnabled("createFolder")} onClick={() => executeCommand({ type: "createFolder", args: {} })}>新建文件夹</button>
        <button type="button" className="hover:bg-muted focus-visible:outline-ring rounded border px-2 py-1 text-xs focus-visible:outline-2 disabled:opacity-50" disabled={!orderActions?.canUp()} onClick={() => executeCommand({ type: "moveWorkspaceRootUp", args: {} })}>上移选中根</button>
        <button type="button" className="hover:bg-muted focus-visible:outline-ring rounded border px-2 py-1 text-xs focus-visible:outline-2 disabled:opacity-50" disabled={!orderActions?.canDown()} onClick={() => executeCommand({ type: "moveWorkspaceRootDown", args: {} })}>下移选中根</button>
      </div>
      <button
        type="button"
        className="hover:bg-muted focus-visible:outline-ring max-w-full rounded border px-2 py-1 text-left text-xs focus-visible:outline-2 disabled:opacity-50"
        disabled={!reveal.canRun()}
        onClick={() => executeCommand({ type: "revealWorkspaceItem", args: {} })}
      >在 Finder 中显示选中项</button>
      <button
        type="button"
        className="hover:bg-muted focus-visible:outline-ring max-w-full rounded border px-2 py-1 text-left text-xs focus-visible:outline-2 disabled:opacity-50"
        disabled={!reveal.canRunDefault()}
        onClick={() => executeCommand({ type: "openDefaultWorkspaceItem", args: {} })}
      >用默认应用打开选中文件</button>
      <p className="text-muted-foreground text-xs">打开磁盘版本，不自动保存当前修改</p>
      <button type="button" className="hover:bg-muted focus-visible:outline-ring rounded border px-2 py-1 text-left text-xs focus-visible:outline-2 disabled:opacity-50" disabled={!controller.canRemoveStandalone(removalHandle)} onClick={() => executeCommand({ type: "removeStandaloneRoot", args: {} })}>从窗口移除选中文件</button>
      <button type="button" className="hover:bg-muted focus-visible:outline-ring rounded border px-2 py-1 text-left text-xs focus-visible:outline-2 disabled:opacity-50" disabled={!workspace.folderRemoval.canRemove(folderRemovalHandle)} onClick={() => executeCommand({ type: "removeFolderRoot", args: {} })}>从窗口移除选中目录</button>
      {revealState.error && <p role="alert" className="text-destructive text-xs">{revealState.error}</p>}
    </nav>
  );
}

function ReadingWindowAction({ controller, snapshot, buttonClass }: {
  controller: Workspace["controller"];
  snapshot: Workspace["state"]["snapshot"];
  buttonClass: string;
}) {
  const pending = useRef(false);
  type Origin = NonNullable<ReturnType<typeof controller.captureIndependentReadingSnapshot>>["origin"];
  const [feedback, setFeedback] = useState<{ origin: Origin; text: string }>();
  const { executeCommand, isCommandEnabled } = useCommands();
  const canOpen = () => !pending.current && !!electrobun.rpc && !!controller.getIndependentReadingSnapshotKind();
  const open = async () => {
    if (pending.current) return;
    const capture = controller.captureIndependentReadingSnapshot();
    const rpc = electrobun.rpc;
    if (!capture || !rpc) return;
    const report = (text: string) => setFeedback({ origin: capture.origin, text });
    if (!capture.request) {
      report("当前正文无法完整编码为未保存快照。");
      return;
    }
    pending.current = true;
    report(capture.kind === "buffer" ? "正在提交未保存快照…" : "正在提交已保存版本…");
    notify();
    try {
      const result = await rpc.request.openReadingSnapshot(capture.request, { maxRequestTime: 12000 });
      if (result?.ok === true && result.submitted === true)
        report("已提交打开请求，请在阅读窗口核对。");
      else if (result?.ok === false && result.error === "BUSY")
        report("请先关闭已打开的阅读窗口，或等当前操作结束后重试。");
      else report("未能确认打开请求，请核对当前文档和阅读窗口。");
    } catch {
      report("未能确认打开请求，请核对当前文档和阅读窗口。");
    } finally {
      pending.current = false;
      notify();
    }
  };
  const notify = useRegisterCommands({ openReadingSnapshot: open }, true, { openReadingSnapshot: canOpen });
  if (!snapshot) return null;
  const kind = controller.getIndependentReadingSnapshotKind();
  const dirty = controller.isDirty(snapshot.documentId);
  const origin = feedback?.origin;
  const message = origin?.handle === snapshot.handle && origin.documentId === snapshot.documentId &&
      origin.revision === snapshot.revision && origin.activation === controller.getContentSearchActivation() &&
      origin.bufferRevision === controller.getEditor(snapshot.documentId)?.revision
    ? feedback?.text
    : dirty && !kind ? "当前状态无法打开未保存快照。" : undefined;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        className={buttonClass}
        disabled={!isCommandEnabled("openReadingSnapshot")}
        onClick={() => executeCommand({ type: "openReadingSnapshot", args: {} })}
      >
        {kind === "buffer" || dirty
          ? "在阅读窗口打开当前未保存内容"
          : "在阅读窗口打开已保存版本"}
      </button>
      <span className="text-muted-foreground text-sm" role="status">{message}</span>
    </div>
  );
}

function DocumentTabStrip({ state, controller }: Pick<Workspace, "state" | "controller">) {
  const subscribe = useCallback((listener: () => void) => controller.subscribeRecentTabCandidate(listener), [controller]);
  const candidateId = useSyncExternalStore(subscribe, controller.getRecentTabCandidate);
  const visualTabs = controller.getVisualTabs();
  const strip = useRef<HTMLElement>(null);
  const candidateTab = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; state: typeof state; focus: Element | null } | null>(null);
  const pendingDrop = useRef<{ source: NonNullable<typeof drag.current>; commit: () => boolean; focusAtDrop: Element | null } | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);
  const pointerFocus = useRef<Element | null>(null);
  const [dragTicket, setDragTicket] = useState<{ id: string; state: typeof state } | null>(null);
  const [insertion, setInsertion] = useState<{ id: string; placement: "before" | "after" } | null>(null);
  const clearDrag = useCallback((restore?: boolean) => {
    const previous = drag.current;
    clearTimeout(settleTimer.current);
    pendingDrop.current = null;
    drag.current = null;
    setDragTicket(null);
    setInsertion(null);
    if ((restore ?? previous?.state === controller.getSnapshot()) && previous) {
      const focusAtSchedule = document.activeElement;
      settleTimer.current = setTimeout(() => {
        if (document.activeElement === focusAtSchedule && previous.state === controller.getSnapshot() && previous.focus instanceof HTMLElement && previous.focus.isConnected)
          previous.focus.focus({ preventScroll: true });
      }, 0);
    }
  }, [controller]);
  const flushDrop = () => {
    clearTimeout(settleTimer.current);
    const pending = pendingDrop.current;
    pendingDrop.current = null;
    drag.current = null;
    setDragTicket(null);
    setInsertion(null);
    if (pending?.source.state !== controller.getSnapshot() || !controller.canReorderTabs()) return;
    const committed = pending.commit();
    if (document.activeElement === pending.focusAtDrop && (committed || pending.source.state === controller.getSnapshot()) && pending.source.focus instanceof HTMLElement && pending.source.focus.isConnected)
      pending.source.focus.focus({ preventScroll: true });
  };
  const stageDrop = (commit: () => boolean, eligible: () => boolean) => {
    if (pendingDrop.current) return;
    const source = drag.current;
    if (source?.state !== controller.getSnapshot() || !controller.canReorderTabs() || !eligible()) { clearDrag(false); return; }
    pendingDrop.current = { source, commit, focusAtDrop: document.activeElement };
    // Keep the native source node in place through drop/dragend. Some WK paths
    // omit dragend; only an already accepted drop gets this bounded fallback.
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(flushDrop, 750);
  };
  useEffect(() => {
    const cancel = () => clearDrag(false);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") clearDrag(); };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("blur", cancel); window.removeEventListener("keydown", key);
      clearTimeout(settleTimer.current); pendingDrop.current = null; drag.current = null;
    };
  }, [clearDrag]);
  useLayoutEffect(() => {
    const scroller = strip.current;
    const tab = candidateTab.current;
    if (!candidateId || !scroller || !tab) return;
    const frame = scroller.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();
    if (rect.left < frame.left) scroller.scrollBy(rect.left - frame.left, 0);
    else if (rect.right > frame.right) scroller.scrollBy(rect.right - frame.right, 0);
  }, [candidateId]);
  const emptyGroupTarget = (pinned: boolean) => {
    if (dragTicket?.state !== state ||
        !controller.canDropTabToEmptyGroup(dragTicket.id, pinned)) return null;
    const id = pinned ? "empty-pinned" : "empty-normal";
    return (
      <div
        aria-label={pinned ? "固定组放置位置" : "普通组放置位置"}
        className={`bg-background absolute top-full z-20 flex h-9 items-center rounded border border-dashed px-3 text-sm shadow-sm ${pinned ? "left-0" : "right-0"} ${insertion?.id === id ? "border-primary" : "text-muted-foreground"}`}
        onDragOver={event => {
          if (drag.current?.state !== controller.getSnapshot() ||
              !controller.canDropTabToEmptyGroup(drag.current.id, pinned)) {
            setInsertion(null); event.dataTransfer.dropEffect = "none"; return;
          }
          event.preventDefault(); event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setInsertion(previous => previous?.id === id ? previous : { id, placement: "before" });
        }}
        onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setInsertion(null); }}
        onDrop={event => {
          if (!drag.current) return;
          event.preventDefault(); event.stopPropagation();
          const source = drag.current;
          stageDrop(() => controller.dropTabToEmptyGroup(source.id, pinned), () => controller.canDropTabToEmptyGroup(source.id, pinned));
        }}
      >
        {pinned ? "固定到此处" : "移到普通标签"}
      </div>
    );
  };
  return (
    <div className="relative shrink-0">
    <nav
      ref={strip}
      aria-label="已打开的文档"
      className="flex shrink-0 gap-1 overflow-x-auto"
      onDragOver={event => {
        if (event.target === event.currentTarget && drag.current) {
          setInsertion(null);
          event.dataTransfer.dropEffect = "none";
        }
      }}
      onDrop={event => {
        if (drag.current) { event.preventDefault(); clearDrag(); }
      }}
    >
      {visualTabs.map((tab, index) => {
        const pinned = controller.isTabPinned(tab.documentId);
        const candidate = candidateId === tab.documentId;
        const active = state.snapshot?.documentId === tab.documentId;
        const next = visualTabs[index + 1];
        const groupEnd = pinned && next && !controller.isTabPinned(next.documentId);
        const name = `${tab.fileName}${documentCapabilitySuffix(tab.writeCapability)}${controller.isDirty(tab.documentId) ? " ● 未保存" : ""}`;
        return (
          <div
            key={tab.documentId}
            ref={candidate ? candidateTab : undefined}
            className={`relative flex shrink-0 items-center rounded border ${pinned ? "border-primary/60" : ""} ${groupEnd ? "mr-2" : ""} ${active ? "bg-muted" : ""} ${candidate ? "ring-primary ring-2 ring-inset" : ""}`}
            onDragOver={event => {
              if (drag.current?.state !== controller.getSnapshot() || !controller.canDropTab(drag.current.id, tab.documentId)) {
                setInsertion(null);
                event.dataTransfer.dropEffect = "none";
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              const rect = event.currentTarget.getBoundingClientRect();
              const placement = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
              setInsertion(previous => previous?.id === tab.documentId && previous.placement === placement ? previous : { id: tab.documentId, placement });
            }}
            onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setInsertion(null); }}
            onDrop={event => {
              if (!drag.current) return;
              event.preventDefault();
              event.stopPropagation();
              const source = drag.current;
              const rect = event.currentTarget.getBoundingClientRect();
              const placement = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
              stageDrop(() => controller.dropTab(source.id, tab.documentId, placement), () => controller.canDropTab(source.id, tab.documentId));
            }}
          >
            {dragTicket?.state === state && insertion?.id === tab.documentId && <span aria-hidden="true" className={`bg-primary pointer-events-none absolute top-0 bottom-0 w-0.5 ${insertion.placement === "before" ? "left-0" : "right-0"}`} />}
            <button
              disabled={state.frozen}
              draggable={controller.canReorderTabs()}
              onPointerDown={() => { suppressClick.current = false; pointerFocus.current = document.activeElement; }}
              onDragStart={event => {
                // A WK path without dragend still owns its accepted drop until
                // the fallback commits it. A new native drag must not erase it.
                if (pendingDrop.current) { event.preventDefault(); return; }
                if (!controller.canReorderTabs()) { event.preventDefault(); return; }
                clearTimeout(settleTimer.current);
                pendingDrop.current = null;
                drag.current = { id: tab.documentId, state: controller.getSnapshot(), focus: pointerFocus.current };
                setDragTicket({ id: tab.documentId, state: controller.getSnapshot() });
                suppressClick.current = true;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-agentic-tab", "local");
              }}
              onDragEnd={() => {
                if (drag.current?.id !== tab.documentId) return;
                if (pendingDrop.current) {
                  clearTimeout(settleTimer.current);
                  settleTimer.current = setTimeout(flushDrop, 0);
                } else clearDrag();
              }}
              aria-current={active ? "page" : undefined}
              aria-label={pinned || candidate ? `${name}${pinned ? " · 已固定" : ""}${candidate ? " · 切换候选" : ""}` : undefined}
              title={tab.displayPath ?? tab.fileName}
              className="max-w-48 truncate px-3 py-2 text-sm"
              onClick={event => { if (!suppressClick.current || event.detail === 0) controller.activateTab(tab.documentId); }}
            >
              {name}
            </button>
            <button
              disabled={state.frozen}
              aria-label={`关闭 ${tab.fileName}`}
              title={`关闭 ${tab.fileName}`}
              className="hover:bg-muted rounded px-2 py-2 text-sm"
              onClick={() => controller.closeTab(tab.documentId)}
            >
              ×
            </button>
          </div>
        );
      })}
    </nav>
    {emptyGroupTarget(true)}
    {emptyGroupTarget(false)}
    </div>
  );
}

export function DocumentServicePanel({ workspace }: { workspace: Workspace }) {
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const { state, controller, executeCommand, isCommandEnabled } = workspace;
  const snapshot = state.snapshot;
  const pinCommand = snapshot && controller.isTabPinned(snapshot.documentId)
    ? "unpinCurrentTab"
    : "pinCurrentTab";
  const editor = snapshot && controller.getEditor(snapshot.documentId);
  const mode =
    snapshot && controller.getMode(snapshot.documentId) === "source"
      ? "source"
      : "editing";
  const canonicalState = useSyncExternalStore(
    workspace.canonical.subscribe,
    workspace.canonical.getSnapshot
  );
  const buttonClass =
    "rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50";

  return (
    <section
      className="flex size-full min-w-0 flex-col gap-3 px-6 pt-16 pb-6"
      aria-label="文档工作区"
    >
      <DocumentTabStrip state={state} controller={controller} />
      <div>
        <h1 className="text-xl font-semibold">
          {snapshot?.fileName ??
            (workspace.folderState.roots.length || state.entries.length
              ? "文件工作区"
              : "欢迎使用 Agentic Markdown")}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {snapshot
            ? controller.isSafeSource(snapshot.documentId)
              ? "安全源码 · 解析与排版已停用 · 文内查找暂不可用 · 手动保存 ⌘S · 单文件限 1 MiB"
              : mode === "source"
                ? "基础源码模式 · 完整原文与基础高亮 · 手动保存 ⌘S · 单文件限 1 MiB"
                : "基础编辑模式 · 标题、粗体、斜体与行内代码 · 手动保存 ⌘S · 单文件限 1 MiB"
            : "打开本地 Markdown 文件或加入文件夹。侧栏单击选择，双击或按 Enter 打开文档。"}
        </p>
      </div>
      {(
        globalThis as typeof globalThis & {
          __AGENTIC_MARKDOWN_READER_SNAPSHOT_ENABLED__?: boolean;
        }
      ).__AGENTIC_MARKDOWN_READER_SNAPSHOT_ENABLED__ === true && (
        <ReadingWindowAction controller={controller} snapshot={snapshot} buttonClass={buttonClass} />
      )}
      <PendingWorkspaceRoots
        state={workspace.rootRoster.state}
        disabled={state.busy || state.frozen || workspace.folderState.busy}
        canReselect={isCommandEnabled("selectFolder")}
        reselect={() => { void executeCommand({ type: "selectFolder", args: {} }); }}
        remove={(id) => { void workspace.rootRoster.model.remove(id); }}
        refresh={workspace.rootRoster.model.refresh}
      />
      {!snapshot &&
        !workspace.folderState.roots.length &&
        !state.entries.length &&
        !state.tabs.length && (
          <RecentFiles
            controller={controller}
            disabled={state.busy || state.frozen}
          />
        )}
      {editor &&
        snapshot &&
        !controller.isSafeSource(snapshot.documentId) &&
        editor.state.field(longLineProtection).length > 0 && (
          <p role="status" className="text-muted-foreground text-sm">
            {mode === "source"
              ? "部分超长行已暂停语法着色；缩短后恢复，自动折行、原文与保存不变。"
              : "部分超长行已简化行内排版，代码与引用结构保留；缩短后恢复，软换行与保存不变。"}
          </p>
        )}
      {snapshot && controller.getEditorFault(snapshot.documentId)?.fault && (
        <p role="status">
          {controller.getEditorFault(snapshot.documentId)?.recoveryFailed
            ? "安全源码恢复失败，内存状态已保留；请勿关闭文档。"
            : controller.isSafeSource(snapshot.documentId)
              ? "编辑呈现发生异常，已切换为安全源码；内存内容已保留。关闭后重新打开才会重新尝试。"
              : "编辑呈现发生异常，正在等待当前输入或操作结束后切换安全源码。"}
        </p>
      )}
      {(
        globalThis as typeof globalThis & {
          __AGENTIC_MARKDOWN_EDITOR_FAULT_LAB__?: boolean;
        }
      ).__AGENTIC_MARKDOWN_EDITOR_FAULT_LAB__ === true && (
        <div className="flex flex-wrap gap-2" aria-label="编辑故障实验">
          <FocusTraceLab />
          <button
            className={buttonClass}
            disabled={!snapshot || state.busy || state.frozen}
            onClick={() => void workspace.canonical.request()}
          >
            实验：解析当前文档
          </button>
          <button
            className={buttonClass}
            disabled={canonicalState.status !== "running"}
            onClick={workspace.canonical.cancel}
          >
            取消当前解析
          </button>
          <p role="status">
            规范解析：
            {canonicalState.status === "ready"
              ? `完成 · revision ${canonicalState.result.revision} · ${canonicalState.result.tree.children.length} 个顶层块 · ${canonicalState.result.milliseconds.toFixed(2)} ms（仅 Worker 内解析）`
              : canonicalState.status === "running"
                ? "进行中"
                : canonicalState.status === "failed"
                  ? "失败，原文未改变"
                  : "尚无当前结果"}
          </p>
          <button
            className={buttonClass}
            disabled={
              !controller.canToggleSourceMode() ||
              (!!snapshot &&
                controller.getMode(snapshot.documentId) !== "editing")
            }
            onClick={() => controller.injectEditorFault("presentation")}
          >
            实验：呈现故障
          </button>
          <button
            className={buttonClass}
            disabled={!controller.canToggleSourceMode()}
            onClick={() => controller.injectEditorFault("parser")}
          >
            实验：解析故障
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {snapshot && (
          <button
            type="button"
            className={buttonClass}
            disabled={!isCommandEnabled(pinCommand)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => executeCommand({ type: pinCommand, args: {} })}
          >
            {PRODUCT_COMMANDS[pinCommand]?.label}
          </button>
        )}
        <button
          className={buttonClass}
          disabled={!isCommandEnabled("selectFolder")}
          onClick={() => executeCommand({ type: "selectFolder", args: {} })}
        >
          加入文件夹
        </button>
        <button
          className={buttonClass}
          disabled={!isCommandEnabled("selectDocument")}
          onClick={() => executeCommand({ type: "selectDocument", args: {} })}
        >
          {PRODUCT_COMMANDS.selectDocument?.label}
        </button>
        <button
          className={buttonClass}
          disabled={!isCommandEnabled("revealDocument")}
          onClick={() => executeCommand({ type: "revealDocument", args: {} })}
        >
          在 Finder 中显示当前文档
        </button>
        <button
          className={buttonClass}
          disabled={!isCommandEnabled("openDefaultDocument")}
          onClick={() =>
            executeCommand({ type: "openDefaultDocument", args: {} })
          }
        >
          用系统默认应用打开
        </button>
        <span className="text-muted-foreground text-sm">
          打开磁盘上的版本，不会自动保存当前修改；默认应用也可能是本 App。
        </span>
        <button
          className={buttonClass}
          disabled={!isCommandEnabled("reloadDocument")}
          onClick={() => executeCommand({ type: "reloadDocument", args: {} })}
        >
          {PRODUCT_COMMANDS.reloadDocument?.label}
        </button>
        <button
          className={buttonClass}
          disabled={!isCommandEnabled("clearDocument")}
          onClick={() => executeCommand({ type: "clearDocument", args: {} })}
        >
          清空窗口
        </button>
        <button
          className={buttonClass}
          disabled={!isCommandEnabled("saveDocument")}
          onClick={() => executeCommand({ type: "saveDocument", args: {} })}
        >
          保存当前文档
        </button>
      </div>
      {snapshot && (
        <p role="status" aria-live="polite" className="text-sm">
          {documentStatusLabel(
            mode,
            snapshot.writeCapability
          )}
          {
            {
              saving: "保存中…",
              saved: "已保存（与读取/保存基线一致）",
              dirty: "未保存",
              failed: "保存失败",
              uncertain: "保存结果未确认",
            }[controller.getSaveStatus(snapshot.documentId).status]
          }
          {controller.getSaveStatus(snapshot.documentId).message
            ? ` · ${controller.getSaveStatus(snapshot.documentId).message}`
            : ""}
        </p>
      )}
      <div
        className="text-muted-foreground text-sm"
        role="status"
        aria-live="polite"
      >
        {state.busy
          ? "正在等待文件选择或读取…"
          : snapshot
            ? `已读取 ${snapshot.byteLength.toLocaleString()} 字节 · 最近一次请求 ${state.elapsedMs?.toFixed(1) ?? "—"} ms`
            : "请选择本地 .md 或 .markdown 文件。"}
      </div>
      {state.error && (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      )}
      {state.removalPending && (
        <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => void controller.retryStandaloneRemoval()}>
          重试确认移除结果
        </button>
      )}
      {state.folderRemovalPending && (
        <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => void workspace.folderRemoval.retry()}>重试确认目录移除结果</button>
      )}
      {workspace.trashState.message && <p role="status" className="text-sm">{workspace.trashState.message}</p>}
      {workspace.trashState.pending && <button type="button" className="rounded border px-2 py-1 text-xs disabled:opacity-50" disabled={!workspace.trashState.canQuery} onClick={() => void workspace.trash.retry()}>查询废纸篓操作结果</button>}
      {snapshot && controller.externalMessage(snapshot.documentId) && (
        <p role="status" className="text-muted-foreground text-sm">
          {controller.externalMessage(snapshot.documentId)}
        </p>
      )}
      {state.stale && (
        <p className="text-sm">
          以下为上次成功读取的旧快照，不代表当前磁盘内容。
        </p>
      )}
      {snapshot && (
        <>
          <details
            className="text-muted-foreground text-sm"
            onToggle={(event) => setDiagnosticsOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer">
              文档诊断信息（磁盘快照与内存分别显示）
            </summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm break-all">
              <dt>文件</dt>
              <dd>{snapshot.fileName}</dd>
              <dt>documentId</dt>
              <dd className="font-mono">{snapshot.documentId}</dd>
              <dt>磁盘 revision</dt>
              <dd>{snapshot.revision}</dd>
              <dt>最近保存传输</dt>
              <dd>
                {controller.getSaveTransfer(snapshot.documentId)
                  ? `${controller.getSaveTransfer(snapshot.documentId)!.mode === "patch" ? "增量" : "权威全文重同步"} · JSON 应用载荷 ${controller.getSaveTransfer(snapshot.documentId)!.payloadBytes} 字节（不含底层协议开销）`
                  : "尚未保存"}
              </dd>
              <dt>权限</dt>
              <dd>仅当前已授权文档可读取/手动保存，不授权任意路径或相邻文件</dd>
              <TextFidelityDetails fidelity={snapshot.fidelity} />
            </dl>
            {editor && diagnosticsOpen && (
              <>
                <p className="mt-3">
                  当前内存 · bufferRevision {editor.revision} ·{" "}
                  {controller.isDirty(snapshot.documentId)
                    ? "未保存"
                    : "与读取基线一致"}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3">
                  <TextFidelityDetails
                    fidelity={analyzeTextFidelity(editor.state.field(rawText))}
                  />
                </dl>
              </>
            )}
          </details>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <MemoryEditor
              readLocalImage={readLocalImage}
              publishRaster={workspace.publishRaster}
              authorizeRaster={workspace.authorizeRaster}
              assetEpoch={
                workspace.folderState.assetEpochs?.[snapshot.handle]
              }
              controller={controller}
              documentId={snapshot.documentId}
              frozen={state.frozen || state.busy}
            />
          </div>
        </>
      )}
      <CreateMarkdownDialog controller={workspace.creation} state={workspace.creationState} folders={workspace.folderState} />
      <CreateMarkdownDialog controller={workspace.duplication} state={workspace.duplicationState} folders={workspace.folderState} />
      <CreateMarkdownDialog controller={workspace.folderCreation} state={workspace.folderCreationState} folders={workspace.folderState} />
      <QuickOpenDialog controller={workspace.quickOpen} />
      <Dialog open={!!workspace.trashDialog} onOpenChange={open => { if (!open) workspace.trashDialog?.respond("cancel"); }}>
        <DialogContent>
          <DialogTitle>{workspace.trashDialog?.stage === "dirty" ? "确认未保存内容" : "移入系统废纸篓"}</DialogTitle>
          <DialogDescription>{workspace.trashDialog?.stage === "dirty" ? "此文件仍有未保存或尚未接受的内存内容。取消可完整保留所有文档；先保存会结束整个操作，请保存后重新确认。选择放弃仅记录本次意图，移入废纸篓成功后才关闭文档。" : workspace.trashDialog?.prepared.kind === "directory" ? "将下方整个实际目录移入系统废纸篓，包括所有子目录、隐藏文件、图片等资产及非 Markdown 文件，不会永久删除。相关目录将从窗口移除，成功后关闭受影响标签；失败或结果未知时保留内存内容。下方文档列表仅为已打开文档，并非目录全部内容。" : "将以下实际文件移入系统废纸篓，不会永久删除。系统成功后关闭相关标签；失败或结果未知时保留内存内容。"}</DialogDescription>
          {workspace.trashDialog?.stage === "dirty" && <p className="text-sm font-medium break-all">当前确认文档：{workspace.trashDialog.document?.fileName}</p>}
          <p className="text-sm break-all">{workspace.trashDialog?.prepared.canonicalPath}</p>
          {workspace.trashDialog && workspace.trashDialog.prepared.selectedPath !== workspace.trashDialog.prepared.canonicalPath && <p className="text-sm break-all">链接入口：{workspace.trashDialog.prepared.selectedPath}。操作的是上方实际目标，不是链接入口。</p>}
          {!!workspace.trashDialog?.prepared.affected.length && <ul className="max-h-48 overflow-auto text-sm">{workspace.trashDialog.prepared.affected.map(item => <li className="break-all" key={item.handle}>{item.fileName}</li>)}</ul>}
          <div className="flex flex-wrap gap-2">
            <button className={buttonClass} onClick={() => workspace.trashDialog?.respond("cancel")}>取消</button>
            {workspace.trashDialog?.stage === "dirty" && <button className={buttonClass} onClick={() => workspace.trashDialog?.respond("save-first")}>先保存（取消本次操作）</button>}
            <button className={`${buttonClass} text-destructive`} onClick={() => workspace.trashDialog?.respond("discard")}>{workspace.trashDialog?.stage === "dirty" ? "放弃并继续确认" : "移入系统废纸篓"}</button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!workspace.folderRemovalDialog} onOpenChange={open => { if (!open) workspace.folderRemovalDialog?.respond("cancel"); }}>
        <DialogContent showCloseButton={false} onInteractOutside={event => event.preventDefault()}>
          <DialogTitle>从窗口移除目录</DialogTitle>
          <DialogDescription>{workspace.folderRemovalDialog?.documents.length ? "以下已打开文档仅由此目录覆盖。选择保留为独立文件，或关闭这些文档；不会删除或改写磁盘文件。" : "确认从当前窗口移除此目录？不会删除磁盘目录或文件，最近文件历史仍保留。"}</DialogDescription>
          {!!workspace.folderRemovalDialog?.documents.length && <ul className="max-h-60 overflow-auto text-sm">{workspace.folderRemovalDialog.documents.map(item => <li key={item.handle}>{item.fileName} · {item.explicitStandalone ? "已有独立授权（关闭仅关闭标签）" : "仅目录授权"}</li>)}</ul>}
          <div className="flex flex-wrap justify-end gap-3">
            <button className={buttonClass} onClick={() => workspace.folderRemovalDialog?.respond("cancel")}>取消</button>
            {!!workspace.folderRemovalDialog?.documents.length && <button className={buttonClass} onClick={() => workspace.folderRemovalDialog?.respond("close")}>关闭这些文档并移除</button>}
            <button className={buttonClass} onClick={() => workspace.folderRemovalDialog?.respond("keep")}>{workspace.folderRemovalDialog?.documents.length ? "保留为独立文件并移除" : "移除目录"}</button>
          </div>
        </DialogContent>
      </Dialog>
      <DocumentDiscardDialog buttonClass={buttonClass} />
    </section>
  );
}
