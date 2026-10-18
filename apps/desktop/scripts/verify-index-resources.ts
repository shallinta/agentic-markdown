import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { record } from "../src/bun/index/protocol";
import { resolveIndexResources } from "../src/bun/index/resources";
import type { createIndexSession } from "../src/bun/index/session";

function isHost(
  value: unknown
): value is { createIndexSession: typeof createIndexSession } {
  return record(value) && typeof value.createIndexSession === "function";
}
const args = process.argv.slice(2);
if (args.length !== 1 || basename(args[0]) !== "bun")
  throw Error("Supply exact app/Contents/Resources/app/bun directory");
const directory = resolve(args[0]);
const resources = resolveIndexResources(directory);
if (!resources) throw Error("Package index resources unavailable");
const loaded: unknown = await import(
  pathToFileURL(join(resources.directory, "index-host.js")).href
);
if (!isHost(loaded)) throw Error("Package host export mismatch");
const root = await mkdtemp(join(tmpdir(), "agentic-index-package-"));
const writer = loaded.createIndexSession(directory);
const check = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw Error("Package index oracle mismatch");
};
check(await writer.open(join(root, "index"), "create-new"), {
  ok: true,
  generation: 0,
});
check(
  await writer.applyAndCommit([
    { kind: "put", id: "a", path: "a.md", raw: "\uFEFF中文\r\n😀x" },
  ]),
  { ok: true, generation: 1 }
);
check(await writer.query("中文"), {
  ok: true,
  generation: 1,
  hits: [{ id: "a", from: 1, to: 3 }],
});
check(await writer.query("😀"), {
  ok: true,
  generation: 1,
  hits: [{ id: "a", from: 5, to: 7 }],
});
check(
  await writer.applyAndCommit([
    { kind: "put", id: "a", path: "a.md", raw: "updated" },
  ]),
  { ok: true, generation: 2 }
);
check(await writer.applyAndCommit([{ kind: "delete", id: "a" }]), {
  ok: true,
  generation: 3,
});
check(
  await writer.applyAndCommit([
    { kind: "put", id: "b", path: "a.md", raw: "new" },
  ]),
  { ok: true, generation: 4 }
);
check(await writer.close(), { ok: true, generation: 4 });
const reader = loaded.createIndexSession(directory);
check(await reader.open(join(root, "index"), "reader-only"), {
  ok: true,
  generation: 4,
});
check(await reader.query("new"), {
  ok: true,
  generation: 4,
  hits: [{ id: "b", from: 0, to: 3 }],
});
check(await reader.close(), { ok: true, generation: 4 });
console.info(
  JSON.stringify({
    phase: "package-index-crud",
    ok: true,
    generation: 4,
    userDocuments: false,
  })
);
