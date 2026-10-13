# F-045e：任务项结构缩进与反缩进

## 本片正式通过（2026-10-13）

最终独立Spec与Standards各0剩余必要阻断；Standards定向复跑23项/404断言/147ms，双方独立核版本、样本SHA/644、退出及日志。主线批准alpha129非离线有限片受托Agent代验通过，非用户亲验，Git待实际执行。源码及包内Bun运行仓库各1016/29368；实际与未实操范围如下分列。完整父F043/F045、协作义务、partial前置波动与offline-final保持开放。下方候选/构建前状态为历史。

## 真实 WK 收尾候选（2026-10-13，待独立最终复核）

alpha129构建成功，manifest与解包version同为0.1.0-alpha.129/hash `2b06ro8jw6duh`，native renderer。直接将官方update artifact提取至 `/tmp/agentic-direct-app.CjWfvv`，运行内层launcher，exec23631；使用已存在的 `AGENTIC_MARKDOWN_HOME=/tmp/agentic-f045e-ui.4Mq4iS/data` 隔离应用数据及EDITOR_FAULT_LAB=1，未改系统HOME。首次CUA精确路径连接成功，随后欢迎页截图及正文AX就绪，本次未运行自解包安装窗口；这只验证本次交付方法，不证明历史超时根因或安装流程已修复。构建日志 `/tmp/agentic-f045e-build129.log`，运行日志 `/tmp/agentic-f045e-runtime129.log`。

实际窗口通过的有限案例：

- 源码选择B后ShiftTab，得到A/B顶层、b及C属于B、c属于C，原`[X]/[x]/[ ]`及正文顺序不变；一次undo恢复clean、redo再次得到同原文，再undo。
- 源码定位child、切编辑后Tab，任务child缩进普通parent之下且仍checked；切源码核精确两空格与原标记，undo。
- 有序BBB执行Tab，得到`1. [ ] ordered AAA\n\n   10. [X] ordered BBB`，保留编号10和大写X。保持本事务未保存时打开另一只读文档，另一文档Tab/undo均无正文变化；回原标签事务仍在，一次undo恢复clean。
- 自建readonly权限444，窗口明确只读、checkbox disabled；源码末尾导航后Tab及undo未改文档。该导航不证明精确字符选区，权限隔离结论不扩大。
- 普通源码任务child后系统输入源工具驱动组合n，控件禁用；Tab后任务层级及正文不变，Return提交n后undo恢复clean。首次连续undo/select动作后n实际落在普通段落，已记录并撤销；分开定位/观察后再试才得到childn。工具组合路径不冒称自然中文候选完整矩阵。
- 编辑模式点击A复选框成功、undo恢复；任务child后Return新增`- [ ] `、undo恢复。安全呈现故障后控件消失，原文保留；选择B后ShiftTab离开编辑焦点而没有子树变化，文档仍clean。

本轮真实未重测源码多范围、全部复杂拒绝、浅色完整矩阵或阅读任务状态，相关既有行为/纯状态测试与前批证据分列，不声称本轮全矩阵实操。欢迎页深色截图与任务控件AX已采集。无离线操作、无用户正文保存。

两文档clean后CmdQ正常退出，exec23631退出0，进程检查无该app实例。两样本SHA256与下节基线完全一致，readonly恢复644。包内Bun运行仓库测试1016pass/0fail、29368断言、160文件、24.10s，日志 `/tmp/agentic-f045e-package129-tests.log`；不是包内含测试文件，也不替代实际WK。当时为收尾候选，最终复核结论见顶部。

## alpha129 构建检查点（2026-10-13）

最终独立Spec50项/1258断言/255ms、Standards47项/1057断言/245ms，各0必要代码阻断；组合不同不合并计数。主线源码1016/29368、type/full lint/docs通过，旧partial前置波动保持未知。版本递增alpha129进入构建，真实WK仍待执行、不得Git。

> 状态：主线已全文读取末节最小生产建议并复跑18/0，独立Spec与Standards分别复跑18/0、0路线阻断，主线批准typed前缀helper和全相关项任务保真检查的窄生产接入；尚未打包/验收。2026-10-13。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## 产品依据与前置

