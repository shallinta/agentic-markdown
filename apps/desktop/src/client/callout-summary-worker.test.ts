import { expect, test } from "bun:test";

import { normalizeIdentifier } from "micromark-util-normalize-identifier";

import { createCalloutSummaryOwner, type CalloutSummarySource } from "./callout-summary-owner";
import { CALLOUT_SUMMARY_CONFIG } from "./callout-summary-protocol";
import { createRawEditorState, rawText } from "./raw-buffer";

for (const [name, count, label] of [
  ["ASCII", 50000, "r"],
  ["Unicode", 30000, "ﬃ"],
] as const)
  test(`real callout Worker dense ${name} labels, without truncation`, async () => {
    const raw = Array.from(
      { length: count },
      (_, i) => `[${label}${i}]: /url\n`
    ).join("");
    expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(1048576);
    const state = createRawEditorState(raw),
      at = performance.now(),
      text = state.field(rawText),
      rawReadMs = performance.now() - at;
    const source: CalloutSummarySource = {
      documentId: "fixture",
      revision: 1,
      doc: state.doc,
      rawText: text,
      identity: {},
      config: CALLOUT_SUMMARY_CONFIG,
    };
    let created = 0;
    const start = performance.now();
    const owner = createCalloutSummaryOwner(
      () => source,
      () => {
        created = performance.now();
        return new Worker(
          new URL("./callout-summary.worker.ts", import.meta.url).href
        );
      }
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const unsubscribe = owner.subscribe(() => {
          const result = owner.getSnapshot();
          if (result.status === "failed") {
            unsubscribe();
            reject(Error("summary failed"));
          }
          if (result.status === "ready") {
            try {
              expect(result.definitions.size).toBe(count);
              expect(
                result.definitions.has(normalizeIdentifier(label + (count - 1)))
              ).toBe(true);
              let units = 0,
                bytes = 0;
              for (const value of result.definitions) {
                units += value.length;
                bytes += new TextEncoder().encode(value).length;
              }
              console.info(
                JSON.stringify({
                  sample: name,
                  inputBytes: new TextEncoder().encode(raw).length,
                  labels: result.definitions.size,
                  outputUnits: units,
                  outputBytes: bytes,
                  rawReadMs,
                  workerThroughValidationMs: performance.now() - created,
                  totalIncludingQuietMs: performance.now() - start,
                  threadExitVerified: false,
                  memoryReturnVerified: false,
                })
              );
              unsubscribe();
              resolve();
            } catch (error) {
              unsubscribe();
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          }
        });
        owner.observe(true);
      });
    } finally {
      owner.dispose();
    }
  }, 20000);
