# F-029a：欢迎页最近独立文件

## 非离线有限片正式通过（2026-10-15）

最终独立Spec与Standards均确认0必要代码/有限验收阻断，独立核日志、版本/hash、正文SHA/644与进程收尾；不冒称两lane重放了GUI。主线据上述复核正式批准alpha145受托Agent代验通过，非用户亲验。最小窄高度未实测作为明确限制保留，本片未改变窗口最小尺寸契约；完整父F029、OBL033/040余项及下方offline-final仍开放。Git待实际执行，未提前声称推送成功。

## alpha145 真实WK收尾候选（2026-10-15）

构建成功，hash `1a0ae0t4o6art`，直接解包副本 `/tmp/agentic-direct145.ZSsPSR/Agentic Markdown-canary.app`，避免安装完成窗口。源码全量1286/32612，包内Bun运行仓库测试1286/32613（188文件、27.58s，`/tmp/f029a-bundled145-tests.log`），断言差1保留不推因。既有chunk警告及hdiutil弃用警告不掩盖。代码自冻结构建后未变；仍待最终独立复核，尚未正式验收或Git。

真实GUI证据（受托Agent操作，不是用户亲验）：

1. 隔离数据根 `/tmp/agentic-f029a-ui.ibVuoX/data`。普通系统选择A、B、再A，两个标签不重复、内容clean；清空工作区后最近列表A/B，正常退出再启动仍A/B。退出前磁盘仅metadata字段，无正文。
2. 点击A“重新选择并打开”，原生picker起始目录为样本目录；Cancel后列表及两个accessedAt逐字不变。再次点A但选B，仅打开B，清空工作区后列表B/A，旧A没有被重定向。移除A、正常退出重启仅B；清空列表、再正常退出重启明确“暂无最近记录”。
3. 停止测试实例后，仅将上述测试metadata version改999。实际欢迎页显示“最近记录来自较新版本，当前不可修改”、清空禁用、普通打开保留；系统picker选择A仍正常打开134字节、clean，同时独立toast报记录不可修改。CmdQ正常退出。future文件前后SHA256同为 `0d8f573bbd266af73d592c6ad87ff8731b9e667a72c0b6c8db6d47be808fb8bd`；bak仅退出后测得hash，未测前值，故不声称本次GUI证明bak未变。只读目录/损坏/超限/FIFO等由生产测试覆盖，不冒称本次GUI逐项实操。
4. 另一个隔离数据根 `layout-data` 用apply_patch种入20条合法metadata指向不存在的历史样本；这是布局fixture，不是20次真实打开。默认2560×1600截图及zoom后3024×1720截图均见中文记录与底部普通打开入口，列表局部滚动到底可见第20项。点击该不存在记录仍只出现系统picker，Cancel回列表保留20项；Option-Tab实际焦点到第20项移除按钮，Return仅移除该项，剩19项。浅色截图中文名称/路径/按钮可读，之后恢复深色。窗口边缘拖动数次未改变尺寸，不推断原因，**最小/窄高度未实测**，不把zoom放大称缩小验收。
5. 各实例CmdQ正常结束，exec37162、27391、4313、61020、54184、99673均exit0；最后Bun42609的ps查询无结果。两正文从未编辑或保存，最终SHA与下面基线完全相同、权限均644。最近删除只移除隔离metadata，不删除任何正文文件。

保留工具时序失败：最初打开B时连续打开picker与GoTo输入太早，落入原生`/private/tftpboot/`，未打开文档；重新观察GoTo后setValue显式样本路径并确认才成功。此不推断产品根因。自然IME、精准在途时序、文件系统I/O时限/RSS、最小窗口矩阵未由此GUI证明，范围外完整根/树/组合恢复不关闭。

### F-029a-offline-final

按用户要求不执行断网。最终由用户集中确认无网络时普通选择、最近列表/重选/清除与重启；本次有限非离线验收不能关闭此项。

## 主线检查与构建中（2026-10-15）

冻结候选经独立 Spec / Standards 各27项/152断言复跑及代码复核，均0必要代码阻断。主线全量1286项/32612断言/188文件通过（29.35s，`/tmp/f029a-main-final-tests.log`），type/full lint、文档/义务/lock/diff检查通过。此前全量1285/32605为最后新增drain测试前收据，不替代本次。版本已递增alpha145，使用既有本地免签选项构建中，日志`/tmp/f029a-alpha145-build.log`；尚未真实WK验收，不得Git。

