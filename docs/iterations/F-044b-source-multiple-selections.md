# F-044b：普通源码多光标与多选区

> 状态：2026-10-10 alpha.103 非离线本片通过，独立 Spec/Standards 0 阻断、主线正式确认。自然中文 IME 与非候选 Escape 为用户亲验，其余为受托 Agent 代验。Git 待执行；父 F-044 与最终离线保持开放。

<!-- obligations: OBL-059 -->
<!-- deferred-obligations: none -->

## 功能说明

普通源码模式启用 CodeMirror 6 原生多光标和多选区。macOS 使用 ⌘单击添加独立位置/范围、⌘⌥↑ / ⌘⌥↓向上/下增加光标，Escape 将多选区收敛至主选区；之后的原生 Escape 行为可将非空主选区收敛至光标。一次多范围输入、删除或粘贴使用统一事务和撤销步骤。

编辑模式仍为单选区，阅读只读，安全降级继续极简隔离。离开普通源码时只保留当前主选区，不隐藏保存一套待自动恢复的多选区；后续 undo/redo 不得令编辑/阅读/安全源码重新出现多个范围。不增加矩形/列选择、Option 点击、⌘D 匹配选择、额外设置或 E-04 配对规则，不触碰 F-028c。

本片只落实 E-08 与必要上下文接入，不关闭 F-044、完整 OBL-059 或 F-014 的完整 IME 责任。当前本片已通过；下方实施与待验检查点保留历史。

## 已核对的基础与最小技术方案

1. `client/raw-buffer.ts` 已安装 history、drawSelection 和 defaultKeymap；CM State 默认未开启 allowMultipleSelections。在普通源码呈现 Compartment 内启用公开 `EditorState.allowMultipleSelections.of(true)`，不放入全局 raw-buffer。复用公开选择模型、绘制和原生鼠标添加规则，不自建 DOM 光标或私有选区树。
2. 本地 CM 默认 macOS 添加范围为 Meta 点击，已有 defaultKeymap 包含上下添加光标和 Escape。新增三项受控选择命令到 `shared/commands.ts` 的类型/运行时精确校验/元数据、统一 registry 与当前文档 handler/guard；中文名称明确为“向上添加光标”“向下添加光标”“保留主选区”。不另建全局快捷键管理器。MemoryEditor 中局部高优先级键位转发统一命令，避免 defaultKeymap 再执行同一动作；设置输入框、命令面板或其他非编辑目标不被截获。是否显示命令面板采用现有命令能力机制，不增加原生菜单/RPC可用性协议的无关字段。执行时必须重新核对活动文档、实际 view、普通源码模式和输入状态，不依赖上次 React 可用性快照。
3. 使用公开 addCursorAbove/addCursorBelow/simplifySelection，在当前真实 view 上执行并复用 controller 的事务接收链。选择操作本身不写正文；只读文档可选择和复制，但输入/删除/粘贴仍由现有只读能力拒绝。冻结、busy、composition 或失效 view 不执行选择命令。关键字和快捷键既不绕过 IME，也不把读取权限失败变成可写。
4. 源码退出至编辑/阅读、故障进入安全源码时，同一模式事务显式收敛 `selection.asSingle()`，保留主范围方向/位置。不能只依赖 reconfigure(false)：当前 CM 在更新时使用 transaction.startState 的 allowMultipleSelections 判断选区，单独关 facet 可能留下一个事务的多范围。目标模式 facet 必须为 false，保证随后 undo/redo 从单范围模式起步时也被原生状态模型收敛；CM 历史事务使用 `filter: false`，不得把 transactionFilter 当唯一兜底。补充后续 history 恢复的单范围约束测试；不清空文档历史、不修改正文/基线，也不为退出源码保存隐藏的多选区副本。新建 isolated 安全 state 同样保持单范围。
5. 剪贴板沿 CM 原生行为：复制多个范围使用其原生组合；粘贴文本行数恰等于范围数时按范围逐行分配，否则各范围插入同一文本（原生整行复制特殊行为保留）。不读取额外系统剪贴板或自行重写格式，不宣传尚未实测的任意应用往返。底层 raw ChangeSet 按变化区间处理，须验证多范围时 BOM、混合 LF/CRLF、未触及片段和 EOF 的保真。
6. 单篇既有范围限制不变，无新增后台任务、全文件副本或每键 RPC。多范围数量带来的 CM/原文映射成本在实际样本中观察，不预设收益或数值门禁。视图关闭/切换时注销局部命令执行目标，旧回调不得操作新文档。模式/只读/冻结状态改变后命令 guard 使用实时状态。

