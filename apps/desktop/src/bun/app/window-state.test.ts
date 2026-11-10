import { expect, mock, test } from "bun:test";

import type { WindowFrame } from "@agentic-markdown/shared/server";

import { createSidebarLayout, sidebarPixels } from "../../client/sidebar-layout";
import { electrobunBunMock } from "../test-electrobun-mock";

await mock.module("electrobun/bun", () => electrobunBunMock);

const windowStateModule = await import("./window-state");

test("fullscreen startup without saved sidebar restores normal-window default through the real bridge", async () => {
  let fullScreen = false;
  const writes: string[] = [];
  const win = {
    getFrame: () => ({ x: 0, y: 0, width: fullScreen ? 1512 : 1280, height: 800 }),
    getPageZoom: () => 1,
    isFullScreen: () => fullScreen,
    isMaximized: () => false,
    on: () => undefined,
    setFullScreen: (value: boolean) => { fullScreen = value; },
    maximize: () => undefined, setPageZoom: () => undefined,
    webview: { on: () => undefined },
  };
  const persistence = windowStateModule.createWindowStatePersistence(
    win as unknown as Parameters<typeof windowStateModule.createWindowStatePersistence>[0],
    { isFullScreen: true },
    { saveFrame: () => Promise.resolve(), saveFullScreen: () => Promise.resolve(),
      saveMaximized: () => Promise.resolve(), saveZoom: () => Promise.resolve(),
      saveSidebar: () => { writes.push("sidebar"); return Promise.resolve(); } }
  );
  const sidebar = createSidebarLayout(
    () => Promise.resolve({ ok: true, layout: persistence.getSidebar() }),
    async layout => { await persistence.saveSidebar(layout); return { ok: true }; },
    win.getFrame().width * 0.2
  );
  await sidebar.initialize();
  expect(sidebarPixels(sidebar.getSnapshot().layout.expandedWidth, 1512)).toBe(256);
  fullScreen = false;
  expect(sidebarPixels(sidebar.getSnapshot().layout.expandedWidth, win.getFrame().width)).toBe(256);
  await sidebar.flush(); await persistence.flush();
  expect(writes).toEqual([]);
});

test("fullscreen fallback uses CSS zoom, preserves explicit sidebar and does not change normal startup", async () => {
  for (const options of [
    { isFullScreen: true, zoom: 1.25 },
    { isFullScreen: true, zoom: 1.25, sidebar: { visible: false, expandedWidth: 200 } },
    { isFullScreen: false, zoom: 1.25 },
  ]) {
    let fullScreen = false, frameReads = 0, writes = 0;
    const win = {
      getFrame: () => { frameReads++; return { x: 0, y: 0, width: fullScreen ? 1512 : 1280, height: 800 }; },
      getPageZoom: () => options.zoom, isFullScreen: () => fullScreen, isMaximized: () => false,
      on: () => undefined, setFullScreen: (value: boolean) => { fullScreen = value; },
      maximize: () => undefined, setPageZoom: () => undefined, webview: { on: () => undefined },
    };
    const persistence = windowStateModule.createWindowStatePersistence(
      win as unknown as Parameters<typeof windowStateModule.createWindowStatePersistence>[0], options,
      { saveFrame: () => Promise.resolve(), saveFullScreen: () => Promise.resolve(), saveMaximized: () => Promise.resolve(),
        saveZoom: () => Promise.resolve(), saveSidebar: () => { writes++; return Promise.resolve(); } }
    );
    if (options.sidebar) {
      expect(persistence.getSidebar()).toEqual(options.sidebar);
      expect(frameReads).toBe(0);
    } else if (options.isFullScreen) {
      expect(persistence.getSidebar()).toEqual({ visible: true, expandedWidth: 204.8 });
      expect(frameReads).toBe(1);
      const sidebar = createSidebarLayout(
        () => Promise.resolve({ ok: true, layout: persistence.getSidebar() }),
        () => Promise.resolve({ ok: true }), 1512 / options.zoom * 0.2
      );
      await sidebar.initialize();
      expect(sidebarPixels(sidebar.getSnapshot().layout.expandedWidth, 1280 / options.zoom)).toBe(204.8);
    } else {
      expect(persistence.getSidebar()).toBeUndefined();
      expect(frameReads).toBe(0);
    }
    await persistence.flush(); expect(writes).toBe(0);
    const explicit = { visible: true, expandedWidth: 220 };
    const save = persistence.saveSidebar(explicit);
    await persistence.flush(); await save;
    expect(persistence.getSidebar()).toEqual(explicit);
    expect(writes).toBe(1);
  }
});

