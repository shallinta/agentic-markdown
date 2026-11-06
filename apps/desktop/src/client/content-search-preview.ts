import {
  validContentSearchProgress,
  type ContentSearchRequest,
} from "../shared/content-search";
import { relativeContentSearchPath } from "../shared/content-search-filters";
import type { ContentSearchFragments } from "../shared/content-search-fragments";

interface PreviewGroup {
  entry: string;
  fragments: ContentSearchFragments;
}

export interface ContentSearchPreviewSnapshot {
  processed: number;
  groups: readonly PreviewGroup[];
}

type PreviewUpdate =
  | { kind: "ignored" }
  | { kind: "discard" }
  | { kind: "update"; snapshot: ContentSearchPreviewSnapshot };

const copyFragments = ({ more, matches }: ContentSearchFragments): ContentSearchFragments =>
  ({ more, matches: matches.map((match) => ({ ...match })) });

export function createContentSearchPreview(
  request: ContentSearchRequest,
  files: ReadonlyMap<string, { displayPath: string }>,
  openedPaths: readonly (string | undefined)[]
) {
  const expected = request.op === "query-workspace"
    ? { ...request, roots: [...request.roots], standaloneHandles: [...request.standaloneHandles] }
    : { ...request };
  const scope = new Map(Array.from(files, ([entry, file]) => [entry, file.displayPath]));
  const open = new Set(openedPaths);
  const redactAll = [...open].some((path) => !path || !relativeContentSearchPath("/", path));
  const processed = new Set<string>();
  const groups: PreviewGroup[] = [];
  let discarded = false;

  function accept(value: unknown): PreviewUpdate {
    if (discarded || !value || typeof value !== "object" ||
        !("requestId" in value) || value.requestId !== expected.requestId)
      return { kind: "ignored" };

    if (!validContentSearchProgress(value, expected) ||
        value.sequence !== processed.size + 1 ||
        processed.has(value.entry) || !scope.has(value.entry)) {
      discarded = true;
      groups.length = 0;
      return { kind: "discard" };
    }

    processed.add(value.entry);
    const path = scope.get(value.entry);
    if (value.kind === "fragments" && value.fragments.matches.length &&
        path && !redactAll && !open.has(path)) {
      groups.push({ entry: value.entry, fragments: copyFragments(value.fragments) });
    }
    return {
      kind: "update",
      snapshot: {
        processed: processed.size,
        groups: groups.map(({ entry, fragments }) => ({ entry, fragments: copyFragments(fragments) })),
      },
    };
  }
  return { accept };
}
