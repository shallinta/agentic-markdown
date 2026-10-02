import {
  CANONICAL_CONFIG,
  canonicalCorpus,
  type CanonicalRow,
} from "../shared/canonical-corpus";

import { BomAwareParser } from "./bom-aware-parser";
import { parseCanonicalMarkdown } from "./canonical-parser";

export { parseCanonicalMarkdown } from "./canonical-parser";
const canonicalKinds = new Set([
  "heading",
  "blockquote",
  "list",
  "listItem",
  "link",
  "linkReference",
  "definition",
  "strong",
  "inlineCode",
  "break",
  "code",
  "html",
]);
const editorKinds: Record<string, string> = {
  Blockquote: "blockquote",
  BulletList: "list",
  OrderedList: "list",
  ListItem: "listItem",
  LinkReference: "definition",
  StrongEmphasis: "strong",
  InlineCode: "inlineCode",
  HardBreak: "break",
  FencedCode: "code",
  CodeBlock: "code",
  HTMLBlock: "html",
  HTMLTag: "html",
  Escape: "escape",
  Entity: "entity",
};
const equal = (a: Record<string, number>, b: object) =>
  JSON.stringify(Object.entries(a).sort()) ===
  JSON.stringify(Object.entries(b).sort());
export function runCanonicalSample(request: unknown): CanonicalRow {
  if (
    !request ||
    typeof request !== "object" ||
    Object.keys(request).sort().join() !== "config,id"
  )
    throw new Error("Invalid sample request");
  const { id, config } = request as { id: unknown; config: unknown };
  const sample = canonicalCorpus.find((value) => value.id === id);
  if (config !== CANONICAL_CONFIG || !sample) throw new Error("Unknown sample");
  const start = performance.now();
  const tree = parseCanonicalMarkdown(sample.text);
  const canonical: Record<string, number> = {},
    editor: Record<string, number> = {};
  let rangesValid = true,
    decoded = "";
  const headings: number[] = [],
    targets: string[] = [];
  const definitions = new Map<string, string>();
  const references: string[] = [];
  const canonicalRanges: NonNullable<typeof sample.ranges> = [];
  const editorRanges: NonNullable<typeof sample.ranges> = [];
  const visit = (node: typeof tree | (typeof tree.children)[number]) => {
    if (canonicalKinds.has(node.type))
      canonical[node.type] = (canonical[node.type] ?? 0) + 1;
    const from = node.position?.start.offset,
      to = node.position?.end.offset;
    rangesValid &&=
      from !== undefined &&
      to !== undefined &&
      from >= 0 &&
      to >= from &&
      to <= sample.text.length;
    if (node.type === "text") decoded += node.value;
    if (node.type === "heading") headings.push(node.depth);
    if (node.type === "link") targets.push(node.url);
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
    if (node.type === "linkReference") references.push(node.identifier);
    if (
      sample.ranges &&
      (node.type === "heading" || node.type === "link") &&
      from !== undefined &&
      to !== undefined
    )
      canonicalRanges.push({
        kind: node.type,
        from,
        to,
        source: sample.text.slice(from, to),
      });
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(tree);
  for (const reference of references)
    targets.push(definitions.get(reference) ?? "UNRESOLVED");
  // Match the editor's LF normalization, retaining an offset map back to the
  // untouched raw UTF-16 input. mdast above reads that raw input directly.
  const offsets = [0];
  let editingText = "";
  for (let index = 0; index < sample.text.length; index++) {
    const character = sample.text[index];
    if (character === "\r" && sample.text[index + 1] === "\n") index++;
    editingText += character === "\r" ? "\n" : character;
    offsets.push(index + 1);
  }
  new BomAwareParser().parse(editingText).iterate({
    enter(node) {
      let kind = editorKinds[node.name];
      if (/^(ATXHeading|SetextHeading)[1-6]$/.test(node.name)) kind = "heading";
      if (node.name === "Link")
        kind =
          node.node.getChildren("LinkMark").length === 4
            ? "link"
            : "referenceCandidate";
      if (kind) editor[kind] = (editor[kind] ?? 0) + 1;
      if (sample.ranges && (kind === "heading" || kind === "link")) {
        const from = offsets[node.from],
          to = offsets[node.to];
        editorRanges.push({
          kind,
          from,
          to,
          source: sample.text.slice(from, to),
        });
      }
      rangesValid &&=
        node.from >= 0 &&
        node.to >= node.from &&
        node.to <= editingText.length &&
        offsets[node.to] <= sample.text.length;
    },
  });
  if (sample.ranges)
    rangesValid &&=
      JSON.stringify(canonicalRanges) === JSON.stringify(sample.ranges) &&
      JSON.stringify(editorRanges) === JSON.stringify(sample.ranges);
  const decodedMatches = !("decoded" in sample) || decoded === sample.decoded;
  const semanticMatches =
    JSON.stringify(headings) === JSON.stringify(sample.headings ?? []) &&
    JSON.stringify(targets) === JSON.stringify(sample.targets ?? []);
  return {
    id: sample.id,
    canonical,
    editor,
    rangesValid,
    decodedMatches,
    semanticMatches,
    headings,
    targets,
    passed:
      equal(canonical, sample.expected) &&
      equal(editor, sample.editor) &&
      rangesValid &&
      decodedMatches &&
      semanticMatches,
    milliseconds: performance.now() - start,
  };
}
