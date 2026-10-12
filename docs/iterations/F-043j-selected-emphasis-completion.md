# F-043j：星号输入包裹非空选区为强调

> 状态：alpha.125 非离线有限片经最终独立 Spec / Standards 各0必要阻断，主线正式批准受托Agent代验通过，非用户亲验；Git待实际执行。下方候选/未实施/待批准为历史。
> 日期：2026-10-12

## 最终复核与交付范围

两条独立复核均确认本片0剩余必要阻断，独立核两样本SHA原样、权限644与Bun16149已退出；主线批准本片通过。源码与包内Bun运行仓库各970项/28236断言、定向两轴各31/960，type/full lint/文档检查通过。真实WK证据及第一次跨标签undo未生效的观察保持下述边界，不推断根因或声明修复；自然物理IME、完整主题矩阵、父F-043/完整E-05/OBL-058/064与F-043j-offline-final继续开放。没有保存用户正文或改变网络。

## 最新真实 WK 候选与启动观察

用户报告超时与未退出旧App、未关闭安装完成窗口有关。主线只读核alpha125相关旧进程无匹配、CUA inventory为未运行，再启动同一已解包包exec6106/Bun16149，CUA立即恢复。此与用户观察一致，但没有分别控制两个因素的实验，不宣称全部超时唯一根因。后续启动前检查旧App及安装完成窗口均退出/关闭；不得用强杀、重叠启动或改网络替代核对。此轮未改生产或重打包。

- 自建A通过选择器打开，先核Alpha plain text.选区；编辑输入Shift+8切源码见`*Alpha plain text.*`，内部选区保留；一次undo回clean。普通源码同样包裹、undo/redo恢复；切编辑离开范围后截图见真实斜体且标记隐藏。
- 打开B后回A，第一串切标签/undo/切模式未撤销，前一AX曾显示权限确认中，但未采事件不推断原因。已聚焦普通源码再次undo后恢复原文clean及原选区；记录该观察，不称第一条命令成功。
- A选中段内首尾空格的padded后Shift+8仅普通替换，得到`START * END`，未误包裹；已有强调内部文字同键得到`***`，不解包。空光标只插单星号。各次undo回clean。
- B临时粘贴AAA/BBB，公开添加下方光标/Shift+Home，先截图核两非空选区；一次Shift+8得到两行`*AAA*`/`*BBB*`，逐行AX和截图确认。汇总AX Value截断，不能依赖其全文值。一次undo两行同时还原，第二次undo恢复B磁盘基线。
- B权限临时444，实际只读提示后选正文Shift+8未修改，恢复644；解析故障实验降级安全源码后相同选择只普通替换为单星号，无自动包裹，undo回clean。A阅读模式正文点击后Shift+8无变化，仍clean。
- A普通源码选Alpha后工具按n，截图明确蓝色marked下划线、相关命令禁用；Shift+8变为n*仍组合，Return结束组合，正文仍仅n*，没有强调包裹或重复提交，一次undo回原文clean。随后n/Esc/undo整体回clean，中间态未逐项采集，不额外声称完整取消矩阵。不是自然物理键盘或所有IME布局验收。
- 最终两文档clean，⌘Q正常退出（工具App quit），只读核Bun16149不存在、A/B SHA与预建值一致、权限均644。未保存用户正文、未断网。仅深色本轮实测，浅色/所有拒绝组合/真实竞态与性能未扩称；自动证据与实际证据分列，完整父/OBL/offline-final开放。候选待独立最终复核，不得提前Git。

最新重连：第二次精确路径失败后重建CUA会话、间隔30秒，第三次/private/tmp规范路径仍timeoutReached，无AX/截图。Bun13666保持运行，不强杀或重叠启动，已请用户正常退出后通知以核退重开。包内Bun运行仓库全量970/28236/155文件/21.48s通过（`/tmp/agentic-f043j-package125-tests.log`），不替代真实WK，尚未打开fixture/验收/提交。

