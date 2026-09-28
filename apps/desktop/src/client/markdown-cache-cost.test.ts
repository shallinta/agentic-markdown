import { expect, test } from "bun:test";

import { NodeType, Tree, TreeBuffer, NodeSet } from "@lezer/common";

import { BomAwareParser } from "./bom-aware-parser";
import {
  estimateMarkdownTreeCost,
  MARKDOWN_ACTIVE_TREE_BUDGET,
} from "./markdown-cache-cost";

test("cost counts shared child and backing store once, with estimated object cost separate", () => {
  const buffer = new Uint16Array([0, 0, 1, 4]);
  const set = new NodeSet([NodeType.none]);
  const a = new TreeBuffer(buffer, 1, set);
  const b = new TreeBuffer(buffer.subarray(0), 1, set);
  const tree = new Tree(NodeType.none, [a, a, b], [0, 1, 2], 3);
  const cost = estimateMarkdownTreeCost(tree);
  expect(cost.bufferBytes).toBe(8);
  expect(cost.estimatedObjectBytes).toBe(64 + 48 + 48 + 128 + 128);
  expect(cost.accountedBytes).toBe(
    cost.bufferBytes + cost.estimatedObjectBytes
  );
});

test("dense trees can exceed soft budget without losing syntax or pretending a hard cap", () => {
  const raw = "**bold** [link](local.md) &amp; \\* ".repeat(16_000);
  const tree = new BomAwareParser().parse(raw);
  const cost = estimateMarkdownTreeCost(tree);
  expect(cost.accountedBytes).toBeGreaterThan(MARKDOWN_ACTIVE_TREE_BUDGET);
  expect(tree.length).toBe(raw.length);
  expect(tree.topNode.getChild("Paragraph")).not.toBeNull();
});
