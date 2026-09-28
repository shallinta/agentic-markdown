import { expect, test } from "bun:test";

import { waitForDenseParser } from "./dense-line-probe";

test("readiness requires the observed public state, timeout is not success", async () => {
  const signal = new AbortController().signal;
  expect(await waitForDenseParser(() => true, signal, 0)).toBe(true);
  expect(await waitForDenseParser(() => false, signal, 0)).toBe(false);
  let checks = 0;
  expect(await waitForDenseParser(() => ++checks > 1, signal, 100)).toBe(true);
});
test("parser wait cancellation interrupts timers and permits a fresh wait", async () => {
  const controller = new AbortController();
  const pending = waitForDenseParser(() => false, controller.signal);
  controller.abort();
  const error: unknown = await pending.catch((cause: unknown) => cause);
  expect(error).toHaveProperty("name", "AbortError");
  expect(
    await waitForDenseParser(() => true, new AbortController().signal)
  ).toBe(true);
});
