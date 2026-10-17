# F-061b：独立文件根从窗口移除

> 状态：已验收

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## 功能与范围

承接已确认总账第333条及W-26的独立文件根部分。用户在文件树真实选中顶层standalone Markdown文件后，通过“从窗口移除选中文件”按钮或统一命令解除这个窗口的文件条目和授权引用；不删除、移动、保存或改写磁盘文件。没有选择、选中folder root或根内节点时禁用，不以当前激活标签替代树选择，不新增默认快捷键。

若目标仍有打开标签，移除同时关闭该标签；有未保存变更、未接受的外部变化或未结束保存时，沿用现有关闭保护，用户取消则条目、标签、编辑状态、撤销历史和授权原样保留。用户可在操作前正常保存，本片不新增“另存为”或自动保存。目标没有标签时直接执行受控移除。其他文档与根、标签顺序及内容保持。

只接受动作发生时仍为独立顶层项的目标；若扫描完成、加入目录等已把该项吸收为目录中的文件，拒绝旧操作并刷新选择，不把目录内文件隐藏成移除，也不借此撤整个目录授权。显式打开隐藏文件仍按当前已确认投影例外判断，不能把“路径落在根下”单独等同已被树吸收。

最近文件记录保留：本片仅解除当前窗口引用，不顺便删除最近历史。清除历史已有独立入口；W-26未授权将两者绑定。跨重启完整恢复仍归F-029。

## 已读实际接口与必要缺口

- `client/workspace-tree-model.ts`：standalone顶层资格取决于`explicitStandalone`、可信`coveredHandles`及实际可见文件，key使用locationId/documentId；不能仅凭展示路径或renderer传入kind授权。
- `client/documents.ts`：`protect(ids, action)`提供IME/frozen、保存排空与dirty取消；`closeTab`只移除标签及编辑器、搜索/阅读/位置状态，**不移除entries、不撤后端授权**。现有`release(handle)`忽略响应内容并吞transport异常，只是旧清理兜底，**不能复用于用户可见移除的成功判定**。
- `bun/documents/index.ts`：`release`校验handle，保存或writeBarrier忙时拒绝，成功时移除grant/观察/mirror/watch/相关请求。返回`DocumentResponse`，但没有可查询、幂等的移除提交收据，也不独立验证当前树顶层资格。
- `bun/workspace/index.ts`：有后端根集合/已发现文件/覆盖投影和可信文档service；当前WorkspaceRequest仅全量`clear`，不得用它实现单文件移除。`removeAll`会撤根scope，不属于本片。
- 已有rescan与refresh acceptance有operation/receipt思路可参考，但不能把移除伪装成重扫或复用它们的token命名空间。

## 最小技术方案

