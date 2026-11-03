# F-064d：既有索引缓存可写重开

> 状态：alpha.190 已通过本切片的受托验收。既有 FINAL002 保持开放。

<!-- obligations: none -->
<!-- deferred-obligations: OBL-006, OBL-018, OBL-026, OBL-035 -->

## 功能与候选顺序

F064c已提交推送`0b26d32ccf5a3d62f3057cf3f1dd01b642779014`，据主线HTTPS远端／origin／HEAD一致，hook前后tree `8383eb2fe282f7debeb53abba81c4938747189e8`一致、当时clean。本片承接其有限内部模块，不交付用户搜索。

父F064的硬前置仍为F005a调度、F011文档、F025／026集合，实际增量需F027、结果打开需F032；这些已有模块不等于索引消费者已接线。当前接口只有create-new／reader-only，无法正常关闭后继续更新原缓存，因此先补一个`writer-existing`模式，比直接扩容量、自动扫描窗口或搜索UI更小且确有持久闭环。缓存分类配额／淘汰、授权及dirty覆盖仍是正式窗口消费者前置，不由本片旁路。

调用者仍只提供自有缓存绝对路径、匿名ID和显式原文；不读取用户目录、不产生documentId、不按路径复活授权。保limited-v1累计16文档／64KiB、query4096 UTF16等原档，非产品上限。仅增加open模式，不新增自动恢复或后台重试入口。

### 继承约束检查

- F-002：缓存仅本地，运行不联网、不新遥测；最终断网验收保持后继。
- 中文与外观：无新UI，内部稳定错误码不输出底层原文。
- 命令与键盘：无新用户命令或快捷键。
- 安全与日志：不记录正文／query／真实路径；损坏／未来schema拒绝，不自动修复或删除缓存。

## 技术：在同一writer所有权内恢复

实际接点为`native/index/src/lib.rs::open_session`和typed `protocol.ts/session.ts/worker.ts`。现实现先reader/live，再`index.load_metas().payload`，最后仅create-new获取writer；**不能照抄这个顺序用于writer-existing**。

