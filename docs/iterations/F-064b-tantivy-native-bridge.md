# F-064b：Tantivy Node-API 持久索引窄桥

> 状态：两独立轴实际终核0必要有限实验及归档交付阻断，主线批准固定桥可行性片受托Agent代验通过，非用户亲验／正式应用验收。完整六组及严格终态通过，原退出首红／漏观测历史保留。正式typed构建／资源接入移至后继F-064c最小方案；最小持久证据已入research/f064b并完成独立最终复核，Git待执行，不交付全文搜索UI。

<!-- obligations: none -->
<!-- deferred-obligations: OBL-006, OBL-018, OBL-026, OBL-035 -->

F-064a已提交推送`0f1d113055330d5e058447293e86a28bd4b499f5`，主线核HEAD／origin/main／HTTPS远端一致，hook前后tree `902355dd77b613be39f6614eda47d3b5f34f7fe5`一致、当时clean。本条引用主线Git收据，不扩展实验结论；alpha186仍为已有应用包。

## 目标与最小闭环

沿F-064a有限结论，优先验证 **Tantivy 0.27.0 → Rust稳定C ABI → Node-API 8窄桥 → 独立Bun Worker**。这里FFI指Rust与C内部调用，不使用`bun:ffi`，保持用户Node-API偏好。闭环为宿主显式发送有限自建文档bytes、创建本地索引、同ID更新／删除／新ID、commit/reload查询、关闭并在新worker只读重开。随后另获准包内资源验证；不接用户目录、扫描器全文读取、dirty覆盖、MRU或搜索UI。

继承检查：**F-002**作者与两轴审查分离、原红保留；**中文与外观**后台错误映射为固定中文状态，尚无UI；**命令与键盘**无新用户入口；**安全与日志**自建夹具、不上传，日志只有匿名ID／阶段／计数，不记录正文、query字面或磁盘路径。

## 已核实际接点与路线选择

