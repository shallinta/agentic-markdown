import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This script is outside the desktop workspace package and uses its installed CodeMirror instances.
import { undoDepth } from "../../apps/desktop/node_modules/@codemirror/commands";
import { language, syntaxTree } from "../../apps/desktop/node_modules/@codemirror/language";
import { EditorSelection } from "../../apps/desktop/node_modules/@codemirror/state";
import { createDocumentController, type DocumentTransport } from "../../apps/desktop/src/client/documents";
import { rawText } from "../../apps/desktop/src/client/raw-buffer";
import type { DocumentSnapshot } from "../../apps/desktop/src/shared/documents";
import { analyzeTextFidelity } from "../../apps/desktop/src/shared/text-fidelity";

const profiles = [1, 5, 20, 50] as const;
const maxFileBytes = 4096;
const expectedBun = "539598c775882420b9d8deb7dc14d845f20f7d26f5600c50ab067dde6ac3f3bf";
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const prefix = "agentic-f069a-";
const script = fileURLToPath(import.meta.url);

class ProbeFailure extends Error {}
function check(value: unknown, stage: string): asserts value {
  if (!value) throw new ProbeFailure(stage);
}

function packageReceipt() {
  const bun = realpathSync(process.execPath);
  const contents = dirname(dirname(bun));
  check(platform() === "darwin" && arch() === "arm64" && Bun.version === "1.4.0" &&
    basename(dirname(contents)) === "Agentic Markdown-canary.app" &&
    bun === join(contents, "MacOS", "bun") && sha(readFileSync(bun)) === expectedBun, "packaged Bun receipt");
  const info: unknown = JSON.parse(readFileSync(join(contents, "Resources", "version.json"), "utf8"));
  check(typeof info === "object" && info !== null && "version" in info && "hash" in info &&
    info.version === "0.1.0-alpha.269" && info.hash === "2fwylu3393c17", "package version receipt");
  return { bun, packageVersion: info.version, packageHash: info.hash, bunVersion: Bun.version, bunSha256: expectedBun };
}

function sampleText(index: number) {
  const header = `\uFEFF# 合成文档 ${index}\r\n`;
  const line = "正文 **中文** 与 English 📖。\r\n\r\n- 条目及 `代码`。\r\n\r\n";
  const bytes = maxFileBytes - Buffer.byteLength(header);
  const repeat = Math.floor(bytes / Buffer.byteLength(line));
  return header + line.repeat(repeat) + "x".repeat(bytes - repeat * Buffer.byteLength(line));
}

function fixture(index: number): DocumentSnapshot {
  const text = sampleText(index);
  const suffix = index.toString(16).padStart(12, "0");
  return {
    handle: `11111111-1111-4111-8111-${suffix}`,
    documentId: `22222222-2222-4222-8222-${suffix}`,
    fileName: `sample-${index}.md`,
    revision: 1,
    hash: sha(text),
    text,
    byteLength: Buffer.byteLength(text),
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: true, reason: "writable" },
  };
}

const memory = () => {
  const { rss, heapUsed } = process.memoryUsage();
  return { rss, heapUsed };
};
function summary(samples: number[]) {
  if (!samples.length) return { calls: 0, minMs: null, medianMs: null, maxMs: null };
  const ordered = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return {
    calls: ordered.length,
    minMs: ordered[0],
    medianMs: ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2,
    maxMs: ordered[ordered.length - 1],
  };
}

