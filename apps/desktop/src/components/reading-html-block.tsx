import { useLayoutEffect, useMemo, useRef } from "react";

import {
  prepareReadingHtml,
  readingHtmlSanitizer,
  type ReadingHtmlResult,
} from "../security/reading-html";

function SanitizedFragment({ fragment }: { fragment: DocumentFragment }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    element.replaceChildren(fragment.cloneNode(true));
    return () => element.replaceChildren();
  }, [fragment]);
  return <div ref={host} className="reading-html" />;
}

export function ReadingHtmlBlock({
  source,
  reason,
}: {
  source: string;
  reason?: string;
}) {
  const result = useMemo<ReadingHtmlResult>(() => {
    if (reason) return { mode: "source", reason };
    if (typeof window === "undefined")
      return { mode: "source", reason: "HTML 浏览器呈现环境不可用，保留原文" };
    return prepareReadingHtml(source, readingHtmlSanitizer(window));
  }, [source, reason]);
  // Separate ownership prevents old imperative cleanup deleting new fallback DOM.
  return result.mode === "sanitized" ? (
    <SanitizedFragment fragment={result.fragment} />
  ) : (
    <div className="bg-muted my-4 rounded p-3">
      <p role="status" className="text-muted-foreground text-xs">
        {result.reason}
      </p>
      <pre className="font-mono break-words whitespace-pre-wrap">{source}</pre>
    </div>
  );
}
