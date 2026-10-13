import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";

const extensions = [
  gfmStrikethrough({ singleTilde: false }),
  gfmTaskListItem(),
];
const mdastExtensions = [
  gfmStrikethroughFromMarkdown(),
  gfmTaskListItemFromMarkdown(),
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
  return tree;
}
