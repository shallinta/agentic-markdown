# F-062a：当前窗口持久文档 MRU 与 Quick Open 空查询

## Git收据（2026-10-18）

已提交推送`1feac5a2f155e30bb50e57a5eef7caba267a7119`，HTTPS ls-remote及origin/main核同SHA。hook前后tree `64b8d12149e1dd3000825f0c013d65fccc220c07`一致；以下尚未Git均为阶段历史。本收据自身随后续文档提交，不扩大有限验收范围。

## alpha184 有限非离线片批准通过（2026-10-18）

最终独立Spec及交叉Standards前后端均0必要有限验收阻断；主线核实际证据与剩余边界，批准受托Agent有限代验通过，非用户亲验。Git待实际执行。下段待批准为批准前阶段记录，不扩大未测范围。

构建hash `16x4mfcqck1do`，源码1735/0/38019、包内Bun运行仓库1735/0/38018；有限真实WK检查完成，待独立最终复核与主线批准，非用户亲验、尚未Git。实际矩阵及保留观察见末节；新建/复制的MRU接纳、自然IME、真实OS故障、极端大树与离线未实际验证，不能冒全覆盖。原FINAL001002003与完整父/专项边界保持。下方构建中/未实施等文字为阶段历史。

## alpha184 构建批准（2026-10-18）

主线最终源码 `/tmp/f062a-source-tests-budget-final.log`、session99459 exit0：1735/0/38019、233文件36.22秒。静态session50012 type/full lint/docs/lock/diff全部通过。独立Spec全片48/0/275及预算补17/0/87，交叉Standards后端10/0/84与前端48/0/258均0必要构建阻断。主线读实际接线并批准递增alpha184及unsigned构建/真实WK；尚未验收，不得Git。原FINAL002失败保留，不因本次全绿称修复；下方待批准/运行中是阶段历史。

> 状态：alpha184有限非离线片已受托Agent代验并经独立最终复核、主线批准通过；尚未Git，完整父义务及未测范围保持开放。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## 功能说明与前置

依据总账第152条/N-07：仅成功持久打开或用户实际激活更新最近顺序；预览、后台恢复、索引访问不计入，关闭标签不删除。按 documentId 记录，保存 canonical path 作安全重绑定线索；与 mtime 无关。Quick Open 空查询显示仍存在且属于当前窗口统一集合的最近文档，非空仅在匹配质量同分后使用 MRU。无收藏入口。

F-029a 的 `recent-files.ts` 是独立文件系统选择器历史：按 path 去重，id 独立生成，只有 `onStandaloneSelected` 写入；不能直接冒充 N-07 MRU。其欢迎页重选/清除保持原样。复用现 settings store 有界持久化机制，不称完整 F029 根/树/平台持久授权恢复已完成。OBL-033/040 仍由原承接者负责，本片无直接归属义务；F063 已承接 OBL-017/025 的查询成本/取消合同不能被本消费者绕过。

推荐本片交付正常单主窗口的有界持久 MRU，当前已授权集合内展示/打开。跨重启条目保存在元数据，但用户尚未重新授权的根/文件不出现；可以经已有普通加入文件夹/文件或欢迎页重选重新授权，不能从 MRU 路径静默授权或读取正文。移出集合/缺失/歧义隐藏，关闭标签不隐藏仍属集合者。原专项、F028c、阅读子窗口与完整区域路由不推进。

## 已确认的真实接点与路线候选

- 文档后端 `identities` 当前是内存 map，`commit` 用 path:fingerprint 查前身份，否则生成新 documentId；fingerprint 真实为 dev:ino:birthtimeNs，不是内容 hash。
- 正常原子保存会更换 inode，后端保存提交已将所有同 oldKey grant 改为新 fingerprint，并保留 documentId。因此 MRU 身份证明必须在这个可靠成功点更新，**不改变最近顺序**；不能只在初次激活存一次旧 fingerprint。
- renderer `load` 的成功接纳与 `activateTab` 是当前实际打开/激活接点；仅 observe 或后端 read 成功不能算用户激活。选择取消、读取成功但迟到丢弃、后台扫描均不得刷新顺序。
- Quick Open 当前复用受控 metadata snapshot/联合4MiB预算，空输入仅提示。加入最近项须沿原 scope/ticket/普通打开与 probe 暂停合同，不另建无界查询索引。

