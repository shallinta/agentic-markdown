import { expect, test } from "bun:test";

import {
  createMainTabMetadataBinder,
  type MainTabSourceInput,
} from "./main-tab-binder";
import { MAIN_TAB_METADATA_MAX_TABS } from "./main-tab-metadata";

const tab = (): MainTabSourceInput => ({
  handle: crypto.randomUUID(),
  documentId: crypto.randomUUID(),
  revision: 1,
  hash: "a".repeat(64),
  pinned: false,
  mode: "editing",
});

test("binder boundary rejects malformed or oversized input before trusted workspace calls", async () => {
  let calls = 0;
  const binder = createMainTabMetadataBinder({
    workspace: {
      captureMainTabSources: () => {
        calls++;
        return Promise.resolve(undefined);
      },
    },
    roster: { confirmExpansionIdentity: () => Promise.resolve(undefined) },
  });
  const item = tab();
  for (const input of [
    null,
    { tabs: [], activeIndex: 0 },
    Object.assign([], { tabs: [], activeIndex: null }),
    { tabs: [Object.assign([], item)], activeIndex: 0 },
    { tabs: [item, item], activeIndex: 0 },
    { tabs: Array(1), activeIndex: 0 },
    { tabs: [{ ...item, path: "/fake.md" }], activeIndex: 0 },
    { tabs: [{ ...item, revision: 0 }], activeIndex: 0 },
    { tabs: [{ ...item, hash: "bad" }], activeIndex: 0 },
    { tabs: [{ ...item, mode: "reading" }], activeIndex: 0 },
    {
      tabs: Array.from({ length: MAIN_TAB_METADATA_MAX_TABS + 1 }, tab),
      activeIndex: 0,
    },
  ]) {
    expect(await binder.bind(input)).toEqual({ status: "invalid" });
  }
  expect(calls).toBe(0);
});

test("binder copies primitive input before await and shares one root confirmation per source root", async () => {
  const rootId = crypto.randomUUID();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let current = true,
    confirmations = 0;
  const binder = createMainTabMetadataBinder({
    workspace: {
      async captureMainTabSources(tabs) {
        await wait;
        expect(tabs[0].pinned).toBe(true);
        return {
          sources: tabs.map((_, index) => ({
            rootHandle: "trusted-root",
            rootPath: "/trusted",
            relativePath: `${index}.md`,
            fingerprint: `1:${index + 1}:3`,
          })),
          current: () => current,
        };
      },
    },
    roster: {
      confirmExpansionIdentity: () => {
        confirmations++;
        return Promise.resolve({ id: rootId, current: () => current });
      },
    },
  });
  const input = { tabs: [{ ...tab(), pinned: true }, tab()], activeIndex: 1 };
  const pending = binder.bind(input);
  input.tabs[0].pinned = false;
  input.activeIndex = 0;
  release();
  const receipt = await pending;
  if (receipt.status !== "ready") throw Error(receipt.status);
  expect(receipt.data.activeIndex).toBe(1);
  expect(receipt.data.tabs.map((value) => value.pinned)).toEqual([true, false]);
  expect(receipt.data.tabs.map((value) => value.rootId)).toEqual([
    rootId,
    rootId,
  ]);
  expect(confirmations).toBe(1);
  expect(receipt.current()).toBe(true);
  current = false;
  expect(receipt.current()).toBe(false);
  current = true;
  expect(receipt.current()).toBe(false);
});

test("binder rejects the complete batch when a root proof fails or the source expires during confirmation", async () => {
  for (const missing of [true, false]) {
    let current = true;
    const binder = createMainTabMetadataBinder({
      workspace: {
        captureMainTabSources: () =>
          Promise.resolve({
            sources: [
              {
                rootHandle: "root",
                rootPath: "/trusted",
                relativePath: "a.md",
                fingerprint: "1:2:3",
              },
            ],
            current: () => current,
          }),
      },
      roster: {
        confirmExpansionIdentity: () => {
          current = false;
          return Promise.resolve(
            missing
              ? undefined
              : { id: crypto.randomUUID(), current: () => true }
          );
        },
      },
    });
    expect(
      (await binder.bind({ tabs: [tab()], activeIndex: 0 })).status
    ).not.toBe("ready");
  }
});

test("binder rejects metadata exceeding the shared serialized byte limit", async () => {
  const input = {
    tabs: Array.from({ length: MAIN_TAB_METADATA_MAX_TABS }, tab),
    activeIndex: 0,
  };
  const binder = createMainTabMetadataBinder({
    workspace: {
      captureMainTabSources: () =>
        Promise.resolve({
          sources: input.tabs.map((_, index) => ({
            rootHandle: "root",
            rootPath: "/trusted",
            relativePath: `${"中".repeat(4000)}${index}.md`,
            fingerprint: "1:2:3",
          })),
          current: () => true,
        }),
    },
    roster: {
      confirmExpansionIdentity: () =>
        Promise.resolve({ id: crypto.randomUUID(), current: () => true }),
    },
  });
  expect(await binder.bind(input)).toEqual({ status: "unavailable" });
});

test("abort during either absent async proof is stale rather than unavailable", async () => {
  for (const atWorkspace of [true, false]) {
    const abort = new AbortController();
    const binder = createMainTabMetadataBinder({
      workspace: {
        captureMainTabSources: () => {
          if (atWorkspace) {
            abort.abort();
            return Promise.resolve(undefined);
          }
          return Promise.resolve({
            sources: [
              {
                rootHandle: "root",
                rootPath: "/trusted",
                relativePath: "a.md",
                fingerprint: "1:2:3",
              },
            ],
            current: () => true,
          });
        },
      },
      roster: {
        confirmExpansionIdentity: () => {
          abort.abort();
          return Promise.resolve(undefined);
        },
      },
    });
    expect(
      await binder.bind({ tabs: [tab()], activeIndex: 0 }, abort.signal)
    ).toEqual({ status: "stale" });
  }
});