1. **真实选择与统一入口。** 树只向窗口owner报告当前standalone的opaque handle及文档绑定；动作提交前重读最新投影。沿用统一命令可用性、controller IME/保存/frozen及workspace busy屏障。按钮与命令共用一个方法，无文件系统路径参数，不激活目标文档。
2. **先保护，后提交。** controller捕获目标handle/documentId/locationId与本次操作代数，先对这个documentId执行正常关闭保护及保存排空。取消不发移除提交。确认后再次核目标身份、树顶层资格和写入状态，并保持操作frozen直至提交结果已确定。不能先调用`closeTab`或publish删entries，再等待后端；也不能调用吞失败的旧release helper。
3. **后端可信资格与单次提交。** 增加专用受控standalone移除入口，由workspace端用自身当前覆盖/实际发现状态判定树归属，再由document service检查grant、显式独立来源及保存/写屏障。新增可信内部接口，不暴露renderer任意路径或“强制独立”布尔值。检查到实际撤grant之间不能插入可使资格过期的异步间隙；不能在已持有writeBarrier时直接调用必然返回BUSY的旧release。若需共享底层清理，应提取受信提交步骤而非放宽公开release守卫。实际接线采用客户端`protect / waitForSaves`先排空，服务端在begin及commit同步拒绝saving、writeBarrier、selecting、running、pending、acceptance.busy；最终检查、撤grant、写收据无await，因此不另持`withWriteBarrier`也不存在检查后异步让出窗口。后端本身不主动排空，不将拒忙测试称为排空测试。
4. **提交收据与迟到响应。** 本片只做一个窗口、一个尚未确认operation槽，不建立通用事务框架。最小协议如下：

   - 后端实例启动产生随机`removalSession`，只绑定当前唯一前端窗口/controller；只读state返回该session及下一可用sequence。服务端维护一个单调`ackedThrough`整数和最多一个槽，槽仅存session、sequence、opaque handle、服务端实际documentId/本次grant身份及`issued / committed / rejected`结果，不存正文。新begin只接受该session与`ackedThrough + 1`，不允许客户端跳号。满槽时不同目标/序号返回BUSY，**未匹配ack前不驱逐槽、不按时间过期**；序号耗尽安全拒绝，不能回绕。
   - `begin(session, sequence, handle)`在最新可信资格与写入屏障检查后登记issued，但不撤授权。相同session/sequence/handle重发只返回原槽；相同序号换handle拒绝。begin回执丢失时可查询或原样重发；客户端没有拿到issued确认前不得commit。失败发生在登记前则是明确拒绝且未修改任何条目。
   - `commit(session, sequence, handle)`只接受匹配issued槽，再查实际grant身份、当前顶层/保存资格。拒绝写入rejected收据；成功撤grant与登记committed在同一不可异步交错的提交收口完成。重复commit只读回原结果，不重复撤权。没有匹配issued槽不得凭handle直接执行，也不得在查询unknown后静默新begin替代原操作。
   - `query(session, sequence, handle)`不修改授权，返回匹配槽状态。issued明确尚未提交，可重试同一commit；committed/rejected据实收口。**unknown不是rejected**：同session中缺槽或身份不符不能证明原结果，保留内存、冻结与错误提示，仅重试只读query，不自动解冻/重授权/关标签。旧session返回`stale-session`，意味着后端实例/授权上下文已重置，不推断原请求是否曾提交；进入显式会话恢复失败提示，保持内存，不把新session当原操作的成功或安全取消。
   - `ack(session, sequence, handle)`仅接受匹配terminal收据，并且只在前端已完成对应committed一致发布或rejected保留原样后发送；issued不能ack。后端清槽并前推`ackedThrough`。ack回执丢失可以重复发送；`sequence <= ackedThrough`的ack只确认已过期且不影响当前槽，旧begin/commit同样拒绝，不能借重放旧请求撤掉新grant。以这个高水位防重放，不保存无界历史。收据未ack时不接受下一次移除；ack失败不回滚已确认的UI结果，只阻止新移除并重试ack。
   - 前端必须建立**独立pending-removal gate（待定移除屏障）**，从确认保护后的begin开始一直持有到query结果明确且UI收口。它要覆盖编辑写入、保存、标签关闭/切换、清空/退出、根集合变化等会使捕获身份或内存失效的入口，不能只禁用移除按钮。现有`protect(...).finally(endDiscard)`只能释放自身discard冻结，不能释放此gate；冻结应组合两个来源，不能让旧finally把待定移除解除。用户取消限于发begin之前的正常保护确认；issued之后不新增中途取消产品选项，使用确定结果收口。终态确认后可释放pending gate，ack未确认只保留新的移除操作禁用。

   启动重置边界：正常新App实例生成新session、高水位与槽均重新开始，不恢复旧runtime handle/operation；本片不提供进程崩溃后的持久事务恢复。存活前端遇后台换session必须按上述stale-session保守处理，不自动丢内存。会话恢复仍属F-029，不能以这一边界宣称跨崩溃原子性。协议只收结构化版本/session/sequence/handle，不接受路径或renderer自报文档身份作为授权。
