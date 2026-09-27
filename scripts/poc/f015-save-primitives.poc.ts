// NON-PRODUCT F-015a PoC. Experimental Bun FFI is NOT approved for production.
// Run explicitly on macOS: bun scripts/poc/f015-save-primitives.poc.ts
// Bun 1.3.14 and official paired Bun 1.4.0 passed both scenarios (2026-09-22).
// Only self-created mkdtemp fixtures are changed/deleted. No project files are saved.
// Successful sync syscalls do not establish power-loss durability, support for all
// volumes, or CAS against concurrent external writers. All FFI calls block this thread.
// COPYFILE_STAT may preserve the source timestamps; a production save must explicitly
// update modification time after copying metadata and before its durability barrier.
import assert from "node:assert/strict";
import { constants } from "node:fs";
import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  rename,
  symlink,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { cc, dlopen, FFIType, ptr, CString } from "bun:ffi";

if (process.platform !== "darwin")
  throw new Error("This isolated PoC requires macOS.");
let assertions = 0;
const expect = (actual: unknown) => ({
  toBe(expected: unknown) {
    assertions++;
    assert.equal(actual, expected);
  },
  toEqual(expected: unknown) {
    assertions++;
    assert.deepEqual(actual, expected);
  },
  toBeGreaterThanOrEqual(expected: number) {
    assertions++;
    assert.ok(typeof actual === "number" && actual >= expected);
  },
});
async function run(name: string, fn: () => Promise<void>) {
  await fn();
  console.info("PASS", name);
}
const api = dlopen("/usr/lib/libSystem.B.dylib", {
  fcopyfile: {
    args: [FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },
  fcntl: {
    args: [FFIType.i32, FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
  renameat: {
    args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr],
    returns: FFIType.i32,
  },
  close: { args: [FFIType.i32], returns: FFIType.i32 },
  fsetxattr: {
    args: [
      FFIType.i32,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.u64,
      FFIType.u32,
      FFIType.i32,
    ],
    returns: FFIType.i32,
  },
  fgetxattr: {
    args: [
      FFIType.i32,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.u64,
      FFIType.u32,
      FFIType.i32,
    ],
    returns: FFIType.i64,
  },
  acl_get_fd_np: { args: [FFIType.i32, FFIType.i32], returns: FFIType.ptr },
  acl_to_text: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  acl_free: { args: [FFIType.ptr], returns: FFIType.i32 },
}).symbols;
const cstr = (s: string) => Buffer.from(s + "\0");
const native = cc({
  source: fileURLToPath(new URL("./f015-openat.poc.c", import.meta.url)),
  symbols: {
    safe_openat: {
      args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.u32],
      returns: FFIType.i32,
    },
  },
}).symbols;
function acl(fd: number): string {
  const value = api.acl_get_fd_np(fd, 0x100);
  if (!value) throw new Error("ACL lookup failed");
  const text = api.acl_to_text(value, null);
  if (!text) throw new Error("ACL serialization failed");
  try {
    return new CString(text).toString();
  } finally {
    api.acl_free(text);
    api.acl_free(value);
  }
}

await run(
  "metadata and strong-sync calls succeed before and after same-directory replacement",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "agentic-save-data-"));
    const source = await open(join(root, "source.md"), "wx+", 0o640);
    const temp = await open(join(root, ".temp"), "wx+", 0o600);
    const directory = await open(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    try {
      await source.writeFile("old");
      expect(
        Bun.spawnSync([
          "/bin/chmod",
          "+a",
          `user:${userInfo().username} allow read`,
          join(root, "source.md"),
        ]).exitCode
      ).toBe(0);
      const name = cstr("com.agenticmarkdown.poc");
      const value = Buffer.from("测试 metadata");
      expect(
        api.fsetxattr(source.fd, ptr(name), ptr(value), value.length, 0, 0)
      ).toBe(0);
      await temp.writeFile("\uFEFF# 新内容\r\n");
      expect(api.fcopyfile(source.fd, temp.fd, null, 7)).toBe(0);
      const oldStat = await source.stat();
      const newStat = await temp.stat();
      expect(newStat.mode & 0o7777).toBe(oldStat.mode & 0o7777);
      expect([newStat.uid, newStat.gid]).toEqual([oldStat.uid, oldStat.gid]);
      expect(acl(temp.fd)).toBe(acl(source.fd));
      const received = Buffer.alloc(100);
      const count = Number(
        api.fgetxattr(temp.fd, ptr(name), ptr(received), received.length, 0, 0)
      );
      expect(received.subarray(0, count)).toEqual(value);
      await temp.sync();
      const fileStart = performance.now();
      expect(api.fcntl(temp.fd, 51, 0)).toBe(0);
      const fileDurationMs = performance.now() - fileStart;
      const from = cstr(".temp"),
        to = cstr("source.md");
      expect(api.renameat(directory.fd, ptr(from), directory.fd, ptr(to))).toBe(
        0
      );
      await directory.sync();
      const directoryStart = performance.now();
      const fullDirectorySync = api.fcntl(directory.fd, 51, 0);
      console.info(
        JSON.stringify({
          fileFullSync: 0,
          directoryFullSync: fullDirectorySync,
          fileDurationMs,
          directoryDurationMs: performance.now() - directoryStart,
        })
      );
      expect(fullDirectorySync).toBe(0);
      expect(await readFile(join(root, "source.md"), "utf8")).toBe(
        "\uFEFF# 新内容\r\n"
      );
    } finally {
      await Promise.all([source.close(), temp.close(), directory.close()]);
      await rm(root, { recursive: true });
    }
  }
);

await run(
  "held directory fd confines temp and rename when parent path is replaced by outside symlink",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "agentic-save-race-"));
    await mkdir(join(root, "authorized"));
    await mkdir(join(root, "outside"));
    const directory = await open(
      join(root, "authorized"),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    try {
      await rename(join(root, "authorized"), join(root, "moved"));
      await symlink(join(root, "outside"), join(root, "authorized"));
      const from = cstr(".temp"),
        to = cstr("doc.md");
      const fd = native.safe_openat(
        directory.fd,
        ptr(from),
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600
      );
      expect(fd).toBeGreaterThanOrEqual(0);
      expect(api.close(fd)).toBe(0);
      expect((await stat(join(root, "moved/.temp"))).mode & 0o7777).toBe(0o600);
      expect(api.renameat(directory.fd, ptr(from), directory.fd, ptr(to))).toBe(
        0
      );
      expect(await readFile(join(root, "moved/doc.md"), "utf8")).toBe("");
      expect(await Bun.file(join(root, "outside/doc.md")).exists()).toBe(false);
    } finally {
      await directory.close();
      await rm(root, { recursive: true });
    }
  }
);

console.info(
  `2 scenarios passed; ${assertions} assertions; Bun ${Bun.version}`
);