自建验收样本为`/tmp/agentic-f029a-ui.ibVuoX/alpha.md`（SHA256 `aebcef7e5c2969fcd62644e6264368f3a87bdaef2fd81d9b41a4ca45ee3dd098`）、`beta.markdown`（`6ba09c8a177c61671ed418d5db2ed33b1c3311a6573c634732baca7c7bff471b`），尚未用新版打开。下方作者待两轴/未改版本为历史，不覆盖本条。

> 状态：获批有限实现已完成，作者定向测试26项/146断言、typecheck与定向lint通过，冻结待两轴代码复核及主线构建/真实验收；未正式验收、未改版本、未构建/UI/Git。前轮F-048b已提交推送`fb56f2701fa785dbbfb487b5f5583a20e6903053`，主线核远端一致。

## 作者实现收据与保留边界（2026-10-15）

冻结后二次窄修：最近区域改局部`min-h-0` flex可收缩列表滚动、长名称换行，避免20项顶出普通打开入口；真实20项/窄高度仍待WK。取消picker采用契约null并断言ok/snapshot:null；新增真实DocumentService成功select同步投递→withWriteBarrier drain→新store重载记录，定向结果更新为27项/152断言通过。此前26/146为前一候选收据。snapshot read单独deferred仍未实操，不扩大该证据。

实际接线为strict opt-in settings store、20条最近记录及64队列、独立错误通知、显式select成功后同步投递、欢迎页列表与remove/clear、`createRecentReopener`经系统picker重新授权。查记录与目录提示stat在已登记select任务中完成，每段await后检查取消及select屏障代数，避免RPC外晚到lookup重开选择器。成功记录失败不阻断打开；warning保留到显式成功remove/clear，避免后来的无关成功记录掩盖曾丢失记录，非自动无限重试。

strict读取使用nonblock/nofollow descriptor且只接普通文件；坏UTF8、BOM JSON、坏外壳/entries、未来版本及超大内容拒写，不把坏数据normalize为空。BOM本片保守拒绝而非迁移；合法legacy精确保留原始UTF8字节备份。有限读取不是文件系统I/O时限保证。只读目录写失败保原及已有备份已真实临时目录回归。

定向命令：`bun test apps/desktop/src/bun/reopen-recent-file.test.ts apps/desktop/src/bun/recent-files.test.ts apps/desktop/src/bun/documents/recent-selection.test.ts packages/shared/src/server/settings-store-strict.test.ts packages/shared/src/server/settings-store.test.ts`，26 pass、0 fail、146断言；`bun run typecheck`及本片16个TS/TSX文件eslint `--max-warnings 0`通过。屏障deferred实证为authorize与recent lookup，未单独实证snapshot read暂停；实际picker/欢迎UI、退出drain及自然IME由后续WK验收负责，不能把这些单元测试当用户亲验。

保留作者中途红：reopen取消测试误用了targetRequestId，纠正为服务既定requestId；随后23 pass/1 fail因临时`/var`路径预期与真实canonical `/private/var`不符，改测试用realpath而非改生产；定向lint一条import顺序已修。早审所指出非法update被normalize清空、首次load写失败吞掉、FIFO、欢迎条件、lookup先于任务登记与初次RPC失败永久loading均已按原方案窄修，不改完整父范围。全量/最终两轴/真实WK未完成，本片不得提前Git。

<!-- obligations: OBL-033, OBL-040 -->
<!-- deferred-obligations: none -->

## 功能说明与边界

本轮交付可见闭环：用户通过系统选择器成功显式打开独立Markdown后记录最近项，欢迎页展示最近独立文件，支持逐项移除、全部清空；重启仍显示记录。点击条目明确提示需在系统选择器重新选择文件以授权，完成后沿现打开链路打开。取消选择不更改原条目或打开状态；选了另一个文件就按新显式选择打开并记录新文件，不擅自把旧条目改指向新路径。移除/清空仅删记录，不删磁盘文件、不关标签、不撤销正在使用的授权。

容量推荐固定20条，按成功显式选择时间倒序，后端canonical path相同即移至首位、去重后裁尾；相同时间保留明确最近操作顺序，不按mtime排序。记录不是稳定documentId、文件系统身份或权限；同一路径以后可能承载新文档。`.md`/`.markdown`及权限/安全规则沿现选择链路。普通激活、树打开、阅读链接及临时预览不在本片写最近记录，完整“真正激活的常驻文档”列表归F-062，不混淆两者。

