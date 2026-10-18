# F-063a：当前主区非空查询 Quick Open

## Git收据（2026-10-18）

已提交推送 `d8f7ef49a7c8556e9bf6beaf6ca7663ac0ede528`；HTTPS ls-remote 与 origin/main 同 SHA，hook 前后 tree `45f48d579d8687a18dab331f1b2396e822c827bd` 一致。下方 Git 待执行是验收时历史。本收据随后续文档提交。

## alpha183 非离线有限片通过（2026-10-18）

主线报告 alpha183/hash `2zyx0tmpacvox` 实际 WK 补验：准确 setValue 授权两根成功、无 toast；新开笔记44切源码并修改/选中，Quick Escape 保原选区；Quick 新开只读聚焦编辑器，再回既有笔记44仍为源码/dirty/精确选区，直接 CmdZ 恢复 clean 原文。同当前笔记44再确认后直接 CmdShiftZ 恢复 dirty，再 CmdZ clean；既有只读目标亦实际聚焦 readonly editor。重复两项选乙跨多个轮询不复位，Enter 正确新开并聚焦编辑模式。

本轮是组合证据：alpha183 当前深色原红补验，沿用 alpha182 的折叠路径鼠标、45 项 Home/End/坐标滚动、浅色、独立查询与 CmdShiftP 等有限路径，**不是全部矩阵在最新包重跑**。alpha181 选择复位、alpha182 焦点红与早先 picker toast 仍保留，不追认旧包全通过。

正常 CmdQ session61866 exit0、Bun73591消失；50 样本 SHA 全部原样、readonly 恢复644。IMK stderr 保留、不归因。源码 1715 pass/1 fail/37902 asserts，唯一原 FINAL002 long-whitespace 18.613s；包内 Bun 运行仓库测试 1716/0/37902，非包内嵌入测试。type/full lint/docs/lock 通过，不将源码称全绿或原 FINAL002 已修复。

独立最终 Spec/Standards 均 0 必要有限非离线验收阻断，主线批准上述组合证据范围受托 Agent 代验通过，非用户亲验；Git 待执行。自然 IME、离线、极端实际大树未测；完整父 F063、MRU 同分/空态、主副区消费者与 OBL-017/025 后续责任仍开放。

## alpha181 构建批准（2026-10-18）

主线已读最终实际接线，Spec窄修后四文件27/0/166、核心Standards三文件24/0/133、非UI作者UI复核3/0/33，均0必要构建阻断。主线最终全量`/tmp/f063a-source-tests-final.log`、session64270 exit1：1704 pass/1 fail/37848，228文件53.28秒；唯一原long-whitespace18.819秒仍FINAL002，不称全绿或已修复。最终type/full lint/docs/lock/diff session49248 exit0。原新重复通知红已按原断言通过，失败历史保留。主线批准alpha181未签名构建及真实WK；尚未构建完成或验收，不得Git。

> 状态：alpha183 非离线有限片经独立最终复核与主线批准通过，Git 待执行；下方构建/实施批准及未验收表述为各阶段历史。

<!-- obligations: OBL-017, OBL-025 -->
<!-- deferred-obligations: none -->

## 功能范围与前置边界

依据总账第 146 条/N-01、MVP F-063 与义务登记，提供独立 `⌘P` 文件快速打开对话框。仅匹配当前窗口统一文件集合的文件名与展示路径，不读正文、不递归扫描窗口外路径、不依赖全文索引。展示文件名、所属根与可区分路径；支持键盘选择、Enter 持久打开、Escape 取消及虚拟列表。

**本片只交付非空查询与当前主区打开。**F-031/F-032 完整主副区域尚未实现，不能称全部硬前置已满足；本片复用已运行的主区 `activate` / `openWorkspaceEntry`，不制造副区或预览的新默认。已打开文档激活原标签，模式/选区/dirty/历史保持；新打开仍沿当前编辑模式默认。副区最后激活、收起、满载规则归 F-032/033/034 消费者，保留 F-063 后续集成责任。

F-062 的持久 MRU 尚未实现：空输入仅提示“输入文件名或路径”，不伪造最近项；非空匹配质量相同时采用稳定展示键顺序，明确是本片临时确定性次序，不以 mtime 或当前标签顺序冒充最终 MRU。MRU 同分与空态必须在 F-062 接入后补验，完整 F-063 不关闭。无收藏、标题搜索或全文搜索。

