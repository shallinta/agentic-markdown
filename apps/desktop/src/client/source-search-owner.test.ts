import { expect, test } from "bun:test";

import { createSearchEngine } from "./source-search-engine";
import {
  createSearchOwner,
  type SearchWorker,
  type SearchSource,
  type SearchStatus,
} from "./source-search-owner";
import type { SearchRequest, SearchResult } from "./source-search-protocol";
import { createSearchStore } from "./source-search-store";

const wait = () => new Promise((resolve) => setTimeout(resolve, 120));
test("synchronous replacement ticket is unavailable during navigation and query change", async () => {
  const f = fixture();
  f.scan();
  expect(f.owner.ticket()).toBeNull();
  await wait();
  f.workers[0].reply();
  expect(f.owner.ticket()?.range).toEqual([0, 1]);
  const copy = f.owner.ticket()!;
  copy.range[0] = 99;
  expect(f.owner.ticket()?.range).toEqual([0, 1]);
  f.owner.navigate(1);
  expect(f.owner.ticket()).toBeNull();
  f.workers[0].reply();
  expect(f.owner.ticket()?.range).toEqual([2, 3]);
  f.setSource({ ...f.source()!, queryKey: "changed before React effect" });
  expect(f.owner.ticket()).toBeNull();
  f.owner.cancel();
  expect(f.owner.ticket()).toBeNull();
  f.owner.dispose();
});
test("replacement fields remain document-local and close releases them", () => {
  const store = createSearchStore();
  store.set("a", { replacement: "$1\n字", replaceOpen: true });
  store.set("b", { replacement: "b" });
  store.set("a", { query: "word" });
  expect(store.get("a").replacement).toBe("$1\n字");
  expect(store.get("b").replaceOpen).toBe(false);
  store.delete("a");
  expect(store.get("a").replacement).toBe("");
  expect(store.get("b").replacement).toBe("b");
});
function fixture() {
  let source: SearchSource | null = {
    session: {},
    textIdentity: {},
    raw: "a a a",
    length: 5,
    queryKey: "a",
  };
  const received: SearchResult[] = [],
    statuses: SearchStatus[] = [];
  class Fake implements SearchWorker {
    onmessage: SearchWorker["onmessage"] = null;
    onerror: SearchWorker["onerror"] = null;
    onmessageerror: SearchWorker["onmessageerror"] = null;
    requests: SearchRequest[] = [];
    closed = 0;
    engine = createSearchEngine();
    postMessage(request: SearchRequest) {
      this.requests.push(request);
    }
    terminate() {
      this.closed++;
    }
    reply() {
      const r = this.requests.shift()!;
      this.onmessage?.({ data: this.engine(r) } as MessageEvent<unknown>);
    }
  }
  const workers: Fake[] = [];
  const owner = createSearchOwner(
    () => {
      const w = new Fake();
      workers.push(w);
      return w;
    },
    () => source,
    (r) => received.push(r),
    (s) => statuses.push(s)
  );
  const scan = (query = "a") =>
    owner.scan({ query, caseSensitive: false, wholeWord: false }, 0);
  return {
    owner,
    workers,
    received,
    statuses,
    scan,
    setSource: (s: SearchSource | null) => {
      source = s;
    },
    source: () => source,
  };
}
test("debounced latest scan only; busy query terminates and stale callback cannot publish", async () => {
  const f = fixture();
  f.scan("x");
  f.scan("a");
  await wait();
  expect(f.workers).toHaveLength(1);
  const old = f.workers[0],
    late = old.onmessage!,
    request = old.requests[0];
  expect(request.kind === "scan" && request.options.query).toBe("a");
  f.scan("a a");
  expect(old.closed).toBe(1);
  await wait();
  late({ data: old.engine(request) } as MessageEvent<unknown>);
  expect(f.received).toHaveLength(0);
  f.workers[1].reply();
  expect(f.received[0].count).toBe(1);
  expect(f.statuses[f.statuses.length - 1]).toBe("ready");
  f.owner.dispose();
});
test("idle query reuses snapshot, no extra clone; selection-only identity does not rescan", async () => {
  const f = fixture();
  f.scan();
  await wait();
  f.workers[0].reply();
  f.scan("a a");
  await wait();
  expect(f.workers).toHaveLength(1);
  const request = f.workers[0].requests[0];
  expect(request.kind === "scan" && request.text).toBeUndefined();
  f.workers[0].reply();
  f.owner.viewport(0, 5);
  f.workers[0].reply();
  expect(f.received[f.received.length - 1]?.ranges).toEqual([0, 3]);
  f.owner.dispose();
});
test("session ABA and changed Text reject old scan/navigation results", async () => {
  for (const sessionOnly of [true, false]) {
    const f = fixture();
    f.scan();
    await wait();
    f.workers[0].reply();
    f.owner.navigate(1);
    const source = f.source()!;
    f.setSource({
      ...source,
      ...(sessionOnly ? { session: {} } : { textIdentity: {} }),
    });
    f.workers[0].reply();
    expect(f.received).toHaveLength(1);
    expect(f.statuses[f.statuses.length - 1]).toBe("idle");
    expect(f.workers[0].closed).toBe(1);
    f.owner.dispose();
  }
});
test("navigation latest-only and viewport queue bounded; cancel/dispose release", async () => {
  const f = fixture();
  f.scan();
  await wait();
  const w = f.workers[0];
  w.reply();
  f.owner.navigate(1);
  for (let i = 0; i < 20; i++) f.owner.navigate(1);
  f.owner.viewport(0, 5);
  expect(w.requests).toHaveLength(1);
  w.reply();
  expect(f.received).toHaveLength(1);
  expect(w.requests).toHaveLength(1);
  w.reply();
  expect(f.received[f.received.length - 1]?.index).toBe(0);
  f.owner.viewport(0, 5);
  const late = w.onmessage!,
    req = w.requests[0];
  f.owner.cancel();
  late({ data: w.engine(req) } as MessageEvent<unknown>);
  expect(f.received).toHaveLength(2);
  f.scan();
  f.owner.dispose();
  await wait();
  expect(f.workers).toHaveLength(1);
});
test("bad kind/schema produces failed not zero; explicit retry creates fresh worker", async () => {
  const f = fixture();
  f.scan();
  await wait();
  const w = f.workers[0];
  w.onmessage?.({
    data: { ...w.engine(w.requests[0]), kind: "navigate" },
  } as MessageEvent<unknown>);
  expect(f.received).toHaveLength(0);
  expect(f.statuses[f.statuses.length - 1]).toBe("failed");
  expect(w.closed).toBe(1);
  f.scan();
  await wait();
  f.workers[1].reply();
  expect(f.received[0].count).toBe(3);
  f.owner.dispose();
});
test("live query change fences old result before a UI effect schedules the next scan", async () => {
  const f = fixture();
  f.scan();
  await wait();
  f.setSource({ ...f.source()!, queryKey: "new-query-before-render" });
  f.workers[0].reply();
  expect(f.received).toHaveLength(0);
  expect(f.workers[0].closed).toBe(1);
  f.owner.dispose();
});
test("store is per-controller, conditions retained per document and released explicitly", () => {
  const a = createSearchStore(),
    b = createSearchStore();
  a.set("a", { query: "a\nb", open: true, position: 0 });
  a.set("b", { query: "other", wholeWord: true });
  expect(a.get("a").query).toBe("a\nb");
  expect(a.get("b").wholeWord).toBe(true);
  expect(b.get("a").query).toBe("");
  a.delete("a");
  expect(a.get("a").open).toBe(false);
  expect(a.get("b").query).toBe("other");
  a.clear();
  expect(a.get("b").query).toBe("");
});
test("worker error and messageerror terminate; late callbacks and dispose cannot publish", async () => {
  for (const key of ["onerror", "onmessageerror"] as const) {
    const f = fixture();
    f.scan();
    await wait();
    const w = f.workers[0];
    const callback = w[key] as (event: ErrorEvent) => void;
    callback({} as ErrorEvent);
    expect(w.closed).toBe(1);
    expect(f.statuses[f.statuses.length - 1]).toBe("failed");
    f.owner.dispose();
    callback({} as ErrorEvent);
    expect(w.closed).toBe(1);
  }
});
test("factory/post failures and timeout settle failed; a retry is explicit", async () => {
  for (const fault of ["factory", "post", "timeout"] as const) {
    const statuses: SearchStatus[] = [];
    let terminated = 0,
      calls = 0;
    const source = {
      session: {},
      textIdentity: {},
      raw: "a",
      length: 1,
      queryKey: "a",
    };
    const owner = createSearchOwner(
      () => {
        calls++;
        if (fault === "factory") throw Error("fixture");
        return {
          onmessage: null,
          onerror: null,
          onmessageerror: null,
          postMessage: () => {
            if (fault === "post") throw Error("fixture");
          },
          terminate: () => {
            terminated++;
          },
        };
      },
      () => source,
      () => {
        throw Error("unexpected result");
      },
      (s) => statuses.push(s),
      { delayMs: 0, timeoutMs: 5 }
    );
    owner.scan({ query: "a", caseSensitive: true, wholeWord: false }, 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(statuses[statuses.length - 1]).toBe("failed");
    expect(calls).toBe(1);
    expect(terminated).toBe(fault === "factory" ? 0 : 1);
    owner.scan({ query: "a", caseSensitive: true, wholeWord: false }, 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(2);
    owner.dispose();
  }
});
