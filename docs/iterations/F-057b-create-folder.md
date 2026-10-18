# F-057b：新建文件夹与本会话空目录展示

## Git 收据（2026-10-18）

提交`ef9456cd5ffab72b10b76f155d7358e53f99c4b3`已推送，HTTPS ls-remote与origin/main相同；钩子前后tree `c007af54641f4485114b7a115077d4f797bec450`一致，核验时工作树clean。以下Git待执行为历史；本收据自身随下一轮文档提交。

> 状态：2026-10-18alpha179经有限真实WK受托代验及最终独立Spec/Standards复核，均0必要有限验收阻断，主线批准本片有限非离线通过，非用户亲验。Git待执行。源码全量唯一旧FINAL002仍开放；下方阶段权限与待复核措辞为历史记录。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

主线准备真实 WK 自建夹具于 `/tmp/agentic-f057b-wk.gtPHeq`：两根、已有含 Markdown 子目录、普通及隐藏外部空目录，原三文件 SHA/长度在 `manifest.json`。仅准备，不代表新功能已构建或已执行验收；运行使用独立 `data`，不接触用户文档。

## 功能与承接范围

2026-10-18，依据[总账第316条及 W-08](../product-capability-register.md)、[MVP F-057](../mvp-product-spec.md)与[义务登记](../deferred-obligations.md)。本片没有既有 OBL 主承接项，不关闭其他 ID。F-057a 已完成空白 Markdown 文件创建；本片承接已确认的文件夹创建，父项完成状态仍须最后核对全部验收和开放边界。

在已授权根或其可信可见目录下新建单个文件夹，明确目标和名称，排他且不覆盖。成功定位/选中目录，不打开文档标签、不创建文档 grant。名称规则沿用当前 macOS 单组件、有限 NFC/小写等价和即时有界冲突检查，但**不补 `.md` 或其他扩展**。输入失败保留名称与上下文，无模板、未命名文档、重命名或移动功能。

用户已确认的例外：仅本 App **本会话新建的目录**即使为空仍可见，重扫后不消失，并能在其中继续新建 Markdown 文件；其他空目录仍隐藏，跨重启保留以后考虑。必要祖先随例外目录展示，避免孤儿节点，不因此展示无关空目录。目录后来有 Markdown 时与普通投影去重；其中最后一个 Markdown 被移除后，原例外仍成立。目录已删除或同路径替换不得把例外转给新对象。

隐藏显示仍遵守根设置，`.git` 不例外；隐藏名在隐藏关闭时提示先开启显示，不擅改设置。已有隐藏例外在关闭显示时不投影，但保留本会话身份记录，重开显示后重新核验。不提供跨重启登记恢复；移除根/撤权后再次加入相同路径作为新 root lifetime，不继承旧记录。该会话范围为工程最小约束，待路线复核。

## 继承约束检查

| 约束 | 行为及验证 |
| --- | --- |
| F-002 本地/离线 | 仅用户授权目录的本地操作；无网络服务或离线操作队列。真实本地创建及扫描验证；`F-057b-offline-final` 留最终人工，不断网。 |
| 中文与外观 | 中文入口/目标/名称/冲突与已创建提示，继承浅深/系统主题；真实长中文名称和两主题检查。 |
| 命令与键盘 | 统一命令及按钮等价入口，不抢系统快捷键；Tab/Enter/Escape 与树选中/焦点行为实际验证，原编辑器 dirty/选区/undo 不改。 |
| 安全与日志 | 后端 opaque 目标重新授权、排他发布、身份核验；不信 renderer 路径，不盲删，不日志记录正文或路径。固定阶段错误/替换/旧代数测试，失败不等同未创建。 |

## 原生路线比较与建议

已只读核本机官方 SDK `usr/include/sys/stat.h` 的 `mkdirat` 声明及 `usr/share/man/man2/mkdir.2`：相对单组件路径以目录 fd 为基准；mode 受 umask 限制；成功 0，失败 -1/errno，已有同名项 EEXIST，不覆盖。声明自 macOS 10.10 提供。它**不返回新目录 fd**，不能把 mkdir 成功后 open 到的同名目录直接称为原子取得刚创建身份。公开声明不是运行验证。

| 候选 | 优点 | 必须保留的缺口 |
| --- | --- | --- |
| 最终名直接 `mkdirat`，再 `openat(O_DIRECTORY\|O_NOFOLLOW)` | syscall 少，无暂存项 | 最终可见对象先出现，mkdir→open 之间若被替换，不能证明获得的 fd 就是刚创建目录；后续失败亦已创建，不能改报未创建。 |
| 同目标目录随机私有暂存目录，取得 held fd，核验后 `RENAME_EXCL` 发布最终名 | 正式最终名发布前已有可比较的 held 身份，可复用 F-058a 已核窄发布合同；发布后再开最终项比对 | 暂存 mkdir→open 仍有身份空隙，rename 按名称不是 fd/CAS；额外暂存项与失败残留必须公开处理。 |

