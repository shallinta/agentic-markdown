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

function LazyMount({ open, children }: { open: boolean; children: ReactNode }) {
  const mounted = useRef(false);
  if (open) mounted.current = true;
  if (!mounted.current) return null;
  return <Suspense fallback={null}>{children}</Suspense>;
}

export function Page() {
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
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const sidebarPanelRef = usePanelRef();
  const [defaultSidebarSize] = useState(readSidebarSize);

  useRegisterCommands({
    openSettings: ({ tab }) => {
      setSettingsTab(tab ?? "general");
      setSettingsOpen(true);
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
          onOpenChange={setSettingsOpen}
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
