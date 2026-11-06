export const CONTENT_SEARCH_FRAGMENT_LIMIT = 3;
export const CONTENT_SEARCH_CONTEXT_LIMIT = 32;

export interface ContentSearchFragment {
  from: number;
  to: number;
  before: string;
  after: string;
}

export interface ContentSearchFragments {
  matches: ContentSearchFragment[];
  more: boolean;
}

const unpaired =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

export const isWellFormedContentSearchText = (text: string) => !unpaired.test(text);

function splitsPair(raw: string, offset: number) {
  const high = raw.charCodeAt(offset - 1);
  const low = raw.charCodeAt(offset);
  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
}

/** UTF-16 offsets in the original text, including any BOM and CRLF. */
export function contentSearchFragments(raw: string, query: string): ContentSearchFragments {
  const matches: ContentSearchFragment[] = [];
  if (!query || !isWellFormedContentSearchText(query)) return { matches, more: false };
  let cursor = 0;
  while (matches.length < CONTENT_SEARCH_FRAGMENT_LIMIT) {
    const from = raw.indexOf(query, cursor);
    if (from < 0) return { matches, more: false };
    const to = from + query.length;
    const start = Math.max(0, from - CONTENT_SEARCH_CONTEXT_LIMIT);
    const end = Math.min(raw.length, to + CONTENT_SEARCH_CONTEXT_LIMIT);
    matches.push({
      from,
      to,
      before: raw.slice(start + Number(splitsPair(raw, start)), from),
      after: raw.slice(to, end - Number(splitsPair(raw, end))),
    });
    cursor = to;
  }
  return { matches, more: raw.includes(query, cursor) };
}
