import type { DelimiterType, MarkdownConfig } from "@lezer/markdown";
import type { Parent, PhrasingContent } from "mdast";
import type { Extension as MdastExtension } from "mdast-util-from-markdown";
import { splice } from "micromark-util-chunked";
import { resolveAll } from "micromark-util-resolve-all";
import type {
  Event,
  Extension,
  Resolver,
  Token,
  Tokenizer,
  TokenizeContext,
} from "micromark-util-types";

type Kind = "subscript" | "superscript";
interface Subscript extends Parent {
  type: "subscript";
  children: PhrasingContent[];
}
interface Superscript extends Parent {
  type: "superscript";
  children: PhrasingContent[];
}
declare module "mdast" {
  interface PhrasingContentMap {
    subscript: Subscript;
    superscript: Superscript;
  }
  interface RootContentMap {
    subscript: Subscript;
    superscript: Superscript;
  }
}
declare module "micromark-util-types" {
  interface TokenTypeMap {
    subscript: "subscript";
    superscript: "superscript";
    subsupTemporary: "subsupTemporary";
    subsupSequence: "subsupSequence";
    subsupEscapedText: "subsupEscapedText";
  }
  interface Token {
    _subsupKind?: Kind;
  }
}
const definitions: {
  code: number;
  node: string;
  mark: string;
  kind: Kind;
  delimiter: DelimiterType;
}[] = [
  {
    code: 94,
    node: "Superscript",
    mark: "SuperscriptMark",
    kind: "superscript",
    delimiter: {},
  },
  {
    code: 126,
    node: "Subscript",
    mark: "SubscriptMark",
    kind: "subscript",
    delimiter: {},
  },
];
function valid(source: string) {
  if (!source.length) return false;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code === 10 || code === 13) return false;
    if (code === 92) {
      if (++i >= source.length) return false;
      const next = source.charCodeAt(i);
      if (next === 10 || next === 13) return false;
    } else if (code === 32 || code === 9) return false;
  }
  return true;
}
const lezer: MarkdownConfig = {
  defineNodes: definitions.flatMap(({ node, mark }) => [node, mark]),
  parseInline: definitions.map(({ code, node, mark, delimiter }) => ({
    name: node,
    after: "Emphasis",
    parse(context, next, position) {
      if (next !== code || context.char(position + 1) === next) return -1;
      if (context.char(position - 1) === next) {
        let slashes = 0;
        for (
          let at = position - 2;
          at >= context.offset && context.char(at) === 92;
          at--
        )
          slashes++;
        if (slashes % 2 === 0) return -1;
      }
      const index = context.findOpeningDelimiter(delimiter);
      if (index !== null) {
        const open = context.getDelimiterAt(index);
        if (open && valid(context.slice(open.to, position))) {
          const content = context.takeContent(index);
          return context.addElement(
            context.elt(node, open.from, position + 1, [
              context.elt(mark, open.from, open.to),
              ...content,
              context.elt(mark, position, position + 1),
            ])
          );
        }
      }
      return context.addDelimiter(
        delimiter,
        position,
        position + 1,
        true,
        false
      );
    },
  })),
};
const visibleEvents = new Set([
  "strong",
  "strongText",
  "emphasis",
  "emphasisText",
  "superscript",
  "subscript",
  "link",
  "label",
  "labelText",
  "image",
  "highlight",
  "highlightText",
  "strikethrough",
  "strikethroughText",
]);
function project(
  events: Event[],
  context: TokenizeContext,
  source: string
): Event[] {
  const out: Event[] = [],
    stack: string[] = [];
  for (let i = 0; i < events.length; i++) {
    const [phase, token] = events[i];
    if (
      phase !== "enter" ||
      token.type !== "data" ||
      events[i + 1]?.[0] !== "exit" ||
      events[i + 1][1] !== token
    ) {
      out.push(events[i]);
      if (phase === "enter") stack.push(token.type);
      else stack.pop();
      continue;
    }
    if (stack.some((type) => !visibleEvents.has(type))) {
      out.push(events[i], events[++i]);
      continue;
    }
    const raw = source.slice(token.start.offset, token.end.offset);
    if (/[\r\n]/.test(raw) || !/(?:\\ |\\\t)/.test(raw)) {
      out.push(events[i], events[++i]);
      continue;
    }
    // Preserve the original public Points. Never serialize fabricated stream positions.
    const projected: Token = {
      type: "subsupEscapedText",
      start: token.start,
      end: token.end,
    };
    out.push(["enter", projected, context], ["exit", projected, context]);
    i++;
  }
  return out;
}

