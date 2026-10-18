import { randomUUID } from "node:crypto";
import { closeSync, fstatSync } from "node:fs";
import { join } from "node:path";

import { folderName, validCreateFolderRequest, type CreateFolderResponse, type CreateFolderOutcome } from "../../shared/create-folder";
import { markdownNameKey, type CreateOperation, type CreateTarget } from "../../shared/create-markdown";
import type { TrustedDocumentService } from "../documents";
import { fileFingerprint } from "../documents/path-authorization";

import { createFolderOnDisk, verifyFolderTarget, type FolderNative } from "./create-folder-disk";
import type { CreationTarget } from "./create-markdown";
import { openDirectoryDescriptor, type ScanDirectory } from "./scan";

export interface FolderLease {
  target: CreationTarget; lifetime: object;
  reserve(proof: ScanDirectory): object;
  cancel(reservation: object): void;
  acceptDirectory(proof: ScanDirectory,reservation?:object,token?:string): {status:"accepted"|"same-identity";entryHandle:string;registrationToken:string;committedVersion:number}|{status:"unavailable"};
  release(): void;
}
export interface FolderHost {
  documents: TrustedDocumentService;
  native(): FolderNative;
  resolve(target: CreateTarget): Promise<CreationTarget>;
  acquire(target: CreateTarget,retry?:{lifetime:object;proof:ScanDirectory}):Promise<FolderLease>;
  registered(lifetime:object,token:string):boolean;
}
interface Slot { operation:CreateOperation; target:CreateTarget; rawName:string; name:string; status:CreateFolderOutcome; working:boolean; message?:string; proof?:ScanDirectory; lifetime?:object; registrationToken?:string; revoked?:boolean; entryHandle?:string }
const envelope=(requestId:string)=>({protocolVersion:1 as const,requestId});
export function createFolderService(host:FolderHost){
  const session=randomUUID();let highwater=0,slot:Slot|undefined,disposed=false,preview:{id:string;active:boolean}|undefined;
  const current=(s:Slot)=>{if(disposed||slot!==s)throw Error("Disposed");};
  const refresh=(s:Slot)=>{if(s.registrationToken&&s.lifetime&&!host.registered(s.lifetime,s.registrationToken)){s.revoked=true;s.entryHandle=undefined;}};
  const response=(id:string,s:Slot):CreateFolderResponse=>{refresh(s);return {...envelope(id),status:s.working?"pending":s.status,operation:s.operation,working:s.working,name:s.name,message:s.message,entryHandle:s.entryHandle};};
  async function equivalent(target:CreationTarget,name:string,check:()=>void){
    verifyFolderTarget(target);const native=host.native(),fd=openDirectoryDescriptor(target.root,target,native);let cursor:object|undefined,bytes=0,count=0,matches=0;
    try{cursor=native.scanOpen(fd);for(;;){check();target.check();const batch=native.scanBatch(cursor,128);for(const n of batch.names){bytes+=Buffer.byteLength(n);if(++count>32768||bytes>4*1024*1024)throw Error("Name budget");if(markdownNameKey(n)===markdownNameKey(name))matches++;}if(batch.done)break;await new Promise(resolve=>setTimeout(resolve,0));}check();verifyFolderTarget(target);return matches;}
    finally{try{if(cursor)native.scanClose(cursor);}finally{closeSync(fd);}}
  }
  async function execute(s:Slot,retry:boolean){
    let lease:FolderLease|undefined,reservation:object|undefined;
    try{
      refresh(s);if(s.revoked)return;
      lease=await host.acquire(s.target,retry&&s.lifetime&&s.proof?{lifetime:s.lifetime,proof:s.proof}:undefined);current(s);
      s.lifetime=lease.lifetime;
      if(!lease.target.showHidden&&s.name.startsWith("."))throw Error("请先开启隐藏文件显示。");
      const count=await equivalent(lease.target,s.name,()=>current(s));
      if(count!==(retry?1:0))throw Error("同目录已存在同名或等价名称的项目，或原目录已变化。");
      const active=lease;
      const entered=await host.documents.withCreateBarrier(()=>{
        current(s);verifyFolderTarget(active.target);
        if(!retry){
          if(host.documents.trashBlocked(join(active.target.path,s.name),undefined,[...active.target.root.directories,...active.target.chain]))throw Error("Trash target remains isolated");
          reservation=active.reserve({path:join(active.target.path,s.name),fingerprint:"9".repeat(96),chain:active.target.chain});
          createFolderOnDisk({native:host.native(),target:active.target,name:s.name,check:()=>current(s),committed:proof=>{s.proof=proof;s.status="created";},unknown:()=>{s.status="unknown";}});
        }
        if(!s.proof||s.status!=="created")return;
        const fd=openDirectoryDescriptor(active.target.root,{path:s.proof.path,chain:[...s.proof.chain,{path:s.proof.path,fingerprint:s.proof.fingerprint}]},host.native());
        try{if(fileFingerprint(fstatSync(fd,{bigint:true}))!==s.proof.fingerprint)throw Error("Created directory replaced");}finally{closeSync(fd);}
        if(!s.registrationToken&&!reservation)reservation=active.reserve(s.proof);
        const accepted=active.acceptDirectory(s.proof,reservation,s.registrationToken);
        if(accepted.status==="unavailable")throw Error("Directory projection unavailable");
        reservation=undefined;s.registrationToken=accepted.registrationToken;s.entryHandle=accepted.entryHandle;s.message=undefined;
      });
      if(!entered)throw Error("文档服务忙，未执行创建。");
    }catch(error){
      if(s.status==="pending")s.status="rejected-before-create";
      const code=error&&typeof error==="object"&&"code"in error?String(error.code):"";
      s.message=s.status==="rejected-before-create"?(code==="PUBLISH_UNSUPPORTED"?"当前目标文件系统不支持安全排他发布；目标未创建，可能保留私有暂存目录。":`目标未创建，可能保留私有暂存目录：${error instanceof Error?error.message:"操作失败"}`):"目录已创建或结果需要确认，暂时无法定位；不会重复创建或自动删除。";
    }finally{try{if(reservation)lease?.cancel(reservation);}finally{lease?.release();s.working=false;}}
  }
  return {
    busy:()=>!!slot,
    async request(value:unknown):Promise<CreateFolderResponse>{
      if(!validCreateFolderRequest(value))return {...envelope(""),status:"stale",operation:{session,sequence:highwater+1},working:false};
      const v=value;
      if(v.op==="state")return {...envelope(v.requestId),status:"state",session,sequence:slot?.operation.sequence??highwater+1};
      if(v.op==="cancel-preview"){if(preview?.id===v.previewId)preview.active=false;return {...envelope(v.requestId),status:"cancelled-preview",previewId:v.previewId};}
      if(v.op==="preview"){
        if(preview)preview.active=false;const token={id:v.previewId,active:true};preview=token;
        const parsed=folderName(v.name),base={...envelope(v.requestId),status:"preview" as const,previewId:v.previewId};
        if(!parsed.ok)return {...base,result:"invalid",message:parsed.message};
        try{if(disposed||slot)throw Error();const target=await host.resolve(v.target);if(!target.showHidden&&parsed.name.startsWith("."))return {...base,result:"invalid",message:"请先开启隐藏文件显示。"};const matches=await equivalent(target,parsed.name,()=>{if(disposed||!token.active)throw Error();});return {...base,result:matches?"conflict":"available",name:parsed.name};}catch{return {...base,result:"unavailable",name:parsed.name};}
      }
      const operation={session:v.session,sequence:v.sequence},status=(state:CreateFolderOutcome):CreateFolderResponse=>({...envelope(v.requestId),status:state,operation,working:false});
      if(disposed||v.session!==session)return status("stale");
      if(v.sequence<=highwater)return status(v.op==="query"||v.op==="ack"?"acked":"stale");
      if(slot&&slot.operation.sequence!==v.sequence)return status("busy");
      if(v.op==="create"){
        if(slot)return slot.rawName===v.name&&JSON.stringify(slot.target)===JSON.stringify(v.target)?response(v.requestId,slot):status("stale");
        if(v.sequence!==highwater+1)return status("stale");const parsed=folderName(v.name);
        const s:Slot={operation,target:{...v.target},rawName:v.name,name:parsed.ok?parsed.name:v.name,status:parsed.ok?"pending":"rejected-before-create",working:parsed.ok,message:parsed.ok?undefined:parsed.message};slot=s;if(preview)preview.active=false;if(parsed.ok)await execute(s,false);return response(v.requestId,s);
      }
      if(!slot)return status("stale");const s=slot;refresh(s);
      if(v.op==="query"||s.working)return response(v.requestId,s);
      if(v.op==="retry-locate"){if(s.status==="created"&&!s.revoked&&s.proof){s.working=true;await execute(s,true);}return response(v.requestId,s);}
      if(v.op==="ack"&&s.status!=="unknown"&&s.status!=="pending"){highwater=v.sequence;slot=undefined;return status("acked");}
      return response(v.requestId,s);
    },
    dispose(){disposed=true;if(preview)preview.active=false;},
  };
}
