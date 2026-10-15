import { expect, test } from "bun:test";

import {
  projectReading,
  readingPoint,
  type ReadingLeaf,
} from "./reading-search-projection";
import { createReadingSearchRegistry } from "./reading-search-registry";

const run = (leaves: ReadingLeaf[]) => {
  const job = projectReading(leaves, 100000);
  let result = job.next();
  while (!result.done) result = job.next();
  return result.value;
};
test("normal flow crosses inline leaves, keeps NBSP and maps collapsed DOM whitespace", () => {
  const p = run([
    { id: 0, text: "a ", flow: "normal" },
    { id: 1, text: "\t b\u00a0c", flow: "normal" },
  ]);
  expect(p.text).toBe("a b\u00a0c");
  expect(readingPoint(p, 1)).toEqual({ leaf: 0, offset: 1 });
  expect(readingPoint(p, 2, true)).toEqual({ leaf: 1, offset: 2 });
});
test("pre flow preserves spaces and maps CRLF to its complete DOM extent", () => {
  const p = run([{ id: 0, text: "a\r\nb\rc\n  d", flow: "pre" }]);
  expect(p.text).toBe("a\nb\nc\n  d");
  expect(readingPoint(p, 1)).toEqual({ leaf: 0, offset: 1 });
  expect(readingPoint(p, 2, true)).toEqual({ leaf: 0, offset: 3 });
});
test("boundaries remain typed rather than granting a searchable separator", () => {
  const p = run([
    { id: 0, text: "left ", flow: "normal" },
    { id: 1, text: "", flow: "boundary" },
    { id: 2, text: " right", flow: "normal" },
  ]);
  expect(p.text).toBe("left\nright");
  expect(p.boundaries).toEqual([[4, 5]]);
  expect(readingPoint(p, 4)).toBeNull();
});
test("linear content compresses and construction yields", () => {
  const job = projectReading(
    [{ id: 0, text: "x".repeat(9000), flow: "normal" }],
    10000
  );
  let count = 0,
    result = job.next();
  while (!result.done) {
    count++;
    result = job.next();
  }
  expect(count).toBeGreaterThanOrEqual(2);
  expect(result.value.runs.length).toBe(1);
});
test("ordinary single spaces and one-unit tabs keep linear DOM coordinates without per-character runs", () => {
  const p = run([{ id: 0, text: "a \tb a b", flow: "normal" }]);
  expect(p.text).toBe("a b a b");
  expect(readingPoint(p, 2)).toEqual({ leaf: 0, offset: 3 });
  const job = projectReading(
    [{ id: 0, text: "a ".repeat(500000), flow: "normal" }],
    1000000
  );
  let next = job.next();
  while (!next.done) next = job.next();
  expect(next.value.runs).toHaveLength(1);
  expect(next.value.text.length).toBe(999999);
});
test("registry old disposer cannot unregister replacement identity", () => {
  const registry = createReadingSearchRegistry();
  // Registry only stores identity; no DOM methods used in this unit test.
  const node = {} as HTMLElement;
  const first = registry.mount(node, { kind: "block", id: 0 });
  const second = registry.mount(node, { kind: "block", id: 1 });
  first();
  expect(registry.get(node)).toEqual({ kind: "block", id: 1 });
  second();
  expect(registry.blocks()).toEqual([]);
  registry.dispose();
  expect(registry.mount(node, { kind: "block", id: 2 })).toBeFunction();
  expect(registry.blocks()).toEqual([]);
});
