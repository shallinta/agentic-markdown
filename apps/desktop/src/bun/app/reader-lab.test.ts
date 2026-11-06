import { expect, test } from "bun:test";

import { PACKAGED_VIEW_URL } from "../../security/shell-policy";
import type { Command } from "../../shared/commands";

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
