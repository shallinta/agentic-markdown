import { expect, test } from "bun:test";

import { READING_SEARCH_UNITS } from "./reading-search-dom";
import { readingHighlightRanges } from "./reading-search-highlight";
import {
  createReadingSearchOwner,
  type ReadingSearchWorker,
  type ReadingSearchState,
} from "./reading-search-owner";
import {
  projectReading,
  type ReadingLeaf,
  type ReadingProjection,
} from "./reading-search-projection";
import { createReadingSearchRegistry } from "./reading-search-registry";
import { createSearchEngine } from "./source-search-engine";
import type { SearchRequest, SearchResult } from "./source-search-protocol";
import { createSearchStore } from "./source-search-store";

const wait = () => new Promise((resolve) => setTimeout(resolve, 25));
const last = <T>(values: T[]) => values[values.length - 1];
function fixture(content = "x x x", pre = false) {
  let reads = 0,
    current = true;
  const text = {
    nodeType: 3,
    length: content.length,
    get data() {
      reads++;
      return content;
    },
    nextSibling: null,
  } as unknown as Text;
  const root = {
    nodeType: 1,
    tagName: pre ? "PRE" : "DIV",
    isConnected: true,
    firstChild: text,
    nextSibling: null,
    parentElement: null,
    classList: { contains: () => false },
    getAttribute: () => null,
    contains: () => true,
    getBoundingClientRect: () => ({ top: 0, bottom: 100 }),
  } as unknown as HTMLElement;
  Object.defineProperty(text, "parentElement", { value: root });
  const registry = createReadingSearchRegistry();
  registry.mount(root, { kind: "block", id: 0 });
  const states: ReadingSearchState[] = [];
  let completed: (result: SearchResult) => void = () => undefined;
  class Fake implements ReadingSearchWorker {
    onmessage: ReadingSearchWorker["onmessage"] = null;
    onerror: ReadingSearchWorker["onerror"] = null;
    onmessageerror: ReadingSearchWorker["onmessageerror"] = null;
    requests: unknown[] = [];
    closed = 0;
    projection: ReadingProjection | undefined;
    engine = createSearchEngine(READING_SEARCH_UNITS);
    initialized = false;
    postMessage(value: unknown) {
      this.requests.push(value);
    }
    terminate() {
      this.closed++;
    }
    reply() {
      const request = this.requests.shift() as
        | SearchRequest
        | { kind: "prepare"; epoch: string; leaves: ReadingLeaf[] };
      if (request.kind === "prepare") {
        const job = projectReading(request.leaves, READING_SEARCH_UNITS);
        let next = job.next();
        while (!next.done) next = job.next();
        this.projection = next.value;
        this.onmessage?.({
          data: {
            kind: "prepared",
            epoch: request.epoch,
            length: next.value.text.length,
            runs: next.value.runs,
          },
        } as MessageEvent<unknown>);
      } else {
        const full =
          request.kind === "scan" && !this.initialized
            ? {
                ...request,
                text: this.projection!.text,
                boundaries: this.projection!.boundaries,
              }
            : request;
        if (request.kind === "scan") this.initialized = true;
        this.onmessage?.({ data: this.engine(full) } as MessageEvent<unknown>);
      }
    }
  }
  const workers: Fake[] = [];
  const owner = createReadingSearchOwner(
    root,
    registry,
    () => current,
    () => {
      const w = new Fake();
      workers.push(w);
      return w;
    },
    (s) => states.push(s),
    (result) => completed(result)
  );
  const options = { query: "x", caseSensitive: false, wholeWord: false };
  return {
    root,
    text,
    registry,
    workers,
    states,
    owner,
    options,
    onCompleted: (callback: typeof completed) => {
      completed = callback;
    },
    reads: () => reads,
    freeze: () => {
      current = false;
    },
  };
}
test("actual owner refines a 6000-line block before requesting its late visible matches", async () => {
  const f = fixture("x\n".repeat(6000), true);
  let calls = 0;
  Object.assign(f.root, {
    getBoundingClientRect: () => ({ top: 0, bottom: 120000 }),
    ownerDocument: {
      createRange() {
        let start = 0,
          end = 0;
        return {
          setStart: (_: Text, offset: number) => {
            start = offset;
          },
          setEnd: (_: Text, offset: number) => {
            end = offset;
          },
          getBoundingClientRect: () => {
            calls++;
            return {
              top: Math.floor(start / 2) * 20,
              bottom: Math.ceil(end / 2) * 20,
            };
          },
        };
      },
    },
  });
  f.owner.update(f.options, null, true);
  await wait();
  const w = f.workers[0];
  w.reply();
  w.reply();
  expect(last(f.states)?.result?.count).toBe(6000);
  f.owner.viewport({
    getBoundingClientRect: () => ({ top: 110000, bottom: 110400 }),
  } as HTMLElement);
  expect((w.requests[0] as { from: number }).from).toBeGreaterThan(10000);
  w.reply();
  const result = last(f.states)?.result;
  expect(result?.ranges[0]).toBeGreaterThan(10000);
  expect(result?.count).toBe(6000);
  expect(calls).toBeLessThanOrEqual(64);
  // Actual collector adds leading/trailing boundaries. Fully visible trailing
  // side must not probe a collapsed range at the last structural boundary.
  expect(w.projection?.runs[0].kind).toBe("boundary");
  expect(last(w.projection!.runs).kind).toBe("boundary");
  calls = 0;
  f.owner.viewport({
    getBoundingClientRect: () => ({ top: 119500, bottom: 120200 }),
  } as HTMLElement);
  w.reply();
  const bottom = last(f.states)?.result;
  expect(bottom?.ranges[0]).toBeGreaterThan(11000);
  // Root and PRE each contribute a typed leading separator (two units).
  expect(bottom?.ranges[bottom.ranges.length - 2]).toBe(12000);
  expect(bottom?.limited).toBe(false);
  expect(calls).toBeLessThanOrEqual(64);
  f.owner.dispose();
});
test("fully visible owned block keeps its structural boundaries without geometry probes", async () => {
  const f = fixture();
  f.owner.update(f.options, null, true);
  await wait();
  const w = f.workers[0];
  w.reply();
  w.reply();
  // No ownerDocument/createRange seam: a probe would fail and mark limited.
  f.owner.viewport(f.root);
  w.reply();
  expect(last(f.states)?.result?.limited).toBe(false);
  expect(last(f.states)?.result?.ranges.length).toBe(6);
  f.owner.dispose();
});
test("coarse geometry fallback only reports highlight limitation when worker actually truncates", async () => {
  for (const count of [3, 3000]) {
    const f = fixture("x ".repeat(count));
    Object.assign(f.root, {
      getBoundingClientRect: () => ({ top: -1000, bottom: 2000 }),
    });
    f.owner.update(f.options, null, true);
    await wait();
    const w = f.workers[0];
    w.reply();
    w.reply();
    // Clipped sides, deliberately absent Range API => conservative full block.
    f.owner.viewport({
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
    } as HTMLElement);
    w.reply();
    expect(last(f.states)?.result?.count).toBe(count);
    expect(last(f.states)?.result?.limited).toBe(count > 2048);
    f.owner.dispose();
  }
});
test("production range resolution failure invalidates owner and cannot be overwritten by late ready; explicit retry works", async () => {
  const f = fixture();
  f.onCompleted((result) => {
    try {
      readingHighlightRanges(result, () => null);
    } catch {
      f.owner.rejectPresentation();
    }
  });
  f.owner.update(f.options, null, true);
  await wait();
  const w = f.workers[0],
    late = w.onmessage!;
  w.reply();
  w.reply();
  expect(last(f.states)?.status).toBe("failed");
  expect(w.closed).toBe(1);
  late({ data: { kind: "viewport", id: 99 } } as MessageEvent<unknown>);
  f.owner.update(f.options, null, true);
  await wait();
  expect(last(f.states)?.status).toBe("failed");
  expect(f.workers).toHaveLength(1);
  f.onCompleted(() => undefined);
  f.owner.retry();
  await wait();
  f.workers[1].reply();
  f.workers[1].reply();
  expect(last(f.states)?.status).toBe("ready");
  f.owner.dispose();
});
test("real owner caches DOM/projection for query changes and bounds one in-flight search", async () => {
  const f = fixture();
  f.owner.update(f.options, null, true);
  await wait();
  expect(f.reads()).toBe(1);
  const w = f.workers[0];
  w.reply();
  w.reply();
  expect(last(f.states)?.result?.count).toBe(3);
  f.owner.update({ ...f.options, query: "xx" }, null, true);
  f.owner.update({ ...f.options, query: "x x" }, null, true);
  expect(w.requests).toHaveLength(1);
  w.reply();
  expect(w.requests).toHaveLength(1);
  w.reply();
  expect(last(f.states)?.result?.count).toBe(1);
  expect(f.reads()).toBe(1);
  expect(f.workers).toHaveLength(1);
  f.owner.viewport(f.root);
  const viewport = w.requests[0] as SearchRequest;
  expect(viewport.kind).toBe("viewport");
  if (viewport.kind === "viewport")
    expect(viewport.to).toBe(w.projection!.text.length);
  w.reply();
  f.owner.dispose();
  expect(w.closed).toBe(1);
});
test("presentation invalidates old results immediately; unchanged owned block reuses its Text snapshot", async () => {
  const f = fixture();
  f.owner.update(f.options, null, true);
  await wait();
  const old = f.workers[0];
  old.reply();
  old.reply();
  const anchor = f.owner.anchor(last(f.states).result!.current![0]);
  expect(anchor?.segment).toBe("0/0");
  f.owner.update(f.options, anchor, true);
  // An unrelated private registration changes generation, not this block.
  f.registry.mount({ parentElement: null } as HTMLElement, {
    kind: "image",
    alt: null,
  });
  expect(last(f.states)?.result).toBeNull();
  expect(old.closed).toBe(1);
  await wait();
  const next = f.workers[1];
  next.reply();
  next.reply();
  expect(f.reads()).toBe(1);
  expect(f.owner.anchor(last(f.states).result!.current![0])?.segment).toBe(
    "0/0"
  );
  f.owner.dispose();
});
test("currentness and dispose reject captured stale callbacks, closing does not save source coordinates", async () => {
  const f = fixture();
  f.owner.update(f.options, null, true);
  await wait();
  const w = f.workers[0],
    late = w.onmessage;
  f.freeze();
  f.owner.update(f.options, null, true);
  const count = f.states.length;
  late?.({
    data: { kind: "prepared", epoch: "1", length: 0, runs: [] },
  } as MessageEvent<unknown>);
  expect(f.states).toHaveLength(count);
  expect(w.closed).toBe(1);
  f.owner.dispose();
  const store = createSearchStore();
  const segment = "0/0";
  store.set("a", {
    position: 12,
    readingPosition: { segment, offset: 3, content: {} },
  });
  expect(store.get("a").position).toBe(12);
  expect(store.get("a").readingPosition?.segment).toBe(segment);
  store.set("a", { query: "new" });
  expect(store.get("a").position).toBeNull();
  expect(store.get("a").readingPosition).toBeNull();
});

