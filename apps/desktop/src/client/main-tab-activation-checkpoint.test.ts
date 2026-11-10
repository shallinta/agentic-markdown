import { expect, test } from "bun:test";

import type { MainTabCheckpointRequest } from "../shared/main-tab-checkpoint";

import type { CleanPrimaryTabCapture } from "./documents";
import { attachMainTabActivationCheckpoint } from "./main-tab-activation-checkpoint";

type Activation = Pick<MainTabCheckpointRequest["tabs"][number], "documentId" | "handle">;
const committed = { protocolVersion: 1, status: "committed" };
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const tabs: MainTabCheckpointRequest["tabs"] = Array.from({ length: 3 }, (_, index) => ({
  handle: `00000000-0000-4000-8000-00000000000${index}`,
  documentId: `00000000-0000-4000-8000-00000000001${index}`,
  revision: 1,
  hash: "a".repeat(64),
  pinned: index === 0,
  mode: index === 1 ? "source" : "editing",
}));
const clean = (activeIndex: number, current = () => true): CleanPrimaryTabCapture =>
  ({ ok: true, tabs, activeIndex, current });

function fixture() {
  let listener: ((target: Activation) => void) | undefined;
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
    captureCleanPrimaryTabs() {
      state.calls++;
      return state.capture;
    },
  }, (request) => {
    requests.push(request);
    return state.send();
  }, () => state.scope, 0);
  return { state, requests, stop, activate(index: number) {
    state.capture = clean(index);
    listener?.(tabs[index]);
  }, emit(index: number) { listener?.(tabs[index]); } };
}

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

test("keeps one publication in flight and sends only the latest new intent afterward", async () => {
  const f = fixture();
  const first = Promise.withResolvers<unknown>();
  try {
    f.state.send = () => first.promise;
    f.activate(0);
    await turn();
    f.activate(1);
    f.activate(2);
    await turn();
    expect(f.requests.map(request => request.activeIndex)).toEqual([0]);
    expect(f.state.calls).toBe(1);
    f.state.send = () => Promise.resolve(committed);
    first.resolve(committed);
    await turn();
    await turn();
    expect(f.requests.map(request => request.activeIndex)).toEqual([0, 2]);
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
    expect(f.requests.map(request => request.activeIndex)).toEqual([0]);
    f.state.scope = {};
    f.activate(0);
    await turn();
    expect(f.requests.map(request => request.activeIndex)).toEqual([0, 0]);

    f.state.send = () => Promise.resolve({ protocolVersion: 1, status: "unknown" });
    f.activate(1);
    await turn();
    await turn();
    expect(f.requests.map(request => request.activeIndex)).toEqual([0, 0, 1]);
    f.state.send = () => Promise.resolve(committed);
    f.activate(0);
    await turn();
    expect(f.requests.map(request => request.activeIndex)).toEqual([0, 0, 1, 0]);
  } finally { f.stop(); }
});

test("disposal drops queued activation and ignores an outstanding publication", async () => {
  const f = fixture();
  const first = Promise.withResolvers<unknown>();
  f.state.send = () => first.promise;
  f.activate(0);
  await turn();
  f.activate(1);
  f.stop();
  first.resolve(committed);
  f.activate(2);
  await turn();
  await turn();
  expect(f.requests.map(request => request.activeIndex)).toEqual([0]);
  expect(f.state.calls).toBe(1);
});
