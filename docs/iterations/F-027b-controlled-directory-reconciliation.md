# F-027b：目录核对候选基础

> 状态：2026-10-05 F-027b alpha.93非离线内部服务本片经最终独立verifier确认0本片阻断，主线确认受托Agent代验通过，非用户亲验。首轮权限测试红保留未归因的非阻断观察，不声明已修或绝对无关；Git待实际执行。无接受发布/UI/RPC/watch，父功能/完整OBL-005/016、延期OBL-011及最终离线仍开放。

<!-- obligations: OBL-005, OBL-016 -->
<!-- deferred-obligations: OBL-011 -->

## 功能说明与范围

为后续目录监听消费者提供后台内部受控全根元数据候选核对：只生成私有候选与稳定核对结果，当前服务树始终不被本片修改。未改变位置、类型与安全身份链的节点可标记为后续可保留opaque handle，但本片不执行接受/发布，不更新root.nodes/files/generation、授权、asset scopes或打开正文。本片没有正式按钮、实验台、RPC或自动触发，现有用户界面仍只使用已验收rescan/hidden；不宣称UI已自动更新或稳定刷新。不是增量扫描性能优化，不添加自动watch、定时重新扫描或重聚焦扫描。

不修改打开文档正文、模式、选区、撤销历史、disk baseline或mirror；不是F-028c自动刷新，不通过“无历史”子集绕过待决定选项。同路径文本内容改变不等于文件身份改变；可靠rename/documentId跟随属于OBL-011，明确延期，跨路径一律不猜身份。独立文件覆盖继续消费同源根结果，授权路径不由显示字符串替代。

局部承接OBL-005的目录候选身份/代次隔离及OBL-016的合并、有界调度与失效；不关闭完整父F-027或OBL。F-025现有授权、扫描、过滤和分页是硬前置；F-026c已验收的统一树是消费者，不重新定义其键盘/焦点规则。

## 源码核对与最小技术方案

已核对 `bun/workspace/index.ts`、`scan.ts`、`authorization.ts`、`shared/workspace.ts` 及 `client/workspace.ts`：现有 restart会立即清空节点并递增generation，后台merge逐批写当前树，客户端每页立即publish；直接复用这些发布步骤不能满足本片原子替换。现有固定扫描Worker、ScanFile指纹/祖先chain、RootAuthorization复核、128节点分页及预算可复用，不新增native依赖或另写目录遍历器。

1. **内部小接口。** 主线明确本片仅服务基础：以trusted workspace服务内部方法接收当前已授权root opaque handle，返回有界明确的核对结果，不接受renderer路径，不新增RPC/按钮/实验台协议。只接受当前complete根作为稳定基线；scanning/partial/paused/failed明确BUSY/NOT_READY，沿用原手动重扫恢复。后台一项候选任务，全局单任务/同根重复请求合并，其他请求明确busy而不无限排队。内部结果区分候选就绪、失败/预算不足、已失效等，不把旧树当新complete；不自动重试。候选token不是授权，check只证明与服务绑定仍一致，不是最新磁盘证明。
2. **私有候选与资源界限。** Worker按现有安全全根扫描规则产生私有候选，不边扫删除/清空当前树。当前树、候选、索引映射及排队元数据必须共同计入现有预算；预算不足/paused/partial/error都拒绝形成完整候选并释放资源，当前树及UI不变，内部返回明确结果。候选唯一任务令牌与公开root generation分离，捕获root lifetime、隐藏策略及当前generation。隐藏切换、手动重扫、根吸收/撤销、clear/退出均失效并清理候选；不能承诺阻塞I/O可硬取消。

   已核对worker只有单outstanding call：候选必须接入既有drain串行调度，与初扫/prioritize/close共用序列，不直接并发call、不每根建Worker。私有候选使用与root:generation不碰撞的独立key，避免start/close破坏现有扫描。现有cleanup优先，批次之间让出且有限公平，维持scan-worker的32会话及共享2MiB队列约束；容量不足明确失败并清理，不增大上限掩盖泄漏。当前根预算仍计入候选准入；不创建长期第二Worker。
3. **安全身份差分。** 只有canonical位置、类型、叶身份（文件）以及完整已观察祖先身份链一致的节点才标记可保留handle；目录身份来自候选ScanFile.chain，而不是名称或子文件名推断。同路径替换、祖先替换、类型改变标记不可保留；链缺失/冲突/不确定不得保留。不以候选判定代替打开前授权；即使同内容不同身份也不能标记可复用，同身份内容变更不触发正文读入。无跨路径rename跟随。
4. **结果成立与生命周期。** 扫描确实done且无错误/预算不足，随后verifyRoot并再检查任务、lifetime、epoch/generation、隐藏策略仍有效，才形成有效完整核对结果。结果只绑定当时服务代次，不保证“当前磁盘永远最新”；不提供accept或生产发布。内部候选不暴露可变对象，摘要为副本、引用为opaque，旧结果查询/释放须验证lifetime并且幂等。完整成功空候选可以报告全删除差分，partial/error/paused/取消不得输出可信删除集。私有候选缓存有界，替换/释放/失效/销毁均清理。扫描不是文件系统事务快照，后续接受仍须重新核对绑定/授权。
5. **接受发布与前端明确延期到F-027c。** F-027c后续承接后台原子接受发布及前端分页一致性：再次验证绑定后更新服务generation，客户端捕获新generation、完整分页暂存/校验/预算后一次替换，拒绝坏游标/重复/晚结果，保留有效选择/展开/焦点；之后才可接watch。不能直接将本候选接入当前逐页publish，不以本片结果冒充已发布或UI更新。
6. **对当前状态的隔离。** 核对前后root.nodes/files/generation/授权/assetScopes/coverage及Document Service正文、baseline、mirror、历史均不被候选修改；现有rescan/hidden仍保留原行为，只使候选失效。服务集成直接调用内部候选/核对/释放方法验证真实临时根及只读结果，不新增可见实验功能。

