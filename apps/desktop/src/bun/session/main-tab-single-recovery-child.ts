import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createDocumentMRU } from "../document-mru";
import { createDocumentService } from "../documents";
import { createWorkspaceService } from "../workspace";
import { createRootRosterService } from "../workspace/root-roster-service";

import { createGuardedMainTabCheckpoint } from "./main-tab-checkpoint";
import { createMainTabCheckpointMetadataStore, type MainTabMetadataWrite } from "./main-tab-metadata";
import { createSingleMainTabRecoveryReader, type SingleMainTabRecoveryResult } from "./main-tab-single-recovery";

const [operation, directory] = process.argv.slice(2);
if (!directory || !["write", "read", "reject"].includes(operation)) throw Error("Recovery fixture arguments required");
const folder = join(directory, "workspace");
const path = join(folder, "original.md");
const settings = join(directory, "metadata");
const checkpoint = join(settings, "main-tab-session-checkpoint.json");
const mru = createDocumentMRU(settings);
await mru.initialize();
const mruPath = join(settings, "document-mru.json");
const originalMru = await readFile(mruPath, "utf8");
const documents = createDocumentService({ pickFile: () => Promise.resolve(null), mru });
const roster = createRootRosterService(join(directory, "roster"), () => workspace.rootMutationsSuspended(),
  () => undefined, () => workspace.rootMutationGeneration());
const workspace = createWorkspaceService({ documents, pickDirectory: () => Promise.resolve(folder),
  onRootRosterCommitted: (event) => roster.committed(event) });
const request = () => ({ protocolVersion: 1 as const, requestId: crypto.randomUUID() });
const call = async (op: string, more: object = {}) => {
  const reply = await workspace.request({ ...request(), op, ...more });
  if (!reply.ok) throw Error("Recovery fixture workspace unavailable");
  return reply;
};
async function scan(handle: string) {
  for (let turn = 0; turn < 500; turn++) {
    const root = (await call("state")).roots.find(value => value.handle === handle);
    if (root?.status === "complete") {
      await roster.drain();
      return root;
    }
    await Bun.sleep(2);
  }
  throw Error("Recovery fixture scan incomplete");
}
const brief = (result: SingleMainTabRecoveryResult) => result.status === "ready" ? "ready" : `${result.status}:${result.reason}`;

