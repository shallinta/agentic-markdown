import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { syntheticDigest, syntheticText } from "../../shared/perf-lab";

import { createPerfLabService, validPerfRows } from "./index";

let directory: string;
let workerPath: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "agentic-perf-service-test-"));
  workerPath = join(directory, "worker.js");
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "worker.ts")],
    outdir: directory,
    target: "bun",
  });
  expect(build.success).toBe(true);
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

const start = () => ({
  op: "start",
  runId: crypto.randomUUID(),
  bytes: 1_000_000,
  shape: "lines",
});
const row = {
  bytes: 1_000_000,
  shape: "lines",
  route: "full-text",
  status: "ok",
  metrics: { roundTripMs: 1.25, rendererHeapBytes: null },
};

describe("isolated performance service", () => {
  test("view probes accept bounded synthetic sizes but reject content and oversized samples", () => {
    for (const route of [
      "cm-long-line-view",
      "cm-parser-lifecycle",
      "cm-dense-diagnostic",
      "cm-responsive-input",
      "cm-parser-work",
      "cm-disk-open",
    ]) {
      const probe = {
        ...row,
        route,
        bytes: 10027,
        metrics: { rawMatches: 1, observationMs: null },
      };
      expect(validPerfRows([probe])).toBe(true);
      for (const bytes of [0, -1, 1.5, 1048577])
        expect(validPerfRows([{ ...probe, bytes }])).toBe(false);
      expect(validPerfRows([{ ...probe, text: "private" }])).toBe(false);
      expect(
        validPerfRows([{ ...probe, metrics: { rawText: "private" } }])
      ).toBe(false);
    }
    expect(validPerfRows([{ ...row, bytes: 10027 }])).toBe(false);
  });
  test("full download obeys strict fields, sequence, integrity and stop lifecycle", async () => {
    const disabled = createPerfLabService({ enabled: false, workerPath });
    expect(
      (
        await disabled.run({
          op: "download",
          runId: crypto.randomUUID(),
          sequence: 0,
        })
      ).error
    ).toBe("DISABLED");
    const service = createPerfLabService({ enabled: true, workerPath });
    const request = start();
    try {
      await service.run(request);
      const download = { op: "download", runId: request.runId, sequence: 0 };
      for (const invalid of [
        { ...download, path: "/file" },
        { ...download, text: "unexpected" },
        { ...download, sequence: 1 },
      ])
        expect((await service.run(invalid)).error).toBe("INVALID");
      const response = await service.run(download);
      const expected = syntheticText(request.bytes, "lines");
      expect(response.text).toBe(expected);
      expect(response.bytes).toBe(Buffer.byteLength(expected));
      expect(response.digest).toBe(syntheticDigest(expected));
      expect(response.applicationJsonUtf8Bytes).toBe(
        Buffer.byteLength(JSON.stringify({ text: expected }))
      );
      expect((await service.run(download)).error).toBe("INVALID");
      await service.run({ op: "stop", runId: request.runId });
      expect((await service.run(download)).error).toBe("INVALID");
      await service.run(request);
      const pending = service.run(download);
      await service.run({ op: "stop", runId: request.runId });
      expect((await pending).error).toBe("CANCELLED");
    } finally {
      await service.dispose();
    }
  });

  test("download reports accept numeric probes and null unknowns but never body content", () => {
    const download = {
      ...row,
      route: "full-text-downlink",
      metrics: {
        applicationJsonUtf8Bytes: 120,
        applicationJsonStringifyMs: 1,
        applicationJsonEncodeMs: 1,
        oneWayMs: null,
        nativeCopyCount: null,
        rendererHeapBytes: null,
      },
    };
    expect(validPerfRows([download])).toBe(true);
    expect(validPerfRows([{ ...download, text: "corpus" }])).toBe(false);
    expect(validPerfRows([{ ...download, metrics: { text: "corpus" } }])).toBe(
      false
    );
  });
  test("disabled service rejects requests without launching a worker", async () => {
    const service = createPerfLabService({ enabled: false, workerPath });
    expect(await service.run(start())).toEqual({
      ok: false,
      error: "DISABLED",
    });
    expect(await service.run({ op: "report", rows: [row] })).toEqual({
      ok: false,
      error: "DISABLED",
    });
    expect(await service.dispose()).toBeNull();
  });

  test("disk fixture capability requires both lab and explicit open flag", async () => {
    for (const flags of [
      { enabled: false, openEnabled: true },
      { enabled: true, openEnabled: false },
    ]) {
      const service = createPerfLabService({ ...flags, workerPath });
      expect(await service.run({ op: "open-start" })).toEqual({
        ok: false,
        error: "DISABLED",
      });
      await service.dispose();
    }
  });

  test("rejects unsupported sizes and extra fields before allocating", async () => {
    const service = createPerfLabService({ enabled: true, workerPath });
    try {
      for (const request of [
        null,
        { ...start(), bytes: 1_048_576 },
        { ...start(), path: "/not-a-document" },
        { ...start(), shape: "unknown" },
        { ...start(), runId: "invalid" },
      ]) {
        expect(await service.run(request)).toEqual({
          ok: false,
          error: "INVALID",
        });
      }
      expect(await service.dispose()).toBeNull();
    } finally {
      await service.dispose();
    }
  });

  test("one session enforces sequence and complete 1 MB integrity, then exits and restarts", async () => {
    const service = createPerfLabService({ enabled: true, workerPath });
    const request = start();
    try {
      expect((await service.run(request)).ok).toBe(true);
      expect(await service.run(start())).toEqual({ ok: false, error: "BUSY" });
      expect(await service.run({ op: "report", rows: [row] })).toEqual({
        ok: false,
        error: "INVALID",
      });
      const text = syntheticText(request.bytes, "lines");
      const message = {
        op: "text",
        runId: request.runId,
        sequence: 0,
        text,
        final: true,
      };
      expect(await service.run({ ...message, sequence: 1 })).toEqual({
        ok: false,
        error: "INVALID",
      });
      expect(await service.run({ ...message, extra: true })).toEqual({
        ok: false,
        error: "INVALID",
      });
      const response = await service.run(message);
      expect(response.ok).toBe(true);
      expect(response.bytes).toBe(request.bytes);
      expect(response.digest).toBe(syntheticDigest(text));
      expect(response.version).toBe(1);
      expect(response.sequence).toBe(0);
      expect(await service.run(message)).toEqual({
        ok: false,
        error: "INVALID",
      });
      const stopped = await service.run({ op: "stop", runId: request.runId });
      expect(stopped.ok).toBe(true);
      expect(stopped.workerExitObserved).toBe(true);
      expect(stopped.ownedTextUnits).toBe(0);
      expect((await service.run(start())).ok).toBe(true);
    } finally {
      await service.dispose();
    }
  });

  test("stop resolves an in-flight request as cancelled without a timing sleep", async () => {
    const service = createPerfLabService({ enabled: true, workerPath });
    const request = start();
    try {
      expect((await service.run(request)).ok).toBe(true);
      const pending = service.run({
        op: "text",
        runId: request.runId,
        sequence: 0,
        text: syntheticText(request.bytes, "lines"),
        final: true,
      });
      const stopped = service.run({ op: "stop", runId: request.runId });
      expect(await pending).toEqual({
        ok: false,
        error: "CANCELLED",
        runId: request.runId,
      });
      expect((await stopped).workerExitObserved).toBe(true);
      expect((await service.run(start())).ok).toBe(true);
    } finally {
      await service.dispose();
    }
  });

  test("report validates allowed metrics, finite numbers and bounded row count", async () => {
    expect(validPerfRows([row])).toBe(true);
    const invalid = [
      [{ ...row, metrics: { path: "/not-a-document" } }],
      [{ ...row, metrics: { roundTripMs: Number.NaN } }],
      [{ ...row, metrics: { roundTripMs: Number.POSITIVE_INFINITY } }],
      [{ ...row, content: "not-report-metadata" }],
      [{ ...row, bytes: 42 }],
      [{ ...row, route: "shell" }],
      Array.from({ length: 101 }, () => row),
    ];
    const service = createPerfLabService({ enabled: true, workerPath });
    try {
      for (const rows of invalid) {
        expect(validPerfRows(rows)).toBe(false);
        expect(await service.run({ op: "report", rows })).toEqual({
          ok: false,
          error: "INVALID",
        });
      }
      const response = await service.run({ op: "report", rows: [row] });
      expect(response.ok).toBe(true);
      expect(response.reportName).toMatch(
        /^agentic-markdown-perf-[^/]+\/report\.json$/
      );
      if (
        !response.reportName?.match(
          /^agentic-markdown-perf-[^/]+\/report\.json$/
        )
      )
        throw Error("Unexpected report path");
      const reportPath = join(tmpdir(), response.reportName);
      try {
        const report: unknown = JSON.parse(await readFile(reportPath, "utf8"));
        expect(report).toMatchObject({ rows: [row], unit: "decimal bytes" });
      } finally {
        await rm(join(tmpdir(), response.reportName.split("/")[0]), {
          recursive: true,
          force: true,
        });
      }
    } finally {
      await service.dispose();
    }
  });
});
