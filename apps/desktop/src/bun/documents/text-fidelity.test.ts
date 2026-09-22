import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { analyzeTextFidelity } from "../../shared/text-fidelity";

import { createDocumentService } from ".";

const corpus = [
  "",
  "\ufeff",
  "中文😀",
  "a\ufeffb",
  "a\n\ufeff",
  "\ufeff中文\n😀\n",
  "a\r\nb\r\n",
  "a\n\r\nb",
  "a\n\r\nb\n",
  "a\r\n\nb\r\n",
  "a\rb\r",
  "\r\r\n\n\r",
];
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

test.each(corpus)(
  "readonly file facts and raw bytes survive select/reload for %j",
  async (text) => {
    const directory = await mkdtemp(join(tmpdir(), "agentic-fidelity-"));
    const path = join(directory, "sample.md");
    const bytes = new TextEncoder().encode(text);
    await writeFile(path, bytes);
    const service = createDocumentService({
      pickFile: () => Promise.resolve(path),
    });
    try {
      const first = await service.select({
        protocolVersion: 1,
        requestId: "select",
      });
      if (!first.ok || !first.snapshot) throw new Error("selection failed");
      expect(first.snapshot.text).toBe(text);
      expect(new TextEncoder().encode(first.snapshot.text)).toEqual(bytes);
      expect(first.snapshot.hash).toBe(digest(bytes));
      expect(first.snapshot.fidelity).toEqual(analyzeTextFidelity(text));
      expect(first.snapshot.fidelity.bom).toBe(
        bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      );
      expect(digest(await readFile(path))).toBe(digest(bytes));
      const reload = await service.read({
        protocolVersion: 1,
        requestId: "reload",
        handle: first.snapshot.handle,
      });
      expect(reload).toMatchObject({ ok: true, snapshot: first.snapshot });
      expect(digest(await readFile(path))).toBe(digest(bytes));
      await service.release({
        protocolVersion: 1,
        requestId: "release",
        handle: first.snapshot.handle,
      });
      expect(digest(await readFile(path))).toBe(digest(bytes));
    } finally {
      await service.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }
);

test("invalid UTF-8 and controlled byte changes keep disk unmodified by reads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentic-fidelity-"));
  const path = join(directory, "sample.md");
  const bad = join(directory, "invalid.md");
  const invalid = Uint8Array.of(0xff, 0xfe, 0x61, 0);
  await writeFile(path, "\ufefffirst\r\n");
  await writeFile(bad, invalid);
  let selected: string | null = path;
  const service = createDocumentService({
    pickFile: () => Promise.resolve(selected),
  });
  try {
    const first = await service.select({
      protocolVersion: 1,
      requestId: "first",
    });
    if (!first.ok || !first.snapshot) throw new Error("selection failed");
    selected = bad;
    expect(
      await service.select({ protocolVersion: 1, requestId: "invalid" })
    ).toMatchObject({ ok: false, error: "INVALID_UTF8" });
    expect(digest(await readFile(bad))).toBe(digest(invalid));
    selected = null;
    expect(
      await service.select({ protocolVersion: 1, requestId: "cancel" })
    ).toMatchObject({ ok: true, snapshot: null });
    const bytes = new TextEncoder().encode("中文\n\r\nend\r");
    await writeFile(path, bytes);
    const updated = await service.read({
      protocolVersion: 1,
      requestId: "updated",
      handle: first.snapshot.handle,
    });
    expect(updated).toMatchObject({
      ok: true,
      snapshot: {
        documentId: first.snapshot.documentId,
        revision: 2,
        hash: digest(bytes),
        fidelity: analyzeTextFidelity("中文\n\r\nend\r"),
      },
    });
    expect(digest(await readFile(path))).toBe(digest(bytes));
  } finally {
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
