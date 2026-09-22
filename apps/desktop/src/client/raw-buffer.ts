import {
  history,
  invertedEffects,
  defaultKeymap,
  historyKeymap,
} from "@codemirror/commands";
import {
  EditorState,
  StateEffect,
  StateField,
  type ChangeSet,
  type Extension,
} from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";

/** CM coordinates count every line separator once; raw bytes stay authoritative. */
export function editorText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n");
}

export function rawOffset(raw: string, editorOffset: number): number {
  let cursor = 0;
  let offset = 0;
  while (cursor < raw.length && offset < editorOffset) {
    if (raw[cursor] === "\r" && raw[cursor + 1] === "\n") cursor++;
    cursor++;
    offset++;
  }
  return cursor;
}

function contextualSeparator(raw: string, offset: number): string {
  // Prefer the current line's terminator, then the previous terminator.
  for (let cursor = offset; cursor < raw.length; cursor++) {
    if (raw[cursor] === "\r" && raw[cursor + 1] === "\n") return "\r\n";
    if (raw[cursor] === "\n") return "\n";
    if (raw[cursor] === "\r") break;
  }
  for (let cursor = offset - 1; cursor >= 0; cursor--) {
    if (raw[cursor] === "\n") return raw[cursor - 1] === "\r" ? "\r\n" : "\n";
  }
  return "\n";
}

/** Replace changed spans only. Untouched BOM, CRLF, lone CR and EOF survive. */
export function applyEditorChanges(raw: string, changes: ChangeSet): string {
  const pieces: string[] = [];
  let previous = 0;
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    const start = rawOffset(raw, from);
    const end = rawOffset(raw, to);
    pieces.push(raw.slice(previous, start));
    pieces.push(
      inserted.toString().replace(/\n/g, contextualSeparator(raw, start))
    );
    previous = end;
  });
  pieces.push(raw.slice(previous));
  return pieces.join("");
}

interface RawPatch {
  from: number;
  to: number;
  insert: string;
}
// History effects are replayed in reverse chronological order. These offsets are
// raw coordinates, deliberately not mapped through CM's normalized coordinates.
const restoreRaw = StateEffect.define<RawPatch>();
export const rawText = StateField.define<string>({
  create: () => "",
  update(raw, transaction) {
    const restores = transaction.effects.filter((effect) =>
      effect.is(restoreRaw)
    );
    if (restores.length) {
      for (const effect of restores) {
        const patch = effect.value;
        raw = raw.slice(0, patch.from) + patch.insert + raw.slice(patch.to);
      }
      return raw;
    }
    return transaction.docChanged
      ? applyEditorChanges(raw, transaction.changes)
      : raw;
  },
});
function inversePatch(before: string, after: string): RawPatch {
  let from = 0;
  while (
    from < before.length &&
    from < after.length &&
    before[from] === after[from]
  )
    from++;
  let endBefore = before.length,
    endAfter = after.length;
  while (
    endBefore > from &&
    endAfter > from &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore--;
    endAfter--;
  }
  return { from, to: endAfter, insert: before.slice(from, endBefore) };
}
export function createRawEditorState(
  raw: string,
  extensions: Extension = []
): EditorState {
  return EditorState.create({
    doc: editorText(raw),
    extensions: [
      rawText.init(() => raw),
      EditorState.transactionFilter.of((transaction) => {
        if (
          !transaction.docChanged ||
          transaction.effects.some((effect) => effect.is(restoreRaw))
        )
          return transaction;
        const before = transaction.startState.field(rawText);
        const after = applyEditorChanges(before, transaction.changes);
        const normalized = editorText(after);
        const proposed = transaction.newDoc.toString();
        if (normalized === proposed) return transaction;
        // A deletion can join a formerly lone CR and LF into a single CRLF.
        // Reconcile only the differing CM span, while explicitly retaining the
        // intended raw edit. CM then maps selection/history through this fix.
        return [
          transaction,
          {
            changes: inversePatch(normalized, proposed),
            sequential: true,
            effects: restoreRaw.of(inversePatch(after, before)),
          },
        ];
      }),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      // Native DOM selection is hidden while the tab button owns focus. Draw
      // the saved CM range without stealing keyboard focus on tab activation.
      drawSelection(),
      EditorView.theme({
        "&": {
          height: "100%",
          backgroundColor: "var(--background)",
          color: "var(--foreground)",
        },
        ".cm-scroller": { overflow: "auto", fontFamily: "monospace" },
        ".cm-content": { padding: "16px", caretColor: "var(--foreground)" },
        ".cm-cursor": { borderLeftColor: "var(--foreground)" },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          backgroundColor:
            "color-mix(in oklab, var(--foreground) 20%, var(--background))",
        },
      }),
      invertedEffects.of((transaction) => {
        if (!transaction.docChanged) return [];
        return [
          restoreRaw.of(
            inversePatch(
              transaction.startState.field(rawText),
              transaction.state.field(rawText)
            )
          ),
        ];
      }),
      extensions,
    ],
  });
}
