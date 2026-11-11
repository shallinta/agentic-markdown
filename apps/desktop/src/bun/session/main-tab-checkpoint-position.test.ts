import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createMainTabCheckpointMetadataStore,
  createMainTabMetadataStore,
  type PositionedMainTabSessionMetadata,
} from "./main-tab-metadata";

const base = () => ({
  tabs: [
    {
      rootId: "550e8400-e29b-41d4-a716-446655440000",
      relativePath: "one.md",
      fingerprint: "1:2:3",
      pinned: false,
      mode: "editing" as const,
    },
  ],
  activeIndex: 0,
});
const positioned = (): PositionedMainTabSessionMetadata => ({
  schemaVersion: 2,
  tabs: [
    { ...base().tabs[0], position: { from: 3, offset: -2.5, ratio: 0.4 } },
    { ...base().tabs[0], relativePath: "two.md", mode: "source", pinned: true },
  ],
  activeIndex: 1,
});
const encode = (data: unknown) =>
  JSON.stringify({ version: 1, data }, null, 2) + "\n";
async function fixture(run: (dir: string, path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "checkpoint-position-"));
  try {
    await run(dir, join(dir, "main-tab-session-checkpoint.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function child(
  op: string,
  dir: string,
  input?: string
): Promise<unknown> {
  const proc = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "main-tab-checkpoint-position-child.ts"),
      op,
      dir,
      ...(input ? [input] : []),
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(stderr).toBe("");
  expect(code).toBe(0);
  return JSON.parse(stdout);
}

test("checkpoint upgrades with exact backup and cross-process preserves optional per-tab position", async () =>
  fixture(async (dir, path) => {
    const original = encode(base());
    await writeFile(path, original);
    const store = createMainTabCheckpointMetadataStore(dir);
    try {
      expect(await store.read()).toEqual({ status: "valid", data: base() });
      expect(await readFile(path, "utf8")).toBe(original);
      const input = join(dir, "input.json");
      await writeFile(input, JSON.stringify(positioned()));
      expect(await child("write", dir, input)).toEqual({ status: "committed" });
      expect(await readFile(path + ".bak", "utf8")).toBe(original);
      const result = await child("read", dir);
      expect(result).toEqual({
        status: "valid",
        positioned: positioned(),
        data: {
          tabs: [
            base().tabs[0],
            {
              ...base().tabs[0],
              relativePath: "two.md",
              mode: "source",
              pinned: true,
            },
          ],
          activeIndex: 1,
        },
      });
      const bytes = await readFile(path, "utf8");
      expect(await store.write(base(), () => true)).toEqual({
        status: "rejected",
        reason: "future",
      });
      expect(await readFile(path, "utf8")).toBe(bytes);
    } finally {
      await store.close();
    }
  }));

test("full-byte observation invalidates on position-only change and claimed v2 clears in v2", async () =>
  fixture(async (dir, path) => {
    const store = createMainTabCheckpointMetadataStore(dir);
    try {
      expect(await store.writePositions(positioned(), () => true)).toEqual({
        status: "committed",
      });
      const observed = await store.readObserved();
      expect(observed.status).toBe("valid");
      expect(store.exactCurrent(observed)).toBe(true);
      const changed = positioned();
      changed.tabs[0].position!.offset = 100;
      await writeFile(path, encode(changed));
      expect(store.exactCurrent(observed)).toBe(false);
      expect(await store.claimObservation(observed, () => true)).toBe(false);
      const current = await store.readObserved();
      expect(await store.claimObservation(current, () => true)).toBe(true);
      const bytes = await readFile(path, "utf8");
      expect(await store.clearOwned(() => true)).toEqual({
        status: "committed",
      });
      expect(await readFile(path, "utf8")).toBe(
        encode({ schemaVersion: 2, tabs: [], activeIndex: null })
      );
      expect(await readFile(path + ".bak", "utf8")).toBe(bytes);
    } finally {
      await store.close();
    }
  }));

test("future, invalid, legacy and probe records stay protected", async () =>
  fixture(async (dir, path) => {
    for (const data of [
      { ...positioned(), schemaVersion: 3 },
      { ...positioned(), extra: true },
      {
        ...positioned(),
        tabs: [
          {
            ...positioned().tabs[0],
            position: { from: -1, offset: 0, ratio: 0 },
          },
        ],
      },
    ]) {
      const bytes = encode(data);
      await writeFile(path, bytes);
      const store = createMainTabCheckpointMetadataStore(dir);
      try {
        expect((await store.read()).status).toBe("corrupt");
        expect(
          (await store.writePositions(positioned(), () => true)).status
        ).toBe("rejected");
        expect(await readFile(path, "utf8")).toBe(bytes);
      } finally {
        await store.close();
      }
    }
    await writeFile(path, JSON.stringify(base()));
    const store = createMainTabCheckpointMetadataStore(dir);
    try {
      expect(await store.writePositions(positioned(), () => true)).toEqual({
        status: "rejected",
        reason: "legacy",
      });
    } finally {
      await store.close();
    }
    const probePath = join(dir, "main-tab-session-probe.json");
    await writeFile(probePath, encode(positioned()));
    const probe = createMainTabMetadataStore(dir);
    try {
      expect(await probe.read()).toEqual({ status: "corrupt" });
      expect((await probe.write(base())).status).toBe("rejected");
      expect(await readFile(probePath, "utf8")).toBe(encode(positioned()));
      expect(await probe.write(positioned())).toEqual({
        status: "rejected",
        reason: "invalid",
      });
    } finally {
      await probe.close();
    }
  }));

test("versioned input copies approved fields without invoking serialization hooks", async () =>
  fixture(async (dir, path) => {
    const store = createMainTabCheckpointMetadataStore(dir);
    try {
      const data = positioned();
      let calls = 0;
      for (const object of [
        data,
        data.tabs,
        data.tabs[0],
        data.tabs[0].position!,
      ])
        Object.defineProperty(object, "toJSON", {
          value() {
            calls++;
            throw Error("must not call");
          },
        });
      expect(await store.writePositions(data, () => true)).toEqual({
        status: "committed",
      });
      expect(calls).toBe(0);
      expect(await readFile(path, "utf8")).toBe(encode(positioned()));
      const pending = store.writePositions(positioned(), () => false);
      expect(await pending).toEqual({ status: "rejected", reason: "stale" });
    } finally {
      await store.close();
    }
  }));

test("versioned writes reject invalid input and missing guards without touching authority", async () =>
  fixture(async (dir, path) => {
    const store = createMainTabCheckpointMetadataStore(dir);
    try {
      const original = encode(base());
      await writeFile(path, original);
      for (const value of [
        base(),
        { ...positioned(), schemaVersion: 3 },
        { ...positioned(), tabs: new Array(1) },
        {
          ...positioned(),
          tabs: Array.from({ length: 65 }, () => positioned().tabs[0]),
        },
      ]) {
        expect(await store.writePositions(value, () => true)).toEqual({
          status: "rejected",
          reason: "invalid",
        });
        expect(await readFile(path, "utf8")).toBe(original);
      }
      const unguarded = store.writePositions.bind(store) as (
        value: unknown
      ) => ReturnType<typeof store.writePositions>;
      expect(await unguarded(positioned())).toEqual({
        status: "rejected",
        reason: "stale",
      });
      const input = positioned();
      Object.defineProperty(input.tabs, Symbol.iterator, {
        value() {
          throw Error("caller iterator must not run");
        },
      });
      const pending = store.writePositions(input, () => true);
      input.tabs[0].position!.offset = 99;
      expect(await pending).toEqual({ status: "committed" });
      expect(await readFile(path, "utf8")).toBe(encode(positioned()));
      expect(await readFile(path + ".bak", "utf8")).toBe(original);
    } finally {
      await store.close();
    }
  }));
