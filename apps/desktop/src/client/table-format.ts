import type { ChangeSet, Text } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

interface Span {
  from: number;
  to: number;
}
export interface TableGap extends Span {
  row: SyntaxNode;
}
interface TablePart extends Span {
  name: string;
}
const tablePart = /^(Table|TableHeader|TableRow|TableCell|TableDelimiter)$/;

/** Command-local index. Call only after the complete related block budget check. */
export function tableGapIndex(doc: Text) {
  const rows = new Map<string, TableGap[]>();
  return (row: SyntaxNode, position: number): TableGap | undefined => {
    const key = row.name + ":" + row.from;
    let gaps = rows.get(key);
    if (!gaps) {
      gaps = [];
      for (
        let left = row.firstChild;
        left?.nextSibling;
        left = left.nextSibling
      ) {
        const right = left.nextSibling;
        if (
          left.name === "TableDelimiter" &&
          right.name === "TableDelimiter" &&
          /^[ \t]*$/.test(doc.sliceString(left.to, right.from))
        )
          gaps.push({ from: left.to, to: right.from, row });
      }
      rows.set(key, gaps);
    }
    let low = 0,
      high = gaps.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (gaps[mid].from <= position) low = mid + 1;
      else high = mid;
    }
    const gap = gaps[low - 1];
    return gap && position <= gap.to ? gap : undefined;
  };
}

/**
 * Validate the public table skeleton, not a second table parser. Empty cells
 * have no node; only explicitly planned gaps may add a corresponding cell.
 */
export function tableFormatPreserved(
  original: Tree,
  parsed: Tree,
  doc: Text,
  next: Text,
  container: Span,
  start: number,
  changes: ChangeSet,
  edits: readonly (Span & { insert: string; gap?: Span })[]
) {
  const before: TablePart[] = [],
    after: TablePart[] = [];
  original.iterate({
    from: container.from,
    to: container.to,
    enter(node) {
      if (tablePart.test(node.name))
        before.push({ name: node.name, from: node.from, to: node.to });
    },
  });
  parsed.iterate({
    enter(node) {
      if (tablePart.test(node.name))
        after.push({
          name: node.name,
          from: node.from + start,
          to: node.to + start,
        });
    },
  });
  const cells = new Map<string, number>();
  after.forEach((node, index) => {
    if (node.name === "TableCell") cells.set(node.from + ":" + node.to, index);
  });
  const added = new Set<number>();
  for (const edit of edits) {
    if (!edit.gap || edit.from < container.from || edit.to > container.to)
      continue;
    const from = changes.mapPos(edit.from, -1);
    const index = cells.get(from + ":" + (from + edit.insert.length));
    if (index === undefined || added.has(index)) return false;
    added.add(index);
  }
  const retained = after.filter((_, index) => !added.has(index));
  if (before.length !== retained.length) return false;
  for (let i = 0; i < before.length; i++) {
    const a = before[i],
      b = retained[i];
    const delimiter = a.name === "TableDelimiter";
    if (
      a.name !== b.name ||
      changes.mapPos(a.from, delimiter ? 1 : -1) !== b.from ||
      changes.mapPos(a.to, delimiter ? -1 : 1) !== b.to
    )
      return false;
    let low = 0,
      high = edits.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (edits[mid].from < a.from) low = mid + 1;
      else high = mid;
    }
    const touched = low < edits.length && edits[low].to <= a.to;
    if (
      (delimiter || (a.name === "TableCell" && !touched)) &&
      doc.sliceString(a.from, a.to) !== next.sliceString(b.from, b.to)
    )
      return false;
  }
  return true;
}