本片承接 OBL-017（连续查询取消/优先级/过期隔离）和 OBL-025（查询缓存配额/无缓存理由），正式实施批准时已同步登记表与 claims。当前顶部所列有限组合证据已通过最终复核及主线批准，不关闭完整义务；跨区域和后续 MRU 接入仍需对应消费者验证。

## 继承约束

| 约束 | 本片落实与验证 |
| --- | --- |
| F-002 | 纯本地元数据查询，无网络/正文索引；离线留最终人工，新增 offline-final 登记。 |
| 中文与外观 | 中文标题、未扫描完/预算不足/失效提示，长中文和浅深主题真实检查。 |
| 命令与键盘 | 统一 `quickOpen` 命令与 `⌘P`，不改变 `⌘⇧P` 命令面板；上下/Home/End/Enter/Escape，IME 候选期间不把 Enter 当打开。 |
| 安全与日志 | 路径只显示，打开仅 opaque root/entry 或既有文档 handle；提交再核资格，不自动保存/放弃；日志仅匿名阶段与计数，不含查询、路径或正文。 |

## 实际接口与最小路线

已核现有接点：

- `client/workspace.ts` 的 `FolderState` 提供 roots、nodes、coveredHandles；`refreshSnapshot` 按 `WORKSPACE_PAGE_SIZE=128` 分页并复核 generation/隐藏策略，最终同步发布快照，已有 `WORKSPACE_CACHE_BYTES=4MiB`。不应在每次键入重调 refresh 或复制整个树。
- `workspace-tree-model.ts` 区分完整投影与折叠后的 `visibleWorkspaceItems`；Quick Open 不用后者，折叠不减少搜索范围。独立项依 explicitStandalone/coveredHandles 与可靠当前根节点去重，不把所有已打开标签当窗口根。
- `document-service-panel.tsx` 当前树入口先激活已有 entry，否则 `documents.openWorkspaceEntry(root,node.handle)`；后者沿 protect/load(true) 与后端授权去重。既有显示路径相等可作展示归属线索，但不能替代后端身份授权。
- `commands/registry.ts` guard 在派发时读 live owner；`commands/index.tsx` 与 shared commands 负责键盘/原生菜单可用状态。复用现有 Radix `Dialog` 的焦点/关闭基础，不直接借用 cmdk 全量自动过滤作为后台查询引擎。
- F-005a 是文档服务的有界取消实现，不是可以直接调用的通用查询 scheduler。本片采用局部 latest-wins 调度，不虚构既有公共 API 或增加任务平台依赖。

### T1：当前集合与身份

新增局部 `client/quick-open.ts` controller 和小匹配 helper；输入为当前 FolderState 与 documents entries 的只读引用及订阅，结果为判别联合 `workspace(root,generation,entry)` / `standalone(handle,documentId)` 加显示引用和得分。不保存正文、原始磁盘路径授权或跨重启句柄。

一次查询捕获集合 epoch、query sequence 与打开 intent。集合变化（含同 generation 扫描追加、隐藏切换、根移除/重加、吸收与目录接纳）使旧查询失效并用最新快照重算；不能只比较 generation。只遍历该快照所有 file 节点和未覆盖独立根，不依赖树展开、已打开状态或目录是否可见行。显示扫描未完成/partial/paused 时明确结果仅来自当前已发现集合，不声称全磁盘扫描完成；不为查询启动第二个磁盘扫描。

现 `refreshSnapshot` 收齐捕获时每个 root.entries 的全部页后才发布，不是仅已展开目录的懒加载缓存，当前没有逐节点 LRU 淘汰；扫描未完成则 root.entries 本身仍只是已发现部分。其预算/验证失败会保留旧 state：查询不得把旧快照标为最新完整集合。已知刷新错误/元数据变更处理中暂停打开并提示“文件集合暂不可确认，请刷新后重试”，成功发布再重算；若旧结果保留用于显示必须明确过期且不可选择打开。独立根只有 coveredHandles 且当前可靠节点确实覆盖时才去重，不能因为暂未加载对应根节点丢掉仍授权的独立 entry；已有 root 派生标签不因此额外成为独立根。

选择结果时重新核当前集合/目标种类/handle、相同根 generation 及当前文档门禁，根移除重加不按路径重绑定。最小路线采用**Enter/点击即确认一次打开，关闭查询对话框并移交现有文档任务**；Escape/普通关闭只取消尚未确认的查询，不承诺撤回已确认的打开。确认关闭与取消关闭是不同原因，不能将确认关闭自身视为意图失效。

