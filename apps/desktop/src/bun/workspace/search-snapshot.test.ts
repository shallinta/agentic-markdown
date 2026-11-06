import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  validContentSearchPrepareResponse,
  validContentSearchProgress,
  validContentSearchResponse,
  type ContentSearchInput,
  type ContentSearchProgress,
} from "../../shared/content-search";
import { createDocumentService } from "../documents";
import { verifySingleFileAuthorization } from "../documents/path-authorization";
import { validRequest, type IndexRequest, type IndexResult } from "../index/protocol";
import { createContentSearchRPC } from "../rpc/content-search";

import { createWorkspaceService, type ContentSearchFileProgress } from ".";

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

test.skipIf(childScenario !== "multi-root")(
  "combines complete roots in one native query and rejects the whole result on invalidation",
  async () => {
    const fixture = await mkdtemp(join(tmpdir(), "workspace-multi-root-"));
    const firstPath = join(fixture, "one", "同名");
    const secondPath = join(fixture, "two", "同名");
    const widePath = join(fixture, "wide");
    const firstRaw = "\uFEFF😀target\r\n";
    const secondRaw = "乙😀target";
    const pad = "x".repeat(33_000);
    let picked = firstPath;
    const documents = createDocumentService({ pickFile: () => Promise.resolve(null) });
    const workspace = createWorkspaceService({ documents, pickDirectory: () => Promise.resolve(picked) });
    const OriginalWorker = globalThis.Worker;
    const operations: string[] = [];
    let holdQuery: ((resume: () => void) => void) | undefined;
    let closing: Promise<void> | undefined;
    class RecordingWorker extends OriginalWorker {
      override postMessage(message: unknown) {
        const op = typeof message === "object" && message && "op" in message ? message.op : undefined;
        if (typeof op === "string") operations.push(op);
        if (op === "query" && holdQuery) holdQuery(() => super.postMessage(message));
        else super.postMessage(message);
      }
    }

    async function addRoot(path: string) {
      picked = path;
      const canonical = await realpath(path);
      const selected = await workspace.request({ ...env(), op: "select" });
      if (!selected.ok) throw Error("Unable to add fixture root");
      for (let i = 0; i < 1000; i++) {
        const state = await workspace.request({ ...env(), op: "state" });
        const root = state.ok && state.roots.find((item) => item.displayPath === canonical);
        if (root && root.status === "complete") return { handle: root.handle, generation: root.generation };
        await Bun.sleep(2);
      }
      throw Error("Fixture root scan did not complete");
    }

    async function findEntry(root: { handle: string; generation: number }) {
      const page = await workspace.request({
        ...env(), op: "page", root: root.handle, generation: root.generation, cursor: 0,
      });
      const entry = page.ok && page.nodes?.find(({ name }) => name === "同名.md");
      if (!entry) throw Error("Missing scanned Markdown entry");
      return entry.handle;
    }

    const coverage = (entry: string, raw: string) => ({
      entry,
      hash: createHash("sha256").update(raw).digest("hex"),
      bytes: Buffer.byteLength(raw),
      hit: { from: 3, to: 9 },
    });
    const removedSlot = async () => {
      expect(await lstat(slot).catch((error: unknown) => error)).toMatchObject({ code: "ENOENT" });
    };
    try {
      await mkdir(join(firstPath, "项目 甲"), { recursive: true });
      await mkdir(join(secondPath, "项目 乙"), { recursive: true });
      await mkdir(widePath);
      await writeFile(join(firstPath, "项目 甲", "同名.md"), firstRaw);
      await writeFile(join(secondPath, "项目 乙", "同名.md"), secondRaw);
      await writeFile(join(firstPath, "budget.md"), pad);
      await writeFile(join(secondPath, "budget.md"), pad);
      for (let index = 0; index < 14; index++)
        await writeFile(join(widePath, `sample-${index}.md`), "target");

      const first = await addRoot(firstPath);
      const second = await addRoot(secondPath);
      const wide = await addRoot(widePath);
      const firstEntry = await findEntry(first);
      const secondEntry = await findEntry(second);
      const opened = await workspace.open({ ...env(), root: second.handle, entry: secondEntry });
      if (!opened.ok || !opened.snapshot) throw Error("Missing second-root grant");
      const { handle, documentId, revision, hash } = opened.snapshot;
      const input = { roots: [first, second], query: "target", handles: [handle] };
      const firstOnly = { ...input, pathFilters: [{ kind: "path", value: "项目 甲/" }] } as const;
      const search = (
        request: Parameters<typeof workspace.searchContentCandidatesForRoots>[0] = input,
        signal?: AbortSignal
      ) => workspace.searchContentCandidatesForRoots(request, signal);

      expect(await search({ ...input, roots: [] })).toEqual({ ok: false, error: "INVALID" });
      expect(await search({ ...input, roots: [first, first] })).toEqual({ ok: false, error: "INVALID" });
      expect(await search({
        ...input,
        roots: Array.from({ length: 17 }, () => ({ handle: crypto.randomUUID(), generation: 1 })),
      })).toEqual({ ok: false, error: "LIMIT" });
      expect(await search({ ...input, roots: [first, { ...second, generation: second.generation + 1 }] }))
        .toEqual({ ok: false, error: "STALE" });
      expect(await search({ ...input, roots: [first, second, wide], fileFilters: ["同名"] }))
        .toEqual({ ok: false, error: "LIMIT" });
      expect(await search()).toEqual({ ok: false, error: "LIMIT" });
      expect(await search({ ...input, roots: [first] })).toMatchObject({ ok: true });
      expect(await search({ ...input, roots: [second] })).toMatchObject({ ok: true });

      Object.defineProperty(globalThis, "Worker", { value: RecordingWorker, configurable: true });
      const both = await search({ ...input, fileFilters: ["同名"] });
      if (!both.ok) throw Error(JSON.stringify(both));
      expect(both.coverage).toHaveLength(2);
      expect(both.coverage).toContainEqual(coverage(firstEntry, firstRaw));
      expect(both.coverage).toContainEqual(coverage(secondEntry, secondRaw));
      expect(both.mappings).toEqual([{ handle, kind: "matched", entry: secondEntry, documentId, revision, hash }]);
      expect(operations).toEqual(["open", "apply", "query", "close"]);
      await removedSlot();

      const rpc = createContentSearchRPC(workspace);
      const wire = {
        ...env(),
        op: "query-roots" as const,
        ...input,
        roots: [second, first],
        fileFilters: ["同名"],
      };
      const wireFailure = (requestId: string, error: "NOT_READY" | "INVALID" | "STALE") => ({
        protocolVersion: 1,
        requestId,
        ok: false,
        error,
      } as const);
      expect(await rpc.run(wire)).toEqual(wireFailure(wire.requestId, "NOT_READY"));
      rpc.setReady(true);
      const malformed = { ...wire, ...env(), rootAlias: secondPath };
      expect(await rpc.run(malformed)).toEqual(wireFailure(malformed.requestId, "INVALID"));
      const duplicate = { ...wire, ...env(), roots: [second, second] };
      expect(await rpc.run(duplicate)).toEqual(wireFailure(duplicate.requestId, "INVALID"));
      const stale = { ...wire, ...env(), roots: [second, { ...first, generation: first.generation + 1 }] };
      expect(await rpc.run(stale)).toEqual(wireFailure(stale.requestId, "STALE"));

      operations.length = 0;
      const reply = await rpc.run(wire);
      expect(validContentSearchResponse(reply, wire)).toBe(true);
      if (!reply.ok || reply.op !== "query-roots") throw Error("Missing native multi-root RPC reply");
      expect(reply).toMatchObject({
        protocolVersion: 1,
        requestId: wire.requestId,
        roots: [second, first],
        mappings: both.mappings,
      });
      expect(reply.coverage).toHaveLength(2);
      expect(reply.coverage).toContainEqual(coverage(firstEntry, firstRaw));
      expect(reply.coverage).toContainEqual(coverage(secondEntry, secondRaw));
      expect(validContentSearchResponse({ ...reply, roots: [first, second] }, wire)).toBe(false);
      expect(operations).toEqual(["open", "apply", "query", "close"]);
      await removedSlot();

      expect(await search(firstOnly)).toEqual({
        ok: true,
        coverage: [coverage(firstEntry, firstRaw)],
        mappings: [{ handle, kind: "outside" }],
      });
      expect(await search({ ...input, pathFilters: [{ kind: "path", value: "项目 乙/" }] }))
        .toMatchObject({ ok: true, coverage: [coverage(secondEntry, secondRaw)] });

      async function pauseSearch(request: Parameters<typeof search>[0], signal?: AbortSignal) {
        const entered = Promise.withResolvers<() => void>();
        holdQuery = entered.resolve;
        const pending = search(request, signal);
        try {
          const resume = await Promise.race([
            entered.promise,
            pending.then((result) => { throw Error("Native query was not dispatched: " + JSON.stringify(result)); }),
          ]);
          return { pending, resume };
        } finally {
          holdQuery = undefined;
        }
      }

      const abort = new AbortController();
      const aborted = await pauseSearch(firstOnly, abort.signal);
      try {
        expect((await lstat(slot)).isDirectory()).toBe(true);
        abort.abort();
      } finally {
        aborted.resume();
      }
      expect(await aborted.pending).toEqual({ ok: false, error: "CANCELLED" });
      await removedSlot();

      const replaced = await pauseSearch(firstOnly);
      try {
        await rename(secondPath, join(fixture, "replaced-root"));
        await mkdir(secondPath);
      } finally {
        replaced.resume();
      }
      const rejected = await replaced.pending;
      expect(rejected.ok).toBe(false);
      if (rejected.ok) throw Error("A zero-candidate root was replaced during the native query");
      expect(["CANCELLED", "UNAVAILABLE"]).toContain(rejected.error);
      expect(Object.keys(rejected).sort()).toEqual(["error", "ok"]);
      await removedSlot();

      const disposed = await pauseSearch({ ...firstOnly, roots: [first, wide], handles: [] });
      try {
        closing = workspace.dispose();
        const settled = await Promise.race([
          closing.then(() => true),
          Bun.sleep(100).then(() => false),
        ]);
        expect(settled).toBe(false);
      } finally {
        disposed.resume();
      }
      expect(await disposed.pending).toEqual({ ok: false, error: "CANCELLED" });
      await closing;
      await removedSlot();
    } finally {
      Object.defineProperty(globalThis, "Worker", { value: OriginalWorker, configurable: true });
      await (closing ?? workspace.dispose());
      await documents.dispose();
      await rm(fixture, { recursive: true, force: true });
    }
  },
  15_000
);

