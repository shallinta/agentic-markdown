import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

import { PACKAGED_READER_SNAPSHOT_URL } from "../../security/reader-policy";
import { PACKAGED_VIEW_URL } from "../../security/shell-policy";
import type { Command } from "../../shared/commands";
import { parseReaderImageSnapshot, READER_IMAGE_SNAPSHOT_EVENT } from "../../shared/reader-image-snapshot";
import { decodeReaderSnapshotDelivery, readerSnapshotDeliveryScript, READER_SNAPSHOT_EVENT } from "../../shared/reader-snapshot";
import type { ReadingSnapshotImageRead } from "../documents";

import { createReaderLab } from "./reader-lab";

function fixture() {
  const events = (url = PACKAGED_VIEW_URL) => {
    const listeners = new Map<string, () => void>();
    return {
      url,
      on: (event: string, callback: () => void) => listeners.set(event, callback),
      emit: (event: string) => listeners.get(event)?.(),
    };
  };
  const calls: string[] = [];
  const main = { ...events(), activate: () => calls.push("activate-main") };
  const reader = {
    ...events(),
    show: () => calls.push("show-reader"),
    requestClose: () => calls.push("request-close-reader"),
    close: () => calls.push("dispose-reader"),
  };
  const lab = createReaderLab(() => {
    calls.push("open-reader");
    return reader;
  });
  lab.bindMain(main);
  return { lab, main, reader, calls };
}

const save: Command = { type: "saveDocument", args: {} };
const close: Command = { type: "closeDocument", args: {} };

test("reader lab fences menu commands before focus and closes only a confirmed reader", () => {
  const { lab, main, reader, calls } = fixture();
  expect(lab.interceptMenu(save)).toBe(false);
  lab.openAfterMainReady({ ...main, url: "http://localhost:5173" });
  expect(calls).toEqual([]);
  lab.openAfterMainReady(main);
  main.emit("focus");
  expect(lab.interceptMenu(save)).toBe(true);
  expect(lab.interceptMenu(close)).toBe(true);
  expect(calls).toEqual(["open-reader", "show-reader"]);

  reader.emit("focus");
  expect(lab.interceptMenu(save)).toBe(true);
  expect(lab.interceptMenu(close)).toBe(true);
  expect(calls[calls.length - 1]).toBe("request-close-reader");
  reader.emit("close");
  expect(lab.interceptMenu(save)).toBe(false);
  reader.emit("blur");
  reader.emit("focus");
  lab.openAfterMainReady(main);
  expect(lab.interceptMenu(save)).toBe(false);
  expect(calls).toEqual(["open-reader", "show-reader", "request-close-reader"]);
});

test("reader lab does not dispatch main commands while focus changes or replace quit guard", () => {
  const { lab, main, reader, calls } = fixture();
  lab.openAfterMainReady(main);
  reader.emit("focus");
  lab.activateMainForDiscard(main);
  expect(calls[calls.length - 1]).toBe("activate-main");
  expect(lab.interceptMenu(save)).toBe(true);
  main.emit("focus");
  reader.emit("blur");
  expect(lab.interceptMenu(save)).toBe(false);
  const last = calls.length;
  lab.activateMainForDiscard(main);
  main.emit("blur");
  expect(lab.interceptMenu(save)).toBe(true);
  expect(lab.interceptMenu(close)).toBe(true);
  expect(calls).toHaveLength(last);
  reader.emit("focus");
  reader.emit("blur");
  expect(lab.interceptMenu(close)).toBe(true);
  expect(calls).toHaveLength(last);
  lab.dispose();
  expect(calls[calls.length - 1]).toBe("dispose-reader");
});

const source = {
  handle: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  documentId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  expectedRevision: 1,
  expectedHash: "c".repeat(64),
};
const readyEvent = (url: string) => ({ data: { detail: url } });