仅给普通 activate/openWorkspaceEntry 增加可选的派发资格回调：捕获当前结果与集合身份，在确认时核一次，在 protect 保存排空/确认完成后的实际 action 内、紧接 load/activate 前再次核验。等保护期间集合变化或新的确认替代旧选择，则不派发；只持一个待交接选择，不排无界打开队列。回调不依赖已经关闭的对话框 visible 状态。

一旦 load 真正派发，打开由原文档请求 ID/generation、授权与替换确认生命周期负责；后续查询取消不再取消它，也不通过 query epoch 拒绝它的响应。用户新打开/退出仍沿原文档规则取消旧任务，原迟到 select grant 释放保护保持；不新造 cancel API、不调用全局 cancelPending、不复用专属创建收据的 createdIntent。已派发后的集合改变不承诺能撤回磁盘读取或已提交结果；测试分清保护前失效零派发、确认后 UI 隐藏正常完成，以及后续用户打开使旧请求失效的现有合同。这比扩大整个 load 提交协议更小，待两轴复核此明确边界。

### T2：匹配、调度与预算

本片大小写不敏感文件名/展示路径匹配：精确优于前缀，前缀优于有序子序列模糊匹配；模糊质量使用连续度/间隔与较短匹配跨度作确定性排序，不以用户输入构造正则或二次方全矩阵。Unicode 字符不拆坏，原字符串用于显示；实现前在测试中冻结中文/非 BMP/大小写、文件名对路径及同分例子，不追认运行输出为 oracle。

匹配 oracle 在此冻结：查询只 trim 首尾空白，内部空格不分词；query/name/displayPath 均 NFC 后使用 JavaScript locale-independent `toLowerCase()`，按 Unicode code point 子序列，不做拼音/音译或 ß→ss 全 case-fold。每个字段取贪心从左到右的匹配，等级为 exact=0、prefix=1、subsequence=2；先等级，再字段（文件名=0、展示路径=1），再总间隔数、跨度、起点，最后根展示顺序/原展示路径/opaque key 做稳定同分。一个文件两字段皆中取更优 tuple，结果不重复。以下相互独立例子不依赖真实磁盘命名许可：

| 查询 | 候选（其他字段不匹配） | 固定预期 |
| --- | --- | --- |
| `note.md` | 文件名 `note.md`；文件名 `note.md.bak`；文件名 `n-o-t-e.md` | exact、prefix、subsequence 顺序；本例仅测 matcher，不把 .bak 加入文件集合 |
| `note` | 文件名 `note-extra.md`；展示路径 `note/other.md` | 同为 prefix，文件名优先 |
| `note.md` | 文件名 `note.md-extra.md`；展示路径恰为 `note.md` | 路径 exact 优先于文件名 prefix，等级先于字段 |
| `ab` | 文件名 `xa-b.md`；文件名 `xa---b.md` | 同等级同字段，间隔更少者优先 |
| ` CAFÉ ` | 文件名 `Cafe\u0301.md` | trim+NFC+lower 后 prefix；保留原显示字符 |
| `😀文` | 文件名 `😀中文.md`；文件名 `文😀.md` | 前者 subsequence 命中，后者不命中；emoji 不拆 surrogate |
| `strasse` | 文件名 `Straße.md` | 不命中，不声称完整 Unicode case folding |

这些 tuple 参数是本片可复核的最小匹配语义，不是第三方成熟模糊排序的等价声明。未来 MRU 仅替代最终同分信号，不改变匹配质量优先层级。

查询原始输入最多 4096 UTF-16 code units，归一化前检查，超限明确整次拒绝不截断；归一化后也检查同界限。查询单运行槽+单最新待处理槽，新输入立即作废旧 token；每批至多 128 项且每批后让出事件循环，处理期间可取消。归一化/匹配长路径也须受现有元数据长度界限约束；排序采用有界增量归并或分批插入，不能最后对全部结果同步长排序。comparator 仅使用已算好的分数与稳定键，不重复 normalize/lower，所有暂存计费。用户前台输入与打开先于后台查询，禁止后台抢占编辑器或保存 owner；关闭/卸载取消并释放引用。

