# F-061c：目录根从窗口移除

> 状态：alpha175 有限非离线受托Agent代验通过，非用户亲验；独立最终两轴0项必要阻断，主线批准；Git待执行

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## 功能与完整有限范围

承接总账第333条及W-26的单个folder root移除。只解除当前窗口会话/授权引用，不删除、移动、保存或改写Markdown及用户目录。真实选择顶层目录后，按钮和统一命令进入同一流程；子目录不是根移除目标，不以当前标签替代树选择，不新增默认快捷键。

列出仅由该根覆盖的已打开文档，提供“保留为独立文件”“关闭这些文档”和取消。前者保留handle/documentId、正文、dirty、模式、选区、undo及标签位置；后者沿正常脏文档/外部变化保护，取消则整个操作不发生。无独占打开文档时只确认移除根，不显示虚假的文档选择。被其他根真实覆盖的文档不关闭、不变身份，迁移至剩余归属。清单明确标注原显式standalone与root-only区别：选择关闭时，原显式standalone只关闭标签，保留其entry/grant并重新显露顶层项；root-only则关闭标签并撤entry/grant。原有显式独立授权不会因树暂时覆盖就丢失。

工程推荐默认：一次“保留/关闭”选择作用于所列全部独占打开文档，不增加逐文件混合选择；推荐保留、关闭是明确次选，取消无副作用。这是本片待审的工程默认，不称用户已逐项亲定。即使有打开/dirty文档也必须提供两条完整路径，不降级为空根或无打开文档才可移除。

最近文件历史保留；移除后原根隐藏文件设置删除，其他根设置不动。目录监听、扫描候选、树缓存和根独有派生授权增量清理；尚不存在的索引消费者只保留后续接入责任。跨重启恢复、批量根操作、阅读子窗口均非本片。

## 已读取的实际本地接口

- `docs/product-capability-register.md`第333条、W-26；`mvp-product-spec.md` F-061；F-061b已验收及收据逻辑。
- `bun/workspace/index.ts`：Root含authorization/files/byPath/scopes/live/generation。Owner.root可变，已有父目录吸收时迁移owner的先例；根集合主动吸收父子重叠，普通嵌套根不能假设同时存在。`invalidate(root)`取消manualCandidates、automatic observation、reconciliation并清缓存/安排worker cleanup；`removeAll()`清全部根，不可当单根入口。
- `bun/workspace/authorization.ts`：`authorizeEntry/verifyRoot/visiblePath`结合真实目录链与文件fingerprint；`byPath`未发现不代表未覆盖，partial/scanning尤其不能当负证据。
- `bun/documents/index.ts`：`locations()`只有handle/path/fingerprint/documentId；Grant内部另有scope、explicitStandalone、单文件授权链、identityKey。`openAuthorized()`创建新handle并读快照，不适合保身份迁移；`revokeScope()`会删grant及观察/candidate/mirror/watch，必须先迁出保留grant。`setAssetScope()`更新assetEpoch；workspace的`syncAssets()`跳过已有assetOwners，必须显式迁移/清旧映射。
- `bun/documents/path-authorization.ts`：每grant已有selectedPath/selectedParent/path/fingerprint/directories；可验证已有能力，不得重新授权替换文件。解除根依赖不必重新选择或重读正文。
- `client/documents.ts`的`protect/waitForSaves`和独立pending-removal gate；`client/workspace.ts`另有串行tail、epoch及独立publish。两个store不能先后公开半结果；React批处理本身不保证两个外部store订阅者的一致性。
- `bun/workspace/preferences.ts`仅get/set，按canonical path hash持久化。`packages/shared/src/server/settings-store.ts`的update按绝对路径队列串行，写临时文件/sync/rename，finally清临时文件；rename后清理失败仍可能reject，故reject不能等同设置未写。`load/inspectState`会迁移或补写，不是纯只读提交查询。不能吞错误或用get=false冒“键已删除”。

## 最小技术方案

### 1. 单槽可信计划与冻结

