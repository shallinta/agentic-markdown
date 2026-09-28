import { StateField, type EditorState } from "@codemirror/state";

import { longLineProtection } from "./long-line-protection";

// Local routing candidates from F-018j measurements, not file limits or SLOs.
// Hysteresis keeps small edits/undo near the entry boundary from restarting workers.
export const BACKGROUND_ENTER_UNITS = 512_000;
export const BACKGROUND_EXIT_UNITS = 256_000;
export const largeDocumentParsing = StateField.define<boolean>({
  create: (state) => state.doc.length >= BACKGROUND_ENTER_UNITS,
  update: (previous, transaction) =>
    transaction.docChanged
      ? transaction.newDoc.length >=
        (previous ? BACKGROUND_EXIT_UNITS : BACKGROUND_ENTER_UNITS)
      : previous,
});

/** Parsing route only; never expands long-line presentation/token protection. */
export function needsBackgroundParsing(state: EditorState): boolean {
  return (
    (state.field(largeDocumentParsing, false) ??
      state.doc.length >= BACKGROUND_ENTER_UNITS) ||
    !!state.field(longLineProtection, false)?.length
  );
}
