import { createHash, randomUUID } from "node:crypto";
import { closeSync, fstatSync, fsyncSync, readSync, writeSync } from "node:fs";

import { fileFingerprint } from "../documents/path-authorization";

import type { CreationNative, CreationTarget } from "./create-markdown";
import { openDirectoryDescriptor } from "./scan";

interface PublishNative extends CreationNative {
  createTemp(fd: number, leaf: string): number;
  publishExclusive(fd: number, source: string, target: string): unknown;
  openFileAt(fd: number, leaf: string): number;
  scanStat(fd: number, leaf: string): { kind: string; fingerprint: string };
}
/** No cleanup-by-name: even a stat/unlink pair can delete an external replacement. */
export async function publishDuplicate(options: {
  native: CreationNative; target: CreationTarget; name: string;
  bytes: Uint8Array; hash: string; check(): void; revalidate(): Promise<void>;
  committed(): void; unknown(): void; identified(fingerprint: string): void;
}) {
  const native = options.native as PublishNative;
  const dir = openDirectoryDescriptor(options.target.root, options.target, native);
  const temporary = `.agentic-save-${randomUUID()}`;
  let directoryIdentity: string;
  const check = () => {
    options.check();
    const expected=options.target.chain[options.target.chain.length-1]?.fingerprint ?? options.target.root.directories[options.target.root.directories.length-1]?.fingerprint;
    const stat=fstatSync(dir,{bigint:true});
    if(!stat.isDirectory()||fileFingerprint(stat)!==directoryIdentity||directoryIdentity!==expected)throw Error("Directory changed");
  };
  let file: number | undefined, final: number | undefined;
  const fd = (value: unknown): number => { if (!Number.isInteger(value) || Number(value)<0 || Number(value)>2147483647) throw Error("Invalid descriptor"); return Number(value); };
  const verifyBytes = (descriptor: number) => {
    const stat = fstatSync(descriptor, {bigint:true});
    if (!stat.isFile() || stat.size !== BigInt(options.bytes.length)) throw Error("Content changed");
    const hash = createHash("sha256"), buffer = Buffer.alloc(64*1024);
    let position = 0;
    while(position < options.bytes.length) {
      check(); const length = readSync(descriptor, buffer, 0, Math.min(buffer.length,options.bytes.length-position),position);
      if(!length)throw Error("Short read");hash.update(buffer.subarray(0,length));position+=length;
    }
    if(hash.digest("hex")!==options.hash)throw Error("Content changed");
    const after=fstatSync(descriptor,{bigint:true});
    if(fileFingerprint(after)!==fileFingerprint(stat)||after.size!==stat.size||after.mtimeNs!==stat.mtimeNs||after.ctimeNs!==stat.ctimeNs)throw Error("Content changed during verification");
    return fileFingerprint(stat);
  };
  try {
    directoryIdentity=fileFingerprint(fstatSync(dir,{bigint:true}));
    check(); file = fd(native.createTemp(dir,temporary));
    let position=0;
    while(position<options.bytes.length){ options.check();const length=writeSync(file,options.bytes,position,Math.min(64*1024,options.bytes.length-position),position);if(!length)throw Error("Short write");position+=length; }
    fsyncSync(file); const identity=verifyBytes(file);
    await options.revalidate(); check();
    const named = native.scanStat(dir,temporary);
    if(named.kind!=="file"||named.fingerprint!==identity||verifyBytes(file)!==identity)throw Error("Temporary replaced");
    check();
    try {
      if(native.publishExclusive(dir,temporary,options.name)!==0){options.unknown();return;}
    } catch(error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if(!["PUBLISH_INVALID","PUBLISH_EXISTS","PUBLISH_UNSUPPORTED","PUBLISH_FAILED"].includes(code))options.unknown();
      throw error;
    }
    options.committed();
    fsyncSync(dir); check();
    final=fd(native.openFileAt(dir,options.name));
    if(verifyBytes(final)!==identity)throw Error("Published file replaced");
    check();options.identified(identity);
  } finally {
    try { if(final!==undefined)closeSync(final); }
    finally {try {if(file!==undefined)closeSync(file);}finally{closeSync(dir);}}
  }
}
