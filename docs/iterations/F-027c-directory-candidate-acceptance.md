# F-027c：内部目录候选安全接受与结果确认

> 状态：2026-10-05 alpha.94 非离线内部服务本片已由受托Agent代验通过，最终独立verifier 0剩余阻断、主线确认；非用户亲验。源码及包内全量、独立双轴核对与真实WK启动/正常退出smoke分列留证，不冒充UI候选接受体验。Git待主线实际执行；无RPC/UI/watch，不改rescan/hidden产品行为，父功能/完整义务与offline-final开放。

<!-- obligations: OBL-005, OBL-016 -->
<!-- deferred-obligations: OBL-011 -->

## 功能说明与范围

在F-027b私有目录候选基础上，提供内部受控接受和操作结果确认。只有服务当前持有且绑定仍有效的候选，可在重新进行安全全根元数据扫描并与原候选完整inventory（节点清单及身份证明）一致后，原子替换服务目录快照。再扫描发现新变化必须拒绝，不以新扫描偷偷替换用户/调用者原本指定的候选。

成功只更新目录服务nodes/files/byPath及meta.generation等派生树状态，不写磁盘，不修改Root授权对象和既有DocumentScope/assetScope，不读取或覆盖打开文档正文、disk baseline、mirror、history或documentId。稳定位置/类型/完整身份链的节点保留handle，其余使用新handle，不猜rename。本片没有renderer/RPC/UI触发，也不自动watch或重扫；原rescan/hidden语义不变。

接受回执描述该操作发生过什么，不保证当前树仍是该代次，更不保证磁盘此后未变化。查询无法确认时明确unknown/已取代，不假装未提交，不因重试重复换代。

## 依赖与责任

- 硬前置：F-027b候选持有/失效/身份proof、F-025安全扫描/授权/分页及共享Worker、现有写屏障和退出生命周期；F-026c树仍作为既有消费者，当前不接新功能。
- 局部承接OBL-005的安全接受/代次防陈旧和OBL-016的单任务、有界结算；OBL-011可靠外部身份跟随延期，父F-027与完整义务不关闭。
- 前端完整分页暂存/一次替换/有效选择展开焦点保持明确拆至后续F-027d；之后才接自动watch。禁止把后台成功直接接当前逐页publish，禁止宣称本片已交付UI原子更新。
- F-028c正文自动刷新及撤销历史待决定仍保持，不以目录接受绕过；目录派生快照和Document Service正文基线不是同一数据层。

## 源码核对与最小技术方案

已核对workspace.reconciliation仅保存身份proof/副本摘要、当前共享drain串行且cleanup优先；F-028b有有界回执经验，但本片不照搬其正文snapshot协议或改变文档服务。实施只扩展trusted内部接口，不修改WebView协议。

1. **操作身份与准入。** 只允许服务真实持有的私有candidate token。采用服务签发的session内单调操作序号，绑定candidate/root lifetime及原generation；接受只能消费已签发操作，不允许caller随机造新UUID绕过淘汰记录。操作记录有界、全局在途接受至多一项；同操作重复调用合并在途或返回回执，不同操作明确busy，不排无限队列。已签发高水位保留到session结束，淘汰后的旧操作不重执行；旧session/旧root不可复活。具体最小字段随实现确定，不冻结外部协议。
2. **再次安全扫描而非仅checkBinding。** 与F-027b共用现有单Worker/drain和独立key，仍为全根扫描不是增量优化。对当前complete根及原hidden策略重扫，严格完整路径、类型、祖先/叶身份proof，必须done且无partial/errors/paused。将结果作为独立暂存，与原候选所有节点及身份集合精确比较；新增/删除/替换/不确定一律拒绝，不偷换候选，不把内容hash与身份混淆。metadata核对不读取Markdown正文。
3. **资源有界与清理。** 原树、原候选、复扫proof/文件元数据、待发布映射及回执共同计入预算，构建时不能隐性翻倍；失败/预算不足不发布。复用共享2MiB扫描队列及32会话限制，不建每根Worker、不增大上限掩盖问题。cleanup优先，批次之间让出，正常打开/保存/扫描不被无限饿死。候选和操作释放/重扫/hidden/clear/根吸收/撤权/退出均在提交前失效，迟到结果不能提交。
4. **发布准备与同步CAS。** 在最后授权复核前，完成全部新nodes/files/byPath/meta及回执的构建、预算计算和扫描Worker关闭。沿原候选顺序构建，不冻结新的最终排序产品规则；同路径/类型/完整链一致才保留handle，其他节点新handle，parent引用随同映射正确重建。最后await verifyRoot后再次同步检查candidate、Root lifetime、generation、hidden和操作绑定仍一致；从该检查到根快照替换、generation只加一次、回执记账不得再await。CAS是服务内比较并替换，不是文件系统事务或durable写入。
5. **授权与打开隔离。** 不替换Root对象或重建根授权，不在提交/query中调用syncAssets或扩大asset scope，不因树删除撤销已开文档。当前Workspace open捕获generation与ScanFile引用并在授权前后校验，补充必要的晚回执验证，确保旧代未完成打开不会授权新替换节点；已打开DocumentScope继续验证原Root身份，不因节点缺失被强制关闭。既有state触发coverage/asset同步属于已有消费者，须单独回归不扩权，不能据此称前端原子。
6. **确定回执与未知。** committed回执包含该操作已提交的有限代次元数据，为历史事实；后续rescan/release不得改写成未提交。明确拒绝只用于提交前可证实未发布的路径；异常/丢回执无法证明结果时保留unknown。query只读副本，不执行I/O或重试接受；淘汰结果仍拒绝旧序号再次执行，不持久化永久操作历史。重复/晚请求不得回滚新树代次。
7. **生命周期。** 接受纳入当前服务的失效和settlement边界；dispose/clear不在任务仍可提交时错误报告完成，也不能与共享drain/写屏障相互等待死锁。先同步失效，等待已发I/O回执及清理；仅任务、并发和持有内存有界，不承诺I/O等待时长有界或硬取消阻塞I/O。提交后cleanup错误不得把已记committed改成rejected；为减少该窗口，扫描close须置于最终CAS之前。

