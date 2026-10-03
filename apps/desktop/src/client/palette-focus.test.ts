import { expect, test } from "bun:test";

import { restorePaletteFocus } from "./palette-focus";

test("palette focus restoration preserves scrolled viewport before queued mode capture", async () => {
  let viewport = 900;
  const editorTarget = {
    isConnected: true,
    focus(options?: FocusOptions) {
      // Browser focus is allowed to scroll the active caret (at document start)
      // into view unless preventScroll is requested. This models that branch;
      // the actual WK symptom is separately reproduced by the UI verifier.
      if (!options?.preventScroll) viewport = 0;
    },
  };
  restorePaletteFocus(editorTarget);
  const captured = await new Promise<number>((resolve) =>
    queueMicrotask(() => resolve(viewport))
  );
  expect(captured).toBe(900);
});

test("palette restores connected target focus but never focuses a detached target", () => {
  let calls = 0;
  restorePaletteFocus({
    isConnected: true,
    focus(options) {
      calls++;
      expect(options).toEqual({ preventScroll: true });
    },
  });
  restorePaletteFocus({
    isConnected: false,
    focus() {
      calls++;
    },
  });
  restorePaletteFocus(null);
  expect(calls).toBe(1);
});
