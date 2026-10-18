# F-058a：已打开 clean 文档的磁盘版复制

## alpha178 真实 WK 有限代验通过（2026-10-18，Git 待执行）

独立最终 Spec 33 项 / 184 断言、前端 Standards 37 项 / 305 断言通过，两轴均为 0 必要有限非离线验收阻断；主线已批准 alpha178 有限受托 Agent 代验通过，非用户亲验。Git 待执行，不预写提交或推送成功，完整父功能和下列开放责任不关闭。

主线完成下列真实 WK 操作与磁盘核验；这是受托 Agent 代验，不是用户亲验。alpha178 unsigned 包 hash `kuh9qnba7qij`，包内 Bun 运行**仓库测试**为 1648 pass / 0 fail / 37412 assertions、224 文件、31.87 秒，日志 `/tmp/f058a-alpha178-bundled-tests.log`；不是应用内嵌测试。源码最终仍为 1647/1/37411，保留 FINAL-ISSUE-002；包内运行通过不构成该性能问题已修。单次权限 metadata 红例仍保留 FINAL-ISSUE-003，不归因或关闭。

自建夹具 `/tmp/agentic-f058a-wk.FmMGwd`，原五文件 SHA 记录在 `manifest.json`。实际矩阵：

| 场景 | 主线实际结果 |
| --- | --- |
| 原字节、建议与冲突 | `root-a/原文.markdown` 为 47 bytes、含 BOM、3 个 CRLF、无末尾换行。建议跳过已有 copy 到 copy 2；改为已有名称时显示冲突并禁提交。 |
| 独立副本与源身份 | 成功创建 copy 2；副本 ID `f422f7ac-179f-4fbe-b448-74a0c336a6ba`，源 ID `8cc46070-94db-4fea-ab93-960e56bd06a9` 不变。返回源后最后一行选区仍在；redo 恢复临时编辑历史后变 dirty、复制禁用，undo 恢复 clean。 |
| 只读与独立文件授权 | 保持 `其他.md` 测试 dirty，打开独立授权、权限 444 的 `只读.md`。隐藏侧栏，用 `⌘⇧P` 进入复制；没有授权父目录时默认目标为空、不能提交，明确选择 root-b 后创建 40 bytes 的 `只读 copy.md`，新标签可编辑。源仍只读，其他文档 dirty 保持；回到其他文档后 `⌘Z` 恢复原文 clean。 |
| 取消 | 取消其他文档的 copy 对话，没有创建对应磁盘文件。 |
| 浅深主题 | 两种主题下本片 UI 可读。首次浅色 AX 点击后 Esc 未应用；之后使用 Home、Return 明确选择浅色，不能把首次操作算通过。 |
| 退出及磁盘终核 | 正常 `⌘Q`，session `25183` exit 0，PID 60214/60215 消失。五原文件 SHA 全部原样，两份新副本均逐字节同源，取消目标不存在，目录仅预期项目。退出 stderr 出现 IMKCFRunLoop 文本，未据此推断根因或宣称无 stderr。 |

以上只证明所列有限路径。自然中文 IME、所有真实 OS 故障与 unknown 回执、跨卷、完整并发时序未实际覆盖；注入测试不冒真实系统错误。`F-058a-offline-final` 留最终人工，不断网。FINAL-ISSUE-001/002/003、F-058b 版本选择、F-028/F-066 消费者、完整父 F-058、F-057b、阅读子窗口、专项与冻结内容继续开放。本次最终批准仅覆盖有限非离线片，Git 待执行。

退出核验后，主线已将自建只读夹具权限从 444 恢复为 644；不改变其已记录的测试期间只读证据，不涉及用户文件。

## 主线冻结检查与新观察（2026-10-18）

源码修改期间首轮全量1644/4/37405（`/tmp/f058a-source-tests.log`）：既有FINAL002及本片三条前端断言失败均保留，不猜根因。冻结后全量1646/2/37408（`/tmp/f058a-source-tests-final.log`）本片断言通过，但出现权限metadata hints为空；主线单文件6/0、独立单文件6/0、单例10次和documents组合130/0未复现。再次同冻结源码全量1647/1/37411、224文件48.49秒（`/tmp/f058a-source-tests-repeat.log`），唯一失败既有长空白18.352秒/5秒timeout。权限新观察登记FINAL-ISSUE-003按用户允许留最终集中，非归旧或已修；源码全量不称全绿。

