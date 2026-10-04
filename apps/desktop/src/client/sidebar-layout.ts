import {
  isSidebarLayout,
  type SidebarLayout,
} from "@agentic-markdown/shared/sidebar-layout";

export const SIDEBAR_MIN = 200;
export const CONTENT_RESERVE = 640;
export const SIDEBAR_PANEL_ID = "window-sidebar-panel";
/** Move focus before collapsing makes the separator hidden/disabled. */
export function focusBeforeSidebarCollapse(
  pixels: number,
  active: Pick<Element, "getAttribute"> | null,
  toggle: Pick<HTMLElement, "focus"> | null
) {
  if (pixels === 0 && active?.getAttribute("role") === "separator") {
    toggle?.focus({ preventScroll: true });
  }
}
/** Completed layout is current while panel DOM can still contain the previous size. */
export function sidebarLayoutPixels(
  layout: Record<string, number>,
  availablePanelWidth: number
) {
  const portion = layout[SIDEBAR_PANEL_ID];
  const total = Object.values(layout).reduce((sum, value) => sum + value, 0);
  if (
    !Number.isFinite(portion) ||
    portion < 0 ||
    !Number.isFinite(total) ||
    total <= 0 ||
    !Number.isFinite(availablePanelWidth)
  )
    return undefined;
  return (Math.max(0, availablePanelWidth) * portion) / total;
}
// Inherited adjustable shell parameters, not future main/secondary pane rules.
export function sidebarBounds(available: number) {
  const width = Math.max(0, available);
  const max = Math.max(0, width - Math.min(CONTENT_RESERVE, width / 2));
  return { min: Math.min(SIDEBAR_MIN, max), max };
}
export function sidebarPixels(desired: number, available: number) {
  const { min, max } = sidebarBounds(available);
  return Math.max(min, Math.min(desired, max));
}
/** Panel constraint registration commits after the parent's layout effect. */
export function scheduleSidebarRestore(
  read: () => { visible: boolean; expandedWidth: number },
  available: () => number,
  apply: (pixels: number | null) => void,
  schedule: (callback: () => void) => number,
  cancel: (id: number) => void
) {
  let active = true;
  const id = schedule(() => {
    if (!active) return;
    const current = read();
    const width = available();
    if (current.visible && width <= 0) return;
    apply(current.visible ? sidebarPixels(current.expandedWidth, width) : null);
  });
  return () => {
    active = false;
    cancel(id);
  };
}
export function createSidebarLayout(
  read: () => Promise<unknown>,
  write: (layout: SidebarLayout) => Promise<unknown>,
  defaultWidth = 256
) {
  let state = {
    layout: { visible: true, expandedWidth: defaultWidth },
    ready: false,
    error: null as string | null,
  };
  let touchedVisible = false,
    touchedWidth = false,
    sequence = 0;
  let loading: Promise<void> | undefined;
  const pending = new Set<Promise<void>>();
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach((listener) => listener());
  const persist = () => {
    if (!state.ready) return;
    const generation = ++sequence;
    const saving = write({ ...state.layout })
      .then((result) => {
        if (
          !result ||
          typeof result !== "object" ||
          !("ok" in result) ||
          result.ok !== true
        )
          throw Error();
        if (generation === sequence) {
          state = { ...state, error: null };
          publish();
        }
      })
      .catch(() => {
        if (generation === sequence) {
          state = {
            ...state,
            error: "侧栏布局未能保存，请重试；当前布局仍保留。",
          };
          publish();
        }
      });
    pending.add(saving);
    void saving.finally(() => pending.delete(saving));
  };
  const controller = {
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    initialize() {
      loading ??= read()
        .then((result) => {
          if (
            !result ||
            typeof result !== "object" ||
            !("ok" in result) ||
            result.ok !== true
          )
            throw Error();
          const layout = "layout" in result ? result.layout : undefined;
          if (layout !== undefined && !isSidebarLayout(layout)) throw Error();
          state = {
            ...state,
            ready: true,
            layout: {
              visible:
                !touchedVisible && layout
                  ? layout.visible
                  : state.layout.visible,
              expandedWidth:
                !touchedWidth && layout
                  ? layout.expandedWidth
                  : state.layout.expandedWidth,
            },
          };
          publish();
          if (touchedVisible || touchedWidth) persist();
        })
        .catch(() => {
          state = {
            ...state,
            ready: true,
            error: "侧栏布局读取失败，暂用当前布局。",
          };
          publish();
        });
      return loading;
    },
    async flush(this: void) {
      await controller.initialize();
      await Promise.all([...pending]);
      if (state.error && (touchedVisible || touchedWidth)) {
        persist();
        await Promise.all([...pending]);
        if (state.error) throw Error("SIDEBAR_LAYOUT_NOT_SAVED");
      }
    },
    toggle() {
      touchedVisible = true;
      state = {
        ...state,
        layout: { ...state.layout, visible: !state.layout.visible },
      };
      publish();
      persist();
    },
    userResize(pixels: number, allowed = true) {
      if (!allowed || !Number.isFinite(pixels) || pixels < 0) return;
      touchedVisible = true;
      if (pixels > 0) touchedWidth = true;
      state = {
        ...state,
        layout: {
          visible: pixels > 0,
          expandedWidth: pixels > 0 ? pixels : state.layout.expandedWidth,
        },
      };
      publish();
      persist();
    },
  };
  return controller;
}