不自动恢复根/树展开/窗口组合/标签，不启动目录遍历、stat所有历史路径、正文读取或watcher。窗口工作区组合最近项及M-14恢复保持父F-029后续；本片不是将既定组合能力删除。失效条目保留可移除的历史显示，用户选它时进行明确重新授权，不伪称启动时已验证可用。OBL-033仅承接独立文件记录存储/schema/失败边界，OBL-040仅欢迎独立文件最近项；二者完整义务保持开放。

## 已读依据与硬前置

- `CONTEXT.md`明确当前路径、documentId、平台身份分离；本片保存位置记录不是恢复逻辑文档身份。
- 总账W-04/基础结论313规定限量最近组合和独立文件、metadata-only、按需重授权与逐项/全部清除；M-14规定根集合/树状态/缺失占位，后续承接。规格F-029与义务登记OBL-033/040为主依据。
- `packages/shared/src/server/settings-store.ts`具同path串行队列、version1 envelope、legacy迁移、精确旧字节`.bak`先提交、同目录临时文件fsync+rename；未来版本/损坏文件update拒绝。load对未知版本返回normalize(undefined)，不能因此向用户声称有效空记录。没有目录fsync或全量备份自动恢复承诺。
- `bun/documents/index.ts:select`经picker→authorize→snapshot→commit→注册grant；这是真实可信路径源，renderer displayPath不能反向授权。`path-authorization.ts`校验显式选择路径与祖先、指纹及fd，内存handle/descriptor不可跨重启持久化。
- `native-files/index.ts`公开dialog具startingFolder，但当前pickFile无参数且无安全书签恢复接口。当前最近记录直接调用authorizeSingleFile(磁盘旧路径)虽技术可读，并不证明跨重启授权契约成立，**本片不选这条捷径**。最小体验改进可由后端已存路径的dirname作为选择器起始目录提示；它只是定位、不授权，目录不存在/不被dialog接受则回普通选择器，不扫描父链寻找替代，不自动选择文件。不引入新原生桥/bookmark系统。
- 硬前置：F-008a设置存储、F-009欢迎页、F-004a/F-011显式选择与去重、F-025来源区分已可用。本片不需要F-037/F-066跨重启正文或F-062 Quick Open完成。

## 最小技术方案

1. **独立持久层**：App数据区`recent-files.json`，独立version1数据`{ entries: [{ id, kind: "file", path, name, accessedAt }] }`；id仅为不透明记录ID，不是授权或documentId。只由后端成功授权结果产生规范路径及展示名。限制20条、字段类型/长度/绝对路径/NUL/后缀/有限非负时间、id唯一及path唯一；不存正文、目录清单、句柄、指纹或选区。整文件按已知容量/字段最大长度推导有限读取上界，不能先无界readFile再检查。明确本文件首次创建格式；不发明未存在历史格式迁移。若采用store已有legacy兼容，仅同本片合法data形状迁移，幂等且保留旧字节备份。
2. **损坏与未来版本**：窄adapter先识别文件格式并明确错误，不把未知版本静默表现为合法空列表；写入继续沿现串行/备份原子提交。损坏/未来版本禁止新增、移除、清空覆写；UI中文说明最近记录不可用，普通打开仍可用。无自动删除、重置、从备份擅自覆盖。adapter与store的读写顺序须同一个本片队列，避免检查后另写覆盖；若现store接口不能保留明确状态与有限读取，实施时最小新增公开诊断/有限读取选项，不改其他设置消费者语义。
3. **记录时点与失败隔离**：DocumentService新增可注入的可信`onStandaloneSelected`结果通知，仅成功显式选择并commit、未被已知取消/销毁淘汰后触发；不因select开始、picker取消、授权/读取失败记录。不将其解释为renderer已激活，迟到已提交回执保持原授权规则。持久写入失败不能把已成功打开变成打开失败或回滚grant；独立返回/发布最近存储失败状态，不暴露OS错误路径。最近写入排队有界且按操作顺序，退出与clear必须按同队列顺序处理，避免clear后旧后台回执又加入；不创建无限重试。
4. **RPC/命令**：新增明确`list/remove/clear/reopen`意图，renderer只传requestId和记录id（clear无路径）。后端运行时严格验schema、在权威存储按id取记录；reopen只打开系统选择器，不以id直接读取旧文件。复用DocumentService选择任务busy/cancel/epoch保护；起始目录可通过后端可选picker参数传递，renderer不可任意传路径。选择成功仍走现canonical path→documentId去重/dirty/模式保留规则，不由最近模块另开第二文档模型。
5. **欢迎页**：普通“打开文件/文件夹”入口保持，最近列表中文名称与可区分路径、键盘可达“重新选择并打开”、独立移除和清空。点击前文本明确需系统重授权，不使用户误认直接恢复。只在欢迎/该消费挂载时load元数据，不读取历史文件；mutation await持久成功再刷新，失败不假删，旧请求不得覆盖较新清空/卸载状态。不增加每键或每selection存储操作。

