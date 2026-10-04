import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHiddenPreferences } from "./preferences";

test("hidden preferences merge concurrent roots and preserve corrupt/future settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hidden-preferences-"));
  try {
    const store = createHiddenPreferences(dir);
    expect(await store.get("/a")).toBe(false);
    await Promise.all([store.set("/a", true), store.set("/b", true)]);
    expect(await store.get("/a")).toBe(true);
    expect(await store.get("/b")).toBe(true);
    await Promise.all([store.set("/a", false), store.set("/a", true)]);
    expect(await createHiddenPreferences(dir).get("/a")).toBe(true);
    const path = join(dir, "hidden-files.json");
    expect(await readFile(path, "utf8")).not.toContain("/a");
    for (const invalid of ["broken", '{"version":2,"data":{}}']) {
      await writeFile(path, invalid);
      expect(await store.get("/a")).toBe(false);
      expect(
        await store.set("/a", true).then(
          () => false,
          () => true
        )
      ).toBe(true);
      expect(await readFile(path, "utf8")).toBe(invalid);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