候选 A（推荐）：独立 `document-mru` 小模块/版本化设置文件，复用现 settings store，而非修改欢迎页 recent schema。建议沿现有限20条作为本片实现参数，record只存 documentId、可信 canonical path、文件fingerprint和单调最近序号，不存正文、编辑缓冲区或可复用授权。服务端根据当前有效 opaque handle+documentId 取可信路径/身份；不接受 renderer 自报路径或时间排序。重复/迟到激活须用本窗口单调序号与会话token拒绝旧消息反超，队列有界且按同记录可合并；持久化失败不阻断正常编辑，明确降级提示并保留错误。

候选 B：仅当前会话 MRU，留跨重启后续。实现较小，但无法交付总账已确定的持久 MRU，故不推荐默默采用；如 A 具体接点不可行，再由主线决定切片而不改原产品目标。

## 最小接入合同（须路线复核后细化签名）

1. renderer 在持久 load **最终接纳**或用户 activateTab 成功后发一次受序号保护的激活事件；保存、重读、根重扫、自动关闭选中邻标签等不是实际用户激活，需逐入口显式区分，不能单靠 snapshot 变更订阅推断。记录目标须仍属当前统一集合；后台打开消费者未来必须明确标识，不能默认所有 read 都计入。
2. 后端 startup 有界加载MRU。仅在已有授权完成、snapshot 稳定读与最后异步 capability 检查结束后，路径与 fingerprint 均一致且无歧义，才同步选择其历史 documentId，再交原 commit 复核；否则使用新 id，不继承旧记录。复制拥有新fingerprint/id；删后同路径新建不因路径或相同内容继承。已有文档身份优先，不能为MRU更改已在本会话使用的id。设置损坏/未来版本不能擅自覆写；失败回退新身份并明确MRU不可确认，不影响打开。
3. 保存成功的已知 oldKey→newKey 迁移只刷新原条目的身份依据；SAVE_UNCERTAIN 不猜新身份。需保证保存后正常退出/重启不会因旧证明错认或丢失连续性；更新失败保守隐藏无法重绑记录，不用内容相同猜身份。可靠重命名/移动消费者未实现，继续父项后续，不以path-only追踪替代。
4. 展示时以最多20条为输入，对当前独立grants/目录files可靠证明做有界匹配，不扫描磁盘全集或读取正文。目录尚在扫描时只显示已被当前集合确认的条目，错误/替换/缺失记录隐藏，不把历史路径当权限。根移除重加、代数/隐藏变化与迟到结果沿F063换代规则；如果仅后端扫描proof尚不足以证明仍存在，要明确复验策略，不能承诺仅缓存即实时存在。此接点与跨重启首次身份接纳是实施前必要调查点。
5. 空查询显示有界MRU；非空排名先沿冻结 match tuple，只在同分后按MRU序号，再沿稳定根/路径/opaque键。激活顺序更新使当前查询按明确版本重新计算，不能异步旧MRU覆盖新输入；持久store异步延迟不允许结果忽新忽旧。保留“已加载集合不完整”提示与无记录空态，不扩大窗口外重授权UI。

### 接点调查补充

实际 documentId 在后端 `snapshot()` 返回前就决定，随后 `commit()` 记录；不能在 commit 后改 id 而让返回值/镜像/当前映射不一致。候选接点应为 snapshot 已完成授权和稳定读后的同步、已加载有界 MRU lookup（优先已有 identities），commit 继续原验证；startup 读store须在接收此类请求前准备好或明确不可用回退，不能在底层同步 commit 中插入无边界异步I/O。这是路线设计，尚未实现或验证。

实际 renderer `load(select, entry?, open?, createdIntent?)` 同时承接重读与打开，不能在所有 load 成功后无差别record。需最小显式 activation purpose：普通select/openWorkspace/未开entry显式激活/用户采纳新建或副本属于成功常驻打开；reload不是。`activateTab` 现只有用户tab按钮与 `activate(entry)` 调用，可在成功发布后record。`closeTab` 自己选择邻项而不调用activateTab，保持不record。未来后台恢复传非用户purpose，不能默认继承。

