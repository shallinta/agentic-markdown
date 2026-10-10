# F-041a：普通源码文内查找

> 状态：2026-10-11，alpha.112 非离线本片经最终独立 verifier 0 剩余阻断、主线确认受托 Agent 代验通过，非用户亲验。Git 待主线实际执行；父 F-041、完整 OBL-056 与 F-041a-offline-final 开放。下方候选、实施/构建前状态与失败保留为历史。

<!-- obligations: OBL-056 -->
<!-- deferred-obligations: none -->

## 功能与范围

依据能力总账 R-09、E-10 及 2026-08-24 查找决定，先交付普通源码模式的当前文档普通文本查找：⌘F、查询、区分大小写、全词、全文计数、上/下一个、当前项及视口高亮。F-012/F-030 普通源码与文档状态、F-006 命令、现有 Worker 生命周期满足本片前置；不等待 F-068 玻璃材质。局部承接 OBL-056，完整 F-041、编辑/阅读可见正文查找、跨模式内容锚点、替换及父义务保持开放。

不支持正则、替换、跨文档搜索；不接原生新菜单/RPC，不占用 ⌘H，不修改正文、基线、撤销历史或授权。只读普通源码也可查找；安全源码本片不安装新呈现/查找消费者，显示本片仅支持普通源码的原因，不声称降级模式查找已交付。F-028c、专项设计和离线验证不推进。

## 交互与匹配

- 每篇已打开文档独立保存查询、大小写/全词、开闭状态与当前匹配位置；不使用窗口级查询单例，不持久化到磁盘。关闭文档释放该状态。离开普通源码暂停并撤销任务/高亮，保留条件；返回源码重算。编辑/阅读本片不把源码结果冒充可见文本结果。
- 查找栏在正文右上角悬浮、模式按钮左侧，不增加正文高度；中文标签、计数、搜索中/无结果/受限或失败提示、关闭和上/下一个可访问名称。Enter 下一项、Shift+Enter 上一项、Escape 关闭；循环跳转，查询变动后以当前正文位置选最近后继，无后继回首项。输入框候选期间不执行导航、Escape 不抢输入法取消，compositionend 后才提交已确认查询。关闭恢复当前文档焦点，不写正文。
- 固定 `regexp: false`、`literal: true`，反斜杠等按普通文字；空查询不扫描。源码预期采用保守字符语义：大小写选项之外不增加兼容字符等价，例如 ① 不匹配 1、全角 A 不匹配 ASCII A；全词采用公开字符类别边界、不是中文自然语言分词。公开游标默认 NFKD 可能更宽松，PoC 必须先核发布版本 `SearchCursor` 构造 test 钩子能否在接受前筛除伪候选；不能简单返回后过滤，避免 `ａaa` 查 `aa` 时伪候选消费后漏掉真实后缀。若需公开 nextOverlapping，则只按已接受范围去重，并验证复杂度与真实位置；没有小型可靠公开适配就报告，不另造 Unicode 引擎或默认放宽语义。高亮使用实际原文字串范围，不能用查询长度推导结束位置。
- 查询可含换行，粘贴 CRLF/LF 按编辑器逻辑换行统一匹配；源码语法标记、URL、BOM 字符属于搜索文本。不修改原始 rawText。CM 位置以其逻辑文档坐标表达，沿既有原文映射测试 BOM/CRLF，不能将 raw offset 直接当 CM offset。
- 高亮不改变编辑选区；仅显式上/下一个导航定位并选择真实匹配范围，保留原有历史，不把查询输入写进文档。仅当前视口及缓冲区生成装饰，当前匹配单独强调；极密集视口装饰受消息/装饰预算保护并明确提示，不假称全部高亮。

## 依赖与先行 PoC

当前仓库未安装 `@codemirror/search`。2026-10-10 官方 npm registry `https://registry.npmjs.org/@codemirror%2fsearch/latest` 实际返回已发布 **6.7.2**，gitHead `4437667eaa9badaba21f151bfc0db8494de0fb81`；依赖 state `^6.0.0`、view `^6.37.0`、crelt `^1.0.5`，与本项目 state6.7.5/view6.43.12 范围兼容，尚不等于安装去重已验证。采用精确 6.7.2，不把 GitHub main 版本当发布证据。