## 最小 happy path 与边界验证

- State/controller：普通源码多个光标插入、范围替换/删除，统一 undo/redo；普通编辑初始单范围；源码→编辑/阅读/安全源码立即主范围，之后 undo/redo 不复活多范围；正文 revision、dirty、基线规则保持。
- 原文：含 BOM、混合行尾、中文和 emoji 的两个以上分离区间输入/换行及撤销；原始未触及字节不变，保存链仍使用既有通道，不为验证保存用户文档。
- 命令：严格参数与当前活动 doc 校验，键盘只路由一次；无 view、旧 view、非源码、IME、busy/冻结禁用；只读选区可操作而任何写入被拒绝。Escape 不抢设置/对话框自身退出逻辑。
- 真实 WK：在普通源码用 ⌘点击与 ⌘⌥↑/↓实际建立多光标/范围，中文普通文本与 ASCII 插入、删除、范围替换、复制粘贴与单步 undo/redo；Escape 收敛主范围。两个标签各保留自身源码选择，编辑/阅读往返只保留主范围，故障安全降级不保留多个编辑位置。
- 软换行开/关、长行、滚动与源码行号/当前行提示、深浅及当前系统外观均需核对；不承诺矩形语义。中文自然 IME 的候选/确认/取消与多范围交互必须实际取证，合成事件只作受控测试；无法完成时如实保留必要项，不代写用户通过。
- 普通退出及未保存取消按已有规则；关闭后旧 dispatcher 不复活。全量/typecheck/lint/文档检查、独立 Spec/Standards 与真实验收完成后才由主线执行 Git。

## 继承约束与义务

- **本地与离线（F-002）**：仅本地状态与既有 CM 模块，不新增网络服务；`F-044b-offline-final` 留最终人工，不断网、不做网络隔离。
- **中文与外观**：三项命令使用中文名称，复用现有选区/光标与焦点主题，浅深/当前系统外观实际检查；不因多光标改源码字号或主副区域布局。
- **命令与键盘**：本片局部主承接 OBL-059，所有新增命令进入统一 registry/即时 guard，鼠标有上述键盘等价入口，不绕过命令注册。完整父项及后续消费者开放。
- **输入、保真与安全**：沿 F-014 历史/IME 及只读、冻结、关闭保护；本片结果作为 OBL-064 后续消费者证据回链，不变更该义务主承接 F-014、不宣称完整中文/日文/韩文矩阵通过。Markdown 不触发外部进程，日志不记录正文或剪贴板。E-04 尚待边界决定，F-028c 未决保持。
- **安全与日志**：本片仅当前受控 EditorView 选择事务，不增加外部进程、RPC 或正文/剪贴板日志；不扩大文件授权和写入权限。

## 实施记录

仅完成源码与已确认范围只读核查及最小方案。没有本片生产代码、测试/构建或验收成功声明；用户不默认 TDD，开发在主线批准后按最小反馈循环进行。若原生模型无法满足已确认隔离或 IME 规则，先报告证据，不自动改变产品行为或关键技术路线。

### 2026-10-10 实施批准

