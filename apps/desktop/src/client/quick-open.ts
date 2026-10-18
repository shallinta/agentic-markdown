import type { createDocumentMRU } from "./document-mru";
import type { DocumentEntry, createDocumentController } from "./documents";
import { compareScore, matchField, normalizeQuery } from "./quick-open-match";
import type { createFolderWorkspace, FolderState } from "./workspace";
import type { createWorkspaceRootOrder } from "./workspace-root-order";

export interface QuickResult {
  key: string; name: string; path: string; rootName: string; score: number[]; order: number;
  target: { root: string; generation: number; entry: string } | { document: DocumentEntry };
}
interface QuickState { visible: boolean; scope: number; query: string; results: QuickResult[]; active: number; searching: boolean; message: string }
type Budget = NonNullable<ReturnType<ReturnType<typeof createFolderWorkspace>["acquireQueryBudget"]>>;
interface Job { token: number; roots?: FolderState; entries?: readonly DocumentEntry[]; seen: Set<string>; results: QuickResult[]; query: string[]; root: number; node: number; entry: number; bytes: number; lease: Budget; timer?: ReturnType<typeof setTimeout> }
export function createQuickOpen(folders: ReturnType<typeof createFolderWorkspace>, documents: ReturnType<typeof createDocumentController>, order?: ReturnType<typeof createWorkspaceRootOrder>, mru?: ReturnType<typeof createDocumentMRU>) {
  let state: QuickState = { visible: false, scope: 0, query: "", results: [], active: 0, searching: false, message: "输入文件名或路径" };
  let epoch = 0, intent = 0, disposed = false, job: Job | undefined;
  let focusTicket: { intent: number; scope: number; closed: boolean; documentId?: string } | undefined;
  const tryFocus = () => {
    const ticket=focusTicket;
    if(!ticket||!ticket.closed||!ticket.documentId)return;
    focusTicket=undefined;
    if(disposed||intent!==ticket.intent||state.visible)return;
    if(documents.focusQuickDocument(ticket.documentId)==="missing")focusTicket=ticket;
  };
  let unsubscribeFocus: (()=>void)|undefined=documents.subscribeQuickFocus(tryFocus);
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<QuickState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const clear = () => {
    epoch++;
    if (job) { clearTimeout(job.timer); job.roots = undefined; job.entries = undefined; job.results = []; job.query = []; job.seen.clear(); job.lease.release(); job = undefined; }
    publish({results:[],active:0,searching:false});
  };
  const rank = (item: Omit<QuickResult, "score">) => mru?.getSnapshot().items.find(record => "root" in item.target ? record.kind === "root" && record.root === item.target.root && record.generation === item.target.generation && record.entry === item.target.entry : record.kind === "standalone" && record.handle === item.target.document.handle && record.documentId === item.target.document.documentId)?.rank ?? -1;
  const compare = (a: QuickResult,b: QuickResult) => compareScore(a.score,b.score) || rank(b)-rank(a) || a.order-b.order || (a.path<b.path?-1:a.path>b.path?1:0) || (a.key<b.key?-1:a.key>b.key?1:0);
  function add(j: Job, item: Omit<QuickResult,"score">) {
    // Empty queries have at most 20 resolved targets: do not allocate a seen
    // entry for every unrelated file while walking the existing paged metadata.
    if (!j.query.length && rank(item) < 0) return;
    const independent="document" in item.target;
    if("document" in item.target&&j.roots?.coveredHandles.includes(item.target.document.handle)&&j.seen.has(item.path))return;
    const key=independent?`document:${item.key}`:item.path;
    if(j.seen.has(key)) return;
    j.bytes += 96 + key.length*2; j.seen.add(key);
    if(!j.lease.reserve(j.bytes + 262144)) throw Error("budget");
    const name=j.query.length?matchField(j.query,item.name,0):[0,0,0,0,0],path=j.query.length?matchField(j.query,item.path,1):null;
    const score=name&&path?(compareScore(name,path)<=0?name:path):name??path;
    if(!score)return;
    j.bytes+=256;
    if(!j.lease.reserve(j.bytes+262144))throw Error("budget");
    const orderKey="root" in item.target?`root:${item.target.root}`:`file:${item.target.document.locationId??item.target.document.documentId}`;
    const displayOrder=order?.getSnapshot().indexOf(orderKey)??-1;
    if(displayOrder>=0)item.order=displayOrder;
    const result={...item,score};let lo=0,hi=j.results.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(compare(j.results[mid],result)<=0)lo=mid+1;else hi=mid;}
    j.results.splice(lo,0,result);
  }
  function step(j: Job) {
    if(disposed||job!==j||j.token!==epoch||!j.lease.current()||!j.roots||!j.entries)return;
    j.timer=undefined;
    if(!j.lease.runnable())return;
    try {
      let remaining=128;
      while(remaining-- >0){
        const root=j.roots.roots[j.root];
        if(root){const node=j.roots.nodes[root.handle]?.[j.node++];if(!node){j.root++;j.node=0;continue;}if(node.kind==="file")add(j,{key:`${root.handle}:${node.handle}`,name:node.name,path:node.displayPath,rootName:root.name,order:j.root,target:{root:root.handle,generation:root.generation,entry:node.handle}});}
        else {const entry=j.entries[j.entry++];if(!entry){publish({results:j.results,searching:false,message:mru?.getSnapshot().message || (j.roots.roots.some(r=>r.status!=="complete")?"仅显示当前已发现的文件；目录尚未完整扫描。":j.results.length?"":j.query.length?"没有匹配的文件":"暂无当前窗口可用的最近文档")});return;}if(entry.explicitStandalone!==false)add(j,{key:entry.handle,name:entry.fileName,path:entry.displayPath??entry.fileName,rootName:"独立文件",order:j.roots.roots.length,target:{document:entry}});}
      }
      j.timer=setTimeout(()=>step(j),0);
    }catch{clear();publish({message:"查询预算不足，请缩小工作区后重试。"});}
  }
  function search() {
    clear();if(disposed||!state.visible)return;
    const normalized=normalizeQuery(state.query);
    if(normalized===null){publish({message:"查询过长（最多 4096 个 UTF-16 单位），未执行查询。"});return;}
    if(!normalized && (!mru?.getSnapshot().items.length)){publish({message:mru ? mru.getSnapshot().message || "暂无当前窗口可用的最近文档" : "输入文件名或路径"});return;}
    const lease=folders.acquireQueryBudget(()=>{clear();publish({message:"文件集合更新中，请稍候。"});});
    if(!lease){publish({message:"文件集合暂不可确认，请刷新后重试。"});return;}
    const bytes=normalized.length*64+1024;
    if(!lease.reserve(bytes+262144)){lease.release();publish({message:"查询预算不足，请缩小工作区后重试。"});return;}
    const next: Job={token:epoch,roots:folders.getSnapshot(),entries:documents.getSnapshot().entries,seen:new Set(),results:[],query:Array.from(normalized),root:0,node:0,entry:0,bytes,lease};
    job=next;publish({searching:true,message:"正在查找…"});next.timer=setTimeout(()=>step(next),0);
  }
  let unsubscribeFolders: (()=>void)|undefined=folders.subscribe(search);
  const availabilityChanged=()=>{
    if(disposed||!state.visible||!folders.queryAvailable())return;
    if(job?.lease.current()){
      if(state.searching&&job.timer===undefined){const pending=job;pending.timer=setTimeout(()=>step(pending),0);}
    }else search();
  };
  let unsubscribeAvailability: (()=>void)|undefined=folders.subscribeQueryAvailability(availabilityChanged);
  let entries=documents.getSnapshot().entries;
  const changedDocuments=()=>{if(focusTicket?.documentId&&documents.getSnapshot().snapshot?.documentId!==focusTicket.documentId)focusTicket=undefined;const next=documents.getSnapshot().entries;if(next!==entries){entries=next;search();}};
  let unsubscribeDocuments: (()=>void)|undefined=documents.subscribe(changedDocuments);
  let unsubscribeOrder=order?.subscribe(search);
  let unsubscribeMRU=mru?.subscribe(search);
  return {
    subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},getSnapshot:()=>state,
    canOpen:()=>!disposed&&documents.canSelectFolder(),
    attach(){disposed=false;unsubscribeFocus??=documents.subscribeQuickFocus(tryFocus);unsubscribeFolders??=folders.subscribe(search);unsubscribeAvailability??=folders.subscribeQueryAvailability(availabilityChanged);unsubscribeDocuments??=documents.subscribe(changedDocuments);unsubscribeOrder??=order?.subscribe(search);unsubscribeMRU??=mru?.subscribe(search);},
    open(){if(disposed||!documents.canSelectFolder())return;intent++;focusTicket=undefined;publish({visible:true,scope:state.scope+1,query:""});mru?.refresh();search();},
    close(){intent++;focusTicket=undefined;clear();publish({visible:false});},
    scopeClosed(scope:number){if(focusTicket?.scope===scope){focusTicket.closed=true;tryFocus();}},
    setQuery(query:string){publish({query});search();},
    move(index:number){publish({active:Math.max(0,Math.min(state.results.length-1,index))});},
    async choose(index=state.active){
      const selected=state.results[index],captured=folders.getSnapshot(),docEntries=documents.getSnapshot().entries;
      if(!selected||state.searching||!job?.lease.runnable()||!folders.queryAvailable()||!documents.canSelectFolder())return;
      const own=++intent,version=folders.queryVersion();
      const ticket={intent:own,scope:state.scope,closed:false,documentId:undefined as string|undefined};focusTicket=ticket;
      let admitted=false;
      const current=()=>{const valid=!disposed&&intent===own&&folders.queryAvailable()&&folders.queryVersion()===version&&folders.getSnapshot()===captured&&documents.getSnapshot().entries===docEntries;admitted=valid;return valid;};
      clear();publish({visible:false});
      try {
        if(!documents.canSelectFolder()){focusTicket=undefined;return;}
        if("document" in selected.target)await documents.activate(selected.target.document,current);
        else {const target=selected.target;const existing=docEntries.find(e=>e.displayPath===selected.path);if(existing)await documents.activate(existing,current);else await documents.openWorkspaceEntry(target.root,target.entry,current);}
        const snapshot=documents.getSnapshot().snapshot;
        if(focusTicket!==ticket)return;
        if(!admitted||!snapshot||documents.getSnapshot().error||("document" in selected.target?snapshot.documentId!==selected.target.document.documentId:snapshot.displayPath!==selected.path)){focusTicket=undefined;return;}
        ticket.documentId=snapshot.documentId;tryFocus();
      }catch(error){if(focusTicket===ticket)focusTicket=undefined;throw error;}
    },
    dispose(){disposed=true;intent++;focusTicket=undefined;unsubscribeFocus?.();unsubscribeFocus=undefined;clear();unsubscribeFolders?.();unsubscribeAvailability?.();unsubscribeDocuments?.();unsubscribeOrder?.();unsubscribeMRU?.();unsubscribeFolders=undefined;unsubscribeAvailability=undefined;unsubscribeDocuments=undefined;unsubscribeOrder=undefined;unsubscribeMRU=undefined;listeners.clear();},
  };
}