## 实现前需收敛的技术风险

- 现settings-store `load()`缺错误状态及大小上界，直接复用不能满足未来版本中文反馈；需最小明确状态/限读适配，保所有旧store测试，不“默认normalize为空”吞错。
- 最近reopen与普通select要共用同一busy/取消任务，不在RPC层另开picker后绕现授权；明确父目录默认参数失效时不会弹两次选择器或将取消误判错误。
- 真正持久化授权恢复尚无现成能力。本片显式重选是安全可执行路径，但操作较多；不能宣称自动恢复已实现，也不偷偷持久指纹/handle作为权限。
- 固定20为本片推荐参数、非性能SLO。未来组合条目配额/去重不在本片预留具名workspace schema，届时独立版本迁移。

### 重开授权路线比较（供主线收敛）

**主线收敛结论优先于下方调查候选**：G-03决策（总账1459）明确跨重启经平台授权恢复后重签handle。本片没有平台持久授权恢复能力，因此采用A系统picker，文案“重新选择并打开”，不实现B旧路径直接authorize；后者技术可读不满足该授权规则。另选文件仅记录新项，旧项不重定向/删除；取消和失败不更新。初始目录仅用现SDK已支持的startingFolder，不支持则保持普通picker，不加native bridge/bookmark。合法version/data外壳内坏entries同样显式不可用/拒写，不能normalize过滤坏项后覆盖。下段是先前未定位G-03时的调查推论，保留历史但其B推荐已被本结论否决。

已核F-004a第14/21/43行：旧切片只授予系统选择器所选文件，明确**不实现**跨重启身份/平台持久授权；链接改向后重选才取得新目标。这是当时范围与现有grant保护，未找到“一切未来最近项必须每次picker”的全产品永久规则。W-04反而说失效时按需重授权，因此不能把默认每次picker写成既定产品要求。

方案A（上文保守基线）每次重选：复用已有可信选择闭环、权限论证最小，但“最近打开”实际两次选择，用户体验明显更差。方案B后端根据记录ID取得其自己持久保存的canonical绝对路径，在用户明确点击后重新执行现`authorizeSingleFile`与snapshot，产生全新grant而非恢复旧handle；成功则直接打开，失败才提示系统重选/移除。B不接renderer路径、不自动启动读取，不复用旧inode/documentId，也不能通过路径记录继承旧链接入口改向授权；仅规范目标路径重新校验祖先/fd/普通文件。本App当前非平台沙箱下技术可行，现authorize本身不强制picker来源。**推荐主线优先评估B**是否可作为本片新明确“按记录显式打开”授权入口，体验更符合按需重授权；这不是声称旧切片已提供该入口。持久文件被修改/外部替换及路径别名的威胁边界必须在实施方案明确，若将持久记录视为不可信则仍需picker或额外持久授权能力，不靠JSON schema验证冒充来源认证。本文尚未将B批准为实施路线，上文A为可运行保守备选，不擅自添加平台书签或鉴权框架。

方案阶段只获准修改本唯一文档，尚未为OBL-033/040写登记表反向链接。因此`check:feature-docs`目录同步检查通过，而`check:obligations`当前按设计报“claim missing reciprocal register link OBL-033”；不伪称全绿、不为消除检查擅改义务登记或把应承接义务写none。主线批准承接时同步两条登记即可再核。

## 最小happy path与异常验证

