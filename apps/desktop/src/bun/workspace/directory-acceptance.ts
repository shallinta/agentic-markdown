import { randomUUID } from "node:crypto";

export interface DirectoryOperation {
  session: string;
  sequence: number;
}
export type DirectoryAcceptanceResult =
  | { status: "committed"; root: string; generation: number }
  | { status: "rejected"; reason: string }
  | { status: "issued" | "pending" | "unknown" | "busy" };
const RECORD_BYTES = 512;
const MAX_RECORDS = 8;

/** Only service-issued operations may run. Evicted operations are never re-admitted. */
export function createDirectoryAcceptanceLedger() {
  const session = randomUUID();
  let highWater = 0,
    active = false;
  const records = new Map<
    number,
    {
      token: string;
      result: DirectoryAcceptanceResult;
      promise?: Promise<DirectoryAcceptanceResult>;
    }
  >();
  const record = (operation: DirectoryOperation) => {
    if (
      operation?.session !== session ||
      !Number.isSafeInteger(operation.sequence) ||
      operation.sequence <= 0 ||
      operation.sequence > highWater
    )
      return undefined;
    return records.get(operation.sequence);
  };
  return {
    issue(token: string, room: number): DirectoryOperation | undefined {
      if (active || highWater === Number.MAX_SAFE_INTEGER) return undefined;
      const nextSize = Math.min(MAX_RECORDS, records.size + 1);
      if (nextSize * RECORD_BYTES > room) return undefined;
      if (records.size === MAX_RECORDS)
        records.delete(records.keys().next().value!);
      const sequence = ++highWater;
      records.set(sequence, { token, result: { status: "issued" } });
      return { session, sequence };
    },
    run(
      operation: DirectoryOperation,
      execute: (token: string) => Promise<DirectoryAcceptanceResult>
    ): Promise<DirectoryAcceptanceResult> {
      const value = record(operation);
      if (!value) return Promise.resolve({ status: "unknown" });
      if (value.promise) return value.promise.then((result) => ({ ...result }));
      if (value.result.status !== "issued")
        return Promise.resolve({ ...value.result });
      if (active) return Promise.resolve({ status: "busy" });
      active = true;
      value.result = { status: "pending" };
      value.promise = Promise.resolve()
        .then(() => execute(value.token))
        .catch((): DirectoryAcceptanceResult => ({ status: "unknown" }))
        .then((result) => {
          value.result = { ...result };
          return value.result;
        })
        .finally(() => {
          active = false;
        });
      return value.promise.then((result) => ({ ...result }));
    },
    query(operation: DirectoryOperation): DirectoryAcceptanceResult {
      return { ...(record(operation)?.result ?? { status: "unknown" }) };
    },
    recordResult(
      operation: DirectoryOperation,
      result: DirectoryAcceptanceResult
    ) {
      const value = record(operation);
      if (value?.result.status === "pending") value.result = { ...result };
    },
    bytes: () => records.size * RECORD_BYTES,
    busy: () => active,
    clear() {
      records.clear();
    },
  };
}