MRU协议响应/renderer20条索引也必须计入F063现有4MiB成本模型：已加载MRU snapshot及同分rank map作为额外有界metadata成本，版本更新在明确owner下取消旧query；probe响应核算同时看到该成本，不能每方各拿4MiB。最多20项仍不等于零成本。当前元数据目录files proof只在服务端，不向前端泄露原生指纹；建议窄listResolved请求返回当前root/generation/entry或独立handle及rank，结合现前台集合双重过滤，不返回未授权路径作为可打开对象。操作严格有界且可取消；是否需要短descriptor复验由现授权接口核定，不建立全树扫描。

### 两轴与主线指出的必要合同收敛

**身份唯一与异步边界。**store schema 拒重复 documentId、重复或歧义 path/fingerprint 绑定；恢复 id 前同时检查当前全部 identities/grants 活跃绑定，不仅查询同 identityKey。旧记录若与另一活跃文件占用同 id，隐藏/不恢复，不覆盖活跃映射。snapshot 原来在 capability await 前决定 id；候选实现须把恢复判定置于最后异步检查之后并在原 task/generation 仍有效时同步完成，不能把 await 前通过的唯一性当 await 后仍成立。commit 继续验证任务，不能改已返回 snapshot 的 id。

**单份服务端权威与保存迁移。**document-MRU 模块持最多20条的当前权威与递增 revision，所有 activation 与已知 save 迁移先同步更新此权威，再经唯一有界持久写队列写完整版本快照；磁盘写必须串行、只提交当前或更新版本，不让慢旧 activation 快照覆盖新 fingerprint。renderer 窗口绑定的服务端生成 session token + 单调 activation sequence 只表达该窗口事件先后；token归当前webview/window生命周期，不让任意旧session重置序号，重复/低序号拒绝。服务端处理事件时立即核有效handle/documentId并捕获当时可信 grant.path/fingerprint，不能到写盘阶段再从已释放handle猜目标；已释放/换代先发生则拒该事件。收下事件后release不删除MRU，但后续展示仍需当前集合过滤。事件真正被前端接纳前不发送，新建/副本的 backend committed 不计入，最终adopt成功才算。

原子save：在 `written.ok` 后与已有 identity/grant oldKey→newKey 同一同步提交段记录证明迁移，先于后续 watchGrant/capability/RPC响应可能抛错的附带动作；迁移只更新该 documentId 原绑定证明，不改变activation序号。旧fingerprint activation写入必须在捕获时/同步权威入口核当前版本；若activate在save后才处理，捕获新证明，若先处理，随后save迁移覆盖它。SAVE_UNCERTAIN无可靠迁移则不猜。异步store失败保持本会话当前权威+明确警告，正常退出复用 `start-desktop-app` 已有 recent.drain 所在收尾增加MRU drain；失败不得把正文save成功改为失败或声称其持久性降低，也不得无限阻止退出。重启只信已成功落盘且复验通过的证明，旧落盘证明不匹配时隐藏，不按内容猜。

**listResolved 实际短复验路径。**最多20条MRU，对当前 workspace 根的 `root.files` /独立grant匹配候选：目录使用 `bun/workspace/authorization.ts::authorizeEntry(root.authorization, file.path, file.fingerprint, file.chain, showHidden, check)`，其内部 `verifyRoot`、`authorizeSingleFile` 和祖先链校验已存在；成功后再次核 root 对象lifetime、generation、同 file 对象及MRU revision，立刻关闭返回file descriptor，不创建文档grant、不读取正文。每次 await 前后 check取消/换代，输出 opaque root/generation/entry。独立项在现可信grant中取path/证明，用 `documents/path-authorization.ts::authorizeSingleFile` 获短descriptor并经 `verifySingleFileAuthorization` 核同证明/原grant仍有效，立即close；不直接读历史path、也不复用不存在的长期打开fd。即使当前路径存在也须 fingerprint 一致，不以mtime/hash代身份。

resolve 走单最新任务、一次只保一个短descriptor，前台变更/保存准入后取消旧解析；复验调用不得 `enqueue` 一个会反向等待自身保存屏障的循环任务。原生文件校验仅在现有授权内，不能凭MRU记录扩授权。保存刚换inode而扫描proof仍旧时结果暂隐藏/不可确认，等待正常扫描更新后重试；不把缓存落后、paused、权限不明或取消当可靠删除惰性清记录。真实根移除/重加与文件替换均重新核，不向前端暴露未授权路径或fingerprint。正式签名与现scheduler绑定仍待主线/两轴复核，不新增实验。

