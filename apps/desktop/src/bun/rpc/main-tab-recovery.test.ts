import { expect, test } from "bun:test";

import { PACKAGED_VIEW_URL } from "../../security/shell-policy";
import type { DocumentSnapshot } from "../../shared/documents";
import {
  validMainTabRecoveryResponse,
  validMainTabRecoveryRequest,
} from "../../shared/main-tab-recovery";
import { analyzeTextFidelity } from "../../shared/text-fidelity";
import type { SingleMainTabRecoveryResult } from "../session/main-tab-single-recovery";

import { createMainTabRecoveryRPC } from "./main-tab-recovery";

const open = () => ({
  protocolVersion: 1 as const,
  requestId: crypto.randomUUID(),
  op: "open" as const,
  root: crypto.randomUUID(),
  generation: 1,
  expectedRootId: crypto.randomUUID(),
});
const finish = (id: string, adopted: boolean) => ({
  protocolVersion: 1 as const,
  requestId: id,
  op: "finish" as const,
  adopted,
});
const ready = { data: { detail: PACKAGED_VIEW_URL } };
function fixture(
  prepareClaim?: Parameters<typeof createMainTabRecoveryRPC>[3],
  viewport?: { from: number; offset: number; ratio: number }
) {
  let resolve!: (value: SingleMainTabRecoveryResult) => void;
  let current = () => true,
    released = 0,
    reads = 0;
  const snapshot: DocumentSnapshot = {
    handle: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    revision: 1,
    hash: "a".repeat(64),
    fileName: "a.md",
    byteLength: 1,
    text: "a",
    fidelity: analyzeTextFidelity("a"),
    writeCapability: { writable: true, reason: "writable" },
    explicitStandalone: false,
  };
  const rpc = createMainTabRecoveryRPC(
    true,
    () => true,
    () => ({
      read(_input, check) {
        reads++;
        current = check;
        return new Promise<SingleMainTabRecoveryResult>((done) => {
          resolve = done;
        });
      },
      close: () => Promise.resolve(),
    }),
    prepareClaim
  );
  const deliver = () =>
    resolve({
      status: "ready",
      ownership: {
        status: "valid",
        data: { tabs: [], activeIndex: null },
        current: () => true,
      },
      snapshot,
      ...(viewport ? { viewport } : {}),
      mode: "source",
      pinned: true,
      current: () => current(),
      release: () => {
        released++;
        return Promise.resolve("released");
      },
    });
  return {
    rpc,
    deliver,
    get reads() {
      return reads;
    },
    get released() {
      return released;
    },
    current: () => current(),
  };
}

test("strict recovery protocol and exact main readiness gate opens", async () => {
  const f = fixture(),
    input = open();
  expect(validMainTabRecoveryRequest(input)).toBe(true);
  for (const value of [
    { ...input, path: "/a.md" },
    { ...input, generation: 0 },
    { ...input, root: "path" },
    { ...finish(input.requestId, true), handle: input.root },
  ])
    expect(validMainTabRecoveryRequest(value)).toBe(false);
  expect((await f.rpc.request(input)).status).toBe("rejected");
  f.rpc.ready({ data: { detail: "http://localhost" } });
  expect((await f.rpc.request(input)).status).toBe("rejected");
  expect(f.reads).toBe(0);
  f.rpc.ready(ready);
  const task = f.rpc.request(input);
  f.deliver();
  expect((await task).status).toBe("ready");
  expect((await f.rpc.request(open())).status).toBe("rejected");
  expect((await f.rpc.request(finish(crypto.randomUUID(), false))).status).toBe(
    "rejected"
  );
  expect((await f.rpc.request(finish(input.requestId, true))).status).toBe(
    "finished"
  );
  expect((await f.rpc.request(finish(input.requestId, true))).status).toBe(
    "finished"
  );
  expect((await f.rpc.request(finish(input.requestId, false))).status).toBe(
    "rejected"
  );
  expect(f.released).toBe(0);
  f.rpc.dispose();
});

test("suspended exit preserves a delivered grant until its matching finish", async () => {
  const f = fixture();
  f.rpc.ready(ready);
  const input = open(),
    task = f.rpc.request(input);
  f.deliver();
  await task;
  const resume = f.rpc.suspend();
  expect(f.released).toBe(0);
  expect((await f.rpc.request(finish(input.requestId, true))).status).toBe(
    "finished"
  );
  resume();
  expect(f.released).toBe(0);
  f.rpc.dispose();
});

test("cancel during open settles only its late grant and prevents duplicate cleanup", async () => {
  const f = fixture();
  f.rpc.ready(ready);
  const input = open(),
    task = f.rpc.request(input);
  const finishing = f.rpc.request(finish(input.requestId, false));
  expect(f.current()).toBe(false);
  expect((await f.rpc.request(finish(input.requestId, true))).status).toBe(
    "rejected"
  );
  f.deliver();
  expect((await task).status).toBe("rejected");
  expect((await finishing).status).toBe("finished");
  expect(f.released).toBe(1);
  expect((await f.rpc.request(finish(input.requestId, false))).status).toBe(
    "finished"
  );
  expect(f.released).toBe(1);
  f.rpc.dispose();
});

