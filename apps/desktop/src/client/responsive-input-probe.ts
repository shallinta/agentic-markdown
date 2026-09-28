import { isolateHistory } from "@codemirror/commands";
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Tree } from "@lezer/common";

import { MAX_DOCUMENT_BYTES, type DocumentSnapshot } from "../shared/documents";
import type { PerfRow } from "../shared/perf-lab";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { setMarkdownWorkerFactory } from "./async-markdown";
import { BomAwareParser } from "./bom-aware-parser";
import { waitForDenseParser } from "./dense-line-probe";
import { createDocumentController, type DocumentTransport } from "./documents";
import { longLineProbeText } from "./editor-view-probe";
import { rawText } from "./raw-buffer";

function check(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
}

function yieldInput(signal: AbortSignal) {
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
    }, 20);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

/** Compare node identities and ranges outside every input timing interval. */
function sameTree(actual: Tree, expected: Tree) {
  const a = actual.cursor(),
    b = expected.cursor();
  while (true) {
    if (a.name !== b.name || a.from !== b.from || a.to !== b.to) return false;
    const nextA = a.next(),
      nextB = b.next();
    if (nextA !== nextB) return false;
    if (!nextA) return true;
  }
}

/** Synthetic authorized transport, but real controller and EditorView update path. */
export async function runResponsiveInputProbe(
  container: HTMLElement,
  progress: (message: string) => void,
  signal: AbortSignal
): Promise<PerfRow[]> {
  const rows: PerfRow[] = [];
  for (const dense of [false, true])
    for (const units of [10_000, 50_000, 200_000])
      for (const mode of ["editing", "source"] as const)
        for (const asyncParser of [false, true]) {
          const raw = longLineProbeText(units, dense);
          const bytes = new TextEncoder().encode(raw).length;
          if (bytes > MAX_DOCUMENT_BYTES) throw new Error("Synthetic size");
          const snapshot: DocumentSnapshot = {
            documentId: crypto.randomUUID(),
            handle: crypto.randomUUID(),
            fileName: "responsive-synthetic.md",
            revision: 1,
            hash: "a".repeat(64),
            text: raw,
            byteLength: bytes,
            fidelity: analyzeTextFidelity(raw),
            writeCapability: { writable: true, reason: "writable" },
          };
          const transport: DocumentTransport = {
            selectDocument: (request) =>
              Promise.resolve({ ...request, ok: true, snapshot }),
            readDocument: (request) =>
              Promise.resolve({ ...request, ok: true, snapshot }),
            releaseDocument: () => Promise.resolve(),
            cancelDocument: () => Promise.resolve(),
            waitForDocumentSaves: (request) =>
              Promise.resolve({ ...request, settled: true }),
          };
          const controller = createDocumentController(transport);
          const host = container.ownerDocument.createElement("div");
          host.style.cssText = "height:240px;width:100%;overflow:hidden";
          container.append(host);
          let view: EditorView | undefined;
          let currentRow: PerfRow | undefined;
          let measuring = false;
          const makeRow = (sampleIndex: number): PerfRow => ({
            bytes,
            shape: "long-line",
            route: "cm-responsive-input",
            status: "failed",
            metrics: {
              corpus: Number(dense),
              lineUnits: units,
              mode: Number(mode === "source"),
              asyncParser: Number(asyncParser),
              sampleIndex,
              stateUpdateMs: null,
              controllerUpdateMs: null,
              viewUpdateMs: null,
              inputDispatchMs: null,
              parserReady: null,
              finalParserReady: null,
              readyWaitMs: null,
              rawMatches: null,
              selectionMatches: null,
              undoMatches: null,
              treeMatches: null,
            },
          });
          try {
            check(signal);
            const previousFactory = setMarkdownWorkerFactory(undefined);
            try {
              if (asyncParser && !previousFactory) {
                currentRow = makeRow(0);
                currentRow.status = "unsupported";
                rows.push(currentRow);
                continue;
              }
              setMarkdownWorkerFactory(
                asyncParser ? previousFactory : undefined
              );
              await controller.select();
              if (mode === "source" && !controller.toggleSourceMode())
                throw new Error("Synthetic mode");
            } finally {
              setMarkdownWorkerFactory(previousFactory);
            }
            check(signal);
            const editor = controller.getEditor(snapshot.documentId);
            if (!editor) throw new Error("Synthetic selection");
            view = new EditorView({
              state: editor.state,
              parent: host,
              dispatchTransactions(transactions, target) {
                for (const transaction of transactions) {
                  const stateStart = performance.now();
                  void transaction.state;
                  const stateMs = performance.now() - stateStart;
                  const controllerStart = performance.now();
                  const accepted = controller.updateEditor(
                    snapshot.documentId,
                    transaction
                  );
                  const controllerMs = performance.now() - controllerStart;
                  if (!accepted)
                    throw new Error("Synthetic transaction rejected");
                  const viewStart = performance.now();
                  target.update([transaction]);
                  const viewMs = performance.now() - viewStart;
                  if (measuring && currentRow) {
                    currentRow.metrics.stateUpdateMs =
                      (currentRow.metrics.stateUpdateMs ?? 0) + stateMs;
                    currentRow.metrics.controllerUpdateMs =
                      (currentRow.metrics.controllerUpdateMs ?? 0) +
                      controllerMs;
                    currentRow.metrics.viewUpdateMs =
                      (currentRow.metrics.viewUpdateMs ?? 0) + viewMs;
                  }
                }
              },
            });
            controller.setHistoryDispatch((transaction) =>
              view?.dispatch(transaction)
            );
            for (let sampleIndex = 0; sampleIndex < 3; sampleIndex++) {
              check(signal);
              progress(
                `真实控制器输入：${dense ? "密集" : "普通"} ${units} · ${mode === "source" ? "源码" : "编辑"} · ${asyncParser ? "后台解析" : "同步基线"} · ${sampleIndex + 1}/3`
              );
              currentRow = makeRow(sampleIndex);
              rows.push(currentRow);
              const position = view.state.doc.length;
              measuring = true;
              const inputStart = performance.now();
              try {
                view.dispatch({
                  changes: { from: position, insert: "!" },
                  selection: EditorSelection.cursor(position + 1),
                  annotations: isolateHistory.of("full"),
                  userEvent: "input.type",
                });
              } finally {
                currentRow.metrics.inputDispatchMs =
                  performance.now() - inputStart;
                measuring = false;
              }
              currentRow.metrics.parserReady = Number(
                syntaxTreeAvailable(view.state, view.state.doc.length)
              );
              currentRow.metrics.rawMatches = Number(
                view.state.field(rawText) ===
                  raw + "!".repeat(sampleIndex + 1) &&
                  controller.getEditor(snapshot.documentId)?.state ===
                    view.state
              );
              currentRow.metrics.selectionMatches = Number(
                view.state.selection.main.empty &&
                  view.state.selection.main.head === position + 1
              );
              currentRow.status =
                currentRow.metrics.rawMatches === 1 &&
                currentRow.metrics.selectionMatches === 1
                  ? "ok"
                  : "failed";
              await yieldInput(signal);
            }
            const waitStart = performance.now();
            const ready = await waitForDenseParser(
              () => syntaxTreeAvailable(view!.state, view!.state.doc.length),
              signal
            );
            currentRow!.metrics.readyWaitMs = performance.now() - waitStart;
            currentRow!.metrics.finalParserReady = Number(ready);
            if (ready) {
              const expected = new BomAwareParser().parse(
                view.state.doc.toString()
              );
              currentRow!.metrics.treeMatches = Number(
                sameTree(syntaxTree(view.state), expected)
              );
            }
            let undone = true;
            for (let count = 0; count < 3; count++)
              undone = controller.runHistory("undo") && undone;
            currentRow!.metrics.undoMatches = Number(
              undone &&
                view.state.field(rawText) === raw &&
                controller.getEditor(snapshot.documentId)?.state === view.state
            );
            if (
              currentRow!.metrics.undoMatches !== 1 ||
              (ready && currentRow!.metrics.treeMatches !== 1)
            )
              currentRow!.status = "failed";
            else if (!ready && currentRow!.status !== "failed")
              currentRow!.status = "unsupported";
          } catch {
            if (!currentRow) {
              currentRow = makeRow(0);
              rows.push(currentRow);
            }
            currentRow.status = signal.aborted ? "cancelled" : "failed";
          } finally {
            measuring = false;
            controller.setHistoryDispatch();
            view?.destroy();
            controller.dispose();
            host.remove();
          }
          if (signal.aborted) return rows;
        }
  return rows;
}
