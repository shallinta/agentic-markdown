import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

import { visiblePath } from "./authorization";
import type { ScanDirectory, CreatedDirectorySnapshot } from "./scan";

export const CREATED_DIRECTORY_LIMIT = 1024;
export const CREATED_DIRECTORY_BYTES = 512 * 1024;
export function createDirectoryRegistry(rootPath: string, charge: (delta: number) => void) {
  const records = new Map<string, { proof: ScanDirectory; token: string; bytes: number }>();
  const reservations = new Map<object, number>();
  let version = 1, bytes = 0, disposed = false;
  const size = (proof: ScanDirectory) => 2 * Buffer.byteLength(JSON.stringify(proof)) + 256;
  return {
    version: () => version,
    bytes: () => bytes,
    get(path: string) { return records.get(path); },
    has(token: string) { return [...records.values()].some(record => record.token === token); },
    snapshot(): CreatedDirectorySnapshot { return { version, directories: [...records.values()].map(record => structuredClone(record.proof)) }; },
    reserve(proof: ScanDirectory) {
      const amount = size(proof);
      if(disposed || records.has(proof.path) || records.size+reservations.size >= CREATED_DIRECTORY_LIMIT || bytes+amount > CREATED_DIRECTORY_BYTES || proof.chain.length>=128 || dirname(proof.path)!==(proof.chain[proof.chain.length-1]?.path??rootPath))throw Error("Directory registry budget or identity");
      charge(amount);const reservation={};reservations.set(reservation,amount);bytes+=amount;return reservation;
    },
    cancel(reservation: object) { const amount=reservations.get(reservation);if(amount!==undefined){reservations.delete(reservation);bytes-=amount;charge(-amount);} },
    commit(reservation: object, proof: ScanDirectory, expected: number) {
      const amount=reservations.get(reservation);
      if(disposed || expected!==version || amount===undefined || size(proof)>amount || records.has(proof.path))throw Error("Directory registry changed");
      const record={proof:structuredClone(proof),token:randomUUID(),bytes:amount};
      reservations.delete(reservation);records.set(proof.path,record);version++;return {committedVersion:version,registrationToken:record.token};
    },
    reconcile(seen: Iterable<ScanDirectory>, showHidden: boolean) {
      const matches=new Map([...seen].map(proof=>[proof.path,JSON.stringify(proof)]));
      for(const [path,record] of records){
        if(!visiblePath(rootPath,path,showHidden))continue;
        if(matches.get(path)===JSON.stringify(record.proof))continue;
        records.delete(path);bytes-=record.bytes;charge(-record.bytes);version++;
      }
    },
    dispose() { if(disposed)return;disposed=true;charge(-bytes);bytes=0;records.clear();reservations.clear();version++; },
  };
}
