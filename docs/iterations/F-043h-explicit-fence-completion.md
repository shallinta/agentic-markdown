# F-043h：文档末尾显式代码围栏补齐

> 状态：alpha.122 非离线 EOF 有限子片经最终独立 Spec/Standards 各 0 剩余必要阻断，主线正式批准受托 Agent 代验通过，非用户亲验；Git 待执行。下方待复核/连接失败/未实施为此前历史。
> 日期：2026-10-12

## 最新真实 WK 证据（2026-10-12）

最终结论：两条独立审核 lane 核对本节实际证据与未实测限制，均无剩余必要阻断；Spec 另复跑10项/416断言、核全量日志/文件哈希/644权限/进程已退，Standards核文档/义务/diff。两位均未操作UI，不冒称独立重复实操。主线依连续授权批准上述有限非离线范围通过；完整父功能、E-05/OBL-058/064与`F-043h-offline-final`保持开放。Git 结果待实际核验。

用户明确已退出并授权重开；旧 alpha.122 进程检查不存在后，重启同一副本、同隔离 App 数据与 fault lab，exec60763 / Bun53809，精确路径 CUA 已恢复 AX/截图。仅记录重开后成功，不推断此前四次超时根因。

- 自建 A/B 经真实文件选择器打开，未保存。A 编辑模式 EOF 粘贴三个反引号及 js 后 Enter，新增空内容行与同型闭围栏，截图光标在内容行；输入 VALUE 后切源码核原文。撤销 VALUE、撤销补齐、重做补齐，再撤销至最初粘贴前恢复 clean。
- A 源码 EOF 两空格加四波浪线及 js，Enter 后输入 VALUE，截图核两空格基线、四波浪线闭行和内容位置。打开 B 再回 A，源码/内容/dirty 保持；三次撤销恢复 clean。A 曾短暂显示权限确认中后恢复，不推断原因。
- 源码 Shift+Enter 仅普通换行，不补闭围栏；随后在开行与前一空行建立两个光标，Enter 两处普通换行，截图见两个光标且无闭围栏；撤销并 Escape、撤销粘贴回 clean。
- 源码开围栏后工具按 n，截图见原生组合输入下划线且相关命令禁用；Return 结束组合，截图仍同一行反引号加 n、没有新增闭围栏/换行，随后两次撤销回 clean。这是工具驱动的本机组合输入路径，不冒称用户自然物理键盘或完整中文候选选择验收。
- B 临时 chmod444，树/标签及正文明确只读；切入后 EOF Enter 不新增正文、仍 clean。恢复644后触发既有解析故障实验，安全源码可编辑；粘贴三波浪线再 Enter 仅普通换行，无自动闭围栏，撤销两次 clean。
- A/B 均 clean 后 ⌘Q，CUA 返回 App quit，进程检查无匹配；两个 SHA256 与初始完全一致，权限均644。只撤销 Agent 临时输入，未保存任何正文。

观察限制：AX 编辑区父文本在部分围栏状态省略 info 或闭行，子文本与截图仍显示原串；以像素与子节点交叉核对，不据父文本推断丢字。B 首次 AX 标签点击未切换，截图核仍 A，随后可见标签坐标点击成功。上述差异保留，不归因工具或应用缺陷。本次仅固定深色实操，浅色/系统动态未重验；所有语法/长度/CRLF/BOM/保护/旧 session 竞态仍以自动测试证据为限，不声称逐项 WK 实操。离线未执行，父 F-043、完整 E-05/OBL-058/064 及 offline-final 开放。初次补齐定位和 redo 既有光标差异依前文，不承诺 redo 原位。

第四次：再间隔30秒精确App路径重连仍`-10005 timeoutReached`，无新增真实窗口证据。未另起实例/强杀/改网络，现有包与样本保留，窗口可见询问尚待答复；本片仍未验收/不得Git。

最新检查点：alpha.122已构建，源码953/27456、包内Bun运行仓库953/27457（21.82秒，`/tmp/agentic-f043h-package122-tests.log`）通过，非产物内测试。独立最终代码0阻断；真实WK三次连接（含重建工具会话、间隔20秒、实际/private/tmp路径）均`-10005 timeoutReached`，无AX/截图，根因未知。inventory列运行及Bun47342存在不作为验收。已异步询问新版窗口是否可见，保留现场继续重试，不强杀/另开实例或改网络；未打开/保存正文、未验收/不得Git。下方待构建为历史。

