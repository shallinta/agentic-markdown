import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { ChangeSet, EditorState, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import { LONG_LINE_UNITS, longLineProtection } from "./long-line-protection";
import { markdownGrammar } from "./markdown-grammar";
import type { IndentationPlan } from "./source-indentation";

export const QUOTE_INDENT_UNAVAILABLE =
  "当前引用段落或混合选区暂不支持此缩进，未修改内容";
export const QUOTE_INDENT_BUDGET =
  "相关引用结构过大，暂不能安全调整层级，未修改内容";
interface Edit {
  from: number;
  to: number;
  insert: string;
}
interface Window {
  from: number;
  to: number;
}
const reject = (): IndentationPlan => ({ reason: QUOTE_INDENT_UNAVAILABLE });
function top(node: SyntaxNode) {
  while (node.parent && node.parent.name !== "Document") node = node.parent;
  return node;
}
function depth(node: SyntaxNode) {
  let value = 0;
  for (let p = node.parent; p; p = p.parent)
    if (p.name === "Blockquote") value++;
  return value;
}
function walk(node: SyntaxNode, visit: (node: SyntaxNode) => void) {
  const cursor = node.cursor();
  do visit(cursor.node);
  while (cursor.next());
}
function prefix(text: string, count: number) {
  let end = text.startsWith("\ufeff") ? 1 : 0;
  const marks: { from: number; to: number }[] = [];
  for (let n = 0; n < count; n++) {
    const match = /^( {0,3})>( ?)/.exec(text.slice(end));
    if (!match) return undefined;
    marks.push({ from: end + match[1].length, to: end + match[0].length });
    end += match[0].length;
  }
  return { end, marks };
}
// Strip only proven enclosing quote prefixes on continuation lines. Code's own
// indentation, delimiter bytes and inline syntax remain part of the comparison.
function value(doc: Text, node: SyntaxNode, offset = 0) {
  const from = node.from + offset,
    to = node.to + offset,
    parts: string[] = [];
  for (let line = doc.lineAt(from); ;) {
    let start = Math.max(from, line.from);
    if (start === line.from && start > from && depth(node)) {
      const mark = prefix(line.text, depth(node));
      if (!mark) return undefined;
      start += mark.end;
    }
    parts.push(doc.sliceString(start, Math.min(line.to, to)));
    if (line.to >= to) break;
    line = doc.lineAt(line.to + 1);
  }
  return parts.join("\n");
}
function ancestors(
  node: SyntaxNode,
  position: (p: number, assoc: number) => number
) {
  const result: string[] = [];
  for (let p = node.parent; p; p = p.parent)
    if (p.name !== "Document" && p.name !== "Blockquote")
      result.push(`${p.name}:${position(p.from, 1)}:${position(p.to, -1)}`);
  return result.join("/");
}

/** Paragraph-unit quote consumer; non-quote input delegates to existing rules. */
export function planQuoteIndentation(
  state: EditorState,
  more: boolean
): IndentationPlan | undefined {
  const tree = syntaxTree(state),
    selected = new Map<number, SyntaxNode>();
  const containers = new Map<number, SyntaxNode>();
  let outside = false,
    quoteSeen = false;
  for (const range of state.selection.ranges) {
    let rangeParagraph = false,
      rangeSeparator = false;
    let last = state.doc.lineAt(range.to).number;
    if (!range.empty && range.to === state.doc.line(last).from) last--;
    for (let n = state.doc.lineAt(range.from).number; n <= last; n++) {
      const line = state.doc.line(n);
      if (/^(?:\ufeff)? {0,3}(?:> ?)+$/.test(line.text)) {
        let context: SyntaxNode | null = tree.resolveInner(line.to, -1);
        let quoted = false,
          forbidden = false;
        while (context) {
          if (context.name === "Blockquote") quoted = true;
          if (/^(?:FencedCode|CodeBlock|HTMLBlock)$/.test(context.name))
            forbidden = true;
          context = context.parent;
        }
        if (quoted && !forbidden) {
          quoteSeen = true;
          rangeSeparator = true;
          continue;
        }
      }
      const lead = /^(?:\ufeff)?(?: {0,3}> ?)+/.exec(line.text);
      let node: SyntaxNode | null = tree.resolveInner(
        Math.min(
          Math.max(line.from, line.to - 1),
          Math.max(range.from, line.from + (lead?.[0].length ?? 0))
        ),
        1
      );
      while (node && node.name !== "Paragraph") {
        if (node.name === "Blockquote") quoteSeen = true;
        node = node.parent;
      }
      if (!node || node.to < line.from || !depth(node)) {
        outside = true;
        continue;
      }
      quoteSeen = true;
      let parent = node.parent;
      while (parent?.name === "Blockquote") parent = parent.parent;
      if (parent?.name !== "Document") return reject();
      selected.set(node.from, node);
      rangeParagraph = true;
      containers.set(top(node).from, top(node));
    }
    if (rangeSeparator && !rangeParagraph) return reject();
  }
  if (!quoteSeen) return undefined;
  if (!selected.size || outside || state.readOnly) return reject();
  const windows: Window[] = [];
  for (const block of containers.values()) {
    const first = block.prevSibling ?? block,
      last = block.nextSibling ?? block;
    windows.push({ from: state.doc.lineAt(first.from).from, to: last.to });
  }
  windows.sort((a, b) => a.from - b.from);
  const merged: Window[] = [];
  for (const w of windows) {
    const previous = merged[merged.length - 1];
    if (previous && w.from <= previous.to)
      previous.to = Math.max(previous.to, w.to);
    else merged.push({ ...w });
  }
  const units = merged.reduce((sum, w) => sum + w.to - w.from, 0);
  if (units > LONG_LINE_UNITS) return { reason: QUOTE_INDENT_BUDGET };
  if (
    merged.some(
      (w) =>
        !syntaxTreeAvailable(state, w.to) ||
        state
          .field(longLineProtection)
          .some((p) => p.from <= w.to && p.to >= w.from)
    )
  )
    return reject();
  const edits: Edit[] = [];
  let projected = units;
  for (const paragraph of selected.values()) {
    const d = depth(paragraph);
    for (
      let n = state.doc.lineAt(paragraph.from).number;
      n <= state.doc.lineAt(paragraph.to).number;
      n++
    ) {
      const line = state.doc.line(n),
        p = prefix(line.text, d);
      if (!p || line.text.slice(p.end).startsWith("\t")) return reject();
      const mark = p.marks[d - 1];
      projected += more ? 2 : mark.from - mark.to;
      if (projected > LONG_LINE_UNITS) return { reason: QUOTE_INDENT_BUDGET };
      edits.push({
        from: line.from + mark.from,
        to: line.from + (more ? mark.from : mark.to),
        insert: more ? "> " : "",
      });
    }
  }
  edits.sort((a, b) => a.from - b.from);
  for (let i = 1; i < edits.length; i++)
    if (edits[i].from <= edits[i - 1].from) return reject();
  const repairBoundaries = new Set<number>();
  function validate(changes: ChangeSet, collect = false) {
    if (
      merged.reduce(
        (sum, w) => sum + changes.mapPos(w.to, 1) - changes.mapPos(w.from, -1),
        0
      ) > LONG_LINE_UNITS
    )
      return false;
    const next = changes.apply(state.doc);
    let windowsValid = true;
    for (const w of merged) {
      const start = changes.mapPos(w.from, -1),
        end = changes.mapPos(w.to, 1);
      const text = next.sliceString(start, end),
        bom = text.startsWith("\ufeff") ? 1 : 0;
      const parsed = markdownGrammar.parse(text.slice(bom)),
        offset = start + bom;
      const actual = new Map<string, SyntaxNode>();
      walk(parsed.topNode, (node) => {
        if (!/^(?:Document|Blockquote|QuoteMark)$/.test(node.name))
          actual.set(
            `${node.name}:${node.from + offset}:${node.to + offset}`,
            node
          );
      });
      let valid = true;
      tree.iterate({
        from: w.from,
        to: w.to,
        enter(ref) {
          const old = ref.node;
          if (
            old.from < w.from ||
            old.to > w.to ||
            /^(?:Document|Blockquote|QuoteMark)$/.test(old.name)
          )
            return;
          const key = `${old.name}:${changes.mapPos(old.from, 1)}:${changes.mapPos(old.to, -1)}`,
            node = actual.get(key);
          if (
            collect &&
            !node &&
            old.name === "Paragraph" &&
            selected.has(old.from)
          ) {
            const from = changes.mapPos(old.from, 1),
              to = changes.mapPos(old.to, -1);
            for (const candidate of actual.values())
              if (
                candidate.name === "Paragraph" &&
                candidate.from + offset <= from &&
                candidate.to + offset >= to
              ) {
                if (candidate.from + offset < from)
                  repairBoundaries.add(state.doc.lineAt(old.from).from);
                if (candidate.to + offset > to)
                  repairBoundaries.add(state.doc.lineAt(old.to).to + 1);
              }
          }
          let target = old;
          while (target.parent && target.name !== "Paragraph")
            target = target.parent;
          const delta =
            selected.has(target.from) && target.name === "Paragraph"
              ? more
                ? 1
                : -1
              : 0;
          if (
            !node ||
            depth(node) !== depth(old) + delta ||
            ancestors(old, (p, a) => changes.mapPos(p, a)) !==
              ancestors(node, (p) => p + offset)
          )
            valid = false;
          else if (
            !old.firstChild ||
            /^(?:Paragraph|FencedCode|CodeBlock|HTMLBlock|ATXHeading[1-6]|SetextHeading[12])$/.test(
              old.name
            )
          ) {
            const original = value(state.doc, old),
              candidate = value(next, node, offset);
            if (
              original === undefined ||
              candidate === undefined ||
              original !== candidate
            )
              valid = false;
          }
          actual.delete(key);
        },
      });
      if (!valid || actual.size) {
        windowsValid = false;
        if (!collect) return false;
      }
    }
    return windowsValid;
  }
  if (validate(state.changes(edits), true)) return { changes: edits };
  if (!repairBoundaries.size) return reject();
  // One bounded repair candidate: separate each changed paragraph at its new
  // parent depth. Never return the known-invalid initial candidate on failure.
  const blanks = new Map<number, string>();
  for (const paragraph of selected.values()) {
    const d = depth(paragraph) + (more ? 1 : -1);
    const separator = "> ".repeat(Math.min(depth(paragraph), d));
    const first = state.doc.lineAt(paragraph.from),
      last = state.doc.lineAt(paragraph.to);
    for (const at of [
      first.from,
      last.to < state.doc.length ? last.to + 1 : -1,
    ]) {
      if (at <= 0 || !repairBoundaries.has(at) || blanks.has(at)) continue;
      const adjacent =
        at === first.from
          ? state.doc.line(first.number - 1)
          : state.doc.lineAt(at);
      if (!adjacent.text.trim() || /^(?: {0,3}> ?)+$/.test(adjacent.text))
        continue;
      if (projected + separator.length + 1 > LONG_LINE_UNITS)
        return { reason: QUOTE_INDENT_BUDGET };
      projected += separator.length + 1;
      blanks.set(at, separator + "\n");
    }
  }
  const repaired = edits.map((e) => ({ ...e }));
  for (const [at, insert] of blanks) {
    const edit = repaired.find((e) => e.from === at);
    if (edit) edit.insert = insert + edit.insert;
    else repaired.push({ from: at, to: at, insert });
  }
  repaired.sort((a, b) => a.from - b.from);
  return validate(state.changes(repaired)) ? { changes: repaired } : reject();
}
