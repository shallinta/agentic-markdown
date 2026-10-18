# F-064c：索引原生构建与 typed worker 有限接入

> 状态：2026-10-19，alpha189尾空格清理包已完成正式包内CRUD、19项定向测试及空窗口正常退出，经两轴最终复核，主线批准有限受托代验通过。alpha187／188及暂存检查首红历史保留，不冒189全量重跑；无搜索UI交付，本片Git未执行。

<!-- obligations: none -->
<!-- deferred-obligations: OBL-006, OBL-018, OBL-026, OBL-035 -->

## 范围与已核接点

F-064b已提交推送`cd6ddf2464593017a4714699c6967138733ec59c`；据主线收据HTTPS远端／origin/main同SHA，hook前后tree `7baf1d9a415711b49a706457322d36852a3d9977`一致、当时clean。[原实验及全部失败](F-064b-tantivy-native-bridge.md)与[持久证据](../../research/f064b/README.md)保留，alpha186不变。

本片只交付一个内部索引模块：Rust staticlib＋C Node-API8构建、index专属资源定位、typed host／worker会话，以及实际打包资源上的自建有限CRUD。没有窗口消费者、目录全文读取、授权、dirty覆盖、搜索UI或新用户命令；不把内部模块可调用冒产品搜索已完成。CONTEXT中的documentId是逻辑身份，不由本片从path／inode生成；本片调用者提供匿名ID和显式bytes，不能调用open文档接口批量建索引。

### 继承约束检查

- F-002：仅本地自建索引缓存，运行不联网、不新增遥测；CI显式工具获取不是产品运行。断网验收留最终，不冒本片已离线实测。
- 中文与外观：只固定内部错误映射，无新增UI。
- 命令与键盘：无新增入口，不改变原快捷键。
- 安全与日志：不含正文／query／路径，仅匿名阶段与计数。

文档两次清单格式检查失败已保留，补齐后通过；作者与两轴独立审查、原红保留是工作流程，不归作F-002能力。

实际接点：`apps/desktop/scripts/build-save-native.ts`当前clang构建save/trash并Bun.build worker；`electrobun.config.ts`preBuild调用它并把dist-native复制到app/native。`documents/atomic-save.ts`有源码／包内定位但依赖save文件名，不复用为index定位器。`workspace/scan-worker.ts`和其host不提供同步native中断，不能借扫描dispose／terminate作为索引正常关闭。`.github/workflows/release.yml`明确macos-15 arm64与macos-15-intel x64双矩阵，当前未供给Rust。

## T1：构建与资源（独立、失败明确）

