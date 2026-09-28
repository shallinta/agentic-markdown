import { Tree, TreeBuffer } from "@lezer/common";

export interface MarkdownTreeCost {
  bufferBytes: number;
  estimatedObjectBytes: number;
  accountedBytes: number;
}
// Local soft accounting budget: roughly twice the observed dense 200k tree.
// A unique active tree is pinned even above this amount. This is not an OS cap.
export const MARKDOWN_ACTIVE_TREE_BUDGET = 1024 * 1024;
export const MARKDOWN_DERIVED_TOTAL_BUDGET = MARKDOWN_ACTIVE_TREE_BUDGET;
/** Version 1 accounting model, not heap/RSS: 64 bytes/object, 24/array, 8/slot.
 * Shared node sets/props are grammar configuration, not per-document allocations.
 * The same tree or backing buffer is counted once even when referenced twice.
 */
export function estimateMarkdownTreeCost(tree: Tree): MarkdownTreeCost {
  const nodes = new Set<Tree | TreeBuffer>();
  const buffers = new Set<ArrayBufferLike>();
  let bufferBytes = 0,
    estimatedObjectBytes = 0;
  const visit = (node: Tree | TreeBuffer) => {
    if (nodes.has(node)) return;
    nodes.add(node);
    estimatedObjectBytes += 64;
    if (node instanceof TreeBuffer) {
      // Typed-array wrapper is estimated; backing store size is directly known.
      estimatedObjectBytes += 64;
      if (!buffers.has(node.buffer.buffer)) {
        buffers.add(node.buffer.buffer);
        bufferBytes += node.buffer.buffer.byteLength;
      }
    } else {
      estimatedObjectBytes += 48 + 16 * node.children.length;
      if (node.propValues.length)
        estimatedObjectBytes += 24 + 24 * node.propValues.length;
      for (const child of node.children) visit(child);
    }
  };
  visit(tree);
  return {
    bufferBytes,
    estimatedObjectBytes,
    accountedBytes: bufferBytes + estimatedObjectBytes,
  };
}
