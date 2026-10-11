# F-041c：普通源码全部替换

## 正式结论：非离线本片受托代验通过（2026-10-11）

最终独立Spec验收复核0剩余必要阻断，Standards收尾0新增阻断；主线正式确认alpha.120非离线本片受托Agent代验通过，非用户亲验。独立Spec复跑19/299并核三SHA/权限/进程，Standards核记录和文档检查；实际UI由主线操作，不冒称审核者亲自实操。源码936/26825与包内Bun运行仓库936/26824、真实WK与退出证据见末节。父F041、完整OBL056、offline-final及未实测边界开放。Git待实际执行，下方全部待验/阻塞/待批准状态保留为历史，不覆盖此正式结论。

## 当前状态：alpha.120 已构建，真实窗口待验（2026-10-11）

本片已实现，源码与包内Bun运行仓库各936项通过，独立最终Spec/Standards代码0阻断。路径连接五次（含重建工具会话和/private/tmp规范路径）均超时；inventory返回运行App、bundle ID连接因多副本歧义失败，尚无本片真实窗口AX/截图。已请用户确认解锁/窗口可见；现场保留，不推断根因。整片未验收、不得提交，详见末节产物/日志和失败证据。下方实验待批准、未生产及中间测试计数均为此前历史，不覆盖本节；父/完整义务及最终离线保持开放。

## 当前轮次：最小生产已获批准并实施，待最终代码复核（2026-10-11）

主线完整读下方生产方案并批准实施，Spec/Standards确认路线和raw-noop条件。核心、独立owner及替换栏按钮已实现，增量验证进行中；尚未构建/实际WK验收，不列可用。版本/build/UI/Git及共享状态由主线管理；下方实验候选/生产待批准为此前检查点，父/OBL056/offline-final保持开放。

F-043f已正式通过并提交推送`231f2eb8544d45ae7d0d8552c61633e9ff6299f1`，主线核验远端一致、当时clean；现重新选定本片。用户已经批准极端高开销整次拒绝、普通输入全部替换一次undo，不新增普通文档大小限制、不部分替换。主线读完补实验方案并批准、独立Spec无执行阻断后，已用当前生产F-014c原文历史与F-043d lazy raw helper完成下方隔离补测；完整12例语义通过，极端分散单长行仍8秒外部终止。此为实验候选待独立复核，尚无生产批准或实现，不改生产/依赖/版本、不构建/UI/Git。以下待批准、先F043f、前置待修和早期“最新”字样均为历史；F028c待决定、父/OBL056/offline-final保持开放。

## 最新用户授权与前置（2026-10-11）

用户明确采用成本保护：极端高开销输入整次拒绝，普通输入仍全部替换且一次undo；不新增普通文档大小限制，不部分替换。该产品选择已解决，具体成本检测与原子拒绝技术方案待继续核实，尚未实现或验收。F-014c原文独有历史/提交守卫已交付，F-043d lazy raw helper已生产；这不证明公开CM API在极端密集单长行的成本已解决，原失败与实测限制保留。先推进F-043f隔离实验，再续本片技术方案；F-028c待决不变。下方旧前置待修及早期状态为历史，父/OBL-056/offline-final开放。


最新推进（2026-10-11）：隔离实验尚不能支持生产接入，主线暂缓本片生产，先以 [F-014c](F-014c-raw-only-history-guards.md) 独立修复实验发现的既有raw-only历史/提交保护缺陷。不是整个连续任务暂停；F-041c、父项和OBL-056仍开放，批量性能与保真路线之后继续，不把前置修复当作全部替换交付。下方早期状态保留历史。

> 状态：2026-10-11，已选定下一切片，最小方案待主线批准与独立核对。先隔离公开 API PoC，尚未运行实验、安装依赖或修改生产；无版本、构建、UI 或 Git 操作。

最新：主线批准隔离PoC、独立Spec无方案阻断；现已完成现有生产事务路线baseline实验。基础语义7例通过，但非相邻密集命中提交触发外部8秒终止，现成路线不足以直接生产接入。下方尚未运行是历史；没有生产修改或生产批准。

<!-- obligations: OBL-056 -->
<!-- deferred-obligations: none -->

## 功能及范围

依据能力总账 E-10/E-11：编辑与源码支持逐项及全部替换，全部替换形成一次可撤销 transaction。当前仅接普通源码当前文档；F-041a 查询与 F-041b 逐项替换、F-014 历史/IME、F-016 权限及统一命令是本片现有前置。用户最新确认保留 `⌘H` 隐藏 App，替换通过查找栏按钮，快捷键未来统一设计。本片不改此决定、不新增快捷键、原生菜单、RPC 或命令面板。

在现有替换栏增加“全部替换”按钮，复用每文档 query/replacement/大小写/全词状态。普通文本、无正则，replacement 按字面解释；空串删除、多行沿已有输入换行规则。一次操作基于同一捕获快照中的全部非重叠匹配，不递归搜索替换产生的新内容，不因当前匹配为空或视口高亮受限而遗漏其它结果。空查询或零匹配不执行；只读仍能查找与填写条件，但禁止替换；safe、编辑、阅读不安装本片消费者。

所有真实修改合并一次事务/一次 undo，保持原文保真、选区映射和跨标签历史；全部同文时不创建 dirty 或空 history。完成显示实际变更处数，如“已替换 N 处”；命中但全无变化时明确“匹配 N 处，正文无变化”。不隐式保存，不移动磁盘基线。重新查询展示新正文真实结果，不自动递归替换或复用旧写入。整次操作导致正文超过现有 1MiB 字节上限则全部拒绝并保留原文，不截断或部分应用。

本片局部主承接 OBL-056。完整父 F-041、编辑/阅读可见文本查找及替换、完整命令责任与 `F-041c-offline-final` 保持开放；不推进 F-028c、专项设计、跨文档/工作区替换或离线验证。

## 先行隔离公开 API PoC

主线批准后才使用明确 mktemp 临时目录，以 apply_patch 写可复跑 driver，读取已安装 `@codemirror/search` 6.7.2 与 CM state/commands 公开声明及实现，不改仓库依赖/lock。复用 F-041a 的公开 SearchQuery/test 普通文本语义、真实 raw-buffer 与公开 ChangeSet/Transaction/history；不复制依赖私有算法或建立新 Unicode/替换引擎。

验证路径：一次不可变快照 → 公开查询得到全部非重叠范围 → 有界批量规划 → 一次真实 raw 编辑事务 → 一次 undo/redo 精确还原。需对比稀疏多行与1MiB密集命中，记录实际计时/分配及失败，不设性能 SLO、不把 Bun 实验当 WK。

