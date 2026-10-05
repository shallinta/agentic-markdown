# F-044a：源码逻辑行号与当前行提示

> 状态：2026-10-06 alpha.101 非离线本片经最终独立 verifier 确认 0 剩余阻断，主线确认受托 Agent 代验通过，非用户亲验；Git 待实际执行。父 F-044、完整 OBL-059 与 offline-final 开放，下方旧阶段保留历史。

<!-- obligations: OBL-059 -->
<!-- deferred-obligations: none -->

## 功能说明

普通源码模式默认显示从 1 开始的逻辑行号，提示光标所在逻辑行及对应行号。软折行仍属同一个逻辑行，不重复编号；当前逻辑行的可见软折行区域整体高亮。编辑模式和阅读模式不显示这些装饰。安全源码降级是故障隔离视图，仍保持现有极简、无附加装饰，不因本片重新加载被隔离的呈现扩展。

不增加开关、设置、命令、跳行功能或多光标；现有 `⌘⇧M` 切换方式不变。源码保持等宽、纯 Markdown 代码编辑语义，行号不是正文，不参与保存、复制的正文内容、字数或解析。仅呈现变化，不改变原文、documentId、磁盘基线、选区、撤销历史、输入法或保存权限。

## 最小技术方案

1. 在 `apps/desktop/src/client/editor-mode.ts` 的 `sourcePresentation` 接入当前已安装 CodeMirror 6 公开 `lineNumbers()`、`highlightActiveLine()`、`highlightActiveLineGutter()`，不在 raw-buffer 全局扩展接入，不新增依赖、不 fork 或访问私有 API。实现前复核本地依赖公开声明与实际逻辑行行为。
2. 继续复用 presentation Compartment：切回编辑移除全部源码装饰，阅读沿独立消费者；`isolated` 与 `safeSourceEffects()` 原路径不附加本片扩展。无自建逐行全量 DOM 或新解析树，使用 CM 现有视口呈现及行信息。
3. 同一源码扩展内以 `EditorView.theme` 和现有语义颜色变量设置 gutter、当前行和当前行号背景/文字；深浅主题均需辨认，避免覆盖已有选区样式。核对 `.cm-content` 现有 16px 内边距与 gutter 顶部的真实对齐，不仅检查类名。
4. 不新增监听器、RPC、文件访问、日志、持久偏好或正文变更事务。仅使用现有光标/选择事务更新提示，不额外驱动 React 每行渲染。性能是一等指标，记录观察到的开销及异常，不预设门槛或声称已有性能收益。

## 最小 happy path 与验证

- 自动验证：普通源码装饰接入；编辑/阅读及安全降级不泄漏；往返模式保持正文、选区、undo/redo；逻辑行号和软折行依赖行为通过现有可用测试 seam 核对，不为测样式新建大型基础设施。
- 真实 WK：打开包含空行、长软折行和多位行号的临时 Markdown，切源码后行号连续、空行有号、软折行不重编号；键盘移动光标时对应逻辑行与行号高亮，软折行区域、首尾行和滚动后 gutter 对齐正确。
- 在源码作临时未保存编辑与选区，编辑/源码/阅读往返后原文及选区/历史保持；undo/redo 不包含行号/主题本身。不保存样本，仅正常退出或按授权处理 Agent 临时变更。
- 深色、浅色及跟随系统的当前外观检查 gutter、当前行和选区对比；未改变系统主题则不宣称动态主题实测。阅读与编辑无 gutter，故障隔离通过自动验证及可用实验入口核对，不把普通源码等同安全降级。
- 代码检查、独立 Spec/Standards、构建与实际 WK 分开记录，失败保留；无法实际覆盖的必要项保持开放，不以类名或构建绿灯代替视觉验收。

## 继承约束与义务

- 中文与外观：无新增文案，复用语义颜色；深浅/当前系统外观与 16px 顶部对齐由真实 WK 验证，不以自动 CSS 检查代替。
- 命令与键盘：不新增命令或快捷键，保留活动文档、模式与 IME 上下文，现有模式切换和方向键移动保持。
- 安全与日志：不执行文档内容、不增加文件/网络访问或日志；安全降级仍隔离、无本片装饰。
- F-002：无在线资源依赖，离线要求保留但不执行断网验证，最终人工入口见下。

OBL-059 本片局部适用：没有新命令，保留已有活动文档/模式与输入法可用性规则；不重复注册命令或更改快捷键。父功能的多光标及未来命令/完整键盘责任仍开放，不因本片默认呈现关闭 OBL-059。

