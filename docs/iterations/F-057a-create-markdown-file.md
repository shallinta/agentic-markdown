# F-057a：授权根内排他新建空白 Markdown 文件

> 状态：2026-10-18 alpha177 有限非离线受托Agent代验通过，非用户亲验；最终独立Spec/Standards均0必要阻断，主线批准。已提交推送e52beb4，完整父及未测边界保持。下文早期记录保留历史。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## 功能说明与范围

依据产品总账第316/329/346条与W-08：在已授权根的明确目录输入名称，排他创建空白Markdown文件，成功后定位并打开；失败保留输入和上下文。没有未命名标签、模板、Frontmatter自动内容或另存为。本片只文件创建，父F-057的文件夹创建仍开放，不借切片取消它。

工程推荐入口：真实选中根/目录后，通过“新建Markdown文件”按钮或统一命令进入名称对话框；没有选中目录时，先从当前授权根选择明确位置，不猜当前文档父目录，也不自动授权任意renderer路径。文件节点不是目录，显示其位置选择流程，不把文件handle作为写入目录。初版不加快捷键、不接拖入/剪贴板。

提交前显示最终文件名及目标目录；空白、分隔符、NUL/控制字符、`.`/`..`、平台保留/非法名称、尾随空格或点、编码不完整及过长名称即时提示。缺少支持扩展名补`.md`；`.markdown`保留，`.md`/`.markdown`大小写沿现有isMarkdown规则识别；不静默trim、替换字符或覆盖。平台名规则需以本地macOS文件API实测固化，不凭Windows规则擅自拒绝所有合法Mac文件名。是否需要跨平台保留名集合在实施方案审查时明确，不能把“非法保留名”留成无验证文案。

同名文件/目录/symlink均不覆盖；大小写等价名称必须检查，Unicode规范等价与大小写折叠不能拿简单`toLowerCase()`冒文件系统语义。隐藏名不自动修改showHidden：若目标根当前不显示隐藏项，应明确提示先开启隐藏显示再创建该隐藏文件，使“成功定位”不变成不可见项目；这是本片建议的工程默认，待路线审查，不称用户逐项亲定。`.git`始终拒绝。

创建0字节普通文件，无BOM、无模板；新文件成功获得新documentId，主窗按已存在持久打开入口进入编辑模式，原标签dirty/选区/undo不改变。尚无副区时复用现有主区路由，不预先决定F-032/阅读子窗行为。

## 实际已读取接口（现有与拟新增明确区分）

- `bun/workspace/index.ts`：root包含authorization、generation、nodes/byPath/files；F060c目录定位通过有界files中ScanFile.chain按需取得目录见证，每64项让出并核current；root自身使用authorization.directories。此方法可复用为目标证明，不能相信node.displayPath即拥有写权限。当前文件树只呈现含Markdown的目录，不新增任意磁盘浏览器。
- `bun/workspace/scan.ts`：`openDirectoryDescriptor(root,{path,chain},native)`从`/`逐级`openDirectoryAt`，每级fstat比对既有fingerprint；`DirectoryNative`目前只有openDirectoryAt。`createScanWorker`已有一任务Worker与128项分批扫描，不可与其并发调用同worker。
- `bun/workspace/authorization.ts`：`verifyRoot`、`authorizeEntry`、`visiblePath`和`containsPath`。`authorizeEntry`要求已知文件fingerprint与完整chain；不能用新realpath/新lstat代替原目标目录身份后继续创建。
- `bun/documents/index.ts`：`openAuthorized(request,getAuthorization,scope)`走可信文档调度、保留scope身份，并创建snapshot；不是“任意路径自动授权”。`withWriteBarrier`用于已有写入排空，有finally释放；跨RPC未知结果不可单靠该callback冻结。F061c已有专用lease但语义是移除，不改名复用成通用事务。
- `bun/documents/path-authorization.ts`：`SingleFileAuthorization`持有FileHandle、目录链、文件fingerprint；`verifySingleFileAuthorization`核原目录链与当前打开文件。创建返回的真实fd/fingerprint必须贯穿接入，不能只按同路径再次打开并接受替换身份。
- `native/save-primitives.c`已全文读取：现有`createTemp(fd,leaf)`仅允许`.agentic-save-`前缀，虽使用`openat(O_RDWR|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600)`，**不是普通文件创建API**；`replace`会覆盖，不可用于新建；`removeTemp`亦只允许临时名。现有`openFileAt`只读。不可靠伪造临时名再rename实现无覆盖新建。
- 本地官方macOS SDK头文件`sys/fcntl.h`声明openat及O_CREAT/O_EXCL，`sys/unistd.h`声明`_PC_CASE_SENSITIVE`/`_PC_CASE_PRESERVING`，`sys/attr.h`描述卷大小写能力。这只是声明证据，尚未对API返回值/目标卷运行探针；未断言所有APFS或所有Mac卷语义相同。

## 最小技术方案

### 1. Opaque目标与有界预检

新增本片typed请求，携带requestId、root handle/generation、可选目录entry handle、原始单个名称及operation身份；不接受绝对路径、父目录路径、文件内容、shell参数。后端重新解析真实root/节点、确认kind与可见性，从现有可信chain取得目标目录fd。原目录被移动/替换、授权撤销、代数变化、保存/根修改互斥不满足时，在创建前拒绝并保留输入。

目录枚举用于名称冲突时必须读取实际目录所有条目（包括非Markdown和隐藏项），不能拿被过滤/partial的root.files缺失当无冲突。复用公开scanOpen/scanBatch/scanClose的有界单目录枚举；每批让出、可取消、预算超限整次拒绝，不全文扫子树、不缓存第二份工作区清单。用户输入时只做纯名称校验；实际目录检查在显式提交进行，不每个按键遍历目录。