优先评估 Worker 保留紧凑索引并生成有界批量结果、主线程一次提交的路线。不能循环调用 F-041b 单项 helper：现有 rawOffset/contextualSeparator 每范围重复扫描可能退化为 O(命中数×正文长度)，且百万 ChangeSpec 对象/完整状态推进会放大内存。PoC 必须验证一次线性 raw/逻辑位置映射及换行上下文处理，合并无需修改的匹配，使用公开 ChangeSet 的批量构造或组合机制，而非每匹配完整 state。最终选择依据实际证据再补生产最小方案，暂不承诺具体序列化 schema。

测量必须包含真实 production state.update 内 rawText field、transactionFilter、invertedEffects 及 undo/redo 的完整成本，不能只计 Worker 匹配/规划。上述消费者共享 applyEditorChanges，Worker 计划更快并不消除提交热路径重复扫描。禁止以全文 replace 丢失选区/未触及行尾语义来伪装小改；raw通道扩展需明确评估是否关键路线，未经批准不接生产。

必须保留未触及 BOM、混合 CRLF/LF、lone CR、EOF 及原有文本字节；新增换行与既有 applyEditorChanges 行为一致。lone CR/LF 拼接后最终 CM 文档与 raw 一致，选择通过最终 changes 映射，不用字符串长度猜位置。若为了规模必须新增受限 raw patch 适配，只能在已批准原文事务能力内保留同一历史真源；需要明显扩大公共协议/安全范围或改写整篇造成不可接受映射时先报告，不默认采用。

PoC 矩阵：中文/emoji/Unicode大小写与全词、字面 `$1`/反斜杠、空串/跨行、替换含查询但只处理原匹配、全部同文及部分同文、正反/多选区映射、混合行尾/BOM与lone CR接缝、稀疏长文/1MiB密集索引、输出字节超限。检查真实 raw、最终逻辑文本、变更数、唯一 history event、undo/redo。拒绝、超时或不足以保真的结果均记录，不为通过实验弱化范围。

## 生产候选契约（待 PoC 核实后主线批准接入）

1. 统一命令从活动普通源码文档发起，捕获 owner/session、Text、query/options、replacement 和一次操作意图；不使用滞后 React result 作权限或全集凭据，不要求存在 current match，但要求完整扫描就绪。Worker 不获路径、文件句柄或写盘能力。
2. 完整索引留 Worker；viewport 的2048项绝不是全部替换集合。结果有严格 schema、单调/不重叠范围、身份与大小校验；不无界传输百万对象。正文与紧凑索引、候选输出/事务的额外开销分别计入保护，不把8MiB索引上限冒称总预算。预算是失败保护而非新增产品结果条数限制，失败不得伪称已替换或部分成功。
3. 一个在途全部替换，重复触发禁用/拒绝，不排队旧写；计算可取消、期限失败可显式重试。期间正文编辑和保存仍可用，不全局冻结。Text、session、查询/替换条件、模式、活动文档或权限改变，以及关闭栏/标签、dispose，使旧意图失效；Worker返回后重新检查全部身份、实时 canWrite、冻结/busy及编辑器/两输入框的 IME，只有仍一致才同步应用一次事务。新事务不得由过期回执自动重放。
4. 保存期间按现有授权边界处理，不改保存捕获快照；提交只经既有 controller 通道。结果原文的UTF-8字节上限在提交前及controller守卫验证；匹配逻辑坐标不冒充raw坐标。同文无变化不创建事务，真实变更通过公开 history隔离成为单步撤销，不清空原history。
5. 执行后保留查询/替换条件并重算；成功提示绑定当前文本与条件，显式新操作、条件变化、编辑/undo/redo、关闭清旧提示，viewport不清有效提示。沿F-041a派生扩展卸载和Worker取消契约，不引入常驻诊断或新网络能力。

## 最小 happy path 与继承约束

自动：上述PoC后补生产owner/协议、命令实时guard与controller提交接缝；一次全部替换→准确count/raw→一次undo/redo；迟到/重复/关闭/条件变更/同id新session拒绝；readonly/safe/IME/冻结与1MiB超限无部分写入。测试明确区分匹配数、实际变化数与最终剩余匹配数。

真实WK：Agent自造样本多处文本，现有查找栏展开替换→全部替换→单次undo/redo；同文、空串、多行、只读查询允许/写入禁止、中文候选、标签条件及模式隔离、主题/键盘按钮、退出取消与正常退出。主线负责版本/构建/实际代验，未测边界如实记录，模型通过不代替产品验收。

- F-002：本地内存与派生Worker操作，授权/网络/保存边界不变；最终离线人工保留，不断网。
- 中文与外观：中文按钮、进度/失败及准确变更提示；浅深/当前系统外观和可见焦点，真实窗口验证。
- 命令与键盘：统一registry及按钮Tab/Space/Enter；不劫持⌘H，不抢组合输入，替换快捷键留后续设计。
- 安全与日志：旧结果不写、全成功或全拒绝、有界候选资源；不输出正文/查询/替换文本/路径，不持久化历史；不把可丢弃Worker当正文真源。

## 当前证据

仅编写方案，未执行PoC或生产实现，尚无本片测试/构建/验收结果。待主线与独立Spec审核后先运行隔离实验；如公开API及规模验证可行，再由主线批准具体生产接入。父项、完整OBL-056与offline-final保持开放。

## 隔离 baseline 实验（2026-10-11）

目录 `/tmp/agentic-f041c-poc.Mi01QN`，apply_patch写 `worker.ts` 与 `driver.ts`；复跑 `bun /tmp/agentic-f041c-poc.Mi01QN/driver.ts`，原始日志 `run.log`、修正实验导入后的 `run-second.log`。使用仓库已安装公开search6.7.2/state6.7.5/commands6.11.1与真实createRawEditorState，无新增依赖。driver每用例独立子进程，8秒超时SIGKILL并记录退出137；不是性能SLO。

首次绝对package目录导入走main CJS，与生产ESM state混用导致semantic扩展实例不兼容红；改为同安装版本公开dist/index.js后7语义例通过，不改生产或依赖。包括BOM/混合CRLF/LF、字面模板、非递归替换、多行、相邻两次删除形成CRLF、emoji、同文与部分同文（3命中仅1真实变化）。验证最终raw/逻辑文本、反向及多范围mainIndex保留并按最终changes映射、原有输入历史→单次undo只撤替换→redo→撤回原先输入。

第二次baseline实际观察（Bun1.3.14/macOS arm64，单轮进程RSS非峰值/非WK）：

