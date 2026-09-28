/** Explicit non-DOM diagnostic: bun run apps/desktop/src/client/parser-work-experiment.ts */
import { ensureSyntaxTree, syntaxTreeAvailable } from "@codemirror/language";

import {
  asyncMarkdownSession,
  setMarkdownWorkerFactory,
  setMarkdownWorkPolicy,
  type MarkdownWorkPolicy,
} from "./async-markdown";
import { createRawEditorState, rawText } from "./raw-buffer";

const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
setMarkdownWorkerFactory(
  () => new Worker(new URL("./markdown-parser.worker.ts", import.meta.url).href)
);
const rows: object[] = [];
for (const units of [10_000, 200_000])
  for (const dense of [0, 1])
    for (const sustained of [0, 1])
      for (let repeat = 0; repeat < 3; repeat++) {
        const policies: MarkdownWorkPolicy[] =
          repeat % 2 ? ["quiet-restart", "wait"] : ["wait", "quiet-restart"];
        for (const policy of policies) {
          setMarkdownWorkPolicy(policy);
          const token = dense ? "**bold** [link](local.md) &amp; \\* " : "x";
          const raw = token
            .repeat(Math.ceil(units / token.length))
            .slice(0, units);
          let state = createRawEditorState(raw);
          const session = state.field(asyncMarkdownSession);
          const start = performance.now();
          session.activate();
          let inputMaxMs = 0,
            expected = raw;
          for (let i = 0; i < (sustained ? 12 : 6); i++) {
            await delay(sustained ? 20 : 10);
            const inputStart = performance.now();
            state = state.update({
              changes: { from: state.doc.length, insert: "z" },
              selection: { anchor: state.doc.length + 1 },
            }).state;
            inputMaxMs = Math.max(inputMaxMs, performance.now() - inputStart);
            expected += "z";
          }
          const stopped = performance.now();
          while (
            !syntaxTreeAvailable(state, state.doc.length) &&
            performance.now() - stopped < 5000
          ) {
            ensureSyntaxTree(state, state.doc.length, 1);
            await delay(5);
          }
          rows.push({
            units,
            dense,
            sustained,
            repeat,
            candidate: policy === "quiet-restart" ? 1 : 0,
            inputMaxMs,
            inputSequenceMs: stopped - start,
            latestReadyMs: performance.now() - stopped,
            ready: syntaxTreeAvailable(state, state.doc.length) ? 1 : 0,
            rawCorrect: state.field(rawText) === expected ? 1 : 0,
            selectionCorrect:
              state.selection.main.head === expected.length ? 1 : 0,
            ...session.snapshot(),
          });
          session.destroy();
        }
      }
setMarkdownWorkPolicy("wait");
setMarkdownWorkerFactory(undefined);
console.info(JSON.stringify({ runtime: "Bun non-DOM worker", rows }, null, 2));
