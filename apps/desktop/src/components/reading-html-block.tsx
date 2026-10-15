import { useLayoutEffect, useMemo, useRef } from "react";

import type { ReadingSearchRegistry } from "../client/reading-search-registry";
import {
  prepareReadingHtml,
  readingHtmlSanitizer,
  type ReadingHtmlResult,
} from "../security/reading-html";

function SanitizedFragment({
  fragment,
  search,
}: {
  fragment: DocumentFragment;
  search?: ReadingSearchRegistry;
}) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    element.replaceChildren(fragment.cloneNode(true));
    const release = search?.mount(element, { kind: "html", mode: "sanitized" });
    return () => {
      release?.();
      element.replaceChildren();
    };
  }, [fragment, search]);
  return <div ref={host} className="reading-html" />;
}

export function ReadingHtmlBlock({
  source,
  reason,
  search,
}: {
  source: string;
  reason?: string;
  search?: ReadingSearchRegistry;
}) {
  const result = useMemo<ReadingHtmlResult>(() => {
    if (reason) return { mode: "source", reason };
    if (typeof window === "undefined")
      return { mode: "source", reason: "HTML 浏览器呈现环境不可用，保留原文" };
    return prepareReadingHtml(source, readingHtmlSanitizer(window));
  }, [source, reason]);
  // Separate ownership prevents old imperative cleanup deleting new fallback DOM.
  return result.mode === "sanitized" ? (
    <SanitizedFragment fragment={result.fragment} search={search} />
  ) : (
    <div className="bg-muted my-4 rounded p-3">
      <p role="status" className="text-muted-foreground text-xs">
        {result.reason}
      </p>
      <pre
        ref={(element) =>
          element
            ? search?.mount(element, { kind: "html", mode: "source" })
            : undefined
        }
        className="font-mono break-words whitespace-pre-wrap"
      >
        {source}
      </pre>
    </div>
  );
}