**不建立跨查询缓存、预归一化全树副本或正文索引。**仅当前任务/结果数组及虚拟列表窗口存在，作为可重建查询暂存计费。实施在现有 workspace metadata 成本 helper 上提供只读成本/快照版本接点，新增查询暂存分类预算，联合现有 4MiB renderer 元数据预算核验（不能额外再加一个未计费 4MiB）。只持原节点引用仍需计算索引/分数/去重集合与归一化暂存开销；旧结果保留期间与新任务同时计费，优先释放旧可重建结果，不驱逐权威文档状态。预算不足明确提示、整次不发布不完整排序，不静默漏结果。具体分类额度在实现时基于当前接口选最小值并写证据，不是产品性能门槛。

OBL-017 以确定性批间 latch 覆盖最新优先、取消/根变更/关闭后零旧发布；OBL-025 明确无查询缓存因现有集合有界且一次查询暂存足够，仍核临时峰值、释放与总预算，不以“无缓存”跳过内存义务。

联合预算不能只查询当前 snapshot 字节而漏掉 refreshSnapshot 的局部 staging。选择最小互斥协议：workspace 在任何异步刷新/accept/prepare-swap 可能建立新 metadata staging 之前同步通知查询取消并清除结果及任务持有引用；查询在该元数据 owner 释放前不得启动。运行任务把暂存集中在可同步 release 的对象，取消真正清空大引用，异步回调只保 token，不能仅标记 cancelled 却继续占用旧数组。最终成功或失败均释放 metadata owner，成功快照后重算，失败保旧但标不可确认。所有刷新入口共用该窄入口，不能只包 UI 按钮；单独 entries 变化亦作废查询并重新计费。若实际接点无法覆盖，须改为明确双方 reservation 再实施，不允许各自读成本各自过关。

实际必须覆盖 `enqueue` 的后台 busy=false 刷新与 `refreshSnapshot` 分配前、`prepareFolderRemoval` 建 next 前、`swapPrepared` 直接换 state 的换代点（不是等 `flushEffects` 通知后才失效），以及 accept 的刷新路径；不能只监听 publish 或 UI busy。4MiB 继续是既有 renderer 保守元数据成本模型的联合账，不等于实测 JavaScript heap 或 GC 已完成；“释放”指清引用/释放预算所有权并经测试核生命周期，不宣称内存即时归还操作系统。

### T3：UI 与打开

新增 `quick-open-dialog.tsx`，依现有 Dialog；固定行高、只渲染可视行与有限 overscan，长列表滚动/键盘定位不挂载全部结果。输入保焦点，使用 combobox/listbox 语义，当前活动项必须真实挂载；上下/Home/End 先滚动再更新可访问活动项。结果包括同名文件的根和路径，不用仅文件名作 key。

document-service-panel 持有 controller 并接统一命令。打开对话框不改源 editor 状态；关闭后仅恢复仍有效的原焦点，不插入正文字符。Enter/点击只派发一次当前选择；IME/冻结/保存门禁变化时明确不可打开。对独立 entry 和已有 root 文档复用既有 activate，未打开文件复用 opaque workspace open。dirty 文档不因查找/切换被保存或丢弃，正常 CmdQ 继续原全部 dirty 保护。

## 最小 happy path 与实施后测试

1. 两根同名文件+独立根，折叠文件树后 `⌘P` 查询文件名/路径，结果能区分所属根；精确/前缀/模糊次序固定。空输入仅提示，不称 MRU。
2. Enter 新打开文档为当前主区常驻；已打开 dirty/源码文档只激活原身份与模式，原选区/undo/redo 和其他 dirty 不变；只读文件可打开。
3. 连续输入、关闭重开、查询期间扫描追加/根删除重加/隐藏策略变动、确认后保护等待期间移除目标，以受控异步测试证明旧查询不发布、未派发失效选择不打开；已派发后依上述普通打开合同，不声称查询关闭撤回请求。
4. 有界大集合、长路径与密集匹配，检查每批计数、取消让出、结果 DOM 数与查询暂存释放/总预算；预算失败不显示伪完整结果。计时只作有限观察，不新设 SLO。
5. 真实 WK 验证 `⌘P`/原命令面板不冲突、中文输入、键盘/鼠标、虚拟滚动、长路径、浅深主题、取消焦点与正常退出；不能以 handler/SSR 替代真实交互。自然 IME 无证据时如实登记，不推断工具输入等同自然输入。

实施后定向测试/type/lint/docs/全量、独立两轴复核后，才由主线批准递增 alpha 与实际验收。任何失败保留原证据；不改既定冻结/专项/F-028c，F-058 异常消费者与阅读子窗口未决均不作为本片隐含需求。