批准后先在明确临时目录运行小 PoC：读取该版本发布包的公开声明/实现，确认 `SearchQuery.getCursor(EditorState | Text)` 在 Worker 无 DOM 环境可用、全词/NFKD/实际范围行为，并核公开 SearchCursor 的 test 与 nextOverlapping 是否足以实现上述保守语义。只用公开 API，不复制私有 QueryType 或 searchState；这些是待证路线，不是已保证可实现。确认后再加精确直接依赖和 lock，核 CM 单实例去重。默认 search 扩展的面板布局、正则/替换与同步导航不符合本片边界，故不整体启用；复用其公开查询游标，轻量文档 overlay 与 CM 公开 Decorations 消费结果。

PoC 矩阵：中文连续词/中英边界、组合音标与预组字、兼容字符、emoji、大小写、反斜杠、跨行/BOM/CRLF；空/无命中/密集命中与当前 1MiB 文档上限的长行。记录准确输出和限制，不将跑通当作 UI 或性能验收。特别确认一次 cursor.next 在无命中时可能长时间运行，因此不能以每 N 个匹配 yield 冒充可取消主线程扫描。

## 后台最小路线与资源边界

1. 使用专用单个活动 Web Worker 扫描，不把搜索挤进 Markdown 解析协议。Worker 仅接收当前内存文本快照与条件，不接路径、文件句柄、网络或保存能力；是可丢弃派生缓存，不是正文真源。主线程复用现有 rawText 快照，不为每个查询全文 `.toString()`；必要逻辑 Text 构造在 Worker。首次/内容 revision 更新有 structured-clone 成本，查询选项变更在空闲 Worker 复用正文；忙时 terminate 后需要重发同快照，如实记录成本，不承诺每次查询均无全文 clone。
2. 主线程仅保留一个在途和一个最新待发请求；输入组合期间不提交，普通输入短防抖合并。扫描期间被新查询/正文/文档/模式取代，用 Worker terminate 取消不可抢占的同步游标并废弃代次，延后创建一个替代 Worker，不积累 Worker 或旧查询队列。timeout/error 同样销毁并显示可重试失败，不锁正文/保存。期限是运行保护而非性能 SLO，沿 F-005 契约思路建立本片独立 owner，并非调用不存在的通用 task-lifecycle 平台。未完成显示“搜索中”，不显示伪 0；只有扫描完成才发布完整计数。
3. 所有请求/回执绑定 documentId、不可复用的文档 session/owner epoch、正文 revision、查询代次、Worker 实例代次及请求 kind，并严格校验 schema；同 documentId 重建 editor 可能从 revision0 开始，不能只凭 revision 防 ABA。接收和导航执行复核当前 Text 身份与 view 挂载 epoch，不因仅选区事务无谓重算。视口/导航另有各自请求代次，晚结果不修改当前计数、位置、选区或新文档。关闭栏/标签、模式离开、故障降级及 unmount 取消在途并释放派生索引；仅小型文档条件保留到标签关闭。输入/保存并发不推进任何正文基线。
4. 扫描结果索引仅驻 Worker，以紧凑 UTF-16 起止 Uint32 对存储非重叠命中，不把巨大数组传 UI。按当前 MAX_DOCUMENT_BYTES=1MiB 推导最大 UTF-16 长度，最多每代码单元一条非空命中，即索引最多 8MiB；分配/消息校验先检查上界，溢出或异常失败关闭本次搜索并提示，不发布伪完整计数。正文与临时对象另有内存，不能把索引上限称总进程预算。若公开规范化导致此非重叠上界不成立，PoC 后先修订规划，不绕过校验。
5. 初回执只有完整计数和当前项；导航返回一个真实范围，视口按区间索引返回有界范围批次，最多 2048 个装饰范围/回执，超密集提示高亮受限但保留精确计数和导航。这是防消息/DOM 失控的实现保护，不新增文件大小限制或速度门槛。只在可见区和小缓冲生成 CM 装饰，不全量 DOM，不在主线程反复整篇计数。

## 接线与安全

统一 registry 注册打开/关闭/导航命令及严格参数；⌘F 只在当前普通源码上下文启用，不劫持设置/其他输入框。查找栏按钮与局部键盘共用当前 documentId 执行检查；本片不加入命令面板（palette:false），不新增其焦点捕获协议。查询输入框内键盘留其自身语义，候选事件不 preventDefault。复用公开 CM 生命周期，不增加绕过 CM 输入法处理的 capture 或私有字段。

