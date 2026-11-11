import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runChild(operation: "capture" | "reselect" | "different" | "replaced", directory: string) {
  const child = Bun.spawn([
    process.execPath, join(import.meta.dir, "main-tab-standalone-source-child.ts"), operation, directory,
  ], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  return JSON.parse(stdout) as Record<string, unknown>;
}

const hash = (body: string) => createHash("sha256").update(body).digest("hex");

test("fresh standalone picker grants match the same file across Bun processes", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "standalone-tab-session-")));
  const original = join(directory, "original");
  const different = join(directory, "different");
  const path = join(original, "same.md");
  const retired = join(original, "retired.md");
  const other = join(different, "same.md");
  const history = join(directory, "source.json");
  const firstBody = "\uFEFF# 原稿 📄\r\n";
  const currentBody = "\uFEFF# 最新正文 📄\r\n";
  try {
    await mkdir(original);
    await mkdir(different);
    await writeFile(path, firstBody);
    await writeFile(other, currentBody);
    const first = await runChild("capture", directory);
    expect(first).toMatchObject({
      status: "ready", hash: hash(firstBody), currentBeforeRelease: true,
      releaseSucceeded: true, currentAfterRelease: false,
    });
    const before = await readFile(history);
    expect((await stat(history)).mode & 0o777).toBe(0o600);
    const originalStat = await stat(path, { bigint: true });
    await writeFile(path, currentBody);
    expect(await stat(path, { bigint: true })).toMatchObject({ dev: originalStat.dev, ino: originalStat.ino });
    const next = await runChild("reselect", directory);
    expect(next).toMatchObject({
      status: "ready", hash: hash(currentBody), currentBeforeRelease: true,
      releaseSucceeded: true, currentAfterRelease: false,
    });
    expect(next.documentId).not.toBe(first.documentId);

    const mismatched = { status: "unavailable", hash: hash(currentBody), currentBeforeRelease: false,
      releaseSucceeded: true, currentAfterRelease: false };
    expect(await runChild("different", directory)).toMatchObject(mismatched);
    await rename(path, retired);
    await writeFile(path, currentBody);
    expect((await stat(path, { bigint: true })).ino).not.toBe(originalStat.ino);
    expect(await runChild("replaced", directory)).toMatchObject(mismatched);
    expect(await readFile(history)).toEqual(before);
    for (const file of [path, retired, other]) expect(await readFile(file, "utf8")).toBe(currentBody);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
