import { useMemo, useState, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "tailwindcss/preflight.css";

import { parseCanonicalMarkdown } from "../src/client/canonical-parser";
import "../src/reading-themes/content.css";
import "../src/reading-themes/ink/theme.css";
import "../src/reading-themes/paper/theme.css";
import {
  commonmarkContent,
  auditReadingContent,
} from "../src/security/commonmark-content";
import { prepareReadingHtml } from "../src/security/reading-html";
import { createSafeContent } from "../src/security/safe-content";

let changeSource: (source: string) => void;
let changeTheme: (theme: string) => void;
function App() {
  const [source, setSource] = useState("<p>安全 <strong>HTML</strong></p>");
  const [theme, setTheme] = useState("paper");
  useLayoutEffect(() => {
    changeSource = setSource;
    changeTheme = setTheme;
  }, []);
  const rendered = useMemo(
    () => commonmarkContent(parseCanonicalMarkdown(source), source),
    [source]
  );
  return (
    <main data-reading-theme={theme}>
      <div id="reading-content">{rendered}</div>
    </main>
  );
}
flushSync(() => createRoot(document.getElementById("root")!).render(<App />));
Object.assign(window, {
  htmlHarness: {
    source(source: string) {
      flushSync(() => changeSource(source));
    },
    theme(theme: string) {
      flushSync(() => changeTheme(theme));
    },
    audit() {
      return auditReadingContent(document.getElementById("reading-content")!);
    },
    prepare(source: string) {
      let calls = 0;
      const sanitizer = createSafeContent(window);
      const start = performance.now();
      const result = prepareReadingHtml(source, (value) => {
        calls++;
        return sanitizer(value);
      });
      return {
        mode: result.mode,
        reason: result.mode === "source" ? result.reason : "",
        calls,
        elapsedMs: performance.now() - start,
      };
    },
  },
});
