import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSourceWrappingStore } from "./source-wrapping";

test("source wrapping defaults on and persists isolated boolean settings across instances", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentic-wrapping-"));
  try {
    const store = createSourceWrappingStore(dir);
    expect(await store.get()).toBe(true);
    await store.set(false);
    expect(await createSourceWrappingStore(dir).get()).toBe(false);
    const record: unknown = JSON.parse(
      await readFile(join(dir, "source-wrapping.json"), "utf8")
    );
    expect(record).toMatchObject({ data: { enabled: false } });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("malformed persisted preference defaults on and failed writes reject", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentic-wrapping-"));
  try {
    await writeFile(
      join(dir, "source-wrapping.json"),
      JSON.stringify({ enabled: "no" })
    );
    expect(await createSourceWrappingStore(dir).get()).toBe(true);
    const file = join(dir, "not-a-directory");
    await writeFile(file, "fixture");
    const failed = await createSourceWrappingStore(file)
      .set(false)
      .then(
        () => false,
        () => true
      );
    expect(failed).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
