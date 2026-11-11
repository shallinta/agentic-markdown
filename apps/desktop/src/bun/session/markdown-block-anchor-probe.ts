import { createHash } from "node:crypto";

import { parseEditingMarkdown } from "../../client/canonical-parser";
import { MAX_DOCUMENT_BYTES } from "../../shared/documents";
import {
  validMainTabPosition,
  type MainTabPosition,
} from "../../shared/main-tab-position";

export interface MarkdownBlockAnchor {
  contentHash: string;
  uniqueAtCapture: boolean;
  position: MainTabPosition;
}
export interface MarkdownPositionReceipt {
  anchor: MarkdownBlockAnchor | undefined;
  blockOffset: number | undefined;
  before: string | undefined;
  after: string | undefined;
  from: number;
  offset: number;
  ratio: number;
}
export type MarkdownPositionResolution =
  | { status: "block"; from: number; to: number; offset?: number }
  | { status: "neighbor"; side: "before" | "after"; from: number; to: number }
  | { status: "source"; from: number; offset: number }
  | { status: "ratio"; ratio: number }
  | { status: "invalid" };

function validOffset(value: number) {
  return (
    Number.isFinite(value) &&
    Math.abs(value) <= Number.MAX_SAFE_INTEGER &&
    !Object.is(value, -0)
  );
}
function validRatio(value: number) {
  return (
    Number.isFinite(value) && value >= 0 && value <= 1 && !Object.is(value, -0)
  );
}
interface Block {
  from: number;
  to: number;
  hash: string;
  occurrence: number;
}
export type MarkdownBlockResolution =
  | { status: "matched"; from: number; to: number; offset: number }
  | { status: "invalid" | "missing" | "ambiguous" };
const hashPattern = /^[a-f0-9]{64}$/;

