import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@agentic-markdown/ui/ui/resizable";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useSyncExternalStore,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePanelRef } from "react-resizable-panels";

import "@/client/markdown-worker-browser";
import {
  createSidebarLayout,
  focusBeforeSidebarCollapse,
  sidebarBounds,
  sidebarLayoutPixels,
  scheduleSidebarRestore,
  SIDEBAR_PANEL_ID,
} from "@/client/sidebar-layout";
import { CommandProvider, useCommands, useRegisterCommands } from "@/commands";
import {
  DocumentServicePanel,
  StandaloneFileList,
  useDocumentWorkspace,
} from "@/components/document-service-panel";
import { UpdateIndicator } from "@/components/update-indicator";
import { UpdateStatusProvider } from "@/components/update-status-provider";
import { electrobun } from "@/lib/electrobun";
import type { SettingsTab } from "@/shared/commands";

const SettingsDialog = lazy(() =>
  import("@/components/settings/settings-dialog").then((module) => ({
    default: module.SettingsDialog,
  }))
);
const CommandPalette = lazy(() =>
  import("@/components/command-palette").then((module) => ({
    default: module.CommandPalette,
  }))
);
const PerformanceLab = lazy(() =>
  import("@/components/performance-lab").then((module) => ({
    default: module.PerformanceLab,
  }))
);
const CanonicalLab = lazy(() =>
  import("@/components/canonical-lab").then((module) => ({
    default: module.CanonicalLab,
  }))
);
const SecurityLab = lazy(() =>
  import("@/components/security-lab").then((module) => ({
    default: module.SecurityLab,
  }))
);
const EditorProbeLab = lazy(() =>
  import("@/components/editor-probe-lab").then((module) => ({
    default: module.EditorProbeLab,
  }))
);

function LazyMount({ open, children }: { open: boolean; children: ReactNode }) {
  const mounted = useRef(false);
  if (open) mounted.current = true;
  if (!mounted.current) return null;
  return <Suspense fallback={null}>{children}</Suspense>;
}

export function Page() {
  const lab = (
    globalThis as typeof globalThis & {
      __AGENTIC_MARKDOWN_PERF_LAB__?: {
        enabled: boolean;
        autorun: boolean;
        editorProbe?: boolean;
        denseProbe?: boolean;
        responsiveProbe?: boolean;
        parserWorkProbe?: boolean;
        openDocumentProbe?: boolean;
        canonicalProbe?: boolean;
        securityProbe?: boolean;
      };
    }
  ).__AGENTIC_MARKDOWN_PERF_LAB__;
  if (lab?.enabled)
    return (
      <Suspense fallback={<p>正在加载合成数据实验…</p>}>
        {lab.securityProbe ? (
          <SecurityLab />
        ) : lab.canonicalProbe ? (
          <CanonicalLab />
        ) : lab.editorProbe ||
          lab.denseProbe ||
          lab.responsiveProbe ||
          lab.parserWorkProbe ||
          lab.openDocumentProbe ? (
          <EditorProbeLab
            autorun={lab.autorun}
            dense={lab.denseProbe}
            responsive={lab.responsiveProbe}
            parserWork={lab.parserWorkProbe}
            openDocuments={lab.openDocumentProbe}
          />
        ) : (
          <PerformanceLab autorun={lab.autorun} />
        )}
      </Suspense>
    );
  return (
    <CommandProvider>
      <UpdateStatusProvider>
        <PageInner />
      </UpdateStatusProvider>
    </CommandProvider>
  );
}

