import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { Command } from "../shared/commands";

const targets = new WeakMap<EditorView, (event: KeyboardEvent) => boolean>();

export function registerListInputView(
  view: EditorView,
  handler: (event: KeyboardEvent) => boolean
) {
  targets.set(view, handler);
  return () => {
    if (targets.get(view) === handler) targets.delete(view);
  };
}

export function handleListInput(event: KeyboardEvent, view: EditorView) {
  return targets.get(view)?.(event) ?? false;
}

// CM's own composition filtering runs before these public handlers. The cached
// extension never captures a document/controller or installs a capture listener.
export const listInputExtension = Prec.high(
  EditorView.domEventHandlers({ keydown: handleListInput })
);

/** Only attached to the current editor contentDOM, not a global Enter binding. */
export function routeListInput(
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
  if (
    !ordinary ||
    event.key !== "Enter" ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  )
    return false;
  if (composing || event.isComposing) {
    // Returning true from a CM DOM handler cancels the native default. Leave
    // composition events to CM's own lifecycle instead of claiming them.
    return false;
  }
  if (allowed)
    execute({
      type: event.shiftKey ? "listSoftBreak" : "continueList",
      args: { documentId },
    });
  return true;
}