/** Internal experiment. No DOM or persistence; original capture/resolve remain exact-only. */
export function createMarkdownBlockAnchorProbe(raw: string) {
  if (typeof raw !== "string") return { status: "invalid" as const };
  const sourceLength = raw.length;
  if (sourceLength > MAX_DOCUMENT_BYTES)
    return { status: "too-large" as const };
  const byteLength = Buffer.byteLength(raw, "utf8");
  if (byteLength > MAX_DOCUMENT_BYTES) return { status: "too-large" as const };
  const bytes = Buffer.from(raw, "utf8");
  // UTF-8 replacement of unpaired UTF-16 surrogates must not produce shared identities.
  if (bytes.toString("utf8") !== raw) return { status: "invalid" as const };
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const blocks: Block[] = [];
  const byHash = new Map<string, Block[]>();
  try {
    const tree = parseEditingMarkdown(raw);
    let previousEnd = 0;
    for (const node of tree.children) {
      const from = node.position?.start.offset;
      const to = node.position?.end.offset;
      if (
        typeof from !== "number" ||
        typeof to !== "number" ||
        !Number.isSafeInteger(from) ||
        !Number.isSafeInteger(to) ||
        from < previousEnd ||
        to <= from ||
        to > raw.length
      )
        return { status: "invalid" as const };
      previousEnd = to;
      if (node.type === "definition") continue;
      const hash = createHash("sha256")
        .update(node.type, "utf8")
        .update("\0")
        .update(raw.slice(from, to), "utf8")
        .digest("hex");
      const matches = byHash.get(hash) ?? [];
      const block = { from, to, hash, occurrence: matches.length };
      matches.push(block);
      byHash.set(hash, matches);
      blocks.push(block);
    }
  } catch {
    return { status: "invalid" as const };
  }
  // A bounded bitset retains only invalid UTF-16 boundaries, never the source body.
  const invalidBoundaries = new Uint8Array(Math.ceil((sourceLength + 1) / 8));
  for (let index = 1; index < sourceLength; index++) {
    const previous = raw.charCodeAt(index - 1);
    const next = raw.charCodeAt(index);
    if (
      (previous === 13 && next === 10) ||
      (previous >= 0xd800 &&
        previous <= 0xdbff &&
        next >= 0xdc00 &&
        next <= 0xdfff)
    )
      invalidBoundaries[index >>> 3] |= 1 << (index & 7);
  }
  function sourceValid(from: number) {
    return (
      Number.isSafeInteger(from) &&
      !Object.is(from, -0) &&
      from >= 0 &&
      from <= sourceLength &&
      !(invalidBoundaries[from >>> 3] & (1 << (from & 7)))
    );
  }
  function blockIndex(from: number) {
    let low = 0,
      high = blocks.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (blocks[mid].to <= from) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  const probe = {
    status: "ready" as const,
    byteLength,
    blockCount: blocks.length,
    capture(
      sourceOffset: number,
      viewportOffset: number
    ): MarkdownBlockAnchor | undefined {
      if (
        !Number.isSafeInteger(sourceOffset) ||
        sourceOffset < 0 ||
        sourceOffset >= sourceLength
      )
        return;
      const block = blocks[blockIndex(sourceOffset)];
      if (!block || block.from > sourceOffset) return;
      const position: MainTabPosition = {
        version: 1,
        anchor: {
          kind: "block-sha256-v1",
          hash: block.hash,
          occurrence: block.occurrence,
        },
        offset: viewportOffset,
      };
      return validMainTabPosition(position)
        ? {
            contentHash,
            uniqueAtCapture: byHash.get(block.hash)!.length === 1,
            position,
          }
        : undefined;
    },
    resolve(value: unknown): MarkdownBlockResolution {
      try {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).sort().join() !==
            "contentHash,position,uniqueAtCapture"
        )
          return { status: "invalid" };
        const anchor = value as MarkdownBlockAnchor;
        if (
          typeof anchor.contentHash !== "string" ||
          !hashPattern.test(anchor.contentHash) ||
          !validMainTabPosition(anchor.position) ||
          typeof anchor.uniqueAtCapture !== "boolean" ||
          (anchor.uniqueAtCapture && anchor.position.anchor.occurrence !== 0)
        )
          return { status: "invalid" };
        const matches = byHash.get(anchor.position.anchor.hash);
        if (!matches?.length) return { status: "missing" };
        if (
          anchor.contentHash !== contentHash &&
          (!anchor.uniqueAtCapture || matches.length !== 1)
        )
          return { status: "ambiguous" };
        const block =
          matches[
            anchor.contentHash === contentHash
              ? anchor.position.anchor.occurrence
              : 0
          ];
        return block
          ? {
              status: "matched",
              from: block.from,
              to: block.to,
              offset: anchor.position.offset,
            }
          : { status: "missing" };
      } catch {
        return { status: "invalid" };
      }
    },
    capturePosition(input: {
      from: number;
      offset: number;
      ratio: number;
      blockOffset?: number;
    }): MarkdownPositionReceipt | undefined {
      const { from, offset, ratio } = input;
      if (
        !sourceValid(from) ||
        !validOffset(offset) ||
        !validRatio(ratio) ||
        (input.blockOffset !== undefined && !validOffset(input.blockOffset))
      )
        return;
      const block = blocks[blockIndex(from)];
      const blockOffset =
        input.blockOffset ?? (block?.from === from ? offset : undefined);
      const anchor = probe.capture(from, blockOffset ?? 0);
      const index = blockIndex(from);
      const uniqueHash = (block: Block | undefined) =>
        block && byHash.get(block.hash)!.length === 1 ? block.hash : undefined;
      return {
        anchor,
        blockOffset: anchor ? blockOffset : undefined,
        before: anchor ? uniqueHash(blocks[index - 1]) : undefined,
        after: anchor ? uniqueHash(blocks[index + 1]) : undefined,
        from,
        offset,
        ratio,
      };
    },
    resolvePosition(value: unknown): MarkdownPositionResolution {
      try {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).sort().join() !==
            "after,anchor,before,blockOffset,from,offset,ratio"
        )
          return { status: "invalid" };
        const receipt = value as MarkdownPositionReceipt;
        if (
          !Number.isSafeInteger(receipt.from) ||
          receipt.from < 0 ||
          receipt.from > MAX_DOCUMENT_BYTES ||
          Object.is(receipt.from, -0) ||
          !validOffset(receipt.offset) ||
          !validRatio(receipt.ratio) ||
          (receipt.blockOffset !== undefined &&
            !validOffset(receipt.blockOffset)) ||
          [receipt.before, receipt.after].some(
            (hash) =>
              hash !== undefined &&
              (typeof hash !== "string" || !hashPattern.test(hash))
          )
        )
          return { status: "invalid" };
        if (receipt.anchor !== undefined) {
          const exact = probe.resolve(receipt.anchor);
          if (exact.status === "invalid") return { status: "invalid" };
          if (
            receipt.anchor.contentHash === contentHash &&
            exact.status !== "matched"
          )
            return { status: "invalid" };
          if (
            receipt.anchor.position.offset !== (receipt.blockOffset ?? 0) ||
            receipt.before === receipt.anchor.position.anchor.hash ||
            receipt.after === receipt.anchor.position.anchor.hash ||
            (receipt.before !== undefined && receipt.before === receipt.after)
          )
            return { status: "invalid" };
          if (
            receipt.anchor.contentHash === contentHash &&
            exact.status === "matched" &&
            (!sourceValid(receipt.from) ||
              receipt.from < exact.from ||
              receipt.from >= exact.to)
          )
            return { status: "invalid" };
          if (exact.status === "matched")
            return {
              status: "block",
              from: exact.from,
              to: exact.to,
              ...(receipt.blockOffset === undefined
                ? {}
                : { offset: receipt.blockOffset }),
            };
          const unique = (hash: string | undefined) => {
            const entries = hash === undefined ? undefined : byHash.get(hash);
            return entries?.length === 1 ? entries[0] : undefined;
          };
          const before = unique(receipt.before),
            after = unique(receipt.after);
          if (after && (!before || before.from < after.from))
            return {
              status: "neighbor",
              side: "after",
              from: after.from,
              to: after.to,
            };
          if (before && !after)
            return {
              status: "neighbor",
              side: "before",
              from: before.from,
              to: before.to,
            };
        } else if (
          receipt.before !== undefined ||
          receipt.after !== undefined ||
          receipt.blockOffset !== undefined
        )
          return { status: "invalid" };
        return sourceValid(receipt.from)
          ? { status: "source", from: receipt.from, offset: receipt.offset }
          : { status: "ratio", ratio: receipt.ratio };
      } catch {
        return { status: "invalid" };
      }
    },
  };
  return probe;
}
