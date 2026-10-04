import { expect, test } from "bun:test";

import { handleImageWorkerRequest } from "./image-worker-protocol";
import type { ImageJob } from "./local-image-operation";
import { createImageReader } from "./local-images";
const job = { authorization: {}, reference: "a.png" } as ImageJob;
test("one worker, bounded queue, timeout settles all without terminating active fd work", async () => {
  let starts = 0,
    terminated = 0;
  const posted: { id: number }[] = [];
  const fake = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null,
    postMessage: (value: { id: number }) => posted.push(value),
    terminate: () => {
      terminated++;
    },
  };
  const reader = createImageReader({
    createWorker: () => {
      starts++;
      return fake as unknown as Worker;
    },
    timeoutMs: 5,
  });
  const first = reader.read(job),
    queued = Array.from({ length: 8 }, () => reader.read(job));
  expect(await reader.read(job)).toEqual({ ok: false, error: "BUSY" });
  expect(starts).toBe(1);
  expect(posted.length).toBe(1);
  expect((await first).ok).toBe(false);
  expect((await Promise.all(queued)).every((r) => !r.ok)).toBe(true);
  expect((await reader.read(job)).ok).toBe(false);
  expect(terminated).toBe(0);
  fake.onmessage!({
    data: {
      protocolVersion: 1,
      kind: "local-image-result",
      id: posted[0].id,
      result: { ok: false, error: "UNAVAILABLE" },
    },
  } as MessageEvent);
  const next = reader.read(job);
  expect(starts).toBe(1);
  expect(posted.length).toBe(2);
  reader.dispose();
  expect((await next).ok).toBe(false);
  expect(terminated).toBe(0);
  fake.onmessage!({
    data: {
      protocolVersion: 1,
      kind: "local-image-result",
      id: posted[1].id,
      result: { ok: false, error: "UNAVAILABLE" },
    },
  } as MessageEvent);
  expect(terminated).toBe(1);
});
test("correlated malformed job fails immediately without stalling the next job",async()=>{
 let reads=0;
 const fake={onmessage:null as ((event:MessageEvent)=>void)|null,onerror:null,terminate:()=>undefined,postMessage:(message:unknown)=>{
  void handleImageWorkerRequest(message,()=>{reads++;return Promise.resolve({ok:false,error:"UNAVAILABLE"});}).then(data=>fake.onmessage?.({data} as MessageEvent));
 }};
 const reader=createImageReader({createWorker:()=>fake as unknown as Worker,timeoutMs:1000});
 expect(await reader.read(job)).toEqual({ok:false,error:"INVALID_REQUEST"});
 const valid:ImageJob={reference:"a.png",authorization:{selectedPath:"/tmp/a.md",path:"/tmp/a.md",selectedParent:"/tmp",fingerprint:"1:2:3",directories:[{path:"/",fingerprint:"1:1:1"}]}};
 expect(await reader.read(valid)).toEqual({ok:false,error:"UNAVAILABLE"});
 expect(reads).toBe(1);
 reader.dispose();
});
