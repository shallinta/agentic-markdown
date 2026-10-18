# F-064a：持久全文索引后端有限选型

> 状态：主线批准有限研究受托Agent代验通过，非用户亲验；Tantivy为下一持久索引集成候选，未集成产品搜索。四套正确性、有限万篇10+20及XZ归档／无引擎迁移三步已完成，两轴0必要有限证据阻断。L50、CRUD14、真实36及scale三档54phase含六次批间取消保持；原200次120秒止损首红不改称通过。获准一次入仓research/f064a，收尾差异待最终复核，未执行本片Git；无生产依赖或应用版本／构建变更。

<!-- obligations: none -->
<!-- deferred-obligations: OBL-006, OBL-018, OBL-026, OBL-035 -->

### 当前持久交付收尾收据

主线无引擎迁移三步session33685 exit0，`preflight complete / engineExecuted:false`；实际work为`/private/tmp/agentic-f064a-replay-check.rxgBGU/work`。作者读取migration-environment、inputs.complete和145行patch，6文件仅路径／离线cache消费变化。两轴独立核2584历史全SHA、78派生文件、36真实及11328合成raw与pins，未见target／新引擎run；不能称迁移版引擎复跑通过。

主线随后批准一次入仓：`research/f064a`实际32文件／10046378 bytes，包括20XZ包、原packreceipt与inventory、两封装源、replay／paths、中文README、4个原迁移收据／diff及一份exec文字说明。20包逐SHA、inventory固定SHA及四迁移原件逐bytes核同；原无末LF的三个JSON经主线特批精确复制保持bytes，不将格式化差异冒原件。没有带入展开history、cache、raw、target、索引DB或旧gzip。docs／obligations／diff检查通过；尚待最终入仓复核及主线Git操作。原历史段的“未pack／未迁移”均为当时状态，以本条终态为准。

## 功能与范围

依据总账第147/148/260条、N-02/N-03、Q-24及2026-09-02决定：全文搜索覆盖当前窗口已加入的 Markdown 集合（包括独立文件），本地持久增量索引是可删重建缓存，不是正文真源。dirty覆盖并屏蔽旧磁盘命中；结果分组、流式、虚拟化、可取消。MVP筛选只有root/path/-path/file，非法或歧义值不得静默当正文。跨文档正则、批量替换及P1筛选不纳入。

本片只形成可复跑选型证据，不交付搜索UI。必须同固定corpus比较Tantivy与SQLite FTS；不能预选SQLite或把Quick Open元数据查询冒全文搜索。本片拟局部承接OBL-006/018/026/035的服务边界、调度、缓存与schema调查；现有隔离证据不自行变更义务登记或关闭完整义务，正式消费者承接仍须对应批准与互链。F029完整恢复、F032完整区域路由、F028c、阅读子窗、专项、FINAL001002003及offline保持开放。

继承检查：**F-002**独立复核与失败证据；**中文与外观**中文错误/覆盖状态，GUI后续；**命令与键盘**后续入口及取消不抢编辑输入；**安全与日志**只自建临时语料、不上传、不读用户正文，日志仅匿名ID/计数/阶段，不输出正文或用户路径。

## 已读取真实接点与缺口

- `bun/workspace/index.ts`的Root持有authorization、generation、nodes/byPath/files、registry和queueBytes；scan结果是当前已加载授权集合，不是全磁盘快照。扫描partial/paused/hidden及独立授权去重必须成为未来coverage信息，不能零命中冒全目录已搜。
- `bun/workspace/worker.ts`是单Worker、单在途请求、serial匹配和dispose协议，不是现成通用全文搜索调度器。`scan-protocol.ts`严格验证root proof与联合预算；不能把全文正文塞扫描批或占住扫描worker长期查询。
- `bun/documents/index.ts::snapshot`经stableBytes/fatal UTF8/hash/capability建立版本，commit才写identities。identityKey为path:fingerprint；保存written成功后迁移fingerprint且保documentId。不能用索引读取走UI普通read产生标签/MRU；未打开文件的持久索引身份分配尚需正式可信服务设计，禁止把所有扫描node.handle冒documentId。
- renderer `raw-buffer.ts::rawText`保原BOM/EOL；dirty覆盖必须携documentId+bufferRevision与有效授权世代，不能用CM规范化doc冒原文。未来磁盘增量接保存成功、可靠文件观察、创建/Trash/撤权；异常/unknown不能猜删除。现在没有可直接继承的完整索引服务。
- 后续结果打开可先复用当前主区持久打开守卫，不宣称F032全部完成。本片CLI/隔离工作单元结果不等于Bun Worker/RPC或真实WK已验。

## 候选与公开来源