最终type/full lint/docs/obligations/lock/diff通过。第一次full lint测试152多余assert失败已窄修，保留记录。独立后端Spec35/206、独立前端Standards37/305及Spec晚接纳19/111通过；解除owner后源版本重查缺口已修，不以阶段较早0阻断覆盖该发现。主线已读实际最终关键接线，批准下一alpha178 unsigned构建与真实WK；尚未构建或验收，不得Git。真实夹具仅自建，原五份SHA见manifest，offline仍不执行。

> 状态：alpha178 经独立最终双轴复核，主线批准有限非离线受托 Agent 代验通过，Git 待执行。下方“尚未构建/验收”为当时阶段记录。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## 状态与范围

2026-10-18：五组隔离探针作者/主线及两独立轴复跑均 5/0；有限 typed 实现、构建和真实 WK 矩阵见顶部，独立最终复核后主线已批准本片有限通过。下方早期“未批准探针/生产/build”为历史阶段，不撤销后续明确批准；不能将探针或自动测试通过冒真实验收。当前最新已获最终批准的有限已验包为 alpha178，Git 待执行。

依据：[产品总账](../product-capability-register.md)第 319、347 条及 W-11；[MVP 规格](../mvp-product-spec.md) F-058；[义务登记](../deferred-obligations.md)。F-058 当前没有既有 OBL 主承接项，本片不关闭、迁移其他 ID。

本片仅处理**已经打开、clean、磁盘版本可可靠读取的 Markdown 文档**。在当前文档提供“复制文档”入口，界面明确源文档及“磁盘版本”，用户确认目标目录与名称后创建独立文件和新 `documentId`。源文件只读但可读不应仅因不可写被排除；目标必须当前已授权且可写。新副本可按现有常驻打开路径进入编辑模式，不把原标签改绑过去。

不承接 dirty、conflict、missing、保存失败、恢复中等状态的版本选择与内存内容复制；这些保留给 **F-058b**。F-028 冲突比较/合并结果与 F-066 崩溃恢复的复制消费者仍开放，复制不能清除它们的原状态或恢复记录。完整 F-058 不因本片通过而完成。F-057b 本 App 本会话新建空目录可见、重扫保留且可在其中新建文档的例外已获用户确认，但尚未实现；其他空目录仍隐藏，跨重启以后再考虑。当前 F-058a 迭代顺序不变，本片仅使用现有可选授权目录，不依赖该例外。

## 功能说明

1. 默认名称采用可修改的 `原名 copy.md`、`原名 copy 2.md` 递增规则；建议保留源支持的扩展名，例如 `a.markdown` → `a copy.markdown`，不剥除源名已有的 `copy` 字样。沿用 F-057a 已明确的单组件名称、有限 NFC/小写比较与隐藏项规则，不声称完整 Unicode case folding 或所有卷语义。
2. 只有源父目录落在**当前有效的目录授权**内且能取得可信目录证明时，才默认选源父目录。单独打开文件的授权不授予其父目录写入权；没有合格默认目录时，要求用户明确选择现有授权目标，不暗中授权父目录或任意路径。
3. 复制的是提交时确认的一份稳定磁盘字节快照，原字节、BOM、LF/CRLF 和末尾换行保持，不经编辑器规范化文本重新编码；不复制图片/附件、恢复记录、标签状态或私有元数据，不重写相对链接。跨目录复制时相对链接可能指向不同位置，界面应明确不会搬运资产。
4. 不覆盖任何已存在文件、目录或符号链接，名称预检失败保留输入。原路径、`documentId`、标签、内容/状态、选区及撤销历史均不因复制而变更；不调用原文档保存、不接受外部变化、不清理恢复状态。其他标签的 dirty 内容也不要求保存或放弃。
5. 候选资格在入口、提交前和接纳结果前复核。提交前源变 dirty、关闭、换身份或基线不再一致，建议明确取消本次提交并保留输入，不能悄悄改成内存复制或复制新版本。完成磁盘提交后资格变化只影响打开/激活，不回滚已生成文件。具体复核点由路线审查确定。

## 继承约束检查

