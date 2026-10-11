import { commonmarkLanguage } from "@codemirror/lang-markdown";
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { type EditorState, type Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import { LONG_LINE_UNITS, longLineProtection } from "./long-line-protection";
import type { IndentationPlan } from "./source-indentation";

export const LIST_INDENT_UNAVAILABLE =
  "当前列表结构或混合选区暂不支持此缩进，未修改内容";
export const LIST_INDENT_BUDGET =
  "相关列表结构过大，暂不能安全调整层级，未修改内容";
const isList = (node: SyntaxNode) =>
  node.name === "BulletList" || node.name === "OrderedList";
const reject = (): IndentationPlan => ({ reason: LIST_INDENT_UNAVAILABLE });

interface Item {
  node: SyntaxNode;
  parent: number | null;
  list: number;
  marker: number;
  base: number;
  content: number;
}
interface Window {
  from: number;
  to: number;
}
interface Edit {
  from: number;
  to: number;
  insert: string;
}
function walk(node: SyntaxNode, visit: (node: SyntaxNode) => void) {
  const cursor = node.cursor();
  do visit(cursor.node);
  while (cursor.next());
}
function parentItem(node: SyntaxNode): SyntaxNode | null {
  for (let p = node.parent; p; p = p.parent)
    if (p.name === "ListItem") return p;
  return null;
}
function top(node: SyntaxNode) {
  while (node.parent && node.parent.name !== "Document") node = node.parent;
  return node;
}

/** Strip only the enclosing item's structural prefix, never code indentation. */
function blockValue(doc: Text, node: SyntaxNode, offset = 0) {
  const parent = parentItem(node);
  let content = 0;
  if (parent) {
    const line = doc.lineAt(parent.from + offset);
    const match = /^(?:\ufeff)?( *)(?:[-+*]|\d+[.)])([ ]+|$)/.exec(line.text);
    if (!match) return undefined;
    content = match[0].length - (line.text.startsWith("\ufeff") ? 1 : 0);
  }
  const from = node.from + offset,
    to = node.to + offset;
  const parts: string[] = [];
  for (let line = doc.lineAt(from); line.from <= to;) {
    const start = Math.max(from, line.from),
      end = Math.min(to, line.to);
    let value = doc.sliceString(start, end);
    if (start === line.from && start > from)
      value = value.slice(Math.min(content, /^ */.exec(value)![0].length));
    parts.push(value);
    if (line.to >= to) break;
    line = doc.lineAt(line.to + 1);
  }
  return parts.join("\n");
}

