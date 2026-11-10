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
import { fileFingerprint } from "../documents/path-authorization";

import {
  createMainTabMetadataStore,
  MAIN_TAB_METADATA_MAX_BYTES,
  MAIN_TAB_METADATA_MAX_TABS,
  type MainTabSessionMetadata,
  validMainTabSessionMetadata,
} from "./main-tab-metadata";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "main-session-probe-"));
  dirs.push(dir);
  return { dir, path: join(dir, "main-tab-session-probe.json") };
}
const metadata = (): MainTabSessionMetadata => ({
  tabs: [
    {
      rootId: randomUUID(),
      relativePath: "nested/a.md",
      fingerprint: "1:2:3",
      pinned: false,
      mode: "editing",
    },
  ],
  activeIndex: 0,
});
const encode = (value: unknown) =>
  `${JSON.stringify({ version: 1, data: value }, null, 2)}\n`;
async function child(
  operation: "read" | "write",
  dir: string,
  input?: string
): Promise<unknown> {
  const process = Bun.spawn(
    [
      globalThis.process.execPath,
      join(import.meta.dir, "main-tab-metadata-child.ts"),
      operation,
      dir,
      ...(input ? [input] : []),
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  expect(exit).toBe(0);
  expect(stderr).toBe("");
  return JSON.parse(stdout) as unknown;
}

test("real writer and reader processes roundtrip saved synthetic tabs from two same-name roots", async () => {
  const f = await fixture(),
    paths = [
      join(f.dir, "one", "same", "a.md"),
      join(f.dir, "two", "same", "a.markdown"),
    ];
  const tabs: MainTabSessionMetadata["tabs"] = [];
  for (const [index, path] of paths.entries()) {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, `PRIVATE_BODY_${index}\n`);
    tabs.push({
      rootId: randomUUID(),
      relativePath: index ? "a.markdown" : "a.md",
      fingerprint: fileFingerprint(await stat(path, { bigint: true })),
      pinned: index === 0,
      mode: index === 0 ? "source" : "editing",
    });
  }
  const value = { tabs, activeIndex: 1 },
    input = join(f.dir, "input.json");
  await writeFile(input, JSON.stringify(value));
  expect(await child("write", f.dir, input)).toEqual({ status: "committed" });
  const before = await readFile(f.path);
  expect(await child("read", f.dir)).toEqual({ status: "valid", data: value });
  expect(await readFile(f.path)).toEqual(before);
  const raw = before.toString();
  expect(raw).not.toContain("PRIVATE_BODY");
  expect(raw).not.toContain("handle");
  expect(raw).not.toContain(f.dir);
  expect(await readFile(paths[0], "utf8")).toBe("PRIVATE_BODY_0\n");
  expect(await readFile(paths[1], "utf8")).toBe("PRIVATE_BODY_1\n");
});

test("missing read creates nothing and serial writes capture input without runtime aliasing", async () => {
  const f = await fixture(),
    store = createMainTabMetadataStore(f.dir),
    a = metadata(),
    b = metadata();
  expect(await store.read()).toEqual({ status: "missing" });
  expect(await stat(f.path).catch(() => null)).toBeNull();
  const first = store.write(a),
    last = store.write(b);
  b.tabs[0].relativePath = "mutated.md";
  await store.close();
  expect(await first).toEqual({ status: "committed" });
  expect(await last).toEqual({ status: "committed" });
  const reopened = createMainTabMetadataStore(f.dir),
    read = await reopened.read();
  expect(read.status).toBe("valid");
  if (read.status === "valid")
    expect(read.data.tabs[0].relativePath).toBe("nested/a.md");
  expect((await store.write(metadata())).status).toBe("rejected");
  await reopened.close();
});

test("invalid identity, paths, extra fields, duplicates and active index never overwrite", async () => {
  const f = await fixture(),
    store = createMainTabMetadataStore(f.dir),
    good = metadata();
  await store.write(good);
  const before = await readFile(f.path);
  const tab = good.tabs[0];
  const invalid: unknown[] = [
    Object.assign([], { tabs: [], activeIndex: null }),
    { ...good, tabs: [Object.assign([], tab)] },
    { ...good, activeIndex: 1 },
    { ...good, activeIndex: null },
    { tabs: [], activeIndex: 0 },
    { ...good, body: "forbidden" },
    { tabs: [tab, tab], activeIndex: 0 },
    { tabs: new Array(1), activeIndex: 0 },
    ...[
      "/absolute.md",
      "../escape.md",
      "a//b.md",
      "a/./b.md",
      "a.txt",
      "a\0.md",
    ].map((relativePath) => ({ ...good, tabs: [{ ...tab, relativePath }] })),
    ...[
      { rootId: "runtime-handle" },
      { fingerprint: "1:2:3:4" },
      { fingerprint: "01:2:3" },
      { pinned: "true" },
      { mode: "reading" },
      { handle: randomUUID() },
    ].map((override) => ({ ...good, tabs: [{ ...tab, ...override }] })),
  ];
  for (const value of invalid) {
    expect(validMainTabSessionMetadata(value)).toBe(false);
    expect(await store.write(value)).toEqual({
      status: "rejected",
      reason: "invalid",
    });
  }
  expect(await readFile(f.path)).toEqual(before);
  expect(await store.write({ tabs: [], activeIndex: null })).toEqual({
    status: "committed",
  });
  await store.close();
});

test("legacy future corrupt oversized and duplicate-key files retain exact original bytes", async () => {
  for (const [source, status] of [
    [JSON.stringify(metadata()), "legacy"],
    ['{"version":8,"data":{}}', "future"],
    ["broken", "corrupt"],
    [
      '{"version":1,"version":1,"data":{"tabs":[],"activeIndex":null}}',
      "corrupt",
    ],
    [" ".repeat(MAIN_TAB_METADATA_MAX_BYTES + 1), "too-large"],
  ] as const) {
    const f = await fixture();
    await writeFile(f.path, source);
    const store = createMainTabMetadataStore(f.dir);
    expect(await store.read()).toEqual({ status });
    expect((await store.write(metadata())).status).toBe("rejected");
    expect(await readFile(f.path, "utf8")).toBe(source);
    await store.close();
  }
});

test("tab root and exact serialized byte capacities reject without truncating", async () => {
  const f = await fixture(),
    store = createMainTabMetadataStore(f.dir),
    initial = metadata();
  await store.write(initial);
  const before = await readFile(f.path);
  const tab = initial.tabs[0];
  expect(
    (
      await store.write({
        tabs: Array.from(
          { length: MAIN_TAB_METADATA_MAX_TABS + 1 },
          (_, i) => ({ ...tab, relativePath: `${i}.md` })
        ),
        activeIndex: 0,
      })
    ).status
  ).toBe("rejected");
  expect(
    (
      await store.write({
        tabs: Array.from({ length: WORKSPACE_MAX_ROOTS + 1 }, () => ({
          ...tab,
          rootId: randomUUID(),
        })),
        activeIndex: 0,
      })
    ).status
  ).toBe("rejected");
  const big = {
    tabs: Array.from({ length: MAIN_TAB_METADATA_MAX_TABS }, (_, i) => ({
      ...tab,
      relativePath: `${i}-${"中".repeat(4000)}.md`,
    })),
    activeIndex: 0,
  };
  expect(validMainTabSessionMetadata(big)).toBe(true);
  expect(Buffer.byteLength(encode(big))).toBeGreaterThan(
    MAIN_TAB_METADATA_MAX_BYTES
  );
  expect(await store.write(big)).toEqual({
    status: "rejected",
    reason: "capacity",
  });
  expect(await readFile(f.path)).toEqual(before);
  await store.close();
});

test("observed backup failure preserves saved state and retry backs up exact previous bytes", async () => {
  const f = await fixture(),
    store = createMainTabMetadataStore(f.dir),
    a = metadata(),
    b = metadata();
  await store.write(a);
  const before = await readFile(f.path);
  await mkdir(`${f.path}.bak`);
  expect(await store.write(b)).toEqual({ status: "unknown", reason: "io" });
  expect(await store.read()).toEqual({ status: "valid", data: a });
  expect(await readFile(f.path)).toEqual(before);
  await rm(`${f.path}.bak`, { recursive: true });
  expect(await store.write(b)).toEqual({ status: "committed" });
  expect(await readFile(`${f.path}.bak`)).toEqual(before);
  await store.close();
});