| 样本 | 命中 | 真实state提交 | undo | 结果 |
|---|---:|---:|---:|---|
| 连续a，1,000字符 | 1,000 | 5.05ms | 1.18ms | 通过 |
| 连续a，10,000字符 | 10,000 | 17.61ms | 10.48ms | 通过 |
| 连续a，100,000字符 | 100,000 | 92.51ms | 61.16ms | 通过 |
| 连续a，1MiB | 1,048,576 | 776.58ms | 507.74ms | 通过但末次RSS约1.51GB，百万ChangeSpec对象不合理 |
| a空格交替，1,000字符 | 500 | 13.10ms | 2.55ms | 通过 |
| a空格交替，10,000字符 | 5,000 | 253.20ms | 13.21ms | 通过 |
| a空格交替，100,000字符 | 50,000 | 未完成 | 未执行 | 8,005.67ms外部终止；规划9.31ms已完成 |
| a空格交替，1MiB | 524,288 | 未完成 | 未执行 | 8,007.29ms外部终止；规划72.53ms已完成 |
| 约1MiB、末尾稀疏2项 | 2 | 129.96ms | 58.48ms | 通过 |

公开 iterChanges 默认合并报告相邻变化，但 ChangeSet 仍可保留各变化的选择映射边界，因此连续密集通过不能代表分散密集安全，也不能自行把相邻替换合并成一个 ChangeSpec。完整真实state提交（包括rawText/filter/invertedEffects）非仅匹配是本次失败边界。8秒是外部保护截止，只能说未完成，不能捏造实际最终耗时。上述无内存硬限或最坏复杂度保证；driver退出清临时进程，不改App/用户文档。

结论：不批准直接搬baseline进入生产。至少须研究共享raw映射的线性适配并减少批量ChangeSpec对象开销，保持精准changes/选区与原始字节；不能用全篇replace掩盖问题。下一步可在隔离目录用既有applyEditorChanges作小输入oracle作穷举/随机差分（CRLF中间、同坐标插入、多个范围接缝），证明候选语义后再评估生产raw通道修改是否属于关键路线。尚未编写该候选，待主线读取baseline决定后续；生产、构建、UI与Git均未执行。

## 后续隔离候选结果（2026-10-11，非生产）

主线批准继续隔离线性 helper、相邻映射实验及公开构造实验。仍在同临时目录：`linear.ts` 以顺序逻辑/raw位置遍历和一次逆向换行上下文表替换重复前缀扫描；`raw-candidate.ts` 是完整仓库 raw-buffer 的临时副本，仅替换 applyEditorChanges、调整绝对导入，其余 field/filter/history/模式扩展保留。故本节不是“原生产模块原样”的测量，仓库生产没有修改。

- `bun .../differential.ts`：68,679组小输入穷举及固定种子随机 oracle 差分通过，包括 CR/LF/CRLF、同坐标插入、多个范围、BOM/emoji。相邻合并等价断言首次失败且方案已拒绝：`aa` 分别替换为 `bb`，旧位置1映射2；整段合并成`bbbb`则按关联方向映射0或4，不可丢失映射。
- `bun .../state-differential.ts`：2,000组完整原模块/候选 state.update、raw/doc、最终changes、选择、undo/redo差分相同；额外原raw恢复断言发现原模块也有3例 lone CR 接缝 undo 未精确还原，现记录而不宣称完整语义通过。首个原文/变化在 `state-differential.log`，已交独立诊断lane约简，不自动修改生产。
- 同脚本证实 logical no-op 不等于 raw no-op：`a\r\nb\nc` 用其逻辑同文替换整个匹配，既有上下文规则输出`a\r\nb\r\nc`。baseline按sliceDoc相等跳过只覆盖七个已测例，不能用于生产真实变化计数；替换 CR/CRLF 必须先走与 CM 一致的规范化并比较实际 raw 效果。

`bun .../candidate-driver.ts` 仍逐用例8秒外部截止，日志 `candidate.log`。仅线性helper：分散100,000字符的提交区间323.63ms、撤销校验区间268.93ms通过；分散1MiB仍8,023.78ms终止。连续1MiB通过但末次进程RSS约1.49GB。因此单helper尚不足以批准生产。

计时精度补记（适用于此前表与本节）：commit区间包含阶段日志及完整state.update；undo区间还包括参考replaceAll生成、raw/undoDepth断言及撤销后断言，不是净API耗时。RSS为每个独立Bun进程读取时的瞬时值，不是峰值、不是计划对象独占分配量，也不是WK性能。

随后按主线批准读取已安装state6.7.5公开声明和实现：ChangeSet.fromJSON接受toJSON序列化形式，ChangeSpec.insert接受公共Text。`construct-worker.ts`/`construct-driver.ts`比较直接公开JSON构造与共享Text插入，保持精确分散ranges，不用私有构造。`construct-differential.ts` 60例核对toJSON/mapPos和完整state/history通过；初版相邻空删除JSON未规范合并与公开结果不同，已在实验修正并保留失败事实，不声称任意JSON构造验证。

`construct.log`：1MiB分散fromJSON构造89.67ms、共享Text构造47.99ms，但两者完整提交均8,018ms左右外部终止；连续1MiB末次RSS仍约1.54/1.53GB。这排除了“仅换构造入口便能消除剩余成本”的假设，没有证明剩余瓶颈的具体根因。尚不能交付可实施的完整生产接线方案；下一步应先定界真实扩展/changes遍历热路径及独立诊断raw撤销接缝，保持公开API、精确映射和原历史，不以降低密集样本要求或整篇replace绕过。父/OBL-056/offline-final开放，无版本、App构建/UI或Git。

### 分段成本诊断

主线批准后追加 `phases.ts`/`phases-driver.ts`，复跑 `bun /tmp/agentic-f041c-poc.Mi01QN/phases-driver.ts`，日志 `phases.log`。24个独立进程，每例仍8秒外部截止。精确changes与共享Text构造在计时前完成；分别测公开changes.apply、候选linearApply、裸EditorState.update以及包含线性helper的完整候选state.update。只读取结果length，不包含上一轮参考文本/undo校验；无并行App或WK测量。

| 1MiB样本 | ChangeSet.apply | linearApply | 裸state.update | 完整候选state.update |
|---|---:|---:|---:|---:|
| 单行a空格交替 | 8s终止 | 86.78ms | 8s终止 | 8s终止 |
| a换行交替 | 1035.38ms | 87.64ms | 1008.52ms | 1945.02ms |
| 长行末尾2项 | 0.17ms | 9.58ms | 0.54ms | 83.76ms |

100k单行分散对照：公开apply258.71ms、linearApply12.32ms、裸265.95ms、完整315.78ms。证据支持“公共ChangeSet.apply在分散单长行即能独立复现主要剩余成本”，不是仅凭依赖源码推断；其他扩展有额外开销但不是该8秒未完成现象的必要条件。没有证明所有可能输入复杂度，也没有得到可直接接入生产的高效替代路线；不私有构造/fork，不改精确changes为整篇replace，不把超时作为正常零结果。