主线批准隔离实验（2026-10-12）：已全文阅读本方案、当前Enter执行守卫及公开声明，独立Spec确认0路线必要阻断。按EOF有限范围执行临时纯planner/薄driver验证，不实施生产、版本或构建；实验结果再核生产方案。该范围是已授权的保守补全子片，不改既有Enter回退或待专项设计事项。

<!-- obligations: OBL-058 -->
<!-- deferred-obligations: none -->

## 功能说明与已确认依据

能力总账 E-05 及2026-08-25决定确认保守 Markdown 情境补全：只有意图明确才补齐围栏等结构；普通标点不激进改写；触发输入与自动插入作为单个可撤销事务。现有 F-043b 只处理五类 ASCII 配对，F-042a 是显式行内格式命令，均不代表围栏补齐已交付。

本片先验证一个不吞并后续正文的子范围：普通编辑或源码中，**唯一空光标位于 EOF，最后一行本身是完整、独立、顶层、尚未闭合的开围栏行**，按无修饰 Enter 时补一个内容行和对应闭围栏，光标置于内容行。支持反引号或波浪线至少三个字符；闭围栏同型同长度，0–3个前导空格保留，info 原样不改。示例候选为 `  ~~~~js` → `  ~~~~js\n  \n  ~~~~`，光标在中间行的两个结构空格之后；该空白是围栏基线，不增加代码内容缩进。最终须以 canonical 代码值及光标验证此候选，而非预先宣称实现正确。

已存在后续正文、已有闭围栏、光标不在EOF/开围栏行末、非空选区或多光标时，整次不自动补齐，继续原 Enter 路径；不能仅对部分光标补齐。Shift+Enter保持既有语义。本片不是代码块内部换行策略设计，不增加自动语言猜测、围栏高亮引擎或任意片段包裹。

## 最小范围与委托边界

- 必须由可靠公开语法确认唯一开CodeMark属于顶层FencedCode，开围栏所在行也是该块最后一行且到文档末尾；正则仅辅助读取原型、长度、前导空白，不能把已有围栏内部的同样文本当新开围栏。
- 反引号info包含反引号等非法语法不得补齐；实际开标记长度/类型由原文及公开节点核对，不硬编码三个字符。BOM是文件内容前缀，保留原位置，不复制到新行。
- 引用/列表等嵌套结构、四空格缩进代码、结构Tab、HTML以及解析未就绪/受保护位置不进入新补齐；保留既有Enter处理，不强制同步解析全文或临时换引擎。
- 阅读没有消费者；原isolated不装、动态safe不执行新增补齐。只读、IME候选、冻结及失效view/session沿既有实时守卫，不绕过原权限路径；“不补齐”不表示只读可执行普通写入。
- 不新增快捷键、原生菜单、RPC、设置或持久化状态。编辑仍单选区；源码现有多选区Enter保持原路径，不部分dispatch。不扩入GFM任务、链接/强调/行内代码自动补全或F-028c。

## 本地公开接口核查与可行性

已读当前`list-input.ts`：既有Enter由`Prec.high(EditorView.domEventHandlers)`接收，位于CM自身composition过滤之后，再经统一registry进入当前文档；候选期间返回false不认领，避免取消原生输入。`memory-editor.tsx`当前执行`listContinuationTransaction`；其中FencedCode/CodeBlock/HTMLBlock走普通换行分支。

已读安装版`@codemirror/lang-markdown`6.5.2公开声明：`insertNewlineContinueMarkup`延续列表/引用标记，`deleteMarkupBackward`处理标记退格，均不是围栏闭合补齐接口；不直接启用整套`markdownKeymap`替换现有命令。现有`source-indentation.ts`公开CodeMark读取可作为语义核查参考，但其要求已有两个标记，不能直接拿来判未闭合围栏。