候选A：拟锁Rust Tantivy **=0.27.0**，不用浮动latest；[版本化crate文档](https://docs.rs/tantivy/0.27.0/tantivy/)与[版本化manifest](https://docs.rs/crate/tantivy/0.27.0/source/Cargo.toml)作为执行前核验入口。作者本次web读取这两页失败；主线latest缓存显示0.27.0但固定页不可访问，crates.io版本API返回HTTP403（不归因），故尚未证明此版本可实际解析下载。早期可读0.25.0文档仅API背景，不用旧版偷偷替代比较。Standards已核官方当前manifest要求Rust1.88，本机rustc/cargo1.69不足；后续须单独批准官方Rust1.88工具链下载至新临时prefix，记录来源/校验并只显式路径调用，不改Homebrew、持久PATH或全局默认。执行前须核官方tag/registry实存版本、准确crate校验与Cargo.lock、rustc/target、release参数；版本源无法验证即停止并报告，不据旧工具链把Tantivy判性能劣势，不自动换版本或取消两者比较。

候选B：本机Bun所带SQLite FTS5。Standards纯内存只读SELECT报告源码Bun1.3.14、alpha186包内Bun1.4.0均SQLite3.54.0且ENABLE_FTS5=1；这不是建表/tokenizer或基准实测。拟固定包内Bun1.4.0比较，运行前冻结实际路径/hash、sqlite_version/source_id与compile_options；tokenizer能力另实际验证。参考[SQLite官方FTS5](https://www.sqlite.org/fts5.html)：unicode61并非中文词典；trigram的MATCH短于3个Unicode字符不能直接满足短中文，LIKE/GLOB可能退扫描。不得只测长词掩盖短词。[Bun SQLite接口](https://bun.sh/docs/runtime/sqlite)为同步调用，放Worker不自动得到底层计算中断。

核源新证据（主线只读，2026-10-18）：[官方稀疏索引](https://index.crates.io/ta/nt/tantivy)两次HTTP200，0.27.0条目yanked=false、rust_version=1.88、pubtime=2026-10-17T11:17:43Z、crate checksum为`ad1ebacf6bc124b741ffbfb088f9835cb55e1e2ff57e182e9219e3efa1377b97`。Rust官方channel 1.88.0 manifest.sha256 HTTP200给出`431b7c5c0b9a511d8e31d29b378bbc74124e8521f14beb92d3a5a5f7e7e55449`。这补足版本存在性，不抹去上述API403历史；尚未下载包、安装或编译。Rust1.88是该crate最低要求，不证明将解析的传递依赖兼容；实际锁文件及release构建必须另核，不自行升级工具链或依赖。

两候选都必须报告原生tokenizer诊断，再比较同语义适配路径。若短词需补单/双gram、候选后验证或扫描fallback，明确算法、额外索引/原文存储、最坏扫描量及取消粒度并共同计费；不能一方substring、一方默认term排名却宣称速度胜负。排名模型、大小写/重音/归一化和多关键词组合尚非已确认产品语义：下节仅冻结实验profile，不升级用户决定；产品需要的取舍在结果后明确提出。

## 固定语义首批（先于性能）

拟议profile L：对正文执行**大小写敏感、不做Unicode归一化的精确连续码点子串**，用于共同召回正确性/短词成本对照，不声称最终产品只能如此。手写语料ID与正文如下；源码BOM/CRLF另按字节fixture保留，不改用户文件。

| ID | 正文（反斜杠转义按JSON解码） |
|---|---|
| a | `中文检索支持中英混合。` |
| b | `中国文字与全文搜索。` |
| c | `Alpha alpha alphabet` |
| d | `café cafe\u0301` |
| e | `甲😀乙 𠮷野家` |
| f | `\ufeff第一行\r\n第二行` |

冻结期望集合：`中`→a,b；`中文`→a；`文检`→a；`全文`→b；`Alpha`→c；`ALPHA`→空；`café`→d且精确片段为组合é；`cafe\u0301`→d且片段为分解序列；`😀`→e；`𠮷`→e；`第二行`→f；`不存在`→空。非BMP不得切半，结果片段必须对应实际原文；单独测试空查询为“无执行”，未配对surrogate为明确拒绝而非替换字符查询。另记录默认tokenizer在这批的差异，不将预期差异混为适配profile通过。

L物化规则同样仅为实验合同：每文档仅返回最早一个命中，按匿名文档ID升序；offset为原始解码字符串的UTF-16 code unit、左闭右开，BOM占1、CR与LF各占1，不归一化。片段严格为该范围原文，不增加上下文。手写范围：a的`中`[0,1)、`中文`[0,2)、`文检`[1,3)；b的`中`[0,1)、`全文`[5,7)；c的`Alpha`[0,5)，另加`alpha`只取[6,11)而非alphabet内后一次；d的`café`[0,4)、`cafe\u0301`[5,10)；e的`😀`[1,3)、`𠮷`[5,7)；f的`第二行`[6,9)。双方必须在同一计时范围内完成原生offset转换、后验证和结果物化，不以不同字节/码点单位直接比较。

控制面固定小例：a磁盘含中文，dirty覆盖改为“草稿独有”，旧中文命中屏蔽、草稿命中出现；较旧bufferRevision迟到不得覆盖。删除b后旧结果拒绝；同path重建新ID不继承；撤root后索引尚未清理也不返回其结果；query2取代query1后旧批不能提交。root同名由ID区分；正/负路径及file过滤按固定fixture集合交集，不解析后端查询语言。此处使用隔离模型，只证适配器协议，不冒正式workspace接线。

## 公平成本批次（首批通过且主线确认后）

批准运行前在新mktemp目录冻结manifest与SHA：上述手写语料；固定中/英/混合自然段落（自写或明确许可来源并附来源/原文哈希）；按固定seed构成100、1000、10000文档三个规模，每篇约4KiB、少量明确1MiB合法边界，合计上限64MiB。生成重复块标记为合成成本样本，不冒真实用户corpus；自然段落必须包含跨token中文短词，不能仅随机ASCII。两后端读取同字节、同插入/更新/删除顺序、同查询集及相同结果数量/片段策略。完整manifest和查询expected IDs需在执行前经主线读核，不依据输出补答案。

上述seed/重复块批次只是工程预检，**不能单独满足Q-24或据此最终选型**。最终比较还需另批冻结有明确再使用许可的真实中文、英文及混合Markdown文档集manifest（逐文件来源、许可、原始字节SHA、大小与语言分层，不用复制模板凑数量），双方同集合和查询oracle；尚未选定/下载该集合。本片不得因工程预检绿就写“选型完成”。

每后端独立release优化进程/持久目录；相同单查询并发、写入批次、commit可见点，明确writer线程数/内存预算/merge设置，报告不可等同参数而非强行声称完全相同。底层engine时间与适配器端到端时间分别记录，含tokenize、候选后验证、IPC/序列化、结果物化，不用裸engine代替交付成本。

- 构建：空索引至commit且reader可见全部语料；另报编译/进程启动，不混入索引时间。磁盘统计commit后全部索引文件（含WAL/暂存），另报显式关闭后稳定大小；不只主文件。
- 增量：固定1篇和固定1%更新、添加、删除，测到新reader可见；逐次核旧命中消失/新命中出现，记录写放大与峰值空间，不用整库重建冒增量。
- 冷暖：新进程首次打开+首次查询称“进程冷”，不称OS页缓存冷；不purge系统缓存。暖轮先固定10次预热，再同顺序200次查询，报告样本数、p50/p95/p99/max与逐次原始数据。三轮按AB/BA/AB交错，输出每轮不只平均；冷、暖、短词fallback分列。
- 内存：宿主采样各受测进程及子进程RSS，保时间序列/采样间隔和可得的系统maxRSS；区分基线、峰值、增量、mmap影响，承认采样可能漏峰。不能把JS heap或writer参数当总RSS。
- 取消：固定latch在查询批间发取消，记录最后提交批及工作停止时间，分别报告“拒收旧结果”和“实际中止计算”；若底层同步调用不可中断，明确后续架构成本，不能用host kill冒协作取消。

这些均为有限观测，不设置产品性能SLO、不以一次快慢预定胜者。正确性不足者不得参与同语义速度排名；若两者均有明显缺口，保留结论而不强选。

## 执行与停止边界

当前**不运行**。严格分阶段：①环境/官方核源，隔离下载工具链仍需批准；②另获准的原生tokenizer诊断，仅记录差异、不判L适配通过；③在本唯一冻结双方具体schema、tokenizer、query候选算法、单/双字短词fallback、postverify、原文存储、offset转换及返回策略，独立复核且主线批准后才执行六文档L语义/控制例；④语义通过后冻结完整成本manifest并另批性能。不能将本方案当算法试错或一揽子执行许可。每语义例15秒、整语义批180秒；编译单列最多10分钟，失败不运行测试。成本每case120秒、整批15分钟宿主上限；均是实验止损而非SLO。只新临时目录与其索引，可保留所有产物；不删除用户文件、不清系统缓存、不改网络/系统配置。

任何固定语义assert失败、输出越界、超时、异常退出立即停当前批并保源/lock/命令/stdout/stderr/receipt，不改oracle自动重跑；缺能力按“不支持/未执行”报告，不能算通过。性能观测慢但未达止损不判语义失败；两路线及独立复跑完成后由主线选择/要求窄修，而非作者自行批准生产。后续typed服务、真实授权/dirty覆盖、保存/删除消费者、损坏重建、UI/中文键盘与实际WK仍是新批准工作，不由本片模型绿替代。

## 隔离工具链执行收据（2026-10-18，MSRV首红停止）

按主线仅工具链阶段授权执行，目录`/tmp/agentic-f064a-toolchain.XOLigk`：`downloads/`、`unpack/`、`prefix/`、`cargo-home/`、`target/`及`project/`全部独立。未改系统默认Rust/PATH、仓库生产/依赖/版本或构建应用；未执行tokenizer/L/成本实验。新project只有exact `tantivy = "=0.27.0"`与空`fn main() {}`，没有运行该程序。

下载均`curl --fail --location --connect-timeout 15 --max-time`（manifest60秒、组件180秒）并加大小上限（manifest1MiB、rustc256MiB、cargo64MiB、std128MiB），完整URL/参数、stdout/stderr和exit保存`logs/manifest.*`及`logs/download-{rustc,cargo,std}.*`。manifest SHA与上文一致；组件均来自官方`https://static.rust-lang.org/dist/2025-06-26/`：

| 文件 | 实际bytes | SHA256 |
|---|---:|---|
| rustc-1.88.0-aarch64-apple-darwin.tar.xz | 63368208 | 249f4cacd3fac1f718af19373c73e9d3b9a595965972d8b1f3947c578110f520 |
| cargo-1.88.0-aarch64-apple-darwin.tar.xz | 7892628 | 71c08c8fab9b7a9cd13b6119886d50ce48efa8261d08e1fd328ed3ee1c84e2e0 |
| rust-std-1.88.0-aarch64-apple-darwin.tar.xz | 26240408 | 532be07511af557cb67f33bfc77044a787363ab281b963752542bc837ce90e96 |

原`inspect-archives.mjs`在解包前exit1：官方tar根目录条目无末斜杠，检查器只接受root/前缀，误拒合法根（`logs/archive-inspection.*`保留）。主线读真实条目后批准另建v2，只允许类型d的精确root或root/子路径，绝对路径/..仍拒；本次三包均无symlink/hardlink/special，69/67/51条通过。不是改搜索oracle或候选性能失败。v2与原检查器、tar完整列表均保留。

解包后全文读取999行install.sh并核另外两脚本仅成功文案不同，读取三份components/manifest.in；三次`bash <unpack/component/install.sh> --prefix=/tmp/agentic-f064a-toolchain.XOLigk/prefix --disable-ldconfig`均exit0，具体命令与双流在`logs/install-{rustc,cargo,std}.*`。Standards独立核安装manifest共116条目标均在prefix内；这是manifest检查，不冒系统调用审计。版本读回rustc1.88.0/LLVM20.1.5、cargo1.88.0、aarch64-apple-darwin。

`run-step.mjs`保逐命令日志，spawnSync超时只作用直接子进程，不冒全后代取消；Cargo另用`run-group.mjs`创建独立进程组、600秒限额、超时TERM后5秒KILL精确本组，结束ps核同PGID。显式设置RUSTC/RUSTDOC、隔离CARGO_HOME/CARGO_TARGET_DIR，PATH仅该子进程prefix与系统工具目录，CARGO_HTTP_TIMEOUT=30/CARGO_NET_RETRY=2。未发生timeout或重试。

实际命令（从任意cwd调用，runner固定临时project cwd）：

```sh
node /tmp/agentic-f064a-toolchain.XOLigk/run-group.mjs generate-lock 600000 generate-lockfile
node /tmp/agentic-f064a-toolchain.XOLigk/run-group.mjs build-release 600000 build --release --locked
```

首次generate-lock exit0、6.743秒、PID/PGID92701结束无组成员，锁150包；Cargo.lock SHA256 `639d75f7f400a528fb5879936175f31f51ba6a762e5cee8202f80f73dc00f347`。Tantivy锁条目与实际下载crate均匹配官方checksum `ad1ebacf6bc124b741ffbfb088f9835cb55e1e2ff57e182e9219e3efa1377b97`。构建`logs/build-release.json/.stdout/.stderr`：cargo **exit101**、3.634秒、PID/PGID92715结束无组成员；明确`ordered-float@5.5.0 requires rustc 1.90`、`uuid@1.28.0 requires rustc 1.89.0`，未开始成功release编译，不能称工具链已满足该锁。锁文件未修改，未采用错误提示的升级/precise建议；按批准边界立即停止。后续需要主线明确新的隔离工具链或依赖锁路线批准，不自动选型、不因本次MSRV红判Tantivy性能失败。

## 下一最小工具链候选（仅方案，未批准执行）

保持上述Cargo.toml、空main、同一Cargo.lock及所有crate版本/校验，不做cargo update或重生成锁。只读检查当前150个锁定registry包的本地官方稀疏索引元数据全部可定位，声明MSRV最高为ordered-float5.5.0的1.90，其次uuid1.28.0的1.89；未发现声明高于1.90。已下载122份实际Cargo.toml的最高声明亦1.90；其余28份未下载的源码不冒已读，索引缺MSRV声明也不保证编译成功。

建议另新mktemp目录，按官方Rust **1.90.0** channel manifest及sha256核源，固定aarch64-apple-darwin rustc/cargo/rust-std的URL/hash和大小上限；逐归档无逃逸路径/链接核验、读取install脚本后显式新prefix及--disable-ldconfig安装。原1.88目录/日志/锁永久保留本轮证据，不覆盖。使用新隔离cargo-home与target；复制原项目及lock后立即核相同SHA，允许Cargo按锁获取同一批crate并校验，不借新Cargo改锁。显式RUSTC/RUSTDOC/PATH与前阶段同作用域，精确独立进程组600秒止损与退出后核验，不修改全局环境。

唯一编译动作仍`cargo build --release --locked`，前后核锁SHA一致，成功仅证明这个target/lock可编译，不运行二进制、tokenizer、L或性能。若再次MSRV/平台/依赖错误或超时，保首次失败立即停，不能再自动升工具链/改依赖。主线及两独立轴复核批准之后才能下载、安装与编译1.90；当前只读检查与方案写作不作执行授权。

## Rust1.90同锁编译执行收据（2026-10-18）

上节随后经两轴路线复核、主线AGENTS明确批准，仅工具链窄补已执行。新目录`/tmp/agentic-f064a-rust190.zxE80R`，原1.88现场未改。官方`channel-rust-1.90.0.toml`及其sha256下载exit0，实际manifest SHA为`489c19f20d331765ab2835661eb546de90f6446a107a8db83045e7371e45cae2`，与官方sha文件一致。三包来自`https://static.rust-lang.org/dist/2025-09-18/`，完整下载参数/双流/exit见`logs/download-*.json/.stdout/.stderr`，限时和大小与上一轮相同：

| 文件 | bytes | SHA256 |
|---|---:|---|
| rustc-1.90.0-aarch64-apple-darwin.tar.xz | 63724992 | 89551c0ba1cc6d0312aebc4a6cafe4497223217ea8e87c81f6afbe127dfaeeb6 |
| cargo-1.90.0-aarch64-apple-darwin.tar.xz | 8523620 | 17a4410a27bf7dad4765f3809265c225f25f8b009da3d4b76cd0927acdae04b5 |
| rust-std-1.90.0-aarch64-apple-darwin.tar.xz | 29010092 | c36777aec17d617f85f94b7cb87bdd4270eeca30ef38c6f686809d163c881609 |

`inspect.mjs`核三hash/官方根目录与相对成员，无link/special/绝对/..，69/67/51条、exit0。读取与已全文读1.88安装脚本的完整差异（四处tr字符集表示修订），同版另两脚本仅成功文案不同；三manifest.in已读。安装三次显式`--prefix=/tmp/agentic-f064a-rust190.zxE80R/prefix --disable-ldconfig`均exit0，116条installed manifest目标全在prefix内。读回rustc1.90.0/LLVM20.1.8、cargo1.90.0、aarch64-apple-darwin。不改系统PATH或全局默认。

原project含Cargo.lock直接复制，新cargo-home和target独立；没有generate-lock或update。实际命令`node /tmp/agentic-f064a-rust190.zxE80R/build.mjs`，其中唯一cargo动作是显式prefix的`build --release --locked`；显式RUSTC/RUSTDOC/CARGO_HOME/CARGO_TARGET_DIR/局部PATH、600秒独立进程组TERM/KILL边界及末尾ps/lock核验均在该可读脚本。首次构建 **exit0、50.797秒**（包含新cache下载，不是后端性能数据），PID/PGID97299，timeout=false，结束无组成员；`logs/build.json/.stdout/.stderr`保完整证据。

Cargo.lock前后及原1.88锁SHA均`639d75f7f400a528fb5879936175f31f51ba6a762e5cee8202f80f73dc00f347`，新下载Tantivy0.27.0 crate仍匹配`ad1ebacf6bc124b741ffbfb088f9835cb55e1e2ff57e182e9219e3efa1377b97`。只证明该固定锁在本机Rust1.90 release可编译，**没有运行生成程序、tokenizer、L语义或成本测试**；原1.88 MSRV首红不抹去，不作生产/最终选型/应用验收结论。下一仅可提交原生tokenizer诊断最小方案，经另批才运行。

## 下一原生tokenizer诊断（仅方案，待主线与两轴复核）

目的仅观察三个原生profile的token与literal phrase召回，不实现L适配、不补fallback、不排名或测性能。沿上述a–f原六文档字节，先将JSON解码后的UTF8逐篇SHA写入冻结manifest，执行前后核同值；不去BOM、不换CRLF、不增加正文。查询固定为原12条加`alpha`共13条，另加仅查询内容为单个双引号及单个反斜杠的两例以核literal escaping（不改语料），空串单列skipped。未配对surrogate在共同输入验证阶段明确拒绝，不能传到Rust后替换或截断。

运行环境固定Rust1.90目录、同Cargo.lock/SHA和Tantivy0.27.0，诊断代码须另新临时项目仅新增源、复制原锁；独立target，不覆盖空main工具链收据。SQLite固定`/tmp/agentic-direct186.uXVnAg/Agentic Markdown-canary.app/Contents/MacOS/bun`，实际SHA256 `539598c775882420b9d8deb7dc14d845f20f7d26f5600c50ab067dde6ac3f3bf`、Bun1.4.0；每轮启动读sqlite_version/source_id/compile_options，若与已核3.54.0/FTS5不符即停。不是重新打应用包。

三个profile：

1. SQLite FTS5 `unicode61`默认参数、`detail=full`；六row、固定rowid→匿名a–f。独立`fts5vocab(table,'instance')`导出term/doc/col/offset，按doc及token ordinal排序。
2. SQLite FTS5 `trigram`默认参数、`detail=full`；同六row与字段，独立表/词表，不能把unicode61的query token复用。query tokens使用单独同配置qprobe表，每次DELETE+INSERT该query后读instance词表，绝不混入六文档索引。SQLite offset是**token ordinal**，raw byte/UTF16 span返回unavailable，不据词文本猜位置。
3. Tantivy schema `id`为STORED匿名ID、`body`为原生TEXT（位置索引）；`Index::create_in_ram`仅诊断原生语义，不能冒持久索引已测。使用`index.tokenizers().get("default")`所得可变TextAnalyzer，调用token_stream/advance/token。已读本地0.27源码：注册default是SimpleTokenizer→RemoveLongFilter(limit40)→LowerCaser；该过滤用UTF8字节len<40，不能改成40字符或手动修中文。**不能用TextAnalyzer::default()**（其实际为空tokenizer）。导出text/position/position_length/offset_from/to；offset是UTF8 byte，核0≤from≤to≤原文bytes、两端字符边界、按该profile顺序不倒退。小写token不要求等于raw slice，另保raw slice以区分归一化。commit后显式reader.reload，使用stored ID与DocSetCollector收全六篇并按ID排序，不用TopK截断。

SQLite查询为绑定参数的MATCH，literal phrase编码将query内每个双引号加倍，再外包双引号；绑定参数并不自动消除MATCH语法。Tantivy以body为唯一default field，先将query内反斜杠转为双反斜杠，再给内部双引号加反斜杠，最后外包双引号，严格`QueryParser::for_index(...).parse_query(...)`，不使用lenient。query token另由同index注册default分析。记录query原始匿名编号、编码后表达式、token列表、sorted IDs、空token标记与有限错误类别；实验fixture公开自建，不能迁此原文诊断到产品日志。

固定安全oracle：所有输入/字段只在绑定值或经上述literal编码的phrase内；不得产生额外SQL语句、字段选择或boolean操作。六文档ID集合/字节SHA不变，返回ID只能a–f且无重复，Tantivy范围合法。空query为共同层skipped，不调用搜索；零token但非空query标为no-token并仍记录其合法查询的返回结果，**不当API失败或L通过**。原生大小写/重音/短词/emoji差异只观察，不要求等于L手写集合。此固定集合及phrase编码未预期任何SQL/QueryParser错误：实际API异常（包括syntax/unknown tokenizer/position/schema错误）保存原始类别后首红停，不临时加入“允许错误”逃过断言；无token的合法EmptyQuery/空IDs正常记录。词表ordinal不能执行字符range断言，缺span明确unavailable。

执行前主线全文读源与两轴核此固定方案后才运行。编译单列`release --locked`、600秒精确组上限，不计入诊断180秒；运行以每个profile×query为case最多15秒（fixture/token导出作为独立case同上限），整批180秒精确组限额。新增源不改lock，任何构建/API/越界/SHA变化/超时首红停保双流/源码/receipt，不增加case或改oracle。通过仅说明原生诊断完整且安全，随后还须冻结两边具体L算法并复核，不能直接开始语义适配或成本批次。

## 原生诊断源准备收据（未编译／未执行搜索）

主线另批准仅源码与输入准备后，新建`/tmp/agentic-f064a-native.hHjGn7`。`prepare.mjs`14行、`run.mjs`69行、`sqlite.mjs`31行、`project/src/main.rs`29行；Cargo.toml8行与Cargo.lock1338行从已验工具链项目原样复制，锁SHA仍`639d75f7f400a528fb5879936175f31f51ba6a762e5cee8202f80f73dc00f347`。Rust仅std读取/UTF8 hex-TSV输出与既有Tantivy依赖，无新增serde_json等直依赖。

只运行输入准备`node /tmp/agentic-f064a-native.hHjGn7/prepare.mjs`，没有调用`run.mjs compile`或`diagnose`。生成六文档、15查询及空查询文件，manifest155行、SHA`77ada5d071e42a3d23e5c747810b3757d6653eca448efc9271bd51ff0bf0a3be`已冻结；每profile为fixture+15query+empty共17case，三profile共51。a–f字节长度33/30/20/12/21/23，逐篇SHA在manifest中；独立xxd确认f以EF BB BF开头，行间0D 0A，未去BOM或变换换行。fixture不是运行后生成期望集合，原生差异仍仅观察。

runner有显式compile/diagnose模式，前后核manifest/每份bytes/lock/Bun hash，逐case独立进程组、15秒/整批180秒、双流输出1MiB上限及首红停；编译600秒独立。尚待主线全文读源、两轴复核与另行执行批准，不将源码准备当编译/API可用或诊断通过证据。

源码复核窄补：主线/两轴指出v1 surrogate仅正则检测常量、batch截止边缘可能误complete、SQLite compile_options未落输出。原三个脚本保在同目录`v1/`（从未编译/查询，不冒实验首红）；修订加`scalars.mjs`共同验证，用于prepare编码之前及全部诊断文件派发之前，SQLite解码后亦核。纯校验实际22份输入通过，高/低未配对surrogate各由同函数明确拒绝，拒绝分支编码/派发callback次数0，合法非BMP/quote/slash通过；不增加51个engine case。batch统一标记expired并调用同一精确组TERM→KILL清理路径，case返回后/物化后/最终均核deadline；SQLite含empty全部输出真实compile_options。原manifest及锁SHA未变，尚未编译/运行搜索。旧行数为首次准备快照，不称修订后行数。

## 原生诊断作者执行收据（2026-10-18）

主线全文读源及三窄补、两轴0必要阻断并明确批准后，实际执行：

```sh
node /tmp/agentic-f064a-native.hHjGn7/run.mjs compile
node /tmp/agentic-f064a-native.hHjGn7/run.mjs diagnose
```

编译输出`/tmp/agentic-f064a-native.hHjGn7/run-1792326693521`，compile.json为exit0/39.026秒、PID/PGID98755、expired=false/无组成员。二进制SHA256 `f88a347fd4c606b279c55bf1031e64ab44d8cc7e3f7e48250d9676ecb04a9e7d`；原锁SHA仍639d75f7…不变。

诊断输出`/tmp/agentic-f064a-native.hHjGn7/run-1792326736950`，receipt complete、51case/0失败，逐case exit0、无超时/残留组，51份stderr实际总0bytes；results.json保完整token/编码查询/IDs/版本/compile_options，scalar-precheck.json保两非法拒绝零派发。manifest及六文档/查询前后SHA一致。不是L语义通过，也未执行成本。

有限观察：unicode61和Tantivy默认对“中/中文/文检/全文”均有query token但本文档没有命中；trigram这四个短词均无query token。三profile均未命中单emoji或单“𠮷”；“第二行”均命中f。三个profile均将ALPHA召回c，故不满足L大小写敏感；unicode61重音折叠与Tantivy/trigram细节不同，原始token已保留。quote/backslash合法编码均无token/无命中、未触发API错误；empty均skipped。以上是原生差异，不通过放宽L获得“正确性绿”，也不据此淘汰后端。下一仍须冻结双方具体适配与单/双字fallback并独立审，未获实施/成本/生产批准。

作者执行源SHA256：prepare.mjs=`42d60d9c89ded8e768a10196e426545b8001402e834d21abe93f3d64c47c94ad`；scalars.mjs=`cb2be4142bd8faa5800f0063b32c020f475a126418477e564224a7029d1c94ea`；run.mjs=`5c4e2b073999e7a0a61f5d295b0e30d435a34bec52f72479a18d4b2635745446`；sqlite.mjs=`e57f86de2ab5f2679f39206cb061bcac3774a53586b7febc84049c773f0bd021`；project/src/main.rs=`cd74f5e7cc73f3077da1a87079545e27a35f3bddab7af451478a194d8a4dab06`。完整临时源/v1/两次运行双流保留，等主线与独立实际复核，不自行宣布选型完成。

独立补证：Spec同源实际复跑`/tmp/agentic-f064a-native.hHjGn7/run-1792326835864`，51/0；主线cmp核results.json与作者逐字节相同。Standards独立核全部exit/hash与范围，0必要原生诊断阻断；主线仅批准有限原生诊断通过，不冒L适配/性能或生产资格。

## L适配最小算法候选（仅方案，不实施／运行）

推荐两引擎共用同一scalar gram语义与精确后验证，不让默认中文分词决定substring漏召回。语义仍为上文实验L，不升级成产品关键词政策。共同纯生成器先拒未配对surrogate，将文本分为Unicode scalar（非UTF16单元、非grapheme）。每文档生成长度1/2/3的全部连续gram，每个scalar编码固定6位小写十六进制，token为`g<长度>x<拼接hex>`，例如`中`=`g1x004e2d`、`中文`=`g2x004e2d006587`。字段全是ASCII字母数字、最长21字符，长度前缀与固定宽度无碰撞；按文档Set去重后字典序固定。BOM/CR/LF/空格/标点也作为scalar，不去重音、不小写原文；gram集合去重只影响候选，不抹去原文中的重复位置。

共同query：空串skipped，非法scalar拒绝；1/2 scalar取同长度唯一gram，≥3 scalar取全部distinct trigram的AND。这只给必要条件候选，必须用存储原文逐候选做精确连续字符串匹配，取首个命中再物化UTF16范围；候选ID和最终ID各自排序并对比两引擎，候选不能TopK截断。对合法scalar输入，JS indexOf与Rust str.find的精确原文匹配等价；Rust将命中前缀与命中片段分别encode_utf16计数，不能把byte offset当UTF16。每doc最多一条、片段等于原文范围，沿原L合同。既有短中文/emoji/组合字符oracle不改。

已核本地Tantivy0.27公开接点：`Schema`的gram字段用`STRING`（raw tokenizer，不用TEXT默认），每个去重gram以`TantivyDocument::add_text`作为同字段独立value；id与raw原文为STORED字段。query构造`Term::from_field_text(gramField,token)`→`TermQuery::new(term,IndexRecordOption::Basic)`，多个用`BooleanQuery::new(Vec<(Occur::Must,Box<dyn Query>)>)`，单个直接TermQuery；不使用QueryParser接用户文本。DocSetCollector取得全部候选，再读stored原文后验证。SQLite FTS5只索引共同token的空格连接串，`tokenize='ascii'`；另普通表存匿名id/原UTF8文本，显式事务将原文和索引版本同步提交。ASCII token不会被拆成多词；仍须首批核vocab与共同token集合严格相等。MATCH参数是经严格token正则核验的token以` AND `连接，不将原query拼入SQL/MATCH；id绑定固定rowid，不把路径作SQL标识符。

这是A候选（多值STRING vs ASCII FTS）的公开最小接法；不新增字典/分词依赖。短词仍走对应gram，不默认扫描。查询distinct trigram超过128时，双方显式进入`scan-fallback`：取同一已冻结语料的全部合格匿名ID作为候选，读取存储原文精确后验证，不截断子句、不假空。这不是索引召回成本，后续成本批须单列fallback候选数、原文读取与匹配费用；不能把它隐藏在普通索引查询均值中。若gram适配太昂贵，先报告真实空间/构建成本再决策。

实验成本门禁拟固定：单文档原UTF8≤现1MiB，原文、scalar缓冲、gram生成去重集合/排序、SQLite连接串与两边存储/原文副本均计账；不能把预生成token时间/空间排出成本批。L首批每组文档≤16、总原文≤64KiB、每doc去重gram≤4096、单query≤4096 UTF16、候选≤16；distinct查询gram128是索引子句上限而非语义拒绝上限，超过时按上段全候选fallback。其余容量超限整次明确`cost-refused`，不得静默截断gram/候选或伪造零命中。全部是本次实验止损，不是新产品SLO/全局文档限制；查询开始前计费，处理中边增量边预留，不先无界分配再核。正式成本批若需更大配额须另冻结并公平应用两引擎，不能用这组小上限声称真实corpus选型已完成。

### 固定首批及反例

组A仍仅原六文档与13条L查询、quote/backslash无命中、empty skipped、非法拒绝；两引擎候选集合也必须相同，最终命中/UTF16范围严格按上文手写oracle，原生观察结果不充当L答案。

组B独立索引五文档（不污染组A）：g=`abcXbcd`、h=`abcd`、i=`aaa`、j=`甲😀乙甲😀乙`、k的JSON原文为`"x\"y\\z"`。手写：query `abcd`候选g/h，最终仅h[0,4)（AND允许不同位置假阳性，必须后验证）；`aaaa`候选i、最终空（去重不能证明重复次数）；`😀`候选及最终j[1,3)且只首个；`bcd`候选g/h、最终g[4,7)、h[1,4)；`ABC`候选/最终均空；单个双引号候选及最终k[1,2)，单反斜杠候选及最终k[3,4)。token编码另核单非BMP不得分半、不同长度与边界组合不会碰撞；严格核token前缀n与后缀恰6*n位小写hex及合法scalar，不只核泛alnum。这些是提前固定的反例，不根据结果补oracle。

组C只核长查询边界与fallback：独立索引u为U+0100到U+0182（含两端，共131个scalar）按升序拼接，v为同串逆序。query为u前130个scalar时恰128个distinct trigram，走索引AND，候选仅u，最终u[0,130)；query等于完整u时有129个distinct trigram，必须标记scan-fallback，候选恰u/v，最终仅u[0,131)。不得发出截成128子句的查询；显式fallback状态与候选集合证明没有假零命中。u/v及两query按本段确定构造生成后、运行前独立核实际原串UTF8/SHA并冻结manifest，不从结果生成oracle。该固定小例只核算法，不是长查询成本结论。

独立纯准入例：query为4097个ASCII `a`，超过4096 UTF16实验输入上限，必须整次cost-refused且engine派发0；不增加搜索正文、不宣称普通产品长query限制。方案探索时曾建议>128子句拒绝，主线最终撤回该建议，固定为上述fallback；此前均未实现或运行，不能记为实验失败。

dirty覆盖/撤销覆盖、删除撤权、同路径换身份、旧bufferRevision与query迟到取消模型留下一独立控制面阶段，本次不执行也不以L算法绿冒这些责任完成。正式保存/授权/dirtystore/Worker生命周期仍后续；引擎同步查询的迟到丢弃不冒计算已中断。

本阶段只收敛以上算法/schema/返回策略；尚未写新源或执行。主线及两轴复核后另批源准备，再读源批准运行；保持旧原生目录与oracle不改。编译/执行仍分别600秒、15秒每例/180秒整批首红停，原文/锁/SHA和双流保留。性能、真实许可corpus、正式服务/UI均不随本方案自动获准。

## L适配源码与冻结输入准备收据（未编译／未搜索）

上节经主线与两轴复核后仅批准源码准备。新目录`/tmp/agentic-f064a-literal.TNa1mW`，文件`common.mjs`（scalar/gram/纯准入）、`prepare.mjs`（手写oracle输入生成）、`sqlite.mjs`、`src/main.rs`（Rust真实引擎）、`run.mjs`（编译与诊断分模式），Cargo.toml/lock原样复制，同锁SHA仍`639d75f7f400a528fb5879936175f31f51ba6a762e5cee8202f80f73dc00f347`；新target尚未生成。未新增依赖。

仅运行prepare生成42份输入及606行manifest：SHA256 `0ef079d6e33348bc086d9808f21d89d98152b12001525a3c92f9c1040f66b163`。A六篇/16query（含empty），B五篇/7query，C两篇/2query，总25query×2引擎=50搜索case；4097a与非法surrogate是独立纯准入不增加引擎case。oracle来自提前固定文字与手写数组，不调用引擎产生expected。实际xxd核k为`7822795c7a`，独立输入校验u/v均131scalar且互为逆序、端点U+0100/U+0182，refused文件恰4097a；f仍保BOM/CRLF。prepare后已加manifest存在即拒及各写入wx，未再运行或覆盖冻结输入。

runner固定manifest/lock/包内Bun SHA；派发前核每组≤16篇/64KiB及stat大小后读取输入，固定小语料边界不冒通用并发文件预算保证。两引擎结果核实际candidate存储raw的完整UTF8字节、手写候选/UTF16首span、slice==query、各doc token集合、严格6*n hex/scalar与中/中文/😀/𠮷独立编码例。SQLite实际vocab逐doc相等检查不只复用生成器自证。Rust使用stored原文及公开Must/AllQuery，不复用原生QueryParser。当前已通过JS语法检查及纯输入字节校验，**没有运行compile或diagnose，也没有编译Rust/建立索引/搜索**。源码等待主线全文读取与两轴复核，后续运行须另行批准。

## L适配首次执行：BOM原文／范围首红，已停止（2026-10-18）

上节随后经主线全文读源、两轴0必要路线阻断、AGENTS明确批准后执行。命令分别为`node /tmp/agentic-f064a-literal.TNa1mW/run.mjs compile`与同runner的`diagnose`，未修改冻结oracle。

编译收据`/tmp/agentic-f064a-literal.TNa1mW/run-1792327589125/compile.json`：exit0、36.356秒、PID/PGID1449、无timeout/残留组；锁SHA前后仍639d75f7…同原锁。生成binary SHA256 `c85987baa446de4bca5c8bd7801717e9d40a2835b4afd262daa4f66eb14e77c7`。

运行输出`/tmp/agentic-f064a-literal.TNa1mW/run-1792327630455`：**runner exit1，首红停止**。此前20个engine case（两边A前10query）完成；SQLite case10查询f的“第二行”返回`[5,8)`，手写冻结oracle为`[6,9)`。该子进程本身exit0/65ms、PID1928、无timeout/残留组；runner验证失败，不冒API失败或整批通过。原`sqlite-10.stdout`的候选raw hex为`e7acace4b880e8a18c0d0ae7acace4ba8ce8a18c`，缺输入文件前导`efbbbf`；这是返回原文缺BOM的证据，尚未定位是在解码、绑定、存储还是读取环节，不能直接归因SQLite或Bun。原输入SHA不变；本case先命中span断言，后续raw相等断言未执行，不能说该后续断言已跑红。

Tantivy同case及后续A/B/C尚未运行；不以此前20项冒整个L通过，不重跑掩红、不改BOM/范围oracle或输入。原receipt/20条results/全部已运行子进程双流与源码保留，等待主线下一诊断授权。

本轮源SHA256：common.mjs=`86724334275ea0e0084bc20365f99634df8bcc4f0b3d80cd1c72b40915201473`；prepare.mjs=`2b6c7858dc241a95ef1d626989992d4f3e666aa652d8d3184237e509264ca246`；sqlite.mjs=`e36fc4f8a8c0efddcd42f90fabcfabfc28c7efe0932ca0ffaf282d48a7fc57ee`；src/main.rs=`b56f518ad6995ba541de40f5dccae87d7a7e14c5e83a5fbe7812c68d76e319e9`；run.mjs=`076c046eed20cd72cd56c8acc747034f42f36b8663fd607cad3b6b2d2714ac7b`。无控制面、成本、生产或Git操作。

## BOM首红反馈环与减法收据（仅复现，尚未假设测试／修复）

主线批准后全文读取diagnosing-bugs技能，新建`/tmp/agentic-f064a-bom-repro.eaiqPG`。可重现命令`node /tmp/agentic-f064a-bom-repro.eaiqPG/run.mjs original`直接调用原冻结sqlite.mjs及包内Bun组A/q10，assert原raw完整字节与[6,9)；实际67ms红，收据`run-original-1792327731965/receipt.json`。双流落文件，原源码/manifest/oracle未改，不重跑整批。

逐步减法另存`reduced.mjs`：one-doc删除其余文档仍66ms红（run-one-doc-1792327736733）；no-fts去除FTS仍65ms红（run-no-fts-1792327736891）；small仅BOM+中仍69ms红（run-small-1792327737048）。再用9行`minimal.mjs`去掉事务、ID及gram依赖，保实际TextDecoder→TEXT绑定→SELECT→raw+span的原路径。`node .../run.mjs minimal`两次分别64/60ms红（run-minimal-1792327754264、run-minimal-1792327754420），expected `efbbbfe4b8ad`与[1,2)，actual `e4b8ad`与[0,1)。各子进程exit0、runner断言exit1，15秒精确组上限均未触发、ps无残组。减法是收窄症状，不称修复或已经证明丢失发生于SQL内部。

尚未测试的三项可证伪假设，先交主线说明后再批准探针：①解码阶段丢BOM，预测SQL前raw codepoints/UTF8已缺FEFF；②JS→SQLite TEXT绑定丢BOM，预测SQL前保留但SQL内`hex(raw)`缺EFBBBF；③SQLite→JS TEXT读取丢BOM，预测SQL内hex保留而返回string缺失，CAST(raw AS BLOB)边界应保完整bytes。拟在同最小例三个明确边界分别采样，不改保BOM断言、不把诊断输出直接用作修复；当前没有运行这些假设探针。

主线向用户说明假设并批准单次边界观测后，新增同目录`boundaries.mjs`，命令`node .../run.mjs boundaries`实际66ms exit0、PID2182无timeout/残组，完整双流与收据`run-boundaries-1792327830560`。原六字节输入不变；SQL前raw的codepoints为[feff,4e2d]、UTF8为efbbbfe4b8ad；SQL内部hex(raw)=E4B8AD、length=1、typeof=text；返回TEXT及CAST(raw AS BLOB)均e4b8ad。故本例排除输入TextDecoder先丢失与仅返回TEXT转换丢失，定位范围为SQL前JS字符串到SQL存储TEXT路径；尚未区分绑定桥与SQLite内部TEXT处理，不宣称SQLite普遍损坏或BLOB替代已修复。随后独立复次原minimal：`run-minimal-1792327830720`65ms仍红、PID2185无timeout/残组。原L源/schema/oracle不变，无全文批重跑。

后续主线明确批准三项对照后，新增`compare.mjs`，每项独立内存DB、同六字节、15秒组上限，实际各exit0/73–75ms、无timeout/残组：`run-parameter-text-1792327906277`仍SQL内E4B8AD、TEXT length1；`run-literal-text-1792327906446`用固定SQL literal CAST(X'efbbbfe4b8ad' AS TEXT)，SQL内EFBBBFE4B8AD、TEXT length2，返回TEXT亦完整；`run-parameter-blob-1792327906616`用Uint8Array参数存BLOB，SQL/返回bytes均完整6bytes，显式fatal+ignoreBOM解码后原[1,2)断言通过，未手工补BOM。前两项仅观测，第三项是替代路线可行性断言，不能当原L已修。

有限结论：该固定Bun版本的参数TEXT绑定路径与无JS文本参数的SQL literal路径有差异，直接SQL TEXT能保BOM，不能泛称SQLite不支持BOM。建议下一**仅另新临时L目录**，复制同锁/manifest/oracle/其他源，SQLite originals.raw改BLOB、原字节Uint8Array绑定，取真实存储bytes后显式fatal+ignoreBOM解码并postverify；gram FTS字段/候选算法、Tantivy及原UTF16 oracle不变，所有byte副本/解码费用仍纳未来成本。原首红目录保留，不能在其中修后覆证；待主线与两轴审窄修源后另批完整50case，无成本/控制面/生产扩张。

### BLOB窄修具体合同（仅文档，尚无新源授权）

仅新mktemp目录复制原Cargo.toml/Cargo.lock、common.mjs、prepare.mjs、run.mjs、src/main.rs及全部fixtures/manifest；除sqlite.mjs外上述文件须逐字节同原，原目录完全不改，manifest SHA仍0ef079d6…、lock仍639d75f7…。runner已按自身路径定位新target，无需改路径常量；不重新运行prepare生成oracle。仅sqlite.mjs改动原文存储路径，gram索引、版本记录、SQLite配置、查询选择与手写预期不改：

1. `originals.raw`改为BLOB；加载文档时保留原文件bytes，并在原尺寸/UTF8校验通过后用这些bytes的Uint8Array作为绑定值，不走原文string的TEXT参数绑定。gram仍来自同份原bytes显式fatal+ignoreBOM:true解码结果，不能改输入内容或手工补FEFF。
2. 候选SQL仍同rowid关联及fallback全候选；返回raw必须是Uint8Array（含其Buffer子类），拒绝string/其他类型。解码前核byteLength在固定单文档预算内，并与该候选原输入byteLength相等；输出candidate raw hex直接来自返回bytes，不从解码文本重建。runner仍独立核完整hex与冻结fixture一致，不因仅长度相等放行。
3. 对返回bytes采用fatal UTF8、ignoreBOM:true显式解码，并校验编码回转逐字节相等后才执行原indexOf/首UTF16 span逻辑。BOM/CRLF/非BMP的原oracle不变，不能在偏移结果加1掩盖存储错误；读取、绑定bytes、解码及回转验证的副本与成本全部留在端到端实现，未来性能批须计入。
4. 新源完成后先主线/两轴读diff与字节不变证据，再另批同锁release编译及原50case+纯准入，600秒编译/15秒case/180秒整批首红停。原SQLite case10红及诊断不撤销；即使全批绿也仅有限L算法/原文保真，不是最终引擎选型、控制面或生产通过。

主线随后仅批准该窄修源码准备：新目录`/tmp/agentic-f064a-literal-blob.pf89ql`。只复制原明确源/42输入/manifest/锁，不复制旧target或运行输出，不运行prepare。实际逐文件bytes比较除sqlite.mjs外49个文件全部与原目录相同，包含Rust源、common、runner、prepare、manifest及锁。sqlite.mjs唯一差异为readBytes保原bytes、raw BLOB及bytes绑定、返回Uint8Array/长度校验与显式decode回转核；候选hex仍直接输出返回bytes。新sqlite SHA256 `92e5b95275f0be884f6a853fecd429228d5d81b4581bd61cbf513fda418966fe`，`diff -u`和JS语法检查已读/通过；没有编译、建索引或运行50case。等待主线与两轴审源后另批执行，原首红现场未改。

### BLOB窄修L实际执行与独立收据

主线全文读diff、两轴审源后批准并亲自执行新目录runner：compile输出`/tmp/agentic-f064a-literal-blob.pf89ql/run-1792328562234`，exit0/37.090秒、PID/PGID3470、无timeout/残组；binary SHA仍`c85987baa446de4bca5c8bd7801717e9d40a2835b4afd262daa4f66eb14e77c7`，Rust源码未变。主线diagnose输出`run-1792328604936`，固定50case全部通过、0异常收据；BOM f在两个引擎均返回完整原bytes与[6,9)，原反例、128/129边界及纯准入均沿冻结oracle。

独立Spec实际复跑同目录`run-1792328637543`，exit0、50case通过，主线cmp确认results.json与主线执行逐字节相同。Standards核全部实际收据与哈希，0必要有限L阻断。两轮manifest SHA仍`0ef079d6e33348bc086d9808f21d89d98152b12001525a3c92f9c1040f66b163`，lock SHA仍`639d75f7f400a528fb5879936175f31f51ba6a762e5cee8202f80f73dc00f347`。主线批准的仅是这组L算法/原文保真隔离实验通过；原TEXT绑定首红、原始源和诊断永久保留，不称引擎库已修。没有持久CRUD、真实许可corpus、成本、dirty/授权控制面、生产或GUI验收证据。

## 下一最小持久CRUD合同（仅方案，未批准源／运行）

前置是当前BLOB窄修L固定批通过主线与独立复核；本节不提前宣布此前置已满足。只检验两真实引擎对小固定语料的持久create/commit/read/reopen/add/update/delete，不实现dirty、授权或产品调度模型，不做成本排名。沿L相同scalar gram/候选AND/fallback/原文后验和返回UTF16首span，原文只用固定自建文本；SQLite原文BLOB路线与Tantivy stored原文均核完整UTF8字节。

最小公开接线：Tantivy新磁盘目录`Index::create_in_dir`，重开用`Index::open_in_dir`；id字段这次明确改为`STRING|STORED`以支持`writer.delete_term(Term::from_field_text(idField,id))`，path仅STORED匿名元数据，不作为身份。初始/add使用add_document，同ID更新必须先delete_term再add_document，均在一个writer commit中；reader使用Manual reload策略，commit后显式reload并取得新searcher再验。旧searcher是否仍旧快照另列观察，不要求与SQLite强行相同。SQLite普通表id唯一、path元数据及raw BLOB，FTS rowid与普通表一一对应；增删改两表在同一事务内，更新删除旧gram并写完整新gram，COMMIT后新read事务核可见。不得用只改raw不改FTS的旁路。Tantivy commit/reload与SQLite COMMIT定义本批可见点；merge完成、WAL checkpoint不伪装成每次可见前置。

阶段0建立唯一冻结manifest，写入原文及SHA，不依引擎结果生成expected。a的path=`p.md`、初始原文JSON=`"\ufeff旧词\r\n😀"`；b的path=`q.md`、原文=`"旁文"`；a新版本=`"\ufeff新词\r\n😀"`；之后c复用path=`p.md`但新ID=c、原文=`"\ufeff重建\r\n😀"`。以下每阶段对固定query旧词/新词/重建/😀/旁文核候选与最终IDs、首span，所有未列命中为空；这些文本中对应query的gram必要候选恰为最终集合，无假阳性可借机跳过后验。

| 阶段 | 真实动作及提交点 | 手写预期 |
|---|---|---|
| P1 | 建磁盘索引，只加入a初始版，commit+新读 | 旧词→a[1,3)，😀→a[5,7)；stored a原bytes含BOM/CRLF |
| P2 | 关闭所有引擎实例，独立新进程只open既有目录，不重建不重新add | 与P1完全相同；索引schema/id/path/raw均从存储恢复 |
| P3 | 增加b并提交 | 保P1，新增旁文→b[0,2) |
| P4 | a同ID、同path更新至新版本并提交 | 旧词空，新词→a[1,3)，😀→a[5,7)，旁文→b[0,2)；枚举存储ID恰a/b各一次，a字节为新版本 |
| P5 | 删除a并提交 | 旧词/新词/重建/😀均空，仅旁文→b[0,2)；存储ID仅b |
| P6 | 同path p.md以新ID c重新加入并提交 | 重建→c[1,3)，😀→c[5,7)，旁文→b[0,2)；旧词/新词空，当前存活可查询ID仅b/c，不返回a或其旧raw；不承诺旧段／磁盘字节擦除 |
| P7 | 再次全关闭、独立新进程open，禁止自动重建/导入 | 完全保P6与b/c原字节，重开结果不继承a旧身份 |

每阶段read必须查真实持久引擎并读取实际stored raw/path/id；不能仅比较外部内存map。对重开采用新进程、不传写入正文给read命令，防测试意外重建；原fixture仅在宿主验证实际返回bytes时作为oracle。索引目录只能本次mktemp自建，不复用生产缓存或读取用户工作区。首轮≤3个匿名ID、各原文≤1KiB，仍沿冻结L生成预算，15秒阶段/180秒整批与600秒编译精确组上限、首红停止保双流。正常关闭后的重开只证有限持久性，不冒断电、崩溃恢复、跨卷、权限恢复、生产durability或性能SLO；存储完整目录可记录大小，但不据此作成本选型。

控制面后继责任仍明确开放：dirty按documentId+bufferRevision覆盖并屏蔽disk，discard撤覆盖、save只在真实成功版本后推进disk；权限/根coverage/身份换代与旧查询迟到必须核真实消费者接线。独立模型仅能证明模型仲裁，不能冒真实documents.save、授权descriptor、Worker停止或正常退出保障。本次CRUD不写这些模型，也不因P1–P7绿关闭OBL-006/018/026/035。真实许可corpus与冷暖/尾延迟/峰值RSS/增量成本仍另批。

### 持久CRUD源准备收据（未编译／未运行）

主线与两轴审P1–P7后仅批准源准备；新目录`/tmp/agentic-f064a-crud.qyfN9u`，prepare.mjs、sqlite.mjs、src/main.rs、run.mjs、原同锁Cargo.toml/Cargo.lock及同L common.mjs。只执行prepare生成四个原文输入与282行手写manifest，SHA256 `b7ba553b117641daca12240eb1e540cd0f13694cad615fcc71cc7da36d5d0139`；prepare已有manifest拒绝与wx防覆写。7阶段×2真实引擎拟14case；不存在预跑生成expected。

P2/P7用独立子进程且fixture参数指向不存在的no-fixtures哨兵，SQLite readonly/create:false、Tantivy仅open_in_dir+schema相等核，不修schema/导入；当前存活文档用公开AllQuery枚举，不扫存储段猜删除。主线源预读指出Rust原写法在查询前wait_merging_threads，已在未运行阶段移到全部存活枚举及查询结果生成之后，commit+Manual reload后先取searcher查询，最后再正常merge收尾/释放句柄；仍须等进程exit0/无残组才下一阶段。源码语法检查仅JS已通过，未Rust编译、未建立磁盘索引、未搜索。待主线全文读源及两轴审后另批运行。

### 持久CRUD首次执行及打开flags窄修合同

主线与两轴全文审源后批准运行，由主线执行：compile收据`/tmp/agentic-f064a-crud.qyfN9u/run-1792328986839`，exit0/37.450秒。diagnose输出`/tmp/agentic-f064a-crud.qyfN9u/run-1792329039304`，P1/P2两引擎共4case通过，随后SQLite P3在`new Database`处首红停止：`flags must include SQLITE_OPEN_READONLY or SQLITE_OPEN_READWRITE`，code=SQLITE_MISUSE/errno21。该case exit1/62ms、PID/PGID5399、无timeout/残组；P3实际add尚未执行，Tantivy P3及后续未运行，不能称CRUD通过或索引增量错误。stderr与receipt原样保留，原数据库不重试。

主线核本地公开bun:sqlite类型的readwrite选项后，下一最小修订合同只允许另新mktemp复制源与冻结输入，**sqlite.mjs唯一变化**为`new Database(databasePath, { create: stage === 1, readonly, readwrite: !readonly })`；P2/P7仍readonly=true/readwrite=false/create=false，P3–P6明确readwrite=true但create=false，不允许不存在时创建。其它源码、Cargo锁、manifest及四fixture逐字节保持，所有P1–P7手写oracle不动，不改reader/事务/保存语义。源准备与运行须主线另批；只能新运行目录的新数据库重新开始，不能在首红DB继续补跑拼接通过。当前仅文档，无新窄修源或执行，真实corpus方案工作暂后置。

主线随后批准单行源准备，新目录`/tmp/agentic-f064a-crud-rw.h2jpT5`。精确diff仅该Database选项增加readwrite，sqlite.mjs SHA256 `4821b5fe0722a54cbcc34c580aaad1ea91b3d2e8741bef9bf8b37413d3351338`；其它11个文件（四fixture、manifest、锁/manifest、common、prepare、runner、Rust源）逐bytes比较全部同原，不复制原target/失败DB、不运行prepare。尚未编译或运行，待主线两轴实际diff审读。

### CRUD打开flags窄修实际收据

主线审单行diff、两轴审源后批准运行。编译`/tmp/agentic-f064a-crud-rw.h2jpT5/run-1792329180024/compile.json`实际exit0/38.368秒、PID/PGID5769、无timeout/残组；binary SHA256 `1062db1cd85ca19f59e27c012d55977d0ac3e1c6655975e1e9d2601cef0c112a`。主线新库diagnose `run-1792329223003`完整14case通过；独立Spec另新运行/新库`run-1792329234888`亦14/0，作者只读cmp核results逐bytes相同。

两receipt均complete，manifest仍`b7ba553b117641daca12240eb1e540cd0f13694cad615fcc71cc7da36d5d0139`，锁仍`639d75f7f400a528fb5879936175f31f51ba6a762e5cee8202f80f73dc00f347`。有限证据覆盖固定正常关闭的P1–P7实际持久CRUD、同ID更新、删除后同path新ID与独立进程只读重开；不证明旧段磁盘擦除、崩溃恢复、控制面或性能。原P3 constructor flags失败目录保留。Standards最终运行证据复核尚待回，不提前写两轴全部通过或本片最终验收。

随后Standards完成全部14结果/实际收据独立核验，0必要有限结论阻断；主线认可并批准仅正常持久CRUD实验通过，不冒全片验收。上述“待回”作为当时收据历史保留。

## 下一真实corpus归档元数据获取（仅方案，未批准下载／新源）

目的仅获取固定官方仓库归档并安全列出成员元数据，为下一步明确真实Markdown文件白名单；不同时提取正文、跑仓库代码、建索引或展开性能实现。先前三仓GitHub git/trees API实际403、tree网页工具restricted保留为获取限制，不推根因，也不冒已核36个文档路径。Standards此前只读核到如下固定commit及官方raw许可证：

| 仓库 | 固定commit | 已核许可证路径 |
|---|---|---|
| vuejs-translations/docs-zh-cn | 354712584b6be1e8532f2ff8559cd01d26ce3c14 | [LICENSE](https://raw.githubusercontent.com/vuejs-translations/docs-zh-cn/354712584b6be1e8532f2ff8559cd01d26ce3c14/LICENSE)，CC BY4.0，图片明确例外 |
| vuejs/docs | 40aa88af0094f7bab4aaf786e55c748a6a251d88 | [LICENSE](https://raw.githubusercontent.com/vuejs/docs/40aa88af0094f7bab4aaf786e55c748a6a251d88/LICENSE)，CC BY4.0，图片明确例外 |
| rust-lang/book | 1500248d8f230566e4ec9f27fcbb8fe9e2898ab1 | [LICENSE-MIT](https://raw.githubusercontent.com/rust-lang/book/1500248d8f230566e4ec9f27fcbb8fe9e2898ab1/LICENSE-MIT)与[LICENSE-APACHE](https://raw.githubusercontent.com/rust-lang/book/1500248d8f230566e4ec9f27fcbb8fe9e2898ab1/LICENSE-APACHE) |

拟请求仅`https://codeload.github.com/{owner}/{repo}/tar.gz/{上述40hexcommit}`，不使用分支/latest、第三方镜像、账号token或系统代理修改。新mktemp存原始压缩包及HTTP状态/最终URL/大小/SHA/双流收据；只接受HTTPS且最终host为codeload.github.com，重定向若不在该边界则拒绝，不以本机鉴权绕过403。压缩包实际SHA是本次下载内容标识，不冒官方签名或独立发布checksum；固定commit/TLS来源与实际hash分别记录。

下载门禁拟固定connect15秒、每包120秒、整批6分钟，单包压缩≤32MiB、三包合计≤96MiB；实际传输计数强制上限而非只信Content-Length，若header可得也提前校验，部分下载保留明确未完成。HTTP非200、超时、大小或来源不符立即停，不自动放宽/换源/换commit，不进入后续包。上述是实验资源止损，不是产品SLO。批准实现时须提供明确进程组及deadline收据，不把父进程退出冒后代清理完成。

安全列表不是解包：按归档头逐条读取name/type/声明size及必要扩展头，解压流中的普通文件payload只计数跳过，不转正文字符串、不写成员到磁盘、不执行成员；扫描gzip尾校验并核实际展开流累计，不能仅看声明大小。每包列表30秒、元数据输出≤8MiB、条目≤20000、路径≤4096 UTF8 bytes、单entry声明≤16MiB、声明payload总计及实际展开流各≤256MiB；三个包相应累计≤768MiB。必须单一精确预期`{repo}-{commit}/`顶层，根自身只准目录类型；绝对路径、空/NUL成员名、`..`路径分量、越界扩展头、链接（含hardlink/symlink）与特殊成员一律拒绝本批。PAX/GNU扩展若出现，必须先明确有界解释规则与生效路径，再继续校验最终路径；未知格式不猜测，不直接交自动extract。失败保包/列表/原错误，不能因仓库“官方”跳过安全核。

本阶段完成仅得到可复核包SHA与安全成员清单。随后再从实际列表提出每仓12个独立Markdown文件、合计36个的固定白名单（不重复复制补数），逐文件记录repo/commit/path/实际byteLength/SHA/许可与来源；文本取样须另批，Vue图片例外不抽取或下载链接资源。单篇≤现1MiB、总正文≤16MiB作为下一小样本候选门禁，实际文件不足/超限须报告，不按运行性能挑选有利路径。语言分层依据实际正文，不把仓库语言名冒混合语料覆盖。白名单与正文到齐后先冻结离线参考substring及少量人工手写范围oracle，再审后端执行方案；不能用引擎结果反推正确答案。36篇真实小样本亦不自动完成Q24最终选型、规模成本或产品接线，现阶段没有获准执行上述任何下载或正文处理。

### 元数据脚本准备与精确归档子集（未联网）

主线与两轴复核后仅批准新目录源码：`/tmp/agentic-f064a-corpus-meta.meLM1N`，download.py、list_tar.py、run.py。Python标准库urllib逐跳手动检查HTTPS/codeload allowlist再发请求，实际压缩流计数；run用独立进程组/各预算及共同6分钟截止、超时TERM后5秒KILL及ps检查，保存partial/stdout/stderr/receipt。仅做AST语法解析，无网络、没有调用脚本下载/归档列表或提取正文。

tar使用公开`tarfile.TarInfo.frombuf`核512-byte header及checksum，不用extract；gzip流实际计费，普通payload仅按块跳过，接受标准字段NUL填充及两零块后的全零尾部。主线固定的唯一扩展是**最多一个、在任何普通成员之前的global PAX**：payload≤64KiB，严格十进制length+空格+key=value+换行frame；只允许唯一comment键，其值必须等于当前固定40hex commit。扩展header也核checksum/路径安全/预算，但header路径只是元数据，不纳正文白名单或预期topdir；comment不覆盖path/size。缺global头合法；重复头/comment、其他key、local PAX、GNU扩展、链接/特殊条目均首错停止，不自动扩语法。所有普通成员最终规范路径去尾slash后检查重复，防后续提取歧义；上限包含global头，声明和实际展开流均计global payload。脚本仍待主线全文读及两轴复审，未批准联网执行。

长期交付责任：F064a最终可复跑选型不能只引用/tmp路径；届时须经批准将最小脚本/固定manifest/必要匿名结果归档到仓库研究目录或明确持久artifact。真实大语料按许可与归属另定是否提交，不默认搬入仓库。当前不迁移、不把临时证据冒长期交付完成。

主线批准实现后7例离线安全列表验证，作者在新`/tmp/agentic-f064a-meta-tests.wQQUwy`先写固定oracle及标准库生成脚本，再实际`python3 .../test.py`，父exit0、**7/0**。普通file/dir+两零块/额外零尾、合法首部global comment各exit0；坏header checksum、重复有效路径、symlink、父级`../`、local PAX path各exit1并命中预定错误类别。每例91–141ms、30秒精确组上限未触发、ps无残组；manifest.json逐输入SHA、receipts.json与各stdout/stderr保完整。这里预期拒绝的exit1不是未处理实验失败；没有调整parser规则以迎合结果，没有网络或真实仓库下载，原三脚本未改。该有限安全列表测试不证明所有恶意归档/网络故障覆盖，联网仍待另批。

### 官方归档元数据实际收据

主线批准后实际运行目录为 `/tmp/agentic-f064a-corpus-meta.meLM1N/run-1792329688912526000`；作者只读核aggregate及六子收据、三包实SHA。三个download均HTTP200、无redirect；下载分别3.867/3.132/4.419秒，安全列表分别0.134/0.138/0.191秒，六项exit0、无timeout或残组。各成员清单仅元数据，普通payload计数跳过，未解包/读取正文。

| 固定仓库简称 | 压缩bytes | 实际SHA256 | 成员数 | 声明payload bytes | 实际展开bytes |
|---|---:|---|---:|---:|---:|
| docs-zh-cn | 4490260 | fb54b1ba78b3781d5658de7ed43fc6d28a9d2f2e875773a4698fdb0d06f785fd | 725 | 6527197 | 7075840 |
| docs | 3877930 | f05f75b8016d94248ed932a6528473693a4dbab45fe28baeb0fb164fddfdaada | 672 | 5826644 | 6328320 |
| book | 5972507 | e4d11084f9e46cb13d2563be7a970864c5236fce51043b9665082e017e42b0e2 | 3855 | 10473251 | 13260800 |

每包global PAX comment等于前述固定commit。Spec独立核六收据与三实际SHA，0必要阻断；Standards另新 `/tmp/agentic-f064a-meta-review.Miju03` 离线同parser复跑三原包3/0（138/133/189ms），成员JSONL及汇总逐bytes相同，无网络/提取/残组/stderr。主线已批准仅metadata有限通过；这些hash不是发布签名，安全列表不代表正文语义或搜索成本通过。

## 下一正文白名单与最小提取合同（仅方案）

仅依据上述实际members的path/type/size选择，不读正文后挑有利性能。固定规则：regular .md、单篇≤1MiB；Vue限`src/api/`或`src/guide/`，Rust限顶层`src/*.md`（不含历史edition、packages副本）；排SUMMARY.md、README.md、index.md，并按主线确认排Rust路径`*-00*.md`章节入口候选。此为路径排除，不声称已读或证明这些文件全部只有导航。各仓各档按相对路径UTF8字节序升序取前4，不额外作章节去重。S为<4096 bytes，M为4096–16384含两端，L为>16384且≤1MiB。过滤后可用数分别ZH 8/54/18、EN 6/55/19、book 11/54/23，全部足4，没有重复复制凑数。Vue中英主题相关是双语成对样本偏差，不冒36个独立主题或语言覆盖；后续按实际内容记录分层，不更换路径迎合引擎。

下表path相对于各固定commit归档根；sizes为已核成员声明值，提取时必须核实际bytes完全相等。36篇合计352051 bytes。

| 仓库简称 | 档 | 相对路径 | bytes |
|---|---|---|---:|
| docs-zh-cn | S | `src/api/built-in-special-attributes.md` | 3806 |
| docs-zh-cn | S | `src/api/compile-time-flags.md` | 3200 |
| docs-zh-cn | S | `src/api/custom-elements.md` | 3008 |
| docs-zh-cn | S | `src/api/custom-renderer.md` | 2511 |
| docs-zh-cn | M | `src/api/built-in-components.md` | 8784 |
| docs-zh-cn | M | `src/api/built-in-special-elements.md` | 5032 |
| docs-zh-cn | M | `src/api/component-instance.md` | 8592 |
| docs-zh-cn | M | `src/api/composition-api-dependency-injection.md` | 4242 |
| docs-zh-cn | L | `src/api/application.md` | 18032 |
| docs-zh-cn | L | `src/api/built-in-directives.md` | 17405 |
| docs-zh-cn | L | `src/api/sfc-script-setup.md` | 20118 |
| docs-zh-cn | L | `src/guide/best-practices/accessibility.md` | 20362 |
| docs | S | `src/api/compile-time-flags.md` | 3322 |
| docs | S | `src/api/custom-elements.md` | 3095 |
| docs | S | `src/api/custom-renderer.md` | 2487 |
| docs | S | `src/api/options-rendering.md` | 3978 |
| docs | M | `src/api/built-in-components.md` | 9216 |
| docs | M | `src/api/built-in-special-attributes.md` | 4108 |
| docs | M | `src/api/built-in-special-elements.md` | 5253 |
| docs | M | `src/api/component-instance.md` | 8854 |
| docs | L | `src/api/application.md` | 18668 |
| docs | L | `src/api/built-in-directives.md` | 18247 |
| docs | L | `src/api/reactivity-core.md` | 16619 |
| docs | L | `src/api/sfc-script-setup.md` | 20905 |
| book | S | `src/appendix-05-editions.md` | 3075 |
| book | S | `src/appendix-06-translation.md` | 1991 |
| book | S | `src/ch03-04-comments.md` | 1529 |
| book | S | `src/ch07-01-packages-and-crates.md` | 3806 |
| book | M | `src/appendix-01-keywords.md` | 5268 |
| book | M | `src/appendix-03-derivable-traits.md` | 9870 |
| book | M | `src/appendix-04-useful-development-tools.md` | 5335 |
| book | M | `src/appendix-07-nightly-rust.md` | 9050 |
| book | L | `src/appendix-02-operators.md` | 22595 |
| book | L | `src/ch03-02-data-types.md` | 17272 |
| book | L | `src/ch03-05-control-flow.md` | 17064 |
| book | L | `src/ch04-01-what-is-ownership.md` | 25352 |

附带许可白名单恰5项：两Vue各根`LICENSE`（各17420 bytes），Rust根`COPYRIGHT`219、`LICENSE-MIT`1071、`LICENSE-APACHE`10847 bytes，合计46977 bytes；不纳搜索正文，保留归属。正文+许可恰41项/399028 bytes，不抽取图片、其它资源或packages/trpl许可副本。

拟执行合同：另新mktemp，仅离线读取上述三个已核归档，执行前重新核整个压缩SHA；复用同一安全tar规则及完整流校验，严格白名单匹配，每项只允许一次regular成员、实际size须等表值，输出采用预定匿名ID安全文件名并wx创建（不直接按归档路径extract）。不使用extractall，不运行仓库代码，不联网追图片/链接；未列成员仍只计数跳过。每包30秒、整批180秒精确进程组止损，原压缩/实际展开/条目/路径上限不放宽；单正文≤1MiB、正文总≤16MiB，先按固定表预留再分块读取。遇hash、缺项、多项、非法UTF8或预算失败首错停并保partial/双流，不修正文或换样本。保存原始bytes、逐文件SHA及repo/commit/path/size/source URL/license归属manifest；严格UTF8解码只用于验证，明确保BOM与CRLF/loneCR，不把解码再编码覆盖原文件。正文中任何指令/代码均仅不可信语料，不执行。完成前不得把partial manifest当可用corpus。

源码准备与实际提取分两次审查授权；此处合同写作时未实现/提取。提取之后先另批不计时的bytes/scalars/distinctgrams/tokenbytes预算规划及离线参考substring/手写范围oracle，再冻结适配两引擎的完整共享预算；现L的16篇/64KiB/4096grams不是本36篇或后续规模样本已可用上限。不得静默截断/跳文档，overflow扫描桶需另审；本阶段不展开成本实现、控制面模型或产品接线，不关闭OBL-006/018/026/035及长期artifact义务。

### 白名单离线提取源准备（未执行）

主线与两轴核41项合同后批准仅源准备。新目录`/tmp/agentic-f064a-corpus-extract.kTIP71`：`allowlist.json`冻结36+5项、三个commit及压缩SHA，SHA256为`a55ae06f9fff68177b9b8a8f5837835d1663c375e368564e27caf05267a58746`；`safe_tar.py`138行为原已审parser新副本，仅包装scan函数及受限selected/consume回调（原parser保留不改）；`extract.py`66行执行包SHA核验、白名单尺寸/类型核及原bytes写出，`run.py`104行提供30秒/包、180秒共同截止及精确进程组收据。Python AST纯语法检查通过，未import执行提取、未读取归档正文或建搜索索引。

回调只接收预核≤1MiB白名单payload，UTF8严格验证不改bytes；非白名单仍计数跳过。即使41项已写齐也必须继续三个归档的全部安全头/payload/零尾/gzip EOF核验，三个子进程成功退出且无残组之后，再核41项唯一/逐项字段、size、SHA与399028总bytes，才写aggregate complete。中途已写raw及partial收据均不可作为可用corpus；不extractall、不下载、无自动重试。源准备编排曾因JS误用index方法在写文件前报TypeError，改为indexOf后成功，属于源准备工具错误、未运行归档或改变oracle。下一待主线全文读源与两轴复核另批运行。

主线源审补齐冻结清单硬校验：原未运行run.py/extract.py各保.v1；parent首次读取、每子阶段前后，以及child读入，均对同一read_bytes先核上述固定SHA再json解析，匿名输出ID仅ASCII `d\d{2}|l[1-5]`完整匹配。allowlist内容/SHA不变，safe_tar不改；仅AST复核通过，仍未执行提取。该补充不改变41项或任何正文oracle。

### 固定41项实际提取收据

主线审源及两轴0必要阻断后执行，`/tmp/agentic-f064a-corpus-extract.kTIP71/run-1792330318024936000/receipt.json`为complete，父exit0。三子收据分别PID7957/7959/7961、131/129/175ms、exit0/无timeout/残组；三包全部流扫描结束，41项352051正文bytes+46977许可bytes=399028，逐文件SHA/来源/许可在receipt内。作者只读核主收据和三子收据，不将读取声明冒独立重新提取。

Spec独立逐原tar核41个payload与实际输出bytes全同；Standards独立核41项实际SHA/size/source/license/固定集合、四源SHA与双流，0必要结果阻断，且实际读取五许可：两Vue CC BY4.0（图片除外），Rust MIT OR Apache及COPYRIGHT。主线批准仅有限提取通过，不冒再分发授权审定、语义或性能结果；许可文件不是搜索正文。

## 下一预算规划与独立参考oracle（仅方案，未源／运行）

目的只为36个完整真实输入核定适配成本与正确性基线，不计入引擎性能，不据此选型。输入固定上述receipt中的d01–d36原bytes/SHA，不读5许可进入搜索，不修改BOM/换行/大小写/Unicode规范形式。先逐文件核size/SHA与严格UTF8，再统计UTF8 bytes、Unicode scalar数、UTF16长度、开头BOM、CRLF/loneCR/loneLF；完整枚举1/2/3 scalar gram，各长度记录出现次数、distinct数、固定ASCII编码token总bytes及分隔符/去重集合暂存模型。不得沿旧16篇/64KiB/4096gram静默截断；实际计数出来后另冻结双方完整共同预算，原文存储、编码、Set/排序、SQL绑定及Tantivy值/候选raw副本都不能藏到账外。本轮输出为不计时规划统计，不是峰值RSS实测或真实heap封顶。拟每文档15秒、整批180秒精确组止损；超限保原失败，不截gram或换样本，overflow扫描桶另审。

独立参考实现拟用Python标准库：解码保BOM；按scalar数组每个起点逐元素比对query，首个匹配后通过前缀scalar的1/2 UTF16单位累加得到[start,end)。不复用引擎find、gram生成或候选集合，不用后端结果生成expected；文档按匿名ID排序，每文档只首命中。参考实现必须先通过原L手写短中文、非BMP、BOM/CRLF、重复gram假阳性、quote/backslash固定小例自校验，再对36正文计算完整12query结果；自校验失败即停不写真实oracle完成标记。参考计算与引擎运行分离，前者结果manifest冻结/hash并独立复核后，才另批引擎与成本源。

原12标题为主的草案尚未运行；主线复核指出缺成本查询类别，执行前改为下列12slot。保Q01–03原锚点；其它按类别固定，不依赖引擎表现选串。UTF16范围只作指定文档的正锚点，全36篇首命中集合仍待独立参考生成。

| slot | 冻结query或确定性规则 | 来源／锚点与覆盖意图 |
|---|---|---|
| Q01 | `内` | d01[2,3)，1 scalar中文 |
| Q02 | `应用` | d09[2,4)，2 scalar中文 |
| Q03 | `无障碍` | d12[2,5)，3 scalar中文 |
| Q04 | `Attributes` | d01[8,18)，英文大写版本 |
| Q05 | `attributes` | 与Q04构成大小写对；全集结果待参考，不能推定与Q04相等 |
| Q06 | `<script setup>` | d24[3,17)，Markdown标点边界 |
| Q07 | 两个LF，JSON字面`"\n\n"`，UTF8 hex=0a0a、scalar/UTF16长度均2 | 跨行查询；不把CRLF规范化为LF，全集首范围待参考 |
| Q08 | `😀`（U+1F600） | 固定非BMP；真实集合是否有命中待参考，若零则不冒正覆盖 |
| Q09 | `é`（U+0065 U+0301） | 固定组合序列，不用U+00E9替换；真实正覆盖待算 |
| Q10 | `F064A_ABSENT_7d4e1c9b_不存在_𠮷` | 预期全空；参考若命中则首红停，不临时换串伪造零命中 |
| Q11 | 一个ASCII空格U+0020 | 固定高频候选类别；实际密度统计后披露，不先宣称具体命中率 |
| Q12 | 固定d01的前512 Unicode scalars，不足则整篇 | 预算批冻结原字面/SHA及[0,end)并断言distinct scalar trigrams>128；若不满足明确覆盖失败，不换文档/取串规则/改语料。验证进入既定全候选fallback，不截子句 |

Q12只取固定前512scalar，不扫描选择其它起点或更有利文档；相同gram按scalar序列相等计数。全部12真实query字面、UTF8 SHA与参考expected必须在引擎运行前完成冻结并独立审查。当前没有运行Q12生成、全体搜索或计数，Q08/Q09缺真实正例则继续用原L固定样本覆盖，不能将语料零命中冒非BMP/组合的正匹配保证。

预算规划须先预留再生成集合：只处理一个文档的gram工作集，当前36文件/352051原bytes从固定manifest核，预先按每篇bytes B取scalar上界n=B。gram出现数上界K=n+max(n-1,0)+max(n-2,0)；ASCII token编码上界E在n=0时0、n=1时9，n≥2时为9n+15(n-1)+21max(n-2,0)，连接空格另计max(K-1,0)。每篇生成前按保守模型预留8B+512K+4(E+K)+1MiB暂存，另保整个原bytes4倍、12个4096UTF16 query各64倍及结果/统计输出8MiB；联合模型上限256MiB。若连此先验上界也不能准入就前拒保失败，不先分配后声称预算控制，不以实际distinct较少擅自放宽。该模型是实验止损账而非Python对象实测RSS或系统硬内存封顶；实际峰值RSS仍后续测量。本批单文件工作集结束释放引用后再处理下一篇，只持固定大小统计，不累积所有doc的gram集合。

由固定metadata可先验推导（不是已运行gram统计）：总scalar≤352051；全部gram窗口≤3B=1056153；token ASCII bytes≤45B=15842295，加连接空格≤3B后总≤48B=16898448。最大单篇为d36的25352 bytes，因此单篇scalar≤25352、窗口≤76056、token ASCII≤1140840。用这些更宽上界代入上式，单篇工作集≤45059648 bytes，加固定原文/query/输出账后联合≤58002188 bytes，低于256MiB模型阈值。Set的512 bytes/窗口、字符串副本系数和1MiB scratch都是提前冻结的保守逻辑计费，不是从解释器实测所得，也不能证明所有实现内存都受此数硬限制；进程峰值RSS与分配器保留必须在后续性能测量单列。未来语料变化必须重新按manifest算准入，不沿这次数字默认放行。

独立参考按文档逐项运行，最多36×12个首命中/空结果，结果序列化≤8MiB；输入query先拒孤立surrogate及>4096UTF16，原文与UTF16映射成本纳上述预留。预算统计与参考是同一个有限脚本批，15秒/文档与180秒总截止仍保留，不拆无关控制模型。原L假阳性、BOM/CRLF、quote/backslash、空查询/超限保护自校验不删除。控制面dirty覆盖、授权与身份／迟到发布依然正式服务前置，不因本批绿升级为产品保证；此处方案写作时无新源、gram统计、参考或引擎运行。

### 预算／参考源准备（未执行）

主线与两轴审后仅批准源准备，新`/tmp/agentic-f064a-reference.BDHlVX`：inputs.json冻结36实际原SHA、原L完整25手写case及fixture SHA、12查询规则，SHA256 `461ee2187b50b0d8f092efab7a092c1878b5a6422a42deabc85bfb613338b60e`；reference.py 156行，run.py 107行。Q07文档修为JSON的两个LF，源码对输入显式assert hex0a0a与scalar/UTF16均2。参考匹配独立逐scalar起点／逐元素比较，未调用find/index或gram候选；规划gram生成只用于完整数量/ASCII编码费用与Q12阈值，未用于参考匹配。

runner复用原精确进程组15秒单阶段/180秒整批上限、双流与ps检查，先原L25自校验与3非法输入拒绝，再生成固定queries、逐36文档独立子进程先预留后计算、最后汇总≤8MiB结果及SHA。原输入与原L只读，最终成功前不写complete；源写作只做Python AST解析，未运行selftest、query生成、gram统计、参考或引擎，未生成任何新expected。待主线全文读源与两轴审后另批运行。

### 预算／参考实际收据（两轴结果待回）

主线批准后实际`/tmp/agentic-f064a-reference.BDHlVX/run-1792330916464532000`父exit0、receipt complete；results SHA256 `d7a211847eab63699bde3dcd5dc651729499c6771c1a096788248b1e3258c451`。原L25手写case与3非法输入拒绝通过，36篇/12query及六正锚点核通过；inputs SHA保持461ee218…38b60e。作者只读核收据与结果，未自行重跑，独立两轴结果尚待回，不提前宣称其已通过。

实数仅作规划：正文352051 bytes、316601 scalars、各doc各长度distinct gram合计120822，含逐doc join分隔的token bytes合计2372532。Q01–Q12文档命中数依次10/7/1/6/9/8/36/0/0/0/36/1；Q12真实512 scalars/UTF16且>128distinct门禁已通过。Q08 emoji与Q09组合序列在本36篇均零命中，不是非BMP或组合的真实正匹配覆盖，原L对应正例继续承担该边界。这里没有引擎正确性、RSS或延迟测量。

随后Spec实际独立复跑`run-1792330935107592000`，38子exit0、无timeout/残组，results逐bytes等主线SHA；Standards独立核38子/源/结果/统计公式及命中原文范围，0必要有限结果阻断，主线认可参考阶段通过。实际按精确K/E公式最大reservation为58000412 bytes，上文58002188是用K≤3B/E≤45B代入的更宽先验界，两者不混。实际单doc最大distinct为8967，已经超过旧4096，下一不能沿用旧限额。上述待回是当时历史，不抹去收据时序。

## 下一36篇真实语料双引擎正确性／成本联合最小批（仅方案）

一个有限闭环：固定上述36原SHA、12实际query字面及独立参考results SHA，两后端各从空临时目录构建真实持久索引→commit后可见→同12查询完整命中/UTF16首范围对照→正常关闭→独立新进程只读重开、不导入正文→同12查询→有界暖查重复与存储计量。仍同Tantivy0.27 Cargo.lock/Rust1.90、同包内Bun1.4/SQLite3.54；不新增分词器或换原文语义。此批同时获得正确性和小样本成本，不能代替未来合成规模、实际增量/删除成本或正式服务控制面。

两边保持相同1/2/3scalar gram、固定ASCII token及去重；query≤2同长度、≥3全部distinct trigram AND，>128全候选scan-fallback。SQLite FTS受控token参数MATCH，原文独立BLOB事务写入、返回Uint8Array核bytes/fatal保BOMdecode；Tantivy STRING多值gram、id STRING|STORED、path/raw STORED，TermQuery+Occur::Must/AllQuery公开接点，commit→Manual reload→新searcher。实际候选stored raw先验SHA/长度必须同原，再case-sensitive精确后验证；每doc只首UTF16span，按匿名ID稳定排序，完整36可返回、不沿旧16文档/64KiB/4096gram上限截断。每轮查询结果逐项等独立参考，首次差异立即停保原输出，不能继续性能批把红掩盖。

资源预留沿上一模型逐doc先准入，固定36篇/352051 bytes且不替换输入；共同先验门禁为单doc bytes≤25352、token数≤76056、含分隔ASCII bytes≤1216896（48B），候选≤36且原bytes合计≤352051，不根据实测distinct挑低门限。构建重新生成全部gram并计费，不能把预计算2372532 bytes的产物当免费索引输入；完整token/Set/编码/绑定/存储raw与查询候选解码都计入阶段耗时。单doc工作集按最大58002188逻辑bytes准入，另预留Tantivy writer的公开50MiB预算与输入累计原文/索引送入暂存；SQLite明确cache_size=-16384（16MiB配置，不冒总RSS上限），联合逻辑预算按下方累计writer补账修订为512MiB。源准备须列清送入writer后可能保留的值/缓存，不因逐doc释放宿主Set便声称引擎内存已释放；实际进程峰值RSS独立测量，超逻辑预算即拒，不截词、不减文档、不按较快候选改参数。

沿原公平成本合同固定三配对轮AB/BA/AB（A=SQLite、B=Tantivy），不采用此前未执行的两轮/30次草案。每个引擎轮使用独立新空索引与build进程，正常关闭退出后另起只读query进程，不重新导入正文。先完整12query正确性校验，再每query10次预热+200次计时，固定slot顺序；预热仍核结果，不计入200次分位数。保每个原始样本与轮序，逐query/逐轮nearest-rank p50/p95/p99/max，不只报跨轮合并均值，不掩短中文、全命中空格或长query fallback。Tantivy明确公开writer单线程+50MiB预算；SQLite cache_size=-16384、journal_mode=WAL、synchronous=FULL及wal_autocheckpoint全部回读记录，不以请求值冒实际配置。

计时分三账且不增加常驻请求协议：build子进程内从开始读原文到全部gram生成/写入、commit与reader可见，另列正常merge/关闭；query子进程内逐query从query编码/检索前到完整stored raw后验证/UTF16首范围/排序完成，只称进程内适配时间；宿主测整个build/query轮墙钟，每个query响应对象的真实序列化耗时、stdout总序列化/IPC总bytes及宿主完整JSON解析耗时分别单列，不能把整轮账除以次数冒单query端到端。宿主墙钟从spawn到收齐并解析完整输出；启动/打开既有索引单列，不混每条暖查；当前是CLI子进程，不宣称已接应用worker。独立重开首查称“新进程首次查、OS缓存未清”，不是硬件冷缓存；不调用purge或改系统缓存。commit可见的正确性必须在wait_merging_threads之前实际查验，不能只在merge收尾后观察结果再声称提交即可见。

writer队列联合账补齐：公开writer_with_num_threads(1,50MiB)仅1个indexing worker，默认4个merge线程，50MiB为索引arena而非总内存上限。36篇可能全部留队列，不能以逐doc释放Set冒队列释放。两边公平预留全语料values/队列账：128×1056153窗口值节点+16898448编码与连接bytes+4×352051原文bytes+1024×36文档元数据=153531100 bytes；再加单doc宽工作集58002188、Tantivy arena52428800（SQLite实际cache配置另报，不要求伪用同等arena）以及独立32MiB merge/查询暂存模型，总逻辑297516520 bytes，超过原256MiB。故本联合批在执行前明确改为共同512MiB模型准入（原256MiB参考阶段不改），不是按实测distinct降低账。所有系数均预声明实验容量账，32MiB不是公开merge物理上限；真实队列/merge/运行时峰值须RSS实测，不能宣称512MiB硬封顶。准入公式超过模型即前拒，不能缩语料/截词放行。SQLite每个连接回读cache_size/synchronous/journal_mode等；只读重开不得执行切换journal_mode写操作。

RSS分别保build/query子进程的采样时间序列、start/ready基线、采样peak与相对基线delta；拟宿主每20ms读取本实验PID的公开RSS，记录实际采样时间/间隔，不能把计划20ms冒每次精确采到。另取公开进程资源maxRSS，先核本机单位再换算bytes；此最大值覆盖整个子进程，不能按阶段拆分猜峰。若采样错失短峰或首样本已过分配起点需显式说明，maxRSS与采样peak不要求相等；包含语言运行时及适配，不拿delta替代总占用。持久disk核整个索引目录所有普通文件逻辑bytes，并单列文件数；SQLite db/-wal/-shm全部计入，commit可见不依赖checkpoint，正常关闭/明确checkpoint后大小与费用单列。Tantivy段/元数据/删除标记均计，正常close不承诺崩溃durability。RSS与磁盘有限样本不是产品SLO。

拟每个引擎完整轮（build及随后query共用截止）≤120秒、整批≤15分钟；编译单列同锁600秒精确组限。每次查询运行若无法独立中断，宿主超时终止该轮精确进程组并保输出，不能把丢弃结果冒查询计算取消；成功阶段无残组才下一轮。输出原始测量/完整结果/源与二进制SHA、退出/timeout/双流全部保存；超时/错误/语义差异首红停，不自动重跑挑好值。最终仅报告36篇有限比较，不直接锁最终后端；后续100/1000/10000合成与大文档、增量成本、取消粒度、许可归属及持久artifact归档责任仍开放。当前仅方案，未新源、编译或引擎执行；待主线与两轴复核后再批源准备。

### 36篇联合批源准备（未编译／执行）

主线及两轴审后批准源准备，新目录`/tmp/agentic-f064a-corpus-cost.hrCQVN`。同原Cargo.toml/lock（锁SHA639d75f7…00f347），固定manifest.json SHA `d6b544e240993096dfb7514621f7a954413df22d2189e69a8919abd497561711`，docs.tsv/queries.tsv供无新增crate的Rust读取；sqlite.mjs、src/main.rs、src/sha256.rs、run.py实现上述有限闭环。仅JS语法与Python AST检查通过，没有编译、构建索引或运行任何查询。

两个引擎先12个first/commit-check全验，再每slot 10预热/200计时。输出候选ID/SHA/总bytes和完整hits，不逐次输出正文；query内均实际核stored raw SHA与bytes，再后验证，不将宿主预检当查询免费校验。stdout NDJSON每进程64MiB上限，宿主计数超限停止精确组；每条query响应只序列化一次并测时，非query未测计时用null不冒0。宿主保存实际RSS时间序列、ready观测后peak/delta和wait4公开maxRSS（主线核macOS单位bytes）；采样失败保存sampleErrors而非假RSS，任何执行异常进入精确组清理与receipt保全，不能核组时明确unknown而非无残留。batch必须找到成功compile收据且当前全部source/binary SHA相等，拒绝改源后运行旧binary。

first标签只有Q01是该进程首次query；Q02–12仅各slot首执行，已经受之前slot与打开索引影响，不冒12次独立冷进程。源准备冻结SHA：run.py `79be2fb5daf13df75dad02ac8b68d9b71da138d8103be9f7b1b3b4da2e5b7735`，sqlite.mjs `2c515b2fd52e79d343db1fcec3b0081a48217e1abbb52ef8ad25ab7f260f15ab`，src/main.rs `ac52130727d442fcb6b2bd6b504967e10cc3531dfb08d26032c3a1b3a052a647`，src/sha256.rs `00acc0074da659ee571147a1c9ac1525df649007b3704698317d19101a246c29`。本记录不是编译或实验通过。

Rust无sha2直接依赖，最初未执行的手写SHA草稿保留src/sha256.rs.v1，未采用。主线查本机公开CommonCrypto/CommonDigest.h及导出后批准仅本macOS实验CC_SHA256窄FFI：checked u32长度、栈32-byte输出、同步生命周期/非重叠依据、返回指针核；empty/abc固定已知摘要自校验放启动前，不计query。无spawn哈希/新增crate或产品FFI路线。源准备一次apply_patch试图同patch删除并新增同路径被工具拒绝，随后用正常Update补写；未运行、无输入/oracle变化。下一待主线与两轴全文审冻结源后另批compile/batch。

### 36篇联合批实际收据及有限比较

主线compile `run-1792331674913533000` exit0/38.676秒，binary SHA `9690bdb9ce359b8f0a37961eb3246ed13fc756c48e0dc62d1c85074b4d5e2065`；同目录`/tmp/agentic-f064a-corpus-cost.hrCQVN/run-1792331731674948000` batch complete、三配对12phase全exit0/无timeout或残组。固定source/manifest/锁与成功compile收据一致。每轮build12次及query 12×211次合计15264完整query结果均核参考，原始逐次p50/p95/p99/max、RSS序列、stdout bytes/解析/序列化与关闭前后disk完整保留，不输出全文副本。

下表为主线三轮各自观测范围（query单位ms，非跨轮合并分位数；完整逐轮统计以receipt为准）：

| 观测 | SQLite+Bun | Tantivy+Rust |
|---|---:|---:|
| 关闭后完整索引bytes | 4022272 | 622177 |
| 构建到commit可见 ms | 262.775–280.208 | 303.740–351.593 |
| Q01单中文 p50 ms | 0.204–0.211 | 0.140–0.155 |
| Q02双中文 p50 ms | 0.112–0.121 | 0.080–0.086 |
| Q03三中文 p50 ms | 0.043–0.044 | 0.019–0.023 |
| Q11空格36候选 p50 ms | 0.547–0.643 | 0.324–0.360 |
| Q12长query全候选fallback p50 ms | 0.686–0.795 | 1.112–1.220 |
| query进程公开maxRSS bytes | 66994176–69173248 | 6766592–6930432 |

有限观察：本固定适配/语料中Tantivy索引较小、短中文与高召回较快，但长query fallback中位数更慢；不可据一列挑胜者。RSS含不同语言runtime及本次适配，不冒纯引擎内存对照。第一Tantivy build宿主1.759秒，而进程内可见0.320秒，后两次宿主0.389/0.446秒；额外宿主时长保留、不推根因、不删除样本。Q08/Q09仍只有真实零命中，非正Unicode覆盖；所有first仍是共享新进程各slot首查，非各slot独立冷缓存。

Spec独立另batch `run-1792331761107519000` complete/12phase无异常，同compile/source链；剥离时间后15264query的候选/结果逐条同主线。独立性能保留原运行，不与主线拼接或挑优。随后Standards完成全部15264响应、72分位组、disk/RSS/source独立核验，0必要有限结论阻断；主线批准36篇联合批有限通过，不冒全片或最终后端选型通过。

## 后继规模／增量／取消与持久artifact（仅最小方案）

| 后继闭环 | 固定范围与不得省略的证据 |
|---|---|
| 合成规模 | 保原100/1000/10000档，每档总数N含两篇精确1MiB，其余N−2篇4096 UTF8 bytes；固定seed=64064和自写中英Markdown段落、唯一ID标记，总≤64MiB。生成规则先全文审，原字节/语言/标记与12类别query及独立参考expected在引擎前冻结；合成不冒真实corpus。 |
| 有界写入 | 不沿36篇512MiB默认放行10000。拟固定每最多32篇构建批次，两后端每批commit；Tantivy每批提交后wait_merging_threads释放该writer再开下一writer，SQLite同批事务，reader可见逐批核。这些额外commit/merge/背压成本全部计入构建，不能拿分批结果冒原一次commit。1MiB文档单独一批；每档先按完整输入计算先验工作集/队列模型并明确独立预算，预算未获准或无法容纳则前拒保记录，不能临时截gram。 |
| 增量 | 每档独立原索引上，固定1篇操作以及固定ceil(N×1%)篇操作；顺序为更新前k个ID→添加k个新ID→删除原后k个ID，各阶段事务与reader可见分账。新旧marker及文档身份expected由manifest明示，原12query和阶段marker完整核；不重建全库冒增量。记录每次可见延迟、磁盘写放大与采样峰值；更新段落/bytes规则执行前冻结。 |
| 取消 | 固定查询批间latch发cancel，代数拒收旧结果与真实计算停止分列；只实现本隔离CLI的批间停止，不冒正式workspace控制面。同步单query不能被安全中断时明确等待该query完成及停止延迟；宿主精确组kill仅止损，不能计协作取消成功。 |
| 同口径 | 同锁/适配/短词fallback、AB/BA/AB、每query10预热+200计时、p50/p95/p99/max原始行与RSS/disk分账保持；各档每engine轮仍120秒、该档整批15分钟，超时首红停止且不自动延长或换小档冒通过。先小档成功才下一档，不平行互扰。 |
| 持久可复跑 | 最终选型前将经批准最小脚本/固定manifest/匿名结果与README归档到明确持久研究artifact（拟仓库research/f064a，实际写入须另批）；大语料不默认提交，保固定官方commit+许可归属及取得/校验指令。移除临时绝对路径依赖，用明确参数；锁/工具链/运行环境与初红、范围限制保留。 |

当前只为下一代码批划清范围，尚不批准生成器/统计/引擎或artifact搬迁。完整参数与合成输入在源准备前一次冻结，不能边跑边按表现优化；dirty/授权/产品UI、F064父与OBL-006/018/026/035仍开放，不把有限选型实验升级成产品交付。

剩余工作合为同一必要规模／增量／取消批及归档，不再拆额外纯流程阶段：下一可先完整准备三档fixture生成／预算源，然后复用已审runner接入性能与操作序列；只有真实输入、oracle和预算齐备并经批准后执行。该组织方式不取消首红停、源审或原合同中的任何必验项。

### 合成批一次性冻结参数（仅方案）

生成不使用运行时随机数：seed=64064仅固定样本版本标识；N恰100/1000/10000，原ID为S000000至S(N−1)（十进制补6位），前N−2篇4096 bytes、最后两篇1048576 bytes。原文依次拼：ASCII首行`id=S000000;rev=0;life=base\n`（按本篇ID替换）、固定长行`\n`+U+0100…U+0182升序131 scalars+`\n`、重复周期P。P精确JSON字面为`"# 中文检索\n\nAttributes attributes <script setup>\n😀 e\u0301 内 应用 无障碍\nMarkdown mixed text.\n"`。只追加完整P，下一完整P会超目标bytes时停止，余量全部补ASCII空格，恰目标bytes；不切UTF8 scalar、不截半自然段。每篇原bytes/SHA与元数据冻结，不声称重复合成代表真实语料。

12query固定为：Q01`内`，Q02`应用`，Q03`无障碍`，Q04`Attributes`，Q05`attributes`，Q06`<script setup>`，Q07两个LF（hex0a0a），Q08`😀`，Q09`e\u0301`两个scalars，Q10`F064A_ABSENT_7d4e1c9b_不存在_𠮷`，Q11一个ASCII空格，Q12上述131scalar升序串本身。Q12有129distinct trigrams，必须走fallback；所有非Q10查询预期每个当前活文档均命中，Q10全空。独立Python逐scalar参考在原L自校验后从完整生成原文计算每篇首UTF16范围，query和每阶段expected在引擎前冻结；不根据后端输出调整。各篇首范围可能随固定前缀长度变化，不能只复用一个文档offset冒全集oracle。

增量采用同一原索引明确顺序，不恢复baseline偷排除成本。先k=1：更新S000000至rev=1/life=base、添加A000000（rev=0/life=add，4096 bytes）、删除S(N−1)；再k=ceil(N×1%)：更新S000000…S(k−1)至rev=2/life=base，添加B000000…B(k−1)（rev=0/life=add，各4096 bytes），删除S(N−k−1)…S(N−2)。更新保原目标bytes，依同一完整P+ASCII补齐重建payload；新增不复用A或S的ID。每个操作阶段单独commit/reload并核完整活ID集合、12query结果及所改首行marker；旧首行marker只在原ID消失，新首行marker恰命中新ID，删除ID不出现在AllQuery/对应普通表当前活集合。共6阶段，阶段前后活集合和bytes由上述规则预先冻结，k=1与1%可能同为1但第二次rev=2/B前缀仍不同，不重复添加同ID。不把当前活集合删除冒物理段擦除。

模板distinct先验（不是实测后放宽）：首行H≤64 scalars，长行L=133 scalars，周期P≤256 scalars（源准备须断言），末尾仅同一ASCII空格。每个n∈{1,2,3}的distinct最多来自H/L/P内部窗口、P循环接缝，以及H→L、L→P、P→padding；三个长度合计保守≤3×(64+133+256)+15=1374 tokens（额外15覆盖各接缝及空格run）。编码每token≤21 ASCII bytes，连接空格计入后≤1374×21+1373=30227 bytes。源必须核结构/长度前提，并完整生成/计数断言不超该界；任何违例首红，不换预算。不以此替代每篇全量1MiB原文读取、哈希、UTF16、后验证成本。

本批共同逻辑预算仍可限定512MiB，改用上述可证明重复模板distinct界，不沿旧每原文窗口512bytes的过宽拒绝模型：最大瞬间活文档保守N+k+1≤10101，原bytes≤43048960+101×4096=43462656，预留4倍原文/候选副本173850624 bytes；单篇原文/解码8×1MiB=8388608，Set=512×1374=703488，token编码/连接4×30227=120908。32篇普通批或单篇1MiB批的全部writer送入预留128×1374×32+30227×32+4×1MiB+1024×32=10822240；再加50MiB arena、32MiB merge/query暂存和64MiB结果/序列化账，合计346977964 bytes，低于512MiB。源执行前重新按固定N/阶段算账并断言，不先分配后检查。writer每批commit后wait_merging_threads消费并等待本writer结束再开下批，限制逻辑队列存活，但不称RSS/allocator实际已回收。上述逻辑模型不是系统硬限，RSS仍真实采样；若实际结构不能兑现账，先拒并报告，不能偷偷放宽。

输出不因10000个命中×重复次数无界增长：每slot首轮保完整候选ID/hash与hits一次；预热/计时仍完整materialize并序列化相同响应，然后核与预冻参考的canonical结果摘要，stdout仅发摘要/数量/bytes/计时。完整响应序列化bytes和实际压缩诊断行的IPC bytes分开，不冒完整逐query端到端传输了所有结果；两后端同规则，stdout每phase仍64MiB硬止损。取消仅一条最小真实CLI控制通道：子进程READY后自行按固定批序执行查询，完成批1报告序号并等待ACK；宿主在该latch发CANCEL（不是不发下一任务），子进程记录已完成/已发布最后序号，回CANCELLED并正常退出。记录cancel发送、ACK与正常exit时间；仅证批间协作停止，不能冒同步单query可中断。host kill只止损，不计成功取消。完整120秒/engine轮、900秒/档、首红停不延长；大档超时或容量不可行是有效候选证据，不要求伪全绿。

此补只冻结下一合成规模／增量／取消联合批的输入与预算，不新增授权/dirty模型或源码。主线及两轴审后才准备源；研究artifact归档与许可归属责任仍在同一后继批末完成，不能仅凭/tmp结果宣告最终交付。

执行前消歧：Q09为实际U+0065 U+0301两scalars，UTF8 hex=65cc81，绝非六个ASCII字符的反斜杠转义文本；P内亦是实际同一组合序列。源码须断Q09长度2/hex，并验证每篇H≤64、L=133、P≤256、至少一个完整P、仅完整周期重复及ASCII空格尾，才允许采用1374 distinct先验界；结构不符前拒，不能套用此界到任意1MiB文档。

### 合成联合批源准备收据（未生成／编译／运行）

获准新目录`/tmp/agentic-f064a-scale.1Kfm4c`，完整源为model.py（130行）、prepare.py（103）、processes.py（245）、run.py（192）、sqlite.mjs（205）、src/main.rs（241）及公开CommonCrypto窄封装src/sha256.rs（16）；原Cargo.lock逐bytes同SHA639d75f7…00f347，literal-inputs.json同461ee218…38b60e。只执行Python AST和JS语法检查通过，未生成三档正文/expected、未编译或运行引擎。生成只写新目录，complete在全部七阶段与pins完成后写；原未执行prepare.py.v1保留，修掉baseline非预期N个marker查询，baseline仍全量输入但严格12query，只有六增量阶段检查所改marker。

generate模式逐档独立180秒精确组截止、首红保partial，不延长或优化造绿；生成源五文件在执行前即写sources.json与失败receipt，不依赖仍在收口的引擎source。compile单列600秒同锁；batch要求显式已审生成receipt路径+SHA及成功compile/source/binary链，仍每engine完整轮120秒/每档900秒，三档顺序首红停。完整候选/hits每次实际序列化、摘要核重复；跨轮／引擎只长期保候选语义摘要，不累积七阶段全结果数组。首响应再次输出的诊断编码/IPC属整轮host账，不冒单query往返时间。

每32篇或单大篇批提交后，在waitmerge前核当前完整live IDs及本批stored原bytes/SHA；最后批的writer保持至12query/阶段marker真正可见核结束后再收尾，合并/背压仍计成本。取消以真实stdin CANCEL及CANCELLED完成／发布序号验证，不用不发下一任务冒取消。磁盘前后记录是目录逻辑bytes变化，不冒OS物理写入量或完整写放大测量；RSS仍进程runtime包含的有限观测。生成5源已交主线及两轴源审，JS/Rust完整候选待整体复核；当前没有新执行收据。

### 三档生成／独立参考实际收据（最终独立复核中）

主线执行`python3 /tmp/agentic-f064a-scale.1Kfm4c/run.py generate`，输出`run-1792332750009771000`，父exit0、receipt complete，SHA256 `2822c8814f93dcef772f43a2afc36b3f2209caab4f9c81905b3b6ab8c0494da5`。作者实际读取三个子收据与complete并核下列摘要；没有重复生成或执行引擎。三个子进程均exit0、failure=null、无残组、stderr为0，逐档180秒截止未超限；所有成功生成源前后保持冻结五文件SHA（完整值在父receipt/sources.json），不把仍可独立收口的引擎源纳入本次生成事实。

| N | 生成／参考实耗秒 | 逻辑预留bytes | 原文瞬间上界bytes | 独立payload版本数／阶段数 | complete SHA256 |
|---:|---:|---:|---:|---:|---|
| 100 | 5.953 | 183154348 | 2506752 | 104／7 | a8f3061bf214240e3083ff3a57ebc12cd81b556318f85ee4451c2609075e1c05 |
| 1000 | 90.057 | 198047404 | 6230016 | 1022／7 | a0fe333f73a2340e4ae5c1b7a878e1734a33892550b097ac20733419a953f436 |
| 10000 | 130.316 | 346977964 | 43462656 | 10202／7 | 1901c4c380b28ba2974316423199acbb9668f0e0228853e130baf8c6ba8ffb12 |

每档原L25及3非法输入自校验通过，完整原文／gram计数与固定12query独立scalar首UTF16 oracle、六增量阶段身份／旧新marker已冻结；baseline仅12query，不额外跑N条marker。原文版本数包含更新／新增payload，不冒当前活文档数；逻辑预留不冒RSS硬限。公开子进程maxRSS依次38502400、37961728、140181504 bytes，属于生成器／参考Python运行而非SQLite或Tantivy成本。生成耗时不作引擎性能或产品SLO，90秒与130秒差异只保观测、不猜原因。两轴最终证据核验尚待回，此处不预写通过；合成引擎编译／三配对性能／增量／取消仍未执行。

### 合成引擎首编译类型红与两处显式调用窄修

主线原目录`run-1792333654289467000` compile真实exit101／35.878秒、无残组，原compile.stderr及receipt/source指纹完整保留。Rust src/main.rs:150与159的key均来自`Vec<(&String,&Doc)>`借用迭代，类型为`&&String`；`key.as_str()`解析到已引入Value trait的Option返回，而非期望的String固有方法，导致E0277及后续BTreeSet contains的E0308。尚未开始任何引擎批，不把该编译红称性能失败或修改语义oracle。

获准新目录`/tmp/agentic-f064a-scale-typed.Xx6GxU`，仅上述两处改为`String::as_str(*key)`，明确从`&&String`解一层取`&String`调用固有方法。src/main.rs新SHA `8554f8974db691a264208b049b685348c667432e1340c5570db9d6bbaed54330`；其余10文件（含Cargo.toml/lock、两生成器、prepare.v1、literal-inputs、processes/run、SQLite、SHA窄封装）逐bytes同原。原目录／原失败／已冻结三档输入和生成receipt路径不改，不重生成、不复制失败target。此处只准备源，未编译或运行，待主线及两轴diff审核后主线重编译。

随后生成证据两轴最终核验均0必要阻断：Spec独立核全部模板bytes、每档七阶段共84条固定query命中与阶段marker；Standards独立核105个阶段文件pins及11328份raw的bytes/SHA。主线认可三档生成／参考有限通过，仍不是SQLite／Tantivy性能、增量或取消结果。两轴与主线亦核新目录两处String固有方法调用diff及其他文件不变，批准主线重编译（session24261）；本条记录时尚在执行，不预写编译或引擎批成功。上方“待回／待审”保留为当时历史。

实际重编译收据：新目录`run-1792333793029627000` compile exit0／35.682882秒、failure=null、无残组，锁与全部source链保持；binary SHA256 `55468cc0afb9f86154f3c46d0d59f7d12ab896cfb16867384b8d94642873e63f`。作者只读核compile.json与receipt.json。主线随后启动`run-1792333838696545000`合成batch（session81311），本条记录时正在运行，源冻结不修改，不预写任何档位／增量／取消结果。

### 持久artifact最小归档方案（未迁移）

拟在获准后仅写`research/f064a/`：README复跑入口／有限结论／开放责任，最小已审源链与Cargo.toml/lock，固定输入manifest／参考oracle，原成功及首红收据／双流／必要匿名原始测量。不要默认带Rust工具链、cargo缓存、target、应用binary、索引DB、官方tar包或大语料。合成正文由固定生成器重建，真实正文由官方固定commit+归档SHA+36白名单+取得／校验脚本重建；保五份license/COPYRIGHT及逐篇repo/commit/path/license/SHA映射，Vue CC BY4.0图片例外与Rust MIT OR Apache-2.0明确，第三方正文不改套项目许可证。

参数化范围仅环境路径：Rust prefix/CARGO_HOME/target、包内Bun路径及其版本／SHA、数据／输出根、原L自校验fixture位置、生成receipt位置；引擎版本／锁、模板／query／expected、预算和止损不随迁移调整。原始receipt、source及失败日志按bytes原样归档，并另建artifact清单记录原绝对路径→归档相对路径、每文件原SHA／归档SHA／用途；不修改旧receipt内/tmp历史路径冒成新运行。迁移后的可运行脚本另记新sourceSHA、逐处路径参数化diff和复跑命令，与原历史链分开。缺失原物料则明确标缺失，不重造首红证据。原始结果可能较大，应先列文件数量／bytes再批准最小集合，不能只留汇总而丢原分位样本；归档本身与迁移版复跑均另需主线批准。当前只是方案，未搬迁／提交；完整后端选型、正式服务的授权／dirty／取消消费者与父义务仍开放。

#### 实际盘点与具体包装方案（未搬迁）

只读盘点排除仍运行的`run-1792333838696545000`，当前历史候选1704文件／219623860 bytes：源码96／714200、小型自建fixtures121／12505、许可5／46977、官方工具链manifest3／1824627、manifest／完整reference139／173909740、原始receipt／双流／timing1340／43115811。这不是最终批准集合，当前batch完成后补实际数量；未压缩，不预测压缩比。大头为scale七阶段完整expected／pins及旧输入副本171601401 bytes、真实36成本原始收据39332433 bytes，不能只保分位摘要。

| 拟研究目录内容 | 包装／用途 |
|---|---|
| README.md、inventory.json | 有限结论、原失败、环境／复跑入口与精确白名单；每项原绝对路径、稳定阶段ID、归档相对路径、原bytes/SHA、容器名与容器内路径、用途。 |
| source/、fixtures/、licenses/ | 最小可读纯文本源链与原窄修版本、Cargo.lock、小自建正／负fixture、五许可／COPYRIGHT；不同历史源不偷偷覆盖，内容重复可共用同SHA实体但保全部来源映射。迁移版参数化源另标revision/newSHA与diff，不覆盖历史版本。 |
| evidence/manifests-reference.tar.gz | 大manifest／完整oracle及官方工具链manifest无损压缩；保持原bytes，不格式化JSON、不重算expected替换历史结果。 |
| evidence/receipts-<stage>.tar.gz | 按toolchain/native/L-BOM/CRUD/corpus/reference/real-cost/scale等稳定阶段分包，原receipt、stdout/stderr、RSS序列和逐样本timing完整无损保留；原始失败与独立复跑不合并挑优。 |

归档采用显式白名单，不递归打包整个/tmp目录。容器仅普通文件／必要目录，路径为预先映射的安全相对路径：拒绝绝对路径、空／`.`／`..`组件、NUL、重复生效路径、symlink/hardlink及特殊项；不得跟随链接逃出源白名单或归档目标。明确排除target、cargo cache、Rust安装prefix／unpack、应用或实验binary、索引目录／db／wal／shm、官方tar大包、真实36篇正文和大合成raw；小型自建归档负例作为普通fixture字节保存，不自动展开其恶意成员。最终集合须按实际stage列出，不能用模糊glob纳入新生成文件。

制作后需核每容器SHA／压缩bytes，以及流式解压后每个成员的相对路径、声明／实际bytes与原文件SHA；全部条目恰一次匹配inventory，完整读到EOF后才标archive complete。容器解压验证不修改原文件，也不默认extractall。解压后每文件SHA与原始SHA相等才称无损归档，容器SHA不能替代成员指纹；原receipt中的/tmp路径是历史事实，保留并由inventory解析，而非编辑成新路径。不要把1700余个诊断散文件直接铺入repo；最终压缩大小与实际batch收据齐备后再由主线批准搬迁／提交，本段仍仅方案。

### 合成批首红与部分完成范围

主线`run-1792333838696545000`父exit1，receipt failed、保109条已完成phase记录。100／1000两档完整三配对共108phase已完成，Spec独立核31716条query及增量／取消结果通过；该部分结果不替代10000档，也不将未跑Tantivy大档当失败或胜者。10000首轮SQLite build exit0／25.665秒，接续query exit−15／88.459秒、无残组、stderr0；最后完整输出为Q03 timed repeat77（该slot已78次），总520条query。Q04–Q12暖测、该轮六增量／取消、后续Tantivy及其余配对均未完成，不外推完整矩阵。

共享engine轮120秒包括build、宿主校验／解析与query，不能把25.665+88.459两个子进程耗时当全部墙钟；本次按固定止损停止，未延长。实际公开maxRSS query1815347200 bytes、build1224785920，前者ready基线152518656。512MiB一直是逻辑预留模型而非物理RSS封顶，本红明确暴露该模型不等于实际内存限制，不把1.8GB写成预算内运行。Q01/Q02已完成的200次进程内query中位167.874／164.639ms，Q03仅78次不能冒200次分位；样本原始值保留，不据此选后端。

收据缺口：原processes.command异常wrapper用outer RuntimeError覆盖了inner failure字段，当前query.json实际failure为`RuntimeError('FAILED_10000-1-sqlite-baseline-query')`，不能声称原JSON仍有DEADLINE。结合原deadline代码、−15退出与整轮时间判断为截止触发，但内层类别直接证据已被覆盖；不修改原收据。下一诊断版须独立保innerFailure与outerError，再保原双流／退出／组核；这是诊断记账修订，不冒性能修复。

### 下一只读诊断建议（未写源／复跑）

已全文读取diagnosing-bugs技能。现有真实红是完整轮截止，尚无秒级且同一失败语义的最小复现；因此以下仅供复现设计的候选，不作为已定位根因，也不直接实施优化。第一步拟新临时诊断目录，原输入／oracle／源码保留，复制原只读query调用、使用本次已成功构建索引，不写索引或重建；以原query剩余时限作一次原路径复现，保确切共享截止口径。若改成单query／少重复秒级切片，只能作为成本剖面，不能声称已复现完整120秒超时；不得用任意降低超时强造同红。主线先审核最小诊断源／信号，再执行；一次变一因素，原10预热／200正式矩阵不被诊断切片替代。

| 只读可疑点（非根因） | 可证伪预测与最小分界观测 |
|---|---|
| 每次候选全量读取＋SHA／decode／Buffer roundtrip | Q01/Q02实际每次10000候选约43MiB；若主要耗在校验／转换，分别计候选fetch、hash、decode／roundtrip、find四段后，后几段应占多数。先只加计时不删校验；反之可排除“纯hash主导”。 |
| FTS join/all物化与JS分配／GC | `.all()`先物化全部BLOB，随后decode并构建两份Buffer比较，反复200次；若分配／回收主导，RSS增量及长尾应随重复出现而非只在open。原ready约153MB而后峰1.8GB支持继续测，不证明泄漏；禁止先强制GC或换迭代接口冒修复。 |
| manifest及常驻metadata | complete约3544811 bytes、baseline manifest26443163 bytes，含重复stage文档／spans／hits；若仅初始manifest解析主导，应主要增加ready前时间／基线，不解释之后持续大幅增长。测load/parse及ready后各边界，暂不裁manifest。 |
| 高召回索引取候选／连接成本 | 原first Q12全扫描88.297ms，Q01–Q09多数162–176ms，Q10空候选1.054ms；若FTS/join成本显著，fetch段应呈index全召回高于fallback，后验证同量部分接近。需固定同样原文与候选集合对照，不能用空命中“证明”常见查询快。 |

上述预测要在真实原路径复现／缩小反馈环建立后才作为正式假设逐项测试；当前无新源、无采样实验、不删完整raw校验或改语义／预算／deadline，不推SQLite引擎单独有缺陷或Tantivy胜出。

#### 获准成本剖面源准备（尚未运行）

主线明确已有真实完整红，不要求重复88秒整段才能调查成本；显式跳过重复整轮，短片不称复现或修复原120秒超时。新目录`/tmp/agentic-f064a-profile.e7G48i`仅准备profile.mjs、run.py、processes.py、pins.json，AST／JS语法通过。固定Q01/Q02/Q10/Q12先各first、再各5次重复，共24条；原raw SHA、fatal保BOM decode、两Buffer roundtrip、find／hits／semantic全部保留，只新增fetch/hash/decode-roundtrip/find及结果构造／序列化分账与原进程RSS。逐doc多次读时钟有观测扰动，短片仅定位大头，不与原无仪表queryNs作加速对照；任何后续优化须原无仪表矩阵重新测，当前不优化、不GC、不换iterate。

执行前拟将原10000 SQLite三个固定普通文件按size/SHA复制至新run/index-copy（wx流式、非重建），不通过SQLite打开原索引；原DB196571136 bytes、WAL0、SHM32768，指纹固定在pins.json（SHA68bc3d22…f57de4）。原来源复制前后及查询后必须不变。仅副本按原readonly/create:false配置打开，不immutable、checkpoint或切journal；副本DB必须原SHA、WAL无新记录，SHM／空控制文件变化独立记录，不能把共享内存读标记变化直接称正文改写。所有source／输入pins与副本普通文件前后核，完整读完24条且语义核同才complete。子进程60秒精确组、首红停；wrapper保innerFailure和outerError两账，不再覆盖原失败类别。当前未实际复制索引、未查询，待全文源审后主线另批执行。

### 剖面实际收据与下一单因素对照（仅方案）

主线实际`/tmp/agentic-f064a-profile.e7G48i/run-1792334587693193000` complete，子exit0／2.711秒、failure=null、无残组、stderr0，固定24query完整语义均通过；copyControlChanges={}，原索引及副本三文件前后SHA保持。公开maxRSS820150272 bytes。作者只读核receipt／profile.json及24原始行，没有重跑。下表是各slot五次重复的中位毫秒，仅本有仪表剖面：

| query | fetch | SHA | decode＋roundtrip | find／结果构造 |
|---|---:|---:|---:|---:|
| Q01 | 86.602 | 21.796 | 48.224 | 0.730 |
| Q02 | 88.829 | 22.164 | 46.087 | 0.720 |
| Q10空候选 | 0.529 | 0 | 0 | 0 |
| Q12全扫描 | 15.578 | 22.332 | 48.132 | 1.249 |

有限观察为高召回index路径fetch占较大部分，raw完整校验亦有可见成本；这不能从时间直接断言GC、泄漏、SQLite必然低效或ORDER BY为根因，更不是原120秒矩阵变绿。短运行RSS低于原长批不能冒内存问题已解决，逐doc时钟扰动保持。

已查本地公开`node_modules/.bun/bun-types@1.3.14/node_modules/bun-types/sqlite.d.ts:666`，`iterate(...params): IterableIterator<ReturnType>`及879的finalize公开；本地声明不是包内1.4实际行为证据。[Bun官方SQLite文档](https://bun.sh/docs/runtime/sqlite#iterate-iterator)说明iterate逐行返回，Statement单cursor且同SQL的db.query会复用statement；因此不在迭代体中重入同statement，不用私有native对象。当前只查接口，未调用iterate。

下一候选仅将原候选SQL的结果消费从all整数组换为iterate逐行；两个SQL文本、ORDER BY、MATCH参数、schema、readonly配置、每行raw bytes/SHA／decode／roundtrip／find、稳定ID顺序、全部hits／semantic与首次＋5重复完全不变，不增加GC或缓存、不改查询规划。预冻结预测：若JS侧all全BLOB驻留是重要成本，iterate应在相同候选／语义下减小进程RSS或fetch消费成本；若两者近似，不能宣称此假设成立。它不保证SQLite内部不会为排序等物化，也不保证单个row对象立刻被GC回收。

拟新隔离目录一次paired all→iterate，两子各独立相同SHA索引副本、同Q01/Q02/Q10/Q12各24条、各60秒首红停，保源／输入／索引前后hash及双流；原profile源不改。共同消费循环可将all返回array的iterator与Statement iterator统一逐next计时：fetch累计包含初始all／iterate构造和所有next（含done），后验分段保持同样时钟次数；不能只测iterate创建而把实际sqlite_step费用藏到别账。完整消费到done再下一query，异常关闭当前iterator／connection且保原异常；不声称公开iterator退出等于事务或计算取消。候选ID／hash／bytes／hits／canonical摘要逐项同原参考和两臂，性能只是有限单对观测，不取代原无仪表三配对矩阵。ORDER BY或BLOB排序只列后继候选，本轮绝不同时改SQL。当前只方案，未写对照源／复制或执行。

随后剖面实际证据两轴核验通过，主线认可该24条有限成本观察，非原完整批修复。主线批准仅单因素对照源准备，新目录`/tmp/agentic-f064a-iterate.aHgt7N`四文件profile.mjs/run.py/processes.py/pins.json；原profile目录不改。两臂共享相同SQL与ORDER BY、逐next（含done）fetch时钟及完整校验，只选择array iterator或公开Statement iterator；异常调用iterator.return，db统一finally关闭，cleanup错误单列而不盖原业务异常。runner顺序all→iterate各独立wx副本／60秒，逐24条完整semantic与摘要相同才complete，pins/processes逐bytes复用。仅AST／JS语法通过，未复制、执行或修改原矩阵；待主线及两轴全文审。

### all／iterate实际单对照与排序定位候选

主线运行`/tmp/agentic-f064a-iterate.aHgt7N/run-1792334842259086000`两臂各24条complete；作者实际读取两子receipt／profile.json核exit0、无残组／stderr、copyControlChanges={}。all为2.745秒／maxRSS813776896 bytes，iterate为2.869秒／622018560 bytes。五重复query中位Q01由161.764→172.770ms，Q02由163.724→169.008ms，Q10由0.583→0.573ms，Q12由90.430→94.265ms。该单对中iterate RSS较低但没有查询提速，不能称原超时修复、确定GC原因或最佳后端结论；固定48条语义通过不替代大档原矩阵。

下一只读计划先记录原SQL公开`EXPLAIN QUERY PLAN`（EQP），不执行payload SELECT：沿相同只读副本、同包内Bun/SQLite、Q01/Q02/Q10的受控MATCH参数及Q12 fallback，前缀`EXPLAIN QUERY PLAN `后用公开db.query(...).all(...params)读取计划行。SQLite[官方EQP说明](https://www.sqlite.org/eqp.html)明确它给出高层访问／索引策略，可能显示临时排序B-tree，格式不是稳定产品API；[EXPLAIN契约](https://www.sqlite.org/lang_explain.html)返回原语句将如何工作的描述，不是原payload结果。保全部原始plan行/SQL/params与版本，不凭字符串出现就断言实际磁盘spill、BLOB复制次数或性能根因；不把EQP当数据读取正确性测试。不执行ANALYZE、建索引、改变cache/journal或数据。

若计划显示排序是可检验候选，再另批一个排序单因素对照：保持iterate及所有raw校验／24query／60秒副本协议；两臂均在消费后只对轻量候选`[ID,SHA]`与hits按ASCII ID显式排序、拒重复，计入query及单列sortNs，不保留raw作排序元素。对照臂保原SQL ORDER BY，候选臂仅删除末尾ORDER BY，其余SQL／MATCH／schema／取值不变。两臂都做相同最终轻量排序，唯一自变量才是SQL排序；最终候选／bytes／hits／摘要须与原冻结oracle及两臂完整相同。预测仅为“若SQL排序物化是显著成本，移至轻量结果排序后fetch／RSS可下降”；未见差异则不支持，不能同时改GC／cache／迭代方式来挑绿。EQP与必要排序对照仍仅方案，未写源／执行，不重跑完整失败矩阵或放宽截止。

主线随后批准源准备，新目录`/tmp/agentic-f064a-order.DwUfIx`四源profile.mjs/run.py/processes.py/pins.json，准备时仅AST／JS语法通过。runner强制显式`plan`或`sort`，无默认动作；plan只发固定四EQP，不调用verifyLive或payload查询，不根据计划字符串自动启动sort。后继sort保持iterate、双方同轻量排序和sortNs／重复拒绝，只删除固定SQL末尾精确ORDER BY后缀并断unordered不含ORDER、ordered保持原尾；每slot首次记录实际SQL／params，runner核两臂精确SQL与固定参数。初草稿正则反斜杠歧义在未执行源审时已改为精确后缀slice，避免两臂实际同SQL；不是运行失败或oracle调整。pins及精确组进程助手同原bytes，原诊断目录不改。

主线实际plan为`/tmp/agentic-f064a-order.DwUfIx/run-1792335172219319000`，作者读取父／子receipt及profile.json：complete、exit0、0.152秒、无残组／stderr，四源前后SHA与原／副本三个文件前后SHA均同、copyControlChanges={}。Q01／Q02／Q10计划均为FTS扫描后按rowid取原文，并出现`USE TEMP B-TREE FOR ORDER BY`；Q12为`SCAN originals USING INDEX sqlite_autoindex_originals_1`。这只使SQL排序成为有实际计划依据的可检验候选，不证明磁盘spill、BLOB复制或原超时根因。主线据此另行批准原冻结sort分支并启动session65691；本条尚不记录排序结果，不改source／oracle／60秒边界，也不重跑原失败矩阵。

### SQL排序单因素实收据与下一有限候选（仅方案）

主线sort实际目录`/tmp/agentic-f064a-order.DwUfIx/run-1792335186669837000`；作者读取父／两子receipt及profile.json，两臂各24query complete、exit0／无残组，四源／原索引／各副本前后SHA均同、copyControlChanges={}。实际queryInputs保两臂SQL与参数，runner核唯一SQL差异为末尾ORDER BY；全候选ID／raw SHA／bytes／hits与固定oracle及两臂一致。

|本次有仪表短片|ordered|unordered|
|---|---:|---:|
|进程墙钟|2.839s|1.978s|
|maxRSS bytes（含Bun）|633667584|423886848|
|Q01五重复query中位|170.148ms|101.293ms|
|Q02五重复query中位|169.216ms|99.303ms|

Q01／Q02 fetch约94／96ms降至22／21ms，轻量sort约0.8ms。该同SQL排序因素短片支持“移除SQL原文行排序在此样本降低成本”，不证明磁盘spill／GC机制，不等于原120秒矩阵已修复，也不据此宣布SQLite或Tantivy胜出。仪表逐doc计时有扰动；原200次完整批失败与未运行万篇Tantivy仍保留。

下一无分段仪表适配候选只将SQLite读取改为公开iterate、SQL去末尾ORDER BY、完整消费后按ID排序轻量候选／hits并拒重复；保原SHA、BLOB类型／字节长度、fatal且ignoreBOM的decode、roundtrip、精确首span、全结果序列化与摘要，query总计时包含全部操作。不删raw校验，不缓存查询或改变gram／短词／>128 fallback，不改Tantivy。构建、事务、更新删除、reader可见性及取消协议不变。必须以原冻结L全部50例、CRUD全部14阶段、真实36的12query全候选／raw／首span、各scale baseline及六增量的原身份／marker oracle逐项核验；原性能数值不能继承给新适配，语义通过也不冒完整性能矩阵通过。只用轻量结果排序不依赖SQL天然顺序，BOM／非BMP／重复gram假阳性等原反例继续保留。

工作量边界：若每个query约100ms，12×200仅计时查询即约240秒，尚未计预热／build／序列化；实际各slot不同，不能把该外推当实测总时长，但足以说明原120秒是本实验整轮止损而非产品延迟SLO，不能要求靠此次局部变化必然完成原采样量。原200次协议不改名、不补判绿。

建议另立明确不同的有限万篇比较合同：同已冻结10000 corpus／12query／原oracle，新适配SQLite对原Tantivy，三配对AB／BA／AB，各新索引构建与独立重开query；先全12正确性，再每slot10预热＋20计时，双方同样减采样。各引擎整轮仍120秒、整批900秒、首红停，不以超时自动再减次数或延长；保每条原始时长、全语义校验、序列化、RSS时间序列及关闭后磁盘费用。20样本只作有限分布观察，不把其p99当可靠尾部估计，不与旧200样本拼接。目的为取得同档双方有限证据，不替代原万篇完整200矩阵，亦不自动覆盖万篇增量／取消未运行责任。新候选先完成上述固定正确性核验，再运行该独立有限比较；是否实施／运行由主线及两轴另审，本节未新增源码或执行。

#### 最小执行编排与归档收尾（源准备待批准）

正确性与成本是两个显式模式／独立收据；先跑下表正确性，全部通过后才可另获准运行上方有限万篇成本。正确性模式没有预热／计时重复，不将其运行耗时混入成本分位。复用各套已审schema、fixture reader、冻结manifest与oracle；SQLite只移植上述候选消费方式，不整份复用scale入口导致大小规则串用。Tantivy公开实现不变，同样执行对照；同锁新target编译单列600秒，源／binary／锁链核实后才运行。

|顺序／独立正确性批|固定输入与必核|止损边界|
|---|---|---|
|L|原A/B/C与纯准入，完整50例；两边真正存储原文、候选及UTF16首span，原非法输入零派发|15秒/例、180秒/批|
|持久CRUD|原P1–P7双引擎14阶段；同ID更新、删除与新ID、只读重开、活集合和真实stored bytes不变|15秒/阶段、180秒/批|
|真实36|原36篇SHA与12query、独立参考，双方新建并重开后每query只执行一次完整核验|120秒/引擎（含build及重开）、总300秒|
|scale正确性|依次100／1000／10000，每档双方各独立baseline→六增量→真实cancel；每阶段原12query及变化marker各一次、完整live IDs／stored raw／批提交可见核不删|每引擎每档120秒、每档总900秒；三档依次首红停|

scale正确性保原每32普通文档／单个1MiB文档的背压与末批query后收尾顺序；六阶段在同一新baseline上按原顺序推进，不能复用上次性能运行后已变更索引。cancel复用原真实READY／批1完成latch→宿主CANCEL→CANCELLED最后完成／发布序号→正常退出，保发送／ACK／exit时间；仍只证明批间协作停止，不冒同步SQL中断。正确性先独立完成，故后续成本达到120秒不再遮蔽这些已测增量与取消证据；若正确性自身首红，照实停止、不删阶段或改时限。

配额分别绑定原输入profile：L保原16文档／64KiB与原gram预算、4096 UTF16查询纯准入；真实36用固定总352051 bytes／单篇25352 bytes及其先验76056 token、全送入队列512MiB逻辑模型；scale才使用原4096 bytes／两个1MiB文档、1374 distinct gram模板证明与分档预留。CRUD沿原小fixture限制。禁止把scale恰定字节要求套到L／真实36，亦禁止用L旧4096 gram限额截真实文档；全部原SHA／oracle原样引用，不重新生成expected来迎合新实现。元数据／结果容量与完整校验依各原profile，预算是逻辑模型而非RSS硬封顶。精确进程组清理、双流、innerFailure与outerError分账、成功前后源及输入hash核保持；没有未授权生产／新包操作。

收尾限于四步：①完成这一个候选正确性批与另批有限万篇比较，保原200次失败和所有未测项；②汇总同档双方语义／有限成本／增量／取消与局限，交主线判定是否足够作有限选型依据，不自动追跑优化；③按前述已盘点白名单归档最小源／锁／小fixtures／五许可，manifest、大oracle、原始timing与失败receipt无损压缩，记录相对安全member及解压后逐文件SHA，排除工具链、缓存、binary、索引与大语料；④经独立复核后验证归档解压指纹及参数化命令可定位固定输入，迁移版源与历史源链分别记录。实际搬迁与必要迁移复跑另由主线授权，不凭/tmp收据宣布长期可复跑交付；正式服务授权／dirty模型、产品集成与完整父义务明确留后续，不在本批无限扩实验。

主线批准上述源准备后，新隔离目录`/tmp/agentic-f064a-candidate.TURSqj`已准备literal／crud／real／scale四套与根README命令；仅6份JS语法及3份Python AST检查通过，未编译／建索引／执行查询。原manifest、fixture、Cargo锁及各套未改文件逐bytes对照，四套分别47／9／7／3文件相同；scale仅引用原生成收据和语料，不复制或重生成。literal／crud各改sqlite.mjs与run.mjs（候选消费、轻量排序及source→compile→binary链）；real改sqlite.mjs、run.py及Rust调度（移除warm/timed，索引查询算法不变）；scale改sqlite.mjs、run.py及Rust显式correctness／finite20调度，并复用已审order目录processes.py保inner／outer错误分账。真实36及scale的Rust调度源码确有变化，不称整份Rust字节不变。具体源SHA与diff交主线／两轴审，仍须另批执行；有限成本入口与正确性入口分离，不自动追加成本实验。

#### 候选运行期间的归档稳定集合再盘点（未搬迁）

主线已启动串行四套正确性session18967，作者未重复执行。以下仅只读盘点稳定物料，candidate目录所有`run-*`均排除（不采集半写文件或称其complete），其余历史首红／部分完成／成功收据均保留。按明确20个阶段根重新枚举后的候选集合为**2149普通文件／355379951 bytes**，不是压缩大小；它替代上方1704项历史快照的集合口径，不能将两次数量机械相加或重复计入原scale编译收据。

所有根均为`/tmp/agentic-f064a-`加下表后缀：

|阶段根后缀|文件数|bytes|
|---|---:|---:|
|toolchain.XOLigk|60|963424|
|rust190.zxE80R|56|1030060|
|native.hHjGn7|349|739517|
|literal.TNa1mW|120|329220|
|literal-blob.pf89ql|360|1378386|
|bom-repro.eaiqPG|47|35607|
|crud.qyfN9u|33|92319|
|crud-rw.h2jpT5|104|237248|
|corpus-meta.meLM1N|25|748087|
|meta-tests.wQQUwy|31|14289|
|meta-review.Miju03|11|737732|
|corpus-extract.kTIP71|25|855243|
|reference.BDHlVX|238|218142|
|corpus-cost.hrCQVN|91|39444385|
|scale.1Kfm4c|135|172443459|
|scale-typed.Xx6GxU|347|89526203|
|profile.e7G48i|8|9255084|
|iterate.aHgt7N|13|18486862|
|order.DwUfIx|18|18509511|
|candidate.TURSqj（仅静态物料）|78|335173|

分类计数为source132／1073277 bytes、manifest/reference135／171778109、原始receipt/双流等1707／180638885、小fixture167／18076、官方工具链manifest3／1824627、许可5／46977。分类仅包装标签，不改变内容；小fixture包括原安全tar负例字节，不自动展开。原scale编译红与typed成功、fullscale失败父收据及109已成phase／部分万篇stdout、profile24／iterate48／EQP4／sort48的原源、实际SQL与完整原始测量均纳入。原索引／副本只纳hash收据，不纳DB内容。

枚举排除target、cargo-home、prefix、unpack、__pycache__、raw、index／index-copy／`*-index`目录，db／wal／shm／sqlite及官方压缩包、36篇dNN.raw正文；只保l1–l5.raw许可。源扩展mjs／py／rs及v1、Cargo文件、README；冻结json／jsonl／tsv、stdout／stderr／list／sha256及原小fixture均列入，未知类型不自动收进。实际遇到旧CRUD三个index.sqlite明确排除，不借后缀漏选。此为无去重物理文件计数，之后若按内容去重，须保每个原路径映射与不同测量，不能把相同语义的不同timing合并掉。

归档脚本建议仍最小两步：先根据此稳定根及最终候选终态收据生成显式逐文件inventory（安全相对member、用途、原size/SHA、所属包），重新报精确总量待主线确认；再只按inventory制作阶段tar.gz，并以逐成员与累计解压字节硬限流式读到EOF、恰一次匹配且SHA相等才complete。压缩比不代替解压上限，不修改历史receipt中的路径或旧innerFailure缺证。迁移版参数化源另存diff／新SHA。当前未写归档脚本、未压缩／搬迁；运行中candidate收据将在终态后另补，失败亦原样保留，不按绿结果筛选。

#### 新适配正确性实际收据与归档源准备

根`/tmp/agentic-f064a-candidate.TURSqj`下主线串行实际结果如下；作者读取父／子receipt核验，未重复运行：

|套件|compile run后缀|正确性run后缀|实际有限结果|
|---|---|---|---|
|literal|1792336068913|1792336105456|原50引擎例＋纯准入通过|
|crud|1792336112944|1792336147372|原14阶段通过，保只读无fixture重开|
|real|1792336150248370000|1792336186254059000|4phase：双方build＋独立重开，各12query完整校验|
|scale|1792336187892538000|1792336224092809000|三档双方54phase，baseline／六增量／六次真实cancel通过|

八父收据均complete；literal50与CRUD14子status0、无超时／残组，real4与scale54子exit0／failure=null／无残组。六cancel实际发送与ACK均有时间记录、正常exit0，仅证原批间latch协作停止，不冒同步单query可中断。主线收到两轴最终0必要正确性阻断后批准finite20并启动session62945；本条不预写成本结果。独立Spec观察宿主`all(hit[0] in ids)`校验存在O(n²)工作，此次未修改，原截止包含该宿主费用；不得据此反推原红唯一根因或偷偷删校验。

获准只准备归档源后，新目录`/tmp/agentic-f064a-archive.ez7rFK`包含freeze.py、archive.py及冻结inventory.json。两Python AST通过；仅执行freeze的只读逐文件size/SHA盘点并写新manifest，未运行pack／压缩／搬迁。显式新增上述8个终态run，不包含任何finite20新run；当前候选归档集合为**2546文件／552882653 bytes**，比前稳定快照增加397／197502702 bytes。candidate阶段合计475／197837875，其余19阶段数量bytes不变。inventory SHA256为`bffabe98fc5403c1d653f41b36d4ac609903717c4abb5c13a4b2513464741f58`，每项含原绝对path、stage、安全相对member、类别、bytes及SHA，旧物料不改。

archive.py需显式pack及固定inventory SHA才执行，按20stage写全新临时tar.gz，非直接写research；原文件前后hash、USTAR普通成员、完整gzip EOF、逐member恰一次／size／SHA、按原size推导的解压总量上限、尾部零填充均核后才complete。600秒仅循环协作截止，不声称阻塞文件系统调用的硬上限。此源尚待主线及两轴审；没有归档成功事实或参数化迁移复跑事实，finite20终态将后续追加inventory版本而不改这份冻结记录。

#### 最小迁移复跑入口设计（仅方案，不迁仓／执行）

最终归档仅新增`research/f064a/README.md`、`inventory.json`、`evidence/*.tar.gz`、`replay.py`、`paths.example.json`及`migration.patch`／`migration-sources.json`。历史source／fixture／manifest／receipt均在阶段包中保持原bytes；最新可运行副本由replay在用户指定的全新工作目录生成，不覆盖历史，也不为全部旧失败脚本重新开发一套运行平台。README固定列旧红、有限结果、环境依赖、许可、各明确命令与未测责任。

路径映射只处理真实接点：①Rust1.90 prefix／CARGO_HOME及新target；②精确包内Bun可执行路径与原固定SHA；③原36提取输出目录、官方包目录；④旧reference结果及scale生成receipt里corpus绝对路径；⑤当前源／输出根。以历史绝对前缀的完整路径组件匹配映射到新工作目录，不做任意文本替换、符号链接到旧/tmp或覆盖用户目录。原manifest／allowlist／生成receipt保持原SHA，**只在路径被用于open时解析映射**；例如real的manifest.corpusDirectory、extract的archiveDirectory、scale receipt.corpus字段，不重写JSON导致放宽pin。migration.patch逐文件列新增参数读取／路径解析及预期替换次数，未匹配／多匹配就拒绝；派生副本记新sourceSHA并重建compile→binary链，不继承历史compile收据。

拟复跑命令仅五类（实现后才可运行，以下为入口合同）：

```sh
python3 research/f064a/replay.py verify --inventory research/f064a/inventory.json
python3 research/f064a/replay.py materialize --work /absolute/new-empty-directory --paths /absolute/paths.json
python3 research/f064a/replay.py inputs --work /absolute/new-empty-directory --download-official
python3 research/f064a/replay.py preflight --work /absolute/new-empty-directory
python3 research/f064a/replay.py run --work /absolute/new-empty-directory --suite literal --mode compile
```

verify仅核容器与全member SHA／完整EOF；materialize只恢复白名单源、小fixture、五许可、冻结oracle到新目录并施加已审窄路径补丁。inputs显式联网选项才按固定官方Rust组件URL／SHA及三repo commit／归档SHA下载，保原网络／安全tar界限，失败不换版本／镜像；已有校验通过文件可复用，不自动修改全局工具链或下载应用binary。Bun必须用户显式提供原固定SHA可执行文件，缺失就停止并说明，不静默替代系统Bun。真实36仅提取原41白名单并核原bytes/SHA，图片与嵌入资源不下载；scale仅由原已审模型逐份重建raw，逐项核冻结生成manifest中的bytes/SHA，不重新推导expected或改变oracle。L／CRUD的小fixture直接从归档恢复。

preflight不建索引、不跑查询：核路径映射闭合、全部文件pins／配额、官方依赖／工具链身份、原L／CRUD／real／scale特殊输入，缺件明确报告。run只转发四套README已审命令，suite限定literal／crud／real／scale、mode限定compile／correctness（L／CRUD映射diagnose）／finite20；finite20只允许scale且先有相同迁移source链的全部正确性收据。不提供自动优化、无限retry、自动降低样本或重写历史结果。具体compile／正确性／成本时限仍沿各套原合同；新运行结果在新目录与历史证据分开。

收尾不再增加引擎实验类别：finite20终态后补新inventory版本（显式run接受complete或failed，拒运行中），归档核验、迁移差异静态审与无引擎preflight完成即可汇总既有证据交主线裁决。若未实际执行迁移版完整矩阵，明确“入口及输入已核，迁移版完整引擎复跑未执行”，不能冒旧/tmp成功为迁移版运行；需要将来复跑时按上述明确入口另行启动，不把这项诚实边界变成无限调优阶段。以上为执行前设计历史；实际源准备与成本终态见下。

#### 有限万篇成本终态与选型建议草稿

主线实际运行`/tmp/agentic-f064a-candidate.TURSqj/scale/run-1792336563627890000`，session62945 exit0、父收据complete；作者读取父收据及原子收据，12phase完成。独立Spec核2304响应／72统计组及语义，Standards核原始证据，均0必要有限证据阻断，主线批准本批有限通过。三对AB／BA／AB、每query10预热＋20计时不变，原200次批红仍独立保留。下表为主线由三轮原收据汇总的范围，不拼接独立测量：

|口径|SQLite新适配|Tantivy|
|---|---:|---:|
|初建host墙钟／可见时间(s)|24.04–24.39／22.75–23.08|42.46–42.61／41.28–41.42|
|Q01进程内query中位(ms)|95.25–96.69|86.80–87.14|
|Q12长query全候选中位(ms)|93.51–95.35|108.07–109.08|
|关闭后索引总bytes|196603904|1995673–1996861|
|query进程公开maxRSS(bytes)|464027648–491536384|44138496–48513024|
|build进程公开maxRSS(bytes)|911704064–921698304|71057408–72122368|

RSS含各自运行时／适配，不冒纯引擎内存；重复模板的高压缩率不能外推真实语料约100倍优势。20计时样本按nearest-rank所得p99等于max，不能据此声称稳定尾延迟；进程内query非产品RPC端到端。原200次工作量与120秒实验止损失败未修复／未重跑通过，截止不是产品SLO。本批正确性、真实增量与批间cancel另有独立收据，未被成本裁减或用“未发任务”代替取消。

**有限研究结论：Tantivy作为下一持久索引集成候选。** 在同substring／完整原文校验语义下，真实36与本次万篇证据显示其磁盘／含运行时RSS及短中文、高召回查询优势，符合本项性能优先取向。SQLite在当前适配的初建和长query fallback仍更好；Tantivy引入Rust工具链、桥接及应用打包的工程成本尚未实际集成验证。主线批准有限研究受托代验通过，不是全面胜出、正式产品已集成或最终关键词语义决定。生产授权／dirty覆盖／完整服务取消、OBL-006／018／026／035及最终离线责任仍开放；本轮不继续无限调优。

#### 最终归档清单与迁移入口源准备

新目录`/tmp/agentic-f064a-archive-final.9dRPVA`保留旧归档源／inventory不动，仅freeze新增显式finite20终态run，并允许显式候选run的complete或failed终态，仍拒无收据／运行中。最终**2584文件／685256038 bytes**，inventory SHA256=`56be4d15461e714f738efec7ef13699c1019024ef414c019a39f6154959a7c7c`；较旧清单增加38文件／132373385 bytes，均本次finite20。candidate阶段513／330211260，其余19阶段不变。Standards独立逐文件size／SHA核同、0必要pack阻断；本条仅冻结事实，尚无pack或迁仓成功事实。

迁移源已准备于`/tmp/agentic-f064a-replay.oDXdG5`：replay.py、paths.example.json、README.md，仅AST／JSON语法检查，未materialize／inputs／preflight／编译或查询。实际入口收敛为四命令`materialize|inputs|preflight|run`，均显式传`--paths --inventory --inventory-sha`；materialize内部完整核归档，不另造verify模式。**inputs仅离线**：调用者先另行取得固定官方三包及原Rust／Bun／Cargo缓存，入口不自动联网；这替代上方设计示例中的`--download-official`，不新增下载授权。工具链及外部cache只读，cache复制到新work后离线编译，缺依赖明确失败。

派生仅当前四套candidate；历史文件保持原bytes。已知JSON／TSV路径消费、argv／cwd／编译环境及cache映射到全新work，未知旧/tmp执行路径拒绝。新源逐文件old/new SHA与migration.patch独立记录，历史README命令仅作证据，实际使用迁移入口README。36篇重新从固定官方包按原41项bytes／SHA取得；合成raw调用原模型后核冻结SHA，不重新生成oracle。无引擎preflight尚待源审后授权，不称长期可复跑交付已经完成。

主线随后实际pack成功于`/var/folders/jy/rh9p8thj3t32m4pwhk38jydc0000gn/T/agentic-f064a-archives.2oxctkpr`，作者读取receipt核complete、20包／2584成员，gzip合计210133629 bytes；candidate单包146045656 bytes不适合直接入仓。原gzip包不改／不删。获准新封装源`/tmp/agentic-f064a-archive-xz.gQsm4o/archive.py`仅改标准库LZMAFile FORMAT_XZ preset6与tar.xz后缀，保同inventory／逐成员SHA／完整EOF／零尾／展开界限，并单列压缩CPU、墙钟及maxRSS，非产品指标。source SHA=`203dc21396790e465d184eecd9514e384500b2e9007c1cdf9aab610a2c39043b`；AST通过、尚未执行XZ压缩。

迁移XZ副本`/tmp/agentic-f064a-replay-xz.pE1MRy`保原入口不改，仅对应包后缀／LZMAFile及说明；replay.py SHA=`cb8facbe8d3b5581f5fc99d7ebbc364645f4977c32758bebf6fc795581358eb2`，AST／JSON通过，尚未运行。仅用于固定自产且SHA核同的包，LZMAFile没有memlimit；展开bytes界限不冒decoder RSS硬限。不裁timing／失败／样本以缩小归档，不改原oracle；实际官方语料tar.gz格式与许可保持。

主线实际XZ pack随后通过：`/private/var/folders/jy/rh9p8thj3t32m4pwhk38jydc0000gn/T/agentic-f064a-archives.gwbnq2h9/receipt.json`为complete；作者读取核20包／2584成员、总9061444 bytes。封装墙钟91.840251833秒、CPU91.460118秒、公开maxRSS126533632 bytes，均为本机封装费用而非搜索产品指标。原gzip包与历史输入保留；压缩减小存储不减成员或原始timing。迁移无引擎三步由主线在新`/private/tmp/agentic-f064a-replay-check.rxgBGU/work`另行验证，作者未重复运行，本条不预写其结果。

拟一次入仓清单（尚未复制）：`research/f064a/evidence/`存上述receipt恰列的20个`stage.tar.xz`，覆盖toolchain／rust190／native／literal原红与BLOB／BOM诊断／CRUD原红与rw／corpus元数据及测试复核／extract／reference／real成本／scale原与typed／profile／iterate／order／candidate；另原样放`evidence/receipt.json`和根`inventory.json`。`archive/archive.py`、`archive/freeze.py`保XZ封装源码（其运行要求inventory在同目录，README明确以根inventory显式复制到新临时封装源目录，不覆盖仓库）；根`replay.py`、`paths.example.json`及`README.md`提供已审迁移入口、固定命令、有限结论与未测边界。README明确五许可／COPYRIGHT在corpus-extract阶段包的原l1–l5.raw及对应来源映射，第三方正文不改用项目许可证；不另提交36正文、工具链／cache／target／索引DB。迁移实际receipt、派生diff／source SHA清单在无引擎验证终态后另列精确文件，未完成不先收入。最终复制前按此清单再核SHA，历史包内容与收据不改。
