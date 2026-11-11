import { expect, test } from "bun:test";

import { PACKAGED_VIEW_URL } from "../../security/shell-policy";
import {
  validMainTabRecoveryRequest,
  validMainTabRecoveryResponse,
} from "../../shared/main-tab-recovery";
import { analyzeTextFidelity } from "../../shared/text-fidelity";
import { WORKSPACE_MAX_ROOTS } from "../../shared/workspace";
import type { MainTabGroupRecoveryResult } from "../session/main-tab-group-recovery";
import type { SingleMainTabRecoveryResult } from "../session/main-tab-single-recovery";

import { createMainTabRecoveryRPC } from "./main-tab-recovery";

function fixture(
  single: SingleMainTabRecoveryResult = {
    status: "rejected",
    reason: "unavailable",
  },
  count = 2
) {
  let groupResult: MainTabGroupRecoveryResult | undefined;
  let multiReads = 0,
    singleReads = 0;
  let released = 0,
    reads = 0,
    verified = 0,
    claimed = 0;
  let verify: () => Promise<boolean> = () => Promise.resolve(true);
  const pair: Extract<MainTabGroupRecoveryResult, { status: "ready" }> = {
    status: "ready",
    activeIndex: 1,
    tabs: Array.from({ length: count }, (_, index) => ({
      snapshot: {
        handle: crypto.randomUUID(),
        documentId: crypto.randomUUID(),
        revision: 1,
        hash: "a".repeat(64),
        fileName: `${index}.md`,
        byteLength: 1,
        text: "a",
        fidelity: analyzeTextFidelity("a"),
        writeCapability: { writable: true, reason: "writable" },
        explicitStandalone: false,
      },
      mode: index === 0 ? "source" : "editing",
      pinned: index === 0,
    })),
    ownership: {
      status: "valid",
      data: { tabs: [], activeIndex: null },
      current: () => true,
    },
    current: () => true,
    revalidate: () => {
      verified++;
      return verify();
    },
    release: () => {
      released++;
      return Promise.resolve("released");
    },
  };
  const rpc = createMainTabRecoveryRPC(
    true,
    () => true,
    () => ({
      read: () => {
        singleReads++;
        return Promise.resolve(single);
      },
      close: () => Promise.resolve(),
    }),
    () => () => {
      claimed++;
      return Promise.resolve(true);
    },
    () => ({
      read: () => {
        reads++;
        return Promise.resolve(groupResult ?? pair);
      },
      close: () => Promise.resolve(),
    }),
    () => ({
      read: () => {
        multiReads++;
        return Promise.resolve(pair);
      },
      close: () => Promise.resolve(),
    })
  );
  rpc.ready({ data: { detail: PACKAGED_VIEW_URL } });
  const input = {
    protocolVersion: 1 as const,
    requestId: crypto.randomUUID(),
    op: "open" as const,
    root: crypto.randomUUID(),
    generation: 1,
    expectedRootId: crypto.randomUUID(),
  };
  const item = (index: number) => ({
    protocolVersion: 1 as const,
    requestId: input.requestId,
    op: "group-item" as const,
    index,
  });
  const finish = (adopted: boolean) => ({
    protocolVersion: 1 as const,
    requestId: input.requestId,
    op: "finish" as const,
    adopted,
  });
  return {
    setGroupResult(value: MainTabGroupRecoveryResult) {
      groupResult = value;
    },
    routing: () => ({ singleReads, multiReads }),
    rpc,
    input,
    item,
    finish,
    pair,
    setVerify(fn: () => Promise<boolean>) {
      verify = fn;
    },
    counts: () => ({ released, reads, verified, claimed }),
  };
}