| 约束 | 本片落实方式 | 计划验证 |
| --- | --- | --- |
| F-002 本地与离线边界 | 仅本地授权文件读取与目标写入，无服务端、资产下载或不可写队列；离线项留最终人工，不主动断网 | 自动核无网络依赖；真实本地复制；`F-058a-offline-final` 实施后登记，不冒已验 |
| 中文与外观 | 中文入口、磁盘版本说明、冲突/失败/已创建提示；继承浅深/系统主题，长文件名不挤坏操作区 | 真实浅深主题、长中文名及错误提示 |
| 命令与键盘 | 统一命令上下文与按钮等价入口，不抢系统快捷键；键盘完成目标/名称确认及取消；IME 与关闭/冻结资格沿用现有守卫 | 命令/按钮一致、Tab/Enter/Escape、失效资格；自然 IME 无实证则明确留缺证 |
| 安全与日志 | 后端从可信 handle/identity 获取源和目标，不信渲染层路径；排他发布、不盲删；匿名阶段错误不记录正文或绝对路径 | 路径/授权替换、同名竞态、提交后异常、日志与 RPC 内容检查 |

## 技术路线候选（待调查与复核）

### 1. 源与目标资格

前端只提交受信文档 handle/documentId/版本标识、opaque 目标与名称，不传磁盘绝对路径或伪称磁盘版的正文。后端结合现有文档调度和保存排空，在开始复制前验证有效源授权、同一文件身份、当前基线及稳定读取；用实际 bytes 和读取前后元数据/hash 得到有界快照，沿用现有文档大小边界。不能只凭前端 clean 标志，也不能调用保存来“变 clean”。源若在检查期间改变则明确拒绝，不能用重读接受任意新版本。

名称建议和冲突检查使用实际目标目录的有界、可取消分批枚举，包含隐藏项与非 Markdown 条目；默认名超出预算则提示用户处理，不阻塞输入事件或枚举无限后缀。提交必须重新核目标目录原身份、授权/代数和名称；不能把预检当排他保证。源字节不随名称每次输入重复读取，不建立第二份长期全文缓存。

### 2. 不覆盖的完整内容发布

F-057a 已有空白文件排他创建不能直接当本片完整内容复制：先暴露最终空文件再慢慢写正文，会产生部分内容与失败阶段的新问题。建议候选是在**目标同目录**创建本操作独占临时文件，写入全部字节并检查长度/hash、同步后，再以公开原生 API **原子且不覆盖地发布**最终名称。源跨目录或跨卷时仍只读源，临时文件在目标卷内。

现有 `native/save-primitives.c` 的 `replace` 使用普通 `renameat`，可能覆盖目标，**不能用于本片最终发布**。macOS 公开不覆盖发布 API、flags、错误码、持有 descriptor 的身份语义及 Node-API 返回失败合同尚须读取官方声明/文档调查；例如带排他语义的 rename 只能作为待核候选，当前不声称可用。调查与独立路线复核后如需隔离探针，须先在本文件冻结有限 oracle、预算和首红停边界并由主线批准；本方案不授权实验。

提交点应是最终文件名成功发布，而非临时文件创建。发布前失败仅可清理本操作已核身份的私有临时项；发布后同步、fstat、关闭、树接纳或打开失败仍须报告“已创建”，不得删最终文件回滚或重放复制。无法确定发布是否完成时保留 unknown，不按路径存在就认领文件、不谎报未创建。原生预构造错误对象、pending exception、fd/临时资源关闭及失败阶段，必须按实际 API 收敛，不沿用空白创建探针替代本片证明。崩溃残留临时项的边界需明确，不扩为扫描用户资产的清理功能。

### 3. 收据、打开与模块边界

优先复用 F-057a 已有目标证明、名称规则、扫描 park、严格准入 owner、一次收据及树接纳原则，增加复制所需的局部模块，不构建通用事务框架。拟在 shared 定义本片请求/阶段，documents 提供可信只读字节快照取得，workspace 协调目标与单次发布收据，native 仅暴露经核实的窄发布操作，client/UI 处理复制对话与一次接纳。具体 typed 签名在公开 API 调查后确定。

收据绑定源版本、目标和最终名称；同 operation 只能重放同结果，换输入拒绝，ack 后不重创。已发布但未打开只可按原身份重试打开，不能再次复制；目标被替换、grant 已关闭或撤销不复活旧意图。单槽需与既有创建/根移除/选择/保存/退出任务明确互斥，所有旧 finally 只能释放自身 owner；不把现有 create sink 或 watcher 成功当全部发布已完成。

新 grant 建立后的同步提交收据、树预算与原身份接纳、迟到响应/IME/关闭守卫和未呈现 grant 释放沿用 F-057a 已审查原则，但必须针对带内容副本重新接线测试。关闭提示不是撤销磁盘复制；打开后的副本为新身份，原标签保持可返回，不能迁移原 undo/dirty 状态或要求放弃原内容。

