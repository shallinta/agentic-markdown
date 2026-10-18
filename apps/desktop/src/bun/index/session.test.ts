import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodeChanges, validResult } from "./protocol";
import { resolveIndexResources } from "./resources";
import { createIndexSession } from "./session";

test("limited-v1 wire rejects malformed shape before encoding", () => {
  for (const value of [
    null,
    [],
    [{ kind: "delete", id: "a", raw: "ignored" }],
    [{ kind: "put", id: "a", path: "x", raw: "\ud800" }],
  ])
    expect(() => encodeChanges(value)).toThrow();
  expect(validResult({ ok: true, generation: 0 }, "query")).toBe(false);
  expect(
    validResult(
      {
        ok: true,
        generation: 0,
        hits: [
          { id: "a", from: 0, to: 1 },
          { id: "a", from: 0, to: 1 },
        ],
      },
      "query"
    )
  ).toBe(false);
});

test("resource resolver never searches cwd or a historical fallback", () => {
  expect(resolveIndexResources("/unrelated/place")).toBeNull();
  expect(resolveIndexResources("/missing/app/bun")).toBeNull();
});

test("formal native exports no experimental methods", () => {
  const resources = resolveIndexResources(import.meta.dir);
  expect(resources).not.toBeNull();
  const native: unknown = createRequire(import.meta.url)(resources!.native);
  expect(Object.getOwnPropertyNames(native)).toEqual([
    "version",
    "open",
    "call",
    "close",
  ]);
});

test("real resource copies reject each missing artifact and invalid manifest/hash", async () => {
  const source = resolveIndexResources(import.meta.dir);
  expect(source).not.toBeNull();
  if (!source) throw Error("Native build required");
  const names = ["index-primitives.node", "index-worker.js", "index-host.js"];
  const manifest = await readFile(join(source.directory, "index-build.json"));
  for (const fault of [...names, "manifest", "hash", "healthy"]) {
    const root = await mkdtemp(join(tmpdir(), "f064c-resources-"));
    const directory = join(root, "native");
    await mkdir(directory);
    for (const name of names)
      if (name !== fault)
        await copyFile(join(source.directory, name), join(directory, name));
    await writeFile(
      join(directory, "index-build.json"),
      fault === "manifest" ? "{}" : manifest
    );
    if (fault === "hash")
      await writeFile(join(directory, "index-worker.js"), "corrupted");
    const result = resolveIndexResources(join(root, "bun"));
    if (fault === "healthy") expect(result?.directory).toBe(directory);
    else expect(result).toBeNull();
  }
});

test("formal postverification rejects gram false positives and long queries scan exactly", async () => {
  const root = await mkdtemp(join(tmpdir(), "f064c-query-"));
  const s = createIndexSession();
  const scalars = Array.from({ length: 131 }, (_, i) =>
    String.fromCodePoint(0x4e00 + i)
  );
  const query = scalars.join("");
  expect(
    new Set(
      scalars.slice(0, -2).map((_, i) => scalars.slice(i, i + 3).join(""))
    ).size
  ).toBe(129);
  expect(await s.open(join(root, "index"), "create-new")).toEqual({
    ok: true,
    generation: 0,
  });
  expect(
    await s.applyAndCommit([
      { kind: "put", id: "g", path: "g", raw: "abcXbcd" },
      { kind: "put", id: "u", path: "u", raw: query },
      { kind: "put", id: "v", path: "v", raw: [...scalars].reverse().join("") },
    ])
  ).toEqual({ ok: true, generation: 1 });
  expect(await s.query("abcd")).toEqual({ ok: true, generation: 1, hits: [] });
  expect(await s.query(query)).toEqual({
    ok: true,
    generation: 1,
    hits: [{ id: "u", from: 0, to: 131 }],
  });
  expect(await s.close()).toEqual({ ok: true, generation: 1 });
}, 15_000);

