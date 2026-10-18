/** Internal limited-v1 profile, not a product-wide document capacity. */
export const INDEX_LIMITS = {
  documents: 16,
  bytes: 65_536,
  wire: 70_000,
  query: 4096,
  output: 150_000,
} as const;
export type IndexChange =
  | { kind: "put"; id: string; path: string; raw: string }
  | { kind: "delete"; id: string };
export type IndexOperation = "open" | "apply" | "query" | "close";
export interface IndexHit {
  id: string;
  from: number;
  to: number;
}
export type IndexResult =
  | { ok: true; generation: number; hits?: IndexHit[] }
  | {
      ok: false;
      error:
        | "INPUT"
        | "LIMIT"
        | "SCHEMA"
        | "READONLY"
        | "UNAVAILABLE"
        | "BUSY"
        | "CANCELLED"
        | "CLOSED"
        | "UNKNOWN";
      accepted: boolean;
    };
export interface IndexRequest {
  version: 1;
  epoch: number;
  id: number;
  op: IndexOperation;
  payload: unknown;
}
export interface IndexResponse {
  version: 1;
  epoch: number;
  id: number;
  result: IndexResult;
}
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function keys(
  value: Record<string, unknown>,
  expected: string
): boolean {
  return Object.keys(value).sort().join(",") === expected;
}
export function natural(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function scalar(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value
    )
  );
}
export function validRequest(value: unknown): value is IndexRequest {
  return (
    record(value) &&
    keys(value, "epoch,id,op,payload,version") &&
    value.version === 1 &&
    natural(value.epoch) &&
    value.epoch > 0 &&
    natural(value.id) &&
    value.id > 0 &&
    ["open", "apply", "query", "close"].includes(String(value.op)) &&
    typeof value.op === "string"
  );
}
export function validResult(
  value: unknown,
  op: IndexOperation
): value is IndexResult {
  if (!record(value)) return false;
  if (value.ok === false)
    return (
      keys(value, "accepted,error,ok") &&
      typeof value.accepted === "boolean" &&
      value.accepted === (value.error === "UNKNOWN") &&
      typeof value.error === "string" &&
      [
        "INPUT",
        "LIMIT",
        "SCHEMA",
        "READONLY",
        "UNAVAILABLE",
        "BUSY",
        "CANCELLED",
        "CLOSED",
        "UNKNOWN",
      ].includes(value.error)
    );
  if (value.ok !== true || !natural(value.generation)) return false;
  if (op !== "query") return keys(value, "generation,ok");
  if (
    !keys(value, "generation,hits,ok") ||
    !Array.isArray(value.hits) ||
    value.hits.length > 16
  )
    return false;
  let prior = "";
  for (const hit of value.hits) {
    if (
      !record(hit) ||
      !keys(hit, "from,id,to") ||
      typeof hit.id !== "string" ||
      !/^[A-Za-z0-9-]{1,32}$/.test(hit.id) ||
      hit.id <= prior ||
      !natural(hit.from) ||
      !natural(hit.to) ||
      hit.to < hit.from ||
      hit.to > INDEX_LIMITS.bytes
    )
      return false;
    prior = hit.id;
  }
  return true;
}
export function encodeChanges(value: unknown): Buffer {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16)
    throw Error("INPUT");
  const fields: string[][] = [];
  const kinds: number[] = [];
  let bytes = 4;
  const ids = new Set<string>();
  for (const item of value) {
    if (
      !record(item) ||
      (item.kind !== "put" && item.kind !== "delete") ||
      !keys(item, item.kind === "put" ? "id,kind,path,raw" : "id,kind")
    )
      throw Error("INPUT");
    if (
      typeof item.id !== "string" ||
      !/^[A-Za-z0-9-]{1,32}$/.test(item.id) ||
      ids.has(item.id)
    )
      throw Error("INPUT");
    ids.add(item.id);
    const row = [
      item.id,
      item.kind === "put" ? item.path : "",
      item.kind === "put" ? item.raw : "",
    ];
    const limits = [32, 128, INDEX_LIMITS.bytes];
    for (let i = 0; i < 3; i++)
      if (
        !scalar(row[i], limits[i]) ||
        Buffer.byteLength(row[i] as string) > limits[i]
      )
        throw Error("LIMIT");
    if (
      item.kind === "put" &&
      (!(row[1] as string).length || (row[1] as string).includes("\0"))
    )
      throw Error("INPUT");
    const strings = row as string[];
    bytes += 16 + strings.reduce((n, s) => n + Buffer.byteLength(s), 0);
    if (bytes > INDEX_LIMITS.wire) throw Error("LIMIT");
    fields.push(strings);
    kinds.push(item.kind === "put" ? 1 : 2);
  }
  const out = Buffer.alloc(bytes);
  out.writeUInt32LE(value.length);
  let at = 4;
  fields.forEach((row, index) => {
    out.writeUInt32LE(kinds[index], at);
    row.forEach((s, i) =>
      out.writeUInt32LE(Buffer.byteLength(s), at + 4 + i * 4)
    );
    at += 16;
    for (const s of row) at += out.write(s, at, "utf8");
  });
  return out;
}
