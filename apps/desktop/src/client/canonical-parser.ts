import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";

import { annotateCallouts } from "./callout-extension";

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
export function parseCanonicalMarkdown(text: string) {
  const bom = text.startsWith("\uFEFF") ? 1 : 0;
  const tree = fromMarkdown(text.slice(bom), { extensions, mdastExtensions });
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
