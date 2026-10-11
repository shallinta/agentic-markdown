import { expect, test } from "bun:test";

import { planReplaceAll } from "./source-replace-all";
import {
  createReplaceAllOwner,
  type AllSource,
  type AllWorker,
} from "./source-replace-all-owner";
import type {
  ReplaceAllRequest,
  ReplaceAllResult,
} from "./source-replace-all-protocol";

function setup(timeout = 15000) {
  let current: AllSource | null = {
    session: {},
    text: {},
    raw: "a a",
    length: 3,
    options: { query: "a", caseSensitive: true, wholeWord: false },
    replacement: "b",
  };
  const responses: ReplaceAllResult[] = [],
    statuses: string[] = [];
  class Worker implements AllWorker {
    onmessage: AllWorker["onmessage"] = null;
    onerror: AllWorker["onerror"] = null;
    onmessageerror: AllWorker["onmessageerror"] = null;
    request!: ReplaceAllRequest;
    closed = 0;
    postMessage(r: ReplaceAllRequest) {
      this.request = r;
    }
    terminate() {
      this.closed++;
    }
    reply() {
      this.onmessage?.({
        data: planReplaceAll(this.request),
      } as MessageEvent<unknown>);
    }
  }
  const workers: Worker[] = [];
  const owner = createReplaceAllOwner(
    () => {
      const w = new Worker();
      workers.push(w);
      return w;
    },
    () => current,
    (r) => responses.push(r),
    (s) => statuses.push(s),
    timeout
  );
  return {
    owner,
    workers,
    responses,
    statuses,
    get: () => current!,
    set: (s: AllSource | null) => {
      current = s;
    },
  };
}
test("independent one-operation owner handles result once and never queues duplicate writes", () => {
  const f = setup();
  expect(f.owner.start()).toBe(true);
  expect(f.owner.start()).toBe(false);
  const w = f.workers[0],
    late = w.onmessage!;
  w.reply();
  expect(f.responses).toHaveLength(1);
  expect(w.closed).toBe(1);
  late({ data: planReplaceAll(w.request) } as MessageEvent<unknown>);
  expect(f.responses).toHaveLength(1);
  expect(f.owner.running()).toBe(false);
  expect(f.owner.start()).toBe(true);
  expect(f.workers[1].request.id).toBe(2);
  f.owner.dispose();
  expect(f.workers[1].closed).toBe(1);
  expect(f.owner.start()).toBe(false);
});
test("synchronous observation invalidates raw-only/session/query/replacement and permission ABA permanently", () => {
  for (const change of [
    (s: AllSource) => ({ ...s, raw: "a\ra" }),
    (s: AllSource) => ({ ...s, session: {} }),
    (s: AllSource) => ({ ...s, text: {} }),
    (s: AllSource) => ({ ...s, options: { ...s.options, query: "b" } }),
    (s: AllSource) => ({ ...s, replacement: "c" }),
    () => null,
  ]) {
    const f = setup(),
      before = f.get();
    f.owner.start();
    const w = f.workers[0],
      late = w.onmessage!;
    f.set(change(before));
    f.owner.observe();
    f.set(before);
    late({ data: planReplaceAll(w.request) } as MessageEvent<unknown>);
    expect(w.closed).toBe(1);
    expect(f.responses).toHaveLength(0);
    expect(f.owner.running()).toBe(false);
    f.owner.dispose();
  }
});
test("composition cancel and unmount fence callbacks even when all final fields are unchanged", () => {
  const f = setup();
  f.owner.start();
  const w = f.workers[0],
    late = w.onmessage!;
  f.owner.cancel();
  late({ data: planReplaceAll(w.request) } as MessageEvent<unknown>);
  expect(f.responses).toHaveLength(0);
  f.owner.start();
  const second = f.workers[1],
    late2 = second.onmessage!;
  f.owner.dispose();
  late2({ data: planReplaceAll(second.request) } as MessageEvent<unknown>);
  expect(f.responses).toHaveLength(0);
  expect(second.closed).toBe(1);
});
test("malformed/errors/timeout release operation and allow explicit retry", async () => {
  for (const kind of ["message", "error", "messageerror"] as const) {
    const f = setup();
    f.owner.start();
    const w = f.workers[0];
    if (kind === "message")
      w.onmessage?.({ data: {} } as MessageEvent<unknown>);
    else if (kind === "error") w.onerror?.({} as ErrorEvent);
    else w.onmessageerror?.({} as MessageEvent<unknown>);
    expect(f.statuses[f.statuses.length - 1]).toBe("failed");
    expect(w.closed).toBe(1);
    expect(f.owner.start()).toBe(true);
    f.workers[1].reply();
    expect(f.responses).toHaveLength(1);
    f.owner.dispose();
  }
  const f = setup(5);
  f.owner.start();
  await new Promise((r) => setTimeout(r, 15));
  expect(f.statuses[f.statuses.length - 1]).toBe("failed");
  expect(f.workers[0].closed).toBe(1);
  f.owner.observe();
  expect(f.statuses[f.statuses.length - 1]).toBe("failed");
  f.set({ ...f.get(), replacement: "changed" });
  f.owner.observe();
  expect(f.statuses[f.statuses.length - 1]).toBe("idle");
  f.owner.dispose();
});
test("factory and postMessage exceptions fail closed", () => {
  const s = setup().get();
  for (const factory of [
    () => {
      throw Error("factory");
    },
    () => ({
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      terminate() {
        return undefined;
      },
      postMessage() {
        throw Error("send");
      },
    }),
  ]) {
    const statuses: string[] = [];
    const owner = createReplaceAllOwner(
      factory,
      () => s,
      () => {
        throw Error("must not receive");
      },
      (x) => statuses.push(x)
    );
    expect(owner.start()).toBe(false);
    expect(statuses).toEqual(["running", "failed"]);
    owner.dispose();
  }
});