最终创建前再次核对held fd及完整祖先链。持有fd可避免中途symlink替换把写入重定向到新目录，但外部rename可能使旧目录离开原路径；须前后复核并报告，不能宣称跨进程原子锁住祖先。创建提交时刻不得跨await在校验与native调用间让出本进程事件循环。

### 2. 最小新Node-API接口（尚不存在）

建议在已有固定Node-API模块新增仅此用途的`createFileExclusive(directoryFd, leaf)`，严格验证参数和单组件UTF-8长度、`O_EXCL|O_NOFOLLOW`创建0字节普通文件，正常直接返回fd；不开放任意flags/mode/绝对路径。mode采用现有安全创建0600作为工程默认，不复制其他文档权限。**openat成功是created提交点，不等待fstat、sync或close。**新增操作用固定错误码区分EEXIST/权限/能力变化/其他失败，禁止带路径的系统错误越RPC。

采用主线简化路线，不新增C长期单槽、native query或双账本。native在openat前后区分阶段：open失败可回明确未创建；open成功但可恢复的N-API fd返回构造失败，必须尝试close fd并抛固定`CREATED_IDENTITY_UNKNOWN`，不unlink。JS正常收到fd后第一步把workspace槽标为created，然后才做fstat/同步/close和其他对象构造，catch按已记阶段保持created；收到特殊码同样记录created-identity-unknown，不能再openat或仅凭同路径存在认领第三方文件。真正RPC失联只由workspace槽查询/重放解决。OOM、进程崩溃导致无法执行任何异常路径不承诺恢复，不以此推导原生永久日志；所有可恢复错误仍不得误报未创建。具体fd清理在所有分支保证尝试，close失败保阶段错误，不伪称OS资源已释放。该简化公开API仍待独立复核与固定小探针，未批准生产。

创建fd交接Bun FileHandle尚无现成公开适配，不能假设`new FileHandle(fd)`可用。最轻候选：调用方收到数值fd后用公开fstat取得身份并关闭，文档端再用已有公开`open`取得FileHandle，但必须以刚创建fingerprint和原目录chain严格验证，替换则进入“已创建但未打开”，不能接受新文件身份。若采用Worker native执行，需返回明确created receipt/fingerprint；消息失败不等于没创建。

不复用save.replace，不调用unlink回滚用户可见新文件。创建之后sync/close、树接纳或打开失败仍返回已创建状态；不能报“未创建”让用户重复新建，也不自动删除原路径以恢复UI。

### 3. 大小写等价与并发边界：有限名称比较

按主线与两轴审查，本片**不因大小写敏感或能力未知而禁用该卷**。实际目录条目分批预检、本实例同目录创建串行，以及最终O_EXCL共同落实名称校验和不覆盖。工程比较键建议固定为`name.normalize("NFC").toLowerCase()`，仅作为App明确的大小写/规范组合比较规则，不称完整Unicode case folding或所有文件系统等价规则。文件系统额外认定的冲突仍由O_EXCL拒绝；卷能力信息只能帮助解释/测试，不能以未知变成默认拒绝。

外部进程仍可在预检后创建另一大小写等价项，尤其敏感卷；本实例不能锁住它。创建后进行同一有界目录核对，若发现额外等价项则状态为“文件已创建，检测到名称冲突”，保留文件、原身份和上下文，不自动打开冲突对象、不盲删、不冒未创建；后检权限或预算失败则保created待确认。不得承诺全局跨进程原子等价拒绝。

拟先冻结6条手写名称oracle（尚未执行）：`a`→`a.md`；`a.markdown`保留；已有`A.md`时`a.md`预检冲突；已有`é.md`时分解形式`e\u0301.md`冲突；已有目录`a.md`亦冲突；`a.md `尾随空格拒绝而非trim。另单独记录`straße.md`与`STRASSE.md`在该有限规则下不同，不声称完整折叠；若产品需要更宽等价，应先改明确规范再写测试，不能按运行结果改变oracle。原生小探针只验证排他/收据与实际卷行为，不自动批准上述全部产品规则。

### 4. 创建收据、重试与一次打开

workspace owner持本片唯一有界未确认operation槽，绑定root/generation/目录证明/最终名称，`create/query/retryOpen/ack`共用session+单调sequence；create重放只回该槽，不重复执行native。终态ack前不驱逐，ack后highwater拒重放，进程启动重置，不建立通用持久事务日志。该槽在native调用前已预留，接收fd或固定createdunknown错误后立即记提交状态，负责目标与后续接纳；原生不再持第二套账本。

具体互斥：预留workspace createPending后拒新select/clear/rescan/隐藏设置/root removal及同根open；已有一批scanner/observation/reconciliation按F061c同样在消费批次已合法合并后park，不丢游标结果。已有picker/根修改或未ack移除槽则在create前BUSY。然后借documents.withWriteBarrier排空已准入save/acceptance，仅在该callback内做目录最终证明、native创建和磁盘收据收口，不在里面调用会被barrier拒绝的openAuthorized。回到created/rejected/unknown后离开callback；未知仍由独立workspace createPending阻止根变化/重放，原文档编辑无须因纯创建结果未知长期冻结。query只读workspace收据/核原身份，不写第二次；身份未知不可凭路径补认领。

