# F-048c：编辑与源码模式围栏代码折叠

> 状态：2026-10-15，alpha160经真实WK受托Agent代验及独立Spec/Standards最终0必要阻断，主线正式批准非离线有限片通过，非用户亲验。Git待主线实际执行；完整父项、阅读子窗口、专项、自然IME等未测边界及最终离线保持开放。以下候选/待验表述保留为历史过程，以末节批准为准。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## 功能说明与边界

编辑与源码可折叠已解析的 fenced code（围栏代码块），共享同一文档的显示状态。折叠摘要显示语言标识与代码正文行数，点击摘要或左缘箭头展开；命令面板提供“折叠/展开当前代码块”，键盘可通过面板执行，本片不抢占已验标题快捷键。只改变展示，不修改 Markdown、dirty、revision 或正文撤销历史。

本片只处理 Lezer `FencedCode`，包括反引号、波浪线及引用/列表容器；缩进代码 `CodeBlock` 不自动扩入范围。保留开围栏整行，在其行尾显示摘要，隐藏后续正文及闭围栏至本代码块结束，不吞下一块、容器外内容或后续行前缀。无正文的空围栏不提供折叠入口；只含一个或多个空代码行仍是代码正文，不沿用标题“纯空白不折叠”的判断。

行数按代码正文的逻辑行计数，排除开/闭围栏行，空正文0行、一个空代码行1行；不按软换行视觉行数，也不按容器前缀计数。无语言显示“纯文本”；有语言使用既有有界首token展示及控制字符清理规则，摘要如“typescript · 3行”。仅显示元数据，不把未知语言当可执行内容。未闭合围栏须解析确认真实末端才允许；不能把部分树当前尾冒充代码结束。精确容器、末行/EOL计数先以隔离实验核实，失败保留，未经主线收敛不直接猜测上线。

非目标：语法高亮、行号偏好、Enter/自动闭围栏专项、复制能力改造、阅读子窗口、跨窗同步、跨重启恢复、全局折叠套件。阅读结构/折叠在对应窗口迭代收敛，不恢复旧“三模式共享状态”假设。完整 F-048、F-040、专项与 F-028c 不关闭。

## 前置调查与已知接入风险

- 已读 MVP F-048/F-040、现行 E-12，以及历史代码折叠语言/行数摘要决定（能力登记88、2026-08-26）；历史保留，当前窗口模型优先。
- F-040a已提供共用官方 `codeFolding`/`foldedRanges`、选区展开与安全清理、标签保持、统一命令守卫；不需要重建解析管线或默认泛块 `foldGutter`。
- 当前 `heading-folding.ts` 的单一 placeholder 固定中文“展开标题章节”，`currentFoldAtSelection` 遍历任意官方fold并当标题目标。直接发代码fold会混淆类型，不能简单增加第二套 `codeFolding` 配置或把代码range交给标题入口。
- 当前 `live-formatting.ts` 在非聚焦代码块隐藏 `CodeMark`、替换 `CodeInfo`并显示语言badge，可能与折叠摘要/闭围栏隐藏发生布局交互。需真实WK验证，必要改动仅为本代码块已折叠时避免重复badge/冲突装饰，不重写解析路由或全局呈现。

## 最小技术方案候选