最新构建：typecheck/full lint/文档及diff检查通过，alpha.125构建成功（`/tmp/agentic-f043j-build125.log`，保留既有大chunk/hdiutil弃用警告）。副本`/tmp/agentic-markdown-alpha125.8SVBk3/Agentic Markdown-canary.app`，plist CFBundleVersion与解包version.json均alpha.125/hash2pjp6cat96nmk；查询不存在的CFBundleShortVersionString一次失败，不改产物。首次解包前包内Bun路径不存在exit127，启动后再运行包内Bun仓库测试；不记首次为测试通过。隔离HOME/fault lab启动exec28066，self-extractor先报sandbox_extension警告随后完成安装；CUA首次精确路径timeoutReached，无新AX/截图，不推因。尚未打开/保存fixture，未真实验收/不得Git，保留进程间隔重试。

最新批准：主线全文读取有限实验结果与生产建议，all复跑30/0（main-rerun.log），独立Spec另复跑30/0并确认0路线阻断，Standards预核0。现批准仅现有严格输入分支与薄事务helper窄复用，单星号接italic wrap-only；旧五类/反引号/toggle/parser不变，新增必要生产回归。尚未生产验收或构建；下段仅实验为此前检查点。

主线已全文读取最小方案及prototype LOGIC说明，独立Spec确认0产品/实验路线阻断，现批准仅明确临时目录有限逻辑实验；不加生产脚本/正式测试套件、不接生产/版本/构建。实验后须另行独立核对与主线批准生产。

<!-- obligations: OBL-058 -->
<!-- deferred-obligations: none -->

## 功能说明与依据

能力总账 E-05 及 2026-08-25 决定已确认保守 Markdown 补全、选区包裹强调/代码、触发与补全单步撤销；普通 `*`、`_`、`-` 不立即推断结构。主线依连续授权选择本片：明确非空选区输入单个 `*` 对应斜体强调，不是粗体或结构列表。

普通编辑/普通源码中，所有范围均为非空、同物理行、可靠合法普通正文时，输入一个 `*` 生成 `*所选文字*`，保留原选中文字、方向和主范围。只 wrap-only，不解包已有强调，不把第二个星号升级粗体。编辑保留单范围，源码多范围整次成功才自动包裹；任一不支持则整次返回既有普通输入，不能部分派发。回退可能按原编辑器行为替换选中文字，不承诺原文不变，也不吞正常输入。

首尾空白（含全空白）不自动修剪、移出标记或添加占位；选区含现有强调/代码/链接等结构、相邻标记或转义，以及跨行、空范围、围栏/HTML、保护长行、解析不完整等均沿现有保守准入回退。普通标点不一概禁止，须由完整相关语义容器中的实际 CommonMark 强调节点边界验证；不能只按字符串两端加星号判断合法。段落其他行的未闭合标记与相邻文字可能影响 delimiter 配对，必须保留完整容器验证。

不含 `_` 输入、双星号输入/连续升级、空光标配对、关闭标记跳过、任意嵌套强调、跨行包裹、链接补全、围栏内部 Enter、GFM 或新快捷键。F-028c、明确专项设计与最终离线仍不推进；完整 E-05/F-043 不关闭。

## 最小技术方案

已只读核对本地固定 `@codemirror/view@6.43.12` 公开声明：`EditorView.inputHandler(view, from, to, text, insert)` 返回是否接管；现有 contextual-pairing 入口和 F-043i 严格当前 view/controller state/session/focus/权限/模式/IME 守卫可复用。精确输入单 `*` 且 from/to 等于当前主范围才尝试新分支，不影响旧五类配对、反引号包裹或显式格式命令。

复用 `planInlineFormat(state, "italic", "wrap-only")` 及已区分意图的缓存。现有规划器已在同类节点 toggle 前拒绝 wrap-only、拒绝空范围，保留完整顶层相关块（含必要列表/引用祖先）、聚合计算保护及公开 Lezer 局部候选解析。不新增解析器、不强制全篇解析、不逐范围构造完整 EditorState；canonical parser 仅为测试 oracle。候选必须得到准确对应新增范围的 Emphasis，不得借用更大范围的邻接强调节点通过。

成功仅一次 `state.update` / dispatch，`input.type` 与公开 `isolateHistory.of("full")` 隔离前后普通输入；不调用默认 insert 生成第二候选事务。失败返回 false 交回原输入。复用既有原文/历史/字节上限通道，不改保存基线；controller 拒绝事务不应误报自动补齐成功。若整理公共 helper，仅做本分支所需窄复用，不重构完整格式或命令平台。

## 隔离验证计划（尚未批准执行）