已确认created后在workspace fence仍持有时进入可信文档打开任务；此任务与原文档读写通过现有文档单槽/保存检查串行，不把旧finally当workspace fence释放。opened、created-but-unopened或明确reject终态后释放park/fence并保历史收据；打开失败不阻止其他文档编辑或退出。只有尚在真实native调用/文档接纳关键段时短暂阻止退出；进程级dispose尽力关fd/worker，不能以取消承诺撤销磁盘文件。取消、所有异常及迟到回执均只能由持有本operation的owner释放自己的fence。

状态至少区分`rejected-before-create`、`created`（已创建但树/文档未就绪）、`opened`与`unknown`。真实创建提交点记fd身份与仅本片有限元数据，不存正文；native调用成功后任何后续错误不得翻成未创建。未知仅有界核对收据/原身份，不以“路径存在”认领第三方文件。若进程崩溃，磁盘可能已经留有空文件；重启由用户显式打开，不自动覆盖/删除，不承诺跨重启自动恢复本操作。

created阶段UI保留名称和位置，明确提示文件已在磁盘，提供重试定位/打开；此重试仅使用原created fingerprint及有效授权。目标已替换、移走或权限丢失时保持说明，不重新授权同路径。等待后端收据时阻止重复新建/撤根，已确认created后可安全释放全局冻结但继续禁同operation创建重放；原文档编辑不应因打开失败无限冻结。创建前取消不落盘；native提交后取消只能停止后续打开/关闭提示，不能“撤销创建”或盲删文件。

### 5. 树、文档与观察衔接

创建成功后复用可信grant接入和既有常驻打开生命周期：workspace槽保存首次成功取得的handle/documentId/snapshot元数据收据，重复query/retryOpen不再创建第二grant；文档接纳在一次task中先核created fingerprint+原chain，snapshot完成并建立grant后即将结果写回同operation收据，发送RPC之前即已可查。若第一次在grant建立前失败可同身份重试；若已有成功grant后来关闭/被撤，不重放旧打开意图，也不按路径授权新对象。root-only归属与资产范围由原授权根承接。

树不可等待不确定watcher事件才显示成功，也不能插伪造node绕过扫描身份。拟新增workspace本片单项接纳方法：输入后端已核的新ScanFile（path/fingerprint/chain），在创建owner持fence且scan已park时，按当前root/generation调用既有merge预算/路径去重；同路径不同fingerprint不得覆盖真实对象。如果root已换代/移除，拒绝旧投影，结果保持created未定位，不重建旧root。该方法尚不存在，需与具体接线一起审查。

在途批次先合并再park，单项接纳后resume；后续批次按路径/身份去重。完整重扫若在fence解除后换代，已有文档身份不随树清页丢失，定位重试需核新代可见映射；不发重复文件节点。树接纳预算不足或打开失败进入created提示，不回滚磁盘。前端收到opened先验证operation/root身份，利用现有controller的同documentId激活去重一次持久打开；迟到响应不得激活用户已关闭/取消的旧意图。现有dirty/IME/保存/根移除互斥仍有效，不自动保存其他文档。

## 实现后最小happy path与故障证据

方案通过后实现再测，不TDD，不预定性能门禁。

1. 授权根与可见子目录新建中文名，缺扩展补md、显式markdown保留；磁盘0字节、新身份、树定位并进入编辑模式，输入保存后可重开；原dirty标签与undo不变。
2. 空白/分隔符/尾随字符/过长/保留名；已有文件、目录、symlink和已定义比较规则的等价冲突不覆盖，失败保留名称；不冒所有卷的完整Unicode等价原子保证。
3. 创建前目标目录换身份、移走、symlink替换、撤根、权限失败；明确拒绝无新文件。提交瞬间外部rename与提交后sync/close失败以真实descriptor/native注入验证，保留created与原身份，绝不盲删。
4. native已创建后回执丢失、重复operation、打开失败、扫描换代/迟到响应、预算拒绝；一次磁盘创建、一次documentId、不重复节点、可查询/重试打开。未知不假装成功或未创建。
5. 真WK按钮/统一命令、无选中目录的位置选择、取消/失败输入保留、中文名称、浅深主题及正常退出；自然IME由真实测试能力决定是否完成，不能用API输入冒候选验证。

## 继承、未决与后续责任

继承F-002：本地真源、离线无网络依赖；`F-057a-offline-final`只登记留最终人工，不断网。中文与外观：目标/最终名称/已创建未打开/失败状态清晰；命令与键盘：按钮和统一命令同资格、对话框可取消且焦点返回；安全与日志：仅opaque授权及固定错误，不记录正文，不扩大renderer路径权限。

本次窄补已明确有限名称规则与外部竞争结果、原生created提交点、workspace owner互斥/释放和一次grant/树接纳接点，仍须公开API固定小探针及具体接线复核，不用文字冒实验；未批准任何探针或生产实现。允许按已授权用户体验优先原则选成本合理的工程实现，但不能改变无覆盖、权限或不盲删约束。

父F057文件夹创建、真实跨卷完整语义、F058复制后续承接；现有OBL主责不迁移。F047e、F028c未定、F061a未测输入矩阵、FINAL001/002、阅读子窗口、专项、冻结stash与最终离线仍开放。F061c Git收据由主线维护，本文件不宣称推送已完成。

## 2026-10-18 首批隔离验证批准

主线全文读取上述方案、本地native与descriptor接口；独立Spec无必要实验阻断，Standards要求先补可恢复N-API失败合同，现明确：openat前构造调用栈局部固定错误对象；成功后返回构造失败先尝试close，核pending exception并清除后抛固定created错误。所有不明native异常在JS只记unknown，只有明确前提交拒绝码才记未创建。不复用未检查status的number()，不新增原生账本，不承诺OOM/进程崩溃恢复。