1. **一个展示状态，typed类型归属。** 官方foldState仍是隐藏范围唯一真源；增加最小受控元数据，判别联合 `kind: "heading" | "fencedCode"`，绑定同Text、精确from/to和展开入口位置；代码元数据另含language/lineCount。只由受控折叠事务创建，显式展开、选区自动展开、正文/故障清理后同步去除不存在的range；inactiveTab暂停保留同Text元数据。不得以元数据代替检查官方精确fold存在。未知fold不冒称标题或代码，也不得借旧metadata创建新fold。
2. **原子发布与生命周期先实验。** 折叠元数据与官方foldEffect在同事务内发布，placeholder准备必须能取得正确种类；StateField依赖顺序、嵌套fold的官方行为、自动unfold同步顺序均需用真实EditorState验证，禁止用互相读取新state的循环field依赖。优先受控typed effect和单向依赖；正式字段位置/导出名在实验后最小方案收敛，不新增通用插件架构。
3. **共享展开、安全与分类型操作。** 提取最小共享范围守卫/placeholder分派，标题命令仅选择heading，代码命令仅选择fencedCode。摘要回调绑定同Text和kind及精确live range，partial恢复时现有fold仍可展开，不要求重建全文结构。新折叠必须使用当前可靠解析结果。标题包含代码时允许嵌套，展开外层应保留内层既有fold；查找/全部选区进入内部时展开所有必要祖先与目标fold，不因类型不同漏开。重叠但非包含范围拒绝，不能静默合并或任意替换。
4. **代码范围与成本。** 复用当前实际树，在既有分片块级结构遍历中识别FencedCode（不是每键另跑全文parse），只读开/闭mark及CodeInfo必要边界，不遍历每行CodeText/QuoteMark。使用Text行索引求正文行数，避免完整正文substring/split。当前tree/doc身份检查与取消、预算、可见gutter沿用已验机制；闭合节点要求syntaxTreeAvailable覆盖闭mark末端，未闭合尾要求全文可用。容器结束、闭mark判定与行数必须经固定oracle实验后批准，不对未知范围猜测。
5. **入口与输入保护。** 复用单个20px gutter，不添加横向挤占的第二条gutter；代码开围栏行提供箭头，hover/focus显示、折叠常显。所有点击、摘要、命令走当前controller/view、busy/frozen/save、安全和IME守卫。只读允许显示操作。单空光标被显式折叠吞入时移至开围栏行末，多光标/非空选区相交则原子拒绝中文提示，保持正文/选择；后续定位展开规则共享。不要从默认placeholder click绕过守卫。
6. **变化安全。** 保持F040a策略：正文变化及safe/fault清理所有展示fold与对应元数据，标签非活动暂停保持；模式切换共用状态。旧DOM或旧解析代结果不能操作新Text，即使数值range恰相同。异步异常释放任务并进入既有故障路径，不自动force/ensure parse。

预计仅触及共用fold扩展/结构adapter及测试、编辑器统一命令接线、必要局部围栏装饰条件、手册与唯一记录；是否新建 `editor-folding.ts` 小模块由实验后方案明确。不在此时大规模重命名已验标题代码。

## 先行有限隔离实验计划（未执行、待主线批准）

按 prototype 轻量模块加薄单命令驱动方式，在mktemp目录用真实当前EditorState/Lezer/官方foldState；不增加生产TUI、源码、package或版本。最多两组脚本，冻结输入与独立oracle，独立复跑后主线决定生产路线：

1. **范围与摘要固定矩阵（约12组）。** 三反引号/波浪线、有/无语言、空正文/单空行/末空行、无末尾换行、未闭合围栏、引用、ListItem及嵌套引用列表、内部伪标题、紧邻后续段落。分别输出开行/隐藏范围/闭mark/正文行数；BOM与实际CM规范化LF/CRLF/CR对照raw不变。针对少量长围栏真实partial EditorState，确认无完整闭合证据不发布尾范围。canonical只作既有独立语义参考，不为生产新增请求，也不把raw EOL计数直接当CM坐标。
2. **共存与状态矩阵（约8组）。** 真正heading→code两层折叠及反向建立顺序、外层展开保留内层、查找选区展开两层、类型限定命令不互相展开、同事务placeholder准备能取得typed信息、mode与标签pause/resume partial保持并可展开、edit/safe清理、旧Text相同数字回调拒绝。检验元数据字段单向更新，不让transactionExtender读取待丢弃tr.state造成重复字段计算。placeholder准备数据不等于真实DOM像素验收。

任何代码边界/官方嵌套行为不符合预期均记录为红，不删例或用手工登记冒自动来源；若必须改变原范围/状态策略，先更新本唯一方案由主线批准，不把研究扩成第三解析器或全语法项目。

## 最小 happy path 与验收

实现获准后才补实现后测试，不采用TDD。自动验证复用上述固定边界、typed生命周期和现有F040a回归，type/full lint/全量与文档义务检查；代码两独立轴复核后主线递增alpha再打包。

