import { expect, test, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSettingsStore } from "@agentic-markdown/shared/server";

import { createHiddenPreferences } from "./preferences";

test("hidden removal deletes only its key; strict read never silently filters malformed source", async () => {
  const root = await mkdtemp(join(tmpdir(), "folder-prefs-"));
  const path = join(root, "hidden-files.json");
  const a = createHash("sha256").update("/a").digest("hex");
  try {
    const prefs = createHiddenPreferences(root);
    expect((await prefs.remove!("/a")).status).toBe("committed");
    expect(await readFile(path, "utf8").catch(() => null)).toBeNull();
    await prefs.set("/a", true);
    await prefs.set("/b", true);
    const beforeBudget = await readFile(path, "utf8");
    expect((await prefs.remove!("/a", 0)).status).toBe("rejected");
    expect(await readFile(path, "utf8")).toBe(beforeBudget);
    const removed = await prefs.remove!("/a");
    expect(removed.status).toBe("committed");
    expect(await removed.query()).toBe("committed");
    expect(await prefs.get("/b")).toBe(true);
    expect(await readFile(path, "utf8")).not.toContain(a);
    for (const source of [
      `{"version":1,"data":{"${a}":true,"bad":false}}`,
      `{"version":1,"data":{"${a}":true,"${a}":false}}`,
      `{"version":1,"data":{"${a}":true},"extra":true}`,
      `{"version":2,"data":{"${a}":true}}`,
      "{broken",
    ]) {
      await writeFile(path, source);
      expect((await prefs.remove!("/a")).status).toBe("rejected");
      expect(await readFile(path, "utf8")).toBe(source);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed real backup leaves old map authoritative and removal rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "folder-backup-"));
  const path = join(root, "hidden-files.json");
  try {
    const prefs = createHiddenPreferences(root);
    await prefs.set("/a", true);
    const before = await readFile(path, "utf8");
    await mkdir(`${path}.bak`);
    const result = await prefs.remove!("/a");
    expect(result.status).toBe("rejected");
    expect(await readFile(path, "utf8")).toBe(before);
    await rm(`${path}.bak`, { recursive: true });
    await prefs.set("/a", false);
    expect(await result.query()).toBe("rejected");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("persisted inspection is bounded and nonmigrating; observed write stays in one queue turn", async () => {
  const root = await mkdtemp(join(tmpdir(), "folder-store-"));
  const path = join(root, "settings.json");
  const store = createSettingsStore<Record<string, boolean>>(
    path,
    (value) => value as Record<string, boolean>,
    {
      maxBytes: 128,
      validateData: (value) =>
        !!value &&
        typeof value === "object" &&
        Object.values(value).every((item) => typeof item === "boolean"),
    }
  );
  try {
    expect(await store.readPersisted()).toEqual({ status: "missing" });
    await writeFile(path, '{"a":true}');
    expect(await store.readPersisted()).toEqual({
      status: "valid",
      format: "legacy",
      data: { a: true },
    });
    expect(await readFile(path, "utf8")).toBe('{"a":true}');
    const result = await store.updateObserved(() => ({}));
    expect(result).toEqual({
      attempted: true,
      confirmed: true,
      before: { a: true },
      beforeFormat: "legacy",
      expected: {},
      persisted: { status: "valid", format: "version1", data: {} },
    });
    await writeFile(path, " ".repeat(129));
    expect(await store.readPersisted()).toEqual({ status: "too-large" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real post-rename cleanup error is classified by strict disk receipt, then locked terminal", async () => {
  const root = await mkdtemp(join(tmpdir(), "folder-rename-"));
  const path = join(root, "hidden-files.json");
  const a = createHash("sha256").update("/a").digest("hex");
  const actualRm = fs.rm;
  let mutate: "none" | "legacy" | "missing" = "none";
  const prefs = createHiddenPreferences(root);
  let hook: { mockRestore(): void } | undefined;
  try {
    for (const mode of ["none", "legacy", "missing"] as const) {
      await writeFile(
        path,
        JSON.stringify({ version: 1, data: { [a]: true } })
      );
      mutate = mode;
      hook = spyOn(fs, "rm").mockImplementation(async (target, options) => {
        if (
          typeof target === "string" &&
          target.startsWith(`${path}.${process.pid}.`) &&
          target.endsWith(".tmp")
        ) {
          if (mutate === "legacy") await writeFile(path, "{}");
          if (mutate === "missing") await actualRm(path);
          throw Error("injected cleanup after main rename");
        }
        return actualRm(target, options);
      });
      const result = await prefs.remove!("/a");
      hook.mockRestore();
      hook = undefined;
      expect(result.status).toBe(mode === "none" ? "committed" : "unknown");
      if (mode !== "none") {
        expect(await result.query()).toBe("unknown");
        await writeFile(path, '{"version":1,"data":{}}');
        const first = result.query(), second = result.query();
        expect(second).toBe(first); // one read receipt, not two racing terminal projections
        expect(await second).toBe("committed");
        await prefs.set("/a", true);
        expect(await first).toBe("committed");
      }
      await prefs.set("/a", true);
      expect(await result.query()).toBe("committed");
    }
  } finally {
    hook?.mockRestore();
    await actualRm(root, { recursive: true, force: true });
  }
});