5. **一次UI发布。** 明确committed后，在同一controller收口中清理目标标签/编辑器派生状态与entries，再发布一次一致的新状态；不要通过两个公共方法逐个publish制造“标签已关、树仍在”的中间成功状态。保留其他文档原对象/dirty/history与活动文档选择规则。明确rejected则原样解冻并反馈；迟到、旧目标或旧操作结果不能作用于新条目。保存成功在正常保护流程内发生的内容变化不是移除失败回滚对象，不恢复旧磁盘版本。
6. **派生消费者清理。** 后端成功移除该grant的观察/mirror/watch/资产引用和本片相关pending请求；workspace端对应assetOwners等引用不能留下可继续访问的陈旧能力。目录根自身授权、扫描及其他文档不变。前端排序owner仅通过既有reconcile删除已不存在的顶层key，不增加恢复持久化；最近记录不删。真正索引消费者尚未实现，保留接入义务，不称已有索引撤销已验。

本片不加入磁盘删除/废纸篓，不实现folder root移除、独占文档转standalone、跨根迁移、批量移除、最近历史联动删除或完整会话恢复。上述folder能力已有产品规则，不是取消或重新待定，只是后续切片。

## 最小 happy path 与必要自动验证

实现后测试，不采用TDD，不新增性能门禁。使用实际controller/service与公开协议：

- clean打开的独立文件：移除成功后条目和标签同次消失，其他dirty文档与history保留，磁盘字节不变；已关闭标签但仍在树中的独立文件也可移除。
- dirty/外部变化保护取消：不提交、不关闭、不撤授权；确认放弃后仅移除目标。保存进行中、IME/frozen/busy、只读文件均按既有边界处理；只读不禁止解除窗口引用。
- 无真实选择、目录/子项、已被目录吸收、伪造或过期handle、提交前代数改变均拒绝；显式隐藏standalone例外不误判。
- 后端拒绝/transport异常/延迟响应不能造成UI提前关闭；提交已完成但回执丢失可查询收口，重试不双执行，旧收据不影响重新打开的grant。未知收据不能冒成功或失败已确定。
- 条目/标签/编辑状态的单次发布，目标观察与资产旧请求失效；其他根、文件、最近记录及磁盘内容保持。真实保存排空/提交交错需要实际接口测试，不能仅靠布尔mock宣称原子性。

## 实际验收与继承

继承F-002本地文件/离线边界：不读写无关文件、不联网、不改Markdown；不为验收断网。`F-061b-offline-final`只登记，留最终人工。中文与外观：中文错误、浅深样式清晰；命令与键盘：统一入口与焦点可见；安全与日志：opaque授权与迟到响应保护、不记录正文。保存/dirty保护随本片接线验证。

主线全量及独立代码复核通过后管理alpha递增和构建；自建两独立文件及目录夹具完成真实WK：clean打开/未打开、dirty取消/放弃、只读、按钮及命令、目录禁用、吸收后的旧选择失效、其他文档未变、最近记录保留、重新显式打开成功、正常退出。取前后样本hash；工具失败与人工补验如实区分，不以自动测试替代真实交互，不触用户未保存窗口。

本片仅F-061的standalone子集，完整folder移除、OBL-007根派生授权撤销仍归原主责F-025及后续消费者；OBL-033/040完整恢复、OBL-061/F-075键盘汇合继续开放，不按编号误迁。F-047e兼容红、FINAL-ISSUE-001/002、阅读子窗、冻结stash、专项/F-028c及最终离线边界不变。

## 实施批准

主线全文读取方案与实际protect、release、树投影及资产接口；收据/冻结首轮必要缺口已补，独立Spec及Standards最终均0必要实施前置阻断。批准上述有限生产实现及实现后测试，不采用TDD；最终资格检查须在保存排空后同步执行，不能复用吞失败release或在writeBarrier内调用被拒的公开release。尚未构建或验收，下一alpha174由主线管理，不得提前Git。unknown/stale仅保守故障状态，不称恢复成功。

