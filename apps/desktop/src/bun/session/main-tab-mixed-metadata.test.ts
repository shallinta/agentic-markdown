import { expect, test } from "bun:test";

import { WORKSPACE_MAX_ROOTS } from "../../shared/workspace";

import {
  copyMixedMainTabMetadata,
  decodeMixedMainTabMetadata,
  type MixedMainTabMetadata,
} from "./main-tab-mixed-metadata";

const root = (index = 0) => ({
  kind: "root" as const,
  rootId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  relativePath: "a.md",
  fingerprint: "1:2:3",
  pinned: true,
  mode: "source" as const,
});
const standalone = (index = 0) => ({
  kind: "standalone" as const,
  path: `/synthetic/${index}/a.md`,
  fingerprint: "1:2:3",
  pinned: false,
  mode: "editing" as const,
});
const position = { from: 3, offset: -0.5, ratio: 0.4 };

test("mixed codec preserves interleaved rows, positions and active index in independent primitive copies", () => {
  const input: MixedMainTabMetadata = {
    schemaVersion: 3,
    tabs: [root(), { ...standalone(), position: { ...position } }, root(1)],
    activeIndex: 1,
  };
  const copied = copyMixedMainTabMetadata(input);
  expect(copied).toEqual(input);
  expect(decodeMixedMainTabMetadata(JSON.parse(JSON.stringify(input)))).toEqual(
    { status: "valid", data: input }
  );
  input.tabs[0].pinned = false;
  input.tabs[1].position!.offset = 5;
  expect(copied?.tabs[0].pinned).toBe(true);
  expect(copied?.tabs[1].position).toEqual(position);
  // Identical physical signals across different source kinds do not confer a live identity.
  expect(
    copyMixedMainTabMetadata({
      schemaVersion: 3,
      tabs: [root(), standalone()],
      activeIndex: 0,
    })
  ).toBeDefined();
});

test("old root-only v1 and v2 project in memory without changing their source", () => {
  const { rootId, relativePath, fingerprint, pinned, mode } = root();
  const base = { rootId, relativePath, fingerprint, pinned, mode };
  const old = { tabs: [base], activeIndex: 0 };
  const v2 = {
    schemaVersion: 2,
    tabs: [{ ...base, position }],
    activeIndex: 0,
  };
  for (const value of [old, v2]) {
    const before = JSON.stringify(value);
    const decoded = decodeMixedMainTabMetadata(value);
    expect(decoded.status).toBe("valid");
    expect(decoded.status === "valid" && decoded.data.tabs[0]).toEqual({
      kind: "root",
      ...value.tabs[0],
    });
    expect(JSON.stringify(value)).toBe(before);
  }
  expect(decodeMixedMainTabMetadata({ schemaVersion: 4 })).toEqual({
    status: "future",
  });
  expect(decodeMixedMainTabMetadata({ ...old, schemaVersion: 1 })).toEqual({
    status: "invalid",
  });
});

test("mixed candidate enforces exact rows, roots, duplicates, coordinates and bounded capacity", () => {
  const valid = { schemaVersion: 3, tabs: [root()], activeIndex: 0 };
  for (const value of [
    { ...valid, content: "body" },
    { ...valid, tabs: [root(), root()] },
    { ...valid, tabs: [standalone(), standalone()] },
    { ...valid, tabs: [{ ...root(), relativePath: "../a.md" }] },
    { ...valid, tabs: [{ ...standalone(), path: "relative.md" }] },
    { ...valid, tabs: [{ ...standalone(), rootId: root().rootId }] },
    {
      ...valid,
      tabs: [{ ...standalone(), position: { ...position, offset: -0 } }],
    },
    { ...valid, tabs: Array(1) },
    {
      ...valid,
      tabs: Array.from({ length: 65 }, (_, index) => standalone(index)),
    },
    {
      ...valid,
      tabs: Array.from({ length: WORKSPACE_MAX_ROOTS + 1 }, (_, index) =>
        root(index)
      ),
    },
    { ...valid, activeIndex: 1 },
  ])
    expect(copyMixedMainTabMetadata(value)).toBeUndefined();
  expect(
    copyMixedMainTabMetadata({
      ...valid,
      tabs: Array.from({ length: 64 }, (_, index) => standalone(index)),
      activeIndex: 63,
    })
  ).toBeDefined();
  expect(
    copyMixedMainTabMetadata({ schemaVersion: 3, tabs: [], activeIndex: null })
  ).toBeDefined();
});

test("accessors and custom serialization cannot inject fields or change primitive output", () => {
  let called = 0;
  const row: Record<string, unknown> = Object.create({
    toJSON() {
      called++;
      return { text: "body" };
    },
  }) as Record<string, unknown>;
  Object.assign(row, standalone());
  const input = { schemaVersion: 3, tabs: [row], activeIndex: 0 };
  const copied = copyMixedMainTabMetadata(input);
  expect(copied?.tabs).toEqual([standalone()]);
  expect(JSON.stringify(copied)).not.toContain("body");
  expect(called).toBe(0);
  Object.defineProperty(row, "path", {
    enumerable: true,
    get() {
      called++;
      throw Error("accessor");
    },
  });
  expect(copyMixedMainTabMetadata(input)).toBeUndefined();
  expect(called).toBe(0);
  const tabs = [standalone()];
  Object.defineProperty(tabs, Symbol.iterator, {
    value() {
      throw Error("not used");
    },
  });
  expect(copyMixedMainTabMetadata({ ...input, tabs })).toBeDefined();
});
