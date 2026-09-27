import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";

import {
  syntheticDigest,
  syntheticText,
  measureApplicationJson,
  validDownload,
  type PerfRequest,
  type PerfResponse,
  type PerfRow,
  type PerfShape,
} from "../shared/perf-lab";

import { createRawEditorState, rawText } from "./raw-buffer";

export function createPerfRunner(
  rpc: (request: PerfRequest) => Promise<PerfResponse>,
  onRow: (row: PerfRow) => void,
  progress: (text: string) => void,
  container: HTMLElement
) {
  let cancelled = false,
    active: string | undefined;
  let cleanupPromise: Promise<PerfResponse> | undefined;
  const rows: PerfRow[] = [];
  const emit = (row: PerfRow) => {
    rows.push(row);
    onRow(row);
  };
  async function cancel() {
    cancelled = true;
    if (active) {
      cleanupPromise ??= rpc({ op: "stop", runId: active });
      await cleanupPromise;
    }
  }
  const check = (response: PerfResponse) => {
    if (!response.ok) throw new Error("Experiment failed");
    return response;
  };
  const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
  async function run(sizes: readonly number[]) {
    const probe = await rpc({
      op: "probe",
      array: Uint8Array.from({ length: 16 }, (_, i) => i).buffer,
      typed: Uint8Array.from({ length: 16 }, (_, i) => i),
    });
    emit({
      bytes: 0,
      shape: "lines",
      route: "rpc-binary-probe",
      status: !probe.ok
        ? "failed"
        : probe.binarySupported
          ? "ok"
          : "unsupported",
      metrics: { nativeCopyCount: null },
    });
    for (const bytes of sizes)
      for (const shape of ["lines", "long-line"] as PerfShape[]) {
        if (cancelled) break;
        let start = performance.now();
        const text = syntheticText(bytes, shape);
        const generationMs = performance.now() - start;
        start = performance.now();
        const digest = syntheticDigest(text),
          digestMs = performance.now() - start;
        for (const route of [
          "full-text",
          "full-text-downlink",
          "chunks",
          "patch",
          "worker-clone",
          "worker-transfer",
        ] as const) {
          if (cancelled) break;
          progress(`${bytes / 1_000_000} MB · ${shape} · ${route}`);
          await breathe();
          if (cancelled) break;
          const row: PerfRow = {
            bytes,
            shape,
            route,
            status: "failed",
            metrics: {
              generationMs,
              digestMs,
              nativeCopyCount: null,
              jsonUtf8Bytes: null,
              rendererHeapBytes: null,
              oneWayMs: null,
            },
          };
          const runId = crypto.randomUUID();
          active = runId;
          cleanupPromise = undefined;
          try {
            const before = check(
              await rpc({ op: "start", runId, bytes, shape })
            ).metrics;
            let workerTotal = 0,
              hostTotal = 0;
            let response: PerfResponse,
              sequence = 0;
            const sendMeasured = async (request: PerfRequest) => {
              const probe = measureApplicationJson(request);
              row.metrics.requestJsonUtf8Bytes =
                (row.metrics.requestJsonUtf8Bytes ?? 0) + probe.bytes;
              row.metrics.requestJsonStringifyMs =
                (row.metrics.requestJsonStringifyMs ?? 0) + probe.stringifyMs;
              row.metrics.requestJsonEncodeMs =
                (row.metrics.requestJsonEncodeMs ?? 0) + probe.encodeMs;
              return rpc(request);
            };
            start = performance.now();
            if (route === "full-text-downlink") {
              response = check(
                await sendMeasured({ op: "download", runId, sequence })
              );
              row.metrics.roundTripMs = performance.now() - start;
              const validationAt = performance.now();
              if (!validDownload(response, text, bytes, runId, sequence))
                throw new Error("Download integrity failure");
              row.metrics.clientValidationMs = performance.now() - validationAt;
              // Do not retain returned full text after validation.
              response = { ...response, text: undefined };
            } else if (route === "worker-clone" || route === "worker-transfer")
              response = check(
                await sendMeasured({
                  op: "binary",
                  runId,
                  sequence,
                  transfer: route === "worker-transfer",
                })
              );
            else if (route === "chunks") {
              response = { ok: false };
              // Corpus is BMP-only; at most three UTF-8 bytes per code unit.
              for (let offset = 0; offset < text.length; offset += 80_000) {
                if (cancelled) throw new Error("Cancelled");
                response = check(
                  await sendMeasured({
                    op: "text",
                    runId,
                    sequence: sequence++,
                    text: text.slice(offset, offset + 80_000),
                    final: offset + 80_000 >= text.length,
                  })
                );
                workerTotal += response.workerMs ?? 0;
                hostTotal += response.hostMs ?? 0;
              }
            } else
              response = check(
                await sendMeasured({
                  op: "text",
                  runId,
                  sequence: sequence++,
                  text,
                  final: true,
                })
              );
            if (route !== "full-text-downlink")
              row.metrics.roundTripMs = performance.now() - start;
            if (cancelled) throw new Error("Cancelled");
            if (response.bytes !== bytes || response.digest !== digest)
              throw new Error("Integrity failure");
            if (route === "patch") {
              row.metrics.setupMs = row.metrics.roundTripMs;
              const hashStart = performance.now();
              const expected = syntheticDigest(
                text.slice(0, 1) + "PATCH" + text.slice(1)
              );
              row.metrics.digestMs! += performance.now() - hashStart;
              row.metrics.requestJsonUtf8Bytes = 0;
              row.metrics.requestJsonStringifyMs = 0;
              row.metrics.requestJsonEncodeMs = 0;
              start = performance.now();
              response = check(
                await sendMeasured({
                  op: "patch",
                  runId,
                  sequence,
                  baseline: digest,
                  version: 1,
                  from: 1,
                  to: 1,
                  insert: "PATCH",
                })
              );
              row.metrics.roundTripMs = performance.now() - start;
              if (
                response.digest !== expected ||
                response.bytes !== bytes + 5 ||
                response.version !== 2
              )
                throw new Error("Patch integrity failure");
            }
            Object.assign(row.metrics, {
              applicationJsonUtf8Bytes:
                route === "full-text-downlink"
                  ? (response.applicationJsonUtf8Bytes ?? null)
                  : (row.metrics.requestJsonUtf8Bytes ?? null),
              applicationJsonStringifyMs:
                route === "full-text-downlink"
                  ? (response.applicationJsonStringifyMs ?? null)
                  : (row.metrics.requestJsonStringifyMs ?? null),
              applicationJsonEncodeMs:
                route === "full-text-downlink"
                  ? (response.applicationJsonEncodeMs ?? null)
                  : (row.metrics.requestJsonEncodeMs ?? null),
              workerMs:
                route === "chunks" ? workerTotal : (response.workerMs ?? null),
              hostMs:
                route === "chunks" ? hostTotal : (response.hostMs ?? null),
              generationMs: response.generationMs ?? generationMs,
              encodeMs: response.encodeMs ?? null,
              payloadUtf8Bytes: route === "patch" ? 5 : bytes,
              transferred:
                response.detached === undefined
                  ? null
                  : Number(response.detached),
              rssBefore: before?.rss ?? null,
              rssAfter: response.metrics?.rss ?? null,
              heapBefore: before?.heapUsed ?? null,
              heapAfter: response.metrics?.heapUsed ?? null,
              cpuUserUs:
                before && response.metrics
                  ? response.metrics.cpuUserUs - before.cpuUserUs
                  : null,
              cpuSystemUs:
                before && response.metrics
                  ? response.metrics.cpuSystemUs - before.cpuSystemUs
                  : null,
            });
            row.status = "ok";
          } catch {
            row.status = cancelled ? "cancelled" : "failed";
          } finally {
            cleanupPromise ??= rpc({ op: "stop", runId });
            const cleanup = await cleanupPromise.catch((): PerfResponse => ({
              ok: false,
            }));
            row.metrics.ownedTextUnitsAfterStop =
              cleanup.ownedTextUnits ?? null;
            row.metrics.workerExitObserved = Number(
              cleanup.workerExitObserved === true
            );
            active = undefined;
          }
          emit(row);
        }
        if (!cancelled) {
          progress(`${bytes / 1_000_000} MB · ${shape} · CM6`);
          await breathe();
          if (cancelled) break;
          const row: PerfRow = {
            bytes,
            shape,
            route: "cm-state",
            status: "failed",
            metrics: {
              generationMs,
              rendererHeapBytes: null,
              nativeCopyCount: null,
            },
          };
          let view: EditorView | undefined;
          try {
            start = performance.now();
            let state = createRawEditorState(text);
            row.metrics.stateCreateMs = performance.now() - start;
            start = performance.now();
            state = state.update({
              changes: { from: 1, insert: "probe" },
            }).state;
            row.metrics.transactionMs = performance.now() - start;
            if (
              state.field(rawText) !==
              text.slice(0, 1) + "probe" + text.slice(1)
            )
              throw new Error("Raw integrity failure");
            start = performance.now();
            if (
              !undo({
                state,
                dispatch: (transaction) => {
                  state = transaction.state;
                },
              }) ||
              state.field(rawText) !== text
            )
              throw new Error("Undo integrity failure");
            row.metrics.undoMs = performance.now() - start;
            row.status = "ok";
            emit(row);
            if (bytes === 1_000_000) {
              start = performance.now();
              view = new EditorView({ state, parent: container });
              const viewCreateMs = performance.now() - start;
              start = performance.now();
              view.dispatch({ changes: { from: 1, insert: "viewport" } });
              const frame = await new Promise<boolean>((resolve) => {
                const timeout = setTimeout(() => resolve(false), 5000);
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    clearTimeout(timeout);
                    resolve(true);
                  })
                );
              });
              emit({
                bytes,
                shape,
                route: "cm-viewport",
                status: frame ? "ok" : "failed",
                metrics: {
                  viewCreateMs,
                  frameOpportunityMs: frame ? performance.now() - start : null,
                  rendererHeapBytes: null,
                },
              });
            }
          } catch {
            if (row.status !== "ok") emit(row);
            else
              emit({
                bytes,
                shape,
                route: "cm-viewport",
                status: "failed",
                metrics: {},
              });
          } finally {
            view?.destroy();
            container.replaceChildren();
          }
        }
      }
    if (!cancelled) {
      const runId = crypto.randomUUID();
      active = runId;
      cleanupPromise = undefined;
      const begun = await rpc({
        op: "start",
        runId,
        bytes: 1_000_000,
        shape: "lines",
      });
      if (begun.ok) {
        const pending = rpc({
          op: "binary",
          runId,
          sequence: 0,
          transfer: true,
        });
        const started = performance.now();
        cleanupPromise = rpc({ op: "stop", runId });
        const stopped = await cleanupPromise;
        const response = await pending;
        emit({
          bytes: 1_000_000,
          shape: "lines",
          route: "cancel",
          status: stopped.workerExitObserved ? "ok" : "failed",
          metrics: {
            cancelMs: performance.now() - started,
            ownedTextUnitsAfterStop: stopped.ownedTextUnits ?? null,
            workerExitObserved: Number(stopped.workerExitObserved === true),
            completedBeforeCancel: Number(response.ok),
          },
        });
      }
      active = undefined;
    }
    const report = check(await rpc({ op: "report", rows }));
    if (
      typeof report.reportName !== "string" ||
      !/^agentic-markdown-perf-[^/]+\/report\.json$/.test(report.reportName)
    )
      throw new Error("Invalid experiment report receipt");
    return { rows, reportName: report.reportName };
  }
  return { run, cancel };
}
