# F-014c：原文独有变化的历史与提交保护

实际Git收据：主线已提交并推送 `e492c6fb5c39a94268949f85558a3d5a43b24cc8`，远端main同SHA，当时工作树干净；下方待Git为提交前历史。本收据追加自身尚未提交。非离线本片受托代验、父/完整义务/最终离线开放及全部证据边界不变。

## alpha.115 构建与受托窗口代验记录（2026-10-11）

最终独立 verifier 确认无剩余代码或必要验收阻断，主线正式确认非离线本片受托 Agent 代验通过，非用户亲验；Git 待实际执行。独立定向31项/427断言/3文件/280ms、文档/义务/diff、两样本SHA及版本/日志核对通过。生产仅本片两处守卫修复，F-041c 性能实验未接入；完整父项、OBL-064及最终离线保持开放。

- 主线源码全量 `893 pass / 20929 expect / 143 files / 23.06s`，日志 `/tmp/agentic-f014c-source115-tests.log`；包内 Bun 运行仓库测试 `893 / 20929 / 143 / 22.00s`，日志 `/tmp/agentic-f014c-package115-tests.log`，不冒称所有包资源的独立测试。
- `AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary` 成功，日志 `/tmp/agentic-f014c-build115.log`；Vite 大块与 hdiutil deprecated 警告保留。解包路径 `/tmp/agentic-markdown-alpha115.CexAwJ/Agentic Markdown-canary.app`，version.json 与 plist 均 alpha.115，hash `26v7zg8kdt4p0`。
- 独立 Standards 代码复核无阻断，35项/451断言/4文件/273ms；Spec 原红复验及最终测试核对分别记录，不以自动测试代替以下窗口实证。
- 以既有隔离数据目录 `/tmp/agentic-sidebar-layout-data.cPxLT0`、显式 fault lab 启动，exec76537 / Bun PID4079。初次 AX 仅窗口框，随后带截图观察看到深色欢迎页、空树、诊断停止；没有将初次空 AX 归因产品故障。
- 只打开自建 `/tmp/agentic-f014c-ui.Z6r7ob/history-a.md`（98字节）和 `history-b.md`（54字节）。A 源码选中 alpha，粘贴 ALPHA-115 后 dirty；单次⌘Z回 clean 且 alpha 选区恢复；⌘⇧Z重做 dirty。源码→编辑保留 ALPHA-115 选区，阅读呈现同一未保存正文，阅读⌘Z未改正文，再回编辑。
- 打开B后替换 beta 为 BETA-115，B dirty；回A仍保留 ALPHA-115 范围，一次撤销只使A clean，B仍dirty。⌘Q出现全部未保存确认，点击继续编辑保留两标签和B修改。取消后第一次B AX点击无变化，按最新状态再次点击成功；只记录动作结果，不推断根因。
- B中一次撤销恢复 beta、clean，两标签均clean。最终⌘Q返回 App quit，`ps -p 4079`无进程；没有强杀或放弃用户内容，没有保存样本。
- 前后 SHA256一致：A `b5d50fe372b54f3561707d945e0b22a30cb1d71650e4563e723e9e7faafe1b54`，B `c549160ab897edc172a1804e7e08e49aa32c88106d009802a103961d60326abc`。

证据边界：真实WK仅普通输入/历史、dirty、跨标签/模式、深色中文可读性和退出路径；raw-only精确字节、1MiB拒绝、原随机接缝及保存捕获由生产seam测试证明，不伪称肉眼看到CR/CRLF或本轮实际写盘。未重测本机自然IME/物理键盘、动态系统外观、权限在途变化、全部外观或极端密集替换。最终离线人工及完整父/OBL-064继续开放，不断网。

> 状态：alpha.115 非离线本片受托 Agent 代验通过；下文实施与待验说明保留为历史记录，以顶部正式结论为准。
> 日期：2026-10-11

<!-- obligations: OBL-064 -->
<!-- deferred-obligations: none -->

## 功能说明与范围

[F-041c 隔离实验](F-041c-source-replace-all.md) 发现既有原文通道缺陷，先独立修复，不启动全部替换。已核查 F-014 仅有 a/b，c 未占用。本片局部承接 F-014 主责任 OBL-064 的既有原文/历史消费者；OBL-043 底座已验收，不重新承接或关闭。完整 OBL-064、父 F-014/F-041 和 F-041c 仍开放；`F-014c-offline-final` 留最终人工，不断网。

独立诊断 `/tmp/agentic-raw-undo-diagnosis.nu4Rnm` 的 repro/probe/controller-probe 已定位：单 lone CR 的逻辑末尾插 LF 后，raw 变 CRLF，但最终 CM changes 为空、docChanged=false。inverse guard 没有记录原文恢复；controller 增加 revision/dirty 却不发布，且恰好1MiB原文可沿此路径越过字节上限。受控证据不冒充窗口复现，不泛称所有替换/保存失效。

