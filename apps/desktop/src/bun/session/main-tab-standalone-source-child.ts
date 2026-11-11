import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createDocumentService } from "../documents";

import { captureMainTabStandaloneSource } from "./main-tab-standalone-source";

// Test subprocess only. The pickFile stub stands in for the native picker result.
const [operation, directory] = process.argv.slice(2);
if (!directory || !["capture", "reselect", "different", "replaced"].includes(operation))
  throw Error("Explicit standalone fixture operation and directory required");

const selected = join(directory, operation === "different" ? "different" : "original", "same.md");
const isolatedSource = join(directory, "source.json");
const documents = createDocumentService({ pickFile: () => Promise.resolve(selected) });
const request = () => ({ protocolVersion: 1, requestId: crypto.randomUUID() } as const);
try {
  const opened = await documents.select(request());
  if (!opened.ok || !opened.snapshot) throw Error("Failed to select the fixture");
  const { handle, documentId, revision, hash } = opened.snapshot;
  const expected: unknown = operation === "capture" ? undefined : JSON.parse(await readFile(isolatedSource, "utf8"));
  const result = await captureMainTabStandaloneSource(documents, { handle, documentId, revision, hash }, () => true, expected);
  const ready = result.status === "ready";
  if (operation === "capture") {
    if (!ready) throw Error("Failed to capture the authorized source");
    await writeFile(isolatedSource, JSON.stringify(result.source), { flag: "wx", mode: 0o600 });
  }
  const currentBeforeRelease = ready && result.current();
  const released = await documents.release({ ...request(), handle });
  process.stdout.write(JSON.stringify({
    status: result.status,
    documentId,
    hash,
    currentBeforeRelease,
    releaseSucceeded: released.ok,
    currentAfterRelease: ready && result.current(),
  }));
} finally {
  await documents.dispose();
}