## 最小 happy path 与异常验证

- 真实文件系统服务集成：临时根有unchanged.md及子目录文档，打开其中一份并保留内存状态；外部新增、删除另一份，直接调用内部核对。候选结果准确区分新增/删除/可保留节点，当前服务树快照、generation、分页及打开文档snapshot/baseline前后不变；新增不被本片自动授权或打开。不将后台测试称为UI选择或历史往返实操。
- 同路径同类型但叶或祖先身份替换，不复用handle；原handle不得授权替换后正文。跨路径rename不跟随documentId。隐藏规则/目录symlink/越界与`.git`排除保持现有策略。
- 受控Worker partial/error/paused/预算不足、根授权失败或目录扫描错误不得返回可信删除集；完整成功空树仅可报告完整候选差分，不发布。已有+候选共同预算，单任务与重复合并有证据，不以样本耗时预设门禁。
- 候选期间hidden/rescan/clear/根吸收/销毁及晚回执不得发布；保存/打开的既有授权与写屏障不削弱。调度/取消/有界性用受控测试，不冒充真实竞态实操。
- 超128节点完整候选与摘要准确，现有服务分页不因候选产生而换代/混页；其他根不受影响。结果副本不可篡改私有候选，释放后不可复用，重复释放安全。不执行或宣称接受发布、前端暂存/焦点保持实测，留F-027c。
- 使用现有默认Node-API安全扫描在临时目录执行真实新增/删除/替换/空结果与文档隔离集成；受控worker补竞态与错误。打包后可由包内Bun运行仓库集成，并真实WK启动/退出smoke确认原UI不回归；无需不存在的可见核对入口，不将smoke当服务功能UI验收。不得修改用户文件。

## 继承约束检查

- F-002：只读本地元数据核对，不写Markdown或联网；不得断网验收，离线项留最终人工。
- 中文与外观：本片无新UI；未来消费者需中文就近非阻塞状态，旧树保留不冒称新鲜；不新增常驻状态栏或打断输入弹窗。
- 命令与键盘：本片无按钮/命令/快捷键，不改变已验收树焦点、Space仅选择、Enter导航和IME/冻结保护。
- 安全与日志：事件或显示路径都不是授权；opaque root、祖先/叶身份及generation验证、后台/前端预算与释放；不记录正文/用户路径，不调用任意脚本或进程。
- 实施纪律：不默认TDD，不预冻结性能门禁；先批准当前最小方案，再实现、独立双轴审查及受托代验。源码与包内测试、实际窗口、未实操项分别记录；每次代码打包递增alpha由主线执行。

## 最终人工待验：F-027b-offline-final

保持最终人工待验、未执行：本地内部目录候选核对在离线环境下仍可用。遵守用户禁止断网/网络隔离约束，不为本片切断系统或进程网络；不阻塞其他已确认非离线范围，但不能写成已通过；当前无UI触发，最终人工方式须使用本片已有服务验证路径，不假造正式入口。

## 当前记录

2026-10-05：主线确认F-026c已提交推送 `e1e792ce26024fd5df935a5e2f0f55933280fa5e`，远端main同SHA，当时工作树干净。随后按连续授权选择本片，主线经planner核对进一步收敛为内部候选基础：无接受发布/UI/RPC/自动watch，不改既有rescan/hidden，F-027c承接接受发布与前端稳定分页，其后才接watch。当前仅方案、待独立核对，未写生产代码/版本、未构建或Git。

## 实施记录（2026-10-05）

主线批准方案、独立planner核对0技术阻断后实现。新增内部 `reconciliation.prepare/get/release`，不进入WorkspaceService的RPC接口；仅complete根准入，同根重复请求共享任务后各返回副本，其他任务BUSY。私有候选只保留身份proof与只读摘要，无accept，不更新服务根/授权/正文。候选持有当前服务lifetime/generation/hidden绑定，token不授予文件访问；get只验证服务绑定，不证明最新磁盘。

候选通过既有drain与正常扫描交替批次，共用一个Worker，现有cleanup优先，私有UUID key不碰撞root:generation。正常扫描需要预算时优先失效候选，双方派生元数据共同受cacheLimit，队列仍由Worker共享原2MiB约束；不是RSS上限保证。身份proof要求连续完整chain并拒绝同目录多后代冲突，同身份重复文件有界去重。独立预审指出原Job曾引用旧nodes/files，已改为只保存必要RootBinding，baseline构建后不持有该旧集合，避免换代扣账后额外保留。

