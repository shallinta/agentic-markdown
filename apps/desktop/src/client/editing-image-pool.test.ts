import { expect, test } from "bun:test";

import type { LocalImageRequest } from "../shared/local-images";

import { createEditingImagePool } from "./editing-image-pool";
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
test("invalidate rejects synchronous acquire reentry rather than orphaning a lease", async () => {
  const { pool, finish } = fixture();
  let reentry: ReturnType<typeof pool.acquire> | undefined;
  const lease = pool.acquire("a.png", () => {
    if (lease.getSnapshot().status === "released")
      reentry = pool.acquire("a.png", () => undefined);
  })!;
  finish(0);
  await flush();
  pool.invalidate();
  expect(reentry).toBeNull();
  expect(pool.diagnostics().entries).toBe(0);
  expect(pool.acquire("a.png", () => undefined)).not.toBeNull();
  pool.dispose();
});
test("throwing synchronous revocation still clears accounting and invalidation guard", async () => {
  for (const action of ["release", "invalidate"]) {
    const { pool, finish } = fixture();
    const lease = pool.acquire("a.png", () => {
      if (lease.getSnapshot().status === "released") throw Error("consumer");
    })!;
    finish(0);
    await flush();
    expect(() =>
      action === "release" ? lease.release() : pool.invalidate()
    ).toThrow("consumer");
    expect(pool.diagnostics().retained).toBe(0);
    expect(pool.diagnostics().presentation).toBe(0);
    expect(pool.acquire("b.png", () => undefined)).not.toBeNull();
    pool.dispose();
  }
});
function fixture() {
  const calls: {
    request: LocalImageRequest;
    resolve: (value: unknown) => void;
  }[] = [];
  const pool = createEditingImagePool(
    "00000000-0000-0000-0000-000000000000",
    (request) => new Promise((resolve) => calls.push({ request, resolve }))
  );
  const finish = (index: number, width = 1, height = 1) =>
    calls[index].resolve({
      protocolVersion: 1,
      requestId: calls[index].request.requestId,
      ok: true,
      mime: "image/png",
      data: "AAAA",
      width,
      height,
      identity: "a".repeat(64),
    });
  return { pool, calls, finish };
}
test("300 cumulative references release all resource accounting", async () => {
  const { pool, calls, finish } = fixture();
  for (let i = 0; i < 300; i++) {
    const lease = pool.acquire(`${i}.png`, () => undefined)!;
    finish(i);
    await flush();
    expect(lease.getSnapshot().status).toBe("ready");
    lease.release();
    lease.release();
  }
  expect(calls).toHaveLength(300);
  expect(pool.diagnostics()).toEqual({
    entries: 0,
    retained: 0,
    presentation: 0,
    inflight: 0,
    running: false,
  });
});
test("shared reference preserves original transport spelling and charges each widget", async () => {
  const { pool, calls, finish } = fixture();
  const a = pool.acquire("a%2520.png", () => undefined)!,
    b = pool.acquire("a%2520.png", () => undefined)!;
  expect(calls[0].request.reference).toBe("a%2520.png");
  finish(0, 10, 10);
  await flush();
  expect(pool.diagnostics().presentation).toBe(800);
  a.release();
  expect(pool.diagnostics().presentation).toBe(400);
  b.release();
  expect(pool.diagnostics().retained).toBe(0);
});
test("encoded slash aliases share key without a second decode", async () => {
  const { pool, calls, finish } = fixture();
  pool.acquire("dir%2Fa%2525.png", () => undefined);
  pool.acquire("dir/a%2525.png", () => undefined);
  expect(calls).toHaveLength(1);
  expect(calls[0].request.reference).toBe("dir%2Fa%2525.png");
  finish(0);
  await flush();
  expect(pool.acquire("a%3Fb.png", () => undefined)).toBeNull();
});
test("queued release and running ABA retain transport slot until finally", async () => {
  const { pool, calls, finish } = fixture();
  const a = pool.acquire("a.png", () => undefined)!,
    b = pool.acquire("b.png", () => undefined)!;
  b.release();
  a.release();
  const replacement = pool.acquire("a.png", () => undefined)!;
  expect(calls).toHaveLength(1);
  finish(0);
  await flush();
  expect(calls).toHaveLength(2);
  expect(calls[1].request.reference).toBe("a.png");
  finish(1);
  await flush();
  expect(replacement.getSnapshot().status).toBe("ready");
});
test("epoch and dispose keep old in-flight accounting and synchronously revoke display", async () => {
  const { pool, calls, finish } = fixture();
  let revoked = false;
  const a = pool.acquire("a.png", () => {
    if (a.getSnapshot().status === "released") {
      revoked = true;
      expect(pool.diagnostics().presentation).toBe(4);
    }
  })!;
  finish(0);
  await flush();
  pool.invalidate();
  expect(revoked).toBe(true);
  pool.acquire("a.png", () => undefined);
  pool.dispose();
  pool.dispose();
  expect(pool.diagnostics().inflight).toBeGreaterThan(0);
  finish(1);
  await flush();
  expect(pool.diagnostics().inflight).toBe(0);
  expect(calls).toHaveLength(2);
});
test("budget retry only follows real capacity release; new lease inherits blocked status", async () => {
  const { pool, calls, finish } = fixture();
  const a = pool.acquire("a.png", () => undefined)!;
  finish(0, 1500, 1500);
  await flush();
  pool.acquire("b.png", () => undefined);
  finish(1, 1500, 1500);
  await flush();
  const duplicate = pool.acquire("a.png", () => undefined)!,
    blocked = pool.acquire("b.png", () => undefined)!;
  expect(blocked.getSnapshot().status).toBe("budget");
  duplicate.release();
  expect(calls).toHaveLength(2);
  a.release();
  await flush();
  expect(calls).toHaveLength(3);
  finish(2, 1500, 1500);
  await flush();
  expect(blocked.getSnapshot().status).toBe("budget");
});
test("synchronous transport failures drain without recursion or retry loops", async () => {
  let firstResolve: (value: unknown) => void = () => undefined,
    calls = 0;
  const pool = createEditingImagePool(
    "00000000-0000-0000-0000-000000000000",
    () => {
      calls++;
      if (calls === 1)
        return new Promise((resolve) => {
          firstResolve = resolve;
        });
      throw Error("sync");
    }
  );
  for (let i = 0; i < 4000; i++) pool.acquire(`${i}.png`, () => undefined);
  firstResolve(null);
  for (let i = 0; i < 5000; i++) await Promise.resolve();
  expect(calls).toBe(4000);
  expect(pool.scheduling()).toEqual({
    dequeued: 4000,
    waiting: 0,
    capacityVisited: 0,
  });
  expect(pool.diagnostics().running).toBe(false);
  pool.acquire("1.png", () => undefined);
  expect(calls).toBe(4000);
  pool.dispose();
});
