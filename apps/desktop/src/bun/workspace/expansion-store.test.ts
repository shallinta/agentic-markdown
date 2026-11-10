import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WORKSPACE_MAX_ROOTS } from "../../shared/workspace";

import {
  createExpansionStore,
  EXPANSION_MAX_BYTES,
  EXPANSION_MAX_DIRS,
  EXPANSION_MAX_DIRS_PER_ROOT,
  EXPANSION_MAX_PATH_LENGTH,
  type RootExpansion,
  validExpansionPath,
} from "./expansion-store";

const directories: string[] = [];
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "expansion-store-"));
  directories.push(dir);
  return { dir, path: join(dir, "workspace-expansion.json") };
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }))
  );
});
const encode = (roots: readonly RootExpansion[]) =>
  `${JSON.stringify({ version: 1, data: { roots } }, null, 2)}\n`;

test("missing read does not create file; serial updates restore defaults and separate root identities", async () => {
  const f = await fixture(),
    store = createExpansionStore(f.dir),
    a = randomUUID(),
    b = randomUUID();
  expect((await store.read()).roots).toEqual([]);
  expect(await stat(f.path).catch(() => null)).toBeNull();
  const tasks = [
    store.setDirectoryExpanded(a, "同名/深层", true),
    store.setRootCollapsed(a, true),
    store.setDirectoryExpanded(b, "同名/其他", true),
    store.setDirectoryExpanded(a, "同名/深层", false),
  ];
  await store.close();
  expect((await Promise.all(tasks)).every((result) => result.committed)).toBe(
    true
  );
  const restarted = createExpansionStore(f.dir);
  expect((await restarted.read()).roots).toEqual([
    { rootId: a, collapsed: true, expanded: [] },
    { rootId: b, collapsed: false, expanded: ["同名/其他"] },
  ]);
  expect((await store.setRootCollapsed(a, false)).failure).toBe("closed");
  await restarted.close();
});

test("relative path validation rejects escapes and non-normalized paths without writes", async () => {
  const f = await fixture(),
    store = createExpansionStore(f.dir),
    id = randomUUID();
  for (const path of [
    "",
    "/absolute",
    ".",
    "..",
    "a/../b",
    "a/./b",
    "a//b",
    "a/",
    "nul\0x",
    "x".repeat(EXPANSION_MAX_PATH_LENGTH + 1),
  ]) {
    expect(validExpansionPath(path)).toBe(false);
    expect((await store.setDirectoryExpanded(id, path, true)).failure).toBe(
      "invalid"
    );
  }
  expect(await stat(f.path).catch(() => null)).toBeNull();
  expect(
    (await store.setDirectoryExpanded(id, "不存在/无文件系统访问", true))
      .committed
  ).toBe(true);
  const before = await readFile(f.path);
  expect((await store.setRootCollapsed("not-an-id", true)).failure).toBe(
    "invalid"
  );
  expect(await readFile(f.path)).toEqual(before);
  await store.close();
});

test("remove and prune affect exact IDs; new IDs do not inherit removed expansion", async () => {
  const f = await fixture(),
    store = createExpansionStore(f.dir),
    a = randomUUID(),
    b = randomUUID(),
    c = randomUUID();
  await store.setDirectoryExpanded(a, "same", true);
  await store.setDirectoryExpanded(b, "same", true);
  expect((await store.removeRoot(a)).roots.map((root) => root.rootId)).toEqual([
    b,
  ]);
  await store.setRootCollapsed(c, true);
  expect((await store.prune([c])).roots).toEqual([
    { rootId: c, collapsed: true, expanded: [] },
  ]);
  const before = await readFile(f.path);
  expect((await store.prune([c, c])).failure).toBe("invalid");
  expect(await readFile(f.path)).toEqual(before);
  await store.close();
});

test("legacy, future, corrupt, oversized and duplicate metadata protect original bytes", async () => {
  const id = randomUUID();
  for (const [source, failure] of [
    ['{"roots":[]}', "legacy"],
    ['{"version":2,"data":{"roots":[]}}', "future"],
    ["broken", "corrupt"],
    ['{"version":1,"version":1,"data":{"roots":[]}}', "corrupt"],
    [
      encode([{ rootId: id, collapsed: false, expanded: ["a", "a"] }]),
      "corrupt",
    ],
    [" ".repeat(EXPANSION_MAX_BYTES + 1), "too-large"],
  ] as const) {
    const f = await fixture();
    await writeFile(f.path, source);
    const store = createExpansionStore(f.dir);
    expect((await store.read()).failure).toBe(failure);
    expect((await store.setRootCollapsed(id, true)).readOnly).toBe(true);
    expect((await store.prune([])).committed).toBe(false);
    expect(await readFile(f.path, "utf8")).toBe(source);
    await store.close();
  }
});

