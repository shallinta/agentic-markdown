import { expect, test } from "bun:test";

import { validPerfRows } from "../bun/perf-lab";

import { inputSummary, workSnapshotMatches } from "./parser-work-probe";

test("cache observations require consistent accounting and released owned costs, not hard budget compliance", () => {
  const ready = {
    treeBufferBytes: 10,
    treeEstimatedObjectBytes: 20,
    treeAccountedBytes: 30,
    pinnedExcessBytes: 5,
    activeTreeBudgetBytes: 25,
    totalBudgetBytes: 25,
    textReferenceCount: 1,
    retainedWireBytes: 0,
    retiredTreeBytes: 0,
    runningCount: 0,
    pendingCount: 0,
  };
  expect(workSnapshotMatches(ready, false)).toBe(true);
  expect(workSnapshotMatches(ready, true)).toBe(false);
  expect(workSnapshotMatches({ ...ready, treeAccountedBytes: 10 }, false)).toBe(
    false
  );
  expect(workSnapshotMatches({ ...ready, runningCount: 2 }, false)).toBe(false);
  expect(workSnapshotMatches({ ...ready, pendingCount: NaN }, false)).toBe(
    false
  );
  expect(workSnapshotMatches({ ...ready, runningCount: -1 }, false)).toBe(
    false
  );
  expect(
    workSnapshotMatches(
      {
        ...ready,
        treeBufferBytes: 0,
        treeEstimatedObjectBytes: 0,
        treeAccountedBytes: 0,
        pinnedExcessBytes: 0,
        textReferenceCount: 0,
      },
      true
    )
  ).toBe(true);
});

test("input summary retains arithmetic mean of central pair for even samples", () => {
  expect(inputSummary([4, 1, 3])).toEqual({
    inputCount: 3,
    inputMinMs: 1,
    inputMedianMs: 3,
    inputMaxMs: 4,
    inputSumMs: 8,
  });
  expect(inputSummary([4, 1, 3, 2])).toEqual({
    inputCount: 4,
    inputMinMs: 1,
    inputMedianMs: 2.5,
    inputMaxMs: 4,
    inputSumMs: 10,
  });
});

test("parser work report accepts bounded scalar observations but not content or arbitrary metric names", () => {
  const row = {
    bytes: 200025,
    shape: "long-line",
    route: "cm-parser-work",
    status: "ok",
    metrics: {
      workPolicy: 1,
      inputPattern: 1,
      trial: 2,
      inputCount: 10,
      input0Ms: 3,
      input9Ms: 4,
      inputMinMs: 3,
      inputMedianMs: 3.5,
      inputMaxMs: 4,
      inputSumMs: 35,
      lastInputToReadyMs: 123,
      saveMatches: 1,
      parserReadyBeforeSave: 0,
      workReadyStarted: 2,
      workDestroyedRunningCount: 0,
      workerHeapBytes: null,
    },
  };
  expect(validPerfRows([row])).toBe(true);
  expect(
    validPerfRows([
      { ...row, metrics: { ...row.metrics, privateText: "sensitive" } },
    ])
  ).toBe(false);
  expect(validPerfRows([{ ...row, metrics: { input10Ms: 1 } }])).toBe(false);
  expect(
    validPerfRows([{ ...row, metrics: { lastInputToReadyMs: Infinity } }])
  ).toBe(false);
  expect(validPerfRows([{ ...row, bytes: 1048577 }])).toBe(false);
});
