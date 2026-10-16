import { commonmarkLanguage } from "@codemirror/lang-markdown";
import {
  MarkdownParser,
  Strikethrough,
  Table,
  type MarkdownConfig,
} from "@lezer/markdown";

import { EmojiExtension } from "./emoji-extension";
import { FrontmatterExtension } from "./frontmatter-extension";
import { FrontmatterParser } from "./frontmatter-parser";
import { HighlightExtension } from "./highlight-extension";
import { SubSupExtension } from "./subsup-extension";

const upstream = Strikethrough.parseInline?.find(
  (rule) => rule.name === "Strikethrough"
);
if (!upstream) throw new Error("Fixed strikethrough rule unavailable");
const originalParse = upstream.parse.bind(upstream);
/** Preserve upstream delimiters/flanking; exclude suffixes of unescaped runs. */
const doubleStrike: MarkdownConfig = {
  ...Strikethrough,
  parseInline: Strikethrough.parseInline!.map((rule) =>
    rule === upstream
      ? {
          ...rule,
          parse(context, next, position) {
            if (next === 126 && context.char(position - 1) === 126) {
              let slashes = 0;
              for (
                let at = position - 2;
                at >= 0 && context.char(at) === 92;
                at--
              )
                slashes++;
              if (slashes % 2 === 0) return -1;
            }
            return originalParse(context, next, position);
          },
        }
      : rule
  ),
};

const base = commonmarkLanguage.parser;
if (!(base instanceof MarkdownParser))
  throw new Error("Fixed Markdown parser unavailable");
export const markdownGrammar = base.configure([
  doubleStrike,
  Table,
  FrontmatterExtension.lezer,
  HighlightExtension.lezer,
  SubSupExtension.lezer,
  EmojiExtension.lezer,
]);
export const documentMarkdownParser = new FrontmatterParser(markdownGrammar);
