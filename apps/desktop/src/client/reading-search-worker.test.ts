import { expect, test } from "bun:test";

import type { ReadingRun } from "./reading-search-projection";
import type { SearchResult } from "./source-search-protocol";

test("real reading Worker prepares once and reuses literal engine with typed object boundaries", async () => {
  const worker = new Worker(
    new URL("./reading-search.worker.ts", import.meta.url).href
  );
  const received: unknown[] = [];
  let resolve: ((value: unknown) => void) | undefined;
  worker.onmessage = (event) => {
    received.push(event.data);
    resolve?.(event.data);
    resolve = undefined;
  };
  const next = (value: unknown) =>
    new Promise<unknown>((done, reject) => {
      const timer = setTimeout(() => reject(Error("worker timeout")), 5000);
      resolve = (response) => {
        clearTimeout(timer);
        done(response);
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        reject(Error(event.message));
      };
      worker.postMessage(value);
    });
  try {
    const prepared = (await next({
      kind: "prepare",
      epoch: "test",
      leaves: [
        { id: 0, text: "ab", flow: "normal" },
        { id: 1, text: "cd", flow: "normal" },
        { id: 2, text: "", flow: "boundary" },
        { id: 3, text: "ab\r\ncd", flow: "pre" },
      ],
    })) as { kind: string; length: number; runs: ReadingRun[] };
    expect(prepared.kind).toBe("prepared");
    expect(prepared.length).toBe(10);
    const scan = {
      kind: "scan",
      epoch: "test",
      id: 1,
      options: { query: "bc", caseSensitive: true, wholeWord: false },
      position: 0,
    };
    const found = (await next(scan)) as SearchResult;
    expect(found.count).toBe(1);
    expect(found.current).toEqual([1, 3]);
    const crossing = (await next({
      ...scan,
      id: 2,
      options: { ...scan.options, query: "d\na" },
    })) as SearchResult;
    expect(crossing.count).toBe(0);
    const code = (await next({
      ...scan,
      id: 3,
      options: { ...scan.options, query: "ab\ncd" },
    })) as SearchResult;
    expect(code.current).toEqual([5, 10]);
    expect(received).toHaveLength(4);
  } finally {
    worker.terminate();
  }
});
