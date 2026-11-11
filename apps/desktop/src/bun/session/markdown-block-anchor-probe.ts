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

/** Internal experiment. No DOM, persistence, neighboring-block or source/ratio fallback. */
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
  return {
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
      let low = 0,
        high = blocks.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (blocks[mid].to <= sourceOffset) low = mid + 1;
        else high = mid;
      }
      const block = blocks[low];
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
  };
}