建议选择第二条，作为**在现有公开 API 下最小、可明确检测发布前后身份的路线**，不是宣称消除同 UID 恶意替换。暂存名随机、普通安全 mode 建议 0700（受 umask），同父目录且固定本片前缀。新建后立即 no-follow 打开并核目录类型/所有者/权限和链，后续持 fd；这些检查也不能证明不存在暂存 mkdir→open 竞态。若产品要求抵抗该空隙中的恶意同 UID 替换，现路线不足，须停止后请求主线定约束，而非无穷增加探针伪造保证。

主线路线边界（2026-10-18）：本片仅原已授权目录，接受上述公开 API 的 mkdir→open 空隙，不承诺对恶意同 UID 并发替换的全局 CAS 保证；不再用穷举探针或猜修把后验冒原子身份取得。该边界不允许认领已检测到的替代目录，仍执行下述拒绝/unknown 合同。

发布前核原父目录 held fd/祖先链、暂存名称与 held fd 同身份，核暂存目录为空；最终同步核验至 `RENAME_EXCL` 不在本进程跨 await。原生预构造显式成功 0 与固定错误；仅严格 0 才记最终目录 created，其他无固定阶段返回 unknown。成功即提交，之后同步/关闭/投影失败不能倒退；再开最终项核 held 身份和父链才登记例外。EEXIST/不支持明确拒绝，不回退覆盖 rename；已有最终目录不能“视为成功”认领。

暂存已产生但最终发布前失败，说明“目标未创建，可能保留私有暂存目录”；最终发布成功后不明则说明“已创建/结果需确认”。所有分支仅关闭持有 fd，不调用 rmdir/unlink 回滚最终名或按名称清理暂存项，不能删除替代对象。崩溃残留不自动清理、不重新发布；本片不新增资产清理功能。原生前缀及目录创建窄接口须单独复核，不直接滥用现有只允许文件临时名的接口。

## 最小贯通接点

### 1. 本会话身份登记与预算

在 workspace 下增加专用有界目录例外模块，记录归属 **Root 对象 lifetime**、目录 path/fingerprint/连续 chain、内部稳定身份及元数据 bytes。记录不是文档授权或磁盘真源，不放文档正文、不持无限目录 fd。沿用总 cache 预算，登记常驻费用与树投影费用分别记账，候选/消息临时副本也计费；预留足够创建收据和登记空间后才能发 syscall，超预算在创建前拒绝。已提交后的意外预算不足保 created 未定位，不删目录。

重扫 generation 更新保留登记，但旧代数 proof 不授予写权限。root 移除、撤权、clear、dispose 释放记录及费用；新 root 同路径不复用旧 lifetime。明确删除/替换使登记失效，原身份在新路径不自动迁移，不把普通外部目录纳入例外。未知/权限失败与扫描 paused 不是删除证据，不删除记录但不能用旧证明创建内容。

一旦可靠确认失效，该条会话例外永久撤销；即使旧对象之后返回同路径也不复活。隐藏关闭或 paused 的未见仍不是可靠失效，不能据此撤销。

### 2. 扫描与自动/手动 reconciliation 使用同一投影

现 `scan` 只回 Markdown files，目录依赖文件 chain；`restart` 清 nodes/files/byPath；reconciliation 用新图整体替换。因此不能只在创建成功时插节点，或在 publication 后无证明补节点。

最小扩展是向每次扫描传有界的例外身份快照/版本；遍历仍使用既有分批 Worker，只额外回报**该名单中已实际核到的目录及其链**，不输出全部目录清单、不建立第二份长期目录索引。有限匹配表和消息 bytes 计入预算；每批只处理新增证据，不每次输入/发布全文重扫树。

本片 typed 边界预定：每根会话例外最多 1024 项，单次例外快照序列化 UTF-8 不超过 512 KiB，且仍须满足较小的可用总 cache/Worker 队列预算；这些是元数据操作保护而非性能 SLO。start 严格校验字段、正整数版本、条目数量/字节、连续 chain；保持现有 root 授权祖先最多 256、root 内扫描 chain 最多 128 的分别上限，不静默扩深度；校验目录自身身份与重复 path，同 path 冲突身份整次拒绝，不挑一条继续。每次 ScanBatch 的 `files.length + directories.length <= 128`，扫描仍最多处理原 128 个 dirent，队列和消息 bytes 合并计费；合法重复匹配仅按相同完整身份去重，不重复计入树。正式实现前须以这组 typed 上限复核协议与预算，不能暂以无界数组传递。

主扫描 merge、完整 restart、自动与手动 reconciliation 的 baseline/candidate/publication 都接纳同一目录 proof，连同必要祖先生成节点并与文件链去重。手动差异摘要及 retainedHandles 也核目录身份，不能因 files 不变而误称无变化；手动候选与接受时使用当前 root lifetime/generation/例外版本复核。只有完整、无不确定性且资格仍有效的扫描才可据未见确认移除；局部错误/预算暂停不推断删除。新建时 park 原合法完整批次，旧快照任务不得覆盖新登记；恢复后按版本失效/重新候选，不重复节点或复活旧根。

隐藏关闭时不参与扫描的隐藏例外不能因“完整扫描未见”被删除；只有实际覆盖其路径且可靠核到缺失/替换才失效。隐藏切换只改变投影，重新显示前需磁盘身份重验，不能拿保留记录当当前写权限。

