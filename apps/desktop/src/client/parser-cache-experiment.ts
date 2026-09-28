/** Explicit Bun-only cost model experiment, not a measurement of heap or RSS. */
import { BomAwareParser } from "./bom-aware-parser";
import { estimateMarkdownTreeCost } from "./markdown-cache-cost";
import { encodeMarkdownTree, decodeMarkdownTree } from "./markdown-tree-wire";

const parser = new BomAwareParser();
const rows: object[] = [];
for (const units of [10_000, 50_000, 200_000, 1_000_000])
  for (const dense of [0, 1]) {
    const token = dense ? "**bold** [link](local.md) &amp; \\* " : "x";
    const raw = token.repeat(Math.ceil(units / token.length)).slice(0, units);
    const wire = encodeMarkdownTree(parser.parse(raw));
    for (let repeat = 0; repeat < 3; repeat++) {
      const start = performance.now();
      const tree = decodeMarkdownTree(wire);
      const decoded = performance.now();
      const cost = estimateMarkdownTreeCost(tree);
      rows.push({
        units,
        dense,
        repeat,
        decodeMs: decoded - start,
        costMs: performance.now() - decoded,
        ...cost,
      });
    }
  }
console.info(
  JSON.stringify(
    { runtime: "Bun cost model; no DOM or heap measurement", rows },
    null,
    2
  )
);
