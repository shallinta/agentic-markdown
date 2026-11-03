import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { record } from "./protocol";
import { createIndexSession } from "./session";

function metadataObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!record(value)) throw Error("Fixture metadata must be an object");
  return value;
}

test("writer-existing resumes CRUD and persistent generation under exclusive ownership", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "f064d-crud-")), "index");
  const first = createIndexSession();
  expect(await first.open(path, "create-new")).toEqual({
    ok: true,
    generation: 0,
  });
  expect(
    await first.applyAndCommit([
      { kind: "put", id: "a", path: "a", raw: "\uFEFF中文\r\n😀x" },
    ])
  ).toEqual({ ok: true, generation: 1 });
  await first.close();
  const writer = createIndexSession();
  expect(await writer.open(path, "writer-existing")).toEqual({
    ok: true,
    generation: 1,
  });
  expect(await writer.query("中文")).toEqual({
    ok: true,
    generation: 1,
    hits: [{ id: "a", from: 1, to: 3 }],
  });
  expect(await writer.query("😀")).toEqual({
    ok: true,
    generation: 1,
    hits: [{ id: "a", from: 5, to: 7 }],
  });
  const contender = createIndexSession();
  expect(await contender.open(path, "writer-existing")).toEqual({
    ok: false,
    error: "UNKNOWN",
    accepted: true,
  });
  await contender.close();
  expect(
    await writer.applyAndCommit([
      { kind: "put", id: "a", path: "a", raw: "updated" },
    ])
  ).toEqual({ ok: true, generation: 2 });
  expect(await writer.applyAndCommit([{ kind: "delete", id: "a" }])).toEqual({
    ok: true,
    generation: 3,
  });
  expect(
    await writer.applyAndCommit([
      { kind: "put", id: "b", path: "a", raw: "new" },
    ])
  ).toEqual({ ok: true, generation: 4 });
  expect(await writer.close()).toEqual({ ok: true, generation: 4 });
  const next = createIndexSession();
  expect(await next.open(path, "writer-existing")).toEqual({
    ok: true,
    generation: 4,
  });
  expect(await next.query("new")).toEqual({
    ok: true,
    generation: 4,
    hits: [{ id: "b", from: 0, to: 3 }],
  });
  await next.close();
}, 15_000);

test("initial zero is distinct from committed empty and invalid payload releases writer", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "f064d-meta-")), "index");
  const first = createIndexSession();
  await first.open(path, "create-new");
  await first.close();
  const writer = createIndexSession();
  expect(await writer.open(path, "writer-existing")).toEqual({
    ok: true,
    generation: 0,
  });
  await writer.applyAndCommit([{ kind: "put", id: "a", path: "a", raw: "x" }]);
  await writer.applyAndCommit([{ kind: "delete", id: "a" }]);
  await writer.close();
  const metaPath = join(path, "meta.json");
  const healthy = await readFile(metaPath, "utf8");
  for (const payload of [undefined, "broken", "bridge-v1:9007199254740992"]) {
    const metadata = metadataObject(healthy);
    expect(Number(metadata.opstamp)).toBeGreaterThan(0);
    if (payload === undefined) delete metadata.payload;
    else metadata.payload = payload;
    await writeFile(metaPath, JSON.stringify(metadata));
    for (const mode of ["writer-existing", "reader-only"] as const) {
      const rejected = createIndexSession();
      expect(await rejected.open(path, mode)).toEqual({
        ok: false,
        error: "SCHEMA",
        accepted: false,
      });
      await rejected.close();
    }
    await writeFile(metaPath, healthy);
    const recovered = createIndexSession();
    expect(await recovered.open(path, "writer-existing")).toEqual({
      ok: true,
      generation: 2,
    });
    expect(await recovered.query("x")).toEqual({
      ok: true,
      generation: 2,
      hits: [],
    });
    await recovered.close();
  }
  const saturated = metadataObject(healthy);
  saturated.payload = "bridge-v1:9007199254740991";
  await writeFile(metaPath, JSON.stringify(saturated));
  const fullGeneration = createIndexSession();
  expect(await fullGeneration.open(path, "writer-existing")).toEqual({
    ok: true,
    generation: Number.MAX_SAFE_INTEGER,
  });
  expect(
    await fullGeneration.applyAndCommit([
      { kind: "put", id: "a", path: "a", raw: "x" },
    ])
  ).toEqual({ ok: false, error: "LIMIT", accepted: false });
  expect(await fullGeneration.query("x")).toEqual({
    ok: true,
    generation: Number.MAX_SAFE_INTEGER,
    hits: [],
  });
  expect(await fullGeneration.close()).toEqual({
    ok: true,
    generation: Number.MAX_SAFE_INTEGER,
  });
  const schemaPath = join(path, "bridge.schema");
  await writeFile(schemaPath, "future=999\n");
  const future = createIndexSession();
  expect(await future.open(path, "writer-existing")).toEqual({
    ok: false,
    error: "SCHEMA",
    accepted: false,
  });
  await future.close();
  expect(await readFile(schemaPath, "utf8")).toBe("future=999\n");
}, 15_000);

test("reopened live budget is cumulative and missing cache is never created", async () => {
  const root = await mkdtemp(join(tmpdir(), "f064d-limit-"));
  const missing = createIndexSession();
  expect(await missing.open(join(root, "missing"), "writer-existing")).toEqual({
    ok: false,
    error: "SCHEMA",
    accepted: false,
  });
  await missing.close();
  expect(await Bun.file(join(root, "missing/meta.json")).exists()).toBe(false);
  const path = join(root, "index");
  const first = createIndexSession();
  await first.open(path, "create-new");
  await first.applyAndCommit([
    { kind: "put", id: "a", path: "a", raw: "a".repeat(65_536) },
  ]);
  await first.close();
  const writer = createIndexSession();
  expect(await writer.open(path, "writer-existing")).toEqual({
    ok: true,
    generation: 1,
  });
  expect(
    await writer.applyAndCommit([{ kind: "put", id: "b", path: "b", raw: "x" }])
  ).toEqual({ ok: false, error: "LIMIT", accepted: false });
  expect(await writer.query("x")).toEqual({
    ok: true,
    generation: 1,
    hits: [],
  });
  expect(
    await writer.applyAndCommit([
      { kind: "delete", id: "a" },
      { kind: "put", id: "b", path: "b", raw: "x" },
    ])
  ).toEqual({ ok: true, generation: 2 });
  await writer.close();
}, 15_000);
