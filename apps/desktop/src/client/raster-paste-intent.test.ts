import { expect, test } from "bun:test";

import type { Transaction } from "@codemirror/state";

import { createRasterPasteIntent, type RasterPasteContext } from "./raster-paste-intent";
import { createRawEditorState, rawText } from "./raw-buffer";

const path = "./assets/image-a1234567-a123-4123-8123-0123456789ab.png";
const source = { handle: "handle", documentId: "document", expectedRevision: 2, expectedHash: "saved" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

function event({ trusted = true, types = ["Files"], format = "image/png", content = "abc" } = {}) {
  const file = new File([content], "fixture", { type: format });
  const data = { files: [file], types, items: [{ kind: "file" }] };
  const calls: string[] = [];
  return {
    calls,
    input: {
      isTrusted: trusted,
      defaultPrevented: false,
      clipboardData: data as unknown as DataTransfer,
      preventDefault: () => { calls.push("prevent"); },
      stopPropagation: () => { calls.push("stop"); },
    },
  };
}

const drained = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function fixture(scope = {}) {
  const initial = createRawEditorState("正文");
  let context: RasterPasteContext = {
    source, location: "/fixture/doc.md", state: initial, activation: 1, bufferRevision: 0,
  };
  let allowed = true;
  let enabled = true;
  let accept = true;
  let change: (() => void) | undefined;
  const reports: string[] = [];
  const receipts = deferred<unknown>();
  const sent: number[][] = [];
  const read = deferred<void>();
  const paste = createRasterPasteIntent(scope, {
    capture: () => context,
    transport: () => enabled ? async (payload, bytes) => {
      expect(payload).toEqual(source);
      sent.push(Array.from(bytes));
      read.resolve();
      return receipts.promise;
    } : undefined,
    authorize: () => () => ({
      current: () => allowed,
      subscribe: listener => {
        change = listener;
        return () => { change = undefined; };
      },
    }),
    dirty: () => false,
    dispatch: (transaction: Transaction) => {
      if (!accept) return false;
      context = { ...context, state: transaction.state };
      return true;
    },
    report: message => { reports.push(message); },
  });
  return {
    paste, reports, sent, receipts, read,
    current: () => context.state.field(rawText),
    enable(value: boolean) { enabled = value; },
    refuseDispatch() { accept = false; },
    select(anchor: number) { context = { ...context, state: initial.update({ selection: { anchor } }).state }; paste.check(); },
    relocate(location: string) { context = { ...context, location }; paste.check(); },
    authority(value: boolean) { allowed = value; change?.(); },
    subscribed: () => !!change,
  };
}

test("leaves existing and untrusted clipboard input alone", async () => {
  const editor = fixture();
  for (const input of [event({ trusted: false }), event({ types: ["Files", "text/html"] }), event({ format: "image/gif" })]) {
    editor.paste.paste(input.input);
    expect(input.calls).toEqual([]);
  }
  editor.enable(false);
  const disabled = event();
  editor.paste.paste(disabled.input);
  expect(disabled.calls).toEqual([]);
  await drained();
  expect(editor.sent).toEqual([]);
  expect(editor.reports).toEqual([]);
});

test("sends one exact copy and applies the confirmed link through the supplied dispatcher", async () => {
  const editor = fixture();
  const accepted = event();
  editor.paste.paste(accepted.input);
  expect(accepted.calls).toEqual(["prevent", "stop"]);
  await editor.read.promise;
  expect(editor.sent).toEqual([[97, 98, 99]]);
  expect(editor.current()).toBe("正文");
  editor.receipts.resolve({ ok: true, relativePath: path });
  await drained();
  expect(editor.current()).toBe(`![图片](${path})正文`);
  expect(editor.reports).toEqual([]);
  expect(editor.subscribed()).toBe(false);
});

test("never revives a retired selection, IME/view lifetime or workspace authority", async () => {
  for (const retire of [
    (editor: ReturnType<typeof fixture>) => { editor.select(1); editor.select(0); },
    (editor: ReturnType<typeof fixture>) => { editor.relocate("/fixture/elsewhere.md"); editor.relocate("/fixture/doc.md"); },
    (editor: ReturnType<typeof fixture>) => { editor.authority(false); editor.authority(true); },
    (editor: ReturnType<typeof fixture>) => editor.paste.invalidate(),
    (editor: ReturnType<typeof fixture>) => editor.paste.dispose(),
  ]) {
    const scope = {};
    const editor = fixture(scope);
    editor.paste.paste(event().input);
    await editor.read.promise;
    retire(editor);
    const next = fixture(scope);
    next.paste.paste(event().input);
    expect(next.reports).toEqual(["busy"]);
    editor.receipts.resolve({ ok: true, relativePath: path });
    await drained();
    expect(editor.current()).toBe("正文");
    expect(editor.reports).toEqual(["unlinked"]);
    expect(editor.subscribed()).toBe(false);
    next.paste.paste(event().input);
    await next.read.promise;
    next.receipts.resolve({ ok: true, relativePath: path });
    await drained();
    expect(next.current()).toBe(`![图片](${path})正文`);
  }
});

test("never inserts on an unknown reply, refused dispatch or cancellation before sending", async () => {
  for (const [receipt, refuses, expected] of [
    [undefined, false, "unknown"],
    [{ ok: false, error: "UNKNOWN" }, false, "unknown"],
    [{ ok: true, relativePath: path + "\n" }, false, "unknown"],
    [{ ok: false, error: "STALE" }, false, "rejected"],
    [{ ok: true, relativePath: path }, true, "unlinked"],
  ] as const) {
    const editor = fixture();
    if (refuses) editor.refuseDispatch();
    editor.paste.paste(event().input);
    await editor.read.promise;
    editor.receipts.resolve(receipt);
    await drained();
    expect(editor.current()).toBe("正文");
    expect(editor.reports).toEqual([expected]);
  }
  const editor = fixture();
  editor.paste.paste(event().input);
  editor.paste.invalidate();
  await drained();
  expect(editor.sent).toEqual([]);
  expect(editor.subscribed()).toBe(false);
});
