import { isolateHistory } from "@codemirror/commands";
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Tree } from "@lezer/common";

import type { DocumentSnapshot } from "../shared/documents";
import type { PerfRow } from "../shared/perf-lab";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import {
  asyncMarkdownSession,
  setMarkdownWorkPolicy,
  type MarkdownParseSession,
  type MarkdownWorkPolicy,
} from "./async-markdown";
import { BomAwareParser } from "./bom-aware-parser";
import { waitForDenseParser } from "./dense-line-probe";
import { createDocumentController, type DocumentTransport } from "./documents";
import { longLineProbeText } from "./editor-view-probe";
import { rawText } from "./raw-buffer";

function check(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
}
function pause(signal: AbortSignal) {
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
function sameTree(actual: Tree, expected: Tree) {
  const a = actual.cursor(),
    b = expected.cursor();
  while (true) {
    if (a.name !== b.name || a.from !== b.from || a.to !== b.to) return false;
    const next = a.next();
    if (next !== b.next()) return false;
    if (!next) return true;
  }
}

export function inputSummary(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    inputCount: values.length,
    inputMinMs: sorted[0],
    inputMedianMs:
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    inputMaxMs: sorted[sorted.length - 1],
    inputSumMs: values.reduce((a, b) => a + b, 0),
  };
}
export function workSnapshotMatches(
  value: Record<string, number>,
  destroyed: boolean
) {
  const costs = [
    "treeBufferBytes",
    "treeEstimatedObjectBytes",
    "treeAccountedBytes",
    "pinnedExcessBytes",
    "textReferenceCount",
    "retainedWireBytes",
    "retiredTreeBytes",
  ];
  if (!costs.every((key) => Number.isFinite(value[key]) && value[key] >= 0))
    return false;
  if (
    value.treeAccountedBytes !==
      value.treeBufferBytes + value.treeEstimatedObjectBytes ||
    value.pinnedExcessBytes !==
      Math.max(0, value.treeAccountedBytes - value.totalBudgetBytes) ||
    !(value.activeTreeBudgetBytes > 0) ||
    !(value.totalBudgetBytes > 0) ||
    ![0, 1].includes(value.runningCount) ||
    ![0, 1].includes(value.pendingCount) ||
    value.textReferenceCount > 2
  )
    return false;
  return (
    !destroyed ||
    [...costs, "runningCount", "pendingCount"].every((key) => value[key] === 0)
  );
}
function observe(
  row: PerfRow,
  phase: "Ready" | "Destroyed",
  session: MarkdownParseSession
) {
  // Deliberately outside every input interval. Owned cost is not process memory.
  const snapshot = session.snapshot();
  for (const [key, value] of Object.entries(snapshot))
    row.metrics[`work${phase}${key[0].toUpperCase()}${key.slice(1)}`] = value;
  return workSnapshotMatches(snapshot, phase === "Destroyed");
}

