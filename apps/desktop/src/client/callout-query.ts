import type { Text } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

import { CALLOUT_TYPES, type CalloutType } from "./callout-extension";
import { calloutInlineBody, calloutNonblank } from "./callout-inline";
import type { CalloutDefinitions } from "./callout-summary-protocol";

export interface EditingCallout {
  from: number;
  to: number;
  markerFrom: number;
  markerTo: number;
  type: CalloutType;
}
export interface CalloutRange {
  from: number;
  to: number;
}
export type CalloutQueryCache = Map<
  number,
  { to: number; value: EditingCallout | null }
>;
/** Yield 0 for a node/navigation step, positive units for bounded text work. */
type Work<T> = Generator<number, T>;
function* body(
  doc: Text,
  root: SyntaxNode,
  skipTo: number,
  definitions: CalloutDefinitions
): Work<boolean> {
  const cursor = root.cursor();
  let enter = true;
  while (true) {
    let descend = true;
    if (enter) {
      yield 0;
      const node = cursor.node;
      if (
        node.to <= skipTo ||
        node.name === "QuoteMark" ||
        node.name === "LinkReference"
      )
        descend = false;
      else if (
        [
          "FencedCode",
          "CodeBlock",
          "HTMLBlock",
          "HorizontalRule",
          "Table",
          "Image",
        ].includes(node.name)
      )
        return true;
      else if (
        node.name === "Paragraph" ||
        /^(?:ATX|Setext)Heading[1-6]$/.test(node.name)
      ) {
        let start = Math.max(node.from, skipTo);
        yield 0;
        const parent = node.parent;
        if (parent?.name === "ListItem") {
          yield 0;
          let first = parent.firstChild;
          while (
            first &&
            (first.name === "ListMark" || first.name === "QuoteMark")
          ) {
            yield 0;
            first = first.nextSibling;
          }
          if (first?.from === node.from && first.name === "Paragraph") {
            const marker = doc.sliceString(
              node.from,
              Math.min(node.to, node.from + 4)
            );
            yield marker.length;
            if (
              /^\[[ xX]\][ \t\n]/.test(marker) &&
              (yield* calloutNonblank(doc, node.from + 3, node.to))
            )
              start = Math.max(start, node.from + 3);
          }
        }
        if (yield* calloutInlineBody(doc, node, start, definitions))
          return true;
        descend = false;
      }
    }
    if (descend && enter) {
      yield 0;
      if (cursor.firstChild()) {
        enter = true;
        continue;
      }
    }
    while (true) {
      if (
        cursor.from === root.from &&
        cursor.to === root.to &&
        cursor.type === root.type
      )
        return false;
      yield 0;
      if (cursor.nextSibling()) {
        enter = true;
        break;
      }
      yield 0;
      if (!cursor.parent()) return false;
    }
  }
}
/** Only visible root blocks are located; all navigation and body work is resumable. */
export function* queryEditingCallouts(
  doc: Text,
  tree: Tree,
  ranges: readonly CalloutRange[],
  definitions: CalloutDefinitions,
  complete: (to: number) => boolean,
  cache: CalloutQueryCache = new Map(),
  visiting?: (range: CalloutRange) => void
): Work<EditingCallout[]> {
  const result: EditingCallout[] = [],
    seen = new Set<number>();
  for (const range of ranges) {
    yield 0;
    let node = tree.topNode.childAfter(range.from);
    while (node && node.from <= range.to) {
      yield 0;
      const quote = node;
      yield 0;
      node = node.nextSibling;
      if (quote.name !== "Blockquote" || seen.has(quote.from)) continue;
      seen.add(quote.from);
      visiting?.({ from: quote.from, to: quote.to });
      const cached = cache.get(quote.from);
      if (cached?.to === quote.to) {
        if (cached.value) result.push(cached.value);
        continue;
      }
      if (!complete(quote.to)) continue;
      yield 0;
      let first = quote.firstChild;
      while (first?.name === "QuoteMark") {
        yield 0;
        first = first.nextSibling;
      }
      if (
        first?.name !== "Paragraph" ||
        doc.lineAt(first.from).number !== doc.lineAt(quote.from).number
      )
        continue;
      const index = CALLOUT_TYPES.findIndex(
        (type) =>
          doc.sliceString(first.from, first.from + type.length + 3) ===
          `[!${type}]`
      );
      yield 64; // Five fixed marker comparisons, no complete-line allocation.
      if (index < 0 || definitions.has(`!${CALLOUT_TYPES[index]}`)) continue;
      const type = CALLOUT_TYPES[index],
        markerTo = first.from + type.length + 3;
      if (
        markerTo < doc.length &&
        doc.sliceString(markerTo, markerTo + 1) !== "\n"
      )
        continue;
      const visible = yield* body(doc, quote, markerTo + 1, definitions);
      const item: EditingCallout | null = visible
        ? {
            from: quote.from,
            to: quote.to,
            markerFrom: first.from,
            markerTo,
            type,
          }
        : null;
      cache.set(quote.from, { to: quote.to, value: item });
      if (item) result.push(item);
    }
  }
  return result;
}
/** Cheap candidate discovery uses the same bounded generator, without body eligibility. */
export function* hasCalloutCandidate(
  doc: Text,
  tree: Tree,
  ranges: readonly CalloutRange[]
): Work<boolean> {
  for (const range of ranges) {
    yield 0;
    let node = tree.topNode.childAfter(range.from);
    while (node && node.from <= range.to) {
      yield 0;
      const quote = node;
      yield 0;
      node = node.nextSibling;
      if (quote.name !== "Blockquote") continue;
      yield 0;
      let first = quote.firstChild;
      while (first?.name === "QuoteMark") {
        yield 0;
        first = first.nextSibling;
      }
      if (first?.name !== "Paragraph") continue;
      const found = CALLOUT_TYPES.some(
        (type) =>
          doc.sliceString(first.from, first.from + type.length + 3) ===
          `[!${type}]`
      );
      yield 64;
      if (found) return true;
    }
  }
  return false;
}
export const CALLOUT_TASK_NODES = 2048;
export const CALLOUT_TASK_CHARACTERS = 8192;
/** Reserving the maximum next character chunk prevents a task overshooting its cap. */
export function advanceCalloutWork<T>(work: Work<T>) {
  let nodes = 0,
    characters = 0;
  while (
    nodes < CALLOUT_TASK_NODES &&
    characters <= CALLOUT_TASK_CHARACTERS - 4096
  ) {
    const step = work.next();
    if (step.done)
      return { done: true as const, value: step.value, nodes, characters };
    if (step.value === 0) nodes++;
    else characters += step.value;
  }
  return { done: false as const, nodes, characters };
}
