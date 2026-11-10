import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@agentic-markdown/ui/ui/resizable";
import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type PointerEvent, type SetStateAction } from "react";

import { discardGuard } from "@/client/discard-guard";
import { resizeSecondaryPaneDivider } from "@/client/secondary-pane-divider";
import { allocateSecondaryPaneHeight, SECONDARY_MIN_HEIGHT } from "@/client/secondary-pane-height";
import { removeSecondaryPaneHeight } from "@/client/secondary-pane-removal";

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
interface HeightAllocationState {
  fixture: HeightFixture;
  heights: readonly number[];
  ids: readonly number[];
  nextId: number;
  notice: string;
  closeReceipt?: { token: object; focusId: number | null };
}

function createHeightFixture(fixture: HeightFixture): HeightAllocationState {
  return {
    fixture,
    heights: fixture.heights,
    ids: fixture.heights.map((_, index) => index + 1),
    nextId: fixture.heights.length + 1,
    notice: "",
  };
}

interface HeightDrag {
  element: HTMLDivElement;
  pointerId: number;
  beforeIndex: number;
  startY: number;
  heights: readonly number[];
  ids: readonly number[];
}

function MinimumHeightWitness({ count, height }: { count: number; height: number }) {
  const canvas = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{ height: number; rows: number[]; overflow: boolean }>();

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    setMeasured({
      height: cssPixels(element.getBoundingClientRect().height),
      rows: Array.from(element.children, (row) => cssPixels(row.getBoundingClientRect().height)),
      overflow: element.scrollHeight > element.clientHeight,
    });
  }, [count, height]);

  return (
    <>
      <div ref={canvas} aria-hidden="true" className="bg-background ring-border w-8 overflow-clip ring-1"
        style={{ height }}>
        {Array.from({ length: count }, (_, index) => (
          <div key={index}>
            <div className="bg-sidebar" style={{ height: SECONDARY_MIN_HEIGHT - 1 }} />
            <div className="bg-border h-px" />
          </div>
        ))}
      </div>
      {measured && (
        <p className="tabular-nums">
          下限样本实测 CSS px，总高 {measured.height}，行高 {measured.rows.join(" / ") || "无"}
          {measured.overflow ? "，有溢出" : "，无溢出"}
        </p>
      )}
    </>
  );
}

function HeightMinimumLab({ ids }: { ids: readonly number[] }) {
  const minimum = ids.length * SECONDARY_MIN_HEIGHT;
  const [check, setCheck] = useState<{ ids: readonly number[]; height: number }>();
  const candidate = check?.ids === ids ? check.height : undefined;

  return (
    <section className="space-y-2 border-t pt-2" aria-label="副区高度下限实验">
      <h4 className="font-semibold">副区高度下限</h4>
      <p className="tabular-nums">{ids.length} 篇文档最少需要 {minimum} CSS px</p>
      <div className="flex flex-wrap gap-1" role="group" aria-label="下限候选高度">
        <button type="button" className={buttonClass}
          onClick={() => setCheck({ ids, height: minimum })}>测试恰好满足下限</button>
        <button type="button" className={`${buttonClass} disabled:opacity-50`} disabled={minimum === 0}
          onClick={() => setCheck({ ids, height: minimum - 1 })}>测试比下限少 1px</button>
      </div>
      {candidate !== undefined && (
        <>
          <p role="status" className="tabular-nums">
            {candidate < minimum ? `${candidate} CSS px 空间不足，需要 ${minimum} CSS px` : `${candidate} CSS px 恰好满足下限`}
          </p>
          {candidate >= minimum && <MinimumHeightWitness count={ids.length} height={candidate} />}
        </>
      )}
    </section>
  );
}

