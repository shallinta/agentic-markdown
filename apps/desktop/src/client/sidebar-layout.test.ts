/* Async mock boundaries intentionally model RPC promises; Bun's rejects matcher is typed void. */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/await-thenable */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  createSidebarLayout,
  focusBeforeSidebarCollapse,
  sidebarPixels,
  sidebarLayoutPixels,
  SIDEBAR_PANEL_ID,
  scheduleSidebarRestore,
} from "./sidebar-layout";

test("public API wiring disables the group, not separator membership, when hidden or frozen", () => {
  // This guards the production call site against reintroducing the known
  // registration error; it does not emulate live DOM/AX subscription updates.
  const page = readFileSync(
    new URL("../app/page.tsx", import.meta.url),
    "utf8"
  );
  const group = (/<ResizablePanelGroup\b[\s\S]*?onPointerDownCapture=/.exec(page))?.[0];
  const separator = (/<ResizableHandle\b[\s\S]*?\/>/.exec(page))?.[0];
  expect(group).toContain(
    "disabled={!visible || !workspace.controller.canChangeReadingTheme()}"
  );
  expect(separator).toContain("inert={!visible}");
  expect(separator).toContain('display: "none"');
  expect(separator).not.toContain("disabled=");
});

test("Home collapse moves separator focus before hiding, but leaves editor focus alone", () => {
  const calls: unknown[] = [];
  const toggle = {
    focus: (options?: FocusOptions) => {
      calls.push(options);
    },
  };
  focusBeforeSidebarCollapse(0, { getAttribute: () => "separator" }, toggle);
  expect(calls).toEqual([{ preventScroll: true }]);
  focusBeforeSidebarCollapse(200, { getAttribute: () => "separator" }, toggle);
  focusBeforeSidebarCollapse(0, { getAttribute: () => "textbox" }, toggle);
  expect(calls.length).toBe(1);
});

test("deferred restore uses registered constraints and latest intent, canceled frame cannot override interaction", () => {
  let frame!: () => void;
  let max = 640,
    available = 1280;
  let intent = { visible: true, expandedWidth: 871 };
  const applied: (number | null)[] = [];
  const schedule = (callback: () => void) => {
    frame = callback;
    return 1;
  };
  const apply = (value: number | null) =>
    applied.push(value === null ? null : Math.min(max, value));
  const cancelled: number[] = [];
  scheduleSidebarRestore(
    () => intent,
    () => available,
    apply,
    schedule,
    (id) => {
      cancelled.push(id);
    }
  );
  expect(applied).toEqual([]);
  // The child registration and available size settle before the scheduled frame.
  max = 872;
  available = 1512;
  frame();
  expect(applied).toEqual([871]);
  const cleanup = scheduleSidebarRestore(
    () => intent,
    () => available,
    apply,
    schedule,
    (id) => {
      cancelled.push(id);
    }
  );
  const stale = frame;
  cleanup();
  stale();
  expect(applied).toEqual([871]);
  expect(cancelled).toEqual([1]);
  scheduleSidebarRestore(
    () => intent,
    () => available,
    apply,
    schedule,
    (id) => {
      cancelled.push(id);
    }
  );
  intent = { visible: false, expandedWidth: 910 };
  frame();
  expect(applied).toEqual([871, null]);
});

test("completed layout uses current percentages, not pre-commit panel DOM width", () => {
  const next = {
    [SIDEBAR_PANEL_ID]: 25.015637,
    content: 74.984363,
  };
  expect(sidebarLayoutPixels(next, 256 + 1023)).toBeCloseTo(319.95, 1);
  const width = sidebarLayoutPixels(next, 256 + 1023)!;
  expect(width).toBeGreaterThan(310);
  expect(sidebarPixels(width, 1280)).toBe(width);
  expect(
    sidebarLayoutPixels({ [SIDEBAR_PANEL_ID]: 0, content: 100 }, 1279)
  ).toBe(0);
  expect(sidebarLayoutPixels({}, 1279)).toBeUndefined();
});

