import { expect, test } from "bun:test";

import { CANONICAL_CONFIG, canonicalCorpus } from "../shared/canonical-corpus";

import {
  parseCanonicalMarkdown,
  runCanonicalSample,
} from "./canonical-markdown";
import {
  createCanonicalRunner,
  type CanonicalWorker,
} from "./canonical-runner";

test("fixed shared corpus matches independent semantic expectations without mutating input", () => {
  const before = JSON.stringify(canonicalCorpus);
  for (const sample of canonicalCorpus)
    expect(
      runCanonicalSample({ id: sample.id, config: CANONICAL_CONFIG }).passed
    ).toBe(true);
  expect(JSON.stringify(canonicalCorpus)).toBe(before);
  expect(
    runCanonicalSample({ id: "reference-defined", config: CANONICAL_CONFIG })
      .targets
  ).toEqual(["local.md"]);
  expect(
    runCanonicalSample({ id: "reference-changed", config: CANONICAL_CONFIG })
      .targets
  ).toEqual(["changed.md"]);
  expect(
    runCanonicalSample({ id: "positions", config: CANONICAL_CONFIG })
      .rangesValid
  ).toBe(true);
  for (const request of [
    null,
    {},
    { id: "heading", config: "wrong" },
    { id: "heading", config: CANONICAL_CONFIG, text: "secret" },
    { id: "unknown", config: CANONICAL_CONFIG },
  ])
    expect(() => runCanonicalSample(request)).toThrow();
});
test("BOM CRLF and astral characters have exact original UTF-16 offsets and slices", () => {
  const original = "\uFEFF# 😀\r\n\r\n[标签](x)\n";
  const tree = parseCanonicalMarkdown(original);
  const heading = tree.children[0];
  expect(heading.type).toBe("heading");
  expect(heading.position?.start.offset).toBe(1);
  expect(heading.position?.end.offset).toBe(5);
  expect(
    original.slice(heading.position?.start.offset, heading.position?.end.offset)
  ).toBe("# 😀");
  const paragraph = tree.children[1];
  if (paragraph.type !== "paragraph") throw new Error("Expected paragraph");
  const link = paragraph.children[0];
  expect(link.type).toBe("link");
  expect(link.position?.start.offset).toBe(9);
  expect(link.position?.end.offset).toBe(16);
  expect(
    original.slice(link.position?.start.offset, link.position?.end.offset)
  ).toBe("[标签](x)");
});

class ControlledWorker implements CanonicalWorker {
  onmessage: CanonicalWorker["onmessage"] = null;
  onerror: CanonicalWorker["onerror"] = null;
  onmessageerror: CanonicalWorker["onmessageerror"] = null;
  requests: { id: string; config: string }[] = [];
  terminated = false;
  postMessage(request: { id: string; config: string }) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  complete() {
    this.onmessage?.(
      new MessageEvent("message", {
        data: {
          ok: true,
          row: runCanonicalSample(this.requests[this.requests.length - 1]),
        },
      })
    );
  }
}
test("cancel terminates, old callbacks cannot publish into rerun, only one worker runs", async () => {
  const workers: ControlledWorker[] = [];
  const runner = createCanonicalRunner(() => {
    const worker = new ControlledWorker();
    workers.push(worker);
    return worker;
  });
  const published: string[] = [];
  const first = runner.run((row) => published.push(row.id));
  expect(
    await runner.run(() => {
      throw new Error("Concurrent publication");
    })
  ).toBeNull();
  expect(workers.length).toBe(1);
  const oldMessage = workers[0].onmessage;
  runner.cancel();
  expect(await first).toBeNull();
  expect(workers[0].terminated).toBe(true);
  const next = runner.run((row) => published.push(row.id));
  oldMessage?.(
    new MessageEvent("message", {
      data: { ok: true, row: runCanonicalSample(workers[0].requests[0]) },
    })
  );
  expect(published).toEqual([]);
  canonicalCorpus.forEach(() => workers[1].complete());
  expect(await next).toBe(true);
  expect(workers[1].terminated).toBe(true);
  expect(published.length).toBe(canonicalCorpus.length);
});
test("consumer exceptions and malformed worker responses terminate rather than leak active work", async () => {
  for (const malformed of [false, true]) {
    const worker = new ControlledWorker();
    const runner = createCanonicalRunner(() => worker);
    const pending = runner.run(() => {
      throw new Error("consumer");
    });
    const failure = pending.catch(() => "failed");
    if (malformed)
      worker.onmessage?.(
        new MessageEvent("message", { data: null }) as unknown as Parameters<
          NonNullable<CanonicalWorker["onmessage"]>
        >[0]
      );
    else worker.complete();
    expect(await failure).toBe("failed");
    expect(worker.terminated).toBe(true);
  }
});
