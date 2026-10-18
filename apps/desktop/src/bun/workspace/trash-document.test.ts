import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rename, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { rawPatch } from "../../shared/save-content";
import { validTrashResponse, type TrashRequest } from "../../shared/trash-document";
import { createDocumentService } from "../documents";
import { atomicSave } from "../documents/atomic-save";
import { trashFile } from "../documents/trash-file";
import type { TrashResult } from "../documents/trash-operation";

import { createWorkspaceService } from ".";

const env=()=>({protocolVersion:1 as const,requestId:crypto.randomUUID()});
async function fixture(run?:()=>Promise<TrashResult>, options:Partial<Parameters<typeof createDocumentService>[0]>={},name="test.md"){
 const dir=await mkdtemp(join(tmpdir(),"f059a-workspace-")),path=join(dir,name);await writeFile(path,"SELF CREATED\n");let selected=path;
 const documents=createDocumentService({pickFile:()=>Promise.resolve(selected),...options}),workspace=createWorkspaceService({documents,pickDirectory:()=>Promise.resolve(dir),trashRun:run??(async input=>{const result=await trashFile(input);if(result.status==="trashed")console.info("F059a retained self-created Trash material",result.resultPath);return result;})});
 await workspace.request({...env(),op:"select"});
 let root:import("../../shared/workspace").WorkspaceRoot|undefined;
 for(let i=0;i<1000;i++){const s=await workspace.request({...env(),op:"state"});if(s.ok&&s.roots[0]?.status==="complete"){root=s.roots[0];break;}await Bun.sleep(2);}
 if(!root)throw Error("Scan did not complete");
 const page=await workspace.request({...env(),op:"page",root:root.handle,generation:root.generation,cursor:0});if(!page.ok||!page.nodes?.[0])throw Error("Missing fixture node");
 const state=await workspace.trashDocument({...env(),op:"state"});if(state.status!=="state")throw Error();
 const op={session:state.session,sequence:state.sequence};
 const prepare=()=>workspace.trashDocument({...env(),...op,op:"prepare",target:{kind:"root",root:root.handle,generation:root.generation,entry:page.nodes![0].handle}});
 return {dir,path,workspace,documents,op,prepare,pick(path:string){selected=path;},async dispose(){await workspace.dispose();await documents.dispose();}};
}
test("real unopened root file: prepare releases admission, commit system Trash once, exact projection and replay",async()=>{
 const f=await fixture();try{
  const p=await f.prepare();expect(p.status).toBe("prepared");expect(f.documents.locations()).toHaveLength(0);
  expect(await f.documents.withWriteBarrier(()=>Promise.resolve(true))).toBe(true);
  if(p.status!=="prepared")throw Error();
  const request={...env(),...f.op,op:"commit" as const,confirmationToken:p.confirmationToken};
  const result=await f.workspace.trashDocument(request);expect(result.status).toBe("trashed");expect(validTrashResponse(result,request)).toBe(true);
  const repeat=await f.workspace.trashDocument({...request,requestId:crypto.randomUUID()});expect(repeat.status).toBe("trashed");
  if(result.status==="trashed"){expect(result.publication.documents).toHaveLength(0);expect(result.publication.files).toHaveLength(1);}
  expect(await readFile(f.path).then(()=>true,()=>false)).toBe(false);
  console.info("F059a self-created workspace fixture moved; no Trash cleanup",f.dir);
 }finally{await f.dispose();}
});
test("held worker exit handoff retains identity quarantine, unknown ack never replays",async()=>{
 let resolve!:(r:TrashResult)=>void,calls=0;const promise=new Promise<TrashResult>(r=>{resolve=r;});
 const f=await fixture(()=>{calls++;return promise;});try{
  const opened=await f.documents.select(env());expect(opened.ok).toBe(true);
  const p=await f.prepare();if(p.status!=="prepared")throw Error();
  const pending=f.workspace.trashDocument({...env(),...f.op,op:"commit",confirmationToken:p.confirmationToken});
  for(let i=0;i<100&&calls===0;i++)await Bun.sleep(1);expect(calls).toBe(1);
  f.workspace.trashLifecycle.beforeExit();expect(await f.documents.withWriteBarrier(()=>Promise.resolve(true))).toBe(true);
  expect(await f.workspace.trashLifecycle.finishExit(Date.now()+5)).toBe(false);f.workspace.trashLifecycle.cancelExit();
  expect(f.documents.trashBlocked(p.canonicalPath)).toBe(true);
  expect((await f.documents.select(env())).ok).toBe(false);
  resolve({status:"unknown",platformSucceeded:false});expect((await pending).status).toBe("unknown");
  expect((await f.workspace.trashDocument({...env(),...f.op,op:"ack"})).status).toBe("unknown");
  await f.workspace.trashDocument({...env(),...f.op,op:"commit",confirmationToken:p.confirmationToken});expect(calls).toBe(1);
  expect(await readFile(f.path,"utf8")).toBe("SELF CREATED\n");
  await rename(f.path,join(f.dir,"original-held.md"));
  const ws=await f.workspace.request({...env(),op:"state"}),creation=await f.workspace.createMarkdown({...env(),op:"state"});
  if(!ws.ok||creation.status!=="state")throw Error();
  const created=await f.workspace.createMarkdown({...env(),op:"create",session:creation.session,sequence:creation.sequence,target:{rootHandle:ws.roots[0].handle,generation:ws.roots[0].generation},name:"Test.md"});
  expect(created.status).not.toBe("opened");expect(await readFile(join(f.dir,"Test.md")).then(()=>true,()=>false)).toBe(false);
 }finally{resolve({status:"unknown",platformSucceeded:false});await f.dispose();}
});
test("strict wire rejects phase confusion and duplicate or regressing publications",()=>{
 const request:TrashRequest={...env(),op:"state"},session=crypto.randomUUID(),root=crypto.randomUUID(),handle=crypto.randomUUID(),documentId=crypto.randomUUID();
 const value={...env(),requestId:request.requestId,session,sequence:1,status:"trashed",working:false,publication:{documents:[{handle,documentId}],files:[{root,previousGeneration:1,generation:2,entries:[crypto.randomUUID()]}]}};
 expect(validTrashResponse(value,request)).toBe(false);
 const query:TrashRequest={...request,op:"query",session,sequence:1};expect(validTrashResponse(value,query)).toBe(true);
 expect(validTrashResponse({...value,publication:{...value.publication,documents:[{handle,documentId},{handle,documentId}]}},query)).toBe(false);
 expect(validTrashResponse({...value,publication:{...value.publication,files:[{...value.publication.files[0],generation:1}]}},query)).toBe(false);
});
test("replacement after confirmation never dispatches, root removal likewise invalidates target",async()=>{
 for(const change of ["replace","remove"]){let calls=0;const f=await fixture(()=>{calls++;return Promise.resolve({status:"failed"});});try{
  const p=await f.prepare();if(p.status!=="prepared")throw Error();
  if(change==="replace"){await rename(f.path,join(f.dir,"original-held.md"));await writeFile(f.path,"REPLACEMENT");}
  else await f.workspace.request({...env(),op:"clear"});
  expect((await f.workspace.trashDocument({...env(),...f.op,op:"commit",confirmationToken:p.confirmationToken})).status).toBe("failed");expect(calls).toBe(0);
  if(change==="replace")expect(await readFile(f.path,"utf8")).toBe("REPLACEMENT");
 }finally{await f.dispose();}}
});
test("platform YES retained through exit handoff and never retried after lost projection",async()=>{
 let resolve!:(r:TrashResult)=>void,calls=0;const held=new Promise<TrashResult>(r=>{resolve=r;});const f=await fixture(()=>{calls++;return held;});try{
  const p=await f.prepare();if(p.status!=="prepared")throw Error();
  const task=f.workspace.trashDocument({...env(),...f.op,op:"commit",confirmationToken:p.confirmationToken});
  for(let i=0;i<100&&!calls;i++)await Bun.sleep(1);f.workspace.trashLifecycle.beforeExit();
  resolve({status:"unknown",platformSucceeded:true});const result=await task;
  expect(result.status).toBe("unknown");expect("message"in result&&result.message).toContain("系统已确认");
  expect((await f.workspace.trashDocument({...env(),...f.op,op:"query"}))).toMatchObject({status:"unknown",working:false});expect(calls).toBe(1);
 }finally{resolve({status:"unknown",platformSucceeded:true});await f.dispose();}
});
test("standalone target and covered child root publish one canonical projection without extra documents",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"f059a-multiroot-")),child=join(dir,"child"),path=join(child,"self.md");await mkdir(child);await writeFile(path,"MULTI ROOT SELF\n");
 let selected=dir;const documents=createDocumentService({pickFile:()=>Promise.resolve(path)}),workspace=createWorkspaceService({documents,pickDirectory:()=>Promise.resolve(selected),trashRun:async input=>{const result=await trashFile(input);if(result.status==="trashed")console.info("F059a multiroot self-created retained Trash material",result.resultPath);return result;}});
 try{
  await workspace.request({...env(),op:"select"});selected=child;await workspace.request({...env(),op:"select"});
  for(let i=0;i<1000;i++){const s=await workspace.request({...env(),op:"state"});if(s.ok&&s.roots.every(r=>r.status==="complete")){expect(s.roots).toHaveLength(1);break;}await Bun.sleep(2);}
  const opened=await documents.select(env());if(!opened.ok||!opened.snapshot)throw Error();const snapshot=opened.snapshot;
  const state=await workspace.trashDocument({...env(),op:"state"});if(state.status!=="state")throw Error();
  const op={session:state.session,sequence:state.sequence};
  const p=await workspace.trashDocument({...env(),...op,op:"prepare",target:{kind:"standalone",handle:snapshot.handle,documentId:snapshot.documentId}});expect(p.status).toBe("prepared");if(p.status!=="prepared")throw Error();
  expect(p.affected).toHaveLength(1);expect(documents.locations()).toHaveLength(1);
  const result=await workspace.trashDocument({...env(),...op,op:"commit",confirmationToken:p.confirmationToken});expect(result.status).toBe("trashed");
  if(result.status!=="trashed")throw Error();expect(result.publication.files).toHaveLength(1);expect(result.publication.documents).toEqual([{handle:snapshot.handle,documentId:snapshot.documentId}]);expect(documents.locations()).toHaveLength(0);
 }finally{await workspace.dispose();await documents.dispose();}
});
test("trash admission drains an existing real save and never dispatches its stale root proof",async()=>{
 const entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>();let calls=0;
 const f=await fixture(()=>{calls++;return Promise.resolve({status:"failed"});},{write:async input=>{entered.resolve();await resume.promise;return atomicSave(input);}});
 try{
  const opened=await f.documents.select(env());if(!opened.ok||!opened.snapshot)throw Error();const s=opened.snapshot;
  const text="SAVED SELF\n",saving=f.documents.save({...env(),handle:s.handle,documentId:s.documentId,expectedHash:s.hash,expectedRevision:s.revision,bufferRevision:1,mirror:s.mirror,content:{kind:"patch",...rawPatch(s.text,text),targetHash:createHash("sha256").update(text).digest("hex")}});
  await entered.promise;let settled=false;const preparing=f.prepare().then(result=>{settled=true;return result;});await Bun.sleep(5);expect(settled).toBe(false);expect(calls).toBe(0);
  resume.resolve();expect(await saving).toMatchObject({ok:true});const p=await preparing;
  if(p.status==="prepared")expect((await f.workspace.trashDocument({...env(),...f.op,op:"commit",confirmationToken:p.confirmationToken})).status).toBe("failed");else expect(p.status).toBe("failed");
  expect(calls).toBe(0);expect(await readFile(f.path,"utf8")).toBe(text);
 }finally{resume.resolve();await f.dispose();}
});
test("affected capacity is rejected before any destructive dispatch",async()=>{
 let calls=0;const f=await fixture(()=>{calls++;return Promise.resolve({status:"failed"});});try{
  const opened=await f.documents.select(env());if(!opened.ok)throw Error();
  const acquire=f.documents.acquireFolderMutationLease.bind(f.documents);
  f.documents.acquireFolderMutationLease=async()=>{const lease=await acquire();if(!lease)return null;const binding=lease.bindings()[0];return {...lease,bindings:()=>Array.from({length:1025},()=>({...binding,handle:crypto.randomUUID()}))};};
  expect((await f.prepare()).status).toBe("failed");expect(calls).toBe(0);expect(await f.documents.withWriteBarrier(()=>Promise.resolve(true))).toBe(true);
 }finally{await f.dispose();}
});
test("unknown target NFC/case equivalents block file, folder and disk duplicate while unrelated names remain eligible",async()=>{
 const f=await fixture(()=>Promise.resolve({status:"unknown",platformSucceeded:false}),{},"Café.md");try{
  const p=await f.prepare();if(p.status!=="prepared")throw Error();await f.workspace.trashDocument({...env(),...f.op,op:"commit",confirmationToken:p.confirmationToken});
  await rename(f.path,join(f.dir,"original-held.md"));
  expect(f.documents.trashBlocked(join(p.canonicalPath.slice(0,p.canonicalPath.lastIndexOf("/")),"CAFE\u0301.md"))).toBe(true);
  expect(f.documents.trashBlocked(join(p.canonicalPath.slice(0,p.canonicalPath.lastIndexOf("/")),"other.md"))).toBe(false);
  const ws=await f.workspace.request({...env(),op:"state"});if(!ws.ok)throw Error();const target={rootHandle:ws.roots[0].handle,generation:ws.roots[0].generation};
  const cs=await f.workspace.createMarkdown({...env(),op:"state"});if(cs.status!=="state")throw Error();
  const created=await f.workspace.createMarkdown({...env(),op:"create",session:cs.session,sequence:cs.sequence,target,name:"CAFE\u0301.md"});expect(created.status).toBe("rejected-before-create");
  const fs=await f.workspace.createFolder({...env(),op:"state"});if(fs.status!=="state")throw Error();
  const folder=await f.workspace.createFolder({...env(),op:"create",session:fs.session,sequence:fs.sequence,target,name:"CAFE\u0301.md"});expect(folder.status).toBe("rejected-before-create");
  const other=join(f.dir,"other.md");await writeFile(other,"OTHER SOURCE");f.pick(other);const opened=await f.documents.select(env());if(!opened.ok||!opened.snapshot)throw Error();const s=opened.snapshot;
  const ds=await f.workspace.duplicateMarkdown({...env(),op:"state"});if(ds.status!=="state")throw Error();
  const copied=await f.workspace.duplicateMarkdown({...env(),op:"create",session:ds.session,sequence:ds.sequence,target,name:"CAFE\u0301.md",source:{handle:s.handle,documentId:s.documentId,expectedRevision:s.revision,expectedHash:s.hash,bufferRevision:0,gateToken:crypto.randomUUID()},version:{kind:"disk"}});expect(copied.status).toBe("rejected-before-create");
  expect(await readFile(join(f.dir,"CAFE\u0301.md")).then(()=>true,()=>false)).toBe(false);expect(await readFile(other,"utf8")).toBe("OTHER SOURCE");
 }finally{await f.dispose();}
});