查找不以 canWrite 为准入，readonly 允许；但已关闭/旧 view/非当前文档/安全或其它模式拒绝导航和装饰。内容改变立即将旧结果标为失效、重算期间不把旧索引当新正文。查询开闭、导航不进入正文 undo；正文原有编辑、保存、选区和跨标签历史继续成立。不输出正文/查询/路径日志、不持久化搜索历史、不新增实验台常驻诊断。

## 最小验证与继承约束

自动：固定依赖公开 API PoC，随后纯扫描、协议校验及受控 Worker 生命周期；精确 count/range/全词/大小写/Unicode、换行映射、无命中与密集上限、viewport 有界、next/previous 循环；取消/旧回执/关闭/模式切换/快速改查询和正文；两文档状态隔离、只读允许、安全拒绝、中文输入组合不导航、不改 raw/history。Worker 受控测试不冒充真实 WK 生命周期或自然 IME。

实际 WK：普通源码 ⌘F，中文输入、大小写/全词、标记与 URL、计数导航和当前高亮；两标签条件独立、切模式返回重算、关闭释放；readonly、正文修改后重算与 undo/redo、长行滚动视口；浅深主题、键盘关闭/恢复、退出取消与正常退出。仅使用 Agent 自造 fixture，不保存测试正文；未实测边界如实记录。

- F-002：本地派生计算，不改授权/网络/保存；`F-041a-offline-final` 留最终人工，不断网。
- 中文与外观：中文控件/错误/受限原因，浅深对比及当前系统外观；不以 CSS 测试冒充视觉验收。
- 命令与键盘：统一命令、文档上下文、IME 避让；无新增拖动，替换与其它模式留后片。
- 安全与日志：Worker 独立可销毁，消息/索引有界，旧结果拒绝；无查询正文日志，readonly 不误禁查找、safe 不引入新故障消费者。

## 当前证据

主线已批准隔离 PoC，以下为实际实验，不是生产批准或产品验收。无仓库依赖/生产/版本/构建/UI/Git 修改，完整父能力及 OBL-056 持续开放。

## 隔离公开 API PoC（2026-10-10）

临时目录 `/tmp/agentic-f041a-poc.9mkpls`，实际执行 `bun add --exact @codemirror/search@6.7.2 @codemirror/state@6.7.5`，只在该目录写 package/lock/node_modules。通过 apply_patch 编写 `worker.ts`、`driver.ts`；复跑命令 `cd /tmp/agentic-f041a-poc.9mkpls && bun driver.ts`。最终原始日志 `run-final.log`，首次失败 `first-run.log` 保留。Bun1.3.14/macOS arm64，无项目生产模块接入。

已读发布包 `dist/index.d.ts` 与公开接口实现：6.7.2 的 **SearchQuery 配置本身提供公开 test(match,state,from,to)**，内部先调用该过滤才接受游标结果，并与公开 wholeWord 组合。因此可直接复用 `SearchQuery({regexp:false,literal:true,test})`，test 对原文匹配串进行严格比较，忽略大小写时两侧 `toLowerCase()`；不需要另造全词逻辑、访问私有字段或 nextOverlapping 适配。该行为不承诺完整 Unicode case folding，如 ß→ss 不在本片语义。

实际 21 个矩阵/存活性用例通过，另有默认宽松对照与取消断言：

- `ａaa` 查 `aa`：接受前 test 得 `[1,3]`；无 test 的默认 NFKD 得 `[0,2]`。验证被拒伪候选没有吞掉后缀真实命中。
- ①/1、全角/ASCII、预组/分解重音精确区分；`é e` 查 e 不误取重音分解前缀；emoji 真 UTF-16 范围、大小写、非重叠 `aaaaa` 查 aa、字面反斜杠、空查询/空文档通过。
- wholeWord：Latin/下划线边界及中文连续字串验证，不是分词；首个预期中文范围手工算错为 `[12,14]`，实际 `[11,13]`，修正 fixture 断言后通过，未修改依赖或匹配逻辑来迁就失败。
- `\ufeffA\r\nB` 查含 CRLF 的 A/B 经逻辑换行得到 `[1,4]`；BOM 单独可查。这里只证明公开 state 的逻辑坐标，生产既有 editorText/raw 映射接线尚待测试。
- 1MiB 无命中约36.77ms；密集1,048,576项约57.57ms；256个a后跟b的长查询无命中约994.12ms。每次索引预分配8,388,608 bytes，结果仅回前20项样本与完整计数。是单次本机 Worker 内构造+扫描观察，不包含应用 UI/全部 IPC，不是性能目标或普遍保证；长查询成本确实更高，生产需真实可 terminate 和期限保护。
- 每条回执 `typeof document === 'undefined'`。另启动 Worker 对1MiB及4096a+b查询，收到 started 后20ms调用 terminate，随后50ms未见完成回执；原独立 Worker 后续仍可查询。仅证明 Bun Worker 实验路径，不证明 WK Web Worker 终止、无竞态泄漏或生产 owner fencing。

