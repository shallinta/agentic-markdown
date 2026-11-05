import { expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentService } from "../documents";
import type { IndexRequest, IndexResult } from "../index/protocol";

import { createWorkspaceService } from ".";

const env = () => ({
  protocolVersion: 1 as const,
  requestId: crypto.randomUUID(),
});

const childScenario = process.env.AGENTIC_MARKDOWN_WORKSPACE_INDEX_TEST;
const slot = join(tmpdir(), "agentic-markdown-workspace-index-v1");

test.skipIf(childScenario !== "native")(
  "searches only a complete live root and maps UTF-16 hits to scanned entries",
  async () => {
    const fixture = await mkdtemp(join(tmpdir(), "workspace-index-fixture-"));
    const path = join(fixture, "sample.md");
    const documents = createDocumentService({
      pickFile: () => Promise.resolve(null),
    });
    const workspace = createWorkspaceService({
      documents,
      pickDirectory: () => Promise.resolve(fixture),
    });
    try {
      await writeFile(path, "\uFEFF😀可检索");
      await writeFile(join(fixture, ".hidden.md"), "不可见");
      await workspace.request({ ...env(), op: "select" });
      const initial = await workspace.request({ ...env(), op: "state" });
      if (!initial.ok || !initial.roots[0]) throw Error("No root");
      const root = initial.roots[0];
      let complete = false;
      for (let i = 0; i < 1000; i++) {
        const state = await workspace.request({ ...env(), op: "state" });
        if (state.ok && state.roots[0]?.status === "complete") {
          complete = true;
          break;
        }
        await Bun.sleep(2);
      }
      expect(complete).toBe(true);
      const page = await workspace.request({
        ...env(),
        op: "page",
        root: root.handle,
        generation: root.generation,
        cursor: 0,
      });
      if (!page.ok || !("nodes" in page) || !page.nodes?.[0])
        throw Error("No entry");
      expect(page.nodes).toHaveLength(1);
      expect(
        await workspace.searchSnapshot(
          root.handle,
          root.generation + 1,
          "可检索"
        )
      ).toMatchObject({ ok: false });
      const pending = workspace.searchSnapshot(
        root.handle,
        root.generation,
        "可检索"
      );
      expect(
        await workspace.searchSnapshot(root.handle, root.generation, "可检索")
      ).toMatchObject({ ok: false, error: "BUSY" });
      expect(await pending).toEqual({
        ok: true,
        hits: [{ entry: page.nodes[0].handle, from: 3, to: 6 }],
      });
      expect(
        await workspace.searchSnapshot(root.handle, root.generation, "不可见")
      ).toEqual({ ok: true, hits: [] });
      await mkdir(slot, { mode: 0o700 });
      const marker = join(slot, "marker");
      await writeFile(marker, "previous owner");
      expect(
        await workspace.searchSnapshot(root.handle, root.generation, "可检索")
      ).toMatchObject({ ok: false, error: "UNAVAILABLE" });
      expect(await readFile(marker, "utf8")).toBe("previous owner");
      await rm(slot, { recursive: true, force: true });
      await writeFile(path, "x".repeat(65_537));
      expect(
        await workspace.searchSnapshot(root.handle, root.generation, "x")
      ).toMatchObject({ ok: false, error: "LIMIT" });
      const hidden = join(fixture, ".hidden.md");
      await rename(path, join(fixture, ".original"));
      await symlink(hidden, path);
      expect(
        await workspace.searchSnapshot(root.handle, root.generation, "不可见")
      ).toMatchObject({ ok: false });
      const cancelled = workspace.searchSnapshot(
        root.handle,
        root.generation,
        "不可见"
      );
      await workspace.request({ ...env(), op: "clear" });
      expect(await cancelled).toMatchObject({ ok: false, error: "CANCELLED" });
    } finally {
      await workspace.dispose();
      await documents.dispose();
      await rm(fixture, { recursive: true, force: true });
    }
  },
  15_000
);