独立raw接缝诊断lane另已约简原模块`raw='\r'`、逻辑位置1插LF，形成raw-only变化但最终CM docChanged=false；撤销/发布/字节上限相关结论由主线及独立诊断记录，不以本片oracle差分相同掩盖既有缺陷。本片生产方案须等待该窄安全修复与批量公开路线进一步决定，目前仍只有隔离实验。

## 本轮最小补实验方案（待批准执行）

### 问题与范围

问题已经从“是否能无条件提交任意密集计划”收敛为“能否在昂贵主线程提交前识别极端成本并整次拒绝，同时普通输入保真完成一次事务/undo”。只用当前生产`createRawEditorState`、raw helper/filter/inverse及已安装公开SearchQuery、ChangeSet、Text和history，不接入旧raw-candidate、不新做Unicode搜索引擎、不以全文replace或丢失精确映射换性能。不得把F043d局部缩进预算照抄成全部替换文件大小上限。

批准后以明确mktemp目录、apply_patch建立薄driver，每case独立子进程并由外部终止保护。先小规模再逐级到既有1MiB边界；旧8秒外部截止可以沿用作实验防卡死，不是产品SLO或拟定拒绝阈值。没有新依赖/生产副本优化，只有自建样本和隔离候选计划；保存输入种子、命令、当前依赖/源码基线、退出状态与原始日志供独立复跑。

### 最少语义矩阵

1. 大小写不敏感`a A`替换为`a`：命中2、实际变化1；全同文最终raw不变，不建空事务/dirty/history。零匹配、空查询保持明确状态。不能把匹配数当实际变化数。
2. 混合LF/CRLF中跨行逻辑同文、replacement含CR/CRLF的逻辑归一化、BOM和EOF：对照当前批量raw helper的最终字节，未触及行尾保留。
3. loneCR与新增LF接缝、相邻匹配同时删除及共享边界插入效果：最终逻辑doc和raw一致，raw-only变化仍可撤销；以F014c修后原文期望为准，不复制旧oracle缺陷。
4. replacement含query或字面`$1`/反斜杠只处理原快照匹配；原有输入历史→全部替换→一次undo仅撤本次→redo。多选区正反方向/mainIndex按最终changes映射，稀疏变更不能全文覆盖未触及位置。
5. 原输出恰上限及放大后超现有1MiB字节上限：要么完整成功，要么全部拒绝；成本拒绝同样不得创建任何部分事务/历史。

### raw-noop与计数预检

所有匹配先保留为同一快照的完整计划，**不先按`state.sliceDoc(from,to) === replacement`删除项**。公开ChangeSet默认iterChanges合并邻接变更，当前raw helper按合并段确定新增行尾上下文；提前删掉看似逻辑同文的项可能影响其余项实际字节，不能把逐个独立调用F041b helper的计数相加当批量语义。

先以完整公开changes得到批量最终raw候选；整体raw相等时明确无变化，不提交。其余情况，实验需对每项在批量有效插入上下文中的原文贡献核对实际变化数，重点包括部分同文和邻接换行；不能只由replacement.length推导raw位置。任何省略no-op项的优化必须另证最终raw与全部位置映射等价，否则保留完整计划。若复杂接缝使归因含糊，先记录最小输入/实际结果并回报，不以模糊“已替换N处”掩盖；本轮先验证计数契约而非直接发明生产新提示。

### 成本形状与有限测量

最少包含中等常规多行、1MiB长行末尾2项、单长行分散密集、同大小多短行密集，以及输出增长/空串删除。原失败样本仅在外部截止保护下逐级验证，不反复长时间运行已知高成本例。

分别记录匹配扫描、紧凑计划统计/公开ChangeSet构造、raw预检、完整生产state.update、undo、redo的独立计时间隔；断言/日志放计时外，无法分离时明确标注。读取RSS则注明采样瞬时值、独立case进程及阶段，不称峰值或计划独有内存。必须测一次真正提交及逆向历史，不用Worker匹配快代替主线程成本，也不把纯裸CM成本当完整产品表现。

成本保护候选先计算无需巨量对象的统计：总变化范围、每条受影响长行的分散段数量与该行长度、输出增长、索引/计划暂存成本；不能仅以总文件大小或命中数设定普通输入拒绝。保护必须能在构造巨大ChangeSpec数组及主线程changes.apply/state.update前作出判断。可取消Worker计算失败也整次拒绝，不声称同步主线程事务启动后可由timeout中断。此次不预设具体系数、阈值、SLO；从有限对照证据提出可解释的保守参数方案，主线阅读批准后才生产。

### 结果交付与下一步边界

交付可复跑路径、完整语义结果/已知失败、分段成本及保护建议；保留高成本原红，明确拒绝候选是否同时放行普通长文稀疏操作。通过隔离验证后再追加生产最小方案（Worker全集索引/身份fencing、替换栏按钮、原子提交及中文提示），需主线明确批准；本次授权不含该实现。继承前文F002、中文与外观、统一命令/键盘、安全日志及只读/IME/生命周期要求，OBL056仅局部、完整父和最终离线开放。

## 当前生产基线补实验结果（2026-10-11，隔离候选）

明确临时目录 `/tmp/agentic-f041c-recheck.WUYxG0`，`plan.ts` 为纯计划/批量贡献核对，`case.ts` 为当前生产 state/raw/history 的薄驱动，`driver.ts` 逐子进程8秒截止。复跑 `bun /tmp/agentic-f041c-recheck.WUYxG0/driver.ts semantic` 或 `driver.ts all`；全量原始日志 `run.log`，最终语义 `semantic-final.log`，追加 `noop.log`、`join.log`、`exact.log`、`unicode-growth.log`。后者可按 `driver.ts noop 1048576`、`join 100000`、`sparse 1048576`、`unicode-growth 1048576` 复跑。主线代码基线231f2eb、已安装公开依赖不变；直接import当前生产模块，未复制旧raw-candidate。driver总退出0不等于各case通过，须读每个code/timeout。

12个语义用例通过：大小写部分同文；完整同文；BOM混合行尾及字面`$1`/反斜杠；非递归扩展；多行上下文；相邻删除形成CRLF；replacement CR/CRLF归一化；中文/emoji；跨行逻辑同文却raw变化；相邻换行部分同文；零匹配；空query。前10例有已有输入历史，真实变更断言单步undo/redo及继续undo恢复原先输入；反向范围、主范围与最终changes映射相等。最后两例无事务/history。12例是有限矩阵，不宣称穷举所有接缝。