主线已批准以上最小方案及独立 Spec 的状态/历史边界。执行本片源码与定向验证，不默认 TDD；统一命令与鼠标 ⌘点击均须实时守卫 IME/busy/frozen，不全局吞键、不让默认 keymap 绕过 registry。版本、构建、真实 UI 与 Git 由主线负责，尚不宣称实现或验收完成。

### 2026-10-10 实现与受控验证，待独立审核

普通源码呈现启用 CM 公开多选区 facet；控制器退出源码与故障降级同事务保留主范围。三项选择命令通过统一 registry 严格参数校验、当前文档/view/焦点与 IME/busy/frozen 守卫；它们只作用于实际编辑焦点，`palette: false`，未新增命令面板恢复编辑焦点机制。全局 defaultKeymap 移除添加光标上下键，普通源码 contentDOM 局部路由 Escape 与添加键，编辑模式保留既有 Escape。局部 ⌘主键鼠标守卫阻止被禁用的添加操作，正常只读选择保留；正文写入仍走原权限屏障。

新增 State/controller/输入路由测试覆盖多区间 BOM、混合行尾与 emoji 原文、单步历史、模式/安全收敛、只读选择与禁写、IME/frozen/失效 target。最新定向 25 项 / 211 断言 / 3 个实际匹配文件 / 120ms 通过（`/tmp/agentic-f044b-targeted-final.log`），typecheck 与全 lint 通过。早先 typecheck 的命令标签类型缩窄遗漏已修；此前 30/241 为不同文件组合，不能当作本次同一统计。未跑本片 App 构建或实际 UI；完整全量由主线统一运行。

合成 IME 路由仅证明代码不执行选择命令且保留 native default，不能保证真实候选确认/取消效果；自然中文 IME 仍为必要非离线验收。没有真实剪贴板、鼠标、软折行多光标或主题证据，不用这些受控测试冒充。代码已交独立 Spec/Standards；未验收，不得 Git，父与 offline-final 保持开放。

文档检查首次因继承检查表缺少“安全与日志”显式标题失败，已补准确边界后重跑；不是产品测试失败或验收通过。

### 2026-10-10 独立 Spec 指出安全源码 Escape 边界并窄修

MemoryEditor 路由初版只判断 mode 为 source，误包含安全源码：禁用选择命令却仍阻止 Escape 默认行为。现键盘及鼠标统一使用生产 `isOrdinarySourceSelection(mode, safe)`，显式排除安全源码，交还既有单选区输入路径。未改安全源码原生 Escape 或全局键盘行为。

真实生产谓词/路由 seam 回归先临时恢复旧谓词，仅跑新测试文件：4 pass / 1 fail，safe Escape 返回 true 而期望 false（`/tmp/agentic-f044b-safe-red.log`）；恢复修正再验证。该红绿是无 DOM 的有限调用边界，不冒称实际 WK 或自然 IME 证据。待独立复核及主线构建验收，未改变本片结论。

修正后定向 26 项 / 216 断言 / 3 文件 / 115ms 通过（`/tmp/agentic-f044b-safe-green.log`），typecheck、全 lint、文档/义务和 diff 检查通过。源码再次冻结交独立增量复核；没有版本、构建、UI 或 Git 操作。

### 2026-10-10 主线全量与 alpha.103 构建检查点

修正后独立 Spec/Standards 均确认 0 剩余代码阻断。主线源码全量 827 tests / 20168 assertions / 133 文件 / 20.12s 通过（`/tmp/agentic-f044b-source103.log`）；首次全量 826 / 20163 / 20.41s 是上述修正前历史，不混作最终源码证据。主线已递增 alpha.103，构建 session34900 进行中，日志 `/tmp/agentic-f044b-build103.log`；此刻尚无构建成功或包产物声明。真实 WK、自然中文 IME 及其余必需验收未完成，整片未验收、不得 Git。父与 offline-final 不关闭。

### 2026-10-10 alpha.103 构建及真实 WK 局部验证

