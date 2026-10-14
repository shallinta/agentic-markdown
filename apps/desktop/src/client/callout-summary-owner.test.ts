import { expect, test } from "bun:test";

import { Text } from "@codemirror/state";

import {
  createCalloutSummaryOwner,
  type CalloutSummarySource,
  type CalloutSummaryWorker,
} from "./callout-summary-owner";
import {
  CALLOUT_SUMMARY_CONFIG,
  type CalloutSummaryRequest,
} from "./callout-summary-protocol";

class Clock {
  now = 0;
  tasks: { at: number; run: () => void; cancelled: boolean }[] = [];
  schedule = (run: () => void, delay: number) => {
    const task = { at: this.now + delay, run, cancelled: false };
    this.tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  };
  step() {
    const task = this.tasks
      .filter((t) => !t.cancelled)
      .sort((a, b) => a.at - b.at)[0];
    if (!task) return false;
    task.cancelled = true;
    this.now = task.at;
    task.run();
    return true;
  }
  drain() {
    let count = 0;
    while (this.step()) {
      if (++count > 10000) throw Error("Unbounded scheduling");
    }
    return count;
  }
}
class Worker implements CalloutSummaryWorker {
  onmessage: CalloutSummaryWorker["onmessage"] = null;
  onerror: CalloutSummaryWorker["onerror"] = null;
  onmessageerror: CalloutSummaryWorker["onmessageerror"] = null;
  request!: CalloutSummaryRequest;
  terminations = 0;
  postMessage(request: CalloutSummaryRequest) {
    this.request = request;
  }
  terminate() {
    this.terminations++;
  }
  response(definitions: unknown[] = ["!NOTE", "FOO"]) {
    const { requestId, documentId, revision, config } = this.request;
    return { requestId, documentId, revision, config, definitions };
  }
  complete(definitions?: unknown[]) {
    this.onmessage?.({ data: this.response(definitions) } as MessageEvent);
  }
}
function fixture() {
  const rawText = "\uFEFF> [!NOTE]\r\n> body";
  let source: CalloutSummarySource | null = {
    documentId: "doc",
    revision: 0,
    doc: Text.of(rawText.replaceAll("\r", "").split("\n")),
    rawText,
    identity: {},
    config: CALLOUT_SUMMARY_CONFIG,
  };
  const clock = new Clock();
  const workers: Worker[] = [];
  const owner = createCalloutSummaryOwner(
    () => source,
    () => {
      const worker = new Worker();
      workers.push(worker);
      return worker;
    },
    { schedule: clock.schedule }
  );
  return {
    owner,
    clock,
    workers,
    get: () => source!,
    set: (next: CalloutSummarySource | null) => {
      source = next;
    },
  };
}

test("callout owner is lazy, debounces 120ms and ignores same-version selection/viewport observations", () => {
  const f = fixture();
  f.owner.observe(false);
  expect(f.clock.step()).toBe(false);
  f.owner.observe(true);
  expect(f.owner.getSnapshot().status).toBe("waiting");
  for (let i = 0; i < 100; i++) f.owner.observe(true);
  f.clock.step();
  expect(f.clock.now).toBe(120);
  expect(f.workers).toHaveLength(1);
  expect(f.workers[0].request.text).toBe(f.get().rawText);
  expect(Object.keys(f.workers[0].request).sort()).toEqual([
    "config",
    "documentId",
    "requestId",
    "revision",
    "text",
  ]);
  f.workers[0].complete();
  expect(f.owner.getSnapshot().status).toBe("validating");
  f.clock.step();
  const ready = f.owner.getSnapshot();
  expect(ready.status).toBe("ready");
  if (ready.status === "ready") {
    expect([...ready.definitions]).toEqual(["!NOTE", "FOO"]);
    expect(f.owner.isCurrent(ready.definitions)).toBe(true);
  }
  for (let i = 0; i < 100; i++) f.owner.observe(true);
  expect(f.clock.drain()).toBe(0);
  expect(f.workers[0].terminations).toBe(1);
  f.owner.dispose();
});