### 3. 创建目标与单槽收据

复用 `creationHost` 的目录 lease、准入互斥和 park；空目录目标证明从当前 root 的已核例外 chain 取得，普通目录仍可用 files chain。`creationTarget` 每次以完整链重新 `openDirectoryDescriptor` 验证，节点 kind、可见性、代数及当前登记 identity 必须一致；不能只信 displayPath，不能令任意目录自动获权。新建 Markdown、后续副本等现有目标消费者通过同一接点获得空目录能力。

`creationHost.acquire` 仅有 workspace gate，不能冒文档任务排空：暂存创建、最终发布与提交收据段明确经过 `documents.withCreateBarrier`，排空已准入 save/acceptance 并使用现有严格 owner 拒绝新的读写/选择/根变更。未获 barrier 时不发创建；释放只归本 owner，退出/dispose 入口失效旧 owner，已有全部 dirty 保护不改变。目录创建没有打开文档阶段，不为复用文件路径制造 grant。

本片独立有界单槽绑定 operation、root lifetime/目标、原始名称；精确重放只回结果，异输入拒绝。状态区分 pending、未发布、created（含未定位）、unknown 与 acked；传输未知只查询、不重发。created 后仅按原身份重试定位，不重新 mkdir，不创建 `documentId`、grant 或标签。未知终态解除本操作执行门禁但保收据禁重创；正常退出仍走全部 dirty 保护并失效 owner，不把退出当未创建。接口可与既有创建 controller 共用局部目标/预览/收据逻辑，不复制整套文件打开路径。

## 最小 happy path 与必要故障边界

批准后实现再测，不 TDD；若原生路线需窄探针，先在本文件固定有限 oracle 与预算并获主线批准，目前不执行。

1. 在授权根及子目录新建中文空目录：无新标签/grant，树定位，原 dirty 文档/选区/undo 不变；其他预存空目录仍不可见。在新空目录中创建 Markdown 并保存，获得正常新文档身份。
2. 新目录保持空时完整重扫、自动 reconciliation、手动预览/接受后仍显示；其中 Markdown 加入再移除仍保该目录。普通空目录不混入，必要祖先可达，同路径不重复。
3. 隐藏开启创建隐藏目录，关闭显示隐藏、重新开启同身份恢复；`.git` 不例外。移除根再加入、App 新会话不恢复例外；目录内已有 Markdown 时仍按普通扫描显示。
4. 原目录外部删除/替换、祖先移动/替换、symlink、失效授权：不把替代身份当本 App 新建，不允许旧目标创建文档；未知扫描/paused 不冒删除。真实关闭与撤根/旧候选代数交错测试。
5. file/dir/symlink 同名和定义的等价名拒绝；暂存换身份、发布前失败、发布后同步/后验失败、回执丢失/重放只创建一次、不盲删。预算耗尽在 syscall 前拒绝；已提交后投影失败保可解释收据。

正式定向测试覆盖全部接点，再做独立代码复核、主线批准递增 alpha/构建和真实 WK：名称/冲突/取消、根及子目录、三种刷新、隐藏开关、目录内新建文件、原编辑状态、浅深主题与正常退出。工具限制及未测自然 IME/真实系统故障/跨卷如实留存；离线仍最终人工。FINAL-ISSUE-001/002/003、阅读子窗、F-058b、专项及冻结内容保持开放。

## 五组隔离原生探针计划（未批准执行）

仅待独立路线复核后由主线批准，在新的 mktemp 目录以真实 Node-API 和包内 Bun 执行。每组宿主 timeout 15 秒，整批 180 秒，首红停，保留目录、冻结 oracle、首次失败与日志；每组实际 assert，不以日志代替断言。不改仓库生产/依赖/版本/build，不新增 C 长期账本。JS 小槽只为验证阶段与调用次数，不冒正式产品收据或扫描实现。

1. **正常目录发布**：在已打开父 fd 下以随机私有名真实 mkdirat(0700)，no-follow 打开目录取得 held fd；核普通目录、无组/其他权限、为空。真实 RENAME_EXCL 到最终名，严格成功 0；最终 no-follow 重开 fingerprint 与 held 相同、仍为空、暂存名消失。只证明固定成功时序，不冒断电耐久或消除 mkdir→open 竞态。
2. **已有最终项目**：分别预置 file、directory、symlink，实际发布必须 EEXIST，原类型/身份/文件 bytes 或链接 target 不变，暂存目录仍在且同 held 身份。不能把已有目录当成功，也不覆盖/删除。
3. **发布前暂存替换**：取得 held fd 后，把暂存目录移到固定保留名，原暂存名换另一目录；末次身份检查必须拒绝，发布 syscall 为 0，最终名不存在，原持有目录与替代目录都保留。仅固定时序，不宣称 CAS。
4. **已发布后后验替换**：实际发布成功后、产品式身份后验前，将最终目录移到保留名并换替代目录；结果仅已发布/unknown，不认领、不重发、不回滚；查询及重复操作不增加发布 syscall，双方均保留。故障为固定测试替换；如 JS 注入抛错，明确是收到 native 成功后的注入，不冒自然 N-API 返回异常。
5. **不支持发布**：在窄发布依赖注入 ENOTSUP，明确最终未发布/不支持，真实发布 syscall 为 0，最终名不存在，暂存与 held 身份原样；不回退覆盖 rename、不调用 unlink/rmdir。注入不证明实际卷不支持；无删除/无覆盖路径以源码核查记录，不冒 runtime 全局拦截。

