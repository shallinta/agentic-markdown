import { useLayoutEffect, useRef, useState } from "react";

import {
  applyDocumentRegionWorkspace,
  type DocumentRegionWorkspace,
  type DocumentRegionWorkspaceAction,
  type DocumentRegionWorkspaceReceipt,
} from "@/client/document-region-workspace";
import { SECONDARY_MIN_HEIGHT } from "@/client/secondary-pane-height";

const files = ["甲.md", "乙.md", "丙.md", "丁.md"].map((documentId) => ({ documentId }));
const buttonClass = "electrobun-webkit-app-region-no-drag rounded border px-2 py-1 focus-visible:outline-2";
const initial: DocumentRegionWorkspace = {
  main: [],
  secondary: [],
  secondaryHeights: [],
  secondaryHeight: 2 * SECONDARY_MIN_HEIGHT,
  secondaryOpen: false,
  activeRegion: null,
  mainActiveId: null,
};
const regionName = { main: "主区", secondary: "副区" } as const;
function describeReceipt(receipt: DocumentRegionWorkspaceReceipt) {
  switch (receipt.kind) {
    case "visibility":
      return receipt.expanded ? "已展开路由副区" : "已收起路由副区";
    case "blocked":
      return {
        "secondary-closed": "副区已收起，文档留在原区域",
        "secondary-full": "空间不足，文档留在原区域",
        "not-open": "文档尚未打开",
        invalid: "路由状态无效",
      }[receipt.reason];
    case "defer":
      return `${receipt.documentId} 保留在已收起的副区，归属不变`;
    case "opened":
      return receipt.notice === "secondary-full"
        ? `空间不足，已在主区域打开 ${receipt.documentId}`
        : `已在${regionName[receipt.region]}打开 ${receipt.documentId}`;
    case "activated":
      return `已在${regionName[receipt.region]}激活 ${receipt.documentId}`;
    case "moved":
      return `已将 ${receipt.documentId} 移入${regionName[receipt.region]}`;
  }
}

/** Isolated routing for synthetic IDs. Never connects to the workspace or editors. */
export function DocumentRegionWorkspaceLab() {
  const root = useRef<HTMLElement>(null);
  const [lab, setLab] = useState<{
    state: DocumentRegionWorkspace;
    receipt: DocumentRegionWorkspaceReceipt | null;
    restoreMoveFocus: boolean;
  }>({ state: initial, receipt: null, restoreMoveFocus: false });
  const { state, receipt, restoreMoveFocus } = lab;
  const act = (action: DocumentRegionWorkspaceAction, restoreMoveFocus = false) =>
    setLab((previous) => ({ ...applyDocumentRegionWorkspace(previous.state, action), restoreMoveFocus }));

  useLayoutEffect(() => {
    if (!restoreMoveFocus || receipt?.kind !== "moved") return;
    const attribute = `data-route-focus-${receipt.region}`;
    const candidates = root.current?.querySelectorAll<HTMLElement>(`[${attribute}]`);
    if (!candidates) return;
    Array.from(candidates).find((element) => element.getAttribute(attribute) === receipt.documentId)
      ?.focus();
  }, [receipt, restoreMoveFocus]);

  return (
    <section ref={root} aria-label="合成文档路由实验" className="space-y-2 rounded border p-2 text-sm">
      <h3 className="font-semibold">合成文档路由</h3>
      <p>实验副区总高 {state.secondaryHeight} CSS px。</p>
      <p>点击文件名，模拟在文件树双击打开。</p>
      <div className="flex flex-wrap gap-1" role="group" aria-label="模拟文件树双击">
        {files.map((document) => (
          <button key={document.documentId} type="button" className={buttonClass}
            aria-label={`模拟双击 ${document.documentId}`}
            onClick={() => act({ kind: "open", document })}>{document.documentId}</button>
        ))}
      </div>
      <button type="button" className={buttonClass} aria-expanded={state.secondaryOpen}
        aria-controls={state.secondaryOpen ? "layout-lab-route-secondary" : undefined}
        onClick={() => act({ kind: "visibility", expanded: !state.secondaryOpen })}>
        {state.secondaryOpen ? "收起路由副区" : "展开路由副区"}
      </button>
      <p>当前活动区域 {state.activeRegion ? regionName[state.activeRegion] : "无"}</p>
      {receipt && <p role="status">{describeReceipt(receipt)}</p>}

      <h4 className="font-medium">路由主区</h4>
      <p>主区活动标签 {state.mainActiveId ?? "无"}</p>
      {state.main.length === 0 ? <p>无文档</p> : (
        <ul aria-label="路由主区文档" className="space-y-1">
          {state.main.map((document) => (
            <li key={document.documentId} className="flex flex-wrap items-center gap-1">
              <button type="button" className={`${buttonClass} aria-pressed:bg-sidebar`}
                aria-label={`在路由主区激活 ${document.documentId}`}
                aria-pressed={state.mainActiveId === document.documentId}
                data-route-focus-main={document.documentId}
                onClick={() => act({ kind: "open", document })}>{document.documentId}</button>
              <button type="button" className={buttonClass} aria-label={`将 ${document.documentId} 移入路由副区`}
                onClick={(event) => act({ kind: "move", documentId: document.documentId, target: "secondary" },
                  event.currentTarget.ownerDocument.activeElement === event.currentTarget)}>移入副区</button>
            </li>
          ))}
        </ul>
      )}

      <h4 className="font-medium">路由副区</h4>
      {state.secondaryOpen ? (
        <ul id="layout-lab-route-secondary" aria-label="路由副区文档" className="bg-background ring-border overflow-clip rounded ring-1"
          style={{ height: state.secondaryHeight }}>
          {state.secondary.map(({ documentId }, index) => (
            <li key={documentId} tabIndex={-1} data-route-focus-secondary={documentId}
              className="flex flex-col focus-visible:outline-2 focus-visible:-outline-offset-2"
              style={{ height: state.secondaryHeights[index] }}>
              <div className="bg-sidebar flex shrink-0 items-center gap-1 px-1" style={{ height: SECONDARY_MIN_HEIGHT - 1 }}>
                <span className="min-w-0 grow truncate" title={documentId}>{documentId}</span>
                <span className="shrink-0 tabular-nums">{state.secondaryHeights[index]}px</span>
                <button type="button" className="electrobun-webkit-app-region-no-drag shrink-0 rounded border px-1 focus-visible:outline-2"
                  aria-label={`将 ${documentId} 移入路由主区`}
                  onClick={(event) => act({ kind: "move", documentId, target: "main" },
                    event.currentTarget.ownerDocument.activeElement === event.currentTarget)}>移出</button>
              </div>
              <div className="min-h-0 grow" aria-hidden="true" />
              <div className="bg-border h-px shrink-0" aria-hidden="true" />
            </li>
          ))}
        </ul>
      ) : (
        <div role="group" aria-label="已收起副区的归属诊断">
          <p>已收起，保留文档</p>
          <p className="tabular-nums">{state.secondary.map(({ documentId }, index) =>
            `${documentId}（${state.secondaryHeights[index]} CSS px）`).join("、") || "无"}</p>
        </div>
      )}
      {state.secondaryOpen && state.secondary.length === 0 && <p>副区为空</p>}
    </section>
  );
}
