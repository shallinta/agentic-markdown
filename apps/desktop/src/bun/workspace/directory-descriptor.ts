import { closeSync, constants, fstatSync, openSync } from "node:fs";
import { join } from "node:path";

import { fileFingerprint } from "../documents/path-authorization";

import type { DirectoryIdentity, RootAuthorization } from "./authorization";

export interface DirectoryNative { openDirectoryAt(fd:number,name:string):number }
export interface PendingDirectory { path:string;chain:DirectoryIdentity[] }
/** Opens each component without following symlinks; caller owns returned fd. */
export function openDirectoryDescriptor(root:RootAuthorization,directory:PendingDirectory,native:DirectoryNative){
 let fd=openSync("/",constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{
  const identities=[...root.directories,...directory.chain];let path="/";
  if(fileFingerprint(fstatSync(fd,{bigint:true}))!==identities.find(d=>d.path===path)?.fingerprint)throw Error("Directory identity changed");
  for(const part of directory.path.split("/").filter(Boolean)){
   const next=native.openDirectoryAt(fd,part);closeSync(fd);fd=next;path=join(path,part);
   if(fileFingerprint(fstatSync(fd,{bigint:true}))!==identities.find(d=>d.path===path)?.fingerprint)throw Error("Directory identity changed");
  }
  return fd;
 }catch(error){closeSync(fd);throw error;}
}
