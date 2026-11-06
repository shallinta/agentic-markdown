import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
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

import type { ContentSearchInput } from "../../shared/content-search";
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

test.skipIf(childScenario !== "candidates")(
  "covers zero-hit entries and classifies only live candidate grants",
  async () => {
    const fixture = await mkdtemp(join(tmpdir(), "workspace-candidates-"));
    const directory = join(fixture, "root");
    const outside = join(fixture, "outside.md");
    const sample = "\uFEFF😀target\r\n";
    const noMatch = "另一个文档";
    const documents = createDocumentService({ pickFile: () => Promise.resolve(outside) });
    const workspace = createWorkspaceService({
      documents,
      pickDirectory: () => Promise.resolve(directory),
    });
    try {
      await mkdir(directory);
      await writeFile(join(directory, "sample.md"), sample);
      await writeFile(join(directory, "zero.md"), noMatch);
      const selected = await workspace.request({ ...env(), op: "select" });
      if (!selected.ok || !selected.roots[0]) throw Error("Missing root");
      const root = selected.roots[0];
      for (let i = 0; i < 1000; i++) {
        const state = await workspace.request({ ...env(), op: "state" });
        if (state.ok && state.roots[0]?.status === "complete") break;
        await Bun.sleep(2);
      }
      const page = await workspace.request({
        ...env(), op: "page", root: root.handle, generation: root.generation, cursor: 0,
      });
      if (!page.ok || !("nodes" in page) || !page.nodes) throw Error("Missing page");
      const entry = page.nodes.find((node) => node.name === "sample.md")?.handle;
      const zeroEntry = page.nodes.find((node) => node.name === "zero.md")?.handle;
      if (!entry || !zeroEntry) throw Error("Missing scan entries");
      const opened = await workspace.open({
        ...env(), root: root.handle, entry,
      });
      if (!opened.ok || !opened.snapshot) throw Error("Missing root grant");
      const { handle, documentId, revision, hash } = opened.snapshot;
      await writeFile(outside, "target");
      const outsideResponse = await documents.select(env());
      if (!outsideResponse.ok || !outsideResponse.snapshot) throw Error("Missing outside grant");
      const outsideHandle = outsideResponse.snapshot.handle;
      const unknownHandle = crypto.randomUUID();
      const input = {
        root: root.handle, generation: root.generation, query: "target",
        handles: [handle, outsideHandle, unknownHandle],
      };
      const result = await workspace.searchContentCandidates(input);
      if (!result.ok) throw Error("Missing result");
      expect(result.coverage).toHaveLength(2);
      expect(result.coverage.find((row) => row.entry === entry)).toEqual({
        entry, hash, bytes: Buffer.byteLength(sample), hit: { from: 3, to: 9 },
      });
      expect(result.coverage.find((row) => row.entry === zeroEntry)).toEqual({
        entry: zeroEntry,
        hash: createHash("sha256").update(noMatch).digest("hex"),
        bytes: Buffer.byteLength(noMatch),
      });
      expect(result.mappings).toEqual([
        { handle, kind: "matched", entry, documentId, revision, hash },
        { handle: outsideHandle, kind: "outside" },
        { handle: unknownHandle, kind: "unresolved" },
      ]);
      expect(await workspace.searchContentCandidates({ ...input, root: crypto.randomUUID() }))
        .toEqual({ ok: false, error: "STALE" });
      expect(await workspace.searchContentCandidates({ ...input, handles: [handle, handle] }))
        .toEqual({ ok: false, error: "INVALID" });
      const duplicate = await workspace.open({ ...env(), root: root.handle, entry });
      if (!duplicate.ok || !duplicate.snapshot) throw Error("Missing duplicate grant");
      const duplicateHandle = duplicate.snapshot.handle;
      expect(await workspace.searchContentCandidates({ ...input, handles: [handle, duplicateHandle] }))
        .toMatchObject({ ok: true, mappings: [
          { handle, kind: "unresolved" },
          { handle: duplicateHandle, kind: "unresolved" },
        ] });
      await documents.release({ ...env(), handle: duplicateHandle });
      await rename(outside, join(fixture, "moved.md"));
      expect(await workspace.searchContentCandidates(input)).toMatchObject({
        ok: true,
        mappings: [
          { handle, kind: "matched" },
          { handle: outsideHandle, kind: "unresolved" },
          { handle: unknownHandle, kind: "unresolved" },
        ],
      });
      await documents.release({ ...env(), handle });
      expect(await workspace.searchContentCandidates(input)).toMatchObject({
        ok: true,
        mappings: input.handles.map((candidate) => ({ handle: candidate, kind: "unresolved" })),
      });
    } finally {
      await workspace.dispose();
      await documents.dispose();
      await rm(fixture, { recursive: true, force: true });
    }
  },
  15_000
);

