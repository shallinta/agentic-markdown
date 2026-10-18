import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@agentic-markdown/ui/ui/dialog";

import type {
  createMarkdownController,
  CreateMarkdownState,
} from "../client/create-markdown";
import type { FolderState } from "../client/workspace";
import { markdownFileName } from "../shared/create-markdown";

export function CreateMarkdownDialog({
  controller,
  state,
  folders,
  duplicate = false,
}: {
  controller: ReturnType<typeof createMarkdownController>;
  state: CreateMarkdownState;
  folders: FolderState;
  duplicate?: boolean;
}) {
  const root = folders.roots.find(
    (item) => item.handle === state.target?.rootHandle
  );
  const directory =
    root && state.target?.directoryHandle
      ? folders.nodes[root.handle]?.find(
          (item) => item.handle === state.target?.directoryHandle
        )
      : undefined;
  const name = markdownFileName(state.name);
  const pending = controller.hasPending();
  const button =
    "hover:bg-muted focus-visible:outline-ring rounded border px-3 py-2 text-sm disabled:opacity-50";
  return (
    <Dialog
      open={state.visible}
      onOpenChange={(open) => {
        if (!open) void controller.close();
      }}
    >
      <DialogContent>
        <DialogTitle>{duplicate ? "复制当前已保存文档" : "新建 Markdown 文件"}</DialogTitle>
        <DialogDescription>
          {duplicate ? "复制磁盘中已保存的完整内容，源文档保持不变，不覆盖已有项目。图片等资产不复制，相对链接不改写；更换目录后链接可能失效。" : "在已授权目录中创建空白文件，不覆盖已有项目。"}
        </DialogDescription>
        {duplicate && <p className="text-sm break-all">源文件：{state.sourceName}</p>}
        <label className="grid gap-2 text-sm">
          目标目录
          <select
            aria-label={duplicate ? "副本目标目录" : "新建文件目标目录"}
            className="bg-background rounded border p-2"
            disabled={state.busy || pending}
            value={root ? root.handle : ""}
            onChange={(event) => {
              const target = folders.roots.find(
                (item) => item.handle === event.target.value
              );
              controller.setTarget(
                target
                  ? { rootHandle: target.handle, generation: target.generation }
                  : null
              );
            }}
          >
            <option value="">请选择已授权目录</option>
            {folders.roots.map((item) => (
              <option key={item.handle} value={item.handle}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {root && (
          <p className="text-muted-foreground text-sm break-all">
            位置：{directory?.displayPath ?? root.displayPath}
          </p>
        )}
        <label className="grid gap-2 text-sm">
          文件名
          <input
            autoFocus
            aria-label={duplicate ? "副本文件名" : "新建文件名"}
            className="bg-background rounded border p-2"
            value={state.name}
            disabled={state.busy || pending}
            onChange={(event) => controller.setName(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                state.preview === "available" &&
                !pending
              ) {
                event.preventDefault();
                void controller.create();
              }
            }}
          />
        </label>
        {name.ok && (
          <p className="text-muted-foreground text-sm break-all">
            最终文件名：{name.name}
          </p>
        )}
        {state.preview === "checking" && !pending && (
          <p role="status" className="text-sm">
            正在检查名称…
          </p>
        )}
        {state.message && (
          <p role="status" className="text-sm">
            {state.message}
          </p>
        )}
        {state.receipt?.status === "created" && (
          <p className="text-sm">
            文件已创建，尚未完成打开。关闭不会删除磁盘文件。
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button className={button} onClick={() => void controller.close()}>
            {pending ? "关闭提示" : "取消"}
          </button>
          {!pending && (
            <button
              className={button}
              disabled={state.busy || state.preview !== "available"}
              onClick={() => void controller.create()}
            >
              {duplicate ? "复制并打开" : "创建并打开"}
            </button>
          )}
          {pending && (
            <button
              className={button}
              disabled={state.busy}
              onClick={() => void controller.query()}
            >
              查询结果
            </button>
          )}
          {pending &&
            (state.receipt?.status === "created" ||
              state.receipt?.status === "opened") &&
            !state.receipt.released && (
              <button
                className={button}
                disabled={state.busy}
                onClick={() => void controller.retry()}
              >
                重试打开
              </button>
            )}
          {!pending && state.preview === "unavailable" && (
            <button className={button} onClick={controller.check}>
              重新检查
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