async function snapshot(path: string) {
  const entries = await readdir(path, { withFileTypes: true });
  const files: Record<string, string> = {};
  for (const entry of entries)
    if (entry.isFile())
      files[entry.name] = createHash("sha256")
        .update(await readFile(join(path, entry.name)))
        .digest("hex");
  return files;
}
test("formal session CRUD, exact spans, latest/busy and reader generation naturally close", async () => {
  const root = await mkdtemp(join(tmpdir(), "f064c-crud-")),
    path = join(root, "index");
  const session = createIndexSession();
  expect(await session.open(path, "create-new")).toEqual({
    ok: true,
    generation: 0,
  });
  const change = session.applyAndCommit([
    { kind: "put", id: "a", path: "a.md", raw: "\uFEFF中文\r\n😀x" },
  ]);
  expect(await session.applyAndCommit([{ kind: "delete", id: "a" }])).toEqual({
    ok: false,
    error: "BUSY",
    accepted: false,
  });
  const obsolete = session.query("not-present"),
    latest = session.query("中文");
  expect(await obsolete).toEqual({
    ok: false,
    error: "CANCELLED",
    accepted: false,
  });
  expect(await change).toEqual({ ok: true, generation: 1 });
  expect(await latest).toEqual({
    ok: true,
    generation: 1,
    hits: [{ id: "a", from: 1, to: 3 }],
  });
  expect(await session.query("😀")).toEqual({
    ok: true,
    generation: 1,
    hits: [{ id: "a", from: 5, to: 7 }],
  });
  expect(
    await session.applyAndCommit([
      { kind: "put", id: "a", path: "a.md", raw: "updated" },
    ])
  ).toEqual({ ok: true, generation: 2 });
  expect(await session.query("中文")).toEqual({
    ok: true,
    generation: 2,
    hits: [],
  });
  expect(await session.applyAndCommit([{ kind: "delete", id: "a" }])).toEqual({
    ok: true,
    generation: 3,
  });
  expect(
    await session.applyAndCommit([
      { kind: "put", id: "b", path: "a.md", raw: "new" },
    ])
  ).toEqual({ ok: true, generation: 4 });
  const close = session.close();
  expect(session.close()).toBe(close);
  expect(await close).toEqual({ ok: true, generation: 4 });
  const before = await snapshot(path);
  const reader = createIndexSession();
  expect(await reader.open(path, "reader-only")).toEqual({
    ok: true,
    generation: 4,
  });
  expect(await reader.query("new")).toEqual({
    ok: true,
    generation: 4,
    hits: [{ id: "b", from: 0, to: 3 }],
  });
  expect(await reader.applyAndCommit([{ kind: "delete", id: "b" }])).toEqual({
    ok: false,
    error: "READONLY",
    accepted: false,
  });
  expect(await reader.close()).toEqual({ ok: true, generation: 4 });
  expect(await snapshot(path)).toEqual(before);
}, 15_000);

test("projected live limits reject whole batch and close cancels pending query", async () => {
  const root = await mkdtemp(join(tmpdir(), "f064c-limit-"));
  const s = createIndexSession();
  expect((await s.open(join(root, "index"), "create-new")).ok).toBe(true);
  expect(
    await s.applyAndCommit([
      { kind: "put", id: "a", path: "a", raw: "a".repeat(65_536) },
    ])
  ).toEqual({ ok: true, generation: 1 });
  expect(
    await s.applyAndCommit([{ kind: "put", id: "b", path: "b", raw: "x" }])
  ).toEqual({ ok: false, error: "LIMIT", accepted: false });
  expect(await s.query("x")).toEqual({ ok: true, generation: 1, hits: [] });
  const active = s.query("a"),
    latest = s.query("x"),
    close = s.close();
  expect(await latest).toEqual({
    ok: false,
    error: "CANCELLED",
    accepted: false,
  });
  expect((await active).ok).toBe(true);
  expect(await close).toEqual({ ok: true, generation: 1 });
}, 15_000);

test("future schema refuses without repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "f064c-schema-")),
    path = join(root, "index");
  const s = createIndexSession();
  expect((await s.open(path, "create-new")).ok).toBe(true);
  expect(
    (await s.applyAndCommit([{ kind: "put", id: "a", path: "a", raw: "x" }])).ok
  ).toBe(true);
  await s.close();
  await writeFile(join(path, "bridge.schema"), "future=999\n");
  const before = await snapshot(path);
  const reader = createIndexSession();
  expect(await reader.open(path, "reader-only")).toEqual({
    ok: false,
    error: "SCHEMA",
    accepted: false,
  });
  await reader.close();
  expect(await snapshot(path)).toEqual(before);
}, 15_000);
