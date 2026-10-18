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
  type DocumentTransport,
} from "@/client/documents";
import { createFolderRemoval } from "@/client/folder-removal";
import { isExternalTextTarget } from "@/client/history-target";
import {
  runInlineFormat,
  runNativeInlineFormat,
} from "@/client/inline-format-input";
import { longLineProtection } from "@/client/long-line-protection";
import { createQuickOpen } from "@/client/quick-open";
import { rawText } from "@/client/raw-buffer";
import { createReadingThemeSelection } from "@/client/reading-theme";
import { routeSourceModeShortcut } from "@/client/source-mode-shortcut";
import { createTrashDocument, type TrashChoice, type TrashDialog } from "@/client/trash-document";
import { createFolderWorkspace } from "@/client/workspace";
import { createWorkspaceReveal } from "@/client/workspace-reveal";
import { createWorkspaceRootOrder } from "@/client/workspace-root-order";
import { projectWorkspaceTree } from "@/client/workspace-tree-model";
import { useCommands, useRegisterCommands } from "@/commands";
import { useSourceWrapping } from "@/hooks/use-source-wrapping";
import { electrobun } from "@/lib/electrobun";
import { PRODUCT_COMMANDS } from "@/shared/commands";
import type { CreateTarget } from "@/shared/create-markdown";
import type { FolderRemovalDocument } from "@/shared/folder-removal";
import type { LocalImageRequest } from "@/shared/local-images";
import { analyzeTextFidelity } from "@/shared/text-fidelity";
import type { TrashTarget } from "@/shared/trash-document";
import type { WorkspaceRevealTarget } from "@/shared/workspace";

import { CreateMarkdownDialog } from "./create-markdown-dialog";
import { FocusTraceLab } from "./focus-trace-lab";
import { MemoryEditor } from "./memory-editor";
import { QuickOpenDialog } from "./quick-open-dialog";
import { ReadingView } from "./reading-view";
import { RecentFiles, recentFailureText } from "./recent-files";
import { TextFidelityDetails } from "./text-fidelity-details";
import { WorkspaceTree, type RootOrderActions } from "./workspace-tree";

const readLocalImage = (request: LocalImageRequest): Promise<unknown> =>
  electrobun.rpc
    ? electrobun.rpc.request.readLocalImage(request, { maxRequestTime: 12000 })
    : Promise.reject(new Error("RPC unavailable"));