F-002 离线约束保持，无网络依赖或在线资源。`F-044a-offline-final` 留最终统一人工确认，不断网、不执行离线验收。用户不默认 TDD；批准方案后实施、定向/typecheck、全量及独立审核，由主线更新 alpha 版本和打包，受托验收通过后才按连续授权 Git。

## 实施与证据

主线批准后开始最小呈现接线。初次文档检查指出继承约束缺少显式“中文与外观”标签，现补齐四项；失败不删除。本片尚无构建或验收成功声明。

实际最小实现仅修改 `editor-mode.ts` 普通源码 presentation，加入三个 CM6 公共扩展及 gutter/当前行轻量主题（正文当前行 5%、行号当前行 8%，弱于既有选区 20%）。没有改 raw-buffer 全局或安全隔离路径，无新依赖、监听器或正文事务。状态/样式测试新增普通源码独占、返回编辑移除、初始隔离及故障降级无装饰；既有原文/选区/undo/redo 测试继续通过。行号 DOM、软折行和顶部像素对齐尚未实测，不能据状态/CSS 测试宣称通过。

首个定向文件 4 项/51 断言通过；typecheck、全 lint 通过（`/tmp/agentic-f044a-typecheck.log`、`/tmp/agentic-f044a-lint.log`）。文档检查另曾报告缺少 deferred marker，已补 `none`，最终文档/义务及 diff 检查通过。未构建 App、未改版本或 Git，等待独立审核及主线实际窗口验收。

### alpha.98 实际验收检查点（2026-10-05，进行中）

主线源码全量 805 项/20012 断言/129 文件/20.15 秒通过（`/tmp/agentic-f044a-source.log`）；构建成功（`/tmp/agentic-f044a-build98.log`），保留通常 chunk/hdiutil warnings。包 `/tmp/agentic-markdown-alpha98.ZyaIvg/Agentic Markdown-canary.app`，hash `184xtpbfc7op0`，实际 PID 4074、exec 97055。以下为真实 WK 局部证据，不是本片验收或 Git 通过。

打开临时 `/tmp/agentic-f044a-ui.hGjLHJ/lines.md`（838 字节），源码显示 1–13，空行有号、长第 4 行只编号一次、首尾对齐。初次工具 selectText cursor_after 没有 AX 变化且仍高亮第 1 行，不记成功；后来 Home + Down 三次的键盘路径实际使长第 4 行所有软折行整体背景及 4 号高亮。

将 XYZ 改为 XYZ-TEMP 并选中，源码→编辑→阅读→编辑→源码后，AX 选区仍为 XYZ-TEMP，正文 dirty 保持，编辑/阅读没有 gutter。浅色截图中选区与当前行对比可辨。其余主题、标签、滚动、undo 与最终退出仍在验证，未提前完成；未将工具最初未生效动作归因于 App。

随后真实 WK 复现阻碍：源码 dirty、选中 XYZ-TEMP，切 second 再回 lines 后首次 `⌘Z` 正确还原 clean，但出现“命令执行失败，请重试”；随后 redo/undo 无该提示。再次 clean→second→lines→`⌘⇧Z` 正确恢复 dirty，同时又出现提示。当前 PID 4074 保留 Agent 的 TEMP 未保存状态。本片未验收、不得 Git；正在按 diagnosing-bugs 建立实际跨标签/命令/历史链的可红反馈，未先猜生产补丁，未改版本或构建。

诊断首轮只增加测试、不改生产：`bun test apps/desktop/src/client/history-documents.test.ts --test-name-pattern 'cross-tab history command'` 1 项/4 断言通过（67 ms）。实际 registry→controller→跨标签 undo/redo 在无 DOM seam 没有复现失败；该测试不包含真实 React MemoryEditor、EditorView 更新/重建、scroll/viewport 恢复，不能当作修复或有效红回归。独立 verifier 同样指出需实际 view 生命周期证据；下一步建议受控获取真实异常类别，尚未实施诊断接线或认定根因。

### 授权临时诊断（待去除）

主线已向用户展示三个可证伪假设：view/controller 事务起点不同（预测固定 transaction-start 类别）、更新重入（预测 update-reentrant 类别）、旧 view 残留（需生命周期进一步证据，不能只靠 other 排除）。真实 WK 的跨标签 undo/redo 两次红环作为 Phase 1/2 反馈；无 DOM 绿灯不作为修复证据。

