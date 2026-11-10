import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@agentic-markdown/ui/ui/resizable";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { discardGuard } from "@/client/discard-guard";
import { allocateSecondaryPaneHeight, SECONDARY_MIN_HEIGHT } from "@/client/secondary-pane-height";

import { MainSideLayout, MAIN_SIDE_MINIMUM_WIDTH } from "./main-side-layout";

const buttonClass = "electrobun-webkit-app-region-no-drag rounded border px-2 py-1 focus-visible:outline-2";
const fixtureWidths = [null, 321, 300] as const;
type FixtureWidth = (typeof fixtureWidths)[number];
const cssPixels = (width: number) => Math.round(width * 100) / 100;

const heightFixtures = [
  { label: "99px 恰好装入", total: 99, heights: [33, 66] },
  { label: "98px 空间不足", total: 98, heights: [33, 65] },
  { label: "134px 均摊触底", total: 134, heights: [33, 46, 55] },
  { label: "132px 比例缩小", total: 132, heights: [66, 66] },
  { label: "99px 空副区", total: 99, heights: [] },
] as const;
type HeightFixture = (typeof heightFixtures)[number];

function HeightAllocationLab() {
  const [state, setState] = useState<{
    fixture: HeightFixture;
    heights: readonly number[];
    notice: string;
  }>({ fixture: heightFixtures[0], heights: heightFixtures[0].heights, notice: "" });
  const { fixture, heights, notice } = state;
  const stack = useRef<HTMLOListElement>(null);
  const [measured, setMeasured] = useState<{
    total: number;
    heights: number[];
    title?: number;
    divider?: number;
  }>();

  useLayoutEffect(() => {
    const element = stack.current;
    if (!element) return;
    const height = (row: Element) => cssPixels(row.getBoundingClientRect().height);
    const first = element.firstElementChild;
    const title = first?.firstElementChild;
    const divider = first?.lastElementChild;
    setMeasured({
      total: height(element),
      heights: Array.from(element.children, height),
      title: title ? height(title) : undefined,
      divider: divider ? height(divider) : undefined,
    });
  }, [fixture, heights]);

  function addDocument() {
    setState((previous) => {
      const result = allocateSecondaryPaneHeight(previous.fixture.total, previous.heights);
      if (!result.ok) return {
        ...previous,
        notice: result.reason === "full" ? "空间不足" : "实验高度无效",
      };
      return {
        ...previous,
        heights: result.heights,
        notice: `已加入合成文档 ${result.heights.length}`,
      };
    });
  }

  return (
    <div className="space-y-2 text-sm">
      <h3 className="font-semibold">副区高度分配</h3>
      <div className="flex flex-wrap gap-1" role="group" aria-label="高度预设">
        {heightFixtures.map((preset) => (
          <button key={preset.label} type="button" className={buttonClass}
            aria-pressed={preset === fixture}
            onClick={() => setState({ fixture: preset, heights: preset.heights, notice: "" })}>
            {preset.label}
          </button>
        ))}
      </div>
      <button type="button" className={buttonClass} onClick={addDocument}>加入合成文档</button>
      {notice && <p role="status">{notice}</p>}
      <p className="tabular-nums">理论 CSS px：总高 {fixture.total}，文档 {heights.join(" / ") || "无"}</p>
      {measured && (
        <p className="tabular-nums">
          实测 CSS px：总高 {measured.total}，文档 {measured.heights.join(" / ") || "无"}
          {measured.title !== undefined && `，标题栏 ${measured.title}，分隔线 ${measured.divider}`}
        </p>
      )}
      <ol ref={stack} aria-label="副区合成文档" className="bg-background ring-border overflow-hidden rounded ring-1"
        style={{ height: fixture.total }}>
        {heights.map((height, index) => (
          <li key={index} className="flex flex-col overflow-hidden" style={{ height }}>
            <h4 className="bg-sidebar flex shrink-0 items-center px-2" style={{ height: SECONDARY_MIN_HEIGHT - 1 }}>
              合成文档 {index + 1}
            </h4>
            <div aria-hidden="true" className="min-h-0 grow" />
            <div aria-hidden="true" className="bg-border h-px shrink-0" />
          </li>
        ))}
      </ol>
    </div>
  );
}

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
                  <section ref={side} aria-label="实验副区" className="bg-muted size-full space-y-2 overflow-auto p-3">
                    <h2>副区</h2>
                    <button type="button" className={buttonClass}>副区焦点样本</button>
                    <HeightAllocationLab />
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
