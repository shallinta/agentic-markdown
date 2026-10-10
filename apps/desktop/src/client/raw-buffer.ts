import { history, invertedEffects, defaultKeymap } from "@codemirror/commands";
import {
  EditorState,
  Compartment,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";

import { largeDocumentParsing } from "./background-parsing";
import { contextualPairing } from "./contextual-pairing";
import { createEditorModeExtensions } from "./editor-mode";
import { inlineFormatKeys } from "./inline-format-input";
import { listInputExtension } from "./list-input";
import { longLineProtection } from "./long-line-protection";
import { applyRawChanges } from "./raw-changes";
import { sourceIndentationInput } from "./source-indentation-input";

export const sourceSearchPresentation = new Compartment();

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

/** Map raw UTF-16 offsets back to CM's LF coordinates, retaining BOM. */
export function editorOffset(raw: string, rawPosition: number): number {
  const end = Math.max(0, Math.min(raw.length, rawPosition));
  let offset = 0;
  for (let cursor = 0; cursor < end; cursor++, offset++)
    if (raw[cursor] === "\r" && raw[cursor + 1] === "\n" && cursor + 1 < end)
      cursor++;
  return offset;
}

/** Replace changed spans only. Untouched BOM, CRLF, lone CR and EOF survive. */
export const applyEditorChanges = applyRawChanges;

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
export const writePermission = new Compartment();
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
  extensions: Extension = [],
  isolated = false
): EditorState {
  return EditorState.create({
    doc: editorText(raw),
    extensions: [
      sourceSearchPresentation.of([]),
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
      isolated ? [] : contextualPairing,
      isolated ? [] : listInputExtension,
      isolated ? [] : sourceIndentationInput,
      isolated ? [] : inlineFormatKeys,
      longLineProtection,
      largeDocumentParsing,
      createEditorModeExtensions(isolated),
      writePermission.of(EditorState.readOnly.of(false)),
      // Source cursor commands are routed through the unified registry by the view.
      keymap.of(
        defaultKeymap.filter(
          (binding) =>
            binding.key !== "Mod-Alt-ArrowUp" &&
            binding.key !== "Mod-Alt-ArrowDown"
        )
      ),
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
        // Match the focused base rule's specificity; a shorter selector loses
        // to CM's default light lavender even when app color variables are dark.
        ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
          {
            backgroundColor:
              "color-mix(in oklab, var(--foreground) 20%, var(--background))",
          },
      }),
      invertedEffects.of((transaction) => {
        const before = transaction.startState.field(rawText);
        const after = transaction.state.field(rawText);
        return before === after
          ? []
          : [restoreRaw.of(inversePatch(before, after))];
      }),
      extensions,
    ],
  });
}
