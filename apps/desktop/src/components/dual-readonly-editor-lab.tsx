import { foldedRanges } from "@codemirror/language";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { createDualActiveEditorLab, createDualReadonlyEditorLab } from "@/client/dual-readonly-editor-lab";
import { rawText } from "@/client/raw-buffer";
import { CommandProvider, useCommands, useRegisterCommands } from "@/commands";

import { MemoryEditor } from "./memory-editor";

const buttonClass = "electrobun-webkit-app-region-no-drag rounded border px-2 py-1 focus-visible:outline-2 disabled:opacity-50";
type Fixture = Awaited<ReturnType<typeof createDualReadonlyEditorLab>>;

function firstVisibleLine(scroller: HTMLElement): string {
  const bounds = scroller.getBoundingClientRect();
  for (const line of scroller.querySelectorAll<HTMLElement>(".cm-line")) {
    const rect = line.getBoundingClientRect();
    if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue;
    const label = line.textContent?.trim();
    if (label) return `${label.slice(0, 28)}（距顶 ${Math.round((rect.top - bounds.top) * 100) / 100}px）`;
  }
  return "不可用";
}

export function DualReadonlyEditorLab({ draft = false }: { draft?: boolean }) {
  const [fixture, setFixture] = useState<Fixture>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let loaded: Fixture | undefined;
    const create = draft ? createDualActiveEditorLab : createDualReadonlyEditorLab;
    void create().then((value) => {
      if (cancelled) value.dispose();
      else {
        loaded = value;
        setFixture(value);
      }
    }, () => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      loaded?.dispose();
    };
  }, [draft]);

  const title = draft ? "双编辑器草稿实验" : "双编辑器只读实验";
  return (
    <section id="layout-lab-dual-editor" aria-label={title} className="space-y-2 rounded border p-2 text-sm">
      <h3 className="font-semibold">{title}</h3>
      <p>{draft ? "两篇文档均为合成草稿，只有活动编辑器可改正文，修改不会保存。" :
        "两篇合成正文同时挂载。通过按钮选择活动编辑器。"}</p>
      {failed ? <p role="alert">无法启动双编辑器实验。</p> : fixture ? (
        <CommandProvider><DualEditorViews fixture={fixture} draft={draft} /></CommandProvider>
      ) : <p role="status">正在准备合成正文…</p>}
    </section>
  );
}

