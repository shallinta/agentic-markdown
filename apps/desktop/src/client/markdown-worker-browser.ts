import {
  setMarkdownWorkerFactory,
  setMarkdownWorkPolicy,
} from "./async-markdown";
import { setCalloutWorkerFactory } from "./callout-presentation";
import CalloutWorker from "./callout-summary.worker?worker&inline";
import { setImageSummaryWorkerFactory } from "./editing-images";
import FrontmatterWorker from "./frontmatter-diagnostic.worker?worker&inline";
import { setFrontmatterDiagnosticFactory } from "./frontmatter-presentation";
import ImageWorker from "./image-summary.worker?worker&inline";
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
if (!lab?.enabled) setCalloutWorkerFactory(() => new CalloutWorker());
if (!lab?.enabled) setImageSummaryWorkerFactory(() => new ImageWorker());
if (!lab?.enabled)
  setFrontmatterDiagnosticFactory(() => new FrontmatterWorker());
