import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentMRU } from "./document-mru";

const envelope=()=>({protocolVersion:1 as const,requestId:crypto.randomUUID()});
test("corrupt and future metadata remain untouched; write failure warns without affecting authority",async()=>{
 for(const value of ["{broken",JSON.stringify({version:2,data:{revision:0,entries:[]}})]){
 const dir=await mkdtemp(join(tmpdir(),"mru-invalid-")),path=join(dir,"document-mru.json");await writeFile(path,value);let warnings=0;const mru=createDocumentMRU(dir,()=>{warnings++;});
 try{await mru.initialize();mru.bindWindow();mru.domReady();expect((await mru.begin(envelope())).available).toBe(false);expect(await readFile(path,"utf8")).toBe(value);expect(warnings).toBeGreaterThan(0);}finally{mru.dispose();await rm(dir,{recursive:true,force:true});}}
 const dir=await mkdtemp(join(tmpdir(),"mru-write-fail-"));let warnings=0;const mru=createDocumentMRU(dir,()=>{warnings++;});try{await mru.initialize();mru.bindWindow();mru.domReady();const session=(await mru.begin(envelope())).session;await rm(join(dir,"document-mru.json"));await mkdir(join(dir,"document-mru.json"));const r={...envelope(),session,sequence:1,handle:crypto.randomUUID(),documentId:crypto.randomUUID()};expect((await mru.record(r,()=>({documentId:r.documentId,path:"/a.md",fingerprint:"1:1:1"}))).status).toBe("unavailable");expect(mru.snapshot().entries).toHaveLength(1);await mru.drainUntil(performance.now()+1);expect(warnings).toBeGreaterThan(0);expect((await mru.record(r,()=>undefined)).status).toBe("unavailable");}finally{mru.dispose();await rm(dir,{recursive:true,force:true});}
});
test("MRU persists bounded exact activation receipts and proof migration without reordering",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mru-store-")),mru=createDocumentMRU(dir);
 try{await mru.initialize();mru.bindWindow();mru.domReady();const start=await mru.begin(envelope());expect(start.available).toBe(true);
 const ids=Array.from({length:21},()=>crypto.randomUUID());
 let last;
 for(let i=0;i<21;i++){last={...envelope(),session:start.session,sequence:i+1,handle:crypto.randomUUID(),documentId:ids[i]};expect((await mru.record(last,()=>({documentId:ids[i],path:`/test/${i}.md`,fingerprint:`1:${i}:1`}))).status).toBe("persisted");}
 expect(mru.snapshot().entries).toHaveLength(20);expect(mru.lookup("/test/0.md","1:0:1")).toBeUndefined();
 if(!last)throw Error();expect((await mru.record(last,()=>{throw Error("replay must not capture");})).status).toBe("persisted");
 expect((await mru.record({...last,handle:crypto.randomUUID()},()=>undefined)).status).toBe("stale");
 mru.migrate(ids[20],"/test/20.md","1:20:1","1:99:1");await mru.drainUntil(performance.now()+2000);
 const next=createDocumentMRU(dir);await next.initialize();expect(next.lookup("/test/20.md","1:99:1")).toBe(ids[20]);expect(next.snapshot().entries[0].rank).toBe(21);expect(next.snapshot().revision).toBe(22);next.dispose();
 }finally{mru.dispose();await rm(dir,{recursive:true,force:true});}
});
test("host lifecycle readiness, duplicate events and stale cancellation cannot reset new session",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mru-lifecycle-")),mru=createDocumentMRU(dir);
 try{await mru.initialize();mru.bindWindow();const pending=mru.begin(envelope());mru.domReady();const first=await pending;expect(first.available).toBe(true);
 const record={...envelope(),session:first.session,sequence:1,handle:crypto.randomUUID(),documentId:crypto.randomUUID()};await mru.record(record,()=>({documentId:record.documentId,path:"/test/a.md",fingerprint:"1:1:1"}));
 mru.bindWindow();mru.domReady();expect(await mru.begin(envelope())).toMatchObject({session:first.session,sequence:1});
 const old=mru.beginTransition(),waiting=mru.begin(envelope());mru.domReady();const second=await waiting;expect(second.session).not.toBe(first.session);mru.cancelTransition(old);expect(await mru.begin(envelope())).toMatchObject({session:second.session,sequence:0});
 const cancelled=mru.beginTransition();mru.cancelTransition(cancelled);expect((await mru.begin(envelope())).session).toBe(second.session);
 expect((await mru.record(record,()=>undefined)).status).toBe("stale");
 }finally{mru.dispose();await rm(dir,{recursive:true,force:true});}
});
