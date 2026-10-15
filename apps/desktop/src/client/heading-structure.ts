import {
  syntaxTree,
  syntaxTreeAvailable,
  language,
} from "@codemirror/language";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Text,
} from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

import { editorFaultSession } from "./editor-fault";
import {
  currentFrontmatter,
  type FrontmatterSection,
} from "./frontmatter-structure";

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
  readonly code: readonly CodeFoldSection[];
  readonly frontmatter?: FrontmatterSection | null;
}
export interface CodeFoldSection {
  readonly opening: number;
  readonly line: number;
  readonly from: number;
  readonly to: number;
  readonly languageLabel: string;
  readonly lineCount: number;
}
export const headingStructureReady = StateEffect.define<HeadingStructure>();
export const headingStructureState = StateField.define<HeadingStructure | null>(
  {
    create: () => null,
    update(value, tr) {
      if (
        tr.docChanged ||
        !tr.state.facet(language) ||
        tr.state.field(editorFaultSession, false)?.fault
      )
        return null;
      if (value && value.tree !== syntaxTree(tr.state)) value = null;
      for (const effect of tr.effects)
        if (
          effect.is(headingStructureReady) &&
          effect.value.doc === tr.state.doc &&
          effect.value.tree === syntaxTree(tr.state)
        )
          value = effect.value;
      return value;
    },
  }
);
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
  const code: CodeFoldSection[] = [];
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
      if (node.name === "FencedCode") {
        const opening = node.firstChild,
          last = node.lastChild;
        if (opening?.name === "CodeMark") {
          const closed =
            last?.name === "CodeMark" && last.from !== opening.from;
          if (closed ? syntaxTreeAvailable(state, last.to) : full) {
            const first = doc.lineAt(opening.from);
            let to = node.to;
            if (
              !closed &&
              to > first.to &&
              doc.sliceString(to - 1, to) === "\n"
            )
              to--;
            const lineCount = closed
              ? doc.lineAt(last.from).number - first.number - 1
              : doc.lineAt(to).number - first.number;
            if (lineCount > 0 && to > first.to) {
              const info = opening.nextSibling;
              const token =
                info?.name === "CodeInfo"
                  ? (/^\S+/.exec(
                      doc.sliceString(
                        info.from,
                        Math.min(info.to, info.from + 65)
                      )
                    )?.[0] ?? "")
                  : "";
              // Derived display only: preserve the raw code/info string.
              const label = token.replace(
                // eslint-disable-next-line no-control-regex
                /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
                ""
              );
              code.push({
                opening: node.from,
                line: first.from,
                from: first.to,
                to,
                languageLabel: label
                  ? label.length > 40
                    ? `${label.slice(0, 40)}…`
                    : label
                  : "纯文本",
                lineCount,
              });
            }
          }
        }
      }
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
  return { doc, tree, sections, code, frontmatter: currentFrontmatter(state) };
}

/** First heading whose display line is at or after position. */
export function headingLowerBound(
  sections: readonly { line: number }[],
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