test("pair protocol delivers only index metadata then each single snapshot in order", async () => {
  const f = fixture();
  expect(await f.rpc.request(f.input)).toEqual({
    protocolVersion: 1,
    requestId: f.input.requestId,
    status: "group",
    count: 2,
    activeIndex: 1,
  });
  expect((await f.rpc.request(f.item(1))).status).toBe("rejected");
  expect((await f.rpc.request(f.finish(true))).status).toBe("rejected");
  const first = await f.rpc.request(f.item(0));
  expect(validMainTabRecoveryResponse(first, f.input.requestId)).toBe(true);
  expect(first).toEqual({
    protocolVersion: 1,
    requestId: f.input.requestId,
    status: "group-item",
    index: 0,
    ...f.pair.tabs[0],
  });
  expect((await f.rpc.request(f.item(0))).status).toBe("rejected");
  const second = await f.rpc.request(f.item(1));
  expect(validMainTabRecoveryResponse(second, f.input.requestId)).toBe(true);
  expect((await f.rpc.request(f.finish(true))).status).toBe("finished");
  expect(f.counts()).toEqual({
    released: 0,
    reads: 1,
    verified: 1,
    claimed: 1,
  });
  f.rpc.dispose();
});

test("pair finish false during second revalidation suppresses late item and releases once", async () => {
  const f = fixture();
  await f.rpc.request(f.input);
  await f.rpc.request(f.item(0));
  let resolve!: (value: boolean) => void;
  f.setVerify(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const second = f.rpc.request(f.item(1));
  expect((await f.rpc.request(f.item(1))).status).toBe("rejected");
  expect((await f.rpc.request(f.finish(true))).status).toBe("rejected");
  expect((await f.rpc.request(f.finish(false))).status).toBe("finished");
  resolve(true);
  expect((await second).status).toBe("rejected");
  expect(f.counts().released).toBe(1);
  expect(f.counts().claimed).toBe(0);
  f.rpc.dispose();
});

test("invalidated second item rejects both without grant handoff", async () => {
  const f = fixture();
  await f.rpc.request(f.input);
  await f.rpc.request(f.item(0));
  f.setVerify(() => Promise.resolve(false));
  expect((await f.rpc.request(f.item(1))).status).toBe("rejected");
  expect(f.counts().released).toBe(1);
  expect((await f.rpc.request(f.finish(true))).status).toBe("rejected");
  f.rpc.dispose();
});

test("only trusted unavailable falls back and protocol rejects extra data or indices", async () => {
  for (const single of [
    { status: "rejected", reason: "busy" },
    { status: "rejected", reason: "stale" },
    { status: "unknown", reason: "release" },
  ] as const) {
    const f = fixture(single);
    await f.rpc.request(f.input);
    expect(f.counts().reads).toBe(0);
    f.rpc.dispose();
  }
  const f = fixture();
  expect(validMainTabRecoveryRequest(f.item(0))).toBe(true);
  expect(validMainTabRecoveryRequest({ ...f.item(0), index: 64 })).toBe(false);
  expect(validMainTabRecoveryRequest({ ...f.item(0), text: "body" })).toBe(
    false
  );
  expect(
    validMainTabRecoveryResponse(
      {
        protocolVersion: 1,
        requestId: f.input.requestId,
        status: "group",
        count: 2,
        activeIndex: 2,
      },
      f.input.requestId
    )
  ).toBe(false);
  f.rpc.dispose();
});

test("pair cleanup unknown keeps the slot quarantined for matching finish", async () => {
  const f = fixture();
  f.pair.release = () => Promise.resolve("unknown");
  await f.rpc.request(f.input);
  await f.rpc.request(f.item(0));
  f.setVerify(() => Promise.resolve(false));
  expect((await f.rpc.request(f.item(1))).status).toBe("unknown");
  expect((await f.rpc.request(f.finish(false))).status).toBe("unknown");
  expect(
    (await f.rpc.request({ ...f.input, requestId: crypto.randomUUID() })).status
  ).toBe("rejected");
  expect((await f.rpc.request(f.finish(true))).status).toBe("rejected");
  f.rpc.dispose();
});

test("pair proof invalidated in the revalidate continuation cannot publish a snapshot", async () => {
  const f = fixture();
  let current = true;
  f.pair.current = () => current;
  await f.rpc.request(f.input);
  await f.rpc.request(f.item(0));
  f.setVerify(() => {
    queueMicrotask(() => {
      current = false;
    });
    return Promise.resolve(true);
  });
  const result = await f.rpc.request(f.item(1));
  expect(result).toEqual({
    protocolVersion: 1,
    requestId: f.input.requestId,
    status: "rejected",
  });
  expect("snapshot" in result).toBe(false);
  expect(f.counts().released).toBe(1);
  expect(f.counts().claimed).toBe(0);
  f.rpc.dispose();
});

test("group delivers 5 and 64 entries sequentially, verifies only the last, and rejects excess items", async () => {
  for (const count of [5, 64]) {
    const f = fixture(undefined, count);
    const opened = await f.rpc.request(f.input);
    expect(opened).toEqual({
      protocolVersion: 1,
      requestId: f.input.requestId,
      status: "group",
      count,
      activeIndex: 1,
    });
    expect(validMainTabRecoveryResponse(opened, f.input.requestId)).toBe(true);
    for (let index = 0; index < count; index++) {
      expect((await f.rpc.request(f.item(index + 1))).status).toBe("rejected");
      const delivered = await f.rpc.request(f.item(index));
      expect(delivered).toEqual({
        protocolVersion: 1,
        requestId: f.input.requestId,
        status: "group-item",
        index,
        ...f.pair.tabs[index],
      });
      expect(validMainTabRecoveryResponse(delivered, f.input.requestId)).toBe(
        true
      );
      expect(f.counts().verified).toBe(index === count - 1 ? 1 : 0);
      if (index < count - 1)
        expect((await f.rpc.request(f.finish(true))).status).toBe("rejected");
    }
    expect((await f.rpc.request(f.item(count))).status).toBe("rejected");
    expect((await f.rpc.request(f.finish(true))).status).toBe("finished");
    expect(f.counts()).toEqual({
      released: 0,
      reads: 1,
      verified: 1,
      claimed: 1,
    });
    f.rpc.dispose();
  }
});

test("group protocol rejects former pair spelling and invalid group counts or indices", () => {
  const f = fixture();
  expect(validMainTabRecoveryRequest({ ...f.item(0), op: "pair-item" })).toBe(
    false
  );
  for (const index of [-1, 0.5, 64, NaN])
    expect(validMainTabRecoveryRequest(f.item(index))).toBe(false);
  for (const count of [0, 1, 65, NaN])
    expect(
      validMainTabRecoveryResponse(
        {
          protocolVersion: 1,
          requestId: f.input.requestId,
          status: "group",
          count,
          activeIndex: 0,
        },
        f.input.requestId
      )
    ).toBe(false);
  f.rpc.dispose();
});

function multiRequest(requestId: string) {
  return {
    protocolVersion: 1 as const,
    requestId,
    op: "open-multi" as const,
    roots: Array.from({ length: 2 }, () => ({
      root: crypto.randomUUID(),
      generation: 1,
      expectedRootId: crypto.randomUUID(),
    })),
  };
}

test("multi-root RPC uses only its trusted reader and the shared delivery and finish slot", async () => {
  const f = fixture();
  const input = multiRequest(f.input.requestId);
  expect(validMainTabRecoveryRequest(input)).toBe(true);
  expect((await f.rpc.request(input)).status).toBe("group");
  expect(f.routing()).toEqual({ singleReads: 0, multiReads: 1 });
  expect(f.counts().reads).toBe(0);
  expect(
    (await f.rpc.request({ ...f.input, requestId: crypto.randomUUID() })).status
  ).toBe("rejected");
  expect((await f.rpc.request(f.item(0))).status).toBe("group-item");
  expect((await f.rpc.request(f.item(1))).status).toBe("group-item");
  expect((await f.rpc.request(f.finish(true))).status).toBe("finished");
  expect(f.counts().claimed).toBe(1);
  expect(f.counts().released).toBe(0);
  f.rpc.dispose();
});

test("multi-root request validates exact bounded roots, both identity sets and sparse arrays", () => {
  const value = multiRequest(crypto.randomUUID());
  const invalid = [
    { ...value, root: value.roots[0].root },
    { ...value, roots: [value.roots[0]] },
    { ...value, roots: [value.roots[0], value.roots[0]] },
    {
      ...value,
      roots: [
        value.roots[0],
        { ...value.roots[1], expectedRootId: value.roots[0].expectedRootId },
      ],
    },
    { ...value, roots: [value.roots[0], { ...value.roots[1], generation: 0 }] },
    {
      ...value,
      roots: [value.roots[0], { ...value.roots[1], path: "/not-authority" }],
    },
    { ...value, roots: new Array(2) },
    {
      ...value,
      roots: Array.from({ length: WORKSPACE_MAX_ROOTS + 1 }, () => ({
        root: crypto.randomUUID(),
        generation: 1,
        expectedRootId: crypto.randomUUID(),
      })),
    },
  ];
  for (const input of invalid)
    expect(validMainTabRecoveryRequest(input)).toBe(false);
  expect(
    validMainTabRecoveryRequest({
      ...value,
      roots: Array.from({ length: WORKSPACE_MAX_ROOTS }, () => ({
        root: crypto.randomUUID(),
        generation: 1,
        expectedRootId: crypto.randomUUID(),
      })),
    })
  ).toBe(true);
});

test("multi-root lifecycle cannot bypass readiness or pause and navigation releases partial delivery", async () => {
  const f = fixture();
  const input = multiRequest(f.input.requestId);
  const resume = f.rpc.suspend();
  expect((await f.rpc.request(input)).status).toBe("rejected");
  expect(f.routing().multiReads).toBe(0);
  resume();
  expect((await f.rpc.request(input)).status).toBe("group");
  await f.rpc.request(f.item(0));
  f.rpc.navigate();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.counts().released).toBe(1);
  expect((await f.rpc.request(f.item(1))).status).toBe("rejected");
  expect(
    (await f.rpc.request({ ...input, requestId: crypto.randomUUID() })).status
  ).toBe("rejected");
  f.rpc.dispose();
});

