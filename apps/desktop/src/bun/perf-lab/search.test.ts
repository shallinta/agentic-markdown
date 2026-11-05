import { expect, test } from "bun:test";
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  validSearchLabRequest,
  validSearchLabResponse,
} from "../../shared/search-lab";

import { createSearchLab } from "./search";

const request = () => ({
  protocolVersion: 1 as const,
  requestId: crypto.randomUUID(),
});
const child = process.env.AGENTIC_MARKDOWN_SEARCH_LAB_TEST_CHILD === "1";

test.skipIf(child)(
  "isolated search lab scans, cancels and releases the fixture",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentic-search-lab-test-"));
    try {
      const process = Bun.spawn(
        [globalThis.process.execPath, "test", import.meta.path],
        {
          env: {
            ...globalThis.process.env,
            TMPDIR: directory,
            AGENTIC_MARKDOWN_SEARCH_LAB_TEST_CHILD: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      const [code, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);
      if (code !== 0) throw Error(stdout + stderr);
      expect(stderr).toContain("2 pass");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  15_000
);

test.skipIf(!child)(
  "failed fixture removal retains ownership until a successful retry",
  async () => {
    const lab = createSearchLab();
    try {
      const scope = await lab.run({ ...request(), op: "prepare" });
      if (!scope.ok || scope.op !== "prepare")
        throw Error("Fixture unavailable");
      const before = await readdir(tmpdir());
      expect(before).toHaveLength(1);
      await chmod(tmpdir(), 0o500);
      try {
        const stop = { ...request(), op: "stop" as const };
        for (let attempt = 0; attempt < 2; attempt++) {
          expect(await lab.run(stop)).toMatchObject({
            ok: false,
            error: "UNAVAILABLE",
          });
          expect(await readdir(tmpdir())).toEqual(before);
        }
        expect(await lab.run({ ...request(), op: "prepare" })).toMatchObject({
          ok: false,
          error: "UNAVAILABLE",
        });
        expect(
          await lab.run({
            ...request(),
            op: "query",
            root: scope.root,
            generation: scope.generation,
            query: "可检索",
          })
        ).toMatchObject({
          ok: false,
          error: "UNAVAILABLE",
        });
      } finally {
        await chmod(tmpdir(), 0o700);
      }
      expect(await lab.run({ ...request(), op: "stop" })).toMatchObject({
        ok: true,
        op: "stop",
      });
      expect(await readdir(tmpdir())).toEqual([]);
    } finally {
      await lab.dispose();
    }
  },
  10_000
);

test.skipIf(!child)(
  "search lab rejects foreign scope and cancels the matching in-flight request",
  async () => {
    const lab = createSearchLab();
    try {
      const start = { ...request(), op: "prepare" as const };
      const scope = await lab.run(start);
      expect(validSearchLabResponse(scope, start)).toBe(true);
      if (!scope.ok || scope.op !== "prepare")
        throw Error("Fixture unavailable");
      const input = {
        ...request(),
        op: "query" as const,
        root: scope.root,
        generation: scope.generation,
        query: "可检索",
      };
      expect(validSearchLabRequest({ ...input, root: "/etc" })).toBe(false);
      expect(validSearchLabRequest({ ...input, query: "\ud800" })).toBe(false);
      expect(validSearchLabRequest({ ...input, query: " ".repeat(4097) })).toBe(
        false
      );
      expect(validSearchLabRequest({ ...input, path: "/etc" })).toBe(false);
      expect(
        await lab.run({ ...input, root: crypto.randomUUID() })
      ).toMatchObject({ ok: false, error: "STALE" });
      expect(
        await lab.run({ ...input, generation: scope.generation + 1 })
      ).toMatchObject({ ok: false, error: "STALE" });
      const found = await lab.run(input);
      expect(validSearchLabResponse(found, input)).toBe(true);
      expect(found).toMatchObject({ ok: true, hits: [{ from: 3, to: 6 }] });
      expect(
        validSearchLabResponse(
          { ...found, requestId: crypto.randomUUID() },
          input
        )
      ).toBe(false);
      expect(
        validSearchLabResponse(
          { ...found, hits: [{ entry: crypto.randomUUID(), from: 3, to: 7 }] },
          input
        )
      ).toBe(false);
      const cancelled = { ...input, ...request() };
      const pending = lab.run(cancelled);
      expect(
        await lab.run({
          ...request(),
          op: "cancel",
          targetRequestId: input.requestId,
        })
      ).toMatchObject({ ok: false, error: "STALE" });
      expect(
        await lab.run({
          ...request(),
          op: "cancel",
          targetRequestId: cancelled.requestId,
        })
      ).toMatchObject({ ok: true, op: "cancel" });
      expect(await pending).toMatchObject({ ok: false, error: "CANCELLED" });
      expect(
        await lab.run({ ...input, ...request(), query: "无命中" })
      ).toMatchObject({ ok: true, hits: [] });
      const closingQuery = lab.run({ ...input, ...request() });
      const stopping = lab.run({ ...request(), op: "stop" });
      expect(await lab.run({ ...request(), op: "prepare" })).toMatchObject({
        ok: false,
        error: "BUSY",
      });
      expect(await closingQuery).toMatchObject({
        ok: false,
        error: "CANCELLED",
      });
      expect(await stopping).toMatchObject({
        ok: true,
        op: "stop",
      });
      expect(await readdir(tmpdir())).toEqual([]);
      expect(await lab.run(input)).toMatchObject({
        ok: false,
        error: "NOT_READY",
      });
    } finally {
      await lab.dispose();
    }
    expect(await lab.run({ ...request(), op: "prepare" })).toMatchObject({
      ok: false,
      error: "DISABLED",
    });
  },
  10_000
);