async function runProfile(tabs: number) {
  const snapshots = Array.from({ length: tabs }, (_, i) => fixture(i));
  const identities = snapshots.map(({ documentId, handle, hash, byteLength }) => ({ documentId, handle, hash, byteLength }));
  const corpusSha256 = sha(identities.map(({ hash }) => hash).join("\n"));
  let opened = 0;
  let unexpected = 0;
  let discardPrompts = 0;
  const unexpectedRead = () => { unexpected++; return Promise.reject(Error("Unexpected transport call")); };
  const transport: DocumentTransport = {
    selectDocument: (request) => Promise.resolve({ ...request, ok: true, snapshot: snapshots[opened++] }),
    readDocument: unexpectedRead,
    cancelDocument: unexpectedRead,
    releaseDocument: () => Promise.resolve(null),
  };
  const controller = createDocumentController(transport, () => { discardPrompts++; return Promise.resolve(false); });
  const timing = { open: [] as number[], switch: [] as number[], undo: [] as number[], close: [] as number[] };
  const baseline = memory();
  const dirty = (index: number) => index % 3 === 0;
  const source = (index: number) => index % 2 === 0;
  const suffix = (index: number) => ` 草稿${index}🌱`;
  const expectedViewport = (index: number) => ({ from: 2, offset: 4, ratio: 0.25, revision: Number(dirty(index)) });
  const verify = (index: number, afterUndo = false) => {
    const item = identities[index];
    const editor = controller.getEditor(item.documentId);
    const tab = controller.getSnapshot().tabs.find(({ documentId }) => documentId === item.documentId);
    const changed = dirty(index) && !afterUndo;
    const raw = sampleText(index) + (changed ? suffix(index) : "");
    check(editor && tab?.handle === item.handle && tab.hash === item.hash && tab.revision === 1 &&
      editor.state.field(rawText) === raw && controller.isDirty(item.documentId) === changed &&
      editor.revision === (dirty(index) ? afterUndo ? 2 : 1 : 0) &&
      controller.getMode(item.documentId) === (source(index) ? "source" : "editing") &&
      undoDepth(editor.state) === Number(changed), "authoritative document state");
    if (!afterUndo) {
      const { anchor, head } = editor.state.selection.main;
      const viewport = controller.getViewport(item.documentId);
      const expected = expectedViewport(index);
      check(anchor === 2 && head === 5 && viewport?.from === expected.from &&
        viewport.offset === expected.offset && viewport.ratio === expected.ratio && viewport.revision === expected.revision,
      "selection and viewport marker");
    }
  };
  const parserOwners = () => {
    const active = controller.getSnapshot().snapshot?.documentId;
    let owners = 0;
    let activeTreeUnits = 0;
    for (const { documentId } of identities) {
      const editor = controller.getEditor(documentId);
      if (!editor) continue;
      const units = syntaxTree(editor.state).length;
      if (editor.state.facet(language)) {
        owners++;
        activeTreeUnits = units;
      } else check(units === 0, "inactive tree not released");
      check(!!editor.state.facet(language) === (documentId === active), "parser ownership differs");
    }
    return { owners, activeTreeUnits };
  };
  let actualSwitches = 0;
  let undoCount = 0;
  try {
    for (let i = 0; i < tabs; i++) {
      const start = performance.now();
      await controller.select();
      timing.open.push(performance.now() - start);
      const { documentId } = identities[i];
      const editor = controller.getEditor(documentId);
      check(controller.getSnapshot().snapshot?.documentId === documentId && editor, "selected fixture identity");
      check(controller.updateEditor(documentId, editor.state.update({
        ...(dirty(i) ? { changes: { from: editor.state.doc.length, insert: suffix(i) }, userEvent: "input.type" } : {}),
        selection: EditorSelection.range(2, 5),
      })), "selection or edit rejected");
      if (source(i)) check(controller.toggleSourceMode(), "source mode switch rejected");
      const viewport = controller.registerViewportCapture(documentId, () => expectedViewport(i));
      viewport.capture();
      viewport.release();
      verify(i);
    }
    snapshots.length = 0;
    check(controller.getSnapshot().tabs.length === tabs, "opened tab count");
    const openParserOwners = parserOwners();
    const afterOpen = memory();
    for (const index of [...identities.keys(), ...Array.from(identities.keys()).reverse()]) {
      const { documentId } = identities[index];
      const previous = controller.getSnapshot().snapshot?.documentId;
      const start = performance.now();
      controller.activateTab(documentId);
      const elapsed = performance.now() - start;
      check(controller.getSnapshot().snapshot?.documentId === documentId, "active document differs");
      if (previous && previous !== documentId) {
        actualSwitches++;
        timing.switch.push(elapsed);
        const inactive = controller.getEditor(previous);
        check(inactive && !inactive.state.facet(language) && syntaxTree(inactive.state).length === 0, "previous parser not paused");
      }
      verify(index);
    }
    const switchedParserOwners = parserOwners();
    const afterSwitch = memory();
    for (const index of identities.keys()) {
      if (!dirty(index)) continue;
      const { documentId } = identities[index];
      controller.activateTab(documentId);
      const start = performance.now();
      const undone = controller.runHistory("undo");
      timing.undo.push(performance.now() - start);
      check(undone, "undo unavailable");
      undoCount++;
      verify(index, true);
    }
    for (const { documentId } of identities) {
      const start = performance.now();
      await controller.closeTab(documentId);
      timing.close.push(performance.now() - start);
      check(!controller.getEditor(documentId), "closed editor retained");
    }
    check(!controller.getSnapshot().tabs.length && !controller.getSnapshot().snapshot &&
      opened === tabs && unexpected === 0 && discardPrompts === 0, "close or transport accounting");
    const closedParserOwners = parserOwners();
    const afterClose = memory();
    return {
      tabs, bytesPerDocument: maxFileBytes, corpusBytes: identities.reduce((total, item) => total + item.byteLength, 0),
      corpusSha256, dirtyTabs: identities.filter((_, index) => dirty(index)).length,
      sourceTabs: identities.filter((_, index) => source(index)).length,
      activationCalls: tabs * 2, actualSwitches, undoCount,
      parserOwners: { open: openParserOwners, switched: switchedParserOwners, closed: closedParserOwners },
      stateVerified: true,
      memory: { baseline, afterOpen, afterSwitch, afterClose },
      timing: { open: summary(timing.open), switch: summary(timing.switch), undo: summary(timing.undo), close: summary(timing.close) },
    };
  } finally {
    controller.dispose();
  }
}

