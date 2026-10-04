import { expect, test } from "bun:test";

import {
  captureReadingNodes,
  createReadingDomReuseAudit,
  sameReadingNodes,
} from "./reading-dom-reuse";

test("image diagnostic excludes only resource descendants and still detects shell replacement", () => {
  const outer = { parentElement: { closest: () => null } };
  const inside = { parentElement: { closest: () => outer } };
  let children = [outer, inside];
  const root = {
    ownerDocument: {
      createTreeWalker: (_root: unknown, _mask: number, filter: { acceptNode(node: unknown): number } | null) => {
        const accepted = children.filter(node => !filter || filter.acceptNode(node) === 1);
        let index = 0;
        return { nextNode: () => accepted[index++] ?? null };
      },
    },
  } as unknown as HTMLElement;
  const baseline = captureReadingNodes(root, true);
  expect(baseline.length).toBe(2);
  expect(captureReadingNodes(root).length).toBe(3);
  children = [outer, { parentElement: { closest: () => outer } }];
  expect(sameReadingNodes(baseline, captureReadingNodes(root, true))).toBe(true);
  children = [{ parentElement: { closest: () => null } }, inside];
  expect(sameReadingNodes(baseline, captureReadingNodes(root, true))).toBe(false);
  children = [outer];
  expect(sameReadingNodes(captureReadingNodes(root), captureReadingNodes(root, true))).toBe(true);
});

test("DOM reuse comparison checks every reference, count and order, not matching text", () => {
  const root = {},
    text = { value: "same text" },
    element = {};
  const before = [root, element, text];
  expect(sameReadingNodes(before, [...before])).toBe(true);
  expect(
    sameReadingNodes(before, [root, element, { value: "same text" }])
  ).toBe(false);
  expect(sameReadingNodes(before, [root, text, element])).toBe(false);
  expect(sameReadingNodes(before, [root, element])).toBe(false);
  expect(sameReadingNodes(before, [...before, {}])).toBe(false);
});

test("same-commit theme and rendered-node replacement compares the prior generation baseline", () => {
  const audit = createReadingDomReuseAudit();
  const identity = { documentId: "a", revision: 2, generation: 10 };
  const root = {},
    oldText = { text: "same" };
  let dom = [root, oldText];
  let captures = 0;
  const capture = () => {
    captures++;
    return [...dom];
  };
  expect(audit.observe(identity, "paper", capture).status).toBe("pending");
  // A React memo/geometry effect may be re-evaluated without new content.
  // It must not recapture a replacement subtree as a successful baseline.
  dom = [root, { text: "same" }];
  expect(audit.observe(identity, "paper", capture).status).toBe("pending");
  expect(captures).toBe(1);
  expect(audit.observe(identity, "ink", capture).status).toBe("failed");
  expect(audit.observe(identity, "paper", capture).status).toBe("failed");
  dom = [root, oldText];
  expect(audit.observe(identity, "ink", capture).status).toBe("passed");
});

test("only actual document, revision or canonical generation resets diagnostic refs", () => {
  const audit = createReadingDomReuseAudit();
  let identity = { documentId: "a", revision: 0, generation: 1 };
  let dom = [{}];
  const capture = () => dom;
  expect(audit.observe(identity, "paper", capture).status).toBe("pending");
  expect(audit.observe(identity, "ink", capture).status).toBe("passed");
  for (const next of [
    { ...identity, revision: 1 },
    { documentId: "b", revision: 1, generation: 1 },
    { documentId: "b", revision: 1, generation: 2 },
  ]) {
    identity = next;
    dom = [{}];
    expect(audit.observe(identity, "ink", capture).status).toBe("pending");
    expect(audit.observe(identity, "paper", capture).status).toBe("passed");
  }
});