test.skipIf(childScenario !== "file-filters")(
  "searches matching basenames without reading excluded bodies or trusting unresolved grants",
  async () => {
    const fixture = await mkdtemp(join(tmpdir(), "workspace-file-filters-"));
    const nested = join(fixture, "parent-marker");
    const sample = "\uFEFF😀target\r\n";
    const documents = createDocumentService({ pickFile: () => Promise.resolve(null) });
    const workspace = createWorkspaceService({
      documents,
      pickDirectory: () => Promise.resolve(fixture),
    });
    try {
      await mkdir(nested);
      await writeFile(join(fixture, "会议 纪要.md"), sample);
      await writeFile(join(nested, "oversize.md"), "target".repeat(11_000));
      const selected = await workspace.request({ ...env(), op: "select" });
      if (!selected.ok || !selected.roots[0]) throw Error("Missing root");
      const root = selected.roots[0];
      for (let i = 0; i < 1000; i++) {
        const state = await workspace.request({ ...env(), op: "state" });
        if (state.ok && state.roots[0]?.status === "complete") break;
        await Bun.sleep(2);
      }
      const page = await workspace.request({
        ...env(), op: "page", root: root.handle, generation: root.generation, cursor: 0,
      });
      if (!page.ok || !page.nodes) throw Error("Missing page");
      const entry = page.nodes.find((node) => node.name === "会议 纪要.md")?.handle;
      const oversize = page.nodes.find((node) => node.name === "oversize.md")?.handle;
      if (!entry || !oversize) throw Error("Missing file entries");
      const opened = await workspace.open({ ...env(), root: root.handle, entry: oversize });
      if (!opened.ok || !opened.snapshot) throw Error("Missing excluded grant");
      const { handle } = opened.snapshot;
      const unknown = crypto.randomUUID();
      const input = {
        root: root.handle, generation: root.generation, query: "target", handles: [handle, unknown],
      };
      const search = (...fileFilters: string[]) =>
        workspace.searchContentCandidates({ ...input, fileFilters });
      expect(await workspace.searchContentCandidates(input)).toEqual({ ok: false, error: "LIMIT" });
      expect(await search("会议", "纪要")).toEqual({
        ok: true,
        coverage: [{
          entry,
          hash: createHash("sha256").update(sample).digest("hex"),
          bytes: Buffer.byteLength(sample),
          hit: { from: 3, to: 9 },
        }],
        mappings: [{ handle, kind: "outside" }, { handle: unknown, kind: "unresolved" }],
      });
      expect(await search("parent-marker")).toEqual({
        ok: true,
        coverage: [],
        mappings: [{ handle, kind: "outside" }, { handle: unknown, kind: "unresolved" }],
      });
      expect(await search("会议", "oversize")).toMatchObject({ ok: true, coverage: [] });
      expect(await search()).toEqual({ ok: false, error: "INVALID" });
      expect(await search("会议", "会议")).toEqual({ ok: false, error: "INVALID" });
      expect(await search("parent-marker/")).toEqual({ ok: false, error: "INVALID" });
      documents.setTrashGuard((path, fingerprint, directories) =>
        path.endsWith("/oversize.md") && !!fingerprint &&
        !!directories?.some((directory) => directory.path.endsWith("/parent-marker"))
      );
      expect(await search("parent-marker")).toEqual({
        ok: true,
        coverage: [],
        mappings: [{ handle, kind: "unresolved" }, { handle: unknown, kind: "unresolved" }],
      });
      await documents.release({ ...env(), handle });
      expect(await search("会议")).toMatchObject({
        ok: true,
        mappings: [{ handle, kind: "unresolved" }, { handle: unknown, kind: "unresolved" }],
      });
    } finally {
      await workspace.dispose();
      await documents.dispose();
      await rm(fixture, { recursive: true, force: true });
    }
  },
  15_000
);