初步可行路线是一个纯候选规划器，返回原坐标下的局部插入和内容行光标位置；在既有普通Enter事务入口前尝试，仅准入成功时使用候选，其他情况原路径不变。复用当前原文保真通道、公开ChangeSet/EditorSelection和既有history；最终一次事务、一次dispatch，不先插Enter再补第二事务，不在capture层处理键盘。实际接线文件和原文换行映射须实验后在最小生产方案确认，现阶段不批准编码。

## 隔离 PoC 计划与判据

主线全文阅读及独立复核批准前不运行。批准后按prototype/LOGIC，在明确mktemp目录用apply_patch建立标明THROWAWAY的纯planner与薄`case/all`命令行driver；不加入仓库脚本/依赖或重型框架。复用真实`createRawEditorState`、公开树、当前raw/history；canonical仅作独立语义oracle。打印实际input/output、树、selection与undo/redo，保留失败，不以命令退出0泛称全部支持。

| 样本 | 操作与判据 |
| --- | --- |
| 基本开围栏 | EOF的三个/四个反引号、三至五个波浪线，无info/有info，Enter一次完成；闭标记长度类型精确、info不变 |
| 基线 | 0/1/2/3空格前缀，内容行及闭行保留基线；追加普通代码文本后canonical值不多出基线空格 |
| 原文 | BOM、前序LF/CRLF/lone CR混合正文+末尾开围栏；未触及字节保持，新增行尾遵当前raw规则，光标按最终事务坐标而非raw长度猜测 |
| 历史 | 前序普通输入→Enter补齐→输入代码，分别undo/redo；Enter与自动闭围栏同一次undo，方向/mainIndex和共享状态不破坏 |
| 已闭/有余文 | 已闭合围栏行EOF、开围栏后存在内容行、文中开围栏、代码内部看似开围栏行，均不自动补；与既有Enter事务对照 |
| 语法边界 | 反引号info含反引号、四空格、Tab、引用/列表嵌套、HTML，纯规划器不产补齐；不把正则匹配当语法成立 |
| 选区 | 非空单范围、双空光标/混合多范围、光标不在末端，整次委托原路径；不部分补齐或丢光标 |
| 准入可靠性 | 解析未就绪/保护范围不强制ensure全文；只读/IME/safe/live目标守卫在生产批准后补执行seam，PoC不冒充真实DOM验收 |

最小成功标准：有限有效样本新增闭围栏且没有包装任何既有后文，canonical围栏类型/语言/内容符合预期，原文与单步历史精确；不准入样本没有新的补齐事务。若结构确认或CR/LF拼接存在缺口，报告并收窄/修正技术方案，不用全文replace或更换历史机制绕过。

## 继承约束检查

- F-002：仅本地内存编辑候选，不改保存/磁盘基线，不执行断网验收。
- 中文与外观：继承现有主题及围栏装饰；后续真实验收区分编辑/源码，当前无UI结果。
- 命令与键盘：复用统一Enter执行路径、实时可用性与公开CM组合输入保护，不新增键位或绕过IME。
- 安全与日志：不新增文件授权、网络、正文遥测；实验只用自建样本，旧view/session不可回调修改新文档。

## 义务、前置及当前边界

OBL-058局部主承接，OBL-064只作历史/IME消费者协作、主责仍F-014。公开语法/编辑状态、F-014原文历史、F-043c Enter路由和F-043d/e围栏基线已具备，当前无需新底层引擎；生产可行性仍待上述实验。完整E-05/F-043/OBL-058/064保持开放，`F-043h-offline-final`留最终人工。F-028c、专项设计及既有离线待验不自动推进。本文件只是最小方案，无实验/生产/版本/构建/UI/Git成果。

## 隔离实验结果（2026-10-12，待独立复核）

按主线批准与prototype/LOGIC最小逻辑分支，在指定`/tmp/agentic-f043h-poc.3ubD7G`以apply_patch建立纯`planner.ts`和薄`driver.ts`，不加入仓库脚本或依赖。复跑命令：`bun /tmp/agentic-f043h-poc.3ubD7G/driver.ts all`，或case名称如backtick、crlf、typed、history、guards。Bun1.3.14/macOS arm64，最终日志`run-final.log`；首次失败保留`run-first.log`。

