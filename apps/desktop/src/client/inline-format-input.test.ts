import { expect, test } from "bun:test";

import { EditorSelection, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { isCommand, type Command } from "../shared/commands";

import {
  canFormat,
  captureFormatTarget,
  handleFormatKey,
  registerFormatView,
  releaseFormatTarget,
  runInlineFormat,
} from "./inline-format-input";
import { createRawEditorState } from "./raw-buffer";

function fixture() {
  const fake = {
    state: createRawEditorState("abc").update({
      selection: EditorSelection.range(0, 3),
    }).state,
    hasFocus: true,
    composing: false,
    compositionStarted: false,
    focusCount: 0,
    dispatch(tx: Transaction) {
      this.state = tx.state;
    },
    focus() {
      this.hasFocus = true;
      this.focusCount++;
    },
  };
  const id = crypto.randomUUID();
  let allowed = true,
    ordinary = true;
  const commands: Command[] = [];
  const view = fake as unknown as EditorView;
  const remove = registerFormatView(
    view,
    id,
    () => allowed,
    () => ordinary,
    (c) => commands.push(c)
  );
  return {
    fake,
    view,
    id,
    commands,
    remove,
    permission: (v: boolean) => {
      allowed = v;
    },
    ordinary: (v: boolean) => {
      ordinary = v;
    },
  };
}
test("palette captured editor survives its focus loss but rejects changed state and released view", () => {
  const f = fixture();
  const capture = captureFormatTarget()!;
  f.fake.hasFocus = false;
  expect(canFormat("formatBold", capture)).toBe(true);
  expect(runInlineFormat("formatBold", f.id)).toBe(false);
  expect(runInlineFormat("formatBold", capture.documentId, capture.token)).toBe(
    true
  );
  expect(f.fake.state.doc.toString()).toBe("**abc**");
  expect(f.fake.focusCount).toBe(1);
  const stale = captureFormatTarget()!;
  f.fake.state = f.fake.state.update({ selection: { anchor: 0 } }).state;
  expect(runInlineFormat("formatBold", f.id, stale.token)).toBe(false);
  f.remove();
  expect(canFormat("formatBold", stale)).toBe(false);
});
test("no editor focus cannot capture, IME/permission/current-view are rechecked", () => {
  const f = fixture();
  f.fake.hasFocus = false;
  expect(captureFormatTarget()).toBeUndefined();
  f.fake.hasFocus = true;
  const capture = captureFormatTarget()!;
  f.permission(false);
  expect(canFormat("formatBold", capture)).toBe(false);
  f.permission(true);
  f.fake.compositionStarted = true;
  expect(runInlineFormat("formatBold", f.id, capture.token)).toBe(false);
  f.fake.compositionStarted = false;
  const next = fixture();
  f.remove();
  expect(runInlineFormat("formatBold", next.id)).toBe(true);
  expect(runInlineFormat("formatBold", f.id, capture.token)).toBe(false);
  next.remove();
});

test("palette cancellation and old cleanup cannot authorize or remove a new target", () => {
  const f = fixture();
  const old = captureFormatTarget()!;
  releaseFormatTarget(old.token);
  expect(runInlineFormat("formatBold", f.id, old.token)).toBe(false);
  const removeNew = registerFormatView(
    f.view,
    f.id,
    () => true,
    () => true,
    () => undefined
  );
  f.remove();
  const next = captureFormatTarget()!;
  releaseFormatTarget(old.token);
  expect(canFormat("formatBold", next)).toBe(true);
  expect(
    isCommand({
      type: "formatBold",
      args: { documentId: f.id, token: next.token },
    })
  ).toBe(true);
  expect(
    isCommand({
      type: "formatBold",
      args: { documentId: f.id, token: "-".repeat(36) },
    })
  ).toBe(false);
  expect(
    isCommand({ type: "formatBold", args: { documentId: f.id, other: true } })
  ).toBe(false);
  removeNew();
});
test("local keys preserve existing shortcuts, consume permission denial, and avoid composition", () => {
  const f = fixture();
  const event = {
    key: "B",
    metaKey: true,
    shiftKey: true,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
  } as KeyboardEvent;
  expect(handleFormatKey(event, f.view)).toBe(true);
  expect(f.commands[0]).toEqual({
    type: "formatBold",
    args: { documentId: f.id },
  });
  expect(isCommand(f.commands[0])).toBe(true);
  f.permission(false);
  expect(handleFormatKey(event, f.view)).toBe(true);
  expect(f.commands).toHaveLength(1);
  f.ordinary(false);
  expect(handleFormatKey(event, f.view)).toBe(false);
  f.ordinary(true);
  f.permission(true);
  f.fake.compositionStarted = true;
  expect(handleFormatKey(event, f.view)).toBe(false);
  f.fake.compositionStarted = false;
  expect(handleFormatKey({ ...event, shiftKey: false, key: "b" }, f.view)).toBe(
    false
  );
  expect(handleFormatKey({ ...event, shiftKey: false, key: "i" }, f.view)).toBe(
    false
  );
  expect(handleFormatKey({ ...event, key: "i" }, f.view)).toBe(true);
  expect(handleFormatKey({ ...event, shiftKey: false, key: "e" }, f.view)).toBe(
    true
  );
  expect(f.commands.map((c) => c.type)).toEqual([
    "formatBold",
    "formatItalic",
    "formatCode",
  ]);
  f.remove();
});