for (const scenario of ["native", "transport"] as const)
  test.skipIf(!!childScenario)(
    `isolated workspace index ${scenario} checks`,
    async () => {
      const fixture = await mkdtemp(join(tmpdir(), "workspace-index-child-"));
      try {
        const child = Bun.spawn([process.execPath, "test", import.meta.path], {
          env: {
            ...process.env,
            TMPDIR: fixture,
            AGENTIC_MARKDOWN_WORKSPACE_INDEX_TEST: scenario,
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        if (code !== 0) throw Error(stdout + stderr);
        expect(stderr).toContain("1 pass");
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    },
    15_000
  );

test.skipIf(childScenario !== "transport")(
  "admission changes suppress late apply and query; UNKNOWN retains the slot",
  async () => {
    const fixture = await mkdtemp(join(tmpdir(), "source-"));
    const path = join(fixture, "a.md");
    const documents = createDocumentService({
      pickFile: () => Promise.resolve(path),
    });
    const workspace = createWorkspaceService({
      documents,
      pickDirectory: () => Promise.resolve(fixture),
    });
    await writeFile(path, "target");
    const originalWorker = globalThis.Worker;
    try {
      await workspace.request({ ...env(), op: "select" });
      let root: { handle: string; generation: number } | undefined;
      for (let i = 0; i < 1000; i++) {
        const state = await workspace.request({ ...env(), op: "state" });
        if (state.ok && state.roots[0]?.status === "complete") {
          root = state.roots[0];
          break;
        }
        await Bun.sleep(2);
      }
      if (!root) throw Error("Missing complete scan root");
      const search = () =>
        workspace.searchSnapshot(root.handle, root.generation, "target");
      async function openAndRelease() {
        const opened = await documents.select(env());
        if (!opened.ok || !opened.snapshot) throw Error("Opening was blocked");
        expect(await search()).toMatchObject({ ok: false, error: "BUSY" });
        expect(
          await documents.release({ ...env(), handle: opened.snapshot.handle })
        ).toMatchObject({ ok: true });
        expect(documents.locations()).toEqual([]);
      }

      for (const scenario of ["apply", "query", "unknown"] as const) {
        let generation = 0;
        let hitId = "";
        const operations: string[] = [];
        class Transport extends EventTarget {
          onmessage?: (event: MessageEvent) => void;
          postMessage(request: IndexRequest) {
            operations.push(request.op);
            void this.respond(request);
          }
          async respond(request: IndexRequest) {
            await Promise.resolve();
            let result: IndexResult;
            if (request.op === "apply" && scenario === "unknown") {
              await openAndRelease();
              result = { ok: false, error: "UNKNOWN", accepted: true };
            } else {
              if (request.op === "apply") {
                generation++;
                const payload: unknown = request.payload;
                if (!Array.isArray(payload)) throw Error("Missing changes");
                const change: unknown = payload[0];
                if (
                  !change ||
                  typeof change !== "object" ||
                  !("id" in change) ||
                  typeof change.id !== "string"
                )
                  throw Error("Missing index ID");
                hitId = change.id;
              }
              if (request.op === "apply" && scenario === "apply")
                expect(await documents.withCreateBarrier(() => undefined)).toBe(
                  true
                );
              if (request.op === "query") await openAndRelease();
              result =
                request.op === "query"
                  ? {
                      ok: true,
                      generation,
                      hits: [{ id: hitId, from: 0, to: 6 }],
                    }
                  : { ok: true, generation };
            }
            this.onmessage?.(
              new MessageEvent("message", {
                data: {
                  version: 1,
                  epoch: request.epoch,
                  id: request.id,
                  result,
                },
              })
            );
            if (request.op === "close" && scenario !== "unknown") {
              const event = new Event("close");
              Object.defineProperty(event, "code", { value: 0 });
              this.dispatchEvent(event);
            }
          }
        }
        Object.defineProperty(globalThis, "Worker", {
          value: Transport,
          configurable: true,
        });
        const result = await search();
        if (scenario === "unknown") {
          expect(result).toEqual({
            ok: false,
            error: "UNKNOWN",
            accepted: true,
          });
          expect((await lstat(slot)).isDirectory()).toBe(true);
          expect(await search()).toMatchObject({
            ok: false,
            error: "UNAVAILABLE",
          });
        } else {
          expect(result).toEqual({
            ok: false,
            error: "CANCELLED",
            accepted: false,
          });
          expect(
            await lstat(slot).catch((error: unknown) => error)
          ).toMatchObject({
            code: "ENOENT",
          });
        }
        expect(operations).toEqual(
          scenario === "query"
            ? ["open", "apply", "query", "close"]
            : ["open", "apply", "close"]
        );
      }
    } finally {
      Object.defineProperty(globalThis, "Worker", {
        value: originalWorker,
        configurable: true,
      });
      await workspace.dispose();
      await documents.dispose();
      await rm(fixture, { recursive: true, force: true });
    }
  },
  5000
);
