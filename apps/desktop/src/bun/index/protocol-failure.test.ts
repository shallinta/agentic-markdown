import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createIndexSession } from "./session";

/** Controlled transport-only fixture; never loads an addon or claims native failure evidence. */
async function transportFixture(
  mode:
    | "malformed"
    | "unknown"
    | "backwards"
    | "acceptance"
    | "apply-unknown"
    | "close-error"
) {
  const root = await mkdtemp(join(tmpdir(), "f064c-transport-"));
  const directory = join(root, "native");
  await mkdir(directory);
  await mkdir(join(root, "bun"));
  const worker = `import {writeFileSync} from 'node:fs';
let operations=[];self.onmessage=e=>{const r=e.data;operations.push(r.op);
let result=r.op==='open'?{ok:true,generation:4}:r.op==='close'?(${JSON.stringify(mode)}==='close-error'?{ok:false,error:'UNKNOWN',accepted:true}:{ok:true,generation:4}):${JSON.stringify(mode)}==='malformed'?{ok:true}:${JSON.stringify(mode)}==='backwards'?{ok:true,generation:3,hits:[]}:${JSON.stringify(mode)}==='acceptance'?{ok:false,error:'INPUT',accepted:true}:{ok:false,error:'UNKNOWN',accepted:true};
self.postMessage({version:1,epoch:r.epoch,id:r.id,result});
if(r.op==='apply'&&${JSON.stringify(mode)}==='apply-unknown')self.postMessage({version:1,epoch:r.epoch,id:r.id,result:{ok:true,generation:5}});
if(r.op==='close'){writeFileSync(${JSON.stringify(join(root, "closed.json"))},JSON.stringify(operations));self.onmessage=null;}};`;
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  await writeFile(join(directory, "index-worker.js"), worker);
  await writeFile(join(directory, "index-primitives.node"), "transport-only");
  await writeFile(join(directory, "index-host.js"), "transport-only");
  await writeFile(
    join(directory, "index-build.json"),
    JSON.stringify({
      version: 1,
      arch: process.arch,
      target:
        process.arch === "arm64"
          ? "aarch64-apple-darwin"
          : "x86_64-apple-darwin",
      rust: "1.90.0",
      cargo: "1.90.0",
      lock: "0".repeat(64),
      sources: Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [
          `scripts/fixture${i}.ts`,
          "0".repeat(64),
        ])
      ),
      addon: hash("transport-only"),
      host: hash("transport-only"),
      worker: hash(worker),
    })
  );
  return { root, session: createIndexSession(join(root, "bun")) };
}
for (const mode of ["malformed", "unknown", "backwards", "acceptance"] as const)
  test(`transport ${mode} faults, cancels latest, and requests close once`, async () => {
    const { root, session } = await transportFixture(mode);
    expect(await session.open(join(root, "unused"), "reader-only")).toEqual({
      ok: true,
      generation: 4,
    });
    const active = session.query("a"),
      pending = session.query("b");
    expect(await active).toEqual({
      ok: false,
      error: "UNKNOWN",
      accepted: true,
    });
    expect(await pending).toEqual({
      ok: false,
      error: "CANCELLED",
      accepted: false,
    });
    const close = session.close();
    expect(session.close()).toBe(close);
    expect(await close).toEqual({
      ok: false,
      error: "UNKNOWN",
      accepted: true,
    });
    let operations: unknown;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      try {
        operations = JSON.parse(
          await readFile(join(root, "closed.json"), "utf8")
        );
        break;
      } catch {
        await Bun.sleep(5);
      }
    }
    expect(operations).toEqual(["open", "query", "close"]);
  }, 5000);

test("apply unknown and late original ACK never replay mutation", async () => {
  const { root, session } = await transportFixture("apply-unknown");
  expect((await session.open(join(root, "unused"), "create-new")).ok).toBe(
    true
  );
  const applied = session.applyAndCommit([
      { kind: "put", id: "a", path: "a", raw: "x" },
    ]),
    pending = session.query("x");
  expect(await applied).toEqual({
    ok: false,
    error: "UNKNOWN",
    accepted: true,
  });
  expect(await pending).toEqual({
    ok: false,
    error: "CANCELLED",
    accepted: false,
  });
  expect(await session.applyAndCommit([{ kind: "delete", id: "a" }])).toEqual({
    ok: false,
    error: "UNKNOWN",
    accepted: true,
  });
  expect(await session.close()).toEqual({
    ok: false,
    error: "UNKNOWN",
    accepted: true,
  });
  let operations: unknown;
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      operations = JSON.parse(
        await readFile(join(root, "closed.json"), "utf8")
      );
      break;
    } catch {
      await Bun.sleep(5);
    }
  }
  expect(operations).toEqual(["open", "apply", "close"]);
}, 5000);
test("close native error stays unknown despite clean worker exit", async () => {
  const { root, session } = await transportFixture("close-error");
  expect((await session.open(join(root, "unused"), "reader-only")).ok).toBe(
    true
  );
  const close = session.close();
  expect(session.close()).toBe(close);
  expect(await close).toEqual({ ok: false, error: "UNKNOWN", accepted: true });
  expect(JSON.parse(await readFile(join(root, "closed.json"), "utf8"))).toEqual(
    ["open", "close"]
  );
}, 5000);