主线批准仅现有 EDITOR_FAULT_LAB 下临时取证：命令失败边界提供 error 给分类器，但仅开关开启时分类并保留最多 16 条内存记录，字段只有固定类别、命令类型及 sync/async；不保留原始 message/stack、参数、路径或正文。分类器使用固定精确匹配，无法识别均记 other，不能把 other 解释为排除任何假设。原有 toast 与命令执行行为不改变；实验台新增读取/清空按钮，按需读回，不持久化、不网络/RPC、不实时订阅渲染。分类/有界复制/危险 getter 和真实 registry 同步异步捕获有定向测试；这只是诊断，不是生产修复，定位收尾须去除临时接线。版本、构建及真实新包复现由主线执行。

诊断初版复跑 15 项通过、1 项失败：原 registry 测试要求 failed 回调无原始错误参数。已恢复 failed() 原契约，另加仅实验开关下注册的可选 diagnostic 回调，默认 undefined，诊断自身异常被隔离；不放宽原安全测试。另初次专项 lint 的空函数报错已修正。日志 `/tmp/agentic-f044a-diagnostic-tests.log` 保留。

修正后诊断/registry/历史三文件 16 项/97 断言/95 ms 通过（`/tmp/agentic-f044a-diagnostic-tests2.log`）；typecheck 通过，全 lint 发现早先历史诊断测试另一个空函数并修正后通过（`/tmp/agentic-f044a-diagnostic-lint2.log`）。文档/义务/diff 检查通过。当前只有实验接线和测试完成，尚未读取真实错误类别，不称根因或修复；等待独立审查及主线 alpha.99 取证。

### alpha.99 真实类别（2026-10-05）

主线实际包 `/tmp/agentic-markdown-alpha99.o2pDmB/Agentic Markdown-canary.app`，hash `jpcxrlr9gyxe`，exec 73853、PID 6515。second clean 激活→点 lines 标签→`⌘Z`，TEMP 正确还原原文 clean，同时失败 toast；实验台 AX 完整读回 `[{"command":"undoDocument","stage":"sync","category":"transaction-start"}]`。这支持事务起点不一致路径，不证明具体发生于哪一次 controller/React/view 更新；下一步核查实际生命周期顺序，不用假造 throw 替代回归。当前 lines clean、两标签，未保存，整片仍未验收。

alpha.98 退出前 undo 至 clean、`⌘Q` 成功且 PID 4074 消失；该旧包内 Bun 运行仓库测试 805 项/20011 断言通过，不混成 alpha.99 证据。后续取证与修复仍不执行 Git，旧实验未知字段不补造。

### viewport 挂载时序最小红反馈

主线与独立 verifier 指出更窄的现有时序：第一次 layout effect 用本 render 捕获的 S0 建 view，恢复 viewport 时真实 `scrollIntoView` 事务推进 controller/view 到 S1；该事务不改正文，controller 不 publish。随后同一 render 的第二 layout effect 仍取捕获 S0，可能将 view 回退 S0，而 controller 保持 S1。无需假设额外同步 React 重入。

已运行 `bun test apps/desktop/src/client/history-documents.test.ts --test-name-pattern 'diagnostic mount'`：1 项对照通过、1 项目标失败，5 断言/67 ms（`/tmp/agentic-f044a-viewport-control.log`）。使用真实 controller、真实 CM State 和 `EditorView.scrollIntoView` effect，经 A 编辑→B→A，确认 viewport 事务后通知数为 0、controller/view 状态先一致，再按当前两 effect 顺序使用旧捕获 state 后身份不一致；无 viewport 对照保持一致。未假造异常，但此反馈模型不是实际 DOM/React 装载实证，不替代随后 native 修复复验。最小候选为第二 effect 从 controller 读取最新 editor 状态和 fault session，尚未改生产，待主线批准。

### 单变量同步修复候选（2026-10-06）

主线批准在本轮验收发现的状态同步缺陷范围内修复：第二 layout effect 经窄 `syncCurrentEditorState` helper 读取 controller 最新状态，同步 view 并从该状态读取 fault session；不使用本 render 捕获的 editor 作为同步来源。不更改权限前置、controller→view dispatch 顺序，不吞掉真实命令异常，不改变正文/选区/历史。不能据此归咎行号，也不声称已修复 F-027d 的旧未知 toast。

原目标回归改为直接调用生产 helper，不再只复制旧表达式；最小两项回归变为 2 项/7 断言通过（62 ms），补最新 owner 状态及未知文档 no-op 覆盖。测试依旧是实际 CM State/controller 加受控 view state seam，而非 DOM/React 实跑。临时诊断保留至主线 alpha.100 真实红环复验；确认后去除实验并由后续最终包复验。尚未构建或验收此修复。