function HeightAllocationLab({ state, setState }: {
  state: HeightAllocationState;
  setState: Dispatch<SetStateAction<HeightAllocationState>>;
}) {
  const { fixture, heights, ids, notice } = state;
  const stack = useRef<HTMLOListElement>(null);
  const drag = useRef<HeightDrag | null>(null);
  const [measured, setMeasured] = useState<{
    total: number;
    heights: number[];
    title?: number;
    divider?: number;
    hit?: { height: number; above: number; below: number };
  }>();

  useLayoutEffect(() => {
    const element = stack.current;
    if (!element) return;
    const height = (row: Element) => cssPixels(row.getBoundingClientRect().height);
    const first = element.firstElementChild;
    const title = first?.firstElementChild;
    const divider = first?.querySelector("[data-height-divider]")?.getBoundingClientRect();
    const hit = first?.querySelector("[data-height-hit]")?.getBoundingClientRect();
    setMeasured({
      total: height(element),
      heights: Array.from(element.children, height),
      title: title ? height(title) : undefined,
      divider: divider ? cssPixels(divider.height) : undefined,
      hit: hit && divider ? {
        height: cssPixels(hit.height),
        above: cssPixels(divider.top - hit.top),
        below: cssPixels(hit.bottom - divider.bottom),
      } : undefined,
    });
  }, [fixture, heights, ids]);

  function addDocument() {
    stopDrag();
    setState((previous) => {
      const result = allocateSecondaryPaneHeight(previous.fixture.total, previous.heights);
      if (!result.ok) return {
        ...previous,
        notice: result.reason === "full" ? "空间不足" : "实验高度无效",
      };
      return {
        ...previous,
        heights: result.heights,
        ids: [...previous.ids, previous.nextId],
        nextId: previous.nextId + 1,
        notice: `已加入合成文档 ${previous.nextId}`,
      };
    });
  }

  function closeDocument(id: number) {
    stopDrag();
    const token = {};
    setState((previous) => {
      const index = previous.ids.indexOf(id);
      const next = removeSecondaryPaneHeight(previous.heights, index);
      if (!next) return previous;
      return {
        ...previous,
        heights: next,
        ids: previous.ids.filter((candidate) => candidate !== id),
        notice: `已关闭合成文档 ${id}`,
        closeReceipt: {
          token,
          focusId: previous.ids[index + 1] ?? previous.ids[index - 1] ?? null,
        },
      };
    });
  }

  function adjust(beforeIndex: number, delta: number, basis?: HeightDrag) {
    setState((previous) => {
      if (basis && basis.ids !== previous.ids) return previous;
      const next = resizeSecondaryPaneDivider(basis?.heights ?? previous.heights, beforeIndex, delta);
      if (!next || (next[beforeIndex] === previous.heights[beforeIndex] &&
        next[beforeIndex + 1] === previous.heights[beforeIndex + 1])) return previous;
      return { ...previous, heights: next, notice: "" };
    });
  }

  function beginDrag(event: PointerEvent<HTMLDivElement>, beforeIndex: number) {
    if (event.button !== 0 || event.pointerType !== "mouse" || !event.isPrimary || drag.current) return;
    const canvas = stack.current;
    if (!canvas) return;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const startY = event.clientY - canvas.getBoundingClientRect().top;
    drag.current = { element, pointerId: event.pointerId, beforeIndex, startY, heights, ids };
    event.preventDefault();
    element.focus({ preventScroll: true });
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    const canvas = stack.current;
    if (!canvas || active?.pointerId !== event.pointerId || active.element !== event.currentTarget) return;
    const y = event.clientY - canvas.getBoundingClientRect().top;
    adjust(active.beforeIndex, y - active.startY, active);
  }

  function stopDrag(event?: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || (event && (active.pointerId !== event.pointerId || active.element !== event.currentTarget))) return;
    drag.current = null;
    if (active.element.hasPointerCapture(active.pointerId))
      active.element.releasePointerCapture(active.pointerId);
  }

  return (
    <div className="space-y-2 text-sm">
      <h3 className="font-semibold">副区高度分配</h3>
      <div className="flex flex-wrap gap-1" role="group" aria-label="高度预设">
        {heightFixtures.map((preset) => (
          <button key={preset.label} type="button" className={buttonClass}
            aria-pressed={preset === fixture}
            onClick={() => {
              stopDrag();
              setState(createHeightFixture(preset));
            }}>
            {preset.label}
          </button>
        ))}
      </div>
      <button type="button" className={buttonClass} onClick={addDocument}>加入合成文档</button>
      <ol ref={stack} aria-label="副区合成文档" className="bg-background ring-border overflow-hidden rounded ring-1"
        style={{ height: fixture.total }}>
        {ids.map((id, index) => (
          <li key={id} id={`layout-lab-height-row-${id}`} className="relative flex flex-col" style={{ height: heights[index] }}>
            <div className="bg-sidebar flex shrink-0 items-center gap-1 px-2" style={{ height: SECONDARY_MIN_HEIGHT - 1 }}>
              <h4 className="min-w-0 grow truncate">合成文档 {id}</h4>
              <button type="button" aria-label={`关闭合成文档 ${id}`} data-height-close={id}
                className="electrobun-webkit-app-region-no-drag size-6 shrink-0 rounded border focus-visible:outline-2"
                onClick={() => closeDocument(id)}>×</button>
            </div>
            <div aria-hidden="true" className="min-h-0 grow" />
            <div aria-hidden="true" data-height-divider="" className="bg-border h-px shrink-0" />
            {index + 1 < heights.length && (
              <div role="separator" tabIndex={0} aria-orientation="horizontal"
                aria-label={`合成文档 ${id} 和 ${ids[index + 1]} 分隔线`}
                aria-controls={`layout-lab-height-row-${id}`}
                aria-valuemin={SECONDARY_MIN_HEIGHT}
                aria-valuemax={cssPixels(heights[index] + heights[index + 1] - SECONDARY_MIN_HEIGHT)}
                aria-valuenow={cssPixels(heights[index])}
                aria-valuetext={`上方 ${cssPixels(heights[index])} CSS px，下方 ${cssPixels(heights[index + 1])} CSS px`}
                data-height-hit=""
                className="electrobun-webkit-app-region-no-drag focus-visible:bg-ring absolute inset-x-0 -bottom-px z-10 h-[3px] cursor-row-resize touch-none select-none focus-visible:outline-2 focus-visible:outline-offset-1"
                onKeyDown={(event) => {
                  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || drag.current) return;
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                  event.preventDefault();
                  event.stopPropagation();
                  adjust(index, event.key === "ArrowDown" ? 8 : -8);
                }}
                onPointerDown={(event) => beginDrag(event, index)}
                onPointerMove={moveDrag}
                onPointerUp={(event) => {
                  moveDrag(event);
                  stopDrag(event);
                }}
                onPointerCancel={stopDrag}
                onLostPointerCapture={stopDrag}
              />
            )}
          </li>
        ))}
      </ol>
      {notice && <p role="status">{notice}</p>}
      <p className="tabular-nums">理论 CSS px：总高 {fixture.total}，文档 {heights.map(cssPixels).join(" / ") || "无"}</p>
      {measured && (
        <p className="tabular-nums">
          实测 CSS px：总高 {measured.total}，文档 {measured.heights.join(" / ") || "无"}
          {measured.title !== undefined && `，标题栏 ${measured.title}，分隔线 ${measured.divider}`}
          {measured.hit && `，命中区 ${measured.hit.height}（向上 ${measured.hit.above}，向下 ${measured.hit.below}）`}
        </p>
      )}
      <HeightMinimumLab ids={ids} />
    </div>
  );
}

export function LayoutLab() {
  const [fixture, setFixture] = useState<FixtureWidth>(null);
  const [sideVisible, setSideVisible] = useState(true);
  const [heightState, setHeightState] = useState(() => createHeightFixture(heightFixtures[0]));
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
  const lastClose = useRef<object | null>(null);
  const { closeReceipt } = heightState;
  const empty = heightState.ids.length === 0;

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

  useLayoutEffect(() => {
    if (!closeReceipt || lastClose.current === closeReceipt.token) return;
    lastClose.current = closeReceipt.token;
    if (closeReceipt.focusId !== null) {
      side.current?.querySelector<HTMLButtonElement>(`[data-height-close="${closeReceipt.focusId}"]`)
        ?.focus({ preventScroll: true });
    } else if (empty) {
      toggle.current?.focus({ preventScroll: true });
      setSideVisible(false);
    }
  }, [closeReceipt, empty]);

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
                    <HeightAllocationLab state={heightState} setState={setHeightState} />
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
