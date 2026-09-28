import { commonmarkLanguage } from "@codemirror/lang-markdown";
import { NodeProp, NodeType, NodeSet, Tree, TreeBuffer } from "@lezer/common";

/** Only the fixed CommonMark grammar is supported, not arbitrary mounted parsers. */
export interface MarkdownTreeWire {
  type: number;
  length: number;
  positions: number[];
  contextHash?: number;
  children: (MarkdownTreeWire | { buffer: Uint16Array; length: number })[];
}
const parser = commonmarkLanguage.parser;
if (!("nodeSet" in parser) || !(parser.nodeSet instanceof NodeSet))
  throw new Error("CommonMark node set unavailable");
const nodeSet = parser.nodeSet;
export function encodeMarkdownTree(tree: Tree): MarkdownTreeWire {
  // Unknown per-node props must fail explicitly instead of silently losing semantics.
  const contextHash = tree.prop(NodeProp.contextHash);
  const known = new Tree(
    tree.type,
    [],
    [],
    0,
    contextHash === undefined ? [] : [[NodeProp.contextHash, contextHash]]
  ).propValues;
  if (tree.propValues.some(([id]) => !known.some(([other]) => other === id)))
    throw new Error("Unsupported Markdown tree property");
  return {
    type: tree.type.id,
    length: tree.length,
    positions: [...tree.positions],
    ...(contextHash === undefined ? {} : { contextHash }),
    children: tree.children.map((child) =>
      child instanceof TreeBuffer
        ? { buffer: child.buffer, length: child.length }
        : encodeMarkdownTree(child)
    ),
  };
}
export function decodeMarkdownTree(wire: MarkdownTreeWire): Tree {
  const type = wire.type === 0 ? NodeType.none : nodeSet.types[wire.type];
  if (
    !type ||
    !Number.isSafeInteger(wire.length) ||
    wire.length < 0 ||
    wire.positions.length !== wire.children.length
  )
    throw new Error("Invalid Markdown tree");
  return new Tree(
    type,
    wire.children.map((child) =>
      "buffer" in child
        ? new TreeBuffer(child.buffer, child.length, nodeSet)
        : decodeMarkdownTree(child)
    ),
    wire.positions,
    wire.length,
    wire.contextHash === undefined
      ? []
      : [[NodeProp.contextHash, wire.contextHash]]
  );
}
export interface MarkdownParseRequest {
  requestId: number;
  text: string;
}
export type MarkdownParseResponse =
  | { requestId: number; tree: MarkdownTreeWire }
  | { requestId: number; error: true };
