import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMainTabCheckpointMetadataStore } from "./main-tab-metadata";

const probeName = "main-tab-session-mixed-probe.json";
const officialName = "main-tab-session-checkpoint.json";
const rootRow = {
  rootId: "00000000-0000-4000-8000-000000000001", relativePath: "nested/a.md",
  fingerprint: "1:2:3", pinned: true, mode: "source",
} as const;
const position = {
  from: 27, offset: -12.25, ratio: 0.7,
  block: { contentHash: "a".repeat(64), hash: "b".repeat(64), occurrence: 0, uniqueAtCapture: true },
};
const legacy = { tabs: [rootRow], activeIndex: 0 };
const positioned = { schemaVersion: 2, tabs: [{ ...rootRow, position }], activeIndex: 0 };
const envelope = (data: unknown) => ` {"version":1, "data":${JSON.stringify(data)}}\n`;

function mixedCandidate(directory: string) {
  const root = { kind: "root", ...rootRow, position };
  const standalone = {
    kind: "standalone", path: join(directory, "not-opened", "独立.markdown"),
    fingerprint: "1:4:5", pinned: false, mode: "editing", position: { from: 11, offset: 3, ratio: 0.5 },
  };
  const otherRoot = { ...root, relativePath: "nested/b.md", fingerprint: "1:8:3" };
  return { schemaVersion: 3, tabs: [root, standalone, otherRoot], activeIndex: 1 };
}

async function child(operation: "read" | "write" | "stale", directory: string, input?: string) {
  const proc = Bun.spawn([
    process.execPath, join(import.meta.dir, "main-tab-mixed-metadata-child.ts"), operation, directory,
    ...(input ? [input] : []),
  ], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  expect(code).toBe(0);
  expect(stderr).toBe("");
  return JSON.parse(stdout) as unknown;
}

async function expectMissing(path: string) {
  const error = await stat(path).then(() => undefined, (reason: unknown) => reason);
  expect(error).toMatchObject({ code: "ENOENT" });
}

test("mixed checkpoint round-trips between processes and preserves v1 and v2 source bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mixed-main-tab-migration-"));
  const probe = join(directory, probeName);
  const official = join(directory, officialName);
  const candidatePath = join(directory, "candidate.json");
  const expectedPath = join(directory, "expected.json");
  const candidate = mixedCandidate(directory);
  const originalOfficial = envelope(positioned);
  const officialStore = createMainTabCheckpointMetadataStore(directory);
  try {
    await writeFile(official, originalOfficial);
    await writeFile(candidatePath, JSON.stringify(candidate));
    for (const original of [legacy, positioned]) {
      const projected = { schemaVersion: 3, tabs: original.tabs.map(tab => ({ kind: "root", ...tab })), activeIndex: 0 };
      const oldBytes = envelope(original);
      await rm(`${probe}.bak`, { force: true });
      await writeFile(probe, oldBytes);
      await writeFile(expectedPath, JSON.stringify(projected));
      expect(await child("read", directory, expectedPath)).toEqual({ status: "valid", matches: true });
      expect(await readFile(probe, "utf8")).toBe(oldBytes);
      await expectMissing(`${probe}.bak`);

      expect(await child("write", directory, candidatePath)).toEqual({ status: "committed" });
      expect(await child("read", directory, candidatePath)).toEqual({ status: "valid", matches: true });
      expect(JSON.parse(await readFile(probe, "utf8"))).toEqual({ version: 1, data: candidate });
      const published = await readFile(probe);
      expect(await child("write", directory, candidatePath)).toEqual({ status: "committed" });
      expect(await readFile(probe)).toEqual(published);
      expect(await readFile(`${probe}.bak`, "utf8")).toBe(oldBytes);
      await expectMissing(join(directory, "not-opened"));
    }
    expect(await officialStore.read()).toMatchObject({ status: "valid", positioned });
    expect(await readFile(official, "utf8")).toBe(originalOfficial);
    await expectMissing(`${official}.bak`);
  } finally {
    await officialStore.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("protected and stale mixed writes preserve both record and existing backup bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mixed-main-tab-protected-"));
  const probe = join(directory, probeName);
  const backup = `${probe}.bak`;
  const candidatePath = join(directory, "candidate.json");
  const candidate = mixedCandidate(directory);
  try {
    await writeFile(candidatePath, JSON.stringify(candidate));
    await writeFile(backup, "old backup\n");
    for (const [bytes, reason] of [
      [envelope({ ...candidate, schemaVersion: 4 }), "future"],
      [JSON.stringify({ version: 2, data: candidate }), "future"],
      ['{"version":1,"version":1,"data":{}}\n', "corrupt"],
      [JSON.stringify(legacy), "legacy"],
    ]) {
      await writeFile(probe, bytes);
      expect(await child("read", directory)).toEqual({ status: reason });
      expect(await child("write", directory, candidatePath)).toEqual({ status: "rejected", reason });
      expect(await readFile(probe, "utf8")).toBe(bytes);
      expect(await readFile(backup, "utf8")).toBe("old backup\n");
    }
    const bytes = envelope(positioned);
    await writeFile(probe, bytes);
    expect(await child("stale", directory, candidatePath)).toEqual({ status: "rejected", reason: "stale" });
    expect(await readFile(probe, "utf8")).toBe(bytes);
    expect(await readFile(backup, "utf8")).toBe("old backup\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
