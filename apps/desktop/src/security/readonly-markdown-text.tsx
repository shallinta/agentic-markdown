import { useLayoutEffect, useRef } from "react";

/** Current L1 surface deliberately displays untrusted Markdown as text only. */
export function ReadonlyMarkdownText({
  text,
  initialScrollTop = 0,
  onScrollTopChange,
}: {
  text: string;
  initialScrollTop?: number;
  onScrollTopChange?: (offset: number) => void;
}) {
  const element = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    if (element.current) element.current.scrollTop = initialScrollTop;
  }, [initialScrollTop]);
  return (
    <pre
      ref={element}
      onScroll={(event) => onScrollTopChange?.(event.currentTarget.scrollTop)}
      aria-label="Markdown 原文（只读）"
      className="bg-muted/40 min-h-0 flex-1 overflow-auto rounded-md border p-4 font-mono text-sm break-words whitespace-pre-wrap"
    >
      {text}
    </pre>
  );
}
