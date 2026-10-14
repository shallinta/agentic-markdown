import type { fromMarkdown } from "mdast-util-from-markdown";

import { MAX_DOCUMENT_BYTES } from "../shared/documents";

type Root = ReturnType<typeof fromMarkdown>;
type Node = Root | Root["children"][number];
type Quote = Extract<Node, { type: "blockquote" }>;

export const CALLOUT_TYPES = [
  "NOTE",
  "TIP",
  "IMPORTANT",
  "WARNING",
  "CAUTION",
] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];
export const CALLOUT_PRESENTATION = {
  NOTE: {
    title: "备注",
    icon: "ⓘ",
    className: "reading-callout reading-callout-note",
  },
  TIP: {
    title: "提示",
    icon: "◇",
    className: "reading-callout reading-callout-tip",
  },
  IMPORTANT: {
    title: "重要",
    icon: "!",
    className: "reading-callout reading-callout-important",
  },
  WARNING: {
    title: "警告",
    icon: "⚠",
    className: "reading-callout reading-callout-warning",
  },
  CAUTION: {
    title: "注意",
    icon: "⊗",
    className: "reading-callout reading-callout-caution",
  },
} as const;

interface CalloutMetadata {
  type: CalloutType;
  markerFrom: number;
  markerTo: number;
  textPrefix: number;
}

/** Constant-sized source/value checks; never infer child positions after transforms. */
function marker(quote: Quote, source: string): CalloutMetadata | undefined {
  const paragraph = quote.children[0];
  if (paragraph?.type !== "paragraph") return;
  const text = paragraph.children[0];
  if (text?.type !== "text") return;
  const q = quote.position?.start,
    p = paragraph.position?.start,
    t = text.position?.start;
  const from = p?.offset;
  if (
    !q ||
    q.line !== p?.line ||
    from === undefined ||
    !Number.isSafeInteger(from) ||
    from < 0 ||
    from > source.length
  )
    return;
  if (t && (t.line !== p?.line || t.offset !== from)) return;
  const type = CALLOUT_TYPES.find((value) =>
    source.startsWith(`[!${value}]`, from)
  );
  if (!type) return;
  const value = `[!${type}]`,
    to = from + value.length;
  if (to < source.length && source[to] !== "\n" && source[to] !== "\r") return;
  const textPrefix =
    text.value === value
      ? value.length
      : text.value.startsWith(value + "\r\n")
        ? value.length + 2
        : text.value.startsWith(value + "\r") ||
            text.value.startsWith(value + "\n")
          ? value.length + 1
          : -1;
  if (textPrefix < 0) return;
  return { type, markerFrom: from, markerTo: to, textPrefix };
}

/** First-party canonical adapter; only data is added, after all checks succeed. */
export function annotateCallouts(tree: Root, source: string): void {
  let nodes = 0,
    characters = 0;
  const plans: { quote: Quote; metadata: CalloutMetadata }[] = [];
  function visible(node: Node, prefix = 0, depth = 0): boolean {
    if (++nodes > 100000 || depth > 128) throw Error("Callout budget");
    if (node.type === "definition") return false;
    if (node.type === "text") {
      for (let index = prefix; index < node.value.length; index++) {
        if (++characters > MAX_DOCUMENT_BYTES) throw Error("Callout budget");
        if (!/\s/u.test(node.value[index])) return true;
      }
      return false;
    }
    if (
      [
        "code",
        "html",
        "image",
        "imageReference",
        "thematicBreak",
        "table",
      ].includes(node.type)
    )
      return true;
    return (
      "children" in node &&
      node.children.some((child, index) =>
        visible(child, index === 0 ? prefix : 0, depth + 1)
      )
    );
  }
  for (const node of tree.children) {
    if (++nodes > 100000) throw Error("Callout budget");
    if (node.type !== "blockquote") continue;
    const metadata = marker(node, source);
    if (
      metadata &&
      node.children.some((child, index) =>
        visible(child, index === 0 ? metadata.textPrefix : 0, 1)
      )
    )
      plans.push({ quote: node, metadata });
  }
  for (const { quote, metadata } of plans)
    quote.data = { ...quote.data, agenticCallout: metadata };
}

/** Only a top-level caller may use this; body qualification belongs to the Worker. */
export function readCallout(
  quote: Quote,
  source: string
): CalloutMetadata | undefined {
  const data =
    quote.data && "agenticCallout" in quote.data
      ? quote.data.agenticCallout
      : undefined;
  if (!data || typeof data !== "object") return;
  const expected = marker(quote, source);
  if (!expected) return;
  const value = data as Record<string, unknown>;
  if (
    value.type !== expected.type ||
    value.markerFrom !== expected.markerFrom ||
    value.markerTo !== expected.markerTo ||
    value.textPrefix !== expected.textPrefix
  )
    return;
  return expected;
}
