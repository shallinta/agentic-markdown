/** Isolated experimental budgets, not production document limits. MB is decimal. */
export const PERF_SIZES = [1_000_000, 10_000_000, 50_000_000] as const;
export const PERF_CHUNK_BYTES = 250_000;
export type PerfShape = "lines" | "long-line";
export type PerfRoute =
  | "rpc-binary-probe"
  | "full-text"
  | "full-text-downlink"
  | "chunks"
  | "patch"
  | "worker-clone"
  | "worker-transfer"
  | "cm-state"
  | "cm-viewport"
  | "cm-long-line-view"
  | "cm-parser-lifecycle"
  | "cm-dense-diagnostic"
  | "cm-responsive-input"
  | "cm-parser-work"
  | "cm-disk-open"
  | "cancel";
export interface PerfRow {
  bytes: number;
  shape: PerfShape;
  route: PerfRoute;
  status: "ok" | "failed" | "unsupported" | "cancelled";
  metrics: Record<string, number | null>;
}
export interface PerfMetrics {
  rss: number;
  heapUsed: number;
  cpuUserUs: number;
  cpuSystemUs: number;
}
export type PerfRequest =
  | { op: "open-start" }
  | { op: "open-prepare"; runId: string; sample: number }
  | { op: "open-stop"; runId: string }
  | {
      op: "open-call";
      runId: string;
      action:
        | "select"
        | "read"
        | "save"
        | "release"
        | "cancel"
        | "checkWriteCapability"
        | "waitForSaves";
      sample: number;
      request: unknown;
    }
  | { op: "start"; runId: string; bytes: number; shape: PerfShape }
  | { op: "probe"; array: unknown; typed: unknown }
  | { op: "download"; runId: string; sequence: number }
  | {
      op: "text";
      runId: string;
      sequence: number;
      text: string;
      final: boolean;
    }
  | {
      op: "patch";
      runId: string;
      sequence: number;
      baseline: string;
      version: number;
      from: number;
      to: number;
      insert: string;
    }
  | { op: "binary"; runId: string; sequence: number; transfer: boolean }
  | { op: "stop"; runId: string }
  | { op: "report"; rows: PerfRow[] };
export interface PerfResponse {
  document?: unknown;
  openMetrics?: Record<string, number>;
  ok: boolean;
  error?: "DISABLED" | "INVALID" | "BUSY" | "CANCELLED" | "TIMEOUT" | "FAILED";
  runId?: string;
  sequence?: number;
  bytes?: number;
  digest?: string;
  version?: number;
  workerMs?: number;
  hostMs?: number;
  generationMs?: number;
  encodeMs?: number;
  metrics?: PerfMetrics;
  binarySupported?: boolean;
  detached?: boolean;
  ownedTextUnits?: number;
  workerExitObserved?: boolean;
  reportName?: string;
  text?: string;
  applicationJsonUtf8Bytes?: number;
  applicationJsonStringifyMs?: number;
  applicationJsonEncodeMs?: number;
}

/** Application-object probe, not SDK envelope/wire bytes or native copy counts. */
export function measureApplicationJson(value: unknown) {
  let start = performance.now();
  const json = JSON.stringify(value);
  const stringifyMs = performance.now() - start;
  start = performance.now();
  const bytes = new TextEncoder().encode(json).byteLength;
  return { bytes, stringifyMs, encodeMs: performance.now() - start };
}

export function validDownload(
  response: PerfResponse,
  expected: string,
  bytes: number,
  runId: string,
  sequence: number
): boolean {
  return (
    response.ok &&
    response.runId === runId &&
    response.sequence === sequence &&
    response.text === expected &&
    response.bytes === bytes &&
    new TextEncoder().encode(response.text).byteLength === bytes &&
    response.digest === syntheticDigest(response.text)
  );
}
export function syntheticText(bytes: number, shape: PerfShape): string {
  const pattern =
    shape === "lines" ? "中文 abc 0123456789\r\n" : "中文 abc 0123456789 ";
  const unit = new TextEncoder().encode(pattern).length;
  const remaining = bytes - 3;
  return (
    "\uFEFF" +
    pattern.repeat(Math.floor(remaining / unit)) +
    "x".repeat(remaining % unit)
  );
}
/** FNV-1a over UTF-16 units: integrity checksum, explicitly not cryptographic. */
export function syntheticDigest(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export const perfUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
export const perfRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
