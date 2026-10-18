import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname,join } from "node:path";

import { resolveSaveWorkerEntry } from "./atomic-save";
import { authorizeSingleFile,verifySingleFileAuthorization,fileFingerprint,type SingleFileAuthorization } from "./path-authorization";

export type TrashInput=Omit<SingleFileAuthorization,"file">;
export type TrashResult={status:"trashed";resultPath:string}|{status:"failed"}|{status:"unknown";platformSucceeded:boolean};
export interface TrashNative {trashReferencedFile(path:string,fingerprint:string,fd:number,directories:TrashInput["directories"],output:Buffer):number}
export async function runTrash(input:TrashInput,native?:TrashNative):Promise<TrashResult>{
 const output=Buffer.alloc(4105);let held:SingleFileAuthorization|undefined;const parents:FileHandle[]=[];
 try{
  held=await authorizeSingleFile(input.selectedPath);
  if(held.path!==input.path||held.fingerprint!==input.fingerprint||JSON.stringify(held.directories)!==JSON.stringify(input.directories))return {status:"failed"};
  await verifySingleFileAuthorization(held);
  for(const directory of input.directories){const fd=await open(directory.path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);parents.push(fd);const stat=await fd.stat({bigint:true});if(!stat.isDirectory()||fileFingerprint(stat)!==directory.fingerprint)return {status:"failed"};}
  await verifySingleFileAuthorization(held);
  const entry=resolveSaveWorkerEntry(import.meta.dir);if(!native){native=createRequire(import.meta.url)(join(entry?dirname(entry):import.meta.dir,"trash-primitives.node")) as TrashNative;}
  const code=native.trashReferencedFile(input.path,input.fingerprint,held.file.fd,input.directories.map((item,index)=>({...item,fd:parents[index].fd})),output),stage=output.readUInt32LE(0),length=output.readUInt32LE(4);
  if(code===1&&stage===3&&length>0&&length<=4096){const resultPath=output.subarray(8,8+length).toString("utf8");if(resultPath.startsWith("/")&&!resultPath.includes("\0"))return {status:"trashed",resultPath};}
  if(code===0&&(stage===0||stage===4))return {status:"failed"};
  return {status:"unknown",platformSucceeded:stage===2||stage===3};
 }catch{return output.readUInt32LE(0)===0?{status:"failed"}:{status:"unknown",platformSucceeded:[2,3].includes(output.readUInt32LE(0))};}
 finally{for(const parent of parents)await parent.close().catch(()=>undefined);await held?.file.close().catch(()=>undefined);}
}
