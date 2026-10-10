import { isolateHistory } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";

import { MAX_DOCUMENT_BYTES } from "../shared/documents";

import { applyEditorChanges, rawText } from "./raw-buffer";

/** One literal edit through the same raw/history filters as normal typing. */
export function prepareSourceReplacement(
  state: EditorState,
  range: [number, number],
  replacement: string
) {
  const [from, to] = range;
  if (state.readOnly || from < 0 || from >= to || to > state.doc.length)
    return null;
  const changes = state.changes({ from, to, insert: replacement });
  const raw = state.field(rawText);
  const after = applyEditorChanges(raw, changes);
  if (new TextEncoder().encode(after).length > MAX_DOCUMENT_BYTES) return null;
  if (after === raw)
    return {
      transaction: null,
      position: to,
      exclude: [from, to] as [number, number],
    };
  const transaction = state.update({
    changes,
    annotations: [
      Transaction.userEvent.of("input.replace"),
      isolateHistory.of("full"),
    ],
  });
  const start = transaction.changes.mapPos(from, -1);
  const end = transaction.changes.mapPos(to, 1);
  return {
    transaction,
    position: end,
    exclude: [start, end] as [number, number],
  };
}
