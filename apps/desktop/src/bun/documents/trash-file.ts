import { dirname,join } from "node:path";

import { resolveSaveWorkerEntry } from "./atomic-save";
import type { TrashInput,TrashResult } from "./trash-operation";

export function trashFile(input:TrashInput):Promise<TrashResult>{
 const entry=resolveSaveWorkerEntry(import.meta.dir);if(!entry)return Promise.resolve({status:"failed"});
 return new Promise(resolve=>{
  let worker:Worker;try{worker=new Worker(join(dirname(entry),"trash-worker.js"));}catch{resolve({status:"failed"});return;}
  let done=false;const finish=(result:TrashResult)=>{if(done)return;done=true;resolve(result);};
  worker.onmessage=(event:MessageEvent<unknown>)=>{
    const result=event.data;
    if(result&&typeof result==="object"&&"status"in result){
      if(result.status==="failed")finish({status:"failed"});
      else if(result.status==="trashed"&&"resultPath"in result&&typeof result.resultPath==="string"&&result.resultPath.startsWith("/")&&result.resultPath.length<=4096&&!result.resultPath.includes("\0"))finish({status:"trashed",resultPath:result.resultPath});
      else finish({status:"unknown",platformSucceeded:"platformSucceeded"in result&&result.platformSucceeded===true});
    }else finish({status:"unknown",platformSucceeded:false});
    worker.terminate();
  };
  worker.onerror=()=>finish({status:"unknown",platformSucceeded:false});
  try{worker.postMessage(input);}catch{finish({status:"unknown",platformSucceeded:false});}
 });
}