test("early cancellation tombstone rejects a late open, and real navigation retires unadopted delivery", async () => {
  const f = fixture();
  f.rpc.ready(ready);
  const early = open();
  expect((await f.rpc.request(finish(early.requestId, false))).status).toBe(
    "finished"
  );
  expect((await f.rpc.request(early)).status).toBe("rejected");
  const input = open(),
    task = f.rpc.request(input);
  f.deliver();
  await task;
  f.rpc.navigate();
  await Bun.sleep(0);
  expect(f.released).toBe(1);
  expect((await f.rpc.request(finish(input.requestId, true))).status).toBe(
    "rejected"
  );
  f.rpc.dispose();
});

test("unconfirmed reader cleanup quarantines the slot instead of acknowledging release", async () => {
  let reads = 0;
  const rpc = createMainTabRecoveryRPC(
    true,
    () => true,
    () => ({
      read() {
        reads++;
        return Promise.resolve({ status: "unknown", reason: "release" });
      },
      close: () => Promise.resolve(),
    })
  );
  rpc.ready(ready);
  const input = open();
  expect((await rpc.request(input)).status).toBe("unknown");
  for (const adopted of [false, true, false])
    expect((await rpc.request(finish(input.requestId, adopted))).status).toBe(
      "unknown"
    );
  expect((await rpc.request(open())).status).toBe("rejected");
  expect(reads).toBe(1);
  const resume = rpc.suspend();
  resume();
  expect((await rpc.request(open())).status).toBe("rejected");
  rpc.navigate();
  rpc.ready(ready);
  expect((await rpc.request(open())).status).toBe("unknown");
  expect(reads).toBe(2);
  rpc.dispose();
});

test("bounded page tombstones never evict older cancellations to admit delayed opens", async () => {
  const f = fixture();
  f.rpc.ready(ready);
  const inputs = Array.from({ length: 128 }, () => open());
  for (const input of inputs)
    expect((await f.rpc.request(finish(input.requestId, false))).status).toBe(
      "finished"
    );
  expect((await f.rpc.request(inputs[0])).status).toBe("rejected");
  expect((await f.rpc.request(inputs[1])).status).toBe("rejected");
  const extra = open();
  expect((await f.rpc.request(finish(extra.requestId, false))).status).toBe(
    "rejected"
  );
  expect((await f.rpc.request(extra)).status).toBe("rejected");
  expect(f.reads).toBe(0);
  f.rpc.dispose();
});

test("adopted grant is never released while claim waits or fails across navigation", async () => {
  let finishClaim!: (value: boolean) => void;
  let current = () => false,
    claims = 0;
  const f = fixture(() => (_receipt, check) => {
    claims++;
    current = check;
    return new Promise<boolean>((resolve) => {
      finishClaim = resolve;
    });
  });
  f.rpc.ready(ready);
  const input = open(),
    opening = f.rpc.request(input);
  f.deliver();
  await opening;
  let acknowledged = false;
  const finishTask = f.rpc
    .request(finish(input.requestId, true))
    .then((value) => {
      acknowledged = true;
      return value;
    });
  expect(claims).toBe(1);
  expect(current()).toBe(true);
  expect(acknowledged).toBe(false);
  f.rpc.navigate();
  expect(current()).toBe(false);
  expect(f.released).toBe(0);
  finishClaim(false);
  expect((await finishTask).status).toBe("finished");
  expect(f.released).toBe(0);
  f.rpc.dispose();
});

test("adoption passes only actual delivered snapshot identities to private position claim", async () => {
  let identities: unknown;
  const f = fixture(() => (_receipt, current, sources) => {
    identities = sources;
    return Promise.resolve(current());
  });
  f.rpc.ready(ready);
  const input = open(),
    opening = f.rpc.request(input);
  f.deliver();
  const delivered = await opening;
  if (delivered.status !== "ready") throw Error("No snapshot");
  expect(identities).toBeUndefined();
  expect((await f.rpc.request(finish(input.requestId, true))).status).toBe(
    "finished"
  );
  const { handle, documentId, revision, hash } = delivered.snapshot;
  expect(identities).toEqual([
    { handle, documentId, revision, hash, pinned: true, mode: "source" },
  ]);
  expect(f.released).toBe(0);
  f.rpc.dispose();
});

test("single recovery transport preserves optional geometry and validates its exact shape", async () => {
  const viewport = { from: 3, offset: -4.25, ratio: 0.7 };
  const f = fixture(undefined, viewport);
  f.rpc.ready(ready);
  const input = open(),
    opening = f.rpc.request(input);
  f.deliver();
  const result = await opening;
  expect(validMainTabRecoveryResponse(result, input.requestId)).toBe(true);
  if (result.status !== "ready") throw Error("No snapshot");
  expect(result.viewport).toEqual(viewport);
  for (const value of [
    undefined,
    { ...viewport, hash: "a".repeat(64) },
    { ...viewport, from: -1 },
    { ...viewport, offset: Infinity },
    { ...viewport, ratio: 2 },
  ])
    expect(
      validMainTabRecoveryResponse(
        { ...result, viewport: value },
        input.requestId
      )
    ).toBe(false);
  expect(
    validMainTabRecoveryResponse(
      { ...result, status: "group-item", index: 0 },
      input.requestId
    )
  ).toBe(true);
  await f.rpc.request(finish(input.requestId, false));
  f.rpc.dispose();
});
