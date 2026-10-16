import { tags } from "@lezer/highlight";
import type { DelimiterType, MarkdownConfig } from "@lezer/markdown";
import type { Parent, PhrasingContent } from "mdast";
import type { Extension as MdastExtension } from "mdast-util-from-markdown";
import { splice } from "micromark-util-chunked";
import { classifyCharacter } from "micromark-util-classify-character";
import { resolveAll } from "micromark-util-resolve-all";
import type {
  Code,
  Event,
  Extension,
  Resolver,
  State,
  Token,
  Tokenizer,
} from "micromark-util-types";

interface Highlight extends Parent {
  type: "highlight";
  children: PhrasingContent[];
}
declare module "mdast" {
  interface PhrasingContentMap {
    highlight: Highlight;
  }
  interface RootContentMap {
    highlight: Highlight;
  }
}
declare module "micromark-util-types" {
  interface TokenTypeMap {
    highlight: "highlight";
    highlightText: "highlightText";
    highlightSequence: "highlightSequence";
    highlightTemporary: "highlightTemporary";
  }
}

const delimiter: DelimiterType = {
  resolve: "Highlight",
  mark: "HighlightMark",
};
const punctuation = /[\p{P}\p{S}]/u;
/** Read at most two UTF-16 units, never copy an entire preceding data token. */
function neighbor(source: string, offset: number, left: boolean) {
  const part = left
    ? source.slice(Math.max(0, offset - 2), offset)
    : source.slice(offset, offset + 2);
  const points = Array.from(part);
  return left ? (points[points.length - 1] ?? "") : (points[0] ?? "");
}
const lezer: MarkdownConfig = {
  defineNodes: [
    { name: "Highlight", style: tags.content },
    { name: "HighlightMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "Highlight",
      after: "Emphasis",
      parse(context, next, position) {
        if (
          next !== 61 ||
          context.char(position + 1) !== 61 ||
          context.char(position + 2) === 61
        )
          return -1;
        if (context.char(position - 1) === 61) {
          let slashes = 0;
          for (let at = position - 2; at >= 0 && context.char(at) === 92; at--)
            slashes++;
          if (slashes % 2 === 0) return -1;
        }
        const left = context.slice(Math.max(0, position - 2), position);
        const right = context.slice(position + 2, position + 4);
        const before = neighbor(left, left.length, true),
          after = neighbor(right, 0, false);
        const spaceBefore = /\s|^$/.test(before),
          spaceAfter = /\s|^$/.test(after);
        return context.addDelimiter(
          delimiter,
          position,
          position + 2,
          !spaceAfter &&
            (!punctuation.test(after) ||
              spaceBefore ||
              punctuation.test(before)),
          !spaceBefore &&
            (!punctuation.test(before) || spaceAfter || punctuation.test(after))
        );
      },
    },
  ],
};

/** Same invocation/input as fromMarkdown, before its explicit BOM remapping. */
function micromark(source: string): Extension {
  const classify = (offset: number, left: boolean, code: Code) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length)
      throw new Error("Invalid highlight token offset");
    if (code === null || code < 0) return classifyCharacter(code);
    const value = neighbor(source, offset, left);
    if (!value) throw new Error("Missing highlight token neighbor");
    return /\s/.test(value) ? 1 : punctuation.test(value) ? 2 : undefined;
  };
  const tokenize: Tokenizer = function (effects, ok, nok) {
    const previous = this.previous,
      events = this.events;
    let size = 0;
    return start;
    function start(code: Code) {
      if (
        previous === 61 &&
        events[events.length - 1]?.[1].type !== "characterEscape"
      )
        return nok(code);
      effects.enter("highlightTemporary");
      return more(code);
    }
    function more(code: Code): State | undefined {
      if (code === 61) {
        if (size > 1) return nok(code);
        effects.consume(code);
        size++;
        return more;
      }
      if (size !== 2) return nok(code);
      const token = effects.exit("highlightTemporary");
      const before = classify(token.start.offset, true, previous),
        after = classify(token.end.offset, false, code);
      token._open = after !== 1 && (!after || (after === 2 && Boolean(before)));
      token._close =
        before !== 1 && (!before || (before === 2 && Boolean(after)));
      return ok(code);
    }
  };
  const tokenizer = {
    name: "highlight",
    tokenize,
    resolveAll: resolveHighlight,
  };
  return {
    text: { 61: tokenizer },
    insideSpan: { null: [tokenizer] },
    attentionMarkers: { null: [61] },
  };
}

// Adapted from micromark-extension-gfm-strikethrough (MIT, Titus Wormer and
// contributors). Local failed-search floor avoids repeating a failed prefix;
// successful splices reset it. This is not a global linear-time guarantee.
/*
Copyright (c) 2020 Titus Wormer <tituswormer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
const resolveHighlight: Resolver = (events, context) => {
  let index = -1,
    floor = 0;
  while (++index < events.length) {
    if (
      events[index][0] !== "enter" ||
      events[index][1].type !== "highlightTemporary" ||
      !events[index][1]._close
    )
      continue;
    let open = index;
    while (open-- > floor) {
      if (
        events[open][0] !== "exit" ||
        events[open][1].type !== "highlightTemporary" ||
        !events[open][1]._open
      )
        continue;
      const opener = events[open][1],
        closer = events[index][1];
      opener.type = closer.type = "highlightSequence";
      const node: Token = {
        type: "highlight",
        start: { ...opener.start },
        end: { ...closer.end },
      };
      const text: Token = {
        type: "highlightText",
        start: { ...opener.end },
        end: { ...closer.start },
      };
      const out: Event[] = [
        ["enter", node, context],
        ["enter", opener, context],
        ["exit", opener, context],
        ["enter", text, context],
      ];
      const inside = context.parser.constructs.insideSpan.null;
      if (inside)
        splice(
          out,
          out.length,
          0,
          resolveAll(inside, events.slice(open + 1, index), context)
        );
      splice(out, out.length, 0, [
        ["exit", text, context],
        ["enter", closer, context],
        ["exit", closer, context],
        ["exit", node, context],
      ]);
      splice(events, open - 1, index - open + 3, out);
      index = open + out.length - 2;
      floor = 0;
      break;
    }
    // Retain this failed closer's exit: it may also open a future match.
    if (open < floor) floor = index;
  }
  for (const event of events)
    if (event[1].type === "highlightTemporary") event[1].type = "data";
  return events;
};
const mdast: MdastExtension = {
  canContainEols: ["highlight"],
  enter: {
    highlight(token) {
      this.enter({ type: "highlight", children: [] }, token);
    },
  },
  exit: {
    highlight(token) {
      this.exit(token);
    },
  },
};

/** Atomic first-party extension; presentation stays in the editing consumer. */
export const HighlightExtension = { lezer, micromark, mdast };