test("invalid fullscreen default geometry never becomes a sidebar record", async () => {
  for (const [width, zoom] of [[0, 1], [-1, 1], [NaN, 1], [Infinity, 1], [1280, 0], [1280, -1], [1280, NaN], [1280, Infinity], [1e9, 1]]) {
    let writes = 0;
    const win = {
      getFrame: () => ({ x: 0, y: 0, width, height: 800 }),
      getPageZoom: () => zoom, isFullScreen: () => true, isMaximized: () => false,
      on: () => undefined, setFullScreen: () => undefined, maximize: () => undefined,
      setPageZoom: () => undefined, webview: { on: () => undefined },
    };
    const persistence = windowStateModule.createWindowStatePersistence(
      win as unknown as Parameters<typeof windowStateModule.createWindowStatePersistence>[0], { isFullScreen: true, zoom },
      { saveFrame: () => Promise.resolve(), saveFullScreen: () => Promise.resolve(), saveMaximized: () => Promise.resolve(),
        saveZoom: () => Promise.resolve(), saveSidebar: () => { writes++; return Promise.resolve(); } }
    );
    expect(persistence.getSidebar()).toBeUndefined();
    await persistence.flush(); expect(writes).toBe(0);
  }
});

test("provides a flushable window-state persistence controller", () => {
  expect(
    (
      windowStateModule as typeof windowStateModule & {
        createWindowStatePersistence?: unknown;
      }
    ).createWindowStatePersistence
  ).toBeFunction();
});

test("flush forces debounced frame and zoom writes through one serial queue", async () => {
  const listeners = new Map<string, () => void>();
  const frame = { x: 1, y: 2, width: 800, height: 600 };
  const win = {
    getFrame: () => frame,
    getPageZoom: () => 1,
    isFullScreen: () => false,
    isMaximized: () => false,
    on: (event: string, listener: () => void) => listeners.set(event, listener),
    setFullScreen: () => undefined,
    maximize: () => undefined,
    setPageZoom: () => undefined,
    webview: { on: () => undefined },
  };
  let finishFrame: (() => void) | undefined;
  const frameGate = new Promise<void>((resolve) => {
    finishFrame = resolve;
  });
  const events: string[] = [];
  const create = windowStateModule.createWindowStatePersistence as unknown as (
    window: typeof win,
    options: { zoom?: number },
    dependencies: {
      saveFrame: (value: WindowFrame) => Promise<void>;
      saveFullScreen: (value: boolean) => Promise<void>;
      saveMaximized: (value: boolean) => Promise<void>;
      saveZoom: (value: number) => Promise<void>;
    }
  ) => { saveZoom(zoom: number): void; flush(): Promise<void> };
  const persistence = create(
    win,
    { zoom: 1 },
    {
      saveFrame: async () => {
        events.push("frame:start");
        await frameGate;
        events.push("frame:end");
      },
      saveFullScreen: () => Promise.resolve(),
      saveMaximized: () => Promise.resolve(),
      saveZoom: (zoom) => {
        events.push(`zoom:${zoom}`);
        return Promise.resolve();
      },
    }
  );

  listeners.get("move")?.();
  persistence.saveZoom(1.25);
  const flushed = persistence.flush();
  await Promise.resolve();
  await Promise.resolve();

  expect(events).toEqual(["frame:start"]);
  finishFrame?.();
  await flushed;
  expect(events).toEqual(["frame:start", "frame:end", "zoom:1.25"]);
});

test("reports the initial full-screen state and only subsequent changes", async () => {
  const listeners = new Map<string, () => void>();
  let fullScreen = false;
  const win = {
    getFrame: () => ({ x: 1, y: 2, width: 800, height: 600 }),
    getPageZoom: () => 1,
    isFullScreen: () => fullScreen,
    isMaximized: () => false,
    on: (event: string, listener: () => void) => listeners.set(event, listener),
    setFullScreen: (value: boolean) => {
      fullScreen = value;
    },
    maximize: () => undefined,
    setPageZoom: () => undefined,
    webview: { on: () => undefined },
  };
  const observed: boolean[] = [];
  const create = windowStateModule.createWindowStatePersistence as unknown as (
    window: typeof win,
    options: { onFullScreenChange: (value: boolean) => void },
    dependencies: {
      saveFrame: (value: WindowFrame) => Promise<void>;
      saveFullScreen: (value: boolean) => Promise<void>;
      saveMaximized: (value: boolean) => Promise<void>;
      saveZoom: (value: number) => Promise<void>;
    }
  ) => { flush(): Promise<void> };
  const persistence = create(
    win,
    { onFullScreenChange: (value) => observed.push(value) },
    {
      saveFrame: () => Promise.resolve(),
      saveFullScreen: () => Promise.resolve(),
      saveMaximized: () => Promise.resolve(),
      saveZoom: () => Promise.resolve(),
    }
  );

  expect(observed).toEqual([false]);
  listeners.get("resize")?.();
  expect(observed).toEqual([false]);

  fullScreen = true;
  listeners.get("resize")?.();
  expect(observed).toEqual([false, true]);

  fullScreen = false;
  listeners.get("resize")?.();
  expect(observed).toEqual([false, true, false]);
  await persistence.flush();
});
