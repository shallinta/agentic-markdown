import type { Command } from "../shared/commands";

/** Capture before CM's history extension and native DOM undo can consume it. */
export function routeHistoryInput(
  event: Pick<
    InputEvent,
    "inputType" | "isComposing" | "preventDefault" | "stopImmediatePropagation"
  >,
  composing: boolean,
  documentId: string,
  execute: (command: Command) => void
): void {
  if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo")
    return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.isComposing || composing) return;
  execute({
    type: event.inputType === "historyUndo" ? "undoDocument" : "redoDocument",
    args: { documentId },
  });
}
