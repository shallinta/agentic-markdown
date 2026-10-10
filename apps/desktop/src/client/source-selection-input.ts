import type { Command } from "../shared/commands";

/** Safety fallback remains on its original single-selection input path. */
export function isOrdinarySourceSelection(mode: string, safe: boolean) {
  return mode === "source" && !safe;
}

/** Bound only to the current contentDOM, before CM's native mouse handler. */
export function guardSourceSelectionMouse(
  event: Pick<
    MouseEvent,
    "button" | "metaKey" | "preventDefault" | "stopImmediatePropagation"
  >,
  source: boolean,
  allowed: boolean
) {
  if (event.button !== 0 || !event.metaKey || !source || allowed) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

export function sourceSelectionKey(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
  >
) {
  if (
    event.key === "Escape" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  )
    return "simplifySourceSelection" as const;
  if (!event.metaKey || !event.altKey || event.ctrlKey || event.shiftKey)
    return undefined;
  if (event.key === "ArrowUp") return "addSourceCursorAbove" as const;
  if (event.key === "ArrowDown") return "addSourceCursorBelow" as const;
  return undefined;
}

/** Called only on the editor content target; handled keys never fall through to CM. */
export function routeSourceSelectionKey(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "metaKey"
    | "ctrlKey"
    | "altKey"
    | "shiftKey"
    | "isComposing"
    | "preventDefault"
    | "stopImmediatePropagation"
  >,
  source: boolean,
  allowed: boolean,
  documentId: string,
  execute: (command: Command) => void,
  composing = event.isComposing
) {
  const type = sourceSelectionKey(event);
  if (!type || !source) return false;
  if (composing || event.isComposing) {
    // Preserve the native IME's default (notably Escape), but bypass CM keymaps.
    event.stopImmediatePropagation();
    return true;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  if (allowed) execute({ type, args: { documentId } });
  return true;
}