test("callout source revision, Text, raw, document and session identity revoke late responses including ABA", () => {
  for (const key of [
    "revision",
    "doc",
    "rawText",
    "documentId",
    "identity",
  ] as const) {
    const f = fixture();
    const original = f.get();
    f.owner.observe(true);
    f.clock.step();
    const old = f.workers[0],
      late = old.onmessage!;
    const changed = { ...original };
    if (key === "revision") changed.revision++;
    if (key === "doc") changed.doc = Text.of(["different"]);
    if (key === "rawText") changed.rawText += " ";
    if (key === "documentId") changed.documentId = "other";
    if (key === "identity") changed.identity = {};
    f.set(changed);
    f.owner.observe(true);
    f.set(original);
    f.owner.observe(true);
    late({ data: old.response() } as MessageEvent);
    expect(f.owner.getSnapshot().status).toBe("waiting");
    expect(old.terminations).toBe(1);
    f.clock.step();
    f.workers[1].complete();
    f.clock.step();
    expect(f.owner.getSnapshot().status).toBe("ready");
    f.owner.dispose();
  }
});

test("callout null authority cancels at wait/running/validation/ready and can resume", () => {
  for (const stage of ["waiting", "running", "validating", "ready"] as const) {
    const f = fixture();
    const source = f.get();
    f.owner.observe(true);
    if (stage !== "waiting") f.clock.step();
    if (stage === "validating" || stage === "ready") f.workers[0].complete();
    if (stage === "ready") f.clock.step();
    f.set(null);
    f.owner.observe(true);
    expect(f.owner.getSnapshot().status).toBe("idle");
    expect(f.clock.drain()).toBe(0);
    f.set(source);
    f.owner.observe(true);
    f.clock.step();
    f.workers[f.workers.length - 1].complete();
    f.clock.step();
    expect(f.owner.getSnapshot().status).toBe("ready");
    f.owner.dispose();
  }
});

test("callout completion rechecks authority even before binding observes revocation", () => {
  const f = fixture();
  f.owner.observe(true);
  f.clock.step();
  f.set(null);
  f.workers[0].complete();
  expect(f.owner.getSnapshot().status).toBe("idle");
  expect(f.clock.drain()).toBe(0);
});

test("callout validates full definition set across tasks without truncation or selection starvation", () => {
  const f = fixture();
  f.owner.observe(true);
  f.clock.step();
  const definitions = Array.from({ length: 9000 }, (_, i) => `LABEL${i}`);
  definitions.push("SS".repeat(20000)); // Normalization can expand; no source-length cap.
  f.workers[0].complete(definitions);
  let tasks = 0;
  while (f.owner.getSnapshot().status === "validating") {
    for (let i = 0; i < 100; i++) f.owner.observe(true);
    expect(f.clock.step()).toBe(true);
    tasks++;
  }
  expect(tasks).toBeGreaterThan(5);
  const ready = f.owner.getSnapshot();
  expect(ready.status).toBe("ready");
  if (ready.status === "ready") {
    expect(ready.definitions.size).toBe(9001);
    expect(ready.definitions.has("LABEL8999")).toBe(true);
  }
  expect(f.workers).toHaveLength(1);
  f.owner.dispose();
});

test("callout rejects malformed envelopes and collection entries with explicit retry only", () => {
  for (const variant of [
    "config",
    "revision",
    "requestId",
    "documentId",
    "array",
    "null",
    "empty",
    "number",
    "error",
    "messageerror",
  ] as const) {
    const f = fixture();
    f.owner.observe(true);
    f.clock.step();
    const worker = f.workers[0];
    const response: Record<string, unknown> = worker.response();
    if (variant === "config" || variant === "documentId")
      response[variant] = "bad";
    if (variant === "revision" || variant === "requestId")
      response[variant] = 999;
    if (variant === "array") response.definitions = {};
    if (variant === "empty") response.definitions = [""];
    if (variant === "number") response.definitions = [42];
    if (variant === "error") worker.onerror?.({} as ErrorEvent);
    else if (variant === "messageerror")
      worker.onmessageerror?.({} as MessageEvent);
    else
      worker.onmessage?.({
        data: variant === "null" ? null : response,
      } as MessageEvent);
    f.clock.drain();
    expect(f.owner.getSnapshot().status).toBe("failed");
    for (let i = 0; i < 10; i++) f.owner.observe(true);
    expect(f.clock.drain()).toBe(0);
    expect(f.owner.retry()).toBe(true);
    f.clock.step();
    f.workers[1].complete([]);
    f.clock.step();
    expect(f.owner.getSnapshot().status).toBe("ready");
    expect(f.owner.retry()).toBe(false);
    f.owner.dispose();
  }
});