方案检查首红：继承内容原有但未使用校验要求的“中文与外观 / 命令与键盘 / 安全与日志”显式标签，已补标签，未改变范围。

## 实现后首轮验证（未构建、未验收）

已接共享严格协议、单槽收据、可信workspace/document撤权、controller独立冻结及一致发布、真实树选择按钮与统一命令。树资格投影按roots/nodes/coveredHandles/entries引用缓存，避免正文每次输入重建文件树；注册清理恢复拒绝谓词。最近记录不删，目录根移除未实现。

- 新增三个测试文件最新13项、111断言通过：真实controller的dirty取消、commit回执丢失、begin回执丢失同身份重试、unknown/stale-session只query保内存、ack重试、guard.request退出拒绝、真实save响应及settled双屏障；真实backend的folder在issued后吸收、隐藏例外、grant重开防重放、writeBarrier拒忙、真实atomicSave交错、pending candidate取消、已生成token撤销及有效图片reader迟到结果拒绝/另一grant正向对照。
- 此前定向旧回归连同当时新增项9文件114项、897断言通过；该次尚未包含最后的真实save后端新增项，不能将两次计数相加当一次运行。
- imageReader为明确成功的注入消费者，验证service撤权后的二次资格，不声称真实图片解码/磁盘图片本身已测。controller的ledger fixture不证明实际文件授权；后者由真实service测试分别覆盖。
- 首红保留：dirty测试只等一microtask即respond导致5000ms超时，改订阅实际dialog；recent断言原路径`/var`与真实canonical `/private/var`不符，改使用实际snapshot.displayPath；加入running/pending拒忙后旧不可达清理导致TS never，删除不可达分支；首轮lint18处格式/async规范问题修正；新增测试filter未显式缩窄union及空dispose注入导致type/lint红，补类型守卫及无资源说明；save测试未提供真实settled响应，controller安全拒绝，补settled latch后通过。上述未放宽生产守卫或预期语义。

独立两轴最终复核、源码全量、版本递增、打包和真实WK尚待主线执行；不标记通过、不提交。

主线首全量 `/tmp/f061b-main-tests.log` exit1：1563通过/1失败/36876断言，214文件47.8秒；唯一既有long whitespace18.803秒超时仍为FINAL-ISSUE-002，不猜测已修复。该次type/full lint/docs/lock/diff通过，但发生在以下重试入口窄修前，不能替代最终复核。

独立Spec发现必要UI阻断：侧栏隐藏仍可命令发起移除，而待定冻结禁止切换侧栏，唯一重试按钮原在inert侧栏内。主线批准将按钮迁到始终挂载的主文档错误提示区域，不放宽正文或退出guard。新增源代码结构测试核真实页面容器归属、pending资格与无disabled/inert；controller未知结果重试已独立运行。此结构测试不冒真实WK隐藏侧栏交互，真实验收须补该路径。窄修前失败保留。

## alpha174 构建批准

两独立轴主体分别Spec34/309、Standards56/722，恢复入口窄修两轴各7/59且最终0必要构建阻断。主线全文读取最终关键实现与真实保存交错测试。最终源码 `/tmp/f061b-final-tests.log` exit1：1564通过/1失败/36885断言、215文件48.93秒；唯一原long whitespace18.866秒超时仍FINAL-ISSUE-002，非全绿，不因重跑称修复。type/full lint/docs/lock/diff全部通过。按照用户既有偶发问题留最终集中授权批准alpha174 unsigned构建及实际WK，尚未验收，不得Git。

实际夹具 `/tmp/agentic-f061b-ui.TjTTyh`：独立甲.md SHA70132afa9b0911ff0fbf481d8282ccc55a3199b8e9ddc14ca2cea0bb9bdf1709；独立乙.md SHA8f1a52763133181f6fea225209fad7ca719f0429cd6c3af0bf609bc53eafa2ad；目录/内文.md SHA2edb4a2c3f8aa51e87675bd501078b15701afafd0d4eea856005971fac0a213f。全部自建，数据区另设，不触用户文件。