## 实现后最小 happy path

方案与必要 API 验证获准后实现再测，不 TDD，不预定性能门禁：

1. 打开授权根内已保存中文 Markdown，复制到默认同目录；默认 copy 名可修改，新文件完整 bytes/hash 与源一致，树只出现一次，新 `documentId` 常驻打开；返回源标签，路径、内容、选区与 undo 原样。
2. 分别用 BOM + CRLF、无 BOM + LF 及无末尾换行样本；比较磁盘原始字节，不仅比显示文本。`.markdown` 扩展保留。
3. 已有 copy 文件时建议 copy 2，手改为已占用名称必须拒绝，旧文件字节不变；预检后竞争占名也不能覆盖。
4. 独立授权文件不能默认写其父目录，明确选择已授权其他目录才复制；可读只读源不被写入。取消前提交不生成副本，其他 dirty 标签与 undo 不变。

必要正式异常测试随实际路线补齐：稳定读取失败、保存交错/源变 dirty、目标换身份与授权撤销、部分临时写入/同步失败、发布后异常、回执丢失/重放、未呈现 grant 清理、关闭后不重激活。故障注入只证明注入阶段，不能冒真实 OS 全矩阵；缺证如实保留。

## 真实验收计划

正式实现通过相关测试、type/lint 与两轴代码复核后，由主线另行批准递增 alpha 和构建；使用自建测试目录与已知字节样本，在真实 WK 完成按钮/命令/键盘复制、修改名称、重名反馈、源标签返回、其他 dirty 文档 undo、取消、独立授权目标选择及浅深主题。核源和目标磁盘 SHA/bytes、新身份和单节点，正常 CmdQ 退出，无用户文档写入或丢弃。

自动测试不替代实际窗口验收。真实未覆盖的自然 IME、跨卷、OS 故障明确登记；工具失败保留证据，不推断根因。离线项留最终人工，FINAL-ISSUE-001/002、阅读子窗口、专项设计及冻结内容保持原边界。通过有限本片仍不关闭 F-058b、冲突/恢复消费者或父 F-058。

## 本次方案检查

### 五组隔离原生探针批准（2026-10-18）

主线全文读取本方案及两轴复核，Spec/Standards均0必要隔离路线阻断。批准仅新mktemp目录、真实Node-API+包内Bun的窄发布探针；每组15秒、整批180秒首红停，保留目录、原oracle和日志。尚不批准生产/新版本/build。固定五组：

1. 固定bytes `EF BB BF 23 20 E4 B8 AD 0D 0A 41 0A 42`，写满sync后RENAME_EXCL发布，最终bytes全等、普通文件且与heldfd fingerprint一致、temp名消失；不冒断电耐久。
2. 分别已有file/dir/symlink，须EEXIST且原类型/bytes/linktarget不变，temp保留；不调用覆盖rename/unlink。
3. 发布前temp移走并换替代，末核拒绝、发布syscall0，最终名不存在、原及替代均保留；仅固定时序非CAS。
4. 真实成功后注入返回失败或后验失败：只能published/unknown、不重发不回滚，查询不增syscall；后验替代拒认领且保留双方。注入不冒自然N-API失败。
5. 窄依赖注入ENOTSUP，未发布/明确不支持，覆盖rename/unlink0，temp原样；不改系统卷、不声称真实卷不支持。

每组实际断言不得以输出日志替代；临时小ledger不冒正式收据/编辑gate/稳定源/树接纳。成功后再收敛typed接入，失败先保留证据和审查原因。

### 首轮双轴必要缺口与有限合同修订

Spec指出clean证明和按名发布两项，Standards另强调按名清理竞争；全部保留为未实验前路线缺口，不以声明存在冒实现可行。主线采用以下候选合同继续复核，尚未批准任何探针/生产：