结论候选：公开接口足以实现保守普通文本和全词，无需新 Unicode 引擎。待独立 verifier 复跑及主线批准生产；WebView Worker 打包/实际生命周期、跨会话 ABA、视口/导航协议及计数 UI 仍未实现或验收。实验脚本为可复跑证据，不直接搬成生产资源管理代码。

## 生产实现检查点（实际窗口验证前）

主线批准生产后新增精确 search6.7.2 与 lock，复用项目 state6.7.5/view6.43.12；Bun 安装自动将 lock 中旧 workspace alpha55 元数据同步到当前 package alpha111，并未递增 package 版本。生产模块包括独立 Worker 查询/索引、严格有界协议、单 Worker owner、controller 所有的文档条件、视口装饰与普通源码悬浮查找栏。Worker 沿既有 `?worker&inline` 打包路线，未新建 native/RPC。

owner 使用不可复用请求 epoch 与闭包挂载身份，接受前复核实时 editorFaultSession、Text 和查询 signature；即使查询 store 已改变但 React effect 尚未运行，旧回执也拒绝。文档关闭/替换/clear/dispose 清条件，关闭后晚写拒绝。普通源码消费者在 MemoryEditor 完成当前 view 同步后才按 session 挂载，编辑/阅读/safe 不安装；只读不阻止查找与选区导航。原始空 compartment 不扫描或生成装饰。

查询空闲重用快照，忙时销毁再发；防抖100ms与15秒故障期限为运行保护，非性能验收目标。全文索引留 Worker；视口有限批次中为当前项保留一个装饰名额。快速下一/上一不丢点击：一个待发导航以完整结果数取模合并净步数，净0合法原位确认；不建立无界操作队列。查询 textarea 保留粘贴换行，输入法未确认内容不提交；键盘候选/229 不导航或关闭。四个命令只走查找栏和局部键盘，不加入命令面板。

中途检查失败保留：首次类型检查发现误用私有 view.destroyed，已移除，改显式挂载 ref/session；测试 readonly fixture reason 初写非法枚举造成加载拒绝，修正为真实 readonly 后通过。导航从单步改为有界净步数后，engine 旧测试仍断言0非法，组合出现红，须更新该已变更契约测试后才冻结；不是已通过全量或实际产品失败。其他 lint 的测试 Promise/类型、hooks 依赖已修。完整源码/包内/实际 WK 仍由主线后续执行，不以受控 tests 声称自然 IME 或真实 Worker 运行通过。

最终源码候选冻结检查：旧 direction0 断言已更新为0合法、多步正反循环及超限拒绝，保留前述红历史。实际执行 `bun test apps/desktop/src/client/source-search-owner.test.ts apps/desktop/src/client/source-search-engine.test.ts apps/desktop/src/client/source-search-view.test.ts apps/desktop/src/client/history-documents.test.ts apps/desktop/src/commands/registry.test.ts`，42项/345断言/5文件/1.95秒通过；随后 typecheck、受影响文件 eslint、文档/义务及 diff 检查通过，lock registry 检查此前通过。等待独立两轴审核及主线全量/打包/WK；未自验通过、未递增版本。

### 冻结后资源审查修正（尚未构建）