## 最小 happy path 与异常验证

- 默认Node-API真实临时根：生成含新增/删除/不变节点候选，签发操作并接受；再次扫描与原候选一致，generation恰加1，新增/替换获得新handle、未变完整链保留handle，服务分页可完整读取。父引用及跨128节点分页正确；树授权与打开文档snapshot/baseline不变，不冒充UI验收。
- 候选后再新增/删改身份或替换祖先，接受拒绝且当前树/代次不变；不会用复扫新结果偷换原候选。partial/error/paused/预算不足、根授权失败、冲突chain均不删除当前节点。完整空候选经相同复验可接受为空树。
- 同操作重复/并发请求只提交一次；query回执不可篡改内部记录，后续新操作/手动重扫后旧committed是历史，淘汰/未知旧序号不重执行。提交前取消与提交后回执丢失分别验证，不能将unknown当未提交。
- 受控Worker pending期间release/rescan/hidden/clear/吸收/dispose，晚结果不提交；与其他根扫描共用Worker最大并发1、cleanup/公平性、全部候选及构建预算有证据。
- 旧open与接受交错，旧代授权/晚结果按规则拒绝，既有打开文档、scope、asset epoch和正文/基线/历史不被静默重授权或刷新。保存/退出相关屏障只补最小必要接线，不改变已验收交互。
- 打包后包内Bun运行服务集成，真实WK默认欢迎/正常退出smoke；无新UI入口，不要求或宣称用户操作“接受候选”。测试故障注入不冒充真实竞态，记录未实操边界。

## 继承约束检查

- F-002：只读元数据与服务派生快照提交，不写Markdown，不联网；离线留最终人工，禁止网络隔离。
- 中文与外观：无新UI/状态栏/弹窗；内部结果不是当前用户可见自动刷新，后续消费者再设计中文提示。
- 命令与键盘：无新命令/快捷键/树按钮，不改Space/Enter、焦点、IME/冻结、编辑或阅读交互。
- 安全与日志：私有token非授权，完整链/原授权/代次CAS；无路径正文日志，不从显示路径重建授权，不运行任意脚本。
- 迭代纪律：先批准方案再实现，不默认TDD；独立Spec/Standards评审和服务代验分别留证，主线每次代码打包递增alpha；未验收不Git。

## 最终人工待验：F-027c-offline-final

内部目录接受及结果确认的离线可用性留最终统一人工验证，未执行不写通过；当前无用户UI，使用既有服务验证路径，不为验收断网或改系统网络。

## 当前记录

2026-10-05：前轮F-027b已主线提交推送`de027433f1d350d0a4adc0ee6086434fbde602b1`，ls-remote main同SHA、当时工作树干净；首次权限测试红未归因的非阻断观察继续保留。本片当前仅最小方案，待主线批准及独立核对，不码/版本/构建/Git。

### 2026-10-05 实施与并发屏障补充

主线批准上述内部最小方案，独立方案核对0技术阻断后实施。服务内账本当前固定最多8条回执、单在途接受，高水位不随淘汰或清理回退；普通扫描预算优先，可淘汰回执但不能重新执行旧operation。复扫、publication构建及Worker关闭均先于最终verifyRoot/CAS；commit回调若发生结果不明异常记录unknown，不谎报rejected。

