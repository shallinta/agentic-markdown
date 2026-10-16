import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";

import type { CanonicalPurpose } from "../shared/markdown-profile";

import { annotateCallouts } from "./callout-extension";
import { EmojiExtension } from "./emoji-extension";
import { FrontmatterExtension } from "./frontmatter-extension";
import { HighlightExtension } from "./highlight-extension";
import { SubSupExtension } from "./subsup-extension";

const extensions = [
  gfmStrikethrough({ singleTilde: false }),
  gfmTaskListItem(),
  gfmAutolinkLiteral(),
  gfmTable(),
];
const mdastExtensions = [
  gfmStrikethroughFromMarkdown(),
  gfmTaskListItemFromMarkdown(),
  gfmAutolinkLiteralFromMarkdown(),
  gfmTableFromMarkdown(),
];

/** Internal mdast, raw UTF-16 positions; never HTML or a public plugin schema. */
export function parseCanonicalMarkdown(
  text: string,
  purpose: CanonicalPurpose
) {
  const bom = text.startsWith("\uFEFF") ? 1 : 0;
  const parseText = text.slice(bom);
  const emoji =
    purpose === "editing-semantic"
      ? EmojiExtension.canonical(parseText)
      : undefined;
  const tree = fromMarkdown(parseText, {
    extensions:
      purpose === "editing-semantic"
        ? [
            ...extensions,
            FrontmatterExtension.micromark,
            HighlightExtension.micromark(parseText),
            SubSupExtension.micromark(parseText),
            emoji!.micromark,
          ]
        : extensions,
    mdastExtensions:
      purpose === "editing-semantic"
        ? [
            ...mdastExtensions,
            FrontmatterExtension.mdast,
            HighlightExtension.mdast,
            SubSupExtension.mdast(parseText),
            emoji!.mdast,
          ]
        : mdastExtensions,
  });
  if (bom) {
    const pending = [tree as typeof tree | (typeof tree.children)[number]];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.position)
        for (const point of [node.position.start, node.position.end]) {
          if (point.offset !== undefined) point.offset += bom;
          if (point.line === 1) point.column += bom;
        }
      if ("children" in node)
        for (const child of node.children) pending.push(child);
    }
  }
  annotateCallouts(tree, text);
  return tree;
}
export const parseReadingMarkdown = (text: string) =>
  parseCanonicalMarkdown(text, "reading-legacy");
export const parseEditingMarkdown = (text: string) =>
  parseCanonicalMarkdown(text, "editing-semantic");
