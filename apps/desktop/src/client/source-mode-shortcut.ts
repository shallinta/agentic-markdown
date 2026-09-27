import type { Command } from "../shared/commands";

import { isExternalTextTarget } from "./history-target";

/** Window-scoped shortcut, never a visible menu or palette entry. */
export function routeSourceModeShortcut(
  event: Pick<
    KeyboardEvent,
    | "metaKey"
    | "ctrlKey"
    | "altKey"
    | "shiftKey"
    | "key"
    | "isComposing"
    | "repeat"
    | "preventDefault"
    | "stopPropagation"
  >,
  target: Element | null,
  modalOpen: boolean,
  enabled: boolean,
  execute: (command: Command) => void
): boolean {
  if (
    !event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    !event.shiftKey ||
    event.key.toLowerCase() !== "m" ||
    event.isComposing ||
    event.repeat ||
    modalOpen ||
    isExternalTextTarget(target) ||
    !enabled
  )
    return false;
  event.preventDefault();
  event.stopPropagation();
  execute({ type: "toggleSourceMode", args: {} });
  return true;
}