**有界查找与退出交接补充。**目录候选优先每条MRU path查询每根现有 `root.byPath`，再按 node.handle 查 `root.files`，至多20条×现有32根，不全扫files、不调用默认会触发syncAssets的workspace.state冒纯读；长链复验仍用现有check边界。MRU仅20条保存其身份关联，淘汰后不能承诺跨重启恢复该documentId，更不是所有文档身份恢复系统；属于MRU有限记录，不改变完整F029/会话身份责任。

正常CmdQ不仅drain后端已入队记录：renderer维护已发送activation的单调ack水位/有界未确认集合，在现discard-guard beginDiscard冻结新激活之后，通过独立可选 `waitForActivationRecords` 收尾等待先前激活请求明确ack，再进入原退出流程；不把它塞入saveDrain或更改是否放弃正文的选择语义。持久化失败/transport不明只显示中文非阻塞警告“最近文档记录可能未完整保存”，写匿名错误码，不新增确认弹窗；有限等待结束后继续原退出。无dirty仍不弹确认，有dirty仍仅原正文保护。不能假称最后激活必落盘。

后端activation只在当前grant绑定/当前MRU权威同步核验与有界store队列提交，不等待退出已持有的文档writeBarrier，不做正文读写，避免退出wait→activation→同barrier死锁。服务端ack明确区分已持久确认与已接收但持久失败，退出drain须覆盖MRU版本，不能仅以RPC发送成功当落盘。取消原dirty退出后解除本方冻结，旧迟到ack不能重激活文档或抢焦点。

### 最小 typed 接入合同（方案，未实施）

共享叶模块 `shared/document-mru.ts`，严格字段/UUID/序号/数量/字节校验，不含正文。服务端实现 `bun/document-mru.ts`，renderer局部 `client/document-mru.ts`；RPC绑定现同一个主webview，不增加客户端可自选windowId。协议建议：

```ts
type MRURecordRequest = {
  protocolVersion: 1; requestId: string; session: string;
  sequence: number; handle: string; documentId: string;
};
type MRUAck = { requestId: string; session: string; sequence: number;
  status: "persisted" | "unavailable" | "stale"; revision: number };
type MRUResolved = { documentId: string; rank: number } & (
  { kind: "root"; root: string; generation: number; entry: string } |
  { kind: "standalone"; handle: string }
);
// 会话创建/读取不授予新文档权限。
// beginMRUSession({protocolVersion,requestId}) -> {session,revision,available}
// recordDocumentActivation(MRURecordRequest) -> MRUAck
// resolveDocumentMRU({protocolVersion,requestId,session,sequence})
//   -> {requestId,session,sequence,revision,items:MRUResolved[],incomplete}
```

session 由主进程针对当前主webview生命周期生成并保存，bootstrap在该renderer初始化仅执行一次；重复相同bootstrap请求幂等，旧webview退出/重载会话失效，旧session请求不产生写入。renderer在每次实际激活同步取得seq并把最小handle/id事件收入有界队列，bootstrap未完成也不漏最后事件；队列满明确告警，不能声称完整持久。发送顺序保持seq，服务端拒低/重复seq导致的反向排序（精确重复返回原ack事实或已持久高水，不重新record）。正常flush固定冻结时frontier，等待此前已捕获事件含bootstrap后的发送与ack，不捕获未来激活。

主线确定退出本片采用 **2秒共享软截止预算**（实现参数，非性能SLO），不复用全局310秒RPC等待。主进程开始metadata收尾时建立唯一截止点，把剩余预算传renderer独立flush接点；renderer ack等待与后续backend drain共同消耗该预算，不能各等2秒，主进程外层确保截止后不再无限drain。逐请求可复用现RPC `maxRequestTime` 覆盖参数，但退出只等剩余预算；不依赖跨进程性能计时器起点相同。超时仅停止等待、中文非阻塞警告和匿名日志，不新增无dirty确认、不虚称取消底层settings I/O或已发RPC。晚ack仅结清元数据任务，不激活/抢焦/复活退出scope；告警本身失败也不阻止原退出。