独立预审发现仅在异步Owner.verify期间绑定generation不能封闭最后verify返回至Document Service commit的微任务间隙。主线批准更窄的Root-local open屏障：获取ScanFile后首个await前同步计数，整个openAuthorized及bindAssets在try/finally内结算；最终CAS在任何树字段/预算变化前，若本根存在open在途则明确rejected/BUSY，不等待、不发布，调用方稍后须重新准备候选。其他根不被此屏障阻挡，已打开scope不永久绑定旧generation，不改Document Service API。此为服务内部保守拒绝，不改变现有用户打开行为。

初始服务新测试两项失败分别为测试误用snapshot.content（正确字段text），以及拒绝返回后私有Worker尚在清理、立即prepare返回既定BUSY；修正测试字段及等待清理，不修改生产拒绝语义。扩展pending接受测试首次在回执已结算但close尚未读回时检查close过早，改等清理证据。初次lint发现四处测试/导入/可选链规范问题，已修；均保留失败，不称产品缺陷修复。当前专项33项/255断言通过（包含真正临时目录、操作身份副本/幂等/unknown、空树、接受阶段重扫/hidden/clear/dispose失效与Root-local late-open/throw/跨根对照），后续全量及独立复核待完成。无版本、构建、UI或Git操作。

后续源码全量已通过：766项、19610断言、125文件、14.97秒，日志`/tmp/agentic-f027c-source-tests.log`；typecheck、lint、feature-docs、obligations及diff检查通过。双轴独立代码复核进行中，未构建、未代验、不得Git；源码测试不等于包内或真实WK证据。

最后追加纯测试覆盖接受阶段release及共同预算拒绝（无生产代码变化）；专项复跑34项/267断言/3文件/902毫秒，日志`/tmp/agentic-f027c-targeted-tests.log`。独立Standards复跑34项/267断言/1301毫秒，代码规范0阻断；仍待独立Spec、更新后全量及主线构建/代验，不作为本片最终验收。

独立Spec源码核对0已知阻断，复跑34项/267断言/953毫秒及文档/义务/diff通过，并要求不借prepare证据代替跨分页接受。随后扩展真实临时目录136节点样本：接受后完整分页保持全部稳定handle与文件parent引用；替换祖先后再次接受，全部换新handle且每个parent有效。仅补测试，无生产改动；workspace集成24项/158断言/1145毫秒通过，日志`/tmp/agentic-f027c-pagination-tests.log`。主线负责末次全量、alpha递增及打包，尚未最终代验。

### 2026-10-05 alpha.94 构建与代验候选

- 主线末次源码全量767项/19628断言/125文件/15.51秒，日志`/tmp/agentic-f027c-final-pagination-source.log`；此前767项/19622断言/14.75秒为多页补测前运行，不混作最终结果。
- 主线构建成功，日志`/tmp/agentic-f027c-build94.log`。实际包`/tmp/agentic-markdown-alpha94.RPNvEl/Agentic Markdown-canary.app`，alpha.94，hash `1kuv6r7aqr2cb`。
- 包内Bun运行当前仓库测试767项/19629断言/125文件/14.53秒，日志`/tmp/agentic-f027c-packaged94.log`。源码与包内断言数差异按实际记录，不强行统一；该项是真实服务自动集成证据，不是通过UI接受候选。
- 同隔离应用数据目录、默认不启用faultlab启动，exec `4122`、PID `91111`；真实WK空欢迎页、空文件树及侧栏26.4已观察。随后CmdQ正常退出，精确进程检查PID 91111已不存在。仅启动/退出smoke，无新UI/RPC入口，不声称自动watch或前端原子更新已实测。
- 前轮F-027b权限测试首红仍为未归因历史，本轮未出现不是已修复或绝对无关的证明。真实并发故障、无限规模与离线边界不扩大；F-027c-offline-final、完整父功能/义务和后续前端消费者继续开放。

当前为受托Agent内部服务代验完成候选，待最终独立证据复核及主线确认；不是用户亲验，不预写本片通过或Git成功。

### 2026-10-05 正式非离线本片结论

最终独立verifier复跑34项/273断言/1391毫秒，相关检查通过，确认本片0剩余阻断；主线据此正式确认F-027c alpha.94非离线内部服务受托Agent代验通过，非用户亲验。上方候选及失败检查点保留历史，不覆盖当前正式结论。Git仍待主线实际执行，不预写提交推送成功。

本结论不关闭父F-027、完整OBL-005/016、延期OBL-011或F-027c-offline-final；F-027d前端分页一致性、自动watch及F-028c正文刷新/撤销决策继续开放。F-027b权限测试首红仍未归因、不声明已修。内部服务自动集成与WK仅启动退出smoke的证据边界保持，不扩展到不存在的UI接受功能或离线实测。