## alpha174 真实 WK 记录（待最终复核）

unsigned构建exit0，hash`2obx7iez0wn0d`，日志`/tmp/f061b-alpha174-build.log`。直接解包wrapper至`/tmp/agentic-direct174.oviMLg/Agentic Markdown-canary.app`并核version.json为alpha174，未运行安装窗口。包内Bun运行仓库测试`/tmp/f061b-bundled-tests.log`1565/0/36886、215文件30.51秒通过；不是包内内置测试，也不抵消两次源码FINAL002红。isolated data位于夹具data，launcher session39862、Bun28455。

实际操作与观察：

1. 打开独立甲、独立乙，乙输入TEMP_B成为未保存。单击树甲（未切换正文）后移除，甲树条目及标签消失，乙内容/dirty原样；乙一次CmdZ回到已保存，验证其他文档撤销历史保持。
2. 乙输入TEMP_DISCARD，移除弹出具名放弃确认。继续编辑后树/标签/正文及dirty原样；再次移除并放弃，仅测试内容丢弃，回欢迎页。最近甲乙记录均仍在，没有删除历史或磁盘内容。
3. 自建甲临时chmod444，通过最近入口系统选择器重开为只读。树选甲、隐藏侧栏，再用CmdShiftP与setValue查询移除命令、Enter执行，成功回欢迎页且甲最近记录保持。只读不阻止解除窗口引用；本步骤只验证真实隐藏侧栏正常路径，未制造真实RPC断链。
4. 重开乙，关闭标签后树条目仍在，选中后移除成功；不要求打开标签才能移除。
5. 单独打开目录/内文.md并选中，移除按钮可用；再加入父目录，树只保目录下该文件一次，原独立选择失效、目录root选中时移除禁用；单击其子文件后仍禁用，正文/标签保持。
6. 浅色截图及切换深色后的截图核新增按钮文字/禁用状态清晰，主区无异常遮挡；未测最小窗宽或所有主题组合。
7. 无未保存状态CmdQ正常退出，CUA报告App quit，session39862 exit0、PID28455消失；退出IMK stderr如实保留，不推断原因。三样本SHA均与基线一致，甲权限恢复644。

证据边界：真实dirty取消/放弃、clean/闭标签/readonly、命令/隐藏侧栏、根吸收及浅深最小路径通过。unknown/stale/lost reply/save竞态与重试可达以实际controller/service测试和真实页面结构组合，不冒真实WK断链注入；未改网络。自然IME、极端竞态、真实图片解码和最终离线不扩证；完整folder移除、父义务/FINAL001002/F047e/冻结stash与专项保持开放。最终独立证据复核及主线批准尚待，不预写Git成功。

## 最终有限验收结论

2026-10-17：最终独立Spec及Standards均0必要有限非离线验收阻断，两轴独立读取日志/版本并核三SHA、权限与进程消失，实际交互依据主线工具记录，非两轴另行GUI复演。主线批准上述standalone有限片受托Agent代验通过，非用户亲验；前述待复核为历史阶段。源码两次FINAL002真实红不隐去、不称已修复；完整父及上述未测边界继续保留。Git尚待实际执行。

Git收据：提交并推送`4e56f1ea6879d22c011f0374d7815da7c32e9e28`，HTTPS ls-remote核远端main与origin/main均同SHA；提交钩子前后tree`b3f168b38e7d6437cbed69c767a1da2c65cea0ca`一致，提交后工作树clean（本收据随后续文档提交）。命令级SSH443沿用已核HostKeyAlias，不改持久Git或网络配置。下一仅F061c目录根移除方案，未提前批准实现。

作者窄修后冻结检查：四新增文件14项/120断言通过，typecheck、受影响代码eslint、feature-docs/obligations及diff检查通过。未修改版本、构建或Git；等待独立最终复核及主线实际验收。