新建仅目录移除命名空间的单个未ack槽，沿F061b的随机session、单调sequence/highwater、防重放和query/ack语义，不把两类操作互相伪装。两种移除共享窗口互斥可用性，不同时进行。槽只存有界授权/元数据及计划，不存正文；预算计入现有workspace cache预算，超过则准备前明确拒绝，不能只留部分文档。

前端捕获真实root handle/generation及当前打开文档opaque handle/documentId清单；后端自行把清单映射到真实grant，任何无效、重复、遗漏已登记活动身份或代数变化拒绝。前端清单只表示哪些文档需用户保护，不能授权文件或自报归属。准备前排空保存并持有独立窗口gate，阻止编辑、切标签/关闭、根添加/隐藏/重扫/打开文件等改变集合的操作；未知结果仍冻结，主区域提供始终可达重试入口。

后端同样持有计划级mutation fence，具体接口与顺序如下，不复用会在callback finally释放的`withWriteBarrier`来假装跨RPC持锁：

1. workspace新增`acquireFolderRemovalLease(root,generation)`内部单槽，先置admission标志；若已有picker/selecting、openingRoots非空、手动rescan未定或隐藏preference操作未结束，立即BUSY并释放，不等待用户picker/未知操作，不改已在途行为。preferenceTail新增计数，所有enqueue前同步登记，finally减少；只有计数0才进入本片。入口标志阻止新select/open/hidden/rescan/accept/clear/reveal/default及另一移除，不能仅挡UI按钮。
2. workspace drain增加park请求及`whenParked()`：停止安排下一scan/reconciliation/observation step，允许已经await的单个step在原身份下完成并回到安全循环边界，然后resolve；不等待整棵树扫描。特别是worker.next已消费的批次，须完成原有merge及status更新后才能park，不能丢弃批次却保留前移游标。已有step期间prepare尚未生成计划，merge及reconciliation.publish仍只提交原代数；park成功后这两个发布点再显式拒绝非lease所有者，wake不会越过park。若旧step失败，按旧路径收口后重新核root；若尚未结束，acquire保持pending，不将超时冒成功。cleanup同样留在停泊前或终态后，不在锁内另等drain总循环。
3. 停泊后调用documents新增`acquireFolderMutationLease()`：若running/pending/selecting/revealing存在，直接BUSY并恢复workspace，不强等或取消这些任务；否则同步占用独立lease槽、置现有写阻入条件，再await已登记saveTail与acceptance.settled。新read/open/select/save/accept以及capability刷新等可改grant的入口均核lease；受信owner的计划验证不走被禁公共入口。既有save/accept只依赖文件验证，不等待workspace drain，因而此顺序不形成互等。后台观察/candidate消费者暂停启动，既有结果按lease代数拒绝变更；图片旧结果按assetEpoch/current核对，不修改grant。
4. 两个lease都是服务端对象，带不可伪造owner、active检查及幂等release；移除单槽保存对象，settings-pending/query返回后不release。仅准备取消/明确rejected、committed同步收口或进程dispose释放，不能放在每次RPC finally。state/page在持lease时明确调用`state(id,false)`，禁止默认syncAssets→bindAssets→setAssetScope暗改epoch；query只读槽。恢复时按顺序释放document lease再解除workspace park并wake；失败申请同样收回已获部分lease，未发设置写前可安全拒绝。

此处是具体待实现接口，不声称现有代码已有上述阻入。实现时对所有列出的入口和publish点作覆盖断言；不得通过无限等待整个树或放宽旧guard达成。

### 2. 归属证明：正向覆盖或可靠不覆盖

后端按实际grant集合生成四类计划：保留现有独立授权、迁移至剩余根、独占打开需保留/关闭、独占且无打开引用可撤销。同path但fingerprint不同不是同文档；硬链接不按inode合并不同canonical location。

对剩余根先用canonical包含/隐藏规则排除不可能覆盖；可能覆盖时使用既有授权根+真实目录链+文件fingerprint进行按需正向验证，不以partial/scanning的Map缺失得出独占。若当前接口不能证明负向结果，返回需重试的未就绪，不暗选关闭/独立化。不能为了消除未知而扫描整个磁盘。普通已规范化根集往往可直接证明不重叠，仍保留并测试真实剩余归属分支。

