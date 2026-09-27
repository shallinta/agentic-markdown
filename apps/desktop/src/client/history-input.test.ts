import { expect, mock, test } from "bun:test";

import { routeHistoryInput } from "./history-input";

const documentId = "f5055cf3-d661-4d76-bd4a-6f438ba783b2";
function event(inputType: string, isComposing = false) {
  return {
    inputType,
    isComposing,
    preventDefault: mock(() => undefined),
    stopImmediatePropagation: mock(() => undefined),
  };
}
test("beforeinput history is intercepted once and routed to explicit document command", () => {
  for (const inputType of ["historyUndo", "historyRedo"]) {
    const input = event(inputType),
      execute = mock(() => undefined);
    routeHistoryInput(input, false, documentId, execute);
    expect(input.preventDefault).toHaveBeenCalledTimes(1);
    expect(input.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      type: inputType === "historyUndo" ? "undoDocument" : "redoDocument",
      args: { documentId },
    });
  }
});
test("either composition signal blocks browser/CM undo without dispatching", () => {
  for (const inputType of ["historyUndo", "historyRedo"]) {
    for (const [eventComposing, viewComposing] of [
      [true, false],
      [false, true],
      [true, true],
    ]) {
      const input = event(inputType, eventComposing),
        execute = mock(() => undefined);
      routeHistoryInput(input, viewComposing, documentId, execute);
      expect(input.preventDefault).toHaveBeenCalledTimes(1);
      expect(input.stopImmediatePropagation).toHaveBeenCalledTimes(1);
      expect(execute).not.toHaveBeenCalled();
    }
  }
});
test("ordinary composition/text/deletion beforeinput is untouched", () => {
  for (const inputType of [
    "insertCompositionText",
    "insertText",
    "deleteContentBackward",
    "insertFromPaste",
  ]) {
    const input = event(inputType, true),
      execute = mock(() => undefined);
    routeHistoryInput(input, true, documentId, execute);
    expect(input.preventDefault).not.toHaveBeenCalled();
    expect(input.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  }
});
