/** Isolated Bun baseline, not native input/View timing or a product performance gate. */
import { ensureSyntaxTree, syntaxTreeAvailable } from "@codemirror/language";

import {
  asyncMarkdownSession,
  setMarkdownWorkerFactory,
} from "./async-markdown";
import { BomAwareParser } from "./bom-aware-parser";
import { encodeMarkdownTree } from "./markdown-tree-wire";
import { createRawEditorState } from "./raw-buffer";

const background = Bun.argv.includes("--worker");
if (background)
  setMarkdownWorkerFactory(
    () =>
      new Worker(new URL("./markdown-parser.worker.ts", import.meta.url).href)
  );

const patterns = {
  ordinary: "ordinary short line\n",
  dense: "**bold** *em* [link](local.md) &amp;\n\n",
  fence: "const value = 1;\n",
  mixed: "## heading\n\n> quote\n\n- item\n\n**bold**\n\n```js\nx\n```\n\n",
};
const rows = [];
for (const units of [32_000, 64_000, 128_000, 256_000, 512_000, 800_000]) {
  for (const [kind, pattern] of Object.entries(patterns)) {
    const header = "\uFEFF# sample\r\n\n" + (kind === "fence" ? "```js\n" : "");
    const raw =
      header +
      pattern.repeat(Math.floor((units - header.length) / pattern.length)) +
      (kind === "fence" ? "```\n" : "");
    for (let trial = 0; trial < 3; trial++) {
      const begin = performance.now();
      let state = createRawEditorState(raw);
      const stateMs = performance.now() - begin;
      const session = state.field(asyncMarkdownSession);
      session.activate();
      const edits = [];
      for (let index = 0; index < 3; index++) {
        const before = performance.now();
        state = state.update({
          changes: { from: state.doc.length, insert: "!" },
        }).state;
        edits.push(performance.now() - before);
      }
      const parseStart = performance.now();
      const tree = new BomAwareParser().parse(state.doc.toString());
      const fullParseMs = performance.now() - parseStart;
      const readyStart = performance.now();
      while (
        !syntaxTreeAvailable(state, state.doc.length) &&
        performance.now() - readyStart < 5000
      ) {
        ensureSyntaxTree(state, state.doc.length, 5);
        if (!syntaxTreeAvailable(state, state.doc.length))
          await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const readyWaitMs = performance.now() - readyStart;
      const actual = ensureSyntaxTree(state, state.doc.length, 0);
      const equivalent =
        !!actual &&
        JSON.stringify(encodeMarkdownTree(actual)) ===
          JSON.stringify(encodeMarkdownTree(tree));
      rows.push({
        units: state.doc.length,
        targetUnits: units,
        kind,
        trial,
        stateMs,
        edits,
        fullParseMs,
        complete: tree.length === state.doc.length,
        readyWaitMs,
        equivalent,
      });
      session.destroy();
    }
  }
}
console.info(
  JSON.stringify(
    {
      scope: `Bun ${background ? "production background routing with real Worker" : "synchronous baseline"}; UTF-16 sizes; three fresh states per cell, three end edits per state; no View/RPC/natural input; full parse timed independently after edits; readiness wait starts AFTER independent full parse, not total syntax latency; exact tree wire comparison outside measured intervals`,
      rows,
    },
    null,
    2
  )
);