真实WK使用自建标题包含代码、quote/list及长代码、readonly样本：

1. 编辑模式点击开围栏箭头，摘要语言/行数正确且下一块完整；点击摘要及命令面板键盘展开；源码同一操作且切换保持。
2. 先折代码再折父标题，展开标题仍保留代码；查找隐藏代码内部文本使两层必要范围展开。标题快捷键不把代码当标题展开，代码命令不误操作标题。
3. readonly无dirty，标签往返/长围栏partial恢复仍可展开；修改后自动展开，撤销保持原文与clean；safe降级展开。非空选择拒绝提示、单空光标迁移符合规则。
4. 深浅主题、代码语言badge不重复、围栏/引用/列表样式无截断；自然IME只在实际可用时记录，不以paste或合成composition冒充。正常退出、样本SHA与临时权限恢复，明确未实操竞态/RSS等限制。

## 义务与收尾

继承检查：**F-002 原文与离线**不回写、不联网，离线项留最终人工；**中文与外观**使用中文摘要/提示及现有浅深主题；**命令与键盘**使用统一命令面板，不抢占标题快捷键；**安全与日志**仅派生范围/行数，不执行代码，不记录正文或路径。F-005取消生命周期与F-008安全边界保持。

已检索当前迁出义务登记，无以F-048/F-040为主承接的OBL，本片声明none，不新建虚假归属或关闭协作父项。协作继承OBL-030富内容安全/CSP协议、OBL-064历史/组合及OBL-068/069编辑/源码外观的相关回归责任，按实际证据局部记录。F-048c-offline-final留最终人工，不断网、不执行离线。功能手册仅在生产实际进展后更新候选/可用状态；实际WK及最终独立复核获主线批准后才按既有授权Git。以上为初始方案，实验进展以末节实际收据为准，未进行生产或验收。

## 两组有限隔离实验收据（2026-10-15，等待独立复跑）

主线全文读取方案，独立Spec/Standards均0必要隔离实验阻断后批准执行。采用prototype逻辑分支，按本项目明确批准的mktemp纯模块加薄命令驱动，不新增生产TUI或package脚本。冻结目录 `/tmp/agentic-f048c-fold.aaNEB4`，文件为 `ranges.ts`、`ranges-v2.ts`、`run-ranges.ts`、`state.ts`、`run-state.ts`、`README.md` 及原始日志。

复跑命令：

```sh
bun /tmp/agentic-f048c-fold.aaNEB4/run-ranges.ts --v2
bun /tmp/agentic-f048c-fold.aaNEB4/run-state.ts
```

范围组首版74项/12红，见 `ranges-first.log`：未闭合末LF被简单lineAt(node.to)多计一行，同时误把末分隔LF纳入隐藏。原候选模块不覆盖；窄修v2仅扣除未闭合结尾分隔LF，另加“只有开围栏+LF=0行”和“未闭合引用在容器结束处停止”的固定oracle。最终 **86项/0红**，见 `ranges-v2.log`；14固定样本×3种raw EOL×有无BOM与2真实partial样本。输出明确分开CM位置与raw位置，原文rawText均不变。单空代码行=1、末空行保留、闭围栏/引用/列表下一块不吞；partial闭合或未闭合长围栏均未开放入口。本实验复制hidden字符串只为核oracle，生产不得迁用全文slice/split。

状态组首跑 `state-first.log` 发生循环field错误：把生产Guarded Language单独移到裸EditorState缺少其所需字段，错误发生在创建状态阶段，不是typed metadata update依赖环已被证明。改为公开Language包装当前真实BomAwareParser后，最终 **12项/0红**，见 `state-final.log`（中间10项收据 `state-second.log` 保留）。实际官方foldState验证两种嵌套建立顺序、展开父层保留代码、次选区定位两层展开、kind限定不误展开、edit/safe清理、同Text partial恢复展开与旧Text拒绝。presentation compartment只测readonly重配置，不冒称实际App模式/标签controller。

