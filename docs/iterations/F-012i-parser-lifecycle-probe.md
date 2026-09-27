# F-012i：真实 EditorView 解析生命周期探针

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
- alpha.31 系统 WebView [报告](evidence/2026-09-27-alpha31-editor-view-report.json) C 行成功：双方 pending 为 1，实际观察 1202ms，正对照 2037 次 advance / 22ms，销毁后 0 次；重建原文、选区、历史均一致。只说明本次有限窗口取消观察，不证明未来所有回调或全局调度责任已完成。
- 独立复核后将销毁后推进判定置于缺少正对照之前，失败不得降为 unsupported；报告提交后取消可能已经写入合成报告，提示已明确。真实手动取消交互仍未由自动报告证明。
> 用户授权本批 A → B → C → D 推进集中验收，本片 C；不授权 Git。

<!-- obligations: OBL-012 -->
<!-- deferred-obligations: OBL-020, OBL-041, OBL-068 -->

## 功能与最小技术方案

- 隔离实验中，以 MeasuredParser 包裹实际 editingMarkdown.parser，Prec.high 的独立 Language 仅加入实验 EditorState，不改全局解析器或生产策略。
- 两个真实 EditorView 作为正对照和销毁组：记录双方 pending 状态后销毁后者，设置 1200ms 观察定时器，记录正对照后续 advance 数量/耗时和销毁后 advance 数量/耗时；主线程繁忙可使实际观察更长。销毁后仍有推进优先判 failed，不因缺少正对照掩盖失败；未发生此失败但无 pending 或正对照无进展则为 unsupported，绝不以“零回调”单独宣称取消成功；不人为延迟 parser 或强制异步制造成功。
- 使用不超过 1 MiB 的合成多行原文，不配置新任务队列。重建 View 验证原文、选区和历史保留。旧 View 的 parser wrapper 仅记录固定计数，不把树引用移除说成 GC 字节释放。
- 同一 runEditorViewProbe 顺序运行 B/C，支持取消和最终清理；结果只数字/null，不输出原文/路径/原始异常。根负责开关、接线和持久化。

## 继承约束检查

- F-002：离线合成状态，不触真实用户文件或生产尺寸上限。
- 中文与外观：中文进度，原文含中文；真实 IME 不由此实验代替，不新增生产 UI 样式。
- 命令与键盘：使用实验 View 的直接 dispatch/undo，不模拟真实快捷键或变更生产命令；保留现有用户输入门禁。
- 安全与日志：不执行文档内容、不加载网络资源，异常匿名，metrics 仅计数/耗时及保真布尔数值。

## 最小 happy path

1. 实际新包开启探针：双方 pending，正对照继续 advance，销毁组之后为零则记录本次观测通过。
2. 未获得正对照时如实 unsupported；取消销毁实验 View，不能伪通过。
3. 重建 View 保持原文和选区，撤销历史可用；是否所有生产后台任务可取消仍由未来完整 OBL-012 承接。

## 实施记录

2026-09-27：先落方案；尚无真实 DOM 结果。OBL-012 只当前 CM 生命周期观察；完整队列/优先级/其他消费者仍开放，OBL-020/041/068 后续范围未关闭，父功能未完成。

### 实施与非 DOM 验证

- `editor-view-probe.ts` 新增 MeasuredParser 透传实际 parser/partial parse，仅计 advance 次数与耗时，不人工 sleep 或更改返回树。两个真实 View 以独立 Language 隔离；先取 pending 与控制组基线，再 destroy 测试组，设 1200ms 观察定时器。实际 observationMs 记录事件循环真实经过时间，繁忙主线程可能使定时器晚于计划触发，不承诺可抢占。
- controlAdvanceCount/Ms 仅销毁后观察窗口的正对照增量；cancelledAdvanceCount 为测试组累计 advance 次数，afterDestroyAdvanceCount/Ms 为销毁后增量。销毁后仍有 advance 优先为 failed；无此失败而 pending 缺失或控制组无后续推进才为 unsupported。有判定所需正对照且没有销毁后推进才 ok，不把无回调当取消成功。
- 重建 View 前移除实验 Language compartment，使用销毁前最后 View state 与原生产 parser；原文、选区、undo 历史分别记录 rawMatches/selectionMatches/historyMatches。最后清理控制/测试/恢复 View，取消不遗漏。
- 本地辅助测试 2 pass / 12 断言，真实 parser 节点/范围与包装后相同，判定逻辑涵盖缺正对照、无进展、销毁后推进；没有真实 DOM 时不测试/宣称 CM worker 实际取消。共享全量当次 486 pass / 3815 断言 / 75 文件，2.95 秒；typecheck、两文件 ESLint/Prettier、承接及差异检查通过。真实新包观察由主任务接续。