E-07及F-043f已确认编辑/源码对当前列表项连同子项进行结构化升降。提升中间项保留正文顺序，尾随兄弟随Markdown解析归入提升项，遵循用户B决定。F045b任务控件与F045c任务续写已在alpha128有限非离线范围验收并推送`1db784e535e54eef106c70236e9f0d6debb935b5`，远端main核同SHA、当时工作树干净。任务结构操作仍明确未交付，本片承接该余项，不改专项设计/F028c/最终离线边界。

## 功能范围

普通编辑/源码复用现有Tab、ShiftTab及缩进命令，支持可靠任务项及含任务的移动子树升降；连续同层组、父子去重与源码多范围沿原规则，一次原文事务可撤销。保留`[ ]/[x]/[X]`、原列表标记与手写编号、正文和换行，不能自动改变完成状态或重编号。首项无前兄弟及顶层反缩进沿原no-op；必要结构空行沿F043f，不新增类型转换。

复杂Tab/lazy、保护区、解析不完整、结构混选与无法保真输入仍整次明确拒绝、不部分执行。空任务/跨行正文仅在可证明资格和内容不变时支持，否则留原拒绝，不以解析器识别即算全部支持。编辑仍单选区，阅读只读。未新增任务创建快捷键、统计、批量勾选或全文索引。

## 最小技术路线与实验问题

本地`list-indentation.ts`已有完整相关块聚合预算、公开Lezer局部重解析、项身份/父级及非列表节点内容映射验证；当前hasTask会拒绝任务子树。不能只删除该拒绝：必须评估映射后的任务资格、checked状态、首内容段与后代语义保真。任务领域用`paragraphTaskPrefix`或等效纯语义描述，不使用视口widget资格做权限。公开CM ChangeSet、raw历史与既有输入/权限/IME守卫保持；canonical只作实验和测试oracle，不进入每键生产热路径。

先按prototype逻辑分支在明确临时目录建立纯候选与薄case/all/interactive驱动，问题是：既有结构规划和局部重解析能否可靠保留任务身份及所有已确认父子关系？无仓库生产改动、无版本/build/UI/Git。用现有Bun、生产state/raw/history及公开解析接口打印前后原文、每项身份/parent/顺序/checked、selection/mainIndex和undo/redo。实验有限样本覆盖：普通与任务互为父子、任务带普通/任务子项；用户B提升/连续组/父子重复选中；ordered必要空行/空任务/跨行首段；代码/链接子树；BOM/CRLF/反向多范围；partial/protected/不可靠混选整次拒绝。保留失败，不把实验候选直接生产化。

实验完成后记录结果和具体最小生产差异，经主线全文读取与独立路线核对才批准生产。不提前宣称需要更换解析器或新增无界扫描。

独立Spec要求一并核对所有相关项（含未选尾随兄弟）的任务资格/checked；空任务canonical checked可能不存在，原文标记与语义资格分别比较。用户B只允许相应尾随父级变化，不允许正文/顺序/完成状态变化；原普通列表兼容性不能遗漏。主线接受这些实验判据并仅批准隔离执行。

## 最小验证与收尾

主线源码全量1016pass/0fail、29368断言、160文件、26.28s，`/tmp/agentic-f045e-full.log`；type/full lint通过，日志`/tmp/agentic-f045e-main-type.log`与`/tmp/agentic-f045e-main-lint.log`。此前作者partial前置波动记录保留，本次全量绿不视为根因修复。尚未打包/实际验收。

为减少安装窗口人工操作，主线查本地官方`apps/desktop/.hutch/devkit/api/sdks/main/core/Updater.ts:2107–2164`及构建update.json：官方更新artifact为完整`.app.tar.zst`，包含内层launcher/Bun/native库/WK内容；自解包外壳只包装同压缩payload。主线批准本轮构建后在新mktemp目录直接tar提取官方artifact、核版本/hash后运行内层launcher的有限验收流程，不改SDK或应用代码、不跳过应用launcher、不改网络/权限策略。这是本地产物结构推断基础上的待验证运行方法，不称官方专门验收CLI、安装流程已验收或CUA根因已解决。

