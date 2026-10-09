# F-043a：普通源码全局软换行偏好

> 状态：2026-10-10 alpha.102 非离线本片已受托 Agent 代验通过，独立 Spec/Standards 均 0 阻断、主线确认；不是用户亲验，Git 待主线实际执行。父 F-043、完整 OBL-058 与 offline-final 开放。此前失败与未实测边界保留。

<!-- obligations: OBL-058 -->
<!-- deferred-obligations: none -->

## 功能说明与范围

落实能力总账 E-13 及 2026-08-26 决定：普通源码默认软换行，可通过全局设置关闭；关闭后长行横向滚动，不插入或删除实际换行符。已打开和后续打开的文档均遵循偏好。编辑和阅读始终按既有规则换行；普通源码中的围栏代码行随整体源码偏好，排除的是编辑/阅读围栏内部专项换行。安全源码仍沿现有极简隔离与原有换行行为，不因本片增加普通源码呈现扩展。

只新增“源码自动换行”设置（默认开启），复用设置页可键盘操作的控件，不新增命令、快捷键、自动配对、补全、缩进、拼写或多光标。切换偏好不重建 EditorView，不改变正文、dirty、选区、撤销历史、磁盘基线或权限；视口保持以当前内容位置为准，重新排版不能承诺原像素布局完全不变。不触碰 F-028c。

## 已核对的现有接口

- `client/raw-buffer.ts` 当前全局安装 `EditorView.lineWrapping`；本片必须迁移为可重配置 Compartment，不能只在普通源码追加 nowrap 而让全局扩展仍生效。
- `client/editor-mode.ts` 已有 presentation/parser Compartment 与安全隔离分支；`components/memory-editor.tsx` 保持文档级 view，最新同步 helper 防止恢复 viewport 后旧 render state 回退。
- `components/settings/general-page.tsx` 及 `hooks/use-update-mode.ts` 已有受控设置 UI/共享外部 store 模式；Bun `updates/state.ts`、workspace preferences 复用 `createSettingsStore/getSettingsDir`。新增布尔偏好应复用该 App 隔离数据目录，不借用更新策略字段，不储存用户文档路径。
- `shared/rpc.ts` 和 `bun/rpc/index.ts` 已有设置读写通道；本片只增加最小严格布尔请求/响应，不增加框架或依赖。controller 已有组合输入交互检查/notifyInteraction、文档缓存及模式切换，可用于延迟呈现重配置。

## 最小技术方案

1. 使用现有 settings store 在 App 数据区独立保存源码换行布尔偏好；缺失/无效字段默认 true，读写异常给固定中文提示。沿现有设置渠道验证请求/响应，拒绝非布尔/多余字段，不记录正文/路径。不写成功就不将失败偏好当作已持久化；串行或代次隔离快速切换和晚回执，启动加载不得覆盖更新的用户选择。
2. renderer 共享偏好 store 加载一次，设置页显示当前值/保存中/失败；controller 接入已确认值并保存最新期望。已开缓存文档与新建 EditorState、后续模式切换同源使用该偏好。无全局持续逐文档轮询。
3. 将原 lineWrapping 迁入窄 Compartment，以当前模式/安全状态/全局偏好计算实际扩展：普通源码按偏好，编辑/安全隔离保持原有换行，阅读不受影响。通过重配置事务动态更新，不重建 view、不加入 undo 历史、不推进正文 revision。保留源码逻辑行号，关闭后仍按真实逻辑行编号。
4. 活跃输入法组合期间不立即重配置当前 view，合并为最后一个待应用偏好，在 composition 结束的既有交互通知后重检当前文档、模式和生命周期再应用；不把异步读设置或隐藏标签变化当成可越过 IME 的理由，不冻结整个应用。文档关闭、切换、退出后晚回执不得复活旧 view。缓存状态仅用公开 State/Compartment API。
5. 内容锚点和选区保持为必要判据，不是任意跳顶的许可。当前活跃 view 通过公开 requestMeasure/posAtCoords/coordsAtPos 捕获可见字符，用同一重配置事务的 scrollIntoView 恢复；没有可靠坐标时退回公开 scrollSnapshot（逻辑块偏移，不冒称精确字符恢复）。读写测量间检查当前 state，文档/view/生命周期过期不应用。隐藏缓存先保留原 wrap 状态，激活完成旧布局的视口恢复后，再基于可见字符应用最新偏好；不遍历重排全部隐藏文档。初始恢复完成前不提前测量，新旧回调不得复活旧视图，desired 偏好始终保留。实际 WK 必测长逻辑行中段、后续还有多行的场景，不能只验证首尾夹取；重排后像素变化允许但内容锚点不能任意丢失。不扩大为 F-040 全量位置恢复重写，不预设性能门槛、不增加每键 React 更新。

