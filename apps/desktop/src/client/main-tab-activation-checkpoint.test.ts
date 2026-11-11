import { expect, test } from "bun:test";

import type { MainTabCheckpointRequest, MainTabSourceInput } from "../shared/main-tab-checkpoint";

import type { CleanPrimaryTabCapture, PrimaryTabLastClose } from "./documents";
import { attachMainTabActivationCheckpoint } from "./main-tab-activation-checkpoint";

type Activation = Pick<MainTabSourceInput, "documentId" | "handle">;
const committed = { protocolVersion: 1, status: "committed" };
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const tabs: readonly MainTabSourceInput[] = Array.from({ length: 3 }, (_, index) => ({
  handle: `00000000-0000-4000-8000-00000000000${index}`,
  documentId: `00000000-0000-4000-8000-00000000001${index}`,
  revision: 1,
  hash: "a".repeat(64),
  pinned: index === 0,
  mode: index === 1 ? "source" : "editing",
}));
const clean = (activeIndex: number, current = () => true): CleanPrimaryTabCapture =>
  ({ ok: true, tabs, activeIndex, current });

function fixture(settlementForRecord?: (target: Activation) => Promise<boolean> | undefined) {
  let listener: ((target: Activation) => void) | undefined;
  let layoutListener: ((target: Activation) => void) | undefined;
  let closeListener: ((intent: PrimaryTabLastClose) => void) | undefined;
  let pruneListener: ((intent: PrimaryTabLastClose) => void) | undefined;
  const requests: MainTabCheckpointRequest[] = [];
  const state = {
    capture: clean(0),
    calls: 0,
    scope: {} as object | undefined,
    send: (): Promise<unknown> => Promise.resolve(committed),
  };
  const stop = attachMainTabActivationCheckpoint({
    subscribeActivation(onActivate) {
      listener = onActivate;
      return () => { listener = undefined; };
    },
    subscribePrimaryTabLayoutChange(onLayout) {
      layoutListener = onLayout;
      return () => { layoutListener = undefined; };
    },
    subscribePrimaryTabLastClose(onClose) {
      closeListener = onClose;
      return () => { closeListener = undefined; };
    },
    subscribePrimaryTabNonLastClose(onClose) {
      pruneListener = onClose;
      return () => { pruneListener = undefined; };
    },
    captureCleanPrimaryTabs() {
      state.calls++;
      return state.capture;
    },
  }, (request) => {
    requests.push(request);
    return state.send();
  }, () => state.scope, { idleMs: 0, settlementForRecord });
  return { state, requests, stop, activate(index: number) {
    state.capture = clean(index);
    listener?.(tabs[index]);
  }, emit(index: number) { listener?.(tabs[index]); }, layout(index: number) { layoutListener?.(tabs[index]); },
  close(current = () => true) {
    state.capture = { ok: true, tabs: [], activeIndex: null, current: () => true };
    closeListener?.({ documentId: tabs[0].documentId, handle: tabs[0].handle, current });
  }, emitClose() { closeListener?.({ documentId: tabs[0].documentId, handle: tabs[0].handle, current: () => true }); },
    prune(index: number, current = () => true) {
      const { documentId, handle } = tabs[index];
      pruneListener?.({ documentId, handle, current });
    },
    sent: () => requests.map(request => "op" in request ? request.op : request.activeIndex),
    subscribed: () => !!listener || !!layoutListener || !!closeListener || !!pruneListener };
}

test("publishes multiple actual closes even while dirty survivors prevent full recording", async () => {
  const f = fixture();
  const first = Promise.withResolvers<unknown>();
  try {
    f.state.send = () => first.promise;
    f.activate(0);
    await turn();
    f.state.capture = { ok: false, reason: "unavailable" };
    f.prune(0);
    f.layout(1);
    f.prune(1);
    f.layout(2);
    expect(f.sent()).toEqual([0]);
    f.state.send = () => Promise.resolve(committed);
    first.resolve(committed);
    for (let index = 0; index < 4; index++) await turn();
    expect(f.requests.slice(1)).toEqual(tabs.slice(0, 2).map(({ documentId, handle }) =>
      ({ protocolVersion: 1, op: "prune", documentId, handle })));
  } finally { f.stop(); }
});

test("rejects a reopened tab and a retired workspace after waiting for recovery claim", async () => {
  const settlement = Promise.withResolvers<boolean>();
  const f = fixture(() => settlement.promise);
  let current = true;
  try {
    f.prune(0, () => current);
    expect(f.requests).toEqual([]);
    current = false;
    settlement.resolve(true);
    await turn();
    f.prune(1);
    f.state.scope = {};
    await turn();
    expect(f.requests).toEqual([]);
    f.prune(2);
    for (let index = 0; index < 3; index++) await turn();
    expect(f.sent()).toEqual(["prune"]);
  } finally { f.stop(); }
});

test("waits for user activation and captures only the latest activation in a burst", async () => {
  const f = fixture();
  try {
    await turn();
    expect(f.state.calls).toBe(0);
    f.activate(0);
    f.activate(1);
    f.activate(2);
    expect(f.requests).toHaveLength(0);
    await turn();
    expect(f.state.calls).toBe(1);
    expect(f.requests).toEqual([{ protocolVersion: 1, tabs, activeIndex: 2 }]);
  } finally { f.stop(); }
});

