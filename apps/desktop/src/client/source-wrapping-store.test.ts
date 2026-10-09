import { expect, test } from "bun:test";

import {
  isSourceWrappingRequest,
  isSourceWrappingResponse,
} from "../shared/source-wrapping";

import { createSourceWrappingPreference } from "./source-wrapping-store";

test("late settings load cannot replace an acknowledged user preference", async () => {
  let finish!: (value: unknown) => void;
  const store = createSourceWrappingPreference({
    load: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    save: (enabled) => Promise.resolve({ ok: true, enabled }),
  });
  const loading = store.load();
  expect(store.getSnapshot().enabled).toBe(true);
  expect(await store.change(false)).toBe(true);
  finish({ ok: true, enabled: true });
  await loading;
  expect(store.getSnapshot().enabled).toBe(false);
});
test("saving is single-flight and invalid acknowledgement preserves confirmed state", async () => {
  let finish!: (value: unknown) => void;
  let writes = 0;
  const store = createSourceWrappingPreference({
    load: () => Promise.resolve({ ok: false }),
    save: () => {
      writes++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const pending = store.change(false);
  expect(store.getSnapshot().isSaving).toBe(true);
  expect(await store.change(true)).toBe(false);
  expect(writes).toBe(1);
  finish({ ok: true, enabled: false, unexpected: true });
  expect(await pending).toBe(false);
  expect(store.getSnapshot().enabled).toBe(true);
  expect(store.getSnapshot().error).toContain("未确认");
});
test("wrapping protocol only admits exact boolean records", () => {
  expect(isSourceWrappingRequest({ enabled: false })).toBe(true);
  for (const value of [
    null,
    [],
    true,
    {},
    { enabled: "false" },
    { enabled: true, extra: 1 },
  ])
    expect(isSourceWrappingRequest(value)).toBe(false);
  expect(isSourceWrappingResponse({ ok: true, enabled: true })).toBe(true);
  expect(isSourceWrappingResponse({ ok: false })).toBe(true);
  expect(isSourceWrappingResponse({ ok: false, enabled: true })).toBe(false);
});
