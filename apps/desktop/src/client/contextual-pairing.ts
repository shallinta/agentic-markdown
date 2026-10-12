import { isolateHistory } from "@codemirror/commands";
import {
  EditorSelection,
  type EditorState,
  type Transaction,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { planInlineFormat } from "./inline-format";

const pairs: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "'": "'",
  '"': '"',
};
const guards = new WeakMap<
  EditorView,
  { allowed: () => boolean; selectedInline: () => boolean }
>();
export function registerPairingView(
  view: EditorView,
  allowed: () => boolean,
  selectedInline: () => boolean = () => false
) {
  const registration = { allowed, selectedInline };
  guards.set(view, registration);
  return () => {
    if (guards.get(view) === registration) guards.delete(view);
  };
}

export function selectedCodeTransaction(state: EditorState) {
  return selectedInlineTransaction(state, "code");
}

export function selectedInlineTransaction(
  state: EditorState,
  kind: "code" | "italic"
) {
  const plan = planInlineFormat(state, kind, "wrap-only");
  return (
    plan &&
    state.update({
      ...plan,
      userEvent: "input.type",
      scrollIntoView: true,
      annotations: isolateHistory.of("full"),
    })
  );
}

export function pairingTransaction(
  state: EditorState,
  text: string
): Transaction | undefined {
  if (text.length !== 1 || !(text in pairs || ")]}".includes(text))) return;
  const close = pairs[text];
  const quote = text === "'" || text === '"';
  return state.update(
    state.changeByRange((range) => {
      if (!range.empty && close)
        return {
          changes: [
            { from: range.from, insert: text },
            { from: range.to, insert: close },
          ],
          range: EditorSelection.range(range.anchor + 1, range.head + 1),
        };
      const next = state.sliceDoc(range.head, range.head + 1);
      let escaped = false;
      if (quote && range.empty) {
        let start = range.head;
        while (start && state.sliceDoc(start - 1, start) === "\\") start--;
        escaped = (range.head - start) % 2 === 1;
      }
      if (range.empty && !escaped && next === text && (quote || !close))
        return { range: EditorSelection.cursor(range.head + 1) };
      const before = state.sliceDoc(Math.max(0, range.from - 2), range.from);
      const word = /[\p{L}\p{N}_]$/u.test(before);
      const pair =
        range.empty &&
        close &&
        !escaped &&
        (!quote || !word) &&
        (!next || /\s/u.test(next) || ")]};:>,".includes(next));
      return {
        changes: {
          from: range.from,
          to: range.to,
          insert: pair ? text + close : text,
        },
        range: EditorSelection.cursor(range.from + 1),
      };
    }),
    { userEvent: "input.type", scrollIntoView: true }
  );
}

export function handlePairingInput(
  view: EditorView,
  from: number,
  to: number,
  text: string
) {
  if (
    !guards.get(view)?.allowed() ||
    view.compositionStarted ||
    view.composing ||
    view.state.readOnly ||
    from !== view.state.selection.main.from ||
    to !== view.state.selection.main.to
  )
    return false;
  const selectedKind =
    text === "`" ? "code" : text === "*" ? "italic" : undefined;
  if (selectedKind && !guards.get(view)?.selectedInline()) return false;
  const transaction = selectedKind
    ? selectedInlineTransaction(view.state, selectedKind)
    : pairingTransaction(view.state, text);
  if (!transaction) return false;
  view.dispatch(transaction);
  return view.state === transaction.state;
}

// The cached state holds no document/view-specific closure.
export const contextualPairing = EditorView.inputHandler.of(handlePairingInput);