record handler无await地验证当前session/seq与可信grants/identities并capture元数据、同步提交MRU权威，然后只等待独立store串行写ack；绝不调用documents.enqueue/read/withWriteBarrier/descriptor。可靠save迁移调用同模块同步 `migrateIdentity(documentId, oldPath, oldFingerprint, newFingerprint)`；捕获后与record都按当前权威revision递增，异步写只用已捕获不可变快照。renderer退出冻结→固定frontier发送/ack→原dirty保护结果→后端MRU drain；仅metadata ack与drain共用上述截止预算，用户回答原dirty弹窗不设新超时，若该时已超metadata截止则drain不另开预算。后端外层writeBarrier不阻挡record handler。普通save返回语义不等待MRU磁盘持久化，不改变正文durability承诺。

resolve在workspace拥有局部单最新请求token，无新通用scheduler；以session+sequence替换旧解析，每条候选前后检查token及MRU revision，并捕获root对象/generation/file对象或独立grant对象。串行最多20条×32根byPath lookup及一个短descriptor；每个候选之间让出事件循环。开始前若保存/授权变更忙则返回incomplete/不可确认，不等待已持屏障；执行中每个await后检查现有文档/根代数，变化则旧响应丢弃并关闭自己的descriptor。根移除/clear/dispose主动使token失效，resolve不持有跨用户操作的文档锁，不创建grant。失败不清历史，返回不完整提示与经核可用项；但最终renderer只能接纳同请求/同MRU版本/同metadata snapshot的结果，不能把旧完成结果混入新集合。rank map与响应保留成本同时纳入workspace查询预算，budget不足整体明确拒绝，不部分伪完整。

以上签名是本片最小建议，普通技术调整限同语义；不新增无dirty弹窗、额外授权或跨窗口产品选项。实施前需两轴确认，无新探针授权。

### 实施前最后两项合同

硬链接沿现 `path:fingerprint` 绑定：不同 canonical path 即使 fingerprint 相同也分别有documentId；schema只要求id和path各自唯一，不要求全局fingerprint唯一。重启精确path+proof各自恢复；现保存层拒绝多硬链接文件，本片不放宽。普通单链接文件成功原子保存只迁自身 oldKey，不重排其他记录。损坏重复id/path拒绝，历史id被其它活跃绑定占用则不给新文件复用。21条淘汰不清当前identities，同会话再次激活沿当前id；淘汰项跨重启不承诺恢复，不新增inode全局身份或无界tombstone。

session由单主BrowserWindow宿主首次top-level dom-ready建立，begin仅返回当前token/高水，不自行轮换。受控reload在派发前设transition，真实dom-ready轮换；合法committed:false仅取消同transition对象，不能回滚已发生的新load。transport未知/malformed保持元数据不可用，直到真实load事件；begin最多等待2秒后返回不可用并降级告警，后续真实交互可有界重试。重复bind/无transition重复dom-ready不重置序号。关闭/dispose失效token；非受控全页刷新不承诺独立新session，但沿当前高水不回退。无需document barrier，旧已捕获record可完成原快照写/ack，不重新排列新会话。公开SDK出处和测试界限见实施接点节。

## 继承约束

- **中文与外观**：中文最近提示/不可用提示；复用Quick Open浅深及有限虚拟列表，长路径不改变身份。
- **命令与键盘**：沿既有⌘P、方向键/Enter/Escape；不加冲突快捷键，不改变确认后焦点ticket与原选区。
- **安全与日志**：元数据不是授权；严格有界协议和服务端handle验证，匿名日志不含正文/路径，不通过MRU打开未授权文件。
- **F-002**：本地离线优先；不自动断网，离线验证留最终人工登记。

## 最小 happy path 与验证计划

两根各含同名文件，加独立文件；依次成功打开A/B、再激活A，空查询A在B前，关闭A仍能在当前集合找到；后台read/扫描不改变顺序。非空匹配质量优先，只有同分才MRU。记录无需正文读取。

正常退出并重启：未授权时隐藏，显式重新授权原文件/root后可靠同身份恢复；同路径替换/复制不继承，正常原子保存后的原文件保持记录。移出根隐藏、重新加入须重验；损坏/未来/写失败不破坏文档或旧settings。确定性用例覆盖乱序激活、迟到/取消未接纳、保存身份迁移、预算与重启，不能只测store排序。

