import { expect, test } from "bun:test";

import { PACKAGED_VIEW_URL } from "../../security/shell-policy";
import {
  validMainTabCheckpointRequest,
  validMainTabCheckpointResponse,
} from "../../shared/main-tab-checkpoint";

import { createMainTabCheckpointRPC } from "./main-tab-checkpoint";

const request = () => ({
  protocolVersion: 1,
  tabs: [
    {
      handle: crypto.randomUUID(),
      documentId: crypto.randomUUID(),
      revision: 1,
      hash: "a".repeat(64),
      pinned: false,
      mode: "editing",
    },
  ],
  activeIndex: 0,
});
const ready = { data: { detail: PACKAGED_VIEW_URL } };

test("checkpoint protocol is bounded and excludes authority paths, contents and sparse or duplicate rows", () => {
  const input = request();
  expect(validMainTabCheckpointRequest(input)).toBe(true);
  for (const invalid of [
    null,
    [],
    { ...input, text: "body" },
    { ...input, path: "/a.md" },
    { ...input, protocolVersion: 2 },
    { ...input, activeIndex: null },
    { ...input, tabs: [] },
    { ...input, tabs: Array(2) },
    { ...input, tabs: [input.tabs[0], input.tabs[0]] },
    { ...input, tabs: [{ ...input.tabs[0], revision: 1.5 }] },
    { ...input, tabs: [{ ...input.tabs[0], mode: "reading" }] },
    { ...input, tabs: Array.from({ length: 65 }, () => request().tabs[0]) },
  ])
    expect(validMainTabCheckpointRequest(invalid)).toBe(false);
  for (const status of ["committed", "rejected", "unknown"])
    expect(validMainTabCheckpointResponse({ protocolVersion: 1, status })).toBe(
      true
    );
  expect(
    validMainTabCheckpointResponse({
      protocolVersion: 1,
      status: "committed",
      documentId: "leak",
    })
  ).toBe(false);
});

test("only exact ready ordinary packaged main can lazily create checkpoint writer", async () => {
  for (const enabled of [false, true]) {
    let packaged = false,
      created = 0;
    const rpc = createMainTabCheckpointRPC(
      enabled,
      () => packaged,
      () => {
        created++;
        return {
          write: (_input, current) =>
            Promise.resolve(
              current()
                ? { status: "committed" }
                : { status: "rejected", reason: "stale" }
            ),
          clear: () =>
            Promise.resolve({ status: "rejected", reason: "not-owned" }),
          close: () => Promise.resolve(),
        };
      }
    );
    expect((await rpc.request(request())).status).toBe("rejected");
    rpc.ready(ready);
    expect((await rpc.request(request())).status).toBe("rejected");
    packaged = true;
    rpc.ready({ data: { detail: "http://localhost:5173" } });
    expect((await rpc.request(request())).status).toBe("rejected");
    rpc.ready(ready);
    expect((await rpc.request(request())).status).toBe(
      enabled ? "committed" : "rejected"
    );
    expect(created).toBe(enabled ? 1 : 0);
    rpc.dispose();
    expect((await rpc.request(request())).status).toBe("rejected");
  }
});

test("latest valid request and navigation or quit suspension invalidate prior guards permanently", async () => {
  const guards: (() => boolean)[] = [];
  const releases: (() => void)[] = [];
  const rpc = createMainTabCheckpointRPC(
    true,
    () => true,
    () => ({
      async write(_input, current) {
        guards.push(current);
        await new Promise<void>((resolve) => releases.push(resolve));
        return current()
          ? { status: "committed" }
          : { status: "rejected", reason: "stale" };
      },
      clear: () => Promise.resolve({ status: "rejected", reason: "not-owned" }),
      close: () => Promise.resolve(),
    })
  );
  rpc.ready(ready);
  const first = rpc.request(request());
  expect(guards[0]()).toBe(true);
  expect((await rpc.request({})).status).toBe("rejected");
  expect(guards[0]()).toBe(true);
  const second = rpc.request(request());
  expect(guards[0]()).toBe(false);
  expect(guards[1]()).toBe(true);
  rpc.navigate();
  rpc.ready(ready);
  expect(guards[1]()).toBe(false);
  releases.splice(0).forEach((release) => release());
  expect((await first).status).toBe("rejected");
  expect((await second).status).toBe("rejected");
  const third = rpc.request(request());
  const resume = rpc.suspend();
  expect((await rpc.request(request())).status).toBe("rejected");
  resume();
  resume();
  expect(guards[2]()).toBe(false);
  releases.splice(0).forEach((release) => release());
  expect((await third).status).toBe("rejected");
  const fourth = rpc.request(request());
  expect(guards[3]()).toBe(true);
  rpc.dispose();
  expect(guards[3]()).toBe(false);
  releases.splice(0).forEach((release) => release());
  expect((await fourth).status).toBe("rejected");
});

test("metadata failures remain bounded and dispose never awaits pending completion", async () => {
  let finish!: () => void;
  const rpc = createMainTabCheckpointRPC(
    true,
    () => true,
    () => ({
      write() {
        return Promise.reject(Error("private path must not leak"));
      },
      clear: () => Promise.resolve({ status: "rejected", reason: "not-owned" }),
      close: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    })
  );
  rpc.ready(ready);
  expect(await rpc.request(request())).toEqual({
    protocolVersion: 1,
    status: "unknown",
  });
  expect(rpc.dispose()).toBeUndefined();
  finish();
});

test("clear uses strict protocol and current generation, and navigation cannot carry writer ownership", async () => {
  expect(
    validMainTabCheckpointRequest({ protocolVersion: 1, op: "clear" })
  ).toBe(true);
  for (const value of [
    { protocolVersion: 1, op: "clear", tabs: [] },
    { protocolVersion: 1, op: "clear", path: "file" },
    { protocolVersion: 2, op: "clear" },
  ])
    expect(validMainTabCheckpointRequest(value)).toBe(false);
  let created = 0,
    closed = 0;
  const rpc = createMainTabCheckpointRPC(
    true,
    () => true,
    () => {
      created++;
      let owned = false;
      return {
        write: (_input, current) => {
          owned = current();
          return Promise.resolve(
            owned
              ? { status: "committed" }
              : { status: "rejected", reason: "stale" }
          );
        },
        clear: (current) => {
          if (!owned || !current())
            return Promise.resolve({ status: "rejected", reason: "not-owned" });
          owned = false;
          return Promise.resolve({ status: "committed" });
        },
        close: () => {
          closed++;
          return Promise.resolve();
        },
      };
    }
  );
  rpc.ready(ready);
  expect((await rpc.request(request())).status).toBe("committed");
  const resume = rpc.suspend();
  resume();
  expect((await rpc.request({ protocolVersion: 1, op: "clear" })).status).toBe(
    "committed"
  );
  await rpc.request(request());
  rpc.navigate();
  rpc.ready(ready);
  expect(closed).toBe(1);
  expect((await rpc.request({ protocolVersion: 1, op: "clear" })).status).toBe(
    "rejected"
  );
  expect(created).toBe(2);
  rpc.dispose();
});
