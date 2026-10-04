/* Async adapters model the persisted-write boundary; Bun's rejects matcher is typed void. */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/await-thenable */
import { expect, mock, test } from "bun:test";

import type { BrowserWindow } from "electrobun/bun";

import { electrobunBunMock } from "../test-electrobun-mock";
await mock.module("electrobun/bun", () => electrobunBunMock);
const { createWindowStatePersistence } = await import("./window-state");

function fixture(
  saveSidebar: (value: {
    visible: boolean;
    expandedWidth: number;
  }) => Promise<void>
) {
  const listeners = new Map<string, () => void>();
  const writes: unknown[] = [];
  const win = {
    on: (name: string, fn: () => void) => listeners.set(name, fn),
    isFullScreen: () => false,
    isMaximized: () => false,
    getPageZoom: () => 1,
    getFrame: () => ({ x: 0, y: 0, width: 900, height: 700 }),
    webview: { on: () => undefined },
  } as unknown as BrowserWindow;
  return {
    writes,
    listeners,
    persistence: createWindowStatePersistence(
      win,
      {},
      {
        saveFrame: async (value) => {
          writes.push(value);
        },
        saveZoom: async (value) => {
          writes.push(value);
        },
        saveFullScreen: () => Promise.resolve(),
        saveMaximized: () => Promise.resolve(),
        saveSidebar,
      }
    ),
  };
}
test("sidebar coalesces desired metadata, flush serializes frame zoom and layout", async () => {
  const layouts: unknown[] = [];
  const f = fixture(async (value) => {
    layouts.push(value);
  });
  const first = f.persistence.saveSidebar({
    visible: true,
    expandedWidth: 320,
  });
  const second = f.persistence.saveSidebar({
    visible: false,
    expandedWidth: 410,
  });
  expect(f.persistence.getSidebar()).toEqual({
    visible: false,
    expandedWidth: 410,
  });
  f.listeners.get("move")?.();
  f.persistence.saveZoom(1.25);
  await f.persistence.flush();
  await Promise.all([first, second]);
  expect(layouts).toEqual([{ visible: false, expandedWidth: 410 }]);
  expect(f.writes.length).toBe(2);
  await Bun.sleep(320);
  expect(layouts.length).toBe(1);
});
test("zoom does not cancel pending sidebar timer", async () => {
  const layouts: unknown[] = [];
  const f = fixture(async (value) => {
    layouts.push(value);
  });
  const saved = f.persistence.saveSidebar({
    visible: true,
    expandedWidth: 333,
  });
  f.persistence.saveZoom(1.5);
  await saved;
  expect(layouts).toEqual([{ visible: true, expandedWidth: 333 }]);
  await f.persistence.flush();
});
test("failed sidebar write rejects acknowledgement and flush; subsequent retry can persist", async () => {
  let fail = true;
  const f = fixture(async () => {
    if (fail) throw Error("test failure");
  });
  const ack = expect(
    f.persistence.saveSidebar({ visible: false, expandedWidth: 300 })
  ).rejects.toThrow("test failure");
  await expect(f.persistence.flush()).rejects.toThrow("test failure");
  await ack;
  fail = false;
  const retried = f.persistence.saveSidebar({
    visible: true,
    expandedWidth: 300,
  });
  await f.persistence.flush();
  await retried;
  expect(f.persistence.getSidebar()?.visible).toBe(true);
});