function DualEditorViews({ fixture: { controller, documents }, draft }: { fixture: Fixture; draft: boolean }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const active = state.snapshot?.documentId;
  const [hidden, setHidden] = useState<string>();
  const [focusRequest, setFocusRequest] = useState<string>();
  const [focusResult, setFocusResult] = useState("");
  const [sample, setSample] = useState<{ count: number; details: string[] }>();
  const editorHosts = useRef<HTMLDivElement>(null);
  const identities = useRef(new WeakMap<HTMLElement, number>());
  const nextIdentity = useRef(1);
  const { executeCommand } = useCommands();
  useRegisterCommands({
    toggleHeadingFold: (action) => { controller.runEditorFold(action); },
    toggleCodeFold: (action) => { controller.runEditorFold({ ...action, kind: "fencedCode" }); },
    toggleFrontmatterFold: (action) => { controller.runEditorFold({ ...action, kind: "frontmatter" }); },
  }, true, {
    toggleHeadingFold: () => controller.canRunEditorFold(),
    toggleCodeFold: () => controller.canRunEditorFold("fencedCode"),
    toggleFrontmatterFold: () => controller.canRunEditorFold("frontmatter"),
  });
  useRegisterCommands({
    undoDocument: ({ documentId }) => { controller.runHistory("undo", documentId); },
    redoDocument: ({ documentId }) => { controller.runHistory("redo", documentId); },
  }, draft, { undoDocument: controller.canUndo, redoDocument: controller.canRedo });

  useLayoutEffect(() => {
    if (!focusRequest) return;
    setFocusResult(controller.focusQuickDocument(focusRequest) === "focused"
      ? "已请求聚焦活动编辑器" : "无法请求聚焦活动编辑器");
    setFocusRequest(undefined);
  }, [active, controller, focusRequest]);

  const captureViews = useCallback(() => {
    const hosts = editorHosts.current;
    if (!hosts) return;
    const editors = Array.from(hosts.querySelectorAll<HTMLElement>(".cm-editor[data-document-editor]"));
    const details = documents.map((document) => {
      const element = editors.find((editor) => editor.dataset.documentEditor === document.documentId);
      const editor = controller.getEditor(document.documentId)?.state;
      if (!element || !editor) return `${document.fileName} 未挂载`;
      let identity = identities.current.get(element);
      if (identity === undefined) {
        identity = nextIdentity.current++;
        identities.current.set(element, identity);
      }
      const scroller = element.querySelector<HTMLElement>(".cm-scroller");
      const scroll = scroller ? `${Math.round(scroller.scrollTop * 100) / 100} CSS px` : "不可用";
      const { anchor, head } = editor.selection.main;
      const focus = element.contains(element.ownerDocument.activeElement) ? "，有焦点" : "";
      const unchanged = editor.field(rawText) === document.text ? "正文一致" : "正文已变化";
      const top = scroller ? firstVisibleLine(scroller) : "不可用";
      const content = draft ? element.querySelector<HTMLElement>(".cm-content") : null;
      const writable = content ? `，DOM ${content.isContentEditable ? "可写" : "不可写"}` : "";
      return `${document.fileName} 视图 ${identity}，滚动 ${scroll}，选区 ${anchor} → ${head}，折叠 ${foldedRanges(editor).size}，${unchanged}${writable}${focus}，首个可见非空行 ${top}`;
    });
    setSample({ count: editors.length, details });
  }, [controller, documents, draft]);

  useLayoutEffect(() => {
    captureViews();
  }, [active, captureViews, focusRequest, hidden]);

  const background = documents.find(({ documentId }) => documentId !== active);
  const activeName = documents.find(({ documentId }) => documentId === active)?.fileName;
  return (
    <>
      <div className="flex flex-wrap gap-1" role="group" aria-label="双编辑器实验操作">
        {documents.map(({ documentId, fileName }) => (
          <button key={documentId} type="button" className={buttonClass} aria-pressed={active === documentId}
            disabled={hidden === documentId}
            onMouseDown={draft ? (event) => event.preventDefault() : undefined}
            onClick={() => {
              controller.activateTab(documentId);
              if (controller.getSnapshot().snapshot?.documentId === documentId) setFocusRequest(documentId);
              else setFocusResult("暂未切换编辑器，请完成或取消当前输入后重试。");
            }}>激活并聚焦 {fileName}</button>
        ))}
        <button type="button" className={buttonClass} disabled={!active}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => executeCommand({ type: "toggleHeadingFold", args: {} })}>折叠或展开活动标题</button>
        <button type="button" className={buttonClass} disabled={!background}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setHidden(hidden ? undefined : background?.documentId)}>
          {hidden ? "重新挂载非活动视图" : "卸载非活动视图"}
        </button>
        <button type="button" className={buttonClass} onMouseDown={(event) => event.preventDefault()}
          onClick={captureViews}>读取视图状态</button>
      </div>
      <p>活动编辑器 {activeName ?? "无"}</p>
      {focusResult && <p role="status">{focusResult}</p>}
      <div ref={editorHosts} className="grid grid-cols-2 gap-2">
        {documents.map(({ documentId, fileName }) => (
          <article key={documentId} aria-label={`编辑器 ${fileName}`} className="min-w-0 space-y-1 rounded border p-1">
            <h4 className="truncate font-medium">{fileName}（{draft && active === documentId ? "活动草稿" : "只读"}）</h4>
            {hidden === documentId ? <p>视图已卸载</p> : (
              <div className="flex h-36 min-w-0 flex-col">
                <MemoryEditor controller={controller} documentId={documentId} frozen={state.frozen || state.busy}
                  autoFocusOnMount={false} preserveViewportOnSync passive={draft && active !== documentId} />
              </div>
            )}
          </article>
        ))}
      </div>
      {sample && (
        <div role="group" aria-label="双编辑器视图采样" className="space-y-1 tabular-nums">
          <p>实际挂载 {sample.count} 个编辑器</p>
          {sample.details.map((line, index) => <p key={documents[index].documentId}>{line}</p>)}
        </div>
      )}
    </>
  );
}