test("callout timeout fails and stops only its own worker", () => {
  const a = fixture(),
    b = fixture();
  a.owner.observe(true);
  b.owner.observe(true);
  a.clock.step();
  b.clock.step();
  a.clock.step();
  expect(a.clock.now).toBe(15120);
  expect(a.owner.getSnapshot().status).toBe("failed");
  expect(a.workers[0].terminations).toBe(1);
  expect(b.workers[0].terminations).toBe(0);
  b.workers[0].complete();
  b.clock.step();
  expect(b.owner.getSnapshot().status).toBe("ready");
  a.owner.dispose();
  b.owner.dispose();
});

test("callout viewport loss/disposal cancels continuation and cannot publish or restart", () => {
  for (const disposed of [false, true]) {
    const f = fixture();
    f.owner.observe(true);
    f.clock.step();
    const late = f.workers[0].onmessage!;
    f.workers[0].complete(Array.from({ length: 9000 }, (_, i) => `L${i}`));
    f.clock.step();
    if (disposed) f.owner.dispose();
    else f.owner.observe(false);
    late({ data: f.workers[0].response() } as MessageEvent);
    expect(f.clock.drain()).toBe(0);
    expect(f.owner.getSnapshot().status).toBe("idle");
    expect(f.owner.retry()).toBe(false);
    if (disposed) {
      f.owner.observe(true);
      expect(f.clock.drain()).toBe(0);
    }
    f.owner.dispose();
  }
});

test("callout notifications can revoke authority reentrantly without resurrecting scheduled work", () => {
  const f = fixture();
  f.owner.subscribe(() => {
    if (f.owner.getSnapshot().status === "running") f.owner.cancel();
  });
  f.owner.observe(true);
  f.clock.step();
  expect(f.workers).toHaveLength(0);
  expect(f.owner.getSnapshot().status).toBe("idle");
  expect(f.clock.drain()).toBe(0);
});

test("callout worker creation and post failure become recoverable failure", () => {
  const f = fixture(),
    clock = new Clock();
  for (const post of [false, true]) {
    const owner = createCalloutSummaryOwner(
      f.get,
      () => {
        if (!post) throw Error("factory");
        const worker = new Worker();
        worker.postMessage = () => {
          throw Error("post");
        };
        return worker;
      },
      { schedule: clock.schedule }
    );
    owner.observe(true);
    clock.drain();
    expect(owner.getSnapshot().status).toBe("failed");
    owner.dispose();
  }
});

test("callout reentrant source replacement schedules a single task and revocation leaves idle", () => {
  const f = fixture();
  f.owner.observe(true);
  f.owner.subscribe(() => {
    if (f.owner.getSnapshot().status === "idle") f.owner.observe(true);
  });
  f.set({ ...f.get(), revision: 1 });
  f.owner.observe(true);
  f.clock.step();
  expect(f.workers).toHaveLength(1);
  f.workers[0].complete();
  f.clock.step();
  expect(f.owner.getSnapshot().status).toBe("ready");
  expect(f.clock.drain()).toBe(0);
  f.owner.dispose();
  for (const revokeAt of ["waiting", "running", "validating"] as const) {
    const g = fixture();
    g.owner.subscribe(() => {
      if (g.owner.getSnapshot().status === revokeAt) g.set(null);
    });
    g.owner.observe(true);
    if (revokeAt !== "waiting") g.clock.step();
    if (revokeAt === "validating") g.workers[0].complete();
    expect(g.owner.getSnapshot().status).toBe("idle");
    expect(g.clock.drain()).toBe(0);
    g.owner.dispose();
  }
});
