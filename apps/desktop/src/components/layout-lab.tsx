import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@agentic-markdown/ui/ui/resizable";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { discardGuard } from "@/client/discard-guard";

import { MainSideLayout, MAIN_SIDE_MINIMUM_WIDTH } from "./main-side-layout";

const buttonClass = "electrobun-webkit-app-region-no-drag rounded border px-2 py-1 focus-visible:outline-2";
const fixtureWidths = [null, 321, 300] as const;
type FixtureWidth = (typeof fixtureWidths)[number];
const cssPixels = (width: number) => Math.round(width * 100) / 100;

export function LayoutLab() {
  const [fixture, setFixture] = useState<FixtureWidth>(null);
  const [sideVisible, setSideVisible] = useState(true);
  const [treeWidth, setTreeWidth] = useState(0);
  const [mainWidth, setMainWidth] = useState(0);
  const [sideWidth, setSideWidth] = useState(0);
  const [hostWidth, setHostWidth] = useState(0);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const separator = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => discardGuard.register({
    beginDiscard: () => true,
    endDiscard() {
      /* Synthetic panels have no dirty state. */
    },
    hasDirty: () => false,
    waitForSaves: () => Promise.resolve(),
  }), []);

  useLayoutEffect(() => {
    const hostElement = host.current;
    const canvasElement = canvas.current;
    if (!hostElement || !canvasElement) return;
    const measure = () => {
      setHostWidth(cssPixels(hostElement.getBoundingClientRect().width));
      setCanvasWidth(cssPixels(canvasElement.getBoundingClientRect().width));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(hostElement);
    observer.observe(canvasElement);
    measure();
    return () => observer.disconnect();
  }, []);

  function toggleSide() {
    const focus = document.activeElement;
    if (sideVisible && (side.current?.contains(focus) || separator.current?.contains(focus)))
      toggle.current?.focus({ preventScroll: true });
    setSideVisible(!sideVisible);
  }

  return (
    <main className="bg-background text-foreground flex h-screen flex-col">
      <div aria-hidden="true" className="electrobun-webkit-app-region-drag h-12 shrink-0 select-none" />
      <section className="space-y-2 px-4 pb-3">
        <h1 className="text-lg font-semibold">主副分栏布局实验</h1>
        <p className="text-sm">仅使用合成占位内容。</p>
        <div className="flex flex-wrap gap-2">
          {fixtureWidths.map((width) => (
            <button
              key={width ?? "workspace"}
              type="button"
              aria-pressed={fixture === width}
              className={buttonClass}
              onClick={() => setFixture(width)}
            >
              {width === null ? "使用工作区宽度" : `宿主 ${width}px`}
            </button>
          ))}
          <button ref={toggle} type="button" aria-expanded={sideVisible}
            aria-controls={sideVisible ? "side-region" : undefined} className={buttonClass} onClick={toggleSide}>
            {sideVisible ? "收起副区" : "展开副区"}
          </button>
        </div>
        <div aria-label="布局测量" className="flex flex-wrap gap-x-4 text-sm tabular-nums">
          <p>文件树宽度 {cssPixels(treeWidth)} CSS px</p>
          <p>宿主宽度 {hostWidth} CSS px</p>
          <p>画布宽度 {canvasWidth} CSS px</p>
          <p>主区宽度 {cssPixels(mainWidth)} CSS px</p>
          <p>副区宽度 {sideVisible ? cssPixels(sideWidth) : 0} CSS px</p>
        </div>
        {sideVisible && hostWidth > 0 && hostWidth < MAIN_SIDE_MINIMUM_WIDTH && (
          <p className="text-sm">宿主窄于双区最小画布，可横向滚动查看。</p>
        )}
      </section>
      <div className="min-h-0 grow overflow-auto border-t">
        <ResizablePanelGroup id="layout-lab-tree-group" orientation="horizontal" className="min-w-[442px]">
          <ResizablePanel id="layout-lab-tree" minSize={120} defaultSize={176}
            groupResizeBehavior="preserve-pixel-size" onResize={({ inPixels }) => setTreeWidth(inPixels)}>
            <section aria-label="实验文件树" className="bg-sidebar size-full p-3">
              <h2>文件树</h2>
              <p className="text-sm">合成条目.md</p>
            </section>
          </ResizablePanel>
          <ResizableHandle id="layout-lab-tree-separator" aria-label="文件树分隔线"
            className="electrobun-webkit-app-region-no-drag" />
          <ResizablePanel id="layout-lab-workspace" minSize={MAIN_SIDE_MINIMUM_WIDTH}>
            <div ref={host} className="h-full overflow-x-auto" style={{ width: fixture ?? "100%" }}>
              <MainSideLayout
                main={<section aria-label="实验主区" className="size-full p-3"><h2>主区</h2></section>}
                side={
                  <section ref={side} aria-label="实验副区" className="bg-muted size-full space-y-2 p-3">
                    <h2>副区</h2>
                    <button type="button" className={buttonClass}>副区焦点样本</button>
                  </section>
                }
                sideVisible={sideVisible}
                elementRef={canvas}
                separatorRef={separator}
                onMainWidth={setMainWidth}
                onSideWidth={setSideWidth}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </main>
  );
}