主线使用已有 skipSigning 构建成功，包 `/tmp/agentic-markdown-alpha103.70JnsV/Agentic Markdown-canary.app`，hash `dg8n08eh8xrx`。包内 Bun 运行仓库测试 827 项 / 20169 断言 / 133 文件 / 20.15s（`/tmp/agentic-f044b-packaged103.log`）；源码 20168 与包内 20169 如实分别记录，不声称全部测试资源从包加载。

同隔离 HOME、fault lab 启动 exec86017 / PID61602，打开 cursors 616 字节 clean，普通源码不换行。主线实际验证：AAA 前定位后 ⌘⌥↓ 添加光标，X 同时插入 AAA/BBB 前；单步 undo 回 clean、redo 恢复双 X、再 undo。Shift+Right 三次形成 AAA/BBB 双范围（截图），粘贴 `甲\n乙` 分别替换两范围，undo 回 clean；复制这两个范围后在 END-ANCHOR 原生 ⌘V 得到 `AAA\nBBB`，undo 回 clean。坐标 ⌘点击 CCC 前增加光标，M 同时写入 AAA/CCC，Backspace 双删回 clean。

首次一批 Escape 后紧接 type Q 仍向双位置写 Q，原因未确认，不宣称已修或归因工具。undo 回 clean 后，独立 Escape 并读回 AX/截图仅 CCC 当前行，再 type Q 仅 CCC 插入，随后 undo 回 clean。保留这次差异，不将工具输入等同自然键盘全部通过。当前 cursors 唯一标签、普通源码 clean，未保存；其余实际验证及自然中文 IME 必要项仍待完成，整片未验收、不得 Git。

### 2026-10-10 alpha.103 后续局部验证（尚未验收）

- 双范围输入 Z 后切编辑，undo 回 clean；随后 S 只写 BBB，再 undo。A 的双范围跨 second 返回后 R 分别替换 AAA/BBB；B 自身双光标得到 TONE/TTWO 并自身 undo，回 A 再 undo clean，记录文档间选择及历史的该实际路径。
- wrap 开启及浅色下已截图双范围；跟随系统当前深色画面已有截图，之后恢复固定深色，未实际切换操作系统主题。
- 阅读往返：BBB 前 ⌘⌥↑，U 同时写 AAA/BBB、undo；source→reading→source 后 V 仅写 AAA、undo。此路径支持离开源码收敛主范围，不扩大为所有模式/输入组合。
- 源码双光标后点实验解析故障进入安全源码，之后重新单击编辑区再 F，仅写 emoji 末并 undo。因中间 click 会重置选择，这条不证明故障发生瞬间直接保留主范围。安全源码选择 BBB 后 Escape，再 E 得到 BBBE 而非覆盖 BBB，补既有单选区 Escape 路径。
- 此时 ⌘Q 弹未保存确认，选择继续编辑后 E 保留；后续 undo/正常退出尚待主线读回，不预写成功。

必要自然中文 IME 与自然 Escape 已由主线异步请求用户补证；首次批量 Escape 差异仍开放，未归因。此前“唯一 clean 标签”等现场描述现为当时历史；当前仍未验收、不得 Git，待主线提供最终现场，未保存正文。

### 2026-10-10 正常退出与自然输入复验现场

safe E 的未保存退出取消后仍保留已确认；随后 Cmd+Z 回 clean、Cmd+Q 返回 App quit，主线 ps 核对 PID61602 无输出。两份 fixture 的 SHA 与 baseline 一致，不把界面 clean 单独当作磁盘未变证明。

主线以相同 alpha.103、隔离 HOME/fault lab 重启 exec15559 / PID62142，经实际选择器重新打开 cursors 616 字节 clean 唯一标签。进入普通源码，AAA 前 ⌘⌥↓ 后截图确认逻辑 3/4 行双光标；wrap ON、固定深色。当前保留此现场供必要的用户自然中文 IME 与 Escape 复验，不继续 UI 操作、不保存。其他未完成实际边界及最终独立复核保持开放，整片未验收、不得 Git；旧 PID 与此前现场均为历史。