## 作者实施记录（2026-10-18，未构建/未真实验收）

已接入局部 matcher/controller、查询预算与 metadata staging 互斥、普通打开派发前资格、统一命令/原生菜单/面板；UI 由独立作者实现。没有新增依赖、正文扫描、MRU 或副区能力。现快照成本仅随 metadata 状态变化重算，不在每次键入序列化全树；查询按实际顶层展示排序，同名独立项保 opaque 身份。

评审指出并窄修三项：初始查询与 scratch 在零候选时也必须先预留；独立项吸收须 coveredHandles 加可靠同路径节点双证据；保护等待期间即使后台 staging 尚未 publish，也须以 metadata 代数和 owner 可用性阻止派发。已加入近满目录-only 集合、确定性批间取消、实际 save-drain 等待期间后台刷新、同代追加/隐藏/独立吸收回归。三项原为源码审查发现，未伪称已有修前红测试。

失败保留：首 type 因并行 UI 文件尚未落盘失败，首 lint 有 8 项 import-order；后续 type 发现 TS2339（独立布尔值不足以窄化 target），改为直接 `in` 判别，不使用断言；新增测试 lint 一项 Array<T> 格式错误已按规则修正。主线首全量 `/tmp/f063a-source-tests.log` 为 1703 pass/2 fail/37839 asserts，包含原 FINAL002 长空白 18.145s 与本片新增 workspace 重复通知；原 FINAL002 继续开放。后者独立原单文件复红 `/tmp/f063a-workspace-atomic-first.log` 为 5/1/30：既定 publish-once oracle 收到 `[130,130]`。修复仅增加 query availability 专用订阅，metadata owner 释放不再通知普通状态 listeners，旧 oracle 未改。

修后作者定向命令 `bun test apps/desktop/src/client/quick-open.test.ts apps/desktop/src/client/workspace.test.ts apps/desktop/src/client/workspace-atomic.test.ts apps/desktop/src/client/folder-removal.test.ts apps/desktop/src/client/create-markdown.test.ts apps/desktop/src/components/quick-open-dialog.test.tsx`：62 pass/0 fail/408 asserts，日志 `/tmp/f063a-targeted-final2.log`。最终 typecheck exit0，日志 `/tmp/f063a-type-final2.log`。这不是全量最终结果，也不是 WK 验收。

UI 独立复核：executor 非 UI 作者，全文核 `quick-open-dialog.tsx` 与测试并独立执行 UI 单文件 3 pass/0 fail/33 asserts；确认有限虚拟行、活动项挂载、组合输入键仲裁、确认与取消焦点语义无必要代码阻断。此证据仅 SSR/纯函数与源码审查，不证明真实 DOM 焦点、鼠标、自然 IME 或滚动。主线后续负责全量、版本/build 与实际 WK，作者不批准自身核心代码交付。

作者最终定向 lint exit0（`/tmp/f063a-lint-final2.log`）；`bun run check:feature-docs` 与 `git diff --check` 均 exit0。生产文件保持冻结，等待主线全量及独立最终复核，不操作版本/build/Git。

## alpha181 原样轮询选中复位：最小窄修合同（待两轴复核，未批准生产修复）

真实 WK 中查找“重复”得到两项，Down 后出现“文件集合更新中”，选择回到第一项；当前面板每 350ms 正常轮询 `folders.refresh()`。已新增实际 `createFolderWorkspace` + `createQuickOpen` 回归：两项结果 `move(1)` 后原样 refresh，必须仍选择同一 key，且不能清空结果或重新进入 searching。作者两次及主线独立均按原命令复红 0/1/4：expected `root:n1`，received `root:n0`；作者日志 `/tmp/f063a-alpha181-selection-first.log`、`/tmp/f063a-alpha181-selection-repeat.log`。第二个“不清空/不重算”断言在首断言失败后尚未执行，不冒已测。原 alpha181 未验收，不得 Git。

**所有权只做本片窄分层，不新增通用 scheduler、不关闭轮询：**

