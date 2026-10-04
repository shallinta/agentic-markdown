import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@agentic-markdown/ui/ui/resizable";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePanelRef } from "react-resizable-panels";

import "@/client/markdown-worker-browser";
import { CommandProvider, useCommands, useRegisterCommands } from "@/commands";
import {
  DocumentServicePanel,
  StandaloneFileList,
  useDocumentWorkspace,
} from "@/components/document-service-panel";
import { UpdateIndicator } from "@/components/update-indicator";
import { UpdateStatusProvider } from "@/components/update-status-provider";
import { electrobun } from "@/lib/electrobun";
import { persistSidebarSize, readSidebarSize } from "@/lib/sidebar-size";
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
  const workspace = useDocumentWorkspace();
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
  const [defaultSidebarSize] = useState(readSidebarSize);

  useRegisterCommands({
    openSettings: ({ tab }) => {
      setSettingsTab(tab ?? "general");
      changeSettingsOpen(true);
    },
    openCommandPalette: () => setCommandPaletteOpen(true),
    toggleSidebar: () => {
      const panel = sidebarPanelRef.current;
      if (!panel) return;
      if (panel.isCollapsed()) {
        panel.expand();
        return;
      }
      panel.collapse();
    },
  });

  useEffect(() => {
    const rpc = electrobun.rpc;
    if (!rpc) return;
    rpc.addMessageListener("executeCommand", executeCommand);
    return () => rpc.removeMessageListener("executeCommand", executeCommand);
  }, [executeCommand]);

  return (
    <div className="relative flex size-full flex-col">
      <main className="min-h-0 grow">
        <ResizablePanelGroup>
          <ResizablePanel
            className="bg-sidebar relative flex items-center justify-center"
            panelRef={sidebarPanelRef}
            collapsible
            collapsedSize={0}
            defaultSize={defaultSidebarSize}
            minSize={200}
            onResize={({ inPixels }) => persistSidebarSize(inPixels)}
          >
            <div
              aria-hidden="true"
              className="electrobun-webkit-app-region-drag absolute inset-x-1 top-0 z-10 h-12 select-none"
            />
            <StandaloneFileList workspace={workspace} />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel
            className="relative flex items-center justify-center"
            minSize={640}
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
