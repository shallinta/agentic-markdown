import { expect, test } from "bun:test";

import { parseCanonicalMarkdown } from "./canonical-parser";
import {
  createCurrentCanonical,
  type CurrentCanonicalWorker,
} from "./current-canonical";
import type { CanonicalRequest } from "./current-canonical-protocol";
import { createEditingCodeCopy } from "./editing-code-copy";

function setup() {
  const raw = "```\na\n```\n\n~~~\nb\n~~~",
    source = { documentId: "doc", revision: 1, identity: {}, text: raw };
  const workers: (CurrentCanonicalWorker & { request?: CanonicalRequest })[] =
      [],
    statuses: string[] = [],
    feedback: string[] = [],
    writes: string[] = [];
  let valid = true,
    settle: (() => void) | undefined;
  const make = () =>
    createEditingCodeCopy(
      createCurrentCanonical(
        () => source,
        () => {
          const worker: CurrentCanonicalWorker & {
            request?: CanonicalRequest;
          } = {
            onmessage: null,
            onerror: null,
            onmessageerror: null,
            terminate() {
              /* Transport intentionally retains captured callbacks for stale-reply tests. */
            },
            postMessage(request) {
              worker.request = request;
            },
          };
          workers.push(worker);
          return worker;
        }
      ),
      (text) => {
        writes.push(text);
        return new Promise((resolve) => {
          settle = resolve;
        });
      },
      (status) => statuses.push(status),
      (status) => feedback.push(status)
    );
  const owner = make();
  const ticket = (second = false) => ({
    raw,
    target: {
      kind: "FencedCode" as const,
      from: second ? 11 : 0,
      to: second ? raw.length : 9,
    },
    valid: () => valid,
  });
  const reply = (index = workers.length - 1, ok = true) => {
    const worker = workers[index],
      request = worker.request!;
    worker.onmessage?.({
      data: ok
        ? {
            ok: true,
            result: {
              ...request,
              tree: parseCanonicalMarkdown(raw),
              milliseconds: 1,
            },
          }
        : { ok: false },
    } as MessageEvent);
  };
  return {
    owner,
    make,
    ticket,
    reply,
    workers,
    statuses,
    feedback,
    writes,
    invalidate: () => {
      valid = false;
    },
    settle: () => settle?.(),
  };
}
test("open A then B cancels old preparation and synchronously copies only B", async () => {
  const h = setup();
  h.owner.open(h.ticket());
  const late = h.workers[0].onmessage;
  h.owner.open(h.ticket(true));
  h.reply();
  await Promise.resolve();
  late?.({ data: { ok: false } } as MessageEvent);
  expect(h.statuses[h.statuses.length - 1]).toBe("ready");
  expect(h.owner.select()).toBe(true);
  expect(h.writes).toEqual(["b"]);
  h.owner.close();
  h.settle();
  await Promise.resolve();
  expect(h.feedback[h.feedback.length - 1]).toBe("success");
  h.owner.dispose();
});
test("close cancels preparation, explicit retry does not copy, stale select refuses", async () => {
  const h = setup();
  h.owner.open(h.ticket());
  h.reply(undefined, false);
  await Promise.resolve();
  expect(h.statuses[h.statuses.length - 1]).toBe("failed");
  h.owner.retry();
  h.reply();
  await Promise.resolve();
  expect(h.statuses[h.statuses.length - 1]).toBe("ready");
  expect(h.writes).toEqual([]);
  h.invalidate();
  expect(h.owner.select()).toBe(false);
  h.owner.close();
  expect(h.owner.select()).toBe(false);
  h.owner.dispose();
});
test("effect-style dispose and fresh setup remains usable and late write feedback is hidden", async () => {
  const h = setup();
  h.owner.open(h.ticket());
  h.owner.dispose();
  const fresh = h.make();
  fresh.open(h.ticket());
  h.reply();
  await Promise.resolve();
  expect(fresh.select()).toBe(true);
  fresh.invalidate();
  h.settle();
  await Promise.resolve();
  expect(h.feedback).not.toContain("success");
  fresh.dispose();
});