1. **提交期窗口owner保护，不建立伪后端dirty镜像。** 对话输入期不冻结。用户确认时，前端同步核源handle/documentId、编辑版本、clean、IME及busy/fault/外部风险，建立本片owner后再核同一token；保护须接入实际编辑事务、undo、保存/重读、关闭与切换入口，不能仅禁用按钮。固定源版本与原baseline revision/hash随操作绑定，后端只验证可信grant、基线和稳定原始bytes，不宣称从renderer标志推知clean。保存排空后重新核源身份/hash；发布前复核源仍为已冻结快照的磁盘版本，变化拒绝而不接受新基线。gate到明确终态或确认取消前保持，响应未知查询原槽，不超时放开后重发。退出/dispose阻止尚未发出的发布；已发调用按真实结果记收据。源外部进程可在最终核验后继续修改，副本语义仍是已确认固定快照，不承诺与源在所有瞬间原子一致。
2. **发布前后身份检测，不宣称跨进程CAS。** 目标同目录随机私有临时叶名，始终持原fd及fingerprint。发布前核祖先链、父fd对应路径、临时名不跟随链接的stat与held fd身份/类型/hash/长度；本进程不跨await执行末核至原生发布。成功立即记published，随后按同父fd重新打开最终项，核原临时身份及完整bytes和祖先链，才树接纳/打开。任一发布后失配记已发布但身份未知，不认领/自动打开/重发或删除最终路径。公开API仍按名称解析，前后检测不等于能阻止同UID恶意外部替换，也不称全局原子身份发布。
3. **未证实身份绑定清理前不按名称自动unlink。** 即便stat相同也不能把stat→unlink称原子条件删除。本片最保守候选在失败/不确定时只关闭本操作fd，保留可能的临时残留并明确提示；不调用既有removeTemp盲删，不扫描清理用户资产。发布成功通常消费临时名；随后同名再出现不能视为本操作所有。若后续选择可靠隔离或真正身份绑定清理原语，必须先修订此唯一方案并独立核验。崩溃残留保留为有限边界，不隐藏为复制成功或原文改变。

上述选择尚需独立二次路线复核，实际typed接点、有限探针oracle及预算尚未冻结；不把当前规划标成实施或已验收。

### 主线公开接口初查（2026-10-18，仅声明证据）

主线全文读取本机Xcode macOS SDK `usr/share/man/man2/rename.2`（`renameatx_np.2`指向它）及`usr/include/sys/stdio.h`相关声明。公开`renameatx_np(fromfd,from,tofd,to,flags)`自macOS10.12声明；`RENAME_EXCL`在支持的文件系统上遇已有目标返回EEXIST，不支持flags可返回ENOTSUP，不能回退普通覆盖rename。相对单组件路径按各自目录fd解析，同目标目录临时项避免跨卷发布。SDK手册未将该API变成“按持有文件fd发布”，源仍是名称：临时项身份与目录重验、外部替换竞态、发布成功后收据、完整sync/cleanup及Bun Node-API联接仍需方案收敛和真实探针，尚未批准实验或生产。不拿声明证明所有卷和系统错误均已验证。

来源为本机官方SDK：`/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk/usr/share/man/man2/rename.2`及同SDK`usr/include/sys/stdio.h`；网页搜索镜像不作为技术结论依据。

- 启动 `bun run check:obligations`：通过；本片没有既有 OBL 主承接项。
- 收尾首跑发现缺少脚本要求的唯一状态引用行，已补齐后重跑；不修改功能范围。
- 以上均为规划，不是生产、探针或验收结果。

## Typed 正式接入最小合同（已批准有限实施）

2026-10-18 主线全文读取 T1–T5 及实际 snapshot/barrier/native/creationHost/updateEditor 接点，独立两轴指出成功哨兵与 unknown 终态缺口，采用以下补充后批准正式实现与实现后测试；不批准新版本/build/验收/Git。以下补充优先于 T3/T5 早期措辞：

- `publishExclusive` 返回预构造的显式成功哨兵 `0`，JS 仅严格 `result === 0` 才记 published；其他返回值为 unknown，仅白名单明确 syscall 前或失败码记未发布。不得以 void/undefined 当成功；正式测试覆盖非法返回。
- 区分传输未知/服务端 pending 与服务端明确 `working=false`、不会继续发布的 terminal unknown。前者保持本 owner gate 并只查询原槽；后者释放本 renderer gate，但保留未知收据、禁重创/自动接纳，根 fence 按收据独立处理。关闭提示不等于 ack unknown。
- 正常 CmdQ/窗口退出有显式出口，走既有全部 dirty 保护后失效 owner/dispose；不删除文件，不把退出当未发布。不得让未知结果永久冻结整个窗口。`publish(next)` 必须合并 duplicate owner，后台观察不能提前解冻。
- 两轴实际探针均5/0：Spec日志 `run-1792309994219.json`、Standards日志 `run-1792309995153.json`；G4为JS收到成功后的注入，G5为依赖注入，未调用覆盖rename/unlink由源码检查确认，不扩证。

