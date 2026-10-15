import type { MarkdownConfig } from "@lezer/markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { frontmatter } from "micromark-extension-frontmatter";

/** Atomic first-party dialect. Fragment parsers share types, not document rules. */
export const FrontmatterExtension = {
  lezer: {
    defineNodes: [{ name: "Frontmatter", block: true }],
  } satisfies MarkdownConfig,
  micromark: frontmatter("yaml"),
  mdast: frontmatterFromMarkdown("yaml"),
};
