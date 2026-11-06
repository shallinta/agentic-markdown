import { localImageReference } from "../shared/local-images";
import { READER_IMAGE_SNAPSHOT_MAX_SLOTS } from "../shared/reader-image-snapshot";

import type { parseReadingMarkdown } from "./canonical-parser";

type Tree = ReturnType<typeof parseReadingMarkdown>;
type Node = Tree | Tree["children"][number];
type ImageNode = Extract<Node, { type: "image" | "imageReference" }>;

export interface ReaderImageCandidate {
  node: ImageNode;
  reference: string;
  from: number;
  to: number;
}

const MAX_NODES = 100_000;
const MAX_DEPTH = 128;

/** Selects bounded visible AST occurrences. Authorization remains with Bun. */
export function readerImageCandidates(tree: Tree, sourceLength: number): readonly ReaderImageCandidate[] {
  if (!Number.isSafeInteger(sourceLength) || sourceLength < 0) return [];

  let visited = 0;
  const definitions = new Map<string, string>();
  function collect(node: Node, depth: number): boolean {
    if (++visited > MAX_NODES || depth > MAX_DEPTH) return false;
    if (node.type === "definition") {
      const identifier = node.identifier.toUpperCase();
      if (!definitions.has(identifier)) definitions.set(identifier, node.url);
    }
    if ("children" in node) {
      for (const child of node.children) if (!collect(child, depth + 1)) return false;
    }
    return true;
  }

  const candidates: ReaderImageCandidate[] = [];
  function scan(node: Node): boolean {
    switch (node.type) {
      case "image":
      case "imageReference": {
        const reference = node.type === "image" ? node.url : definitions.get(node.identifier.toUpperCase());
        const path = reference === undefined ? null : localImageReference(reference);
        if (reference === undefined || path === null || !/\.(?:png|jpe?g)$/i.test(path)) return false;
        const from = node.position?.start.offset;
        const to = node.position?.end.offset;
        // A malformed chosen occurrence cannot silently fall back to a later image.
        if (from === undefined || to === undefined || !Number.isSafeInteger(from) ||
            !Number.isSafeInteger(to) || from < 0 || to <= from || to > sourceLength) return true;
        candidates.push({ node, reference, from, to });
        return candidates.length >= READER_IMAGE_SNAPSHOT_MAX_SLOTS;
      }
      case "table": {
        // The renderer skips extra row cells that have no header column.
        const columns = node.children[0]?.children.length ?? 0;
        for (const row of node.children) {
          for (let index = 0; index < columns && index < row.children.length; index++) {
            if (scan(row.children[index])) return true;
          }
        }
        return false;
      }
      case "root":
      case "paragraph":
      case "heading":
      case "blockquote":
      case "list":
      case "listItem":
      case "emphasis":
      case "strong":
      case "delete":
      case "link":
      case "linkReference":
      case "tableCell":
        for (const child of node.children) {
          if (scan(child)) return true;
        }
        return false;
      default:
        return false;
    }
  }

  // The second walk uses only the visible subset of this fully bounded tree.
  if (!collect(tree, 0)) return [];
  scan(tree);
  return candidates;
}
