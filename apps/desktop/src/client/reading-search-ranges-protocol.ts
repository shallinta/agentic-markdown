import { READING_SEARCH_NODES } from "./reading-search-dom";
import { validSearchBoundaries } from "./source-search-protocol";

/** Internal reading-only request. The ordinary source Worker never accepts it. */
export interface ReadingVisibleRangesRequest {
  kind: "viewport-ranges";
  epoch: string;
  id: number;
  intervals: [number, number][];
}
export function validReadingVisibleRangesRequest(
  value: unknown,
  length: number
): value is ReadingVisibleRangesRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    Object.keys(request).sort().join() === "epoch,id,intervals,kind" &&
    request.kind === "viewport-ranges" &&
    typeof request.epoch === "string" &&
    request.epoch.length <= 100 &&
    typeof request.id === "number" &&
    Number.isSafeInteger(request.id) &&
    request.id >= 0 &&
    Number.isSafeInteger(length) &&
    length >= 0 &&
    Array.isArray(request.intervals) &&
    request.intervals.length <= READING_SEARCH_NODES &&
    validSearchBoundaries(request.intervals, length)
  );
}
