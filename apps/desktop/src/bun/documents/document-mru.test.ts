import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { link, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DocumentResponse } from "../../shared/documents";
import { rawPatch } from "../../shared/save-content";
import { createDocumentMRU } from "../document-mru";

import { createDocumentService } from ".";

const req=()=>({protocolVersion:1 as const,requestId:crypto.randomUUID()});
const snapshot=(v:DocumentResponse)=>{if(!v.ok||!v.snapshot)throw Error(JSON.stringify(v));return v.snapshot;};
test("real grants restore hardlink path-specific IDs without permitting unsupported saves",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mru-documents-")),a=join(dir,"a.md"),b=join(dir,"b.md");await writeFile(a,"original");await link(a,b);
 const mru=createDocumentMRU(join(dir,"settings"));await mru.initialize();mru.bindWindow();mru.domReady();const session=(await mru.begin(req())).session;
 let selected=a,docs=createDocumentService({mru,pickFile:()=>Promise.resolve(selected)});
 try{const one=snapshot(await docs.select(req()));selected=b;const two=snapshot(await docs.select(req()));expect(two.documentId).not.toBe(one.documentId);
 for(const [i,s] of [one,two].entries())expect((await mru.record({...req(),session,sequence:i+1,handle:s.handle,documentId:s.documentId},docs.captureMRU)).status).toBe("persisted");
 const before=mru.snapshot(),text="saved";
 const saved=await docs.save({...req(),handle:one.handle,documentId:one.documentId,expectedHash:one.hash,expectedRevision:one.revision,bufferRevision:1,mirror:one.mirror,content:{kind:"patch",...rawPatch(one.text,text),targetHash:createHash("sha256").update(text).digest("hex")}});
 expect(saved).toMatchObject({ok:false,error:"READ_ONLY"});expect(mru.snapshot()).toEqual(before);
 await mru.drainUntil(performance.now()+2000);await docs.dispose();docs=createDocumentService({mru,pickFile:()=>Promise.resolve(selected)});
 selected=a;expect(snapshot(await docs.select(req())).documentId).toBe(one.documentId);selected=b;expect(snapshot(await docs.select(req())).documentId).toBe(two.documentId);
 await rename(a,join(dir,"old.md"));await writeFile(a,"replacement");selected=a;expect(snapshot(await docs.select(req())).documentId).not.toBe(one.documentId);
 }finally{await docs.dispose();mru.dispose();await rm(dir,{recursive:true,force:true});}
});
test("successful ordinary atomic save migrates proof without reordering MRU",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mru-save-")),path=join(dir,"a.md");await writeFile(path,"original");const mru=createDocumentMRU(join(dir,"settings"));await mru.initialize();mru.bindWindow();mru.domReady();const session=(await mru.begin(req())).session;let docs=createDocumentService({mru,pickFile:()=>Promise.resolve(path)});
 try{const s=snapshot(await docs.select(req()));await mru.record({...req(),session,sequence:1,handle:s.handle,documentId:s.documentId},docs.captureMRU);const before=mru.snapshot().entries[0],text="saved";
 expect(await docs.save({...req(),handle:s.handle,documentId:s.documentId,expectedHash:s.hash,expectedRevision:s.revision,bufferRevision:1,mirror:s.mirror,content:{kind:"patch",...rawPatch(s.text,text),targetHash:createHash("sha256").update(text).digest("hex")}})).toMatchObject({ok:true});
 expect(mru.snapshot().entries[0].fingerprint).not.toBe(before.fingerprint);expect(mru.snapshot().entries[0].rank).toBe(before.rank);await mru.drainUntil(performance.now()+2000);await docs.dispose();docs=createDocumentService({mru,pickFile:()=>Promise.resolve(path)});expect(snapshot(await docs.select(req())).documentId).toBe(s.documentId);
 }finally{await docs.dispose();mru.dispose();await rm(dir,{recursive:true,force:true});}
});
test("record captures trusted grant during quit write barrier without cyclic waits",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mru-barrier-")),path=join(dir,"a.md");await writeFile(path,"a");const mru=createDocumentMRU(join(dir,"settings"));await mru.initialize();mru.bindWindow();mru.domReady();const session=(await mru.begin(req())).session,docs=createDocumentService({mru,pickFile:()=>Promise.resolve(path)});
 try{const s=snapshot(await docs.select(req()));expect(await docs.withWriteBarrier(async()=>{expect((await mru.record({...req(),session,sequence:1,handle:s.handle,documentId:s.documentId},docs.captureMRU)).status).toBe("persisted");return true;})).toBe(true);
 const entry=mru.snapshot().entries[0];expect((await docs.resolveMRUIndependent(entry,()=>undefined))?.handle).toBe(s.handle);expect(docs.inspectMRU({...entry,documentId:crypto.randomUUID()})).toBeUndefined();
 await docs.release({...req(),handle:s.handle});expect(docs.captureMRU(s.handle,s.documentId)).toBeUndefined();expect(await docs.resolveMRUIndependent(entry,()=>undefined)).toBeUndefined();
 }finally{await docs.dispose();mru.dispose();await rm(dir,{recursive:true,force:true});}
});