主线批准仅mktemp新目录下8组固定探针，使用真实公开Node-API/openat及自建文件。每组宿主15秒、整批180秒，首红停并保留原目录/日志；不改仓库生产、依赖、版本、build或用户数据。具体oracle执行前冻结为：

1. 正常中文名创建：有效fd、普通文件0字节、权限不超0600、关闭后存在；非断电耐久证明。
2. 同名普通文件/目录/symlink均明确前拒，原内容/类型/目标不变。
3. 空名、分隔符、NUL、点/双点、过长UTF-8、未配对surrogate在syscall前拒；合法中文不发生编码替换。
4. 无效或非目录fd、固定open前失败：明确前拒且无新增文件；不借root权限chmod冒权限验证。
5. 真实open成功后的普通及pending-exception返回构造故障：尝试close，固定created-identity-unknown可识别，文件保留；未知异常fail-closed且不重创。只故障注入，不冒自然N-API/OOM故障。
6. JS先记created后分别注入fstat/sync/close失败，同operation重放计数仍1；close失败仅证尝试，不盲重试fd，不unlink。此为最小收据模型，非完整workspace/grant集成。
7. 文件替换及目录移动：公开reopen拒绝不同fingerprint；held目录fd不被新路径重定向，证明失配保已创建阶段，两份测试文件均不删除。
8. 文档六条名称oracle加ß边界原样，记录实际卷排他表现，不改卷、不扩全卷证明。

即时冲突检查不能被提交检查替代：正式方案需在输入稳定后以可取消、有界分批后台检查提供冲突反馈，并在提交前再次核对；不得每次按键同步全文扫描。完整park/grant/树接纳/迟到激活、跨卷、真实WK及自然IME仍属正式实现责任，探针不提前验收产品。

## 2026-10-18 隔离探针执行收据与证据限度

冻结目录 `/tmp/agentic-f057a-native.ig3Uz5`，`probe.c`、`run.cjs`、`RECEIPT.md` 保留；没有修改仓库生产、依赖、版本或构建，没有删除样本。编译命令：

```sh
clang -Wall -Wextra -Werror -shared -undefined dynamic_lookup -I /Users/shallinta/.nvm/versions/node/v22.22.2/include/node /tmp/agentic-f057a-native.ig3Uz5/probe.c -o /tmp/agentic-f057a-native.ig3Uz5/probe.node
node /tmp/agentic-f057a-native.ig3Uz5/run.cjs
bun /tmp/agentic-f057a-native.ig3Uz5/run.cjs
```

作者 Node 首跑、同源码 Bun 复跑均 8/0、exit 0、无 timeout；主线全文读取两源码并以 Bun 复跑亦 8/0。独立Spec与Standards实际复跑各8/0，均未据此批准生产或产品验收。宿主对子进程实施 15秒/组、180秒/整批、首红停；本批没有初红。

| 组 | 实际有限证据 | 不扩大的边界 |
| --- | --- | --- |
| 1 | 真实中文名 openat，fd 对应普通0字节文件、权限不超0600，close 后存在 | 非断电耐久证明 |
| 2 | 普通文件、目录、symlink 同名均前拒，内容/类型/link目标不变 | native 使用统一前拒码，未验证精细 errno 映射 |
| 3 | 非法输入前后 syscall 计数不变；中文与emoji文件名原样 | 不代表全部命名规则已接产品 |
| 4 | 无效/非目录fd及固定前置故障前拒，无意外文件 | 非真实权限拒绝矩阵 |
| 5 | 成功open后注入普通失败/pending exception，执行一次close尝试，固定created错误可识别，文件保留；最小JS模型未知异常不重创 | 故障为注入，非自然N-API/OOM；没有生产owner账本 |
| 6 | JS在后续动作前记created，fstat/sync故障后重放不重创；一次清理尝试 | close样本是真实close后模拟失败回报，不是OS实际close失败；不证明全部fd释放场景 |
| 7 | 公开fstat可观察替换文件的不同dev/ino/birthtimeNs；held目录fd写入移动后的旧目录而非同路径新目录，两份文件均保留 | 只有身份比较与descriptor位置证据；`stage`常量并未验证生产拒绝/阶段状态机，正式接入必须实际测试 |
| 8 | 六条名称oracle及ß边界按固定NFC+lowercase模型通过；A.md后第二次a.md创建返回统一前拒码 | 脚本标签`case-equivalent rejected`仅证第二create被拒，未捕获errno，不推断卷类型或完整文件系统等价规则 |

精细errno、生产替换拒绝、状态提交和调度、真实树/文档消费者、真实WK与自然IME均转下节正式实现验证，不能从8组绿直接推定完成。

## 2026-10-18 最小 typed 正式接入候选（待主线与独立复核，未批准生产）

本节收敛并替代前文仍笼统的接口候选，不建立通用事务框架；范围仅macOS已授权、当前可见根/目录内空白Markdown文件创建。文件夹创建、模板、未命名文档、另存为与阅读子窗口不包含。

### T1：名称、目标和冲突反馈

`shared/create-markdown.ts` 集中纯校验与RPC discriminated union（可区分状态联合类型）。输入和最终名均拒空白、`/`、NUL、控制字符、`.`/`..`、尾随空格/点、未配对UTF16 surrogate；最终UTF8不超255字节。缺支持扩展补`.md`，`.md`/`.markdown`大小写保留，不trim或改写。`.git`作为原输入或目标链组件均拒。macOS单组件规则不套Windows设备名集合：`CON.md`、普通反斜杠或冒号不因Windows规则拒绝；它们不是本平台路径分隔符，UI必须按纯文本显示并经过同一native单组件校验。更严格跨平台策略不在本片暗加。隐藏名仅在目标根showHidden开启时允许，拒绝时说明如何开启，不静默改设置。