test.skipIf(childScenario !== "direct")(
  "direct RPC matches native evidence without opening an index and fails closed on root changes",
  async () => {
    const fixture = await mkdtemp(join(tmpdir(), "workspace-direct-"));
    const directories = [join(fixture, "first"), join(fixture, "second")];
    const paths = [join(directories[0], "项目 甲", "同名.md"), join(directories[1], "项目 乙", "同名.md")];
    const raw = ["\uFEFF😀中文 target\r\n😀中文 TARGET", "乙\r\n😀中文 target"];
    const OriginalWorker = globalThis.Worker;
    const indexOperations: string[] = [];
    class RecordingWorker extends OriginalWorker {
      override postMessage(message: unknown) {
        if (validRequest(message)) indexOperations.push(message.op);
        super.postMessage(message);
      }
    }

    function createHarness(contentSearchStrategy: "native" | "direct") {
      let selected: string | null = null;
      const documents = createDocumentService({ pickFile: () => Promise.resolve(null) });
      const workspace = createWorkspaceService({
        documents, contentSearchStrategy, pickDirectory: () => Promise.resolve(selected),
      });
      const rpc = createContentSearchRPC(workspace);
      rpc.setReady(true);
      async function addRoot(path: string) {
        selected = path;
        const canonical = await realpath(path);
        if (!(await workspace.request({ ...env(), op: "select" })).ok)
          throw Error("Fixture root could not be added");
        for (let index = 0; index < 1000; index++) {
          const state = await workspace.request({ ...env(), op: "state" });
          const root = state.ok && state.roots.find(({ displayPath }) => displayPath === canonical);
          if (root && root.status === "complete") {
            const { handle, generation } = root;
            const page = await workspace.request({ ...env(), op: "page", root: handle, generation, cursor: 0 });
            const entry = page.ok && page.nodes?.find(({ name }) => name === "同名.md");
            if (!entry) throw Error("Fixture file was not scanned");
            return { root: { handle, generation }, entry: entry.handle };
          }
          await Bun.sleep(2);
        }
        throw Error("Fixture scan incomplete");
      }
      async function setup() {
        const first = await addRoot(directories[0]);
        const second = await addRoot(directories[1]);
        const opened = await workspace.open({ ...env(), root: second.root.handle, entry: second.entry });
        if (!opened.ok || !opened.snapshot) throw Error("Second-root document not opened");
        const { handle, documentId, revision, hash } = opened.snapshot;
        return {
          first,
          second,
          scope: { roots: [first.root, second.root], handles: [handle] },
          mapping: { handle, kind: "matched" as const, entry: second.entry, documentId, revision, hash },
        };
      }
      return {
        rpc, setup,
        async close() {
          rpc.setReady(false);
          await rpc.drain();
          await workspace.dispose();
          await documents.dispose();
        },
      };
    }

    const native = createHarness("native");
    const direct = createHarness("direct");
    try {
      for (const [index, path] of paths.entries()) {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, raw[index]);
        await writeFile(join(directories[index], "budget.md"), "x".repeat(33_000));
      }
      const nativeScope = await native.setup();
      const directScope = await direct.setup();
      Object.defineProperty(globalThis, "Worker", { value: RecordingWorker, configurable: true });
      const literal = "😀中文";
      const onlyFirst = [{ kind: "path", value: "项目 甲/" }] as const;
      const queryRoots = (scope: typeof directScope.scope) => ({
        ...env(), ...scope, op: "query-roots" as const, query: literal, fileFilters: ["同名"],
      });
      async function runCases(harness: typeof direct, scope: typeof directScope) {
        const request = queryRoots(scope.scope);
        const matched = await harness.rpc.run(request);
        expect(validContentSearchResponse(matched, request)).toBe(true);
        if (!matched.ok || matched.op !== "query-roots") throw Error("Search returned no verified coverage");
        expect(matched.coverage).toEqual([scope.first.entry, scope.second.entry].map((entry, index) => ({
          entry,
          bytes: Buffer.byteLength(raw[index]),
          hash: createHash("sha256").update(raw[index]).digest("hex"),
          hit: index === 0 ? { from: 1, to: 5 } : { from: 3, to: 7 },
        })));
        expect(matched.mappings).toEqual([scope.mapping]);
        const noHit = { ...request, ...env(), query: "Target" };
        const noHitResult = await harness.rpc.run(noHit);
        if (!noHitResult.ok || noHitResult.op !== "query-roots") throw Error("Missing zero-hit coverage");
        expect(noHitResult.coverage).toEqual(matched.coverage.map(({ entry, bytes, hash }) => ({ entry, bytes, hash })));
        const filtered = await harness.rpc.run({ ...request, ...env(), pathFilters: onlyFirst });
        expect(filtered).toMatchObject({
          ok: true, coverage: matched.coverage.slice(0, 1),
          mappings: [{ handle: scope.mapping.handle, kind: "outside" }],
        });
        if (!filtered.ok || filtered.op !== "query-roots") throw Error("Missing filtered coverage");
        expect(filtered.coverage).toHaveLength(1);
        expect(await harness.rpc.run({
          ...env(), op: "query", root: scope.second.root.handle, generation: scope.second.root.generation,
          handles: scope.scope.handles, query: literal, fileFilters: ["同名"],
        })).toMatchObject({ ok: true, coverage: matched.coverage.slice(1), mappings: [scope.mapping] });
        return matched.coverage.flatMap(({ bytes, hash, hit }) => hit ? [{ bytes, hash, hit }] : []);
      }

      // Direct must succeed even while another owner occupies the native slot.
      await mkdir(slot, { mode: 0o700 });
      const marker = join(slot, "fixture-owned-marker");
      await writeFile(marker, "keep");
      const directEvidence = await runCases(direct, directScope);
      expect(await readFile(marker, "utf8")).toBe("keep");
      const budget = { ...env(), ...directScope.scope, op: "query-roots" as const, query: literal };
      const directBudget = await direct.rpc.run(budget);
      expect(validContentSearchResponse(directBudget, budget)).toBe(true);
      if (!directBudget.ok || directBudget.op !== "query-roots") throw Error("Missing direct byte coverage");
      expect(directBudget.coverage.flatMap(({ bytes, hash, hit }) => hit ? [{ bytes, hash, hit }] : []))
        .toEqual(directEvidence);
      expect(directBudget.coverage.map(({ bytes }) => bytes).sort((a, b) => a - b))
        .toEqual([...raw.map((text) => Buffer.byteLength(text)).sort((a, b) => a - b), 33_000, 33_000]);
      expect(indexOperations).toEqual([]);
      await rm(slot, { recursive: true });
      const nativeBudget = { ...budget, ...env(), ...nativeScope.scope };
      expect(await native.rpc.run(nativeBudget)).toEqual({
        protocolVersion: 1, requestId: nativeBudget.requestId, ok: false, error: "LIMIT",
      });
      expect(indexOperations).toEqual([]);
      expect(await runCases(native, nativeScope)).toEqual(directEvidence);
      expect(indexOperations).toContain("apply");
      expect(await lstat(slot).catch((error: unknown) => error)).toMatchObject({ code: "ENOENT" });
      indexOperations.length = 0;

      const cancelled = queryRoots(directScope.scope);
      const pending = direct.rpc.run(cancelled);
      const cancel = { ...env(), op: "cancel", targetRequestId: cancelled.requestId };
      expect(await direct.rpc.run(cancel)).toEqual({ protocolVersion: 1, requestId: cancel.requestId, ok: true, op: "cancel" });
      expect(await pending).toEqual({ protocolVersion: 1, requestId: cancelled.requestId, ok: false, error: "CANCELLED" });
      const stale = { ...queryRoots(directScope.scope), roots: [
        directScope.first.root, { ...directScope.second.root, generation: directScope.second.root.generation + 1 },
      ] };
      expect(await direct.rpc.run(stale)).toEqual({ protocolVersion: 1, requestId: stale.requestId, ok: false, error: "STALE" });

      const probe = await open(paths[0], "r");
      const identity = await probe.stat({ bigint: true });
      const prototype = Object.getPrototypeOf(probe) as Pick<FileHandle, "read">;
      const originalRead = Object.getOwnPropertyDescriptor(prototype, "read");
      await probe.close();
      if (!originalRead) throw Error("Missing file read method");
      const read = prototype.read;
      const entered = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      let seen = false;
      Object.defineProperty(prototype, "read", {
        ...originalRead,
        value: async function (this: FileHandle, ...args: unknown[]) {
          const result: unknown = await Reflect.apply(read, this, args);
          if (!seen) {
            const stat = await this.stat({ bigint: true });
            if (stat.dev === identity.dev && stat.ino === identity.ino) {
              seen = true;
              entered.resolve();
              await resume.promise;
            }
          }
          return result;
        },
      });
      try {
        const request = { ...queryRoots(directScope.scope), pathFilters: onlyFirst };
        const pending = direct.rpc.run(request);
        try {
          await Promise.race([entered.promise, pending.then(() => { throw Error("Expected held descriptor read"); })]);
          // The second root contributed no candidate and was valid at query admission.
          await rename(directories[1], join(fixture, "replaced"));
          await mkdir(directories[1]);
        } finally {
          resume.resolve();
        }
        const invalidated = await pending;
        if (invalidated.ok) throw Error("Returned partial coverage after replacing a zero-candidate root");
        expect(["CANCELLED", "UNAVAILABLE"]).toContain(invalidated.error);
        expect(Object.keys(invalidated).sort()).toEqual(["error", "ok", "protocolVersion", "requestId"]);
        expect(indexOperations).toEqual([]);
      } finally {
        Object.defineProperty(prototype, "read", originalRead);
      }
    } finally {
      Object.defineProperty(globalThis, "Worker", { value: OriginalWorker, configurable: true });
      await direct.close();
      await native.close();
      await rm(fixture, { recursive: true, force: true });
    }
  },
  15_000
);

