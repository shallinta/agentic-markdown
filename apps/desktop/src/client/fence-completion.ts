import { isolateHistory } from "@codemirror/commands";
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { Transaction, type EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import { editorFaultSession, type EditorFaultSession } from "./editor-fault";
import { LONG_LINE_UNITS, longLineProtection } from "./long-line-protection";

/** Stronger ownership check only for the new completion, not legacy Enter. */
export function isCurrentFenceCompletion(
  state: EditorState,
  current: EditorState | undefined,
  session: EditorFaultSession,
  ordinary: boolean
) {
  return (
    ordinary &&
    state === current &&
    state.field(editorFaultSession) === session &&
    !session.fault
  );
}

/** One EOF-only transaction, or undefined to preserve the existing Enter path. */
export function fenceCompletionTransaction(
  state: EditorState,
  soft: boolean
): Transaction | undefined {
  const { ranges, main } = state.selection;
  const end = state.doc.length;
  if (
    soft ||
    state.readOnly ||
    ranges.length !== 1 ||
    !main.empty ||
    main.head !== end
  )
    return;
  const line = state.doc.lineAt(end);
  if (
    line.length >= LONG_LINE_UNITS ||
    !syntaxTreeAvailable(state, end) ||
    state
      .field(longLineProtection)
      .some((span) => span.from <= end && span.to >= line.from)
  )
    return;
  const match = /^(\ufeff?)( {0,3})(`{3,}|~{3,})(.*)$/.exec(line.text);
  if (!match || (match[1] && line.from !== 0)) return;
  const markFrom = line.from + match[1].length + match[2].length;
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(end, -1);
  while (node && node.name !== "FencedCode") node = node.parent;
  if (
    !node ||
    node.parent?.name !== "Document" ||
    node.to !== end ||
    state.doc.lineAt(node.from).number !== line.number
  )
    return;
  const marks = node.getChildren("CodeMark");
  if (
    marks.length !== 1 ||
    marks[0].from !== markFrom ||
    marks[0].to !== markFrom + match[3].length
  )
    return;
  // Check derived growth before concatenation; the controller still owns the
  // final raw UTF-8 file-size limit and may refuse the complete transaction.
  if (2 + match[2].length * 2 + match[3].length > LONG_LINE_UNITS) return;
  return state.update({
    changes: {
      from: end,
      insert: "\n" + match[2] + "\n" + match[2] + match[3],
    },
    selection: { anchor: end + 1 + match[2].length },
    annotations: [
      isolateHistory.of("full"),
      Transaction.userEvent.of("input.complete"),
    ],
    scrollIntoView: true,
  });
}
