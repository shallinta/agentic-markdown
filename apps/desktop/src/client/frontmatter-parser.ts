import {
  Parser,
  Tree,
  type Input,
  type NodeType,
  type PartialParse,
  type TreeBuffer,
  type TreeFragment,
} from "@lezer/common";
import type { MarkdownParser } from "@lezer/markdown";

interface ClosedHeader {
  end: number;
  body: number;
}
type Phase = "fragments" | "scan" | "body" | "combine" | "done";
const SCAN_UNITS = 4096;
const STRUCTURE_UNITS = 128;

/** Document-only wrapper. No mixed trees, hidden parser internals, or YAML evaluation. */
export class FrontmatterParser extends Parser {
  private readonly documentType: NodeType;
  private readonly headerType: NodeType;
  constructor(private readonly markdown: MarkdownParser) {
    super();
    const document = markdown.nodeSet.types.find(
      (type) => type.name === "Document"
    );
    const header = markdown.nodeSet.types.find(
      (type) => type.name === "Frontmatter"
    );
    if (!document || !header)
      throw new Error("Frontmatter node types unavailable");
    this.documentType = document;
    this.headerType = header;
  }
  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[]
  ): PartialParse {
    if (
      ranges.length !== 1 ||
      ranges[0].from !== 0 ||
      ranges[0].to !== input.length
    )
      throw new Error("Unsupported Frontmatter document ranges");
    const documentType = this.documentType,
      headerType = this.headerType,
      markdown = this.markdown;
    let phase: Phase = "fragments",
      fragmentIndex = 0;
    let position = 0,
      lineStart = 0,
      dashes = 0,
      trailing = false,
      valid = true,
      opening = true;
    let pendingCR: number | null = null;
    let header: ClosedHeader | undefined, atom: Tree | undefined;
    let delegate: PartialParse | undefined, body: Tree | undefined;
    let stopped: number | null = null,
      childIndex = 0;
    const children: (Tree | TreeBuffer)[] = [],
      positions: number[] = [];
    const finishLine = (end: number, next: number) => {
      const delimiter = valid && dashes === 3;
      if (opening) {
        opening = false;
        if (!delimiter) phase = "body";
      } else if (delimiter) {
        header = { end, body: next };
        phase = "body";
      }
      lineStart = next;
      dashes = 0;
      trailing = false;
      valid = true;
    };
    const finish = (tree: Tree) => {
      phase = "done";
      return tree;
    };
    return {
      advance() {
        if (phase === "fragments") {
          const limit = Math.min(
            fragmentIndex + STRUCTURE_UNITS,
            fragments.length
          );
          for (; fragmentIndex < limit; fragmentIndex++) {
            const fragment = fragments[fragmentIndex],
              tree = fragment.tree,
              child = tree.children[0],
              start = tree.positions[0];
            if (
              tree.type !== documentType ||
              !(child instanceof Tree) ||
              child.type !== headerType ||
              child.children.length ||
              !Number.isSafeInteger(start) ||
              start - fragment.offset !== 0 ||
              fragment.from !== 0 ||
              fragment.openStart
            )
              continue;
            const end = start + child.length - fragment.offset;
            if (!Number.isSafeInteger(end) || end <= 0 || end >= input.length)
              continue;
            const suffix = input.read(end, Math.min(end + 2, input.length));
            const next = suffix.startsWith("\r\n")
              ? end + 2
              : suffix.startsWith("\r") || suffix.startsWith("\n")
                ? end + 1
                : -1;
            // Half-open fragment coverage must include a unit after the complete delimiter EOL.
            if (
              next < 0 ||
              fragment.to <= next ||
              tree.length - fragment.offset <= next
            )
              continue;
            header = { end, body: next };
            phase = "body";
            break;
          }
          if (phase === "fragments" && fragmentIndex === fragments.length)
            phase = "scan";
          return null;
        }
        if (phase === "scan") {
          const chunk = input.read(
            position,
            Math.min(position + SCAN_UNITS, input.length)
          );
          for (let index = 0; index < chunk.length && phase === "scan";) {
            const character = chunk[index];
            if (pendingCR !== null) {
              const end = pendingCR;
              pendingCR = null;
              if (character === "\n") {
                position++;
                index++;
                finishLine(end, position);
                continue;
              }
              finishLine(end, position);
              if (phase !== "scan") break;
            }
            if (character === "\r") {
              pendingCR = position;
              position++;
              index++;
              continue;
            }
            if (character === "\n") {
              const end = position;
              position++;
              index++;
              finishLine(end, position);
              continue;
            }
            if (character === "-" && !trailing) {
              if (++dashes > 3) valid = false;
            } else if (character === " " || character === "\t") trailing = true;
            else valid = false;
            position++;
            index++;
            if (opening && !valid) phase = "body";
          }
          if (phase === "scan" && position === input.length) {
            if (pendingCR !== null) {
              const end = pendingCR;
              pendingCR = null;
              finishLine(end, position);
            } else if (position > lineStart) finishLine(position, position);
            if (phase === "scan") phase = "body";
          }
          return null;
        }
        if (phase === "body") {
          if (header && !atom) atom = new Tree(headerType, [], [], header.end);
          if (
            header &&
            (header.body === input.length ||
              (stopped !== null && stopped <= header.body))
          )
            return finish(new Tree(documentType, [atom!], [0], header.body));
          if (!delegate) {
            delegate = markdown.startParse(
              input,
              fragments,
              header ? [{ from: header.body, to: input.length }] : ranges
            );
            if (stopped !== null) delegate.stopAt(stopped);
          }
          const tree = delegate.advance();
          if (!tree) return null;
          if (!header) return finish(tree);
          body = tree;
          children.push(atom!);
          positions.push(0);
          phase = "combine";
          return null;
        }
        if (phase === "combine") {
          const limit = Math.min(
            childIndex + STRUCTURE_UNITS,
            body!.children.length
          );
          for (; childIndex < limit; childIndex++) {
            children.push(body!.children[childIndex]);
            positions.push(body!.positions[childIndex] + header!.body);
          }
          if (childIndex === body!.children.length)
            return finish(
              new Tree(
                documentType,
                children,
                positions,
                header!.body + body!.length,
                body!.propValues
              )
            );
          return null;
        }
        throw new Error("Frontmatter parse already complete");
      },
      get parsedPos() {
        return delegate?.parsedPos ?? (atom ? header!.body : 0);
      },
      get stoppedAt() {
        return stopped;
      },
      stopAt(end) {
        if (stopped !== null && end > stopped)
          throw new RangeError("Cannot increase parse stop");
        stopped = end;
        delegate?.stopAt(end);
      },
    };
  }
}