- `apps/desktop/scripts/build-save-native.ts`现以clang、`-DNAPI_VERSION=8`及现有node-api-headers产出`.node`，Bun.build单独打包worker至dist-native；没有Rust构建接点。
- `electrobun.config.ts`将dist-native复制到app/native。`documents/atomic-save.ts::resolveSaveWorkerEntry`分别处理源码dist-native与包内app/native；`trash-operation.ts`经createRequire载同目录`.node`。本片应提取或新增明确index资源定位，不让索引运行依赖save-worker文件存在。
- `workspace/worker.ts`单Worker单在途serial协议可作模式参考，不能复用同扫描worker长期索引。其dispose等待在途响应才terminate，不提供同步原生计算中断。
- 官方[Bun Node-API](https://bun.sh/docs/runtime/node-api)说明原生addon支持，但不证明本桥全部API在当前包内runtime可用，必须实际验证；[Node-API文档](https://nodejs.org/download/release/v22.18.0/docs/api/n-api.html)禁止跨worker复用napi_env。本片仅在调用worker线程用N-API，Tantivy后台线程不能访问JS值。

|候选|收益／成本|本片建议|
|---|---|---|
|Rust staticlib＋少量C Node-API8胶水|复用现C/header构建习惯，无新增napi-rs宏／CLI；需自行严格实现参数、所有权和finalizer|优先验证，具体链接系统库由公开构建输出确定，不能猜静态库自动完整链接|
|现成napi-rs|自动类型转换与导出，减少手写胶水；增加napi/napi-derive等锁定依赖、构建和Bun兼容验证面|只比较，不新增依赖或默认运行脚手架；若首路线确实成本过高再向主线提替代|

[napi-rs官方入门](https://napi.rs/docs/introduction/getting-started)提供Rust原生addon构建路线；它也基于Node-API，不是Bun FFI。当前未核定其具体依赖版本／MSRV，不虚构同F064a锁不变。优先路线以F064a Tantivy精确版本和已验证Rust1.90为基线；新增库crate/构建目标引起的Cargo元数据变化单列，传递依赖不得静默升级。

## T1：ABI与所有权最小合同

本片≤16命中一次完整返回，接口名使用query而非queryPage，不引分页token；一次调用固定一个commit generation和searcher，结果带该generation。后继若分页必须另定义快照代数，不在本片偷换成跨代续页。

拟以`index_bridge_v1.h`固定ABI版本1：仅`uint32_t`状态／版本、明确宽度计数、借用`const uint8_t* + size_t`输入、opaque session指针及调用者输出buffer；不跨ABI传Rust Vec/String/Result、C++对象或JS值。公开导出限定version、open、applyBatch、commitReload、query、close；操作序号与session epoch在worker协议层验证。头文件与Rust布局有编译期大小断言，入口统一检查null、长度、整数溢出／UTF8，零长度不据null构造slice。

1. C桥先校验并为结果预留有界buffer，再调用Rust；输入仅在本次同步调用借用。Rust如需加入writer队列，先复制为Rust自有数据；返回后绝不留JS Buffer指针。输出由C桥持有并复制进JS Buffer，Rust不释放C／JS内存；不使用外部ArrayBuffer共享可变内存。容量不足返回明确required-size/limit错误，不截断结果或重复执行mutation来扩容。
2. opaque session由Rust创建／Rust关闭；C env-local包装保存指针、closed标记及类型身份，JS不得传任意数字地址。显式close至多一次，先清包装pointer再释放，重复close稳定返回closed；不跨env／worker转移handle。GC finalizer只作兜底，不能替代正常关闭收据。
3. Rust所有extern入口内部`catch_unwind`，不允许unwind跨C ABI；捕获后session标faulted，禁止继续写入，不推断commit未发生。采用unwind编译策略，abort／OOM／进程故障并不能被catch捕获。panic不能输出用户信息；默认panic hook会先输出，本片匿名hook明确具有下述进程级影响，不只写catch就声称匿名。[Rust FFI](https://doc.rust-lang.org/nomicon/ffi.html)、[catch_unwind](https://doc.rust-lang.org/std/panic/fn.catch_unwind.html)是依据。
4. N-API返回值／pending exception逐步检查；不可把JS结果分配失败冒mutation未发生。Rust先记录session内单调commit generation，随后返回；回执丢失仅query当前代或关闭后重开核缓存，不自动重放batch。索引是可重建缓存，但不能因此把unknown报成功／空结果。

## T2：worker、关闭和有限输入

没有写入等待队列：唯一在途槽忙时，新写请求在接受前返回busy／零mutation，由上层继续持有并决定重试，不称已接受后丢弃。已接受写入不被query／cancel替换；latest槽只允许一个query。16文档／64KiB限制适用于投影后的累计live集合（旧live减删除及替换旧bytes、加新bytes），不是每batch可无限累加；批次整体验证／预留后才接纳，超额全批零mutation。

wrapper生命周期独立于Rust资源：env registry持wrapper，cleanup只关资源并移除hook关联，不直接free仍可能被finalizer引用的wrapper；finalizer先到则先从registry解除再释放，cleanup与finalizer各自恰一次释放其持有引用，最后一个才释放wrapper。正常close只置closed并关Rust资源，不销仍被JS引用的wrapper。测试须覆盖GC先到与env cleanup先到两顺序，避免只防双close却留下UAF。

临时验证进程只安装一次固定匿名Rust panic hook，明确影响该进程共享的Rust hook，非天然独立运行时隔离；不按每次调用set/restore引竞态。正式应用hook策略仍待集成审核。本片编译系统库依据固定工具链`cargo rustc --release --locked --lib -- --print native-static-libs`实际输出及clang链接命令，不猜库清单。

初片一个worker负责一个完整session；正常显式close完成writer收尾后ACK，再退出worker。cleanup hook与finalizer共享同一env-local已关闭状态，hook先执行也不得让后续finalizer重复free；两者都不能代替commit或成功close收据。Rust析构路径亦不允许unwind越ABI。Worker是线程而非进程隔离：abort／native内存错误可能影响整个Bun宿主，不能声称workererror总能兜底。

独立`index-worker.js`持一个session，宿主一个在途请求＋一个可替换latest查询，写入串行、不丢写任务。所有消息有严格字段、protocolVersion、sessionEpoch、requestId；bytes通过明确有界载荷，不默认复制成本为零。迟到／旧epoch响应不能发布，workererror置unavailable且释放待办引用，不自动调用第二次mutation。

同步native正在执行时，worker JS不能接收取消消息；本片只承诺batch／query之间检查取消及旧结果不发布，明确不能中断Tantivy当前同步调用。cancel之后等待当前调用返回，再close writer／reader并正常回应；异常退出可能使缓存需重开核验，不保证terminate会运行finalizer或释放锁。测试超时由独立宿主精确进程组止损，仅用于自建验证进程，不在应用主进程内冒强制安全终止。

最小夹具预算沿原L／CRUD：最多16文档、总原bytes64KiB、单批不超过16操作、query≤4096 UTF16；每次结果至多16个匿名ID与首span，原文bytes仅测试验证接口返回，生产不得顺便全量回传。保BOM／CRLF／非BMP，拒孤立surrogate／非法UTF8，L算法及128distinct fallback保持实验profile，不升级产品最终query语义。请求、候选、原文副本和结果均在调用前计费；16/64KiB只是本片验证界限，不能迁为全产品文档上限。Tantivy writer1 indexing thread＋50MiB arena、默认merge threads仍另有内存，非物理硬上限。

## T3：持久schema与资源链

固定0.27源码`reader/mod.rs::open_segment_readers`获取META_LOCK；`directory/mmap_directory/mod.rs::acquire_lock`以write＋create、truncate=false打开`.tantivy-meta.lock`。故reader-only仅指不构造IndexWriter／不拿writer锁、不写schema或修复，**不是OS只读介质／完全无write-open保证**。本片只接受正常close后已存在meta锁的自建独占目录，缺锁在调用前拒绝，前后成员集合及全部文件bytes核同；既有meta控制文件仍以官方写方式打开。该预检不是并发TOCTOU防护，不冒产品授权安全，不自造Directory绕过官方锁。

只操作宿主建立的独立缓存父目录，renderer不提供路径。schema元数据单独含bridgeABI、schemaVersion、Tantivy版本、gram/profile版本；本片create目标leaf须不存在，由桥创建新空目录，open必须已存在且版本完全匹配，不repair、不导入fixture补数据。未来版本／损坏明确incompatible/unavailable，保原缓存不自动删除；后继正式缓存服务负责隔离／重建与配额，不实现通用迁移框架。正常commit→Manual reader.reload→新searcher可见，close等待writer线程收尾；正常重开不是OS掉电durability保证。

拟资源名`index-primitives.node`＋`index-worker.js`；Rust staticlib仅链接构建产物，不把Cargo缓存／工具链带应用。若静态链接需要额外系统库，须按实际官方输出记录；若改成dylib会新增loader路径与签名成本，不能静默切换。源码路径／包内native路径各独立检查，不依赖cwd，不搜任意PATH或旧/tmp；缺失明确unavailable。构建只在主线另批后扩现脚本，应用构建／签名／真实包worker加载另批，现doc不授权。

## 最小验证与止损（尚未执行）

一个有限验证批即可，不重跑F064a全部性能：①实际包内Bun加载NodeAPI8/ABI版本与错误输入零mutation；②原CRUD手写阶段经worker真实add／same-ID update／delete／same-path new-ID，commit可见及新worker无fixture只读重开；③原BOM/CRLF/非BMP／候选假阳性后验小例保持bytes/span；④重复close、跨workerhandle拒、批间cancel/迟到epoch零发布；⑤未来schema/损坏不创建或改写、缺资源不fallback；⑥可控panic/回执失败明确标注注入，commit事实不倒退、不重发。保原输入SHA／完整双流和错误，不将注入称自然OS错误。

先源码及依赖diff复核，再编译（600秒精确组）及上述固定小批（每例15秒／整批180秒首红停），不以延时放宽造绿。仅自建缓存／夹具，失败保留；若要包内资源闭环，由主线另批unsigned构建与实际worker调用，不能把复制目录布局当真实已打包运行。无需新GUI作为内部桥接入口，但没有UI即明确不能验收全文搜索功能。

源准备前固定以下六组oracle；所有正文以JSON字面解码成UTF8，非法输入先拒，不从引擎输出反推expected。各组独立自建目录；ID只用a/b/c等匿名值，路径p只作测试字段不作文件授权。

|组|输入／操作|固定必达|
|---|---|---|
|1 ABI／准入|ABI=1；非法UTF8 bytes ff、孤立high/low surrogate、17个不同ID单批；累计已有16项再add第17项；已有a为65536个ASCII a再add b为x|坏输入全批零mutation／代数不变；正确替换a为x后add b允许，live bytes=2；错误ABI拒加载|
|2 CRUD／重开|a路径p正文`"\uFEFF中文\r\n😀x"`，b路径q正文`"abcXbcd"`；commit g1；a同ID更新`"中文新"`→g2；delete a→g3；p新ID c正文`"中文"`→g4|g1查中文仅a[1,3)、😀仅a[5,7)，查abcd候选b而最终空；g2中文a[0,2)、😀空；g3中文空；g4中文仅c[0,2)无a。每阶段完整live ID/raw核；close后新worker无fixture重开g4相同、文件成员/bytes不变|
|3 bytes／返回容量|复用组2初始a，返回原文测试接口；输出容量故意不足|原bytes含BOM、CRLF及完整emoji，不能补BOM；不足明确limit／无截断、不执行mutation来扩容；query结果generation等于本次searcher代|
|4 生命周期／取消|一write在途latch，新write；query latest替换；batch1完成后CANCEL；旧epoch响应；close两次；worker B尝试worker A的伪造handle|第二write busy且零调用；已接受write不被取消撤回；取消ACK列最后已commit代，不发batch2；旧结果零发布；正常close收尾ACK后exit；重复close稳定closed、伪handle拒。GC与cleanup顺序各验证无二次释放|
|5 schema／资源|正常g4目录元数据version改为未来2；另独立副本损坏schema；缺meta锁；缺.node或worker资源|打开前／解析时明确拒，目录成员和bytes前后不变，不建writer／repair，不回退旧/tmp；实际加载失败不同于空搜索|
|6 阶段错误（注入）|pre-mutation可捕获panic；另一session在commit g1后注入JS结果分配／回执失败|前者faulted且零mutation；后者unknown而非未写，不能重派batch，正常新session重开见g1；只固定匿名错误。此为注入，不冒自然OOM／abort已安全捕获|

组1边界大字符串属于64KiB累计预算检查，不要求对密集gram额外放宽预算；预算验证先于索引构造。组4 latch为明确测试接点，非忙等或sleep竞态。包内资源加载另获准后复用同小fixture，不增加产品UI入口。

## 义务承接与下一步

|义务|本片可证明的局部|仍由后继正式服务承担|
|---|---|---|
|OBL-006|内部typed消息、ABI参数及固定错误|真实授权集合、docId/revision/hash可信读与RPC服务接入|
|OBL-018|单worker串行、batch/query取消、epoch隔离|优先级、背压、全窗口调度、真实dirty覆盖与服务取消粒度|
|OBL-026|小夹具输入／输出与副本计费观察|可重建缓存总配额、LRU、真实大规模内存／磁盘及观测|
|OBL-035|bridge/schema版本拒绝未来或损坏缓存|产品索引重建、旧缓存迁移／备份、失效与恢复消费者|

这些仅局部承接计划，不在本片提前关闭OBL或父F064；正式实施批准时由主线登记准确claim。本方案先交主线／两轴，当前不写桥接代码或探针，不新增仓库依赖，不运行Cargo或应用build。

## 临时源准备收据（未编译／执行）

主线在两轴路线0必要阻断后仅批准隔离源准备；`/tmp/agentic-f064b-bridge.w0G13h`含header、Rust staticlib、C NodeAPI8、protocol／worker／client／六组cases、run.py、复用processes.py、README与Cargo文件。原锁SHA仍`639d75f7f400a528fb5879936175f31f51ba6a762e5cee8202f80f73dc00f347`，新增lib target但无新crate依赖；只Python AST／JS语法检查通过，未cargo／clang／引擎。复用processes.py SHA `49ee48c63d4aee48d75e8fd5804ab17ce88fb63b3b291271b345a10c8804a7a9`，保精确组和inner／outer错误分账。

源码审中已收窄：固定Tantivy公开`PreparedCommit::set_payload`随同commit保存generation，只有commit返回成功后推进；随后reload失败仍保已提交代、poison／unknown，不冒回滚。close即使rollback返回错误也尝试wait，返回非0不发成功close ACK。C hook与wrapper独立引用防UAF、close预分配返回值、NaN与重叠Buffer前拒；全批零mutation预检与最坏逻辑预留先于clone／gram分配。实际C/worker行为仍待执行，不以源码审冒运行通过。六组中cleanupForTest是明确顺序注入、commitLost是实际worker提交后unknown回执注入，均非自然OS失败；取消记录实际ACK generation及batch派发次数。下一仅待全部源独立审及主线批准运行`run.py compile`／`run.py diagnose`，当前不自行执行。

## 首次编译与退出首红（后续实际收据）

主线获准执行：原目录`/tmp/agentic-f064b-bridge.w0G13h/run-1792339410377845000`编译complete／exec28330 exit0；native SHA `6589e6ea852dce773d6a46bea665f6c00a95dda0094069fcde591e529fc8dd78`。实际rustc系统库输出iconv／System／c／m，重复System链接警告保留；主线otool核仅系统动态依赖。这不是应用打包证据。

随后`run-1792339463364777000`首红：case1正常成功；case2 stdout已输出`{"case":"2","status":"complete","injected":false}`，但子进程15秒内未正常退出，子收据`case2.json`记录exit -15、failure DEADLINE、elapsed 15.061161417秒、members=[]、stderr 0 bytes。父收据failed／FAILED_case2；case3–6未运行。断言完成不等于worker／进程关闭成功，不能称六组通过。原源码、二进制及收据全部冻结，不改close或用terminate掩盖退出事实。

## 退出链最小化计划与源（尚未运行）

已完整读取diagnosing-bugs技能。Phase1原`run.py diagnose`已是实际red-capable反馈；Phase2先减法，不先归因Bun、Rust线程或NodeAPI。新目录`/tmp/agentic-f064b-exit.QZhTo0`仅`probe.mjs`、`bare-worker.mjs`、`run.py`，复用原冻结processes及二进制；每次显式单模式、15秒精确进程组与完整双流／inner-outer错误收据，先审源后授权运行：

|模式|相对前例删减|固定退出oracle|
|---|---|---|
|client-open-close|去全部CRUD、查询和第二次重开，仅原Client／原worker一次open空索引→close|close code0／lastCommit0且真实宿主进程自然exit0|
|direct-open-close|再去Client槽，直接同wire发送给原worker|同open／close收据且自然exit0|
|bare-close|再去native加载及索引，只worker消息→ACK→self.close|ACK完整且自然exit0|

命令为`python3 /tmp/agentic-f064b-exit.QZhTo0/run.py <mode>`。每模式独立新自建输出目录；不process.exit／unref／主动terminate，不额外GC，不延长deadline。遇红保存并停止该命令，下一减法是否执行由主线据证决定；三模式并非已跑批次，也不以裸worker绿替代原红回归。runner运行前核原编译全部source／native／Bun SHA，成功后复核；这里只准备源与语法检查，不建索引或运行探针。建立最小红后再给3–5可证伪假设并先展示，当前无根因结论或修复。

### 三次获准减法实际结果与下一加载边界

主线逐次批准执行，作者随后实读子收据与stdout：

|原退出诊断目录下run|模式|真实结果|
|---|---|---|
|1792339654554977000|client-open-close|ACK／assertions complete；15.067475625秒DEADLINE、exit -15|
|1792339677998033000|direct-open-close|ACK／assertions complete；15.067254417秒DEADLINE、exit -15|
|1792339698421276000|bare-close|ACK／assertions complete，0.148437791秒自然exit0|

三例members均空、stderr均0 bytes。去掉CRUD与Client仍红，无addon裸worker绿；尚不能区分模块env生命周期与实际Rust session，也不能据此判Bun或Tantivy根因。

主线仅批准下一源准备：`/tmp/agentic-f064b-exit-load.4EcutT/{load-worker.mjs,probe.mjs,run.py}`，原Bun／native／全部原源SHA沿同编译收据核验。worker只加载原addon并确认ABI=1，保持消息→postMessage→close顺序，绝不open／创建索引／调用Rust session。命令`python3 /tmp/agentic-f064b-exit-load.4EcutT/run.py`仍单例15秒精确组、双流、真实自然退出oracle；不GC／unref／terminate／process.exit。当前仅语法检查，未执行；若红说明不需要实际session也能复现，若绿仍须继续收敛session边界，不直接当修复。

### 加载对照实证与计数诊断计划

主线随后执行load-only：`run-1792339785412019000`实际exit0、0.076961917秒、members=[]，stdout ABI=1 ACK断言complete，作者已读子收据。主线程原case1正常与worker load-only正常为有限控制；实际session open-close仍红，尚非唯一根因。

主线已向用户展示三条可证伪假设：H1 wrapped JS对象finalizer尚未回收牵住退出；H2 Rust reader／writer仍有资源未释放；H3 native-close ACK与worker close顺序相关。下一新源`/tmp/agentic-f064b-exit-audit.fT2xB0`仅利用原二进制已有audit／stats，不重编、不改原源。`run.py audit`与`run.py audit-gc`两个独立显式模式：同单worker空索引open→native.close code0→清handle引用→30次1ms让出→ACK→worker.close；唯一臂差异为后者每次让出前`Bun.gc(true)`。两侧保open、afterClose、afterYield计数及实际audit文件，即使超时也读取保存close／finalize／cleanup／state-free观察，不预断finalize应何时发生，不调用cleanupForTest。

H1预测：若显式GC后finalize计数推进且自然退出，而无GC仍挂，将支持回收边界相关性（不把GC当修复）。若两侧已finalize仍挂，弱化H1并需定位H2／H3；原生close计数只证close调用返回，不证明全部线程已退出，不能据它排除H2。H3本轮保持ACK／close顺序不变，暂不试换序以免混变量。每次15秒精确组、真实自然exit0为唯一退出通过标准，禁止process.exit／unref／主动terminate；后者是否运行仍由主线据前例批准。源仅AST／JS语法检查，未执行，固定原native／Bun／源SHA，双流及首红完整保留。

### 无GC审计首臂通过，下一仅缩减让出

主线执行`/tmp/agentic-f064b-exit-audit.fT2xB0/run-1792339943585377000`：audit臂自然exit0／0.158535042秒／无残组，作者实读stdout及audit。opened=1/0/0、afterClose=1/1/0、afterYield=1/1/0；文件顺序open→close→cleanup→finalize→state-free，终计数1/1/1。没有强制GC，且ACK前freed仍0，故“必须强制GC才可退出”已被此有限控制反驳；不证明全部H1变体或H2/H3均已排除。audit-gc未跑，旧30次让出源冻结。

主线批准下一仅源准备`/tmp/agentic-f064b-exit-timing.GCFJZS`：同三文件与审计逻辑、同native及Bun pins，只将让出改为两个明确模式`zero-yield`（0次）与`one-yield`（一次`setTimeout(resolve,0)`）。命令`python3 /tmp/agentic-f064b-exit-timing.GCFJZS/run.py <mode>`；独立目录、15秒自然退出、双流及失败审计保持，先zero后由主线决定one。无GC、无强退，不把timer作为修复；当前只AST／JS语法检查，未执行。若zero红而one绿，仅支持跨任务时序相关；若zero亦绿，说明先前审计/封装等差异仍需单独收敛，不能把该对照冒原链已修复。

主线实际zero-yield `run-1792340058213657000`自然exit0／0.121779458秒／无残组，作者核audit仍open→close→cleanup→finalize→state-free，终1/1/1。one-yield未执行；因此yield亦非必要，不能把上一绿归因延时。

下一主线仅批准源准备`/tmp/agentic-f064b-exit-live.gfdt8o`：复制zero-yield三源，worker仅新增`invoke(native,handle,4)`及code0／generation0断言，位置为open后、close前，其他audit／单消息／session局部作用域保持。runner只允许`zero-yield`，未启用保留的一次timer分支；命令`python3 /tmp/agentic-f064b-exit-live.gfdt8o/run.py zero-yield`，仍15秒自然退出、原binary及源SHA、无GC／强退。仅语法检查未跑；用于判断原worker额外live／ABI Buffer路径是否与退出差异相关，不据源码预判。两消息差异留待此例后决定，不扩矩阵。

主线实际live对照`run-1792340150920724000`自然exit0／0.116781750秒／无残组，作者核cleanup→finalize→state-free完整且终1/1/1；live调用本身不足以复现红。

下一仅源准备`/tmp/agentic-f064b-exit-retain.Nk6EWR`，相对已绿live源只在session返回前将已关闭wrapper赋给`globalThis.retainedClosedWrapper`，其余一消息、原audit、无yield、无GC、原native及15秒标准不变；probe与runner逐字节同。命令`python3 /tmp/agentic-f064b-exit-retain.Nk6EWR/run.py zero-yield`（模式名沿用，实际差异由独立source SHA表明）。控制为刚完成的不保留live例；若retain红则支持wrapper可达性相关，若仍绿则该强引用不足以复现，继续保留原两消息／栈内close差异。当前仅AST／JS语法检查，未执行，不修改原worker或宣称根因。

主线实际retain `run-1792340330179498000`自然exit0／0.114432209秒／无残组，作者核audit完整终1/1/1。该全局强引用不足以复现；不由此推全部wrapper生命周期无关。

下一从原失败direct-open-close侧仅加审计：源`/tmp/agentic-f064b-direct-audit.FIVB5J`的worker为原worker拷贝，除protocol/native资源定位仍指向原冻结目录外，只在open校验后加`native.audit(Buffer.from(m.payload.path+'.audit'))`。两消息、同步handler、close分支局部const h作用域及ACK→close顺序完全保持；不新增wire字段。probe相对原退出诊断版仅将direct分支Worker目标改为本地副本。runner仅允许direct-open-close并在失败收据保`index.audit`，原pins／15秒／自然退出标准不变。命令`python3 /tmp/agentic-f064b-direct-audit.FIVB5J/run.py direct-open-close`；仅AST／JS语法检查，未执行。先排审计行为影响，再据证决定是否缩两消息或同步handler，不把当前控制扩成修复。

主线实际direct-audit `run-1792340417951080000`仍红：ACK／assertions complete但15.067487916秒DEADLINE／exit -15，无残组；作者核audit仅`open 1 0 0`、`close 1 1 0`，未观察到cleanup／finalize。审计本身没有使此路径转绿，不把缺少事件解释为已定位Bun或Rust根因。

下一仅源准备`/tmp/agentic-f064b-direct-async.PSLmqV`：相对direct-audit唯一worker代码差异是`self.onmessage=event=>`改为`self.onmessage=async event=>`，没有await，probe／runner逐字节同。命令`python3 /tmp/agentic-f064b-direct-async.PSLmqV/run.py direct-open-close`；保持原binary／SHA链／两消息／close作用域／15秒自然退出标准。仅语法检查，未执行；单因素即便绿也不等于修复或完整六组通过，后续须回原完整路径及生命周期合同。

主线实际async对照`run-1792340517688295000`父执行exit1；作者核子收据为DEADLINE／exit -15／15.076844666秒／无残组，ACK完整，audit仍只有open／close。async无await不足以解决该退出差异。

下一源`/tmp/agentic-f064b-direct-stack.ONkpmI`基于原同步direct-audit，只把action关闭分支的`close()`改为`return true`，handler在`action(m)===true`返回之后才调用worker `close()`；native.close／ACK原位置不变。probe及runner逐字节同，仍两消息／同步handler／audit／无yield或GC／15秒自然退出，命令`python3 /tmp/agentic-f064b-direct-stack.ONkpmI/run.py direct-open-close`。仅源与语法检查未执行；测试局部action栈结束后的差异，不把潜在绿提升为完整修复。

主线stack实际`run-1792340668546136000`父exit1；作者核子DEADLINE／exit -15／15.063761542秒／无残组，audit仅open／close，移出action栈未消除此红。

下一源`/tmp/agentic-f064b-live-two.aVi8EG`从已绿live路径拆成两消息：首open→invoke4(g0)→stats→ACK；宿主确收首ACK后才发close，第二native.close→stats→清handle→ACK→worker.close。worker保持async无await、无yield／GC，handle仅为跨消息而保留在worker模块作用域；原audit、native及15秒自然exit标准不变。runner与live原件逐字节同，命令`python3 /tmp/agentic-f064b-live-two.aVi8EG/run.py zero-yield`。AST／JS语法检查通过，未执行；测试跨消息session边界，不声称单例可区分所有运行时原因。

主线live-two `run-1792340781462206000`通过；作者核子收据实际0.121900167秒／exit0／无残组（不用先前口头约0.102秒代替），audit完整终1/1/1。两消息及跨消息handle本身不足以复现。

剩余变量只读排序：绿例在open后和close后调用native.stats（C会创建JS对象／三个数值），红例无stats；红例open ACK额外调用native.version，绿例仅加载时核版本；此外仍有wire／ACK结构、局部h、catch／action函数及null/undefined差异，现有控制不证明它们全无关。推荐下一最小因素从红direct-audit仅在native.close返回后加一次`native.stats()`（不改变ACK或消费其值）；若转绿，支持关闭后NAPI调用／分配相关而非stats成为正确修复，随后需逆向控制。若仍红，只能说此单次位置不足，不排除open处／次数影响。第二候选才是在已绿live-two的open ACK前加原`native.version()`并核1，判断是否转红；两因素不合并。当前仅建议，无新增源码或执行；仍需原六组回归和正常生命周期理由才可提出修复。

主线随后发现更高信息差异并调整优先级：原direct-audit的global close在handler try/catch内，已测stack例亦仍在catch内，而绿live-two无此catch。下一建议仅action关闭分支返回true，handler局部标志记录action返回；native动作与ACK仍在try内，`if(shouldClose)close()`放在整个catch之后。若该路径绿而先前“只移出action、仍在try”红，则支持catch边界相关性，不直接宣称捕获了运行时内部异常；stats／version建议暂不执行。只读原direct probe确有观察缺口：close promise首次resolve后onmessage仍在，第二次相同id回执只会再次resolve已完成promise，未记录其result；所以现有ACK日志不能排除随后BRIDGE_ERROR，但没有证据证明它发生。当前仅差异与预测，无新源；可在另行获准时保全每条消息，且须区分观测增加与代码因素。

主线选择先补观测、暂不移动close。新源`/tmp/agentic-f064b-direct-events.LxL5OG`的worker逐字节同direct-audit（SHA `9abc32cb18d55227204f992000e74e78bf53011d4e4b1aa3cb3769b7c9c4ffaa`），probe保原send／ACK，新增永久message/error监听。最多输出16条固定匿名摘要，超额仍累加计数并失败；首两消息必须精确匹配原open／close，任意额外消息、BRIDGE_ERROR或error均登记失败。error只给ReferenceError／close关键词布尔分类，不输出正文、路径或完整错误。beforeExit仅首次输出完整计数，任意错误置exitCode1但不强退；runner要求真实exit0与四条严格事件／summary，否则失败。旧15秒与原pins／audit保持，命令`python3 /tmp/agentic-f064b-direct-events.LxL5OG/run.py direct-open-close`；仅语法检查未执行。

这是断言加严，不改关闭oracle。此前各简化例只证明自然退出及首ACK断言，不能追认“无worker error”；尤其异步回调的迟到拒绝尚未被原探针完整观测。close未定义／普通异常／运行时特殊行为均仍待证，暂无根因结论。

执行前源审纠错：mentionsClose初稿误用匹配字面反斜杠的正则，主线与Spec指出后已改为真正词边界`/\bclose\b/`并重新冻结SHA；尚未运行，非实验红或oracle变更。其余源未改。

主线events实际`run-1792341036120020000`仍DEADLINE／子exit -15／15.071589834秒／无残组。作者实核stdout前两条成功消息及assertions后，有第三条ordinal3／id2／exact=false／bridgeError=true，audit仍仅open／close。已证首ACK曾掩盖后续错误，但错误类型未明。

下一仅源`/tmp/agentic-f064b-catch-kind.t3taIm`：events worker的catch改接err并stderr输出固定JSON三字段`referenceError`／`mentionsClose`布尔及`closeType=typeof globalThis.close`，不打印原message／stack／路径。原BRIDGE_ERROR协议、native调用及关闭流程不变；probe／runner逐字节同events，仍严格原红oracle及15秒。命令`python3 /tmp/agentic-f064b-catch-kind.t3taIm/run.py direct-open-close`；仅语法检查未执行，原源全部保留。

主线分类实际`run-1792341116467553000`，作者核stderr为`referenceError:true, mentionsClose:true, closeType:"undefined"`；随后第三条同id BRIDGE_ERROR，15.074707417秒DEADLINE／exit -15／无残组。结合原调用位置，定位为实验使用不存在的global close被catch，消息监听器未移除而留活；不归因Bun或Rust原生缺陷。旧简化例遗漏迟到error，不能提升其成功范围。

主线批准新候选源`/tmp/agentic-f064b-direct-drain.XbszZl`基于direct-events，仅将worker关闭分支`close()`改为`self.onmessage=null`；保native.close及ACK顺序，移除分类TEMP，probe／runner逐字节同严格事件版，无process.exit／unref／terminate。依据主线已核[Bun terminating a worker](https://bun.sh/docs/runtime/workers#terminating-a-worker)的监听器保活／无待办自然退出合同，等待原生正常close后解除唯一监听器。命令`python3 /tmp/agentic-f064b-direct-drain.XbszZl/run.py direct-open-close`；仅语法检查未跑。若该原红路径通过，仍需新目录完整六组及加强终态oracle，不改旧冻结目录或历史红。

主线direct-drain实际`run-1792341199195853000`通过，作者核exit0／0.115079875秒／无残组，summary恰2 messages／0 errors／0 bridgeErrors，audit完整cleanup／finalize／state-free终1/1/1。

获准的完整回归源位于`/tmp/agentic-f064b-regression.tQc04Q`：cases／client／protocol与原件cmp逐字节同；worker唯一改动close→onmessage=null，无TEMP audit；复用原native SHA `6589e6ea852dce773d6a46bea665f6c00a95dda0094069fcde591e529fc8dd78`不重编。新增launch独立观察所有真实Worker派发／消息／error／close，台账不依赖Client过滤。hold允许一次通知及原hold id终态，release自身无回执；case6仅已派发commitLost id允许一次预期unknown。每worker无pending、无多余响应／error，close/cancel代必须为手写预期（case2为4/4、case4为1、case6为1），close event code0且一次；beforeExit摘要与宿主自然exit0联合核。原case4明确GC顺序测试保留，不新增退出GC。casebody未改，注入与真实错误分开。

仅AST／Node语法检查和SHA／cmp通过，未运行；命令`python3 /tmp/agentic-f064b-regression.tQc04Q/run.py`，6组15秒／180秒整批／首红停、原全部pins与双流保留。close事件仅辅助标志，不单独冒实际线程已完全结束；仍以宿主自然退出及原生audit收尾为有限证据。

## 完整六组实际收据

主线`/tmp/agentic-f064b-regression.tQc04Q/run-1792341527379330000`complete，作者实际读取父／六子收据、stdout摘要、stderr及case4 audit，并重核六source pins及native SHA原样。六子均自然exit0／无timeout／无残组，分别2.172453、0.363810、0.169937、0.350532、0.175952、0.298229秒。case1/3/5无worker；case2两个worker分别22／4请求，case4六请求且held1／release1，case6四请求且仅预期commitLost unknown1。全部pending／errors／failures为0，四worker各一次close event code0且正常关闭代符合手写预期。

case4 audit终`state-free 2 2 2`，两close／两finalize及cleanup完整；case6 stderr恰两行固定`INDEX_PANIC`符合两次注入，其余stderr空。只有有限自建桥接／worker行为证据，不等于自然panic安全、正式缓存授权、应用打包或搜索产品验收；独立结果复核／主线最终结论另记。

## 下一最小正式接入建议（未批准实施）

建议把“实际包内资源链”作为本片剩余内部闭环或紧邻下一片，而不是直接接窗口搜索。由主线决定编号／交付范围；本段不授权代码、依赖或构建。

主线现已明确：F-064b仅收固定桥可行性实验，下面正式接入工作归F-064c方案，不把F064b通过冒这些工作已交付。

1. **构建**：仓库新增独立Rust lib/C header桥与锁，精确Tantivy0.27及当前传递锁；独立`build-index-native.ts`由既有native构建入口调用。显式配置并验证Rust1.90工具链，缺失明确失败，不自动下载／升级／引用旧/tmp。记录cargo `--release --locked`与native-static-libs实际输出，clang NodeAPI8静态链接为`dist-native/index-primitives.node`；不带Cargo缓存／target进app，不静默换dylib。全局panic hook必须单独确认应用级影响，不能直接复制实验once-hook就称隔离。
2. **资源**：`index-worker.ts`单独Bun.build到`dist-native/index-worker.js`，沿已有native复制接点进入包。index自有resolver从源码dist-native或包内native固定位置找两资源，不依赖save文件、cwd或旧/tmp，缺失返回unavailable；真实包验证只自建缓存，不添加用户UI入口。
3. **typed session**：把当前严格协议／ABI声明迁为独立typed模块与host session，保一在途＋一latest query、busy前拒写、唯一提交代及unknown不重放。只正常native close后解除唯一消息监听器并核终态；不得回用不存在global close，也不复制测试Worker子类／hold／commitLost／audit作为产品API。正式query只返回有限ID/span/generation，不携全raw；测试能力须独立隔离。renderer、真实授权读、dirty覆盖和完整调度不在此步。
4. **验证与收口**：实现后先同六oracle与独立终态测试，再由主线单独批准应用构建并核真实包内Bun→worker→addon的小CRUD／重开／缺资源／自然退出。保源编译和包内二进制来源收据，不冒仅复制资源已验证加载。完成后将最小源／固定输入／原红与最终收据归档为可复跑证据；OBL006/018/026/035仍仅部分承接，缓存重建／配额与正式窗口消费者留后继，不扩成本调优。

## 有限验收与最小持久材料方案（历史盘点，实际入仓见下）

主线据两轴实际终核批准本片受托代验通过，仅固定自建缓存、原生ABI／NodeAPI8／Bun worker六组。正式app构建／资源链、用户授权、dirty覆盖、搜索UI、真实OS故障／OOM／abort及完整缓存配额未交付；OBL-006/018/026/035保持deferred，无关闭claim。当前包仍alpha186，不新增用户可用功能。

已只读盘点15个明确临时目录，所有run都有complete或failed终态：拟纳入**164文件／1,223,070 bytes**，其中源码57／199,826 bytes，收据双流及audit107／1,023,244 bytes。源码包括原Cargo.lock、header/Rust/C、完整cases和最终observer；所有历史减法及失败保留。表中路径均以`/tmp/agentic-f064b-`为前缀，数字为文件数／未压缩bytes。

|目录后缀|源码|收据／双流／audit|
|---|---|---|
|bridge.w0G13h|12／96008|16／244631|
|exit.QZhTo0|3／3867|12／207689|
|exit-load.4EcutT|3／2649|4／3595|
|exit-audit.fT2xB0|3／4405|5／4468|
|exit-timing.GCFJZS|3／4364|5／4329|
|exit-live.gfdt8o|3／4474|5／4398|
|exit-retain.Nk6EWR|3／4609|5／4329|
|direct-audit.FIVB5J|3／6611|5／102667|
|direct-async.PSLmqV|3／6617|5／102651|
|direct-stack.ONkpmI|3／6633|5／101279|
|live-two.aVi8EG|3／4413|5／4395|
|direct-events.LxL5OG|3／8787|5／102103|
|catch-kind.t3taIm|3／9000|5／102956|
|direct-drain.XbszZl|3／8799|5／4381|
|regression.tQc04Q|6／28590|20／29373|

名单规则严格限定：各目录根源文件及bridge/src/lib.rs；上表终态run目录的直接`.json/.stdout/.stderr/.audit`文件，以及case4/lifecycle.audit。不递归包含case索引文件；排除native binary、target、工具链／Cargo cache、pycache和生成索引。原native只保SHA／编译命令／系统链接输出，不伪称另机重编必字节相同。

拟入仓仅`research/f064b/README.md`、逐文件相对路径／size／SHA／原来源的`inventory.json`、一个无损`evidence.tar.xz`和pack验证收据；164成员全部保原bytes，不铺散历史run，也不复制F064a工具与缓存。沿F064a自产固定SHA包规范：安全相对路径、无链接／特殊项／重复路径、逐成员及总展开量核对，完整tar尾／XZ EOF后才complete；本片固定2MiB总展开保护足以覆盖盘点（不当解码器RSS硬限）。压缩包大小待实际打包，不预报。

无需新增通用replay框架。README明确原/tmp绝对路径是历史收据，不直接跨机执行；人工重建前置为macOS arm64、固定Rust1.90和原Cargo锁、NodeAPI8 headers及包内Bun精确版本／SHA记录。工具取得与校验复用F064a研究说明；在新work副本显式重映射原run.py／cases／worker资源引用，留映射diff和新SHA，执行公开cargo/clang命令后再六组，禁止覆盖历史。测试小文本在cases字面中，无须归档索引数据库。可审证据先持久化，自动跨机可移植重放不作本片承诺；当前尚未复制入仓或打包。

## 持久归档实际收据

主线在`/var/folders/jy/rh9p8thj3t32m4pwhk38jydc0000gn/T/agentic-f064b-pack.i5f9ib5o`执行打包exit0，收据complete：164成员／1,223,070原bytes，完整tar展开1,351,680 bytes，XZ100,084 bytes，SHA `c44a3ceea313f1d0bbd81f51ce1960adf4fa386f0556160064579a780b03d768`。逐成员size／SHA、总量、零尾与完整EOF均核通过，不是引擎重跑。

主线批准后入仓[research/f064b](../../research/f064b/README.md)五文件：README、inventory.json、evidence.tar.xz、pack-receipt.json及原冻结archive/pack.py。后四件保持原bytes，脚本SHA `9f0533b55bf4f3deea1834cddbf88f1c84b839faa4959ffc78dac7188b65d39b`与原收据一致；清单SHA `bac8ca269150f2d75d420dad1e16807abe2cf850e6d64d24b7b0963e0589af6a`。未带native binary／索引／工具链／缓存；脚本只针对固定自产清单，不作通用不可信输入工具。原历史路径须在新work手工重映射，未执行迁移后的编译或引擎。归档最终审与Git仍待主线，不把研究通过冒全App测试或产品搜索完成。

入仓后独立Spec／Standards均实际核全部成员、完整EOF、原件SHA与README范围，0必要有限归档交付阻断；主线批准收尾。主线另跑typecheck、full lint、check:feature-docs（含obligations）、check:lockfile和diff检查均通过；本轮未改应用代码，不重跑全App测试，不把六组桥实验冒全App全绿。Git尚未执行。