暂存目录不写入用户文件，正式接纳前必须核空；失败残留明确提示。显示隐藏项时普通扫描可能遍历残留目录，仍遵守既有分批/预算，不新增“忽略全部临时前缀”产品规则，也不把残留登记为已发布目录例外。本阶段不为此增加第六组探针。

通过五组也仅允许继续收敛 typed 接入，不自动批准生产。失败先报告证据和固定 oracle，不在原目录改期待结果；本节当前不授权执行。

## 本次方案检查

启动 `bun run check:obligations` 通过。本文件仅记录候选路线与明确边界，不是探针、生产或验收结果；Git 由主线另行处理。

## 五组原生探针作者执行收据（2026-10-18）

按顶部批准，新建 `/tmp/agentic-f057b-folder.TPsAUj`，冻结 `probe.c`、`case.cjs`、`run.cjs` 后首次执行。临时 Node-API 模块由本机 `xcrun clang` 编译为同目录 `probe.node`，真实 `mkdirat(0700)` 与 `renameatx_np(RENAME_EXCL)`；no-follow 目录持有/重开使用公开 `fs.openSync` 的 `O_DIRECTORY|O_NOFOLLOW`。身份断言为 dev/ino/birthtimeNs，C 不保存业务账本；所有返回数值在 mkdir/publish syscall 前构造，固定样本不代表生产参数/异常协议。

复跑命令：`'/tmp/agentic-direct178.qVLy3J/Agentic Markdown-canary.app/Contents/MacOS/bun' /tmp/agentic-f057b-folder.TPsAUj/run.cjs`。

作者运行 exit 0，5 PASS / 0 FAIL，无 timeout；日志 `/tmp/agentic-f057b-folder.TPsAUj/run-1792311996131.json`。宿主整批 180 秒、编译及每组 15 秒、首红停，首次运行无失败。不删除样本或残留；每次复跑生成独立 case 目录及新日志。

| 组 | 实际结果 | publish syscall 次数 | 首次样本目录（相对此探针目录） |
| --- | --- | --- | --- |
| 1 | 私有空目录、排他发布、最终 held 身份与空内容相同、暂存消失 | 1 | `g1-XF7jji` |
| 2 | file/directory/symlink 三种真实 EEXIST，原项目与暂存身份保留 | 3 | `g2-gx4dK8` |
| 3 | 固定暂存替换在身份末核拒绝，最终不存在，双方保留 | 0 | `g3-w9ri92` |
| 4 | 实际发布后固定替换，JS 小槽保 published/unknown；查询/重复调用不重发、不认领 | 1 | `g4-cqQNkB` |
| 5 | 窄依赖注入 ENOTSUP，明确 unsupported、最终未发布，暂存身份保留 | 0 | `g5-z2c6Lc` |

第 4 组没有注入 N-API 返回构造异常；第 5 组不证明当前卷真实不支持。无 unlink/rmdir 或覆盖发布回退依据冻结源码路径检查，不是运行时全局拦截；测试安排替换使用的 rename 不是发布 fallback。有限 JS 槽不是正式服务收据，五组不证明 scanner/reconciliation/renderer gate/退出与真实 WK，也不消除 mkdir→open 或按名发布的竞态，不证明断电耐久。主线全文读源及独立两轴复跑尚待完成；未批准生产。

## Typed 正式接入最小合同（待主线及独立路线复核，未批准实施）

主线已全文读三源并复跑五组 5/0、exit 0、无 timeout，日志 `run-1792312071020.json`；独立两轴结果另补。下面确定正式接点，不把临时 JS 槽迁为产品状态机，不新增通用事务框架。

### T1：共享协议、名称与原生窄接口

- 新 `shared/create-folder.ts` 定义 `CreateFolderRequest/Response` 与严格 validator；复用 `CreateTarget`、`CreateOperation`、`DocumentRequest` envelope。请求仅 `state / preview / cancel-preview / create / query / retry-locate / ack`；create 严格绑定 target+原始 name，无 source、suggest、snapshot、release-unpresented 或 retry-open。preview 返回 `name`（不是 fileName），名称不补扩展；局部提取已有单组件/UTF-16/255 UTF-8 bytes 校验及 NFC/小写键，保 Markdown 既有行为。
- 结果沿用 state/preview 形状的含义；操作结果为 `pending | rejected-before-create | created | unknown | busy | stale | acked`，有 operation、必填 boolean working，可选 name/message/entryHandle，不含文档身份或授权。严格字段白名单及对应 op/status 验证。`created` 专指最终目录已发布，entryHandle 只代表本次可信目录投影；无 entryHandle 不冒定位成功。
- `WorkspaceService.createFolder(value: unknown): Promise<CreateFolderResponse>`、独立 RPC 与统一 `createFolder` 命令接线。兼容现有 mock 的公共可选接口与实际 Trusted 接口必需方法分开，不宽松接受 Markdown endpoint 载荷。
- `save-primitives.c` 增加 `createPrivateDirectory(fd, tempName): 0` 与 `publishDirectoryExclusive(fd, tempName, finalName): 0`。前者仅本片固定随机目录前缀，真实 mkdirat(0700)；后者使用同一内部排他发布核心，文件/目录 wrapper 各自前缀白名单，不复制 errno/N-API 错误逻辑。完整参数个数/整数 fd/UTF-16 配对/单组件与长度校验；syscall 前预构造成功 0 和固定错误对象，检查 napi_status/pending exception，不覆盖已有 pending 异常；syscall 后不创建返回值。仅 `=== 0` 接受成功，无法证明阶段的异常/返回值为 unknown。持 fd 的目录检查在 Bun 侧使用现有 `openDirectoryAt` 与 `fstat`，不声称 mkdir 原子返回原目录 fd。