function PageInner() {
  const [sidebar] = useState(() =>
    createSidebarLayout(
      () =>
        electrobun.rpc
          ? electrobun.rpc.request.getSidebarLayout({})
          : Promise.reject(Error()),
      (layout) =>
        electrobun.rpc
          ? electrobun.rpc.request.saveSidebarLayout(layout)
          : Promise.reject(Error()),
      Math.max(1, window.innerWidth * 0.2)
    )
  );
  const workspace = useDocumentWorkspace(sidebar.flush);
  const { executeCommand } = useCommands();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const changeSettingsOpen = (open: boolean) => {
    // Set the controller guard synchronously, before lazy dialog mounting or
    // focus restoration can deliver editing events to the background view.
    workspace.controller.setEditorInputBlocked(open);
    setSettingsOpen(open);
  };
  useEffect(
    () => () => workspace.controller.setEditorInputBlocked(false),
    [workspace.controller]
  );
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const sidebarPanelRef = usePanelRef();
  const contentPanelRef = usePanelRef();
  const sidebarContent = useRef<HTMLDivElement>(null);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const groupElement = useRef<HTMLDivElement>(null);
  const cancelSidebarRestore = useRef<(() => void) | undefined>(undefined);
  const sidebarPointerActive = useRef(false);
  const [sidebarRestoreRevision, setSidebarRestoreRevision] = useState(0);
  const [availableWidth, setAvailableWidth] = useState(window.innerWidth);
  const sidebarState = useSyncExternalStore(
    sidebar.subscribe,
    sidebar.getSnapshot
  );
  const { visible, expandedWidth } = sidebarState.layout;
  const bounds = sidebarBounds(availableWidth);
  useEffect(() => {
    void sidebar.initialize();
  }, [sidebar]);
  useEffect(() => {
    const finish = () => {
      if (!sidebarPointerActive.current) return;
      sidebarPointerActive.current = false;
      setSidebarRestoreRevision((value) => value + 1);
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
    };
  }, []);
  useLayoutEffect(() => {
    const element = groupElement.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setAvailableWidth(element.clientWidth)
    );
    observer.observe(element);
    setAvailableWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!visible) {
      if (sidebarContent.current?.contains(document.activeElement))
        sidebarToggle.current?.focus({ preventScroll: true });
    }
    if (sidebarPointerActive.current) return;
    const cancel = scheduleSidebarRestore(
      () => sidebar.getSnapshot().layout,
      () => groupElement.current?.clientWidth ?? availableWidth,
      (pixels) => {
        const panel = sidebarPanelRef.current;
        if (pixels === null) panel?.collapse();
        else panel?.resize(pixels);
      },
      (callback) => requestAnimationFrame(callback),
      (id) => cancelAnimationFrame(id)
    );
    cancelSidebarRestore.current = cancel;
    return cancel;
  }, [
    visible,
    expandedWidth,
    availableWidth,
    sidebarPanelRef,
    sidebar,
    sidebarRestoreRevision,
  ]);

  useRegisterCommands(
    {
      openSettings: ({ tab }) => {
        setSettingsTab(tab ?? "general");
        changeSettingsOpen(true);
      },
      openCommandPalette: () => setCommandPaletteOpen(true),
      toggleSidebar: () => {
        if (
          sidebarContent.current?.contains(document.activeElement) ||
          document.activeElement?.getAttribute("role") === "separator"
        )
          sidebarToggle.current?.focus({ preventScroll: true });
        sidebar.toggle();
      },
    },
    true,
    { toggleSidebar: () => workspace.controller.canChangeReadingTheme() }
  );

  useEffect(() => {
    const rpc = electrobun.rpc;
    if (!rpc) return;
    rpc.addMessageListener("executeCommand", executeCommand);
    return () => rpc.removeMessageListener("executeCommand", executeCommand);
  }, [executeCommand]);

  return (
    <div className="relative flex size-full flex-col">
      <button
        ref={sidebarToggle}
        disabled={!workspace.controller.canChangeReadingTheme()}
        className="electrobun-webkit-app-region-no-drag bg-background/70 focus-visible:outline-ring absolute top-4 left-28 z-30 rounded border px-2 text-xs focus-visible:outline-2"
        aria-expanded={visible}
        aria-controls="window-sidebar"
        onClick={() => executeCommand({ type: "toggleSidebar", args: {} })}
      >
        {visible ? "隐藏文件树" : "显示文件树"}
      </button>
      {sidebarState.error && (
        <p
          role="alert"
          className="bg-background text-destructive absolute top-12 right-4 z-30 text-xs"
        >
          {sidebarState.error}
        </p>
      )}
      <main className="min-h-0 grow">
        <ResizablePanelGroup
          elementRef={groupElement}
          disabled={!visible || !workspace.controller.canChangeReadingTheme()}
          onPointerDownCapture={() => {
            sidebarPointerActive.current = true;
            cancelSidebarRestore.current?.();
          }}
          onLayoutChanged={(layout, meta) => {
            if (meta.isUserInteraction) {
              // Both DOM panel widths still reflect the previous commit, but
              // their sum is the available group width excluding its separator.
              const available =
                (sidebarPanelRef.current?.getSize().inPixels ?? 0) +
                (contentPanelRef.current?.getSize().inPixels ?? 0);
              const size = sidebarLayoutPixels(layout, available);
              if (size !== undefined) {
                if (workspace.controller.canChangeReadingTheme())
                  focusBeforeSidebarCollapse(
                    size,
                    document.activeElement,
                    sidebarToggle.current
                  );
                sidebar.userResize(
                  size,
                  workspace.controller.canChangeReadingTheme()
                );
              }
            }
          }}
        >
          <ResizablePanel
            id={SIDEBAR_PANEL_ID}
            className="bg-sidebar relative flex items-center justify-center"
            panelRef={sidebarPanelRef}
            collapsible
            collapsedSize={0}
            defaultSize="20%"
            minSize={bounds.min}
            maxSize={bounds.max}
            groupResizeBehavior="preserve-pixel-size"
          >
            <div
              aria-hidden="true"
              className="electrobun-webkit-app-region-drag absolute inset-x-1 top-0 z-10 h-12 select-none"
            />
            <div
              ref={sidebarContent}
              id="window-sidebar"
              className="size-full"
              inert={!visible}
              aria-hidden={!visible}
            >
              <StandaloneFileList workspace={workspace} />
            </div>
          </ResizablePanel>
          <ResizableHandle
            hidden={!visible}
            inert={!visible}
            style={visible ? undefined : { display: "none" }}
          />
          <ResizablePanel
            className="relative flex items-center justify-center"
            panelRef={contentPanelRef}
            minSize={Math.min(640, availableWidth / 2)}
          >
            <div
              aria-hidden="true"
              className="electrobun-webkit-app-region-drag absolute inset-x-1 top-0 z-10 h-12 select-none"
            />
            <div className="electrobun-webkit-app-region-no-drag absolute top-4 right-4 z-20">
              <UpdateIndicator />
            </div>
            <DocumentServicePanel workspace={workspace} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
      <LazyMount open={settingsOpen}>
        <SettingsDialog
          tab={settingsTab}
          open={settingsOpen}
          onOpenChange={changeSettingsOpen}
          onTabChange={setSettingsTab}
        />
      </LazyMount>
      <LazyMount open={commandPaletteOpen}>
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          blacklist={[
            "openSettings",
            "openCommandPalette",
            "openLink",
            "toggleMaximized",
          ]}
        />
      </LazyMount>
    </div>
  );
}