/** Separate from historical input probe: 48 groups, raw per-input scalar timings. */
export async function runParserWorkProbe(
  container: HTMLElement,
  progress: (message: string) => void,
  signal: AbortSignal
): Promise<PerfRow[]> {
  const rows: PerfRow[] = [];
  for (const dense of [false, true])
    for (const mode of ["editing", "source"] as const)
      for (const count of [3, 10])
        for (let trial = 0; trial < 3; trial++) {
          const policies: MarkdownWorkPolicy[] =
            trial % 2 ? ["quiet-restart", "wait"] : ["wait", "quiet-restart"];
          for (let orderIndex = 0; orderIndex < policies.length; orderIndex++) {
            const policy = policies[orderIndex];
            const units = dense ? 200_000 : 10_000;
            const raw = longLineProbeText(units, dense);
            const row: PerfRow = {
              bytes: new TextEncoder().encode(raw).length,
              shape: "long-line",
              route: "cm-parser-work",
              status: "failed",
              metrics: {
                corpus: Number(dense),
                lineUnits: units,
                mode: Number(mode === "source"),
                workPolicy: Number(policy === "quiet-restart"),
                inputPattern: Number(count === 10),
                trial,
                orderIndex,
                inputCount: 0,
                inputMinMs: null,
                inputMedianMs: null,
                inputMaxMs: null,
                inputSumMs: null,
                lastInputToReadyMs: null,
                finalParserReady: null,
                rawMatches: null,
                selectionMatches: null,
                treeMatches: null,
                undoMatches: null,
                saveMatches: null,
                parserReadyBeforeSave: null,
                workerHeapBytes: null,
              },
            };
            for (let i = 0; i < 10; i++) row.metrics[`input${i}Ms`] = null;
            rows.push(row);
            const snapshot: DocumentSnapshot = {
              documentId: crypto.randomUUID(),
              handle: crypto.randomUUID(),
              fileName: "parser-work-synthetic.md",
              revision: 1,
              hash: "a".repeat(64),
              text: raw,
              byteLength: row.bytes,
              fidelity: analyzeTextFidelity(raw),
              writeCapability: { writable: true, reason: "writable" },
            };
            let savedText: string | undefined;
            const transport: DocumentTransport = {
              selectDocument: (request) =>
                Promise.resolve({ ...request, ok: true, snapshot }),
              readDocument: (request) =>
                Promise.resolve({ ...request, ok: true, snapshot }),
              releaseDocument: () => Promise.resolve(),
              cancelDocument: () => Promise.resolve(),
              waitForDocumentSaves: (request) =>
                Promise.resolve({ ...request, settled: true }),
              saveDocument: (request) => {
                const patch = request.content;
                savedText =
                  patch.kind === "resync"
                    ? patch.text
                    : raw.slice(0, patch.from) +
                      patch.insert +
                      raw.slice(patch.to);
                const { text: ignored, ...metadata } = snapshot;
                void ignored;
                return Promise.resolve({
                  protocolVersion: 1,
                  requestId: request.requestId,
                  ok: true,
                  savedBufferRevision: request.bufferRevision,
                  snapshot: {
                    ...metadata,
                    revision: 2,
                    hash: patch.targetHash,
                    mirror: {
                      token: crypto.randomUUID(),
                      revision: request.bufferRevision,
                      hash: patch.targetHash,
                    },
                    byteLength: new TextEncoder().encode(savedText).length,
                    fidelity: analyzeTextFidelity(savedText),
                  },
                });
              },
            };
            const controller = createDocumentController(transport);
            const host = container.ownerDocument.createElement("div");
            host.style.cssText = "height:240px;width:100%;overflow:hidden";
            container.append(host);
            let view: EditorView | undefined;
            let session: MarkdownParseSession | undefined;
            try {
              check(signal);
              progress(
                `任务与缓存：${dense ? "密集200k" : "普通10k"} · ${mode === "editing" ? "编辑" : "源码"} · ${policy === "wait" ? "等待旧任务" : "最新优先"} · ${count}次输入 · 第${trial + 1}轮`
              );
              const previous = setMarkdownWorkPolicy(policy);
              try {
                await controller.select();
                if (mode === "source" && !controller.toggleSourceMode())
                  throw new Error("Synthetic mode");
              } finally {
                setMarkdownWorkPolicy(previous);
              }
              const editor = controller.getEditor(snapshot.documentId);
              if (!editor) throw new Error("Synthetic selection");
              session = editor.state.field(asyncMarkdownSession);
              if (!session.factory) {
                row.status = "unsupported";
                continue;
              }
              view = new EditorView({
                state: editor.state,
                parent: host,
                dispatchTransactions(transactions, target) {
                  for (const transaction of transactions) {
                    if (
                      !controller.updateEditor(snapshot.documentId, transaction)
                    )
                      throw new Error("Synthetic transaction rejected");
                    target.update([transaction]);
                  }
                },
              });
              controller.setHistoryDispatch((transaction) =>
                view?.dispatch(transaction)
              );
              const times: number[] = [];
              let rawMatches = true,
                selectionMatches = true,
                lastInputStart = 0;
              for (let i = 0; i < count; i++) {
                check(signal);
                const position = view.state.doc.length;
                lastInputStart = performance.now();
                view.dispatch({
                  changes: { from: position, insert: "!" },
                  selection: EditorSelection.cursor(position + 1),
                  annotations: isolateHistory.of("full"),
                  userEvent: "input.type",
                });
                const elapsed = performance.now() - lastInputStart;
                times.push(elapsed);
                row.metrics[`input${i}Ms`] = elapsed;
                rawMatches &&=
                  view.state.field(rawText) === raw + "!".repeat(i + 1) &&
                  controller.getEditor(snapshot.documentId)?.state ===
                    view.state;
                selectionMatches &&=
                  view.state.selection.main.empty &&
                  view.state.selection.main.head === position + 1;
                row.metrics.inputCount = times.length;
                if (i < count - 1) await pause(signal);
              }
              Object.assign(row.metrics, inputSummary(times));
              row.metrics.rawMatches = Number(rawMatches);
              row.metrics.selectionMatches = Number(selectionMatches);
              row.metrics.parserReadyBeforeSave = Number(
                syntaxTreeAvailable(view.state, view.state.doc.length)
              );
              await controller.save();
              row.metrics.saveMatches = Number(
                savedText === raw + "!".repeat(count) &&
                  !controller.isDirty(snapshot.documentId)
              );
              const ready = await waitForDenseParser(
                () => syntaxTreeAvailable(view!.state, view!.state.doc.length),
                signal
              );
              row.metrics.lastInputToReadyMs =
                performance.now() - lastInputStart;
              row.metrics.finalParserReady = Number(ready);
              if (ready)
                row.metrics.treeMatches = Number(
                  sameTree(
                    syntaxTree(view.state),
                    new BomAwareParser().parse(view.state.doc.toString())
                  )
                );
              const costMatches = observe(row, "Ready", session);
              let undone = true;
              for (let i = 0; i < count; i++)
                undone = controller.runHistory("undo") && undone;
              row.metrics.undoMatches = Number(
                undone &&
                  view.state.field(rawText) === raw &&
                  controller.getEditor(snapshot.documentId)?.state ===
                    view.state
              );
              row.status =
                !costMatches ||
                !rawMatches ||
                !selectionMatches ||
                row.metrics.saveMatches !== 1 ||
                row.metrics.undoMatches !== 1 ||
                (ready && row.metrics.treeMatches !== 1)
                  ? "failed"
                  : ready
                    ? "ok"
                    : "unsupported";
            } catch {
              row.status = signal.aborted ? "cancelled" : "failed";
            } finally {
              controller.setHistoryDispatch();
              view?.destroy();
              controller.dispose();
              host.remove();
              if (session) {
                if (!observe(row, "Destroyed", session)) row.status = "failed";
              }
            }
            if (signal.aborted) return rows;
          }
        }
  return rows;
}
