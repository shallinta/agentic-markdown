import type { DocumentRequest } from "./documents";

export type TrashTarget = {kind:"root";root:string;entry:string;generation:number}|{kind:"directory";root:string;entry?:string;generation:number}|{kind:"standalone";handle:string;documentId:string};
export interface TrashOperation {session:string;sequence:number}
export interface TrashAffected {handle:string;documentId:string;fileName:string}
export interface TrashPublication {
  documents: {handle:string;documentId:string}[];
  files: {root:string;previousGeneration:number;generation:number;entries:string[];removed?:true}[];
}
export type TrashRequest=DocumentRequest&(
 {op:"state"}|(TrashOperation&{op:"prepare";target:TrashTarget})|
 (TrashOperation&{op:"commit";confirmationToken:string})|
 (TrashOperation&{op:"query"|"cancel"|"ack"})
);
export type TrashResponse=DocumentRequest&(
 {status:"state";session:string;sequence:number}|
 (TrashOperation&{status:"prepared";working:false;confirmationToken:string;canonicalPath:string;selectedPath:string;affected:TrashAffected[];kind?:"directory"})|
 (TrashOperation&{status:"trashed";working:false;publication:TrashPublication})|
 (TrashOperation&{status:"working"|"unknown"|"failed"|"acked"|"stale"|"busy";working:boolean;message?:string})
);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
const keys=(v:Record<string,unknown>,expected:string[])=>Object.keys(v).sort().join()===expected.sort().join();
export function validTrashTarget(v:unknown):v is TrashTarget {
 if(object(v)&&v.kind==="directory")return keys(v,v.entry===undefined?["kind","root","generation"]:["kind","root","entry","generation"])&&uuid(v.root)&&count(v.generation)&&(v.entry===undefined||uuid(v.entry));
 return object(v)&&(v.kind==="root"?keys(v,["kind","root","entry","generation"])&&uuid(v.root)&&uuid(v.entry)&&count(v.generation):v.kind==="standalone"&&keys(v,["kind","handle","documentId"])&&uuid(v.handle)&&uuid(v.documentId));
}
export function validTrashRequest(v:unknown):v is TrashRequest {
 if(!object(v)||v.protocolVersion!==1||!uuid(v.requestId))return false;
 const base=["protocolVersion","requestId","op"];
 if(v.op==="state")return keys(v,base);
 if(!uuid(v.session)||!count(v.sequence))return false;base.push("session","sequence");
 if(v.op==="prepare")return keys(v,[...base,"target"])&&validTrashTarget(v.target);
 if(v.op==="commit")return keys(v,[...base,"confirmationToken"])&&uuid(v.confirmationToken);
 return ["query","cancel","ack"].includes(String(v.op))&&typeof v.op==="string"&&keys(v,base);
}
export function validTrashResponse(v:unknown,request:TrashRequest):v is TrashResponse {
 if(!object(v)||v.protocolVersion!==1||v.requestId!==request.requestId||!uuid(v.session)||!count(v.sequence))return false;
 const base=["protocolVersion","requestId","status","session","sequence"];
 if(v.status==="state")return request.op==="state"&&keys(v,base);
 if(request.op==="state")return false;
 if(v.session!==request.session||v.sequence!==request.sequence)return false;
 base.push("working");if(typeof v.working!=="boolean")return false;
 if(v.status==="prepared")return v.working===false&&(v.kind===undefined||v.kind==="directory")&&keys(v,[...base,"confirmationToken","canonicalPath","selectedPath","affected",...(v.kind===undefined?[]:["kind"])])&&uuid(v.confirmationToken)&&[v.canonicalPath,v.selectedPath].every(p=>typeof p==="string"&&p.startsWith("/")&&p.length<=4096&&!p.includes("\0"))&&Array.isArray(v.affected)&&v.affected.length<=1024&&v.affected.every(e=>object(e)&&keys(e,["handle","documentId","fileName"])&&uuid(e.handle)&&uuid(e.documentId)&&typeof e.fileName==="string"&&e.fileName.length<=4096)&&new Set(v.affected.map(e=>(e as TrashAffected).handle)).size===v.affected.length;
 if(v.status==="trashed"){
  if(v.working||!keys(v,[...base,"publication"])||!object(v.publication)||!keys(v.publication,["documents","files"]))return false;
  const p=v.publication;
  return Array.isArray(p.documents)&&p.documents.length<=1024&&p.documents.every(e=>object(e)&&keys(e,["handle","documentId"])&&uuid(e.handle)&&uuid(e.documentId))&&new Set(p.documents.map(e=>(e as {handle:string}).handle)).size===p.documents.length&&Array.isArray(p.files)&&p.files.length<=32&&p.files.every(e=>object(e)&&keys(e,["root","previousGeneration","generation","entries",...(e.removed===undefined?[]:["removed"])])&&(e.removed===undefined||e.removed===true)&&uuid(e.root)&&count(e.previousGeneration)&&count(e.generation)&&e.generation===e.previousGeneration+1&&Array.isArray(e.entries)&&e.entries.length<=1024&&e.entries.every(uuid)&&new Set(e.entries).size===e.entries.length)&&new Set(p.files.map(e=>(e as {root:string}).root)).size===p.files.length;
 }
 return typeof v.status==="string"&&["working","unknown","failed","acked","stale","busy"].includes(v.status)&&keys(v,v.message===undefined?base:[...base,"message"])&&(v.message===undefined||typeof v.message==="string"&&v.message.length<=512)&&((v.status==="working")===v.working||v.status==="unknown");
}