try {
  const pending = (await roster.request({ protocolVersion: 1, op: "list" })).pending;
  const initial = { pending: pending.length, roots: (await call("state")).roots.length, grants: documents.locations().length };
  const selected = (await call("select")).selectedRoot;
  if (!selected) throw Error("Recovery fixture picker missed receipt");
  const root = await scan(selected.handle);
  if (operation === "write") {
    const page = await call("page", { root: root.handle, generation: root.generation, cursor: 0 });
    const file = page.nodes?.find(node => node.name === "original.md" && node.kind === "file");
    if (!file) throw Error("Recovery fixture source missing");
    const opened = await workspace.open({ ...request(), root: root.handle, entry: file.handle });
    if (!opened.ok || !opened.snapshot) throw Error("Recovery fixture source open failed");
    const { handle, documentId, revision, hash } = opened.snapshot;
    const writer = createGuardedMainTabCheckpoint(settings, { workspace, roster });
    try {
      const written = await writer.write({ tabs: [{ handle, documentId, revision, hash, pinned: true, mode: "source" }], activeIndex: 0 }, () => true);
      console.info(JSON.stringify({ written, mruUnchanged: await readFile(mruPath, "utf8") === originalMru }));
    } finally { await writer.close(); }
  } else {
    const expectedRootId = pending[0]?.id;
    if (!expectedRootId) throw Error("Recovery fixture pending ID missing");
    const input = () => ({ requestId: crypto.randomUUID(), root: root.handle, generation: root.generation, expectedRootId });
    const reader = createSingleMainTabRecoveryReader(settings, { workspace, roster, documents });
    try {
      const authoritative = await readFile(checkpoint, "utf8");
      if (operation === "read") {
        const opened = await reader.read(input(), () => true);
        if (opened.status !== "ready") throw Error(brief(opened));
        const proof = opened.current();
        const grants = documents.locations().length;
        const released = await opened.release();
        console.info(JSON.stringify({ initial, proof, grants, mode: opened.mode, pinned: opened.pinned,
          currentText: opened.snapshot.text === "# Current contents\n", treeAuthority: opened.snapshot.explicitStandalone === false,
          released, releasedProof: opened.current(), finalGrants: documents.locations().length,
          metadataUnchanged: await readFile(checkpoint, "utf8") === authoritative,
          mruUnchanged: await readFile(mruPath, "utf8") === originalMru }));
      } else {
        const wrongRoot = brief(await reader.read({ ...input(), expectedRootId: crypto.randomUUID() }, () => true));
        const expired = brief(await reader.read(input(), () => false));
        const metadata = createMainTabCheckpointMetadataStore(settings);
        const saved = await metadata.read();
        await metadata.close();
        if (saved.status !== "valid") throw Error("Recovery fixture record missing");
        const variants = [
          JSON.stringify({ version: 7, data: saved.data }),
          JSON.stringify({ version: 1, data: { tabs: [], activeIndex: null } }),
          JSON.stringify({ version: 1, data: { tabs: [...saved.data.tabs, { ...saved.data.tabs[0], relativePath: "other.md" }], activeIndex: 0 } }),
        ];
        await writeFile(`${checkpoint}.bak`, authoritative);
        const protectedResults = [];
        for (const variant of variants) {
          await writeFile(checkpoint, variant);
          const result = brief(await reader.read(input(), () => true));
          protectedResults.push({ result, preserved: await readFile(checkpoint, "utf8") === variant });
        }
        await writeFile(checkpoint, authoritative);

        const rewrite = createSingleMainTabRecoveryReader(settings, { roster, documents,
          workspace: { ...workspace, openMainTabCandidate: (target, proof) => workspace.openMainTabCandidate(target, {
            ...proof, async verify(current) { await writeFile(checkpoint, variants[1]); await proof.verify(current); },
          }) },
        });
        const changedRecord = brief(await rewrite.read(input(), () => true));
        await rewrite.close();
        await writeFile(checkpoint, authoritative);

        const page = await call("page", { root: root.handle, generation: root.generation, cursor: 0 });
        const sentinel = page.nodes?.find(node => node.name === "sentinel.md");
        if (!sentinel) throw Error("Recovery fixture sentinel missing");
        const previous = await workspace.open({ ...request(), root: root.handle, entry: sentinel.handle });
        if (!previous.ok || !previous.snapshot) throw Error("Recovery fixture sentinel open failed");
        const previousHandle = previous.snapshot.handle;
        const alternate = { tabs: [{ ...saved.data.tabs[0], pinned: false }], activeIndex: 0 };
        const raceWriter = createMainTabCheckpointMetadataStore(settings);
        const publication = Promise.withResolvers<MainTabMetadataWrite>();
        let verified = false;
        let queued = false;
        const racing = createSingleMainTabRecoveryReader(settings, { roster, documents,
          workspace: { ...workspace, openMainTabCandidate: (target, proof) => workspace.openMainTabCandidate(target, {
            check() {
              proof.check();
              if (!verified || queued) return;
              queued = true;
              // Admit the write while the post-reread physical check is awaiting the filesystem.
              queueMicrotask(() => { void raceWriter.write(alternate, () => true).then(publication.resolve, publication.reject); });
            },
            async verify(current) { await proof.verify(current); verified = true; },
          }) },
        });
        const afterReread = brief(await racing.read(input(), () => true));
        const racedPublication = queued ? (await publication.promise).status : "not-admitted";
        const priorGrantKept = documents.locations().length === 1 && documents.locations()[0].handle === previousHandle;
        await racing.close();
        await writeFile(checkpoint, authoritative);

        const afterOpen = createSingleMainTabRecoveryReader(settings, { roster, documents,
          workspace: { ...workspace, async openMainTabCandidate(target, proof) {
            const opened = await workspace.openMainTabCandidate(target, proof);
            if (opened.ok && opened.snapshot) await raceWriter.write(alternate, () => true);
            return opened;
          } },
        });
        const staleAfterOpen = brief(await afterOpen.read(input(), () => true));
        const priorGrantKeptAfterOpen = documents.locations().length === 1 && documents.locations()[0].handle === previousHandle;
        await afterOpen.close();
        await raceWriter.close();
        await documents.release({ ...request(), handle: previousHandle });
        await writeFile(checkpoint, authoritative);

        async function late(loseRelease: boolean) {
          let current = true;
          let releases = 0;
          const delayed = createSingleMainTabRecoveryReader(settings, { roster,
            workspace: { ...workspace, async openMainTabCandidate(target, proof) {
              const result = await workspace.openMainTabCandidate(target, proof);
              current = false;
              return result;
            } },
            documents: { release: (input) => {
              releases++;
              return loseRelease ? Promise.reject(Error("Fixture cleanup reply unavailable")) : documents.release(input);
            } },
          });
          try {
            const result = brief(await delayed.read(input(), () => current));
            const grants = documents.locations();
            const count = grants.length;
            for (const grant of grants) await documents.release({ ...request(), handle: grant.handle });
            return { result, count, releases };
          } finally { await delayed.close(); }
        }
        const lateReleased = await late(false);
        const unknownRelease = await late(true);

        const existingFile = page.nodes?.find(node => node.name === "original.md");
        if (!existingFile) throw Error("Recovery fixture existing entry missing");
        const already = await workspace.open({ ...request(), root: root.handle, entry: existingFile.handle });
        if (!already.ok || !already.snapshot) throw Error("Recovery fixture could not obtain existing grant");
        const existing = brief(await reader.read(input(), () => true));
        const existingKept = documents.locations().length === 1 && documents.locations()[0].handle === already.snapshot.handle;
        await documents.release({ ...request(), handle: already.snapshot.handle });

        await rename(path, join(folder, "old.md"));
        await writeFile(path, "# A different file\n");
        await call("hidden", { root: root.handle, showHidden: true });
        const newer = await scan(root.handle);
        const staleGeneration = brief(await reader.read(input(), () => true));
        const replacement = brief(await reader.read({ ...input(), generation: newer.generation }, () => true));
        console.info(JSON.stringify({ initial, wrongRoot, expired, protectedResults, changedRecord,
          afterReread, racedPublication, priorGrantKept, staleAfterOpen, priorGrantKeptAfterOpen, lateReleased,
          unknownRelease, existing, existingKept, staleGeneration, replacement, finalGrants: documents.locations().length,
          metadataUnchanged: await readFile(checkpoint, "utf8") === authoritative,
          backupUnchanged: await readFile(`${checkpoint}.bak`, "utf8") === authoritative,
          mruUnchanged: await readFile(mruPath, "utf8") === originalMru }));
      }
    } finally { await reader.close(); }
  }
} finally {
  await workspace.dispose();
  await documents.dispose();
  await roster.close();
  mru.dispose();
}