function snapshotFixture(timeoutMs?: number, candidate?: (base64: string, signal: AbortSignal) => Promise<string | undefined>, imageTimeoutMs?: number) {
  const captured = Promise.withResolvers<{ ok: true; base64: string; current(): boolean; readImage?: ReadingSnapshotImageRead }>();
  const callers: (() => boolean)[] = [];
  const sources: unknown[] = [];
  const options: unknown[] = [];
  const calls: string[] = [];
  const makeChild = () => {
    const registered = Promise.withResolvers<void>();
    const events = new Map<string, () => void>();
    const webviewEvents = new Map<string, (event: unknown) => void>();
    const scripts: string[] = [];
    return {
      url: PACKAGED_READER_SNAPSHOT_URL,
      webview: {
        url: PACKAGED_READER_SNAPSHOT_URL,
        isRemoved: false,
        on: (name: string, callback: (event: unknown) => void) => {
          webviewEvents.set(name, callback);
          if (name === "dom-ready") registered.resolve();
        },
        executeJavascript: (script: string) => { calls.push(script); scripts.push(script); },
      },
      on: (event: string, callback: () => void) => events.set(event, callback),
      show: () => calls.push("show"),
      requestClose: () => calls.push("request-close"),
      close: () => calls.push("close"),
      registered, scripts,
      emit: (event: string) => events.get(event)?.(),
      webEvent: (name: string, url = PACKAGED_READER_SNAPSHOT_URL) => webviewEvents.get(name)?.(readyEvent(url)),
    };
  };
  let child = makeChild();
  let opened = false;
  const main = { url: PACKAGED_VIEW_URL, on: () => undefined, activate: () => undefined };
  const lab = createReaderLab(undefined, {
    capture: (request, current, settings) => {
      sources.push(request);
      callers.push(current);
      options.push(settings);
      return captured.promise;
    },
    open: () => {
      calls.push("open");
      if (opened) child = makeChild();
      opened = true;
      return child;
    },
    timeoutMs, candidate, imageTimeoutMs,
  });
  lab.bindMain(main);
  return {
    lab, main, calls, sources, callers, captured, options,
    get child() { return child; },
    get registered() { return child.registered; },
    open: () => lab.openReadingSnapshot(source, main),
    ready: (url = PACKAGED_VIEW_URL) => lab.openAfterMainReady(main, readyEvent(url)),
    dom: (url = PACKAGED_READER_SNAPSHOT_URL) => child.webEvent("dom-ready", url),
    emit: (event: string) => child.emit(event),
  };
}

test("snapshot route binds the packaged main, one child, one exact ready event and one submission", async () => {
  const f = snapshotFixture();
  f.ready("http://localhost:5173");
  expect(await f.open()).toEqual({ ok: false, error: "UNAVAILABLE" });
  f.ready();
  expect(await f.lab.openReadingSnapshot({ ...source, path: "/foreign" }, f.main))
    .toEqual({ ok: false, error: "INVALID_REQUEST" });
  expect(await f.lab.openReadingSnapshot({ ...source, expectedHash: source.expectedHash + "\n" }, f.main))
    .toEqual({ ok: false, error: "INVALID_REQUEST" });
  expect(f.sources).toEqual([]);
  const result = f.open();
  expect(await f.open()).toEqual({ ok: false, error: "BUSY" });
  let checks = 0;
  f.captured.resolve({ ok: true, base64: "5Lit", current: () => ++checks <= 2 });
  await f.registered.promise;
  expect(f.sources).toEqual([source]);
  expect(f.calls).toEqual(["open"]);
  expect(f.callers[0]?.()).toBe(true);
  f.dom("about:blank");
  expect(f.calls).toEqual(["open"]);
  f.dom();
  f.dom();
  expect(await result).toEqual({ ok: true, submitted: true });
  const script = readerSnapshotDeliveryScript("5Lit");
  if (!script) throw new Error("Fixture base64 is canonical");
  expect(f.calls).toEqual(["open", script, "show"]);
  expect(checks).toBe(2);
  expect(f.callers[0]?.()).toBe(false);
  expect(await f.open()).toEqual({ ok: false, error: "BUSY" });
  f.emit("focus");
  expect(f.lab.interceptMenu(close)).toBe(true);
  expect(f.calls[f.calls.length - 1]).toBe("request-close");
  f.emit("close");
  expect(f.lab.interceptMenu(save)).toBe(false);
  f.lab.dispose();
});