1. 保留串行 workspace 操作 tail。普通 refresh 的只读状态探测持 `probeOwner`，不立即取消 query lease、不换 metadata 集合代数、不发布新 FolderState；显式 select/hidden/rescan/clear/prioritize、移除 prepare/swap 仍按原严格 staging/mutation owner 失效。若 refresh 有待确认重扫收据或已知 commit，不走无变化快捷资格，仍进入严格路径。
2. probe 开始立即使打开资格不可用，并递增独立派发资格代数；确认前及 protect 等待后的回调都核此代数与 owner。因 probe 开始而失效的已确认但未派发打开不自动复活。已有查询 lease 仍占账，但暂停批处理；已完成结果保持原数组、active key、滚动上下文，不清空、不伪称正在重算。暂停通过专属 availability 通知/任务状态实现，不通知普通 workspace state listeners。
3. `state` 响应经现有严格校验，根信息/coveredHandles/assetEpochs 与已载节点数均与当前快照一致，且无错误/notice 变化，才认定 unchanged；释放 probe owner 后已有完成查询直接恢复可选择，已有未完成查询从原游标继续，不从头匹配。probe 期间用户修改输入则取消旧 query/清引用，仅保最新有界 query 文本与待启动标记；owner 释放后只启动这个最新输入一次。关闭/卸载清待启动标记，旧回调不可重开或发布。不能让 `lease.current()===false` 后直接 return 而丢失恢复责任。
4. 确认 metadata 变化时，**先**转入原严格 staging owner、取消并释放 query 引用/预算，**再**建立 nodes/captured staging 与分页；之后成功/失败沿原换代和错误合同。探测异常、响应非法、预算失败、notice/错误状态变化同样使旧结果不可选择并明确反馈，不静默当 unchanged。真正变化后重新匹配仍允许按既有规则重置活动项，本窄修只保证无变化不复位。

**探测费用不视为零：**query lease 必须保存当前实际 reservation 字节数，snapshot 基础成本仍为缓存值。probe 在发请求前持有其小型固定控制记录额度；响应在 transport 返回、严格形状校验后，且在比较、保留 captured 或建立 staging 前，计算其保守 `metadataBytes(response)`，以当前基础成本 + query reservation + probe 控制/响应成本联合检查 4MiB。超限整次拒绝本次探测并使查询不可确认，清响应引用及本人 reservation，不暗自降低计费或返回部分结果。比较时产生的字符串等暂存须纳入同次保守额度，不能只计 response 而漏比较副本；可以改为有界字段比较避免整份重复 stringify。将响应转换为 staging 后转移计费，不能同时遗漏或重复释放 owner。正常 unchanged 后释放 probe 临时引用/额度，query reservation 原样保留。

上述是 renderer 已有保守成本模型的准入，不承诺在收到 IPC 响应之前知道其实际长度，更不声称控制 transport/反序列化已经发生的 JavaScript 分配或 GC。收到响应的瞬时分配无法由本接点事前消除；校验后不得继续持有超过模型的组合数据。若实际实现无法维持此明确的响应后准入边界，应回报，不以“只读零成本”替代。

实施后保留固定新红不改 oracle，并补：probe 暂停中输入仅恢复最新一次、暂停中关闭零恢复、真实变化/失败仍清结果、保护等待跨 probe 零派发、近满账本响应拒绝及额度释放。原批间取消、staging 互斥、原子 publish-once、hidden/追加/吸收和初始查询费用回归继续通过后，才提交两轴及主线批准新包真实复验。本节目前仅方案，不作为已修复证据。

主线已全文读取上述窄修合同及实际 enqueue/request/refreshSnapshot/query lease 接点；独立 Spec 与 Standards 均给出 0 必要实施路线阻断。批准按此合同有限实施及实现后测试，不批准新构建或 Git。实现需保证失败先失效并确定错误再通知恢复、staging 分配前完成所有权转移、暂停定时任务只有一个恢复责任；未将路线认可冒充修复证据。下一代码包须递增 alpha182，alpha181 的真实失败仍保留。

### 经主线批准的窄修实施收据（未新构建/未真实复验）

生产仅修改 `client/workspace.ts` 与 `client/quick-open.ts`。workspace 执行时判断普通 refresh 且无 pendingRescan/confirmedCommit 才为 probe；query lease 的存活与 runnable 分离，开始 probe 递增派发代数但不清结果。实现无需开始 availability 通知：每批 timer 进入时检查 runnable 并清本人 timer 标记，暂停后的唯一恢复由 owner 结束通知负责；完成结果无 timer，不重新匹配。输入变化清旧任务，结束时仅启动最新文本；关闭后不启动。错误在 owner finally 恢复通知之前发布并失效。