单向依赖得到有限正证据：metadata.update仅读旧state官方fold、effects及selection/doc事实；官方preparePlaceholder读取新metadata，成功取得代码kind/language/lines，单次fold事务metadata更新1次。另专测新fold+内部main光标同事务：没有旧fold供自定义extender清理，官方随后自动清除新fold；metadata同样为空，prepare中短暂得到null，最终无显示fold。此null需要正式placeholder安全容错，不能强断言任何prepare必有类型。没有读取新foldState造成循环。

**证据限制与下一生产前置**：plain Language结果不替代真实createRawEditorState/GuardedParser/故障与presentation完整接线；正式最小方案须明确在实际工厂中装入typed共享扩展、重复原单向/自动清理/跨标签模式回归，不能把本实验当已完成actual integration。范围组是实际生产工厂读取；状态组是实际CM公开字段、当前Lezer但有限宿主。尚无DOM/WK摘要布局、真实IME、生产预算、完整错误竞态或RSS证据。目录现冻结待两轴和主线复跑；未改生产、版本、构建、GUI或Git，不批准自身生产。

主线末轮提醒补核了不支持的effect组合：`bun /tmp/agentic-f048c-fold.aaNEB4/conflict.ts` 实际exit1，`conflict.log`记录同范围add+foldEffect+unfoldEffect导致官方fold保留1、metadata0，不能冒称任意事务一致。生产必须由唯一受控builder严格配对typed entry和foldEffect，同一范围不得同时新增与展开；选区已知将触发清理时禁止生成新增fold，清理事务不混入新增。该组合不在正常用户操作路径，不需要扩成通用任意effects协议，但必须在正式方案/实现回归明确拒绝，不能静默忽略本红例。此前12项常规状态矩阵仍是有限正证据，不抵消此边界红例。

## 正式最小接入方案收敛（2026-10-15，待主线批准生产）

主线与独立Spec/Standards实际复跑均为范围86/0、状态12/0、冲突脚本exit1，证据一致；主线现仅批准编写本节。下列设计不是已实现或已验收。原红及plain Language限制不被此方案覆盖。

### 1. 严格类型与单一展示真源

使用判别联合而非可选字段拼盘：`HeadingFoldEntry = {kind:"heading", titleFrom, from, to}`，`CodeFoldEntry = {kind:"fencedCode", openingFrom, from, to, languageLabel, lineCount}`，共同绑定所属Text。标题数据不得携带代码字段，代码数据必须含有界摘要。统一登记以精确from/to为键；同范围不同kind冲突整次拒绝，不能覆盖旧归属。只登记经当前可靠结构批准的候选，不给任意未知官方fold猜类型。

官方foldState仍为可见隐藏范围的唯一真源，typed登记不是第二套折叠开关。当前入口与placeholder实际操作均再次核同Text、kind与官方精确live range；同Text partial重建不阻止展开既有fold。显示准备数据包含必要不可变元数据与Text戳，不能凭裸位置复活旧正文范围。

### 2. 唯一受控事务builder与明确拒绝

标题及代码的新折叠均经一个小型typed builder产生完整事务：当前doc/tree/结构资格核验→选区策略→typed登记effect与同值官方foldEffect成对输出。展开只输出目标精确官方unfoldEffect。外部命令/DOM不接收任意effect数组，也不暴露自由组合的metadata effect。

builder约束：同一range不得同时add/unfold，不得在clear/safe/正文变化事务中add，不接受无对应typed entry的受控foldEffect，不接受typed-only新增。新fold若事务最终选区仍与隐藏范围相交，拒绝整次新增；单空光标显式操作先生成移动至标题/开围栏末尾的最终选区，再核不在隐藏区。多光标/非空相交按已验中文提示拒绝。拒绝不更改正文或选择；不靠事后修复一个不一致状态。混合清理与新增的内部编程错误由builder返回拒绝并回归证明，不扩成支持任意第三方effects的协议。

共享定位extender根据全部最终选区产生必要unfold，只读startState，不建立将丢弃的新tr.state；受控新fold不能再被该事务选区吞入。保留对官方自动清理的防御：metadata根据tr.selection及newSelection规则去除相应条目，即便非受控裸官方fold在测试中出现，最终不可留下可操作伪条目；不承诺支持外部裸fold，也不为其生成语言摘要。