修复既定行为：真实原文变化必须可撤销/重做、通知消费者并受既有大小与权限保护；纯选区/视口变化不变脏或创建正文历史。保留 CM 公开 history、原文字段、保存捕获及磁盘基线，不新增产品行为。

## 最小技术方案

1. raw-buffer invertedEffects 不再仅以最终 docChanged 准入；比较起止真实 raw，确有变化才生成既有 inverse 原文 patch，让仅效果变化也进入公开 CM history。沿用 restoreRaw 和历史边界，不另建历史栈、不整篇改写 CM 文档或复制私有算法；相同raw只不额外生成inverse效果，普通docChanged是否进入历史仍由CM既有机制管理。
2. DocumentController.updateEditor 定义 rawChanged=前后raw不等、contentChanged=transaction.docChanged或rawChanged；权限/阅读/输入阻止、UTF-8结果字节上限和正文发布统一覆盖contentChanged，revision仍仅rawChanged递增；原有模式/安全状态发布仍保留。超限整体拒绝，editor/state/revision/history/基线不替换，沿既有中文错误；selection-only不算正文变化。
3. 保留旧startState、frozen/busy、只读、IME及保存并发守卫，不改变保存捕获快照或磁盘基线。避免重复编码和不必要的raw计算；未改原文的呈现事务维持既有行为。
4. 不接入 F-041c 线性helper/批量Worker/按钮，不修其 ChangeSet.apply 性能，不改 F-028c、快捷键、引擎或磁盘协议。方案获批后才实施；版本与构建由主线负责，后续至少alpha.115，当前不预写成功。

## 最小 happy path

- 真实createRawEditorState：单CR后插LF，逻辑文本不变但raw变CRLF；一次undo精确回CR，redo回CRLF；已有输入历史不被清空或并入本次撤销。
- 实际controller seam：接受、undo、redo均有正确raw/revision/dirty及订阅发布；选区/mainIndex保留，保存捕获当前raw，磁盘基线不自行前进。
- 恰1MiB末尾CR插LF越界整体拒绝，等于上限允许；拒绝后raw/revision/undoDepth不变。只读、阅读、输入阻止、冻结、旧事务拒绝写入。
- 普通LF/CRLF、BOM/混合行尾、多范围接缝、空操作、selection-only及既有history回归。旧oracle自身错误不能作正确性标准。
- 主线真实WK自有样本验证正常输入/undo/redo、dirty、跨标签模式和退出保护；raw-only精确字节与超限以生产seam测试证明，不伪称肉眼区分CR/CRLF。两轴复核后才受托验收/Git。

## 继承约束检查

- F-002：原文与基线职责不变，BOM和未触及行尾保真；精确raw断言覆盖接缝，最终离线留人工。
- 中文与外观：无新控件/样式，沿既有中文超限提示和dirty呈现；实际窗口核可读性，不以测试代视觉验收。
- 命令与键盘：复用统一撤销/重做及快捷键，保留候选保护；无新按钮、拖放、分隔线或原生菜单。
- 安全与日志：raw变化受权限及字节保护；旧事务不更新当前状态，不记录用户正文/路径，不引入新真源。

## 当前证据

主线已批准实施。raw-buffer inverse按前后raw变化生成恢复effect；controller复用rawChanged/contentChanged覆盖字节和发布守卫，revision仅真实raw递增。没有接入批量性能候选，也没有新历史或保存协议。

2026-10-11新增 `raw-only-history.test.ts` 六项：effects-only undo/redo与既有前后输入历史、反向多选区/mainIndex、controller raw/revision/dirty/订阅、selection-only无正文发布、exact1MiB/越界原子拒绝、readonly/inputblocked/reading/frozen/旧事务。联合 `raw-buffer.test.ts`、`history-documents.test.ts` 为29 pass / 406 assertions / 3文件 / 275ms；typecheck及受影响三文件ESLint通过（末次测试补充后typecheck复跑待结果）。这不是真实窗口验收。

实现期第一次新测试的只读fixture误用了非法reason，导致选择未创建editor；改用正式readonly枚举后通过。首次lint报await void dispose，已移除错误await并重跑通过。documents批量格式化产生的无关噪声已只撤回本人引入部分，保留窄11行差异；诊断红事实仍保留，未改版本/构建/UI/Git。待独立Spec/Standards与主线包/实际验收，不自批。

最终executor增补：新增测试合计8项，补实际controller经受控save transport捕获CRLF、保存后clean且undo回CR变dirty（非真实磁盘写）；固定随机种子恢复的三个原始接缝失败分别断言精确undo原raw及redo最终raw，不以旧oracle相同代替正确性。最终上述三文件31 pass / 427 assertions / 310ms；全项目typecheck及三受影响源码ESLint通过。生产核心已冻结、无批量性能改动；主线独立负责alpha115构建/真实验收，其结果不由本段预写。
