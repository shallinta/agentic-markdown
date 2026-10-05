import { afterEach, expect, test } from "bun:test";

import { createAutomaticObservation } from "./automatic-observation";
import type { DirectoryAcceptanceResult } from "./directory-acceptance";
import type { ReconciliationResult } from "./reconciliation";

type Options = Parameters<typeof createAutomaticObservation>[0];
const ROOT = "11111111-1111-4111-8111-111111111111";
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fixture(interval = 60_000) {
  const root: ReturnType<Options["list"]>[number] = {
    meta: {
      handle: ROOT,
      name: "fixture",
      displayPath: "/fixture",
      generation: 1,
      status: "complete",
      examined: 0,
      errors: 0,
      entries: 0,
      showHidden: false,
    },
    authorization: { path: "/fixture", directories: [] },
  };
  const controls = {
    roots: [root],
    dirty: false,
    canStart: true,
    wakes: 0,
    terminations: 0,
    close: (): Promise<unknown> => Promise.resolve({ bytes: 0 }),
    shutdown: (): Promise<unknown> => Promise.resolve({ bytes: 0 }),
    prepare: (): Promise<ReconciliationResult> =>
      Promise.resolve({
        ok: true,
        summary: {
          token: "candidate",
          root: ROOT,
          generation: 1,
          added: 1,
          removed: 0,
          replaced: 0,
          retainedHandles: [],
        },
      }),
    accept: (): Promise<DirectoryAcceptanceResult> =>
      Promise.resolve({
        status: "committed",
        root: ROOT,
        generation: 2,
      }),
    query: (): DirectoryAcceptanceResult => ({ status: "unknown" }),
    tick: undefined as undefined | (() => Promise<unknown>),
  };
  const calls: Record<string, unknown>[] = [];
  const prepares: string[] = [],
    releases: string[] = [],
    invalidations: (string | undefined)[] = [];
  const accepts: unknown[] = [],
    queries: unknown[] = [],
    issues: string[] = [];
  const reconciliation: Options["reconciliation"] = {
    prepare: (handle) => {
      prepares.push(handle);
      return controls.prepare();
    },
    accept: (operation) => {
      accepts.push(operation);
      return controls.accept();
    },
    query: (operation) => {
      queries.push(operation);
      return controls.query();
    },
    issue: (token) => {
      issues.push(token);
      return { session: "session", sequence: issues.length };
    },
    get: () => undefined,
    release: (token) => {
      releases.push(token);
    },
    invalidate: (handle) => {
      invalidations.push(handle);
    },
    bytes: () => 0,
    hasWork: () => false,
    step: () => Promise.resolve(),
    dispose: () => undefined,
  };
  const response = () => ({
    bytes: 100,
    queueBytes: 0,
    roots: [
      {
        key: calls.find((item) => item.op === "watchStart")?.key,
        status: "watching",
        dirty: controls.dirty,
      },
    ],
  });
  const observer = createAutomaticObservation({
    list: () => controls.roots,
    canStart: () => controls.canStart,
    budget: () => 2 * 1024 * 1024,
    reconciliation,
    interval,
    terminate: () => {
      controls.terminations++;
    },
    wake: () => {
      controls.wakes++;
    },
    call: async (request) => {
      calls.push(request);
      if (request.op === "watchTick")
        return controls.tick ? controls.tick() : response();
      if (request.op === "watchClose") return controls.close();
      if (request.op === "watchDispose") return controls.shutdown();
      return { bytes: 100 };
    },
  });
  disposers.push(() => observer.dispose());
  const initialize = async () => {
    await observer.step();
    await observer.step();
    await settle();
  };
  return {
    root,
    controls,
    calls,
    prepares,
    releases,
    invalidations,
    accepts,
    queries,
    issues,
    observer,
    initialize,
    response,
  };
}

test("timer only wakes owner; worker calls remain in explicit drain steps", async () => {
  const f = fixture(5);
  await Bun.sleep(20);
  expect(f.controls.wakes).toBeGreaterThan(0);
  expect(f.calls).toHaveLength(0);
  expect(f.observer.hasWork()).toBe(true);
  f.observer.dispose();
  const wakes = f.controls.wakes;
  await Bun.sleep(15);
  expect(f.controls.wakes).toBe(wakes);
});