受控模块测试覆盖40个同根请求合并、摘要副本、释放/换代/销毁、完整空结果、错误/paused/不完整链/冲突链/预算增长。真实默认Node-API临时根集成覆盖新增/删除/同路径替换、祖先替换、136节点跨页基线不变、文档locations/assetEpochs不变；没有调用正文read/accept推进基线。共享drain受控集成验证候选与第二根扫描交错不饥饿、最大并发Worker call为1，以及pending next期间rescan/hidden/clear/dispose清理私有key且旧结果结算失效。

最终定向26 tests / 171 assertions / 2文件 / 758毫秒通过。首次模块测试因临时/tmp路径未按实际canonical路径建fixture失败，修正为authorizeRoot返回路径后通过；首次lint提示空测试方法/可选链样式已修，不掩盖初次失败。完整源码测试、最终typecheck/lint及独立双轴审核仍在收尾；未版本/构建/UI/Git，不能称已验收或前端稳定更新。

源码完整复跑759 pass、0 fail、19526 assertions、124文件、14.88秒，日志`/tmp/agentic-f027b-source-tests.log`；最终typecheck、全量lint、文档/义务及diff检查均通过。源码稳定待独立双轴结论及主线打包服务代验，当前仍未验收，未由执行者修改版本、构建或Git。

### alpha.93 包内全量失败，保留未验收（2026-10-05）

主线alpha.93构建成功，日志`/tmp/agentic-f027b-build93.log`；包`/tmp/agentic-markdown-alpha93.Sa0zw0/Agentic Markdown-canary.app`、hash `miny2m5c7zqm`。包内Bun运行仓库全量758 pass / 1 fail / 19526 assertions / 124文件 / 14.63秒（`/tmp/agentic-f027b-packaged93.log`）：`client/reading-save-capability.test.ts:65`在原生保存并切换文档后，inactive能力预期writable、实际unavailable。构建成功不覆盖该失败，本片仍未验收/不得Git。

主线真实默认无faultlab窗口欢迎页侧栏26.4，启动/退出smoke完成、PID88385消失；旧alpha.92 clean退出且PID82645消失。只有smoke，不是不存在的目录候选UI验证。

依diagnosing-bugs先窄复现：同alpha.93包内Bun执行 `test apps/desktop/src/client/reading-save-capability.test.ts --rerun-each 30`，30 pass / 0 fail / 150 assertions / 6.03秒，日志`/tmp/agentic-f027b-capability-repro93.log`。主线另已启动20次循环，20/20通过；两组可能并发，不能当隔离性能实验。尚未稳定复现、不判“已修”或必为flake。候选解释为150ms断言遇到watcher失效/异步复核窗口、后台版本变化留下unavailable，或全量前序/运行环境影响；均未确因，无生产修复或放宽断言。继续由主线选择原全量/运行时对照取证。

主线后续取证：原alpha.93包内Bun按原命令重跑同一当前工作树全量，759 pass / 0 fail / 19526 assertions / 124文件 / 13.97秒，日志`/tmp/agentic-f027b-packaged93-retry.log`。随后以alpha.92包内Bun运行同一当前工作树，759 pass / 0 fail / 19526 assertions / 124文件 / 14.64秒，日志`/tmp/agentic-f027b-runtime92-control.log`；这仅运行时对照，不是alpha.92基线源码对照，不能据此排除全部新源码影响。

主线核对相对`e1e792c`的`client/documents.ts`、`client/reading-save-capability.test.ts`与`bun/documents`差异为空；独立verifier未发现该失败测试直接调用候选服务的路径。两次全量绿及20+30次窄绿不消除首次真实红，不证明根因已解决；watcher暂态仍是假设，未归因、未修复，未修改生产能力判定或测试断言。alpha.93构建及真实WK默认欢迎/退出smoke仍按上文边界，当前交付判断待最终verifier，不预写本片通过或Git。

### 非离线内部服务本片通过（2026-10-05）

最终独立verifier正式确认0本片阻断，主线确认F-027b alpha.93非离线内部服务本片受托Agent代验通过，非用户亲验。既有真实Node-API服务集成、受控竞态、包内复跑和WK启动/退出smoke按各自边界使用，不冒充目录核对UI验收。

首次权限测试失败保留为未归因的非阻断观察，不声明已修或与本片绝对无关；后续若复现，应采集失效提示/复核回执时序独立诊断，不只延长等待或放宽断言掩盖。父F-027、完整OBL-005/016、延期OBL-011、F-027b-offline-final及后续F-027c接受发布/前端接入责任继续开放。Git待主线实际执行核验，不预写成功。

主线实际Git收尾：提交并推送`de027433f1d350d0a4adc0ee6086434fbde602b1`，ls-remote核对main同SHA，当时工作树干净。随后按连续授权形成F-027c内部接受/回执最小方案；前端分页稳定消费者进一步拆至F-027d，不将该后续新文档算作本次已提交内容。
