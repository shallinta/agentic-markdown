import { expect, spyOn, test } from "bun:test";

import { analyzeTextFidelity } from "../shared/text-fidelity";
import type { WorkspaceNode, WorkspaceRoot } from "../shared/workspace";

import { createDocumentController } from "./documents";
import { createQuickOpen } from "./quick-open";
import { compareScore, matchField, normalizeQuery } from "./quick-open-match";
import { createFolderWorkspace } from "./workspace";
import { createWorkspaceRootOrder } from "./workspace-root-order";

test("frozen matching oracles preserve grades, fields and Unicode policy",()=>{
 const score=(q:string,s:string,field=0)=>matchField(Array.from(normalizeQuery(q)!),s,field)!;
 expect(score("note.md","note.md")[0]).toBe(0);expect(score("note.md","note.md.bak")[0]).toBe(1);expect(score("note.md","n-o-t-e.md")[0]).toBe(2);
 expect(compareScore(score("note","note-extra.md"),score("note","note/other.md",1))).toBeLessThan(0);
 expect(compareScore(score("note.md","note.md",1),score("note.md","note.md-extra.md"))).toBeLessThan(0);
 expect(compareScore(score("ab","xa-b.md"),score("ab","xa---b.md"))).toBeLessThan(0);
 expect(score(" CAFÉ ","Cafe\u0301.md")[0]).toBe(1);expect(score("😀文","😀中文.md")[0]).toBe(2);
 expect(score("😀文","文😀.md")).toBeNull();expect(score("strasse","Straße.md")).toBeNull();expect(normalizeQuery("x".repeat(4097))).toBeNull();
});
async function fixture(count=300){
 const root:WorkspaceRoot={handle:"root",name:"根",displayPath:"/root",generation:1,status:"complete",examined:count,errors:0,entries:count};
 let roots=[root],hold:Promise<void>|undefined,covered:string[]=[];
 const nodes:WorkspaceNode[]=Array.from({length:count},(_,i)=>({handle:`n${i}`,name:`note${i}.md`,parent:root.handle,kind:"file",displayPath:`/root/note${i}.md`}));
 const folders=createFolderWorkspace(async request=>{
  if(hold)await hold;
  const base={protocolVersion:1 as const,requestId:request.requestId,ok:true as const,roots,coveredHandles:covered,cacheBytes:0};
  if(request.op!=="page")return base;
  const start=request.cursor??0,next=Math.min(start+128,nodes.length);
  return {...base,root:roots[0].handle,generation:roots[0].generation,nodes:nodes.slice(start,next),nextCursor:next};
 });
 const original={handle:crypto.randomUUID(),documentId:crypto.randomUUID(),fileName:"standalone.md",displayPath:"/standalone.md",text:"original",byteLength:8,revision:1,hash:"a".repeat(64),fidelity:analyzeTextFidelity("original"),writeCapability:{writable:true,reason:"writable" as const}};
 let opens=0,settleHold:Promise<void>|undefined;
 const documents=createDocumentController({selectDocument:r=>Promise.resolve({...r,ok:true,snapshot:original}),readDocument:r=>Promise.resolve({...r,ok:true,snapshot:original}),cancelDocument:()=>Promise.resolve(),releaseDocument:r=>Promise.resolve({...r,ok:true,snapshot:null}),saveDocument:()=>Promise.reject(Error("injected save transport failure")),waitForDocumentSaves:async r=>{await settleHold;return {...r,settled:true};},openWorkspaceDocument:r=>{opens++;return Promise.resolve({...r,ok:true,snapshot:{...original,handle:crypto.randomUUID(),documentId:crypto.randomUUID(),fileName:"opened.md",displayPath:nodes.find(n=>n.handle===r.entry)?.displayPath}});}});
 await folders.refresh();await documents.select();const order=createWorkspaceRootOrder();const quick=createQuickOpen(folders,documents,order);
 return {quick,folders,documents,original,order,nodes,covered:(v:string[])=>{covered=v;},opens:()=>opens,settle:(p:Promise<void>)=>{settleHold=p;},hold:(p:Promise<void>|undefined)=>{hold=p;},roots:(value:WorkspaceRoot[])=>{roots=value;},dispose(){quick.dispose();folders.dispose();documents.dispose();}};
}
async function settled(q:ReturnType<typeof createQuickOpen>){for(let i=0;i<100&&q.getSnapshot().searching;i++)await Bun.sleep(2);expect(q.getSnapshot().searching).toBe(false);}
test("confirmed existing document focuses once only after its matching scope closes, preserving editor state",async()=>{
 const f=await fixture(1);try{let focuses=0;const editor=f.documents.getEditor(f.original.documentId)!;
  f.documents.updateEditor(f.original.documentId,editor.state.update({changes:{from:0,insert:"dirty"},selection:{anchor:2,head:4}}));
  const before=f.documents.getEditor(f.original.documentId)!.state;
  const release=f.documents.registerQuickFocusTarget({documentId:f.original.documentId,ready:()=>true,focus:()=>{focuses++;}});
  f.quick.open();const scope=f.quick.getSnapshot().scope;f.quick.setQuery("standalone");await settled(f.quick);await f.quick.choose();expect(focuses).toBe(0);
  f.quick.scopeClosed(scope-1);expect(focuses).toBe(0);f.quick.scopeClosed(scope);f.quick.scopeClosed(scope);expect(focuses).toBe(1);
  expect(f.documents.getEditor(f.original.documentId)!.state).toBe(before);expect(f.documents.getSaveStatus(f.original.documentId).status).toBe("dirty");release();
 }finally{f.dispose();}
});
test("focus joins delayed view registration, while composition rejection and reopening terminate old tickets",async()=>{
 const f=await fixture(1);try{let focuses=0;
  f.quick.open();f.quick.setQuery("standalone");await settled(f.quick);const scope=f.quick.getSnapshot().scope;const chosen=f.quick.choose();f.quick.scopeClosed(scope);await chosen;
  const release=f.documents.registerQuickFocusTarget({documentId:f.original.documentId,ready:()=>false,focus:()=>{focuses++;}});release();
  const ready=f.documents.registerQuickFocusTarget({documentId:f.original.documentId,ready:()=>true,focus:()=>{focuses++;}});expect(focuses).toBe(0);ready();
  f.quick.open();f.quick.setQuery("standalone");await settled(f.quick);await f.quick.choose();const old=f.quick.getSnapshot().scope;f.quick.open();f.quick.scopeClosed(old);
  const later=f.documents.registerQuickFocusTarget({documentId:f.original.documentId,ready:()=>true,focus:()=>{focuses++;}});expect(focuses).toBe(0);later();
  f.quick.close();
 }finally{f.dispose();}
});
test("asynchronous new open never focuses the old view and waits for its own mounted target",async()=>{
 const f=await fixture(1);try{let oldFocus=0,newFocus=0;
  const old=f.documents.registerQuickFocusTarget({documentId:f.original.documentId,ready:()=>true,focus:()=>{oldFocus++;}});
  f.quick.open();f.quick.setQuery("note");await settled(f.quick);const scope=f.quick.getSnapshot().scope;
  const opening=f.quick.choose();f.quick.scopeClosed(scope);await opening;expect(oldFocus).toBe(0);
  const id=f.documents.getSnapshot().snapshot!.documentId;expect(id).not.toBe(f.original.documentId);
  const target=f.documents.registerQuickFocusTarget({documentId:id,ready:()=>true,focus:()=>{newFocus++;}});old();
  expect(newFocus).toBe(1);f.quick.scopeClosed(scope);expect(newFocus).toBe(1);target();
 }finally{f.dispose();}
});
test("switching away and back revokes a successful ticket still waiting for a view",async()=>{
 const f=await fixture(1);try{let focuses=0;
  f.quick.open();f.quick.setQuery("note");await settled(f.quick);const scope=f.quick.getSnapshot().scope;await f.quick.choose();f.quick.scopeClosed(scope);
  const id=f.documents.getSnapshot().snapshot!.documentId;f.documents.activateTab(f.original.documentId);f.documents.activateTab(id);
  const release=f.documents.registerQuickFocusTarget({documentId:id,ready:()=>true,focus:()=>{focuses++;}});expect(focuses).toBe(0);release();
 }finally{f.dispose();}
});
test("late input blocking consumes a focus ticket instead of restoring it when unblocked",async()=>{
 const f=await fixture(1);try{let focuses=0;const release=f.documents.registerQuickFocusTarget({documentId:f.original.documentId,ready:()=>true,focus:()=>{focuses++;}});
  f.quick.open();f.quick.setQuery("standalone");await settled(f.quick);const scope=f.quick.getSnapshot().scope;await f.quick.choose();f.documents.setEditorInputBlocked(true);f.quick.scopeClosed(scope);f.documents.setEditorInputBlocked(false);f.quick.scopeClosed(scope);expect(focuses).toBe(0);release();
  f.quick.open();f.quick.setQuery("standalone");await settled(f.quick);const next=f.quick.getSnapshot().scope;await f.quick.choose();f.quick.dispose();f.quick.scopeClosed(next);
  const later=f.documents.registerQuickFocusTarget({documentId:f.original.documentId,ready:()=>true,focus:()=>{focuses++;}});expect(focuses).toBe(0);later();
 }finally{f.dispose();}
});
test("an already active snapshot cannot masquerade as successful admission after confirmation invalidates",async()=>{
 const f=await fixture(1);try{let focuses=0;const release=f.documents.registerQuickFocusTarget({documentId:f.original.documentId,ready:()=>true,focus:()=>{focuses++;}});
  f.quick.open();f.quick.setQuery("standalone");await settled(f.quick);const scope=f.quick.getSnapshot().scope;
  const unsub=f.quick.subscribe(()=>{if(!f.quick.getSnapshot().visible)f.folders.beginFolderRemoval();});await f.quick.choose();f.quick.scopeClosed(scope);expect(focuses).toBe(0);unsub();release();f.folders.cancelFolderRemoval();
 }finally{f.dispose();}
});
test("unchanged background refresh preserves the selected quick-open key without clearing results",async()=>{
 const f=await fixture(2);try{
  f.quick.open();f.quick.setQuery("note");await settled(f.quick);expect(f.quick.getSnapshot().results).toHaveLength(2);
  f.quick.move(1);const selected=f.quick.getSnapshot().results[1].key;
  const observations:{count:number;searching:boolean}[]=[];
  const unsubscribe=f.quick.subscribe(()=>observations.push({count:f.quick.getSnapshot().results.length,searching:f.quick.getSnapshot().searching}));
  try{await f.folders.refresh();await settled(f.quick);
   expect(f.quick.getSnapshot().results[f.quick.getSnapshot().active]?.key).toBe(selected);
   expect(observations.some(value=>value.count===0||value.searching)).toBe(false);
  }finally{unsubscribe();}
 }finally{f.dispose();}
});
test("full metadata not expanded rows, latest query only, independent root and dirty activation",async()=>{
 const f=await fixture();try{
  f.quick.open();expect(f.quick.getSnapshot().results).toHaveLength(0);f.quick.setQuery("note");f.quick.setQuery("note299");await settled(f.quick);expect(f.quick.getSnapshot().results.map(x=>x.name)).toEqual(["note299.md"]);
  const e=f.documents.getEditor(f.original.documentId)!;f.documents.updateEditor(f.original.documentId,e.state.update({changes:{from:8,insert:" dirty"}}));
  f.quick.setQuery("standalone");await settled(f.quick);await f.quick.choose();expect(f.quick.getSnapshot().visible).toBe(false);expect(f.documents.getSaveStatus(f.original.documentId).status).toBe("dirty");expect(f.documents.runHistory("undo")).toBe(true);expect(f.opens()).toBe(0);
 }finally{f.dispose();}
});
test("confirmed selection transfers once; ordinary close only cancels query",async()=>{
 const f=await fixture();try{f.quick.open();f.quick.setQuery("note299");await settled(f.quick);await f.quick.choose();expect(f.opens()).toBe(1);await f.quick.choose();expect(f.opens()).toBe(1);
 f.quick.open();f.quick.setQuery("note");f.quick.close();await Bun.sleep(15);expect(f.quick.getSnapshot().results).toHaveLength(0);expect(f.quick.getSnapshot().visible).toBe(false);
 }finally{f.dispose();}
});
test("background staging synchronously invalidates query and owns budget until settlement",async()=>{
 const f=await fixture();try{f.quick.open();f.quick.setQuery("note");await settled(f.quick);expect(f.quick.getSnapshot().results.length).toBe(300);
 const latch=Promise.withResolvers<void>();f.hold(latch.promise);const refresh=f.folders.prioritize("root","n0");await Bun.sleep(0);expect(f.quick.getSnapshot().results).toHaveLength(0);expect(f.folders.acquireQueryBudget(()=>undefined)).toBeNull();await f.quick.choose();expect(f.opens()).toBe(0);
 f.roots([]);f.hold(undefined);latch.resolve();await refresh;await settled(f.quick);expect(f.quick.getSnapshot().results).toHaveLength(0);
 }finally{f.dispose();}
});
test("metadata query reservations share the 4MiB model and removal invalidates before swap",async()=>{
 const f=await fixture(1);try{let cancelled=0;const lease=f.folders.acquireQueryBudget(()=>{cancelled++;});expect(lease).not.toBeNull();expect(lease!.reserve(4*1024*1024)).toBe(false);expect(lease!.reserve(1024)).toBe(true);expect(f.folders.beginFolderRemoval()).toBe(true);expect(cancelled).toBe(1);expect(lease!.current()).toBe(false);expect(f.folders.acquireQueryBudget(()=>undefined)).toBeNull();f.folders.cancelFolderRemoval();expect(f.folders.acquireQueryBudget(()=>undefined)).not.toBeNull();}finally{f.dispose();}
});
test("workspace open checks captured qualification again at the protected dispatch boundary",async()=>{
 const f=await fixture(1);try{let checks=0;await f.documents.openWorkspaceEntry("root","n0",()=>++checks===1);expect(checks).toBe(2);expect(f.opens()).toBe(0);}finally{f.dispose();}
});
test("long query rejects whole input; metadata error cannot expose stale selectable results",async()=>{
 const f=await fixture(1);try{f.quick.open();f.quick.setQuery("x".repeat(4097));expect(f.quick.getSnapshot().message).toContain("过长");expect(f.quick.getSnapshot().results).toHaveLength(0);
 f.quick.setQuery("note");await settled(f.quick);expect(f.quick.getSnapshot().results).toHaveLength(1);
 f.hold(Promise.reject(Error("test-metadata-error")));await f.folders.refresh().catch(()=>undefined);await Bun.sleep(0);expect(f.quick.getSnapshot().results).toHaveLength(0);expect(f.quick.getSnapshot().message).toContain("暂不可确认");
 }finally{f.dispose();}
});
test("matching ties follow window root display order without changing matching quality",async()=>{
 const f=await fixture(1);try{f.order.reconcile([`root:root`,`file:${f.original.documentId}`]);f.quick.open();f.quick.setQuery(".md");await settled(f.quick);
 expect(f.quick.getSnapshot().results).toHaveLength(2);f.order.moveBy(`file:${f.original.documentId}`,-1);await settled(f.quick);
 // Different match start/span retain quality ordering, regardless of root order.
 expect(f.quick.getSnapshot().results.map(r=>r.name)).toEqual(["note0.md","standalone.md"]);
 }finally{f.dispose();}
});
test("zero file candidates still reserve initial query against nearly full metadata",async()=>{
 const f=await fixture(0);const count=310;
 const root:WorkspaceRoot={handle:"large",name:"large",displayPath:"/large",generation:1,status:"complete",examined:count,errors:0,entries:count};
 const folders=createFolderWorkspace(r=>{const base={protocolVersion:1 as const,requestId:r.requestId,ok:true as const,roots:[root],coveredHandles:[],cacheBytes:0};if(r.op!=="page")return Promise.resolve(base);const n=r.cursor??0;return Promise.resolve({...base,root:root.handle,generation:1,nodes:[{handle:`d${n}`,parent:root.handle,kind:"directory" as const,name:"x".repeat(3000),displayPath:`/large/${n}${"x".repeat(3000)}`}],nextCursor:n+1});});
 await folders.refresh();const quick=createQuickOpen(folders,f.documents);
 try{expect(folders.getSnapshot().nodes.large).toHaveLength(count);quick.open();quick.setQuery("x".repeat(4096));expect(quick.getSnapshot().searching).toBe(false);expect(quick.getSnapshot().message).toContain("预算不足");expect(quick.getSnapshot().results).toHaveLength(0);}finally{quick.dispose();folders.dispose();f.dispose();}
});
test("cancel between consumed batches prevents old publication",async()=>{
 const f=await fixture(300),callbacks:(()=>void)[]=[];
 const timer=spyOn(globalThis,"setTimeout").mockImplementation(((fn:()=>void)=>{callbacks.push(fn);return 123;}) as typeof setTimeout);
 try{f.quick.open();f.quick.setQuery("note");callbacks.shift()!();expect(f.quick.getSnapshot().searching).toBe(true);expect(f.quick.getSnapshot().results).toHaveLength(0);
 f.quick.setQuery("standalone");for(let i=0;i<20&&callbacks.length;i++)callbacks.shift()!();expect(f.quick.getSnapshot().results.map(r=>r.name)).toEqual(["standalone.md"]);
 f.quick.setQuery("note");callbacks.shift()!();f.quick.close();while(callbacks.length)callbacks.shift()!();expect(f.quick.getSnapshot().results).toHaveLength(0);
 }finally{timer.mockRestore();f.dispose();}
});
test("background probe before protected dispatch invalidates captured open without state publication",async()=>{
 const f=await fixture(1),settle=Promise.withResolvers<void>(),refreshGate=Promise.withResolvers<void>();
 try{const editor=f.documents.getEditor(f.original.documentId)!;f.documents.updateEditor(f.original.documentId,editor.state.update({changes:{from:0,insert:"dirty"}}));await f.documents.save();f.settle(settle.promise);
 f.quick.open();f.quick.setQuery("note");await settled(f.quick);const before=f.folders.getSnapshot();const opening=f.quick.choose();await Bun.sleep(0);
 f.hold(refreshGate.promise);const refresh=f.folders.refresh();await Bun.sleep(0);expect(f.folders.getSnapshot()).toBe(before);expect(f.folders.queryAvailable()).toBe(false);
 settle.resolve();await opening;expect(f.opens()).toBe(0);expect(f.documents.getSnapshot().snapshot?.documentId).toBe(f.original.documentId);
 f.hold(undefined);refreshGate.resolve();await refresh;
 }finally{settle.resolve();refreshGate.resolve();f.dispose();}
});
test("save-drain protection without metadata changes permits the confirmed ordinary open",async()=>{
 const f=await fixture(1),settle=Promise.withResolvers<void>();try{
  const editor=f.documents.getEditor(f.original.documentId)!;f.documents.updateEditor(f.original.documentId,editor.state.update({changes:{from:0,insert:"dirty"}}));await f.documents.save();f.settle(settle.promise);
  f.quick.open();f.quick.setQuery("note");await settled(f.quick);const opening=f.quick.choose();await Bun.sleep(0);expect(f.opens()).toBe(0);settle.resolve();await opening;expect(f.opens()).toBe(1);
 }finally{settle.resolve();f.dispose();}
});
test("probe pauses results, resumes only the latest changed input, and never resumes a closed query",async()=>{
 const f=await fixture(2),gate=Promise.withResolvers<void>();try{
  f.quick.open();f.quick.setQuery("note");await settled(f.quick);f.quick.move(1);
  f.hold(gate.promise);const refresh=f.folders.refresh();await Bun.sleep(0);
  expect(f.quick.getSnapshot().results).toHaveLength(2);expect(f.quick.getSnapshot().active).toBe(1);
  await f.quick.choose();expect(f.opens()).toBe(0);
  f.quick.setQuery("note0");f.quick.setQuery("note1");expect(f.quick.getSnapshot().results).toHaveLength(0);
  f.hold(undefined);gate.resolve();await refresh;await settled(f.quick);expect(f.quick.getSnapshot().results.map(r=>r.name)).toEqual(["note1.md"]);
  const closed=Promise.withResolvers<void>();f.hold(closed.promise);const second=f.folders.refresh();await Bun.sleep(0);f.quick.setQuery("note");f.quick.close();f.hold(undefined);closed.resolve();await second;await Bun.sleep(5);
  expect(f.quick.getSnapshot().visible).toBe(false);expect(f.quick.getSnapshot().results).toHaveLength(0);
 }finally{gate.resolve();f.dispose();}
});
test("probe response shares existing query reservation and failure releases it without resuming",async()=>{
 const f=await fixture(1);try{
  let cancelled=0;const lease=f.folders.acquireQueryBudget(()=>{cancelled++;})!;
  const base=2*JSON.stringify(f.folders.getSnapshot()).length+128;
  expect(lease.reserve(4*1024*1024-base-1024)).toBe(true);
  const error=await f.folders.refresh().then(()=>null,(reason:unknown)=>reason);
  expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("workspace-probe-response-budget");
  expect(cancelled).toBe(1);expect(lease.current()).toBe(false);expect(f.folders.queryAvailable()).toBe(false);
  await f.folders.refresh();expect(f.folders.queryAvailable()).toBe(true);
  const next=f.folders.acquireQueryBudget(()=>undefined)!;expect(next.reserve(1024)).toBe(true);next.release();
 }finally{f.dispose();}
});
test("a partially consumed query resumes its paused cursor exactly once after unchanged probe",async()=>{
 const f=await fixture(300),gate=Promise.withResolvers<void>(),callbacks:(()=>void)[]=[];
 const timer=spyOn(globalThis,"setTimeout").mockImplementation(((fn:()=>void)=>{callbacks.push(fn);return 123;}) as typeof setTimeout);
 try{
  f.quick.open();f.quick.setQuery("note");callbacks.shift()!();expect(f.quick.getSnapshot().searching).toBe(true);
  f.hold(gate.promise);const refresh=f.folders.refresh();await Promise.resolve();await Promise.resolve();
  callbacks.shift()!();expect(callbacks).toHaveLength(0);expect(f.quick.getSnapshot().results).toHaveLength(0);
  f.hold(undefined);gate.resolve();await refresh;expect(callbacks).toHaveLength(1);
  while(callbacks.length)callbacks.shift()!();expect(f.quick.getSnapshot().results).toHaveLength(300);expect(f.quick.getSnapshot().searching).toBe(false);
 }finally{timer.mockRestore();gate.resolve();f.dispose();}
});
test("independent authorization is hidden only with both covered identity and visible file proof",async()=>{
 const f=await fixture(1);try{
 f.nodes[0]={...f.nodes[0],name:f.original.fileName,displayPath:f.original.displayPath};f.roots([{...f.folders.getSnapshot().roots[0],generation:2}]);await f.folders.refresh();f.quick.open();f.quick.setQuery("standalone");await settled(f.quick);expect(f.quick.getSnapshot().results).toHaveLength(2);
 f.covered([f.original.handle]);await f.folders.refresh();await settled(f.quick);expect(f.quick.getSnapshot().results).toHaveLength(1);
 f.roots([]);await f.folders.refresh();await settled(f.quick);expect(f.quick.getSnapshot().results).toHaveLength(1);expect(f.quick.getSnapshot().results[0].rootName).toBe("独立文件");
 }finally{f.dispose();}
});
test("same-generation appended files and hidden generation replace the query snapshot",async()=>{
 const f=await fixture(1);try{f.quick.open();f.quick.setQuery("note");await settled(f.quick);expect(f.quick.getSnapshot().results).toHaveLength(1);
 f.nodes.push({...f.nodes[0],handle:"n1",name:"note1.md",displayPath:"/root/note1.md"});f.roots([{...f.folders.getSnapshot().roots[0],entries:2}]);await f.folders.refresh();await settled(f.quick);expect(f.quick.getSnapshot().results).toHaveLength(2);
 f.nodes.splice(0,2);f.roots([{...f.folders.getSnapshot().roots[0],generation:2,showHidden:false,entries:0,status:"partial"}]);await f.folders.refresh();await settled(f.quick);expect(f.quick.getSnapshot().results).toHaveLength(0);expect(f.quick.getSnapshot().message).toContain("尚未完整扫描");
 }finally{f.dispose();}
});