五组探针保留于 `/tmp/agentic-f058a-publish.ZZ6IeK`，作者日志 `run-1792309921548.json`、主线复跑日志 `run-1792309984802.json`，均 5/0、exit 0、无 timeout；两独立轴亦各复跑 5/0、无必要底层路线阻断。真实 `RENAME_EXCL` 与固定替换/故障时序通过；G4 是 JS 已收到成功后 throw，不是 N-API 返回构造故障，G5 是 ENOTSUP 注入，不证明卷不支持；覆盖 rename/unlink 为零来自源码路径检查，不是 runtime 拦截。不能直接迁移简陋 probe 状态机，不证明生产收据、源 gate 或全部并发安全。以下为待实施合同，不扩探针。

### T1：可信源读取与严格准入

拟新增 Bun-only `withDuplicateSource(source, action): Promise<boolean>`；`source` 固定 `{ handle, documentId, expectedRevision, expectedHash }`，action 接收 `{ bytes: Uint8Array, hash: string, fileName: string, checkCurrent(): void, revalidate(): Promise<void> }`。不向 renderer 返回 bytes，不接受 renderer 正文伪装磁盘版。

复用 `withCreateBarrier` 的 owner/保存与 acceptance 排空机制，所有 enqueue/读写/选择/退出入口受同一严格准入约束；不得在已有 owner 内再次进入公开 barrier。排空后核当前 grant、identities 基线及固定 hash。局部抽取 snapshot 已有稳定读取循环：从可信路径重新 O_RDONLY/NOFOLLOW 打开临时 FileHandle，核原 grant 身份，64KiB 分段读取、有界大小及前后 stat/hash；不调用会 commit 新基线或失败撤权的公开 read，不改变原 mirrors、revision、标签状态。action 生命周期结束关闭临时 handle，源 grant 不关闭。

`checkCurrent` 核 owner/epoch/dispose/grant，`revalidate` 在发布前重新核授权与磁盘仍为固定快照；变化拒绝，不重新接受版本。renderer 的 clean 仍由 T5 gate 保证，后端不建立假 dirty 镜像。退出/dispose 入口立即使 owner 失效；旧 finally 不解除新 owner 或退出屏障。已进入原生发布的真实结果必须收口，不能由取消改写为未创建。

### T2：默认目标、名称与共享创建接点

将 F-057a workspace 中已有 target/lease/accept 局部整理为同一个 `creationHost`，供原空白创建和本片使用；保留相同 `removalAdmission/createOwner`、scanner 完整批次 park、目录证明、预算与单项接纳，不复制一整套创建逻辑。默认源父目录仅从当前目录授权与可信节点映射取得；独立文件授权不推导父目录权限。没有可用父目录则要求显式目标，不新增磁盘目录浏览器或空目录例外实现。

名称建议对实际目标目录做可取消有界枚举，采用源 stem + ` copy`、` copy 2`…，保留 `.md`/`.markdown` 扩展，不解析或剥除 stem 已有 copy；用户可修改。建议无可确定结果则 unavailable，不无限递增。纯校验、有限 NFC/小写等价、隐藏项规则复用 F-057a；预览取消不影响提交槽。提交前及发布后重新枚举，前检要求零等价项，后检要求唯一原身份项；失败保留输入或已发布收据，不冒所有卷原子等价语义。

### T3：窄原生发布与身份收口

本片局部 `duplicate-disk.ts` 接收固定 bytes 与 `CreationLease`，在目标同目录创建随机私有临时文件，持 fd 写满、核 hash/长度并同步。拟新增窄 `publishExclusive(directoryFd: number, temporaryLeaf: string, finalLeaf: string): void`，仅 `renameatx_np(..., RENAME_EXCL)`，不接受 flags/绝对路径，不回退覆盖 rename。参数/UTF-16/单组件长度验证、固定错误对象与正常返回值均在 syscall 前准备，检查每次 N-API status/pending exception；成功后回执异常固定区分 published-unknown，不把任意异常解释成未发布。EEXIST、ENOTSUP、权限和其他明确 syscall 失败使用固定匿名码；ENOTSUP 明确不支持，不换危险路径。