## 最小 happy path 与边界验证

- 自动：默认 true、有效 false 重启读回、坏值与存储失败；严格 RPC；保存串行/加载晚回执不会逆转最新偏好。普通源码开/关、编辑/阅读/安全隔离不泄漏，已开/新开/模式往返遵循同一值。
- 实际 CM State 回归：同 doc/selection/history、正文和 revision 不变，undo/redo 只撤销用户编辑；控件的重配置不重建 view。IME 合成时延迟并合并最新值、结束后应用，关闭/切换晚通知不复活；合成不冒充自然输入法。
- 真实 WK：长逻辑行源码默认换行→设置关闭后一行横向滚动→开启恢复；行号不按视觉折行重复，编辑/阅读仍换行。两文档、dirty/范围选区、undo/redo 和上下滚动位置、源码往返保持；深浅/当前系统主题控件可辨，键盘可操作。
- 真实重启验证全局偏好持久化（不等于恢复目录授权/会话），安全降级不附加本片策略；普通退出/未保存确认遵循既有规则。不保存临时正文。必要自然 IME 若无法自动验证则明确保留，不伪造通过。

## 继承约束

- F-002：本地设置，无在线服务；`F-043a-offline-final` 留最终人工，不断网。
- 中文与外观：设置中文名称/帮助及固定失败提示，复用现有外观、可访问名称与 focus 样式；技术术语不向普通设置用户扩张。
- 命令与键盘：OBL-058 本片局部适用，设置控件有键盘等价入口；不新增命令/快捷键，完整父功能未来命令责任仍开放。
- 安全与日志：仅布尔偏好，不授权文件、不执行 Markdown 内容、不增正文日志或遥测；安全隔离不解除，F-028c 不涉及。

## 实施记录

仅最小方案待批准，没有生产代码或测试成功声明。实现遵循用户不默认 TDD 约束，定向/typecheck、最终全量及独立双轴审核后由主线版本/构建/真实验收；通过后才按既有连续授权 Git。目前未发现需要新增产品决定，若视口/IME 接入要求扩大既定行为，将先报告主线而非猜默认。

### 2026-10-06 批准后实施（进行中）

主线已批准以上最小方案及字符锚点/隐藏缓存延迟细化。现已接入独立布尔设置与严格 RPC、共享确认式偏好 store、模式 Compartment、控制器期望值/IME 门禁及 view 测量调度；初轮 typecheck 通过，测试和独立审核尚在进行。旧“仅方案”段为启动历史，不代表当前实施状态。未更新版本或构建，不能列作可用功能。

### 2026-10-06 独立评审中的测量阶段修正

Spec 与 Standards 独立指出初版在 `requestMeasure.write` 中直接派发事务；本地安装的 CodeMirror 在该阶段仍为 Updating，调用 view.update 会拒绝。按 diagnosing-bugs 的反馈纪律对这条明确 API 约束做单变量验证，不虚构额外根因：提取真实调用的窄 `deferWrappingUpdate` seam，临时同步执行得到 0 通过 / 1 失败（apply 仍处于测量阶段）；恢复微任务后 1 通过 / 7 断言。命令为 `bun test apps/desktop/src/client/wrapping-measure.test.ts`，分别记录 `/tmp/agentic-f043a-measure-red.log` 与 `/tmp/agentic-f043a-measure-green.log`。

修正后 write 只排微任务，退出测量阶段后重检当前 view/文档/state；state 不符则重新测量，IME/冻结/忙碌与销毁由控制器最终复核，未满足时保留全局期望、不强行应用。没有吞异常、改事务先后、临时日志或新诊断 UI。上述为受控调度 seam 的红绿，不是真实 DOM/CM 测量执行或 WK 验收证据；真实重排与内容锚点仍交主线。首轮 lint 曾检出新 store 未声明 `this: void`、测试 unknown/异步 matcher 使用问题，已窄修，最终检查待收集。

### 2026-10-06 源码冻结交付候选