临时样本`/tmp/agentic-f045e-ui.4Mq4iS/tasks.md`基线SHA256 `b391bbe203b2c73c8fdbccc6f40d98bf6e6d0ebf18edae2540fd493775f639ab`；`readonly.md`为`dcebe75066f05d251610df8c2ea8bc5065b581738a06b621a4884beec4725d0a`。仅这些自建样本内存操作，不保存用户正文。

实现后按风险补精确原文/结构/checked/历史和旧普通列表回归，type/full lint/docs检查，独立两轴代码复核。真实WK验证任务升降、保留勾选状态、用户B归属、一次undo/redo与跨标签隔离；只读/safe/工具IME拒绝新消费者；合包时回归任务点击/续写。自然输入法完整矩阵和极端组合若未实际操作要明确记录；不以测试替代实际窗口。代码重打包递增alpha；本轮未定最终批次，不承诺自动链接同包。

## 继承与义务

- 中文与外观：沿既有中文拒绝及任务样式，不另设控件；真实核对编辑/源码显示。
- 命令与键盘：复用现有缩进命令及权限、IME、焦点守卫，不增加原生菜单或快捷键。
- 安全与日志：不新增HTML/磁盘写入口，不记录正文，失败不部分修改。

无新增主责OBL；OBL-058结构命令、OBL-064历史/IME及OBL-068/069外观仅消费者协作，完整主责与父F043/F045不关闭。F-002本地/磁盘真源、无自动保存、无联网输入，`F-045e-offline-final`留最终人工、不操作网络。中文拒绝沿既有文案，阅读/源码边界和公开API生命周期不变。

## 有限隔离结果与最小生产建议（2026-10-13，待独立复核及主线批准）

使用prototype/LOGIC，临时目录 `/tmp/agentic-f045e-poc.8BFqMu`；`candidate.ts` 是当前列表规划器的实验副本，`driver.ts` 为纯状态 case/all/interactive 薄驱动。运行 `bun /tmp/agentic-f045e-poc.8BFqMu/driver.ts all`；也可将 all 换成 user-b、ordered、boundaries 或 interactive。没有安装依赖或改生产。首轮 `run-first.log` 为16项通过；冻结 `run-final.log` 为18项通过、0失败，实际命令退出码0。本次没有语义断言失败，不重写此前其它迭代的失败历史。

候选并非仅删除hasTask：保留原相关窗口、预算、映射项身份/预期父级及所有非列表节点验证，在每一个相关原ListItem（包括未选尾随兄弟）匹配新节点后，核对任务资格、checked、原三字符标记及映射marker位置。新局部树使用next Text和显式offset，不读旧state文本。该PoC暂用最小sliceDoc对象类型断言调用旧接口，仅为实验适配，不作为生产类型设计。

16个语义样本包含普通/任务互为父子、任务子树与父子重复选中、用户B的A/B/b/C/c完整关系、连续同层任务、有序10保号及必要空行、空任务、首段跨行、后续普通段落的非任务标记、代码与链接子树、BOM/混合CRLF/反向范围、真实默认editing单范围、首项及顶层no-op、混入普通段落与结构Tab整次拒绝、原普通列表用户B回归。12个实际变更样本断言精确raw、最终changes映射后的selection/mainIndex和一次undo/redo；2个no-op无历史，2个拒绝原文无变更。源码多范围不冒称编辑模式支持多光标。

driver使用当前官方canonical管线，对全部项逐一断言原位置经过最终changes后仍对应同项、精确预期父级、checked及剔除子列表后的自身段落/代码/链接内容；不是仅打印树或比较项数。空任务 `- [ ] ` 的canonical checked实际为null且正文含字面`[ ]`，前后均保持；领域投影仍为`[ ]`/false，两种口径分列，不伪称canonical已识别任务。首行`[x]`后换行再正文的样本canonical checked=true，前后保持。用户B中原C从A归B、c仍归C，B/b及全部完成状态不变。有序样本得到 `1. [ ] A\n\n   10. [X] B`，保留数字与标记，新增结构空行延续既有松散布局规则。

