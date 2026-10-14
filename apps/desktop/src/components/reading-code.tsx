import { useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  createReadingCodeCopy,
  writeCodeClipboard,
  type CodeCopyStatus,
} from "../client/reading-code-copy";
import { retainReadingCode } from "../client/reading-code-ownership";

export function ReadingCode({
  value,
  language,
  current,
}: {
  value: string;
  language?: string | null;
  current?: () => boolean;
}) {
  const active = useRef(false);
  const [status, setStatus] = useState<CodeCopyStatus>("idle");
  const copy = useMemo(
    () =>
      createReadingCodeCopy(
        () => active.current && current?.() === true,
        writeCodeClipboard,
        setStatus
      ),
    [current]
  );
  useLayoutEffect(() => {
    active.current = true;
    setStatus("idle");
    return () => {
      active.current = false;
      copy.cancel();
    };
  }, [copy, value]);
  useLayoutEffect(() => {
    if (status !== "success") return;
    const timer = setTimeout(() => setStatus("idle"), 1500);
    return () => clearTimeout(timer);
  }, [status, copy]);
  return (
    <div className="reading-code" ref={retainReadingCode}>
      <span className="reading-code-language">{language || "代码"}</span>
      <button
        type="button"
        className="reading-code-copy"
        aria-label="复制代码正文"
        disabled={!current || status === "pending"}
        onClick={() => copy.copy(value)}
      >
        复制
      </button>
      <pre className="reading-code-body">
        <code>{value}</code>
      </pre>
      <p className="reading-code-status" role="status" aria-live="polite">
        {status === "pending"
          ? "正在复制…"
          : status === "success"
            ? "已复制"
            : status === "failed"
              ? "复制失败，请选择代码正文后复制"
              : ""}
      </p>
    </div>
  );
}
