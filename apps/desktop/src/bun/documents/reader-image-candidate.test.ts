import { expect, test } from "bun:test";
import { join } from "node:path";

import { READER_SNAPSHOT_MAX_BYTES } from "../../shared/reader-snapshot";

import { findReaderImageCandidates } from "./reader-image-candidate";

const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const source = base64("![first](./assets/pixel.png)");

test("the actual parser worker chooses at most two local rasters in visible order", async () => {
  let resolvedEntry: string | undefined;
  const options = {
    createWorker(entry: string) {
      resolvedEntry = entry;
      return new Worker(join(import.meta.dir, "reader-image-candidate-worker.ts"));
    },
  };
  const read = (text: string) => findReaderImageCandidates(base64(text), undefined, options);
  expect(await read("\uFEFF# 中文\r\n\r\n![remote](https://example.invalid/x.png)\r\n\r\n![first](./assets/a%20b.PNG) ![later](next.jpg) ![third](third.png)"))
    .toEqual(["./assets/a%20b.PNG", "next.jpg"]);
  expect(await read("[unused]: unused.png\n\n![first][r]\n\n![next](later.png)\n\n[r]: ../assets/photo.jpeg"))
    .toEqual(["../assets/photo.jpeg", "later.png"]);
  expect(await read("![one](same.png) ![two](same.png)")).toEqual(["same.png", "same.png"]);
  expect(await read("`![code](code.png)`\n\n<img src='raw.png'>\n\n![vector](a.svg)\n\n[unused]: unused.png"))
    .toEqual([]);
  expect(resolvedEntry?.endsWith("/dist-native/reader-image-candidate-worker.js")).toBe(true);
});

type Options = NonNullable<Parameters<typeof findReaderImageCandidates>[2]>;
type WorkerStub = ReturnType<NonNullable<Options["createWorker"]>>;

function heldWorker() {
  let posted = 0, terminated = 0;
  const worker: WorkerStub = {
    onmessage: null, onerror: null, onmessageerror: null,
    postMessage() { posted++; },
    terminate() { terminated++; },
  };
  return { worker, options: { createWorker: () => worker }, posted: () => posted, terminated: () => terminated };
}

test("malformed, remote or missing worker replies settle once without a candidate", async () => {
  for (const reply of [
    { protocolVersion: 2, references: ["ok.png"] },
    { protocolVersion: 1, references: ["ok.png", "https://example.invalid/remote.png"] },
    { protocolVersion: 1, references: ["ok.png"], unexpected: true },
    { protocolVersion: 1, references: ["one.png", "two.jpg", "third.png"] },
  ]) {
    const f = heldWorker();
    const pending = findReaderImageCandidates(source, undefined, f.options);
    expect(f.posted()).toBe(1);
    f.worker.onmessage?.(new MessageEvent("message", { data: reply }));
    expect(await pending).toEqual([]);
    expect(f.terminated()).toBe(1);
  }
  const f = heldWorker();
  expect(await findReaderImageCandidates(source, undefined, { ...f.options, timeoutMs: 10 })).toEqual([]);
  expect(f.posted()).toBe(1);
  expect(f.terminated()).toBe(1);
});

test("abort retires a child parser even if a valid reply is already queued", async () => {
  const f = heldWorker();
  const controller = new AbortController();
  const pending = findReaderImageCandidates(source, controller.signal, f.options);
  const late = f.worker.onmessage;
  expect(f.posted()).toBe(1);
  controller.abort();
  late?.(new MessageEvent("message", { data: { protocolVersion: 1, references: ["late.png"] } }));
  expect(await pending).toEqual([]);
  expect(f.terminated()).toBe(1);
  expect(f.worker.onmessage).toBeNull();
});

test("empty, oversized, noncanonical or already cancelled snapshots do not start a worker", async () => {
  const controller = new AbortController();
  controller.abort();
  let spawned = 0;
  const check = { createWorker: () => { spawned++; throw Error("unexpected worker"); } };
  for (const raw of ["", "AB==", Buffer.alloc(READER_SNAPSHOT_MAX_BYTES + 1).toString("base64")])
    expect(await findReaderImageCandidates(raw, undefined, check)).toEqual([]);
  expect(await findReaderImageCandidates(source, controller.signal, check)).toEqual([]);
  expect(spawned).toBe(0);
});