### T2：有界目录例外与扫描证明

- 新 `workspace/created-directories.ts` 管理 Root-owned ledger：`reserve(proofBytes)`、`commit(reservation, proof)`、`snapshot()`、`revoke(identity)`、`dispose()`；reservation 与当前 root lifetime 绑定，创建前占用数量和 bytes，失败仅释放预留，不删除磁盘。记录一旦可靠撤销即移除；仅真实新发布可以登记，同路径旧对象回来不能靠扫描重新插入。版本单调递增，创建/撤销改变版本，重扫不重置。
- `ScanDirectory = { path: string; fingerprint: string; chain: DirectoryIdentity[] }`，其中 chain 为 root 内从根之后至**自身父目录**的连续祖先，自身身份单独在 path/fingerprint；根授权仍由 RootAuthorization 提供。`CreatedDirectorySnapshot = { version: number; directories: ScanDirectory[] }`，只在 ScanRequest.start 增加此字段；watchStart 不偷偷接收。每根最多 1024、快照序列化 UTF-8 <=512 KiB、祖先授权 <=256、root 内含自身深度 <=128；再受实际 cache/queue 可用 bytes 限制，重复 path/断链/越根/冲突身份拒绝。
- ScanBatch 增加 `directories: ScanDirectory[]`，files+directories 联合 <=128，原 examined dirent <=128；worker 对名单中的实际同身份目录才产出 proof，不回传所有空目录。临时 snapshot/匹配表、批消息、候选图及常驻账本与投影费用均计入既有预算，禁止扫描全部树以处理每个新 proof。无例外也传严格空数组，更新协议 validator、worker/client/mock，不用可选字段掩盖旧协议。
- 正式 scanner 在父目录 dirent 遇到例外时完成可靠 open/fstat，再把目录 proof 计入该 dirent 的输出；文件与目录对同一 dirent 互斥。不得在下一批 onDirectory 入口额外插 1 项然后仍读 128 files，不能丢尾项或突破联合 128。既有总 cache 为 4 MiB；512 KiB 是单快照上限而非额外赠送额度，所有活动 worker scans 的快照/队列与已有费用须联合计入该总预算。
- `restart/merge/reconciliation.prepare/candidate/accept` 同时接 files 与 directory proofs；baseline 从两者与必要祖先生成，替换图和摘要/retainedHandles 共用此规则。扫描 epoch 绑定 root lifetime+generation+例外版本，接受前复核；旧快照结果不得覆盖新创建登记。可靠未见撤销仅适用于完整、无错、确实覆盖该例外路径的扫描；hidden off、paused、权限未知不构成覆盖，保账本但不授予旧 proof 写权限。根移除/撤权/clear/dispose 释放 ledger；同路径重加是新 lifetime。

### T3：创建服务与目标消费者