/** Undefined delegates non-list selections to the existing fence/paragraph consumer. */
export function planListIndentation(
  state: EditorState,
  more: boolean
): IndentationPlan | undefined {
  const tree = syntaxTree(state);
  const selected = new Map<number, SyntaxNode>();
  const containers = new Map<number, SyntaxNode>();
  let outside = false;
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    let last = state.doc.lineAt(range.to).number;
    if (!range.empty && range.to === state.doc.line(last).from) last--;
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n);
      const prefix = /^(?:\ufeff)?[ \t]*/.exec(line.text)![0].length;
      let node: SyntaxNode | null = tree.resolveInner(
        Math.min(line.to, line.from + prefix),
        1
      );
      let forbidden = false;
      while (node && node.name !== "ListItem") {
        if (/^(?:FencedCode|CodeBlock|HTMLBlock|Blockquote)$/.test(node.name))
          forbidden = true;
        node = node.parent;
      }
      if (!node) {
        outside = true;
        continue;
      }
      if (forbidden || !isList(top(node))) return reject();
      selected.set(node.from, node);
      containers.set(top(node).from, top(node));
    }
  }
  if (!selected.size) return undefined;
  if (outside || state.readOnly) return reject();

  // Complete adjacent blocks are context, not targets. This prevents local parses
  // from silently swallowing a block just outside the changed list.
  const windows: Window[] = [];
  for (const block of containers.values()) {
    const first = block.prevSibling ?? block;
    const last = block.nextSibling ?? block;
    windows.push({
      from: state.doc.lineAt(first.from).from,
      to: last.to,
    });
  }
  windows.sort((a, b) => a.from - b.from);
  const merged: Window[] = [];
  for (const window of windows) {
    const previous = merged[merged.length - 1];
    if (previous && window.from <= previous.to)
      previous.to = Math.max(previous.to, window.to);
    else merged.push({ ...window });
  }
  let projectedUnits = merged.reduce((sum, w) => sum + w.to - w.from, 0);
  if (projectedUnits > LONG_LINE_UNITS) return { reason: LIST_INDENT_BUDGET };
  const protection = state.field(longLineProtection);
  if (
    merged.some(
      (w) =>
        !syntaxTreeAvailable(state, w.to) ||
        protection.some((p) => p.from <= w.to && p.to >= w.from)
    )
  )
    return reject();

  const items = new Map<number, Item>();
  for (const block of containers.values())
    walk(block, (node) => {
      if (node.name !== "ListItem") return;
      const mark = node.getChild("ListMark");
      const line = state.doc.lineAt(node.from);
      const prefix = /^(\ufeff?)( *)([-+*]|\d+[.)])([ \t]+|$)/.exec(line.text);
      if (!mark || !prefix || prefix[4].includes("\t")) return;
      items.set(node.from, {
        node,
        parent: parentItem(node)?.from ?? null,
        list: node.parent!.from,
        marker: mark.from,
        base: prefix[2].length,
        content: prefix[2].length + prefix[3].length + (prefix[4].length || 1),
      });
    });
  const roots = [...selected.values()].filter((node) => {
    for (let parent = parentItem(node); parent; parent = parentItem(parent))
      if (selected.has(parent.from)) return false;
    return true;
  });
  const groups = new Map<number, Item[]>();
  for (const root of roots) {
    const item = items.get(root.from);
    if (!item) return reject();
    const group = groups.get(item.list) ?? [];
    group.push(item);
    groups.set(item.list, group);
  }
  const expectedParents = new Map(
    [...items.values()].map((item) => [item.node.from, item.parent])
  );
  const edits: Edit[] = [];
  const blankLines = new Set<number>();
  let noops = 0;
  for (const group of groups.values()) {
    group.sort((a, b) => a.node.from - b.node.from);
    for (let n = 1; n < group.length; n++)
      if (group[n - 1].node.nextSibling?.from !== group[n].node.from)
        return reject();
    const first = group[0],
      last = group[group.length - 1];
    const previous = first.node.prevSibling;
    const parent = first.parent === null ? undefined : items.get(first.parent);
    if ((more && !previous) || (!more && !parent)) {
      noops++;
      continue;
    }
    const target = more ? items.get(previous!.from) : parent;
    if (!target) return reject();
    const delta = more ? target.content - first.base : target.base - first.base;
    if ((more && delta <= 0) || (!more && delta >= 0)) return reject();
    for (const item of group) {
      let hasTask = false;
      walk(item.node, (node) => {
        if (node.name !== "ListItem") return;
        const marker = node.getChild("ListMark");
        if (
          marker &&
          /^\s*\[[ xX]\](?:\s|$)/.test(
            state.sliceDoc(marker.to, state.doc.lineAt(marker.to).to)
          )
        )
          hasTask = true;
      });
      if (hasTask) return reject();
      expectedParents.set(
        item.node.from,
        more ? target.node.from : target.parent
      );
      const startLine = state.doc.lineAt(item.node.from).number;
      const endLine = state.doc.lineAt(item.node.to).number;
      for (let n = startLine; n <= endLine; n++) {
        const line = state.doc.line(n);
        if (line.from === item.node.to && n > startLine) break;
        if (!line.text.trim()) continue;
        const prefix = /^(\ufeff?)([ \t]*)/.exec(line.text)!;
        if (prefix[2].includes("\t") || prefix[2].length + delta < 0)
          return reject();
        const from = line.from + prefix[1].length;
        // One operation has one direction: indentation growth is monotonic.
        // Refuse before allocating repeated whitespace, not after amplification.
        projectedUnits += delta;
        if (projectedUnits > LONG_LINE_UNITS)
          return { reason: LIST_INDENT_BUDGET };
        edits.push({
          from,
          to: from + (delta < 0 ? -delta : 0),
          insert: delta > 0 ? " ".repeat(delta) : "",
        });
      }
    }
    if (!more)
      for (
        let sibling = last.node.nextSibling;
        sibling;
        sibling = sibling.nextSibling
      )
        if (sibling.name === "ListItem")
          expectedParents.set(sibling.from, last.node.from);
    // Non-one ordered markers cannot interrupt a paragraph. Preserve the marker
    // and add only the structural separator, instead of silently renumbering it.
    if (more && first.node.parent?.name === "OrderedList") {
      const mark = first.node.getChild("ListMark")!;
      if (Number.parseInt(state.sliceDoc(mark.from, mark.to), 10) !== 1) {
        const line = state.doc.lineAt(first.node.from);
        if (line.number > 1 && state.doc.line(line.number - 1).text.trim()) {
          if (!blankLines.has(line.from) && ++projectedUnits > LONG_LINE_UNITS)
            return { reason: LIST_INDENT_BUDGET };
          blankLines.add(line.from);
        }
      }
    }
  }
  if (noops) return noops === groups.size ? { changes: [] } : reject();
  edits.sort((a, b) => a.from - b.from);
  for (let n = 1; n < edits.length; n++)
    if (edits[n].from <= edits[n - 1].from) return reject();
  for (const edit of edits)
    if (blankLines.has(edit.from)) edit.insert = "\n" + edit.insert;
  const changes = state.changes(edits);
  if (
    merged.reduce(
      (sum, w) => sum + changes.mapPos(w.to, 1) - changes.mapPos(w.from, -1),
      0
    ) > LONG_LINE_UNITS
  )
    return { reason: LIST_INDENT_BUDGET };
  const next = changes.apply(state.doc);
  for (const window of merged) {
    const start = changes.mapPos(window.from, -1);
    const end = changes.mapPos(window.to, 1);
    const local = next.sliceString(start, end);
    const bom = local.startsWith("\ufeff") ? 1 : 0;
    const parsed = commonmarkLanguage.parser.parse(local.slice(bom));
    const offset = start + bom;
    const actual = new Map<number, SyntaxNode>();
    walk(parsed.topNode, (node) => {
      if (node.name === "ListItem") actual.set(node.from + offset, node);
    });
    const original: SyntaxNode[] = [];
    tree.iterate({
      from: window.from,
      to: window.to,
      enter(node) {
        if (
          node.from >= window.from &&
          node.to <= window.to &&
          node.name === "ListItem"
        )
          original.push(node.node);
      },
    });
    if (actual.size !== original.length) return reject();
    for (const old of original) {
      const mapped = changes.mapPos(old.from, 1);
      const node = actual.get(mapped);
      if (!node) return reject();
      const parent = expectedParents.has(old.from)
        ? expectedParents.get(old.from)!
        : (parentItem(old)?.from ?? null);
      const expected = parent === null ? null : changes.mapPos(parent, 1);
      const actualParent = parentItem(node);
      if ((actualParent ? actualParent.from + offset : null) !== expected)
        return reject();
    }
    // Non-list syntax nodes must retain their mapped spans and kind. In particular
    // paragraphs/code cannot be swallowed or turned into each other by whitespace.
    const nodes = new Map<string, SyntaxNode>();
    walk(parsed.topNode, (node) => {
      if (node.name !== "Document" && node.name !== "ListItem" && !isList(node))
        nodes.set(
          `${node.name}:${node.from + offset}:${node.to + offset}`,
          node
        );
    });
    let valid = true;
    tree.iterate({
      from: window.from,
      to: window.to,
      enter(node) {
        if (
          node.from < window.from ||
          node.to > window.to ||
          node.name === "Document" ||
          node.name === "ListItem" ||
          isList(node.node)
        )
          return;
        const key = `${node.name}:${changes.mapPos(node.from, 1)}:${changes.mapPos(node.to, -1)}`;
        const candidate = nodes.get(key);
        if (!candidate) valid = false;
        else if (
          /^(?:Paragraph|FencedCode|CodeBlock|HTMLBlock)$/.test(node.name) &&
          blockValue(state.doc, node.node) !==
            blockValue(next, candidate, offset)
        )
          valid = false;
        nodes.delete(key);
      },
    });
    if (!valid || nodes.size) return reject();
  }
  return { changes: edits };
}
