import { expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMixedMainTabMetadataStore } from "./main-tab-mixed-metadata-store";

const probeName = "main-tab-session-mixed-probe.json";
const root = {
  rootId: "00000000-0000-4000-8000-000000000001",
  relativePath: "old.md",
  fingerprint: "1:2:3",
  mode: "editing",
  pinned: false,
} as const;
const candidate = {
  schemaVersion: 3,
  tabs: [{ ...root, kind: "root", relativePath: "proposed.md" }],
  activeIndex: 0,
};
const encoded = (data: unknown) => Buffer.from(` {"data":${JSON.stringify(data)},"version":1}\r\n`);

function stagedAuthority(directory: string) {
  const name = readdirSync(directory).find((file) => file.startsWith(`${probeName}.`) &&
    !file.startsWith(`${probeName}.bak.`) && file.endsWith(".tmp"));
  return name && readFileSync(join(directory, name));
}

test("late future body keeps its exact bytes after the old authority has been backed up", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mixed-checkpoint-late-future-"));
  const path = join(directory, probeName);
  const backup = `${path}.bak`;
  const store = createMixedMainTabMetadataStore(directory);
  const previous = encoded({ tabs: [root], activeIndex: 0 });
  const future = encoded({ schemaVersion: 4, text: "未来格式", tabs: [] });
  let injected: { staged: Buffer; authority: Buffer; backup: Buffer } | undefined;
  try {
    await writeFile(path, previous);
    await writeFile(backup, "an earlier backup\n");
    const result = await store.write(candidate, () => {
      if (injected) return true;
      const staged = stagedAuthority(directory);
      if (!staged) return true;
      const atInjection = { staged, authority: readFileSync(path), backup: readFileSync(backup) };
      writeFileSync(path, future);
      injected = atInjection;
      return true;
    });
    if (!injected) throw Error("No competing write at authoritative publication");
    expect(JSON.parse(injected.staged.toString("utf8"))).toEqual({ version: 1, data: candidate });
    expect(injected.authority).toEqual(previous);
    expect(injected.backup).toEqual(previous);
    expect(result).toEqual({ status: "rejected", reason: "stale" });
    expect(await readFile(path)).toEqual(future);
    expect(await readFile(backup)).toEqual(previous);
    expect(await store.read()).toEqual({ status: "future" });
    expect((await readdir(directory)).sort()).toEqual([probeName, `${probeName}.bak`]);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a competing file appearing before the first rename is retained without a backup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mixed-checkpoint-late-create-"));
  const path = join(directory, probeName);
  const store = createMixedMainTabMetadataStore(directory);
  const competing = { schemaVersion: 3 as const, tabs: [], activeIndex: null };
  const bytes = encoded(competing);
  let injected: Buffer | undefined;
  try {
    expect(await store.read()).toEqual({ status: "missing" });
    const result = await store.write(candidate, () => {
      if (injected) return true;
      const staged = stagedAuthority(directory);
      if (!staged) return true;
      writeFileSync(path, bytes, { flag: "wx" });
      injected = staged;
      return true;
    });
    if (!injected) throw Error("No competing create at first publication");
    expect(JSON.parse(injected.toString("utf8"))).toEqual({ version: 1, data: candidate });
    expect(result).toEqual({ status: "rejected", reason: "stale" });
    expect(await readFile(path)).toEqual(bytes);
    expect(await store.read()).toEqual({ status: "valid", data: competing });
    expect(await readdir(directory)).toEqual([probeName]);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
