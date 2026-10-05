import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { documentCapabilitySuffix } from "@/client/document-status-label";
import type { DocumentEntry } from "@/client/documents";
import { releaseTreeEditorSelection } from "@/client/tree-editor-selection";
import type { createFolderWorkspace, FolderState } from "@/client/workspace";
import { rootControlHandlers } from "@/client/workspace-root-control";
import {
  projectWorkspaceTree,
  treeExpanded,
  treeFocusFallback,
  treeKeyAction,
  visibleWorkspaceItems,
  type TreeItem,
} from "@/client/workspace-tree-model";
import type { WorkspaceNode } from "@/shared/workspace";

export function WorkspaceTree({
  folders,
  state,
  entries,
  activeHandle,
  disabled,
  standaloneDisabled,
  runAction,
  runRescan,
  open,
  openStandalone,
  setHidden,
}: {
  folders: ReturnType<typeof createFolderWorkspace>;
  state: FolderState;
  entries: readonly DocumentEntry[];
  activeHandle?: string;
  disabled: boolean;
  standaloneDisabled: boolean;
  runAction: (action: () => void | Promise<void>) => void | Promise<void>;
  runRescan: (action: () => void | Promise<void>) => void | Promise<void>;
  open: (root: string, node: WorkspaceNode) => void;
  openStandalone: (entry: DocumentEntry) => void;
  setHidden: (root: string, showHidden: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedRoots, setCollapsedRoots] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const model = useMemo(
    () =>
      projectWorkspaceTree(
        state.roots,
        state.nodes,
        state.coveredHandles,
        entries
      ),
    [state.roots, state.nodes, state.coveredHandles, entries]
  );
  const visible = useMemo(
    () => visibleWorkspaceItems(model, expanded, collapsedRoots),
    [model, expanded, collapsedRoots]
  );
  const available = useMemo(
    () =>
      visible.filter((item) =>
        item.kind === "standalone" ? !standaloneDisabled : !disabled
      ),
    [visible, disabled, standaloneDisabled]
  );
  const tabStop =
    available.find((item) => item.key === selected)?.key ?? available[0]?.key;
  const container = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLLIElement>());
  const focused = useRef<{ item: TreeItem; element: HTMLLIElement } | null>(
    null
  );
  const current = useRef(model);
  current.current = model;
  const previousModel = useRef(model);
  const focus = (key: string | null) => {
    setSelected(key);
    if (key) buttons.current.get(key)?.focus();
    else container.current?.focus();
  };
  useLayoutEffect(() => {
    const oldModel = previousModel.current;
    previousModel.current = model;
    setExpanded((old) => {
      const next = new Set([...old].filter((key) => model.items.has(key)));
      return next.size === old.size ? old : next;
    });
    setCollapsedRoots((old) => {
      const next = new Set([...old].filter((key) => model.items.has(key)));
      return next.size === old.size ? old : next;
    });
    if (selected && !visible.some((item) => item.key === selected))
      setSelected(treeFocusFallback(oldModel.items.get(selected), visible));
    const prior = focused.current;
    // Repair only focus lost through removal, never focus held by an editor or switch.
    if (
      prior &&
      !prior.element.isConnected &&
      (document.activeElement === document.body ||
        document.activeElement === container.current)
    ) {
      focused.current = null;
      focus(treeFocusFallback(prior.item, available));
    }
  }, [model, visible, available, selected]);
  useLayoutEffect(() => {
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target)
      )
        focused.current = null;
    };
    document.addEventListener("focusin", outside);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      document.removeEventListener("focusin", outside);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, []);
  const toggle = (item: TreeItem) => {
    if (disabled || !item.directory) return;
    const desired = !treeExpanded(item, expanded, collapsedRoots);
    void runAction(async () => {
      if (item.kind === "node")
        await folders.prioritize(item.root.handle, item.node.handle);
      const live = current.current.items.get(item.key);
      if (
        !live ||
        (item.kind === "node" &&
          (live.kind !== "node" ||
            live.root.generation !== item.root.generation))
      )
        return;
      if (item.kind === "root")
        setCollapsedRoots((old) => {
          const next = new Set(old);
          if (desired) next.delete(item.key);
          else next.add(item.key);
          return next;
        });
      else
        setExpanded((old) => {
          const next = new Set(old);
          if (desired) next.add(item.key);
          else next.delete(item.key);
          return next;
        });
    })?.catch(() => undefined);
  };
  const activate = (item: TreeItem) => {
    if (item.kind === "standalone" ? standaloneDisabled : disabled) return;
    if (item.directory) toggle(item);
    else if (item.kind === "standalone") openStandalone(item.entry);
    else if (item.kind === "node") open(item.root.handle, item.node);
  };
  return (
    <div
      ref={container}
      tabIndex={-1}
      className="min-h-0 flex-1 overflow-auto"
      onFocusCapture={(event) => {
        releaseTreeEditorSelection(event.currentTarget, event.target);
        const key = (event.target as HTMLElement).dataset.treeKey;
        const item = key && model.items.get(key);
        focused.current =
          item && event.target instanceof HTMLLIElement
            ? { item, element: event.target }
            : null;
        if (item) setSelected(item.key);
      }}
    >
      {state.error && (
        <p role="alert" className="text-destructive text-xs">
          {state.error}
        </p>
      )}
      <ul role="tree" aria-label="工作区 Markdown 文件树">
        {visible.map((item) => {
          const isExpanded = treeExpanded(item, expanded, collapsedRoots);
          return (
            <li
              key={item.key}
              ref={(element) => {
                if (element) buttons.current.set(item.key, element);
                else buttons.current.delete(item.key);
              }}
              data-tree-key={item.key}
              role="treeitem"
              aria-level={item.level}
              tabIndex={item.key === tabStop ? 0 : -1}
              aria-selected={selected === item.key}
              aria-expanded={item.directory ? isExpanded : undefined}
              aria-current={
                item.kind === "standalone" && activeHandle === item.entry.handle
                  ? "page"
                  : undefined
              }
              aria-disabled={
                item.kind === "standalone" ? standaloneDisabled : disabled
              }
              aria-label={
                item.name +
                (item.kind === "standalone"
                  ? documentCapabilitySuffix(item.entry.writeCapability)
                  : "")
              }
              className="aria-selected:bg-muted focus-visible:outline-ring rounded text-sm focus-visible:outline-2 aria-disabled:opacity-50"
              onClick={(event) => {
                if (
                  event.target instanceof HTMLElement &&
                  event.target.closest("button")
                )
                  return;
                if (item.kind === "standalone" ? standaloneDisabled : disabled)
                  return;
                focus(item.key);
              }}
              onDoubleClick={(event) => {
                if (
                  event.target instanceof HTMLElement &&
                  event.target.closest("button")
                )
                  return;
                activate(item);
              }}
              onKeyDown={(event) => {
                if (
                  event.target !== event.currentTarget ||
                  (item.kind === "standalone"
                    ? standaloneDisabled
                    : disabled) ||
                  event.nativeEvent.isComposing
                )
                  return;
                const action = treeKeyAction(
                  available,
                  item.key,
                  event.key,
                  isExpanded
                );
                if (!action) return;
                event.preventDefault();
                if (action.kind === "focus") focus(action.key);
                else activate(item);
              }}
            >
              <div className="flex items-center gap-1">
                <span
                  title={item.path}
                  className="hover:bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 text-left"
                  style={{ paddingLeft: item.level * 12 }}
                >
                  {item.directory ? (isExpanded ? "▾ " : "▸ ") : ""}
                  {item.name}
                  {item.kind === "standalone"
                    ? documentCapabilitySuffix(item.entry.writeCapability)
                    : ""}
                </span>
                {item.kind === "root" && (
                  <>
                    <button
                      disabled={disabled}
                      aria-disabled={disabled || state.busy}
                      role="switch"
                      aria-checked={item.root.showHidden === true}
                      aria-label={`${item.name}：显示隐藏文件`}
                      className="hover:bg-muted focus-visible:outline-ring shrink-0 rounded border px-1 text-xs focus-visible:outline-2 aria-disabled:opacity-50"
                      {...rootControlHandlers(
                        disabled,
                        () => folders.getSnapshot().busy,
                        () => setHidden(item.root.handle, !item.root.showHidden)
                      )}
                    >
                      {item.root.showHidden ? "隐藏：显示" : "隐藏：不显示"}
                    </button>
                    <button
                      disabled={disabled}
                      aria-disabled={disabled || state.busy}
                      aria-label={`${item.name}：重新扫描`}
                      className="hover:bg-muted focus-visible:outline-ring shrink-0 rounded border px-1 text-xs focus-visible:outline-2 aria-disabled:opacity-50"
                      {...rootControlHandlers(
                        disabled,
                        () => folders.getSnapshot().busy,
                        () => {
                          void runRescan(() =>
                            folders.rescan(item.root.handle)
                          )?.catch(() => undefined);
                        }
                      )}
                    >
                      重新扫描
                    </button>
                  </>
                )}
              </div>
              {item.kind === "root" && (
                <p role="status" className="text-muted-foreground px-3 text-xs">
                  {
                    {
                      scanning: "扫描中…",
                      complete: "扫描完成",
                      partial: "部分项目无法访问，结果未完整",
                      paused: "扫描已暂停，结果未完成；可重新扫描",
                      failed: "扫描失败，请重新扫描",
                    }[item.root.status]
                  }
                  {item.root.observation &&
                    ` · ${{ establishing: "正在建立自动观察", watching: "自动观察中", limited: "自动观察受限，请手动重新扫描", unavailable: "目录后台已停止，请重新启动应用" }[item.root.observation]}`}
                  {item.root.status === "complete" &&
                  !state.nodes[item.root.handle]?.length
                    ? " · 没有可显示的 Markdown 文档"
                    : ""}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {!visible.length && (
        <p className="text-muted-foreground text-xs">打开的文件将在这里显示</p>
      )}
    </div>
  );
}
