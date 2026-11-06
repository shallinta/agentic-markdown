import { randomUUID } from "node:crypto";
import {
  linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkpoint, header, limits, replacement } from "../f066a/journal";

import { digest, leaf, loadPackagedNative, maxCheckpointBytes, publishCheckpoint, readCheckpoint, type Result } from "./checkpoint";

const prefix = "agentic-f066b-";
const marker = ".fixture";
const script = fileURLToPath(import.meta.url);
const actions = ["read", "publish", "before-publish", "before-directory-sync"] as const;
type Action = (typeof actions)[number];
type Profile = "small" | "full";

class FixtureError extends Error {}
function expect(value: unknown, stage: string): asserts value {
  if (!value) throw new FixtureError(stage);
}

function body(profile: Profile) {
  const start = "\uFEFF# 合成检查点 📖\r\n中文和 English。\r\n";
  const end = "\r\n检查点末尾 🧭\r\n";
  const middle = profile === "small" ? "固定样本" : "x".repeat(limits.body - Buffer.byteLength(start + end));
  return Buffer.from(start + middle + end);
}

function privateDirectory(path: string) {
  const stat = lstatSync(path, { bigint: true });
  expect(realpathSync(path) === path && stat.isDirectory() && stat.uid === BigInt(process.geteuid!()) &&
    (stat.mode & 0o7777n) === 0o700n, "Private fixture boundary failed");
  return stat;
}

function child(args: string[]): Result {
  const [nonce, action, profile] = args;
  expect(args.length === 3 && nonce !== undefined && /^[a-f0-9-]{36}$/.test(nonce) &&
    action !== undefined && actions.some((known) => known === action) &&
    (profile === "small" || profile === "full"), "Unknown child command");
  const path = process.cwd();
  const root = dirname(path);
  expect(dirname(root) === realpathSync(tmpdir()) && basename(root).startsWith(prefix) &&
    /^case-[0-9]{2}$/.test(basename(path)) && process.env.AGENTIC_MARKDOWN_HOME === root,
    "Child fixture boundary failed");
  privateDirectory(root);
  privateDirectory(path);
  const markerPath = join(root, marker);
  const proof = lstatSync(markerPath, { bigint: true });
  expect(proof.isFile() && proof.nlink === 1n && proof.uid === BigInt(process.geteuid!()) &&
    (proof.mode & 0o7777n) === 0o600n && proof.size === 36n && readFileSync(markerPath, "utf8") === nonce,
    "Child fixture proof failed");
  const { native } = loadPackagedNative();
  if (action === "read") return readCheckpoint(native, path);
  return publishCheckpoint(native, path, profile === "small" ? 7 : 9, body(profile),
    action === "before-publish" || action === "before-directory-sync" ? action : undefined);
}

