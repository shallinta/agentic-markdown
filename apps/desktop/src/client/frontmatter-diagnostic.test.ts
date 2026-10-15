import { expect, test } from "bun:test";

import { diagnoseFrontmatter } from "./frontmatter-diagnostic";
import {
  createFrontmatterDiagnosticOwner,
  type FrontmatterDiagnosticWorker,
} from "./frontmatter-diagnostic-owner";
import {
  FRONTMATTER_DIAGNOSTIC_CONFIG,
  type FrontmatterDiagnosticRequest,
} from "./frontmatter-diagnostic-protocol";

test("missing closing tokens at EOF retain errors with the exact virtual unit normalized", () => {
  for (const body of ["a: [", "a: [\n", 'a: "x\n', "中文: [未闭合\n"]) {
    const result = diagnoseFrontmatter(body);
    expect(result.hasErrors).toBe(true);
    expect(
      result.diagnostics.some(
        (d) => d.from === body.length && d.to === body.length
      )
    ).toBe(true);
    expect(result.diagnostics.every((d) => d.to <= body.length)).toBe(true);
  }
});
function worker() {
  const sent: FrontmatterDiagnosticRequest[] = [];
  let terminated = 0;
  const value: FrontmatterDiagnosticWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: (request) => {
      sent.push(request);
    },
    terminate: () => {
      terminated++;
    },
  };
  return {
    value,
    sent,
    get terminated() {
      return terminated;
    },
  };
}
test("syntax diagnostics project no YAML values or messages and truncate without declaring success", () => {
  expect(diagnoseFrontmatter("a: 1\n").hasErrors).toBe(false);
  const result = diagnoseFrontmatter(
    "secret: first\n" + "secret: confidential\n".repeat(40)
  );
  expect(result.hasErrors).toBe(true);
  expect(result.truncated).toBe(true);
  expect(result.diagnostics).toHaveLength(32);
  expect(JSON.stringify(result)).not.toContain("confidential");
  expect(() => diagnoseFrontmatter("a".repeat(65537))).toThrow();
});
test("owner cancel before first message settles and retires even captured late callback", async () => {
  const w = worker(),
    owner = createFrontmatterDiagnosticOwner(() => w.value);
  const result = owner.request("a: 1"),
    late = w.value.onmessage!;
  owner.cancel();
  expect(await result).toEqual({ status: "cancelled" });
  expect(w.terminated).toBe(1);
  late({
    data: {
      config: FRONTMATTER_DIAGNOSTIC_CONFIG,
      requestId: w.sent[0].requestId,
      result: diagnoseFrontmatter("a: 1"),
    },
  } as MessageEvent);
  expect(w.value.onmessage).toBeNull();
  owner.dispose();
});
test("owner error, synchronous post throw and host watchdog all release and settle", async () => {
  for (const kind of ["error", "throw", "timeout"] as const) {
    const w = worker();
    if (kind === "throw")
      w.value.postMessage = () => {
        throw new Error("post failed");
      };
    const owner = createFrontmatterDiagnosticOwner(() => w.value, 5);
    const pending = owner.request("a: 1");
    if (kind === "error") w.value.onerror!({} as ErrorEvent);
    expect(await pending).toEqual({ status: "unavailable" });
    expect(w.terminated).toBe(1);
    expect(w.value.onmessage).toBeNull();
    owner.dispose();
  }
});
test("owner validates current profile and bounds, and oversized input starts no worker", async () => {
  const w = worker(),
    owner = createFrontmatterDiagnosticOwner(() => w.value);
  expect(await owner.request("x".repeat(65537))).toEqual({
    status: "unavailable",
  });
  expect(w.sent).toHaveLength(0);
  const result = owner.request("a: 1");
  w.value.onmessage!({
    data: {
      config: "old",
      requestId: w.sent[0].requestId,
      result: diagnoseFrontmatter("a: 1"),
    },
  } as MessageEvent);
  expect(await result).toEqual({ status: "unavailable" });
  owner.dispose();
});