计划绑定根对象/generation、全部受影响grant对象/identityKey及documentId、剩余owner身份和设置快照；异步验证后重新核，准备过程中变化整次拒绝。关闭路径只对列出的文档调用现有保护；保留路径不触dirty正文和undo。用户取消发生在提交前，释放计划/fence，不撤授权或改设置。

### 3. 原地批量授权处理与资产

新增Bun内部受信批量提交接口，不接renderer path。保留独占文档：基于已有验证过的单文件能力移除scope、标explicitStandalone，保持handle/documentId/identityKey/revision/mirror；不调用openAuthorized或authorizeSingleFile重新采信路径。迁移文档改绑定至剩余可信owner，保持身份与正文。不应把原独立grant强降为root-only。

关闭及无人引用的旧root-only grant才撤权并清观察、acceptance、candidate、mirror、watch和相关任务。所有保留/迁移grant先从原scope脱离，再撤旧scope，避免被revokeScope误删。关闭/撤引用只核内存root/grant/文档绑定与用户保护批准，不要求磁盘仍存在或身份未变；因此缺失、替换、不可读的文件仍可选择关闭后移除根。保留/迁移才要求旧身份验证，失败时保留原内存并明确可改选关闭，不能升级为新路径授权。已独立grant维持旧能力及现有失效策略，不为移除根刷新身份。

资产单独处理：旧root.assetOwners必须删除或迁至剩余根；独立化恢复单文件相对资产范围，递增assetEpoch使旧宽范围请求/缓存失效；保持其他grant不变。旧请求最终回执重查grant和assetEpoch，不能带回被移除根的图片能力。

### 4. 设置删除作为唯一持久提交点，不做无限补偿

推荐最轻的具体路径：所有授权变更、UI提交描述及必要容器分配先准备好，在mutation fence内串行执行这个根的隐藏设置键删除；确认持久结果后，仅做无await的内存批量提交及terminal收据。设置写入前可取消/明确拒绝；发起写入后不再接受取消或重新规划，以免出现设置已删但计划被主动撤回。

`HiddenPreferences`增加仅此用途的删除与纯只读核对接口。继续用现有store.update保证同路径写队列，但读取必须先完整验证原始schema，不能调用当前normalize过滤后再比较。store增加最小`readPersisted()`：同一绝对路径enqueue串行、O_NOFOLLOW有界读取、不迁移/补写/备份，返回missing、valid(raw)、corrupt、future、too-large、io；保留原始合法envelope种类。隐藏设置使用现有workspace元数据预算为上限（读取上限+1），超过在写前拒绝，不能无界读或截断后解析。合法仅精确version1/data envelope或现支持的legacy map，每个键均64位hex且值boolean，任何额外字段、非法键值、数组或未知版本均不投影成空map；重复JSON key检测及精确schema由该只读接口验证测试，不能被JSON.parse覆盖后冒完整验证。

删除入口先严格读取并验证old，再在store同一路径写队列内完成old一致性复核、update删除和结果分类，避免prepare读与实际update间插入其他写；回调捕获原始有效map与删除后的expected，所有其他键原样。需要最小store内部组合方法实现同队列单操作，不能enqueue里再await公共update产生自锁。实际写入继续调用现有内部commit，不另写一套原子文件替换。legacy写后按现有version1规范，比较合法内容与预期envelope，不用宽松normalize掩盖差异。根隐藏写入和remove共享preferenceTail与fence；外部进程写入不受本实例锁保护，发现第三态保持unknown，不补偿覆盖外部值。

- 键原已不存在：没有持久变化，直接走已准备的内存提交。
- update确认成功，或异常后一次严格只读核对完整map等于expected：设置删除已确定，完成原计划内存提交并登记committed，不能再报rejected或重新授权。
- update异常且核对严格合法主文件等于old：明确未完成删除，登记rejected，保持全部原根/文档；备份文件的更新不冒主设置变化。写前missing且无键需删可直接提交；原有主文件写后变missing不能当expected空map，进入unknown。
- 读取失败、损坏、第三种map或结果不明：状态为settings-pending/unknown，保留槽/fence及全部内存，不驱逐、不自动补偿、不无限循环。每次用户重试仅执行一次只读核对；未确定前不再次写设置，不回退成可编辑成功状态。主区域入口始终可达。