- 新 `workspace/create-folder.ts` 持独立单槽，复用 creationHost 的 resolve/acquire 与有界名称枚举 helper；不复制 file open/grant 流程。既有 acquire 的 owner、park 和 folder/remove 槽互斥保持；新建文件、复制和文件夹创建在共同 creation owner **执行期**互斥。终态 unknown 解除执行门禁，仅保本文件夹创建槽禁止同类再创；不宣称所有终态收据跨功能互斥。通过 `documents.withCreateBarrier` 排空已有 save/acceptance 后才创建暂存；整个发布和同步收据提交期间拒绝新准入，dispose 入口即失效 owner，旧 finally 不能解除新 owner。
- lease 增加 `acceptDirectory(proof): {status:"accepted"|"same-identity";entryHandle:string}|{status:"unavailable"}`，仍核 owner/currentOwner、scanParked、root lifetime/generation、例外版本、链及预算。此接点同步提交预留 ledger 与树，失败保 created 未定位；不得制造 ScanFile 或文档 grant。`creationTarget` 在 files chain 之外接受当前目录例外 proof，同样完整 descriptor 链重验，现有新建文件/复制消费者无需新授权旁路。
- `acceptDirectory` 先按本 lease 的 expected 例外版本准备完整 ledger/投影提交，最终同步复核后一次替换；成功结果另带内部 `committedVersion` 与 `registrationToken`，同步更新**仅本 lease/slot**认可版本，再失效旧扫描/候选。不能因自己的成功 commit 自判 stale，也不能普遍豁免外部版本变化。普通 renderer 结果不泄露 token；其余 lease 仍按原 expected 拒绝。若准备失败，不产生半提交账本或半投影。
- 实际磁盘 helper 独立 `workspace/create-folder-disk.ts`：随机私有名、mkdir 0、no-follow 持 fd，核目录/所有者/权限/空内容；发布前再次核父链/held父/暂存原身份与空内容，末核至同步排他 publish 不跨 await。严格 0 后立刻同步记录 created/原 fingerprint，再后验最终目录和父链，最后登记；后验失败不倒退为未创建。ENOTSUP 明确不支持且不回退；所有失败保可能残留说明，仅关 fd，不 unlink/rmdir。
- 精确重放返回原槽，异输入拒绝；pending/传输未知只能 query。retry-locate 只用原发布身份重验、重新申请有效 lease/预算后定位，不 mkdir、不换身份；可靠替换使不可定位，不自动认领替代目录。ack 仅明确终态，未知保槽禁重创；已 ack 高水 query/ack 返回 acked，不能旧请求复活。正常退出走原全部 dirty 保护，再 dispose，目录结果未知不强留窗口、不清理磁盘。
- slot 明确区分 `never-registered` 与 `registered(registrationToken)`：首次发布但尚未登记可在原身份后验通过后补登记；曾登记后 ledger 已可靠撤销该 token，则本槽标记 revoked，永久拒绝补登记，即使原 inode 回到同路径。token 只在有界当前槽与有界 ledger 中关联，不另建无限 tombstone map。完整重扫保留同 Root lifetime，retry-locate 可由服务端取得当前 generation/例外版本，以原 path/fingerprint/chain 重新授权后定位，不仅重放旧 generation；原请求 target 绑定仍不可换根。同路径移除重加是新 Root lifetime，旧槽永远不能迁移或再登记。

### T4：前端局部复用与迟到保护

创建 controller/dialog 用 `mode: "markdown" | "duplicate" | "folder"` 取代叠加 bool，抽取共享目标/名称/预览 UI；folder 分支调用独立严格 RPC，不把无源请求伪装 DuplicateSource。创建发出后以无源 creation owner 阻止正文事务与冲突动作，已有 dirty 不要求先保存或放弃；开始前与每次接纳前重核 IME/关闭/冻结资格。

transport unknown 或 working=true 保本 owner 门禁；已知 working=false 解除本门禁，terminal unknown 仍保槽禁重创。close/discard 使当前激活 intent 失效，不取消已发磁盘操作；退出继续所有 dirty 保护。created 分支仅 refresh 后逐 await 复核 intent、当前 root、当前 entry.kind===directory 及可信身份关联再 locate/ack，绝不调用 adopt/release 文档。retry-locate 生成新定位 intent；旧响应不得把已经关闭/撤根的目录重新选中。中文名称、错误、残留与已创建但未定位区别真实展示。

### T5：实施后验证边界

实现后正式测试覆盖协议拒绝、实际 native wrapper 与 fault stage、单槽/ack/unknown、保存排空与退出 owner、账本预留及预算释放、restart/自动和手动 reconciliation/隐藏/永久撤销/root 重加，以及在例外空目录新建 Markdown 的真实消费者；保留首次红例，不用探针绿代替。再经独立代码复核与主线批准版本/build，真实 WK 按上方矩阵验证。当前仅 typed 合同，尚无本片生产实现或验收。

## 前端作者阶段实现与验证（2026-10-18）

按主线后续实施批准，创建 controller/dialog 已统一为 `markdown | duplicate | folder` mode，复用预览、目标与单槽恢复路径；folder 使用独立严格协议/RPC、无扩展名策略、“新建文件夹”按钮及统一命令。成功仅刷新后按当前 root/目录 entry 资格定位，不打开标签、不制造 snapshot/source/grant。失效 generation 明确要求重新选择，避免旧目标静默拒绝；已有 pending 即使没有根仍可从命令重新打开查询。

无源 creation owner 接入现有 frozen 文档事务、保存/重读/关闭与历史守卫，已有 dirty 可准入但不会被保存或丢弃。pending/传输未知保门禁，明确 terminal unknown 仅解本人 gate、保 operation 禁重创；正常退出仍走既有全部 dirty 保护，取消退出不复活旧定位意图。发送前关闭不发 create；发送后关闭不撤回磁盘操作；refresh 每次 await 后再核当前意图与目录资格，retry 只调用 retry-locate。

作者测试与中途失败记录：

