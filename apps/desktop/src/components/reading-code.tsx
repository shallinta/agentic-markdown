import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  createReadingCodeCopy,
  writeCodeClipboard,
  type CodeCopyStatus,
} from "../client/reading-code-copy";
import { retainReadingCode } from "../client/reading-code-ownership";
import type { ReadingHeadingFolds } from "../client/reading-heading-folds";

function codeLines(value: string) {
  if (!value.length) return 0;
  let lines = 1;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "\r") {
      lines++;
      if (value[index + 1] === "\n") index++;
    } else if (value[index] === "\n") lines++;
  }
  return lines;
}

export function ReadingCode({
  value,
  language,
  current,
  fold,
}: {
  value: string;
  language?: string | null;
  current?: () => boolean;
  fold?: {
    id: number;
    controller: Pick<ReadingHeadingFolds, "registerCodeButton" | "registerCodeBody" | "toggleCode">;
  };
}) {
  const active = useRef(false);
  const [status, setStatus] = useState<CodeCopyStatus>("idle");
  const foldId = fold?.id;
  const foldController = fold?.controller;
  const lines = useMemo(() => foldId === undefined ? 0 : codeLines(value), [foldId, value]);
  const registerFoldButton = useCallback((element: HTMLButtonElement | null) => {
    if (element && foldId !== undefined) return foldController?.registerCodeButton(foldId, element, lines);
  }, [foldController, foldId, lines]);
  const registerFoldBody = useCallback((element: HTMLPreElement | null) => {
    if (element && foldId !== undefined) return foldController?.registerCodeBody(foldId, element);
  }, [foldController, foldId]);
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
      <span className="reading-code-language">{language || "代码"}{fold && ` · ${lines} 行`}</span>
      <button
        type="button"
        className="reading-code-copy"
        aria-label="复制代码正文"
        disabled={!current || status === "pending"}
        onClick={() => copy.copy(value)}
      >
        复制
      </button>
      {fold && (
        <button
          ref={registerFoldButton}
          type="button"
          className="reading-code-toggle"
          aria-expanded="true"
          aria-label="折叠代码"
          onClick={() => fold.controller.toggleCode(fold.id)}
        >
          ›
        </button>
      )}
      <pre className="reading-code-body" ref={fold ? registerFoldBody : undefined}>
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
