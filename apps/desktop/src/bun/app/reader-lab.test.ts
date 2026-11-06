import { expect, test } from "bun:test";

import { PACKAGED_READER_SNAPSHOT_URL } from "../../security/reader-policy";
import { PACKAGED_VIEW_URL } from "../../security/shell-policy";
import type { Command } from "../../shared/commands";
import { readerSnapshotDeliveryScript } from "../../shared/reader-snapshot";

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

function snapshotFixture(timeoutMs?: number) {
  const registered = Promise.withResolvers<void>();
  const captured = Promise.withResolvers<{ ok: true; base64: string; current(): boolean }>();
  const callers: (() => boolean)[] = [];
  const sources: unknown[] = [];
  const calls: string[] = [];
  const events = new Map<string, () => void>();
  let onReady: ((event: unknown) => void) | undefined;
  const child = {
    url: PACKAGED_READER_SNAPSHOT_URL,
    webview: {
      url: PACKAGED_READER_SNAPSHOT_URL,
      isRemoved: false,
      on: (_name: "dom-ready", callback: (event: unknown) => void) => {
        onReady = callback;
        registered.resolve();
      },
      executeJavascript: (script: string) => calls.push(script),
    },
    on: (event: string, callback: () => void) => events.set(event, callback),
    show: () => calls.push("show"),
    requestClose: () => calls.push("request-close"),
    close: () => calls.push("close"),
  };
  const main = { url: PACKAGED_VIEW_URL, on: () => undefined, activate: () => undefined };
  const lab = createReaderLab(undefined, {
    capture: (request, current) => {
      sources.push(request);
      callers.push(current);
      return captured.promise;
    },
    open: () => {
      calls.push("open");
      return child;
    },
    timeoutMs,
  });
  lab.bindMain(main);
  return {
    lab, main, child, calls, sources, callers, captured, registered,
    open: () => lab.openReadingSnapshot(source, main),
    ready: (url = PACKAGED_VIEW_URL) => lab.openAfterMainReady(main, readyEvent(url)),
    dom: (url = PACKAGED_READER_SNAPSHOT_URL) => onReady?.(readyEvent(url)),
    emit: (event: string) => events.get(event)?.(),
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
