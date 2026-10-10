import { Prec, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { Command } from "../shared/commands";

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
export const inlineFormatKeys = Prec.high(
  EditorView.domEventHandlers({ keydown: handleFormatKey })
);
