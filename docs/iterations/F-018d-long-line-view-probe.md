# F-018d：真实 EditorView 长行探针

> 状态：2026-09-27 授权 Agent 代验通过（alpha.32，本片范围）
> 日期：2026-09-27

## 2026-09-27 最终交付 alpha.32

### 2026-09-27 受托代验完成

用户授权 B/C/D 代验并确认已退出普通窗口后，Agent 在隔离数据目录 `/private/tmp/agentic-markdown-accept32.EWtGUD` 实际操作 alpha.32 的运行及取消。取消后显示“已取消；未完成项目不表示成功”，临时报告“尚未生成”；B 六行已结束，C 为 cancelled（测量值未完成，双方 pending 为 1），未把未完成项记通过。宿主可访问性树中无残留编辑器，“运行”恢复可用、“取消”禁用。

随后实际点击运行重跑，得到 [验收重跑报告](evidence/2026-09-27-alpha32-acceptance-rerun.json) 7/7 成功：B 原文/撤销一致、坐标偏差 0、合成 dispatch 2–20ms、双帧机会 22–37ms；C 1201ms 观察中正对照 2037 次 / 11ms，销毁后 0 次，原文/选区/历史一致。最后 `⌘Q` 已观察 App 退出。由此本片受托代验通过，不改写为用户亲验，不推广为真实键盘/IME/绘制延迟或全部生产调度性能。父功能和完整 OBL 仍开放；本次仅验证与文档，无代码、重新打包或 Git，版本仍 alpha.32。

### 构建阶段证据（历史，当时仍待验收）

- alpha.31 后仅格式调整，依规则递增并重新构建 alpha.32（hash `7d00qowzqtv4`），最终路径 `/private/tmp/agentic-markdown-batch32.lKGi3Y/Agentic Markdown-canary.app`。构建、归档核对、Lint/typecheck 通过，包内 Bun 487 项 / 3831 断言 / 75 文件，2.60 秒。
- 新包系统 WebView 隔离实验正常退出 0，[alpha.32 报告](evidence/2026-09-27-alpha32-editor-view-report.json) 7/7 成功；B dispatch 2–22ms、双帧机会 23–34ms、原文/撤销一致和坐标偏差 0；C 实际 1200ms、双方 pending、正对照 2037 次 / 13ms、销毁后 0 次、重建原文/选区/历史一致。均为有限合成观测，不证明真实输入、绘制或完整生产性能。
- 仍待人工验收，无 Git 操作。下方 alpha.31 结果保留历史，不改标为 alpha.32；取消操作未命中运行期的事实不变。

## 2026-09-27 alpha.31 历史批次证据（下方为当时状态）

- 最终交付 alpha.31（hash `1vguffajb6upe`）；`AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary` 成功并核对归档版本。alpha.30 曾构建成功，后因报告提交后取消提示修正而被 alpha.31 替代。
- `bun test` 本机 487 pass / 3831 断言 / 75 文件，2.87 秒；包内 Bun 1.4.0 同样 487 / 3831，2.35 秒；typecheck 通过。Lint 首次与构建并发扫描临时 `.cottontail-tmp` 失败，构建结束后重跑通过。独立规格/规范复核无剩余问题。
- [集中人工验收清单](2026-09-27-l2-followup-acceptance.md) 包含最终包路径、复验步骤和证据限制。仅进入待人工验收，不关闭父功能或开放 OBL，无 Git 操作。
- alpha.31 已真实启动系统 WebView 隔离探针，[报告](evidence/2026-09-27-alpha31-editor-view-report.json) B 六行全部成功：编辑/源码 × 10k/50k/200k，原文与撤销一致、坐标偏差 0；同步 dispatch 2–21ms，双帧机会 22–29ms，仅本次合成样本测量。
- 实验开关仅在 PERF_LAB 与 PERF_EDITOR 同时启用时进入，普通生产读写边界不变。取消若发生在报告已提交之后，后端可能已写入合成报告；界面明确说明，不承诺撤销已提交写入。实际手动取消/重跑尚未据此宣称通过。
> 用户授权本批 A → B → C → D 推进集中验收，本片 B；不授权 Git。

<!-- obligations: OBL-003 -->
<!-- deferred-obligations: none -->

## 功能与最小技术方案

- 仅实验入口创建真实 CM EditorView，使用 production createRawEditorState、现有软换行/解析策略与主题；普通生产文件仍限 1 MiB。不改策略或因探针修改用户文档。
- 编辑/源码两模式，各使用 10,000 / 50,000 / 200,000 UTF-16 单位合成长行，实际 UTF-8 bytes 校验小于等于 1 MiB。记录 View 创建、合成单字 dispatch、随后两次 requestAnimationFrame 回调机会、光标坐标反查及原文/撤销结果。
- 合成 dispatch 不是键盘输入、双帧回调不是已呈现证明；不把这些数值称真实键盘延迟、IME 体验或性能门槛。坐标缺失记 unsupported，保真/撤销失败记 failed，不输出正文。
- 每次销毁实验 View；取消清理 DOM/帧/定时器。只返回 PerfRow 数字/null，根负责显式实验开关、UI 和报告白名单，不自动启用。

## 继承约束检查

- F-002：本地合成样本、离线，不打开/覆盖真实文件，边界不变。
- 中文与外观：实验进度中文，样本含中文/BOM，主题继承；真实中文候选及主编辑器外观仍人工，数字不替代视觉。
- 命令与键盘：仅既有显式实验入口接线，不为生产新增编辑快捷键，实验不劫持主编辑器命令。
- 安全与日志：禁止正文/路径日志与资源执行，仅固定数字报告，异常不泄漏原始 error。

## 最小 happy path

1. 开关开启后运行六组真实 View，得到实际 bytes 和各阶段计时；原文与撤销一致。
2. 坐标反查有效，取消/失败能销毁实验 View；无 DOM 环境不得虚构结果。
3. 新包实际运行后由主任务追加真实报告；本地纯状态测试只覆盖辅助逻辑。

## 实施记录

2026-09-27：先落最小方案；尚无真实 DOM 运行结果。OBL-003 仅本探针部分，完整换行/token/单向/复制与大文档策略继续开放，父功能未完成。

### 实施与非 DOM 验证

- 新增 `editor-view-probe.ts`：顺序创建六个真实 View（240px 高、容器宽度），单字插入/滚动到光标、双帧机会、coordsAtPos/posAtCoords 与 undo；结束/异常/取消均销毁 View 并移除实验宿主。viewCreateMs 仅 EditorView 构造，不含先前 EditorState 创建；dispatchMs 为同步 dispatch，twoFramesMs 只计两次帧回调机会，不声称屏幕已呈现。
- metrics 固定：mode、lineUnits、viewCreateMs、dispatchMs、twoFramesMs、coordsAvailable、roundTripDelta、rawMatches、undoMatches；bytes 为真实合成 UTF-8 大小，未超过 1 MiB。无坐标/帧不可用 unsupported；原文/撤销/坐标反查不一致 failed，异常匿名。
- 辅助 `editor-view-probe.test.ts` 两项 / 12 断言通过，仅证明真实 parser 包装保真与结果判定，不构造 DOM、不冒充 View 实测。共享工作区当次全量 486 pass / 3815 断言 / 75 文件，2.95 秒（包含并行功能）；本片 ESLint/Prettier、typecheck、承接和差异检查通过。
- 根负责实验开关/UI/报告接线与真实新包运行；本轮尚未运行实际 DOM，不能报告长行 View 实测结果。未改版本、构建或 Git。