export function useDocumentWorkspace(beforeDiscard?: () => Promise<void>) {
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
    const rpc = electrobun.rpc;
    const unavailable = () => Promise.reject(new Error("RPC unavailable"));
    const transport: DocumentTransport = {
      removeStandalone: request => rpc ? rpc.request.removeStandalone(request) : unavailable(),
      observeDocument: (request) =>
        rpc
          ? rpc.request.observeDocument(request, { maxRequestTime: 4000 })
          : unavailable(),
      openWorkspaceDocument: (request) =>
        rpc ? rpc.request.openWorkspaceDocument(request) : unavailable(),
      checkDocumentWriteCapability: (request) =>
        rpc
          ? rpc.request.checkDocumentWriteCapability(request, {
              maxRequestTime: 4000,
            })
          : unavailable(),
      cancelDocument: (request) =>
        rpc ? rpc.request.cancelDocument(request) : unavailable(),
      selectDocument: (request) =>
        rpc ? rpc.request.selectDocument(request) : unavailable(),
      revealDocument: (request) =>
        rpc ? rpc.request.revealDocument(request) : unavailable(),
      openDefaultDocument: (request) =>
        rpc ? rpc.request.openDefaultDocument(request) : unavailable(),
      readDocument: (request) =>
        rpc ? rpc.request.readDocument(request) : unavailable(),
      saveDocument: (request) =>
        rpc ? rpc.request.saveDocument(request) : unavailable(),
      waitForDocumentSaves: (request) =>
        rpc ? rpc.request.waitForDocumentSaves(request) : unavailable(),
      releaseDocument: (request) =>
        rpc ? rpc.request.releaseDocument(request) : unavailable(),
    };
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
  const [readingThemes] = useState(() =>
    createReadingThemeSelection(
      controller.captureCurrentViewport,
      controller.canChangeReadingTheme
    )
  );
  const readingTheme = useSyncExternalStore(
    readingThemes.subscribe,
    readingThemes.getSnapshot
  );
  const chooseReadingTheme = (id: string) => {
    const error = readingThemes.select(id);
    if (error) toast.error(error);
  };
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
      readingThemePaper: () => chooseReadingTheme("paper"),
      readingThemeInk: () => chooseReadingTheme("ink"),
      toggleReadingMode: () => {
        controller.toggleReadingMode();
      },
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
      readingThemePaper: controller.canChangeReadingTheme,
      readingThemeInk: controller.canChangeReadingTheme,
      toggleReadingMode: controller.canToggleReadingMode,
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
      reloadDocument: () =>
        !controller.getSnapshot().busy &&
        !controller.getSnapshot().frozen &&
        !!controller.getSnapshot().snapshot,
      clearDocument: () =>
        !controller.getSnapshot().frozen &&
        (controller.getSnapshot().busy ||
          controller.getSnapshot().entries.length > 0 ||
          folders.getSnapshot().roots.length > 0),
      closeDocument: () =>
        !controller.getSnapshot().frozen && !!controller.getSnapshot().snapshot,
    }
  );
  useEffect(
    () => controller.subscribe(notifyCommands),
    [controller, notifyCommands]
  );
  useEffect(() => folders.subscribe(notifyCommands), [folders, notifyCommands]);
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
    controller,
    folders,
    folderState,
    state,
    canonical,
    readingTheme,
    executeCommand,
    isCommandEnabled,
  };
}
type Workspace = ReturnType<typeof useDocumentWorkspace>;

