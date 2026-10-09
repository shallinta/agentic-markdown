import { expect, test } from "bun:test";

import { deferWrappingUpdate } from "./wrapping-measure";

test("wrapping dispatch exits measurement write before applying and rechecks current state", async () => {
  let updating = true;
  let current = true;
  let state = {};
  let applied = 0;
  let measured = 0;
  const callbacks = {
    current: () => current,
    state: () => state,
    remeasure: () => {
      measured++;
    },
    apply: () => {
      expect(updating).toBe(false);
      applied++;
    },
  };
  deferWrappingUpdate(state, callbacks);
  expect(applied).toBe(0);
  updating = false;
  await Promise.resolve();
  expect(applied).toBe(1);
  deferWrappingUpdate(state, callbacks);
  state = {};
  await Promise.resolve();
  expect(applied).toBe(1);
  expect(measured).toBe(1);
  deferWrappingUpdate(state, callbacks);
  current = false;
  await Promise.resolve();
  expect(applied).toBe(1);
  expect(measured).toBe(1);
});
