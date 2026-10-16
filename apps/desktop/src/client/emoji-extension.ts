import type { MarkdownConfig } from "@lezer/markdown";
import type { Literal } from "mdast";
import type { Extension as MdastExtension } from "mdast-util-from-markdown";
import type {
  Code,
  Extension,
  State,
  Token,
  Tokenizer,
} from "micromark-util-types";

import { EMOJI_MAX_NAME, emojiNames } from "./emoji-map";

interface Emoji extends Literal {
  type: "emoji";
  value: string;
}
declare module "mdast" {
  interface PhrasingContentMap {
    emoji: Emoji;
  }
  interface RootContentMap {
    emoji: Emoji;
  }
}
declare module "micromark-util-types" {
  interface TokenTypeMap {
    emojiPending: "emojiPending";
    emojiShortcode: "emojiShortcode";
  }
}

const nameCharacter = /^[A-Za-z0-9_+-]$/;
const boundary = /[\p{L}\p{N}\p{M}_:/]/u;
const separator = /[\s<>[\]()"']/u;
const uriPrefix = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|www\.)/;
const LEFT_READ_LIMIT = 256;
const hasName = (name: string) =>
  Object.prototype.hasOwnProperty.call(emojiNames, name);

export function emojiValue(shortcode: string): string | undefined {
  if (
    shortcode.length < 3 ||
    shortcode.length > EMOJI_MAX_NAME + 2 ||
    !shortcode.startsWith(":") ||
    !shortcode.endsWith(":")
  )
    return undefined;
  const name = shortcode.slice(1, -1);
  return hasName(name) ? emojiNames[name] : undefined;
}

interface Source {
  lower: number;
  limit: number;
  read: (position: number) => string;
  /** undefined: Lezer's actual inline limit; null/negative: host stream boundary. */
  rightCode?: Code;
}

/** Local qualification failure preserves the raw shortcode; never throws. */
export function emojiQualified(
  from: number,
  to: number,
  source: Source
): boolean {
  const { lower, limit, read, rightCode } = source;
  if (!Number.isInteger(lower) || lower < 0 || lower > from || to > limit)
    return false;
  let before = "";
  for (let p = Math.max(lower, from - 2); p < from; p++) before += read(p);
  const points = Array.from(before);
  const left = points[points.length - 1] ?? "";
  let right = "";
  if (rightCode === undefined) {
    let part = "";
    for (let p = to; p < Math.min(limit, to + 2); p++) part += read(p);
    right = Array.from(part)[0] ?? "";
  } else if (rightCode !== null && rightCode >= 0) {
    if (to >= limit) return false;
    const first = read(to);
    if (first.charCodeAt(0) !== rightCode) return false;
    right = first;
    if (rightCode >= 0xd800 && rightCode <= 0xdbff && to + 1 < limit) {
      const second = read(to + 1);
      if (second.charCodeAt(0) >= 0xdc00 && second.charCodeAt(0) <= 0xdfff)
        right += second;
    }
  }
  if (boundary.test(left) || boundary.test(right)) return false;
  let remaining = LEFT_READ_LIMIT;
  const previous = (at: number) => (remaining-- > 0 ? read(at) : undefined);
  let slashes = 0;
  for (let p = from - 1; p >= lower; p--) {
    const c = previous(p);
    if (c === undefined) return false;
    if (c !== "\\") break;
    slashes++;
  }
  if (slashes % 2) return false;
  const reversed: string[] = [];
  for (let p = from - 1; p >= lower; p--) {
    const c = previous(p);
    if (c === undefined) return false;
    if (separator.test(c)) break;
    reversed.push(c);
  }
  return !uriPrefix.test(reversed.reverse().join(""));
}

const lezer: MarkdownConfig = {
  defineNodes: ["EmojiShortcode"],
  parseInline: [
    {
      name: "EmojiShortcode",
      after: "Escape",
      parse(context, next, from) {
        if (next !== 58) return -1;
        let at = from + 1,
          name = "",
          closed = false;
        for (
          let count = 0;
          count <= EMOJI_MAX_NAME && at < context.end;
          count++
        ) {
          const c = String.fromCharCode(context.char(at));
          if (c === ":") {
            closed = true;
            break;
          }
          if (!nameCharacter.test(c)) break;
          name += c;
          at++;
        }
        if (
          !closed ||
          !hasName(name) ||
          !emojiQualified(from, at + 1, {
            lower: context.offset,
            limit: context.end,
            read: (p) => String.fromCharCode(context.char(p)),
          })
        )
          return -1;
        return context.addElement(context.elt("EmojiShortcode", from, at + 1));
      },
    },
  ],
};

function canonical(source: string): {
  micromark: Extension;
  mdast: MdastExtension;
} {
  const pending = new WeakMap<Token, { value: string; right: Code }>();
  const tokenize: Tokenizer = function (effects, ok, nok) {
    let token: Token,
      name = "";
    const start: State = (code) => {
      token = effects.enter("emojiPending");
      effects.consume(code);
      return inside;
    };
    const inside: State = (code) => {
      if (code === 58 && name.length && hasName(name)) {
        effects.consume(code);
        return after;
      }
      if (
        code === null ||
        code < 0 ||
        name.length === EMOJI_MAX_NAME ||
        !nameCharacter.test(String.fromCharCode(code))
      )
        return nok(code);
      name += String.fromCharCode(code);
      effects.consume(code);
      return inside;
    };
    const after: State = (code) => {
      effects.exit("emojiPending");
      pending.set(token, { value: emojiNames[name], right: code });
      return ok(code);
    };
    return start;
  };
  return {
    micromark: {
      text: {
        58: {
          name: "emojiShortcode",
          tokenize,
          resolveTo(events) {
            const exit = events[events.length - 1],
              enter = events[events.length - 2];
            const token = exit?.[1];
            if (
              !token ||
              exit?.[0] !== "exit" ||
              enter?.[0] !== "enter" ||
              enter[1] !== token ||
              token.type !== "emojiPending" ||
              !pending.has(token)
            )
              throw new Error("Emoji token identity mismatch");
            const lower = events[0]?.[1].start.offset;
            token.type =
              lower !== undefined &&
              emojiQualified(token.start.offset, token.end.offset, {
                lower,
                limit: source.length,
                read: (p) => source[p],
                rightCode: pending.get(token)!.right,
              })
                ? "emojiShortcode"
                : "data";
            return events;
          },
        },
      },
    },
    mdast: {
      enter: {
        emojiShortcode(token) {
          const entry = pending.get(token);
          if (!entry) throw new Error("Emoji token identity missing");
          this.enter({ type: "emoji", value: entry.value }, token);
        },
      },
      exit: {
        emojiShortcode(token) {
          this.exit(token);
        },
      },
    },
  };
}

export const EmojiExtension = { lezer, canonical };