这是单进程内有限提交协议，不承诺断电/进程崩溃跨内存与文件原子性。终态收据及内存提交必须在确认后同步建立；停止watcher等可异步资源释放用已fenced任务继续完成并报告，不能使旧授权复活。必须保证最终同步步骤不含可预期失败或外部I/O；若发现仍存在可失败步骤，应先移至prepare，不能靠catch吞掉一半提交。此设计的实现可行性、只读inspect的API及queue内异常分类仍需两轴确认，未以文字冒实验证据。

### 5. 前端一致发布

后端committed返回有界结果描述：root移除、保留/迁移的原handle及provenance更新、需关闭的handle集合、资产epoch与根代数；不返整篇正文。客户端先验证整个响应和原绑定，再在同一同步提交方法中更新folders与documents两store的内部snapshot，最后才通知任一订阅者。两个setter需支持prepare/commit-notify分离或owner级单一批量边界；不能连续调用公共closeTab/clear或仅依赖React batch。

具体接口为两store各自的`prepareFolderRemoval(result): Prepared`（校验/分配/无通知）、`swapPrepared(prepared): void`（只赋已备snapshot及Map引用，无外部调用）、`flushPreparedEffects(prepared)`（两swap后副作用及通知）。owner持有不可重入batch，先两prepare全部成功、再两swap、最后effects/notify；不调用现有publish。documents现publish的viewport capture、pause/resume parser生成新EditorState属于prepare，capture发生在旧DOM仍在时；所有可能throw的事务构造/响应校验/后继选择先完成，失败保原内存并保可查询状态。已有编辑器不重新生成或补读正文；只对按旧语义必须改变活跃状态的两个slot生成准备态。

移除开始时folders新增publication epoch fence与refresh暂停，旧tail任务、page/final state回执和enqueue.catch/finally发布均核捕获epoch，不能在最后refresh回来覆盖终态或解除busy。终态swap后释放暂停才安排新refresh，不在prepare重新请求全量树。documents观察同步、candidate取消、parser相关宿主副作用及listeners在两store已swap后运行；单个effect/listener异常单独记录固定错误，继续必要通知，不回滚已确定后端结果、不阻断另一store通知。所有观察者第一次收到通知时两store均已终态；正文controller批量关闭一次选择后继，不逐标签publish。保留dirty/undo、标签顺序及折叠；rootOrder只reconcile去旧根、新独立根追加（工程默认）。ack失败不回滚已确认UI，仅禁用新移除；query未知保持内存/gate。JS进程崩溃或OOM不宣称可恢复原子性。

## 实现后验证与最小happy path

不采用TDD，方案批准后实现再测，不预设性能门禁。

1. 两个打开文件（含后台dirty）+已关闭标签的root-only grant：保留路径身份/EditorState/undo原对象保持，关根后顶层独立项出现；关闭路径取消零副作用，确认只关闭所列目标；磁盘SHA不变。
2. 原显式独立文件被树覆盖、隐藏独立例外、真实剩余根覆盖/身份不符、partial缺失未知：正确分类，不误撤原独立授权，不把未知当独占；保留/迁移后真实read/save授权与资产范围检查。
3. root/scoped open、save、refresh acceptance、扫描/观察在途与迟到回执；计划前后代数变化；原candidate/图片旧token及宽root资产失效，其他根及文件正常。
4. 设置删除成功、写前失败、rename后报错+expected读回、old读回、读取失败/第三态、同operation重试/ack重放；每次重试有界，无部分移除/无限补偿。注入故障必须落真实设置服务调用边界，不用单布尔代替持久协议。
5. 两store订阅每次观察一致，未知期间编辑/保存/退出/改根都被gate挡；隐藏侧栏仍可主区域重试。关闭多个文档只一次终态发布，其他文档原样。