最终发布前 `revalidate` 源，核父目录祖先链、held directory fd、临时名称 no-follow stat 与原临时 fd fingerprint/类型/hash/长度；末次同步 owner/身份检查到原生调用之间不 await。成功立即同步调用槽的 `markPublished()`，再 fstat/同步目录/关闭/构造对象。按同目录 fd 重开最终项核原临时身份及完整字节，并重验父链才允许接纳；按名 API 仍有外部 TOCTOU，后验不是 CAS。发布后失配或回执不明保留 published/unknown，不认领、不重复发布、不删最终项。失败仅关闭持有 fd，**不按名称 unlink 临时项**，残留用中文说明，不自动清理或隐瞒。

### T4：独立单槽收据与一次打开

新增本片严格 typed 请求：`state`、`suggest/preview/cancel-preview` 与携带 `{ session, sequence }` 的 `duplicate/query/retry-open/release-unpresented/ack`。duplicate 绑定 T1 source、renderer gate 的版本 token、opaque target 和原始名称；同 operation 换任一输入拒绝，精确重放只回原槽。独立有界单槽不存长期正文，固定 bytes 仅执行期持有；ack 高水返回 acked，重启不自动恢复操作。不能复制整个 F-057a 服务，局部共用名称/目录证明与已创建打开 helper；workspace 两类提交共用排他 lease。

至少区分 pending、rejected-before-publish、published（含未能确认身份/打开）、opened、unknown、acked。发布函数进入前预留槽，published 状态不可倒退。query 只核收据，unknown 不凭同路径认领；暂时响应丢失保留原操作查询，绝不换新 sequence 重创。已发布后退出 T1 barrier，方可复用 `openCreatedAuthorized`，其 commit+grants.set 后同步 sink 更新本槽，附带阶段失败不丢提交事实。

树接纳沿用 owner+scanParked+root generation/identity/预算核验，未接纳保 published。retry-open 仅按原证明/身份和唯一等价项打开，**不重读源、不重写内容**；已失效/关闭 grant 标 released，不复活旧标签。后端未呈现 grant 释放仅本 operation 所建 handle，幂等且不得碰原文档或已由前端持有的 grant。unknown 的保守提示与资源释放不等于未发布。

### T5：renderer 真实事务 gate 与迟到接纳

对话输入期不冻结；提交同步核 clean、源 handle/id、editor revision、基线、IME/故障/观察风险/已有 busy，创建本片独立 owner 后再核一次，固定版本 token。gate 接入真实 CM docChanged 过滤及输入/undo/保存/重读/切换/关闭入口，而非仅 disabled 按钮；不要求其他 dirty 文档保存或放弃，可读只读源仍可复制。后端可能 pending/响应丢失时只查询同槽；收到明确终态才能释放本人 gate，unknown 明确“结果未知且不会重创”并保持 gate，关闭提示不能释放它或静默当取消。

opened 收据到达时先核旧 token、源版本及 IME/关闭意图；释放**本 owner** gate 后再次核 activation intent 才调用现有 `adoptCreatedDocument`，否则只显示已创建并释放本次未呈现 grant。不能因解除 gate 使自己刚检查的旧 intent 重新有效，也不误用仍 frozen 的接纳入口。用户关闭已创建提示可 ack 并停止激活；retry-open 建立新 activation intent，不重创；其他冻结 owner 保持。正常打开副本后返回源，原选择/undo/模式/状态不动。

正式实现后补源稳定读取无副作用、gate 真实 transaction、保存/退出交错、名称预算、全部发布阶段收据与迟到接纳测试，再进入原定真实验收；探针不替代这些接线证据。本节实施批准以节首主线记录为准；T3早期void签名及T5未细分unknown措辞均由节首显式成功0与terminal unknown合同覆盖。

## 后端实现及阶段验证（2026-10-18）

实际新增 `duplicate-disk.ts` 发布模块及 source/workspace 正式测试；native 新增固定 `publishExclusive`、预构造成功 0 与错误对象，导出数组使用实际长度。documents 从 snapshot 抽取稳定 bytes 读取并增加严格 `withDuplicateSource`，不调用会 commit/撤权的 read；workspace 共用 creationHost 与创建调度逻辑、使用独立复制槽，显式 `working` 与 source 绑定，source 不得交空白创建入口、复制不得缺 source。预览一次枚举产生 copy 名；发布前后身份/内容核验、明确 ENOTSUP、不按名称删除临时项、terminal unknown 释放后端 lease 但保收据禁止重创已接线。前端与 RPC 由并行作者接入，未在此记录冒完成。