独立 Standards 发现动态查找扩展可被 controller 保留的 EditorState 持有：源码转阅读时父组件先销毁 view，子 cleanup 因失去挂载身份跳过 reconfigure；忙/冻结又会拒绝普通编辑 dispatch。按 diagnosing-bugs 核对生命周期并建立真实 controller 状态回归，清理前断言残留捕获闭包的 FacetProvider，得到3项通过/1项失败/26断言，日志 `/tmp/agentic-f041a-teardown-red.log`。这是状态与清理接缝的确定性复现，不冒称已运行完整 React/WK 卸载现场。

窄修新增 `releaseSearchPresentation`：只接受当前 document session 与完全相同的扩展 owner 身份，只清空查找 presentation compartment，不接受任意事务；忙/冻结仍可释放派生资源，正文、revision、选区、历史不变。SourceSearch 卸载无论 view 是否仍在都请求此释放；仅在 view 起始状态及 controller 最新结果仍精确匹配时，用公开 `view.update` 同步该事务，不向旧 view 回写新状态。回归覆盖失效 session/owner 拒绝，以及普通 dispatch 被冻结拒绝时仍能清理阅读状态。

修正后同一5文件定向为43项/357断言/1.94秒通过；typecheck、受影响文件 eslint、文档/义务、lock registry 与 diff 检查通过。中途 import 顺序及 optional-chain lint 提示已修，不更改忽略规则。当前重新冻结候选，等待独立 Spec/Standards 最终复核及主线全量/构建/实际 WK；没有递增版本、构建、产品验收或 Git。

### 主线中间验证与 alpha.112 构建中（2026-10-10）

主线全量修前875项/20775断言/141文件/22.36s，日志 `/tmp/agentic-f041a-source-pre112-tests.log`；资源清理修正后876项/20787断言/141文件/22.81s，日志 `/tmp/agentic-f041a-source-teardown-tests.log`。两次结果分列，不以修前全量覆盖最终代码。主线 typecheck、完整 lint、文档/义务及 diff 检查通过；相关日志 `/tmp/agentic-f041a-typecheck.log`、`/tmp/agentic-f041a-lint.log`。

独立 Spec 定向20项/204断言、Standards定向26项/242断言，最终代码复核均0阻断；这是源码结论，不是产品验收。主线已递增 package 与 lock 至 alpha.112，构建 session87595 进行中，日志 `/tmp/agentic-f041a-build112.log`，尚不宣称构建成功或真实 WK 已通过。此前失败、父 F-041、完整 OBL-056 与 offline-final 保持开放，未 Git。

主线预备 UI 语料 `/tmp/agentic-f041a-ui.LPmw34`，此检查点尚未打开或保存。只读 SHA256 基线：

- `search-a.md`：`dc2cda0aeffa8be1243cc09ff265611ebad5cbcfa442bbe9efdbf47f6fed5e49`
- `search-b.md`：`2c9be23bbc85c7a930deaa76d5d9790124af2cc4ea78f2150f91204ed420d720`
- `long.md`：`96edb377964bb702e6bc7b6deabb62a56ecf1340fd3bfe886eba53d0524d8b37`
- `readonly.md`：`38684e76b500a56333efa24417f6ce463041f617f1c3a5b205424e52d6bce0e5`

### alpha.112 构建成功及局部真实 WK（2026-10-11，未验收）

主线构建实际成功，日志 `/tmp/agentic-f041a-build112.log`。提取包 `/tmp/agentic-markdown-alpha112.nCBhVI/Agentic Markdown-canary.app`，hash `2tlldrkz4pd0j`，CFBundleVersion `0.1.0-alpha.112`；运行 exec15088 / Bun PID93952。包内 Bun 运行仓库测试876项/20788断言/141文件/22.02s，日志 `/tmp/agentic-f041a-packaged112-tests.log`。此为包内运行时执行仓库测试，不宣称包内全部资源均已验证；与源码876/20787结果分列。

真实 WK 局部观察：

- A 普通源码221字节 clean：`alpha` 为1/5，Return到2/5；大小写开启为1/3，再开全词为1/2。中文查询全词为1/2，关闭全词为1/4；`1` 仅1/1，不匹配 `①`。
- URL字面 `example.invalid` 为1/1，Return后Escape选中对应正文；多行 `AAA\nBBB` 为1/1，Return后Escape选中跨行正文；再次⌘F保持查找条件。
- 系统中文输入源通过工具按 n/i，见蓝下划线 `ni`，没有候选弹窗证据；Escape清空组合而不关闭查找。再次 n/i/Space提交“你”，无结果且正文保持clean。这不是用户物理键盘亲验，也不扩大为全部自然输入法路径。
- B 打开后30字节 clean，普通源码 `beta` 为1/2；回到 A 保留 `alpha` 1/5且正文clean。期间曾显示权限确认中，回 A 后可编辑，仅记录读回结果，不推断原因。