候选只检查单空范围EOF、公开syntaxTreeAvailable、未受保护、原末行前缀及其对应顶层FencedCode唯一CodeMark；该标记必须真正属于原末行，已有代码内容中的另一种围栏不能触发。返回局部插入与逻辑光标，不派发、不改变输入状态；driver使用真实state.update及当前raw/history，不改raw通道、不ensure强制语法树。

23类基础输入在编辑/源码共运行45个有效case：编辑多光标样本因既有模型归一为单区而不作为多选区拒绝证据，source对应case实际验证拒绝。有效开围栏样本准确断言新增raw、原raw作为完整前缀不变、同型同长度闭标记、info对应canonical lang/meta不变、空内容代码值，以及光标处继续输入VALUE后的代码值正好VALUE。0–3空格基线不变成代码内容空格。已有闭围栏/内容/余文、非法info、四空格/Tab、引用/列表/HTML、非空选区/非EOF等没有补齐候选，组合执行与原listContinuationTransaction输出对照相同，原state无新增undo。

原文：BOM保持文件开头；有前文CRLF或混合行尾样本，新增两处换行均按当前raw规则为CRLF；只有lone CR前文的样本新增为LF，并非自动采用lone CR。样本undo精确恢复原始raw和原selection，redo恢复补齐raw；redo光标不等同首次补齐光标，具体差异如下，不能泛称redo选区完全恢复。

另外6种围栏串各在编辑/源码从空文档逐字符state事务构造，共12次不调用ensure后的准入/代码语义断言通过；这是公开真实state增量解析证据，不是用户物理键盘或native IME。单独history样本先输入js，再Enter补齐，再输入x：三次undo按输入x→补齐→js逐步恢复，redo逆序精确恢复，补齐只有一个history事件。只读facet、无语言树、受保护超长开行三个guard对照无候选。

首次all在multi/editing断言失败：driver错误假定编辑模式能保留双范围，实际已归一成一个EOF光标，故候选合法。修正driver仅在源码验证多范围拒绝，编辑模式单选区保持原约束；未因此改候选或生产。最终all退出0且上述逐项断言通过，不扩称native键盘、IME、safe、旧view生命周期或全语法已验收。

输出快照修正：旧日志仅标selection，实际在redo后读取，反引号样本为8而首次补齐为4；不是新增VALUE后的变量。原输出保留`run-before-snapshot-label.log`。现driver分别打印completedSelection、redoSelection及独立typingProbeSelection，不把混时序字段当同一快照。曾增加“redo selection等于首次”断言，executor及主线复跑均exit1（原driver行38），已作为明确失败保留此记录；没有改raw/history使其通过。额外公开userEvent对照`input.type`与`input.complete`均首次4、redo8，raw一致，现只如实报告，不归因产品缺陷或宣称原位置已恢复。最终run-final.log对应移除过宽断言、准确分列字段后的冻结driver。

## 最小生产接线建议（待批准，不实施）

主线生产批准（2026-10-12）：已全文读冻结结果与本节、复跑backtick核首次/redo光标差异；独立Spec/Standards均0路线必要阻断。批准下列typed小模块与现有守卫入口的有限接线、回归，不改raw/history。首次补齐定位内容行，redo保留现公开history行为并在手册写清，不承诺同位置恢复。版本/构建/共享文档/UI/Git由主线执行；完整父/义务/专项边界不变，下文待批准为原建议历史。

新增小型纯EOF围栏planner，使用当前公开节点/保护/范围判断，返回变化与光标或undefined；不安装新的解析器、扩展或事件监听。优先在MemoryEditor既有当前view/state/焦点/composition/readOnly守卫后的普通Enter执行处组合：非soft时尝试planner，成功只创建一笔带isolateHistory的原文事务，否则原样执行listContinuationTransaction；Shift+Enter完全不尝试。既有registry命令及公开domEventHandlers不变，IME原生保护不绕过。实际源码接线保持一个消费者入口，不修改默认Enter、raw/history和多选区机制。