test("manual priority prevents prepare; cancelled late prepare releases without accepting", async () => {
  const f = fixture();
  await f.initialize();
  f.controls.dirty = true;
  f.controls.canStart = false;
  await f.observer.step();
  expect(f.prepares).toHaveLength(0);
  const gate = Promise.withResolvers<ReconciliationResult>();
  const candidate = await f.controls.prepare();
  f.controls.prepare = () => gate.promise;
  f.controls.canStart = true;
  await f.observer.step();
  f.observer.cancel(ROOT);
  gate.resolve(candidate);
  await settle();
  expect(f.invalidations).toEqual([ROOT]);
  expect(f.releases).toEqual(["candidate"]);
  expect(f.issues).toHaveLength(0);
  expect(f.root.meta.observation).toBe("watching");
});

test("late failed prepare after manual cancellation cannot poison live observation", async () => {
  const f = fixture();
  await f.initialize();
  const gate = Promise.withResolvers<ReconciliationResult>();
  f.controls.prepare = () => gate.promise;
  f.controls.dirty = true;
  await f.observer.step();
  f.observer.cancel(ROOT);
  gate.reject(Error("cancelled transport"));
  await settle();
  expect(f.root.meta.observation).toBe("watching");
  expect(f.accepts).toHaveLength(0);
});

test("cancelled late accept cannot mark a live watcher limited", async () => {
  const f = fixture();
  await f.initialize();
  const gate = Promise.withResolvers<DirectoryAcceptanceResult>();
  f.controls.accept = () => gate.promise;
  f.controls.dirty = true;
  await f.observer.step();
  await settle();
  expect(f.accepts).toHaveLength(1);
  f.observer.cancel(ROOT);
  gate.resolve({ status: "unknown" });
  await settle();
  expect(f.root.meta.observation).toBe("watching");
  expect(f.releases).toEqual(["candidate"]);
});

test("unknown acceptance only queries original operation a bounded number of times", async () => {
  const f = fixture();
  await f.initialize();
  f.controls.accept = () => Promise.resolve({ status: "unknown" });
  f.controls.dirty = true;
  await f.observer.step();
  await settle();
  for (let i = 0; i < 10; i++) {
    await f.observer.step();
    await settle();
  }
  expect(f.accepts).toHaveLength(1);
  expect(f.issues).toHaveLength(1);
  expect(f.queries.length).toBeGreaterThan(0);
  expect(f.queries.length).toBeLessThanOrEqual(3);
  for (const query of f.queries) expect(query).toEqual(f.accepts[0]);
  expect(f.root.meta.observation).toBe("limited");
});

test("BUSY prepare retries on subsequent owner ticks without recursive wake or parallel prepare", async () => {
  const f = fixture();
  await f.initialize();
  f.controls.prepare = () => Promise.resolve({ ok: false, reason: "BUSY" });
  f.controls.dirty = true;
  for (let i = 1; i <= 4; i++) {
    await f.observer.step();
    await settle();
    expect(f.prepares).toHaveLength(i);
  }
  expect(f.controls.wakes).toBe(0);
  expect(f.issues).toHaveLength(0);
  expect(f.root.meta.observation).toBe("watching");
});

test("zero difference releases candidate without commit or self-trigger", async () => {
  const f = fixture();
  await f.initialize();
  const result = await f.controls.prepare();
  if (!result.ok) throw Error("fixture");
  result.summary.added = 0;
  f.controls.prepare = () => Promise.resolve(result);
  f.controls.dirty = true;
  await f.observer.step();
  await settle();
  f.controls.dirty = false;
  for (let i = 0; i < 5; i++) {
    await f.observer.step();
    await settle();
  }
  expect(f.prepares).toHaveLength(1);
  expect(f.releases).toEqual(["candidate"]);
  expect(f.accepts).toHaveLength(0);
  expect(f.controls.wakes).toBe(0);
});

