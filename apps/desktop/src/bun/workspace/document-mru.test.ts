import { expect,test } from "bun:test";
import { mkdtemp,rename,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentMRU } from "../document-mru";
import { createMRUService } from "../document-mru-service";
import { createDocumentService } from "../documents";

import { createWorkspaceService } from ".";

const env=()=>({protocolVersion:1 as const,requestId:crypto.randomUUID()});
test("aggregate resolve rejects an earlier grant released while a later verification waits",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mru-late-resolve-")),a=join(dir,"a.md"),b=join(dir,"b.md");await writeFile(a,"a");await writeFile(b,"b");const mru=createDocumentMRU(join(dir,"settings"));await mru.initialize();mru.bindWindow();mru.domReady();let path=a;
 const documents=createDocumentService({mru,pickFile:()=>Promise.resolve(path)}),workspace=createWorkspaceService({documents,pickDirectory:()=>Promise.resolve(null)}),service=createMRUService(mru,documents,workspace),entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>();
 try{const session=(await service.begin(env())).session,one=await documents.select(env());path=b;const two=await documents.select(env());if(!one.ok||!one.snapshot||!two.ok||!two.snapshot)throw Error();
 for(const [i,s] of [one.snapshot,two.snapshot].entries())await service.record({...env(),session,sequence:i+1,handle:s.handle,documentId:s.documentId});
 const original=documents.resolveMRUIndependent;let calls=0;documents.resolveMRUIndependent=async(e,c)=>{if(++calls===2){entered.resolve();await resume.promise;}return original(e,c);};
 const resolving=service.resolve({...env(),session,sequence:1});await entered.promise;await documents.release({...env(),handle:two.snapshot.handle});resume.resolve();expect((await resolving).items).toHaveLength(0);
 }finally{resume.resolve();await workspace.dispose();await documents.dispose();mru.dispose();await rm(dir,{recursive:true,force:true});}
});
test("MRU service resolves only current verified roots, hides replacements without deleting history",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mru-resolve-")),path=join(dir,"a.md");await writeFile(path,"a");const mru=createDocumentMRU(join(dir,"settings"));await mru.initialize();mru.bindWindow();mru.domReady();
 const documents=createDocumentService({mru,pickFile:()=>Promise.resolve(path)}),workspace=createWorkspaceService({documents,pickDirectory:()=>Promise.resolve(dir)}),service=createMRUService(mru,documents,workspace);
 try{const session=(await service.begin(env())).session,s=await documents.select(env());if(!s.ok||!s.snapshot)throw Error();
 expect((await service.record({...env(),session,sequence:1,handle:s.snapshot.handle,documentId:s.snapshot.documentId})).status).toBe("persisted");
 expect((await service.resolve({...env(),session,sequence:1})).items[0]).toMatchObject({kind:"standalone",handle:s.snapshot.handle});
 await workspace.request({...env(),op:"select"});for(let i=0;i<1000;i++){const state=await workspace.request({...env(),op:"state"});if(state.ok&&state.roots[0]?.status==="complete")break;await Bun.sleep(2);}
 const resolved=await service.resolve({...env(),session,sequence:2});expect(resolved.items).toHaveLength(1);expect(resolved.items[0].kind).toBe("root");
 const captured=await workspace.resolveMRU(mru.snapshot().entries,()=>undefined);const root=resolved.items[0];if(root.kind!=="root")throw Error();await workspace.request({...env(),op:"rescan",root:root.root});expect(()=>captured.current()).toThrow();
 await rename(path,join(dir,"old.md"));await writeFile(path,"new");expect((await service.resolve({...env(),session,sequence:3})).items).toHaveLength(0);expect(mru.snapshot().entries).toHaveLength(1);
 expect((await service.resolve({...env(),session,sequence:2})).items).toHaveLength(0);
 }finally{await workspace.dispose();await documents.dispose();mru.dispose();await rm(dir,{recursive:true,force:true});}
});
test("active ID collision uses a new ID and hides stale persisted MRU identity",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mru-collision-")),a=join(dir,"a.md"),b=join(dir,"b.md");await writeFile(a,"a");await writeFile(b,"b");const id=crypto.randomUUID();let path=a;
 const documents=createDocumentService({mru:{lookup:()=>id,migrate:()=>undefined},pickFile:()=>Promise.resolve(path)}),workspace=createWorkspaceService({documents,pickDirectory:()=>Promise.resolve(null)});
 try{const one=await documents.select(env());path=b;const two=await documents.select(env());if(!one.ok||!one.snapshot||!two.ok||!two.snapshot)throw Error();expect(one.snapshot.documentId).toBe(id);expect(two.snapshot.documentId).not.toBe(id);
 const captured=documents.captureMRU(two.snapshot.handle,two.snapshot.documentId);if(!captured)throw Error();expect((await workspace.resolveMRU([{...captured,documentId:id,rank:1}],()=>undefined)).items).toHaveLength(0);
 }finally{await workspace.dispose();await documents.dispose();await rm(dir,{recursive:true,force:true});}
});
