import { beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { closeSync, openSync, renameSync, mkdirSync, writeFileSync, fstatSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile, rename,readFile,symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { folderName, validCreateFolderRequest, validCreateFolderResponse } from "../../shared/create-folder";
import { rawPatch } from "../../shared/save-content";
import { createDocumentService } from "../documents";
import { atomicSave } from "../documents/atomic-save";
import { fileFingerprint } from "../documents/path-authorization";

import { authorizeRoot } from "./authorization";
import { createFolderOnDisk, type FolderNative } from "./create-folder-disk";
import { createDirectoryRegistry } from "./created-directories";
import { createScan } from "./scan";
import { validDirectorySnapshot, validScanBatch } from "./scan-protocol";

import { createWorkspaceService } from ".";

const env=()=>({protocolVersion:1 as const,requestId:crypto.randomUUID()});
const operationEnvelope=(value:{session:string;sequence:number})=>({...env(),session:value.session,sequence:value.sequence});
const override=(value:Partial<FolderNative>):FolderNative=>Object.assign(Object.fromEntries(Object.getOwnPropertyNames(native).map(key=>[key,Reflect.get(native,key)])),value) as FolderNative;
let native:FolderNative,nativePath:string;
beforeAll(()=>{const desktop=fileURLToPath(new URL("../../../",import.meta.url));expect(Bun.spawnSync([process.execPath,"scripts/build-save-native.ts"],{cwd:desktop}).exitCode).toBe(0);nativePath=join(desktop,"dist-native/save-primitives.node");native=createRequire(import.meta.url)(nativePath) as FolderNative;});
async function fixture(injected?:FolderNative,options:Partial<Parameters<typeof createDocumentService>[0]>={}){
 const dir=await mkdtemp(join(tmpdir(),"f057b-formal-"));await writeFile(join(dir,"cover.md"),"KEEP");await mkdir(join(dir,"ordinary-empty"));
 const documents=createDocumentService({pickFile:()=>Promise.resolve(join(dir,"cover.md")),...options}),workspace=createWorkspaceService({documents,pickDirectory:()=>Promise.resolve(dir),directoryNative:injected??native});
 await workspace.request({...env(),op:"select"});
 async function state(){for(let i=0;i<1000;i++){const s=await workspace.request({...env(),op:"state"});if(s.ok&&s.roots[0]?.status!=="scanning")return s;await Bun.sleep(2);}throw Error("Scan timeout");}
 async function nodes(){const s=await state(),root=s.roots[0];const p=await workspace.request({...env(),op:"page",root:root.handle,generation:root.generation,cursor:0});if(!p.ok||!p.nodes)throw Error("No nodes");return p.nodes;}
 async function create(name:string,directoryHandle?:string){const s=await state(),slot=await workspace.createFolder({...env(),op:"state"});if(slot.status!=="state")throw Error();const request={...env(),op:"create" as const,session:slot.session,sequence:slot.sequence,target:{rootHandle:s.roots[0].handle,generation:s.roots[0].generation,...(directoryHandle?{directoryHandle}:{})},name};return {request,response:await workspace.createFolder(request)};}
 return {dir,workspace,documents,state,nodes,create,async dispose(){await workspace.dispose();await documents.dispose();await rm(dir,{recursive:true,force:true});}};
}
test("folder names never append an extension and strict wire refuses file grants",()=>{
 expect(folderName("中文")).toEqual({ok:true,name:"中文"});for(const name of [".git","..","a/","\ud800", "中".repeat(86)])expect(folderName(name).ok).toBe(false);
 const request={...env(),op:"create" as const,session:crypto.randomUUID(),sequence:1,target:{rootHandle:crypto.randomUUID(),generation:1},name:"x"};expect(validCreateFolderRequest(request)).toBe(true);expect(validCreateFolderRequest({...request,source:{}})).toBe(false);
 const response={...env(),requestId:request.requestId,status:"created",operation:{session:request.session,sequence:1},working:false};expect(validCreateFolderResponse(response,request)).toBe(true);expect(validCreateFolderResponse({...response,snapshot:{}},request)).toBe(false);expect(validCreateFolderResponse({...response,working:undefined},request)).toBe(false);
});
test("real folder stays visible through restart and manual acceptance; accepts new Markdown without folder grant",async()=>{
 const f=await fixture();try{
  const {request,response}=await f.create("中文");expect(response.status).toBe("created");expect("entryHandle"in response&&response.entryHandle).toBeString();expect(f.documents.locations()).toHaveLength(0);
  await f.workspace.createFolder({...operationEnvelope(request),op:"ack"});
  let s=await f.state();await f.workspace.request({...env(),op:"rescan",root:s.roots[0].handle});let nodes=await f.nodes();expect(nodes.map(n=>n.name)).toContain("中文");expect(nodes.map(n=>n.name)).not.toContain("ordinary-empty");
  s=await f.state();const prepared=await f.workspace.reconciliation.prepare(s.roots[0].handle);expect(prepared.ok).toBe(true);if(!prepared.ok)throw Error();const operation=f.workspace.reconciliation.issue(prepared.summary.token);if(!operation)throw Error();expect((await f.workspace.reconciliation.accept(operation)).status).toBe("committed");
  nodes=await f.nodes();const directory=nodes.find(n=>n.name==="中文")!;s=await f.state();const slot=await f.workspace.createMarkdown({...env(),op:"state"});if(slot.status!=="state")throw Error();const created=await f.workspace.createMarkdown({...env(),op:"create",session:slot.session,sequence:slot.sequence,target:{rootHandle:s.roots[0].handle,generation:s.roots[0].generation,directoryHandle:directory.handle},name:"inside"});expect(created.status).toBe("opened");expect(await readdir(join(f.dir,"中文"))).toEqual(["inside.md"]);
 }finally{await f.dispose();}
});
test("folder exact replay and lost ack never recreate; different input refused",async()=>{
 const f=await fixture();try{const {request,response}=await f.create("one");expect(response.status).toBe("created");expect((await f.workspace.createFolder({...request,name:"two"})).status).toBe("stale");expect((await f.workspace.createFolder(request)).status).toBe("created");expect((await f.workspace.createFolder({...operationEnvelope(request),op:"ack"})).status).toBe("acked");expect((await f.workspace.createFolder({...operationEnvelope(request),op:"query"})).status).toBe("acked");for(const name of ["one","cover.md","ordinary-empty"])expect(await readdir(f.dir)).toContain(name);}finally{await f.dispose();}
});
test("hidden exception retained while off then reverified, reliable deletion permanently revokes old operation",async()=>{
 const f=await fixture();try{
  let s=await f.state();await f.workspace.request({...env(),op:"hidden",root:s.roots[0].handle,showHidden:true});await f.state();const {request,response}=await f.create(".owned");expect(response.status).toBe("created");
  s=await f.state();await f.workspace.request({...env(),op:"hidden",root:s.roots[0].handle,showHidden:false});expect((await f.nodes()).some(n=>n.name===".owned")).toBe(false);
  s=await f.state();await f.workspace.request({...env(),op:"hidden",root:s.roots[0].handle,showHidden:true});expect((await f.nodes()).some(n=>n.name===".owned")).toBe(true);
  await rename(join(f.dir,".owned"),join(f.dir,"retained"));s=await f.state();await f.workspace.request({...env(),op:"rescan",root:s.roots[0].handle});await f.state();await rename(join(f.dir,"retained"),join(f.dir,".owned"));
  const result=await f.workspace.createFolder({...operationEnvelope(request),op:"retry-locate"});expect(result.status).toBe("created");expect("entryHandle"in result&&result.entryHandle).toBeUndefined();expect((await f.nodes()).some(n=>n.name===".owned")).toBe(false);
 }finally{await f.dispose();}
});
test("unsupported and invalid native publication return preserve residue without fallback or repeated call",async()=>{
 for(const mode of ["unsupported","unknown"]){let calls=0;const f=await fixture(override({publishDirectoryExclusive(){calls++;if(mode==="unsupported")throw Object.assign(Error("Unsupported"),{code:"PUBLISH_UNSUPPORTED"});return undefined as unknown as number;}}));try{const {request,response}=await f.create("final");expect(response.status).toBe(mode==="unsupported"?"rejected-before-create":"unknown");if(mode==="unsupported")expect("message"in response&&response.message).toContain("不支持");expect((await readdir(f.dir)).some(n=>n.startsWith(".agentic-dir-"))).toBe(true);expect((await readdir(f.dir)).includes("final")).toBe(false);await f.workspace.createFolder(request);expect(calls).toBe(1);}finally{await f.dispose();}}
});
test("real publication rejects temp replacement and fresh second emptiness check detects inserted content",async()=>{
 for(const mode of ["replace","insert"]){const dir=await mkdtemp(join(tmpdir(),"f057b-disk-"));try{const root=await authorizeRoot(dir);let scans=0,calls=0,temp="";const injected=override({createPrivateDirectory(fd:number,name:string){temp=name;return native.createPrivateDirectory(fd,name);},scanClose(cursor:object){native.scanClose(cursor);if(++scans===1){if(mode==="replace"){renameSync(join(dir,temp),join(dir,"retained"));mkdirSync(join(dir,temp));}else writeFileSync(join(dir,temp,"unexpected"),"KEEP");}},publishDirectoryExclusive(fd:number,src:string,dst:string){calls++;return native.publishDirectoryExclusive(fd,src,dst);}});expect(()=>createFolderOnDisk({native:injected,target:{root,path:dir,chain:[],showHidden:true,check(){return;},scope(){throw Error();}},name:"final",check(){return;},committed(){throw Error("Should not publish");},unknown(){throw Error("Should not call publish");}})).toThrow();expect(calls).toBe(0);expect((await readdir(dir)).includes("final")).toBe(false);}finally{await rm(dir,{recursive:true,force:true});}}
});
test("strict bounded snapshot rejects malformed/cyclic chains and scanner jointly caps directories plus files",async()=>{
 const cycle:unknown[]=[];cycle.push(cycle);expect(validDirectorySnapshot({version:1,directories:cycle},"/root")).toBe(false);
 const dir=await mkdtemp(join(tmpdir(),"f057b-scan-"));try{await mkdir(join(dir,"owned"));for(let i=0;i<130;i++)await writeFile(join(dir,`${i}.md`),"");const fd=openSync(join(dir,"owned"),"r"),fingerprint=fileFingerprint(fstatSync(fd,{bigint:true}));closeSync(fd);const root=await authorizeRoot(dir),snapshot={version:1,directories:[{path:join(root.path,"owned"),fingerprint,chain:[]}]};expect(validDirectorySnapshot(snapshot,root.path)).toBe(true);const scan=createScan(root,nativePath,true,undefined,snapshot);let directories=0,files=0;try{for(let i=0;i<20;i++){const batch=await scan.next();expect(validScanBatch(batch)).toBe(true);expect(batch.files.length+batch.directories.length).toBeLessThanOrEqual(128);directories+=batch.directories.length;files+=batch.files.length;if(batch.done)break;}}finally{scan.close();}expect(directories).toBe(1);expect(files).toBe(130);}finally{await rm(dir,{recursive:true,force:true});}
});
test("registered folder retry survives own commit and rescan, root clear/readd never inherits",async()=>{
 const f=await fixture();try{const {request,response}=await f.create("retained");expect(response.status).toBe("created");const s=await f.state();await f.workspace.request({...env(),op:"rescan",root:s.roots[0].handle});await f.state();const retried=await f.workspace.createFolder({...operationEnvelope(request),op:"retry-locate"});expect(retried.status).toBe("created");expect("entryHandle"in retried&&retried.entryHandle).toBeString();await f.workspace.request({...env(),op:"clear"});await f.workspace.request({...env(),op:"select"});expect((await f.nodes()).some(node=>node.name==="retained")).toBe(false);const stale=await f.workspace.createFolder({...operationEnvelope(request),op:"retry-locate"});expect("entryHandle"in stale&&stale.entryHandle).toBeUndefined();expect(f.documents.locations()).toHaveLength(0);}finally{await f.dispose();}
});
test("automatic reconciliation preserves empty exception after its last Markdown disappears",async()=>{
 const f=await fixture();try{const {request}=await f.create("watched");await f.workspace.createFolder({...operationEnvelope(request),op:"ack"});await writeFile(join(f.dir,"watched","external.md"),"TEMP");
 async function waitFor(name:string,present:boolean){for(let i=0;i<80;i++){const nodes=await f.nodes();if(nodes.some(n=>n.name===name)===present)return;await Bun.sleep(50);}throw Error("Watch timeout");}
 await waitFor("external.md",true);await rm(join(f.dir,"watched","external.md"));await waitFor("external.md",false);expect((await f.nodes()).some(n=>n.name==="watched")).toBe(true);expect((await f.nodes()).some(n=>n.name==="ordinary-empty")).toBe(false);
 }finally{await f.dispose();}
});
test("registry reservations are bounded, own version advances and revoked tokens never revive",()=>{
 let bytes=0;const registry=createDirectoryRegistry("/root",delta=>{bytes+=delta;});const proof={path:"/root/new",fingerprint:"1:2:3",chain:[]};const reservation=registry.reserve(proof);expect(bytes).toBeGreaterThan(0);const receipt=registry.commit(reservation,proof,1);expect(receipt.committedVersion).toBe(2);expect(registry.has(receipt.registrationToken)).toBe(true);registry.reconcile([],false);expect(registry.has(receipt.registrationToken)).toBe(false);expect(bytes).toBe(0);registry.reconcile([proof],true);expect(registry.has(receipt.registrationToken)).toBe(false);const pending=[];for(let i=0;i<1024;i++)pending.push(registry.reserve({...proof,path:`/root/${i}`}));expect(()=>registry.reserve({...proof,path:"/root/overflow"})).toThrow();for(const item of pending)registry.cancel(item);expect(bytes).toBe(0);registry.dispose();
});
test("native directory wrappers reject invalid input and existing final files/directories/links",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"f057b-native-")),fd=openSync(dir,"r");try{for(const name of [".agentic-save-x",".agentic-dir-\ud800",".agentic-dir-../x", "x"])expect(()=>native.createPrivateDirectory(fd,name)).toThrow();for(const name of ["existing","directory","link"]){if(name==="existing")await writeFile(join(dir,name),"KEEP");else if(name==="link")await symlink("existing",join(dir,name));else await mkdir(join(dir,name));const temp=`.agentic-dir-${crypto.randomUUID()}`;expect(native.createPrivateDirectory(fd,temp)).toBe(0);expect(()=>native.publishDirectoryExclusive(fd,temp,name)).toThrow("PUBLISH_EXISTS");}expect(()=>native.publishDirectoryExclusive(fd,`.agentic-dir-${crypto.randomUUID()}`,"\ud800")).toThrow("PUBLISH_INVALID");}finally{closeSync(fd);await rm(dir,{recursive:true,force:true});}
});
test("folder execution holds the actual document barrier and workspace owner until one receipt settles",async()=>{
 const f=await fixture();const entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>();
 const barrier=f.documents.withCreateBarrier.bind(f.documents);
 f.documents.withCreateBarrier=action=>barrier(async()=>{entered.resolve();await resume.promise;return action();});
 try{const pending=f.create("held");await entered.promise;const slot=await f.workspace.createFolder({...env(),op:"state"});if(slot.status!=="state")throw Error();const receipt=await f.workspace.createFolder({...env(),op:"query",session:slot.session,sequence:slot.sequence});expect(receipt.status).toBe("pending");expect("working"in receipt&&receipt.working).toBe(true);expect((await f.documents.select(env())).ok).toBe(false);const s=await f.state(),md=await f.workspace.createMarkdown({...env(),op:"state"});if(md.status!=="state")throw Error();const blocked=await f.workspace.createMarkdown({...env(),op:"create",session:md.session,sequence:md.sequence,target:{rootHandle:s.roots[0].handle,generation:s.roots[0].generation},name:"blocked"});expect(blocked.status).toBe("rejected-before-create");resume.resolve();expect((await pending).response.status).toBe("created");expect((await readdir(f.dir)).includes("blocked.md")).toBe(false);}finally{resume.resolve();f.documents.withCreateBarrier=barrier;await f.dispose();}
});
test("published but never registered retries only location; postpublication replacement is never claimed",async()=>{
 for(const mode of ["postcheck","replace"]){let calls=0,fail=true,directory="";
 const injected=override({publishDirectoryExclusive(fd,src,dst){calls++;const result=native.publishDirectoryExclusive(fd,src,dst);if(mode==="replace"){renameSync(join(directory,dst),join(directory,"retained-original"));mkdirSync(join(directory,dst));}return result;},openDirectoryAt(fd,name){if(mode==="postcheck"&&name==="published"&&calls&&fail){fail=false;throw Error("Injected post-publish open failure");}return native.openDirectoryAt(fd,name);}});
 const f=await fixture(injected);directory=f.dir;
 try{const {request,response}=await f.create("published");expect(response.status).toBe("created");expect("entryHandle"in response&&response.entryHandle).toBeUndefined();const retry=await f.workspace.createFolder({...operationEnvelope(request),op:"retry-locate"});expect(retry.status).toBe("created");if(mode==="postcheck")expect("entryHandle"in retry&&retry.entryHandle).toBeString();else expect("entryHandle"in retry&&retry.entryHandle).toBeUndefined();expect(calls).toBe(1);expect(f.documents.locations()).toHaveLength(0);}finally{await f.dispose();}}
});
test("new empty folder is a valid subfolder target and disposing a parked creation prevents syscall",async()=>{
 let calls=0;const f=await fixture(override({createPrivateDirectory(fd,name){calls++;return native.createPrivateDirectory(fd,name);}}));
 try{const parent=await f.create("parent");expect(parent.response.status).toBe("created");await f.workspace.createFolder({...operationEnvelope(parent.request),op:"ack"});const node=(await f.nodes()).find(n=>n.name==="parent")!;const child=await f.create("child",node.handle);expect(child.response.status).toBe("created");expect(await readdir(join(f.dir,"parent"))).toEqual(["child"]);await f.workspace.createFolder({...operationEnvelope(child.request),op:"ack"});
 const entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>(),barrier=f.documents.withCreateBarrier.bind(f.documents);
 f.documents.withCreateBarrier=action=>barrier(async()=>{entered.resolve();await resume.promise;return action();});
 const pending=f.create("disposed");await entered.promise;const disposal=f.workspace.dispose();resume.resolve();const result=await pending;await disposal;expect(result.response.status).toBe("rejected-before-create");expect(calls).toBe(2);expect((await readdir(f.dir)).includes("disposed")).toBe(false);f.documents.withCreateBarrier=barrier;
 }finally{await f.dispose();}
});
test("real folder publication waits for an already admitted atomic save",async()=>{
 const entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>();let calls=0;
 const f=await fixture(override({createPrivateDirectory(fd,name){calls++;return native.createPrivateDirectory(fd,name);}}),{write:async input=>{entered.resolve();await resume.promise;return atomicSave(input);}});
 try{const selected=await f.documents.select(env());if(!selected.ok||!selected.snapshot)throw Error();const s=selected.snapshot;const saving=f.documents.save({...env(),handle:s.handle,documentId:s.documentId,expectedHash:s.hash,expectedRevision:s.revision,bufferRevision:1,mirror:s.mirror,content:{kind:"patch",...rawPatch("KEEP","SAVED"),targetHash:createHash("sha256").update("SAVED").digest("hex")}});await entered.promise;const pending=f.create("after-save");await Bun.sleep(20);expect(calls).toBe(0);resume.resolve();expect((await saving).ok).toBe(true);expect((await pending).response.status).toBe("created");expect(calls).toBe(1);expect(await readFile(join(f.dir,"cover.md"),"utf8")).toBe("SAVED");}finally{resume.resolve();await f.dispose();}
});
test("a reliable manual candidate revokes an exception even if its tree publication is cancelled",async()=>{
 const f=await fixture();try{const {request,response}=await f.create("owned");expect(response.status).toBe("created");await rename(join(f.dir,"owned"),join(f.dir,"retained"));const state=await f.state();const candidate=await f.workspace.reconciliation.prepare(state.roots[0].handle);expect(candidate.ok).toBe(true);if(!candidate.ok)throw Error();f.workspace.reconciliation.release(candidate.summary.token);await rename(join(f.dir,"retained"),join(f.dir,"owned"));const retry=await f.workspace.createFolder({...operationEnvelope(request),op:"retry-locate"});expect("entryHandle"in retry&&retry.entryHandle).toBeUndefined();await f.workspace.request({...env(),op:"rescan",root:state.roots[0].handle});expect((await f.nodes()).some(node=>node.name==="owned")).toBe(false);}finally{await f.dispose();}
});
test("necessary ancestor projected only by a descendant exception remains a valid creation target",async()=>{
 const f=await fixture();try{await mkdir(join(f.dir,"ancestor"));await writeFile(join(f.dir,"ancestor","old.md"),"TEMP");let state=await f.state();await f.workspace.request({...env(),op:"rescan",root:state.roots[0].handle});let ancestor=(await f.nodes()).find(node=>node.name==="ancestor")!;const child=await f.create("child",ancestor.handle);expect(child.response.status).toBe("created");await f.workspace.createFolder({...operationEnvelope(child.request),op:"ack"});await rm(join(f.dir,"ancestor","old.md"));state=await f.state();await f.workspace.request({...env(),op:"rescan",root:state.roots[0].handle});ancestor=(await f.nodes()).find(node=>node.name==="ancestor")!;expect(ancestor.kind).toBe("directory");const sibling=await f.create("sibling",ancestor.handle);expect(sibling.response.status).toBe("created");expect((await readdir(join(f.dir,"ancestor"))).sort()).toEqual(["child","sibling"]);}finally{await f.dispose();}
});
test("only ordinary directory queues are paused within the shared multi-root metadata budget",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"f057b-queue-budget-"));let selected=join(dir,"a");await mkdir(selected);await mkdir(join(dir,"b"));for(const root of ["a","b"])for(let i=0;i<100;i++)await mkdir(join(dir,root,`ordinary-${i}`));
 const documents=createDocumentService({pickFile:()=>Promise.resolve(null)}),workspace=createWorkspaceService({documents,pickDirectory:()=>Promise.resolve(selected),cacheLimit:4096});
 try{for(const name of ["a","b"]){selected=join(dir,name);await workspace.request({...env(),op:"select"});for(let i=0;i<100;i++){const state=await workspace.request({...env(),op:"state"});if(!state.ok||state.queueBytes===undefined)throw Error();expect(state.cacheBytes+state.queueBytes).toBeLessThanOrEqual(4096);if(state.roots.every(root=>root.status!=="scanning"))break;await Bun.sleep(3);}}const state=await workspace.request({...env(),op:"state"});if(!state.ok)throw Error();expect(state.roots).toHaveLength(2);expect(state.roots.every(root=>root.status==="paused")).toBe(true);expect(state.roots.every(root=>root.entries===0)).toBe(true);}finally{await workspace.dispose();await documents.dispose();await rm(dir,{recursive:true,force:true});}
});
