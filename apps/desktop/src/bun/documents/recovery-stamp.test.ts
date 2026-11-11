import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_DOCUMENT_BYTES } from "../../shared/documents";
import { authorizeRoot, verifyRoot } from "../workspace/authorization";

import { authorizeSingleFile, verifySingleFileAuthorization } from "./path-authorization";

import { createDocumentService } from ".";

test("one stamped recovery snapshot can be verified without rereading the body and fails terminally after a rewrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentic-recovery-stamp-"));
  const path = join(directory, "sample.md");
  let reads = 0;
  const service = createDocumentService({
    pickFile: () => Promise.resolve(null),
    onTiming(phase) { if (phase === "diskReadMs") reads++; },
  });
  const requestId = randomUUID();
  const check = () => undefined;
  try {
    const root = await authorizeRoot(directory);
    await writeFile(path, "old body");
    const response = await service.openAuthorized(
      { protocolVersion: 1, requestId },
      () => authorizeSingleFile(path),
      { verify: () => verifyRoot(root) },
      {
        maxBytes: MAX_DOCUMENT_BYTES,
        retainRecoveryStamp: true,
        check,
        async verify(file, _snapshot, current) { await verifySingleFileAuthorization(file, current); },
      }
    );
    if (!response.ok || !response.snapshot) throw Error("Missing stamped recovery grant");
    const { snapshot } = response;
    expect(service.ownsRecoverySnapshot(snapshot, requestId)).toBe(true);
    expect(await service.verifyRecoverySnapshots([snapshot], check)).toBe(true);
    expect(service.currentRecoverySnapshot(snapshot, requestId)).toBe(true);
    expect(service.currentRecoverySnapshot(snapshot, randomUUID())).toBe(false);
    expect(service.currentRecoverySnapshot({ ...snapshot }, requestId)).toBe(false);
    expect(await service.verifyRecoverySnapshots([], check)).toBe(false);

    const before = await stat(path, { bigint: true });
    await writeFile(path, "new body");
    const after = await stat(path, { bigint: true });
    expect(after.ino).toBe(before.ino);
    expect(after.size).toBe(before.size);
    expect(service.currentRecoverySnapshot(snapshot, requestId)).toBe(false);
    expect(await service.verifyRecoverySnapshots([snapshot], check)).toBe(false);
    expect(service.ownsRecoverySnapshot(snapshot, requestId)).toBe(true);
    expect(reads).toBe(1);
  } finally {
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
