import {
  setMarkdownWorkerFactory,
  setMarkdownWorkPolicy,
} from "./async-markdown";
import MarkdownWorker from "./markdown-parser.worker?worker&inline";

// Keep historical diagnostics on their original synchronous configuration.
const lab = (
  globalThis as typeof globalThis & {
    __AGENTIC_MARKDOWN_PERF_LAB__?: {
      enabled: boolean;
      responsiveProbe?: boolean;
      parserWorkProbe?: boolean;
      openDocumentProbe?: boolean;
    };
  }
).__AGENTIC_MARKDOWN_PERF_LAB__;
// Bundled application code only. Markdown is passed as data, never as worker code.
if (
  !lab?.enabled ||
  lab.responsiveProbe ||
  lab.parserWorkProbe ||
  lab.openDocumentProbe
)
  setMarkdownWorkerFactory(() => new MarkdownWorker());
if (lab?.enabled && lab.responsiveProbe && !lab.parserWorkProbe)
  setMarkdownWorkPolicy("wait");
