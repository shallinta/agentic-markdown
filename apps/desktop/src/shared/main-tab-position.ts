import { MAX_DOCUMENT_BYTES } from "./documents";

/** Storage precursor only. Block hashing and resolution are not implemented here. */
export interface MainTabPosition {
  version: 1;
  anchor: {
    kind: "block-sha256-v1";
    hash: string;
    occurrence: number;
  };
  /** Signed viewport-relative CSS pixels, not total document scroll. */
  offset: number;
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function validMainTabPosition(value: unknown): value is MainTabPosition {
  if (
    !object(value) ||
    Object.keys(value).sort().join() !== "anchor,offset,version" ||
    value.version !== 1 ||
    typeof value.offset !== "number" ||
    !Number.isFinite(value.offset) ||
    Math.abs(value.offset) > Number.MAX_SAFE_INTEGER ||
    Object.is(value.offset, -0)
  )
    return false;
  const anchor = value.anchor;
  return (
    object(anchor) &&
    Object.keys(anchor).sort().join() === "hash,kind,occurrence" &&
    anchor.kind === "block-sha256-v1" &&
    typeof anchor.hash === "string" &&
    /^[a-f0-9]{64}$/.test(anchor.hash) &&
    typeof anchor.occurrence === "number" &&
    Number.isSafeInteger(anchor.occurrence) &&
    anchor.occurrence >= 0 &&
    anchor.occurrence <= MAX_DOCUMENT_BYTES &&
    !Object.is(anchor.occurrence, -0)
  );
}
