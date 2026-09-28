import { isolateHistory } from "@codemirror/commands";
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Tree } from "@lezer/common";

import { OPEN_PROBE_CASES, openProbeText } from "../shared/open-probe";
import type { PerfRequest, PerfResponse, PerfRow } from "../shared/perf-lab";

import { BomAwareParser } from "./bom-aware-parser";
import { waitForDenseParser } from "./dense-line-probe";
import {
  createDocumentController,
  isDocumentResponse,
  type DocumentTransport,
} from "./documents";
import { rawText } from "./raw-buffer";

function sameTree(a: Tree, b: Tree) {
  const left = a.cursor(),
    right = b.cursor();
  for (;;) {
    if (
      left.name !== right.name ||
      left.from !== right.from ||
      left.to !== right.to
    )
      return false;
    const more = left.next();
    if (more !== right.next()) return false;
    if (!more) return true;
  }
}
export async function runOpenDocumentProbe(
  container: HTMLElement,
  progress: (message: string) => void,
  signal: AbortSignal,
  rpc: (request: PerfRequest) => Promise<PerfResponse>
): Promise<PerfRow[]> {
  const rows: PerfRow[] = [];
  const start = await rpc({ op: "open-start" });
  if (!start.ok || !start.runId) throw new Error("Open experiment unavailable");
  const runId = start.runId;
  const check = () => {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  try {
    for (let sample = 0; sample < OPEN_PROBE_CASES; sample++)
      for (const mode of ["editing", "source"] as const)
        for (let trial = 0; trial < 2; trial++) {
          check();
          const raw = openProbeText(sample);
          const row: PerfRow = {
            bytes: new TextEncoder().encode(raw).length,
            shape: "lines",
            route: "cm-disk-open",
            status: "failed",
            metrics: {
              corpus: sample,
              mode: Number(mode === "source"),
              trial,
              pickerNative: 0,
              oneWayMs: null,
              rendererHeapBytes: null,
              frameOpportunityMs: null,
            },
          };
          rows.push(row);
          progress(
            `真实磁盘打开：样本 ${sample + 1}/6，${mode === "editing" ? "编辑" : "源码"}，第 ${trial + 1} 次`
          );
          if (!(await rpc({ op: "open-prepare", runId, sample })).ok)
            throw new Error("Fixture preparation failed");
          const inFlight = new Set<Promise<PerfResponse>>();
          let readSucceeded = false;
          let expectedRead = raw + "!";
          const call = async (
            action: Extract<PerfRequest, { op: "open-call" }>["action"],
            request: unknown
          ) => {
            const before = performance.now();
            const operation = rpc({
              op: "open-call",
              runId,
              sample,
              action,
              request,
            });
            inFlight.add(operation);
            let response: PerfResponse;
            try {
              response = await operation;
            } finally {
              inFlight.delete(operation);
            }
            if (!response.ok)
              throw new Error("Isolated document request failed");
            if (action === "select") {
              row.metrics.openRoundTripMs = performance.now() - before;
              Object.assign(row.metrics, response.openMetrics);
            }
            return response.document;
          };
          const transport: DocumentTransport = {
            selectDocument: (request) => call("select", request),
            readDocument: async (request) => {
              readSucceeded = false;
              const result = await call("read", request);
              readSucceeded =
                isDocumentResponse(result, request.requestId) &&
                result.ok &&
                result.snapshot?.text === expectedRead;
              return result;
            },
            saveDocument: (request) => call("save", request),
            releaseDocument: (request) => call("release", request),
            cancelDocument: (request) => call("cancel", request),
            checkDocumentWriteCapability: (request) =>
              call("checkWriteCapability", request),
            waitForDocumentSaves: (request) => call("waitForSaves", request),
          };
          const controller = createDocumentController(
            transport,
            () => Promise.resolve(false),
            5000,
            (key, ms) => {
              if (row.metrics[key] === undefined) row.metrics[key] = ms;
            }
          );
          const host = container.ownerDocument.createElement("div");
          host.style.cssText = "height:240px;overflow:hidden";
          container.appendChild(host);
          let view: EditorView | undefined;
          const cancel = () => {
            controller.dispose();
          };
          signal.addEventListener("abort", cancel, { once: true });
          try {
            const opened = performance.now();
            await controller.select();
            row.metrics.controllerOpenMs = performance.now() - opened;
            check();
            const snapshot = controller.getSnapshot().snapshot;
            if (!snapshot) throw new Error("No opened document");
            if (mode === "source") controller.toggleSourceMode();
            const editor = controller.getEditor(snapshot.documentId);
            if (!editor) throw new Error("No editor state");
            const beforeView = performance.now();
            view = new EditorView({
              state: editor.state,
              parent: host,
              dispatchTransactions(transactions, target) {
                for (const transaction of transactions) {
                  if (
                    !controller.updateEditor(snapshot.documentId, transaction)
                  )
                    throw new Error("Rejected input");
                  target.update([transaction]);
                }
              },
            });
            row.metrics.viewCreateMs = performance.now() - beforeView;
            controller.setHistoryDispatch((transaction) =>
              view?.dispatch(transaction)
            );
            const first = performance.now();
            const position = view.state.doc.length;
            view.dispatch({
              changes: { from: position, insert: "!" },
              selection: EditorSelection.cursor(position + 1),
              annotations: isolateHistory.of("full"),
              scrollIntoView: true,
              userEvent: "input.type",
            });
            row.metrics.firstDispatchMs = performance.now() - first;
            row.metrics.openToInteractionMs = performance.now() - opened;
            row.metrics.rawMatches = Number(
              view.state.field(rawText) === raw + "!"
            );
            row.metrics.selectionMatches = Number(
              view.state.selection.main.head === position + 1
            );
            row.metrics.wrappingEnabled = Number(view.lineWrapping);
            const syntaxStart = performance.now();
            const ready = await waitForDenseParser(
              () => syntaxTreeAvailable(view!.state, view!.state.doc.length),
              signal
            );
            row.metrics.readyWaitMs = performance.now() - syntaxStart;
            row.metrics.finalParserReady = Number(ready);
            if (ready)
              row.metrics.treeMatches = Number(
                sameTree(
                  syntaxTree(view.state),
                  new BomAwareParser().parse(view.state.doc.toString())
                )
              );
            check();
            await controller.save();
            row.metrics.saveMatches = Number(
              !controller.isDirty(snapshot.documentId)
            );
            row.metrics.undoMatches = Number(
              controller.runHistory("undo") && view.state.field(rawText) === raw
            );
            row.metrics.redoMatches = Number(
              controller.runHistory("redo") &&
                view.state.field(rawText) === raw + "!"
            );
            row.metrics.saveRetainsHistory = Number(
              row.metrics.undoMatches === 1 && row.metrics.redoMatches === 1
            );
            await controller.reload();
            row.metrics.reloadMatches = Number(
              readSucceeded &&
                !controller.getSnapshot().error &&
                !controller.getSnapshot().stale &&
                controller.getSnapshot().snapshot?.text === raw + "!" &&
                controller
                  .getEditor(snapshot.documentId)
                  ?.state.field(rawText) ===
                  raw + "!"
            );
            // Separate follow-up: preserve all original open/first-input metrics.
            // Reload replaces the editor state, so mount the current state again.
            view.destroy();
            view = new EditorView({
              state: controller.getEditor(snapshot.documentId)!.state,
              parent: host,
              dispatchTransactions(transactions, target) {
                for (const transaction of transactions) {
                  if (
                    !controller.updateEditor(snapshot.documentId, transaction)
                  )
                    throw new Error("Rejected continuous input");
                  target.update([transaction]);
                }
              },
            });
            let continuousMatches = true;
            let inputSum = 0;
            for (let input = 0; input < 3; input++) {
              check();
              const at = view.state.doc.length;
              const before = performance.now();
              view.dispatch({
                changes: { from: at, insert: String(input + 1) },
                selection: EditorSelection.cursor(at + 1),
                annotations: isolateHistory.of("full"),
                userEvent: "input.type",
                scrollIntoView: true,
              });
              const duration = performance.now() - before;
              row.metrics[`input${input}Ms`] = duration;
              inputSum += duration;
              continuousMatches &&=
                view.state.field(rawText) ===
                  raw + "!" + "123".slice(0, input + 1) &&
                view.state.selection.main.head === at + 1;
              if (input < 2)
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            row.metrics.inputCount = 3;
            row.metrics.inputSumMs = inputSum;
            row.metrics.parserReadyBeforeSave = Number(
              syntaxTreeAvailable(view.state, view.state.doc.length)
            );
            expectedRead = raw + "!123";
            await controller.save(); // Deliberately do not wait for syntax first.
            continuousMatches &&= !controller.isDirty(snapshot.documentId);
            const continuousReady = await waitForDenseParser(
              () => syntaxTreeAvailable(view!.state, view!.state.doc.length),
              signal
            );
            row.metrics.continuousParserReady = Number(continuousReady);
            if (continuousReady)
              continuousMatches &&= sameTree(
                syntaxTree(view.state),
                new BomAwareParser().parse(view.state.doc.toString())
              );
            for (let count = 0; count < 3; count++) {
              const applied = controller.runHistory("undo");
              continuousMatches = applied && continuousMatches;
            }
            continuousMatches &&= view.state.field(rawText) === raw + "!";
            for (let count = 0; count < 3; count++) {
              const applied = controller.runHistory("redo");
              continuousMatches = applied && continuousMatches;
            }
            continuousMatches &&= view.state.field(rawText) === expectedRead;
            await controller.reload();
            continuousMatches &&=
              readSucceeded &&
              !controller.getSnapshot().error &&
              !controller.getSnapshot().stale &&
              controller
                .getEditor(snapshot.documentId)
                ?.state.field(rawText) === expectedRead;
            row.metrics.continuousMatches = Number(continuousMatches);
            const keys = [
              "rawMatches",
              "selectionMatches",
              "wrappingEnabled",
              "saveMatches",
              "undoMatches",
              "redoMatches",
              "reloadMatches",
              "continuousMatches",
            ];
            row.status =
              keys.some((key) => row.metrics[key] !== 1) ||
              (ready && row.metrics.treeMatches !== 1)
                ? "failed"
                : ready && continuousReady
                  ? "ok"
                  : "unsupported";
          } catch {
            row.status = signal.aborted ? "cancelled" : "failed";
          } finally {
            signal.removeEventListener("abort", cancel);
            controller.setHistoryDispatch();
            view?.destroy();
            controller.dispose();
            host.remove();
            await Promise.allSettled([...inFlight]);
          }
          if (signal.aborted) return rows;
        }
    return rows;
  } finally {
    await rpc({ op: "open-stop", runId });
  }
}