比较键明确固定NFC+lowercase，非完整case folding。输入稳定后debounce发起后台预检，每次输入或位置变更递增preview sequence并取消旧意图；后端复核opaque目标，使用独立短命单目录cursor，128条以内一批、批间让出、逐批核取消与root generation。包括隐藏和非Markdown项；超过既有预算返回`unavailable`，不得冒`available`。关闭对话框/根变更释放cursor，迟到结果按session/目标/sequence丢弃。仅保存有限比较状态，不积累第二份目录清单。提交仍重新完整预检，preview不是写入权限或无冲突证明。

最小请求边界：`CreateTarget { rootHandle, generation, directoryHandle? }`，`CreateOperation { session, sequence }`；renderer只能发目标handle、单个名称及操作身份，不能发任意路径、flags、文件内容或可信fingerprint。目标证明沿用有界ScanFile.chain取得held目录fd。

### T2：原生接口与提交点

只在现有 `native/save-primitives.c` 与其Bun typed loader增加 `createFileExclusive(directoryFd, leaf): number`，生产无fault参数。逐项检查Node-API status、UTF16完整性和UTF8长度；open前预构造固定错误对象，`openat(O_RDWR|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600)`成功就是created。保存errno后映射明确前提交码（名称冲突、权限拒绝、目标无效、其他明确open失败），不发系统路径；细分映射必须正式测试，不能引用探针统一码冒已验。

成功后的fd返回构造失败先尝试close；清除pending exception后抛预构造`CREATED_IDENTITY_UNKNOWN`，不unlink、不再openat。无法归类异常由JS记unknown；只有白名单前提交码可记rejected。fd正常返回后**JS调用方先同步把已预留槽设created**，再以公开fstat读取fingerprint，尝试必要sync/close并复核目录证明。不是native持有fd取身份，也不假设公开FileHandle构造器存在。任一后提交失败保留created/identity-unknown；close失败不盲目重试可能复用的fd。身份未取得不得凭路径存在补认领。

### T3：严格创建屏障与单一owner收据

`bun/workspace/create-markdown.ts` 持唯一预留槽与单调highwater；`create/query/retryOpen/ack`只操作该槽，无C第二账本。状态分为`rejected-before-create`、`created`（identity可known/unknown）、`opened`、`unknown`；unknown不会触发第二次create。终态ack前保留，ack后拒旧sequence；不承诺跨重启操作恢复。workspace createPending与现有根操作/移除槽互斥，扫描按完整消费批次后park；只本owner能释放fence。

documents新增专用 `withCreateBarrier(action)`，不直接使用现有宽松`withWriteBarrier`：入口同步拒disposed、writeBarrier、folderMutationLease、running、pending、selecting、revealing；设屏障后排空已准入save/acceptance，await后再次核owner与上述任务状态，再执行最终目录证明/native调用。校验与openat之间无await；finally仅释放本屏障。创建结果未知仍由workspace槽冻结根变化，不能把旧文档编辑永久冻结。

创建后的文档打开采用本片Bun-only `openCreatedAuthorized`（或现有函数的内部typed分支），要求idle、无running/pending/selecting/revealing/保存屏障/其他lease；原调度的enqueue会取消已有任务，不能原样调用造成supersede。入队前同步检查且占 `createAdmissionOwner` token（仅本进程身份对象）；**全部enqueue入口，包括read/重新读取**及select/reveal等接纳入口统一核owner，只有内部同token可入，其他请求明确BUSY，不能反过来取消创建接纳。不是只给openAuthorized加guard，也不重写其他路由业务。无法立即打开则返回created未打开，解除本片park/fence，后续由用户重试。

cancel/dispose仅停止后续打开或呈现，不翻转已提交created或sink收据。dispose必须在入口、任何await之前使owner/token失效并建立退出屏障；现有disposed在saveTail之后才设置，不能只用`!disposed`作为资格。各await后核token，旧finally仅在仍持有同owner且未进入退出时释放自己的屏障，不得解除新owner或退出屏障。

创建前取消仅适用于尚未发create的输入/预检阶段。create已发后关闭对话框只是取消激活意图，不等于取消磁盘操作或立即ack；controller继续有界查询本operation至可确认终态，unknown仍保留恢复入口。created终态关闭可ack并停止激活，不删文件。retryOpen是同operation上的**新activation intent**，只重试原身份打开，绝不重create；已经opened后被用户关闭的旧槽不得借旧意图复活。

### T4：实际grant提交收据与树接纳

本地 `CreatedCommitSink` 是Bun内部同步函数，不经过RPC、不由renderer传入。workspace预先分配opened收据槽；document端完成snapshot与原身份验证后，按实际顺序 `commit(candidate,next,task,generation)` → `grants.set(handle,candidate)` → `sink(handle,next)`，其后才调用watcher、scope release、通知等副作用。sink只向预留槽写已存在的引用/固定字段，无await、无I/O、无可控回调链；不能依靠当前过早设置的`task.committed`证明grant已提交。正式测试应分别在commit前、grant登记后真实可抛副作用处注入异常，证明已登记grant可从原槽恢复且不创建第二身份。当前watchGrant普通watch异常已catch，不能虚构其自然向外抛出；采用真实scope.release或明确附带阶段注入，注明测试接点。sink前失败不冒opened；sink后副作用失败/响应丢失只重放已存收据，不重开。生命周期关闭或撤权后不重放旧激活意图。

