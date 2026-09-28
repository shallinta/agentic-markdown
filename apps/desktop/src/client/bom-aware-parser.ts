import { commonmarkLanguage } from "@codemirror/lang-markdown";
import { Parser, Tree, TreeFragment, type Input } from "@lezer/common";

/** BOM is raw file content, not Markdown syntax; preserve all editor offsets. */
export class BomAwareParser extends Parser {
  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[]
  ) {
    if (input.read(0, 1) !== "\uFEFF")
      return commonmarkLanguage.parser.startParse(input, fragments, ranges);
    const shifted: Input = {
      length: input.length - 1,
      lineChunks: input.lineChunks,
      chunk: (from) => input.chunk(from + 1),
      read: (from, to) => input.read(from + 1, to + 1),
    };
    const parse = commonmarkLanguage.parser.startParse(
      shifted,
      // This is a coordinate projection, not a second document edit.
      // applyChanges would recompute openEnd and permit unsafe tail reuse.
      fragments
        .filter((fragment) => fragment.to > 1)
        .map(
          (fragment) =>
            new TreeFragment(
              Math.max(0, fragment.from - 1),
              fragment.to - 1,
              fragment.tree,
              fragment.offset + 1,
              fragment.openStart,
              fragment.openEnd
            )
        ),
      ranges.map((range) => ({
        from: Math.max(0, range.from - 1),
        to: Math.max(0, range.to - 1),
      }))
    );
    return {
      advance() {
        const tree = parse.advance();
        return tree
          ? new Tree(
              tree.type,
              tree.children,
              tree.positions.map((position) => position + 1),
              tree.length + 1,
              tree.propValues
            )
          : null;
      },
      get parsedPos() {
        return parse.parsedPos + 1;
      },
      get stoppedAt() {
        return parse.stoppedAt === null ? null : parse.stoppedAt + 1;
      },
      stopAt(position: number) {
        parse.stopAt(Math.max(0, position - 1));
      },
    };
  }
}
