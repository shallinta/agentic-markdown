import { expect,test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir,mkdtemp,writeFile,readFile,lstat,symlink,readlink,rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { rawPatch } from "../../shared/save-content";
import { validTrashRequest,validTrashResponse } from "../../shared/trash-document";
import { createDocumentService } from "../documents";
import { atomicSave } from "../documents/atomic-save";
import { fileFingerprint } from "../documents/path-authorization";
import { trashFile } from "../documents/trash-file";
import type { TrashInput,TrashResult } from "../documents/trash-operation";

import { createWorkspaceService } from ".";

const env=()=>({protocolVersion:1 as const,requestId:crypto.randomUUID()});
async function fixture(run?:(input:TrashInput)=>Promise<TrashResult>,extraFiles=0,options:Partial<Parameters<typeof createDocumentService>[0]>={}){
 const dir=await mkdtemp(join(tmpdir(),"f059b-formal-")),rootPath=join(dir,"root"),child=join(rootPath,"child"),inside=join(child,"inside.md"),outside=join(rootPath,"outside.md");
 await mkdir(child,{recursive:true});await writeFile(inside,"INSIDE\n");await writeFile(outside,"OUTSIDE\n");
 for(let i=0;i<extraFiles;i++)await writeFile(join(child,`extra-${i}.md`),"EXTRA");
 let picked=inside,pickedRoot=rootPath,resultPath="";
 const documents=createDocumentService({pickFile:()=>Promise.resolve(picked),...options});
 const workspace=createWorkspaceService({documents,pickDirectory:()=>Promise.resolve(pickedRoot),trashRun:run??(async input=>{const result=await trashFile(input);if(result.status==="trashed"){resultPath=result.resultPath;console.info("F059b retained self-created Trash",JSON.stringify({fixture:dir,resultPath}));}return result;})});
 await workspace.request({...env(),op:"select"});
 const state=async()=>{for(let i=0;i<1500;i++){const s=await workspace.request({...env(),op:"state"});if(s.ok&&s.roots.every(r=>r.status==="complete"))return s;await Bun.sleep(2);}throw Error("Incomplete fixture");};
 const initial=await state(),root=initial.roots[0];const page=await workspace.request({...env(),op:"page",root:root.handle,generation:root.generation,cursor:0});if(!page.ok)throw Error();
 const node=page.nodes?.find(n=>n.kind==="directory");if(!node)throw Error("Missing child");
 const s=await workspace.trashDocument({...env(),op:"state"});if(s.status!=="state")throw Error();const operation={session:s.session,sequence:s.sequence};
 const prepare=(whole=false)=>workspace.trashDocument({...env(),...operation,op:"prepare",target:{kind:"directory",root:root.handle,generation:root.generation,...(whole?{}:{entry:node.handle})}});
 return {dir,rootPath,child,inside,outside,workspace,documents,root,node,operation,prepare,state,resultPath:()=>resultPath,pick(path:string){picked=path;},pickRoot(path:string){pickedRoot=path;},async dispose(){await workspace.dispose();await documents.dispose();}};
}
test("real typed directory worker moves complete hidden/binary/link subtree without following external target",async()=>{
 const f=await fixture();try{
  const sentinel=join(f.dir,"external.md"),hidden=Buffer.from([0,255,128,1]);await writeFile(sentinel,"EXTERNAL");await writeFile(join(f.child,".hidden.bin"),hidden);await symlink(sentinel,join(f.child,"external-link"));
  const before=fileFingerprint(await lstat(f.child,{bigint:true}));
  const opened=await f.documents.select(env());expect(opened.ok).toBe(true);f.pick(f.outside);expect((await f.documents.select(env())).ok).toBe(true);
  const p=await f.prepare();expect(p.status).toBe("prepared");if(p.status!=="prepared")throw Error();expect(p.kind).toBe("directory");expect(p.affected.map(x=>x.fileName)).toEqual(["inside.md"]);
  const request={...env(),...f.operation,op:"commit" as const,confirmationToken:p.confirmationToken};const result=await f.workspace.trashDocument(request);expect(result.status).toBe("trashed");expect(validTrashResponse(result,request)).toBe(true);
  expect(fileFingerprint(await lstat(f.resultPath(),{bigint:true}))).toBe(before);expect(await readFile(join(f.resultPath(),".hidden.bin"))).toEqual(hidden);expect(await readlink(join(f.resultPath(),"external-link"))).toBe(sentinel);expect(await readFile(sentinel,"utf8")).toBe("EXTERNAL");
  expect(f.documents.locations()).toHaveLength(1);expect(await readFile(f.outside,"utf8")).toBe("OUTSIDE\n");
  console.info("F059b retained bytes SHA",createHash("sha256").update(await readFile(join(f.resultPath(),"inside.md"))).digest("hex"));
 }finally{await f.dispose();}
});
test("real entire root publication removes root, all grants, and uses bounded empty entry list",async()=>{
 const f=await fixture();try{
  await f.documents.select(env());f.pick(f.outside);await f.documents.select(env());
  const p=await f.prepare(true);if(p.status!=="prepared")throw Error();expect(p.affected).toHaveLength(2);
  const request={...env(),...f.operation,op:"commit" as const,confirmationToken:p.confirmationToken};const result=await f.workspace.trashDocument(request);expect(result.status).toBe("trashed");expect(validTrashResponse(result,request)).toBe(true);
  if(result.status!=="trashed")throw Error();expect(result.publication.files[0]).toMatchObject({removed:true,entries:[]});expect((await f.state()).roots).toHaveLength(0);expect(f.documents.locations()).toHaveLength(0);
  expect(await readFile(join(f.resultPath(),"child","inside.md"),"utf8")).toBe("INSIDE\n");
 }finally{await f.dispose();}
});
test("unknown directory blocks renamed-ancestor reauthorization and equivalent subtree but not sibling",async()=>{
 let calls=0;const f=await fixture(()=>{calls++;return Promise.resolve({status:"unknown",platformSucceeded:false});});try{
  await f.documents.select(env());const p=await f.prepare();if(p.status!=="prepared")throw Error();
  expect((await f.workspace.trashDocument({...env(),...f.operation,op:"commit",confirmationToken:p.confirmationToken})).status).toBe("unknown");
  await rename(f.child,join(f.rootPath,"renamed"));f.pick(join(f.rootPath,"renamed","inside.md"));expect((await f.documents.select(env())).ok).toBe(false);
  expect(f.documents.trashBlocked(join(p.canonicalPath.replace(/child$/,"CHILD"),"new.md"))).toBe(true);
  f.pick(f.outside);expect((await f.documents.select(env())).ok).toBe(true);
  expect((await f.workspace.trashDocument({...env(),...f.operation,op:"ack"})).status).toBe("unknown");expect(calls).toBe(1);
 }finally{await f.dispose();}
});
test("new affected binding after confirmation rejects before directory platform call",async()=>{
 let calls=0;const f=await fixture(()=>{calls++;return Promise.resolve({status:"failed"});});try{
  const p=await f.prepare();if(p.status!=="prepared")throw Error();await f.documents.select(env());
  expect((await f.workspace.trashDocument({...env(),...f.operation,op:"commit",confirmationToken:p.confirmationToken})).status).toBe("failed");expect(calls).toBe(0);
 }finally{await f.dispose();}
});
test("directory target and publication wire stay strict",()=>{
 const target={kind:"directory",root:crypto.randomUUID(),generation:1},request={...env(),op:"prepare",session:crypto.randomUUID(),sequence:1,target};
 expect(validTrashRequest(request)).toBe(true);expect(validTrashRequest({...request,target:{...target,path:"/tmp"}})).toBe(false);expect(validTrashRequest({...request,target:{...target,entry:"invalid"}})).toBe(false);
});
test("directory wire entry capacity rejects before platform, whole root does not enumerate output entries",async()=>{
 let calls=0;const f=await fixture(()=>{calls++;return Promise.resolve({status:"failed"});},1024);try{
  expect((await f.prepare()).status).toBe("failed");expect(calls).toBe(0);
  await f.workspace.trashDocument({...env(),...f.operation,op:"ack"});
  const state=await f.workspace.trashDocument({...env(),op:"state"});if(state.status!=="state")throw Error();
  expect((await f.workspace.trashDocument({...env(),session:state.session,sequence:state.sequence,op:"prepare",target:{kind:"directory",root:f.root.handle,generation:f.root.generation}})).status).toBe("prepared");expect(calls).toBe(0);
 }finally{await f.dispose();}
});
test("directory confirmation identifies same basenames by target-relative paths",async()=>{
 const f=await fixture(()=>Promise.resolve({status:"failed"}));try{
  for(const name of ["a","b"]){await mkdir(join(f.child,name));const path=join(f.child,name,"same.md");await writeFile(path,"SAME");f.pick(path);expect((await f.documents.select(env())).ok).toBe(true);}
  const p=await f.prepare();expect(p.status).toBe("prepared");if(p.status!=="prepared")throw Error();expect(p.affected.map(x=>x.fileName)).toEqual(["a/same.md","b/same.md"]);
 }finally{await f.dispose();}
});
test("unknown original directory identity blocks creation under its newly authorized renamed root",async()=>{
 const f=await fixture(()=>Promise.resolve({status:"unknown",platformSucceeded:false}));try{
  const p=await f.prepare(true);if(p.status!=="prepared")throw Error();await f.workspace.trashDocument({...env(),...f.operation,op:"commit",confirmationToken:p.confirmationToken});
  const moved=join(f.dir,"renamed-root");await rename(f.rootPath,moved);f.pickRoot(moved);await f.workspace.request({...env(),op:"select"});
  const state=await f.workspace.request({...env(),op:"state"});if(!state.ok)throw Error();const root=state.roots.find(r=>r.handle!==f.root.handle);if(!root)throw Error("Missing renamed root");
  const target={rootHandle:root.handle,generation:root.generation};
  const file=await f.workspace.createMarkdown({...env(),op:"state"}),folder=await f.workspace.createFolder({...env(),op:"state"});if(file.status!=="state"||folder.status!=="state")throw Error();
  expect((await f.workspace.createMarkdown({...env(),op:"create",session:file.session,sequence:file.sequence,target,name:"new.md"})).status).toBe("rejected-before-create");
  expect((await f.workspace.createFolder({...env(),op:"create",session:folder.session,sequence:folder.sequence,target,name:"new-folder"})).status).toBe("rejected-before-create");
  expect(await lstat(join(moved,"new.md")).then(()=>true,()=>false)).toBe(false);
 }finally{await f.dispose();}
});
test("directory prepare drains real admitted save before capturing bindings",async()=>{
 const entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>();let calls=0;
 const f=await fixture(()=>{calls++;return Promise.resolve({status:"failed"});},0,{write:async input=>{entered.resolve();await resume.promise;return atomicSave(input);}});try{
  const opened=await f.documents.select(env());if(!opened.ok||!opened.snapshot)throw Error();const s=opened.snapshot,text="SAVED BEFORE DIRECTORY\n";
  const saving=f.documents.save({...env(),handle:s.handle,documentId:s.documentId,expectedHash:s.hash,expectedRevision:s.revision,bufferRevision:1,mirror:s.mirror,content:{kind:"patch",...rawPatch(s.text,text),targetHash:createHash("sha256").update(text).digest("hex")}});await entered.promise;
  let settled=false;const preparing=f.prepare().then(p=>{settled=true;return p;});await Bun.sleep(5);expect(settled).toBe(false);expect(calls).toBe(0);resume.resolve();expect(await saving).toMatchObject({ok:true});
  const p=await preparing;expect(p.status).toBe("prepared");expect(await readFile(f.inside,"utf8")).toBe(text);
 }finally{resume.resolve();await f.dispose();}
});
test("created empty-directory exception is revoked after actual Trash and cannot survive rescan",async()=>{
 const f=await fixture();try{
  const cs=await f.workspace.createFolder({...env(),op:"state"});if(cs.status!=="state")throw Error();const op={session:cs.session,sequence:cs.sequence};
  const created=await f.workspace.createFolder({...env(),...op,op:"create",target:{rootHandle:f.root.handle,generation:f.root.generation},name:"empty-owned"});expect(created.status).toBe("created");if(created.status!=="created"||!created.entryHandle)throw Error();
  await f.workspace.createFolder({...env(),...op,op:"ack"});const state=await f.state(),root=state.roots[0];
  const p=await f.workspace.trashDocument({...env(),...f.operation,op:"prepare",target:{kind:"directory",root:root.handle,generation:root.generation,entry:created.entryHandle}});expect(p.status).toBe("prepared");if(p.status!=="prepared")throw Error();expect(p.affected).toHaveLength(0);
  expect((await f.workspace.trashDocument({...env(),...f.operation,op:"commit",confirmationToken:p.confirmationToken})).status).toBe("trashed");
  await f.workspace.trashDocument({...env(),...f.operation,op:"ack"});await mkdir(join(f.rootPath,"empty-owned"));
  await f.workspace.request({...env(),op:"rescan",root:root.handle});const next=(await f.state()).roots[0];const page=await f.workspace.request({...env(),op:"page",root:next.handle,generation:next.generation,cursor:0});expect(page.ok&&page.nodes?.some(n=>n.name==="empty-owned")).toBe(false);
 }finally{await f.dispose();}
});
test("unreliable path-matching descendant proof rejects before dispatch and releases admission",async()=>{
 let calls=0;const f=await fixture(()=>{calls++;return Promise.resolve({status:"failed"});});try{
  await f.documents.select(env());const acquire=f.documents.acquireFolderMutationLease.bind(f.documents);
  f.documents.acquireFolderMutationLease=async()=>{const lease=await acquire();return lease?{...lease,bindings:()=>lease.bindings().map(binding=>({...binding,directories:[]}))}:null;};
  expect((await f.prepare()).status).toBe("failed");expect(calls).toBe(0);expect(await f.documents.withWriteBarrier(()=>Promise.resolve(true))).toBe(true);
 }finally{await f.dispose();}
});
test("successful directory receipt remains charged through rescan until ack",async()=>{
 const f=await fixture();try{
  const p=await f.prepare();if(p.status!=="prepared")throw Error();
  expect((await f.workspace.trashDocument({...env(),...f.operation,op:"commit",confirmationToken:p.confirmationToken})).status).toBe("trashed");
  await f.workspace.request({...env(),op:"rescan",root:f.root.handle});const before=await f.state();
  const receipt=await f.workspace.trashDocument({...env(),...f.operation,op:"query"});expect(receipt.status).toBe("trashed");
  expect((await f.workspace.trashDocument({...env(),...f.operation,op:"ack"})).status).toBe("acked");
  const after=await f.state();expect(before.cacheBytes-after.cacheBytes).toBeGreaterThan(2048);
 }finally{await f.dispose();}
});
