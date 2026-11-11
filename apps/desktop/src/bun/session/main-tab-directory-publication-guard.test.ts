import { expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createMainTabCheckpointMetadataStore,
  type MainTabSessionMetadata,
  type PositionedMainTabSessionMetadata,
} from "./main-tab-metadata";
import type { MixedMainTabMetadata } from "./main-tab-mixed-metadata";

const name = "main-tab-session-checkpoint.json";
const root = {
  rootId: "00000000-0000-4000-8000-000000000001",
  relativePath: "original.md",
  fingerprint: "1:2:3",
  pinned: true,
  mode: "source",
} as const;
const previous: MainTabSessionMetadata = { tabs: [root], activeIndex: 0 };
const proposed: MainTabSessionMetadata = {
  tabs: [{ ...root, relativePath: "proposed.md" }],
  activeIndex: 0,
};
const withPosition = (
  value: MainTabSessionMetadata
): PositionedMainTabSessionMetadata => ({
  schemaVersion: 2,
  tabs: value.tabs.map((tab) => ({
    ...tab,
    position: { from: 3, offset: -2.5, ratio: 0.6 },
  })),
  activeIndex: value.activeIndex,
});
const newer: MixedMainTabMetadata = {
  schemaVersion: 3,
  tabs: [
    { kind: "root", ...root },
    {
      kind: "standalone",
      path: "/synthetic/独立.md",
      fingerprint: "1:5:6",
      pinned: false,
      mode: "editing",
    },
  ],
  activeIndex: 1,
};
const exactBytes = (data: unknown) =>
  Buffer.from(` {"data":${JSON.stringify(data)},"version":1}\r\n`);

function stagedAuthority(directory: string) {
  const temporary = readdirSync(directory).find(
    (file) =>
      file.startsWith(`${name}.`) &&
      !file.startsWith(`${name}.bak.`) &&
      file.endsWith(".tmp")
  );
  return temporary && readFileSync(join(directory, temporary));
}

for (const method of [
  "write",
  "writePositions",
  "writeViewportPositions",
  "clearOwned",
] as const) {
  test(`${method} preserves a newer mixed checkpoint arriving after backup, before authority publication`, async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "directory-checkpoint-publication-")
    );
    const path = join(directory, name);
    const backup = `${path}.bak`;
    const store = createMainTabCheckpointMetadataStore(directory);
    const newerBytes = exactBytes(newer);
    let injection:
      { staged: Buffer; authority: Buffer; backup: Buffer } | undefined;
    try {
      if (method === "clearOwned")
        expect(
          await store.writePositions(withPosition(previous), () => true)
        ).toEqual({ status: "committed" });
      else
        await writeFile(
          path,
          exactBytes(method === "write" ? previous : withPosition(previous))
        );
      const oldBytes = await readFile(path);
      await writeFile(backup, "previous backup\n");
      const current = () => {
        if (injection) return true;
        const staged = stagedAuthority(directory);
        if (!staged) return true;
        const observed = {
          staged,
          authority: readFileSync(path),
          backup: readFileSync(backup),
        };
        writeFileSync(path, newerBytes);
        injection = observed;
        return true;
      };
      const positioned = withPosition(proposed);
      const observation = await store.readObserved();
      if (observation.status !== "valid")
        throw Error("Missing original checkpoint observation");
      const result =
        method === "clearOwned"
          ? await store.clearOwned(current)
          : method === "write"
            ? await store.write(proposed, current)
            : method === "writePositions"
              ? await store.writePositions(positioned, current)
              : await store.writeViewportPositions(
                  positioned,
                  current,
                  observation
                );
      if (!injection)
        throw Error(
          "Missing competing write at the authoritative staging point"
        );
      const expected =
        method === "clearOwned"
          ? { schemaVersion: 2, tabs: [], activeIndex: null }
          : method === "write"
            ? proposed
            : positioned;
      expect(JSON.parse(injection.staged.toString("utf8"))).toEqual({
        version: 1,
        data: expected,
      });
      expect(injection.authority).toEqual(oldBytes);
      expect(injection.backup).toEqual(oldBytes);
      expect(result).toEqual({ status: "rejected", reason: "stale" });
      expect(await readFile(path)).toEqual(newerBytes);
      expect(await readFile(backup)).toEqual(oldBytes);
      expect((await readdir(directory)).sort()).toEqual([name, `${name}.bak`]);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("a newly created checkpoint at the first publication point keeps its bytes and no backup", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "directory-checkpoint-first-publication-")
  );
  const path = join(directory, name);
  const store = createMainTabCheckpointMetadataStore(directory);
  const newerBytes = exactBytes(newer);
  let injection: Buffer | undefined;
  try {
    expect(await store.read()).toEqual({ status: "missing" });
    const result = await store.write(proposed, () => {
      if (injection) return true;
      const staged = stagedAuthority(directory);
      if (!staged) return true;
      writeFileSync(path, newerBytes, { flag: "wx" });
      injection = staged;
      return true;
    });
    if (!injection)
      throw Error("Missing competing create at first publication");
    expect(JSON.parse(injection.toString("utf8"))).toEqual({
      version: 1,
      data: proposed,
    });
    expect(result).toEqual({ status: "rejected", reason: "stale" });
    expect(await readFile(path)).toEqual(newerBytes);
    expect(await readdir(directory)).toEqual([name]);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