计数使用完整batch的raw输出、默认iterChanges合并段，再顺序核每个原匹配实际插入贡献，未逐项独立apply或预滤逻辑同文。例如 `\r\n\n` 查LF换LF：2匹配、最终`\r\n\r\n`、1真实变化；跨行逻辑同文混合EOL例则2匹配、2变化。整体raw不变优先count0/no transaction。另1MiB单长行524288个精确`a→a`，以“精确匹配且query/替换相同、均不含换行”窄证明直接无变化，约50.17ms扫描后不创建changes/state.update；不能把该证明推广到多行逻辑同文。

本轮计时把日志和校验置于各API计时外；state.update与读取其惰性state单独报告。RSS是独立Bun进程阶段瞬时采样，非峰值/计划独占/WK值。以下毫秒为单次观察，非性能SLO：

| 样本 | 命中 | 构造 / raw预检 | update / state | undo / redo | 结果 |
|---|---:|---:|---:|---:|---|
| 单行分散10k字符 | 5000 | 1.37 / 2.31 | 10.60 / 7.43 | 9.38 / 8.70 | 精确原文/历史通过 |
| 单行分散100k字符 | 50000 | 4.36 / 12.25 | 259.51 / 38.78 | 270.47 / 280.65 | 通过；阶段RSS约300.5MB |
| 恰1MiB稀疏2项 | 2 | 0.19 / 4.08 | 8.17 / 66.77 | 57.18 / 56.81 | exact.log通过，无文件大小拒绝 |
| 多短行100k字符 | 50000 | 7.61 / 9.82 | 70.42 / 89.83 | 131.33 / 129.31 | 通过 |
| 单行分散1MiB | 524288 | 38.58 / 60.51 | 未完成 | 未执行 | 8012.08ms外部终止/137，非实际完成时长 |
| 多短行1MiB | 524288 | 30.93 / 70.09 | 1135.40 / 788.49 | 1924.48 / 1856.63 | 完成；末次RSS约1.115GB，不能当低成本 |
| 多行100k删除所有LF | 50000 | 6.59 / 4.58 | 110.73 / 35.05 | 187.98 / 141.56 | 输出50k长行，必须计逆向形状 |
| 单行10k删除a | 5000 | 1.31 / 1.44 | 8.70 / 5.63 | 9.88 / 8.08 | 通过 |

run.log原稀疏公式实际少1字符；追加exact.log修正到恰1MiB并通过，不修改旧日志。原plan的`indexBytes`仅“若Uint32配对索引”的理论尺寸，实验实际pairs为JS number[]，不能把该字段当实际分配。现experiment没有生产Worker/生命周期/成本阈值实现。

增长预检两例在ChangeSpec和raw扩展分配前拒绝：10k输入5000匹配各换10000字符，逻辑输出50005000；1MiB `a ` 换`字`，逻辑长度仍1MiB但仅插入UTF8已1572864字节。两者都是既有1MiB最终字节上限的必要下界，不是假设最坏CRLF上界即一律拒绝；更一般精确UTF8/上下文统计仍需在生产规划前线性预检。没有放大巨量字符串再事后以byte检查宣称受控。

### 下一最小生产保护建议（待主线批准，尚未实施）

1. 独立全部替换operation owner/Worker，不占用现有查找的latest-pending槽；捕获raw字符串、Text、editor会话、query/options/replacement及操作epoch。raw-only会保持Text，不能只核Text。取消或权限/条件换代后旧请求永久失效，不能条件改回便复活。
2. Worker先对完整匹配做线性统计与能证明的整体raw-noop识别。跨行仍须完整合并段上下文，不预滤同文匹配。先核精确输出UTF8与暂存增量，再允许raw候选/共享Text及有界精确ranges；零变化不创建CM事务。当前窄无换行同文证明可以直接复用思路，通用批量预检需生产正式测试，不把实验计数当完备实现。
3. 成本至少联合范围数/暂存量、原受影响行长度乘分散变化数、输出及中间连接长行形状和逆向undo；不能只看原行或扫描耗时。建议下一方案以“最多65536个需提交范围、正反相关行工作量各不高于5×10^9个估算单位”作为待核初始内部保护参数：放行本次50k普通样本及1MiB稀疏，拒绝524288范围的极端分散/多短行。该数字仅从有限样本选保守起点，未在本实验实现、不是普遍复杂度保证/产品SLO；正式方案需明确估算算法、边界及受控拒绝回归，主线可调整后批准。暂存放大单独按实际协议约束，不把理论indexBytes冒充总内存。
4. 通过保护后主线程再同步复核全部身份、当前raw/权限/IME/冻结，并创建一个精确changes事务及一次undo。中文拒绝提示说明成本保护、内容未修改；不partial、不全文replace、不声称主线程提交能被Worker timeout打断。匹配数与真实变化数分别记录，既有单替换/查找不受新operation失败影响。

本轮只证明有限语义与公开路线风险仍存在，尚未生产批准、构建或产品代验；下一步由主线及独立review决定最小生产接入，父/OBL056/offline-final开放。

### 独立补实验复核（2026-10-11）

独立Spec实际读取冻结`plan.ts`、`case.ts`、`driver.ts`及本节结果，复跑以下命令；子进程均code 0、timeout false：

```sh
bun /tmp/agentic-f041c-recheck.WUYxG0/driver.ts semantic
bun /tmp/agentic-f041c-recheck.WUYxG0/driver.ts join 1000
bun /tmp/agentic-f041c-recheck.WUYxG0/driver.ts noop 1000
```

12语义例通过；轻量join的500次删除输出500字符长行，完整state/undo/redo断言通过；noop的500次精确同文匹配在changes构造前结束，count 0。没有重跑已知1MiB分散8秒超时例，不把有限复跑当计数全接缝证明或产品验收。

独立发现字节预检的泛化限制：`matches × UTF8(replacement)`不一定是任意JavaScript字符串的必要下界，跨替换片段的代理项可能结合。实际小探针：

```sh
bun -e 'const r="\uDC00\uD800"; const e=new TextEncoder(); console.log({each:e.encode(r).length,twice:e.encode(r.repeat(2)).length,claimedLowerBound:2*e.encode(r).length});'
```

输出`each: 6, twice: 10, claimedLowerBound: 12`。因此已测两种增长拒绝不等于该乘法对所有替换文本有效；生产方案须用跨片精确UTF-8计数，或仅在证明无此接缝时采用该下界。此证据已告主线与执行者，未修改实验或生产实现。独立结论仅允许进入最小生产方案编写；具体成本算法/参数及完整守卫仍待批准，生产未批，父/完整义务/offline-final不变。

## 具体最小生产接入方案（待主线批准）