function parent() {
  const { version, bunSha, addonSha } = loadPackagedNative();
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  const pin = privateDirectory(root);
  const nonce = randomUUID();
  writeFileSync(join(root, marker), nonce, { flag: "wx", mode: 0o600 });
  let caseCount = 0;
  let processes = 0;
  const receipts: { name: string; result: Result }[] = [];
  const fixture = () => {
    const path = join(root, `case-${String(++caseCount).padStart(2, "0")}`);
    mkdirSync(path, { mode: 0o700 });
    return path;
  };
  const run = (name: string, path: string, action: Action, profile: Profile = "small") => {
    const output = Bun.spawnSync({
      cmd: [process.execPath, script, "child", nonce, action, profile],
      cwd: path,
      env: { ...process.env, AGENTIC_MARKDOWN_HOME: root },
      stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 15_000,
    });
    ++processes;
    expect(output.exitCode === 0 && output.stderr.length === 0 && output.stdout.length < 1024,
      `Child failed: ${name}`);
    const result = JSON.parse(output.stdout.toString()) as Result;
    receipts.push({ name, result });
    return result;
  };
  const rejected = (name: string, path: string, error: string, action: Action = "read") => {
    const result = run(name, path, action);
    expect(result.ok === false && result.error === error, `Unexpected refusal: ${name}`);
  };
  const exact = (result: Result, profile: Profile) => {
    const expected = body(profile);
    expect(result.ok === true && result.revision === (profile === "small" ? 7 : 9) &&
      result.bytes === expected.length && result.sha256 === digest(expected), "Checkpoint receipt differs");
  };
  const keep = (path: string, bytes: Buffer) => {
    writeFileSync(join(path, leaf), bytes, { flag: "wx", mode: 0o600 });
  };
  const onDisk = (path: string, profile: Profile) => {
    const source = readFileSync(join(path, leaf));
    // Independent byte/range check of the known single-frame v1 layout.
    expect(source.length === body(profile).length + 88 && source.subarray(88).equals(body(profile)) &&
      source.readUInt32LE(48) === (profile === "small" ? 7 : 9), "Published bytes differ");
    return source;
  };

  for (const profile of ["small", "full"] as const) {
    const path = fixture();
    exact(run(`${profile}-publish`, path, "publish", profile), profile);
    exact(run(`${profile}-fresh-read`, path, "read", profile), profile);
    const before = onDisk(path, profile);
    const file = join(path, leaf);
    const stat = lstatSync(file, { bigint: true });
    if (profile === "small") {
      const collision = run("occupied-native-exclusive", path, "publish", "full");
      expect(collision.ok === false && collision.error === "BUSY", "Existing destination was not protected");
      expect(readdirSync(path).length === 2, "Collision staging evidence unavailable");
    }
    const latest = lstatSync(file, { bigint: true });
    expect(stat.ino === latest.ino && stat.dev === latest.dev && readFileSync(file).equals(before), "Published identity changed");
  }

  const good = Buffer.concat([header, checkpoint(7, body("small"))]);
  const future = Buffer.from(good);
  future.writeUInt8(2, header.length - 1);
  const corrupt = Buffer.from(good);
  corrupt.writeUInt8(corrupt.readUInt8(corrupt.length - 1) ^ 1, corrupt.length - 1);
  const source = body("small");
  const patch = replacement(8, 7, source.length, source.length, Buffer.from("x"), source, Buffer.concat([source, Buffer.from("x")]));
  for (const [name, bytes, error] of [
    ["foreign", Buffer.from("unknown file"), "CORRUPT"],
    ["future", future, "FUTURE"],
    ["corrupt", corrupt, "CORRUPT"],
    ["invalid-utf8", Buffer.concat([header, checkpoint(7, Buffer.of(0xff))]), "CORRUPT"],
    ["truncated", good.subarray(0, -1), "CORRUPT"],
    ["multiple-frames", Buffer.concat([good, patch]), "CORRUPT"],
    ["over-limit", Buffer.alloc(maxCheckpointBytes + 1), "LIMIT"],
  ] as const) {
    const path = fixture();
    keep(path, bytes);
    rejected(name, path, error);
    expect(readFileSync(join(path, leaf)).equals(bytes), `Evidence changed: ${name}`);
  }

  for (const kind of ["symlink", "hardlink"] as const) {
    const path = fixture();
    const original = join(path, "original");
    writeFileSync(original, good, { flag: "wx", mode: 0o600 });
    const makeLink = kind === "symlink" ? symlinkSync : linkSync;
    makeLink(original, join(path, leaf));
    rejected(kind, path, "UNAVAILABLE");
    expect(readFileSync(original).equals(good), `Link target changed: ${kind}`);
  }

  const before = fixture();
  rejected("prepublish-injection", before, "INJECTED_BEFORE_PUBLISH", "before-publish");
  rejected("prepublish-fresh-read", before, "MISSING");
  expect(readdirSync(before).length === 1, "Prepublication staging evidence unavailable");
  const after = fixture();
  rejected("postpublish-sync-injection", after, "UNKNOWN", "before-directory-sync");
  exact(run("postpublish-fresh-read", after, "read"), "small");
  onDisk(after, "small");

  const current = privateDirectory(root);
  expect(pin.dev === current.dev && pin.ino === current.ino && pin.birthtimeNs === current.birthtimeNs,
    "Fixture root was replaced");
  rmSync(root, { recursive: true });
  return { version, bunSha, addonSha, caseCount, processes, receipts, cleaned: true };
}

try {
  const args = process.argv.slice(2);
  expect(args.length === 0 || args[0] === "child", "Unknown command");
  console.info(JSON.stringify(args.length ? child(args.slice(1)) : parent()));
} catch (error) {
  const stage = error instanceof FixtureError ? ` ${error.message}.` : "";
  console.error(`F-066b checkpoint probe failed; synthetic evidence retained.${stage}`);
  process.exitCode = 1;
}
