import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serializeLogEvent } from "../shared/logging";

import { createLocalLogger } from "./logging";

const directories: string[] = [];
async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "anonymous-log-test-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("anonymous local logs", () => {
  test("only fixed codes and an anonymous bounded count survive serialization", () => {
    const sensitive =
      "/Users/private/secret.md bearer-token document-body search-term";
    const metadata = {
      count: 3,
      message: sensitive,
      error: new Error(sensitive),
      path: sensitive,
      toJSON: () => {
        throw new Error("must not invoke");
      },
    };
    expect(serializeLogEvent("app.started", metadata)).toBe(
      '{"event":"app.started","count":3}\n'
    );
    expect(serializeLogEvent(sensitive, metadata)).toBeNull();
    expect(serializeLogEvent("app.started", new Error(sensitive))).toBe(
      '{"event":"app.started"}\n'
    );
    expect(serializeLogEvent("app.started", { count: Infinity })).not.toContain(
      "count"
    );
    expect(serializeLogEvent("app.started", { count: 4_000_000 })).toContain(
      '"count":1000000'
    );
    expect(
      serializeLogEvent("app.started", {
        get count() {
          throw new Error(sensitive);
        },
      })
    ).not.toContain("count");
    const proxy = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error(sensitive);
        },
      }
    );
    expect(serializeLogEvent("app.started", proxy)).not.toContain(sensitive);
  });

  test("rotates fixed files and preserves complete JSON lines under concurrent calls", async () => {
    const directory = await temporaryDirectory();
    const logger = createLocalLogger(directory, { maxFileBytes: 100 });
    for (let count = 0; count < 20; count++)
      logger.log("app.started", { count, path: "/private/file" });
    await logger.flush();
    const files = await readdir(directory);
    expect(files.sort()).toEqual(["app.log", "app.previous.log"]);
    for (const file of files) {
      expect((await stat(join(directory, file))).size).toBeLessThanOrEqual(100);
      const data = await readFile(join(directory, file), "utf8");
      expect(data).not.toContain("private");
      for (const line of data.trim().split("\n"))
        expect(JSON.parse(line)).toHaveProperty("event", "app.started");
    }
    expect(await readFile(join(directory, "app.log"), "utf8")).toContain(
      '"count":19'
    );
  });

  test("caps the queued burst and rejects overlong records", async () => {
    const directory = await temporaryDirectory();
    const logger = createLocalLogger(directory, { maxQueued: 2 });
    for (let count = 0; count < 1000; count++)
      logger.log("app.started", { count });
    await logger.flush();
    expect(
      (await readFile(join(directory, "app.log"), "utf8")).trim().split("\n")
    ).toHaveLength(2);
    const tiny = createLocalLogger(join(directory, "tiny"), {
      maxFileBytes: 1,
    });
    tiny.log("app.started");
    await tiny.flush();
    expect(await readdir(directory)).toEqual(["app.log"]);
  });

  test("enforces quotas on existing oversized log files", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "app.log"), "x".repeat(300));
    await writeFile(join(directory, "app.previous.log"), "x".repeat(300));
    const logger = createLocalLogger(directory, { maxFileBytes: 100 });
    logger.log("app.started");
    await logger.flush();
    expect(await readdir(directory)).toEqual(["app.log"]);
    expect((await stat(join(directory, "app.log"))).size).toBeLessThanOrEqual(
      100
    );
  });

  test("IO failure is swallowed, disables retries, and does not reject the caller", async () => {
    const directory = await temporaryDirectory();
    const blocked = join(directory, "not-a-directory");
    await writeFile(blocked, "original");
    const logger = createLocalLogger(blocked);
    expect(() => logger.log("app.start_failed")).not.toThrow();
    await logger.flush();
    logger.log("app.started");
    await logger.flush();
    expect(await readFile(blocked, "utf8")).toBe("original");
  });
});
