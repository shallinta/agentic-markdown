/** Conservative block refinement. Bounds public geometry calls, not browser layout work. */
export function refineReadingViewport(
  first: [number, number],
  last: [number, number],
  top: number,
  bottom: number,
  measure: (
    from: number,
    to: number,
    block: [number, number]
  ) => { top: number; bottom: number } | null,
  current: () => boolean,
  clipped = { start: true, end: true }
): { from: number; to: number; limited: boolean } {
  const fallback = { from: first[0], to: last[1], limited: true };
  let reads = 0;
  const rect = (from: number, to: number, block: [number, number]) => {
    if (++reads > 64 || !current()) throw Error("阅读视口测量已过期或超限");
    const value = measure(from, to, block);
    if (
      !value ||
      !Number.isFinite(value.top) ||
      !Number.isFinite(value.bottom) ||
      value.bottom <= value.top
    )
      throw Error("阅读视口没有可靠几何");
    return value;
  };
  let from = first[0],
    to = last[1],
    limited = false;
  if (clipped.start)
    try {
      let lo = first[0] + 1,
        hi = first[1];
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (rect(first[0], mid, first).bottom < top) lo = mid + 1;
        else hi = mid;
      }
      from = Math.max(first[0], lo - 1);
    } catch {
      limited = true;
    }
  if (clipped.end)
    try {
      let lo = last[0],
        hi = last[1] - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (rect(mid, last[1], last).top <= bottom) lo = mid;
        else hi = mid - 1;
      }
      to = Math.min(last[1], lo + 1);
    } catch {
      limited = true;
    }
  if (!current()) return fallback;
  return { from, to: Math.max(from, to), limited };
}