export function StandaloneFileList({ workspace }: { workspace: Workspace }) {
  const { state, controller, executeCommand, isCommandEnabled, folders, setCreationTarget } = workspace;
  const [removalHandle, setRemovalHandle] = useState<string | null>(null);
  const [folderRemovalHandle, setFolderRemovalHandle] = useState<string | null>(null);
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
    setFolderRemovalHandle(target?.type === "workspace" && !target.entry ? target.root : null);
    const entry = target?.type === "document" ? controller.getSnapshot().entries.find(entry => entry.handle === target.handle) : undefined;
    const fileRoot = target?.type === "workspace" ? folders.getSnapshot().roots.find(root => root.handle === target.root) : undefined;
    setTrashTarget(!isFile ? null : entry ? { kind: "standalone", handle: entry.handle, documentId: entry.documentId } : target?.type === "workspace" && target.entry && fileRoot ? { kind: "root", root: fileRoot.handle, entry: target.entry, generation: fileRoot.generation } : null);
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

export function DocumentServicePanel({ workspace }: { workspace: Workspace }) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const { state, controller, executeCommand, isCommandEnabled } = workspace;
  const snapshot = state.snapshot;
  const dialog = useSyncExternalStore(
    discardGuard.subscribe,
    discardGuard.getSnapshot
  );
  const editor = snapshot && controller.getEditor(snapshot.documentId);
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
      <nav
        aria-label="已打开的文档"
        className="flex shrink-0 gap-1 overflow-x-auto"
      >
        {state.tabs.map((tab) => (
          <div
            key={tab.documentId}
            className={`flex shrink-0 items-center rounded border ${snapshot?.documentId === tab.documentId ? "bg-muted" : ""}`}
          >
            <button
              disabled={state.frozen}
              aria-current={
                snapshot?.documentId === tab.documentId ? "page" : undefined
              }
              title={tab.displayPath ?? tab.fileName}
              className="max-w-48 truncate px-3 py-2 text-sm"
              onClick={() => controller.activateTab(tab.documentId)}
            >
              {tab.fileName}
              {documentCapabilitySuffix(tab.writeCapability)}
              {controller.isDirty(tab.documentId) ? " ● 未保存" : ""}
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
        ))}
      </nav>
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
              : controller.getMode(snapshot.documentId) === "source"
                ? "基础源码模式 · 完整原文与基础高亮 · 手动保存 ⌘S · 单文件限 1 MiB"
                : controller.getMode(snapshot.documentId) === "reading"
                  ? "阅读模式 · 只读当前内存正文 · 本地静态 PNG/JPEG · 远程图片默认不加载"
                  : "基础编辑模式 · 标题、粗体、斜体与行内代码 · 手动保存 ⌘S · 单文件限 1 MiB"
            : "打开本地 Markdown 文件或加入文件夹。侧栏单击选择，双击或按 Enter 打开文档。"}
        </p>
      </div>
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
            {controller.getMode(snapshot.documentId) === "source"
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
            controller.getMode(snapshot.documentId),
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
            {controller.getMode(snapshot.documentId) !== "source" &&
              !controller.isSafeSource(snapshot.documentId) && (
                <button
                  className="bg-background/60 absolute top-2 right-3 z-10 rounded border p-2 opacity-50 backdrop-blur hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 disabled:opacity-30"
                  title={
                    controller.getMode(snapshot.documentId) === "reading"
                      ? "切换为编辑模式"
                      : "切换为阅读模式"
                  }
                  aria-label={
                    controller.getMode(snapshot.documentId) === "reading"
                      ? "切换为编辑模式"
                      : "切换为阅读模式"
                  }
                  disabled={!isCommandEnabled("toggleReadingMode")}
                  onClick={() =>
                    executeCommand({ type: "toggleReadingMode", args: {} })
                  }
                >
                  <span aria-hidden="true">
                    {controller.getMode(snapshot.documentId) === "reading"
                      ? "✎"
                      : "▤"}
                  </span>
                </button>
              )}
            {controller.getMode(snapshot.documentId) === "reading" ? (
              <ReadingView
                readLocalImage={readLocalImage}
                assetEpoch={
                  workspace.folderState.assetEpochs?.[snapshot.handle]
                }
                theme={workspace.readingTheme}
                controller={controller}
                canonical={workspace.canonical}
                documentId={snapshot.documentId}
                frozen={state.frozen || state.busy}
              />
            ) : (
              <MemoryEditor
                readLocalImage={readLocalImage}
                assetEpoch={
                  workspace.folderState.assetEpochs?.[snapshot.handle]
                }
                controller={controller}
                documentId={snapshot.documentId}
                frozen={state.frozen || state.busy}
              />
            )}
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
          <DialogDescription>{workspace.trashDialog?.stage === "dirty" ? "此文件仍有未保存或尚未接受的内存内容。取消可完整保留；先保存会结束本次操作，请保存后重新确认。选择放弃仅在移入废纸篓成功后关闭文档。" : "将以下实际文件移入系统废纸篓，不会永久删除。系统成功后关闭相关标签；失败或结果未知时保留内存内容。"}</DialogDescription>
          <p className="text-sm break-all">{workspace.trashDialog?.prepared.canonicalPath}</p>
          {workspace.trashDialog && workspace.trashDialog.prepared.selectedPath !== workspace.trashDialog.prepared.canonicalPath && <p className="text-sm break-all">链接入口：{workspace.trashDialog.prepared.selectedPath}。操作的是上方实际文件，不是链接入口。</p>}
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
      <Dialog
        open={!!dialog}
        onOpenChange={(open) => {
          if (!open) discardGuard.respond(false);
        }}
      >
        <DialogContent
          showCloseButton={false}
          role="alertdialog"
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={() => {
            previousFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (previousFocus.current?.isConnected)
              previousFocus.current.focus();
          }}
        >
          <DialogTitle>确认放弃修改</DialogTitle>
          <DialogDescription>{dialog?.message}</DialogDescription>
          <div className="mt-2 flex justify-end gap-3">
            <button
              className={buttonClass}
              onClick={() => discardGuard.respond(false)}
            >
              继续编辑
            </button>
            <button
              className={buttonClass}
              onClick={() => discardGuard.respond(true)}
            >
              放弃变更
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