test("BUSY accept releases candidate and only retries on a later owner tick", async () => {
  const f = fixture();
  await f.initialize();
  f.controls.accept = () =>
    Promise.resolve({ status: "rejected", reason: "BUSY" });
  f.controls.dirty = true;
  await f.observer.step();
  await settle();
  expect(f.accepts).toHaveLength(1);
  expect(f.releases).toHaveLength(1);
  await settle();
  expect(f.accepts).toHaveLength(1);
  await f.observer.step();
  await settle();
  expect(f.accepts).toHaveLength(2);
  expect(f.controls.wakes).toBe(0);
  expect(f.root.meta.observation).toBe("watching");
});

test("clear, hidden reset and dispose discard a late watchTick and retain cleanup", async () => {
  for (const action of ["clear", "hidden", "dispose"]) {
    const f = fixture();
    await f.initialize();
    const gate = Promise.withResolvers<unknown>();
    f.controls.tick = () => gate.promise;
    const late = {
      ...f.response(),
      roots: f.response().roots.map((row) => ({ ...row, dirty: true })),
    };
    const running = f.observer.step();
    if (action === "dispose") f.observer.dispose();
    else {
      if (action === "clear") f.controls.roots = [];
      else f.root.meta.showHidden = true;
      f.observer.cancel(ROOT, true);
    }
    gate.resolve(late);
    await running;
    await settle();
    expect(f.prepares).toHaveLength(0);
    expect(f.observer.hasCleanup()).toBe(true);
    await f.observer.step();
    expect(f.calls[f.calls.length - 1]?.op).toBe("watchClose");
    expect(f.observer.bytes()).toBe(0);
  }
});

test("close failures retain accounting and block polling or registration until confirmed close", async () => {
  const f = fixture(30);
  await f.initialize();
  f.controls.close = () => Promise.reject(Error("close failed"));
  f.observer.cancel(ROOT, true);
  await f.observer.step();
  const first = f.calls.length;
  expect(f.observer.bytes()).toBe(100);
  await f.observer.step();
  expect(f.calls).toHaveLength(first);
  f.observer.cancel(ROOT, true);
  f.controls.close = () => Promise.resolve({ bytes: 0, extra: true });
  await Bun.sleep(35);
  await f.observer.step();
  expect(f.observer.bytes()).toBe(100);
  expect(f.calls.filter((call) => call.op === "watchStart")).toHaveLength(1);
  expect(f.calls.filter((call) => call.op === "watchTick")).toHaveLength(1);
  f.controls.close = () => Promise.resolve({ bytes: 0 });
  await Bun.sleep(35);
  await f.observer.step();
  expect(f.observer.bytes()).toBe(0);
  await f.observer.step();
  expect(f.calls.filter((call) => call.op === "watchStart")).toHaveLength(2);
  expect(f.calls.filter((call) => call.op === "watchDispose")).toHaveLength(0);
});

test("three cumulative close failures escalate to shared disposal, or terminate on unconfirmed disposal", async () => {
  for (const fatal of [false, true]) {
    const f = fixture(20);
    await f.initialize();
    f.controls.close = () => Promise.reject(Error("close failed"));
    if (fatal) f.controls.shutdown = () => Promise.resolve({ bytes: 1 });
    f.observer.cancel(ROOT, true);
    for (let i = 0; i < 3; i++) {
      if (i) await Bun.sleep(25);
      f.observer.cancel(ROOT, true);
      await f.observer.step();
    }
    expect(f.calls.filter((call) => call.op === "watchClose")).toHaveLength(3);
    await f.observer.step();
    expect(f.calls.filter((call) => call.op === "watchDispose")).toHaveLength(
      1
    );
    expect(f.controls.terminations).toBe(fatal ? 1 : 0);
    expect(f.observer.bytes()).toBe(fatal ? 100 : 0);
    const count = f.calls.length;
    for (let i = 0; i < 4; i++) await f.observer.step();
    expect(f.calls).toHaveLength(count);
    f.observer.cancel(ROOT);
    await f.observer.step();
    expect(f.calls.filter((call) => call.op === "watchStart")).toHaveLength(
      fatal ? 1 : 2
    );
  }
});