### 3. metadata单向依赖与成本

官方foldState.update中的preparePlaceholder允许读取新metadata；metadata.update禁止读取新foldState或触发新的解析，只消费旧登记、必要时旧官方live、事务effects/doc/selection事实。prepare得不到条目时返回安全的unknown准备数据：只显示通用“展开折叠内容”，不冒称标题或代码；最终不存在live range时任何回调无操作。这个容错覆盖实验中新fold随后被官方清理的prepare null，不将它视为可新增unknown功能。

不迁入临时 `previous.filter(oldLive.some)`：那是O(f²)对照代码。登记使用同步精确键索引；无doc变化、无相关effects、无selection/故障清理的事务直接返回同引用，不遍历fold、不复制集合。有关事务一次建立必要旧live键集合或按受控effect直接查键，不嵌套线性some；只有实际新增/删除才懒复制索引，内容变化/clear直接空。selection展开与当前已验遍历保持同一轮并收集待删键，不重复全量克隆。官方live最终核仅在实际目标消费、placeholder与可见marker匹配时进行，不能为每可见行重新全扫所有fold。嵌套关系判断及查询索引在实现前以现有range组织选择最小结构，不增加每输入全文内容工作；不声称无成本或给出未经测量性能目标。

### 4. 实际工厂接线必须先验证

将单个共用fold扩展从标题专用配置分离为必要小模块（可名 `editor-folding.ts`）；保留现有标题结构/入口职责，禁止同时安装两份相冲突的placeholder配置。代码与标题候选由既有分片块级遍历同次生成，避免第二个每键全文遍历；保持每128单位让出、当前Text/tree票据、timer取消和既有fault通知。命令仍分别注册标题/代码，单gutter按可见行类型产生箭头。

正式实现后第一批自动检查必须使用真正 `createRawEditorState`，包含GuardedParser、fault/session、原文保真与presentation compartments，验证typed field与官方prepare无循环依赖且一次更新。再用真正document controller验证标题+代码嵌套→切标签→partial返回→不同模式与readonly→精确展开，以及safe清理、raw/dirty/revision/history不变。临时plain Language不能抵扣这项。若真实工厂出现依赖环，先保留失败并报告主线修正局部field次序/依赖，不换掉parser或删除保护字段凑绿。

### 5. 围栏来源与显示边界

实际Lezer FencedCode仅取开/闭CodeMark、邻接CodeInfo和节点/行索引；闭合必须有不同于开mark的末CodeMark且syntaxTreeAvailable覆盖其末端。未闭合必须全文可用，终点仍是该节点/容器真实末端，不一律延伸document末尾。未闭合若节点末为一个分隔LF，隐藏末端退一单位，正文行数同时扣除终止空行；开围栏+LF为0行、再一个LF为1行。raw EOL仅保真原文，折叠/lineCount用实际CM规范化坐标。临时rawOffset输出不是独立语义等价证明，不把它当完整raw映射测试。

语言从当前CodeInfo取最多65单位内的首token，移除既有控制字符，展示上限沿用40字符及省略；无可见token显示“纯文本”。不用完整info/正文slice、正则全篇搜索或正文split计行。代码已折叠时只局部抑制重复language badge/冲突围栏装饰，保持开围栏原文和容器前缀，不影响非折叠编辑效果。摘要正常显示语言与行数，unknown准备数据不输出虚构行数。

### 6. 实现后最小回归与验收出口

除原固定矩阵外，正式自动测试补：builder配对及冲突整次拒绝、prepare null安全、真实工厂field更新次数、无关事务登记同引用、单清理/多清理索引一致、标题与代码互不冒名、两顺序嵌套及外展内留、官方自动清理、所有选区定位展开、过期DOM同数字/不同Text拒绝。输出真实调用的结果，禁止仅对复制出来的模型自证。

随后type/full lint/全量与两轴代码复核，主线才管理alpha递增、build和上述真实WK happy path。首轮真实布局须核语言badge/折叠摘要共存、外层标题展开后代码摘要仍正确；若重叠装饰有真实缺陷只做局部修正。最终独立复核及主线批准前不得标记本片通过、提交或推送。当前仍只有方案与冻结临时实验，生产未批准。