- 首轮 folder 7 项加原文件/复制 19 项共 26/0/169；补保存和组合输入入口、发送前关闭后，冻结阶段运行 `create-folder.test.ts`、`create-markdown.test.ts`、`discard-guard.test.ts`、`current-canonical.test.ts`、`sidebar-discard.test.ts` 五文件为 **45 pass / 0 fail / 372 assertions**（最终该轮 chunk `b93f6f`）。新建文件与复制原 19 项继续通过。
- 新增测试核真实 controller 编辑事务拒绝、已有 dirty/selection/buffer revision/undo 不变、无新标签、未知查询/禁止重创、旧 owner 不解新 gate、退出取消、迟到 refresh、目录资格缺失与重试定位、严格拒绝携 snapshot 响应。组合输入为 guard seam，不冒自然 IME；定位为回调测试，不冒真实 WK 树滚动。
- 首次 type 报测试夹具 mode union 使 request 参数失去上下文推导，已显式标注 `CreateMarkdownRequest`；首次定向 lint 报 dialog import 顺序，已窄修。其间全仓 type 看到后端并行改动的 Array.at 与 ScanBatch 必填 directories 中途错误，已交对应作者处理，不改变前端 oracle。最终本轮 `bun run typecheck` exit 0（session41101），前端/RPC相关10文件定向 ESLint exit 0（session37984）。不是首跑全绿。

这是作者验证，不自批前端；仍待独立复核与主线最终全量检查。本节不声称新版本/build/真实 WK 或 Git 已完成，所有既定未测及最终离线边界保持。

## 前端独立阶段复核（2026-10-18）

独立 Spec 实际运行同五文件为 45/0/372，复核 mode 严格协议、无文档授权路径、owner 门禁、退出与迟到定位，报告 0 项必要前端构建阻断。主线随后独立复跑同命令亦为 45/0/372、exit 0（chunk 8d988b）。后端仍在实施，这不是全片批准构建或真实验收；root lifetime、登记 token、可靠扫描撤销和联合预算仍待后端冻结后整体复核。

### 后端中途独立发现（未关闭）

Standards 只读复核指出：既有 worker 已对全部 scans 和 watching 共用 2 MiB 队列限制，不是各根独占 2 MiB；但队列增长还必须受主进程 4 MiB 总预算的剩余额度约束，不能只在有文件进入 merge 时检查，reconciliation 队列也须联合计费。主线认可为本片必要收口项，要求暂停不能触发未知目录例外撤销。

另有必要祖先消费者缺口：若已登记的后代空目录使祖先继续展示，而祖先已没有 Markdown，创建目标必须能从当前可靠后代目录 proof 的 chain 得到祖先身份，再走原完整 descriptor 重验；不能只查祖先自身登记或文件 chain。可靠候选观察与永久撤销的发生点也待明确验证。本节记录发现而非声称已修复，最终状态以修正后测试与独立复核为准。

## 后端作者实施与定向验证（2026-10-18，待独立复核）

已落 native 私有目录/共用排他发布核心、严格 shared/create-folder 协议、create-folder service/disk、Root-owned created-directories ledger，以及 scanner/protocol/worker/reconciliation/creationTarget 接线。生产目录 proof 独立于 files，不产生文档 grant；文件夹可作为 Markdown 和子目录创建目标。可靠完整候选或接受扫描在 root/binding 后验通过后确认撤销，不等待用户接受树；返回版本只推进本 job。隐藏未覆盖、错误/paused 不确认撤销。执行期共用 creation owner，终态 unknown 仅保本类槽禁重创，其他功能门禁解除。

联合预算窄修：next 携带主进程剩余预算，worker 与既有 scans+watch 2 MiB 上限取较小值；主根 queue 和 reconciliation job.queueBytes 均纳总账。无输出的普通目录队列仍受限，暂停不构造删除结论。父 dirent 输出匹配目录 proof，files+directories 联合 128；新建后代提供必要祖先当前 chain，仍完整 descriptor 重验。核空每次 fresh open 同身份目录，避免 scanOpen dup 共享 EOF offset；失败残留只关闭 fd，不删除。

首次失败保留：首 type 为旧 reconciliation fake ScanBatch 缺 directories；新增测试首跑 3/4，具体为控制请求误带 create 字段被严格拒绝、native 非枚举方法经对象 spread 丢失、`/tmp` 与规范 `/private/tmp` 测试 proof 不一致。修正夹具后 6/1，剩测试 helper 与局部 operation 同名 TDZ；随后修正。新增祖先测试首次仅 readdir 无顺序保证与期待顺序不同，改为对内容集合排序断言。更新 next 协议后一次三文件组先运行 index（尚未重建该 worker 产物），35/26；之后正式 native/worker 测试编译重建并复跑通过，不删除原失败或冒生产已稳定。新增预算测试 type 曾报 queueBytes 可选，补显式检查。首 lint 29 项为 import 顺序、unbound method 与测试/validator any/空方法等，已逐项修正。

定向命令 `bun test apps/desktop/src/bun/workspace/create-folder.test.ts apps/desktop/src/bun/workspace/index.test.ts apps/desktop/src/bun/workspace/reconciliation.test.ts apps/desktop/src/bun/documents/create-admission.test.ts apps/desktop/src/bun/workspace/create-markdown.test.ts apps/desktop/src/bun/workspace/duplicate-disk.test.ts` 得 93/0/657，6 文件 exit 0。随后补错误/paused 不调用 confirmDirectories 断言后，两文件 create-folder/reconciliation 26/0/237；包含 18 项本片测试。最新全仓 typecheck 与后端涉及 TS 的定向 ESLint exit 0；测试脚本仅编译现有测试 native/worker 产物，没有 App 打包或版本变化。