新增补齐路径执行时再核controller当前EditorState与view.state精确相同，并核captured editorFaultSession仍为当前session；不只比较doc字符串/文档ID。该更强守卫不改变soft和既有普通Enter路径。超长开行直接不补，闭标记长度及插入增长在分配前沿既有保护有界检查，不新设文件限制；最终1MiB原文上限仍由原controller事务守卫执行，不绕过。初次补齐光标置内容行；redo暂沿既有公开history观察到的默认光标行为，若主线要求改变须另核公开机制，不在本片擅改共享历史。

正式回归复用本矩阵并增加生产调用seam：soft、多范围、safe、只读、组合输入和旧view/状态均不可执行新补齐；fallback与既有普通换行完全相同，不能因false/undefined语义误吞默认行为。检查事务最终selection与原文byte边界，单步undo和前后历史隔离。真实WK由主线分别验证编辑装饰与源码输入、光标、中文候选Enter、只读、跨模式历史及退出；本实验不替代这些验收。

本路线没有发现必须改变已确认产品边界或新增底层机制的问题；EOF范围以外仍明确未交付，完整E05及父/义务/离线开放。待主线完整读结果、独立复跑与明确生产批准后才写生产文件。

## 生产实现候选与自动验证（2026-10-12，待独立审核）

构建与连接检查点：`AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary`成功，日志`/tmp/agentic-f043h-build122.log`；既有大chunk/hdiutil弃用警告保留。副本`/tmp/agentic-markdown-alpha122.mvD1Xc/Agentic Markdown-canary.app`的CFBundleVersion及展开version.json均alpha.122、hash`39scfr5qxnmbu`（CFBundleShortVersionString键不存在，改核实际版本键）。按既有隔离App数据/fault lab启动exec62808/Bun47342，首次精确路径CUA连接`-10005 timeoutReached`，尚无AX/实际窗口证据，原因未知，未保存正文/验收/Git。自建样本`/tmp/agentic-f043h-ui.p2n6Sm/fence-a.md`初始SHA256`31dd900e868025a85f7b59f0d6481449fcc326679fb65935cb962b5edf8472c7`，B为`a5a2fdae596c28c5cb1072820c51dc54e75d8c5b330cdbf474d50315b062ec63`，尚未在新版打开。

主线最终自动检查：typecheck、全量lint、feature-docs/obligations与diff检查通过；全量953项/27456断言/152文件/22.46秒通过，日志`/tmp/agentic-f043h-full.log`。最终独立Spec及Standards各复跑10项/416断言，均0剩余代码阻断。源码/lock递增alpha.122并开始canary构建，尚不作为交付或验收成果；实际产物与WK另记。

新增typed `fence-completion.ts`：公开树/CodeMark准入、EOF单空光标、开行保护及派生增长前置检查，一笔带`isolateHistory("full")`的事务；`MemoryEditor`仅在既有Enter消费者内组合，新增补齐核当前state/session精确身份，未改raw/history/listContinuation或事件注册。无候选与soft仍走原Enter路径。

新增`fence-completion.test.ts`七项，覆盖编辑/源码原文与基线/info/canonical代码值、首次光标及既有redo差异、逐字符输入无强制解析、回退等价、权限/状态/session/保护、单事务filter和前后历史；1MiB测试使用真实controller加载约1K短段落样本，测试专用`ensureSyntaxTree`后通过空事务发布就绪树，再生成真实补齐事务，controller整次拒绝且原state/raw/revision/dirty/history不变。不是生产强制解析，也不是UI验收。

中途检查保留：首次typecheck因测试`Array.at`不在项目目标lib失败，lint随之报不安全访问；仅改末元素索引，不改编译配置。上限测试初版大行/大量短行夹具虽ensure返回树，未发布到state时planner仍无候选，6通过1失败；改低于保护长度的约1K段落并空事务发布后通过，未改生产准入或上限。

最终执行：本轮三源码文件prettier与专项eslint通过；`bun run typecheck`通过。`bun test apps/desktop/src/client/fence-completion.test.ts apps/desktop/src/client/list-continuation.test.ts apps/desktop/src/client/list-input.test.ts apps/desktop/src/client/history-documents.test.ts`：38通过、730断言、4文件、301ms；单独新文件7通过384断言。类型/纯state/受控controller证据不代替实际WK、IME或失焦/生命周期实操，当前只交代码候选；完整父/义务/offline-final继续开放。
