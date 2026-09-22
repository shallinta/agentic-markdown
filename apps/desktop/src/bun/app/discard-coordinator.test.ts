import { expect, test } from "bun:test";

import {
  isDiscardRequest,
  isDiscardResponse,
  isReloadCommitResponse,
  type DiscardRequest,
} from "../../shared/discard";

import { createDiscardCoordinator } from "./discard-coordinator";
import { createLifecycleGuard } from "./lifecycle-guard";

test("strict versioned discard protocol rejects forged responses", () => {
  const request = {
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    reason: "quit",
  };
  expect(isDiscardRequest(request)).toBe(true);
  expect(isDiscardRequest({ ...request, extra: true })).toBe(false);
  expect(isDiscardRequest({ ...request, reason: "save" })).toBe(false);
  expect(
    isDiscardResponse(
      { protocolVersion: 1, requestId: request.requestId, allow: true },
      request.requestId
    )
  ).toBe(true);
  expect(
    isDiscardResponse(
      { protocolVersion: 1, requestId: crypto.randomUUID(), allow: true },
      request.requestId
    )
  ).toBe(false);
});
test("quit and window-close synchronously veto; cancellation never cleans up", async () => {
  let stops = 0,
    quits = 0,
    releases = 0;
  const guard = createDiscardCoordinator({
    prepare: (request) =>
      Promise.resolve({
        protocolVersion: 1,
        requestId: request.requestId,
        allow: false,
      }),
    release: () => {
      releases++;
    },
  });
  const lifecycle = createLifecycleGuard({
    guard,
    stop: () => {
      stops++;
      return Promise.resolve();
    },
    quit: () => {
      quits++;
    },
    reload: () => Promise.resolve(false),
    update: () => Promise.resolve(false),
    beforeUpdate: () => Promise.resolve(),
  });
  const event: { response?: { allow: boolean } } = {};
  lifecycle.beforeClose(event);
  expect(event.response).toEqual({ allow: false });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(stops).toBe(0);
  expect(quits).toBe(0);
  expect(releases).toBe(1);
});
test("deduplicates mixed requests and ignores late approval after timeout; retry works", async () => {
  let late: ((value: unknown) => void) | undefined;
  let first: DiscardRequest | undefined;
  let executions = 0;
  const released: string[] = [];
  const guard = createDiscardCoordinator({
    timeoutMs: 5,
    prepare: (request) => {
      first = request;
      return new Promise((resolve) => {
        late = resolve;
      });
    },
    release: (id) => released.push(id),
  });
  const run = guard("quit", () => {
    executions++;
    return true;
  });
  expect(
    await guard("reload", () => {
      executions++;
      return true;
    })
  ).toBe(false);
  expect(await run).toBe(false);
  late?.({ protocolVersion: 1, requestId: first!.requestId, allow: true });
  await Promise.resolve();
  expect(executions).toBe(0);
  expect(released).toHaveLength(1);
  const retry = guard("update", () => {
    executions++;
    return true;
  });
  late?.({ protocolVersion: 1, requestId: first!.requestId, allow: true });
  expect(await retry).toBe(true);
  expect(executions).toBe(1);
  expect(released).toHaveLength(1);
});
test("approval precedes cleanup; cleanup error refuses quit and releases; update no-op releases", async () => {
  let stopFails = true,
    stops = 0,
    quits = 0,
    releaseCount = 0;
  const guard = createDiscardCoordinator({
    prepare: (r) =>
      Promise.resolve({
        protocolVersion: 1,
        requestId: r.requestId,
        allow: true,
      }),
    release: () => {
      releaseCount++;
    },
  });
  const lifecycle = createLifecycleGuard({
    guard,
    stop: () => {
      stops++;
      if (stopFails) throw Error("stop");
      return Promise.resolve();
    },
    quit: () => {
      quits++;
    },
    reload: () => Promise.resolve(false),
    update: () => Promise.resolve(false),
    beforeUpdate: () => Promise.resolve(),
  });
  lifecycle.beforeQuit({});
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(stops).toBe(1);
  expect(quits).toBe(0);
  expect(releaseCount).toBe(1);
  expect(await lifecycle.update()).toBe(false);
  expect(releaseCount).toBe(2);
  stopFails = false;
  lifecycle.beforeQuit({});
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(quits).toBe(1);
  const next: { response?: { allow: boolean } } = {};
  lifecycle.beforeQuit(next);
  expect(next.response).toEqual({ allow: false });
});
test("transport rejection and destructive action failure both fail closed and unlock", async () => {
  let releases = 0,
    executions = 0;
  const rejected = createDiscardCoordinator({
    prepare: () => Promise.reject(Error("offline")),
    release: () => {
      releases++;
    },
  });
  expect(
    await rejected("reload", () => {
      executions++;
      return true;
    })
  ).toBe(false);
  const approved = createDiscardCoordinator({
    prepare: (r) =>
      Promise.resolve({
        protocolVersion: 1,
        requestId: r.requestId,
        allow: true,
      }),
    release: () => {
      releases++;
    },
  });
  expect(
    await approved("reload", () => {
      throw Error("failure");
    })
  ).toBe(false);
  expect(executions).toBe(0);
  expect(releases).toBe(2);
});

test("reload propagates approval ID, validates commit result, and unlocks every failed send", async () => {
  let prepared = "",
    executed = "",
    released = "";
  const guard = createDiscardCoordinator({
    prepare: (request) => {
      prepared = request.requestId;
      return Promise.resolve({
        protocolVersion: 1,
        requestId: prepared,
        allow: true,
      });
    },
    release: (id) => {
      released = id;
    },
  });
  for (const reply of [
    null,
    { protocolVersion: 1, requestId: "wrong", committed: true },
    false,
  ]) {
    expect(
      await guard("reload", (id) => {
        executed = id;
        return isReloadCommitResponse(reply, id) && reply.committed;
      })
    ).toBe(false);
    expect(executed).toBe(prepared);
    expect(released).toBe(prepared);
  }
  expect(
    await guard("reload", () => Promise.reject(Error("RPC unavailable")))
  ).toBe(false);
  expect(released).toBe(prepared);
  expect(
    await guard("reload", (id) =>
      isReloadCommitResponse(
        { protocolVersion: 1, requestId: id, committed: true },
        id
      )
    )
  ).toBe(true);
  expect(released).not.toBe(prepared);
});