test("merges activation and layout while one publication is in flight", async () => {
  const f = fixture();
  const first = Promise.withResolvers<unknown>();
  try {
    f.state.send = () => first.promise;
    f.activate(0);
    await turn();
    f.activate(1);
    f.activate(2);
    const changed = [{ ...tabs[2], pinned: true, mode: "source" as const }, tabs[0], tabs[1]];
    f.state.capture = { ok: true, tabs: changed, activeIndex: 0, current: () => true };
    f.layout(2);
    await turn();
    expect(f.sent()).toEqual([0]);
    expect(f.state.calls).toBe(1);
    f.state.send = () => Promise.resolve(committed);
    first.resolve(committed);
    await turn();
    await turn();
    expect(f.requests[1]).toEqual({ protocolVersion: 1, tabs: changed, activeIndex: 0 });
    expect(f.requests).toHaveLength(2);
  } finally { f.stop(); }
});

test("layout changes send a clean checkpoint without activation and share failure and deduplication rules", async () => {
  const f = fixture();
  try {
    const changed = [{ ...tabs[0], mode: "source" as const }, tabs[2], tabs[1]];
    f.state.capture = { ok: true, tabs: changed, activeIndex: 0, current: () => true };
    f.layout(0);
    await turn();
    expect(f.requests).toEqual([{ protocolVersion: 1, tabs: changed, activeIndex: 0 }]);
    f.layout(0);
    await turn();
    expect(f.requests).toHaveLength(1);

    f.state.capture = { ok: false, reason: "unavailable" };
    f.layout(0);
    await turn();
    expect(f.requests).toHaveLength(1);

    f.state.capture = clean(0);
    f.state.send = () => Promise.resolve({ protocolVersion: 1, status: "unknown" });
    f.layout(0);
    await turn();
    await turn();
    expect(f.requests).toHaveLength(2);
  } finally { f.stop(); }
});

test("skips dirty, empty, mismatched, stale and unauthorized captures", async () => {
  const f = fixture();
  try {
    for (const capture of [
      { ok: false, reason: "unavailable" },
      { ok: true, tabs: [], activeIndex: null, current: () => true },
      clean(1),
      clean(0, () => false),
    ] as const) {
      f.state.capture = capture;
      f.emit(0);
      await turn();
    }
    expect(f.requests).toHaveLength(0);
    f.state.scope = undefined;
    f.activate(0);
    await turn();
    expect(f.state.calls).toBe(4);
    expect(f.requests).toHaveLength(0);
  } finally { f.stop(); }
});

test("deduplicates only confirmed content in the same workspace and never retries an unknown result", async () => {
  const f = fixture();
  try {
    f.activate(0);
    await turn();
    f.activate(0);
    await turn();
    expect(f.sent()).toEqual([0]);
    f.state.scope = {};
    f.activate(0);
    await turn();
    expect(f.sent()).toEqual([0, 0]);

    f.state.send = () => Promise.resolve({ protocolVersion: 1, status: "unknown" });
    f.activate(1);
    await turn();
    await turn();
    expect(f.sent()).toEqual([0, 0, 1]);
    f.state.send = () => Promise.resolve(committed);
    f.activate(0);
    await turn();
    expect(f.sent()).toEqual([0, 0, 1, 0]);
  } finally { f.stop(); }
});

test("disposal unsubscribes all triggers, drops queued layout and ignores an outstanding publication", async () => {
  const f = fixture();
  const first = Promise.withResolvers<unknown>();
  f.state.send = () => first.promise;
  f.activate(0);
  await turn();
  f.layout(0);
  f.stop();
  expect(f.subscribed()).toBe(false);
  first.resolve(committed);
  f.activate(2);
  f.layout(2);
  f.close();
  await turn();
  await turn();
  expect(f.sent()).toEqual([0]);
  expect(f.state.calls).toBe(1);
});

test("explicit last close replaces a queued record and sends only an empty intent without retry", async () => {
  const f = fixture();
  try {
    f.state.scope = undefined;
    f.state.send = () => Promise.resolve({ protocolVersion: 1, status: "unknown" });
    f.activate(0);
    f.close();
    await turn();
    await turn();
    expect(f.requests).toEqual([{ protocolVersion: 1, op: "clear" }]);
  } finally { f.stop(); }
});

test("nonempty, stale, or superseded last close cannot send clear", async () => {
  const f = fixture();
  try {
    f.emitClose();
    await turn();
    f.close(() => false);
    await turn();
    expect(f.sent()).toEqual([]);
    f.close();
    f.activate(1);
    await turn();
    expect(f.sent()).toEqual([1]);
  } finally { f.stop(); }
});

test("clear waits for an in-flight record and invalidates its deduplication baseline", async () => {
  const f = fixture();
  const first = Promise.withResolvers<unknown>();
  try {
    f.state.send = () => first.promise;
    f.activate(0);
    await turn();
    f.close();
    await turn();
    expect(f.sent()).toEqual([0]);
    f.state.send = () => Promise.resolve(committed);
    first.resolve(committed);
    await turn();
    await turn();
    expect(f.sent()).toEqual([0, "clear"]);
    f.activate(0);
    await turn();
    expect(f.sent()).toEqual([0, "clear", 0]);
  } finally { f.stop(); }
});
