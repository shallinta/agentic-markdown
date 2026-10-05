# F-027e：安全目录自动观察与树更新（PoC 先行）

> 状态：2026-10-05 alpha.97 非离线本片经最终独立 verifier 确认 0 阻断，主线确认受托 Agent 代验通过，非用户亲验；Git 待实际执行。下方旧阶段记录保留历史。本片不关闭完整父 F-027、义务或离线责任。

<!-- obligations: OBL-005, OBL-016 -->
<!-- deferred-obligations: OBL-011 -->

## 功能说明与边界

目录内新增、删除或替换 Markdown 后，自动安全核对并更新文件树，沿 F-027b/c/d 的候选、接受、统一分页暂存发布，不直接把事件当作真实状态。不刷新已打开正文、磁盘基线、选区或撤销历史，不绕过 F-028c 的产品决定；不提供可靠重命名身份跟随，OBL-011 延期。OBL-005/016 仅局部承接目录观察及安全树更新。

`.git` 始终排除；隐藏策略关闭时不登记隐藏子目录；目录符号链接不递归。允许目录的父级条目变化可能产生 hint，这不等于监听被排除子树内容。不以 callback 过滤、未收到事件或最终树未显示作为底层排除证明。

## 现有依据与风险

`workspace/scan.ts` 已通过完整身份链和 `openDirectoryAt` 安全打开目录，在 stat/入队前排除 `.git` 及关闭的隐藏项；原生 `fstatat(..., AT_SYMLINK_NOFOLLOW)` 和 `openat(..., O_DIRECTORY|O_NOFOLLOW)` 不沿目录 symlink 递归。但当前 ScanBatch 仅文件及祖先链，缺少空目录/无 Markdown 目录 inventory，不能直接用可见树建立监听覆盖。

