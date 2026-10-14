import { MAX_DOCUMENT_BYTES } from "../shared/documents";

import { IMAGE_SUMMARY_CONFIG, type ImageSummary } from "./image-summary-types";

export interface ImageSummaryRequest {
  requestId: number;
  documentId: string;
  revision: number;
  config: string;
  text: string;
}
export interface ImageSummaryResponse {
  requestId: number;
  documentId: string;
  revision: number;
  config: string;
  summary: ImageSummary;
}
export function isImageSummaryRequest(
  value: unknown
): value is ImageSummaryRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ImageSummaryRequest>;
  return (
    Number.isSafeInteger(v.requestId) &&
    v.requestId! > 0 &&
    typeof v.documentId === "string" &&
    v.documentId.length > 0 &&
    v.documentId.length <= 200 &&
    Number.isSafeInteger(v.revision) &&
    v.revision! >= 0 &&
    v.config === IMAGE_SUMMARY_CONFIG &&
    typeof v.text === "string" &&
    v.text.length <= MAX_DOCUMENT_BYTES &&
    new TextEncoder().encode(v.text).length <= MAX_DOCUMENT_BYTES
  );
}
/** Shape envelope only; payload validation is cooperatively consumed by owner. */
export function imageResponseEnvelope(
  value: unknown
): value is ImageSummaryResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ImageSummaryResponse>;
  return (
    v.config === IMAGE_SUMMARY_CONFIG &&
    Number.isSafeInteger(v.requestId) &&
    typeof v.documentId === "string" &&
    Number.isSafeInteger(v.revision) &&
    !!v.summary &&
    Array.isArray(v.summary.sources) &&
    Array.isArray(v.summary.images)
  );
}
export function* validateImageSummary(
  summary: ImageSummary,
  rawLength: number,
  editorLength: number
): Generator<void, boolean> {
  // Every image has a nonempty disjoint source span. Distinct decoded source
  // values occupy direct-resource or definition spans, and alt values occupy
  // image spans. Neither decoding step expands past its raw UTF-16 spelling.
  // Two groups may overlap, so charge their combined strings against 2 * raw.
  if (summary.images.length > rawLength || summary.sources.length > rawLength)
    return false;
  let units = 0;
  const string = function* (value: unknown): Generator<void, boolean> {
    if (typeof value !== "string") return false;
    units += value.length;
    if (units > rawLength * 2) return false;
    for (let offset = 0; offset < value.length; offset += 4096) yield;
    return true;
  };
  for (const source of summary.sources) {
    yield;
    if (
      !source ||
      typeof source !== "object" ||
      !(yield* string(source.url)) ||
      (source.title !== null && !(yield* string(source.title)))
    )
      return false;
  }
  let rawEnd = 0,
    end = 0;
  for (const image of summary.images) {
    yield;
    if (
      !image ||
      typeof image !== "object" ||
      ![image.from, image.to, image.rawFrom, image.rawTo, image.source].every(
        Number.isSafeInteger
      ) ||
      image.from < end ||
      image.to <= image.from ||
      image.to > editorLength ||
      image.rawFrom < rawEnd ||
      image.rawTo <= image.rawFrom ||
      image.rawTo > rawLength ||
      image.source < 0 ||
      image.source >= summary.sources.length ||
      !(yield* string(image.alt))
    )
      return false;
    end = image.to;
    rawEnd = image.rawTo;
  }
  return true;
}