实际WK使用自建目录/独立文档：两选择、取消、dirty保留/关闭、只读、目录按钮与统一命令、重新打开、最近历史保留、根设置重新加入后默认值、侧栏隐藏恢复、浅深主题和正常CmdQ。真实剩余归属若UI正常化不可构造，明确限定自动service证据，不伪造UI验收。无需打开/改用户未保存窗口。

## 继承与未决边界

继承F-002：本地文件/离线边界不变；`F-061c-offline-final`只记录留最终人工，不断网。中文与外观：文档清单及保留/关闭/失败提示中文、浅深清晰；命令与键盘：真实选择、按钮与统一入口共用资格、取消与恢复可达；安全与日志：opaque能力、固定错误、不记录正文或扩大路径权限。

本方案初审三类必要缺口已显式收敛：失效文件关闭不依赖磁盘验证、原独立授权关闭只关tab；后端跨query lease/扫描安全边界停泊及state禁syncAssets；严格持久schema/错误分类及两store prepare/swap/effects。以上接口尚未实现和运行，仍须主线及两轴对具体接点确认，不因文档写出而自批准；未知点转实施后的故障注入和真实验收责任，不撤销333/W26或新增产品专项。预算沿既有workspace限制，不定任意性能目标。

完整OBL-007仍由F-025主责，本片协作实现根撤销，真实卷语义、后续索引消费者不自动完成。OBL-033/040恢复、OBL-061/F-075键盘汇合、F047e、FINAL001/002、阅读子窗、冻结stash、专项/F028c及最终离线保持开放。F061b/alpha174已验已推；本片已获批有限实施，未改依赖/版本/构建/Git，尚未验收。

## 实施中证据（非验收）

后端已实现专用folder mutation lease、单槽prepare/commit/query/cancel/ack、严格设置删除收据及内存批量提交。原standalone ledger保原函数调用接口、增加只读busy，任何未ack槽均阻止folder prepare；反向由folder admission和document lease阻止standalone begin。设置`updateObserved`成功返回明确confirmed；仅写异常读回，保legacy/version1格式及完整map，终态锁存。重叠query共享单个读Promise，读后再核unknown，不能后到读回翻转已确定终态。

作者定向：新folder workspace、preferences、document lease及既有standalone ledger四文件15通过/0失败/134断言；全项目typecheck通过。设置旧新四文件曾22通过/142断言，Standards独立复跑相同；后续query共Promise窄修待独立复核。主线前端首轮9通过/58断言，随后前端作者28通过/177断言，属于自动controller证据，非真实WK。

首失败保留：最初settings patch命中interface导致TS1128/1005/1109；prepared数组implicit-any、ledger局部slot类型收窄never及validator回调narrowing错误均修正；首lint16项修后通过。workspace初测把设置key写为`/var`，授权实际canonical为`/private/var`，调整测试读取真实root.displayPath，未改生产路径。尝试两个重叠根迁移用例首跑14通过/1失败/129断言：合法select父目录会吸收子根，不能构造两个重叠顶层根。该错误前提不冒生产红；改为测试父目录吸收后旧root prepare拒绝且原grant身份仍可读取，未声称移除时跨根迁移已实测。

前端作者回传首红：新folder-removal测试首跑6例，5通过/1失败/47断言，keep双store用例在dispose清空期间仍订阅并断言a entry存在而得到undefined，旧refresh catch也触发同一越界断言。修为验收断言结束先unsubscribe，再dispose两store；不是生产缺陷或放宽业务oracle。随后新6+standalone6+workspace5共17通过/110断言，扩至新9并联组件恢复/commands五文件28通过/177断言。另发现订阅内expect可能被生产要求的listener异常隔离吞掉，改回调只采样、await后外部断言，仍28通过/177断言。首eslint9项为测试async无await/empty mocks，修为Promise.resolve或明确异步时序，最终type/lint/diff为0；不冒GUI验收证据。