// Event wrapping adapted from micromark-extension-gfm-strikethrough (MIT).
// Two local pending stacks avoid scanning completed spans; splice/host inline
// resolution still have costs. This is not a global linear-time guarantee.
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
function micromark(source: string): Extension {
  const resolve: Resolver = (events, context) => {
    const stacks: Record<Kind, { index: number; token: Token }[]> = {
      subscript: [],
      superscript: [],
    };
    let index = -1;
    while (++index < events.length) {
      const closer = events[index][1],
        kind = closer._subsupKind;
      if (
        events[index][0] !== "enter" ||
        closer.type !== "subsupTemporary" ||
        !kind
      )
        continue;
      const stack = stacks[kind];
      let top = stack[stack.length - 1];
      while (
        top &&
        (top.token.type !== "subsupTemporary" || top.token._subsupKind !== kind)
      ) {
        stack.pop();
        top = stack[stack.length - 1];
      }
      if (
        top &&
        valid(source.slice(top.token.end.offset, closer.start.offset))
      ) {
        const opener = top.token,
          begin = top.index;
        opener.type = closer.type = "subsupSequence";
        const node: Token = {
          type: kind,
          start: { ...opener.start },
          end: { ...closer.end },
        };
        let inside = events.slice(begin + 2, index);
        const constructs = context.parser.constructs.insideSpan.null;
        if (constructs) inside = resolveAll(constructs, inside, context);
        inside = project(inside, context, source);
        const result: Event[] = [
          ["enter", node, context],
          ["enter", opener, context],
          ["exit", opener, context],
          ...inside,
          ["enter", closer, context],
          ["exit", closer, context],
          ["exit", node, context],
        ];
        splice(events, begin, index - begin + 2, result);
        for (const pending of Object.values(stacks))
          while (pending.length && pending[pending.length - 1].index >= begin)
            pending.pop();
        index = begin + result.length - 1;
      } else stack.push({ index, token: closer });
    }
    for (const event of events)
      if (event[1].type === "subsupTemporary") event[1].type = "data";
    return events;
  };
  const tokenize: Tokenizer = function (effects, ok, nok) {
    const previous = this.previous,
      events = this.events;
    let marker = 0;
    return (code) => {
      if (code !== 94 && code !== 126) return nok(code);
      marker = code;
      if (
        previous === code &&
        events[events.length - 1]?.[1].type !== "characterEscape"
      )
        return nok(code);
      effects.enter("subsupTemporary");
      effects.consume(code);
      return end;
    };
    function end(code: number | null) {
      if (code === marker) return nok(code);
      const token = effects.exit("subsupTemporary");
      if (source.charCodeAt(token.start.offset - 1) === marker) {
        let slashes = 0;
        for (
          let at = token.start.offset - 2;
          at >= 0 && source.charCodeAt(at) === 92;
          at--
        )
          slashes++;
        if (slashes % 2 === 0) return nok(code);
      }
      token._subsupKind = marker === 94 ? "superscript" : "subscript";
      return ok(code);
    }
  };
  const construct = { name: "subsup", tokenize, resolveAll: resolve };
  return {
    text: { 94: construct, 126: construct },
    insideSpan: { null: [construct] },
  };
}
function mdast(source: string): MdastExtension {
  return {
    enter: {
      subscript(token) {
        this.enter({ type: "subscript", children: [] }, token);
      },
      superscript(token) {
        this.enter({ type: "superscript", children: [] }, token);
      },
      subsupEscapedText(token) {
        const from = token.start.offset,
          to = token.end.offset;
        if (
          !Number.isSafeInteger(from) ||
          !Number.isSafeInteger(to) ||
          from < 0 ||
          to < from ||
          to > source.length
        )
          throw new Error("Invalid SubSup source range");
        const raw = source.slice(from, to);
        if (/[\r\n]/.test(raw) || token.start.line !== token.end.line)
          throw new Error("Invalid SubSup data span");
        let value = "";
        for (let at = 0; at < raw.length; at++) {
          if (raw[at] === "\\" && at + 1 < raw.length) {
            const next = raw[++at];
            value += next === " " || next === "\t" ? next : "\\" + next;
          } else value += raw[at];
        }
        this.enter({ type: "text", value }, token);
      },
    },
    exit: {
      subscript(token) {
        this.exit(token);
      },
      superscript(token) {
        this.exit(token);
      },
      subsupEscapedText(token) {
        this.exit(token);
      },
    },
  };
}
/** Atomic dialect contribution; reading-legacy and source presentation opt out. */
export const SubSupExtension = { lezer, micromark, mdast };
