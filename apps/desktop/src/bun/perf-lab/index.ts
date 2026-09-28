import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  PERF_SIZES,
  perfRecord,
  perfUuid,
  syntheticText,
  syntheticDigest,
  measureApplicationJson,
  type PerfMetrics,
  type PerfResponse,
  type PerfRow,
  type PerfShape,
} from "../../shared/perf-lab";

import { createOpenDocumentLab } from "./open-documents";
import type { WorkerOperation } from "./worker-state";

const metrics = (): PerfMetrics => {
  const memory = process.memoryUsage(),
    cpu = process.cpuUsage();
  return {
    rss: memory.rss,
    heapUsed: memory.heapUsed,
    cpuUserUs: cpu.user,
    cpuSystemUs: cpu.system,
  };
};
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => key in value);
export function resolvePerfWorkerEntry(directory: string) {
  return basename(directory) === "perf-lab"
    ? join(directory, "../../../dist-native/perf-worker.js")
    : join(directory, "../native/perf-worker.js");
}
const metricKeys = new Set([
  "pickerMs",
  "authorizeMs",
  "diskReadMs",
  "decodeAnalyzeMs",
  "backendDocumentMs",
  "pickerNative",
  "openRoundTripMs",
  "controllerOpenMs",
  "firstDispatchMs",
  "openToInteractionMs",
  "reloadMatches",
  "redoMatches",
  "saveRetainsHistory",
  "workPolicy",
  "inputPattern",
  "trial",
  "inputCount",
  "inputMinMs",
  "inputMedianMs",
  "inputMaxMs",
  "inputSumMs",
  "lastInputToReadyMs",
  "saveMatches",
  "parserReadyBeforeSave",
  "continuousMatches",
  "continuousParserReady",
  "workerHeapBytes",
  ...Array.from({ length: 10 }, (_, i) => `input${i}Ms`),
  ...["Ready", "Destroyed"].flatMap((phase) =>
    [
      "Started",
      "Completed",
      "Terminated",
      "StaleDiscarded",
      "RunningCount",
      "PendingCount",
      "Restarts",
      "TreeBufferBytes",
      "TreeEstimatedObjectBytes",
      "TreeAccountedBytes",
      "ActiveTreeBudgetBytes",
      "TotalBudgetBytes",
      "PinnedExcessBytes",
      "TextReferenceCount",
      "RetainedWireBytes",
      "RetiredTreeBytes",
    ].map((key) => `work${phase}${key}`)
  ),
  "asyncParser",
  "controllerUpdateMs",
  "inputDispatchMs",
  "treeMatches",
  "finalParserReady",
  "instrumented",
  "orderIndex",
  "sampleIndex",
  "parserReady",
  "readyWaitMs",
  "stateUpdateMs",
  "viewUpdateMs",
  "parserStateMs",
  "parserViewMs",
  "parserStateAdvances",
  "parserViewAdvances",
  "roundTripMs",
  "setupMs",
  "workerMs",
  "hostMs",
  "cpuUserUs",
  "cpuSystemUs",
  "rssBefore",
  "rssAfter",
  "heapBefore",
  "heapAfter",
  "payloadUtf8Bytes",
  "jsonUtf8Bytes",
  "applicationJsonUtf8Bytes",
  "applicationJsonStringifyMs",
  "applicationJsonEncodeMs",
  "requestJsonUtf8Bytes",
  "requestJsonStringifyMs",
  "requestJsonEncodeMs",
  "oneWayMs",
  "clientValidationMs",
  "encodeMs",
  "digestMs",
  "generationMs",
  "stateCreateMs",
  "transactionMs",
  "undoMs",
  "viewCreateMs",
  "frameOpportunityMs",
  "nativeCopyCount",
  "rendererHeapBytes",
  "transferred",
  "ownedTextUnitsAfterStop",
  "workerExitObserved",
  "cancelMs",
  "completedBeforeCancel",
  "mode",
  "lineUnits",
  "corpus",
  "wrappingEnabled",
  "protectedColorMarks",
  "dispatchMs",
  "twoFramesMs",
  "coordsAvailable",
  "roundTripDelta",
  "rawMatches",
  "undoMatches",
  "observationMs",
  "controlPending",
  "cancelledPending",
  "controlAdvanceCount",
  "controlAdvanceMs",
  "cancelledAdvanceCount",
  "afterDestroyAdvanceCount",
  "afterDestroyAdvanceMs",
  "selectionMatches",
  "historyMatches",
]);
export function validPerfRows(value: unknown): value is PerfRow[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (row) =>
        perfRecord(row) &&
        exact(row, ["bytes", "shape", "route", "status", "metrics"]) &&
        typeof row.bytes === "number" &&
        ([
          "cm-long-line-view",
          "cm-parser-lifecycle",
          "cm-dense-diagnostic",
          "cm-responsive-input",
          "cm-parser-work",
          "cm-disk-open",
        ].includes(String(row.route))
          ? Number.isInteger(row.bytes) &&
            row.bytes > 0 &&
            row.bytes <= 1_048_576
          : [0, ...PERF_SIZES].includes(row.bytes)) &&
        ["lines", "long-line"].includes(String(row.shape)) &&
        typeof row.shape === "string" &&
        typeof row.route === "string" &&
        [
          "rpc-binary-probe",
          "full-text",
          "full-text-downlink",
          "chunks",
          "patch",
          "worker-clone",
          "worker-transfer",
          "cm-state",
          "cm-viewport",
          "cm-long-line-view",
          "cm-parser-lifecycle",
          "cm-dense-diagnostic",
          "cm-responsive-input",
          "cm-parser-work",
          "cm-disk-open",
          "cancel",
        ].includes(row.route) &&
        typeof row.status === "string" &&
        ["ok", "failed", "unsupported", "cancelled"].includes(row.status) &&
        perfRecord(row.metrics) &&
        Object.entries(row.metrics).every(
          ([key, val]) =>
            metricKeys.has(key) &&
            (val === null ||
              (typeof val === "number" &&
                Number.isFinite(val) &&
                Math.abs(val) < 1e15))
        )
    )
  );
}
export function createPerfLabService({
  enabled,
  timeoutMs = 120_000,
  workerPath = resolvePerfWorkerEntry(import.meta.dir),
  openEnabled = false,
}: {
  enabled: boolean;
  timeoutMs?: number;
  workerPath?: string;
  openEnabled?: boolean;
}) {
  const openLab = createOpenDocumentLab(enabled && openEnabled);
  interface Session {
    id: string;
    bytes: number;
    shape: PerfShape;
    next: number;
    busy: boolean;
    worker: Worker;
    timer: ReturnType<typeof setTimeout>;
    pending?: (response: PerfResponse) => void;
    exited: Promise<boolean>;
    resolveExit: () => void;
    stopping?: Promise<PerfResponse>;
  }
  let session: Session | undefined;
  async function stop(
    current: Session,
    error: PerfResponse["error"] = "CANCELLED"
  ) {
    if (current.stopping) return current.stopping;
    clearTimeout(current.timer);
    current.pending?.({ ok: false, error, runId: current.id });
    current.pending = undefined;
    current.stopping = (async () => {
      current.worker.terminate();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const observed = await Promise.race([
        current.exited,
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 1000);
        }),
      ]);
      clearTimeout(timer);
      if (observed && session === current) session = undefined;
      return {
        ok: true,
        runId: current.id,
        ownedTextUnits: observed ? 0 : undefined,
        workerExitObserved: observed,
        metrics: metrics(),
      } satisfies PerfResponse;
    })();
    return current.stopping;
  }
  async function run(value: unknown): Promise<PerfResponse> {
    if (!enabled) return { ok: false, error: "DISABLED" };
    if (!perfRecord(value) || typeof value.op !== "string")
      return { ok: false, error: "INVALID" };
    if (value.op.startsWith("open-")) return openLab.run(value);
    if (value.op === "probe") {
      if (!exact(value, ["op", "array", "typed"]))
        return { ok: false, error: "INVALID" };
      const intact =
        value.array instanceof ArrayBuffer &&
        value.array.byteLength === 16 &&
        value.typed instanceof Uint8Array &&
        value.typed.length === 16 &&
        [...new Uint8Array(value.array)].every((byte, i) => byte === i) &&
        [...value.typed].every((byte, i) => byte === i);
      return { ok: true, binarySupported: intact, metrics: metrics() };
    }
    if (value.op === "report") {
      if (
        !exact(value, ["op", "rows"]) ||
        !validPerfRows(value.rows) ||
        session
      )
        return { ok: false, error: "INVALID" };
      try {
        const directory = await mkdtemp(
          join(tmpdir(), "agentic-markdown-perf-")
        );
        await writeFile(
          join(directory, "report.json"),
          JSON.stringify(
            {
              format: 1,
              date: new Date().toISOString(),
              bun: Bun.version,
              platform: process.platform,
              arch: process.arch,
              unit: "decimal bytes",
              cpuScope:
                "Bun process including workers, cumulative deltas; excludes WebView",
              memoryScope:
                "Bun process samples, not peaks or exact copy counts",
              measurementScope: {
                openContinuousFollowup:
                  "After original open metrics and reload, remount current editor state, dispatch three isolated-history end insertions with requested 20ms gaps, then save before waiting for syntax. input0Ms..input2Ms/inputSumMs measure synchronous dispatch, not natural keyboard/IME/paint; parserReadyBeforeSave records actual readiness (zero means pending observed). Final full-tree equality, three undo/redo steps and validated disk reload contribute continuousMatches. Original firstDispatchMs/readyWaitMs remain unchanged in scope. Open lab enables the same fixed Worker factory as production.",
                openDocument:
                  "24 groups: six fixed disposable disk fixtures x editing/source x two trials; fixture generation outside open timing; pickerNative=0 uses a fixed-path selector, not native picker dwell; backend diskReadMs includes identity/stat verification and read, decodeAnalyzeMs includes text fidelity and hashing; backend phases nested in backendDocumentMs nested in openRoundTripMs nested in controllerOpenMs, never add nested intervals; stateCreateMs captures first open only, not reload; source rows open default editing state then switch to source before View creation; openToInteractionMs includes that switch, View construction and end insertion with scrollIntoView; firstDispatchMs is synthetic transaction completion, not natural input or paint; readiness measured separately and full tree comparison outside readiness timing; save/undo/redo/reload exact raw checked independently; one-way and renderer heap remain unknown",
                parserWork:
                  "same-build wait versus quiet-restart; 48 groups: plain10k/dense200k x editing/source x policy x 3/10-input pattern x 3 independent trials; policy order alternates by trial, not randomized; each group retains input0Ms..input9Ms, unused slots null; min/median/max/sum summarize synchronous dispatch only, even-count median averages central two values; 20ms requested gaps between inputs, actual scheduling can vary; lastInputToReadyMs begins immediately before last dispatch and includes synthetic save capture and public readiness polling, not paint or pure parse latency; group raw/selection cover every input, final tree/undo/save checked separately; Ready work snapshot before undo, Destroyed after cleanup; owned task/cost counters are not CPU, RSS, exact allocations or GC; workerHeapBytes unknown",
                responsiveInput:
                  "same-build synchronous versus background-parser configurations; synthetic continuous edits through real document controller and EditorView with disposable in-memory transport; no user files; state/controller/view intervals are disjoint, inputDispatchMs encloses them; syntax readiness and equivalent final tree checked separately; not natural keyboard/IME/paint latency; no numeric performance gate",
                denseDiagnostic:
                  "isolated EditorView only; sampleIndex 0=new-view first edit, 1..3=public syntaxTreeAvailable before each edit; parserReady is observed, timeout=unsupported; stateUpdateMs explicitly forces lazy transaction.state before view.update (different evaluation placement from historical unsplit dispatch); parserStateMs/parserViewMs are nested subsets not additive; plain versus wrapped-parser overhead control uses alternating orderIndex with same forced evaluation; undo/readiness wait excluded from edit timing; no natural keyboard/IME/paint latency or exact residual attribution",
                fullText: "renderer -> Bun -> Worker upload; metadata ACK only",
                downlink:
                  "small renderer request -> Bun corpus generation and application JSON probe -> full text response; RTT is not one-way; session Worker is idle on download",
                chunks:
                  "workerMs and hostMs are sums of chunk requests; UTF-16 chunk positions, UTF-8 byte totals",
                binary:
                  "Bun -> Worker only; clone/transfer not evidence of renderer RPC binary support",
                patch:
                  "roundTrip excludes baseline; CPU and memory include baseline setup",
                generation:
                  "renderer corpus generation except binary and downlink rows: Bun corpus generation; binary rows additionally encode UTF-8",
                jsonUtf8Bytes:
                  "legacy wire size remains unmeasured; applicationJson fields probe {text} on download and application request objects on upload, excluding SDK envelope, transport framing and probe fields; chunk values are summed; patch excludes setup",
                jsonTiming:
                  "probes allocate JSON and UTF-8 buffers; WebView request probes and Bun download {text} probes are inside RTT; Bun CPU/memory samples include only Bun probe work, exclude WebView request probes/client validation and occur before SDK response serialization; client validation recorded separately",
                oneWayMs:
                  "null: clocks and bridge serialization are not instrumented for strict one-way measurement",
                cm: "1 MB visible viewport, 10/50 MB state only; double RAF is opportunity, not paint completion",
                editorViewProbe:
                  "isolated real EditorView with production editor state and synthetic dispatch/undo; twoFramesMs is scheduling opportunity, not keyboard/IME or paint latency; source mode=1, editing=0; corpus=0 plain x, corpus=1 dense Markdown; coords round trip is approximate",
                parserLifecycle:
                  "isolated real CM parse worker with delegating parser observation, live positive control versus destroyed view; unsupported if no pending work/progress observed; finite observation does not prove all future callbacks or process memory reclamation",
                cleanup:
                  "ownedTextUnitsAfterStop zero only after Worker close; not VM/RSS reclamation",
              },
              rows: value.rows,
            },
            null,
            2
          ),
          { mode: 0o600, flag: "wx" }
        );
        return { ok: true, reportName: `${basename(directory)}/report.json` };
      } catch {
        return { ok: false, error: "FAILED" };
      }
    }
    if (value.op === "start") {
      if (
        !exact(value, ["op", "runId", "bytes", "shape"]) ||
        !perfUuid(value.runId) ||
        !PERF_SIZES.some((size) => size === value.bytes) ||
        (value.shape !== "lines" && value.shape !== "long-line")
      )
        return { ok: false, error: "INVALID" };
      if (session) return { ok: false, error: "BUSY" };
      if (!existsSync(workerPath)) return { ok: false, error: "FAILED" };
      try {
        const worker = new Worker(workerPath);
        let resolveExit!: () => void;
        const exited = new Promise<true>((resolve) => {
          resolveExit = () => resolve(true);
        });
        worker.addEventListener("close", () => {
          resolveExit();
          if (session?.worker === worker && session.stopping)
            session = undefined;
        });
        const current: Session = {
          id: value.runId,
          bytes: value.bytes as number,
          shape: value.shape,
          next: 0,
          busy: false,
          worker,
          exited,
          resolveExit,
          timer: setTimeout(() => {
            void stop(current, "TIMEOUT");
          }, timeoutMs),
        };
        session = current;
        worker.onerror = () => {
          void stop(current, "FAILED");
        };
        return { ok: true, runId: current.id, metrics: metrics() };
      } catch {
        return { ok: false, error: "FAILED" };
      }
    }
    const current = session;
    if (!perfUuid(value.runId) || current?.id !== value.runId)
      return { ok: false, error: "INVALID" };
    if (value.op === "stop") {
      if (!exact(value, ["op", "runId"]))
        return { ok: false, error: "INVALID" };
      return stop(current);
    }
    if (current.busy || current.stopping) return { ok: false, error: "BUSY" };
    if (value.sequence !== current.next || current.next >= 1024)
      return { ok: false, error: "INVALID" };
    if (value.op === "download") {
      if (!exact(value, ["op", "runId", "sequence"]) || current.next !== 0)
        return { ok: false, error: "INVALID" };
      current.busy = true;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (session !== current || current.stopping)
        return { ok: false, error: "CANCELLED", runId: current.id };
      try {
        const start = performance.now();
        const text = syntheticText(current.bytes, current.shape);
        const generationMs = performance.now() - start;
        const digest = syntheticDigest(text);
        const probe = measureApplicationJson({ text });
        const sequence = current.next++;
        return {
          ok: true,
          runId: current.id,
          sequence,
          text,
          bytes: current.bytes,
          digest,
          generationMs,
          applicationJsonUtf8Bytes: probe.bytes,
          applicationJsonStringifyMs: probe.stringifyMs,
          applicationJsonEncodeMs: probe.encodeMs,
          metrics: metrics(),
        };
      } finally {
        current.busy = false;
      }
    }
    let operation: WorkerOperation, buffer: ArrayBuffer | undefined;
    let generationMs: number | undefined, encodeMs: number | undefined;
    if (
      value.op === "text" &&
      exact(value, ["op", "runId", "sequence", "text", "final"]) &&
      typeof value.text === "string" &&
      value.text.length > 0 &&
      value.text.length <= current.bytes &&
      typeof value.final === "boolean" &&
      ((current.next === 0 && value.final) ||
        Buffer.byteLength(value.text, "utf8") <= 250_000)
    ) {
      operation = { op: "text", text: value.text, final: value.final };
    } else if (
      value.op === "patch" &&
      exact(value, [
        "op",
        "runId",
        "sequence",
        "baseline",
        "version",
        "from",
        "to",
        "insert",
      ]) &&
      typeof value.baseline === "string" &&
      /^[a-f0-9]{8}$/.test(value.baseline) &&
      Number.isSafeInteger(value.version) &&
      Number.isSafeInteger(value.from) &&
      Number.isSafeInteger(value.to) &&
      typeof value.insert === "string" &&
      value.insert.length <= 1024
    ) {
      operation = {
        op: "patch",
        baseline: value.baseline,
        version: value.version as number,
        from: value.from as number,
        to: value.to as number,
        insert: value.insert,
      };
    } else if (
      value.op === "binary" &&
      exact(value, ["op", "runId", "sequence", "transfer"]) &&
      typeof value.transfer === "boolean"
    ) {
      const generatedAt = performance.now();
      const generated = syntheticText(current.bytes, current.shape);
      generationMs = performance.now() - generatedAt;
      const encodedAt = performance.now();
      buffer = new TextEncoder().encode(generated).buffer;
      encodeMs = performance.now() - encodedAt;
      operation = { op: "binary", buffer };
    } else return { ok: false, error: "INVALID" };
    current.busy = true;
    const start = performance.now();
    return new Promise<PerfResponse>((resolve) => {
      current.pending = resolve;
      current.worker.onmessage = (event: MessageEvent<PerfResponse>) => {
        if (session !== current || event.data.sequence !== current.next) return;
        current.next++;
        current.busy = false;
        current.pending = undefined;
        if (!event.data.ok) {
          resolve({ ok: false, error: "INVALID", runId: current.id });
          void stop(current);
          return;
        }
        resolve({
          ...event.data,
          runId: current.id,
          hostMs: performance.now() - start,
          generationMs,
          encodeMs,
          metrics: metrics(),
          detached: buffer ? buffer.byteLength === 0 : undefined,
        });
      };
      try {
        if (buffer && value.transfer)
          current.worker.postMessage(
            { sequence: current.next, limit: current.bytes, operation },
            [buffer]
          );
        else
          current.worker.postMessage({
            sequence: current.next,
            limit: current.bytes,
            operation,
          });
      } catch {
        void stop(current, "FAILED");
      }
    });
  }
  return {
    run,
    dispose: async () => {
      await openLab.dispose();
      return session ? stop(session) : null;
    },
  };
}