实现后正式测试：成功显式选择A/B/重复A排序去重；第21条裁尾；取消/失败不记录；读取最近不stat/read历史文件；metadata schema/legacy合法迁移/精确备份/未来拒绝/损坏拒绝/超大有限拒绝；并发记录与remove/clear线性顺序、写盘失败打开仍成功、旧回执/销毁；恶意renderer路径字段拒绝、id不存在不打开选择器；移除/清空不关闭grant或改文件。

真实WK：选择两个自建样本→退出重启为空工作区时查看持久最近列表→点击条目有明确重选提示与系统dialog→取消无变化→重选成功打开→原文/dirty/历史不受记录影响；逐项/全部清除重启验证；暂移自建文件后不启动扫描、重选取消仍保留条目；只读App记录路径故障独立提示，普通文档打开不被记录失败阻断。欢迎条件为无roots、entries、tabs，单纯关闭标签不会清独立文件树叶子，不应出现最近欢迎页。浅深主题/键盘导航与现原生选择器正常退出回归；离线验证登记`F-029a-offline-final`留最终人工，不改网络。

继承检查：**F-002 原文与离线**只存metadata且不改正文、不联网；**中文与外观**中文最近项/错误与现主题；**命令与键盘**可达列表按钮并沿现打开命令/退出保护；**安全与日志**记录不授权、不接受renderer路径、不记正文或OS详细路径日志。F-005取消/任务边界、F-008独立存储/版本/备份及失败隔离沿用。完整父、OBL-033/040余项、F-028c/其他专项与offline-final仍开放。未批准实现前不升级alpha或Git。

## 收敛typed实施候选（待主线全文批准）

1. **共享store向后兼容选项**：在`packages/shared/src/server/settings-store.ts`增加opt-in第三参数，例如`{ maxBytes, validateData }`及`inspectState(): Promise<Available<T> | Unavailable>`，不可用原因固定枚举`future/corrupt/too-large/io`，不返回原文或OS错误。旧调用默认行为不变。严格消费者的load/update/inspectState在现同path队列内共同调用同一inspect；version1外壳与全部entries必须整体验证，legacy仅合法同结构迁移，future/corrupt/oversize拒写。不能另建check-then-update的竞态窗口。文件先open descriptor，分段最多读`maxBytes+1`，据多出的1字节识别超限，不依赖单次stat后无界readFile；同descriptor读取原字节用于精确backup。文件不存在为合法空，读/迁移写失败明确区分，不把future或坏数据称空列表。
2. **容量计算与内存边界**：20条；每项path最多4096 UTF-16 units、name最多4096 units、UUID id固定36、kind固定file、accessedAt安全非负整数。生成JSON最坏每UTF-16 unit六个ASCII转义字节，使用`20 * ((4096 + 4096 + 36 + 4) * 6 + 256) + 4096 = 997056 bytes`作为独立文件最大读取预算（包含字段/标点/时间/pretty缩进和envelope余量）；不是普通Markdown文件上限或SLO。实际持久序列化还应核输出≤该值。大于预算即不可用/拒写，不在后台读取其剩余内容。UTF-8非转义字符最多4字节/codepoint，不超过六字节/unit保守界；未经本store生成的额外任意空白也受此文件预算约束，不宣称可接收无限pretty空白JSON。
3. **最近store接口与线性点**：新增Bun `recent-files`模块，`list()`返回固定schema的available/unavailable、`recordSelected(metadata)`、`remove(id)`、`clear()`、`drain()`。record/remove/clear被调用时同步进入同一个FIFO，enqueue就是操作线性顺序，不等await前置磁盘读才入队。clear删除其前已commit投递的记录；仍停在picker/read的选择若之后成功commit可新增，**不加generation把合法后来成功打开吞掉**。容量最多64个待处理变更含正在执行，理由是20条可见列表的快速移除/重复选择留有限余量、单picker使通常record稀疏；这是内部背压候选，不是用户操作承诺。满载不阻塞文档打开：record拒绝并发布独立`queue-full`，remove/clear返回明确失败且UI保留原列表。队列记录仅不可变metadata与短操作，不保存正文；失败一项后后续继续，无无限retry。重复通知可合并状态但不合并或重排不同操作。
4. **DocumentService成功路径接线**：`bun/documents/index.ts`配置新增可选`onStandaloneSelected: (metadata: Readonly<...>) => void | Promise<void>`，仅select完成`commit`与`grants.set`后，以已授权candidate.path、后端basename及服务端时间生成不可变metadata，同步调用投递；捕获同步throw并catch异步rejection，绝不await存储、不把成功snapshot变failure。选择取消/授权失败/commit前取消不投递。回调失败由独立最近状态通知，禁用原路径OS日志。`start-desktop-app.ts`创建recent store并注入回调；退出writeBarrier建立后等待`drain()`，让已成功commit通知进入队列；存储错误已结算不永久veto退出、不重试到无限，仍等待真实正在写的有界队列而不谎称取消I/O。既有stop/update/reload路径共享同一drain挂点，不能只关主窗口处理而更新遗漏。
5. **RPC与重新授权**：`shared`新增runtime schema，list/remove/clear只接受固定字段；reopen请求仅记录id，后端从合法store取其dirname作提示，然后调用与普通select同一个任务入口（可选可信backend-only picker起始参数），系统实际返回的路径再完整authorize。`native-files`的pickFile可选startingFolder仅后端传，引用现SDK公开字段；取消直接结束，普通异常返回原打开失败，不盲目再弹一次picker。起始目录预先不可用若要回默认，仅局部检查指定目录并在**首次**弹出前决定，无父链遍历、无任何最近文件自动读取。请求存在记录但用户另选B只打开/记录B，A不改指向；记录丢失/非法/不可用时不自动授权。保持DocumentService的busy、writeBarrier、取消和grant adoption，不在RPC外自行建选择任务。
6. **前端与状态**：最近API在欢迎页加载一次、mutation成功后刷新；请求号/卸载守卫防晚到覆盖。新增正常选择成功后的最近错误状态可通过既有UI通知路径显示，不将数据复制进文档状态。列表中文“重新选择并打开”、移除、清空与浅深/键盘均可用；future/corrupt/too-large/io显式不可用，普通打开入口保留；只读数据区不假删记录。测试须以真实store注入故障和DocumentService seam证明“commit先、投递同步、IO不await、clear顺序、queue-full独立、writeBarrier后drain与退出”，而非只测纯排序。