`workspace/index.ts`新增局部 `acceptCreatedFile(ownerToken,rootHandle,generation,file)`，或由等价私有闭包携带token；typed结果仅 `accepted {entryHandle}`、`same-identity {entryHandle}` 或 `unavailable {reason}`。首先核`currentOwner === ownerToken && scanParked`，再核root对象与代数、可见性、各层kind/chain及file fingerprint、完整预算；同路径不同身份或错误kind拒绝，已有同身份仅在完整chain仍一致时返回same-identity。先准备所有节点及预算再同步提交，不把现有void merge的“可能跳过/暂停/提前return”当成功，不以root.byPath存在代替files身份核对。只接后端已验证的ScanFile；失败保持created未定位，不删磁盘。后续scanner批次仍去重，fence解除后换代的旧回执不能重建旧树。

树定位与文档打开分别记录状态：树预算失败不冒定位成功，文档提交成功后树失败不撤销grant或重复打开。`retryOpen`仅以原fingerprint+chain重取公开FileHandle并复核；替换/移动则保created说明。已存在opened收据直接查询，不能再走open。前端按operation意图和documentId幂等接纳，**收到结果时重新核IME、冻结状态、关闭/取消及当前activation intent**，不是只核启动资格；原dirty文档不要求保存或放弃。

已读client documents.load现有惯例：旧generation的select响应仅在handle不属于state.entries时release；新片沿用此不伤既有标签的资格，但须显式处理成功响应未呈现的grant。controller用后端收据的opaque handle、同operation及新建grant归属调用清理，不按路径释放，不碰已有dirty标签handle。IME/冻结暂时不允许接纳时保留created待显式新intent；取消/关闭意图下，后端opened但前端未接纳的本次grant先执行精确release，清理收据标记为未呈现已释放后才ack，禁止旧opened重播复活。release遇BUSY/传输未知保留待清理状态并查询/重试，不以现有吞异常helper冒清理成功；进程退出仍是资源清理后备，不删磁盘文件。正式测试覆盖迟到成功、重复释放与既有dirty handle不受影响。

### T5：文件分工、正式验证与退出范围

- `shared/create-markdown.ts`、shared RPC/命令表：名称结果、操作/目标/收据/预检typed边界，固定错误文案。
- native现有模块及loader：唯一排他创建接口；仅测试构建或可控依赖注入提供错误路径，不留产品fault开关。
- `bun/workspace/create-markdown.ts` 与workspace owner：槽、预检cursor、目标证明、park与树显式接纳；不新增长期全目录缓存。
- `bun/documents/index.ts` 及内部接口：专用严格屏障、idle no-supersede接纳、同步commit sink；旧保存/移除行为不重构。
- client局部controller与现有面板/命令入口：位置选择、名称对话框、预检反馈、创建中防重复、created未打开重试；保护原dirty/undo/选区/模式，不自动保存。

实现后测试覆盖真实native errno分类、UTF16/UTF8、fstat与关闭失败阶段、真实ledger重放/丢回执、严格屏障竞争、已有task不被取消、commit与watch异常间收据、acceptCreatedFile冲突/预算/代数、原文件替换拒绝、预检取消与迟到结果、前端关闭后不激活。保留原8组证据，不改oracle以适应实现。测试success不是实际验收；主线读代码及独立复核后再批准alpha176构建、真实WK（含中文名、浅深、取消/冲突/失败保输入、创建后编辑保存、其他dirty/undo、正常退出）。目前仍alpha175，未批准生产/构建/验收/Git。

真实native临界区短暂阻止退出；created未打开不永久阻止退出，解释磁盘文件已保留。dispose仅关闭本操作资源，不回滚用户可见文件。完整父/FINAL001002/F047e/阅读子窗口/冻结stash/专项及最终离线边界不变。

## 2026-10-18 后端实施与首轮有限测试收据

在主线批准T1–T5后，作者实现新增 `shared/create-markdown.ts`、`bun/workspace/create-markdown.ts`；现有native模块增加唯一`createFileExclusive`，workspace index仅接目标证明/park/显式单项接纳，documents index接严格创建屏障、idle owner、同步sink。前端/RPC/命令与产品总账由主线并行维护，本节不提前声明整片完成。版本仍alpha175，未执行App构建、GUI或Git。

独立Standards实施中指出的三处窄缺口均已修：未ack folder-removal槽同样阻挡create；native不合法返回值只能记unknown不重创；相同operation但不同原始name/target不冒原回执。另按主线修正ack丢响应查询：同session已ack sequence的query/ack可返回acked，create仍拒重放；TrustedWorkspaceService明确required方法，公共可选接口留旧mock兼容。

保留首轮失败：`/tmp/f057a-first-type.log`仅当时并行UI未接完两项；随后`/tmp/f057a-backend-type.log`记录新增test调用公共可选createMarkdown导致的TS2722/18048，已由trusted接口修正。`/tmp/f057a-backend-lint.log`共8项：native测试方法未绑定4项、同步callback误async、import顺序2项、控制字符regex；已用明确wrapper/同步callback/排序/逐字符校验修正，未改测试期望。没有测试红被改oracle掩盖。

实际运行：

- 首个后端文件5/0/55：`/tmp/f057a-backend-first.log`。
- 创建+接纳+旧folder回归4文件25/0/182：`/tmp/f057a-backend-related.log`，为当时源码快照，不与后续计数相加。
- 最新创建/接纳2文件18/0/118、exit0：`/tmp/f057a-backend-third.log`。
- 最新全仓typecheck无错误：`/tmp/f057a-backend-type4.log`；后端6个TS文件eslint无错误：`/tmp/f057a-backend-lint4.log`。不是全仓lint或全量测试凭证。