主线与独立核对批准后，按 prototype/LOGIC 在明确临时目录建立纯候选与薄 case/all driver，用实际生产 state、公开 inputHandler facet 和现有原文/history；受控 view 不冒称真实 DOM/IME。

- 合法正文：中文/emoji/拉丁文，正反范围，编辑/源码；标点在选区内外及词内位置，逐例核准确 Emphasis 边界、正文值和未选邻文。
- 不支持：首尾/全空白、转义及相邻 `*`/`_`、已有强调完整或局部选区、代码/链接/HTML、空范围/跨行；拒绝后不得解包、部分自动补齐或吞输入。
- 语义环境：同段跨行未闭合标记、合法列表/引用正文与结构前缀；验证完整容器，不能截断单行伪造成功。
- 源码双范围及反向主范围；一合法一非法全部回退。同容器多范围一次计划，保留 mainIndex 和方向。
- BOM/CRLF 原文；前后普通 input.type 与本次单步 undo/redo；一个目标 transactionFilter 调用；旧 toggle/反引号与五类配对回归。
- 输入入口：from/to 不符、旧 view/state/session、权限/冻结/模式/IME及释放。仅证明新处理器不接管，不用 fallback harness 证明原生默认输入链安全。

实验失败及实际边界须保留。若现有语义验证不足以防邻接内容误吸收，先报告具体反例和最小修正，不直接扩展解析路线。实验通过后仍须主线批准生产。

## 最小 happy path 与验收

普通编辑选中文字输入 `*` 呈现斜体，切源码核 `*文字*` 和原选区；一次撤销恢复原文，重做恢复包裹。源码双范围一次包裹与一次撤销，跨标签/模式保持独立历史。无选区普通输入、不支持选择回退而非 toggle；只读/阅读/安全源码与组合输入不新增自动包裹。只在自建样本实测并恢复，未保存用户正文、正常退出与 hash 核对分列证据。真实 WK、工具驱动系统输入和用户自然键盘证据分别记录，不扩大结论。

## 继承约束与义务

F-014 原文/历史、F-042a 强调规划、F-043b 输入入口、F-044b 源码多范围及 F-043i 严格 wrap-only 消费者已具备。F-043i 实际提交推送 `057c1032c5fe088405c8c6c7287b9b04e696bd4f`，主线核远端一致且当时干净；本方案未声称新的 Git 成功。

- 中文与外观：沿现有强调呈现与主题，不新增独立 UI；中文/emoji 与标记显隐实际回归。
- F-002：全程本地内存变换，不读取外部资源或自动写盘；真实操作只用自建样本，最终离线单独保留人工。
- 命令与键盘：复用公开输入处理及当前文档守卫，不新增快捷键/原生菜单；组合输入优先，不改原默认回退行为。
- 安全与日志：只内存事务，无外部请求、自动保存、正文日志或新权限；安全降级与只读隔离保持。
- 生命周期与性能：旧 state/session/view 失效，释放不得影响新注册；沿既有聚合有界验证与缓存，不新增性能 SLO 或文件大小限制。

局部主承接 OBL-058；OBL-064 为历史/IME消费者协作，主责仍 F-014，不迁移或关闭完整义务。父 F-043、完整 E-05/OBL-058/064 保持开放，`F-043j-offline-final` 留最终统一人工，不断网。实现不默认 TDD；代码重打包递增 alpha 由主线处理，独立双轴、自动检查及真实代验完成并主线批准后才 Git。

## 有限隔离实验结果与生产建议

主线批准后全文读取 prototype/SKILL.md 与 LOGIC.md，按本片约束只在 `/tmp/agentic-f043j-poc.CDNuyq` 建立标记 PROTOTYPE 的 `planner.ts` 与 `driver.ts`，无仓库脚本、依赖或生产改动。复跑命令：`bun /tmp/agentic-f043j-poc.CDNuyq/driver.ts all`；可传单例名称或 `interactive` 逐例运行。`run-first.log` 保存29组首跑，`run-final.log` 保存补精确边界/历史后的30组，均exit0，未出现断言失败。仅有限已列样本，不泛称所有Markdown上下文通过。

