import { expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MainTabSessionMetadata } from "./main-tab-metadata";

async function child(
  operation: "write" | "read",
  directory: string
): Promise<unknown> {
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "main-tab-recovery-child.ts"),
      operation,
      directory,
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exit).toBe(0);
  expect(stderr).toBe("");
  return JSON.parse(stdout) as unknown;
}

test("separate real processes capture and bind clean tabs, then resolve only reauthorized unchanged files", async () => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "main-tab-recovery-"))
  );
  const paths = [join(dir, "one/same"), join(dir, "two/same")];
  const originals = [
    join(paths[0], "a.md"),
    join(paths[0], "replace.md"),
    join(paths[1], "a.md"),
  ];
  try {
    for (const path of paths) await mkdir(path, { recursive: true });
    for (const [index, path] of originals.entries())
      await writeFile(path, `PRIVATE_SYNTHETIC_${index}\n`);
    const written = (await child("write", dir)) as {
      status: string;
      data: MainTabSessionMetadata;
      openCount: number;
    };
    expect(written.status).toBe("written");
    expect(written.openCount).toBe(3);
    expect(written.data.activeIndex).toBe(2);
    expect(
      written.data.tabs.map((tab) => [tab.relativePath, tab.pinned, tab.mode])
    ).toEqual([
      ["a.md", true, "source"],
      ["replace.md", false, "editing"],
      ["a.md", false, "editing"],
    ]);
    expect(written.data.tabs[0].rootId).not.toBe(written.data.tabs[2].rootId);
    const record = join(dir, "metadata/main-tab-session-probe.json"),
      before = await readFile(record);
    await rename(originals[1], join(paths[0], "previous.md"));
    await writeFile(originals[1], "NEW_PHYSICAL_IDENTITY\n");
    const resolved = await child("read", dir);
    expect(resolved).toEqual({
      status: "resolved",
      initial: { pending: 2, live: 0, grants: 0 },
      partial: { indices: [0], pending: 1, current: true },
      staleEarly: true,
      recovered: [0, 2].map((savedIndex) => ({
        savedIndex,
        ...written.data.tabs[savedIndex],
      })),
      activeIndex: 2,
      final: { grants: 0, tabs: 0, live: 2 },
    });
    expect(await readFile(record)).toEqual(before);
    expect(before.toString()).not.toContain("PRIVATE_SYNTHETIC");
    expect(before.toString()).not.toContain(dir);
    expect(await readFile(originals[0], "utf8")).toBe("PRIVATE_SYNTHETIC_0\n");
    expect(await readFile(originals[2], "utf8")).toBe("PRIVATE_SYNTHETIC_2\n");
    expect(await readFile(originals[1], "utf8")).toBe(
      "NEW_PHYSICAL_IDENTITY\n"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