真实WK再核⌘P空态/同分、关闭标签、dirty/源码/只读/原选区和undo、浅深、正常退出与重启重授权。自然IME/离线/极端规模如未实操如实登记；测试不替代真实验收。

当前已由主线批准候选A/20条有限实施；代码验证中，尚未构建或验收，不改变前片F063a最终批准/Git状态。

## 实施接点与中间证据（未冻结）

上节生命周期合同以本段实际公开接点修订：本地 `.hutch/devkit/api/preload/events.ts` 的 `initLifecycleEvents` 在 top-level load 发 `dom-ready`，公开 `BrowserWindow.webview.on` 接收事件。宿主首次绑定紧随同步构造窗口返回，在事件循环交还前注册；首次 dom-ready 生成 session，受控 reload 的活跃 transition 在 dom-ready 时轮换。重复绑定/无 transition 的重复事件不清序号；合法 committed:false 只取消同一个 transition token，不能回滚已发生新 load。transport 丢回执或 malformed 不能推断未 reload，保持元数据不可用至真实事件；begin 最多等2秒返回 unavailable，前端只在真实交互/集合变化重试并中文告警，无无限定时重试。非受控全页刷新不承诺独立新 token，沿当前高水不回退。窗口 dispose 使旧 token 失效。

硬链接实施校准：现 `save-operation.ts` 对 nlink≠1 拒绝，文档资格层返回 READ_ONLY；前述“保存A迁移”不表示开放硬链接保存。正式用例分开验证硬链接两个路径分别恢复 ID、保存仍拒且 MRU 不变，以及普通单链接文件成功原子保存只迁自身 proof/rank不变。首次新增测试误期望硬链接保存成功，3/1/45；纠正到拒绝后又错误期望底层 UNSUPPORTED_SAVE，4/1/49。主线核现有规则批准校准，未改生产保存边界或旧测试。

后端当前四文件 `shared/document-mru.test.ts`、`bun/document-mru.test.ts`、`bun/documents/document-mru.test.ts`、`bun/workspace/document-mru.test.ts` 实跑8/0/70。覆盖真实store20条与精确重放、生命周期重复/旧取消、hardlink与真实原子保存、退出屏障内可信记录无环、独立及根 descriptor解析、替换隐藏、聚合后第一grant撤销拒旧响应。聚合至多20个原绑定复验闭包在 workspace 返回前及 service await后核，不将闭包发renderer。

施工首type仅日志白名单 mru.unavailable 缺项，补后全type通过；首次定向lint余6项 unbound-method/optional-chain已按真实无this契约修，待最终复跑。前端作者报告首次type同日志项、首4项lint及后require-await已修；其正常ACK fixture曾多出handle/id字段，改成严格wire并加无warning断言后38/0/191，旧38/190不当完整ACK路径证据。当前均仅自动验证，真实WK未运行。

后端新增 corrupt/future 原字节保留、真实写入路径拒绝与明确 unavailable、活跃ID碰撞 snapshot 新ID/resolve隐藏、root rescan 后聚合末核，最终四文件10/0/84。故障夹具首次 mkdir(document-mru.json) 得 EEXIST（initialize已创建默认文件），修为仅移除自建临时该文件后建立目录故障，保留2/1/41首红；未改产品代码/断言以冒通过。前端交叉作者之外实际复跑三文件38/0/191，尚在核联合预算接点，不据此提前验收。

前端交叉复核发现并由前端作者窄补两处：MRU新响应接纳联合原query暂存，目录移除prepare在浅复制前联合原MRU/响应/新增map账，拒绝不发布新图。随后非前端作者独立运行 client/document-mru、quick-open、discard-guard、folder-removal 四文件48/0/258（b4238f），0剩余必要前端构建阻断；不自批本人的后端。后端最终type22318/定向lint59057均exit0，docs/diff通过。4MiB仍是已有模型联合预算，不声称IPC分配前预知或真实heap/GC测量。尚无新包或真实WK，不构成产品验收。

