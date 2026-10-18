import {
  natural,
  record,
  keys,
  validResult,
  scalar,
  encodeChanges,
} from "./protocol";
import type { IndexChange, IndexOperation, IndexResult } from "./protocol";
import { resolveIndexResources } from "./resources";

interface Waiter {
  op: IndexOperation;
  payload: unknown;
  resolve: (result: IndexResult) => void;
}
type Active = Waiter & { id: number };
const error = (
  code: "UNKNOWN" | "CLOSED" | "CANCELLED" | "BUSY" | "UNAVAILABLE" | "INPUT",
  accepted = false
): IndexResult => ({ ok: false, error: code, accepted });
/** No window consumers yet. The supplied directory must have the real source/package layout. */
export function createIndexSession(moduleDirectory = import.meta.dir) {
  const resources = resolveIndexResources(moduleDirectory);
  let worker: Worker | undefined;
  let active: Active | undefined;
  let latest: Waiter | undefined;
  let serial = 0;
  let generation: number | undefined;
  let abandoned: number | undefined;
  let closeSent = false;
  const epoch = 1;
  let closed = false,
    closing = false,
    faulted = false;
  let closeResult: IndexResult | undefined;
  let closePromise: Promise<IndexResult> | undefined;
  let closeResolve: ((value: IndexResult) => void) | undefined;
  const settleUnknown = () => {
    faulted = true;
    closing = true;
    if (active) abandoned = active.id;
    active?.resolve(error("UNKNOWN", true));
    active = undefined;
    latest?.resolve(error("CANCELLED"));
    latest = undefined;
    closeResolve?.(error("UNKNOWN", true));
    if (!closeSent && worker && !closed) dispatchClose();
  };
  const dispatch = (waiter: Waiter) => {
    if (!worker || closed) {
      waiter.resolve(error(resources ? "CLOSED" : "UNAVAILABLE"));
      return;
    }
    const current = { ...waiter, id: ++serial };
    active = current;
    try {
      worker.postMessage({
        version: 1,
        epoch,
        id: current.id,
        op: current.op,
        payload: current.payload,
      });
    } catch {
      settleUnknown();
    }
  };
  const dispatchClose = () => {
    if (closeSent) return;
    closeSent = true;
    dispatch({
      op: "close",
      payload: null,
      resolve: (result) => {
        closeResult = result;
      },
    });
  };
  function validGeneration(op: IndexOperation, result: IndexResult) {
    if (!result.ok) return true;
    if (op === "open") return generation === undefined;
    if (generation === undefined)
      return op === "close" && result.generation === 0;
    if (op === "apply") return result.generation === generation + 1;
    return faulted && op === "close"
      ? result.generation >= generation
      : result.generation === generation;
  }
  if (resources) {
    try {
      worker = new Worker(resources.worker);
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const message = event.data,
          current = active;
        if (!current) {
          settleUnknown();
          return;
        }
        if (
          record(message) &&
          message.id === abandoned &&
          message.epoch === epoch
        )
          return;
        if (
          !record(message) ||
          !keys(message, "epoch,id,result,version") ||
          message.version !== 1 ||
          message.epoch !== epoch ||
          !natural(message.id) ||
          message.id !== current.id ||
          !validResult(message.result, current.op) ||
          !validGeneration(current.op, message.result)
        ) {
          settleUnknown();
          return;
        }
        active = undefined;
        if (message.result.ok) generation = message.result.generation;
        current.resolve(message.result);
        if (current.op === "close") return;
        if (!message.result.ok && message.result.error === "UNKNOWN") {
          abandoned = current.id;
          settleUnknown();
          return;
        }
        if (closing) dispatchClose();
        else if (latest) {
          const next = latest;
          latest = undefined;
          dispatch(next);
        }
      };
      worker.onerror = settleUnknown;
      worker.addEventListener("close", (event) => {
        closed = true;
        if (
          active ||
          latest ||
          !closeResult ||
          !("code" in event) ||
          event.code !== 0
        )
          settleUnknown();
        else closeResolve?.(faulted ? error("UNKNOWN", true) : closeResult);
      });
    } catch {
      worker = undefined;
    }
  }
  function send(op: IndexOperation, payload: unknown): Promise<IndexResult> {
    if (!worker) return Promise.resolve(error("UNAVAILABLE"));
    if (faulted) return Promise.resolve(error("UNKNOWN", true));
    if (closed || closing) return Promise.resolve(error("CLOSED"));
    if (active && op !== "query") return Promise.resolve(error("BUSY"));
    return new Promise((resolve) => {
      const next = { op, payload, resolve };
      if (active) {
        latest?.resolve(error("CANCELLED"));
        latest = next;
      } else dispatch(next);
    });
  }
  return {
    open(path: string, mode: "create-new" | "reader-only") {
      if (
        !scalar(path, 4096) ||
        !path.startsWith("/") ||
        path.includes("\0") ||
        Buffer.byteLength(path) > 4096 ||
        !["create-new", "reader-only"].includes(mode)
      )
        return Promise.resolve(error("INPUT"));
      return send("open", { path, mode });
    },
    applyAndCommit(changes: readonly IndexChange[]) {
      try {
        encodeChanges(changes);
      } catch {
        return Promise.resolve(error("INPUT"));
      }
      return send("apply", changes);
    },
    query: (text: string) =>
      scalar(text, 4096)
        ? send("query", text)
        : Promise.resolve(error("INPUT")),
    close(): Promise<IndexResult> {
      if (closePromise) return closePromise;
      closing = true;
      latest?.resolve(error("CANCELLED"));
      latest = undefined;
      closePromise = new Promise((resolve) => {
        closeResolve = resolve;
      });
      if (faulted) closeResolve?.(error("UNKNOWN", true));
      if (!worker || closed)
        closeResolve?.(closeResult ?? error("UNAVAILABLE"));
      else if (!active) dispatchClose();
      return closePromise;
    },
  };
}
