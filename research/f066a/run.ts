import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { checkpoint, compactJournal, frame, header, limits, readJournal, replacement, writeJournal } from "./journal";

const scratchPrefix = "f066a-journal-";
const profiles = ["tiny", "near-1mib"] as const;
type Profile = (typeof profiles)[number];
const actions = ["write", "read", "compact", "compact-before", "compact-unknown"] as const;
type Action = (typeof actions)[number];
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const fail = (message: string): never => { throw Error(message); };
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function corpus(profile: Profile) {
  const prefix = "\uFEFF# 合成恢复\r\n第一行：旧🙂\r\n";
  const old = "旧🙂";
  const updated = "新🧭";
  const suffix = "\r\n尾部：保留🌱\r\n";
  const filler = profile === "tiny" ? "English and 中文\r\n"
    : "x".repeat(limits.body - 24 - Buffer.byteLength(prefix));
  const text = prefix + filler;
  const base = Buffer.from(text);
  const first = Buffer.from(text.replace(old, updated));
  const final = Buffer.from(text.replace(old, updated) + suffix);
  const start = Buffer.byteLength(prefix.slice(0, prefix.indexOf(old)));
  const finish = start + Buffer.byteLength(old);
  const frames = [
    checkpoint(7, base),
    replacement(8, 7, start, finish, Buffer.from(updated), base, first),
    replacement(9, 8, first.length, first.length, Buffer.from(suffix), first, final),
  ] as const;
  expect(final.length <= limits.body && (profile === "tiny" || final.length >= limits.body - 32), "Unexpected corpus size");
  return { base, first, final, frames, start };
}

async function privateDirectory(path: string) {
  const owner = process.geteuid?.();
  expect(owner !== undefined && await realpath(path) === path, "Scratch location is not canonical");
  const stat = await lstat(path, { bigint: true });
  expect(stat.isDirectory() && stat.uid === BigInt(owner) && (stat.mode & 0o7777n) === 0o700n, "Scratch location is not private");
  return stat;
}

async function runChild(action: Action, profile: Profile) {
  const directory = process.cwd();
  const root = dirname(directory);
  const temporary = await realpath(tmpdir());
  expect(dirname(root) === temporary && basename(root).startsWith(scratchPrefix) &&
    /^case-[0-9]{2}$/.test(basename(directory)), "Child scratch boundary invalid");
  await privateDirectory(root);
  await privateDirectory(directory);
  const sample = corpus(profile);
  const started = performance.now();
  if (action === "write")
    return { ...await writeJournal(directory, sample.frames), elapsedMs: performance.now() - started };
  if (action !== "read") {
    const fault = action === "compact-before" ? "before-rename" : action === "compact-unknown" ? "before-directory-sync" : undefined;
    return { ...await compactJournal(directory, fault), elapsedMs: performance.now() - started };
  }
  const outcome = await readJournal(directory);
  const elapsedMs = performance.now() - started;
  if (!outcome.ok) return { ...outcome, elapsedMs };
  const { body, hash, revision, ...metadata } = outcome;
  const reference = revision === 7 ? sample.base : revision === 8 ? sample.first : revision === 9 ? sample.final : undefined;
  return { ...metadata, revision, bodyBytes: body.length, bodySha256: hash.toString("hex"),
    exactReference: reference !== undefined && body.equals(reference), elapsedMs };
}