- 拟新增`apps/desktop/native/index/`保存Rust crate／原传递Cargo.lock、C header与桥；固定Tantivy `=0.27.0`，不引napi-rs。crate名称／测试feature带来的根锁元数据变化单列，不静默升级传递依赖。napi-rs仍是替代路线，不在本片同时实施。
- 独立`scripts/build-index-native.ts`由preBuild串行调用，旧save测试直接调用build-save-native时不被迫重复编Rust。只有全部成功才发布`dist-native/index-primitives.node`、`index-worker.js`与小型构建manifest；失败不得沿用旧产物冒本次成功。target／中间文件不复制入app。
- 工具显式供给：要求配置绝对Rust工具目录，核`rustc -vV`、cargo版本为1.90.0及实际可执行路径，显式RUSTC／RUSTDOC／CARGO_TARGET_DIR；不搜索历史/tmp，不自动下载或改全局默认。CI后续实施须专门供给固定官方Rust1.90.0并校验官方hash，日志保版本／target；这是CI准备步骤，不放在日常build中隐式联网安装。
- 配置名固定`AGENTIC_MARKDOWN_INDEX_RUST_BIN`（含rustc/cargo/rustdoc的绝对bin目录）、`AGENTIC_MARKDOWN_INDEX_TARGET`（上述两个受支持triple之一）；脚本从同目录派生RUSTC/RUSTDOC并交叉核版本，不信任外部同名工具。CI新增独立setup步骤：从Rust官方1.90.0固定manifest按本runner架构取得rustc/cargo/rust-std三个归档，固定manifest及组件SHA校验后仅安装RUNNER_TEMP下prefix（禁ldconfig），设置这两个env给后续build。实现前锁定两架构实际URL/SHA及安全归档检查；任何不可得/不匹配明确失败，不换版本或跳过x64。日常本地用户自行供给，不调用CI下载步骤。
- 支持本机对应架构构建，不偷偷交叉：arm64映射`aarch64-apple-darwin`，x64映射`x86_64-apple-darwin`；显式构建target与clang arch，核Rust host、Bun进程架构及请求发布架构一致，不支持组合前拒。编后核Mach-O实际架构、otool依赖及构建manifest，不只看退出0。两CI矩阵都保留，arm64本机结果不冒x64实测。
- `cargo rustc --release --locked --lib --target … -- --print native-static-libs`记录系统库真实输出，再由clang NodeAPI8链接；不硬抄实验库列表假定跨目标一致。源码／Cargo.lock／tool版本／target／addon与worker SHA进入manifest。Rust公开[命令选项](https://doc.rust-lang.org/rustc/command-line-arguments.html)支持显式target与staticlib，不意味着系统库自动完整链接。
- 专属resolver仅按当前模块位置选择源码dist-native或包内app/native，核本次index两资源及manifest匹配；不查cwd、save-worker或旧/tmp兜底。worker从自身资源目录require addon，先ABI版本校验再open。缺失／错架构／不匹配统一unavailable，禁止创建索引。缓存路径与资源路径分离，包内资源不写入。

## T2：一个有限会话接口

建议内部`createIndexSession`隐藏worker／ABI，提供open、applyAndCommit、query、close；strict协议含版本、session epoch、单调requestId与commit generation。返回固定错误码及阶段（rejected／unknown／closed），不暴露native指针、异常原文、query／正文或真实路径日志。query只返回有界ID＋首个UTF16 span＋generation；Rust仍取存储原文精确后验证，但不把全raw或live调试枚举返回正式host。

open显式区分`create-new`（宿主准备parent，leaf必须不存在）与`reader-only`（只开既有schema，不修复），成功的正式原生返回直接含持久commit generation，不能靠已移除live调试操作初始化。applyAndCommit首次writer mutation前失败才可rejected／零mutation；自首次mutation起，add／commit／reload／回执失败均进入unknown/faulted，禁止后续写，不假定已回滚。本片不提供query恢复写权限：只允许关闭后新session重开核持久代；当前reader-only重开不能写，重建新缓存须独立create-new，不隐含追加writer-open功能。close立即取消尚未派发latest并结清其Promise、停止新派发，等待原active终态后唯一native close；重复close共享同一个终态Promise，关闭失败维持unknown，不能重派close冒成功。

本片保留**命名为limited-v1的内部容量档**：投影后累计16文档／64KiB原bytes、query4096 UTF16、完整≤16结果；不是正式窗口或全产品上限。批内预检全部操作和最终live集合，减删除／替换旧bytes后加新bytes；wire、临时gram、writer持有值、输出buffer均按F064b先验模型计费再分配／mutation，超限全批拒绝，不截断或部分提交。未来放大容量须另核真实语料与缓存义务，不静默改常量后称完成大规模服务。

保F064a literal profile：精确大小写／不归一化，1/2/3 scalar gram候选＋raw后验证，超过128 distinct query grams全候选扫描，首命中UTF16范围，BOM／CRLF原样。ID、字段、UTF8与整数范围运行时校验；借用JS Buffer只存活于单次同步调用，持久数据Rust自有，输出JS自有，Rust资源只由Rust关闭。env-local wrapper与hook／finalizer各持有引用避免UAF；显式close结果先预留，错误不能变成功ACK。

一在途且不排写队列：忙时写入接受前busy，由上层继续持有；latest仅一个query且替换必须返回明确取消。已接受mutation不能由后续query取消。commit payload持久化generation；commit成功后reload或回执失败是unknown，不自增假确认代、不重放。schema／profile版本未知或损坏只拒绝，不repair／删除原目录。reader-only不建writer，但保F064b已核META_LOCK写打开事实；仅自有缓存，不宣称OS只读介质或授权TOCTOU防护。

关闭停止新派发，等待已接受调用返回，再native显式close、发唯一终态、解除worker消息监听器自然排空；host核close事件及无pending。不用不存在global close、unref或terminate冒正常清理。同步native仅调用前后／批间可取消，不承诺在栈中断；worker错误把在途mutation标unknown且不自动重派。Worker并非进程崩溃隔离。[Bun worker文档](https://bun.sh/docs/runtime/workers)的自然退出规则与本片实测一致，但close事件仍不能替代native成功收尾。

## T3：panic与测试能力隔离

选择一次安装匿名全局Rust panic hook，只输出固定码，无payload／路径；不每调用set/take，不链到可能泄露正文的默认hook。明确影响当前共享Rust runtime的全局hook，其他Rust模块未来接入必须协调，不能称worker隔离。[官方set_hook](https://doc.rust-lang.org/std/panic/fn.set_hook.html)说明hook为全局资源。extern入口catch_unwind＋poison只覆盖unwind；OOM／abort不可捕获，关闭错误不得宣称正常成功。

正式导出不含panic注入、commitLost、hold、cleanupForTest、audit、原文／live枚举。协议迟到／丢回执测试在host测试adapter注入，实际wrapper清理／panic只在明确test feature的独立测试addon验证，输出不同文件且不进入dist-native发布清单。正式addon通过导出表／JS属性精确白名单测试，不能靠“调用者不使用”隐藏测试方法。原六组语义与所有失败保留；新测试走正式接口验证同ID更新、删除后新ID、查询和重开，不借测试接口制造产品成功。

测试裁剪须同时作用Rust注入操作（原op90/91）与C audit／cleanup导出，不仅隐藏JS属性。发布manifest最后写入；任何本次构建失败都不能使旧资源通过本轮验收，open前校验三件一致。manifest SHA仅为完整性／来源关联，不是安全签名或授权证明。

## 最小验证与交付门槛

|层|必须实际证明|不扩大结论|
|---|---|---|
|构建／定位|工具缺失／版本错／目标错前拒；源码与包路径定位；缺任一资源不open；本机真实编译／SHA／依赖核验|x64需对应CI或机器结果，未跑如实登记，不假双架构已绿|
|正式模块|原六组可映射的CRUD／BOM中文与emoji spans／预算零mutation／schema拒／busy和latest／只读重开／自然关闭；每真实Worker请求唯一回执、终态无pending|测试feature的panic／清理计数独立标注，不冒自然OS失败|
|实际包|主线另批构建后，用包内Bun与原位置资源运行同typed host小CRUD：a=`\uFEFF中文\r\n😀x`，中文[1,3)、emoji[5,7)，同ID更新／删除／新ID、正常close／新worker重开；移开自建源夹具后仍可查；包资源SHA一致|仅自建临时缓存，非用户GUI／权限／dirty；不为验证增加长期启动入口|

实际包测试由仓库独立harness显式指向包内资源，不接正常App启动，也不绕过正式resolver／host协议。所有测试保首红，不更改oracle造绿；编译及实际包由主线另批，当前只方案。无需重跑F064a性能矩阵，不增加新性能SLO。

resolver调用具体约束：同一纯`resolveIndexResources(moduleDirectory)`只接受模块目录，不接受任意addon／worker路径覆盖。正常host传`import.meta.dir`；独立harness传实际包`Contents/Resources/app/bun`目录，走同函数得到并校验`../native`三资源，再由同host工厂建立session。源码测试传已知源码模块目录；通过资源文件存在／manifest错误夹具测拒绝，不能harness直接new Worker绕resolver。此参数是内部测试seam，不暴露renderer或用户输入；实际包harness与源码同一host实现并核source/build manifest链，不称其已在正常窗口启动运行。

harness须加载本轮实际编译的正式host入口，而非手抄host；该内部测试入口随构建产物可审，不接App启动／窗口。CI供给改动保留原双矩阵，不触发release／tag。limited-v1档不外露给正式窗口。

四义务只局部承接：OBL-006为内部typed校验／稳定错误，正式受控窗口索引尚缺；OBL-018为单会话有界调度／迟到隔离，跨任务优先级与实际授权调度尚缺；OBL-026只有限档逻辑准入，分类配额／总上限／淘汰／观测尚缺；OBL-035只独立schema版本与未来版本拒绝，生产缓存迁移／重建尚缺。全部继续deferred，不更新MVP／手册为已实现。若本片打包链超出可审小片，可先交正式构建与typed内部模块，但没有真实包资源证据时必须保持包内验收开放。

## 实施中收据（非最终候选）

作者负责native／typed／构建；Standards作者lane仅CI供给脚本和release setup，由Spec及主线独立核。官方Rust1.90.0 manifest SHA `489c19f20d331765ab2835661eb546de90f6446a107a8db83045e7371e45cae2`在线核与原已下载manifest同，两架构六组件pin已锁；仅本机显式`/tmp/agentic-f064a-rust190.zxE80R/prefix/bin`实际核rustc1.90.0／aarch64 host，不冒x64编译。此为本次命令显式供给，不是生产脚本旧/tmp回退。

首正式编译`/tmp/f064c-native-first.log`exit0，Rust release35.50s，保两dead-code和ld重复System warning。首type`/tmp/f064c-type-first.log`因Event.code未窄化失败，修后type通过；首lint`/tmp/f064c-lint-first.log`18错误／1警告及后续一个optional-chain规则红均保留，正收口。初6测试6/0/38；新增受控transport错误后`/tmp/f064c-tests-second.log`9/0/56。这些使用各次实际构建，不冒后续源码已测；正式原文不再外返、open直接给持久代、测试Rust/C双层隔离已实施，最终重编仍需核。

CI供给源Spec路线／代码审与主线自建5fixture复跑exit0，收据`/var/folders/jy/rh9p8thj3t32m4pwhk38jydc0000gn/T/agentic-rust-setup-recheck.4zcn_m67/receipt.json`。中途setup最初错插meta job，作者发现后改至macOS build的bun install后；尚未真实CI下载安装或双架构release，不触发tag。协议代数、unknown收尾、空索引重开与缓存读取前限额正在补充正式测试，未自批整片。

### 首个代码冻结候选与作者定向验证

正式crate已改名`agentic-index-native`／lib `agentic_index_native`；与原锁逐行比较仅根包名变化，传递锁不变。模块路径为`apps/desktop/native/index`、`src/bun/index`；构建组合`build-native.ts`替换preBuild，仅单模块编译已执行，尚未App构建。CI供给独立显式调用；新增`verify-index-resources.ts`加载本轮编出的host，经同resolver运行包资源自建CRUD，当前未执行包验。

作者历史实际命令（旧环境名保留为收据，现行命令见末节；工具路径仅本次显式值）：`AGENTIC_INDEX_RUST_BIN=/tmp/agentic-f064a-rust190.zxE80R/prefix/bin AGENTIC_INDEX_TARGET=aarch64-apple-darwin CARGO_HOME=/tmp/agentic-f064a-rust190.zxE80R/cargo-home bun apps/desktop/scripts/build-index-native.ts`，再同env加`--test-addon`独立输出`.index-test`，再`bun test apps/desktop/src/bun/index`。本机源码Bun1.3.14，不冒包内Bun测试。

`/tmp/f064c-native-frozen.log`与`/tmp/f064c-test-native-frozen.log`均exit0，正式addon SHA `35c020b4329b3efbb43d9e884e61037a3d159da1fb3d3ba69abec0a183812027`，test addon SHA `8da4b1b2fb1455816e2ffb4e1979d07eb8cb59cc46253e15b664b51266cb4f39`，worker SHA `2854fa2db87da84ccbd3cc2ad00a326f445eec128dd75e6af3bfe64897d4fdef`，host SHA `18e2d563e244ff20f1dd11a4ce50d83e03b04b45b411a5bd7d477c580df41140`。正式manifest含10源SHA／根锁／工具版本／target及三资源SHA，末发布。编译warning保留，不冒系统库无警告。

`/tmp/f064c-tests-frozen.log`三文件**16/0/99**、3.10秒；包含正式导出裁剪及90/91拒绝／零mutation、NaN与buffer重叠前拒、空cache代0重开、精确BOM/CRLF/非BMP spans、累计预算全拒、同ID更新／删除后新ID、reader-only原文件SHA不变、future schema不修、busy/latest/close共享Promise，以及实际受控Worker malformed／代倒退／accepted错误／apply unknown后迟到原ACK不重派、唯一close和close错误。transport夹具只证明协议，不冒原生故障；test addon单独panic注入返回poison且新reader核已提交代1，cleanup人工顺序保留wrapper不UAF，固定`INDEX_PANIC`为预期stderr，不称自然panic／OS失败已测。

另一次施工type因新测试未使用readFile失败（`/tmp/f064c-type-fifth.log`），仅移除未用import；最终type/lint日志另核，不改oracle。当前是作者候选，待两轴独立代码／定向复核与主线全量；x64真实编译、包内加载、应用验收及四父义务仍开放。未执行版本／App build／Git。

随后仅测试追加正式op4（raw/live枚举）拒绝断言及native README准备命令；最终`/tmp/f064c-tests-final.log`为**16/0/101**，源码native／worker／host未因此改变。`/tmp/f064c-type-frozen.log`全type与`/tmp/f064c-lint-frozen.log`定向lint均exit0，docs／obligations／diff通过。作者候选已冻结送两轴，不自批；全量测试前须先分别构建正式与`--test-addon`，后者输出`.index-test`不会进入app，未准备时明确失败而非静默略过native验证。

### 独立复核与门槛补测

Spec与Standards各独立实跑**16/0/101**、exit0，并核正式三资源及manifest源SHA相符（Standards工具收据f87c76/9b9faf）。主线全量`/tmp/f064c-main-full-tests.log`为**1795/1/38414**、240文件58秒；唯一失败仍原FINAL002长空白18,764.49ms超过5秒，不冒全绿或本片修复。主线full lint/type/docs/obligations/lock/diff通过，原延期义务保留。

按主线批准仅补正式适配门槛测试，未改生产或重编：`abcXbcd`对`abcd`后验拒绝；131连续scalar产生129 distinct trigram走fallback，仅正序文档命中[0,131)，逆序不命中；真实三资源复制夹具逐项缺失、manifest错和worker内容hash错均拒绝，健康副本可解析。隔离复制构建脚本及源目录，用自建fake rustc证明缺env／错target／缺工具／错版本／错host前拒，正式dist-native manifest逐bytes原样，未运行真实cargo或失效正式包。

作者`/tmp/f064c-tests-coverage-final.log`**19/0/134**、4文件3.91秒，原16/99和16/101历史保留。这是本机有限模块证据，新增测试待两轴窄核；包内资源、x64实际编译及应用验收仍未完成，未执行alpha/App build/Git。

### alpha187构建批准与待验清单

随后主线定向**19/0/134**通过；Standards独立审新增测试并实跑四文件**19/0/134**、exit0（session19433／e69110），不重编，0新增必要构建阻断。作者补测后全type、定向lint与diff均exit0，日志`/tmp/f064c-type-coverage.log`、`/tmp/f064c-lint-coverage.log`。主线已批准alpha187并实际启动exec76833，日志`/tmp/f064c-alpha187-build.log`，显式Rust目录／target／CARGO_HOME及`SKIP_SIGNING=1`；本条仅记录构建中，不预写成功或包验。

后续由主线执行最小验收：确认构建exit／版本／hash及包内三资源manifest一致；使用包内Bun运行`verify-index-resources.ts <本轮app/bun目录>`，实际导入包内host并经同resolver完成自建CRUD、BOM／CRLF／非BMP及reader重开；核正式导出不含测试能力、退出正常；必要应用启动／正常退出确认无新增用户入口。x64真实运行、完整窗口授权／dirty／搜索消费者和最终离线仍不在本轮已测范围，不因内部harness通过关闭四父义务。

### alpha187实际有限证据（待最终复核）

构建前Spec亦独立实跑四文件**19/0/134**、3.28秒exit0（本机Bun1.3.14，工具chunk1ff79d／session34021）；未另写日志文件，不虚构路径。与Standards分别核验，不代替包验。

主线构建exec76833 exit0，`/tmp/f064c-alpha187-build.log`；版本`0.1.0-alpha.187`、hash `5lvf8caidut3`。实际payload解包至`/tmp/agentic-direct187.lt69qG/Agentic Markdown-canary.app`，包Bun1.4.0。包／源manifest逐bytes一致；本轮worker／host产物SHA分别`7ed058a3d9650bd58b165f300dcd2484319534157c12f610e9c5f43b3539030e`、`a01e2d0dbe9413f79ec7f0aa74d2ab732c705d3ba012d54019b8368e1f44c913`，不得套用前次单模块构建产物hash。

包内Bun执行`verify-index-resources.ts`并传本轮正式`app/bun`目录，加载包内host且经同resolver，exit0；`/tmp/f064c-alpha187-package-crud.log`实际输出`generation:4,userDocuments:false`。包Bun运行仓库exec9778 exit0：**1799/0/38446**、241文件39.82秒，`/tmp/f064c-alpha187-bundled-tests.log`；此绿不抹源码原FINAL002红。

真实WK仅独立空数据`/tmp/agentic-f064c-wk.xj3ksG/data`，欢迎页无文档，CUA实际连接AX与截图。CmdQ后CUA报-10005 Appquit，与launcher exec52706 exit0、Bun95101消失及ps无本包共同构成正常退出证据；不把工具退出错误当产品异常。app.log末IMK machport既有观察保留不归因。未接新UI，不称搜索用户功能验收；未断网、未x64运行、未完整窗口授权／dirty索引，四deferred义务保持。作者只记录主线实际有限收据，待独立最终复核，不自批。

### F001环境前缀兼容窄修（待alpha188清理包）

主线最终发现本片构建环境名未遵F001既定`AGENTIC_MARKDOWN_`前缀。仅将现行build／CI供给／README／测试／合同的两变量改为`AGENTIC_MARKDOWN_INDEX_RUST_BIN`、`AGENTIC_MARKDOWN_INDEX_TARGET`；不改生产会话、协议、原生语义或测试oracle。release.yml只调用setup并消费GITHUB_ENV，本身没有旧变量字面，无须改动。上文旧真实命令及alpha187包收据原样保留。

现行命令以`AGENTIC_MARKDOWN_INDEX_RUST_BIN=/tmp/agentic-f064a-rust190.zxE80R/prefix/bin AGENTIC_MARKDOWN_INDEX_TARGET=aarch64-apple-darwin CARGO_HOME=/tmp/agentic-f064a-rust190.zxE80R/cargo-home`运行原build脚本及`--test-addon`，分别`/tmp/f064c-env-native.log`、`/tmp/f064c-env-test-native.log`exit0。作者首轮错误地与重编并行跑测试，manifest稳定性断言实际撞到重编源hash切换，**18/1/130**保留`/tmp/f064c-env-tests.log`，不改断言掩盖；重编完成后串行同19测试**19/0/134**、3.15秒，`/tmp/f064c-env-tests-after-build.log`。本轮仍只模块构建，alpha188版本／App构建／最终验收由主线管理，不提前宣称清理包通过。

### alpha188清理包实际收据（最终有限复核通过）

前缀窄修后Spec独立串行**19/0/134**、1.96秒exit0（session38478／chunk8b75c1），Standards亦**19/0/134**、exit0（session99012／tool6c0f30）；两者不重编、0必要构建阻断。Standards按新旧变量反向归一核setup与原sourceSHA一致、10生产源码同既定窄差异；不据此抹原并行测试红。

主线alpha188 build exec55712 exit0，`/tmp/f064c-alpha188-build.log`，版本`0.1.0-alpha.188`、hash `1gcixb7tv1lyn`；实际包`/tmp/agentic-direct188.EHj7UJ/Agentic Markdown-canary.app`。本轮三正式资源SHA同alpha187，源码仅已核构建env名称窄修。包Bun经正式host／同resolver执行harness exec47650 exit0，`/tmp/f064c-alpha188-package-crud.log`实际`generation:4,userDocuments:false`；包Bun定向**19/0/134**、3.53秒，`/tmp/f064c-alpha188-targeted.log`。alpha187 **1799/0/38446**仅作为上一包同runtime代码组合证据，不称188全量重跑，源码FINAL002仍开放。

新空数据`/tmp/agentic-f064c-wk188.ytOD4k/data`实际WK欢迎页AX连接；CmdQ后-10005 Appquit，launcher exec26648 exit0、PID96202消失、ps无本包。IMK stderr观察保留不归因。此为受托有限内部模块／空窗口检查，不是用户亲验或搜索功能交付；x64实际运行、离线终验、完整授权／dirty／UI与四deferred义务保持。Spec独立包harness退出0，Spec与Standards核当前10源/三产物SHA与文档边界，最终0必要有限阻断；主线批准本片受托有限验收通过，Git待执行。

### 暂存检查首红与alpha189清理包前置

主线提交前`git diff --cached --check`发现新增`apps/desktop/native/index/bridge.c`第15行尾空格；此前普通`git diff --check`没有覆盖尚未跟踪文件，故不能将此前检查绿冒全部新增文件无空白错误。主线仅删除该处一个尾空格，不改逻辑或其他生产代码；源SHA因此变化，不能直接用旧alpha188 manifest宣称新源已包验。原暂存检查红保留，两轴核唯一格式差异，主线管理alpha189重包与正式资源复验。当前不新增功能、不执行Git；alpha188有限通过作为历史证据而非新SHA验收。

### alpha189格式清理包实际收据（有限受托代验通过）

主线build exec95415 exit0，`/tmp/f064c-alpha189-build.log`，版本`0.1.0-alpha.189`、hash `2p9sykdjetquk`；实际包`/tmp/agentic-direct189.9d1gAq/Agentic Markdown-canary.app`。独立test addon随后串行重编exit0，`/tmp/f064c-alpha189-test-native.log`；本轮bridge.c源SHA为`43ebedb7a63f542a9ad43d411c67647e20c04550be542eeda2605f3965168a96`，不混用旧有尾空格源SHA。

包Bun正式harness exec15953 exit0，`/tmp/f064c-alpha189-package-crud.log`输出`generation:4,userDocuments:false`；包Bun定向**19/0/134**、3.37秒，`/tmp/f064c-alpha189-targeted.log`。187全量及188结果只保各自原历史／组合证据，不称189全量已跑。

独立空数据`/tmp/agentic-f064c-wk189.g8Im2J/data`实际WK欢迎页AX与CmdQ，launcher exec10234 exit0、PID97053消失；IMK stderr仍仅保留观察不归因。两轴最终0必要有限阻断，主线批准alpha189有限受托代验通过，非用户亲验；无新增搜索UI、无x64／离线扩证、四deferred义务及源码FINAL002保持。作者未改生产或版本，Git待主线处理。