const ok = { ok: true };
test("late initialization preserves active visibility but restores untouched width", async () => {
  let resolve!: (value: unknown) => void;
  const writes: unknown[] = [];
  const layout = createSidebarLayout(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
    async (value) => {
      writes.push(value);
      return ok;
    }
  );
  const initialized = layout.initialize();
  layout.toggle();
  expect(writes).toEqual([]);
  resolve({ ok: true, layout: { visible: true, expandedWidth: 380 } });
  await initialized;
  await layout.flush();
  expect(layout.getSnapshot().layout).toEqual({
    visible: false,
    expandedWidth: 380,
  });
  expect(writes).toEqual([{ visible: false, expandedWidth: 380 }]);
});
test("mount/read is idempotent, active resize wins and temporary clamps do not persist", async () => {
  let resolve!: (value: unknown) => void;
  let reads = 0;
  const writes: unknown[] = [];
  const layout = createSidebarLayout(
    () => {
      reads++;
      return new Promise((r) => {
        resolve = r;
      });
    },
    async (value) => {
      writes.push(value);
      return ok;
    }
  );
  const first = layout.initialize();
  expect(layout.initialize()).toBe(first);
  layout.userResize(410);
  resolve({ ok: true, layout: { visible: false, expandedWidth: 220 } });
  await first;
  expect(reads).toBe(1);
  expect(sidebarPixels(410, 500)).toBe(250);
  expect(sidebarPixels(410, 1400)).toBe(410);
  expect(layout.getSnapshot().layout).toEqual({
    visible: true,
    expandedWidth: 410,
  });
  expect(writes.length).toBe(1);
  layout.userResize(0);
  expect(layout.getSnapshot().layout).toEqual({
    visible: false,
    expandedWidth: 410,
  });
});
test("restoring hidden never writes defaults; bad input cannot become width", async () => {
  const writes: unknown[] = [];
  const layout = createSidebarLayout(
    async () => ({ ok: true, layout: { visible: false, expandedWidth: 360 } }),
    async (value) => {
      writes.push(value);
      return ok;
    }
  );
  await layout.initialize();
  layout.userResize(450, false);
  for (const value of [NaN, Infinity, -1]) layout.userResize(value);
  await layout.flush();
  expect(writes).toEqual([]);
  expect(layout.getSnapshot().layout).toEqual({
    visible: false,
    expandedWidth: 360,
  });
  expect(sidebarPixels(360, 100)).toBe(50);
});
test("flush awaits renderer intent, reports failure, then retries without changing current layout", async () => {
  let resolve!: (value: unknown) => void;
  let fail = true;
  const layout = createSidebarLayout(
    async () => ok,
    () =>
      fail
        ? Promise.resolve({ ok: false })
        : new Promise((r) => {
            resolve = r;
          })
  );
  await layout.initialize();
  layout.toggle();
  await expect(layout.flush()).rejects.toThrow("SIDEBAR_LAYOUT_NOT_SAVED");
  expect(layout.getSnapshot().error).toContain("保存");
  fail = false;
  const flush = layout.flush();
  await new Promise((r) => setTimeout(r, 0));
  let done = false;
  void flush.then(() => {
    done = true;
  });
  expect(done).toBe(false);
  resolve(ok);
  await flush;
  expect(layout.getSnapshot().error).toBeNull();
  expect(layout.getSnapshot().layout.visible).toBe(false);
});
test("older failure cannot overwrite newer success and failed initial read does not trap unchanged exit", async () => {
  let old!: (value: unknown) => void;
  let count = 0;
  const layout = createSidebarLayout(
    async () => ok,
    () =>
      ++count === 1
        ? new Promise((r) => {
            old = r;
          })
        : Promise.resolve(ok)
  );
  await layout.initialize();
  layout.toggle();
  layout.toggle();
  old({ ok: false });
  await layout.flush();
  expect(layout.getSnapshot().error).toBeNull();
  const failed = createSidebarLayout(
    async () => {
      throw Error();
    },
    async () => ok
  );
  await failed.flush();
  expect(failed.getSnapshot().error).toContain("读取失败");
});