## 有限生产候选与作者验证（2026-10-15，待独立复核）

主线已全文读取正式六节、实际复跑临时实验，独立Spec/Standards0必要路线阻断后批准窄实现及实现后测试；不采用TDD。作者未修改版本、build、GUI、AGENTS或Git。

- 新增 `editor-fold-state.ts`：严格heading/fencedCode联合、精确键Map元数据、单向字段依赖与私有登记effect。唯一builder自身核当前结构doc/tree及精确候选，不仅依赖UI；无任意effect/changes参数，typed+fold成对生成，同范围异kind/非包含交叠/选区冲突均拒绝。官方fold是显示真源，无关事务及无删除选区保持同Map引用，修改/故障清空；没有迁移临时O(f²)配对。
- 既有 `heading-structure.ts` 同次分片块遍历增加可靠FencedCode范围及有界语言/行数，不新增parser请求；共享structure StateField移至该模块供builder核验，原heading-folding导出兼容。末LF与容器范围使用实验证据，正文不复制或split。
- 单个官方placeholder分派标题/代码摘要，精确同Text/kind/live回调，unknown准备数据安全显示不冒标题；标题命令限定heading，新增代码面板命令，继续一个gutter。既有guard/IME/readonly入口复用。局部live装饰对已折代码不生成重复language badge，未闭合末LF端点同样适用。
- 新增 `editor-code-folding.test.ts` 实际调用生产工厂/GuardedParser/正式builder：typed准备数据、普通事务单次状态更新与raw/history、元数据无关事务同引用、候选/重叠拒绝、两种嵌套顺序、选区与自动清理、命令校验、84语料组合及两partial、badge前有后无。测试对第三方官方Decoration的公开spec按窄边界类型读取，不复制实现自证。
- `documents.test.ts` 真正controller readonly长代码+父标题双fold→另标签→partial返回→源码→各自展开，核metadata、原文、dirty、revision和history。测试专用ensure用于构造已完整初态，生产无ensure/force；不把自动测试当实际WK。

作者定向 **68 pass / 930 expect / 0 fail / 6文件**，`/tmp/f048c-tests4.log`；完整typecheck通过 `/tmp/f048c-type4.log`。最后定向lint及文档收据由下次补记确认，尚未以自动验证替代实际验收。主线后续负责全量、下一alpha160及真实窗口。

失败/纠正保留：首次factory旧标题测试15/1及type1指出用EditorSelection.cursor返回SelectionRange却读取ranges，改用single后旧16/67通过（`/tmp/f048c-first-factory.log`、`f048c-factory2.log`）。首次批次65/3中，测试ensure仅推进parse context，旧state树未发布却投递旧结构，新增builder正确拒绝；补测试专用空事务发布后68/928通过，未放宽生产资格（`/tmp/f048c-tests2.log`、`tests3.log`）。type3及lint3的测试窄类型、未用导入、optional-chain与regex指令位置已修。主线指出badge测试caret在围栏内会因touched自然无badge，作者改为块外caret并先断言未折存在再折消失，最终多2断言；不把原假绿当真实显示证据。

本片仅代码候选等待两轴独立审核，真实IME、真实布局/焦点、竞态、RSS、离线以及完整父/专项仍开放。

作者冻结补记：定向eslint `--max-warnings 0`通过（`/tmp/f048c-lint5.log`），功能/义务检查及`git diff --check`通过；格式已限候选文件整理。源码自tests4/type4后未改，现冻结供两轴及主线复核，不自批。

## alpha160 真实窗口候选收据（主线观察，待最终双轴复核）

以下根据主线实际操作与日志记录，不是文档作者独立GUI复跑，不提前批准本片通过。alpha160/hash `192e5xr33tbwb`，直接解包 `/tmp/agentic-direct160.fJBUNJ`，隔离数据 `/tmp/agentic-f048c-ui.qsnFrx/data`。源码全量1358/33396/199文件（`/tmp/f048c-root-tests.log`），包内Bun运行仓库1358/33397/199文件（`/tmp/f048c-alpha160-bundled-tests.log`）均通过，断言差1原样保留不推原因；type/full lint/docs通过。构建 `/tmp/f048c-alpha160-build.log` 完成，保留700kB chunk及hdiutil警告，不冒构建无警告。

