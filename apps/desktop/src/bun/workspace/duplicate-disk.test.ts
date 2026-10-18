import { beforeAll, expect, test } from "bun:test";
import { closeSync, openSync, renameSync, writeFileSync } from "node:fs";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DuplicateSource } from "../../shared/create-markdown";
import { createDocumentService } from "../documents";

import type { CreationNative } from "./create-markdown";

import { createWorkspaceService } from ".";

type Native=CreationNative&{publishExclusive(fd:number,src:string,dst:string):unknown;createTemp(fd:number,name:string):number;openFileAt(fd:number,name:string):number;scanStat(fd:number,name:string):{kind:string;fingerprint:string}};
let native:Native;
const envelope=()=>({protocolVersion:1 as const,requestId:crypto.randomUUID()});
const bytes=Buffer.from("efbbbf2320e4b8ad0d0a410a42","hex");
beforeAll(()=>{const desktop=fileURLToPath(new URL("../../../",import.meta.url));expect(Bun.spawnSync([process.execPath,"scripts/build-save-native.ts"],{cwd:desktop}).exitCode).toBe(0);native=createRequire(import.meta.url)(join(desktop,"dist-native/save-primitives.node")) as Native;});
function injected(publish:(fd:number,src:string,dst:string)=>unknown):Native{return {openDirectoryAt:(fd,n)=>native.openDirectoryAt(fd,n),scanOpen:fd=>native.scanOpen(fd),scanBatch:(c,l)=>native.scanBatch(c,l),scanClose:c=>native.scanClose(c),createFileExclusive:(fd,n)=>native.createFileExclusive(fd,n),createTemp:(fd,n)=>native.createTemp(fd,n),openFileAt:(fd,n)=>native.openFileAt(fd,n),scanStat:(fd,n)=>native.scanStat(fd,n),publishExclusive:publish};}
async function fixture(replace?:Native, content=bytes){
 const dir=await mkdtemp(join(tmpdir(),"f058-disk-")),path=join(dir,"source.markdown");await writeFile(path,content);
 const docs=createDocumentService({pickFile:()=>Promise.resolve(path)}),opened=await docs.select(envelope());if(!opened.ok||!opened.snapshot)throw Error();
 const original=opened.snapshot;
 const workspace=createWorkspaceService({documents:docs,pickDirectory:()=>Promise.resolve(dir),directoryNative:replace??native});
 const selected=await workspace.request({...envelope(),op:"select"});if(!selected.ok)throw Error();
 for(let i=0;i<1000;i++){const state=await workspace.request({...envelope(),op:"state"});if(state.ok&&state.roots[0].status!=="scanning")break;await Bun.sleep(2);}
 const receipt=await workspace.duplicateMarkdown({...envelope(),op:"state"});if(receipt.status!=="state")throw Error();
 const operation={session:receipt.session,sequence:receipt.sequence},target={rootHandle:selected.roots[0].handle,generation:selected.roots[0].generation};
 const source:DuplicateSource={handle:original.handle,documentId:original.documentId,expectedRevision:original.revision,expectedHash:original.hash,bufferRevision:0,gateToken:crypto.randomUUID()};
 const request={...envelope(),...operation,op:"create" as const,target,name:"source copy.markdown",source};
 return {dir,path,docs,workspace,source,original,request,operation,target,async dispose(){await workspace.dispose();await docs.dispose();await rm(dir,{recursive:true,force:true});}};
}
test("real duplicate preserves bytes/BOM/EOL and original identity; suggestion skips collisions",async()=>{
 const f=await fixture();try{
  await writeFile(join(f.dir,"source copy.markdown"),"existing");
  expect(await f.workspace.duplicateMarkdown({...envelope(),op:"preview",target:f.target,name:"source.markdown",previewId:"suggest",suggest:true})).toMatchObject({result:"available",fileName:"source copy 2.markdown"});
  await chmod(f.path,0o444);
  const request={...f.request,name:"source copy 2.markdown"};const result=await f.workspace.duplicateMarkdown(request);expect(result.status).toBe("opened");if(!("snapshot" in result)||!result.snapshot)throw Error(JSON.stringify(result));
  expect(await readFile(join(f.dir,request.name))).toEqual(bytes);expect(await readFile(f.path)).toEqual(bytes);expect(result.snapshot.documentId).not.toBe(f.original.documentId);
  expect(f.docs.locations().some(x=>x.handle===f.original.handle&&x.documentId===f.original.documentId)).toBe(true);
  const reread=await f.docs.read({...envelope(),handle:f.original.handle});expect(reread).toMatchObject({ok:true,snapshot:{hash:f.original.hash,revision:f.original.revision}});
  expect(await f.workspace.duplicateMarkdown({...request,source:{...request.source,bufferRevision:1}})).toMatchObject({status:"stale"});
  expect(await f.workspace.duplicateMarkdown(request)).toMatchObject({status:"opened",snapshot:{documentId:result.snapshot.documentId}});
  expect((await readdir(f.dir)).filter(n=>n.startsWith(".agentic-save-"))).toHaveLength(0);
 }finally{await f.dispose();}
});
test("disk changes reject without changing original grant or publishing",async()=>{
 const f=await fixture();try{await writeFile(f.path,"CHANGED");expect(await f.workspace.duplicateMarkdown(f.request)).toMatchObject({status:"rejected-before-create",working:false});expect(f.docs.locations()).toHaveLength(1);expect(f.docs.locations()[0].handle).toBe(f.original.handle);expect(await readdir(f.dir)).toEqual(["source.markdown"]);}finally{await f.dispose();}
});
test("duplicate endpoint requires source and empty creation rejects source",async()=>{
 const f=await fixture();try{const {source:_,...request}=f.request;void _;expect(await f.workspace.duplicateMarkdown(request)).toMatchObject({status:"stale"});const state=await f.workspace.createMarkdown({...envelope(),op:"state"});if(state.status!=="state")throw Error();expect(await f.workspace.createMarkdown({...f.request,session:state.session,sequence:state.sequence})).toMatchObject({status:"stale"});expect(await readdir(f.dir)).toEqual(["source.markdown"]);}finally{await f.dispose();}
});
test("native nonzero/undefined result is terminal unknown and never retries publish",async()=>{
 let calls=0;const f=await fixture(injected(()=>{calls++;return undefined;}));try{
  expect(await f.workspace.duplicateMarkdown(f.request)).toMatchObject({status:"unknown",working:false});
  for(const op of ["query","retry-open","ack"]){expect(await f.workspace.duplicateMarkdown({...envelope(),...f.operation,op})).toMatchObject({status:"unknown",working:false});}
  expect(await f.workspace.duplicateMarkdown(f.request)).toMatchObject({status:"unknown"});expect(calls).toBe(1);expect((await readdir(f.dir)).filter(n=>n.startsWith(".agentic-save-"))).toHaveLength(1);
  expect(await f.docs.withCreateBarrier(()=>undefined)).toBe(true);
 }finally{await f.dispose();}
});
test("native success followed by injected thrown response preserves publication and unknown",async()=>{
 let calls=0;const f=await fixture(injected((fd,s,d)=>{calls++;native.publishExclusive(fd,s,d);throw Error("injected after native success");}));try{
  expect(await f.workspace.duplicateMarkdown(f.request)).toMatchObject({status:"unknown",working:false});expect(await readFile(join(f.dir,f.request.name))).toEqual(bytes);
  expect(await f.workspace.duplicateMarkdown({...envelope(),...f.operation,op:"retry-open"})).toMatchObject({status:"unknown"});expect(calls).toBe(1);expect(f.docs.locations()).toHaveLength(1);
 }finally{await f.dispose();}
});
test("publication conflict preserves competitor and retained temp; no overwrite fallback",async()=>{
 let calls=0;let dir="";const f=await fixture(injected((fd,s,d)=>{calls++;writeFileSync(join(dir,d),"COMPETITOR");return native.publishExclusive(fd,s,d);}));dir=f.dir;try{
  expect(await f.workspace.duplicateMarkdown(f.request)).toMatchObject({status:"rejected-before-create"});expect(await readFile(join(dir,f.request.name),"utf8")).toBe("COMPETITOR");expect(calls).toBe(1);expect((await readdir(dir)).filter(n=>n.startsWith(".agentic-save-"))).toHaveLength(1);
 }finally{await f.dispose();}
});
test("post-publication replacement remains created without adopting or deleting either object",async()=>{
 let dir="";const f=await fixture(injected((fd,s,d)=>{native.publishExclusive(fd,s,d);renameSync(join(dir,d),join(dir,"moved.md"));writeFileSync(join(dir,d),"REPLACEMENT");return 0;}));dir=f.dir;try{
  expect(await f.workspace.duplicateMarkdown(f.request)).toMatchObject({status:"created",working:false});expect(await readFile(join(dir,"moved.md"))).toEqual(bytes);expect(await readFile(join(dir,f.request.name),"utf8")).toBe("REPLACEMENT");expect(f.docs.locations()).toHaveLength(1);
  expect(await f.workspace.duplicateMarkdown({...envelope(),...f.operation,op:"retry-open"})).toMatchObject({status:"created"});expect(f.docs.locations()).toHaveLength(1);
 }finally{await f.dispose();}
});
test("native validates UTF16 and returns exact zero only on real exclusive publish",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"f058-native-")),fd=openSync(dir,"r");try{const temp=".agentic-save-test",file=native.createTemp(fd,temp);closeSync(file);expect(()=>native.publishExclusive(fd,temp,"\ud800")).toThrow("PUBLISH_INVALID");expect(native.publishExclusive(fd,temp,"out.md")).toBe(0);expect(await readFile(join(dir,"out.md"))).toEqual(Buffer.alloc(0));}finally{closeSync(fd);await rm(dir,{recursive:true,force:true});}
});
test("unsupported publication explicitly reports unsupported and retains private temp",async()=>{
 let calls=0;const f=await fixture(injected(()=>{calls++;throw Object.assign(Error("injected unsupported"),{code:"PUBLISH_UNSUPPORTED"});}));try{
  const result=await f.workspace.duplicateMarkdown(f.request);expect(result).toMatchObject({status:"rejected-before-create",working:false});expect("message" in result&&result.message).toContain("不支持安全排他发布");expect(calls).toBe(1);expect((await readdir(f.dir)).filter(n=>n.startsWith(".agentic-save-"))).toHaveLength(1);expect((await readdir(f.dir)).includes(f.request.name)).toBe(false);
 }finally{await f.dispose();}
});
test("temporary substitution fails final identity check before any publication",async()=>{
 let dir="",calls=0,replaced=false;
 const replacement=injected((fd,s,d)=>{calls++;return native.publishExclusive(fd,s,d);});
 replacement.scanStat=(fd,name)=>{if(name.startsWith(".agentic-save-")&&!replaced){replaced=true;renameSync(join(dir,name),join(dir,"held-temp"));writeFileSync(join(dir,name),"REPLACEMENT");}return native.scanStat(fd,name);};
 const f=await fixture(replacement);dir=f.dir;try{
  expect(await f.workspace.duplicateMarkdown(f.request)).toMatchObject({status:"rejected-before-create"});expect(calls).toBe(0);expect(await readFile(join(dir,"held-temp"))).toEqual(bytes);const left=(await readdir(dir)).find(n=>n.startsWith(".agentic-save-"));if(!left)throw Error();expect(await readFile(join(dir,left),"utf8")).toBe("REPLACEMENT");expect((await readdir(dir)).includes(f.request.name)).toBe(false);
 }finally{await f.dispose();}
});
test("LF and empty sources retain exact bytes without source baseline mutation",async()=>{
 for(const content of [Buffer.from("# title\nline\n"),Buffer.alloc(0)]){
  const f=await fixture(undefined,content);try{expect(await f.workspace.duplicateMarkdown(f.request)).toMatchObject({status:"opened"});expect(await readFile(join(f.dir,f.request.name))).toEqual(content);expect(await readFile(f.path)).toEqual(content);expect(await f.docs.read({...envelope(),handle:f.source.handle})).toMatchObject({ok:true,snapshot:{revision:f.source.expectedRevision,hash:f.source.expectedHash}});}finally{await f.dispose();}
 }
});