响应联合账为缓存快照成本 + query 已保留的完整 reservation（含原 scratch）+ 1024 控制记录 + 缓存旧 headers 比较成本 + 3 倍收到的 response 模型成本。旧 headers 成本随 state publish/swap 缓存，避免新 response 缩小时漏计旧比较字符串。变化路径在任何 nodes/known/collected/parents 构造前取消 query 并转 staging；响应已被 transport 分配的事实边界仍如上，不声称实测堆峰值。

原复位回归保持不变并通过。首窄修定向 `/tmp/f063a-probe-first.log` 为 19/1/118：旧“staging”测试实际上持普通 refresh，预期立即清空与新 probe 合同冲突；经主线明确批准仅将该用例操作换为 `prioritize` 真 mutation，原清空/预算互斥断言不改。保护等待跨普通 refresh 的零派发入口和断言保留。新增 probe 最新输入/关闭、中途游标唯一恢复、联合响应预算拒绝/释放及错误恢复；未增加生产诊断。

最终六文件定向 `/tmp/f063a-probe-final3.log`：66 pass/0 fail/436 asserts；包含旧 workspace-atomic、folder-removal、create-markdown、UI 回归。typecheck `/tmp/f063a-probe-type-final.log` exit0，定向 lint `/tmp/f063a-probe-lint-final2.log` exit0，diffcheck 通过。新增测试首 lint await-thenable 红保留 `/tmp/f063a-probe-lint.log`，改为明确 await 实际 refresh Promise 后断言捕获错误。等待两轴独立复核与主线全量/alpha182实际复验，不宣称 alpha181 已修复验收，不执行版本/build/Git。

## alpha182 已打开文档焦点：最小窄修合同（仅方案）

主线实际 WK：原选择复位、两根同名 Enter、折叠路径鼠标、45 项 Home/End/滚动/末项打开与只读路径通过。源码笔记44修改并保留选区，Quick Open Escape 可恢复原选区；经 Quick Open 打开 readonly 后再回笔记44，单标签、源码模式与 dirty 保留，但焦点为 HTML，直接 CmdZ 未改变正文。新文档打开能聚焦 editor。普通标签点击对照由主线继续，本条不预写结果。

只读接点：`quick.choose` 先同步关闭对话再调用 `documents.activate`；已有标签 `activateTab` 同步发布，`MemoryEditor` 在 documentId 切换后的 effect 内调用公开 `EditorView.focus()`。`QuickOpenDialog.onCloseAutoFocus` 确认分支 preventDefault 且不恢复焦点，取消分支才恢复 previous。此时序与现象相符，但尚无事件证据证明具体是 Radix 哪一步夺焦；不将推测写作已定位机制。已读本地锁定 Radix FocusScope 公开 onUnmountAutoFocus 契约及实际关闭事件，不新增任意延时竞争。

候选窄修：仅 Quick Open 确认链持一个一次性 focus ticket，联合“该确认打开完成”“该次 Dialog onCloseAutoFocus 已发生”“对应当前已挂载编辑器可用”三个事实；条件齐全时调用该已挂载 view 的公开 `focus()`，不重建 state、不派发编辑 transaction、不改选区/滚动/历史。普通 activate/activateTab 返回和行为不扩为通用焦点协议。

现 documents 没有公开 editor-focus target，只有 source-selection/history 等专用目标，不能冒已有 API；新增最小注册入口（documentId + ready + focus，返回按注册身份释放函数），由 MemoryEditor 在 currentView 建立后注册，cleanup 仅释放自己，内部复用现 `currentView()`、实际 view.state/控制器当前 editor state 与 compositionStarted/冻结/忙/输入门禁检查。执行只调用此注册对象的 EditorView.focus，不以 DOM querySelector 猜目标、不调用历史操作来间接聚焦。注册/解除只负责可用性，不自行全局抢焦点。

ticket 绑定当前 Quick Open intent、所选授权身份和成功激活后的 documentId；异步新打开不能沿用先前 snapshot 的 id。打开失败、没有实际激活所选目标、目标关闭/切换、query 重开、取消、卸载/dispose 均清 ticket；原选择存在且本来已激活也可在确认关闭后重新聚焦该 view。pending 打开期间旧 view 的注册通知不能触发。实际聚焦前再核同 intent、同当前 snapshot/授权及 editor 可交互；IME 期间不抢焦点，不挂无期限迟到恢复。对话取消仍只恢复有效 previous，不创建 ticket。onCloseAutoFocus 负责标记该次 scope 的结束边界；通过同步条件汇合及注册/打开完成回调处理先后，不加 setTimeout/rAF 反复争焦点。若公开边界不足，需回报而非靠延时猜测。