本节为下一步方案，尚未编码。独立Spec复跑12语义与小型join/noop通过；另指出UTF8分块边界必须处理未配对代理项：`\uDC00\uD800`单份编码6字节、两份拼接后10字节，而非12。因此实验`insertedMin`原公式不得泛称任意JS字符串必要下界；上述`字`样本仍成立，临时case已限定无surrogate才用快捷下界。生产采用下述精确流式计量，不用错误分块和拒绝合法结果。

### 一个独立操作与严格协议

- 在现有普通源码替换栏增加“全部替换”按钮及统一registry命令，无新快捷键/native菜单/RPC。当前query/replacement沿既有逐文档store，结果显示“匹配N处，实际改变M处”；无变化明确显示0变化，不制造dirty/history。权限、模式、解析安全降级、查找/替换草稿IME、正文IME及冻结守卫沿单替换；只读仍可查找，不可全部替换。
- 一个挂载view仅一个独立all-owner/inline Worker，与查找owner分离；运行时禁用重复all提交，不排无界任务，也不占查询/viewport/navigation槽。request含operation单调代次、不可复用owner/view/session epoch、raw快照、query/options/replacement；Worker只收到标量epoch，不收到真实session对象。结果为`noop`、`rejected(reason)`或`plan`判别联合，携带同operation/epoch与matched/changed、精确outputBytes及成本统计；plan携有界Uint32配对ranges，不回传海量匹配对象/重复replacement。
- 严格检查字段/类型/整数/上下界、buffer偶数长度、各range非空有序不重叠且在logicalText范围内、计数关系和声明预算；最多65536个提交范围，索引最多524288字节。全集扫描仍不能截断匹配数冒充总数；超过可提交预算时可直接明确成本拒绝，不显示假总数。一般匹配仍复用SearchQuery/getCursor及当前保守Unicode/wholeword逻辑，不创建Markdown解析state或私有算法。
- owner在发起时捕获真实session对象、Text、raw字符串、view身份以及条件/权限失效epoch；任何正文（包括raw-only）、query/replacement/options、close、模式/safe、卸载/关闭标签、权限/冻结或IME进入变化均取消并terminate旧worker，清listener/timer；恢复相同条件不恢复旧epoch。回执和执行同帧再次核对所有绑定，未通过不写正文。Worker factory/postMessage/error/messageerror/timeout/malformed均整次失败且可显式重试，无永久冻结；同步CM提交开始后不声称timeout可中断。
- 失效不等React下一render：store/controller同步订阅、ViewPlugin每次update（不只docChanged）、query/replacement输入框compositionstart立即撤销当前intent；正文compositionstart也明确撤销。通知订阅不能仅看最终值，否则条件或IME开始/结束的ABA会复活旧回执。all结果提示独立绑定raw/条件，正文、replacement或新操作变化清除，单纯viewport不清；成功提交后核controller实际新state再展示完成，不借旧React值证明写入。

### 精确raw预检，不创建第二套原文规则

1. 先扫描完整快照匹配并统计输入总长度、范围数与源最大逻辑行长。raw-noop快路仅限`caseSensitive === true`、query与规范化replacement完全相同且均不含CR/LF；或另行逐实际命中核对原文完全同字后才可快返。忽略大小写的`a A`查a换a不能据query等于replacement判整体同文。满足该证明时不构造changes，即便高密度也返回准确匹配数/0变化。一般跨行同文不走此捷径；所有原命中保留，不先过滤逻辑同文。
2. 在重复插入或巨量ChangeSpec之前先核逻辑输出必要下界、非surrogate快捷UTF8必要下界及范围预算。每次统计使用安全整数、超过上界即成本/大小失败；不先分配待拒绝大字符串。共享一个公开`Text`作为replacement，≤65536范围才用公开`state.changes`构造精确ChangeSet，不合并丢映射、不全文replace。
3. 对当前`raw-changes.ts`只作必要小重构：抽出共享单调raw范围/行尾上下文遍历，使旧apply与新增measure共用同一规则；visitor提供未修改raw片段和当前合并段的插入Text/选定separator。measure以Text公开迭代器分片处理，不先`toString().replace()`放大整个插入。旧apply仍在需要输出时构造结果，其F014c/filter/inverse顺序不变；有界旧helper oracle与常规单点性能对照为必须回归，不引入新raw引擎。
4. measure流式累积精确UTF8、逻辑输出最大行长、raw整体相等及每原匹配在批量合并上下文中的贡献；UTF8使用公开TextEncoder并暂存最多一个尾high-surrogate，下一片接合后编码，最终孤立项按TextEncoder规则，不能简单分片字节相加。CRLF逻辑边界同样跨片保留一个pending CR；范围计数沿合并段输出按规范化replacement逻辑长度归属，不能独立调用单替换。任何计数/范围对不上均失败，不给错误“已替换”。
5. 精确outputBytes超过既有1MiB立即整次拒绝；完整measure结束raw相同则无需state事务。通过后才允许生成有界最终raw预期，供主线程最终保真核对；Worker可不传正文，只传字节/count/plan，主线程复用同shared helper验证结果。后续主线程一个`state.update`带`input.replace`和`isolateHistory.full`，精确原ranges保留选区/主范围映射，一次undo/redo；不复用过期transaction、不自动定位首匹配或清原选区。

### 可解释的有限成本保护

设N为完整拟提交ranges（不先删no-op），Lsrc为源逻辑文本最大行长，Lout为measure得到输出逻辑文本最大行长。取正向指标N×Lsrc、逆向N×Lout；中间指标N×(Lsrc+Lout)。顺序apply的处理中行可含已处理输出前缀及尚未处理源后缀，和界比只取max保守；undo交换源/输出，使用相同和界。不只看query起始行，也覆盖跨行删除把短行连接为长行。包含无关大行是有意保守，不是“精确运行步数”。

候选初值明确修订为：N≤65536，正反各≤5×10^9，中间≤10^10。这样100k单行50k范围处在上界而放行，恰1MiB稀疏2项和100k多短行通过，524288范围的极端样本在构造前拒绝。前节“正反各5e9”不意味着把其和也限制5e9；不无声改变已测放行意图。参数为当前有限样本的内部保护起点，不是普遍最坏时长/内存保证或性能SLO，不新增普通文档大小限制。正式实现须有精确边界测试与中文“本次全部替换开销过高，内容未修改”提示；不能部分替换。

还需计构造暂存：输入/raw及最终输出沿现有1MiB字节界、索引≤512KiB、一个共享replacement Text、有界changes/history范围。复杂Text/history真实分配不能靠这些数字证明绝对RSS上限；因此保留实测限制，必要失败terminate仅作用尚未提交的Worker。若measure统计显示N少但插入结构/行数会使构造明显放大，应先报告具体样本修订保护，而不偷偷放宽或新增文档大小上限。

