import { normalizeIdentifier } from "micromark-util-normalize-identifier";

import { parseEditingMarkdown as parseCanonicalMarkdown } from "./canonical-parser";
import type {
  ImageSemantic,
  ImageSource,
  ImageSummary,
} from "./image-summary-types";

type Root = ReturnType<typeof parseCanonicalMarkdown>;
type Nodes =
  | Root
  | Root["children"][number]
  | Extract<
      Root["children"][number],
      { children: unknown }
    >["children"][number];
type Definition = Extract<Nodes, { type: "definition" }>;

/** Worker only. Two tree walks; no retained duplicate AST-node array. */
export function summarizeImages(raw: string): ImageSummary {
  const tree = parseCanonicalMarkdown(raw),
    definitions = new Map<string, Definition>();
  function walk(fn: (node: Nodes) => void) {
    const pending: Nodes[] = [tree];
    while (pending.length) {
      const node = pending.pop()!;
      fn(node);
      if ("children" in node)
        for (let i = node.children.length - 1; i >= 0; i--)
          pending.push(node.children[i]);
    }
  }
  walk((node) => {
    if (node.type === "definition") {
      const key = normalizeIdentifier(node.identifier);
      if (!definitions.has(key)) definitions.set(key, node);
    }
  });
  const sources: ImageSource[] = [],
    images: ImageSemantic[] = [],
    sourceIds = new Map<string, Map<string | null, number>>(),
    definitionSources = new Map<Definition, number>();
  walk((node) => {
    if (node.type !== "image" && node.type !== "imageReference") return;
    const resolved =
      node.type === "image"
        ? node
        : definitions.get(normalizeIdentifier(node.identifier));
    const start = node.position?.start.offset,
      end = node.position?.end.offset;
    if (!resolved || start === undefined || end === undefined) return;
    let index =
      resolved.type === "definition"
        ? definitionSources.get(resolved)
        : undefined;
    if (index === undefined) {
      const source = { url: resolved.url, title: resolved.title ?? null };
      let titles = sourceIds.get(source.url);
      if (!titles) {
        titles = new Map();
        sourceIds.set(source.url, titles);
      }
      index = titles.get(source.title);
      if (index === undefined) {
        index = sources.length;
        titles.set(source.title, index);
        sources.push(source);
      }
      if (resolved.type === "definition")
        definitionSources.set(resolved, index);
    }
    images.push({
      from: 0,
      to: 0,
      rawFrom: start,
      rawTo: end,
      source: index,
      alt: node.alt ?? "",
    });
  });
  // Images have source order and nonoverlapping ranges. One monotonic raw scan.
  let cursor = 0,
    editor = 0;
  function advance(end: number) {
    while (cursor < end) {
      cursor += raw[cursor] === "\r" && raw[cursor + 1] === "\n" ? 2 : 1;
      editor++;
    }
    return editor;
  }
  for (const image of images) {
    image.from = advance(image.rawFrom);
    image.to = advance(image.rawTo);
  }
  return { sources, images };
}
