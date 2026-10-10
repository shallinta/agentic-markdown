import { expect, test } from "bun:test";

import type { EditorView } from "@codemirror/view";

import { isCommand, COMMAND_META, type Command } from "../shared/commands";

import {
  handleListInput,
  registerListInputView,
  routeListInput,
} from "./list-input";

test("editor-local Enter routing preserves native IME and isolates disabled contexts", () => {
  const commands: Command[] = [];
  let prevented = 0,
    stopped = 0;
  const event = {
    key: "Enter",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    preventDefault: () => {
      prevented++;
    },
    stopImmediatePropagation: () => {
      stopped++;
    },
  };
  const id = crypto.randomUUID(),
    execute = (c: Command) => {
      commands.push(c);
    };
  expect(routeListInput(event, false, true, false, id, execute)).toBe(false);
  expect(stopped).toBe(0);
  expect(routeListInput(event, true, true, true, id, execute)).toBe(false);
  expect(prevented).toBe(0);
  expect(commands).toHaveLength(0);
  expect(routeListInput(event, true, false, false, id, execute)).toBe(true);
  expect(prevented).toBe(0);
  expect(commands).toHaveLength(0);
  routeListInput(event, true, true, false, id, execute);
  event.shiftKey = true;
  routeListInput(event, true, true, false, id, execute);
  expect(commands.map((c) => c.type)).toEqual([
    "continueList",
    "listSoftBreak",
  ]);
  expect(commands.every(isCommand)).toBe(true);
  expect(
    isCommand({ type: "continueList", args: { documentId: id, other: true } })
  ).toBe(false);
  expect(COMMAND_META.continueList.palette).toBe(false);
  event.metaKey = true;
  expect(routeListInput(event, true, true, false, id, execute)).toBe(false);
  event.metaKey = false;
  event.ctrlKey = true;
  expect(routeListInput(event, true, true, false, id, execute)).toBe(false);
  event.ctrlKey = false;
  event.altKey = true;
  expect(routeListInput(event, true, true, false, id, execute)).toBe(false);
  expect(commands).toHaveLength(2);
  expect(stopped).toBe(0);
});

test("public handler binds only current view and stale cleanup cannot remove replacement", () => {
  const view = {} as EditorView;
  const other = {} as EditorView;
  const event = { key: "Enter" } as KeyboardEvent;
  let oldCalls = 0,
    newCalls = 0;
  expect(handleListInput(event, view)).toBe(false);
  const removeOld = registerListInputView(view, () => {
    oldCalls++;
    return true;
  });
  expect(handleListInput(event, view)).toBe(true);
  expect(handleListInput(event, other)).toBe(false);
  const removeNew = registerListInputView(view, () => {
    newCalls++;
    return true;
  });
  removeOld();
  expect(handleListInput(event, view)).toBe(true);
  expect(oldCalls).toBe(1);
  expect(newCalls).toBe(1);
  removeNew();
  removeNew();
  expect(handleListInput(event, view)).toBe(false);
  expect(newCalls).toBe(1);
});

test("CM handled-result contract does not cancel composition but consumes denied ordinary Enter", () => {
  const view = {} as EditorView;
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperties(event, {
    key: { value: "Enter" },
    isComposing: { value: false, configurable: true },
  });
  const key = event as KeyboardEvent;
  let started = true;
  let commands = 0;
  const remove = registerListInputView(view, (input) =>
    routeListInput(input, true, false, started, crypto.randomUUID(), () => {
      commands++;
    })
  );
  // Public DOM handler contract: CM cancels default only for a true result.
  const deliver = () => {
    const handled = handleListInput(key, view);
    if (handled) key.preventDefault();
    return handled;
  };
  expect(deliver()).toBe(false);
  expect(key.defaultPrevented).toBe(false);
  started = false;
  Object.defineProperty(event, "isComposing", {
    value: true,
    configurable: true,
  });
  expect(deliver()).toBe(false);
  expect(key.defaultPrevented).toBe(false);
  Object.defineProperty(event, "isComposing", { value: false });
  expect(deliver()).toBe(true);
  expect(key.defaultPrevented).toBe(true);
  expect(commands).toBe(0);
  remove();
});
