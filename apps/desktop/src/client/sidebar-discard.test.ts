import { expect, test } from "bun:test";

import { createDiscardGuard } from "./discard-guard";
import { canonicalDiscardParticipant } from "./document-canonical";

test("the sole discard participant drains renderer layout before reload approval and keeps failure recovery", async () => {
  let finish!: () => void;
  let frozen = false,
    failures = 0,
    cancelled = 0;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let flush = () => gate;
  const guard = createDiscardGuard();
  guard.register(
    canonicalDiscardParticipant(
      {
        beginDiscard: () => {
          frozen = true;
          return true;
        },
        endDiscard: () => {
          frozen = false;
        },
        hasDirty: () => false,
        waitForSaves: () => Promise.resolve(),
        reportDiscardFailure: () => {
          failures++;
        },
      },
      {
        cancel: () => {
          cancelled++;
        },
      },
      () => flush()
    )
  );
  const pending = guard.request({
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    reason: "reload",
  });
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await Bun.sleep(0);
  expect(frozen).toBe(true);
  expect(settled).toBe(false);
  expect(cancelled).toBe(1);
  finish();
  const result = await pending;
  expect(result.allow).toBe(true);
  guard.release(result.requestId);
  flush = () => Promise.reject(Error("layout failed"));
  const rejected = await guard.request({
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    reason: "quit",
  });
  expect(rejected.allow).toBe(false);
  expect(failures).toBe(1);
  expect(frozen).toBe(false);
});
