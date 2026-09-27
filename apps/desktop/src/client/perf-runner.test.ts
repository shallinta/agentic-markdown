import { expect, test } from "bun:test";

import {
  syntheticDigest,
  syntheticText,
  type PerfRequest,
  type PerfResponse,
  type PerfRow,
} from "../shared/perf-lab";

import { createPerfRunner } from "./perf-runner";

test("report failures and malformed receipts reject the run instead of claiming completion", async () => {
  for (const receipt of [
    { ok: false },
    { ok: true },
    { ok: true, reportName: "" },
    { ok: true, reportName: "../report.json" },
  ]) {
    const runner = createPerfRunner(
      async (request) => {
        await Promise.resolve();
        return request.op === "report"
          ? receipt
          : { ok: true, binarySupported: false };
      },
      () => undefined,
      () => undefined,
      {} as HTMLElement
    );
    await runner.cancel();
    const rejected = await runner.run([]).then(
      () => false,
      () => true
    );
    expect(rejected).toBe(true);
  }
});

test("download rows validate client text, reject corruption, and honor cancellation without leaking payload to report", async () => {
  for (const outcome of ["ok", "failed", "cancelled"] as const) {
    const rows: PerfRow[] = [];
    let text = "",
      downloads = 0,
      stops = 0;
    const runner = createPerfRunner(
      async (request): Promise<PerfResponse> => {
        await Promise.resolve();
        if (request.op === "start") {
          text = syntheticText(request.bytes, request.shape);
          return { ok: true };
        }
        if (request.op === "text")
          return { ok: true, bytes: 1_000_000, digest: syntheticDigest(text) };
        if (request.op === "download") {
          downloads++;
          if (outcome === "cancelled") void runner.cancel();
          return {
            ok: true,
            runId: request.runId,
            sequence: request.sequence,
            text: outcome === "failed" ? text + "!" : text,
            bytes: 1_000_000,
            digest: syntheticDigest(text),
            applicationJsonUtf8Bytes: 123,
          };
        }
        if (request.op === "stop") {
          stops++;
          return { ok: true, workerExitObserved: true, ownedTextUnits: 0 };
        }
        if (request.op === "report") {
          expect(JSON.stringify(request.rows)).not.toContain("中文 abc");
          return {
            ok: true,
            reportName: "agentic-markdown-perf-test/report.json",
          };
        }
        return { ok: true, binarySupported: false };
      },
      (row) => {
        rows.push(row);
        if (row.route === "full-text-downlink") void runner.cancel();
      },
      () => undefined,
      {} as HTMLElement
    );
    await runner.run([1_000_000]);
    const result = rows.find((row) => row.route === "full-text-downlink")!;
    expect(result.status).toBe(outcome);
    expect(result.metrics.oneWayMs).toBeNull();
    expect(result.metrics.nativeCopyCount).toBeNull();
    expect(result.metrics.rendererHeapBytes).toBeNull();
    expect(downloads).toBe(1);
    expect(stops).toBe(2);
    if (outcome === "ok") {
      expect(result.metrics.applicationJsonUtf8Bytes).toBe(123);
      expect(result.metrics.clientValidationMs).toBeGreaterThanOrEqual(0);
    }
  }
});

test("cancel during progress yield does not start a new Worker", async () => {
  const requests: PerfRequest[] = [];
  const rows: PerfRow[] = [];
  const runner = createPerfRunner(
    async (request) => {
      await Promise.resolve();
      requests.push(request);
      if (request.op === "report")
        return {
          ok: true,
          reportName: "agentic-markdown-perf-test/report.json",
        };
      return { ok: true, binarySupported: false };
    },
    (row) => rows.push(row),
    () => {
      void runner.cancel();
    },
    {} as HTMLElement
  );
  await runner.run([1_000_000]);
  expect(requests.map((request) => request.op)).toEqual(["probe", "report"]);
  expect(rows).toHaveLength(1);
});

test("cancel shares stop promise with finally and retains exit evidence", async () => {
  const requests: PerfRequest[] = [];
  const rows: PerfRow[] = [];
  const runner = createPerfRunner(
    async (request): Promise<PerfResponse> => {
      await Promise.resolve();
      requests.push(request);
      if (request.op === "report")
        return {
          ok: true,
          reportName: "agentic-markdown-perf-test/report.json",
        };
      if (request.op === "text") {
        void runner.cancel();
        return {
          ok: true,
          bytes: 1_000_000,
          digest: syntheticDigest(request.text),
          version: 1,
        };
      }
      if (request.op === "stop")
        return { ok: true, workerExitObserved: true, ownedTextUnits: 0 };
      return { ok: true, binarySupported: false };
    },
    (row) => rows.push(row),
    () => undefined,
    {} as HTMLElement
  );
  await runner.run([1_000_000]);
  expect(requests.filter((request) => request.op === "stop")).toHaveLength(1);
  expect(requests.filter((request) => request.op === "start")).toHaveLength(1);
  expect(rows[1]?.metrics.workerExitObserved).toBe(1);
  expect(rows[1]?.metrics.ownedTextUnitsAfterStop).toBe(0);
});