已只读核本机锁定Tantivy0.27.0公开源码`src/index/index.rs`约681–731：`writer_with_num_threads`经`writer_with_options`先取得`INDEX_WRITER_LOCK`，再构造IndexWriter。不是以锁文件存在猜占用；不能手工删锁或使用私有字段。公开`Index::open_in_dir`、Manual reader/reload、`Index::load_metas`和PreparedCommit payload沿原锁继续使用。参考固定[公开Index接口](https://docs.rs/tantivy/0.27.0/tantivy/struct.Index.html)，本次依据实际锁版本源码而非未访问页面缓存。

建议顺序：路径／既有schema有限预检→`Index::open_in_dir`核schema→获取独占writer（1索引线程／50MiB原配置）→在持有writer期间创建Manual reader并reload→同一reader searcher读取有界live集合，再读取持久payload。只有全部验证成功才把session发布给host。其他遵守Tantivy writer锁的写者此时不能提交，因而live与payload在稳定提交状态下对应；不能声称分别读取成功天然形成事务，也不承诺对直接篡改文件／不遵守锁的外部写者安全。锁竞争沿原IO→UNKNOWN（accepted:true）保守映射，不扩ABI或把任意IO冒接受前拒绝；第二writer不发布可用session，不自动重试。测试须证明第一正常close后新session可再次获取。

读取前仍核num_docs≤16，累计raw与字段限额照旧；不先无界collect。schema／payload／live任一拒绝或writer构造后验证失败，都必须显式消费writer收尾；收尾成功才返回原验证错误，若收尾亦失败则对外unknown优先，控制流保首错，cleanup不确定时覆盖对外状态；不提供可观察的双失败记录，不输出异常正文，也不返回可用handle。已有坏schema在取writer前拒绝；取锁及Tantivy内部文件管理可能涉及控制文件，不能宣称任何失败都目录bytes不变。只对预检拒绝证明无修复，对正常重开无apply证明逻辑live与generation不变；reader-only继续单独不建writer及原META_LOCK写打开边界。

generation从同一稳定窗口的公开IndexMeta恢复。已核锁版`src/index/index_meta.rs`公开`opstamp`；仅`opstamp==0`且live为空且payload=None允许初始代0。已提交后删除至空也必须保合法payload代；missing／malformed／超过JS安全整数的代数都拒绝，并在发布handle前完成writer收尾。不得沿旧`live.is_empty()`条件把损坏的已提交空缓存重置0；reader-only同样应用此合法性收紧，健康空初始行为不变。成功apply才按原合同提交g+1。首次mutation后任何失败单调unknown／faulted，不查询后解毒、不自动重派；调用者显式close后新session可写重开只读取实际持久状态，不意味着知道失联写是否已满足业务意图。没有跨重启pending账本或exactly-once承诺。

typed模式、C整数mode、Rust枚举与测试一致收紧；旧create-new／reader-only健康路径不变，仅同步上述payload合法性收紧。忙时写入接受前拒绝，latest只query；close仍取消latest、排空active、唯一native收尾ACK与worker自然退出。测试能力仍仅独立feature，不新增正式raw/live诊断方法。

## 最小 happy path 与拒绝验证计划

1. 自建cache create-new代0，写a=`\uFEFF中文\r\n😀x`提交代1，close；新worker writer-existing恢复代1，中文[1,3)、emoji[5,7)；更新同a为`updated`代2，delete a代3，同path新b=`new`代4；close后reader-only恢复代4，仅b命中[0,3)。原文不通过正式接口外返。
2. 空create／close后writer-existing代0可提交；写入再删除至空重开保代2，对该已提交空缓存人为移除payload后明确拒绝，恢复原metadata后新session再次取锁成功（证明失败路径已收尾）；既有文件缺失、future schema或坏payload拒绝，不隐式create-new／repair。累计live已满时重开后新增超限全批零mutation，删除后再新增按投影计费。
3. 两真实worker争同cache：第一writer持有期间第二open保守UNKNOWN且无可用session／写请求发布，不称accepted:false；第一正常close后第三成功恢复同代。不自动重试失败session。覆盖writer取得后live／payload验证失败的收尾，测试seam只在测试代码，正式不注入。
4. 原unknown后显式close／重开读取已提交代及未提交情况，分别说明test注入与真实路径；不得从unknown自行重派。沿原协议迟到ACK、close错误、无pending／自然退出回归。

每原生小组15秒／有限整批180秒首红保留，不性能选型、不延长造绿。未来代码与本机模块编译须主线另批；包内harness仍加载正式host并走同resolver，不能直接指定addon旁路。x64／新包／实际验收由主线管理。

## 义务分工与失效界限

OBL-006仅局部承接有类型内部会话和稳定失败，窗口索引受控模块仍未接；OBL-018仅沿已有一在途/latest及迟到隔离，不完成全局优先级／真实同步栈中断；OBL-026不扩limited-v1或建立全产品缓存总额／淘汰；OBL-035仅既有schema拒绝与正常重开，不完成迁移／重建策略。四项保持deferred，F064父未完。下一消费者不能仅因writer-existing可用就跳过授权、磁盘revision、dirty覆盖与缓存配额设计。

## 实施与定向验证记录（未最终验收）

已实现mode2／typed writer-existing、锁后reader/live/meta恢复、初始opstamp0与合法payload核验、restore失败显式writer收尾。合法generation已饱和JS安全上限时在batch分配／mutation前LIMIT，commit另保防御检查；不允许新提交代超出wire整数范围。无新依赖或容量变化，正式测试接口裁剪保持。

实际`verify-index-resources.ts`已扩为同resolver／包内host create→close→writer-existing→update/delete/reinsert→reader流程；待主线新包执行，不能沿用alpha189包结果。原生编译沿F064c显式Rust1.90新前缀env，正式→test addon→测试严格串行。首轮`/tmp/f064d-native.log`、`/tmp/f064d-test-native.log`exit0，`/tmp/f064d-tests-first.log`**22/0/168**、5文件6.56秒；之后增加饱和代与postcommit unknown后显式可写重开覆盖，最终结果另记。

首lint`/tmp/f064d-lint.log`新增测试JSON.parse赋值两项no-unsafe-assignment红，改unknown+运行时record核验，未改oracle。一次apply_patch上下文不匹配未写入目标，后精确定位再应用；不冒测试失败。原F064c／FINAL002及全部历史保留，本片未自行版本／App build／Git。

最终正式／test模块串行重编`/tmp/f064d-native-final.log`、`/tmp/f064d-test-native-final.log`exit0；最终源码测试`/tmp/f064d-tests-final-extra.log`**23/0/184**、5文件4.52秒，full type及定向lint分别`/tmp/f064d-type-final-extra.log`、`/tmp/f064d-lint-final-extra.log`exit0。包括两writer竞争UNKNOWN、锁后恢复、删除空代2／缺或坏payload与超安全代拒绝后恢复取锁、饱和代接受前LIMIT、累计live预算、mode2 future schema不修，以及测试addon pre-panic未提交代0／postcommit-panic代1关闭后正式writer-existing恢复。两panic为明确测试注入，cleanup失败路径未故障注入，不冒实际OS失败覆盖。

普通diff检查及对新未跟踪测试／唯一文档显式尾空白扫描通过，docs／obligations通过；原23测试为本机Bun1.3.14与单模块资源，不冒新App包验。候选冻结交主线／两轴独立复核，作者不自批。

## 独立复核与 alpha.190 构建记录

Spec独立**23/0/184**、3.61秒exit0（Bun1.3.14，session95886／chunk8bd7dd）；Standards独立**23/0/184**、3.26秒exit0（session27259／tool845bcf），均未重编，最终0必要本机有限构建阻断。cleanup真实故障仍未注入，不扩大为OS故障全覆盖。

主线全量`/tmp/f064d-main-full-tests.log`实际**1803/0/38497**、242文件43.30秒；type／full lint／docs／obligations／lock／diff通过。本次全量通过不抹既有FINAL002历史超时，仍按原延期义务开放。主线已升alpha190并启动应用构建session89059，`/tmp/f064d-alpha190-build.log`；当前只记录运行中，不预写构建成功／包内harness／真实窗口验收。生产源码冻结，作者不另启动构建或Git。

## alpha.190 包验记录

构建 session 89059 退出 0，产物 hash 为 `2d5vh2y32qxoo`。包内 Bun 定向测试 23 项通过、184 条断言。正式 host 经同一资源解析器完成创建、关闭、可写重开、更新、删除和只读查询，最终提交代为 4。真实 WK 窗口使用隔离空数据目录，欢迎页正常显示，⌘Q 后 launcher 退出 0，进程已退出。2026-11-03 从留存的原包装重新解包，正式 host 流程再次退出 0。测试使用自建缓存。

最终独立复核重新核对 10 份源码及 3 份包内资源的 SHA，复跑正式 host 流程及 23 项定向测试，均通过。窗口和全量测试采用此前实测记录，原临时日志已不可用。真实系统清理失败未做故障注入。