test("semantic segment anchor survives reading remount and prior image alt disappearance", async () => {
  const f = fixture();
  const alt = {
    nodeType: 3,
    length: 9,
    data: "x x x x x",
    nextSibling: null,
  } as unknown as Text;
  const image = {
    nodeType: 1,
    tagName: "SPAN",
    firstChild: alt,
    nextSibling: f.text,
    parentElement: f.root,
    classList: { contains: (c: string) => c === "reading-image" },
    getAttribute: () => null,
  } as unknown as HTMLElement;
  Object.defineProperty(f.root, "firstChild", {
    value: image,
    configurable: true,
  });
  f.registry.mount(image, {
    kind: "image",
    alt: alt as unknown as HTMLElement,
  });
  f.owner.update(f.options, null, true);
  await wait();
  const w = f.workers[0];
  w.reply();
  w.reply();
  f.owner.navigate(-1);
  w.reply();
  const anchor = f.owner.anchor(last(f.states).result!.current![0]);
  expect(anchor).toEqual({ segment: "0/1", offset: 4 });
  f.owner.update(f.options, anchor, true);
  f.registry.mount(image, { kind: "image", alt: null });
  await wait();
  const replacement = f.workers[1];
  replacement.reply();
  replacement.reply();
  expect(last(f.states).result!.index).toBe(2);
  f.owner.dispose();
  const g = fixture();
  g.owner.update(g.options, { segment: "0/0", offset: 4 }, true);
  await wait();
  g.workers[0].reply();
  g.workers[0].reply();
  expect(last(g.states).result!.index).toBe(2);
  g.owner.dispose();
});

test("last scroll viewport is coalesced while an older viewport is in flight", async () => {
  const f = fixture();
  f.owner.update(f.options, null, true);
  await wait();
  const worker = f.workers[0];
  worker.reply();
  worker.reply();
  f.owner.viewport(f.root);
  const before = f.states.length;
  const below = {
    getBoundingClientRect: () => ({ top: 1000, bottom: 1100 }),
  } as HTMLElement;
  f.owner.viewport(below);
  f.owner.viewport(below);
  expect(worker.requests).toHaveLength(1);
  worker.reply();
  expect(worker.requests).toHaveLength(1);
  expect(f.states).toHaveLength(before);
  const queued = worker.requests[0] as SearchRequest;
  expect(queued.kind).toBe("viewport");
  if (queued.kind === "viewport") expect(queued.from).toBe(queued.to);
  worker.reply();
  expect(worker.requests).toHaveLength(0);
  expect(last(f.states)?.result?.kind).toBe("viewport");
  f.owner.dispose();
});
