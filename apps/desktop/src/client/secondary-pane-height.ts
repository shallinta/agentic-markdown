export const SECONDARY_MIN_HEIGHT = 33;

export type SecondaryPaneAllocation =
  { ok: true; heights: number[] } | { ok: false; reason: "full" | "invalid" };

/** Compensated sum: inputs are model heights, not independently rounded DOM boxes. */
function sum(values: readonly number[]): number {
  let total = 0,
    correction = 0;
  for (const value of values) {
    const adjusted = value - correction;
    const next = total + adjusted;
    correction = next - total - adjusted;
    total = next;
  }
  return total;
}

/** Append one document; failure never changes the caller's allocation. */
export function allocateSecondaryPaneHeight(
  total: number,
  current: readonly number[]
): SecondaryPaneAllocation {
  const min = SECONDARY_MIN_HEIGHT;
  if (!Number.isFinite(total) || total < 0 || !Array.isArray(current))
    return { ok: false, reason: "invalid" };
  for (const height of current)
    if (!Number.isFinite(height) || height < min)
      return { ok: false, reason: "invalid" };
  const originalTotal = sum(current);
  const tolerance = Number.EPSILON * Math.max(1, total, originalTotal) * 8;
  if (
    !Number.isFinite(originalTotal) ||
    (current.length && Math.abs(originalTotal - total) > tolerance)
  )
    return { ok: false, reason: "invalid" };
  // Do not use floating-point tolerance to admit genuinely insufficient space.
  if (total < (current.length + 1) * min) return { ok: false, reason: "full" };
  if (total === (current.length + 1) * min)
    return { ok: true, heights: Array.from({ length: current.length + 1 }, () => min) };
  if (!current.length) return { ok: true, heights: [total] };

  const ratio = current.length / (current.length + 1);
  const heights = current.map((height) => Math.max(min, height * ratio));
  const available = total - sum(heights);
  if (available >= min) return { ok: true, heights: [...heights, available] };

  // Sorting capacities implements equal-pixel water filling in O(n log n).
  // Each minimum-bound item leaves once; output retains its original index.
  let deficit = min - available;
  const capacities = heights
    .map((height, index) => ({ index, spare: height - min }))
    .filter(({ spare }) => spare > 0)
    .sort((a, b) => a.spare - b.spare);
  for (let index = 0; index < capacities.length; index++) {
    const share = deficit / (capacities.length - index);
    const entry = capacities[index];
    if (entry.spare <= share) {
      heights[entry.index] = min;
      deficit -= entry.spare;
    } else {
      for (let rest = index; rest < capacities.length; rest++)
        heights[capacities[rest].index] = Math.max(
          min,
          heights[capacities[rest].index] - share
        );
      deficit = 0;
      break;
    }
  }
  if (deficit > tolerance) return { ok: false, reason: "invalid" };

  // Absorb only arithmetic residue in an old slot; new document stays at min.
  const residue = total - sum([...heights, min]);
  let largest = -1;
  for (let index = 0; index < heights.length; index++)
    if (
      current[index] > min &&
      (largest < 0 || heights[index] > heights[largest])
    )
      largest = index;
  if (largest >= 0) {
    const corrected = heights[largest] + residue;
    if (corrected >= min) heights[largest] = corrected;
  }
  const result = [...heights, min];
  if (
    result.some((height) => !Number.isFinite(height) || height < min) ||
    Math.abs(sum(result) - total) > tolerance
  )
    return { ok: false, reason: "invalid" };
  return { ok: true, heights: result };
}
