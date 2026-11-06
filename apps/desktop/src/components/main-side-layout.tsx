import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@agentic-markdown/ui/ui/resizable";
import type { ReactNode, Ref } from "react";

const paneMinimum = 160;
export const MAIN_SIDE_MINIMUM_WIDTH = 2 * paneMinimum + 1;

interface MainSideLayoutProps {
  main: ReactNode;
  side: ReactNode;
  sideVisible: boolean;
  elementRef?: Ref<HTMLDivElement>;
  separatorRef?: Ref<HTMLDivElement>;
  onMainWidth?: (pixels: number) => void;
  onSideWidth?: (pixels: number) => void;
}

export function MainSideLayout({
  main, side, sideVisible, elementRef, separatorRef, onMainWidth, onSideWidth,
}: MainSideLayoutProps) {
  return (
    <ResizablePanelGroup
      id="main-side-layout"
      orientation="horizontal"
      elementRef={elementRef}
      style={{ minWidth: sideVisible ? MAIN_SIDE_MINIMUM_WIDTH : paneMinimum }}
      resizeTargetMinimumSize={{ fine: 3, coarse: 3 }}
    >
      <ResizablePanel
        id="main-region"
        minSize={paneMinimum}
        onResize={({ inPixels }) => onMainWidth?.(inPixels)}
      >
        {main}
      </ResizablePanel>
      {sideVisible && (
        <ResizableHandle
          id="main-side-separator"
          aria-label="主副区域分隔线"
          elementRef={separatorRef}
          className="electrobun-webkit-app-region-no-drag after:w-[3px]"
        />
      )}
      {sideVisible && (
        <ResizablePanel
          id="side-region"
          minSize={paneMinimum}
          onResize={({ inPixels }) => onSideWidth?.(inPixels)}
        >
          {side}
        </ResizablePanel>
      )}
    </ResizablePanelGroup>
  );
}