### 最小接线与验证

新增小型all协议/engine/worker/owner与纯计划模块；`SourceSearch`只接按钮/运行状态、现有条件及生命周期取消；共享commands加本片无键位命令；不动文档保存基线或搜索worker任务调度。raw helper只做上述共同遍历抽取。生产测试须覆盖：12语义矩阵及跨片surrogate；密集raw-noop；原/输出长行与精确预算边界；超限在放大前拒绝；同id重建session/raw-only/权限和条件ABA、晚回执、close/unmount/error/timeout；运行期间查找导航独立；一次undo/redo/原历史及主选区映射。测试driver用当前生产模块而非旧候选副本。

主线后续真实包验：普通源码按钮替换、空串/多行/部分同文、只读/IME隔离、取消/跨标签/历史、成本拒绝正文不变及主题/退出；自然物理输入、极端机器RSS等没实操不能宣称。此方案等待主线与独立review批准后才实施；F041父/完整OBL056、编辑/阅读、F028c和offline-final不随本片关闭。

## 实施检查点（未验收）

- 新增独立all协议/纯计划/inline Worker/owner；现有查找owner不复用、不占其pending槽。唯一主线程事务入口置于`source-replacement.ts`并核真实raw字段，Worker纯计划不依赖完整Markdownstate。SourceSearch新增按钮与统一命令（无快捷键/菜单），store/controller同步observe、每次view update及正文/两个草稿输入compositionstart即时撤销旧operation。
- 协议实际最小化为id与判别结果/ranges/count/bytes；会话对象、不可复用挂载owner及Worker实例身份保留在闭包，回执核当前raw/Text/session/conditions。成本在主线程再计算，不重复传cost统计或冗余epoch字段。此内部简化经主线认可，不能据此省略同步取消或ABA防护。
- 共同raw visitor保持原单调查找与默认合并段语义；measure实现经主线认可简化为最多两份有界normalized replacement字符串缓存，而非计划中的Text迭代器。前置逻辑输出及范围约束后才构造，未创建match数倍的whole-output字符串；精确UTF8保留跨片high-surrogate，逻辑行计量以loneCR/CRLF均换行，原文比较仍逐字节。普通apply原有逆效果/filter/history不变。
- 自有owner 5例覆盖同快照单operation、无队列重复、raw-only/session/Text/query/replacement/权限ABA同步失效、composition显式cancel、卸载晚回执、malformed/error/messageerror/factory/postMessage/timeout及显式重试；失败后条件变化清提示，viewport本身不清。受控测试不是实际WK或自然IME。
- 独立测试作者新增core8项214断言（曾6项201），包括12原文矩阵、代理对、range预算/密集no-op、精确字节及正逆5e9边界、同逻辑不同raw拒绝。其readonly初夹具appendConfig优先级错误已改用生产writePermission compartment，不据旧夹具误判生产。
- 最新定向21项5011断言/4文件/350ms通过（all core/owner、旧raw-mapping oracle、单替换回归）。首次增量typecheck仅owner测试`.at`不在目标lib红，已改显式末项索引；首次专项lint仅空测试方法与循环风格红，已修。最终typecheck进行中，专项格式/lint已绿；主线全量由主线另记，当前未自行验收。
- 共享visitor独立补证：`/tmp/agentic-f041c-raw-compare.4YcsB0/{baseline,driver}.ts`取实际HEAD旧helper，`run-final.log`固定seed0x041c2026的3000组CR/LF、多range差分全同。100轮交替helper总毫秒：短尾旧0.043/新0.051、多行中段2.344/1.680、100k尾63.652/64.113；有限采样非UI/SLO。首计时夹具把raw11当CM10坐标导致红，修driver后pipefail0；首差分绿记录留run.log。无生产回退或新依赖。

尚未完成实际WK；临时实验的超时、RSS与未实操范围保留，不将自动测试写成实际包验收。任何后续修改须重新冻结交独立review与主线。

### 实施中窄补：插入行结构暂存保护（主线批准）

源码核查发现只有range数/长行指标尚未覆盖“少数匹配插入大量换行”的公开`Text.of(split)`行结构分配；这是静态风险推断，未运行近百万行对象实验，不声称已实测巨量RSS。主线批准将其纳入既有操作成本保护：在split/Text.of前流式统计规范化replacement的LF数，乘完整matches；超过65536个新增换行结构即整次成本拒绝，主线程preflight同查。参数与range保护同阶但独立，非原文行数/普通文件大小限制，不部分修改，不承诺峰值内存。边界只构造有限样本验证，不用巨大对象实验；F041c其他范围不变。

最终作者检查点：core测试10项224断言，含插入LF结构边界、已有65537行不受该新增结构预算限制、loneCR准确行界；初版后者夹具误把loneCR当行内字符导致9过1失败，依真实editorText纠正后全绿，不通过回退生产迎合错误预期。与owner、原raw oracle、单替换组合23项5021断言/4文件/388ms通过；最终typecheck、受影响文件eslint、feature-docs/obligations、diff检查均通过。当前生产与测试冻结交独立Spec/Standards，主线另行全量/版本/构建/WK；未自批、未Git。

## alpha.120 构建与实际窗口待验（2026-10-11）

独立最终Spec代码复核0阻断（19项299断言），Standards代码复核0阻断（31项5109断言），不等同整片验收。主线最终源码全量936项26825断言/150文件/23.95秒通过，日志`/tmp/agentic-f041c-source120-final.log`；之前932项中间结果保留于`source120-tests.log`，不覆盖最终计数。typecheck、全lint、文档/义务/lock/diff检查通过。

主线递增package/bun.lock至`0.1.0-alpha.120`，`AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary`成功，日志`/tmp/agentic-f041c-build120.log`；现有大chunk与hdiutil弃用警告保留，不作为失败。产物与实际展开version.json同为alpha.120、hash`3dslcp31xse3l`。副本`/tmp/agentic-markdown-alpha120.8JoYAr/Agentic Markdown-canary.app`用原隔离App数据目录及editor fault lab启动，exec59308 / Bun PID28812，尚未据进程存在宣称界面正常。

主线按精确App路径连接真实窗口两次，CUA均返回`-10005 timeoutReached`，暂未取得AX/截图，不推断系统/进程/锁屏根因，不以模型测试代替窗口验收。尚未在新版打开或保存正文，未断网；继续间隔重连，整片未验收、不得提交。自建待验样本在`/tmp/agentic-f041c-ui.qxHm1V`，A/B普通文档及70k分散命中成本样本，未使用用户正文。