test.skipIf(childScenario !== "coverage")(
  "direct search locates the last covered file at the count and byte boundaries",
  async () => {
    const fixture = await mkdtemp(join(tmpdir(), "workspace-coverage-"));
    let selected: string | null = null;
    const documents = createDocumentService({ pickFile: () => Promise.resolve(null) });
    const workspace = createWorkspaceService({
      documents, pickDirectory: () => Promise.resolve(selected), contentSearchStrategy: "direct",
    });
    const progress: ContentSearchProgress[] = [];
    const rpc = createContentSearchRPC(
      workspace,
      async (handle) => (await documents.release({ ...env(), handle })).ok,
      (event) => progress.push(event)
    );
    rpc.setReady(true);

    async function joinFixture(label: string, files: ReadonlyMap<string, string>) {
      const path = join(fixture, label);
      await mkdir(path);
      for (const [name, raw] of files) await writeFile(join(path, name), raw);
      selected = path;
      const canonical = await realpath(path);
      if (!(await workspace.request({ ...env(), op: "select" })).ok)
        throw Error("Fixture root not joined");
      for (let i = 0; i < 1000; i++) {
        const state = await workspace.request({ ...env(), op: "state" });
        const root = state.ok && state.roots.find(({ displayPath }) => displayPath === canonical);
        if (root && root.status === "complete") return { root, files };
        await Bun.sleep(2);
      }
      throw Error("Fixture scan did not complete");
    }
    function joinNumberedFixture(count: number) {
      const files = new Map(Array.from({ length: count }, (_, index) => {
        const name = `note-${String(index + 1).padStart(2, "0")}.md`;
        return [name, `\uFEFF😀target\r\n${name}`];
      }));
      return joinFixture(String(count), files);
    }
    async function entryRaw(root: { handle: string; generation: number }, files: ReadonlyMap<string, string>, entry: string) {
      const page = await workspace.request({
        ...env(), op: "page", root: root.handle, generation: root.generation, cursor: 0,
      });
      const node = page.ok && page.nodes?.find(({ handle }) => handle === entry);
      if (!node || node.kind !== "file") throw Error("Missing last scan entry");
      const raw = files.get(node.name);
      if (raw === undefined) throw Error("Missing last fixture file");
      return raw;
    }

    try {
      const { root, files } = await joinNumberedFixture(32);
      const request = {
        ...env(), op: "query" as const, root: root.handle, generation: root.generation,
        query: "target", handles: [], fragments: true as const, stream: true as const,
      };
      const receipt = await rpc.run(request);
      expect(validContentSearchResponse(receipt, request)).toBe(true);
      if (!receipt.ok || receipt.op !== "query") throw Error("Missing direct coverage");
      expect(receipt.coverage).toHaveLength(32);
      expect(progress.map(({ sequence }) => sequence)).toEqual(Array.from({ length: 32 }, (_, index) => index + 1));
      expect(progress.map(({ entry }) => entry)).toEqual(receipt.coverage.map(({ entry }) => entry));
      expect(progress.every((event) => validContentSearchProgress(event, request))).toBe(true);
      const last = receipt.coverage[31];
      expect(progress[31]).toMatchObject({
        entry: last.entry, sequence: 32, kind: "fragments",
        fragments: { matches: [{ from: 3, to: 9 }], more: false },
      });
      const raw = await entryRaw(root, files, last.entry);
      expect(last.hash).toBe(createHash("sha256").update(raw).digest("hex"));
      const prepare = {
        ...env(), root: root.handle, generation: root.generation, entry: last.entry, expectedHash: last.hash,
      };
      const opened = await rpc.prepare(prepare);
      expect(validContentSearchPrepareResponse(opened, prepare)).toBe(true);
      if (!opened.ok) throw Error("Missing last-entry fresh snapshot: " + opened.error);
      if (opened.target.kind !== "open") throw Error("Unexpected last-entry fresh target");
      const snapshot = opened.target.snapshot;
      expect(snapshot.text).toBe(raw);
      const retained = {
        ...env(), op: "prepare-retained" as const, roots: [{ handle: root.handle, generation: root.generation }],
        rootEntry: last.entry, entry: snapshot.handle, expectedHash: last.hash,
      };
      const reopened = await rpc.prepare(retained);
      expect(validContentSearchPrepareResponse(reopened, retained)).toBe(true);
      expect(reopened).toMatchObject({
        ok: true, target: { kind: "retained", snapshot: {
          handle: snapshot.handle, documentId: snapshot.documentId, text: raw, explicitStandalone: false,
        } },
      });

      const over = await joinNumberedFixture(33);
      const filtered = {
        ...request, ...env(), root: over.root.handle, generation: over.root.generation,
        fileFilters: ["note-01.md"],
      };
      expect(await rpc.run(filtered)).toEqual({
        protocolVersion: 1, requestId: filtered.requestId, ok: false, error: "LIMIT",
      });
      expect(progress).toHaveLength(32);
      expect(await documents.release({ ...env(), handle: snapshot.handle })).toMatchObject({ ok: true });
      const native = await joinNumberedFixture(17);
      expect(await workspace.searchSnapshot(native.root.handle, native.root.generation, "target"))
        .toEqual({ ok: false, error: "LIMIT", accepted: false });

      const budgetFiles = new Map(["first.md", "second.md"].map((name) => {
        const prefix = `\uFEFF😀target\r\n${name}\n`;
        return [name, prefix + "x".repeat(65_536 - Buffer.byteLength(prefix))];
      }));
      const boundary = await joinFixture("exact-byte-budget", budgetFiles);
      const exact = { ...request, ...env(), root: boundary.root.handle, generation: boundary.root.generation };
      const started = performance.now();
      const exactReceipt = await rpc.run(exact);
      const elapsed = performance.now() - started;
      expect(validContentSearchResponse(exactReceipt, exact)).toBe(true);
      if (!exactReceipt.ok || exactReceipt.op !== "query") throw Error("Missing exact byte coverage");
      console.info(`Direct 128 KiB query observed ${elapsed.toFixed(2)} ms`);
      expect(exactReceipt.coverage.map(({ bytes }) => bytes)).toEqual([65_536, 65_536]);
      expect(exactReceipt.coverage.map(({ fragments }) => fragments?.matches.map(({ from, to }) => ({ from, to }))))
        .toEqual([[{ from: 3, to: 9 }], [{ from: 3, to: 9 }]]);
      const second = exactReceipt.coverage[1];
      const secondRaw = await entryRaw(boundary.root, budgetFiles, second.entry);
      expect(second.hash).toBe(createHash("sha256").update(secondRaw).digest("hex"));
      const locateSecond = {
        ...env(), root: exact.root, generation: exact.generation, entry: second.entry, expectedHash: second.hash,
      };
      const exactOpened = await rpc.prepare(locateSecond);
      expect(validContentSearchPrepareResponse(exactOpened, locateSecond)).toBe(true);
      if (!exactOpened.ok || exactOpened.target.kind !== "open") throw Error("Missing exact-budget second snapshot");
      expect(exactOpened.target.snapshot.text).toBe(secondRaw);
      expect(progress.slice(32).map(({ requestId, sequence }) => ({ requestId, sequence }))).toEqual([
        { requestId: exact.requestId, sequence: 1 }, { requestId: exact.requestId, sequence: 2 },
      ]);

      const overflow = await joinFixture("overflow-by-one", new Map([...budgetFiles, ["extra.md", "x"]]));
      const excess = { ...request, ...env(), root: overflow.root.handle, generation: overflow.root.generation };
      expect(await rpc.run(excess)).toEqual({
        protocolVersion: 1, requestId: excess.requestId, ok: false, error: "LIMIT",
      });
      expect(progress.slice(34).map(({ requestId, sequence }) => ({ requestId, sequence }))).toEqual([
        { requestId: excess.requestId, sequence: 1 }, { requestId: excess.requestId, sequence: 2 },
      ]);

      const oversized = await joinFixture("oversized-single-file", new Map([["single.md", "x".repeat(65_537)]]));
      const tooLarge = { ...request, ...env(), root: oversized.root.handle, generation: oversized.root.generation };
      expect(await rpc.run(tooLarge)).toEqual({
        protocolVersion: 1, requestId: tooLarge.requestId, ok: false, error: "LIMIT",
      });
      expect(progress).toHaveLength(36);
    } finally {
      rpc.setReady(false);
      await rpc.drain();
      await workspace.dispose();
      await documents.dispose();
      await rm(fixture, { recursive: true, force: true });
    }
  },
  15_000
);

