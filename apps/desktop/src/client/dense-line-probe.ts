import { undo } from "@codemirror/commands";
import { Language, syntaxTreeAvailable } from "@codemirror/language";
import { EditorSelection, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { PerfRow } from "../shared/perf-lab";

import { switchEditorMode } from "./editor-mode";
import { longLineProbeText, MeasuredParser } from "./editor-view-probe";
import { editingMarkdown } from "./live-formatting";
import { createRawEditorState, rawText } from "./raw-buffer";

const READY_TIMEOUT_MS = 3000;
function check(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
}
function pause(ms: number, signal: AbortSignal) {
  check(signal);
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

/** Public readiness, not an elapsed-time inference; timeout is an observation budget. */
export async function waitForDenseParser(
  ready: () => boolean,
  signal: AbortSignal,
  timeoutMs = READY_TIMEOUT_MS
) {
  const start = performance.now();
  while (true) {
    check(signal);
    if (ready()) return true;
    if (performance.now() - start >= timeoutMs) return false;
    await pause(20, signal);
  }
}

export async function runDenseLineProbe(
  container: HTMLElement,
  progress: (message: string) => void,
  signal: AbortSignal
): Promise<PerfRow[]> {
  const rows: PerfRow[] = [];
  let group = 0;
  for (const dense of [false, true])
    for (const units of [10_000, 50_000, 200_000])
      for (const mode of ["editing", "source"] as const) {
        // Alternate order across groups; retain order in each row, no random hidden seed.
        const order = group++ % 2 ? [true, false] : [false, true];
        for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
          const instrumented = order[orderIndex];
          const raw = longLineProbeText(units, dense);
          const parser = instrumented
            ? new MeasuredParser(editingMarkdown.parser)
            : undefined;
          const host = container.ownerDocument.createElement("div");
          host.style.cssText = "height:240px;width:100%;overflow:hidden";
          container.append(host);
          let view: EditorView | undefined;
          let currentRow: PerfRow | undefined;
          try {
            check(signal);
            let state = createRawEditorState(
              raw,
              parser
                ? Prec.high(
                    new Language(
                      editingMarkdown.data,
                      parser,
                      [],
                      "dense-measured"
                    )
                  )
                : []
            );
            if (mode === "source")
              state = state.update({ effects: switchEditorMode(mode) }).state;
            view = new EditorView({ state, parent: host });
            for (let sample = 0; sample < 4; sample++) {
              check(signal);
              progress(
                `密集长行诊断：${dense ? "密集" : "普通"} ${units} · ${mode === "source" ? "源码" : "编辑"} · ${instrumented ? "插桩" : "原始"} · ${sample === 0 ? "首次" : `就绪 ${sample}/3`}`
              );
              const row: PerfRow = {
                bytes: new TextEncoder().encode(raw).length,
                shape: "long-line",
                route: "cm-dense-diagnostic",
                status: "failed",
                metrics: {
                  corpus: Number(dense),
                  mode: Number(mode === "source"),
                  lineUnits: units,
                  instrumented: Number(instrumented),
                  orderIndex,
                  sampleIndex: sample,
                  parserReady: null,
                  readyWaitMs: null,
                  stateUpdateMs: null,
                  viewUpdateMs: null,
                  parserStateMs: null,
                  parserViewMs: null,
                  parserStateAdvances: null,
                  parserViewAdvances: null,
                  rawMatches: null,
                  undoMatches: null,
                  selectionMatches: null,
                },
              };
              rows.push(row);
              currentRow = row;
              const startWait = performance.now();
              const ready =
                sample === 0
                  ? syntaxTreeAvailable(view.state, view.state.doc.length)
                  : await waitForDenseParser(
                      () =>
                        syntaxTreeAvailable(
                          view!.state,
                          view!.state.doc.length
                        ),
                      signal
                    );
              row.metrics.readyWaitMs = performance.now() - startWait;
              row.metrics.parserReady = Number(ready);
              if (sample > 0 && !ready) {
                row.status = "unsupported";
                break;
              }
              const position = view.state.doc.length;
              const parserStart = parser?.advanceMs ?? 0,
                countStart = parser?.advances ?? 0;
              const stateStart = performance.now();
              const transaction = view.state.update({
                changes: { from: position, insert: "!" },
                selection: EditorSelection.cursor(position + 1),
                scrollIntoView: true,
                userEvent: "input.type",
              });
              // CM state is lazy. Force the same public transaction state before
              // starting the view interval; both plain and wrapped trials do this.
              void transaction.state;
              row.metrics.stateUpdateMs = performance.now() - stateStart;
              const parserAfterState = parser?.advanceMs ?? 0,
                countAfterState = parser?.advances ?? 0;
              const viewStart = performance.now();
              view.update([transaction]);
              row.metrics.viewUpdateMs = performance.now() - viewStart;
              if (parser) {
                row.metrics.parserStateMs = parserAfterState - parserStart;
                row.metrics.parserViewMs = parser.advanceMs - parserAfterState;
                row.metrics.parserStateAdvances = countAfterState - countStart;
                row.metrics.parserViewAdvances =
                  parser.advances - countAfterState;
              }
              row.metrics.rawMatches = Number(
                view.state.field(rawText) === raw + "!"
              );
              row.metrics.selectionMatches = Number(
                view.state.selection.main.empty &&
                  view.state.selection.main.head === position + 1
              );
              row.metrics.undoMatches = Number(
                undo(view) && view.state.field(rawText) === raw
              );
              row.status =
                row.metrics.rawMatches === 1 &&
                row.metrics.selectionMatches === 1 &&
                row.metrics.undoMatches === 1
                  ? "ok"
                  : "failed";
              await pause(0, signal);
            }
          } catch {
            if (currentRow)
              currentRow.status = signal.aborted ? "cancelled" : "failed";
            else
              rows.push({
                bytes: new TextEncoder().encode(raw).length,
                shape: "long-line",
                route: "cm-dense-diagnostic",
                status: signal.aborted ? "cancelled" : "failed",
                metrics: {
                  corpus: Number(dense),
                  mode: Number(mode === "source"),
                  lineUnits: units,
                  instrumented: Number(instrumented),
                  orderIndex,
                },
              });
          } finally {
            view?.destroy();
            host.remove();
          }
          if (signal.aborted) return rows;
        }
      }
  return rows;
}
