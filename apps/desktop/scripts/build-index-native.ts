import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const testing = process.argv.slice(2).includes("--test-addon");
if (process.argv.slice(2).some((arg) => arg !== "--test-addon"))
  throw Error("Unknown index build argument");
const output = join(root, testing ? ".index-test" : "dist-native");
const manifest = join(output, "index-build.json");
await mkdir(output, { recursive: true });
// A failed current build must never validate the previous resource pair.
await rm(manifest, { force: true });
if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch))
  throw Error("Index requires native macOS arm64/x64");
const bin = process.env.AGENTIC_MARKDOWN_INDEX_RUST_BIN;
const target = process.env.AGENTIC_MARKDOWN_INDEX_TARGET;
const expected =
  process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
if (!bin || !isAbsolute(bin) || target !== expected)
  throw Error(
    "Explicit AGENTIC_MARKDOWN_INDEX_RUST_BIN / AGENTIC_MARKDOWN_INDEX_TARGET required"
  );
const crate = join(root, "native/index");
const sourceNames = [
  "native/index/Cargo.toml",
  "native/index/Cargo.lock",
  "native/index/index_bridge_v1.h",
  "native/index/bridge.c",
  "native/index/src/lib.rs",
  "src/bun/index/protocol.ts",
  "src/bun/index/resources.ts",
  "src/bun/index/session.ts",
  "src/bun/index/worker.ts",
  "scripts/build-index-native.ts",
];
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const sources: Record<string, string> = {};
for (const name of sourceNames)
  sources[name] = hash(await readFile(join(root, name)));
const env = {
  ...process.env,
  RUSTC: join(bin, "rustc"),
  RUSTDOC: join(bin, "rustdoc"),
  CARGO_TARGET_DIR: join(root, ".index-target", target),
  PATH: `${bin}:${process.env.PATH ?? ""}`,
};
function run(command: string[]): string {
  const result = Bun.spawnSync(command, {
    cwd: crate,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw Error(
      `Index build step failed: ${command[0]}\n${result.stderr.toString()}`
    );
  if (result.stderr.length) process.stderr.write(result.stderr);
  return result.stdout.toString();
}
const rust = run([join(bin, "rustc"), "-vV"]);
if (!rust.includes("release: 1.90.0\n") || !rust.includes(`host: ${target}\n`))
  throw Error("Rust version/host mismatch");
if (!run([join(bin, "cargo"), "--version"]).startsWith("cargo 1.90.0 "))
  throw Error("Cargo version mismatch");
if (!run([join(bin, "rustdoc"), "--version"]).startsWith("rustdoc 1.90.0 "))
  throw Error("Rustdoc version mismatch");
const lockBefore = await readFile(join(crate, "Cargo.lock"));
const build = Bun.spawnSync(
  [
    join(bin, "cargo"),
    "rustc",
    "--release",
    "--locked",
    "--lib",
    ...(testing ? ["--features", "bridge-test"] : []),
    "--target",
    target,
    "--",
    "--print",
    "native-static-libs",
  ],
  { cwd: crate, env, stdout: "pipe", stderr: "pipe" }
);
process.stdout.write(build.stdout);
process.stderr.write(build.stderr);
if (build.exitCode !== 0) throw Error("Rust index build failed");
if (!lockBefore.equals(await readFile(join(crate, "Cargo.lock"))))
  throw Error("Cargo lock changed");
const match = /native-static-libs:\s*([^\n]+)/.exec(build.stderr.toString());
if (!match) throw Error("Missing native-static-libs receipt");
const libraries = match[1].trim().split(/\s+/);
if (!libraries.every((lib) => /^-l[A-Za-z0-9_]+$/.test(lib)))
  throw Error("Unexpected native-static-libs syntax");
const headers = join(
  dirname(fileURLToPath(import.meta.resolve("node-api-headers/package.json"))),
  "include"
);
const native = join(output, "index-primitives.node");
const pending = `${native}.pending`;
run([
  "xcrun",
  "clang",
  "-bundle",
  "-undefined",
  "dynamic_lookup",
  "-arch",
  process.arch === "arm64" ? "arm64" : "x86_64",
  "-DNAPI_VERSION=8",
  ...(testing ? ["-DINDEX_BRIDGE_TEST"] : []),
  "-Wall",
  "-Wextra",
  "-Werror",
  "-I",
  headers,
  join(crate, "bridge.c"),
  join(env.CARGO_TARGET_DIR, target, "release/libagentic_index_native.a"),
  ...libraries,
  "-o",
  pending,
]);
const architecture = run(["lipo", "-archs", pending]).trim();
if (architecture !== (process.arch === "arm64" ? "arm64" : "x86_64"))
  throw Error("Addon architecture mismatch");
const linked = run(["otool", "-L", pending]);
if (
  linked
    .split("\n")
    .slice(1)
    .some(
      (line) =>
        line.trim() &&
        !/^\s*\/usr\/lib\//.test(line) &&
        !/^\s*\/System\/Library\//.test(line)
    )
)
  throw Error("Unexpected addon dynamic dependency");
await rename(pending, native);
for (const [entry, name] of [
  ["worker.ts", "index-worker.js"],
  ["session.ts", "index-host.js"],
] as const) {
  const built = await Bun.build({
    entrypoints: [join(root, "src/bun/index", entry)],
    outdir: output,
    target: "bun",
    naming: name,
  });
  if (!built.success)
    throw new AggregateError(built.logs, "Index JS build failed");
}
for (const name of sourceNames)
  if (sources[name] !== hash(await readFile(join(root, name))))
    throw Error("Index source changed during build");
const record = {
  version: 1,
  arch: process.arch,
  target,
  rust: "1.90.0",
  cargo: "1.90.0",
  sources,
  lock: hash(lockBefore),
  addon: hash(await readFile(native)),
  worker: hash(await readFile(join(output, "index-worker.js"))),
  host: hash(await readFile(join(output, "index-host.js"))),
};
await writeFile(`${manifest}.pending`, `${JSON.stringify(record, null, 2)}\n`);
await rename(`${manifest}.pending`, manifest);
console.info(JSON.stringify({ phase: "index-built", ...record }));