已实际注入：主设置rename完成后临时文件清理抛错，expected读回committed；第三方legacy同map或missing读回unknown，随后恢复expected经query收口；真实backup目标为目录造成写前失败、原map保留rejected。设置终态后其他写入不逆转收据。两个query共享同一在途Promise，先await第二、随后改变设置再await第一仍同终态；没有伪称两次读反序，因为实现合并为一次实际读。

尚需补证/复核：扫描在途批次停泊/恢复不漏页、真实save排空、旧图片token与cleanup异常接点，完整协议及前后端总复核、全量检查和真实WK。当前固定用例只证明已列路径；未完成项不转为通过。既有FINAL002完整保留，不因定向绿称已修复。

### 独立早审后的必要窄补

Standards发现在途probe/capability和已生成candidate可能跨短暂lease后复活，已用既有单调selectBarrierGeneration持久拒绝旧回执，并在受影响grant提交时释放candidate/acceptance；不取消原grant身份或正文。probe的live同时核writeBarrier，capability的准入/迟到均核folder lease及代数。旧candidate未在lease期间访问，释放后仍失效，随后新candidate可正常取得。

prepare现复核lease捕获的既有observations活动登记：任何已登记active未列入全部打开文档清单，操作安全拒绝。没有新增活动登记通道，也不声称未登记可证明已关闭；实际前端仍发送全tabs。已关闭tab但unsubscribe尚在途可能暂时拒绝，送达后ack并以新operation重试可恢复，不持lease等待订阅而死锁。

预算按本片实际保留的ledger请求、全部binding引用及字段、索引、资产map、changes/publication和设置old/expected/readback/query预留保守元数据费用，沿现有workspace cache上限；并非JS heap精确计量。设置删除收到剩余额度，写前超额明确拒绝，不能设置已写后才发现计划装不下。真实设置读取仍独立受既有4MiB输入保护。

新增实测：真实atomicSave writer latch未完成时lease等待，正常写入后才绑定更新身份；真实scan worker第一next结果已消费但未回前prepare等待，交还批次后entries大于0且小于160，cancel后继续扫描到完整160项；probe/capability从lease前开始、释放后完成亦不发布旧结果。作者最新三新文件18通过/0失败/139断言，全typecheck通过，scoped lint复核中。新增测试首type缺WriteCapability.reason及空数组union断言两项已修，测试语义未放宽。

主线早期全量快照`/tmp/f061c-main-tests.log`为1588通过/0失败/37062断言、219文件、31.17秒，type/full lint通过；这是以上窄补前源码，不代替最终复跑，也不代表FINAL002已修复。旧图片具体迟到读及cleanup抛出专项仍未新测，交独立总审判断必要补证；真实WK尚未开始。

最终必要补证：lease期间新active observation拒绝，inactive撤订阅继续允许；同watch绑定释放后重试可登记。成功imageReader对照后，实际service请求进入read暂停，受影响retain提交并释放lease后才返回成功图，实际current/assetEpoch校验拒为UNAVAILABLE，新请求再成功；不是只比较epoch数字。watcher清理改为先摘map/取消hint，再逐个close独立固定日志；真实两个watcher第一个原close完成后注入throw，第二个仍关闭、提交收据不回滚、lease可释放且可重新选择。此注入只证明异常隔离，不冒OS真正拒绝close时资源已释放。documents七例32断言通过，预期固定warning已保留；最终type/lint及三新文件合跑待主线/两轴复核，仍不冒真实WK。

作者最终三新文件20通过/0失败/150断言、type与scoped lint通过。独立Spec实际40通过/274断言，最终0项必要构建阻断；主线最终type/full lint/docs/lock/diff均退出0，全量测试仍运行，Standards最终待返回。手册、义务登记及F061进度仅更新“已实现待真实验收”，不称alpha175已构建。

## alpha175 构建与真实有限检查（待独立最终复核）

以下为主线实际执行并回传的证据；上方实施中状态按时间保留，不代表当前仍未构建。