另外2个边界：受控longLineProtection初始化覆盖相关范围，候选明确拒绝且raw/history不变；16万单位的真实生产state未解析到文末，候选返回undefined交回原消费者、不生成计划，调用后syntaxTreeAvailable仍false。这是纯规划未接管证据，不冒称已经实测完整UI拒绝提示。一般语义样本由driver使用公开ensureSyntaxTree准备测试树，不表示生产按键强制全文解析；canonical全样本遍历仅为oracle。

最小生产建议：

1. 在task-marker模块抽出typed的Text/node/offset纯前缀查询，现有paragraphTaskPrefix(state,node)委托它保持调用兼容。不伪造EditorState，不为每个项创建state或调用canonical；领域查询与可见checkbox资格仍分离。
2. list-indentation仅用上述全相关项映射任务保真校验替换任务一律拒绝。复用原局部树和next Text；原普通列表、用户B、预算/早增长保护、必要空行最多二次验证、其他节点内容检查与失败原子性不改。不重新注册Lezer TaskList，不更换profile/原文通道/历史/命令入口。
3. 正式回归将本次关键语义转为精确断言，更新原“任务一律拒绝”的过时样本；另补多个独立相关窗口、原历史前后隔离及既有执行守卫回归。真实WK再验证控件/装饰后操作目标、checked、一次undo/redo和跨模式标签，不能由本实验自批。

本实验没有验证任意复杂Tab/lazy、所有跨块混选、真实DOM/IME、权限生命周期、长期成本/RSS或离线。尚未生产实施/打包/验收，以上路线须主线完整读取与独立核对后另行批准，不自动推进其它GFM能力。

## 批准后实施候选（2026-10-13，待独立代码复核）

主线全文读取并复跑18/0，两独立lane各复跑18/0、0路线阻断后批准窄接入。生产仅两文件：task-marker.ts新增typed `paragraphTaskPrefixIn(Text, SyntaxNode|null, offset)`，返回绝对marker范围，旧state接口委托它；list-indentation.ts去掉任务一律拒绝，改在原相关ListItem身份校验环内比较前后任务资格、checked、原三字符与映射起点，包括未选尾随项。未更换parser/profile、算法/预算、raw/history或输入接线，没有伪造EditorState或新增canonical生产调用。

新增task-indentation.test.ts共20项，涵盖隔离关键样本、typed局部offset、两个独立窗口、相邻普通输入的三步undo/redo及保护/partial。沿真实默认editing单范围及source多范围；canonical逐项映射、父级、checked、自身内容、精确原文及selection/mainIndex有断言。原list-indentation.test.ts删除两条任务一律拒绝旧样本；task-marker.test.ts将旧拒绝断言改为精确任务缩进原文并保留独立续写验证，不删除其他安全断言。原source-indentation及input套件作为既有权限/IME/focus/tab-focus回归，未新增UI证明。

实际检查与失败保留：

- 首次两文件29项/524断言通过，`/tmp/agentic-f045e-target.log`。
- 首次六文件组合53通过/1失败，原F045b任务一律拒绝断言已与本轮批准范围冲突；更新上述旧断言。首次type仅新fixture可选字段未收窄；首次lint为类型风格、JSON replacer返回类型及optional-chain规则，均局部修正。原日志 `/tmp/agentic-f045e-combined.log`、`type.log`、`lint.log` 保留（共同前缀 `/tmp/agentic-f045e-`）。
- 第二组合53/1失败是未修改的source-indentation.test.ts:116，既有partial前置期望false而实际syntaxTreeAvailable=true；本轮首次组合该项绿。保留 `/tmp/agentic-f045e-combined-final.log`，不归因、不调阈值、不宣称本轮修复。之后串行单项1/3绿（partial-single.log），一次同组合54项/1586断言/6文件/254ms绿（combined-recheck.log）；不以偶然绿抹掉前置观察。
- `bun run typecheck`通过（type-final.log）；5个受影响TS文件专项eslint通过（lint-final.log）；`git diff --check`通过。未自行运行全量、构建或UI。

本次executor变更清单为task-marker.ts、list-indentation.ts、上述两旧测试、新task-indentation.test.ts及本唯一实施证据。共享文档/AGENTS/版本由主线管理，未由executor编辑。候选冻结交独立代码复核，未自批验收；真实控件/装饰、跨模式/标签及本批最终守卫仍由主线WK验证。
