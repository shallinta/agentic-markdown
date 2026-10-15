import type { SearchResult } from "./source-search-protocol";

/** A nonempty match without its current DOM range is a failed presentation, not a skipped mark. */
export function readingHighlightRanges(
  result: SearchResult,
  range: (from: number, to: number) => Range | null
) {
  const requireRange = (from: number, to: number) => {
    const value = range(from, to);
    if (!value) throw Error("阅读查找映射已失效，请重试");
    return value;
  };
  const selected = result.current ? requireRange(...result.current) : null;
  const ranges: Range[] = [];
  for (let i = 0; i < result.ranges.length; i += 2)
    ranges.push(requireRange(result.ranges[i], result.ranges[i + 1]));
  return { selected, ranges };
}

/** Registry entries are private to this owner; cleanup never clears other users. */
let sequence = 0;
export function createReadingHighlights(document: Document) {
  const global = document.defaultView as
    | (Window & {
        Highlight?: new (...ranges: Range[]) => object;
        CSS?: { highlights?: Map<string, object> };
      })
    | null;
  const registry = global?.CSS?.highlights,
    Constructor = global?.Highlight;
  if (!registry || !Constructor) throw Error("当前阅读环境不支持查找高亮");
  const name = `agentic-reading-${++sequence}`,
    currentName = `${name}-current`;
  const style = document.createElement("style");
  style.textContent = `::highlight(${name}){background-color:var(--reading-search-match,#efd675);color:var(--reading-search-text,#171717)}::highlight(${currentName}){background-color:var(--reading-search-current,#f4a94e);color:var(--reading-search-text,#171717)}`;
  document.head.append(style);
  let marks: object | undefined, current: object | undefined;
  const clear = () => {
    if (registry.get(name) === marks) registry.delete(name);
    if (registry.get(currentName) === current) registry.delete(currentName);
    marks = current = undefined;
  };
  return {
    paint(ranges: Range[], selected: Range | null) {
      clear();
      marks = new Constructor(...ranges);
      registry.set(name, marks);
      if (selected) {
        current = new Constructor(selected);
        registry.set(currentName, current);
      }
    },
    clear,
    dispose() {
      clear();
      style.remove();
    },
  };
}
