import { expect, mock, test } from "bun:test";

import { createLocaleController } from "./controller";

test("ignores inherited English state and activates Chinese before readiness", async () => {
  const activateLocale = mock(() => Promise.resolve());
  const onLocaleChanged = mock(() => undefined);
  const setLocale = mock(() => Promise.resolve());
  const controller = createLocaleController({
    store: { getLocale: () => Promise.resolve("en-US"), setLocale },
    activateLocale,
    onLocaleChanged,
  });
  expect(controller.getLocale()).toBe("zh-CN");
  await controller.initialize();
  expect(activateLocale).toHaveBeenCalledWith("zh-CN");
  await Promise.all([
    controller.setLocale("en-US"),
    controller.setLocale("zh-CN"),
  ]);
  expect(controller.getLocale()).toBe("zh-CN");
  expect(setLocale).not.toHaveBeenCalled();
  expect(onLocaleChanged).not.toHaveBeenCalled();
  expect(activateLocale).toHaveBeenCalledTimes(1);
  expect(controller.setLocale("fr-FR" as never)).rejects.toThrow(
    "不支持的界面语言"
  );
});

test("activation failure rejects initialization instead of reporting readiness", () => {
  const controller = createLocaleController({
    store: {
      getLocale: () => Promise.resolve("zh-CN"),
      setLocale: () => Promise.resolve(),
    },
    activateLocale: () => Promise.reject(new Error("activation failed")),
    onLocaleChanged: () => undefined,
  });
  expect(controller.initialize()).rejects.toThrow("activation failed");
});
