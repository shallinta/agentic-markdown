/** Fixed first-party profile. Other GFM features remain unregistered. */
export const MARKDOWN_GRAMMAR =
  "commonmark-gfm-strike-task-table-frontmatter-highlight-5";

/** Reading-only canonical capabilities; not the editor's Lezer grammar. */
export const CANONICAL_PROFILE =
  "commonmark-gfm-strike-task-autolink-table-callout-5";
export const EDITING_CANONICAL_PROFILE =
  "commonmark-gfm-strike-task-autolink-table-callout-frontmatter-highlight-7";
export type CanonicalPurpose = "editing-semantic" | "reading-legacy";
export const canonicalProfile = (purpose: CanonicalPurpose) =>
  purpose === "editing-semantic"
    ? EDITING_CANONICAL_PROFILE
    : CANONICAL_PROFILE;
