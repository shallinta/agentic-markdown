import {
  collectReadingDom,
  READING_SEARCH_UNITS,
  type ReadingDomSnapshot,
  type ReadingBlockCache,
} from "./reading-search-dom";
import { refineReadingViewport } from "./reading-search-geometry";
import {
  readingPoint,
  type ReadingProjection,
  type ReadingRun,
} from "./reading-search-projection";
import type { ReadingSearchRegistry } from "./reading-search-registry";
import {
  validSearchResult,
  type SearchOptions,
  type SearchRequest,
  type SearchResult,
} from "./source-search-protocol";

export interface ReadingSearchWorker {
  postMessage(value: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}
export interface ReadingSearchState {
  status: "idle" | "preparing" | "running" | "ready" | "failed";
  result: SearchResult | null;
}
/** One mounted reading consumer, with its own cancellation/worker ownership. */
export function createReadingSearchOwner(
  root: HTMLElement,
  registry: ReadingSearchRegistry,
  current: () => boolean,
  factory: () => ReadingSearchWorker,
  notify: (state: ReadingSearchState) => void,
  completed: (result: SearchResult) => void
) {
  let worker: ReadingSearchWorker | undefined;
  let dom: ReadingDomSnapshot | undefined;
  let projection: ReadingProjection | undefined;
  let generation = 0,
    requestId = 0,
    latest = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let disposed = false,
    active = false;
  let options: SearchOptions = {
    query: "",
    caseSensitive: false,
    wholeWord: false,
  };
  let position: { segment: string; offset: number } | null = null;
  let queryKey = "";
  let sourceVersion = -1;
  let length = 0;
  let queuedNavigation = 0;
  let failureKey: string | undefined;
  let queuedViewport:
    { kind: "viewport"; from: number; to: number } | undefined;
  const pending = new Map<number, SearchRequest>();
  const blockCache = new WeakMap<HTMLElement, ReadingBlockCache>();
  const valid = (g = generation) =>
    !disposed &&
    active &&
    current() &&
    root.isConnected &&
    g === generation &&
    sourceVersion === registry.version;
  const clear = () => {
    generation++;
    clearTimeout(timer);
    clearTimeout(deadline);
    timer = deadline = undefined;
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
    }
    worker = undefined;
    dom = undefined;
    projection = undefined;
    pending.clear();
    queuedNavigation = 0;
    queuedViewport = undefined;
    queryKey = "";
  };
  const fail = () => {
    clear();
    failureKey = JSON.stringify(options);
    if (!disposed) notify({ status: "failed", result: null });
  };
  const send = (body: Omit<SearchRequest, "epoch" | "id">) => {
    if (!valid() || !worker || !projection) return;
    if (pending.size) return;
    const request = {
      ...body,
      epoch: String(generation),
      id: ++requestId,
    } as SearchRequest;
    latest = request.id;
    pending.set(request.id, request);
    clearTimeout(deadline);
    deadline = setTimeout(fail, 15000);
    try {
      worker.postMessage(request);
    } catch {
      fail();
    }
  };
  const scan = () => {
    if (!valid() || !projection) return;
    notify({ status: "running", result: null });
    if (pending.size) return;
    queryKey = JSON.stringify(options);
    const leaf = position && dom?.segmentIds.get(position.segment);
    let at = 0;
    if (typeof leaf === "number" && position) {
      let lo = 0,
        hi = projection.runs.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const run = projection.runs[mid];
        if (
          run.end.leaf < leaf ||
          (run.end.leaf === leaf && run.end.offset <= position.offset)
        )
          lo = mid + 1;
        else hi = mid;
      }
      const run = projection.runs[lo];
      if (run?.start.leaf === leaf)
        at =
          run.from +
          (run.kind === "linear"
            ? Math.max(
                0,
                Math.min(position.offset - run.start.offset, run.to - run.from)
              )
            : 0);
    }
    send({
      kind: "scan",
      options,
      position: at,
    } as Omit<SearchRequest, "epoch" | "id">);
  };
  const prepare = () => {
    clear();
    failureKey = undefined;
    sourceVersion = registry.version;
    if (!active || !current() || disposed) {
      notify({ status: "idle", result: null });
      return;
    }
    const g = generation;
    notify({ status: "preparing", result: null });
    const job = collectReadingDom(root, registry, blockCache);
    const step = () => {
      timer = undefined;
      if (!valid(g)) return;
      try {
        const next = job.next();
        if (!next.done) {
          timer = setTimeout(step, 0);
          return;
        }
        dom = next.value;
        const created = factory();
        worker = created;
        created.onerror = created.onmessageerror = () => {
          if (worker === created && valid(g)) fail();
        };
        created.onmessage = (event) => {
          if (worker !== created || !valid(g)) return;
          const data = event.data;
          if (
            data &&
            typeof data === "object" &&
            "kind" in data &&
            data.kind === "prepared"
          ) {
            const value = data as {
              epoch?: unknown;
              length?: unknown;
              runs?: unknown;
            };
            if (
              value.epoch !== String(g) ||
              !Number.isSafeInteger(value.length) ||
              typeof value.length !== "number" ||
              value.length < 0 ||
              value.length > READING_SEARCH_UNITS ||
              !Array.isArray(value.runs) ||
              value.runs.length > READING_SEARCH_UNITS
            ) {
              fail();
              return;
            }
            length = value.length;
            const runs = value.runs as ReadingRun[];
            let index = 0,
              end = 0;
            const validate = () => {
              timer = undefined;
              if (!valid(g) || worker !== created || !dom) return;
              for (let n = 0; index < runs.length && n < 128; n++, index++) {
                const run = runs[index];
                const endpoint = (point: ReadingRun["start"]) =>
                  !!point &&
                  Number.isSafeInteger(point.leaf) &&
                  Number.isSafeInteger(point.offset) &&
                  point.offset >= 0 &&
                  (run.kind === "boundary"
                    ? point.offset === 0
                    : !!dom!.texts.get(point.leaf) &&
                      point.offset <= dom!.texts.get(point.leaf)!.length);
                if (
                  !run ||
                  !Number.isSafeInteger(run.from) ||
                  !Number.isSafeInteger(run.to) ||
                  run.from !== end ||
                  run.to <= run.from ||
                  run.to > length ||
                  !["linear", "collapsed", "boundary"].includes(run.kind) ||
                  !endpoint(run.start) ||
                  !endpoint(run.end) ||
                  (run.kind === "linear" &&
                    (run.start.leaf !== run.end.leaf ||
                      run.end.offset - run.start.offset !== run.to - run.from))
                ) {
                  fail();
                  return;
                }
                end = run.to;
              }
              if (index < runs.length) {
                timer = setTimeout(validate, 0);
                return;
              }
              if (end !== length) {
                fail();
                return;
              }
              clearTimeout(deadline);
              projection = { text: "", runs, boundaries: [] };
              scan();
            };
            validate();
            return;
          }
          if (
            !data ||
            typeof data !== "object" ||
            !("id" in data) ||
            typeof data.id !== "number"
          ) {
            fail();
            return;
          }
          const request = pending.get(data.id);
          pending.delete(data.id);
          if (!request || data.id !== latest) return;
          if (!validSearchResult(data, request, length)) {
            fail();
            return;
          }
          clearTimeout(deadline);
          if (queryKey !== JSON.stringify(options)) {
            queuedNavigation = 0;
            scan();
            return;
          }
          if (queuedNavigation) {
            const direction = queuedNavigation;
            queuedNavigation = 0;
            send({ kind: "navigate", direction } as Omit<
              SearchRequest,
              "epoch" | "id"
            >);
            return;
          }
          const viewport = queuedViewport;
          queuedViewport = undefined;
          if (viewport && request.kind === "viewport") {
            send(viewport);
            return;
          }
          notify({ status: "ready", result: data });
          completed(data);
        };
        deadline = setTimeout(fail, 15000);
        created.postMessage({
          kind: "prepare",
          epoch: String(g),
          leaves: dom.leaves,
        });
      } catch {
        if (valid(g)) fail();
      }
    };
    timer = setTimeout(step, 0);
  };
  const release = registry.subscribe(() => {
    if (active) prepare();
  });
  return {
    update(
      next: SearchOptions,
      nextPosition: { segment: string; offset: number } | null,
      enabled: boolean
    ) {
      options = next;
      position = nextPosition;
      if (!enabled || !next.query || !current()) {
        active = false;
        clear();
        failureKey = undefined;
        notify({ status: "idle", result: null });
        return;
      }
      active = true;
      if (
        failureKey === JSON.stringify(options) &&
        sourceVersion === registry.version
      )
        return;
      if ((!worker && !timer) || sourceVersion !== registry.version) prepare();
      else if (projection && queryKey !== JSON.stringify(options)) scan();
    },
    retry: prepare,
    rejectPresentation: fail,
    anchor(offset: number): { segment: string; offset: number } | null {
      if (!valid() || !projection || !dom) return null;
      const point = readingPoint(projection, offset);
      const segment = point && dom.segments.get(point.leaf);
      return point && segment ? { segment, offset: point.offset } : null;
    },
    navigate(direction: number) {
      if (!valid() || !projection || (direction !== 1 && direction !== -1))
        return;
      if (pending.size) {
        queuedNavigation = Math.max(
          -READING_SEARCH_UNITS,
          Math.min(READING_SEARCH_UNITS, queuedNavigation + direction)
        );
        return;
      }
      send({ kind: "navigate", direction } as Omit<
        SearchRequest,
        "epoch" | "id"
      >);
    },
    viewport(scroller: HTMLElement) {
      if (!valid() || !projection || !dom) return;
      const bounds = scroller.getBoundingClientRect();
      // Ordered block geometry: binary search avoids scanning the whole DOM on scroll.
      let lo = 0,
        hi = dom.blocks.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (
          dom.blocks[mid].element.getBoundingClientRect().bottom <
          bounds.top - 200
        )
          lo = mid + 1;
        else hi = mid;
      }
      const startBlock = lo;
      const first = dom.blocks[lo]?.first ?? dom.leaves.length;
      hi = dom.blocks.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (
          dom.blocks[mid].element.getBoundingClientRect().top <=
          bounds.bottom + 200
        )
          lo = mid + 1;
        else hi = mid;
      }
      const last = lo > startBlock ? dom.blocks[lo - 1].last : first;
      const offset = (leaf: number) => {
        let a = 0,
          b = projection!.runs.length;
        while (a < b) {
          const m = (a + b) >>> 1;
          if (projection!.runs[m].end.leaf < leaf) a = m + 1;
          else b = m;
        }
        return projection!.runs[a]?.from ?? length;
      };
      let from = offset(first),
        to = offset(last);
      if (lo > startBlock && from < to) {
        const g = generation;
        const point = (at: number, end: boolean, scope: [number, number]) => {
          let a = 0,
            b = projection!.runs.length;
          while (a < b) {
            const m = (a + b) >>> 1;
            if (
              projection!.runs[m].to <= at &&
              !(end && projection!.runs[m].to === at)
            )
              a = m + 1;
            else b = m;
          }
          // Typed structural boundaries have no DOM node. Move toward the range interior.
          for (
            let n = 0;
            n < 64 && a >= 0 && a < projection!.runs.length;
            n++, a += end ? -1 : 1
          ) {
            const run = projection!.runs[a];
            if (run.to <= scope[0] || run.from >= scope[1]) return null;
            if (run.kind !== "boundary") {
              return run.kind === "linear"
                ? {
                    leaf: run.start.leaf,
                    offset:
                      run.start.offset +
                      Math.max(0, Math.min(run.to - run.from, at - run.from)),
                  }
                : end
                  ? run.end
                  : run.start;
            }
          }
          return null;
        };
        const refined = refineReadingViewport(
          [from, offset(dom.blocks[startBlock].last)],
          [offset(dom.blocks[lo - 1].first), to],
          bounds.top - 200,
          bounds.bottom + 200,
          (a, b, scope) => {
            const start = point(a, false, scope),
              end = point(b, true, scope);
            if (!start || !end) return null;
            const startNode = dom!.texts.get(start.leaf)!,
              endNode = dom!.texts.get(end.leaf)!;
            if (!root.contains(startNode) || !root.contains(endNode))
              return null;
            const range = root.ownerDocument.createRange();
            range.setStart(startNode, start.offset);
            range.setEnd(endNode, end.offset);
            return range.getBoundingClientRect();
          },
          () => valid(g),
          {
            start:
              dom.blocks[startBlock].element.getBoundingClientRect().top <
              bounds.top - 200,
            end:
              dom.blocks[lo - 1].element.getBoundingClientRect().bottom >
              bounds.bottom + 200,
          }
        );
        from = refined.from;
        to = refined.to;
      }
      if (!valid()) return;
      const request = {
        kind: "viewport" as const,
        from,
        to,
      };
      if (pending.size) {
        queuedViewport = request;
        return;
      }
      queuedViewport = undefined;
      send(request);
    },
    range(from: number, to: number): Range | null {
      if (!valid() || !projection || !dom) return null;
      const a = readingPoint(projection, from),
        b = readingPoint(projection, to, true);
      const start = a && dom.texts.get(a.leaf),
        end = b && dom.texts.get(b.leaf);
      if (
        !a ||
        !b ||
        !start ||
        !end ||
        !root.contains(start) ||
        !root.contains(end)
      )
        return null;
      const range = root.ownerDocument.createRange();
      range.setStart(start, a.offset);
      range.setEnd(end, b.offset);
      return range;
    },
    dispose() {
      disposed = true;
      active = false;
      release();
      clear();
    },
  };
}
