import { expect, test } from "bun:test";

import type { EditorView } from "@codemirror/view";

import { isCommand, COMMAND_META, type Command } from "../shared/commands";

import {
  handleIndentationInput,
  registerIndentationView,
  routeIndentationInput,
  routeSourceTabFocus,
} from "./source-indentation-input";

test("existing Mac physical shortcut escapes readonly source, not IME or unrelated keys", () => {
  let calls = 0;
  const view = {
    hasFocus: true,
    compositionStarted: false,
    composing: false,
    state: { readOnly: true },
    setTabFocusMode: () => {
      calls++;
    },
  } as unknown as EditorView;
  const event = {
    key: "Â",
    code: "KeyM",
    altKey: true,
    shiftKey: true,
    metaKey: false,
    ctrlKey: false,
    isComposing: false,
  };
  const remove = registerIndentationView(view, (e) =>
    routeSourceTabFocus(e, view, true, "MacIntel")
  );
  expect(handleIndentationInput(event as KeyboardEvent, view)).toBe(true);
  expect(calls).toBe(1);
  for (const patch of [
    { code: "KeyN", key: "m" },
    { altKey: false },
    { shiftKey: false },
    { metaKey: true },
    { ctrlKey: true },
    { isComposing: true },
  ])
    expect(
      routeSourceTabFocus({ ...event, ...patch }, view, true, "MacIntel")
    ).toBe(false);
  expect(routeSourceTabFocus(event, view, false, "MacIntel")).toBe(false);
  expect(routeSourceTabFocus(event, view, true, "Win32")).toBe(false);
  for (const patch of [
    { hasFocus: false },
    { compositionStarted: true },
    { composing: true },
  ])
    expect(
      routeSourceTabFocus(
        event,
        { ...view, ...patch } as unknown as EditorView,
        true,
        "MacIntel"
      )
    ).toBe(false);
  expect(calls).toBe(1);
  remove();
  expect(handleIndentationInput(event as KeyboardEvent, view)).toBe(false);
  const commands: Command[] = [];
  expect(
    routeIndentationInput(
      { ...event, key: "Tab", altKey: false, shiftKey: false },
      true,
      false,
      false,
      crypto.randomUUID(),
      (c) => commands.push(c)
    )
  ).toBe(true);
  expect(commands).toHaveLength(0);
});

test("source-local Tab and existing brackets use registry without claiming IME", () => {
  const calls: Command[] = [];
  const id = crypto.randomUUID(),
    execute = (c: Command) => {
      calls.push(c);
    };
  const e = {
    key: "Tab",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
  };
  expect(routeIndentationInput(e, false, true, false, id, execute)).toBe(false);
  expect(routeIndentationInput(e, true, true, true, id, execute)).toBe(false);
  expect(
    routeIndentationInput(
      { ...e, isComposing: true },
      true,
      true,
      false,
      id,
      execute
    )
  ).toBe(false);
  expect(routeIndentationInput(e, true, false, false, id, execute)).toBe(true);
  expect(calls).toHaveLength(0);
  for (const event of [
    e,
    { ...e, shiftKey: true },
    { ...e, key: "]", metaKey: true },
    { ...e, key: "[", metaKey: true },
  ])
    expect(routeIndentationInput(event, true, true, false, id, execute)).toBe(
      true
    );
  expect(calls.map((c) => c.type)).toEqual([
    "indentSource",
    "dedentSource",
    "indentSource",
    "dedentSource",
  ]);
  for (const c of calls) {
    expect(isCommand(c)).toBe(true);
    expect(COMMAND_META[c.type].palette).toBe(false);
  }
  for (const event of [
    { ...e, altKey: true },
    { ...e, ctrlKey: true },
    { ...e, key: "m", altKey: true, shiftKey: true },
    { ...e, key: "\\", metaKey: true, altKey: true },
  ])
    expect(routeIndentationInput(event, true, true, false, id, execute)).toBe(
      false
    );
});

test("view registration replacement and cleanup cannot call stale targets", () => {
  const view = {} as EditorView,
    other = {} as EditorView,
    event = {} as KeyboardEvent;
  let old = 0,
    fresh = 0;
  const removeOld = registerIndentationView(view, () => {
    old++;
    return true;
  });
  expect(handleIndentationInput(event, view)).toBe(true);
  const removeNew = registerIndentationView(view, () => {
    fresh++;
    return false;
  });
  removeOld();
  expect(handleIndentationInput(event, view)).toBe(false);
  expect(handleIndentationInput(event, other)).toBe(false);
  removeNew();
  expect(handleIndentationInput(event, view)).toBe(false);
  expect(old).toBe(1);
  expect(fresh).toBe(1);
});