test("clean single-root rejection acknowledges cancellation before multi-root admission", async () => {
  const f = fixture();
  f.setGroupResult({ status: "rejected", reason: "unavailable" });
  expect((await f.rpc.request(f.input)).status).toBe("rejected");
  expect((await f.rpc.request(f.finish(false))).status).toBe("finished");
  const multi = multiRequest(crypto.randomUUID());
  expect((await f.rpc.request(multi)).status).toBe("group");
  // Late completion for the old clean request must not touch this new slot.
  expect((await f.rpc.request(f.finish(false))).status).toBe("finished");
  expect((await f.rpc.request(f.finish(true))).status).toBe("rejected");
  expect(
    (await f.rpc.request({ ...f.item(0), requestId: multi.requestId })).status
  ).toBe("group-item");
  expect(f.counts().released).toBe(0);
  expect(
    (await f.rpc.request({ ...f.finish(false), requestId: multi.requestId }))
      .status
  ).toBe("finished");
  expect(f.counts().released).toBe(1);
  expect((await f.rpc.request(f.finish(false))).status).toBe("finished");
  f.rpc.dispose();
});

test("late stale group item preserves a clean cancellation acknowledgement across new requests", async () => {
  const f = fixture();
  await f.rpc.request(f.input);
  await f.rpc.request(f.item(0));
  f.setVerify(() => Promise.resolve(false));
  expect((await f.rpc.request(f.item(1))).status).toBe("rejected");
  expect(f.counts().released).toBe(1);
  expect((await f.rpc.request(f.finish(false))).status).toBe("finished");
  const multi = multiRequest(crypto.randomUUID());
  expect((await f.rpc.request(multi)).status).toBe("group");
  expect((await f.rpc.request(f.finish(false))).status).toBe("finished");
  expect(
    (await f.rpc.request({ ...f.item(0), requestId: multi.requestId })).status
  ).toBe("group-item");
  f.rpc.dispose();
});
