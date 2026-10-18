import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { keys, record } from "./protocol";

export interface IndexResources {
  worker: string;
  native: string;
  directory: string;
}
/** Integrity association only: this manifest is not a signature or authorization. */
export function resolveIndexResources(
  moduleDirectory: string
): IndexResources | null {
  const source =
    basename(moduleDirectory) === "index" &&
    basename(join(moduleDirectory, "..")) === "bun" &&
    basename(join(moduleDirectory, "../..")) === "src";
  const directory = source
    ? join(moduleDirectory, "../../../dist-native")
    : basename(moduleDirectory) === "bun"
      ? join(moduleDirectory, "../native")
      : null;
  if (!directory || process.platform !== "darwin") return null;
  try {
    const manifestPath = join(directory, "index-build.json");
    if (statSync(manifestPath).size > 16_384) return null;
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (
      !record(manifest) ||
      !keys(
        manifest,
        "addon,arch,cargo,host,lock,rust,sources,target,version,worker"
      ) ||
      manifest.version !== 1 ||
      manifest.arch !== process.arch ||
      manifest.rust !== "1.90.0" ||
      manifest.cargo !== "1.90.0" ||
      typeof manifest.lock !== "string" ||
      !/^[a-f0-9]{64}$/.test(manifest.lock) ||
      !record(manifest.sources) ||
      Object.keys(manifest.sources).length !== 10 ||
      !Object.entries(manifest.sources).every(
        ([path, hash]) =>
          /^(native\/index|src\/bun\/index|scripts)\/[A-Za-z0-9_./-]+$/.test(
            path
          ) &&
          !path.includes("..") &&
          typeof hash === "string" &&
          /^[a-f0-9]{64}$/.test(hash)
      ) ||
      manifest.target !==
        (process.arch === "arm64"
          ? "aarch64-apple-darwin"
          : "x86_64-apple-darwin")
    )
      return null;
    for (const [name, key] of [
      ["index-primitives.node", "addon"],
      ["index-worker.js", "worker"],
      ["index-host.js", "host"],
    ] as const) {
      const path = join(directory, name);
      const info = statSync(path);
      if (
        !info.isFile() ||
        info.size > 128 * 1024 * 1024 ||
        typeof manifest[key] !== "string" ||
        createHash("sha256").update(readFileSync(path)).digest("hex") !==
          manifest[key]
      )
        return null;
    }
    return {
      directory,
      worker: join(directory, "index-worker.js"),
      native: join(directory, "index-primitives.node"),
    };
  } catch {
    return null;
  }
}