### 2026-10-10 用户必要自然输入亲验通过

用户最新明确确认自然中文 IME 候选确认/取消，以及非候选状态 Escape 验收通过（前条亦已反馈验收）。这两项为用户亲验，其他本片实际操作仍记受托 Agent 代验，不扩大为用户逐项亲验。原工具批量 Escape 差异保留未归因，不据用户通过倒写旧失败已解释。

必要自然输入待验状态已由该用户确认更新；整体仍等待最终独立复核与主线确认，不自行批准或 Git。用户操作后的当前正文 dirty 状态未知，之前 clean 仅为交接时事实。父、完整义务及 offline-final 保持开放。

### 2026-10-10 故障收敛后续取证（待最终判断）

用户验后主线 AX 读回 clean，没有修改用户 dirty。主线另建立 AAA/BBB 双空光标，故障后 Option+Tab 六次回编辑器，typeText K 只写 LONG-ANCHOR 前而非预期 BBB；随后 undo clean，原因未知，不将这条说成预期主光标保持或已修。

关闭 clean 文档并重新打开后，重新建立 AAA/BBB 双范围（Shift+Right 三次，主 BBB）。触发故障后尚未回焦的截图已只有 BBB 灰色选区、AAA 无选区；Option+Tab 六次后 AX 仍为 BBB，pressKey k 仅替换 BBB 为 k。Return 后组合状态结束、按钮恢复，未新增换行；Cmd+Z 回 clean 且 BBB 范围恢复。这是该双范围路径的实际故障收敛证据，与先前 click 重置选择的路径及本次双空光标异常分开记录，不覆盖未知差异。

未改代码；最终 verifier 正评估证据缺口与旧差异，整片尚未最终通过，不得 Git。当前最后读回 clean 及 BBB 范围，仅代表这次操作后的现场。

后续双空光标同形对照：重新 clean 开文并明确普通源码，AAA 前 ⌘⌥↓ 后触发故障；失焦截图没有 caret，不据此声称已读位置。Option+Tab 六次后截图明确 caret 在 BBB 前且 AAA 无 caret；pressKey k 仅得到 `222 kBBB end`，AAA 与 LONG 保持原样。Return 结束组合、Cmd+Z 回 clean，期间未再次点击正文或修改选区。无代码修复；旧 typeText 不同位置结果仍未归因，不以新对照删除历史。证据已交最终 verifier，仍等待主线整体确认，不预写通过或 Git。

### 2026-10-10 正式结论

独立 Spec/Standards 确认 0 剩余阻断，主线正式确认 alpha.103 非离线本片通过。用户明确亲验自然中文 IME 候选确认/取消与非候选 Escape；其他实际操作与自动验证为受托 Agent 代验。源码 827/20168、包内 Bun 仓库测试 827/20169 分别记录，真实路径及受控测试不互相冒充。旧批量 Escape/typeText 差异仍未归因，不声明其根因已修；通过依据包括后续同形实际对照及必要用户确认。

Git 待主线实际执行，不预写 SHA；父 F-044、完整 OBL-059/064、F-044b-offline-final 与未实操边界保持开放。E-04 新决定仅为后续产品规则，不包含在本片实现中。

最后实际收尾：clean 下 Cmd+Q 返回 App quit，ps 核对 PID62142 无输出；两份 fixture SHA 仍与 baseline 一致，未保存正文。当前无 alpha.103 运行现场，不把旧交接现场写成仍在运行。

### 2026-10-10 实际 Git 回执

主线已提交并推送 `15c94f08938fba956e9fedd0f126246385251301`，`ls-remote` 核验远端 main 为同一 SHA，随后 git status 为空。上述待 Git 为提交前历史；本条收据的文档补记不声明已再次提交。验收边界、父项及 offline-final 状态不变。
