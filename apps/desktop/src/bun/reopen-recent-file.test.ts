import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RecentFile } from "../shared/recent-files";

import { createDocumentService } from "./documents";
import { createRecentReopener } from "./reopen-recent-file";

const item: RecentFile = {
  id: "00000000-0000-0000-0000-000000000001",
  kind: "file",
  path: "/tmp/a.md",
  name: "a.md",
  accessedAt: 1,
};
function gate() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((r) => {
      resolve = r;
    }),
    done: () => resolve(),
  };
}
test("delayed recent lookup is inside selection cancellation and completed-barrier lifetime", async () => {
  for (const cancel of [true, false]) {
    const entered = gate(),
      resume = gate();
    let pickers = 0;
    const documents = createDocumentService({
      pickFile: () => {
        pickers++;
        return Promise.resolve(null);
      },
    });
    const reopen = createRecentReopener(documents, async () => {
      entered.done();
      await resume.promise;
      return item;
    });
    const pending = reopen({
      protocolVersion: 1,
      requestId: "recent",
      id: item.id,
    });
    await entered.promise;
    if (cancel)
      await documents.cancel({ protocolVersion: 1, requestId: "recent" });
    else await documents.withWriteBarrier(() => Promise.resolve(true));
    resume.done();
    expect((await pending).ok).toBe(false);
    expect(pickers).toBe(0);
    await documents.dispose();
  }
});
test("bad ids and renderer paths cannot reach picker; cancellation does not retry dialog", async () => {
  let pickers = 0;
  const documents = createDocumentService({
    pickFile: () => {
      pickers++;
      return Promise.resolve(null);
    },
  });
  const reopen = createRecentReopener(documents, () => Promise.resolve(item));
  expect(
    (
      await reopen({
        protocolVersion: 1,
        requestId: "bad",
        id: item.id,
        path: "/tmp/forged.md",
      })
    ).ok
  ).toBe(false);
  const result = await reopen({
    protocolVersion: 1,
    requestId: "good",
    id: item.id,
  });
  expect(result.ok).toBe(true);
  expect(pickers).toBe(1);
  await documents.dispose();
});

test("missing id never opens picker and selecting B does not read or redirect old A", async () => {
  const dir = await mkdtemp(join(tmpdir(), "recent-reopen-")),
    path = join(dir, "b.md");
  await writeFile(path, "selected B");
  let pickers = 0;
  const recorded: string[] = [];
  const documents = createDocumentService({
    pickFile: () => {
      pickers++;
      return Promise.resolve(path);
    },
    onStandaloneSelected: (metadata) => {
      recorded.push(metadata.path);
    },
  });
  try {
    const missing = createRecentReopener(documents, () =>
      Promise.resolve(undefined)
    );
    expect(
      (await missing({ protocolVersion: 1, requestId: "missing", id: item.id }))
        .ok
    ).toBe(false);
    expect(pickers).toBe(0);
    const reopen = createRecentReopener(documents, () => Promise.resolve(item));
    const response = await reopen({
      protocolVersion: 1,
      requestId: "other",
      id: item.id,
    });
    expect(response.ok && response.snapshot?.text).toBe("selected B");
    expect(recorded).toEqual([await realpath(path)]);
    expect(item.path).toBe("/tmp/a.md");
  } finally {
    await documents.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