候选直接调用实际 `planInlineFormat(state, "italic", "wrap-only")`，一次 input.type/full 隔离事务。正文、资格及受控输入条件合29组，另1组前后普通输入历史：中文/emoji、正反范围、内外标点、词内 `a*b*c`、同容器两范围、BOM/CRLF、列表/引用正文及两种跨行未闭星号样本成功；首尾/全空格、现有/嵌套强调、邻接标记、代码/链接/转义、空/跨行/混合范围、围栏/HTML及只读/组合标志/失焦/from不符不接管。其中分类是样本说明，不代表每类所有组合均已测。

实际同容器 `AAA between BBB` 得到 `*AAA* between *BBB*`，两个独立Emphasis值分别为AAA/BBB，反向第一范围及主范围1保持。每一成功样本都核canonical全文文本相同、Emphasis值对应原选区，节点起止与最终逻辑选区±1经当前生产 `rawOffset` 映射后的raw位置精确相同（含BOM/CRLF），未借数量相等断言未选正文安全。两种跨行未闭标记样本仍只形成所选abc的Emphasis。每次一次dispatch、undo原raw/原选区、redo包裹raw。前后普通input.type不额外隔离时undo依次为`*abc*`、`abc`、`a`，redo反向恢复，证明该样本本次full隔离有效。

受控public facet没有DOM或实际controller生命周期，失败分支没有继续派发默认输入，因此日志“不变”仅是新handler未执行，不代表产品普通输入会被阻止。真实IME、事件来源、权限变化/重挂等生产守卫与WK仍待验证；未增加正式测试或伪称完整矩阵已测。

推荐最小生产：仅在现有严格选区包裹入口新增精确单`*`分支，将薄事务helper按`code/italic`复用既有wrap-only计划及full历史隔离（可窄改函数/guard命名表达两种消费者）；原有反引号、五类配对、显式toggle和缓存行为保持，不改规划器语义或解析器。所有范围预先成功才一次dispatch，不支持返回原处理。无需新产品决定或新安全路线；仍待主线读取结果、独立复跑和明确生产授权。

## 获批窄实现与自动证据（待独立复核）

最新独立Spec/Standards代码各0必要阻断，各复跑6文件31项960断言通过；主线源码全量970项/28236断言/155文件/23.69s通过（`/tmp/agentic-f043j-full.log`）。升alpha.125构建，尚未真实验收，不得Git。自建WK样本`/tmp/agentic-f043j-ui.hY6cTl/emphasis-a.md` SHA256 `3652b1bddcb81008652e722907c7b23ad2e25a23ad1e677b4cbab2e3ac1dde9e`，B `emphasis-b.md` SHA256 `7b633701ea5e51222235fba6f5ac7887bc1311b59a813482019d4f4b694e4374`；尚未打开或保存。

主线完整读取并all复跑30/0，独立Spec亦30/0且无路线阻断、Standards预核无阻断后，批准本片生产。仅改 `contextual-pairing.ts`：新增精确单`*`映射italic，薄 `selectedInlineTransaction` 复用既有wrap-only/full历史，保留 `selectedCodeTransaction` 兼容入口；第三guard内部命名为selectedInline，不改MemoryEditor当前controller state/session/focus/权限/模式/IME回调或cleanup身份语义。旧五类配对、反引号、显式toggle、规划器/parser/raw/history均无规则修改。

新增 `selected-emphasis-input.test.ts` 5组正式回归，实际生产函数覆盖编辑/源码正反范围、中文/emoji/标点、词内、邻接跨行未闭星号、列表/引用及BOM/CRLF；canonical文本与Emphasis精确raw位置、未选between子节点保留、多范围方向/mainIndex、一次transactionFilter、非法混合全退、单步undo/redo及前后普通输入隔离。受控入口覆盖strict拒绝不影响旧配对、普通资格/只读/IME/from不符、单次派发/被拒返回false、旧cleanup不删新注册；不是实际DOM或自然IME验收。

首轮新/旧输入定向16项789断言通过。最终命令 `bun test apps/desktop/src/client/selected-emphasis-input.test.ts apps/desktop/src/client/selected-code-input.test.ts apps/desktop/src/client/contextual-pairing.test.ts apps/desktop/src/client/inline-format.test.ts apps/desktop/src/client/inline-format-input.test.ts`：26项909断言、5文件、158ms、0失败。`bun run typecheck` 与两变更TS文件 `eslint --max-warnings 0` 均通过，本次实施检查无已观察失败。当前未全量、未构建或真实WK，版本由主线后续处理；不以定向通过批准本片验收/Git。
