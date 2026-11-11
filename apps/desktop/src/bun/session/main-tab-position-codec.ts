import { MAX_DOCUMENT_BYTES } from "../../shared/documents";
import { validMainTabPosition } from "../../shared/main-tab-position";
import { hashPattern } from "../../shared/save-content";

import type { MarkdownPositionReceipt } from "./markdown-block-anchor-probe";

export interface StoredMainTabPosition {
  from: number;
  offset: number;
  ratio: number;
  block?: {
    contentHash: string;
    hash: string;
    occurrence: number;
    uniqueAtCapture: boolean;
    offset?: number;
    before?: string;
    after?: string;
  };
}

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

/** Read enumerable own data fields without invoking accessors or serialization hooks. */
function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const keys = Object.keys(value);
  if (
    keys.length < required.length ||
    keys.length > required.length + optional.length
  )
    return;
  const projected: Record<string, unknown> = {};
  for (const key of keys) {
    if (!required.includes(key) && !optional.includes(key)) return;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !hasOwn(descriptor, "value")) return;
    projected[key] = descriptor.value;
  }
  if (required.every((key) => hasOwn(projected, key))) return projected;
}

const finiteOffset = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= Number.MAX_SAFE_INTEGER &&
  !Object.is(value, -0);

const isHash = (value: unknown): value is string =>
  typeof value === "string" && hashPattern.test(value);

/** Validate the persisted format and return a fresh object with only JSON primitives. */
export function copyStoredMainTabPosition(
  value: unknown
): StoredMainTabPosition | undefined {
  try {
    const source = fields(value, ["from", "offset", "ratio"], ["block"]);
    if (!source) return;
    const { from, offset, ratio } = source;
    if (
      typeof from !== "number" ||
      !Number.isSafeInteger(from) ||
      from < 0 ||
      from > MAX_DOCUMENT_BYTES ||
      Object.is(from, -0) ||
      !finiteOffset(offset) ||
      !finiteOffset(ratio) ||
      ratio < 0 ||
      ratio > 1
    )
      return;

    const position: StoredMainTabPosition = { from, offset, ratio };
    if (!hasOwn(source, "block")) return position;
    const block = fields(
      source.block,
      ["contentHash", "hash", "occurrence", "uniqueAtCapture"],
      ["offset", "before", "after"]
    );
    if (!block) return;
    const { contentHash, uniqueAtCapture, before, after } = block;
    if (
      !isHash(contentHash) ||
      typeof uniqueAtCapture !== "boolean" ||
      (hasOwn(block, "offset") && !finiteOffset(block.offset)) ||
      (hasOwn(block, "before") && !isHash(before)) ||
      (hasOwn(block, "after") && !isHash(after))
    )
      return;

    const anchor = {
      version: 1,
      anchor: {
        kind: "block-sha256-v1",
        hash: block.hash,
        occurrence: block.occurrence,
      },
      offset: block.offset ?? 0,
    };
    if (!validMainTabPosition(anchor)) return;
    const { hash, occurrence } = anchor.anchor;
    if (
      (uniqueAtCapture && occurrence !== 0) ||
      before === hash ||
      after === hash ||
      (before !== undefined && before === after)
    )
      return;

    position.block = {
      contentHash,
      hash,
      occurrence,
      uniqueAtCapture,
      ...(hasOwn(block, "offset") ? { offset: anchor.offset } : {}),
      ...(typeof before === "string" ? { before } : {}),
      ...(typeof after === "string" ? { after } : {}),
    };
    return position;
  } catch {
    return;
  }
}

/** Project the in-memory receipt, omitting absent fields in the persisted shape. */
export function encodeMainTabPosition(
  value: unknown
): StoredMainTabPosition | undefined {
  try {
    const source = fields(value, [
      "anchor",
      "blockOffset",
      "before",
      "after",
      "from",
      "offset",
      "ratio",
    ]);
    if (!source) return;
    const { anchor, blockOffset, before, after, from, offset, ratio } = source;
    if (anchor === undefined) {
      if (
        blockOffset !== undefined ||
        before !== undefined ||
        after !== undefined
      )
        return;
      return copyStoredMainTabPosition({ from, offset, ratio });
    }
    const block = fields(anchor, [
      "contentHash",
      "uniqueAtCapture",
      "position",
    ]);
    const position = fields(block?.position, ["version", "anchor", "offset"]);
    const digest = fields(position?.anchor, ["kind", "hash", "occurrence"]);
    if (
      !block ||
      position?.version !== 1 ||
      digest?.kind !== "block-sha256-v1" ||
      !Object.is(position.offset, blockOffset ?? 0)
    )
      return;
    return copyStoredMainTabPosition({
      from,
      offset,
      ratio,
      block: {
        contentHash: block.contentHash,
        hash: digest.hash,
        occurrence: digest.occurrence,
        uniqueAtCapture: block.uniqueAtCapture,
        ...(blockOffset === undefined ? {} : { offset: blockOffset }),
        ...(before === undefined ? {} : { before }),
        ...(after === undefined ? {} : { after }),
      },
    });
  } catch {
    return;
  }
}

/** Rebuild the exact receipt shape consumed by the Markdown position resolver. */
export function decodeMainTabPosition(
  value: unknown
): MarkdownPositionReceipt | undefined {
  const stored = copyStoredMainTabPosition(value);
  if (!stored) return;
  const { block, from, offset, ratio } = stored;
  return {
    from,
    offset,
    ratio,
    blockOffset: block?.offset,
    before: block?.before,
    after: block?.after,
    anchor: block && {
      contentHash: block.contentHash,
      uniqueAtCapture: block.uniqueAtCapture,
      position: {
        version: 1,
        offset: block.offset ?? 0,
        anchor: {
          kind: "block-sha256-v1",
          hash: block.hash,
          occurrence: block.occurrence,
        },
      },
    },
  };
}
