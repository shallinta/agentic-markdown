import { SearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";

import {
  SEARCH_MARK_LIMIT,
  validSearchRequest,
  type SearchRequest,
  type SearchResult,
} from "./source-search-protocol";

/** Disposable Worker-only projection. No Markdown extensions or filesystem. */
export function createSearchEngine() {
  let state: EditorState | undefined;
  let epoch = "";
  let pairs = new Uint32Array();
  let count = 0,
    index = -1;
  const lowerBound = (position: number, end = false) => {
    let lo = 0,
      hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (pairs[mid * 2 + (end ? 1 : 0)] < position) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return (request: SearchRequest): SearchResult => {
    if (!validSearchRequest(request)) throw new Error("invalid search request");
    if (request.kind === "scan") {
      if (request.text !== undefined)
        state = EditorState.create({ doc: request.text });
      if (!state) throw new Error("missing search text");
      epoch = request.epoch;
      const query = request.options.query.replace(/\r\n?/g, "\n");
      const folded = request.options.caseSensitive
        ? query
        : query.toLowerCase();
      const search = new SearchQuery({
        search: query,
        literal: true,
        regexp: false,
        caseSensitive: request.options.caseSensitive,
        wholeWord: request.options.wholeWord,
        test: (match) =>
          (request.options.caseSensitive ? match : match.toLowerCase()) ===
          folded,
      });
      pairs = new Uint32Array(state.doc.length * 2);
      count = 0;
      if (search.valid) {
        const cursor = search.getCursor(state);
        for (let next = cursor.next(); !next.done; next = cursor.next()) {
          if (count >= state.doc.length) throw new Error("search index limit");
          pairs[count * 2] = next.value.from;
          pairs[count * 2 + 1] = next.value.to;
          count++;
        }
      }
      index = count
        ? lowerBound(Math.min(request.position, state.doc.length)) % count
        : -1;
    } else {
      if (!state || request.epoch !== epoch) throw new Error("stale search");
      if (request.kind === "navigate" && count)
        index = (((index + request.direction) % count) + count) % count;
    }
    const ranges: number[] = [];
    let limited = false;
    if (request.kind === "viewport") {
      for (
        let i = lowerBound(request.from, true);
        i < count && pairs[i * 2] < request.to;
        i++
      ) {
        if (pairs[i * 2 + 1] <= request.from) continue;
        if (ranges.length === SEARCH_MARK_LIMIT * 2) {
          limited = true;
          break;
        }
        ranges.push(pairs[i * 2], pairs[i * 2 + 1]);
      }
    }
    return {
      epoch: request.epoch,
      id: request.id,
      kind: request.kind,
      count,
      index,
      current: index < 0 ? null : [pairs[index * 2], pairs[index * 2 + 1]],
      ranges,
      limited,
    };
  };
}
