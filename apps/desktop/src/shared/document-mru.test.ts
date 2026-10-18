import { expect,test } from "bun:test";

import { isMRUAck,isMRUData,isMRUResolveResponse,isMRUSessionResponse } from "./document-mru";

test("strict MRU wire and disk schema reject ambiguous IDs and targets but permit hardlink proofs",()=>{
 const a=crypto.randomUUID(),b=crypto.randomUUID(),requestId=crypto.randomUUID(),session=crypto.randomUUID(),base={protocolVersion:1,requestId,session,sequence:1,revision:2};
 expect(isMRUAck({...base,status:"persisted"})).toBe(true);expect(isMRUAck({...base,status:["persisted"]})).toBe(false);
 expect(isMRUSessionResponse({...base,available:true,session:""})).toBe(false);
 const entries=[{documentId:a,path:"/a.md",fingerprint:"1:2:3",rank:2},{documentId:b,path:"/b.md",fingerprint:"1:2:3",rank:1}];expect(isMRUData({revision:2,entries})).toBe(true);
 expect(isMRUData({revision:2,entries:[entries[0],{...entries[1],documentId:a}]})).toBe(false);expect(isMRUData({revision:2,entries:[entries[0],{...entries[1],path:"/a.md"}]})).toBe(false);
 const item={kind:"standalone",documentId:a,handle:crypto.randomUUID(),rank:2};expect(isMRUResolveResponse({...base,incomplete:false,items:[item]})).toBe(true);expect(isMRUResolveResponse({...base,incomplete:false,items:[item,{...item,documentId:b}]})).toBe(false);expect(isMRUResolveResponse({...base,incomplete:false,items:[{...item,rank:3}]})).toBe(false);
});
