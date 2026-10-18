import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DuplicateSource } from "../../shared/create-markdown";

import { createDocumentService } from ".";

const request=()=>({protocolVersion:1 as const,requestId:crypto.randomUUID()});
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