包内Bun实际运行仓库测试936项26824断言/150文件/21.77秒通过，日志`/tmp/agentic-f041c-package120-tests.log`，不冒称产物内置测试。后续第三次精确路径及重建CUA工具会话后的第四次连接仍同一超时，未获得窗口实证；已异步请用户确认是否解锁且窗口可见，不将其作为已知根因。未退出当前包、不代写验收结论，不改变网络或用户文档。

后续只读inventory成功列出运行中的Agentic Markdown；按其bundle ID连接返回多副本歧义（Applications/build/dev/temp），再按ps实际`/private/tmp/...alpha120...`规范路径第五次连接仍超时。仅记录工具响应差异，不推断窗口、系统锁定或App故障原因。尚无验收操作成功，不以进程或inventory可见替代窗口验收；当前保留现场待连接恢复。

### 用户确认解锁后的重试（2026-10-11）

用户回复“已解锁，窗口可见”，仅确认桌面状态，不代表F-041c验收。随后第六次规范路径连接失败，间隔30秒后的第七次精确路径连接失败，重建CUA会话后的第八次连接失败，恢复工具文档后的第九次连接仍失败，均为`Computer Use server error -10005: timeoutReached`（约5秒）。最近只读进程核对Bun PID28812仍运行同alpha.120；不将进程存在或用户可见窗口当作Agent已取得界面证据。

尚未取得新版AX/截图，未打开、编辑或保存待验正文，未退出应用、改变网络或提交代码。连接失败根因未知，不能继续归因锁屏，也不能据此声明App失去响应。真实窗口验收继续阻塞；保留运行现场和自动测试/代码审查证据，不以它们替代必要实际验收。

用户再次要求重试后的第十、十一次精确路径连接均`-10005 timeoutReached`，后者在重建CUA会话及间隔20秒后执行。只读ps发现原Bun28812已不存在，launcher28801仍在、子进程28807为defunct；inventory仍显示App运行。原exec59308轮询无新输出。此为新的进程观察，不补造退出时间/原因，不证明与连接超时因果关系。没有强杀、重叠启动或写用户正文；请求用户正常退出现有实例后再启动同一alpha.120验收，整片仍未验收、不得Git。

### 用户退出后同包重新启动：真实 WK 局部证据

用户确认已退出后，ps确认旧alpha.120实例不存在。主线以原隔离数据目录/editor fault lab启动同一包，exec57769/Bun33011；CUA精确路径连接成功，取得欢迎页AX与截图。仅证明本次恢复，不确定历史超时或旧Bun退出根因。未重打包、未改生产、未保存用户文档。

- 自建A源码查alpha（忽略大小写）换alpha：匹配4/实际改变1，ALPHA变alpha、dirty；重复操作4/0。首次点击正文与undo同调用未观察变化，分步确认焦点后undo恢复原文clean；redo再dirty、undo再clean。保留首次无变化，不归因。随后多行`甲\n$&😀`替换4/4，四处均按字面呈现，分步确认正文焦点后单次undo恢复完整原文clean；空串替换4/4，undo后打开B，A标签clean。
- A换Z四处dirty，切B正文仍alpha beta alpha且clean，回A保持Z与替换草稿；正文焦点确认后单次undo恢复A完整原文clean。仅普通跨标签路径，不冒充Worker竞态。
- 自建B chmod444后UI明确只读；源码查alpha显示1/2，单项/全部替换均disabled且提示只读。已恢复644，切文档后权限恢复可编辑。B故障实验触发安全源码，查找/替换栏消失、正文保持clean；未据此宣称所有故障路径。
- cost.md140001字节查a显示1/70000、高亮受限；首次工具paste的实际替换草稿不是预期b，记录为未知输入差异，不算a→b证据。之后分步setValue核对草稿恰b，再点全部替换，明确提示“本次全部替换开销过高，内容未修改”，正文/标签仍clean；关闭cost无放弃弹窗。没有部分替换，不声明机器RSS或任意最坏时长。
- A替换草稿Z内工具按n/i时AX显示Zn且两替换按钮disabled；Escape后草稿Z、按钮恢复、正文clean。这是工具输入法路径，不冒称用户自然物理IME验收。

当前A普通源码clean、B安全源码clean，cost已关闭；B磁盘权限恢复644。其他计划项及最终独立验收复核仍待完成，整片尚未通过、不得Git。

### 真实 WK 收尾证据（待最终独立复核）

- 查找草稿alpha内工具n组合时显示alphan，两替换按钮禁用；Escape恢复alpha及可用。正文工具n组合时临时line-twon/dirty、替换禁用，Escape恢复line-two/clean。与替换草稿路径合并覆盖三个组合入口，仅工具路径，不冒称自然键盘或全部输入法。
- 先普通编辑line-one→TEMP，再选line-two后全部alpha→Z，结果4/4且AX仍报告line-two选区；一次undo只还原alpha、TEMP仍dirty，redo恢复Z且选区仍在。dirty下⌘Q显示确认、继续编辑保持TEMP/Z；之后一次undo撤批量，下一次undo才撤TEMP并回clean。证明本次原历史边界，不概括任意选区映射。
- 浅色/深色设置值均读回，实际替换栏截图可辨，最终恢复深色。首次点浅色随后Escape没有应用，保留失败，改Up/Return后成功。浅色下替换成功4/4；把草稿Z改Q，关闭查找再⌘F打开，Q保留且旧完成提示不复活；随后undo回clean。
- A编辑及阅读模式均无源码替换栏，阅读正文仍原内容；安全源码隔离见前节。未专门实测⌘H隐藏，既有系统键位不改，本片无新快捷键。
- cost重新打开，a→b再次成本拒绝；同一打开会话改查询为`a \n`，提示清除且1/1，全部替换成功1/1、dirty，再单次undo回clean。说明拒绝后普通条件可恢复，不是关闭重开才恢复。
- 最后所有标签clean，⌘Q返回App quit，ps确认Bun33011不存在。三样本SHA与起始完全相同：A `32f499ed9806f8f8b3c066f2e308581bebea78a1dc2424dbacc068d87117582e`；B `49f42637599e5528ae0731738ed1959f3c21f1cd22fe08fab4e4190fdd6180bb`；cost `b9cab1f02cec3986a8d5d0693b3bbd037e5f3e72e20da7627e6ac45f071a748e`。B权限644；未保存任何样本/用户正文，未断网。

Worker在途ABA/超时/malformed、精确BOM/EOL/UTF8及所有成本极限主要为受控测试，不虚构为WK实操；极端机器RSS、自然物理IME仍未实测。父F041/完整OBL056和F-041c-offline-final仍开放。等待独立最终复核与主线确认，不预写整片通过或Git成功。
