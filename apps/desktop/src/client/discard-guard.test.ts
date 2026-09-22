import { expect, test } from "bun:test";

import { createDiscardGuard } from "./discard-guard";
const request = () => ({
  protocolVersion: 1 as const,
  requestId: crypto.randomUUID(),
  reason: "quit" as const,
});
test("uninitialized guard refuses; release-before-prepare refuses", async () => {
  const guard = createDiscardGuard();
  for (const malformed of [null, { protocolVersion: 1 }]) {
    const error: unknown = await guard
      .request(malformed)
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
  }
  const req = request();
  expect((await guard.request(req)).allow).toBe(false);
  let frozen = false;
  guard.register({
    beginDiscard: () => {
      frozen = true;
      return true;
    },
    endDiscard: () => {
      frozen = false;
    },
    hasDirty: () => false,
  });
  guard.release(req.requestId);
  expect((await guard.request(req)).allow).toBe(false);
  expect(frozen).toBe(false);
});
test("cancel and timeout retain data and unlock; allow stays frozen until matching release", async () => {
  const guard = createDiscardGuard();
  let frozen = false;
  guard.register({
    beginDiscard: () => {
      if (frozen) return false;
      frozen = true;
      return true;
    },
    endDiscard: () => {
      frozen = false;
    },
    hasDirty: () => true,
  });
  const first = request();
  const waiting = guard.request(first);
  expect(guard.request(first)).toBe(waiting);
  expect((await guard.request(request())).allow).toBe(false);
  guard.respond(false);
  expect((await waiting).allow).toBe(false);
  expect(frozen).toBe(false);
  const second = request();
  const timeout = guard.request(second);
  guard.release(second.requestId);
  guard.respond(true);
  expect((await timeout).allow).toBe(false);
  expect(frozen).toBe(false);
  const third = request();
  const allowed = guard.request(third);
  guard.respond(true);
  expect((await allowed).allow).toBe(true);
  expect(frozen).toBe(true);
  guard.release(crypto.randomUUID());
  expect(frozen).toBe(true);
  guard.release(third.requestId);
  expect(frozen).toBe(false);
});

test("reload commits only approved matching request; late commits cannot discard new edits", async () => {
  const guard = createDiscardGuard();
  let frozen = false,
    reloads = 0;
  guard.register({
    beginDiscard: () => {
      if (frozen) return false;
      frozen = true;
      return true;
    },
    endDiscard: () => {
      frozen = false;
    },
    hasDirty: () => true,
  });
  const req = { ...request(), reason: "reload" as const };
  const commit = { protocolVersion: 1 as const, requestId: req.requestId };
  expect(() => guard.commitReload(null, () => reloads++)).toThrow();
  expect(guard.commitReload(commit, () => reloads++).committed).toBe(false);
  const waiting = guard.request(req);
  expect(guard.commitReload(commit, () => reloads++).committed).toBe(false);
  guard.respond(true);
  await waiting;
  guard.release(req.requestId);
  expect(frozen).toBe(false);
  expect(guard.commitReload(commit, () => reloads++).committed).toBe(false);
  expect(reloads).toBe(0);
  const next = { ...request(), reason: "reload" as const };
  const approved = guard.request(next);
  guard.respond(true);
  await approved;
  const valid = { protocolVersion: 1 as const, requestId: next.requestId };
  expect(guard.commitReload(valid, () => reloads++).committed).toBe(true);
  expect(reloads).toBe(1);
  expect(guard.commitReload(valid, () => reloads++).committed).toBe(false);
  guard.release(next.requestId);
  expect(frozen).toBe(true); // Navigation already invoked: never unlock late.
});

test("throwing reload safely unlocks; a quit approval cannot authorize reload", async () => {
  const guard = createDiscardGuard();
  let frozen = false;
  guard.register({
    beginDiscard: () => {
      if (frozen) return false;
      frozen = true;
      return true;
    },
    endDiscard: () => {
      frozen = false;
    },
    hasDirty: () => false,
  });
  const quit = request();
  await guard.request(quit);
  expect(
    guard.commitReload(
      { protocolVersion: 1, requestId: quit.requestId },
      () => {
        throw Error("must not execute");
      }
    ).committed
  ).toBe(false);
  guard.release(quit.requestId);
  const reload = { ...request(), reason: "reload" as const };
  await guard.request(reload);
  expect(
    guard.commitReload(
      { protocolVersion: 1, requestId: reload.requestId },
      () => {
        throw Error("navigation failed");
      }
    ).committed
  ).toBe(false);
  expect(frozen).toBe(false);
});
