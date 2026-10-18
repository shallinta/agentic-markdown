import { randomUUID } from "node:crypto";
import { closeSync, fstatSync, lstatSync } from "node:fs";
import { join } from "node:path";

import { fileFingerprint } from "../documents/path-authorization";

import type { CreationNative, CreationTarget } from "./create-markdown";
import { openDirectoryDescriptor, type ScanDirectory } from "./scan";

export interface FolderNative extends CreationNative {
  createPrivateDirectory(fd: number, name: string): number;
  publishDirectoryExclusive(fd: number, temp: string, name: string): number;
}
export function verifyFolderTarget(target: CreationTarget) {
  target.check();
  for(const part of [...target.root.directories,...target.chain]){
    const stat=lstatSync(part.path,{bigint:true});
    if(!stat.isDirectory()||stat.isSymbolicLink()||fileFingerprint(stat)!==part.fingerprint)throw Error("Target changed");
  }
  target.check();
}
export function createFolderOnDisk(options: {
  native: FolderNative; target: CreationTarget; name: string; check(): void;
  committed(proof: ScanDirectory): void; unknown(): void;
}) {
  const {native,target,name}=options;
  const check=()=>options.check();
  check();verifyFolderTarget(target);
  const parent=openDirectoryDescriptor(target.root,target,native),temp=`.agentic-dir-${randomUUID()}`;
  let held: number|undefined;
  const empty=(fd:number)=>{const cursor=native.scanOpen(fd);try{const batch=native.scanBatch(cursor,3);if(batch.names.some(n=>n!=="."&&n!=="..")||!batch.done)throw Error("Temporary directory not empty");}finally{native.scanClose(cursor);}};
  const emptyName=(leaf:string,fingerprint:string)=>{const fresh=native.openDirectoryAt(parent,leaf);try{if(fileFingerprint(fstatSync(fresh,{bigint:true}))!==fingerprint)throw Error("Directory changed");empty(fresh);}finally{closeSync(fresh);}};
  try {
    if(native.createPrivateDirectory(parent,temp)!==0)throw Error("Temporary creation uncertain");
    held=native.openDirectoryAt(parent,temp);
    const stat=fstatSync(held,{bigint:true}),fingerprint=fileFingerprint(stat);
    if(!stat.isDirectory()||(stat.mode&0o077n)!==0n||(typeof process.getuid==="function"&&stat.uid!==BigInt(process.getuid())))throw Error("Temporary identity unavailable");
    const proof={path:join(target.path,name),fingerprint,chain:target.chain};
    emptyName(temp,fingerprint);check();verifyFolderTarget(target);
    const named=lstatSync(join(target.path,temp),{bigint:true});
    if(!named.isDirectory()||named.isSymbolicLink()||fileFingerprint(named)!==fingerprint)throw Error("Temporary directory replaced");
    if(fileFingerprint(fstatSync(parent,{bigint:true}))!==fileFingerprint(lstatSync(target.path,{bigint:true})))throw Error("Parent replaced");
    emptyName(temp,fingerprint);
    let result: number;
    try {result=native.publishDirectoryExclusive(parent,temp,name);}
    catch(error){const code=error&&typeof error==="object"&&"code"in error?String(error.code):"";if(!["PUBLISH_EXISTS","PUBLISH_UNSUPPORTED","PUBLISH_INVALID","PUBLISH_FAILED"].includes(code))options.unknown();throw error;}
    if(result!==0){options.unknown();throw Error("Publication unknown");}
    options.committed(proof);
    check();verifyFolderTarget(target);
    const final=native.openDirectoryAt(parent,name);
    try{if(fileFingerprint(fstatSync(final,{bigint:true}))!==fingerprint)throw Error("Published directory replaced");empty(final);}finally{closeSync(final);}
    return proof;
  } finally {try{if(held!==undefined)closeSync(held);}finally{closeSync(parent);}}
}
