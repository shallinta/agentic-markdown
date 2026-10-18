import { randomUUID } from "node:crypto";
import { basename, dirname, relative } from "node:path";

import { markdownNameKey } from "../../shared/create-markdown";
import { validTrashRequest, type TrashRequest, type TrashResponse, type TrashTarget, type TrashPublication } from "../../shared/trash-document";
import type { TrustedDocumentService, FolderMutationLease, FolderGrantBinding } from "../documents";
import { trashFile } from "../documents/trash-file";
import type { TrashInput, TrashResult } from "../documents/trash-operation";

import { containsPath, verifyRoot } from "./authorization";

export interface TrashLease {
  input: TrashInput;
  current(): void;
  release(): void;
  reserveBindings?(bytes:number):void;
  publicationBytes?:number;
  publish(): {files: TrashPublication["files"]; effects():void};
}
interface Slot {
  sequence: number; target: TrashTarget; token: string;
  lease?: TrashLease; documents?: FolderMutationLease;
  input?: TrashInput; affected: TrashPublication["documents"];
  bindings?: readonly FolderGrantBinding[];
  status: "working"|"prepared"|"trashed"|"unknown"|"failed";
  working: boolean; dispatched: boolean; publication?: TrashPublication;
  platformSucceeded?: boolean; resultPath?: string;
  task?: Promise<void>;
}
export function createTrashService(host: {
  documents: TrustedDocumentService;
  acquire(target: TrashTarget): Promise<TrashLease>;
  run?: (input: TrashInput) => Promise<TrashResult>;
  receiptBytes?(bytes:number):void;
}) {
  const session=randomUUID();let sequence=1,slot:Slot|undefined,exiting=false,disposed=false;
  const isolated=(path:string,fingerprint?:string,directories?:TrashInput["directories"])=>{
    const s=slot;
    if(!s?.dispatched||s.status==="failed"||!s.input)return false;
    if(s.input.kind==="directory"){
      if(directories?.some(item=>item.fingerprint===s.input!.fingerprint)||fingerprint&&s.bindings?.some(item=>item.fingerprint===fingerprint))return true;
      let cursor=path;
      while(cursor!==dirname(cursor)){
        if(dirname(cursor)===dirname(s.input.path)&&markdownNameKey(basename(cursor))===markdownNameKey(basename(s.input.path)))return true;
        cursor=dirname(cursor);
      }
      return containsPath(s.input.path,path);
    }
    return !!fingerprint&&s.input.fingerprint===fingerprint || dirname(s.input.path)===dirname(path)&&markdownNameKey(basename(s.input.path))===markdownNameKey(basename(path));
  };
  const affectedBindings=async(s:Slot)=>{
    const result:FolderGrantBinding[]=[];let count=0,bytes=0;
    for(const binding of s.documents!.bindings()){
      const input=s.input!;
      if(input.kind==="directory"){
        const identity=binding.directories.some(item=>item.fingerprint===input.fingerprint);
        if(containsPath(input.path,binding.path)&&!identity)throw Error("Unproven descendant binding");
        if(identity){await verifyRoot({path:dirname(binding.path),directories:binding.directories});s.lease!.current();if(!s.documents!.current())throw Error("Lost binding proof");result.push(binding);}
      }else if(binding.path===input.path&&binding.fingerprint===input.fingerprint)result.push(binding);
      if(result.length>1024)throw Error("Too many affected bindings");
      if(result[result.length-1]===binding){bytes+=512+binding.path.length*4+binding.directories.reduce((sum,item)=>sum+256+item.path.length*4+item.fingerprint.length*4,0);s.lease!.reserveBindings?.(bytes);}
      if(++count%64===0){await new Promise(resolve=>setTimeout(resolve,0));s.lease!.current();if(!s.documents!.current())throw Error("Lost bindings");}
    }
    const receiptCost=bytes+2048+JSON.stringify(s.input).length*4+(s.lease!.publicationBytes??0);
    s.lease!.reserveBindings?.(receiptCost);host.receiptBytes?.(receiptCost);return result;
  };
  host.documents.setTrashGuard(isolated);
  const release=(s:Slot)=>{s.documents?.release();s.documents=undefined;s.lease?.release();s.lease=undefined;};
  const response=(r:TrashRequest):TrashResponse=>{
    const envelope={protocolVersion:1 as const,requestId:r.requestId,session,sequence:r.op==="state"?sequence:r.sequence};
    const s=slot;
    if(r.op==="state")return {...envelope,status:"state"};
    if(r.session!==session||r.sequence!==s?.sequence)return {...envelope,status:r.session===session&&r.sequence<sequence?"acked":"stale",working:false};
    if(s.status==="prepared"&&s.input)return {...envelope,status:"prepared",working:false,confirmationToken:s.token,canonicalPath:s.input.path,selectedPath:s.input.selectedPath,...(s.input.kind?{kind:s.input.kind}:{}),affected:s.bindings!.map(item=>({handle:item.handle,documentId:item.documentId,fileName:s.input!.kind==="directory"?(containsPath(s.input!.path,item.path)?relative(s.input!.path,item.path):item.path):basename(item.path)}))};
    if(s.status==="trashed"&&s.publication)return {...envelope,status:"trashed",working:false,publication:s.publication};
    return {...envelope,status:s.status==="prepared"?"working":s.status==="trashed"?"unknown":s.status,working:s.working,...(s.platformSucceeded?{message:"系统已确认移入废纸篓，窗口状态尚未完成收尾；不会重复移动。"}:{})};
  };
  async function prepare(s:Slot) {
    try {
      s.lease=await host.acquire(s.target);
      if(disposed||exiting||slot!==s)throw Error("Trash admission changed");
      s.documents=await host.documents.acquireFolderMutationLease()??undefined;
      if(!s.documents)throw Error("Document admission busy");
      s.lease.current();s.input=s.lease.input;
      if(host.documents.trashBlocked(s.input.path,s.input.fingerprint,s.input.directories))throw Error("Target isolated");
      s.bindings=await affectedBindings(s);s.affected=s.bindings.map(({handle,documentId})=>({handle,documentId}));
      if(s.affected.length>1024)throw Error("Too many affected bindings");
      s.status="prepared";
    }catch{s.status="failed";}finally{release(s);s.working=false;}
  }
  async function commit(s:Slot) {
    try {
      if(!s.input)throw Error("Missing target");
      s.lease=await host.acquire(s.target);
      s.documents=await host.documents.acquireFolderMutationLease()??undefined;
      if(!s.documents||JSON.stringify(s.lease.input)!==JSON.stringify(s.input))throw Error("Target changed since confirmation");
      const bindings=await affectedBindings(s),affected=bindings.map(({handle,documentId})=>({handle,documentId}));
      if(JSON.stringify(affected)!==JSON.stringify(s.affected))throw Error("Affected bindings changed");
      if(bindings.some((item,index)=>item.fingerprint!==s.bindings?.[index].fingerprint||item.path!==s.bindings?.[index].path))throw Error("Binding identity changed");
      if(!s.documents.current())throw Error("Lost trash lease");
      s.lease.current();
      const prepared=await s.documents.prepare(s.affected.map(item=>({handle:item.handle,action:"revoke" as const})));
      s.lease.current();if(!s.documents.current()||exiting||disposed)throw Error("Trash interrupted before dispatch");
      s.dispatched=true;
      const result=await (host.run??trashFile)(s.input);
      if(result.status==="trashed"){s.platformSucceeded=true;s.resultPath=result.resultPath;}
      else if(result.status==="unknown"&&result.platformSucceeded)s.platformSucceeded=true;
      if(result.status==="failed"){s.status="failed";return;}
      if(result.status!=="trashed"){s.status="unknown";return;}
      // A handed-off lease cannot apply an old publication. Keep the known
      // system action quarantined rather than revoke a newly authorized object.
      if(!s.documents?.current()){s.status="unknown";return;}
      s.lease.current();
      const publication=s.lease.publish();
      prepared.commit(()=>{s.publication={documents:s.affected,files:publication.files};s.status="trashed";});
      try{publication.effects();}catch{/* Committed publication survives ancillary cleanup. */}
    }catch{if(!s.publication)s.status=s.dispatched?"unknown":"failed";}
    finally{s.working=false;release(s);}
  }
  return {
    blocked:isolated,
    async request(value:unknown):Promise<TrashResponse> {
      if(!validTrashRequest(value))return {protocolVersion:1,requestId:"",session,sequence,status:"stale",working:false};
      const r=value;
      if(r.op==="state")return response(r);
      if(r.session!==session)return response(r);
      if(r.op==="prepare"&&!slot&&r.sequence===sequence&&!exiting&&!disposed){
        const s:Slot={sequence,target:r.target,token:randomUUID(),affected:[],status:"working",working:true,dispatched:false};slot=s;
        s.task=prepare(s);await s.task;return response(r);
      }
      const s=slot;if(s?.sequence!==r.sequence)return response(r);
      if(r.op==="prepare"&&JSON.stringify(r.target)!==JSON.stringify(s.target))return {...response({...r,op:"query"}),status:"stale",working:false};
      if(r.op==="commit"&&s.status==="prepared"&&r.confirmationToken===s.token&&!exiting&&!disposed){s.working=true;s.status="working";s.task=commit(s);await s.task;}
      if(r.op==="cancel"&&!s.dispatched&&!s.working){release(s);slot=undefined;host.receiptBytes?.(0);sequence++;}
      if(r.op==="ack"&&!s.working&&(s.status==="failed"||s.status==="trashed")){release(s);slot=undefined;host.receiptBytes?.(0);sequence++;}
      return response(r);
    },
    beforeExit(){
      exiting=true;
      if(slot){release(slot);if(slot.dispatched&&slot.working)slot.status="unknown";else if(slot.status==="prepared")slot.status="failed";}
    },
    cancelExit(){if(!disposed)exiting=false;},
    async finishExit(deadline:number){
      const task=slot?.task;if(!task||!slot?.working)return true;
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{return await Promise.race([task.then(()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),Math.max(0,deadline-Date.now()));})]);}
      finally{if(timer)clearTimeout(timer);}
    },
    dispose(){disposed=true;exiting=true;if(slot)release(slot);host.receiptBytes?.(0);},
  };
}