- 最终源码：1594通过/0失败/37093断言，219文件，32.10秒，`/tmp/f061c-final-tests.log`。
- 包内Bun运行仓库测试：1594通过/0失败/37094断言，219文件，30.72秒，`/tmp/f061c-bundled-tests.log`。不是所有GUI行为的替代证明。
- type/full lint/docs/lock/diff均退出0；独立Spec 40通过/274断言，Standards后端57通过/716断言、前端16通过/117断言，分别0项必要构建阻断。此处是构建前审查，不提前写最终验收批准。
- alpha175 unsigned build退出0，hash `3tok0hhs1vjb4`，日志`/tmp/f061c-alpha175-build.log`，直接解包位置`/tmp/agentic-direct175.SCjb4f`。没有以旧包冒本轮新代码。

### 真实WK检查

1. 先打开“原独立”再加入待移除目录；甲输入`TEMP_KEEP`形成dirty，显式打开showHidden。移除选择保留后，原独立与甲均保留标签并出现在顶层；甲`CmdZ`恢复clean。重新加入目录后showHidden默认off，验证成功移除清除该根设置。
2. 加入其他目录并打开“保留.md”，乙输入`TEMP_CLOSE`形成dirty。选择待移除根、隐藏侧栏后通过命令进入移除，选择关闭，再取消dirty确认：四个标签全部保留。随后通过按钮移除并确认关闭，只剩其他目录标签；原独立与甲的独立entry仍保留，乙的root-only entry消失。
3. “保留.md”改为444只读，在浅色主题移除并保留成功；输入`READONLY`正文无变化且保持clean。原独立顶层项双击重新打开，不弹选择器，仍可编辑。深/浅移除dialog截图已核。
4. 两个干净标签关闭后正常`CmdQ`退出，session11747退出0，PID32825消失。退出时IMK stderr保留，不推断根因，也不将它冒故障已修复。
5. 五个样本SHA均与baseline一致，readonly恢复644。`recent-files.json`仍包含原独立；本次仍有顶层文件时未显示最近入口，不推断整个App没有入口。
6. 同版重开session84197/PID33434，欢迎页实际显示最近“原独立.md”。加入待移除目录、不打开任何文档，点击目录标题文本选择后进入简化确认（只有取消/移除目录）；取消后根及hidden off保留，再确认移除后文件树空，欢迎页最近原独立仍显示。正常CmdQ退出0、PID33434消失，五SHA再次原样；IMK退出stderr保留。

样本目录`/tmp/agentic-f061c-ui.aROvzq`，基线与两次退出后工具复核SHA（基线来自本轮初始工具输出，未另存baseline文件）：

| 文件 | SHA-256 |
| --- | --- |
| 待移除/甲.md | `1d3f5cd014dd4c8ad27eda0ff62c47326dd1050b7d85309d2de24cb03791c309` |
| 待移除/乙.md | `dc9511bfd2e529128154f354ce312a3811b0a41f2ae03ba80f1374a9bd0e31dd` |
| 待移除/原独立.md | `77bb48f1e734301d56ff7255905e9af28a1d6273f63146832289d78233ac501a` |
| 待移除/.隐藏.md | `5ccc162e46fe26c959866c647319dcbada2867db7e59b38990ff9626d1e8890e` |
| 其他目录/保留.md | `8b46bf1f39384a3f955cf1d85193eb3764ee93e4c9f4f45328c6968b178b3a4e` |

### 异常观察与有限范围

AX选择根行并隐藏侧栏后，后来观察到showHidden为on，但缺少中间快照；不归因，也不拿它证明取消是否保持该设置。设置删除的真实成功证据仅取上方明确开启→成功移除→重新加入默认off的路径。

精确选区、自然IME和真实并存剩余根迁移未测。失联/未知结果主要依据controller/service故障注入，不冒真实断链验收。F061a剩余输入矩阵、完整父/OBL主责、FINAL-ISSUE-001/002、阅读子窗、冻结stash、专项/F028c和`F-061c-offline-final`仍开放；不因本轮全绿声称FINAL002修复，不断网执行离线项。

最终独立Spec/Standards均0项必要有限非离线验收阻断；两轴独立核实际日志、五SHA与进程退出，GUI采用主线收据，不冒其亲自操作。主线据此批准本片受托Agent有限代验通过，非用户亲验；Git尚未执行。
