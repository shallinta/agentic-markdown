import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_DOCUMENT_BYTES } from "../../shared/documents";
import {
  validMainTabPosition,
  type MainTabPosition,
} from "../../shared/main-tab-position";

import {
  createMainTabCheckpointMetadataStore,
  validMainTabSessionMetadata,
} from "./main-tab-metadata";
import {
  createMainTabPositionProbeStore,
  validMainTabPositionProbeMetadata,
  type MainTabPositionProbeMetadata,
} from "./main-tab-position-probe";

const position = (): MainTabPosition => ({
  version: 1,
  anchor: { kind: "block-sha256-v1", hash: "a".repeat(64), occurrence: 2 },
  offset: -12.75,
});
const metadata = (withPosition = true): MainTabPositionProbeMetadata => ({
  tabs: [
    {
      rootId: crypto.randomUUID(),
      relativePath: "nested/a.md",
      fingerprint: "1:2:3",
      mode: "source",
      pinned: true,
      ...(withPosition ? { position: position() } : {}),
    },
  ],
  activeIndex: 0,
});
async function child(
  operation: string,
  directory: string,
  input?: string
): Promise<unknown> {
  const processHandle = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "main-tab-position-child.ts"),
      operation,
      directory,
      ...(input ? [input] : []),
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ]);
  expect(code).toBe(0);
  expect(stderr).toBe("");
  return JSON.parse(stdout) as unknown;
}

