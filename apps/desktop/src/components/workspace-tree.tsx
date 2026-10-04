import { useMemo, useState } from "react";

import type { createFolderWorkspace, FolderState } from "@/client/workspace";
import type { WorkspaceNode } from "@/shared/workspace";

export function WorkspaceTree({
  folders,
  state,
  disabled,
  runAction,
  open,
  setHidden,
}: {
  folders: ReturnType<typeof createFolderWorkspace>;
  state: FolderState;
  disabled: boolean;
  runAction: (action: () => void | Promise<void>) => void | Promise<void>;
  open: (root: string, node: WorkspaceNode) => void;
  setHidden: (root: string, showHidden: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const identity = state.roots
    .map((root) => `${root.handle}:${root.generation}`)
    .join("|");
  const [previousIdentity, setPreviousIdentity] = useState(identity);
  if (identity !== previousIdentity) {
    const live = new Set(
      Object.values(state.nodes).flatMap((nodes) =>
        nodes.map((node) => node.handle)
      )
    );
    setPreviousIdentity(identity);
    setExpanded(
      (previous) => new Set([...previous].filter((handle) => live.has(handle)))
    );
    setSelected((previous) =>
      previous && live.has(previous) ? previous : null
    );
  }
  const children = useMemo(() => {
    const result = new Map<string, WorkspaceNode[]>();
    for (const nodes of Object.values(state.nodes))
      for (const node of nodes) {
        const siblings = result.get(node.parent) ?? [];
        siblings.push(node);
        result.set(node.parent, siblings);
      }
    return result;
  }, [state.nodes]);
  const toggle = (root: string, entry: string) => {
    void runAction(async () => {
      await folders.prioritize(root, entry);
      setExpanded((previous) => {
        const next = new Set(previous);
        if (next.has(entry)) next.delete(entry);
        else next.add(entry);
        return next;
      });
    })?.catch(() => undefined);
  };
  return (
    <div className="min-h-0 overflow-auto">
      {state.error && (
        <p role="alert" className="text-destructive text-xs">
          {state.error}
        </p>
      )}
      {state.roots.map((root) => {
        const nodes = state.nodes[root.handle] ?? [];
        const render = (parent: string, depth: number) =>
          (children.get(parent) ?? []).map((node) => (
            <li key={node.handle} role="none">
              <button
                role="treeitem"
                aria-level={depth}
                aria-selected={selected === node.handle}
                aria-expanded={
                  node.kind === "directory"
                    ? expanded.has(node.handle)
                    : undefined
                }
                disabled={disabled}
                title={node.displayPath}
                className="hover:bg-muted aria-selected:bg-muted focus-visible:outline-ring w-full truncate rounded px-2 py-1 text-left text-sm focus-visible:outline-2 disabled:opacity-50"
                style={{ paddingLeft: depth * 12 }}
                onClick={() => setSelected(node.handle)}
                onDoubleClick={() =>
                  node.kind === "file"
                    ? open(root.handle, node)
                    : toggle(root.handle, node.handle)
                }
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (node.kind === "file") open(root.handle, node);
                    else toggle(root.handle, node.handle);
                  } else if (
                    event.key === "ArrowRight" &&
                    node.kind === "directory" &&
                    !expanded.has(node.handle)
                  ) {
                    event.preventDefault();
                    toggle(root.handle, node.handle);
                  } else if (
                    event.key === "ArrowLeft" &&
                    node.kind === "directory" &&
                    expanded.has(node.handle)
                  ) {
                    event.preventDefault();
                    toggle(root.handle, node.handle);
                  } else if (
                    event.key === "ArrowDown" ||
                    event.key === "ArrowUp"
                  ) {
                    event.preventDefault();
                    const items = Array.from(
                      event.currentTarget
                        .closest('[role="tree"]')!
                        .querySelectorAll<HTMLButtonElement>(
                          '[role="treeitem"]'
                        )
                    );
                    const next =
                      items[
                        items.indexOf(event.currentTarget) +
                          (event.key === "ArrowDown" ? 1 : -1)
                      ];
                    next?.focus();
                    next?.click();
                  }
                }}
              >
                {node.kind === "directory"
                  ? expanded.has(node.handle)
                    ? "▾ "
                    : "▸ "
                  : ""}
                {node.name}
              </button>
              {node.kind === "directory" && expanded.has(node.handle) && (
                <ul role="group">{render(node.handle, depth + 1)}</ul>
              )}
            </li>
          ));
        return (
          <section key={root.handle} className="mb-3">
            <div className="flex items-center gap-2">
              <h3
                className="min-w-0 flex-1 truncate text-sm"
                title={root.displayPath}
              >
                {root.name}
              </h3>
              <button
                disabled={disabled || state.busy}
                role="switch"
                aria-checked={root.showHidden === true}
                aria-label={`${root.name}：显示隐藏文件`}
                className="hover:bg-muted focus-visible:outline-ring rounded border px-1 text-xs focus-visible:outline-2 disabled:opacity-50"
                onClick={() => setHidden(root.handle, !root.showHidden)}
              >
                {root.showHidden ? "隐藏：显示" : "隐藏：不显示"}
              </button>
              <button
                disabled={disabled || state.busy}
                className="hover:bg-muted rounded border px-1 text-xs disabled:opacity-50"
                onClick={() => {
                  void runAction(() => folders.rescan(root.handle))?.catch(
                    () => undefined
                  );
                }}
              >
                重新扫描
              </button>
            </div>
            <p role="status" className="text-muted-foreground text-xs">
              {
                {
                  scanning: "扫描中…",
                  complete: "扫描完成",
                  partial: "部分项目无法访问，结果未完整",
                  paused: "扫描已暂停，结果未完成；可重新扫描",
                  failed: "扫描失败，请重新扫描",
                }[root.status]
              }
            </p>
            {nodes.length ? (
              <ul role="tree" aria-label={root.name}>
                {render(root.handle, 1)}
              </ul>
            ) : root.status === "complete" ? (
              <p className="text-muted-foreground text-xs">
                没有可显示的 Markdown 文档
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
