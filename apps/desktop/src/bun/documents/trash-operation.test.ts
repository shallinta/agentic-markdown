import { expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { authorizeSingleFile, fileFingerprint } from "./path-authorization";
import { trashFile } from "./trash-file";
import { runTrash, type TrashInput, type TrashNative } from "./trash-operation";

async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),"agentic-f059a-formal-")),path=join(dir,"self-created.md");
 await writeFile(path,"F059a self-created test material\n");
 const a=await authorizeSingleFile(path);await a.file.close();
 const input:TrashInput={path:a.path,selectedPath:a.selectedPath,selectedParent:a.selectedParent,fingerprint:a.fingerprint,directories:a.directories};
 return {dir,path,input};
}
test("actual Node-API worker moves only its self-created fixture and preserves identity and bytes",async()=>{
 const f=await fixture(),before=await readFile(f.path);
 const result=await trashFile(f.input);expect(result.status).toBe("trashed");
 if(result.status!=="trashed")throw Error("No successful receipt");
 expect(await readFile(result.resultPath)).toEqual(before);
 expect(fileFingerprint(await lstat(result.resultPath,{bigint:true}))).toBe(f.input.fingerprint);
 expect(await lstat(f.path).then(()=>true,()=>false)).toBe(false);
 console.info("F059a self-created Trash material retained",JSON.stringify({fixture:f.dir,resultPath:result.resultPath}));
});
test("native stage evidence survives injected post-YES exception and undefined result is not NO",async()=>{
 const f=await fixture();
 const inject=(stage:number,throws=false):TrashNative=>({trashReferencedFile(_path,_proof,_fd,_directories,buffer){buffer.writeUInt32LE(stage);if(throws)throw Error("Injected after-stage failure");return undefined as unknown as number;}});
 expect(await runTrash(f.input,inject(2,true))).toEqual({status:"unknown",platformSucceeded:true});
 expect(await runTrash(f.input,inject(0))).toEqual({status:"unknown",platformSucceeded:false});
 expect(await readFile(f.path,"utf8")).toContain("self-created");
});
test("pre-dispatch replacement rejects without invoking native",async()=>{
 const f=await fixture();let calls=0;
 const result=await runTrash({...f.input,fingerprint:"0:0:0"},{trashReferencedFile(){calls++;return 0;}});
 expect(result.status).toBe("failed");expect(calls).toBe(0);expect(await readFile(f.path,"utf8")).toContain("self-created");
});
test("injected platform NO is explicit failed and leaves original bytes",async()=>{
 const f=await fixture();let calls=0;
 expect(await runTrash(f.input,{trashReferencedFile(_p,_f,_d,_a,output){calls++;output.writeUInt32LE(4);return 0;}})).toEqual({status:"failed"});
 expect(calls).toBe(1);expect(await readFile(f.path,"utf8")).toContain("self-created");
});