test("optional block position roundtrips in separate processes and former strict schema cannot overwrite it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "position-schema-"));
  const path = join(directory, "main-tab-position-probe.json"),
    input = join(directory, "input.json");
  try {
    const value = metadata();
    value.tabs.push({
      ...metadata(false).tabs[0],
      relativePath: "nested/b.md",
      mode: "editing",
      pinned: false,
    });
    value.activeIndex = 1;
    await writeFile(input, JSON.stringify(value));
    expect(await child("write", directory, input)).toEqual({
      status: "committed",
    });
    const bytes = await readFile(path);
    expect(await child("read", directory)).toEqual({
      status: "valid",
      data: value,
    });
    expect(await readFile(path)).toEqual(bytes);
    expect(await child("old-read-write", directory)).toEqual({
      before: "corrupt",
      attempted: false,
    });
    expect(await readFile(path)).toEqual(bytes);
    expect(bytes.toString()).not.toContain(directory);
    expect(bytes.toString()).not.toContain('"text"');
    expect(bytes.toString()).not.toContain('"scrollTop"');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("new reader preserves legacy version-one metadata with no implicit position or rewrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "position-old-schema-"));
  const path = join(directory, "main-tab-position-probe.json");
  try {
    const value = metadata(false);
    const bytes = JSON.stringify({ version: 1, data: value });
    await writeFile(path, bytes);
    expect(await child("read", directory)).toEqual({
      status: "valid",
      data: value,
    });
    expect(await readFile(path, "utf8")).toBe(bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("position validator bounds exact JSON-safe metadata and rejects body or path payloads", () => {
  expect(validMainTabPosition(position())).toBe(true);
  for (const offset of [
    0,
    0.125,
    Number.MAX_SAFE_INTEGER,
    -Number.MAX_SAFE_INTEGER,
  ])
    expect(validMainTabPosition({ ...position(), offset })).toBe(true);
  expect(
    validMainTabPosition({
      ...position(),
      anchor: { ...position().anchor, occurrence: MAX_DOCUMENT_BYTES },
    })
  ).toBe(true);
  const invalid: unknown[] = [
    undefined,
    null,
    [],
    { ...position(), version: 2 },
    { ...position(), text: "body" },
    { ...position(), path: "/private" },
    ...[NaN, Infinity, -Infinity, -0, Number.MAX_SAFE_INTEGER + 1].map(
      (offset) => ({ ...position(), offset })
    ),
    ...[-1, -0, 0.5, MAX_DOCUMENT_BYTES + 1].map((occurrence) => ({
      ...position(),
      anchor: { ...position().anchor, occurrence },
    })),
    { ...position(), anchor: { ...position().anchor, hash: "A".repeat(64) } },
    { ...position(), anchor: { ...position().anchor, kind: "unknown" } },
    { ...position(), anchor: { ...position().anchor, text: "body" } },
    Object.assign([], position()),
    { ...position(), anchor: Object.assign([], position().anchor) },
  ];
  for (const value of invalid) {
    expect(validMainTabPosition(value)).toBe(false);
    const record = metadata();
    Object.assign(record.tabs[0], { position: value });
    expect(validMainTabPositionProbeMetadata(record)).toBe(false);
  }
});

test("queued position write owns nested primitives and invalid write preserves existing bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "position-copy-"));
  const path = join(directory, "main-tab-position-probe.json"),
    store = createMainTabPositionProbeStore(directory);
  try {
    const value = metadata();
    const expected = JSON.parse(
      JSON.stringify(value)
    ) as MainTabPositionProbeMetadata;
    const pending = store.write(value);
    value.tabs[0].position!.anchor.hash = "b".repeat(64);
    value.tabs[0].position!.offset = 55;
    expect(await pending).toEqual({ status: "committed" });
    expect(await store.read()).toEqual({ status: "valid", data: expected });
    const bytes = await readFile(path);
    value.tabs[0].position!.offset = -0;
    expect(await store.write(value)).toEqual({
      status: "rejected",
      reason: "invalid",
    });
    expect(await readFile(path)).toEqual(bytes);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("isolated position storage never changes the strict production checkpoint schema or file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "position-isolation-"));
  const checkpoint = createMainTabCheckpointMetadataStore(directory);
  const probe = createMainTabPositionProbeStore(directory);
  try {
    const previous = metadata(false);
    expect(await checkpoint.write(previous, () => true)).toEqual({
      status: "committed",
    });
    const path = join(directory, "main-tab-session-checkpoint.json");
    const bytes = await readFile(path);
    const extended = metadata();
    expect(validMainTabSessionMetadata(extended)).toBe(false);
    expect(await checkpoint.write(extended, () => true)).toEqual({
      status: "rejected",
      reason: "invalid",
    });
    expect(await probe.write(extended)).toEqual({ status: "committed" });
    expect(await readFile(path)).toEqual(bytes);
    expect(await checkpoint.read()).toEqual({
      status: "valid",
      data: previous,
    });
  } finally {
    await checkpoint.close();
    await probe.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("protected probe formats and unknown anchor versions retain exact bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "position-protected-"));
  const store = createMainTabPositionProbeStore(directory);
  const path = join(directory, "main-tab-position-probe.json");
  try {
    for (const [value, reason] of [
      [{ version: 2, data: metadata() }, "future"],
      [
        {
          version: 1,
          data: {
            ...metadata(),
            tabs: [
              {
                ...metadata().tabs[0],
                position: { ...position(), version: 2 },
              },
            ],
          },
        },
        "corrupt",
      ],
      [metadata(), "legacy"],
    ] as const) {
      const bytes = JSON.stringify(value);
      await writeFile(path, bytes);
      expect(await store.write(metadata())).toEqual({
        status: "rejected",
        reason,
      });
      expect(await readFile(path, "utf8")).toBe(bytes);
    }
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("position write ignores hidden and inherited serialization hooks at every input layer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "position-projection-"));
  const store = createMainTabPositionProbeStore(directory);
  try {
    const value = metadata();
    const expected = JSON.parse(
      JSON.stringify(value)
    ) as MainTabPositionProbeMetadata;
    let calls = 0;
    const hook = () => {
      calls++;
      throw Error("Caller serializer must not run");
    };
    Object.setPrototypeOf(value, { toJSON: hook });
    Object.defineProperty(value.tabs, "toJSON", { value: hook });
    Object.setPrototypeOf(value.tabs[0], { toJSON: hook });
    Object.defineProperty(value.tabs[0].position!, "toJSON", { value: hook });
    Object.setPrototypeOf(value.tabs[0].position!.anchor, { toJSON: hook });
    expect(await store.write(value)).toEqual({ status: "committed" });
    expect(calls).toBe(0);
    expect(await store.read()).toEqual({ status: "valid", data: expected });
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("throwing input access is rejected without escaping or damaging stored data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "position-access-"));
  const store = createMainTabPositionProbeStore(directory);
  try {
    const value = metadata();
    expect(await store.write(value)).toEqual({ status: "committed" });
    const bytes = await readFile(
      join(directory, "main-tab-position-probe.json")
    );
    const bad = metadata();
    Object.defineProperty(bad.tabs[0].position!.anchor, "hash", {
      enumerable: true,
      get() {
        throw Error("Input access failed");
      },
    });
    expect(await store.write(bad)).toEqual({
      status: "rejected",
      reason: "invalid",
    });
    expect(
      await store.write(
        new Proxy(
          {},
          {
            ownKeys() {
              throw Error("Proxy keys failed");
            },
          }
        )
      )
    ).toEqual({ status: "rejected", reason: "invalid" });
    expect(
      await readFile(join(directory, "main-tab-position-probe.json"))
    ).toEqual(bytes);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("shared storage queue orders reads and writes while close drains the bounded admissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "position-queue-"));
  const store = createMainTabPositionProbeStore(directory);
  try {
    const value = metadata();
    const writes = Array.from({ length: 64 }, (_, index) =>
      store.write({
        ...value,
        tabs: [
          { ...value.tabs[0], position: { ...position(), offset: index } },
        ],
      })
    );
    expect(await store.write(value)).toEqual({
      status: "rejected",
      reason: "queue-full",
    });
    const reading = store.read();
    const closing = store.close();
    expect(await store.write(value)).toEqual({
      status: "rejected",
      reason: "closed",
    });
    const results = await Promise.all(writes);
    expect(results.every((result) => result.status === "committed")).toBe(true);
    const result = await reading;
    if (result.status !== "valid") throw Error("Missing final queued record");
    expect(result.data.tabs[0].position?.offset).toBe(63);
    await closing;
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
