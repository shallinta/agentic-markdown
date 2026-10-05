import { expect, test } from "bun:test";

import {
  createDirectoryAcceptanceLedger,
  type DirectoryAcceptanceResult,
} from "./directory-acceptance";

test("issued operations join once, copy receipts, and do not admit arbitrary or evicted operations", async () => {
  const ledger = createDirectoryAcceptanceLedger();
  const first = ledger.issue("candidate", 4096)!;
  const other = ledger.issue("other", 4096)!;
  let finish!: (value: DirectoryAcceptanceResult) => void;
  let calls = 0;
  const execute = async () => {
    calls++;
    return new Promise<DirectoryAcceptanceResult>((resolve) => {
      finish = resolve;
    });
  };
  const a = ledger.run(first, execute),
    b = ledger.run(first, execute);
  await Promise.resolve();
  expect(calls).toBe(1);
  expect(await ledger.run(other, execute)).toEqual({ status: "busy" });
  expect(ledger.issue("blocked", 4096)).toBeUndefined();
  ledger.recordResult(first, {
    status: "committed",
    root: "root",
    generation: 2,
  });
  expect(ledger.query(first)).toMatchObject({ status: "committed" });
  finish({ status: "committed", root: "root", generation: 2 });
  const result = await a;
  expect(await b).toEqual(result);
  result.status = "unknown";
  expect(ledger.query(first)).toMatchObject({ status: "committed" });
  for (let i = 0; i < 10; i++) ledger.issue("later", 4096);
  expect(ledger.bytes()).toBe(4096);
  expect(await ledger.run(first, execute)).toEqual({ status: "unknown" });
  expect(await ledger.run({ ...first, sequence: 999 }, execute)).toEqual({
    status: "unknown",
  });
  expect(await ledger.run({ ...first, session: "foreign" }, execute)).toEqual({
    status: "unknown",
  });
  expect(calls).toBe(1);
});

test("uncertain execution never becomes rejected or executes again after receipt eviction", async () => {
  const ledger = createDirectoryAcceptanceLedger();
  expect(ledger.issue("too-small", 511)).toBeUndefined();
  const op = ledger.issue("candidate", 512)!;
  let mutations = 0;
  const execute = async () => {
    await Promise.resolve();
    mutations++;
    throw Error("after mutation");
  };
  expect(await ledger.run(op, execute)).toEqual({ status: "unknown" });
  expect(await ledger.run(op, execute)).toEqual({ status: "unknown" });
  ledger.clear();
  const next = ledger.issue("new", 512)!;
  expect(next.sequence).toBeGreaterThan(op.sequence);
  expect(await ledger.run(op, execute)).toEqual({ status: "unknown" });
  expect(mutations).toBe(1);
});
