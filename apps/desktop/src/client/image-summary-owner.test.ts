import { expect, test } from "bun:test";

import { Text } from "@codemirror/state";

import { summarizeImages } from "./image-summary";
import {
  createImageSummaryOwner,
  type ImageSummaryIdentity,
  type ImageSummaryWorker,
} from "./image-summary-owner";
import type { ImageSummaryRequest } from "./image-summary-protocol";
function fixture() {
  let current: ImageSummaryIdentity | null = {
    documentId: "doc",
    revision: 1,
    doc: Text.of(["![a](a.png)"]),
    rawText: "![a](a.png)",
    identity: {},
  };
  const tasks: { fn: () => void; ms: number; cancelled: boolean }[] = [],
    workers: ImageSummaryWorker[] = [],
    requests: ImageSummaryRequest[] = [];
  let stops = 0,
    notifies = 0;
  const owner = createImageSummaryOwner(
    () => current,
    () => {
      const w: ImageSummaryWorker = {
        onmessage: null,
        onerror: null,
        onmessageerror: null,
        postMessage: (r) => {
          requests.push(r);
        },
        terminate: () => {
          stops++;
        },
      };
      workers.push(w);
      return w;
    },
    () => {
      notifies++;
    },
    (fn, ms) => {
      const task = { fn, ms, cancelled: false };
      tasks.push(task);
      return () => {
        task.cancelled = true;
      };
    }
  );
  const step = (ms: number) => {
    const task = tasks.find((t) => t.ms === ms && !t.cancelled);
    expect(task).toBeDefined();
    task!.cancelled = true;
    task!.fn();
  };
  const reply = () => {
    const request = requests[requests.length - 1];
    workers[workers.length - 1].onmessage?.({
      data: { ...request, summary: summarizeImages(request.text) },
    } as MessageEvent);
  };
  return {
    owner,
    tasks,
    workers,
    requests,
    step,
    reply,
    get current() {
      return current;
    },
    set current(value) {
      current = value;
    },
    stops: () => stops,
    notifies: () => notifies,
  };
}
test("selection observations do not postpone quiet timer or start a second worker", () => {
  const f = fixture();
  f.owner.observe(true);
  for (let i = 0; i < 100; i++) f.owner.observe(true);
  expect(f.tasks.filter((t) => !t.cancelled && t.ms === 120)).toHaveLength(1);
  f.step(120);
  f.reply();
  expect(f.owner.getSnapshot().status).toBe("ready");
  f.owner.observe(true);
  expect(f.requests).toHaveLength(1);
  expect(f.stops()).toBe(1);
  f.owner.dispose();
});
test("session ABA, raw changes and revoked composition authority reject late result", () => {
  for (const change of ["session", "raw", "blocked"]) {
    const f = fixture();
    f.owner.observe(true);
    f.step(120);
    const callback = f.workers[0].onmessage!,
      request = f.requests[0];
    f.current =
      change === "blocked"
        ? null
        : {
            ...f.current!,
            ...(change === "session"
              ? { identity: {} }
              : { rawText: "changed" }),
          };
    callback({
      data: { ...request, summary: summarizeImages(request.text) },
    } as MessageEvent);
    expect(f.owner.getSnapshot().status).toBe("idle");
    expect(f.owner.isCurrent()).toBe(false);
    f.owner.dispose();
  }
});
test("failure is stable until explicit retry and disposal cancels active worker", () => {
  const f = fixture();
  f.owner.observe(true);
  f.step(120);
  f.step(15000);
  expect(f.owner.getSnapshot().status).toBe("failed");
  f.owner.observe(true);
  expect(f.requests).toHaveLength(1);
  f.owner.retry();
  f.step(120);
  expect(f.requests).toHaveLength(2);
  f.reply();
  expect(f.owner.getSnapshot().status).toBe("ready");
  f.owner.dispose();
  expect(f.owner.getSnapshot().status).toBe("idle");
});
test("two owners do not cancel one another", () => {
  const a = fixture(),
    b = fixture();
  a.owner.observe(true);
  b.owner.observe(true);
  a.step(120);
  b.step(120);
  a.owner.dispose();
  b.reply();
  expect(b.owner.getSnapshot().status).toBe("ready");
  expect(a.stops()).toBe(1);
  b.owner.dispose();
});
test("cancelled old timer cannot clear or start the new generation", () => {
  const f = fixture();
  f.owner.observe(true);
  const old = f.tasks[0].fn;
  f.current = { ...f.current!, identity: {} };
  f.owner.observe(true);
  old();
  expect(f.owner.getSnapshot().status).toBe("waiting");
  f.step(120);
  expect(f.requests).toHaveLength(1);
  f.reply();
  expect(f.owner.getSnapshot().status).toBe("ready");
  f.owner.dispose();
});