type ChildResult = Awaited<ReturnType<typeof runChild>>;
async function child(directory: string, profile: Profile, action: Action): Promise<ChildResult> {
  const environment = { ...process.env };
  delete environment.AGENTIC_MARKDOWN_HOME;
  const processHandle = Bun.spawn([process.execPath, import.meta.path, "--child", action, profile], {
    cwd: directory, env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  const [exit, stdout, stderr] = await Promise.all([
    processHandle.exited, new Response(processHandle.stdout).text(), new Response(processHandle.stderr).text(),
  ]);
  expect(exit === 0 && stderr.length === 0 && stdout.length > 0 && stdout.length < 2048,
    `Synthetic Bun child failed (${action})`);
  const result: unknown = JSON.parse(stdout);
  return result as ChildResult;
}

function changedFrame(bytes: Buffer, change: (payload: Buffer) => void) {
  const payload = Buffer.from(bytes.subarray(40));
  change(payload);
  return frame(payload);
}

async function compare() {
  const scratch = await mkdtemp(join(await realpath(tmpdir()), scratchPrefix));
  const initial = await privateDirectory(scratch);
  let serial = 0;
  async function fresh(bytes?: Buffer) {
    const directory = join(scratch, `case-${String(serial++).padStart(2, "0")}`);
    await mkdir(directory, { mode: 0o700 });
    if (bytes) await writeFile(join(directory, "journal"), bytes, { flag: "wx", mode: 0o600 });
    return directory;
  }
  async function verifyRead(directory: string, profile: Profile, options: {
    records: number; revision: number; body: Buffer; stored: Buffer; state?: "complete" | "degraded"; verifiedBytes?: number;
  }) {
    const { records, revision, body, stored, state = "complete", verifiedBytes = stored.length } = options;
    const result = await child(directory, profile, "read");
    expect(result.ok && "revision" in result && result.state === state && result.records === records &&
      result.revision === revision && result.exactReference && result.bodyBytes === body.length &&
      result.bodySha256 === digest(body) && result.verifiedBytes === verifiedBytes &&
      result.journalBytes === stored.length && result.journalSha256 === digest(stored), "Cross-process replay differs");
    return result;
  }
  const receipts = [];
  for (const profile of profiles) {
    const expected = corpus(profile);
    const directory = await fresh();
    const written = await child(directory, profile, "write");
    const stored = Buffer.concat([header, ...expected.frames]);
    expect(written.ok && "fileSyncs" in written && written.fileSyncs === 3 && written.bytes === stored.length &&
      written.directorySynced && (await readFile(join(directory, "journal"))).equals(stored), "Journal writer receipt differs");
    const before = await verifyRead(directory, profile, { records: 3, revision: 9, body: expected.final, stored });
    const compacted = Buffer.concat([header, checkpoint(9, expected.final)]);
    const compact = await child(directory, profile, "compact");
    expect(compact.ok && "fileSynced" in compact && compact.fileSynced && compact.directorySynced &&
      compact.bytes === compacted.length, "Compaction did not confirm actual sync");
    const after = await verifyRead(directory, profile, { records: 1, revision: 9, body: expected.final, stored: compacted });
    expect((await readdir(directory)).join() === "journal", "Compaction left an extra scratch member");
    receipts.push({
      profile, initialBodyBytes: expected.base.length, finalBodyBytes: expected.final.length,
      beforeBytes: before.journalBytes, afterBytes: after.journalBytes, bodySha256: after.bodySha256,
      journalSha256Before: before.journalSha256, journalSha256After: after.journalSha256,
      recordsBefore: before.records, recordsAfter: after.records, revision: after.revision,
      fileSyncs: written.fileSyncs, compactFileSynced: compact.fileSynced, compactDirectorySynced: compact.directorySynced,
      elapsedMs: { write: written.elapsedMs, read: before.elapsedMs, compact: compact.elapsedMs, readCompacted: after.elapsedMs },
    });
  }
  const tiny = corpus("tiny");
  const [initialFrame, patch, finalPatch] = tiny.frames;
  const full = Buffer.concat([header, initialFrame, patch, finalPatch]);
  const prefix = Buffer.concat([header, initialFrame, patch]);
  const torn = full.subarray(0, full.length - 1);
  const degradedPath = await fresh(torn);
  const degraded = await verifyRead(degradedPath, "tiny", {
    records: 2, revision: 8, body: tiny.first, stored: torn, state: "degraded", verifiedBytes: prefix.length,
  });
  const refused = await child(degradedPath, "tiny", "compact");
  expect(!refused.ok && refused.error === "DEGRADED" && (await readFile(join(degradedPath, "journal"))).equals(torn),
    "Degraded prefix was rewritten");

  const damaged = Buffer.from(full);
  const checksumByte = header.length + initialFrame.length + 10;
  damaged.writeUInt8(damaged.readUInt8(checksumByte) ^ 1, checksumByte);
  const future = Buffer.from(full);
  future[header.length - 1] = 2;
  const invalidLength = Buffer.from(full);
  const lengthByte = header.length + initialFrame.length;
  invalidLength.writeUInt8(invalidLength.readUInt8(lengthByte) ^ 1, lengthByte);
  const oversizedLength = Buffer.alloc(8);
  const oversized = limits.insert + 86;
  oversizedLength.writeUInt32LE(oversized);
  oversizedLength.writeUInt32LE((~oversized) >>> 0, 4);
  const append = (bytes: Buffer) => Buffer.concat([header, initialFrame, bytes]);
  const tooMany = Buffer.concat([header, initialFrame, ...Array.from({ length: limits.records }, (_, index) =>
    replacement(8 + index, 7 + index, 0, 0, Buffer.alloc(0), tiny.base, tiny.base))]);
  const negative = [
    { name: "first-checkpoint-truncated", bytes: full.subarray(0, header.length + 17), error: "CORRUPT" },
    { name: "complete-checksum-damage", bytes: damaged, error: "CORRUPT" },
    { name: "future-version", bytes: future, error: "FUTURE" },
    { name: "length-complement", bytes: invalidLength, error: "CORRUPT" },
    { name: "oversized-declared-tail", bytes: Buffer.concat([prefix, oversizedLength]), error: "LIMIT" },
    { name: "oversized-length-before-complement", bytes: Buffer.concat([prefix, oversizedLength.subarray(0, 4)]), error: "LIMIT" },
    { name: "oversized-journal", bytes: Buffer.alloc(limits.journal + 1), error: "LIMIT" },
    { name: "record-count", bytes: tooMany, error: "LIMIT" },
    { name: "wrong-revision", bytes: append(changedFrame(patch, (payload) => payload.writeUInt32LE(42, 5))), error: "CORRUPT" },
    { name: "wrong-base-hash", bytes: append(changedFrame(patch, (payload) => payload.writeUInt8(payload.readUInt8(21) ^ 1, 21))), error: "CORRUPT" },
    { name: "wrong-result-hash", bytes: append(changedFrame(patch, (payload) => payload.writeUInt8(payload.readUInt8(53) ^ 1, 53))), error: "CORRUPT" },
    { name: "out-of-bounds", bytes: append(changedFrame(patch, (payload) => payload.writeUInt32LE(tiny.base.length + 1, 13))), error: "CORRUPT" },
    { name: "split-utf8", bytes: append(changedFrame(patch, (payload) => payload.writeUInt32LE(tiny.start + 1, 9))), error: "CORRUPT" },
  ] as const;
  const rejections = [];
  for (const { name, bytes, error } of negative) {
    const directory = await fresh(bytes);
    const actual = await child(directory, "tiny", "read");
    expect(!actual.ok && actual.error === error && (await readFile(join(directory, "journal"))).equals(bytes),
      `Unexpected corruption receipt (${name})`);
    rejections.push({ name, error, bytes: bytes.length, retainedSha256: digest(bytes) });
  }
  const oldDirectory = await fresh(full);
  const beforeFault = await child(oldDirectory, "tiny", "compact-before");
  expect(!beforeFault.ok && beforeFault.error === "INJECTED_BEFORE_RENAME" &&
    (await readFile(join(oldDirectory, "journal"))).equals(full) && (await readdir(oldDirectory)).join() === "journal",
  "Simulated pre-rename fault modified the original journal");
  await verifyRead(oldDirectory, "tiny", { records: 3, revision: 9, body: tiny.final, stored: full });

  const unknownDirectory = await fresh(full);
  const afterFault = await child(unknownDirectory, "tiny", "compact-unknown");
  expect(!afterFault.ok && afterFault.error === "UNKNOWN", "Post-rename sync simulation did not stay uncertain");
  const installed = Buffer.concat([header, checkpoint(9, tiny.final)]);
  const actual = await verifyRead(unknownDirectory, "tiny", { records: 1, revision: 9, body: tiny.final, stored: installed });
  expect((await readdir(unknownDirectory)).join() === "journal", "Post-rename simulation left an extra member");

  const latest = await privateDirectory(scratch);
  expect(initial.dev === latest.dev && initial.ino === latest.ino && initial.birthtimeNs === latest.birthtimeNs,
    "Scratch identity changed before cleanup");
  await rm(scratch, { recursive: true });
  return {
    version: 1, limits, appendScope: "one-exclusive-writer-session", receipts,
    degraded: { records: degraded.records, revision: degraded.revision, verifiedBytes: degraded.verifiedBytes,
      journalBytes: degraded.journalBytes, bodySha256: degraded.bodySha256, compactionRefused: true },
    rejections,
    publication: {
      simulatedBeforeRename: { error: beforeFault.error, originalSha256: digest(full) },
      simulatedBeforeDirectorySync: { error: afterFault.error, observedRevision: actual.revision,
        observedRecords: actual.records, observedJournalSha256: actual.journalSha256 },
    },
  };
}

try {
  if (process.argv[2] === "--child") {
    const action = actions.find((value) => value === process.argv[3]);
    const profile = profiles.find((value) => value === process.argv[4]);
    expect(process.argv.length === 5 && action && profile, "Invalid synthetic child command");
    console.info(JSON.stringify(await runChild(action, profile)));
  } else {
    expect(process.argv.length === 2, "Runner accepts no external paths or arguments");
    console.info(JSON.stringify(await compare()));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  // Keep synthetic artifacts on failure; never print paths or Markdown bodies.
  console.error(/^[A-Za-z0-9 ()-]+$/.test(message) ? message : "Synthetic journal experiment failed");
  process.exitCode = 1;
}
