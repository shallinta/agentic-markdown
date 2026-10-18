import { closeSync, constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname,join } from "node:path";

import { verifyRoot } from "../workspace/authorization";
import { openDirectoryDescriptor, type DirectoryNative } from "../workspace/directory-descriptor";

import { resolveSaveWorkerEntry } from "./atomic-save";
import { authorizeSingleFile,verifySingleFileAuthorization,fileFingerprint,type SingleFileAuthorization } from "./path-authorization";

export type TrashInput=Omit<SingleFileAuthorization,"file">&{kind?:"directory"};
export type TrashResult={status:"trashed";resultPath:string}|{status:"failed"}|{status:"unknown";platformSucceeded:boolean};
export interface TrashNative {trashReferencedFile(path:string,fingerprint:string,fd:number,directories:TrashInput["directories"],output:Buffer,kind?:"directory"):number}
export async function runTrash(input:TrashInput,native?:TrashNative):Promise<TrashResult>{
 const output=Buffer.alloc(4105);let held:SingleFileAuthorization|undefined,directoryFd:number|undefined;const parents:FileHandle[]=[];
 try{
  const entry=resolveSaveWorkerEntry(import.meta.dir),resource=entry?dirname(entry):import.meta.dir;
  if(input.kind==="directory"){
   if(input.directories.length>256||input.directories[input.directories.length-1]?.path!==input.path||input.directories[input.directories.length-1]?.fingerprint!==input.fingerprint)return {status:"failed"};
   const root={path:input.path,directories:input.directories};await verifyRoot(root);
   const directoryNative=createRequire(import.meta.url)(join(resource,"save-primitives.node")) as DirectoryNative;
   directoryFd=openDirectoryDescriptor(root,{path:input.path,chain:[]},directoryNative);await verifyRoot(root);
  }else{
   held=await authorizeSingleFile(input.selectedPath);
   if(held.path!==input.path||held.fingerprint!==input.fingerprint||JSON.stringify(held.directories)!==JSON.stringify(input.directories))return {status:"failed"};
   await verifySingleFileAuthorization(held);
  }
  for(const directory of input.directories){const fd=await open(directory.path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);parents.push(fd);const stat=await fd.stat({bigint:true});if(!stat.isDirectory()||fileFingerprint(stat)!==directory.fingerprint)return {status:"failed"};}
  if(held)await verifySingleFileAuthorization(held);else await verifyRoot({path:input.path,directories:input.directories});
  if(!native){native=createRequire(import.meta.url)(join(resource,"trash-primitives.node")) as TrashNative;}
  const args=[input.path,input.fingerprint,directoryFd??held!.file.fd,input.directories.map((item,index)=>({...item,fd:parents[index].fd})),output] as const;
  const code=input.kind==="directory"?native.trashReferencedFile(...args,"directory"):native.trashReferencedFile(...args),stage=output.readUInt32LE(0),length=output.readUInt32LE(4);
  if(code===1&&stage===3&&length>0&&length<=4096){const resultPath=output.subarray(8,8+length).toString("utf8");if(resultPath.startsWith("/")&&!resultPath.includes("\0"))return {status:"trashed",resultPath};}
  if(code===0&&(stage===0||stage===4))return {status:"failed"};
  return {status:"unknown",platformSucceeded:stage===2||stage===3};
 }catch{return output.readUInt32LE(0)===0?{status:"failed"}:{status:"unknown",platformSucceeded:[2,3].includes(output.readUInt32LE(0))};}
 finally{for(const parent of parents)await parent.close().catch(()=>undefined);await held?.file.close().catch(()=>undefined);if(directoryFd!==undefined)try{closeSync(directoryFd);}catch{/* Cleanup must not erase platform evidence. */}}
}