test("root, per-root directory, total directory and serialized byte bounds preserve whole durable state", async () => {
  const single = randomUUID();
  const manyPaths = Array.from(
    { length: EXPANSION_MAX_DIRS_PER_ROOT },
    (_, i) => `dir${i}`
  );
  const roots = Array.from({ length: WORKSPACE_MAX_ROOTS }, () => ({
    rootId: randomUUID(),
    collapsed: true,
    expanded: [],
  }));
  const totals = Array.from(
    { length: EXPANSION_MAX_DIRS / EXPANSION_MAX_DIRS_PER_ROOT },
    () => ({ rootId: randomUUID(), collapsed: false, expanded: manyPaths })
  );
  const bytes: RootExpansion = {
    rootId: single,
    collapsed: false,
    expanded: [],
  };
  const expanded: string[] = [];
  while (
    Buffer.byteLength(
      encode([
        {
          ...bytes,
          expanded: [...expanded, `${expanded.length}-${"x".repeat(4000)}`],
        },
      ])
    ) <= EXPANSION_MAX_BYTES
  )
    expanded.push(`${expanded.length}-${"x".repeat(4000)}`);
  for (const [initial, id, path] of [
    [roots, randomUUID(), "new"],
    [
      [{ rootId: single, collapsed: false, expanded: manyPaths }],
      single,
      "overflow",
    ],
    [totals, randomUUID(), "overflow"],
    [[{ ...bytes, expanded }], single, `extra-${"x".repeat(4000)}`],
  ] as const) {
    const f = await fixture(),
      before = encode(initial);
    await writeFile(f.path, before);
    const store = createExpansionStore(f.dir);
    const result = await store.setDirectoryExpanded(id, path, true);
    expect(result.failure).toBe("capacity");
    expect(result.committed).toBe(false);
    expect(result.roots).toEqual(initial);
    expect(await readFile(f.path, "utf8")).toBe(before);
    await store.close();
  }
});

test("real backup failure preserves old state; later retry commits and exact bytes are backed up", async () => {
  const f = await fixture(),
    store = createExpansionStore(f.dir),
    id = randomUUID();
  await store.setDirectoryExpanded(id, "first", true);
  const before = await readFile(f.path);
  await mkdir(`${f.path}.bak`);
  const failed = await store.setRootCollapsed(id, true);
  expect(failed.failure).toBe("unknown");
  expect(failed.roots[0].collapsed).toBe(false);
  expect(await readFile(f.path)).toEqual(before);
  expect((await store.read()).failure).toBe("unknown");
  await rm(`${f.path}.bak`, { recursive: true });
  expect((await store.setRootCollapsed(id, true)).committed).toBe(true);
  expect((await store.read()).failure).toBeUndefined();
  expect(await readFile(`${f.path}.bak`)).toEqual(before);
  await store.close();
});

test("default states consume no root slot and removing the last override returns to absent default", async () => {
  const f = await fixture(),
    id = randomUUID();
  const roots = Array.from({ length: WORKSPACE_MAX_ROOTS }, () => ({
    rootId: randomUUID(),
    collapsed: true,
    expanded: [],
  }));
  const before = encode(roots);
  await writeFile(f.path, before);
  const store = createExpansionStore(f.dir);
  expect((await store.setRootCollapsed(id, false)).committed).toBe(true);
  expect(
    (await store.setDirectoryExpanded(id, "unknown", false)).committed
  ).toBe(true);
  expect(await readFile(f.path, "utf8")).toBe(before);
  expect(await stat(`${f.path}.bak`).catch(() => null)).toBeNull();
  expect((await store.setRootCollapsed(roots[0].rootId, false)).roots).toEqual(
    roots.slice(1)
  );
  await store.setDirectoryExpanded(id, "only", true);
  expect((await store.setDirectoryExpanded(id, "only", false)).roots).toEqual(
    roots.slice(1)
  );
  await store.prune([]);
  expect((await store.read()).roots).toEqual([]);
  await store.close();
});
