import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin")
  throw new Error("Native save currently requires macOS.");
const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "dist-native");
await mkdir(output, { recursive: true });
const headers = join(
  dirname(fileURLToPath(import.meta.resolve("node-api-headers/package.json"))),
  "include"
);
const build = Bun.spawnSync([
  "xcrun",
  "clang",
  "-bundle",
  "-undefined",
  "dynamic_lookup",
  "-DNAPI_VERSION=8",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-I",
  headers,
  join(root, "native/save-primitives.c"),
  "-o",
  join(output, "save-primitives.node"),
]);
if (build.exitCode !== 0) throw new Error(build.stderr.toString());
const worker = await Bun.build({
  entrypoints: [join(root, "src/bun/documents/save-worker.ts")],
  outdir: output,
  target: "bun",
  naming: "save-worker.js",
});
if (!worker.success)
  throw new AggregateError(worker.logs, "Save worker build failed");
const imageWorker = await Bun.build({
  entrypoints: [join(root, "src/bun/documents/image-worker.ts")],
  outdir: output,
  target: "bun",
  naming: "image-worker.js",
});
if (!imageWorker.success)
  throw new AggregateError(imageWorker.logs, "Image worker build failed");
const perfWorker = await Bun.build({
  entrypoints: [join(root, "src/bun/perf-lab/worker.ts")],
  outdir: output,
  target: "bun",
  naming: "perf-worker.js",
});
if (!perfWorker.success)
  throw new AggregateError(perfWorker.logs, "Performance worker build failed");