上述具体收敛替代此前“clear后旧回执不再加入”的模糊表述：按成功commit与enqueue先后区分已提交历史与后来成功选择，不把仍在进行的真实用户打开当旧回执丢弃。尚未实现；共享store opt-in不得影响现设置消费者，最终全量回归、独立复核及真实WK仍由主线统一推进。

### 写屏障收敛补充（实施前必要前提）

主线实际核代码：现`withWriteBarrier`只在select入口阻止新任务，在途select的`checkTask/commit`不检查屏障。因此“屏障后drain自然不再新增record”此前前提不成立，不能仅接drain就宣称退出安全。最小改动限定在**显式select**：`snapshot`成功之后、`commit`之前，同步再次检查`writeBarrier`；若屏障有效返回`BUSY`，不commit、不`grants.set`、不投递最近metadata，沿既有finally关闭candidate。检查与commit之间不得插入await。不要修改所有read或通用commit、不要把屏障视为全局取消，也不改变已完成commit与排队record的顺序。

真实DocumentService回归必须使authorize/read通过deferred Promise暂停：开始select→进入屏障→释放authorize/read→确认BUSY、candidate关闭、无grant提交/最近通知→drain结束；另一顺序先commit通知再进屏障，确认drain确实包含该已入队记录。取消退出释放屏障后新select应再次成功，先前被拒绝选择不自动重放、不自动再弹picker。stop/update/reload必须沿已确认屏障边界与同一drain接线。此条仅方案补充，仍待两轴复核及主线生产批准。

### 单调屏障代数修正与生产批准

两独立轴指出仅boolean会漏过旧select跨越完整屏障后才commit。主线批准采用select专用单调barrier generation，不改通用epoch：select入口捕获代数，withWriteBarrier成功建立时递增，snapshot后commit前同步检查当前barrier或捕获代数不同，任一成立即BUSY并finally关闭candidate，不commit/record；屏障释放后的新select捕获新代可正常执行。新增在屏障内恢复与屏障已释放后才恢复deferred两种真实回归。此规则替代上节仅boolean检查，不更改其他read或自动重放。

主线已批准按typed六点及本条有限生产实现与实现后测试；仅本片必要store opt-in/API/client/UI/tests，版本/build/AGENTS/Git与手册登记由主线统一，基线`fb56f270`。尚未实现验收，不扩根/组合恢复、平台书签或新原生桥。
