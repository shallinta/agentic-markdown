import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

export interface HeadingSection {
  readonly heading: number;
  readonly line: number;
  readonly level: number;
  readonly from: number;
  readonly to: number;
}
export interface HeadingStructure {
  readonly doc: Text;
  readonly tree: Tree;
  readonly sections: readonly HeadingSection[];
}
interface OpenHeading {
  index: number;
  heading: number;
  line: number;
  level: number;
  from: number;
  body: boolean;
}
interface Frame {
  node: SyntaxNode;
  next: SyntaxNode | null;
  open: OpenHeading[];
}
const containers = new Set([
  "Document",
  "Blockquote",
  "BulletList",
  "OrderedList",
  "ListItem",
]);
const markers = new Set(["QuoteMark", "ListMark"]);

/** Only traverses existing block nodes. Yield budget includes closing/output work. */
export function* headingStructureSteps(
  state: EditorState
): Generator<void, HeadingStructure> {
  const tree = syntaxTree(state),
    doc = state.doc;
  const full = syntaxTreeAvailable(state, doc.length);
  const slots: (HeadingSection | null)[] = [];
  const stack: Frame[] = [
    { node: tree.topNode, next: tree.topNode.firstChild, open: [] },
  ];
  let work = 0;
  const close = (item: OpenHeading, end: number, reliable: boolean) => {
    const to =
      end > 0 && doc.sliceString(end - 1, end) === "\n" ? end - 1 : end;
    if (reliable && item.body && to > item.from)
      slots[item.index] = {
        heading: item.heading,
        line: item.line,
        level: item.level,
        from: item.from,
        to,
      };
  };
  while (stack.length) {
    if (++work >= 128) {
      work = 0;
      yield;
    }
    const frame = stack[stack.length - 1];
    const node = frame.next;
    if (!node) {
      for (const item of frame.open) close(item, frame.node.to, full);
      stack.pop();
      continue;
    }
    frame.next = node.nextSibling;
    if (markers.has(node.name)) continue;
    const match = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
    if (match) {
      const level = Number(match[1]);
      const line = doc.lineAt(node.from).from;
      while (
        frame.open.length &&
        frame.open[frame.open.length - 1].level >= level
      )
        close(frame.open.pop()!, line, syntaxTreeAvailable(state, node.to));
      for (const parent of frame.open) parent.body = true;
      frame.open.push({
        index: slots.length,
        heading: node.from,
        line,
        level,
        from: node.to,
        body: false,
      });
      slots.push(null);
    } else {
      for (const parent of frame.open) parent.body = true;
      if (containers.has(node.name))
        stack.push({ node, next: node.firstChild, open: [] });
    }
  }
  const sections: HeadingSection[] = [];
  for (const section of slots) {
    if (++work >= 128) {
      work = 0;
      yield;
    }
    if (section) sections.push(section);
  }
  return { doc, tree, sections };
}

/** First heading whose display line is at or after position. */
export function headingLowerBound(
  sections: readonly HeadingSection[],
  position: number
) {
  let low = 0,
    high = sections.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sections[mid].line < position) low = mid + 1;
    else high = mid;
  }
  return low;
}