test.skipIf(childScenario !== "mixed")(
  "searches exact workspace roots and retained standalone grants in one direct budget",
  async () => {
    const fixture = await mkdtemp(join(tmpdir(), "workspace-mixed-"));
    const firstPath = join(fixture, "first");
    const secondPath = join(fixture, "second");
    const thirdPath = join(fixture, "third");
    const standalonePath = join(fixture, "explicit.md");
    const aliasPath = join(fixture, "hard-alias.md");
    const hiddenPath = join(firstPath, ".hidden.md");
    const visiblePath = join(firstPath, "项目 甲", "visible.md");
    const peerPath = join(secondPath, "项目 乙", "peer.md");
    const oversizedPath = join(fixture, "oversized.md");
    const sharedBudgetPath = join(fixture, "standalone-budget.md");
    const original = "\uFEFF😀\r\n中文target";
    const revised = "\uFEFF改写😀target";
    const hiddenRaw = "hidden target";
    const visibleRaw = "visible target";
    const peerRaw = "peer target";
    const query = "target";
    let selectedFile = standalonePath;
    let selectedFolder = firstPath;
    function readGate() {
      return { checked: 0, entered: Promise.withResolvers<void>(), resume: Promise.withResolvers<void>() };
    }
    let gate: ReturnType<typeof readGate> | undefined;
    const documents = createDocumentService({
      pickFile: () => Promise.resolve(selectedFile),
      async verify(grant, check) {
        const state = gate;
        const stat = await verifySingleFileAuthorization(grant, check);
        if (state && grant.path.endsWith("/explicit.md") && ++state.checked === 2) {
          state.entered.resolve();
          await state.resume.promise;
        }
        return stat;
      },
    });
    const workspace = createWorkspaceService({
      documents, pickDirectory: () => Promise.resolve(selectedFolder),
    });
    type Input = Parameters<typeof workspace.searchContentCandidatesForWorkspace>[0];
    const rootless = { roots: [], standaloneHandles: [], query, handles: [] };
    const search = (input: Input, signal?: AbortSignal, onFile?: (event: ContentSearchFileProgress) => void) =>
      workspace.searchContentCandidatesForWorkspace(input, signal, onFile);
    const sha = (raw: string) => createHash("sha256").update(raw).digest("hex");
    const evidence = (entry: string, raw: string) => {
      const from = raw.indexOf(query);
      return {
        entry, hash: sha(raw), bytes: Buffer.byteLength(raw),
        ...(from < 0 ? {} : { hit: { from, to: from + query.length } }),
      };
    };
    async function select(path: string) {
      selectedFile = path;
      const opened = await documents.select(env());
      if (!opened.ok || !opened.snapshot) throw Error("Fixture picker grant missing");
      return opened.snapshot;
    }
    async function joinRoot(path: string) {
      selectedFolder = path;
      const canonical = await realpath(path);
      if (!(await workspace.request({ ...env(), op: "select" })).ok) throw Error("Fixture root not joined");
      for (let i = 0; i < 1000; i++) {
        const state = await workspace.request({ ...env(), op: "state" });
        const root = state.ok && state.roots.find((item) => item.displayPath === canonical);
        if (root && root.status === "complete") return { handle: root.handle, generation: root.generation };
        await Bun.sleep(2);
      }
      throw Error("Fixture scan did not complete");
    }
    async function entryFor(root: { handle: string; generation: number }, name: string) {
      const page = await workspace.request({ ...env(), op: "page", root: root.handle, generation: root.generation, cursor: 0 });
      const entry = page.ok && page.nodes?.find((node) => node.name === name);
      if (!entry) throw Error("Fixture scan entry missing");
      return entry.handle;
    }

    try {
      await mkdir(dirname(visiblePath), { recursive: true });
      await mkdir(dirname(peerPath), { recursive: true });
      await mkdir(thirdPath);
      await writeFile(join(thirdPath, "added.md"), query);
      await writeFile(standalonePath, original);
      await link(standalonePath, aliasPath);
      await writeFile(hiddenPath, hiddenRaw);
      await writeFile(visiblePath, visibleRaw);
      await writeFile(peerPath, peerRaw);
      await writeFile(oversizedPath, "x".repeat(65_537));
      await writeFile(sharedBudgetPath, "x".repeat(27_000));
      for (const rootPath of [firstPath, secondPath]) await writeFile(join(rootPath, "budget.md"), "x".repeat(53_000));
      for (let i = 0; i < 8; i++) await writeFile(join(firstPath, `pad-${i}.md`), "");
      for (let i = 0; i < 16; i++) await writeFile(join(firstPath, `pad-7-extra-${i}.md`), "");

      const standalone = await select(standalonePath);
      const hardAlias = await select(aliasPath);
      const hidden = await select(hiddenPath);
      const visible = await select(visiblePath);
      const oversized = await select(oversizedPath);
      const sharedBudget = await select(sharedBudgetPath);
      const { handle, documentId, revision, hash } = standalone;
      expect(await documents.observe({
        ...env(), handle, documentId, revision, hash,
        active: false, watchToken: crypto.randomUUID(), watchEpoch: 1,
      })).toMatchObject({ ok: true });
      expect(await search(rootless)).toEqual({ ok: false, error: "INVALID" });
      const independent = { ...rootless, standaloneHandles: [handle] };
      expect(await search({ ...independent, standaloneHandles: [handle, handle] }))
        .toEqual({ ok: false, error: "INVALID" });
      expect(await search(independent)).toEqual({
        ok: true,
        coverage: [{
          entry: handle, hash: sha(original), bytes: Buffer.byteLength(original), hit: { from: 7, to: 13 },
        }],
        mappings: [],
      });
      expect(hardAlias.documentId).not.toBe(documentId);
      await writeFile(standalonePath, revised);
      expect(await search({ ...independent, standaloneHandles: [handle, hardAlias.handle], handles: [handle] }))
        .toEqual({
          ok: true,
          coverage: [evidence(handle, revised), evidence(hardAlias.handle, revised)],
          mappings: [{ handle, kind: "matched", entry: handle, documentId, revision, hash }],
        });
      expect(sha(revised)).not.toBe(hash);
      const excluded = { ...independent, standaloneHandles: [handle, oversized.handle], handles: [oversized.handle] };
      expect(await search(excluded)).toEqual({ ok: false, error: "LIMIT" });
      expect(await search({ ...excluded, pathFilters: [{ kind: "path", value: "explicit.md" }] }))
        .toEqual({
          ok: true, coverage: [evidence(handle, revised)],
          mappings: [{ handle: oversized.handle, kind: "outside" }],
        });
      expect(await search({ ...independent, standaloneHandles: [sharedBudget.handle] }))
        .toMatchObject({ ok: true, coverage: [{ entry: sharedBudget.handle, bytes: 27_000 }] });

      const first = await joinRoot(firstPath);
      const second = await joinRoot(secondPath);
      const firstEntry = await entryFor(first, "visible.md");
      const secondEntry = await entryFor(second, "peer.md");
      const mixed = { ...rootless, roots: [first, second] };
      expect(await search({ ...mixed, roots: [first] })).toEqual({ ok: false, error: "STALE" });
      expect(await search({ ...mixed, roots: [second, first] })).toEqual({ ok: false, error: "STALE" });
      const all = { ...mixed, standaloneHandles: [visible.handle, hidden.handle, handle] };
      const selected = await search({
        ...all,
        pathFilters: [{ kind: "-path", value: "budget" }, { kind: "-path", value: "pad-" }],
        handles: [visible.handle, hidden.handle, handle],
      });
      if (!selected.ok) throw Error("Missing mixed coverage: " + selected.error);
      expect(selected.coverage).toHaveLength(4);
      expect(selected.coverage).toContainEqual(evidence(firstEntry, visibleRaw));
      expect(selected.coverage).toContainEqual(evidence(secondEntry, peerRaw));
      expect(selected.coverage).toContainEqual(evidence(hidden.handle, hiddenRaw));
      expect(selected.coverage).toContainEqual(evidence(handle, revised));
      expect(selected.mappings).toEqual([
        { handle: visible.handle, kind: "matched", entry: firstEntry, documentId: visible.documentId, revision: visible.revision, hash: visible.hash },
        { handle: hidden.handle, kind: "matched", entry: hidden.handle, documentId: hidden.documentId, revision: hidden.revision, hash: hidden.hash },
        { handle, kind: "matched", entry: handle, documentId, revision, hash },
      ]);
      const rpc = createContentSearchRPC(workspace);
      rpc.setReady(true);
      const wire = {
        ...env(), ...all, op: "query-workspace" as const,
        fileFilters: [".hidden.md"], handles: [hidden.handle],
      };
      const receipt = await rpc.run(wire);
      expect(validContentSearchResponse(receipt, wire)).toBe(true);
      if (!receipt.ok || receipt.op !== "query-workspace") throw Error("Missing mixed transport receipt");
      expect(receipt).toMatchObject({
        roots: mixed.roots, standaloneHandles: all.standaloneHandles,
        coverage: [evidence(hidden.handle, hiddenRaw)], mappings: [selected.mappings[1]],
      });
      expect(receipt.coverage).toHaveLength(1);
      const grouped = { ...wire, ...env(), fragments: true as const };
      const groupedReceipt = await rpc.run(grouped);
      expect(validContentSearchResponse(groupedReceipt, grouped)).toBe(true);
      expect(groupedReceipt).toMatchObject({
        ok: true,
        coverage: [{
          entry: hidden.handle, bytes: Buffer.byteLength(hiddenRaw), hash: sha(hiddenRaw),
          fragments: { matches: [{ from: 7, to: 13, before: "hidden ", after: "" }], more: false },
        }],
      });
      const groupedDirectory = {
        ...env(), op: "query" as const, root: first.handle, generation: first.generation,
        query, handles: [], fragments: true as const,
        pathFilters: ["budget", ...Array.from({ length: 7 }, (_, i) => `pad-${i + 1}`)]
          .map((value) => ({ kind: "-path" as const, value })),
      };
      const directoryReceipt = await rpc.run(groupedDirectory);
      expect(validContentSearchResponse(directoryReceipt, groupedDirectory)).toBe(true);
      if (!directoryReceipt.ok || directoryReceipt.op !== "query") throw Error("Missing grouped directory receipt");
      expect(directoryReceipt.coverage).toHaveLength(2);
      expect(directoryReceipt.coverage).toContainEqual({
        entry: firstEntry, bytes: Buffer.byteLength(visibleRaw), hash: sha(visibleRaw),
        fragments: { matches: [{ from: 8, to: 14, before: "visible ", after: "" }], more: false },
      });
      expect(directoryReceipt.coverage).toContainEqual({
        entry: await entryFor(first, "pad-0.md"), bytes: 0, hash: sha(""),
        fragments: { matches: [], more: false },
      });
      const prepare = {
        ...env(), op: "prepare-retained" as const, roots: mixed.roots,
        entry: hidden.handle, expectedHash: receipt.coverage[0].hash,
      };
      const locations = documents.locations();
      const prepared = await rpc.prepare(prepare);
      expect(validContentSearchPrepareResponse(prepared, prepare)).toBe(true);
      expect(prepared).toMatchObject({
        ok: true,
        target: { kind: "retained", snapshot: {
          handle: hidden.handle, locationId: hidden.locationId, documentId: hidden.documentId,
          revision: hidden.revision, explicitStandalone: true, text: hiddenRaw,
        } },
      });
      expect(documents.locations()).toEqual(locations);
      await rpc.drain();
      expect(await search(mixed)).toMatchObject({ ok: true });
      expect(await search({ ...mixed, standaloneHandles: [sharedBudget.handle] }))
        .toEqual({ ok: false, error: "LIMIT" });
      const atCoverageLimit = {
        ...mixed,
        standaloneHandles: [visible.handle, hidden.handle, handle, hardAlias.handle, oversized.handle],
        fileFilters: ["visible.md"],
      };
      expect(await search(atCoverageLimit)).toEqual({ ok: true, coverage: [evidence(firstEntry, visibleRaw)], mappings: [] });
      expect(await search({ ...atCoverageLimit, standaloneHandles: [...atCoverageLimit.standaloneHandles, sharedBudget.handle] }))
        .toEqual({ ok: false, error: "LIMIT" });
      const scoped = await workspace.open({ ...env(), root: second.handle, entry: secondEntry });
      if (!scoped.ok || !scoped.snapshot) throw Error("Missing directory-derived grant");
      expect(await search({ ...mixed, standaloneHandles: [scoped.snapshot.handle] }))
        .toEqual({ ok: false, error: "STALE" });

      const progressInput = {
        ...mixed, standaloneHandles: [handle],
        pathFilters: ["budget", "pad-", "peer.md"].map((value) => ({ kind: "-path" as const, value })),
      };
      const groupedProgress = { ...progressInput, fragments: true as const };
      const firstProgress: ContentSearchFileProgress = {
        sequence: 1, entry: firstEntry, kind: "fragments",
        fragments: { matches: [{ from: 8, to: 14, before: "visible ", after: "" }], more: false },
      };
      const standaloneProgress: ContentSearchFileProgress = {
        sequence: 2, entry: handle, kind: "fragments",
        fragments: { matches: [{ from: 5, to: 11, before: "\uFEFF改写😀", after: "" }], more: false },
      };
      const redacted = ({ sequence, entry }: ContentSearchFileProgress): ContentSearchFileProgress =>
        ({ sequence, entry, kind: "redacted" });
      const observed: ContentSearchFileProgress[] = [];
      const recordProgress = (event: ContentSearchFileProgress) => observed.push(event);
      expect(await workspace.searchContentCandidates({
        root: first.handle, generation: first.generation, query, handles: [], fragments: true,
        pathFilters: groupedDirectory.pathFilters,
      }, undefined, recordProgress)).toMatchObject({ ok: true });
      const directoryProgress = observed.splice(0);
      expect(directoryProgress.map(({ sequence }) => sequence)).toEqual([1, 2]);
      expect(directoryProgress).toContainEqual({
        sequence: directoryProgress.find(({ entry }) => entry === firstEntry)?.sequence ?? 0,
        entry: firstEntry, kind: "fragments", fragments: firstProgress.fragments,
      });
      const emptyEntry = await entryFor(first, "pad-0.md");
      expect(directoryProgress).toContainEqual({
        sequence: directoryProgress.find(({ entry }) => entry === emptyEntry)?.sequence ?? 0,
        entry: emptyEntry, kind: "fragments", fragments: { matches: [], more: false },
      });
      expect(await search(progressInput, undefined, recordProgress)).toMatchObject({ ok: true });
      expect(observed).toEqual([]);
      expect(await search({ ...groupedProgress, handles: [visible.handle] }, undefined, recordProgress))
        .toMatchObject({ ok: true, mappings: [{ kind: "matched", entry: firstEntry }] });
      expect(observed.splice(0)).toEqual([redacted(firstProgress), standaloneProgress]);
      const unknown = crypto.randomUUID();
      expect(await search({ ...groupedProgress, handles: [unknown] }, undefined, recordProgress))
        .toMatchObject({ ok: true, mappings: [{ kind: "unresolved", handle: unknown }] });
      expect(observed.splice(0)).toEqual([redacted(firstProgress), redacted(standaloneProgress)]);

      const successful = await search(groupedProgress);
      expect(successful).toMatchObject({ ok: true });
      const mutating = await search(groupedProgress, undefined, (event) => {
        recordProgress(event);
        if (event.kind === "fragments") {
          event.fragments.matches[0].before = "mutated";
          event.fragments.matches.length = 0;
          event.fragments.more = true;
        }
        throw Error("Synthetic progress sink failure");
      });
      expect(observed.splice(0).length).toBeGreaterThan(0);
      expect(mutating).toEqual(successful);
      const overBudget = await search({
        ...mixed, standaloneHandles: [sharedBudget.handle], fragments: true,
      }, undefined, recordProgress);
      expect(overBudget).toEqual({ ok: false, error: "LIMIT" });
      expect(observed.splice(0).length).toBeGreaterThan(0);

      async function interrupt(
        input: Input, invalidate: () => Promise<void> | void, signal?: AbortSignal,
        onFile?: (event: ContentSearchFileProgress) => void
      ) {
        const state = readGate();
        gate = state;
        let settled = false;
        const pending = search(input, signal, onFile).then((result) => {
          settled = true;
          return result;
        });
        try {
          await Promise.race([state.entered.promise, pending.then((result) => {
            throw Error("Expected held standalone read: " + JSON.stringify(result));
          })]);
          await invalidate();
          expect(settled).toBe(false);
        } finally {
          gate = undefined;
          state.resume.resolve();
        }
        expect(await pending).toEqual({ ok: false, error: "CANCELLED" });
      }
      const externalOnly = { ...mixed, standaloneHandles: [handle], fileFilters: ["explicit.md"] };
      const abort = new AbortController();
      await interrupt(groupedProgress, async () => {
        // One real file was verified and published while the second file was
        // still held. Cancelling cannot make the slot reusable prematurely.
        expect(observed).toEqual([firstProgress]);
        abort.abort();
        expect(await workspace.searchContentCandidatesForRoots({ roots: mixed.roots, handles: [], query }))
          .toEqual({ ok: false, error: "BUSY" });
        expect(observed).toEqual([firstProgress]);
      }, abort.signal, recordProgress);
      expect(observed.splice(0)).toEqual([firstProgress]);
      expect(await search(groupedProgress, undefined, recordProgress)).toEqual(successful);
      expect(observed.splice(0)).toEqual([firstProgress, standaloneProgress]);

      const wireEvents: ContentSearchProgress[] = [];
      const streamingRPC = createContentSearchRPC(workspace, undefined, (event) => wireEvents.push(event));
      streamingRPC.setReady(true);
      const plainRequest = {
        ...groupedProgress, ...env(), op: "query-workspace" as const, handles: [visible.handle],
      };
      const plainTerminal = await streamingRPC.run(plainRequest);
      expect(plainTerminal).toMatchObject({ ok: true });
      expect(wireEvents).toEqual([]);
      const stream = { ...plainRequest, ...env(), stream: true as const };
      const nextStream = { ...stream, ...env() };
      const blocked = readGate();
      gate = blocked;
      let finished = false;
      let nextFinished = false;
      let nextPending: ReturnType<typeof streamingRPC.run> | undefined;
      const wirePending = streamingRPC.run(stream).then((response) => {
        finished = true;
        return response;
      });
      const firstWireEvent = (requestId: string) => ({
        protocolVersion: 1 as const, requestId, ...redacted(firstProgress),
      });
      try {
        await Promise.race([blocked.entered.promise, wirePending.then((result) => {
          throw Error("Stream completed before second read was held: " + JSON.stringify(result));
        })]);
        expect(wireEvents).toEqual([firstWireEvent(stream.requestId)]);
        expect(validContentSearchProgress(wireEvents[0], stream)).toBe(true);
        const cancel = { ...env(), op: "cancel" as const, targetRequestId: stream.requestId };
        expect(await streamingRPC.run(cancel)).toEqual({
          protocolVersion: 1, requestId: cancel.requestId, ok: true, op: "cancel",
        });
        nextPending = streamingRPC.run(nextStream).then((response) => {
          nextFinished = true;
          return response;
        });
        expect(await streamingRPC.run({ ...plainRequest, ...env() })).toMatchObject({ error: "BUSY" });
        expect(finished).toBe(false);
        expect(nextFinished).toBe(false);
        expect(wireEvents).toEqual([firstWireEvent(stream.requestId)]);
      } finally {
        gate = undefined;
        blocked.resume.resolve();
      }
      expect(await wirePending).toEqual({
        protocolVersion: 1, requestId: stream.requestId, ok: false, error: "CANCELLED",
      });
      expect(await nextPending).toEqual({ ...plainTerminal, requestId: nextStream.requestId });
      expect(wireEvents).toEqual([
        firstWireEvent(stream.requestId),
        firstWireEvent(nextStream.requestId),
        { protocolVersion: 1, requestId: nextStream.requestId, ...standaloneProgress },
      ]);
      expect(wireEvents.slice(1).every((event) => validContentSearchProgress(event, nextStream))).toBe(true);
      await streamingRPC.drain();

      await interrupt(groupedProgress, async () => {
        expect(observed).toEqual([firstProgress]);
        await joinRoot(thirdPath);
      }, undefined, recordProgress);
      expect(observed.splice(0)).toEqual([firstProgress]);
      const current = await workspace.request({ ...env(), op: "state" });
      if (!current.ok) throw Error("Root roster unavailable");
      const complete = { ...externalOnly, roots: current.roots.map(({ handle, generation }) => ({ handle, generation })) };
      expect(await search(complete)).toMatchObject({ ok: true, coverage: [evidence(handle, revised)] });
      const blockedPath = await realpath(standalonePath);
      documents.setTrashGuard((path) => path === blockedPath);
      expect(await search(complete)).toEqual({ ok: false, error: "BUSY" });
      expect(await search({ ...complete, fileFilters: ["no-match"] })).toEqual({ ok: false, error: "BUSY" });
      documents.setTrashGuard(() => false);
      await rename(standalonePath, join(fixture, "old.md"));
      await writeFile(standalonePath, "replacement target");
      expect(await search(complete)).toEqual({ ok: false, error: "UNAVAILABLE" });
      expect(await documents.release({ ...env(), handle })).toMatchObject({ ok: true });
      expect(await search(complete)).toEqual({ ok: false, error: "STALE" });
      expect(await lstat(slot).catch((error: unknown) => error)).toMatchObject({ code: "ENOENT" });
    } finally {
      gate?.resume.resolve();
      await workspace.dispose();
      await documents.dispose();
      await rm(fixture, { recursive: true, force: true });
    }
  },
  15_000
);

for (const scenario of ["native", "transport", "candidates", "file-filters", "path-filters", "multi-root", "direct", "coverage", "mixed"] as const)
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
