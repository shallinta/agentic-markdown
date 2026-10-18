import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DuplicateSource } from "../../shared/create-markdown";

import { createDocumentService } from ".";

const request=()=>({protocolVersion:1 as const,requestId:crypto.randomUUID()});
test("known backend observation risks reject buffer before renderer notification is applied",async()=>{
 for(const status of ["content-changed","missing","replaced"] as const){
  const dir=await mkdtemp(join(tmpdir(),"f058-known-risk-")),path=join(dir,"source.md");await writeFile(path,"SOURCE");
  const observed=Promise.withResolvers<string>();
  const docs=createDocumentService({pickFile:()=>Promise.resolve(path),onExternalChanged:event=>{observed.resolve(event.status);}});
  try{
   const reply=await docs.select(request());if(!reply.ok||!reply.snapshot)throw Error();const s=reply.snapshot;
   if(status==="content-changed")await writeFile(path,"CHANGED");
   else {await rename(path,join(dir,"old.md"));if(status==="replaced")await writeFile(path,"REPLACEMENT");}
   expect(await docs.observe({...request(),active:true,handle:s.handle,documentId:s.documentId,hash:s.hash,revision:s.revision,watchToken:crypto.randomUUID(),watchEpoch:1})).toMatchObject({ok:true});
   expect(await observed.promise).toBe(status);
   const text="fixed memory",hash=createHash("sha256").update(text).digest("hex");let entered=false;
   expect(await docs.withDuplicateBuffer({handle:s.handle,documentId:s.documentId,expectedRevision:s.revision,expectedHash:s.hash,bufferRevision:1,gateToken:crypto.randomUUID()},{text,hash},()=>{entered=true;return Promise.resolve();}).then(()=>false,()=>true)).toBe(true);
   expect(entered).toBe(false);
  }finally{await docs.dispose();await rm(dir,{recursive:true,force:true});}
 }
});
test("buffer source uses fixed bytes without disk reread or advancing baseline, holding admission",async()=>{
 const f=await fixture(),text="\ufeff内存\r\n末行\r",hash=createHash("sha256").update(text).digest("hex");
 try{expect(await f.docs.withDuplicateBuffer(f.source,{text,hash},async source=>{
  expect(Buffer.from(source.bytes)).toEqual(Buffer.from(text));
  expect(await f.docs.read({...request(),handle:f.source.handle})).toMatchObject({ok:false,error:"BUSY"});
  await writeFile(f.path,"externally changed");await source.revalidate();expect(Buffer.from(source.bytes)).toEqual(Buffer.from(text));
 })).toBe(true);expect(f.docs.locations()).toHaveLength(1);expect(await f.docs.withCreateBarrier(()=>undefined)).toBe(true);
 }finally{await f.dispose();}
});
test("buffer source rejects bad digest and stale source; disposal invalidates callback",async()=>{
 const f=await fixture(),text="memory",hash=createHash("sha256").update(text).digest("hex");
 let calls=0;
 try{expect(await f.docs.withDuplicateBuffer(f.source,{text,hash:"0".repeat(64)},()=>{calls++;return Promise.resolve();}).then(()=>false,()=>true)).toBe(true);expect(calls).toBe(0);
 expect(await f.docs.withDuplicateBuffer({...f.source,expectedRevision:999},{text,hash},()=>Promise.resolve()).then(()=>false,()=>true)).toBe(true);
 expect(await f.docs.withDuplicateBuffer(f.source,{text,hash},async source=>{await f.docs.dispose();await source.revalidate();}).then(()=>false,()=>true)).toBe(true);
 }finally{await f.dispose();}
});
test("buffer source release is blocked during barrier and revoked source cannot enter again",async()=>{
 const f=await fixture(),text="memory",hash=createHash("sha256").update(text).digest("hex");
 try{expect(await f.docs.withDuplicateBuffer(f.source,{text,hash},async source=>{
  expect(await f.docs.release({...request(),handle:f.source.handle})).toMatchObject({ok:false,error:"BUSY"});source.checkCurrent();
 })).toBe(true);
 expect(await f.docs.release({...request(),handle:f.source.handle})).toMatchObject({ok:true});
 expect(await f.docs.withDuplicateBuffer(f.source,{text,hash},()=>Promise.resolve()).then(()=>false,()=>true)).toBe(true);
 }finally{await f.dispose();}
});
test("maximum existing byte budget is accepted without writing source",async()=>{
 const f=await fixture(),text="x".repeat(1024*1024),hash=createHash("sha256").update(text).digest("hex");
 try{expect(await f.docs.withDuplicateBuffer(f.source,{text,hash},source=>{expect(source.bytes.length).toBe(1024*1024);expect(source.hash).toBe(hash);return Promise.resolve();})).toBe(true);
 expect(await f.docs.read({...request(),handle:f.source.handle})).toMatchObject({ok:true,snapshot:{text:"SOURCE",revision:f.source.expectedRevision,hash:f.source.expectedHash}});
 }finally{await f.dispose();}
});
async function fixture(){const dir=await mkdtemp(join(tmpdir(),"f058-source-")),path=join(dir,"source.md");await writeFile(path,"SOURCE");const docs=createDocumentService({pickFile:()=>Promise.resolve(path)});const reply=await docs.select(request());if(!reply.ok||!reply.snapshot)throw Error();const s=reply.snapshot;const source:DuplicateSource={handle:s.handle,documentId:s.documentId,expectedRevision:s.revision,expectedHash:s.hash,bufferRevision:0,gateToken:crypto.randomUUID()};return {docs,path,source,async dispose(){await docs.dispose();await rm(dir,{recursive:true,force:true});}};}
test("duplicate source callback holds strict admission without modifying original baseline",async()=>{
 const f=await fixture(),entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>();let observed="";
 try{const run=f.docs.withDuplicateSource(f.source,async source=>{observed=Buffer.from(source.bytes).toString();entered.resolve();await resume.promise;await source.revalidate();source.checkCurrent();});await entered.promise;
 expect(await f.docs.read({...request(),handle:f.source.handle})).toMatchObject({ok:false,error:"BUSY"});expect(await f.docs.select(request())).toMatchObject({ok:false,error:"BUSY"});expect(await f.docs.acquireFolderMutationLease()).toBeNull();
 resume.resolve();expect(await run).toBe(true);expect(observed).toBe("SOURCE");expect(await f.docs.read({...request(),handle:f.source.handle})).toMatchObject({ok:true,snapshot:{documentId:f.source.documentId,revision:f.source.expectedRevision,hash:f.source.expectedHash}});
 }finally{resume.resolve();await f.dispose();}
});
test("source revalidation rejects later disk writes while retaining grant",async()=>{
 const f=await fixture();try{expect(await f.docs.withDuplicateSource(f.source,async source=>{await writeFile(f.path,"CHANGED");await source.revalidate();}).then(()=>false,()=>true)).toBe(true);expect(f.docs.locations()).toHaveLength(1);expect(f.docs.locations()[0].handle).toBe(f.source.handle);expect(await f.docs.withCreateBarrier(()=>undefined)).toBe(true);}finally{await f.dispose();}
});
test("dispose invalidates duplicate source callback before continuation",async()=>{
 const f=await fixture(),entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>();try{const run=f.docs.withDuplicateSource(f.source,async source=>{entered.resolve();await resume.promise;source.checkCurrent();});await entered.promise;await f.docs.dispose();resume.resolve();expect(await run.then(()=>false,()=>true)).toBe(true);expect(await f.docs.withCreateBarrier(()=>undefined)).toBe(false);}finally{resume.resolve();await f.dispose();}
});
