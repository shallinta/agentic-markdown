import { isMRUResolveRequest, type MRUResolveResponse } from "../shared/document-mru";

import type { createDocumentMRU } from "./document-mru";
import type { TrustedDocumentService } from "./documents";
import type { TrustedWorkspaceService } from "./workspace";

export function createMRUService(mru:ReturnType<typeof createDocumentMRU>,documents:TrustedDocumentService,workspace:TrustedWorkspaceService){
  let latest=0,activeSession="";
  return {
    begin:(input:unknown)=>mru.begin(input),
    record:(input:unknown)=>mru.record(input,(handle,id)=>documents.captureMRU(handle,id)),
    async resolve(input:unknown):Promise<MRUResolveResponse>{
      const r=input as Partial<MRUResolveResponse>;
      const base={protocolVersion:1 as const,requestId:typeof r?.requestId==="string"?r.requestId:"",session:typeof r?.session==="string"?r.session:"",sequence:typeof r?.sequence==="number"?r.sequence:0};
      const snapshot=mru.snapshot();
      const rejected={...base,revision:snapshot.revision,items:[],incomplete:true};
      if(!isMRUResolveRequest(input)||!mru.currentSession(input.session))return rejected;
      if(activeSession!==input.session){activeSession=input.session;latest=0;}
      if(input.sequence<=latest)return rejected;
      latest=input.sequence;
      const check=()=>{if(latest!==input.sequence||activeSession!==input.session||!mru.currentSession(input.session)||mru.snapshot()!==snapshot)throw Error("MRU_STALE");};
      try{const result=await workspace.resolveMRU(snapshot.entries,check);check();result.current();return {...base,revision:snapshot.revision,items:result.items,incomplete:result.incomplete};}catch{return rejected;}
    },
  };
}
