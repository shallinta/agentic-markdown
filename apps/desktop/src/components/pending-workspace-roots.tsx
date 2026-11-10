import type { WorkspaceRootRosterState } from "@/client/workspace-root-roster";
import type { RootRosterFailure } from "@/shared/root-roster";

const failureText: Record<RootRosterFailure, string> = {
  legacy: "上次目录记录使用旧格式，已保留原记录。",
  future: "上次目录记录来自较新版本，已保留原记录。",
  corrupt: "上次目录记录损坏，已保留原记录。",
  "too-large": "上次目录记录超过大小限制，已保留原记录。",
  io: "无法读取或保存上次目录记录，请重试。",
  capacity: "上次目录记录已满。移除一条待授权记录后可再保存。",
  invalid: "这条目录记录已不可用，请重新读取。",
  closed: "上次目录记录暂不可用，请重试。",
  "queue-full": "上次目录记录操作繁忙，请重试。",
  unknown: "未能确认上次目录记录已保存。",
  busy: "上次目录记录操作繁忙，请重试。",
};

const buttonClass =
  "hover:bg-muted focus-visible:outline-ring rounded border px-2 py-1 text-xs focus-visible:outline-2 disabled:opacity-50";

export function canClearPendingWorkspaceRoots(state: WorkspaceRootRosterState) {
  return state.pending.length > 0 && !state.readOnly && !state.busy;
}

export function PendingWorkspaceRoots({
  state,
  disabled,
  canReselect,
  reselect,
  remove,
  refresh,
}: {
  state: WorkspaceRootRosterState;
  disabled: boolean;
  canReselect: boolean;
  reselect: () => void;
  remove: (id: string) => void;
  refresh: () => void;
}) {
  if (!state.pending.length && !state.failure) return null;
  const actionsDisabled = disabled || state.busy || state.readOnly;
  return (
    <section
      aria-label="待重新授权的目录"
      className="flex shrink-0 flex-col gap-2"
    >
      <h2 className="text-sm font-medium">待重新授权的目录</h2>
      {state.failure && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p role="status">
            {state.readOnly && state.failure === "io"
              ? "无法读取上次目录记录，重新启动后可再检查。"
              : failureText[state.failure]}
          </p>
          {!state.readOnly && (
            <button
              type="button"
              className={buttonClass}
              disabled={actionsDisabled}
              onClick={refresh}
            >
              重新读取记录
            </button>
          )}
        </div>
      )}
      {state.pending.length > 0 && (
        <>
          <p className="text-muted-foreground text-sm">
            {state.readOnly
              ? "可使用「加入文件夹」打开目录。"
              : "请在系统选择器中选中原目录，以重新授权。"}
          </p>
          <ul className="max-h-44 space-y-2 overflow-y-auto">
            {state.pending.map(({ id, name, path }) => (
              <li
                key={id}
                className="flex flex-wrap items-center gap-2 rounded border p-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm break-all">{name}</p>
                  <p className="text-muted-foreground text-xs break-all">
                    {path}
                  </p>
                </div>
                <button
                  type="button"
                  className={buttonClass}
                  aria-label={`重新选择目录 ${path}`}
                  disabled={!canReselect || actionsDisabled}
                  onClick={reselect}
                >
                  重新选择
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  aria-label={`移除目录记录 ${path}`}
                  disabled={actionsDisabled}
                  onClick={() => remove(id)}
                >
                  移除记录
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
