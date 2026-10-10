import {
  validSearchResult,
  type SearchOptions,
  type SearchRequest,
  type SearchResult,
} from "./source-search-protocol";
export interface SearchWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(request: SearchRequest): void;
  terminate(): void;
}
export interface SearchSource {
  session: object;
  textIdentity: object;
  raw: string;
  length: number;
  queryKey: string;
}
export type SearchStatus = "idle" | "running" | "ready" | "failed";
/** A view-local owner. Closure identity is its non-reusable mount epoch. */
export function createSearchOwner(
  factory: () => SearchWorker,
  current: () => SearchSource | null,
  receive: (result: SearchResult) => void,
  status: (value: SearchStatus) => void,
  timing: { delayMs: number; timeoutMs: number } = {
    delayMs: 100,
    timeoutMs: 15000,
  }
) {
  let worker: SearchWorker | undefined,
    source: SearchSource | null = null,
    epoch = "",
    id = 0;
  let active: SearchRequest | undefined, pending: SearchRequest | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let count = 0;
  let currentMatch: [number, number] | null = null;
  const latest = { scan: 0, viewport: 0, navigate: 0 };
  const matches = () => {
    const now = current();
    return (
      !!now &&
      !!source &&
      now.session === source.session &&
      now.queryKey === source.queryKey &&
      now.textIdentity === source.textIdentity
    );
  };
  const terminate = () => {
    clearTimeout(timer);
    clearTimeout(delay);
    timer = delay = undefined;
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
    }
    worker = undefined;
    active = pending = undefined;
    currentMatch = null;
  };
  const fail = () => {
    terminate();
    source = null;
    status("failed");
  };
  const send = (request: SearchRequest) => {
    if (disposed || !matches()) return;
    if (active) {
      pending = request;
      return;
    }
    try {
      if (!worker) {
        const created = factory();
        worker = created;
        created.onerror = created.onmessageerror = () => {
          if (worker === created) fail();
        };
        created.onmessage = (event) => {
          if (disposed || worker !== created || !active || !source) return;
          const request = active;
          if (!matches()) {
            terminate();
            source = null;
            status("idle");
            return;
          }
          if (
            !validSearchResult(event.data, request, source.length) ||
            (event.data.count > 0 &&
              event.data.current === null &&
              !(request.kind === "scan"
                ? request.exclude && request.exclude[0] < request.exclude[1]
                : request.kind === "viewport" &&
                  currentMatch === null &&
                  count > 0))
          ) {
            fail();
            return;
          }
          clearTimeout(timer);
          active = undefined;
          count = event.data.count;
          if (latest[request.kind] === request.id) {
            currentMatch = event.data.current ? [...event.data.current] : null;
            if (request.kind === "scan") status("ready");
            receive(event.data);
          }
          const next = pending;
          pending = undefined;
          if (next) send(next);
        };
      }
      active = request;
      timer = setTimeout(fail, timing.timeoutMs);
      worker.postMessage(request);
    } catch {
      fail();
    }
  };
  return {
    ticket() {
      if (
        disposed ||
        !matches() ||
        delay ||
        active?.kind === "scan" ||
        active?.kind === "navigate" ||
        pending?.kind === "navigate" ||
        !currentMatch ||
        !source
      )
        return null;
      return {
        session: source.session,
        textIdentity: source.textIdentity,
        queryKey: source.queryKey,
        range: [...currentMatch] as [number, number],
      };
    },
    scan(options: SearchOptions, position: number, exclude?: [number, number]) {
      const next = current();
      if (disposed || !next) return;
      const reuse =
        !!worker &&
        !active &&
        source?.session === next.session &&
        source.textIdentity === next.textIdentity;
      if (!reuse) terminate();
      else {
        clearTimeout(delay);
        pending = undefined;
      }
      source = next;
      currentMatch = null;
      epoch = crypto.randomUUID();
      const request: SearchRequest = {
        kind: "scan",
        epoch,
        id: ++id,
        options: {
          query: options.query,
          caseSensitive: options.caseSensitive,
          wholeWord: options.wholeWord,
        },
        position,
        ...(exclude ? { exclude } : {}),
        ...(reuse ? {} : { text: next.raw }),
      };
      latest.scan = request.id;
      status("running");
      delay = setTimeout(() => {
        delay = undefined;
        send(request);
      }, timing.delayMs);
    },
    viewport(from: number, to: number) {
      if (!worker || !matches() || active?.kind === "scan" || delay) return;
      const request: SearchRequest = {
        kind: "viewport",
        epoch,
        id: ++id,
        from,
        to,
      };
      latest.viewport = request.id;
      // Navigation has priority over a coalesced viewport request.
      if (pending?.kind === "navigate") return;
      send(request);
    },
    navigate(direction: -1 | 1) {
      if (!worker || !matches() || active?.kind === "scan" || delay) return;
      const request: SearchRequest = {
        kind: "navigate",
        epoch,
        id: ++id,
        direction: count
          ? ((pending?.kind === "navigate" ? pending.direction : 0) +
              direction) %
            count
          : direction,
      };
      latest.navigate = request.id;
      send(request);
    },
    cancel() {
      terminate();
      source = null;
      epoch = "";
      status("idle");
    },
    dispose() {
      disposed = true;
      terminate();
      source = null;
    },
  };
}
