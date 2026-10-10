# F-041c：普通源码全部替换

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
