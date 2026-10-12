import { Prec, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { Command, NativeFormatMenu } from "../shared/commands";

import { editorFaultSession } from "./editor-fault";
import {
  inlineFormatTransaction,
  planInlineFormat,
  type InlineFormat,
} from "./inline-format";

export type FormatCommand = "formatBold" | "formatItalic" | "formatCode";
export const formatKinds: Record<FormatCommand, InlineFormat> = {
  formatBold: "bold",
  formatItalic: "italic",
  formatCode: "code",
};
export function isFormatCommand(type: string): type is FormatCommand {
  return Object.prototype.hasOwnProperty.call(formatKinds, type);
}
interface Target {
  view: EditorView;
  documentId: string;
  allowed: () => boolean;
  ordinary: () => boolean;
  execute: (command: Command) => void;
}
export interface FormatCapture {
  documentId: string;
  token: string;
}
let current: Target | undefined;
let captured: { target: Target; state: EditorState; token: string } | undefined;
const targets = new WeakMap<EditorView, Target>();
let nativeCapture:
  | {
      target: Target;
      state: EditorState;
      session: object;
      menu: NativeFormatMenu;
      valid: () => boolean;
    }
  | undefined;
let nativeSnapshot: NativeFormatMenu | null = null;
const nativeListeners = new Set<() => void>();
let nativeNotificationPending = false;
function notifyNativeMenu() {
  if (nativeNotificationPending) return;
  nativeNotificationPending = true;
  queueMicrotask(() => {
    nativeNotificationPending = false;
    for (const listener of nativeListeners) listener();
  });
}
const nativeRefreshers = new WeakMap<EditorView, () => void>();
export const getNativeFormatMenu = () => nativeSnapshot;
export function subscribeNativeFormatMenu(listener: () => void) {
  nativeListeners.add(listener);
  return () => {
    nativeListeners.delete(listener);
  };
}
function clearNativeFormat() {
  nativeCapture = undefined;
  if (nativeSnapshot === null) return;
  nativeSnapshot = null;
  notifyNativeMenu();
}

/** Strict, short-lived native menu authorization; never uses palette capture. */
export function bindNativeFormatMenu(
  view: EditorView,
  currentState: () => EditorState | undefined,
  subscribe: (listener: () => void) => () => void
) {
  let alive = true,
    composing = false;
  const target = targets.get(view);
  const session = view.state.field(editorFaultSession);
  const invalidate = () => {
    if (nativeCapture?.target === target) clearNativeFormat();
  };
  const refresh = () => {
    if (
      !alive ||
      !target ||
      !view.hasFocus ||
      composing ||
      !ready(target) ||
      !target.ordinary() ||
      currentState() !== view.state ||
      view.state.field(editorFaultSession) !== session ||
      session.fault
    ) {
      invalidate();
      return;
    }
    if (nativeCapture?.target === target && nativeCapture.state === view.state)
      return;
    invalidate();
    const menu: NativeFormatMenu = {
      documentId: target.documentId,
      token: crypto.randomUUID(),
      bold: !!planInlineFormat(view.state, "bold"),
      italic: !!planInlineFormat(view.state, "italic"),
      code: !!planInlineFormat(view.state, "code"),
    };
    nativeCapture = {
      target,
      state: view.state,
      session,
      menu,
      valid: () =>
        alive &&
        !composing &&
        currentState() === view.state &&
        view.state.field(editorFaultSession) === session &&
        !session.fault,
    };
    nativeSnapshot = Object.freeze(menu);
    notifyNativeMenu();
  };
  nativeRefreshers.set(view, refresh);
  const changed = () => {
    invalidate();
    refresh();
  };
  const start = () => {
    composing = true;
    invalidate();
  };
  const end = () => {
    composing = false;
    refresh();
  };
  const remove = subscribe(changed);
  const doc = view.contentDOM.ownerDocument;
  const win = doc.defaultView;
  view.contentDOM.addEventListener("focus", refresh);
  view.contentDOM.addEventListener("blur", invalidate);
  view.contentDOM.addEventListener("compositionstart", start, true);
  view.contentDOM.addEventListener("compositionend", end, true);
  win?.addEventListener("blur", invalidate);
  win?.addEventListener("focus", refresh);
  refresh();
  return () => {
    alive = false;
    invalidate();
    remove();
    if (nativeRefreshers.get(view) === refresh) nativeRefreshers.delete(view);
    view.contentDOM.removeEventListener("focus", refresh);
    view.contentDOM.removeEventListener("blur", invalidate);
    view.contentDOM.removeEventListener("compositionstart", start, true);
    view.contentDOM.removeEventListener("compositionend", end, true);
    win?.removeEventListener("blur", invalidate);
    win?.removeEventListener("focus", refresh);
  };
}
export function runNativeInlineFormat(
  type: FormatCommand,
  documentId: string,
  token: string
) {
  const capture = nativeCapture;
  if (capture?.menu.token !== token || capture.menu.documentId !== documentId)
    return false;
  clearNativeFormat(); // Consume before callbacks/dispatch, including failed execution.
  const { target, state, session } = capture;
  if (
    !capture.valid() ||
    !target.view.hasFocus ||
    !ready(target) ||
    !target.ordinary() ||
    target.view.state !== state ||
    state.field(editorFaultSession) !== session ||
    state.field(editorFaultSession).fault
  )
    return false;
  const tx = inlineFormatTransaction(state, formatKinds[type]);
  if (!tx) return false;
  // Publication above may synchronously change permission/state.
  if (
    !capture.valid() ||
    !target.view.hasFocus ||
    !ready(target) ||
    target.view.state !== state
  )
    return false;
  target.view.dispatch(tx);
  if (target.view.state !== tx.state) return false;
  target.view.focus();
  return true;
}

export function registerFormatView(
  view: EditorView,
  documentId: string,
  allowed: () => boolean,
  ordinary: () => boolean,
  execute: (command: Command) => void
) {
  const target = { view, documentId, allowed, ordinary, execute };
  current = target;
  targets.set(view, target);
  return () => {
    if (nativeCapture?.target === target) clearNativeFormat();
    if (current === target) current = undefined;
    if (targets.get(view) === target) targets.delete(view);
    if (captured?.target === target) captured = undefined;
  };
}
function ready(target: Target) {
  return (
    current === target &&
    targets.get(target.view) === target &&
    target.allowed() &&
    !target.view.compositionStarted &&
    !target.view.composing &&
    !target.view.state.readOnly
  );
}
export function captureFormatTarget(): FormatCapture | undefined {
  captured = undefined;
  const target = current;
  if (!target || !target.view.hasFocus || !ready(target)) return;
  const token = crypto.randomUUID();
  captured = { target, state: target.view.state, token };
  return { documentId: target.documentId, token };
}
export function releaseFormatTarget(token?: string) {
  if (captured?.token === token) captured = undefined;
}
function resolve(documentId?: string, token?: string) {
  const target = current;
  if (
    !target ||
    (documentId && target.documentId !== documentId) ||
    !ready(target)
  )
    return;
  if (token) {
    if (
      captured?.token !== token ||
      captured.target !== target ||
      captured.state !== target.view.state
    )
      return;
  } else if (!target.view.hasFocus) return;
  return target;
}
export function canFormat(type: FormatCommand, capture?: FormatCapture) {
  const target = resolve(capture?.documentId, capture?.token);
  return !!target && !!planInlineFormat(target.view.state, formatKinds[type]);
}
export function runInlineFormat(
  type: FormatCommand,
  documentId: string,
  token?: string
) {
  const target = resolve(documentId, token);
  if (!target) return false;
  const transaction = inlineFormatTransaction(
    target.view.state,
    formatKinds[type]
  );
  if (!transaction) return false;
  target.view.dispatch(transaction);
  if (target.view.state !== transaction.state) return false;
  if (token) releaseFormatTarget(token);
  target.view.focus();
  return true;
}
export function handleFormatKey(event: KeyboardEvent, view: EditorView) {
  const target = targets.get(view);
  if (
    !target ||
    !target.ordinary() ||
    !view.hasFocus ||
    event.isComposing ||
    view.compositionStarted ||
    view.composing
  )
    return false;
  if (!event.metaKey || event.ctrlKey || event.altKey) return false;
  const key = event.key.toLowerCase();
  const type =
    event.shiftKey && key === "b"
      ? "formatBold"
      : event.shiftKey && key === "i"
        ? "formatItalic"
        : !event.shiftKey && key === "e"
          ? "formatCode"
          : undefined;
  if (!type) return false;
  if (ready(target))
    target.execute({ type, args: { documentId: target.documentId } });
  return true;
}
export const inlineFormatKeys = Prec.high([
  EditorView.domEventHandlers({ keydown: handleFormatKey }),
  EditorView.updateListener.of((update) =>
    nativeRefreshers.get(update.view)?.()
  ),
]);