有限覆盖包括实际中文空目录、完整重扫/自动 watcher/手动接受、最后 Markdown 删除仍保空目录、hidden 关闭重显、同 Root 重扫 retry/移除重加隔离、可靠候选取消也永久撤销、祖先投影消费者、新文件与新子目录、联合批 128/registry 1024/普通目录双根预算暂停、真实保存排空/创建屏障/dispose、postpublish 未登记重定位不重发、发布后替换拒认领、ENOTSUP/未知回执保留、严格协议及三类 EEXIST。未知/ENOTSUP、时序替换及门禁 latch 是明确测试注入，不冒真实系统故障；全量、独立后端复核、真实 WK、自然 IME、跨卷/系统拒绝/最终离线仍未验证。本节不自批后端或全片验收。

## 最终代码复核与构建批准（2026-10-18）

独立 Spec 与后端 Standards 均先在 apps/desktop 运行 `bun scripts/build-save-native.ts`，再独立运行上述六文件，各93/0/663、exit0（Spec session37755 7.84秒；Standards session52940 9.25秒）。两轴0项必要代码构建阻断；Standards未自批本人前端。结合此前前端独立45/0/372，三项中途发现的代码收口通过有限复核，不冒真实WK或自然IME。

主线亦先编译native/测试worker，再运行 `bun test`，日志 `/tmp/f057b-source-tests.log`：1673 pass / 1 fail / 37617 assertions、226文件、51.36秒。唯一失败为原 `long whitespace eventually completes in bounded slices` 18.806秒超时，继续FINAL-ISSUE-002，不能称全量绿或已修；FINAL001/003亦保持。并行type/full lint/docs/obligations/lock/diff检查exit0（session58998）。主线已读正式关键实现，按用户允许最终集中旧偶发问题的既有授权，批准版本升alpha179并unsigned构建、实际WK验证；未验收，不得提交。

## alpha179 实际窗口与磁盘证据（2026-10-18，待最终复核）

`AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary` exit0，包内version为0.1.0-alpha.179、hash `3ajblxtn34q5g`；Vite大chunk与hdiutil弃用警告保留。直接解包至 `/tmp/agentic-direct179.T6NdUc`，以 `AGENTIC_MARKDOWN_HOME=/tmp/agentic-f057b-wk.gtPHeq/data` 启动，不经安装完成窗口。包内Bun运行仓库测试1674/0/37616、226文件、33.23秒，日志 `/tmp/f057b-alpha179-bundled-tests.log`；不是内嵌测试，不关闭源码FINAL002。

主线受托操作实际WK，未用合成DOM替代：

- 加入root-a，原普通及隐藏外部空目录均未出现在树；创建“本会话空目录”成功定位且无标签，重新扫描后保留；在其内创建“子目录”，再在子目录创建“内部文档.md”，空白文档正常打开。
- 新文档输入“未保存测试正文”并全选后，创建根下“保留正文目录”，正文仍原内容、仅原标签且仍未保存；重新聚焦后CmdZ回到空白clean，CmdShiftZ恢复，CmdS保存21字节。窗口未直接读回创建后的精确选区，不将自动测试selection断言冒实际精确选区证据。
- 隐藏显示开启时在保留正文目录下创建“.隐藏子目录”；关闭隐藏显示后不可见，重新开启并键盘展开后恢复。隐藏关闭时“.应拒绝”被明确提示先开启显示、创建禁用；普通预存“外部空目录”虽不显示仍报重名、创建禁用，未覆盖。
- 侧栏隐藏后用CmdShiftP搜索“新建文件夹”并Return进入对话框；深色截图确认布局及名称/目标可读。浅色创建流程正常；取消“取消不创建”草稿后无磁盘项目。AX Expand动作曾无变化，改用树行点击与Right实际展开；一次路径跳转尚停MacOS，重开GoTo并核root-a后才确认，未误授权该目录。首次根行AX点击后隐藏开关由off变on属于工具操作观察，不归因为创建自动改设置。
- 关闭已保存内部文档后，将该自建文件移至夹具外层 `retained-internal.md`（可恢复、没有删除）。实际自动观察后子目录无文件但仍可见。手动reconciliation prepare/accept由正式后端测试覆盖，本轮没有对应正式UI入口操作，不冒三种刷新均实际窗口亲测。
- 从窗口移除root-a再加入，旧创建空目录不再显示；磁盘仍保留。再创建“重启不保留”，正常CmdQ退出后重开同包、重新授权root-a，该目录亦不显示，原Markdown与已有分支仍在。
- 两次正常CmdQ分别session60411和39964 exit0，Bun PID64525/64930均已消失；退出均有IMKCFRunLoopWakeUpReliable stderr，保留不推断根因。原三文件SHA逐项与manifest相同，测试新文件21字节原文保留在夹具外层，无取消或隐藏拒绝的项目，无用户文件改动。

root-b仅预置未加入窗口；真实替换/祖先替换、unknown、权限拒绝、并发保存阶段、精确选区和自然IME、跨卷仍以自动测试或未测边界分别说明，不称实际GUI完成。FINAL001002003、完整父、专项、阅读子窗、冻结及最终离线保持。当前无运行测试实例，尚待独立最终有限验收复核，不得Git。
