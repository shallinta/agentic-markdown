import { createHash, randomUUID } from "node:crypto";
import { closeSync, fstatSync, fsyncSync, lstatSync } from "node:fs";
import { join } from "node:path";

import { markdownFileName, markdownNameKey, validCreateMarkdownRequest, type DuplicateVersion, type DuplicateSource, type CreateMarkdownRequest, type CreateMarkdownResponse, type CreateOperation, type CreateTarget, type CreateOutcome } from "../../shared/create-markdown";
import type { DocumentSnapshot } from "../../shared/documents";
import type { TrustedDocumentService, DocumentScope } from "../documents";
import { fileFingerprint } from "../documents/path-authorization";

import { authorizeEntry, type DirectoryIdentity, type RootAuthorization } from "./authorization";
import { publishDuplicate } from "./duplicate-disk";
import { openDirectoryDescriptor, type DirectoryNative, type ScanFile } from "./scan";

export interface CreationNative extends DirectoryNative {
  createFileExclusive(fd: number, name: string): number;
  scanOpen(fd: number): object;
  scanBatch(cursor: object, limit: number): { names: string[]; done: boolean };
  scanClose(cursor: object): void;
}
export interface CreationTarget {
  root: RootAuthorization;
  path: string;
  chain: DirectoryIdentity[];
  showHidden: boolean;
  check(): void;
  scope(): DocumentScope;
}
export interface CreationLease {
  target: CreationTarget;
  accept(file: ScanFile): { status: "accepted" | "same-identity"; entryHandle: string } | { status: "unavailable" };
  release(): void;
}
interface Slot {
  operation: CreateOperation;
  target: CreateTarget;
  name: string;
  rawName: string;
  status: CreateOutcome;
  fingerprint?: string;
  proof?: CreationTarget;
  snapshot?: DocumentSnapshot;
  entryHandle?: string;
  released?: boolean;
  message?: string;
  working: boolean;
  source?: DuplicateSource;
  versionKey?: string;
}
export function createMarkdownService(host: {
  native(): CreationNative;
  documents: TrustedDocumentService;
  resolve(target: CreateTarget): Promise<CreationTarget>;
  acquire(target: CreateTarget): Promise<CreationLease>;
}, duplicate = false) {
  const session = randomUUID(); let highwater = 0, slot: Slot | undefined, disposed = false;
  let preview: { id: string; active: boolean } | undefined;
  const code = (e: unknown) => e && typeof e === "object" && "code" in e ? String(e.code) : "";
  function verify(target: CreationTarget) {
    target.check();
    for (const directory of [...target.root.directories, ...target.chain]) {
      const stat = lstatSync(directory.path, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || fileFingerprint(stat) !== directory.fingerprint) throw Error("Target changed");
    }
    target.check();
  }
  async function equivalent(target: CreationTarget, name: string, check: () => void, names?: Set<string>): Promise<number> {
    const native = host.native(); verify(target);
    const fd = openDirectoryDescriptor(target.root, target, native);
    let cursor: object | undefined, bytes = 0, count = 0, matches = 0;
    try {
      cursor = native.scanOpen(fd);
      for (;;) {
        check(); target.check();
        const batch = native.scanBatch(cursor, 128);
        for (const entry of batch.names) { bytes += Buffer.byteLength(entry); count++; if (bytes > 4 * 1024 * 1024 || count > 32768) throw Error("Directory budget"); names?.add(markdownNameKey(entry)); if (markdownNameKey(entry) === markdownNameKey(name)) matches++; }
        if (batch.done) break;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      check(); verify(target); return matches;
    } finally { try { if (cursor) native.scanClose(cursor); } finally { closeSync(fd); } }
  }
  const current = (s: Slot) => { if (disposed || slot !== s) throw Error("Disposed"); };
  async function openCreated(s: Slot, lease: CreationLease) {
    if (!s.fingerprint || s.released || s.snapshot) return;
    current(s); lease.target.check();
    const path = join(lease.target.path, s.name);
    verify(lease.target);
    const disk = lstatSync(path, {bigint: true});
    if (!disk.isFile() || disk.isSymbolicLink() || fileFingerprint(disk) !== s.fingerprint) throw Error("Created file replaced");
    // This checks the original creation identity; a path alone is never authority.
    const file: ScanFile = { path, fingerprint: s.fingerprint, chain: lease.target.chain };
    const accepted = lease.accept(file);
    if (accepted.status === "unavailable") { s.message = "文件已创建，但文件树暂时无法接纳；可重试打开。"; return; }
    s.entryHandle = accepted.entryHandle;
    const scope = lease.target.scope();
    const response = await host.documents.openCreatedAuthorized(
      { protocolVersion: 1, requestId: randomUUID() },
      () => authorizeEntry(lease.target.root, path, s.fingerprint!, lease.target.chain, lease.target.showHidden, () => { current(s); lease.target.check(); }),
      scope,
      snapshot => { s.snapshot = snapshot; s.status = "opened"; s.message = undefined; }
    );
    if (!s.snapshot) { scope.release?.(); s.message = "文件已创建，但暂时无法打开；可重试打开。"; }
    void response;
  }
  async function execute(s: Slot, retry: boolean, version?: DuplicateVersion) {
    let lease: CreationLease | undefined;
    try {
      lease = await host.acquire(s.target); current(s);
      if (retry) {
        if (!s.proof || !s.fingerprint || s.released || s.snapshot) return;
        const original = s.proof;
        if (lease.target.path !== original.path || JSON.stringify(lease.target.chain) !== JSON.stringify(original.chain) || JSON.stringify(lease.target.root) !== JSON.stringify(original.root)) throw Error("Target identity changed");
        if (await equivalent(lease.target, s.name, () => current(s)) !== 1) { s.message = "文件已创建，但名称冲突尚未消除；不会自动打开。"; return; }
        await openCreated(s, lease); return;
      }
      s.proof = lease.target;
      if (!lease.target.showHidden && s.name.startsWith(".")) { s.status = "rejected-before-create"; s.message = "请先开启该目录的隐藏文件显示。"; return; }
      if (await equivalent(lease.target, s.name, () => current(s))) { s.status = "rejected-before-create"; s.message = "已存在同名或等价名称，未创建文件。"; return; }
      const activeLease = lease;
      const publishSource: Parameters<TrustedDocumentService["withDuplicateSource"]>[1] = async source => {
        const check = () => { current(s);source.checkCurrent();verify(activeLease.target); };
        await publishDuplicate({native:host.native(),target:activeLease.target,name:s.name,bytes:source.bytes,hash:source.hash,check,revalidate:()=>source.revalidate(),
          committed:()=>{s.status="created";},unknown:()=>{s.status="unknown";},identified:value=>{s.fingerprint=value;}});
      };
      const entered = s.source ? (version?.kind === "buffer" ? await host.documents.withDuplicateBuffer(s.source, version, publishSource) : await host.documents.withDuplicateSource(s.source, publishSource)) : await host.documents.withCreateBarrier(() => {
        current(s); const native = host.native(); verify(activeLease.target);
        const dir = openDirectoryDescriptor(activeLease.target.root, activeLease.target, native);
        let file: number | undefined;
        try {
          verify(activeLease.target); current(s);
          try {
            const returned = native.createFileExclusive(dir, s.name);
            if (!Number.isInteger(returned) || returned < 0 || returned > 2147483647) { s.status = "unknown"; s.message = "创建回执无效，结果未知；不会重复创建。"; return; }
            file = returned; s.status = "created";
          }
          catch (error) { const c = code(error); s.status = c === "CREATED_IDENTITY_UNKNOWN" ? "created" : ["CREATE_INVALID", "CREATE_EXISTS", "CREATE_DENIED", "CREATE_FAILED"].includes(c) ? "rejected-before-create" : "unknown"; s.message = s.status === "rejected-before-create" ? "未创建文件：名称冲突、权限不足或目标已变化。" : "创建结果需要确认；不会再次执行创建。"; return; }
          const stat = fstatSync(file, { bigint: true });
          if (!stat.isFile() || stat.size !== 0n) throw Error("Created identity unavailable");
          s.fingerprint = fileFingerprint(stat); fsyncSync(file); verify(activeLease.target);
        } finally { try { if (file !== undefined) closeSync(file); } finally { closeSync(dir); } }
      });
      if (!entered) { s.status = "rejected-before-create"; s.message = "文档服务忙，未创建文件。"; return; }
      if (s.status !== "created" || !s.fingerprint) return;
      const count = await equivalent(lease.target, s.name, () => current(s));
      if (count !== 1) { s.message = "文件已创建，名称冲突或目录状态变化；请检查磁盘。"; return; }
      await openCreated(s, lease);
    } catch (error) {
      if (s.status === "pending") s.status = "rejected-before-create";
      s.message = s.status === "rejected-before-create" ? (duplicate ? (code(error)==="PUBLISH_UNSUPPORTED" ? "当前目标文件系统不支持安全排他发布，未发布副本；可能保留私有临时文件，不会自动删除或改用覆盖操作。" : "未发布副本：源版本、目标或权限已变化；可能保留私有临时文件，不会自动删除。") : "未创建文件：目标不可用或操作繁忙。") : "文件可能已创建，但后续确认失败；不会重复创建或删除临时残留。";
    } finally { if (duplicate || s.status !== "unknown") lease?.release(); s.working = false; }
  }
  const envelope = (requestId: string) => ({ protocolVersion: 1 as const, requestId });
  function refreshGrant(s: Slot) {
    if (s.snapshot && !host.documents.locations().some(location => location.handle === s.snapshot?.handle && location.documentId === s.snapshot.documentId)) {
      s.snapshot = undefined; s.released = true; s.status = "created"; s.message = "文件已创建；此前打开的标签已关闭或授权已撤销。";
    }
  }
  function response(requestId: string, s: Slot): CreateMarkdownResponse {
    refreshGrant(s);
    return { ...envelope(requestId), status: s.working ? "pending" : s.status, operation: s.operation, fileName: s.name, message: s.message, snapshot: s.snapshot, entryHandle: s.entryHandle, released: s.released, working: s.working };
  }
  return {
    busy: () => !!slot?.working,
    async request(value: unknown): Promise<CreateMarkdownResponse> {
      if (!validCreateMarkdownRequest(value)) return { ...envelope(""), status: "stale", operation: {session, sequence: highwater + 1} };
      const v: CreateMarkdownRequest = value;
      if (v.op === "create" && !!v.source !== duplicate) return {...envelope(v.requestId),status:"stale",operation:{session:v.session,sequence:v.sequence},working:false};
      if (v.op === "state") return { ...envelope(v.requestId), status: "state", session, sequence: highwater + 1 };
      if (v.op === "cancel-preview") { if (preview?.id === v.previewId) preview.active = false; return { ...envelope(v.requestId), status: "cancelled-preview", previewId: v.previewId }; }
      if (v.op === "preview") {
        if (preview) preview.active = false;
        const intent = {id: v.previewId, active: true}; preview = intent;
        const base = {...envelope(v.requestId), status: "preview" as const, previewId: v.previewId};
        const parsed = markdownFileName(v.name);
        if (!parsed.ok) return {...base, result: "invalid", message: parsed.message};
        try {
          if (disposed || slot?.working) throw Error();
          const target = await host.resolve(v.target);
          if (!target.showHidden && parsed.name.startsWith(".")) return {...base, result: "invalid", fileName: parsed.name, message: "请先开启该目录的隐藏文件显示。"};
          const names = v.suggest && duplicate ? new Set<string>() : undefined;
          const found = await equivalent(target, parsed.name, () => { if (disposed || !intent.active || preview !== intent || slot?.working) throw Error(); }, names);
          if(names){
            const match=/^(.*)(\.(?:md|markdown))$/i.exec(parsed.name)!;
            for(let i=1;i<=32769;i++){const name=`${match[1]} copy${i===1?"":` ${i}`}${match[2]}`;if(!markdownFileName(name).ok)throw Error("Name budget");if(!names.has(markdownNameKey(name)))return {...base,result:"available",fileName:name};}
            throw Error("Name budget");
          }
          return {...base, result: found ? "conflict" : "available", fileName: parsed.name};
        } catch { return {...base, result: "unavailable", fileName: parsed.name}; }
      }
      const operation = {session: v.session, sequence: v.sequence};
      const status = (state: CreateOutcome): CreateMarkdownResponse => ({...envelope(v.requestId), status: state, operation, working: false});
      if (disposed || v.session !== session) return status("stale");
      if (v.sequence <= highwater) return status(v.op === "query" || v.op === "ack" ? "acked" : "stale");
      if (slot && (slot.operation.sequence !== v.sequence || slot.operation.session !== v.session)) return status("busy");
      if (v.op === "create") {
        let versionKey: string | undefined;
        if (v.version?.kind === "buffer") {
          const bytes = new TextEncoder().encode(v.version.text);
          const digest = createHash("sha256").update(bytes).digest("hex");
          if (digest !== v.version.hash) return status("stale");
          versionKey = `buffer:${digest}:${bytes.length}`;
        } else if (v.version) versionKey = "disk";
        if (slot) return slot.versionKey === versionKey && JSON.stringify(slot.source) === JSON.stringify(v.source) && slot.rawName === v.name && slot.target.rootHandle === v.target.rootHandle && slot.target.generation === v.target.generation && slot.target.directoryHandle === v.target.directoryHandle ? response(v.requestId, slot) : status("stale");
        if (v.sequence !== highwater + 1) return status("stale");
        const parsed = markdownFileName(v.name);
        slot = {operation, source:v.source ? {...v.source}:undefined, versionKey, target: {...v.target}, rawName: v.name, name: parsed.ok ? parsed.name : v.name, status: parsed.ok ? "pending" : "rejected-before-create", message: parsed.ok ? undefined : parsed.message, working: parsed.ok};
        if (preview) preview.active = false;
        if (parsed.ok) await execute(slot, false, v.version);
        return response(v.requestId, slot);
      }
      if (!slot) return status("stale");
      const s = slot;
      refreshGrant(s);
      if (v.op === "query" || s.working) return response(v.requestId, s);
      if (v.op === "retry-open") { if (s.status === "created" && s.fingerprint && !s.released) { s.working = true; await execute(s, true); } return response(v.requestId, s); }
      if (v.op === "release-unpresented") {
        if (s.snapshot && !s.released) {
          s.working = true;
          try { const reply = await host.documents.release({ ...envelope(randomUUID()), handle: s.snapshot.handle }); if (!reply.ok && reply.error !== "INVALID_HANDLE") return status("busy"); s.snapshot = undefined; s.status = "created"; s.released = true; }
          finally { s.working = false; }
        }
        return response(v.requestId, s);
      }
      if (v.op === "ack") { if (s.status === "unknown" || s.status === "pending") return response(v.requestId, s); highwater = v.sequence; slot = undefined; return status("acked"); }
      return response(v.requestId, s);
    },
    dispose() { disposed = true; if (preview) preview.active = false; }
  };
}
