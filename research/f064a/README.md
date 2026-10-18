# F-064a 全文索引有限选型研究

这是有限研究受托Agent代验物料，非用户亲验，不是应用全文搜索实现。建议将 **Tantivy 0.27.0 作为下一持久索引集成候选**；本有限研究已由主线受托代验通过，不表示全面胜出、已集成或改变产品关键词语义。

## 范围与有限结论

两后端共用Unicode scalar 1/2/3-gram候选、精确大小写敏感原文后验证及UTF16首命中范围。长query超过128 distinct gram走完整候选后验证，不截断。SQLite原文存BLOB，完整bytes与BOM保留；候选消费用iterate、SQL去payload排序、最后只排序轻量ID/hash/hits。语义、固定输入和所有失败均留档。

|已实际完成的临时源验证|范围|
|---|---|
|L与持久CRUD|50固定引擎例＋纯准入；14持久阶段，包含只读无源正文重开|
|真实语料|固定官方36篇、352051原文bytes，12查询；中文短词、大小写、换行及长查询；emoji/组合字符在真实样本无正命中，以L补语义证据|
|合成正确性|100/1000/10000三档、双方共54phase；baseline、六增量、六次真实批间取消|
|有限万篇成本|三对AB/BA/AB，12phase、2304响应；每query10预热＋20计时，72统计组|

有限万篇三轮：SQLite初建host24.04–24.39秒，Tantivy42.46–42.61秒；Q01中位分别95.25–96.69ms和86.80–87.14ms，长fallback Q12分别93.51–95.35ms和108.07–109.08ms。关闭后索引分别196603904和1995673–1996861 bytes；query maxRSS分别464027648–491536384和44138496–48513024 bytes。真实36与该同义合成批支持Tantivy的空间/RSS和部分查询优势；SQLite初建和长fallback仍更好。重复模板压缩优势不外推真实语料，RSS包含各自运行时；20样本nearest-rank p99等于max，非稳定尾延迟估计或产品SLO。

Rust桥接、应用打包与生产服务尚未实施。dirty/授权/外部变化、产品RPC端到端与同步查询取消等不由CLI模型证明；正式服务和OBL-006/018/026/035继续承接。此次停止继续调优，不增加新实验类别。

## 原失败必须保留

- Rust1.88对同锁依赖MSRV失败；另隔离1.90后编译，未改锁迎合。
- Bun SQLite TEXT参数路径丢BOM，固定原raw/span红保留；独立边界对照后只改BLOB原文路线。
- CRUD构造选项缺readwrite及scale两处Rust方法解析编译红均保原目录/收据，窄修新目录。
- 原200次完整scale批：100/1000完成；万篇首SQLite query在整轮120秒止损退出-15，Tantivy该档未执行。旧wrapper覆盖inner failure字段的缺证保留，不伪补原receipt。有限20通过不等于原200通过或“修复超时”。
- profile/all→iterate/EQP/排序短片是定位或单因素证据，不代替原矩阵，也不推断GC或磁盘spill根因。

## 归档结构与完整性

`inventory.json`固定SHA256：`56be4d15461e714f738efec7ef13699c1019024ef414c019a39f6154959a7c7c`。
`evidence/receipt.json`列20个`.tar.xz`包SHA，完整展开2584普通成员、685256038 bytes；压缩合计9061444 bytes。原源、oracle、原始timing/双流、失败及source/binary链原bytes保留；没有工具链、cache、target、索引DB或36正文。原包内绝对路径是历史证据，不直接执行其旧README命令。

`archive/archive.py`与`archive/freeze.py`是历史封装源。重新封装需在另新临时目录放两源及根inventory，并提供其中明确原物料路径；不在仓库原地运行freeze或覆盖清单。迁移入口不要求重新封装。XZ仅固定自产SHA包；完整EOF、成员/累计展开界限不等于decoder RSS硬限。

## 离线重建及精确复跑命令

先复制`paths.example.json`到外部新配置，填写规范绝对路径（macOS用`/private/tmp`而非符号链接`/tmp`）：work必须不存在；archives指本目录`evidence`；提供原arm64 macOS Rust1.90 prefix父目录、固定Bun、Node/Python实际文件、官方三tar.gz及完整原Cargo registry cache。入口拒绝symlink链、未知历史执行路径及覆盖；只写新work，外部工具/cache只读，cache复制后离线编译。所有工具获取为另行显式动作，本入口不联网。