test("snapshot route suppresses expired proof before create or immediately before submission", async () => {
  const early = snapshotFixture();
  early.ready();
  const earlyResult = early.open();
  early.captured.resolve({ ok: true, base64: "5Lit", current: () => false });
  expect(await earlyResult).toEqual({ ok: false, error: "CANCELLED" });
  expect(early.calls).toEqual([]);
  early.lab.dispose();

  const late = snapshotFixture();
  late.ready();
  const lateResult = late.open();
  let fresh = true;
  late.captured.resolve({ ok: true, base64: "5Lit", current: () => fresh });
  await late.registered.promise;
  fresh = false;
  late.dom();
  expect(await lateResult).toEqual({ ok: false, error: "CANCELLED" });
  late.dom();
  expect(late.calls).toEqual(["open", "request-close"]);
  late.emit("close");
  late.lab.dispose();
});

test("snapshot route retires late events on close, main navigation and timeout", async () => {
  for (const change of ["close", "navigate", "suspend", "timeout"] as const) {
    const f = snapshotFixture(change === "timeout" ? 10 : undefined);
    f.ready();
    const result = f.open();
    f.captured.resolve({ ok: true, base64: "5Lit", current: () => true });
    await f.registered.promise;
    if (change === "close") f.emit("close");
    if (change === "navigate") f.lab.retireMainReady(f.main);
    if (change === "suspend") {
      const resume = f.lab.suspendSnapshots();
      expect(await f.open()).toEqual({ ok: false, error: "UNAVAILABLE" });
      resume();
    }
    expect(await result).toEqual({
      ok: false, error: change === "timeout" ? "UNAVAILABLE" : "CANCELLED",
    });
    f.dom();
    expect(f.calls).toEqual(change === "close" ? ["open"] : ["open", "request-close"]);
    expect(f.callers[0]?.()).toBe(false);
    f.emit("close");
    f.lab.dispose();
  }
});

test("snapshot route checks the exact child's webview identity after its ready event", async () => {
  const f = snapshotFixture();
  f.ready();
  const result = f.open();
  f.captured.resolve({ ok: true, base64: "5Lit", current: () => true });
  await f.registered.promise;
  f.child.webview.url = PACKAGED_VIEW_URL;
  f.dom();
  expect(await result).toEqual({ ok: false, error: "UNAVAILABLE" });
  expect(f.calls).toEqual(["open", "request-close"]);
  f.emit("close");
  f.lab.dispose();
});

