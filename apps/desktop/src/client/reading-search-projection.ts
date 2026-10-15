/** Serializable reading coordinates; never a raw/CodeMirror document position. */
export interface ReadingLeaf {
  id: number;
  text: string;
  flow: "normal" | "pre" | "boundary";
}
export interface DomPoint {
  leaf: number;
  offset: number;
}
export interface ReadingRun {
  from: number;
  to: number;
  start: DomPoint;
  end: DomPoint;
  kind: "linear" | "collapsed" | "boundary";
}
export interface ReadingProjection {
  text: string;
  runs: ReadingRun[];
  boundaries: [number, number][];
}

/** One generation, resumable at bounded input work intervals. No DOM access. */
export function* projectReading(
  leaves: readonly ReadingLeaf[],
  maxUnits: number
): Generator<void, ReadingProjection> {
  const parts: string[] = [];
  let chunk = "";
  const runs: ReadingRun[] = [];
  const boundaries: [number, number][] = [];
  let length = 0,
    work = 0,
    input = 0;
  let pending: { start: DomPoint; end: DomPoint } | undefined;
  let lineStart = true;
  const put = (
    value: string,
    start: DomPoint,
    end: DomPoint,
    kind: ReadingRun["kind"]
  ) => {
    if (length + value.length > maxUnits) throw Error("阅读查找投影超过预算");
    const previous = runs[runs.length - 1];
    if (
      kind === "linear" &&
      previous?.kind === "linear" &&
      previous.end.leaf === start.leaf &&
      previous.end.offset === start.offset
    ) {
      previous.to += value.length;
      previous.end = end;
    } else
      runs.push({ from: length, to: length + value.length, start, end, kind });
    chunk += value;
    if (chunk.length >= 4096) {
      parts.push(chunk);
      chunk = "";
    }
    length += value.length;
  };
  const flush = () => {
    if (pending && !lineStart)
      put(
        " ",
        pending.start,
        pending.end,
        pending.start.leaf === pending.end.leaf &&
          pending.end.offset - pending.start.offset === 1
          ? "linear"
          : "collapsed"
      );
    pending = undefined;
  };
  for (const leaf of leaves) {
    if (!Number.isSafeInteger(leaf.id) || leaf.id < 0)
      throw Error("阅读查找叶身份无效");
    if (++work >= 4096) {
      work = 0;
      yield;
    }
    if (leaf.flow === "boundary") {
      pending = undefined;
      const at = length;
      put(
        "\n",
        { leaf: leaf.id, offset: 0 },
        { leaf: leaf.id, offset: 0 },
        "boundary"
      );
      boundaries.push([at, length]);
      lineStart = true;
      continue;
    }
    if (leaf.flow === "pre") flush();
    for (let i = 0; i < leaf.text.length;) {
      const begin = i;
      let char = leaf.text[i++];
      if (char === "\r") {
        if (leaf.text[i] === "\n") i++;
        char = "\n";
      }
      input += i - begin;
      work += i - begin;
      if (input > maxUnits) throw Error("阅读查找输入超过预算");
      const start = { leaf: leaf.id, offset: begin },
        end = { leaf: leaf.id, offset: i };
      if (
        leaf.flow === "normal" &&
        (char === " " || char === "\t" || char === "\n")
      ) {
        pending = { start: pending?.start ?? start, end };
      } else {
        if (leaf.flow === "normal") flush();
        put(
          char,
          start,
          end,
          i - begin === char.length ? "linear" : "collapsed"
        );
        lineStart = char === "\n";
      }
      if (work >= 4096) {
        work = 0;
        yield;
      }
    }
  }
  parts.push(chunk);
  return { text: parts.join(""), runs, boundaries };
}

/** Binary endpoint lookup. Collapsed whitespace maps its complete DOM interval. */
export function readingPoint(
  projection: ReadingProjection,
  offset: number,
  end = false
): DomPoint | null {
  let lo = 0,
    hi = projection.runs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const run = projection.runs[mid];
    if (end ? run.to < offset : run.to <= offset) lo = mid + 1;
    else hi = mid;
  }
  const run = projection.runs[lo];
  if (!run || run.kind === "boundary" || offset < run.from || offset > run.to)
    return null;
  if (run.kind === "linear")
    return {
      leaf: run.start.leaf,
      offset: run.start.offset + offset - run.from,
    };
  return end ? run.end : run.start;
}