主线旧候选全量1733/1/38009，233文件52.38秒；唯一失败为既有FINAL002 long-whitespace 19.014秒，保留不归因、不称修复。加入最终预算窄补后的budget-final全量session99459仍运行，旧候选结果不替代最终结果。前端预算窄补后的全type、定向lint及diff由前端作者运行64964/0a0716均exit0。

主线最终budget-final全量已完成：1735/0/38019，233文件36.22秒；静态session50012全绿，独立Spec预算补充17/0/87通过。此次全绿不关闭上次保留的FINAL002。主线已递增alpha184并批准构建，session54308运行中；尚未取得构建成功或真实WK验收结果，不预写通过或Git。后续实际验收使用隔离样本`/tmp/agentic-f062a-wk.st5mBW`，目前仅准备，不冒已测。

## alpha184 真实验收进行中（未批准验收）

构建session54308已exit0，hash `16x4mfcqck1do`。包内Bun运行仓库测试1735/0/38018，233文件35.34秒（session21396）；这是包内运行时运行仓库测试，不是包内嵌入测试或真实UI替代。以下为主线受托Agent在隔离样本`/tmp/agentic-f062a-wk.st5mBW`的实际WK中间证据，非用户亲验、非最终批准。

- 甲/乙两根同名文件打开并激活，最近顺序变化；关闭甲标签后甲仍在MRU，自动选择邻标签不重排；非空同分查询中甲按最近排序优先。
- 甲源码修改并选择源码文字后，经Quick打开只读文件再返回甲，精确选区、dirty与源码模式保留；直接⌘Z恢复clean，⌘⇧Z后⌘S正常保存。
- 保存前甲documentId为`a5e3324f-d433-4c6e-a3a8-495ff231a385`、rank为6、proof为`16777234:29907430:1792318748794205284`；保存后documentId/rank不变，proof更新为`16777234:29920406:1792318748794409493`。该证据只代表本次真实普通原子保存，不扩成硬链接保存支持。
- 正常⌘Q结束session43750，exit0且PID76893消失。IMK stderr保留，不推断原因。重开session17545/PID77345后，尚未授权时Quick空；显式重新加入甲root后显示一项，打开后诊断documentId仍为上述原ID，正文为已保存版本。
- 工具对重复phrase调用selectText曾返回`-10005`；后续唯一源码文字选区操作成功。保留工具失败，不归因产品或冒全部选区操作通过。

其余GUI检查仍进行；当前重开实例仍在运行，尚未记录最终退出、所有夹具摘要或完整验收结果。自然IME、离线、真实OS持久失败、非受控fullreload与极端大树仍未测。不得以本节中间证据预写验收或Git。

### 最终GUI补充收据（上述中间运行状态已结束）

- 重启后显式重新授权甲root，打开后的ID与保存前一致。独立文件经picker打开后，Quick空态两项依次为独立、甲；乙未授权，不显示。
- 正确选择甲标题并移除，选择“关闭这些文档”后，Quick仅独立一项；元数据仍保留甲、乙、只读和独立共4条记录，移出窗口不删除MRU历史。移除刚结束首次⌘P在忙状态未打开，随后重试正常，独立文档权限恢复。
- 深色与键盘选择浅色后的实际截图确认可读。AX点击浅色后立即Escape没有改变主题，改用键盘Up/Return成功；首次点击root的AX row实际碰到隐藏switch并改on，随后点击标题text正确选中。保留这些工具/操作观察，不判为产品缺陷。
- 设置未关闭时⌘P可叠加在设置上，保留观察，不宣称本片新增因果或已修复。IMK退出stderr同样保留不归因。
- 最终正常⌘Q，session17545 exit0，PID77345消失。只读夹具恢复644；乙重复、只读、独立三文件SHA与baseline一致。甲仅发生计划内保存，最终SHA为`2c430153ba0d8d8695f60c00fee61a7f2fb7b13f80f5bb8a291bb09175071dbc`。

以上实际有限证据不包含新建/复制后的MRU场景、自然IME、真实OS故障、极端规模或离线；相关确定性测试不能冒用户实操。完整父F-062/F-063、完整F-029根授权恢复与后续区域/重命名消费者保持开放。本片待最终批准，不预写Git。

文档收口首检因状态标记误写为“当前状态”失败，已恢复脚本要求的唯一“状态”标记；不改变候选待批准事实。