test("snapshot route times out a held capture without stacking reads or creating a late child", async () => {
  const f = snapshotFixture(10);
  f.ready();
  expect(await f.open()).toEqual({ ok: false, error: "UNAVAILABLE" });
  expect(f.callers[0]?.()).toBe(false);
  expect(await f.open()).toEqual({ ok: false, error: "BUSY" });
  expect(f.sources).toEqual([source]);
  f.captured.resolve({ ok: true, base64: "5Lit", current: () => true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.calls).toEqual([]);
  const retry = f.open();
  await f.registered.promise;
  f.dom();
  expect(await retry).toEqual({ ok: true, submitted: true });
  f.lab.dispose();
});

const imageResult = { ok: true, mime: "image/png", width: 2, height: 3, data: "AA==", current: () => true } as const;
const unavailable = { ok: false, error: "UNAVAILABLE" } as const;

function readDeliveryEvents(scripts: readonly string[]) {
  const events: CustomEvent[] = [];
  const window = { dispatchEvent: (event: CustomEvent) => events.push(event) };
  for (const script of scripts) runInNewContext(script, { CustomEvent, window });
  return events;
}

test("image work starts after the body is submitted, with one exact fixed receipt", async () => {
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<Awaited<ReturnType<ReadingSnapshotImageRead>>>();
  const seen: string[] = [];
  const f = snapshotFixture(undefined, (base64) => {
    expect(f.calls[f.calls.length - 1]).toBe("show");
    seen.push(base64);
    return Promise.resolve("图%20像.png");
  });
  try {
    f.ready();
    const body = f.open();
    f.captured.resolve({ ok: true, base64: "5Lit", current: () => true, readImage: (reference, current) => {
      expect(current()).toBe(true);
      seen.push(reference);
      entered.resolve();
      return finish.promise;
    } });
    await f.registered.promise;
    f.child.webEvent("did-commit-navigation");
    f.dom();
    f.dom();
    expect(await body).toEqual({ ok: true, submitted: true });
    await entered.promise;
    expect(f.options).toEqual([{ includeImage: true }]);
    expect(seen).toEqual(["5Lit", "图%20像.png"]);
    const [bodyEvent] = readDeliveryEvents(f.child.scripts);
    expect(bodyEvent?.type).toBe(READER_SNAPSHOT_EVENT);
    const bodyReceipt = decodeReaderSnapshotDelivery(bodyEvent?.detail);
    if (!bodyReceipt?.deliveryId) throw Error("missing body image ID");
    expect(bodyReceipt.text).toBe("中");
    expect(f.child.scripts).toHaveLength(1);
    finish.resolve(imageResult);
    await Bun.sleep(0);
    const [, imageEvent] = readDeliveryEvents(f.child.scripts);
    expect(imageEvent?.type).toBe(READER_IMAGE_SNAPSHOT_EVENT);
    expect(parseReaderImageSnapshot(imageEvent?.detail, bodyReceipt.deliveryId)).toEqual({
      protocolVersion: 1, deliveryId: bodyReceipt.deliveryId, slot: 0,
      status: "image", mime: "image/png", width: 2, height: 3, data: "AA==",
    });
    expect(f.child.scripts).toHaveLength(2);
  } finally {
    finish.resolve(unavailable);
    f.lab.dispose();
  }
});

test("plain body and candidate miss avoid an image read, while known image failure sends only unavailable", async () => {
  for (const mode of ["plain", "missing", "candidate-failure", "read-failure", "stale"] as const) {
    let candidates = 0;
    let reads = 0;
    const f = snapshotFixture(undefined, () => {
      candidates++;
      if (mode === "candidate-failure") return Promise.reject(Error("candidate failed"));
      return Promise.resolve(mode === "missing" ? undefined : "raster.png");
    });
    try {
      f.ready();
      const body = f.open();
      f.captured.resolve({ ok: true, base64: "5Lit", current: () => true, ...(mode === "plain" ? {} : {
        readImage: () => {
          reads++;
          return Promise.resolve(mode === "stale" ? { ...imageResult, current: () => false } : unavailable);
        },
      }) });
      await f.registered.promise;
      f.dom();
      expect(await body).toEqual({ ok: true, submitted: true });
      await Bun.sleep(0);
      const [bodyEvent, asset] = readDeliveryEvents(f.child.scripts);
      expect(bodyEvent?.type).toBe(READER_SNAPSHOT_EVENT);
      expect(candidates).toBe(mode === "plain" ? 0 : 1);
      expect(reads).toBe(mode === "read-failure" || mode === "stale" ? 1 : 0);
      if (mode === "plain") expect(bodyEvent?.detail).toBe("5Lit");
      if (mode === "read-failure") {
        const deliveryId = decodeReaderSnapshotDelivery(bodyEvent?.detail)?.deliveryId;
        if (!deliveryId) throw Error("missing bound ID");
        expect(asset?.type).toBe(READER_IMAGE_SNAPSHOT_EVENT);
        expect(parseReaderImageSnapshot(asset?.detail, deliveryId)).toEqual({ protocolVersion: 1, slot: 0, deliveryId, status: "unavailable" });
      } else expect(asset).toBeUndefined();
    } finally {
      f.lab.dispose();
    }
  }
});

test("late image from closed reader A cannot reach reader B", async () => {
  const entered = Promise.withResolvers<() => boolean>();
  const finishA = Promise.withResolvers<Awaited<ReturnType<ReadingSnapshotImageRead>>>();
  const signals: AbortSignal[] = [];
  const f = snapshotFixture(undefined, (_base64, signal) => {
    signals.push(signal);
    return Promise.resolve("raster.png");
  });
  let reads = 0;
  try {
    f.ready();
    const resultA = f.open();
    f.captured.resolve({ ok: true, base64: "5Lit", current: () => true, readImage: (_reference, current) => {
      if (++reads === 1) {
        entered.resolve(current);
        return finishA.promise;
      }
      return Promise.resolve(imageResult);
    } });
    await f.registered.promise;
    const childA = f.child;
    f.dom();
    expect(await resultA).toEqual({ ok: true, submitted: true });
    const currentA = await entered.promise;
    expect(currentA()).toBe(true);
    childA.emit("close");
    expect(currentA()).toBe(false);
    expect(signals[0]?.aborted).toBe(true);

    const resultB = f.open();
    await Bun.sleep(0);
    const childB = f.child;
    expect(childB).not.toBe(childA);
    await childB.registered.promise;
    f.dom();
    expect(await resultB).toEqual({ ok: true, submitted: true });
    finishA.resolve(imageResult);
    await Bun.sleep(0);
    expect(childA.scripts).toHaveLength(1);
    expect(childB.scripts).toHaveLength(2);
    const [a] = readDeliveryEvents(childA.scripts);
    const [b, image] = readDeliveryEvents(childB.scripts);
    const idA = decodeReaderSnapshotDelivery(a?.detail)?.deliveryId;
    const idB = decodeReaderSnapshotDelivery(b?.detail)?.deliveryId;
    if (!idA || !idB) throw Error("missing reader IDs");
    expect(idA).not.toBe(idB);
    expect(parseReaderImageSnapshot(image?.detail, idA)).toBeUndefined();
    expect(parseReaderImageSnapshot(image?.detail, idB)?.status).toBe("image");
  } finally {
    finishA.resolve(unavailable);
    f.lab.dispose();
  }
});

test("held candidate aborts on deadline, quit suspension, or committed child or main navigation", async () => {
  for (const cause of ["deadline", "suspend", "child-navigation", "main-navigation", "dispose"] as const) {
    const entered = Promise.withResolvers<AbortSignal>();
    const finished = Promise.withResolvers<string>();
    let reads = 0;
    const f = snapshotFixture(undefined, (_base64, signal) => {
      entered.resolve(signal);
      return finished.promise;
    }, cause === "deadline" ? 10 : undefined);
    try {
      f.ready();
      const body = f.open();
      f.captured.resolve({ ok: true, base64: "5Lit", current: () => true, readImage: () => {
        reads++;
        return Promise.resolve(imageResult);
      } });
      await f.registered.promise;
      f.dom();
      expect(await body).toEqual({ ok: true, submitted: true });
      const signal = await entered.promise;
      if (cause === "deadline") await Bun.sleep(20);
      if (cause === "suspend") f.lab.suspendSnapshots()();
      if (cause === "child-navigation") f.child.webEvent("did-commit-navigation");
      if (cause === "main-navigation") { f.lab.retireMainReady(f.main); f.ready(); }
      if (cause === "dispose") f.lab.dispose();
      expect(signal.aborted).toBe(true);
      finished.resolve("raster.png");
      await Bun.sleep(0);
      expect(reads).toBe(0);
      expect(f.child.scripts).toHaveLength(1);
    } finally {
      finished.resolve("raster.png");
      f.lab.dispose();
    }
  }
});