### 实际WK已观察路径

- 反引号代码摘要typescript、3行（含空行）正确；父标题折叠再展开保留内部代码fold；编辑/源码共用。源码查找隐藏`const`定位展开两层，非空选区折叠被中文提示拒绝，单空光标允许显式迁移后折叠。
- readonly临时444，js/2行可折叠且clean，跨标签保持。长代码3000行摘要与后续标题可见、跨标签保持；编辑后自动展开/dirty，CmdZ回clean；presentation故障进入safe并清除fold。
- 引用js/2行、列表python/1行均保留下文与容器边界；波浪线无语言显示纯文本/1行。一个空代码行显示1行并可折叠；空正文0行位置点击gutter无动作。未闭合text/1行范围观察成功。
- 上述有CUA真实窗口截图支持，不以DOM元数据或自动测试替代可见结果。

### 操作失败与限制

一次命令面板后立即paste `X`未产生变化，随后分开发送paste成功，原因未证。编辑模式CmdF未打开源码查找；批量CmdA/paste意外替换代码，已立即CmdZ恢复clean，未保存。随后切源码CmdF确实完成查找路径；不把误操作删去，不据此宣称编辑模式查找已实现，也不把未等待/焦点现象强推为根因。

首次运行未新做浅色主题，随后已补下方最小浅色happy path，仍不代表完整主题矩阵。自然物理IME、多光标真实UI、精确partial解析时序、竞态或RSS未实操；自动controller partial/选区与既有外观证据不能替代这些未测项。完整父项、阅读子窗口、专项及最终离线仍开放，不断网、不执行离线。

### 退出与数据完整性

正常CmdQ后GUI应用退出，exec94145 exit0，Bun88888确认不存在。退出stderr观察到`IMKCFRunLoopWakeUpReliable`错误，原因未推断，不冒无错误退出。三自建正文SHA256前后未变，readonly已恢复644：

- code.md：`720bfddeda3a1c8115432e3113dcdca80c6b76ffe1d66fbb17f295cd846ae53c`
- readonly.md：`842556f79fc8df226def002c71a5507dc17beed06e262f3a7d99a656c8f0c69a`
- long.md：`808fcc2dc1b1a7e32c8ec5f0b1c4e195510f99a592979252dedf4331be66a1b0`

候选等待最终Spec/Standards与主线批准，手册仍候选，不得预写通过或Git。

### 同版浅色最小补验与再次退出

主线使用同alpha160 direct产物及同隔离HOME重开，exec5034 / Bun90018。通过原生App菜单进入设置，切换主题为浅色；打开code样本，gutter折叠显示typescript/3行摘要，无重复语言badge且下一段完整，点击摘要可展开，实际截图正常。随后设置恢复深色并核对Value。仅补最小浅色happy path，不代表每种语法/所有主题完整矩阵。

再次CmdQ后App退出，exec5034 exit0、PID90018不存在；三样本SHA仍为上方原值，readonly权限644。stderr仍观察到`IMKCFRunLoopWakeUpReliable`，不推断原因。源码CmdF路径正常；编辑CmdF未提供查找属于现有编辑查找尚未实现，不列为F048c新回归，但此前批量误输入及立即撤销事实保留。仍为候选待最终双轴与主线批准，未Git。

## 主线正式有限批准（2026-10-15）

两独立最终Spec/Standards各0必要验收阻断，主线依据上述源码/包内、真实WK及退出/文件完整性证据，正式批准F-048c alpha160非离线有限片受托Agent代验通过，非用户亲验。编辑/源码围栏折叠、摘要及与标题共存的实际覆盖以上方证据为限；不关闭完整F-048/F-040、阅读子窗口、Enter专项、自然IME/多光标真实UI/精确时序/竞态/RSS及最终离线。此前失败和操作限制不删除。Git由主线另执行，本条不预写提交或推送成功。