最终定向 6 文件 31 项 / 202 断言全部通过（129ms，`/tmp/agentic-f043a-targeted-final.log`）；全仓 typecheck、lint、feature-docs（含 obligations）及 diff check 均通过，记录分别为 `/tmp/agentic-f043a-typecheck-final.log`、`/tmp/agentic-f043a-lint-final.log`、`/tmp/agentic-f043a-docs-final.log`。新增调度/helper/store/MemoryEditor 格式检查通过。测试覆盖持久化/严格 RPC、加载与保存晚回执、模式隔离、历史与选区、隐藏缓存激活、测量失配/IME/冻结/dispose；这些是受控状态与调度测试，不替代自然 IME、真实字符锚点、键盘设置或新进程持久化实测。未执行全量测试或 App 构建，由主线统一执行；尚未验收，不 Git。

### 2026-10-06 alpha.102 主线交付与首次连接检查点

- 源码全量 820 项 / 20092 断言 / 132 文件通过，20.98s，`/tmp/agentic-f043a-source102.log`；包内 Bun 运行仓库测试同为 820 项 / 20092 断言 / 132 文件通过，20.82s，`/tmp/agentic-f043a-packaged102.log`。后者不等于所有测试资源均从 App 包读取。
- 使用既有 skipSigning 设置构建成功，常规 chunk/hdiutil 警告保留，日志 `/tmp/agentic-f043a-build102.log`。提取包 `/tmp/agentic-markdown-alpha102.WQhP7Q/Agentic Markdown-canary.app`，版本 alpha.102、hash `e9letu1cjz6d`。
- 使用隔离 HOME `/tmp/agentic-sidebar-layout-data.cPxLT0`、fault lab 启动，exec session 23689 / Bun PID 11615。首次 CUA getApp 返回 `cgWindowNotFound`；随后 listApps 返回 `Sky native pipe startup failed`。尚无真实界面证据，不据此判断应用或工具根因，也不把进程启动当成功验收。主线继续间隔重试。
- 修正后独立 Spec 与 Standards 均无剩余代码阻断，仅为代码结论；本片真实 WK 范围未验收、不得 Git。父 F-043、完整 OBL-058 与 offline-final 保持开放，历史失败不删除。

### 2026-10-06 间隔重试与明确锁屏返回

间隔重试 getApp 仍返回 `cgWindowNotFound`。主线通过 ps 确认 PID 11615 仍运行，随后 getState 恢复并返回运行中的 App。bundle ID 连接存在歧义，改用精确路径 `/tmp/agentic-markdown-alpha102.WQhP7Q/Agentic Markdown-canary.app` 后，工具明确返回：`The Mac is locked and automatic unlock could not unlock it. Ask the user to unlock the Mac manually before continuing.`

这仅证明该次调用遇到锁屏，不将此前窗口或 native pipe 错误追溯归因为锁屏。主线已请求用户手动解锁，保留进程与现场；进程存活不证明界面响应或验收通过。本轮未打开、编辑或保存用户正文，没有新增源码、版本或 Git 操作。alpha.102 尚未实际界面验收，不得 Git；解锁后继续既有范围，父项及离线最终人工项不关闭。

### 2026-10-10 alpha.102 恢复连接与软换行局部实证

- 精确路径 CUA 已恢复窗口连接。旧 PID 11615 已不在当前运行现场；实际读到新进程 56700/56701 的空欢迎页、无 fault lab，主线正常 super+Q 返回 App quit。随后显式隔离 HOME 与 fault lab 重启同 alpha.102 包，exec 66007 / PID 57664。不推断旧进程退出方式，也不混用旧现场。
- 打开 `/tmp/agentic-f043a-ui.zOaCrJ/long.md`，19667 字节、clean；⌘⇧M 切源码。设置默认复选框为 1，点击变 0；回正文长行单视觉行。选择第 010 行后 ⌘Right，实际横向滚动至末端片段 14 可见，正文仍 clean。重新开启后恢复软折行，逻辑行号不重复。
- 键盘 Next 两次后，顶部处于逻辑行 12（正文第 010 行后部片段 12/13），后续短行和第 020 行仍可见；在这里关闭换行，顶部仍为逻辑行 12、片段 12 附近，水平方向自动移至对应字符，没有跳到文首，仍 clean。这是该长行中段路径的内容位置局部实证，不承诺任意布局像素完全不变。
- 初次选择器批量 Go To 快捷键迟滞，后续分步输入路径成功；仅记录现象，不推断原因。截至本检查点没有 dirty 编辑或正文保存。跨文档、历史、主题及新进程偏好持久化等继续待验，尚不宣布整片通过。无代码、版本或 Git 改动，父功能、OBL-058 及 offline-final 保持开放。

### 2026-10-10 同包状态保持、模式隔离与键盘实证