test("pending tick reserves growth and settles only after real accounting is visible", async () => {
  const f = fixture();
  await f.initialize();
  const gate = Promise.withResolvers<unknown>();
  f.controls.tick = () => gate.promise;
  const running = f.observer.step();
  expect(f.observer.bytes()).toBe(2 * 1024 * 1024);
  let settled = false,
    settledBytes = -1;
  const waiting = f.observer.settle().then(() => {
    settled = true;
    settledBytes = f.observer.bytes();
  });
  await settle();
  expect(settled).toBe(false);
  gate.resolve({ ...f.response(), bytes: 321 });
  await waiting;
  await running;
  expect(settledBytes).toBe(321);
  expect(f.observer.bytes()).toBe(321);
});

test("preempt waits for cancelled preparation finally without poisoning state or accepting late payload", async () => {
  for (const reject of [false, true]) {
    const f = fixture();
    await f.initialize();
    const candidate = await f.controls.prepare();
    const gate = Promise.withResolvers<ReconciliationResult>();
    f.controls.prepare = () => gate.promise;
    f.controls.dirty = true;
    await f.observer.step();
    expect(f.observer.preempt()).toBe(true);
    let settled = false;
    const waiting = f.observer.settle().then(() => {
      settled = true;
    });
    await settle();
    expect(settled).toBe(false);
    if (reject) gate.reject(Error("cancelled"));
    else gate.resolve(candidate);
    await waiting;
    expect(f.accepts).toHaveLength(0);
    expect(f.root.meta.observation).toBe("watching");
    expect(f.observer.preempt()).toBe(false);
    expect(f.releases).toHaveLength(reject ? 0 : 1);
  }
});

test("disposed pending cleanup failure cannot restart polling or registration", async () => {
  const f = fixture();
  await f.initialize();
  const gate = Promise.withResolvers<unknown>();
  f.controls.close = () => gate.promise;
  f.observer.cancel(ROOT, true);
  const closing = f.observer.step();
  f.observer.dispose();
  gate.reject(Error("late close failed"));
  await closing;
  const count = f.calls.length;
  await f.observer.step();
  expect(f.calls).toHaveLength(count);
  expect(f.observer.bytes()).toBe(100);
  expect(f.observer.hasWork()).toBe(false);
});

test("invalid tick payload fails closed without admitting a candidate", async () => {
  for (const invalid of [
    null,
    { bytes: -1, queueBytes: 0, roots: [] },
    { bytes: 2 ** 22, queueBytes: 0, roots: [] },
    { bytes: 1.5, queueBytes: 0, roots: [] },
    { bytes: 0, queueBytes: -1, roots: [] },
    { bytes: 0, queueBytes: 0, roots: Array(33).fill({}) },
    {
      bytes: 0,
      queueBytes: 0,
      roots: [{ key: `${ROOT}:1`, status: "watching", dirty: "yes" }],
    },
    {
      bytes: 0,
      queueBytes: 0,
      roots: [{ key: `${ROOT}:1`, status: "complete", dirty: true }],
    },
    {
      bytes: 0,
      queueBytes: 0,
      roots: [{ key: "bad", status: "watching", dirty: true }],
    },
    {
      bytes: 0,
      queueBytes: 0,
      roots: [
        {
          key: `${ROOT}:1`,
          status: "watching",
          dirty: true,
          payload: "untrusted",
        },
      ],
    },
    {
      bytes: 0,
      queueBytes: 0,
      roots: Array(2).fill({
        key: `${ROOT}:1`,
        status: "watching",
        dirty: true,
      }),
    },
  ]) {
    const f = fixture();
    await f.initialize();
    f.controls.tick = () => Promise.resolve(invalid);
    await f.observer.step();
    await settle();
    expect(f.prepares).toHaveLength(0);
    expect(f.root.meta.observation).toBe("limited");
    expect(f.observer.hasCleanup()).toBe(true);
  }
});