官方语料固定来源（包大小/SHA在归档allowlist.json，不接受重新冻结）：

|本地文件名|官方固定URL|
|---|---|
|docs-zh-cn.tar.gz|https://codeload.github.com/vuejs-translations/docs-zh-cn/tar.gz/354712584b6be1e8532f2ff8559cd01d26ce3c14|
|docs.tar.gz|https://codeload.github.com/vuejs/docs/tar.gz/40aa88af0094f7bab4aaf786e55c748a6a251d88|
|book.tar.gz|https://codeload.github.com/rust-lang/book/tar.gz/1500248d8f230566e4ec9f27fcbb8fe9e2898ab1|

工具链官方manifest/组件URL/SHA及安装参数在toolchain/rust190包；Bun固定SHA为`539598c775882420b9d8deb7dc14d845f20f7d26f5600c50ab067dde6ac3f3bf`，不自动替代系统Bun。Cargo.lock固定`639d75f7f400a528fb5879936175f31f51ba6a762e5cee8202f80f73dc00f347`。工具或cache缺失即失败，不自动下载/换版。

以下在research/f064a目录执行，`/absolute/paths.json`替换为配置实际路径：

```sh
python3 replay.py materialize --paths /absolute/paths.json --inventory /absolute/research/f064a/inventory.json --inventory-sha 56be4d15461e714f738efec7ef13699c1019024ef414c019a39f6154959a7c7c
python3 replay.py inputs --paths /absolute/paths.json --inventory /absolute/research/f064a/inventory.json --inventory-sha 56be4d15461e714f738efec7ef13699c1019024ef414c019a39f6154959a7c7c
python3 replay.py preflight --paths /absolute/paths.json --inventory /absolute/research/f064a/inventory.json --inventory-sha 56be4d15461e714f738efec7ef13699c1019024ef414c019a39f6154959a7c7c
```

materialize全包核验后派生当前四套源，记录migration.patch及逐文件old/new SHA；inputs完整安全读取三个官方包，只还原原41白名单并核SHA，合成raw按原模型重建后核原SHA，绝不重生成expected。partial目录不能继续或覆盖，请另用新work。

需要真正引擎复跑时，按literal、crud、real、scale顺序各显式执行compile再correctness。下列命令把suite依次替换为这四个字面；mode只替换为compile或correctness：

```sh
python3 replay.py run --paths /absolute/paths.json --inventory /absolute/research/f064a/inventory.json --inventory-sha 56be4d15461e714f738efec7ef13699c1019024ef414c019a39f6154959a7c7c --suite literal --mode compile
python3 replay.py run --paths /absolute/paths.json --inventory /absolute/research/f064a/inventory.json --inventory-sha 56be4d15461e714f738efec7ef13699c1019024ef414c019a39f6154959a7c7c --suite literal --mode correctness
```

另需成本复跑时，显式`--suite scale --mode finite20`，要求四套同派生source链正确性完成。保原各套精确子进程组时限/首红停，不能改样本或期限装作原通过。所有新运行保在新work，与原历史分开。

## 迁移验证和许可边界

主线在全新`/private/tmp/agentic-f064a-replay-check.rxgBGU/work`执行materialize/inputs/preflight，session33685 exit0，输出`preflight:complete, engineExecuted:false`；145行迁移diff仅6源路径/cache调整。迁移版完整引擎未运行，不能以历史临时源绿冒迁移引擎复跑证据；两轴终核0必要阻断，主线已批准一次入仓；Git尚未执行。

五许可原件位于解包后的`history/corpus-extract.kTIP71/run-1792330318024936000/`：l1.raw=Vue中文LICENSE、l2.raw=Vue英文LICENSE（CC BY4.0，图片例外）；l3.raw=Rust book COPYRIGHT、l4.raw=LICENSE-MIT、l5.raw=LICENSE-APACHE（MIT OR Apache-2.0）。相同包的allowlist.json及提取receipt保每篇repo/commit/path/bytes/SHA与归属。inputs也还原五许可到inputs/real。第三方正文不改用本项目许可证，不下载图片或嵌入资源；不能将许可证核对冒新的再授权结论。