当前仅 A/B 两文档打开，A 普通源码 query `alpha`，没有正文修改或保存。跨模式、只读、长行、编辑历史及退出仍待验；本片未验收、不得 Git。既有失败与未实测限制保留，父 F-041、完整 OBL-056 与 offline-final 不关闭。

### alpha.112 真实 WK 收尾候选（2026-10-11，待最终独立复核）

以下为主线后续实际观察，覆盖前节当时待验及运行现场，不删除历史失败：

- A 查询 `alpha` 共5项，Return/Escape选中正文后粘贴 `SEARCH_TEMP`，仅内存 dirty，结果变4项；正文 Cmd+Z 回clean/5项，redo回dirty/4项。Cmd+Q确认选择继续编辑，正文与查询 `alpha` 2/4保持；再撤销回clean，查询框连续3次Return最终2/5，仍可导航。
- B仍为 `beta` 1/2；关闭clean B后通过选择器重开，普通源码Cmd+F显示空输入“输入查找文字”，旧查询已清除。只读 `readonly.md` 34字节，UI显示只读；查询 `readonly` 1/2，Return/Escape选中对应正文且保持clean。
- `long.md` 132029字节，`needle` 1/12000，Shift+Return到12000/12000，截图底部当前项边框明显，Return回1/12000。连续输入 `missing`→`END` 最终1/1，仅证明最后结果，不冒称实际触发在途竞态。没有看到高亮预算限制提示，不称实测达到装饰上限。
- 源码→编辑隐藏查找，阅读→源码恢复 `alpha` 1/5；源码→阅读实际卸载→源码仍1/5且clean。查找框焦点下Cmd+Shift+M无变化，点击正文后模式切换生效。
- 设置浅色已读回，截图查找高亮可辨；跟随系统已读回，当前深色A `alpha` 2/5截图可辨，最后恢复固定深色并读回。没有动态改变系统主题。关闭设置立即快捷键首次未打开查找，随后聚焦正文Cmd+F成功且正文clean，原因不作推断。
- 源码直接点击解析故障按钮未观察到降级；后经阅读→编辑，呈现故障按钮实际降级安全源码，完整raw保持clean，明确显示查找不可用，聚焦正文Cmd+F不出现查找栏。只将后一路径作为安全隔离实证。

最终四标签clean，Cmd+Q由CUA明确返回App quit，主线ps确认PID93952不存在。主线核验四fixture SHA全部与前述基线一致，未保存正文、未操作用户文档、未断网，当前无运行现场。

本片仅为非离线受托代验完成候选，待最终独立复核和主线确认，未最终验收、不得Git。实际在途竞态、Worker timeout、RSS、物理自然输入与系统动态主题等未实操，不以受控测试或局部工具观察冒充；完整父F-041、OBL-056及offline-final继续开放。

### 正式非离线本片结论（2026-10-11）

最终独立 verifier 复跑20项/204断言，文档/义务及diff检查通过，核对源码876/20787与包内Bun仓库876/20788日志及实际WK收尾证据，确认0剩余阻断；主线正式确认alpha.112本片受托Agent代验通过，非用户亲验。Git待主线实际执行，不预写提交或推送结果。前述失败与未实操边界不删除、不扩大；编辑/阅读查找、替换及完整父F-041/OBL-056仍开放，`F-041a-offline-final`精确留待最终人工验证，当前无App运行现场。

### 实际 Git 收据（2026-10-11）

主线已提交并推送 `99b37c7d2cdd58d2f89c503ccf74743d6f9208d2`，`ls-remote` 核验远端 main 同 SHA，随后工作树为空。本次收据追加本身不声明已经再次提交；上方 Git 待执行为提交前历史。非离线本片代验结论、失败/未实操边界、完整父与 `F-041a-offline-final` 保持不变。

下一候选 F-041b 逐项替换仅规划，`⌘H` 与现有 native hide 的入口冲突待用户回答，不实施；其他独立候选仅只读调查，未选定，不在本次收据中开启新迭代。
