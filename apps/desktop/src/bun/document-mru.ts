import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createSettingsStore } from "@agentic-markdown/shared/server";

import { isMRUData, isMRUEnvelope, isMRURecordRequest, MRU_LIMIT, MRU_MAX_BYTES, type MRUAck, type MRUData, type MRUEntry, type MRUSessionResponse } from "../shared/document-mru";

export function createDocumentMRU(settingsDir:string, warn:()=>void=()=>undefined) {
  const store=createSettingsStore(join(settingsDir,"document-mru.json"),v=>isMRUData(v)?v:{revision:0,entries:[]},{maxBytes:MRU_MAX_BYTES,validateData:isMRUData});
  let data:MRUData={revision:0,entries:[]},available=false,session="",sequence=0,persisted=0,transition=false,disposed=false;
  let tail:Promise<void>=Promise.resolve(),queued=0;
  let lastRecord: { key: string; revision: number; outcome: Promise<boolean> } | undefined;
  let transitionDone: (()=>void)|undefined, transitionWait:Promise<void>|undefined;
  let windowBound=false, ready=false, transitionToken:object|undefined;
  const finishTransition=()=>{transition=false;transitionToken=undefined;transitionDone?.();transitionDone=undefined;transitionWait=undefined;};
  const report=()=>{try{warn();}catch{/* Metadata reporting never blocks editing. */}};
  const write=()=>{
    if(!available||queued>=64){report();return Promise.resolve(false);}
    const captured=data;queued++;
    const next=tail.then(async()=>{try{await store.update(()=>captured);persisted=Math.max(persisted,captured.revision);return true;}catch{report();return false;}});
    tail=next.then(()=>undefined).finally(()=>{queued--;});return next;
  };
  return {
    async initialize(){try{const read=await store.inspectState();if(read.available){data=read.data;persisted=data.revision;available=true;}else report();}catch{report();}},
    bindWindow(){if(windowBound||disposed)return;windowBound=true;transition=true;transitionWait=new Promise<void>(resolve=>{transitionDone=resolve;});},
    domReady(){if(disposed||!windowBound||ready&&!transitionToken)return;ready=true;session=randomUUID();sequence=0;lastRecord=undefined;finishTransition();},
    beginTransition(){const token={};transitionToken=token;transition=true;transitionWait=new Promise<void>(resolve=>{transitionDone=resolve;});return token;},
    cancelTransition(token:object){if(transitionToken===token)finishTransition();},
    currentSession(token:string){return !disposed&&!transition&&available&&!!session&&token===session;},
    async begin(input:unknown):Promise<MRUSessionResponse>{
      if(transitionWait){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([transitionWait,new Promise<void>(resolve=>{timer=setTimeout(resolve,2000);})]);}finally{clearTimeout(timer);}}
      const requestId=typeof (input as {requestId?:unknown})?.requestId==="string"?(input as {requestId:string}).requestId:"";
      return {protocolVersion:1,requestId,available:isMRUEnvelope(input)&&available&&!disposed&&!transition&&!!session,session,sequence,revision:data.revision};
    },
    snapshot(){return data;},
    lookup(path:string,fingerprint:string){return available?data.entries.find(e=>e.path===path&&e.fingerprint===fingerprint)?.documentId:undefined;},
    migrate(documentId:string,path:string,oldFingerprint:string,newFingerprint:string){
      if(!available||disposed)return;
      const entry=data.entries.find(e=>e.documentId===documentId&&e.path===path&&e.fingerprint===oldFingerprint);
      if(!entry)return;
      data={revision:data.revision+1,entries:data.entries.map(e=>e===entry?{...e,fingerprint:newFingerprint}:e)};void write();
    },
    async record(input:unknown,capture:(handle:string,documentId:string)=>Omit<MRUEntry,"rank">|undefined):Promise<MRUAck>{
      const r=input as Partial<MRUAck>;const base={protocolVersion:1 as const,requestId:typeof r?.requestId==="string"?r.requestId:"",session:typeof r?.session==="string"?r.session:"",sequence:typeof r?.sequence==="number"?r.sequence:0};
      if(!isMRURecordRequest(input)||disposed||transition||input.session!==session||!available||input.sequence<sequence)return {...base,status:"stale",revision:data.revision};
      const key=JSON.stringify(input);
      if(input.sequence===sequence){if(lastRecord?.key!==key)return {...base,status:"stale",revision:data.revision};const previous=lastRecord;return {...base,status:await previous.outcome?"persisted":"unavailable",revision:previous.revision};}
      const captured=capture(input.handle,input.documentId);sequence=input.sequence;
      if(!captured)return {...base,status:"stale",revision:data.revision};
      const revision=data.revision+1;
      data={revision,entries:[{...captured,rank:revision},...data.entries.filter(e=>e.documentId!==captured.documentId&&e.path!==captured.path)].slice(0,MRU_LIMIT)};
      const outcome=write();lastRecord={key,revision,outcome};const ok=await outcome;return {...base,status:ok?"persisted":"unavailable",revision};
    },
    async drainUntil(deadline:number){
      const remaining=Math.max(0,deadline-performance.now());
      if(!remaining){if(queued)report();return;}
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([tail,new Promise<void>(resolve=>{timer=setTimeout(()=>{report();resolve();},remaining);})]);if(persisted<data.revision)report();}finally{clearTimeout(timer);}
    },
    dispose(){disposed=true;session="";transitionDone?.();transitionDone=undefined;transitionWait=undefined;},
  };
}
