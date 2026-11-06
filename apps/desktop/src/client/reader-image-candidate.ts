import { localImageReference } from "../shared/local-images";

import type { parseReadingMarkdown } from "./canonical-parser";

type Tree = ReturnType<typeof parseReadingMarkdown>;
type Node = Tree | Tree["children"][number];
type ImageNode = Extract<Node, { type: "image" | "imageReference" }>;

interface ImageCandidate {
  node: ImageNode;
  reference: string;
}

const MAX_NODES = 100_000;
const MAX_DEPTH = 128;

/** Selects a single visible AST occurrence. Authorization remains with Bun. */
export function firstReaderImageCandidate(tree: Tree, sourceLength: number):
  (ImageCandidate & { from: number; to: number }) | undefined {
  if (!Number.isSafeInteger(sourceLength) || sourceLength < 0) return undefined;

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

  function find(node: Node): ImageCandidate | undefined {
    switch (node.type) {
      case "image":
      case "imageReference": {
        const reference = node.type === "image" ? node.url : definitions.get(node.identifier.toUpperCase());
        const path = reference === undefined ? null : localImageReference(reference);
        return reference !== undefined && path !== null && /\.(?:png|jpe?g)$/i.test(path)
          ? { node, reference }
          : undefined;
      }
      case "table": {
        // The renderer skips extra row cells that have no header column.
        const columns = node.children[0]?.children.length ?? 0;
        for (const row of node.children) {
          for (let index = 0; index < columns && index < row.children.length; index++) {
            const candidate = find(row.children[index]);
            if (candidate) return candidate;
          }
        }
        return undefined;
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
          const candidate = find(child);
          if (candidate) return candidate;
        }
        return undefined;
      default:
        return undefined;
    }
  }

  // The second walk uses only the visible subset of this fully bounded tree.
  if (!collect(tree, 0)) return undefined;
  const candidate = find(tree);
  const from = candidate?.node.position?.start.offset;
  const to = candidate?.node.position?.end.offset;
  if (!candidate || from === undefined || to === undefined ||
      !Number.isSafeInteger(from) || !Number.isSafeInteger(to) ||
      from < 0 || to <= from || to > sourceLength) return undefined;
  return { ...candidate, from, to };
}