最终定向四文件 23 项/160 断言/108 ms 通过（`/tmp/agentic-f044a-sync-fix-tests.log`），typecheck、全 lint 及文档/义务/diff 检查通过。主线确认 alpha.99 两标签 clean 后 `⌘Q` 正常退出，PID 6515 不存在；这是旧诊断包退出实证，不当作新修复效果。下一步独立双轴审核及主线 alpha.100 真实复验，未 Git。

### alpha.100 原红环实际转绿与实验清理（2026-10-06）

主线构建成功（`/tmp/agentic-f044a-build100.log`），包 `/tmp/agentic-markdown-alpha100.Wc9Oyz/Agentic Markdown-canary.app`，exec 90614、PID 7880。真实 WK 打开 838 字节 lines、源码模式将 SELECT-ME-XYZ 改为 SELECT-ME-XYZ-TEMP dirty；打开 second 71 字节 clean→回 lines→`⌘Z` 正确恢复原文 clean、无失败 toast。再次 second→lines→`⌘⇧Z` 正确恢复 TEMP dirty，选区为 SELECT-ME-XYZ-TEMP、无 toast。读取诊断仍 `[]`，截图核对空记录及源码 gutter/选区正常。此为原跨标签红环修复实证，不证明 F-027d 历史未知 toast 同因，不等于所有生命周期故障已消失。

按主线批准，使用 apply_patch 删除本轮临时 `failure-diagnostic.ts`、其专项测试及 `command-failure-lab.tsx`，精确恢复 registry/provider/panel 的临时接线；保留正式状态同步 helper、MemoryEditor 修复与有效回归。原 FocusTraceLab 不在本次删除范围。诊断源码未单独提交，结果及失败历史保留本文件；未来复查需依记录重新建立实验，不宣称仍可从当前 App 调用。最终无临时诊断 alpha.101 构建/复验尚待主线，本片未整体验收，不 Git。

### alpha.101 最终受托代验完成候选（2026-10-06）

主线最终源码全量 809 项/20028 断言/129 文件/20.73 秒通过（`/tmp/agentic-f044a-source101.log`），包内 Bun 运行仓库测试 809 项/20028 断言/19.31 秒通过（`/tmp/agentic-f044a-packaged101.log`），不称全部测试资源来自 App 内部。构建成功，保留通常 chunk/hdiutil warnings。实际包 `/tmp/agentic-markdown-alpha101.3gpnCj/Agentic Markdown-canary.app`，Info.plist 核对版本 101，exec 85659、PID 8604；本包没有临时命令诊断，原 focus/fault 实验入口仅用于测试。

真实 WK：

- 打开 838 字节 lines，源码 Home+Down 三次，截图长逻辑第 4 行所有软折行整体背景及 4 号高亮；空行和多位行号连续。
- 替换 TEMP 形成 dirty 并选中 XYZ-TEMP，编辑→阅读→编辑→源码后 AX 选区保持，编辑/阅读截图无 gutter。打开 second（71 字节）→回 lines 选区保持，undo 正确回 clean、无 toast；再次 second→lines→redo 正确回 dirty、无 toast。
- 浅色初次 AX 文本点击后 Escape 未改变设置，不算成功；改用 combo 的 Home+Return 成功切浅色，截图 gutter/当前行/选区对比清楚。End+Return 切跟随系统，当前深色截图可辨，未改变 OS 主题、不称动态跟随实测；最终 Home+Down+Return 核对固定深色恢复。
- 实际触发编辑呈现故障按钮，降级安全源码后无 gutter/当前行，原文、TEMP dirty 与选区保持；`⌘Z` 回原文 clean，再 `⌘Q` 正常返回 App quit，ps 无 PID 8604。主线最后读取两样本全文，与原始 literal（838/71 字节）一致，未写盘。

alpha.101 未重跑 alpha.98 的 400 追加滚动路径，不混作新版证据；自然 IME 与实际只读新路径本片未实操，保留受控测试边界。当前非离线受托代验完成候选、待最终独立判断，不自批，不 Git；父 F-044、完整 OBL-059 与 F-044a-offline-final 开放。

### 最终结论（2026-10-06）

最终独立 verifier 明确 F-044a alpha.101 非离线本片 0 剩余阻断，主线确认受托 Agent 代验通过，非用户亲验。最终包 hash `10e5rxyg8suan`；真实窗口与自动验证范围如上，不扩大未实测证据，不将同步修复归因于行号，也不宣称旧 F-027d toast 同因。临时命令诊断已去除，正式源码行号/当前行及状态同步修复可用。Git 待主线实际执行；父 F-044、多光标/未来命令、完整 OBL-059 和 F-044a-offline-final 继续开放。
