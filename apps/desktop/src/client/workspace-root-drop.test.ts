import { expect, mock, test } from "bun:test";

import {
  rejectedTreeDragHandlers,
  rootDropPlacement,
} from "./workspace-root-drop";

test("actual tree fallback handlers prevent defaults and cancel only a rejected drop", () => {
  const clear = mock(() => undefined),
    cancel = mock(() => undefined);
  const handlers = rejectedTreeDragHandlers(clear, cancel);
  const event = {
    preventDefault: mock(() => undefined),
    dataTransfer: { dropEffect: "copy" },
  };
  handlers.onDragOver(event);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(event.dataTransfer.dropEffect).toBe("none");
  expect(clear).toHaveBeenCalledTimes(1);
  expect(cancel).not.toHaveBeenCalled();
  event.dataTransfer.dropEffect = "move";
  handlers.onDrop(event);
  expect(event.preventDefault).toHaveBeenCalledTimes(2);
  expect(event.dataTransfer.dropEffect).toBe("none");
  expect(clear).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledTimes(1);
});

test("only bounded header edges are valid, including small rows", () => {
  for (const height of [16, 24, 40, 80]) {
    const edge = Math.min(8, height / 4);
    expect(rootDropPlacement(0, height)).toBe("before");
    expect(rootDropPlacement(edge, height)).toBe("before");
    expect(rootDropPlacement(edge + 0.01, height)).toBeNull();
    expect(rootDropPlacement(height / 2, height)).toBeNull();
    expect(rootDropPlacement(height - edge - 0.01, height)).toBeNull();
    expect(rootDropPlacement(height - edge, height)).toBe("after");
    expect(rootDropPlacement(height, height)).toBe("after");
    expect(rootDropPlacement(-1, height)).toBeNull();
    expect(rootDropPlacement(height + 1, height)).toBeNull();
  }
  for (const [y, height] of [
    [0, 0],
    [0, -1],
    [NaN, 20],
    [1, Infinity],
  ])
    expect(rootDropPlacement(y, height)).toBeNull();
});