18条正式测试实际覆盖：真实native中文0字节/权限、文件/目录/link不覆盖及精确CREATE_EXISTS和CREATE_INVALID；非法UTF16；真实workspace一次create/文档身份、异输入重放拒绝、未呈现精确release与旧槽不复活、ack重试；未ack移除槽阻挡；冲突后台预检；真实替换后无grant、恢复原inode仅重试open；fstat失败保created；实际controller的fsync故障与close报告故障；取消分批preview；树预算拒绝仍留磁盘文件；旧root generation拒绝；read/select/lease不supersede；真实atomicSave排空；dispose入口失效及旧finally防解屏障；同步sink可见已登记grant与丢响应后的身份保留。

证据边界：非法native返回正式测试用NaN（与undefined经过同一整数验证），不冒自然Node-API失败。close故障是在真实close后模拟错误回报，仅证一次尝试与阶段保留，不证明OS真正拒close。fstat故障是注入提前关闭新fd；没有外部系统资源故障推断。sink测试实际检查登记点及不消费调用返回结果，没有虚构watchGrant内部catch之后仍自然外抛。跨卷/所有竞争时序/自然IME/真实WK及最终离线尚未验证；完整父与FINAL001002等保持开放，仍待主线与独立最终代码复核。

后端窄补：主线建议的post-sink故障已在测试中明确注入“保存snapshot后throw”，外部断言响应失败但唯一grant仍在且原documentId可read，未增生产API。Standards发现原登记点断言位于可能被生产catch吞掉的sink回调，已改为回调只收集boolean、外部assert，保留此测试资格修正记录。最新两文件19/0/123，exit0，`/tmp/f057a-backend-final2.log`；两测试文件eslint无错误，`/tmp/f057a-backend-testlint.log`。这不是自然watch异常或完整系统故障证据。

独立审查后第二次窄修：retry-open原先跳过首次postcheck等价冲突，现每次重试都完整有界核恰1项才打开；原opened槽在grant关闭/撤权后仍可能返回旧snapshot，现query/retry前及返回时以可信当前handle+documentId核验，失效标released，不凭路径重开。新增“初次冲突→retry仍拒→解除后只open一次”（额外等价项是native枚举依赖注入）与真实docs.release后的query/retry不复活。随后type实红TS2769为测试toBe参数含undefined，已只前移显式recorded存在检查，未改断言语义；日志`/tmp/f057a-backend-type-frozen.log`保留。最终后端21/0/133，两文件exit0：`/tmp/f057a-backend-frozen2.log`；全仓typecheck exit0：`/tmp/f057a-backend-type-frozen2.log`；后端6文件lint exit0：`/tmp/f057a-backend-lint-frozen.log`（该lint在最后测试收窄前，主线尚需最终全仓检查）。作者源码停止修改，等待两轴与主线复核，不预写构建/GUI/验收。

## 2026-10-18 有限实施批准

主线已全文读取正式方案及实际commit/grants/enqueue/read/dispose/merge与本地Node-API公开声明。独立Spec与Standards复核T3/T4修订后均0必要实施路线阻断；此前取消收据、全部enqueue与dispose资格、树owner/park缺口保留为审查过程，现方案已明确。批准按T1–T5实施及实现后测试，不再扩展临时探针；不得把路线通过写成代码或实际验收。新版本alpha176、构建、真实WK与Git均由主线在后续证据满足后分别执行。

## 前端实现中间记录（2026-10-18，非验收）

主线实现独立创建controller、目标/名称对话框、统一命令与RPC、既有文档load的created意图窄接点及一次树定位。独立Spec初审指出已确认回执丢失、本次定位刷新失败与旧定位重复滚动三项缺口；已分别以acked恢复、独立adopted/located记录及一次scroll intent窄修，不删除审查发现。后端真实highwater互操作仍须集成复测。

`bun test apps/desktop/src/client/create-markdown.test.ts`主线最新8/0/34；独立Spec连同既有documents/save/history四文件77/0/692。新测试实用原编辑器验证dirty正文与撤销保留，并覆盖迟到成功精确清理、丢create和已成功ack回执、定位刷新重试、非法名与清理未知；不冒真实WK或自然IME。首轮lint17项（含异步声明、导入顺序、props.ref修改）已窄修，随后3项继续修；两次type期间后端可选接口测试调用红已改TrustedWorkspaceService必需接口，最新主线type退出0。文档检查曾因状态头被写成`当前状态`失败，恢复规定`状态`头后已通过；完整lint/全量/实际验收尚待。

## alpha176 构建批准（2026-10-18，尚未实际验收）

最终两轴代码复核：Spec实际三个文件29/0/167，Standards四文件37/0/243，均0必要构建阻断。主线已读native、严格文档接纳及创建ledger/树接点全体差异，重试等价名称后检及已关闭grant禁止复活修订已核。前端定位消费后清父意图，防侧栏重挂载重复定位。

主线中间全量 `/tmp/f057a-main-full-first.log` 1620/0/37247；最终 `/tmp/f057a-main-full-final.log` 1622通过/1失败/37261断言、222文件、48.60秒。唯一失败为原 `long whitespace eventually completes in bounded slices`，18.429秒、5秒timeout，仍记FINAL-ISSUE-002，不改测试或时限、不冒本片修复。新测试类型收窄曾报TS2769，明确if后收窄已修，最终type/full lint/docs/lock/diff均退出0。依用户允许旧偶发最终集中处理，主线批准alpha176 unsigned构建及后续真实WK，尚未验收/Git。

## alpha176 真实 WK 与提示窄修（2026-10-18）

