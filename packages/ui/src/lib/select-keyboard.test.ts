import { expect, test } from "bun:test";

import { preventSelectEnterDefault } from "./select-keyboard";

test("select bubble guard cancels Enter default after selection without cancelling IME or other keys", () => {
  for (const [key, isComposing, keyCode, expected] of [
    ["Enter", false, 13, true],
    ["Enter", true, 13, false],
    ["Enter", false, 229, false],
    [" ", false, 32, false],
    ["ArrowDown", false, 40, false],
    ["Escape", false, 27, false],
    ["a", false, 65, false],
  ] as const) {
    const order: string[] = ["item selection"];
    preventSelectEnterDefault({
      key,
      nativeEvent: { isComposing, keyCode },
      preventDefault: () => order.push("prevent default"),
    });
    expect(order).toEqual(
      expected ? ["item selection", "prevent default"] : ["item selection"]
    );
  }
});
