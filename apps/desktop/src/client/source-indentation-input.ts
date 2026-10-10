import { toggleTabFocusMode } from "@codemirror/commands";
import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { Command } from "../shared/commands";

const targets = new WeakMap<EditorView, (event: KeyboardEvent) => boolean>();
/** Shared consumer predicate; source-prefixed command IDs remain compatible. */
export function isOrdinaryIndentation(mode: string | undefined, safe: boolean) {
  return !safe && (mode === "source" || mode === "editing");
}
export function registerIndentationView(
  view: EditorView,
  handler: (event: KeyboardEvent) => boolean
) {
  targets.set(view, handler);
  return () => {
    if (targets.get(view) === handler) targets.delete(view);
  };
}
export function handleIndentationInput(event: KeyboardEvent, view: EditorView) {
  return targets.get(view)?.(event) ?? false;
}
// Composition and tab-focus handling belong to CM, before public DOM handlers.
export const sourceIndentationInput = Prec.high(
  EditorView.domEventHandlers({ keydown: handleIndentationInput })
);

/** Preserve the existing macOS shortcut when Option changes its character. */
export function routeSourceTabFocus(
  event: Pick<
    KeyboardEvent,
    "code" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey" | "isComposing"
  >,
  view: EditorView,
  currentOrdinaryEditor: boolean,
  platform = typeof navigator === "undefined" ? "" : navigator.platform
) {
  if (
    !currentOrdinaryEditor ||
    !platform.includes("Mac") ||
    !view.hasFocus ||
    view.compositionStarted ||
    view.composing ||
    event.isComposing ||
    event.code !== "KeyM" ||
    !event.altKey ||
    !event.shiftKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return false;
  // Focus escape is not a document write: readOnly must not disable it.
  return toggleTabFocusMode(view);
}
export function routeIndentationInput(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing"
  >,
  ordinary: boolean,
  allowed: boolean,
  composing: boolean,
  documentId: string,
  execute: (command: Command) => void
) {
  if (!ordinary || composing || event.isComposing) return false;
  const tab =
    event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey;
  const bracket =
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key === "[" || event.key === "]");
  if (!tab && !bracket) return false;
  if (allowed)
    execute({
      type: (tab ? !event.shiftKey : event.key === "]")
        ? "indentSource"
        : "dedentSource",
      args: { documentId },
    });
  return true;
}
