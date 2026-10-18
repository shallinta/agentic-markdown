import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("isolated build rejects missing tools, version and target without touching formal output", async () => {
  const source = join(import.meta.dir, "../../..");
  const original = await readFile(join(source, "dist-native/index-build.json"));
  for (const fault of [
    "missing-env",
    "target",
    "missing-tool",
    "version",
    "host",
  ]) {
    const root = await mkdtemp(join(tmpdir(), "f064c-build-reject-"));
    await mkdir(join(root, "scripts"));
    await cp(
      join(source, "scripts/build-index-native.ts"),
      join(root, "scripts/build-index-native.ts")
    );
    await cp(join(source, "native/index"), join(root, "native/index"), {
      recursive: true,
    });
    await cp(join(source, "src/bun/index"), join(root, "src/bun/index"), {
      recursive: true,
    });
    const bin = join(root, "bin");
    await mkdir(bin);
    const target =
      process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
    if (fault === "version" || fault === "host")
      await writeFile(
        join(bin, "rustc"),
        `#!/bin/sh\nprintf 'release: ${fault === "version" ? "1.89.0" : "1.90.0"}\\nhost: ${fault === "host" ? "wrong-target" : target}\\n'\n`,
        { mode: 0o755 }
      );
    const child = Bun.spawnSync(
      [process.execPath, join(root, "scripts/build-index-native.ts")],
      {
        env: {
          ...process.env,
          AGENTIC_MARKDOWN_INDEX_RUST_BIN: fault === "missing-env" ? "" : bin,
          AGENTIC_MARKDOWN_INDEX_TARGET: fault === "target" ? "wrong-target" : target,
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 15_000,
      }
    );
    expect(child.exitCode).not.toBe(0);
    expect(child.stderr.toString()).toContain(
      fault === "version" || fault === "host"
        ? "Rust version/host mismatch"
        : fault === "missing-tool"
          ? "rustc"
          : "Explicit AGENTIC_MARKDOWN_INDEX_RUST_BIN"
    );
    expect(
      await Bun.file(join(root, "dist-native/index-build.json")).exists()
    ).toBe(false);
    expect(
      await readFile(join(source, "dist-native/index-build.json"))
    ).toEqual(original);
  }
}, 30_000);
