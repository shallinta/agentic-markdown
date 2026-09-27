import { expect, test } from "bun:test";

import type { Tree } from "@lezer/common";

import { lifecycleOutcome, MeasuredParser } from "./editor-view-probe";
import { editingMarkdown } from "./live-formatting";

function nodes(tree: Tree) {
  const result: [string, number, number][] = [];
  tree.iterate({
    enter(node) {
      result.push([node.name, node.from, node.to]);
    },
  });
  return result;
}

test("measured parser delegates real CommonMark unchanged and attributes advance counters", () => {
  const parser = new MeasuredParser(editingMarkdown.parser);
  const raw = "\uFEFF# 中文\n\n> quote\n\n```js\ncode\n```";
  const expected = editingMarkdown.parser.parse(raw);
  expect(nodes(parser.parse(raw))).toEqual(nodes(expected));
  expect(parser.advances).toBeGreaterThan(0);
  expect(parser.advanceMs).toBeGreaterThanOrEqual(0);
  expect(parser.afterDestroy).toBe(0);
  const count = parser.advances;
  parser.destroyed = true;
  expect(nodes(parser.parse(raw))).toEqual(nodes(expected));
  expect(parser.afterDestroy).toBe(parser.advances - count);
  expect(parser.afterDestroyMs).toBeGreaterThanOrEqual(0);
});

test("zero callbacks alone cannot claim View cancellation; positive pending control required", () => {
  expect(lifecycleOutcome(false, true, 1, 0)).toBe("unsupported");
  expect(lifecycleOutcome(true, false, 1, 0)).toBe("unsupported");
  expect(lifecycleOutcome(true, true, 0, 0)).toBe("unsupported");
  expect(lifecycleOutcome(true, true, 1, 0)).toBe("ok");
  expect(lifecycleOutcome(true, true, 1, 1)).toBe("failed");
  expect(lifecycleOutcome(false, false, 0, 1)).toBe("failed");
});