阶段命令与证据：

- `bun test apps/desktop/src/bun/workspace/duplicate-disk.test.ts apps/desktop/src/bun/documents/duplicate-source.test.ts apps/desktop/src/bun/workspace/create-markdown.test.ts apps/desktop/src/bun/documents/create-admission.test.ts`：最终本阶段 35 pass / 0 fail / 206 assertions，4 文件；真实 Node-API 在测试准备中局部编译，不是应用构建。
- 本片 8 个 backend/shared 文件定向 ESLint 通过；阶段 `bun run typecheck` 通过。主线后续仍须在前后端稳定全集上重新执行最终检查。
- 初次新增目录 fd 检查使用 `Array.at` 与当前 TS lib 不匹配，type 报两处错误；已改索引访问，不升级 target。首轮 lint 的 import 顺序、unbound method、Bun matcher await 类型提示已窄修，未改测试 oracle；并行前端 mock 缺方法的中途 type 红由前端作者处理，保留为中途失败，不称首跑全绿。
- 新测试覆盖 BOM/CRLF/无末行、LF/空文件、可读只读源、copy 递增、源变更无撤权、源 gate 准入与 dispose、异 source 重放拒绝、无效原生回执 unknown、不重创、发布竞态 EEXIST、发布后替换、ENOTSUP 明确提示与临时项替换末核。JS 注入与真实 API 证据分别保留，非自然系统故障全覆盖。

尚未真实 WK、自然 IME、跨卷或完整 OS 故障验收；应用版本仍 alpha177，不提交。本片实际 WK 自建夹具由主线准备于 `/tmp/agentic-f058a-wk.FmMGwd`，仅记录准备，未冒执行结果。F-058b、父 F-058、F-057b、恢复/冲突消费者及最终离线仍开放。

## 前端实现及阶段验证（2026-10-18）

复用 `createMarkdownController` 增加复制模式，独立 RPC/命令入口及同一对话组件；源文件名固定展示、默认目标仅匹配当前根/目录节点、建议名称使用原源名，说明不复制资产及不改写相对链接。侧栏按钮可换行，命令面板入口不依赖侧栏显示。新建文件原入口继续回归，不复制整套控制器。

文档控制器新增本片 owner，真实 `updateEditor`、历史/保存/重读/切换入口沿用同步 frozen 守卫；只读源不因不可写被拒绝。源版本 token 及后端 `working=false` 分别控制提交期和终态，传输失败/pending 只查询原槽，terminal unknown 解本人 gate 但保留槽，不允许再次 create。正常退出使用 `beginWindowDiscard`，保持原全部 dirty 保护，取消退出不恢复旧自动激活；不能解除其他 owner。迟到接纳在 gate 释放后及现有 load 的 await 接点重新核 source 身份/版本/clean/IME/退出意图，显式 retry 才建立新激活意图。

失败和修订记录：

- 首轮 14 项有 2 红：实际 `controller.create()` 可绕 UI pending 再发，已在控制器入口增加同步 operation guard；另一项要求 `EditorState` 对象恒等，但既有标签切换会重配 parser，已保留此错误测试要求并改为产品合同的正文、selection、buffer revision 与 redo 历史断言，不宣称对象恒等。
- 新测试误写不存在的 `registerInteractionGuard`，17/1；修为实际 `setInteractionCheck`，不扩生产 API。中途 type 的两个 discard mock 缺新方法、lint 的 import/await/多余断言亦保留，均窄修，非首跑全绿。
- 并行后端作者复核指出 gate 释放到接纳间仅检查旧 boolean 的缺口；已保留源 token 并增加无 owner 的 `matchesDuplicateSource`，实际控制器释放通知中插入源编辑的测试核副本仅撤销未呈现 grant、原源编辑保留且不抢激活。
- 当前作者阶段运行 `bun test` 的 create-markdown/current-canonical/sidebar-discard/document-observation/discard-guard 五文件：44 pass / 0 fail / 363 assertions（chunk `f8d8e9`）。含空白新建原九项、源只读/建议、实际编辑事务拒绝、dirty 与组合 guard、传输丢失隐藏后重开、未知终态、退出取消、旧 owner、授权默认目录、发送前关闭、缺 terminal 标志及释放后晚接纳测试。

这是作者阶段验证，未自批、未应用打包、未真实 WK 或自然 IME 验收；最终 type/lint/全量与独立复核由主线继续收口。
