import { beforeAll, expect, spyOn, test } from "bun:test";
import { closeSync, openSync, renameSync, writeFileSync } from "node:fs";
import * as filesystem from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { markdownFileName, markdownNameKey, validCreateMarkdownResponse } from "../../shared/create-markdown";
import { createDocumentService } from "../documents";

import type { CreationNative } from "./create-markdown";

import { createWorkspaceService } from ".";

const envelope = () => ({protocolVersion: 1 as const, requestId: crypto.randomUUID()});
let native: CreationNative;
beforeAll(() => {
  const desktop = fileURLToPath(new URL("../../../", import.meta.url));
  expect(Bun.spawnSync([process.execPath, "scripts/build-save-native.ts"], {cwd: desktop}).exitCode).toBe(0);
  native = createRequire(import.meta.url)(join(desktop, "dist-native/save-primitives.node")) as CreationNative;
});
test("name rules preserve macOS components and the fixed finite comparison", () => {
  expect(markdownFileName("a")).toEqual({ok: true, name: "a.md"});
  expect(markdownFileName("a.markdown")).toEqual({ok: true, name: "a.markdown"});
  for (const name of ["", " ", ".", "..", ".git", "a.md ", "a/", "a\0b", "\ud800", "中".repeat(86)]) expect(markdownFileName(name).ok).toBe(false);
  for (const name of ["CON", "a:b", "a\\b", "中文😀"]) expect(markdownFileName(name).ok).toBe(true);
  expect(markdownNameKey("A.md")).toBe(markdownNameKey("a.md"));
  expect(markdownNameKey("é.md")).toBe(markdownNameKey("e\u0301.md"));
  expect(markdownNameKey("straße.md")).not.toBe(markdownNameKey("STRASSE.md"));
});
test("real native exclusive create reports precise conflict, rejects invalid UTF16, never overwrites", async () => {
  const dir = await mkdtemp(join(tmpdir(), "f057-native-")), fd = openSync(dir, "r");
  try {
    const f = native.createFileExclusive(fd, "中文.md"); closeSync(f);
    expect((await stat(join(dir, "中文.md"))).size).toBe(0);
    expect((await stat(join(dir, "中文.md"))).mode & 0o177).toBe(0);
    await writeFile(join(dir, "old.md"), "OLD"); await mkdir(join(dir, "folder.md")); await symlink("old.md", join(dir, "link.md"));
    for (const name of ["old.md", "folder.md", "link.md"]) expect(() => native.createFileExclusive(fd, name)).toThrow("CREATE_EXISTS");
    for (const name of ["", "..", "a/b", "x\0y", "\ud800", "\udc00", "中".repeat(86)]) expect(() => native.createFileExclusive(fd, name)).toThrow("CREATE_INVALID");
    expect(() => native.createFileExclusive(2147483647, "bad.md")).toThrow("CREATE_INVALID");
    expect(await readFile(join(dir, "old.md"), "utf8")).toBe("OLD"); expect(await readdir(dir)).toHaveLength(4);
  } finally {closeSync(fd); await rm(dir, {recursive: true, force: true});}
});
async function fixture(injected?: CreationNative, cacheLimit?: number) {
  const dir = await mkdtemp(join(tmpdir(), "f057-workspace-"));
  await writeFile(join(dir,"existing.md"), "KEEP");
  const documents = createDocumentService({pickFile: () => Promise.resolve(null)});
  const workspace = createWorkspaceService({documents, pickDirectory: () => Promise.resolve(dir), directoryNative: injected ?? native, cacheLimit});
  const selected = await workspace.request({...envelope(), op: "select"}); if (!selected.ok) throw Error();
  const root = selected.roots[0];
  for (let i=0;i<1000;i++) {const s=await workspace.request({...envelope(),op:"state"});if(s.ok&&s.roots[0].status!=="scanning")break;await Bun.sleep(2);}
  const state = await workspace.createMarkdown({...envelope(),op:"state"});if(state.status!=="state")throw Error();
  const operation={session:state.session,sequence:state.sequence},target={rootHandle:root.handle,generation:root.generation};
  return {dir,documents,workspace,operation,target,async dispose(){await workspace.dispose();await documents.dispose();await rm(dir,{recursive:true,force:true});}};
}
test("real workspace creates once, query preserves document identity, release and ack cannot revive", async () => {
  const f=await fixture();try {
    const request={...envelope(),...f.operation,op:"create" as const,target:f.target,name:"中文"};
    const opened=await f.workspace.createMarkdown(request);
    expect(validCreateMarkdownResponse(opened,request)).toBe(true);expect(opened.status).toBe("opened");if(!("snapshot" in opened)||!opened.snapshot)throw Error(JSON.stringify(opened));
    const id=opened.snapshot.documentId,handle=opened.snapshot.handle;
    expect(opened.snapshot.text).toBe("");expect((await stat(join(f.dir,"中文.md"))).size).toBe(0);
    const replay=await f.workspace.createMarkdown({...request,requestId:crypto.randomUUID()});expect("snapshot" in replay&&replay.snapshot?.documentId).toBe(id);
    expect((await f.workspace.createMarkdown({...request,name:"different"})).status).toBe("stale");
    expect((await f.workspace.createMarkdown({...request,target:{...f.target,generation:f.target.generation+1}})).status).toBe("stale");
    expect(f.documents.locations().filter(v=>v.handle===handle)).toHaveLength(1);
    const released=await f.workspace.createMarkdown({...envelope(),...f.operation,op:"release-unpresented"});expect(released).toMatchObject({status:"created",released:true});expect(f.documents.locations()).toHaveLength(0);
    expect(await f.workspace.createMarkdown({...envelope(),...f.operation,op:"retry-open"})).toMatchObject({status:"created",released:true});
    expect(await f.workspace.createMarkdown({...envelope(),...f.operation,op:"ack"})).toMatchObject({status:"acked"});
    expect(await f.workspace.createMarkdown({...envelope(),...f.operation,op:"query"})).toMatchObject({status:"acked"});
    expect(await f.workspace.createMarkdown({...envelope(),...f.operation,op:"ack"})).toMatchObject({status:"acked"});
    expect(await f.workspace.createMarkdown(request)).toMatchObject({status:"stale"});expect(await readdir(f.dir)).toHaveLength(2);
  }finally{await f.dispose();}
});
test("invalid native return is unknown, retains operation and never repeats create",async()=>{
 let calls=0;
 const injected:CreationNative={openDirectoryAt:(fd,name)=>native.openDirectoryAt(fd,name),scanOpen:fd=>native.scanOpen(fd),scanBatch:(cursor,limit)=>native.scanBatch(cursor,limit),scanClose:cursor=>native.scanClose(cursor),createFileExclusive(){calls++;return Number.NaN;}};
 const f=await fixture(injected);try{
  const req={...envelope(),...f.operation,op:"create" as const,target:f.target,name:"unknown"};
  expect((await f.workspace.createMarkdown(req)).status).toBe("unknown");expect((await f.workspace.createMarkdown(req)).status).toBe("unknown");expect((await f.workspace.createMarkdown({...envelope(),...f.operation,op:"ack"})).status).toBe("unknown");expect(calls).toBe(1);
 }finally{await f.dispose();}
});
test("unacknowledged folder-removal receipt blocks creation after its fence released",async()=>{
 const f=await fixture();try{
  const state=await f.workspace.removeFolderRoot({...envelope(),op:"state"});if(state.status!=="state")throw Error();
  const op={session:state.session,sequence:state.sequence,root:f.target.rootHandle};
  expect((await f.workspace.removeFolderRoot({...envelope(),...op,op:"prepare",generation:f.target.generation,documents:[]})).status).toBe("issued");
  expect((await f.workspace.removeFolderRoot({...envelope(),...op,op:"cancel"})).status).toBe("rejected");
  const result=await f.workspace.createMarkdown({...envelope(),...f.operation,op:"create",target:f.target,name:"not-created"});expect(result.status).toBe("rejected-before-create");expect(await readdir(f.dir)).toHaveLength(1);
 }finally{await f.dispose();}
});
test("conflict preview includes directories and case variants; create rejects without altering old content",async()=>{
 const f=await fixture();try{
  const preview=await f.workspace.createMarkdown({...envelope(),op:"preview",target:f.target,name:"EXISTING.md",previewId:"p1"});expect(preview).toMatchObject({status:"preview",result:"conflict"});
  const r=await f.workspace.createMarkdown({...envelope(),...f.operation,op:"create",target:f.target,name:"EXISTING.md"});expect(r.status).toBe("rejected-before-create");expect(await readFile(join(f.dir,"existing.md"),"utf8")).toBe("KEEP");expect(await readdir(f.dir)).toHaveLength(1);
 }finally{await f.dispose();}
});
test("injected post-open identity failure preserves file and never creates again",async()=>{
 let calls=0;const injected={...native,openDirectoryAt:(fd:number,name:string)=>native.openDirectoryAt(fd,name),scanOpen:(fd:number)=>native.scanOpen(fd),scanBatch:(cursor:object,limit:number)=>native.scanBatch(cursor,limit),scanClose:(cursor:object)=>native.scanClose(cursor),createFileExclusive(fd:number,name:string){calls++;const file=native.createFileExclusive(fd,name);closeSync(file);throw Object.assign(Error("after-open"),{code:"CREATED_IDENTITY_UNKNOWN"});}};
 const f=await fixture(injected);try{
  const req={...envelope(),...f.operation,op:"create" as const,target:f.target,name:"retained"};
  expect((await f.workspace.createMarkdown(req)).status).toBe("created");expect((await f.workspace.createMarkdown(req)).status).toBe("created");expect((await f.workspace.createMarkdown({...envelope(),...f.operation,op:"retry-open"})).status).toBe("created");expect(calls).toBe(1);expect((await stat(join(f.dir,"retained.md"))).size).toBe(0);
 }finally{await f.dispose();}
});
test("actual replacement after create is not accepted; restoring original identity permits only open retry",async()=>{
 let calls=0,dir="";
 const injected:CreationNative={openDirectoryAt:(fd,name)=>native.openDirectoryAt(fd,name),scanOpen:fd=>native.scanOpen(fd),scanBatch:(cursor,limit)=>native.scanBatch(cursor,limit),scanClose:cursor=>native.scanClose(cursor),createFileExclusive(fd,name){calls++;const file=native.createFileExclusive(fd,name);renameSync(join(dir,name),join(dir,"retained-original"));writeFileSync(join(dir,name),"OUTSIDE");return file;}};
 const f=await fixture(injected);dir=f.dir;
 try{
  const req={...envelope(),...f.operation,op:"create" as const,target:f.target,name:"new"};
  expect((await f.workspace.createMarkdown(req)).status).toBe("created");expect(f.documents.locations()).toHaveLength(0);expect(await readFile(join(dir,"new.md"),"utf8")).toBe("OUTSIDE");
  expect((await f.workspace.createMarkdown({...envelope(),...f.operation,op:"retry-open"})).status).toBe("created");
  renameSync(join(dir,"new.md"),join(dir,"retained-replacement"));renameSync(join(dir,"retained-original"),join(dir,"new.md"));
  expect((await f.workspace.createMarkdown({...envelope(),...f.operation,op:"retry-open"})).status).toBe("opened");expect(calls).toBe(1);expect(f.documents.locations()).toHaveLength(1);
 }finally{await f.dispose();}
});
test("fstat failure after a real returned fd retains created without claiming identity",async()=>{
 let calls=0;
 const injected:CreationNative={openDirectoryAt:(fd,name)=>native.openDirectoryAt(fd,name),scanOpen:fd=>native.scanOpen(fd),scanBatch:(cursor,limit)=>native.scanBatch(cursor,limit),scanClose:cursor=>native.scanClose(cursor),createFileExclusive(fd,name){calls++;const file=native.createFileExclusive(fd,name);closeSync(file);return file;}};
 const f=await fixture(injected);try{
  const req={...envelope(),...f.operation,op:"create" as const,target:f.target,name:"closed-fd"};
  expect((await f.workspace.createMarkdown(req)).status).toBe("created");expect((await f.workspace.createMarkdown({...envelope(),...f.operation,op:"retry-open"})).status).toBe("created");expect(calls).toBe(1);expect((await stat(join(f.dir,"closed-fd.md"))).size).toBe(0);expect(f.documents.locations()).toHaveLength(0);
 }finally{await f.dispose();}
});
test("actual creation controller preserves created on sync or cleanup failure",async()=>{
 for(const phase of ["sync","close"] as const){
  let createdFd=-1,calls=0;
  const injected:CreationNative={openDirectoryAt:(fd,name)=>native.openDirectoryAt(fd,name),scanOpen:fd=>native.scanOpen(fd),scanBatch:(cursor,limit)=>native.scanBatch(cursor,limit),scanClose:cursor=>native.scanClose(cursor),createFileExclusive(fd,name){calls++;createdFd=native.createFileExclusive(fd,name);return createdFd;}};
  const f=await fixture(injected);const realSync=filesystem.fsyncSync,realClose=filesystem.closeSync;let attempts=0;
  const hook=phase==="sync"?spyOn(filesystem,"fsyncSync").mockImplementation(fd=>{if(fd===createdFd)throw Error("injected real caller sync failure");realSync(fd);}):spyOn(filesystem,"closeSync").mockImplementation(fd=>{realClose(fd);if(fd===createdFd){attempts++;throw Error("injected post-close failure report");}});
  try{
   const req={...envelope(),...f.operation,op:"create" as const,target:f.target,name:phase};expect((await f.workspace.createMarkdown(req)).status).toBe("created");expect((await f.workspace.createMarkdown(req)).status).toBe("created");expect(calls).toBe(1);expect((await stat(join(f.dir,`${phase}.md`))).size).toBe(0);expect(f.documents.locations()).toHaveLength(0);if(phase==="close")expect(attempts).toBe(1);
  }finally{hook.mockRestore();await f.dispose();}
 }
});
test("cancelled asynchronous directory preview cannot publish an available result",async()=>{
 const f=await fixture();try{
  await Promise.all(Array.from({length:140},(_,i)=>writeFile(join(f.dir,`other-${i}`),"")));
  const pending=f.workspace.createMarkdown({...envelope(),op:"preview",target:f.target,name:"candidate",previewId:"cancel-me"});
  await f.workspace.createMarkdown({...envelope(),op:"cancel-preview",previewId:"cancel-me"});
  expect(await pending).toMatchObject({status:"preview",result:"unavailable"});expect(await readdir(f.dir)).toHaveLength(141);
 }finally{await f.dispose();}
});
test("tree budget refusal retains disk creation and does not pretend a located node or open grant",async()=>{
 const f=await fixture(undefined,256);try{
  const name="n".repeat(200),reply=await f.workspace.createMarkdown({...envelope(),...f.operation,op:"create",target:f.target,name});expect(reply.status).toBe("created");expect("entryHandle" in reply&&reply.entryHandle).toBeUndefined();expect(f.documents.locations()).toHaveLength(0);expect((await stat(join(f.dir,`${name}.md`))).size).toBe(0);
 }finally{await f.dispose();}
});
test("old root generation never creates against a new scan generation",async()=>{
 const f=await fixture();try{
  await f.workspace.request({...envelope(),op:"rescan",root:f.target.rootHandle});
  const result=await f.workspace.createMarkdown({...envelope(),...f.operation,op:"create",target:f.target,name:"stale"});expect(result.status).toBe("rejected-before-create");expect(await readdir(f.dir)).toHaveLength(1);
 }finally{await f.dispose();}
});
test("every retry rechecks equivalent-name conflicts before opening the original created file",async()=>{
 let calls=0,conflict=true,created=false;
 const injected:CreationNative={openDirectoryAt:(fd,name)=>native.openDirectoryAt(fd,name),scanOpen:fd=>native.scanOpen(fd),scanBatch(cursor,limit){const batch=native.scanBatch(cursor,limit);return created&&conflict&&batch.done?{...batch,names:[...batch.names,"NEW.md"]}:batch;},scanClose:cursor=>native.scanClose(cursor),createFileExclusive(fd,name){calls++;const file=native.createFileExclusive(fd,name);created=true;return file;}};
 const f=await fixture(injected);try{
  expect((await f.workspace.createMarkdown({...envelope(),...f.operation,op:"create",target:f.target,name:"new"})).status).toBe("created");
  expect((await f.workspace.createMarkdown({...envelope(),...f.operation,op:"retry-open"})).status).toBe("created");expect(f.documents.locations()).toHaveLength(0);
  conflict=false;expect((await f.workspace.createMarkdown({...envelope(),...f.operation,op:"retry-open"})).status).toBe("opened");expect(calls).toBe(1);
 }finally{await f.dispose();}
});
test("closed or revoked created grants cannot be resurrected by query or old retry",async()=>{
 const f=await fixture();try{
  const opened=await f.workspace.createMarkdown({...envelope(),...f.operation,op:"create",target:f.target,name:"closed"});if(!("snapshot"in opened)||!opened.snapshot)throw Error();
  expect(await f.documents.release({...envelope(),handle:opened.snapshot.handle})).toMatchObject({ok:true});
  expect(await f.workspace.createMarkdown({...envelope(),...f.operation,op:"query"})).toMatchObject({status:"created",released:true});
  expect(await f.workspace.createMarkdown({...envelope(),...f.operation,op:"retry-open"})).toMatchObject({status:"created",released:true});expect(f.documents.locations()).toHaveLength(0);expect(await readdir(f.dir)).toHaveLength(2);
 }finally{await f.dispose();}
});