function parent() {
  const { bun, ...runtime } = packageReceipt();
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  const rows = [];
  for (const tabs of profiles) {
    const scratch = join(root, `profile-${tabs}`);
    mkdirSync(scratch, { mode: 0o700 });
    const child = Bun.spawnSync({
      cmd: [bun, script, "child", String(tabs)], cwd: scratch,
      env: { ...process.env, AGENTIC_MARKDOWN_HOME: scratch },
      stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
    });
    if (child.exitCode !== 0 || child.stderr.length !== 0)
      writeFileSync(join(scratch, "stderr.log"), child.stderr, { flag: "wx", mode: 0o600 });
    check(child.exitCode === 0 && child.stderr.length === 0 && child.stdout.length < 4096,
      `profile ${tabs} exited or failed an invariant`);
    const row: unknown = JSON.parse(child.stdout.toString());
    check(typeof row === "object" && row !== null && "tabs" in row && row.tabs === tabs &&
      "stateVerified" in row && row.stateVerified === true, `profile ${tabs} receipt`);
    rows.push(row);
  }
  rmSync(root, { recursive: true });
  return {
    ...runtime, machine: { platform: platform(), arch: arch(), release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
    observation: "Bun RSS/heap snapshots; baseline includes fixture queue, released before post-open; no WK, GC, or natural input timing",
    profiles: rows,
  };
}

try {
  const args = process.argv.slice(2);
  if (!args.length) console.info(JSON.stringify(parent()));
  else {
    const tabs = profiles.find((value) => String(value) === args[1]);
    const scratch = process.cwd();
    check(args.length === 2 && args[0] === "child" && tabs && basename(scratch) === `profile-${tabs}` &&
      basename(dirname(scratch)).startsWith(prefix) && dirname(dirname(scratch)) === realpathSync(tmpdir()) &&
      process.env.AGENTIC_MARKDOWN_HOME === scratch, "child fixture boundary");
    console.info(JSON.stringify(await runProfile(tabs)));
  }
} catch (error) {
  const stage = error instanceof ProbeFailure ? ` ${error.message}.` : "";
  console.error(`F-069a baseline failed.${stage}`);
  process.exitCode = 1;
}