[Bun 浅层 watch 指南](https://bun.com/guides/read-file/watch)与 [Bun API](https://bun.com/reference/node/fs/watch)不提供已安全打开 fd 的公开入参；[Node caveats](https://nodejs.org/api/fs.html#caveats)不承诺防恶意路径替换。改用候选 Node-API 的 descriptor-bound `EVFILT_VNODE`，须先核对[Apple kqueue 文档](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html)与本机 SDK，不能用 Node 平台实现说明替代 Bun 本机证据。用户本次已批准这一原生路线的验证，不改用 Bun FFI。

## 最小技术方案：先隔离实验，后生产接入

1. 使用 `mktemp -d` 生成明确临时目录，以 apply_patch 写独立 Node-API addon 与 Bun driver，标明实验；不改已有 native 模块、生产接线、版本或依赖。不调整系统限制，不运行网络隔离。保留实验源码、日志、失败与准确命令供独立复核。
2. addon 只提供有界登记、有限事件批量轮询、注销/关闭；`kqueue` 使用真实已打开的安全目录 fd，注册期间不按字符串路径重开目标。目录打开从安全根逐级 `openat`、nofollow、fstat 身份核对；明确 fd 所有权和失败清理，不向生产 WebView 暴露路径或 fd。零/短有限 timeout 的 poll，不让实验无限阻塞。
3. 受控清单覆盖根、允许空目录和允许无 Markdown 目录；登记日志记录实验对象身份与策略，证明 `.git`、关闭的隐藏项和目录 symlink 未进入/登记。启用隐藏后仅允许隐藏目录，`.git` 仍不登记。实验文件路径仅临时样本日志，不引入产品日志。
4. 测试路径被替换后监听仍绑定旧对象，不自动跟随新路径；旧对象移动产生的 hint 只要求后续重新核对授权。异步观察不能承诺移动到隐藏路径的瞬间已撤销；必须登记/处理前复核身份链、失效关闭，若硬约束不能满足则报告限制，不放宽范围。
5. 新目录先由父 hint 发现，再安全登记及补扫；将注册前后窗口纳入重复核对，不声称事务快照或无事件遗漏。每根合并一个待核对标志，不无限积累事件名；poll 无文件名也只作为根需核对 hint。目录 vnode 不预先宣称覆盖所有子文件内容写入，正文外变继续独立消费者。
6. PoC 经独立 verifier 判定可行后，才自动继续生产最小实现方案核对。生产阶段仍复用单扫描 Worker/cleanup 优先、有界任务与预算，不因每个事件启动新扫描；与手动重扫/隐藏/撤权/退出互相失效，旧回执不可复活。完整 inventory 与 fd/事件资源共同计账，失败不能静默丢覆盖或破坏旧树；具体上限根据实验记录确定，不提前冻结性能门槛。

## 最小 happy path 与安全验证

- 在真实 Bun + 独立 Node-API 下登记安全根和允许空目录，新增 Markdown、创建多层目录后补登记并核对清单，收到相应需核对 hint；不只测已有 Markdown 目录。
- 样本包含 `.git`、隐藏子目录、目录 symlink；检查实际安全打开与登记对象清单，而非只检查回调。隐藏关闭/开启的清单差异准确，`.git` 不变。
- 注册前受控替换为 symlink 时安全打开拒绝；登记后重命名原目录并在原路径创建新目录，校验 fd 身份未改变、不重绑新 target；旧对象事件与新对象事件分开记录，不因事件缺失作安全证明。
- 关闭单 watcher/全部 addon 资源后可验证 fd 已释放，重复关闭不误伤复用 fd；有限批次/有限 poll 在空队列返回，有界登记拒绝超量并清理中间资源。记录实际资源计数，不能当作 RSS 硬封顶。
- 实验失败如实保留，未通过关键身份/排除边界不得进入生产。生产后另需真实 WK 自动树增删、独立叶覆盖、dirty/选区/历史保持、失败提示及退出；PoC 不是产品验收，也不以启动 smoke 冒充可见闭环。

## 继承约束与记录

- 中文与外观：PoC 无产品界面；生产接入后沿现有中文状态及深浅主题，实际验证后才记可用。
- 命令与键盘：不新增命令，不改变树 Space/Enter、焦点、编辑器选区或 IME 规则。
- 安全与日志：PoC 仅临时样本；生产不得记录正文或路径，不把 fd/token 暴露给 renderer，不扩大根授权。

F-002：本地目录 metadata 为观察对象，不写用户 Markdown；不执行 Markdown 脚本、shell 或外部网络。保持中文状态提示、现有深浅主题与命令键盘行为，不增加布局或正文模式决定。用户不默认 TDD，按最小实验/测试证据推进；独立评审、版本构建和 Git 由主线安排。

稳定最终人工入口：`F-027e-offline-final`。目录自动观察与树更新离线可用性留最后统一人工，未执行、不宣称通过，不断网。

2026-10-05：用户确认 Node-API descriptor 监听验证及通过后自动继续；本次先形成上述方案，PoC 尚未执行。前轮 F-027d 已提交推送 `a6355381d8e22a32b5bb413c3c8ad07c77e30cbc`，远端一致、当时工作树干净；前轮未归因 toast 与验证限制保持。

### 2026-10-05 隔离 PoC 实证（待独立复核）

主线批准后，仅在 `/tmp/agentic-f027e-poc.r1R1PV` 创建独立 `watch.c`、`driver.ts`、`watch.node` 与临时样本，无生产接线。使用 prototype 技能的可丢弃实验原则；按本任务明确要求保留验证断言/日志及临时路径，不创建交互 TUI 或修改项目脚本。源码基于现有 Node-API headers 1.9.0，本机 SDK 的 `sys/event.h` 确认 `EVFILT_VNODE`、`NOTE_WRITE`、`NOTE_RENAME`。Bun 实际 1.3.14，clang `-bundle -undefined dynamic_lookup -DNAPI_VERSION=8 -Wall -Wextra -Werror` 编译成功；首次错误假定根 node_modules 有 header，编译找不到头文件且随后 addon 不存在，改为既有 `.bun/node-api-headers@1.9.0/node_modules/node-api-headers/include` 后成功，没有安装依赖。

运行命令：`bun /tmp/agentic-f027e-poc.r1R1PV/driver.ts`。首次成功日志 `run.log`；增加部分分配失败与 fd 释放实证后最终日志 `run-final.log`，最终运行全部断言通过。实验容量为固定 8 个登记，每个持有目录 fd 与独立 kqueue；仅验证机制，不确定生产容量/架构。最终样本根 `/private/tmp/agentic-f027e-poc.r1R1PV/fixture-QfPyKh`，样本与历史日志保留。

- 隐藏关闭时实际登记根及 4 个允许子目录，日志列出确切清单；`.git`、`.hidden` 和指向根外临时目录的 symlink 未登记。隐藏开启后含新建两层目录和 `.hidden` 共 8 个登记，仍无 `.git`/symlink。driver 在递归前排除，native 使用 nofollow 安全链，仅显式目录 fd 注册；不是以无 callback 作为排除证据。隐藏策略目前在实验 driver，未形成生产授权 API。
- 允许空目录首次新增 Markdown 产生 NOTE_WRITE；父目录新增两层后有 hint，显式安全补登记得到两层清单。实际原地改写已有子 Markdown 时父目录 flags=0：证明不能把目录监听当完整正文变化观察，正文消费者保持独立。
- 达 8 个时第 9 个拒绝，既有 8 个保持；symlink、`.git`、missing 路径安全打开拒绝。注入在目录 fd/kqueue 均创建后的失败 100 次，`/dev/fd` 计数前后均 6、活动登记为 0。不是实际系统耗尽或所有原生错误组合证明。
- 登记目录后将原对象改名、原路径创建新目录：旧登记收到 NOTE_RENAME，fstat 身份不变；显式另登记新路径获得不同身份，不自动绑定替代对象。此处只证明 fd 绑定，不证明旧对象移动后仍被授权。
- 关闭旧登记后其 fd 的 `fstatSync` 返回 EBADF；随后新登记实际复用了 fd 数值 6。旧 token close/poll 返回无效，未伤及新 token。最终全部登记关闭、计数 0。1000 次零 timeout poll 约 12.91 ms，是本次有限空轮询观测，不是应用性能门禁或生产调度方案。

限制：实验没有生产 Root epoch/完整存续授权检查、隐藏切换的在途事件失效、scanner inventory 协议、全局 watcher 预算与退出调度，不能据此宣称这些已实现；注册前后恶意并发替换的完整 race 矩阵也未穷尽。安全链验证了逐级 nofollow 与打开前后身份核对，移动后的旧 fd 须由未来处理前链/epoch 核对撤销，不将仍有 fd 等同仍有授权。PoC 当前为实证候选，待独立 verifier 核对后主线决定可行并批准最小生产接入；未产品验收、未版本/构建 App/Git。

### 2026-10-05 PoC 独立结论与生产最小接入方案（待批准）

独立 verifier 已实际复跑隔离 PoC 并通过，主线完整读取实验源码后确认机制可行；不补造未提供的断言数量或耗时。上述实验局限继续成立。用户授权验证通过自动继续，本节先明确生产最小接入，批准后实现，不复制实验的 static registry、uint32 token 或每登记一个 kqueue。

1. **私有原生实例。** 在现有 Node-API addon 新增 branded opaque 实例，由每个 scan Worker 的环境私有持有；实例内一个共享 kqueue、受控目录登记表及单调不复用登记身份。对外不暴露 fd，不通过数字 fd 查找登记。add/remove/poll/close 验证实例/登记归属及关闭状态；重复 close 幂等，旧事件/旧 token 不影响 fd 数值复用后的新对象。固定登记数量、目录 metadata 字节及单批事件上限；资源成功关闭前仍计账，构造或登记失败回收所有已分配资源。环境终止清理作为兜底，不替代正常显式关闭。
2. **既有 Worker 串行调度。** 扩严格 `scan-protocol` 私有操作，由现有 owner drain 唯一串行调用；cleanup 优先，其次显式扫描/手动任务和有界自动工作，短零等待 poll 在已有任务间让出。没有第二个永久 Worker、同步阻塞 UI 或无限原生等待。事件队列只消费有限批次；积压或失去精确事件信息时将对应根标需全量核对，不能宣称无丢事件。定时器只有一个、可取消，不创建每目录 JS 轮询。
3. **完整 inventory 与树分离。** 安全扫描另产出包含根及所有允许目录的有界身份链 inventory，含空目录/无 Markdown 目录；不将这些空节点强塞可见树。所有根共享预算，扫描候选、旧 inventory、登记待释放对象及暂存批次共同计账。只有根 complete 且 inventory 完整、身份有效后才建立自动观察覆盖；partial/paused/failed、额度不足或注册失败明确显示“自动观察受限，请手动重新扫描”，不是已同步/静默重试成功。恢复沿用户已有手动重扫；不进入紧密 NOT_READY 循环。
4. **授权/epoch 与 generation 分离。** 独立 watchEpoch 绑定根授权、隐藏策略和完整目录身份链，不直接绑定树 generation。正常候选接受增代且身份未变时保留登记；隐藏变化、根吸收/撤销、clear/dispose 同步失效 epoch，排入优先清理，迟到事件先按 epoch 丢弃。注册前和消费事件前通过安全 openat 全链复核，任一祖先/根身份变化使旧登记无效并注销，不在同路径自动重新授权。移动后仍持有 fd 不是有效授权；异步关闭期间不处理失效事件，也不声称内核瞬间不再产出事件。
5. **事件只是核对提示。** 每根至多一 dirty 位及受控 pending 状态，合并突发事件；无 filename 也能核对，不无限保留事件名。后台调用既有 prepare/issue/accept/query 安全服务，不从 hint 直接编辑节点。新增目录经安全 inventory 补登记后至少再做一次 catch-up 核对覆盖注册窗口；零差异候选释放不 commit，不无意义增代，避免扫描/登记本身触发自激。inventory 变化和可见 Markdown 变化分别比较，空目录变化可只更新登记，不伪造树差异。持续变动时有界让出/重排，不承诺某个磁盘事务时点或硬耗时。
6. **手动优先与结果纪律。** 自动候选在提交前遇手动重扫/隐藏/移除等即取消让位、释放占用，不能让用户操作长期 BUSY；已提交事实保留，unknown 仅查原 operation，不另发新 accept。普通 Root-local open 屏障拒绝时安全保留旧树并受控延期，不冻结正文或扩展全局 save barrier。后台结果沿 F-027d 所有 refresh 的 captured 前缀/staging 原子发布，roots/nodes/coverage 一致，稳定 handle 的选择/展开/焦点保持。正文/基线/undo、F-028c 和已打开文档授权生命周期不随树删除而重写。
7. **最小可见状态。** 仅在既有根状态处增加严格受控观察状态（建立中/观察中/受限），不把“观察中”说成磁盘最新或事务同步，不新增按钮或设置。扩共享 schema 与 runtime validator、状态快照比较及中文呈现；前端仍通过已有轮询读取，不增加任意原生/RPC入口。错误无正文/路径日志，手动失败文案不被后台 poll 清掉。

生产最小验证：真实 native + 服务测试覆盖多根空目录首次 Markdown/新增层级 catch-up、目录登记排除、同身份保持与替换拒绝；受控交错覆盖 hidden/revoke/dispose 晚事件、fd 复用、预算及部分失败、手动抢占自动候选、open BUSY、unknown 不重提交。静止目录重复扫描后不持续触发自动 commit/增代，持续突发输入资源仍有界；受限根不能被标观察中。协议恶意对象/超量 inventory 拒绝。WK 实际不点重扫地验证临时 Markdown 增删进入树、dirty/选区/undo 保持、隐藏开关与受限提示边界及正常退出；内部测试不冒充自然窗口操作，离线仍留最后人工。

当前只方案与 PoC 收尾，没有新增生产代码。下一步待主线批准本节后实施，再由独立 Spec/Standards 审核，主线构建和真实 WK 验收。

2026-10-05 主线批准上述生产最小方案实施，并明确：首次完整 inventory 安装后无条件一次 catch-up；此后仅新增登记或真实 hint 再标 dirty，防止自激。同路径不得重新授权针对 Root/根授权祖先；原 Root 授权仍有效时，子目录替换或改名后可以安全扫描派生新身份登记，不推断 documentId 跟随。当前进入实施，未验收，不改版本/构建 App/Git。

### 初版实施与局部检查点

生产采用单 Worker 内一个 Node-API 实例/共享 kqueue。原生每环境最多 512 个目录 fd 与 8 个实例；生产仅创建一个实例。TS retained inventory 与待安装 inventory 合计最多 512 项/2 MiB（不是可承诺观察 512 个目录，双份暂存也计入），共享原扫描 queue 的 2 MiB 总预算，并将 observation metadata 纳入现有服务 4 MiB 元数据总账；这些是安全资源保护，不是性能目标。每 poll 最多 64 事件，目录安装每次最多 16 条链并让出，单个 350 ms timer 仅唤醒 owner drain；完整 inventory 另做安全全量遍历，不称增量优化。

仅 complete 根建立观察，partial/paused/failed 或资源失败显示受限，手动恢复；首次/新增登记补查，零可见差异释放候选。手动操作取消自动候选；issued 手动回执丢失由 30 秒有限候选租期处理，释放占用之前同步 fence/release，迟到 accept 不得提交，pending 已发接受不按这个期限猜结果。unknown 自动回执只最多查询原 operation 3 次，不重发 accept；仍未知则受限并保留历史事实。真实所需耗时不承诺硬有界。

初版 manager/实际服务两文件 31 项、207 断言、5.38 秒通过，日志 `/tmp/agentic-f027e-service-tests.log`；含自动增删、稳定 handle、静止不持续增代、失落 issued 回执后他根继续及过期操作拒绝。生产登记新增 trusted-test-only 检查回调，用实际 fd fstat 身份及登记路径集合验证隐藏 off/on、.git/目录 symlink 排除，不进 RPC/UI。原生专用测试由独立作者维护。首次 typecheck 因目标库不支持 Array.at 失败，改索引后 typecheck 通过；lint 曾报未知响应类型与导入顺序，修正中。当前不是最终测试或独立验收结论，尚无本片 App 构建/真实 WK/Git。

独立预审指出并修正两个真实边界：关闭失败不能丢失 cleanup key；手动 prepare 成功但 issue 无预算时必须释放候选。现在 close 最多按 timer 间隔重试 3 次，期间不 poll 旧登记或新装覆盖；仍失败使用 watchDispose 关闭整个观察实例，确认 bytes=0 后才释放计账并暂停观察等待显式恢复。该关闭再失败则终止当前扫描 Worker，由原生环境 cleanup 回收；保留旧树，新增明确“目录后台已停止，请重新启动应用”，不误称手动重扫可恢复已终止 Worker。普通 limited 才保留手动恢复。真实服务受控失败测试 1 项/5 断言通过，日志见本轮终态追加；低剩余预算 issue 失败后其他根 prepare 可成功的测试 1 项/2 断言通过。未宣称在本机制造了真实 kqueue 系统故障。

补齐在途预算预留：watchStart/tick 调用前将可能新增的 metadata 计入 observation.bytes，实际回执先更新计账再解除等待；回执失败保守保留预留，待实际关闭确认释放。手动任务先占有独立 record、抢占自动任务，等待当前 metadata/取消清理结算，再开始候选，不在单一 drain 内自等。并发同根 prepare 不删除前一 record，未过期 issued 返回原身份，结算核对 session+sequence。首次 catch-up 完成前仍显示建立中；建立过程每有界批次让出后继续 drain，不是每个目录都等待 350 ms。无根时不发 watchTick；终止异常停 timer。

组合定向检查曾出现 42 项通过、1 项失败（296 断言）：关闭重试预期 3 次、实际 4 次。核查发现同一隐藏动作的两次 cancel 重置了未完成 cleanup 的计数，现取消该重置，保持累计有界重试；修后该实际服务回归 1 项/5 断言通过。失败日志 `/tmp/agentic-f027e-targeted6.log` 保留，不将此前单独绿灯作为最终组合验证。

随后 manager、实际服务与 observation 三文件组合 43 项/298 断言、5.12 秒通过（`/tmp/agentic-f027e-targeted7.log`）；typecheck 与全 lint 通过（`/tmp/agentic-f027e-typecheck7.log`、`/tmp/agentic-f027e-lint7.log`），功能文档/义务及 diff 检查通过。独立作者仍补充 cleanup/在途预算的 adapter 证据，最终独立审核及 App 构建/实际窗口验收尚未完成，不能据此记作通过。

上述修正前首轮全量 796 项/19949 断言/129 文件/20.51 秒通过，日志 `/tmp/agentic-f027e-source-initial.log`，不冒充最终修正后全量。后续 manager/服务专项 32 项/209 断言/3.99 秒通过，日志 `/tmp/agentic-f027e-targeted4.log`；最终全量、独立评审和真实 WK 仍待完成。

### alpha.97 受托代验完成候选（2026-10-05，当时阶段）

独立测试作者最终 adapter 15 项/123 断言/235 ms 通过，补齐关闭重试/升级终止、重复取消不重置计数、在途预算与 settle、抢占晚回执、dispose 不复活；专项格式/lint 和全仓 typecheck 通过。主线最终源码 803 项/19994 断言/129 文件/19.69 秒通过（`/tmp/agentic-f027e-source97-final.log`）；包内 Bun 运行仓库测试 803 项/19995 断言/129 文件/19.41 秒通过（`/tmp/agentic-f027e-packaged97.log`），两次断言数按实录，不冒称全部测试资源来自包内。typecheck/lint/文档检查通过。构建 alpha.97 成功，保留 chunk/hdiutil warnings；实际包 `/tmp/agentic-markdown-alpha97.k9nvra/Agentic Markdown-canary.app`，hash `udloagu11y9s`。主线 Standards 0 额外阻断，与独立 Spec 分 lane；因并发槽限制，不宣称两个独立 subagent 代码评审。

真实 WK（launcher exec 4325，Bun PID 1665）：

- alpha 根隐藏 off、自动观察中，打开 cover 167 字节 clean；将 `SELECT-ME-XYZ` 替换为 `SELECT-ME-XYZ-TEMP`，选中 `XYZ-TEMP` 并保持 dirty。外部新增 `empty/first.md`、`new/deep/second.markdown` 后未点重扫即自动出现，AX 选区仍为 `XYZ-TEMP`，展开核对叶节点；继续新增 `deep/third.md`、删除 Agent 创建的 first 后自动出现 third，empty/first 消失，deep 仍选中。undo 回 clean、redo 回 dirty 成功。
- 加入 beta 和独立 loose（62 字节），cover dirty 保持。alpha 隐藏 on 后外部写入 `.hidden/live.md`、`.git/never-visible.md`、`beta/live-beta.md`，`.hidden` 展开可见 live/secret、`.git` 未出现，loose 正文保持 clean；UI 不见 `.git` 不替代生产实际登记列表的排除测试。
- 将 beta 移至 beta-held 并创建替代 beta，原根显示受限且不接纳替代目录；将替代目录保留为 beta-replacement、原对象移回，手动重扫恢复观察中，再新增 recovered 自动出现。隐藏 off 后隐藏项消失。
- 浅色截图可辨；跟随系统设置下当前深色截图可辨，未动态修改系统主题；最后恢复固定深色。dirty 退出确认选择继续编辑后，新增 `alpha/after-cancel.md` 仍自动出现、dirty 保持。undo 还原 TEMP 至 clean 后，两份 clean 文档正常 `⌘Q` 退出，工具返回 App quit，PID 1665 不存在、launcher 退出码 0。输出 `IMKCFRunLoopWakeUpReliable` mach-port warning 仅记录，不推断原因。

未保存用户文件。主线使用 Bun readFileSync 严格断言 cover 全文等于原 fixture（167 字节）、loose 全文等于原 fixture（62 字节），两项 PASS；不是由 UI clean 推断磁盘不变。预算/清理失败/终止等有受控测试，未在真实 UI 制造这些故障；EV_ERROR 仅源码错误分支核对，未实际注入，自然竞态未实操；动态系统主题、离线未实操。当前仅受托代验完成候选、待最终独立结论，不提前通过或 Git；父功能、完整 OBL-005/016、OBL-011 延期和 F-028c 继续开放。

### 最终非离线本片结论（2026-10-05）

最终独立 verifier 确认 0 剩余阻断，主线确认 F-027e alpha.97 非离线本片受托 Agent 代验通过，非用户亲验。上述候选阶段和失败历史保留；本结论不扩大实际证据：EV_ERROR 未实际注入，预算/清理/终止等故障的受控测试不冒充自然 UI 故障。Git 仍待主线实际执行，未预写成功；父 F-027、完整 OBL-005/016、延期 OBL-011、F-028c 与 F-027e-offline-final 继续开放。
