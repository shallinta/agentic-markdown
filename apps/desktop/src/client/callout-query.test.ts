import { expect, test } from "bun:test";

import { BomAwareParser } from "./bom-aware-parser";
import { calloutDefinitions } from "./callout-definitions";
import {
  queryEditingCallouts,
  advanceCalloutWork,
  CALLOUT_TASK_NODES,
  CALLOUT_TASK_CHARACTERS,
  type CalloutQueryCache,
} from "./callout-query";
import { calloutQueryFixtures } from "./callout-query-fixtures";
import { parseReadingMarkdown as parseCanonicalMarkdown } from "./canonical-parser";
import { documentMarkdownParser } from "./markdown-grammar";
import { createRawEditorState, editorOffset } from "./raw-buffer";

function check(raw: string, expected?: boolean) {
  const state = createRawEditorState(raw),
    text = state.doc.toString(),
    tree = new BomAwareParser(documentMarkdownParser).parse(text);
  const definitions = new Set(calloutDefinitions(tree, text));
  const work = queryEditingCallouts(
    state.doc,
    tree,
    [{ from: 0, to: state.doc.length }],
    definitions,
    () => true
  );
  let count = 0;
  while (true) {
    const step = advanceCalloutWork(work);
    expect(step.nodes).toBeLessThanOrEqual(CALLOUT_TASK_NODES);
    expect(step.characters).toBeLessThanOrEqual(CALLOUT_TASK_CHARACTERS);
    expect(++count).toBeLessThan(10000);
    if (!step.done) continue;
    const oracle = parseCanonicalMarkdown(raw).children.flatMap((node) =>
      node.type === "blockquote" && node.data && "agenticCallout" in node.data
        ? [node.data.agenticCallout]
        : []
    );
    expect(step.value.length).toBe(oracle.length);
    if (expected !== undefined) expect(step.value.length > 0).toBe(expected);
    for (let i = 0; i < oracle.length; i++) {
      const metadata = oracle[i] as { markerFrom: number; markerTo: number };
      expect(step.value[i].markerFrom).toBe(
        editorOffset(raw, metadata.markerFrom)
      );
      expect(step.value[i].markerTo).toBe(editorOffset(raw, metadata.markerTo));
    }
    return count;
  }
}
for (const row of calloutQueryFixtures)
  test(`callout local ${row.id}`, () => {
    check(row.raw, row.expected);
  });
const base = "> [!NOTE]\n> body\n\n" + "ordinary\n\n".repeat(1000);
test("long shortcut labels normalize incrementally without a length rejection", () => {
  check(
    "> [!NOTE]\n> [" + " ".repeat(5000) + "&nbsp;]\n\n[&nbsp;]: /url",
    false
  );
  check("> [!NOTE]\n> [" + "x".repeat(5000) + "]\n\n[other]: /url", true);
});
test("far definition addition and removal", () => {
  check(base, true);
  check(base + "[!NOTE]: /url", false);
  check(base, true);
});
for (const body of [
  "[](/url)",
  "[ ](/url)",
  "[&nbsp;](/url)",
  "*&nbsp;*",
  "**&#32;**",
  "~~&nbsp;~~",
  "`code`",
  "`code` text",
  "- [ ]",
  "- [x]",
  "- [ ] &nbsp;",
  "<i></i>",
  "![](/url)",
  "&nbsp;  \n> &nbsp;",
])
  test(`semantic body ${body}`, () => {
    check("> [!NOTE]\n> " + body);
  });
for (const label of [
  "[&nbsp;][foo]",
  "[&nbsp;][]",
  "[&nbsp;]",
  "[text][foo]",
  "[text][]",
  "[text]",
])
  test(`reference membership ${label}`, () => {
    const source = "> [!NOTE]\n> " + label;
    check(source);
    check(source + "\n\n[foo]: /url\n[&nbsp;]: /url\n[text]: /url");
    check(source);
  });
test("long whitespace eventually completes in bounded slices", () => {
  expect(
    check("> [!NOTE]\n> " + " ".repeat(50000) + "x", true)
  ).toBeGreaterThan(1);
});
test("completed quote eligibility is reused when the viewport moves inside it", () => {
  const state = createRawEditorState("> [!NOTE]\n> " + " ".repeat(9000) + "x"),
    tree = new BomAwareParser(documentMarkdownParser).parse(
      state.doc.toString()
    );
  const cache: CalloutQueryCache = new Map(),
    definitions = new Set<string>();
  const first = queryEditingCallouts(
    state.doc,
    tree,
    [{ from: 0, to: 15 }],
    definitions,
    () => true,
    cache
  );
  let chunks = 0;
  while (true) {
    const part = advanceCalloutWork(first);
    chunks++;
    if (part.done) {
      expect(part.value.length).toBe(1);
      break;
    }
  }
  expect(chunks).toBeGreaterThan(1);
  const second = advanceCalloutWork(
    queryEditingCallouts(
      state.doc,
      tree,
      [{ from: 100, to: 200 }],
      definitions,
      () => true,
      cache
    )
  );
  expect(second.done).toBe(true);
  expect(second.characters).toBe(0);
  expect(second.nodes).toBeLessThan(10);
});
test("pending local completeness is not cached as a negative eligibility", () => {
  const state = createRawEditorState("> [!NOTE]\n> body"),
    tree = new BomAwareParser(documentMarkdownParser).parse(
      state.doc.toString()
    ),
    cache: CalloutQueryCache = new Map();
  const pending = advanceCalloutWork(
    queryEditingCallouts(
      state.doc,
      tree,
      [{ from: 0, to: 15 }],
      new Set(),
      () => false,
      cache
    )
  );
  expect(pending.done).toBe(true);
  expect(cache.size).toBe(0);
  const complete = advanceCalloutWork(
    queryEditingCallouts(
      state.doc,
      tree,
      [{ from: 0, to: 15 }],
      new Set(),
      () => true,
      cache
    )
  );
  expect(complete.done && complete.value.length).toBe(1);
});