- 临时编辑后选择 `TEMP-XYZ` 范围，跨设置关闭换行后选区与 dirty 保持；undo 回 clean、redo 恢复 dirty。新开 second，在源码模式遵循全局 off；处于 B 时开启换行，再返回 A 恢复 wrap 且 dirty 保持，undo 回 clean。没有保存正文。
- 浅色截图中设置控件可辨。跟随系统只读回 AX 选择，未动态修改系统外观，不能据此声称动态跟随实测；最后恢复固定 dark。
- 全局 off 时，阅读截图仍自动换行。long 经实验入口触发呈现故障后进入安全源码，截图仍 wrap、无 gutter，正文 clean；安全隔离未被普通源码偏好覆盖。自然 IME 本轮未实测，不以受控测试冒充。
- 键盘初试：设置打开时焦点为通用 tab，普通 Tab 到通用 container，再 Tab 到 Color picker，观察到跳过 checkbox/theme；theme 鼠标选中后 Home/Return 可切浅色，Shift+Tab 回通用 container，Space 没有改变 checkbox，也没有导致正文 dirty。此段不证明所有控件无法通过键盘操作，也不据此推断系统根因。
- 零代码对照成功：设置初始通用 tab → Option+Tab 到通用 container → 再 Option+Tab，AX 确认聚焦值为 0 的源码换行 checkbox → 单独 Space，值变为 1。随后鼠标恢复 0。仅证明该 Option+Tab/Space 路径可用，不声称普通 Tab 已可达；没有为此修改系统或产品代码。[Apple 的 WKPreferences 文档](https://developer.apple.com/documentation/webkit/wkpreferences/tabfocuseslinks)说明 Tab 导航偏好与 Option 临时反转机制，但本机具体配置/此前跳过原因仍未确定。

本片仍等待新进程偏好持久化与最终独立验收，未总体验收、不得 Git；父功能、完整 OBL-058 与离线最终人工保持开放。

### 2026-10-10 重启、编辑模式隔离与退出收尾候选

- 全局 off 时切 second 编辑模式，截图长逻辑行仍 wrap、正文 clean。两篇 clean 标签下 ⌘Q 返回 App quit，PID 57664 不存在；主线确认三个 fixture 的 SHA256 均与 baseline 一致，没有保存。
- 显式使用同隔离 HOME/fault lab 重启同 alpha.102 包，exec 88388 / PID 58509。设置读回“源码自动换行”为 0、深色。打开 second，1460 字节，切源码后截图为单视觉长行、横向溢出、逻辑行号存在，正文 clean。该新进程实证支持 off 偏好持久化，不等同恢复目录授权或文档会话。
- 将临时 `SECOND-ANCHOR` 替换为 `SECOND-ANCHOR TEMP-EXIT`；⌘Q 弹未保存确认，选择继续编辑后 dirty 与临时文本保留。⌘Z 回 clean，随后 ⌘Q 返回 App quit，PID 58509 不存在。主线再次核验全部 fixture hash 仍与 baseline 一致，没有保存；本段只记录主线确认的比较结果，不补造未提供的精确 hash 值。

结合前述同包实证，本片记为受托 Agent 代验完成候选、待独立最终复核，不自批通过、不写 Git 成功。普通 Tab 跳过控件的观察与 Option+Tab/Space 成功路径分开；自然 IME、动态改变系统外观及离线未实测，受控状态/调度测试不冒充这些实操。当前两个实际进程均已正常退出，不再描述为保留运行现场；父功能、完整 OBL-058 和 offline-final 不关闭。

### 2026-10-10 正式收尾结论

独立 Spec 与 Standards 最终均 0 阻断，主线确认 F-043a alpha.102 非离线本片受托 Agent 代验通过，非用户亲验。源码/包内 Bun 仓库测试各 820 项 / 20092 断言通过，真实 WK 的换行与横滚、长行中段位置、范围选区跨设置保持、跨标签 dirty 与撤销历史、模式隔离、偏好重启、Option+Tab/Space 设置入口和正常/取消退出证据如上。redo 后范围已折叠，不宣称范围选区跨标签或所有模式范围恢复已实测。源码测量重入修正的受控红绿、初次连接失败、锁屏与普通 Tab 跳过观察均保留，不覆盖为从未失败。

仅本片交付可用；自然 IME、动态系统外观及最终离线未实测边界不改写为已验。父 F-043、完整 OBL-058 以及 `F-043a-offline-final` 继续开放，不涉及 F-028c。Git 尚待主线执行并核验，不预写提交推送成功。
