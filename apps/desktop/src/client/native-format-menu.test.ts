import { expect, test } from "bun:test";

import { EditorSelection, type Transaction } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";

import { isCommand, isNativeFormatMenu } from "../shared/commands";

import {
  bindNativeFormatMenu,
  getNativeFormatMenu,
  registerFormatView,
  runNativeInlineFormat,
  subscribeNativeFormatMenu,
} from "./inline-format-input";
import { createRawEditorState } from "./raw-buffer";

function fixture() {
  const win = new EventTarget();
  const dom = Object.assign(new EventTarget(), {
    ownerDocument: { defaultView: win },
  });
  const fake = {
    state: createRawEditorState("abc").update({
      selection: EditorSelection.range(0, 3),
    }).state,
    contentDOM: dom,
    hasFocus: true,
    composing: false,
    compositionStarted: false,
    dispatch(tx: Transaction) {
      this.state = tx.state;
    },
    focus() {
      this.hasFocus = true;
    },
  };
  let state = fake.state,
    allowed = true,
    ordinary = true;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  const id = crypto.randomUUID(),
    view = fake as unknown as EditorView;
  const unregister = registerFormatView(
    view,
    id,
    () => allowed,
    () => ordinary,
    () => undefined
  );
  const unbind = bindNativeFormatMenu(
    view,
    () => state,
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  );
  return {
    fake,
    dom,
    win,
    id,
    changed,
    permission(v: boolean) {
      allowed = v;
      changed();
    },
    mode(v: boolean) {
      ordinary = v;
      changed();
    },
    setState(next: typeof state) {
      state = next;
      fake.state = next;
      changed();
    },
    selectionOnly(next: typeof state) {
      state = next;
      fake.state = next;
      for (const listener of next.facet(EditorView.updateListener))
        listener({ view, state: next } as ViewUpdate);
    },
    remove() {
      unbind();
      unregister();
    },
  };
}
test("native tickets are single-use and never borrow palette focus exemption", () => {
  const f = fixture(),
    ticket = getNativeFormatMenu()!;
  expect(isNativeFormatMenu(ticket)).toBe(true);
  expect(ticket.bold).toBe(true);
  expect(runNativeInlineFormat("formatBold", f.id, ticket.token)).toBe(true);
  expect(f.fake.state.doc.toString()).toBe("**abc**");
  expect(runNativeInlineFormat("formatBold", f.id, ticket.token)).toBe(false);
  f.remove();
  const g = fixture(),
    second = getNativeFormatMenu()!;
  g.fake.hasFocus = false;
  expect(runNativeInlineFormat("formatBold", g.id, second.token)).toBe(false);
  g.fake.hasFocus = true;
  expect(runNativeInlineFormat("formatBold", g.id, second.token)).toBe(false);
  g.remove();
});
test("blur, composition, permission, mode and state ABA invalidate native tickets synchronously", () => {
  for (const kind of [
    "blur",
    "window",
    "composition",
    "permission",
    "mode",
    "state",
  ]) {
    const f = fixture(),
      ticket = getNativeFormatMenu()!,
      original = f.fake.state;
    if (kind === "blur") {
      f.dom.dispatchEvent(new Event("blur"));
      f.dom.dispatchEvent(new Event("focus"));
    }
    if (kind === "window") {
      f.win.dispatchEvent(new Event("blur"));
      f.win.dispatchEvent(new Event("focus"));
    }
    if (kind === "composition") {
      f.dom.dispatchEvent(new Event("compositionstart"));
      f.dom.dispatchEvent(new Event("compositionend"));
    }
    if (kind === "permission") {
      f.permission(false);
      f.permission(true);
    }
    if (kind === "mode") {
      f.mode(false);
      f.mode(true);
    }
    if (kind === "state") {
      f.setState(original.update({ selection: { anchor: 0 } }).state);
      f.setState(original);
    }
    expect(runNativeInlineFormat("formatBold", f.id, ticket.token)).toBe(false);
    expect(f.fake.state.doc.toString()).toBe("abc");
    expect(getNativeFormatMenu()?.token).not.toBe(ticket.token);
    f.remove();
    expect(getNativeFormatMenu()).toBeNull();
    f.dom.dispatchEvent(new Event("focus"));
    expect(getNativeFormatMenu()).toBeNull();
  }
});
test("presentation coalesces same-turn invalidation and issuance without retaining old authority", async () => {
  const f = fixture(),
    ticket = getNativeFormatMenu()!;
  await Promise.resolve();
  const notices: unknown[] = [];
  const stop = subscribeNativeFormatMenu(() =>
    notices.push(getNativeFormatMenu())
  );
  f.changed();
  expect(runNativeInlineFormat("formatBold", f.id, ticket.token)).toBe(false);
  expect(notices).toHaveLength(0);
  await Promise.resolve();
  expect(notices).toEqual([getNativeFormatMenu()]);
  expect(f.fake.state.doc.toString()).toBe("abc");
  stop();
  f.remove();
});
test("native schema excludes mixed tokens and malformed menu data", () => {
  const f = fixture(),
    ticket = getNativeFormatMenu()!;
  expect(
    isCommand({
      type: "formatBold",
      args: { documentId: f.id, nativeToken: ticket.token },
    })
  ).toBe(true);
  expect(
    isCommand({
      type: "formatBold",
      args: {
        documentId: f.id,
        nativeToken: ticket.token,
        token: ticket.token,
      },
    })
  ).toBe(false);
  expect(isNativeFormatMenu({ ...ticket, extra: true })).toBe(false);
  expect(isNativeFormatMenu({ ...ticket, bold: "true" })).toBe(false);
  expect(isNativeFormatMenu(Object.assign([], ticket))).toBe(false);
  f.remove();
});

test("actual installed update listener rejects selection-only stale tickets and old cleanup does not remove a replacement view", () => {
  const f = fixture(),
    ticket = getNativeFormatMenu()!;
  f.selectionOnly(f.fake.state.update({ selection: { anchor: 1 } }).state);
  expect(getNativeFormatMenu()?.token).not.toBe(ticket.token);
  expect(runNativeInlineFormat("formatBold", f.id, ticket.token)).toBe(false);
  const g = fixture(),
    next = getNativeFormatMenu()!;
  f.remove();
  expect(getNativeFormatMenu()).toEqual(next);
  expect(runNativeInlineFormat("formatBold", f.id, ticket.token)).toBe(false);
  expect(runNativeInlineFormat("formatBold", g.id, next.token)).toBe(true);
  g.remove();
});