test.skipIf(childScenario !== "path-filters")(
  "searches contained paths using combined filters without widening root or body limits",
  async () => {
    const fixture = await mkdtemp(join(tmpdir(), "workspace-path-filters-"));
    let selected = join(fixture, "root");
    const documents = createDocumentService({ pickFile: () => Promise.resolve(null) });
    const workspace = createWorkspaceService({
      documents,
      pickDirectory: () => Promise.resolve(selected),
    });
    async function scan(name: string) {
      await workspace.request({ ...env(), op: "select" });
      for (let i = 0; i < 1000; i++) {
        const state = await workspace.request({ ...env(), op: "state" });
        const root = state.ok && state.roots.find((item) => item.name === name);
        if (root && root.status === "complete") return root;
        await Bun.sleep(2);
      }
      throw Error("Missing complete root");
    }
    try {
      await mkdir(join(selected, "项目 甲"), { recursive: true });
      await mkdir(join(selected, "项目 乙 草稿"), { recursive: true });
      await writeFile(join(selected, "项目 甲", "note.md"), "target 甲");
      await writeFile(join(selected, "项目 乙 草稿", "note.md"), "target 乙");
      await writeFile(join(selected, "项目 乙 草稿", "oversize.md"), "x".repeat(65_537));
      const root = await scan("root");
      const page = await workspace.request({
        ...env(), op: "page", root: root.handle, generation: root.generation, cursor: 0,
      });
      if (!page.ok || !page.nodes) throw Error("Missing page");
      const entries = page.nodes;
      const byFolder = (name: string) => {
        const parent = entries.find((node) => node.name === name)?.handle;
        return entries.find((node) => node.name === "note.md" && node.parent === parent)?.handle;
      };
      const alpha = byFolder("项目 甲");
      const beta = byFolder("项目 乙 草稿");
      if (!alpha || !beta) throw Error("Missing matching file names");
      const opened = await workspace.open({ ...env(), root: root.handle, entry: beta });
      if (!opened.ok || !opened.snapshot) throw Error("Missing granted file");
      const { handle } = opened.snapshot;
      const input = {
        root: root.handle, generation: root.generation, query: "target", handles: [handle],
      };
      const search = (filters: Pick<ContentSearchInput, "fileFilters" | "pathFilters">) =>
        workspace.searchContentCandidates({ ...input, ...filters });
      expect(await search({})).toEqual({ ok: false, error: "LIMIT" });
      const both = await search({ fileFilters: ["note"] });
      if (!both.ok) throw Error(JSON.stringify(both));
      expect(both.coverage.map(({ entry }) => entry).sort()).toEqual([alpha, beta].sort());
      const excludeDraft = { kind: "-path", value: "草稿/" } as const;
      expect(await search({ pathFilters: [excludeDraft] })).toMatchObject({
        ok: true,
        coverage: [{ entry: alpha, hit: { from: 0, to: 6 } }],
        mappings: [{ handle, kind: "outside" }],
      });
      expect(await search({
        fileFilters: ["note"],
        pathFilters: [{ kind: "path", value: "项目 乙 草稿/" }],
      })).toMatchObject({
        ok: true,
        coverage: [{ entry: beta, hit: { from: 0, to: 6 } }],
        mappings: [{ handle, kind: "matched", entry: beta }],
      });
      expect(await search({
        fileFilters: ["n", "o", "t", "e", ".", "m", "d"],
        pathFilters: [excludeDraft],
      })).toMatchObject({ ok: true, coverage: [{ entry: alpha }] });
      expect(await search({
        fileFilters: ["n", "o", "t", "e", ".", "m", "d", "no"],
        pathFilters: [excludeDraft],
      })).toEqual({ ok: false, error: "INVALID" });
      expect(await search({ pathFilters: [{ kind: "path", value: "workspace-path-filters-" }] }))
        .toMatchObject({ ok: true, coverage: [], mappings: [{ handle, kind: "outside" }] });
      for (const value of ["/项目", "../项目", "项目//甲"])
        expect(await search({ pathFilters: [{ kind: "path", value }] }))
          .toEqual({ ok: false, error: "INVALID" });

      selected = join(fixture, "wide");
      await mkdir(selected);
      for (let index = 0; index < 17; index++)
        await writeFile(join(selected, `note-${index}.md`), "target");
      const wide = await scan("wide");
      expect(await workspace.searchContentCandidates({
        ...input,
        root: wide.handle,
        generation: wide.generation,
        handles: [],
        pathFilters: [{ kind: "path", value: "note-16.md" }],
      })).toEqual({ ok: false, error: "LIMIT" });
    } finally {
      await workspace.dispose();
      await documents.dispose();
      await rm(fixture, { recursive: true, force: true });
    }
  },
  15_000
);

for (const scenario of ["native", "transport", "candidates", "file-filters", "path-filters"] as const)
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

      for (const scenario of ["apply", "query", "product", "unknown"] as const) {
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
        const result = scenario === "product"
          ? await workspace.searchContentCandidates({ root: root.handle, generation: root.generation, query: "target", handles: [] })
          : await search();
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
          expect(result).toEqual(scenario === "product"
            ? { ok: false, error: "CANCELLED" }
            : { ok: false, error: "CANCELLED", accepted: false });
          expect(
            await lstat(slot).catch((error: unknown) => error)
          ).toMatchObject({
            code: "ENOENT",
          });
        }
        expect(operations).toEqual(
          scenario === "query" || scenario === "product"
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
