import { ensureSyntaxTree } from "@codemirror/language";

import { liveDecorations } from "../src/client/live-formatting";
import { longLineProtection } from "../src/client/long-line-protection";
import { createRawEditorState } from "../src/client/raw-buffer";

// Pure-state timings; no files, RPC, DOM, input latency or universal threshold claim.
for (const units of [9999, 10000, 50000, 200000]) {
  const raw = "short\n".repeat(1000) + "x".repeat(units) + "\nend";
  let start = performance.now();
  let state = createRawEditorState(raw, longLineProtection);
  const createMs = performance.now() - start;
  const times: number[] = [];
  for (let i = 0; i < 20; i++) {
    start = performance.now();
    state = state.update({ changes: { from: 2, insert: "a" } }).state;
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.info(
    JSON.stringify({
      units,
      bytes: new TextEncoder().encode(raw).length,
      protectedLines: state.field(longLineProtection).length,
      createMs,
      transactionMinMs: times[0],
      transactionMedianMs: times[10],
      transactionMaxMs: times[19],
      scope:
        "full editor state incl parser/raw fidelity; ordinary-line edits, no DOM",
    })
  );
}

// Same corpus and pre-parsed tree; bypassing the field only in this probe gives
// a baseline for our decoration work, not a previous-version/whole-app benchmark.
for (const repeats of [1600, 1700, 10000, 30000]) {
  const raw = "outside\n\n" + "**b** ".repeat(repeats) + "\n\n# ordinary";
  for (const protection of [false, true]) {
    const state = createRawEditorState(
      raw,
      protection ? [] : longLineProtection.init(() => [])
    );
    ensureSyntaxTree(state, state.doc.length, 10000);
    const times: number[] = [];
    let count = 0;
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      count = liveDecorations(state, [{ from: 9, to: 2009 }]).size;
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    console.info(
      JSON.stringify({
        lineUnits: repeats * 6,
        protection,
        count,
        medianMs: times[10],
        maxMs: times[19],
        scope:
          "preparsed pure-state self-decoration only, 2000 visible units; no DOM/parser cost",
      })
    );
  }
}
