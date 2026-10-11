import {
  getIndentUnit,
  syntaxTree,
  syntaxTreeAvailable,
} from "@codemirror/language";
import {
  countColumn,
  type ChangeSpec,
  type EditorState,
} from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import { planListIndentation } from "./list-indentation";
import { longLineProtection } from "./long-line-protection";

export const INDENT_UNAVAILABLE = "选区需完整位于已解析的顶层代码围栏内容中";
export const INDENT_BOUNDARY_CHANGE = "反缩进会改变代码围栏边界，未修改内容";
interface Fence {
  baseline: number;
  marker: string;
  length: number;
  first: number;
  last: number;
}
export type IndentationPlan =
  | { changes: ChangeSpec[]; reason?: undefined }
  | { reason: string; changes?: undefined };

function topBlock(node: SyntaxNode) {
  while (node.parent && node.parent.name !== "Document") node = node.parent;
  return node;
}

function readFence(state: EditorState, node: SyntaxNode): Fence | undefined {
  const marks = node.getChildren("CodeMark");
  if (marks.length !== 2 || !syntaxTreeAvailable(state, node.to)) return;
  const opening = state.doc.lineAt(marks[0].from),
    closing = state.doc.lineAt(marks[1].from);
  const match = /^(?:\ufeff)?( {0,3})(`{3,}|~{3,})/.exec(opening.text);
  if (!match || closing.number <= opening.number) return;
  return {
    baseline: match[1].length,
    marker: match[2][0],
    length: match[2].length,
    first: opening.number + 1,
    last: closing.number - 1,
  };
}

/** CommonMark structure tabs use four columns, independent of editor tab size. */
function codeIndent(text: string, baseline: number) {
  let index = 0,
    column = 0;
  while (
    index < text.length &&
    column < baseline &&
    (text[index] === " " || text[index] === "\t")
  ) {
    column += text[index] === "\t" ? 4 - (column % 4) : 1;
    index++;
  }
  return " ".repeat(Math.max(0, column - baseline)) + text.slice(index);
}

function closesFence(text: string, fence: Fence) {
  const match = /^( {0,3})(`+|~+)[\t ]*$/.exec(text);
  return (
    !!match &&
    match[2].startsWith(fence.marker) &&
    match[2].length >= fence.length
  );
}

/** Atomic plan only: no state advancement, parser forcing, or per-range state. */
export function planSourceIndentation(
  state: EditorState,
  more: boolean
): IndentationPlan {
  const reject = () => ({ reason: INDENT_UNAVAILABLE });
  if (state.readOnly) return reject();
  const list = planListIndentation(state, more);
  if (list) return list;
  const tree = syntaxTree(state),
    protection = state.field(longLineProtection);
  const numbers = new Set<number>(),
    fences = new Map<number, Fence>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    let last = state.doc.lineAt(range.to).number;
    if (!range.empty && range.to === state.doc.line(last).from) last--;
    for (let n = first; n <= last; n++) numbers.add(n);
  }
  const changes: ChangeSpec[] = [];
  let kind: "plain" | "fence" | undefined;
  for (const n of [...numbers].sort((a, b) => a - b)) {
    const line = state.doc.line(n);
    if (
      !syntaxTreeAvailable(state, line.to) ||
      protection.some((s) => s.from <= line.to && s.to >= line.from)
    )
      return reject();
    const block = topBlock(tree.resolveInner(line.from, 1));
    if (block.name !== "FencedCode") {
      // Only ordinary top-level paragraphs and independent blank lines consume Tab as no-op.
      if (
        block.name !== "Paragraph" &&
        !(block.name === "Document" && /^\s*$/.test(line.text))
      )
        return reject();
      if (kind === "fence") return reject();
      kind = "plain";
      continue;
    }
    if (kind === "plain") return reject();
    kind = "fence";
    let fence = fences.get(block.from);
    if (!fence) {
      fence = readFence(state, block);
      if (!fence) return reject();
      fences.set(block.from, fence);
    }
    if (n < fence.first || n > fence.last) return reject();
    const semantic = codeIndent(line.text, fence.baseline);
    const codeWhitespace = /^[\t ]*/.exec(semantic)![0];
    const before = countColumn(codeWhitespace, state.tabSize);
    const after = Math.max(0, before + (more ? 1 : -1) * getIndentUnit(state));
    if (after === before) continue;
    const rawWhitespace = /^[\t ]*/.exec(line.text)![0];
    const prefix = " ".repeat(fence.baseline + after);
    const proposed = prefix + line.text.slice(rawWhitespace.length);
    if (closesFence(proposed, fence)) return { reason: INDENT_BOUNDARY_CHANGE };
    let common = 0;
    while (
      common < prefix.length &&
      common < rawWhitespace.length &&
      prefix[common] === rawWhitespace[common]
    )
      common++;
    changes.push({
      from: line.from + common,
      to: line.from + rawWhitespace.length,
      insert: prefix.slice(common),
    });
  }
  return { changes };
}
