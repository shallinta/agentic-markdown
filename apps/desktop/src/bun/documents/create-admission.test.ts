import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DocumentSnapshot } from "../../shared/documents";
import { rawPatch } from "../../shared/save-content";

import { atomicSave } from "./atomic-save";
import { authorizeSingleFile } from "./path-authorization";

import { createDocumentService } from ".";

const request=()=>({protocolVersion:1 as const,requestId:crypto.randomUUID()});
test("creation admission rejects read, select and leases without superseding the original task",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"f057-admission-")),old=join(dir,"old.md"),fresh=join(dir,"new.md");
 await writeFile(old,"OLD");await writeFile(fresh,"");
 const docs=createDocumentService({pickFile:()=>Promise.resolve(old)}),entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>();
 try{
  const before=await docs.select(request());if(!before.ok||!before.snapshot)throw Error();
  let committed:DocumentSnapshot|undefined;
  const opening=docs.openCreatedAuthorized(request(),async()=>{entered.resolve();await resume.promise;return authorizeSingleFile(fresh);},{verify:()=>Promise.resolve()},snapshot=>{committed=snapshot;});
  await entered.promise;
  expect(await docs.read({...request(),handle:before.snapshot.handle})).toMatchObject({ok:false,error:"BUSY"});
  expect(await docs.select(request())).toMatchObject({ok:false,error:"BUSY"});
  expect(await docs.acquireFolderMutationLease()).toBeNull();
  expect(await docs.withCreateBarrier(()=>undefined)).toBe(false);
  resume.resolve();const result=await opening;expect(result.ok).toBe(true);expect(committed?.text).toBe("");expect(docs.locations()).toHaveLength(2);
  expect(await docs.read({...request(),handle:before.snapshot.handle})).toMatchObject({ok:true,snapshot:{text:"OLD"}});
 }finally{resume.resolve();await docs.dispose();await rm(dir,{recursive:true,force:true});}
});
test("strict barrier refuses an existing picker and creates no side effects",async()=>{
 const picked=Promise.withResolvers<string|null>(),entered=Promise.withResolvers<void>();
 const docs=createDocumentService({pickFile:()=>{entered.resolve();return picked.promise;}});
 try{const selecting=docs.select(request());await entered.promise;let calls=0;expect(await docs.withCreateBarrier(()=>{calls++;})).toBe(false);expect(calls).toBe(0);picked.resolve(null);await selecting;}
 finally{picked.resolve(null);await docs.dispose();}
});
test("dispose invalidates owner before awaits and a stale barrier finally cannot reopen admission",async()=>{
 const docs=createDocumentService({pickFile:()=>Promise.resolve(null)}),entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>();
 const barrier=docs.withCreateBarrier(async()=>{entered.resolve();await resume.promise;});
 await entered.promise;const disposing=docs.dispose();
 expect(await docs.select(request())).toMatchObject({ok:false,error:"BUSY"});
 resume.resolve();await barrier;await disposing;
 expect(await docs.withCreateBarrier(()=>undefined)).toBe(false);
});
test("committed sink remains authoritative when a later caller response is lost",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"f057-sink-")),path=join(dir,"new.md");await writeFile(path,"");
 const docs=createDocumentService({pickFile:()=>Promise.resolve(null)});let snapshot:DocumentSnapshot|undefined,registeredAtSink=false;
 try{
  await docs.openCreatedAuthorized(request(),()=>authorizeSingleFile(path),{verify:()=>Promise.resolve()},value=>{snapshot=value;registeredAtSink=docs.locations().some(x=>x.handle===value.handle);});
  expect(registeredAtSink).toBe(true);expect(snapshot?.text).toBe("");expect(docs.locations()).toHaveLength(1);
 }finally{await docs.dispose();await rm(dir,{recursive:true,force:true});}
});
test("an injected exception after the sink records commit cannot remove its registered grant",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"f057-sink-fault-")),path=join(dir,"new.md");await writeFile(path,"");
 const docs=createDocumentService({pickFile:()=>Promise.resolve(null)});let recorded:DocumentSnapshot|undefined;
 try{
  const result=await docs.openCreatedAuthorized(request(),()=>authorizeSingleFile(path),{verify:()=>Promise.resolve()},snapshot=>{recorded=snapshot;throw Error("injected after recording commit");});
  expect(result).toMatchObject({ok:false});expect(recorded?.text).toBe("");expect(docs.locations()).toHaveLength(1);
  if(!recorded)throw Error("sink absent");expect(docs.locations()[0].handle).toBe(recorded.handle);expect(await docs.read({...request(),handle:recorded.handle})).toMatchObject({ok:true,snapshot:{documentId:recorded.documentId,text:""}});
 }finally{await docs.dispose();await rm(dir,{recursive:true,force:true});}
});
test("create barrier drains an already admitted real atomic save before calling its action",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"f057-save-drain-")),path=join(dir,"old.md");await writeFile(path,"A");
 const entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>();
 const docs=createDocumentService({pickFile:()=>Promise.resolve(path),write:async input=>{entered.resolve();await resume.promise;return atomicSave(input);}});
 try{
  const response=await docs.select(request());if(!response.ok||!response.snapshot)throw Error();const s=response.snapshot;
  const saving=docs.save({...request(),handle:s.handle,documentId:s.documentId,expectedHash:s.hash,expectedRevision:s.revision,bufferRevision:1,mirror:s.mirror,content:{kind:"patch",...rawPatch("A","B"),targetHash:createHash("sha256").update("B").digest("hex")}});
  await entered.promise;let called=false;const barrier=docs.withCreateBarrier(async()=>{expect(await readFile(path,"utf8")).toBe("B");called=true;});
  await Promise.resolve();expect(called).toBe(false);resume.resolve();expect(await saving).toMatchObject({ok:true});expect(await barrier).toBe(true);expect(called).toBe(true);
 }finally{resume.resolve();await docs.dispose();await rm(dir,{recursive:true,force:true});}
});