最小测试：锁定同步已有激活先于关闭、异步新打开后于关闭、同当前标签确认三种顺序均只聚焦目标一次；旧 view/错误返回/取消/重开/目标关闭/IME/dispose 零迟到聚焦；原 dirty、精确选区及 undo state 对象不变化。可控 helper/注册目标测试只证明协议，必须再以真实 WK 原流程核直接 CmdZ、取消选区/焦点和正常退出，不以其替代 DOM 验收。当前只方案，未批准生产焦点修复/新版本/build/Git。

主线随后批准本焦点合同的有限生产实现与实现后测试；下一代码包为 alpha183，版本/build/Git 仍由主线管理。普通已激活标签点击对照仍为 HTML 焦点，点击 editor 后 CmdZ 成功恢复 clean 与原文/选区，说明历史仍在，不证明具体 Radix 根因。

alpha182 实际收据（主线执行）：50 fixtures；dark/light、45 项 End/Home/坐标滚动（AX 元素 scroll 无效）、折叠路径鼠标/new Enter、readonly、独立查询、CmdShiftP 有限通过。两次 picker 确认后 toast 与空树保留；第三次 AX/截图显示粘贴仍为旧独立文件路径，改 UI setValue 精确甲目录并确认选中后成功扫描 47 Markdown，不将此前失败归因产品回归。正常 CmdQ session32306 exit0、Bun72169消失，50 样本 SHA 全部原样，readonly 恢复644；隔离数据区主题深色。笔记44 clean 后从独立 picker 返回曾显示“权限确认中”，未测试其恢复，不归因且不混作焦点根因。焦点原流程仍待新包复验。

### 焦点作者实施记录（尚未新包实测）

新增 documents 专用焦点 target 注册/按注册身份释放，MemoryEditor 复用 currentView、connected、同 editor state、非 compositionStarted/composing，就绪不要求 hasFocus 或可写。控制器入口另核输入阻断/保存/frozen/busy/disposed。Quick Open 只持一次 ticket，打开完成/同 scope 关闭/目标挂载三条件汇合；执行前消耗，missing 仅保本人待挂载，blocked 终止。文档切走使已成功绑定 id 的票据永久失效；未成功阶段不把旧 snapshot 当目标。Dialog scope key 与旧回调复核避免上轮 close 认领新票据。未增加 timer、普通 activate 返回 API 或 DOM 查找。

独立审查补齐已知输入/保存门禁，以及“本来已激活 snapshot 巧合相同但本次准入失败”边界：沿原 current 回调记录本次最后准入结果，不在已派发 load 后重新用变化的 probe 代数否认其正常交接。确认期间同步监听开始根移除的正式回归仍零 focus。fixture 新打开返回路径改为对应请求的真实节点展示路径，不改变原匹配 oracle。

阶段六文件 `/tmp/f063a-focus-final3.log` 72 pass/0 fail/459 asserts；typecheck `/tmp/f063a-focus-type-final3.log` 与定向 lint `/tmp/f063a-focus-lint-final3.log` exit0，diffcheck 通过。首 lint prefer-optional-chain 红保留 `/tmp/f063a-focus-lint.log`。新增测试覆盖已有 dirty 精确 state 保持、异步新开不聚焦旧 view、延迟注册、scope错配、重开、composition阻断后不恢复、输入门禁、切走回来、dispose 与实际准入失败。受控target测试不冒真实DOM焦点通过；等待两轴独立代码复核与主线alpha183原流程复验，无作者版本/build/Git操作。

主线源码审查又指出：若把 canSelectFolder 放在 current 回调，会把 protect 等待保存排空时的本方 frozen 误当禁止，正常打开也被拒。此为源审发现，未伪称已有运行红。已采用确认关闭 publish 后、调用 documents 操作前的同步 canSelectFolder 检查；current 只保原 metadata/intent 合同并记录准入，不按调用次数猜测。新增实际 saveDrainRequired 无 metadata 变化的正常打开回归，旧跨 probe 零打开仍保留。

作者冻结检查：六文件 `/tmp/f063a-focus-final4.log` 73 pass/0 fail/462 asserts；`/tmp/f063a-focus-type-final4.log` 与 `/tmp/f063a-focus-lint-final4.log` 均 exit0，feature-docs/diffcheck 通过。等待独立最终复核，不再修改生产。
