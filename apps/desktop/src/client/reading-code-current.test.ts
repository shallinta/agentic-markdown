import { expect, test } from "bun:test";

import type { DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { parseReadingMarkdown as parseCanonicalMarkdown } from "./canonical-parser";
import { CANONICAL_CONFIG } from "./current-canonical-protocol";
import { createDocumentController } from "./documents";
import { readingCodeCurrent } from "./reading-code-current";

test("actual controller reading identity, frozen, reload, readonly and mode guard", async () => {
  const text = "```\nx\n```";
  const id = crypto.randomUUID();
  const snapshot: DocumentSnapshot = {
    documentId: id,
    handle: crypto.randomUUID(),
    fileName: "a.md",
    revision: 1,
    hash: "a".repeat(64),
    text,
    byteLength: text.length,
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: false, reason: "readonly" },
  };
  const c = createDocumentController({
    selectDocument: (req) => Promise.resolve({ ...req, ok: true, snapshot }),
    readDocument: (req) => Promise.resolve({ ...req, ok: true, snapshot }),
    cancelDocument: () => Promise.resolve(),
    releaseDocument: () => Promise.resolve(),
  });
  await c.select();
  const session = c.getEditorFault(id);
  const result = {
    documentId: id,
    revision: c.getEditor(id)!.revision,
    requestId: 1,
    config: CANONICAL_CONFIG,
    tree: parseCanonicalMarkdown(text),
    milliseconds: 1,
  };
  let canonicalCurrent = true;
  const current = () =>
    readingCodeCurrent(
      c,
      { isCurrent: () => canonicalCurrent },
      id,
      session,
      result
    );
  expect(current()).toBe(false);
  c.toggleReadingMode();
  expect(current()).toBe(true);
  canonicalCurrent = false;
  expect(current()).toBe(false);
  canonicalCurrent = true;
  expect(c.beginDiscard()).toBe(true);
  expect(current()).toBe(false);
  c.endDiscard();
  expect(current()).toBe(true);
  c.toggleReadingMode();
  expect(current()).toBe(false);
  c.toggleReadingMode();
  await c.reload();
  expect(c.getEditorFault(id)).not.toBe(session);
  expect(current()).toBe(false);
  c.dispose();
});