unsigned构建成功，hash `w7b2xbilw69b`，日志 `/tmp/f057a-alpha176-build.log`；包内Bun运行仓库1623/0/37261、222文件30.64秒，日志 `/tmp/f057a-alpha176-bundled-tests.log`，不覆盖源码FINAL002失败。直接解包 `/tmp/agentic-direct176.jwTw1D/Agentic Markdown-canary.app`，独立数据 `/tmp/agentic-f057a-wk.6uHbEX/data`、自建root，不经过安装窗口。首次AX仅原生框且截图白色，随后正常加载；不推断原因。首次GoTo批量输入未改变旧路径，重新读取输入框并setValue才正确到本轮root，未打开旧样本。

真实验证：无选中目录时需显式选root；中文“新建验证”自动补.md，磁盘0字节0600、树定位单标签编辑模式；粘贴正文保存34字节，关闭后树双击重开一致。选中子目录创建“子目录验证.markdown”保扩展名、0字节，展开并定位。A.md先切源码、追加临时修改并选中“修改”，创建前后dirty/源码/精确选区均保留，一次CmdZ恢复基线。尾空格立即禁用；隐藏显示明确off时“.hidden-reject”禁用并提示先开启显示，改普通名称恢复可创建、取消无文件。此前隐藏创建时界面最终显示on且创建成功，但该设置开启动作未单独核对，不冒从off自动切换或已测设置不变；后续明确关闭与拒绝已核。

冲突实际输入a.md禁用创建，但显示泛化“无法确认名称可用，请重试”，不够明确。已委托仅前端默认conflict文案改“同目录已存在同名或等价名称的项目，请更换名称。”及正式测试；9/0/38和两文件lint通过，日志 `/tmp/f057a-conflict-copy-test.log`、`/tmp/f057a-conflict-copy-lint.log`。需独立复核后alpha177重打包及补验，不据alpha176提前验收。

alpha176正常CmdQ，session79661退出0；A.md SHA `71c6fe035fa390e44f40677b982a89c7f1712aa7ff5a03cf3593c672453b61ae`、cover.md SHA `2cc82d2e9acec7b70ed2fdc3aa9df7012e453d1b67a1dca6a86fd9ea6991e3e5`保持。未测自然IME、真实OS故障/全部并发时序、深色/命令入口待补；完整父及既定开放义务不变。

## alpha177 补验收据（2026-10-18）

冲突文案两轴各独立9/0/38、0必要构建阻断；主线复跑9/0/38、type/full lint/docs/diff通过。主线批准递增alpha177构建，产物hash `dvhvvi8chs3x`，Info.plist版本已核；日志 `/tmp/f057a-alpha177-build.log`，直接解包 `/tmp/agentic-direct177.l1pnvK/Agentic Markdown-canary.app`。包内Bun运行仓库1624/0/37265、222文件30.62秒，日志 `/tmp/f057a-alpha177-bundled-tests.log`；不覆盖源码FINAL002红例。

真实WK继续同一自建数据区，重新授权root而非假定会话授权恢复：隐藏侧栏后命令面板“新建 Markdown 文件”可进入，未选目录仍要求显式root；输入a.md显示明确同名/等价冲突且创建禁用，浅色截图可读。更名“命令创建177”恢复创建能力，成功创建0字节并编辑模式单标签打开；重新显示侧栏时选中该文件。设置深色后再次命令打开，对话框文字、输入框、取消与禁用按钮均可读，取消正常。只改变隔离实例偏好。alpha176的子目录、dirty/source/精确选区、undo、保存重开证据是旧包有限组合证据，alpha177仅增加文案分支，没有冒全矩阵重跑。

正常CmdQ，session33077退出0；PID45872随后主线核消失。退出stderr出现 `error messaging the mach port for IMKCFRunLoopWakeUpReliable`，无根因推断。A.md及cover.md SHA与上一节一致；子目录验证.markdown与命令创建177.md均0字节，取消验证.md及.hidden-reject.md未生成。自然中文输入法、真实OS拒close、跨卷/全部竞争时序与最终离线仍未验证；完整文件夹创建、F047e、FINAL001002、阅读子窗/冻结stash/专项边界保持。主线请求独立最终Spec/Standards审核后再验收与Git。

最终独立Spec复跑相关三文件30/0/171，并独立核原SHA/新文件尺寸权限；Standards复核代码、构建/运行日志及边界。两轴均0必要有限非离线验收阻断，GUI是主线真实执行记录的独立复核，非两代理重复操作。主线据组合证据批准F057a有限片受托代验通过，2026-10-18；不关闭完整父或其他未测责任，Git按连续授权随后执行。

提交前再次源码全量 `/tmp/f057a-alpha177-source-tests.log`：1623通过/1失败/37264断言、222文件47.02秒，唯一仍同 `long whitespace eventually completes in bounded slices` 18.233秒超时；不是全绿，继续FINAL002最终集中责任。最新docs/obligations/lock/diff通过，未改失败oracle或源码测试时限。

Git收据：`e52beb44f176a47f096620051342b000e9526da5`已提交推送，hook前后tree `3157a40ee9ca31dfc552d8420b1eb7d6fde5806e`一致。默认SSH22 banner超时；仅命令级SSH443、既有github.com HostKeyAlias严格校验push成功，随后同路径ls-remote与origin/main核同SHA。原HTTPS调用受既有`url.git@github.com:.insteadof https://github.com/`改写而仍连22失败；用命令级完整仓库URL精确insteadOf覆盖后，真实HTTPS ls-remote同SHA成功。未改系统/进程网络或持久Git配置。工作树当时clean，冻结stash未动；本收据随后续文档提交。
