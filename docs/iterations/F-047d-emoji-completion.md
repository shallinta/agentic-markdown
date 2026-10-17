# F-047d：Emoji 按需候选输入

### 最新清理版验证（2026-10-16，alpha168有限代验通过）

最终独立Spec及Standards均0必要有限验收阻断，主线正式批准本片非离线范围受托Agent代验通过，非用户亲验。FINAL-ISSUE-001/002按用户授权延期但仍开放；Git待实际执行。下方待复核/待清理文字为过程记录，不覆盖本结论。

循环依赖窄修后，主线原同进程`bun test`通过1522项/36559断言、208文件，日志`/tmp/f047d-alpha168-cycle-full.log`；typecheck/full lint/feature-docs/obligations/lockfile及diff检查全部exit0。独立Spec/Standards各67/478及原链接独立6/87通过，主线已全文读state叶模块、原API重导出及新进程入口测试，批准alpha168 unsigned构建。此前全量超时仍属FINAL-ISSUE-002，此次绿不证明其修复；分组及逐文件失败见8.2。

unsigned构建exit0，产物version.json确认0.1.0-alpha.168/hash18esct1gd90bm；日志`/tmp/f047d-alpha168-build.log`，独立候选chunk仍为本地动态导入，大chunk/hdiutil弃用警告保留。直接提取wrapper payload到`/tmp/agentic-direct168.Siak8B`，不运行安装器，不带临时诊断flag。包内Bun运行仓库1522/36559、208文件exit0（`/tmp/f047d-alpha168-bundled-tests.log`）。

真实WK清理版回归：completion样本输入`:smi`无初选、Down显式选中、Enter变`:smile:`且无新增换行；一次undo恢复`:smi`，再undo恢复clean。源码输入`:smi`无菜单，undo；源码定位URL末端、切编辑并输入`:smi`，URL完整为`https://example.com/?q=test:smi`且无菜单，undo。末行输入`- :smi`、Down/Enter仅变`- :smile:`，切源码截图核第12行完整原文；AX父Value此处未包含整个末行，子text与实际截图一致，不仅依赖父Value断言。两次undo恢复clean，CmdQ实际App quit，exec36449 exit0、Bun70981消失。两样本SHA仍为第7节原值，未保存/强制退出或改网络；退出仍有IMK mach port stderr，不推因。

此清理版补验沿alpha166已取得的鼠标、Tab、只读、跨标签和浅深有限证据，未冒这些在alpha168逐项重新执行；新state单例及readonly/source/safe由定向回归覆盖。自然IME、完整竞态/首载成本和最终离线仍未测。FINAL-ISSUE-001/002保持最终收敛开放；等待独立最终复核，不预写验收/Git。

> 状态：alpha168有限候选片已受托Agent代验通过，已提交推送`1c874564a121a4c6859db344370a7e0b36e11350`，主线ls-remote核远端main同SHA、origin/main同步。临时诊断已清理，确定性循环依赖已修并复验。偶发问题FINAL-ISSUE-001/002留最终集中处理，未称已修复。

## 主线实施批准（2026-10-16）

主线全文读取本方案及已安装公开CompletionContext/apply/config契约，独立Spec/Standards均0必要实施阻断，批准直接有限typed实现、同版6.20.3直接依赖及最小lock和实现后测试，不另叠加PoC。`:smi|:`可补、已知完整`:smile|:`不自动重开；Completion.apply返回void，acceptCompletion返回true不冒controller已写入。迟到rejection源内返回null并守dispose/代数；filter:false不得validFor。真实组合DOM优先级和鼠标接受必须实际验证。下一alpha166/build/WK/Git由主线后续管理，不预批验收。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## 1. 选择依据与本片范围

检索唯一迭代目录未发现F-047d占用。本片承接总账122 / S-11及[F-047c第5节](F-047c-emoji-editing.md)：已验显示片仍明确开放“合法上下文按需加载候选”。F-047c alpha165已有固定gemoji8.1.0原子语法与原文显示，因此本片不再改变词典版本、语法profile或reading-legacy，不将输入候选混成Unicode写入功能。

建议首片支持已知名字的严格、区分大小写prefix搜索，不引入描述搜索、模糊匹配、中文同义词、最近使用或网络候选。仅编辑模式、单一空光标、可写且当前活动文档可交互时启用。输入合法 `:s` 后提供名称以s开头的候选（如 `:smile:`）；只有单独冒号时不弹大词典，减少普通标点干扰。此为本轮具体交互提案，待主线批准，不声称用户已逐项决定。

候选显示系统Emoji及完整shortcode。上下方向键选择，Enter或鼠标接受，Esc关闭；Tab不劫持，Ctrl-Space/Option-i等系统或已有快捷键不新增绑定。候选未打开或没有明确选中项时，Enter仍走现有正文/列表输入。建议`selectOnOpen:false`，首次Enter不盲选；主动向下选择后Enter才接受，避免普通输入误提交。按Esc后同一前缀不立即重新打开，继续输入名称才重新查询。

接受以一次局部事务写入 **`:name:`**，不是Unicode；光标置于末尾，移动离开后由F-047c呈现Emoji。若光标后已有一个闭冒号，替换范围包含它，不能生成双冒号；光标后紧接名称字符（正在词中）先不触发，以免截断用户后缀。取消、加载失败、无匹配、失去资格均不改正文/选区/历史。已有完整shortcode不自动重开列表。

源码、只读、safe source、阅读、非空选区及多光标不提供此入口。没有独立新快捷键或全局菜单命令；自动触发后的鼠标与键盘等价由同一公开completion命令及当前文档guard处理。未来若需要主动全词典/命令面板入口另收敛，不把它列为S-11已经确认的必需范围。

## 2. 已核公开接口与实际接点

已安装间接依赖 `@codemirror/autocomplete@6.20.3`，实际类型/实现位于 `node_modules/.bun/@codemirror+autocomplete@6.20.3/node_modules/@codemirror/autocomplete/dist/index.d.ts`及`index.js`，当前desktop未声明直接依赖。本轮若实施，建议精确声明同已锁6.20.3为直接runtime依赖并最小lock同步，不升级其它包；当前未安装或改依赖。

官方接口入口：[自动补全说明](https://codemirror.net/examples/autocompletion/)、[CompletionContext](https://codemirror.net/docs/ref/#autocomplete.CompletionContext)、[CompletionResult](https://codemirror.net/docs/ref/#autocomplete.CompletionResult)、[autocompletion](https://codemirror.net/docs/ref/#autocomplete.autocompletion)。本次web抓取前两页403，未用失败页面假作已读取内容；以下依据已安装官方包公开声明及实现核实：

- `CompletionSource`返回结果/null/Promise；`CompletionContext`提供state、pos、view、aborted和`addEventListener("abort",...,{onDocChange:true})`。默认普通输入不会自动abort所有旧请求，因此必须明确选择doc change失效。
- `CompletionResult`有from/to/options；`filter:false`时不得设置validFor。本片由有序索引给严格prefix结果，建议filter:false且不复用validFor，避免官方模糊匹配或映射后旧范围资格绕过；每次输入只做有界局部资格与索引查询。
- 配置提供`override`、`defaultKeymap:false`、`closeOnBlur`、`maxRenderedOptions`和`selectOnOpen`，可复用原生CM tooltip而非自建React弹层。maxRenderedOptions只限制DOM数量，不截断语义匹配集合。
- `Completion.apply`函数须自行附`pickedCompletion`注解；公开`insertCompletionText`可生成事务，但它会同时应用到相同前缀的其它选区，本片接受前再次要求单光标，不能依赖该helper替代guard。
- 官方`acceptCompletion`检查readOnly，但鼠标路径直接调用内部applyCompletion，自定义apply仍必须独立核验权限/IME/活动文档。公开completionKeymap含Ctrl-Space/Alt-i等，不整包接入；只选择公开moveCompletionSelection/acceptCompletion/closeCompletion组成局部守卫键位。
- 官方plugin已有composition处理，但这不等于本项目in-flight索引结果与controller状态全部安全；仍需本片所有入口最后检查。

仓库实际接点：`editor-mode.ts`通过presentation compartment隔离编辑/源码与safe；`raw-buffer.ts`的rawText、applyRawChanges/history保留BOM/EOL；`components/memory-editor.tsx`将dispatchTransactions经controller.updateEditor批准后才view.update，并已有currentView、compositionStarted/composing、controller可写/退出冻结等检查。候选必须走此真实事务通道，不直接setState、修改rawText或自己维护第二份正文。

## 3. 最小技术路线

### 3.1 数据分离与懒加载

保留F-047c静态小映射及同步grammar完全不变。用现有固定生成器同次生成独立排序名字索引，带同一映射version/hash与名称一致性测试；只输出prefix搜索需要的数据，不引入gemoji全metadata或用户内容。候选源通过单个`import("./emoji-completion-index")`按需取模块，不在顶层import索引或全Completion数组。固定映射继续用于Emoji detail，无需重复value表。

只有本节3.2全部资格满足且至少一个名称字符时才触发dynamic import；代码/URL/只读/源码中的 `:s`不能启动加载。模块Promise可跨view共享，因为只含不可变公开词典；不得共享文档位置、选区、请求票据或正文。加载失败返回null，清失败Promise让后续明确新输入可重试，不循环重试、不阻止输入、不输出文档内容。动态import不能实际取消网络/模块求值，失效只禁止结果发布；需如实记录模块初始化成本。

索引预排序，二分求prefix上下界；返回全部匹配名字且排序稳定，建议最多20条DOM可见由CM自行滚动。每次只创建匹配范围的Completion对象，最大工作量受固定词典大小约束但不是零成本；记录索引文件字节、首次load/查询有限成本，不声称总解析或UI全局线性。构建时检查真实分包产物，不能仅凭源码import宣称按需成功。

### 3.2 合法前缀与语法资格

从当前空光标向左最多`EMOJI_MAX_NAME+1`单位寻找未闭合 `:[A-Za-z0-9_+-]+`；必须位于同物理行，不能靠matchBefore扫描任意长行。名称包含至少1字符、没有完成闭冒号；右侧名称字符直接拒绝，单闭冒号可纳入待替换范围。未知prefix查无结果即可null。

采用当前可靠syntaxTree的公开resolveInner/父链核宿主，最多64祖先步；syntaxTreeAvailable至少覆盖整个前缀/被消费闭冒号，不强制ensure/force parse，不新增canonical或后台Worker。不可靠/缺宿主/预算耗尽保持原文无候选。未完成前缀本来没有EmojiShortcode节点，不将它作为前置。只开放真实正文inline容器（Paragraph、标题、TableCell及其合法行内组合）中的文本/已有短码区域；排除Frontmatter、代码围栏/缩进代码/行内代码、HTML、URL/LinkTitle、定义标识与目标。建议链接label及图片alt沿已有Emoji解析语义允许候选，但必须证明当前点是label/alt文本而非目的地/引用标识，不能只看有Link/Image祖先；显示widget对图片opaque的规则不能直接套成输入禁止。若公开节点无法可靠区分，则该未知上下文暂不触发并如实报告，不把它静默取消为产品范围。

资格应复用或小幅抽取F-047c的只读Unicode左右邻界、转义奇偶与同段URI排除逻辑，不能改其已验语法；不是先构造整文插入候选后重解析。前缀左侧最多256读取、左右码点各最多2单位，范围以可靠inline宿主及当前行共同限定；不擅把全文开头当inline起点。右邻以最终替换末端之后的现有文本判断（若已有闭冒号就跳过该一个冒号）。`:sm`在普通文本可触发，`a:sm`、`12:3`、`https://x/?q=:sm`、单反斜杠转义及不可靠上下文不得触发。容器换行/BOM/非BMP必须通过正式小回归，不把F-047c的完整令牌资格收据当未完成前缀证明。

此处最需验证的是公开语法节点的label范围和partial tree下的前缀资格；若实际API无法可靠提供，不扩大全文扫描或私有字段，保留原文并报告路线问题，由主线决定窄适配。

### 3.3 生命周期与接受边界

候选源捕获view实例/当前document关联route、Text身份、选区与局部from/to/prefix；加载后复核context.aborted、view存活且当前活动、同Text/同选区/同mode/可写/非冻结及无IME。`onDocChange:true`使普通输入也失效旧请求；新前缀下一请求复用已加载索引，不重用旧候选闭包范围。选区/模式/权限变化及dispose同样失效代数，不能仅比较字符串碰巧相同。

编辑presentation内挂补全扩展，source/safe reconfigure卸载；view销毁/切标签关闭候选并取消本view票据。权限刷新不一定改Text，必须单独触发关闭/失效。生命周期票据由本view局部持有，不增加文档全局缓存。DOM回调必须验证仍属当前候选代，不能仅凭旧from/to数字插入新正文。

compositionstart立即失效查询并关闭候选，不接受Enter/Escape/箭头来抢输入法；关闭若处在CM同步update不可重入，延后dispatch前再核代数/view，所有accept函数即时guard仍阻止提交。compositionend在CM标志清除后的下一安全时点重查最新输入，不补造composition事件，不把受控测试称自然IME。仅Ctrl/Meta正常原有命令继续既有route。

键盘与鼠标均调用同一自定义apply：再次核上述资格、候选属于当前固定map/prefix结果且route可写；用当前真实范围插入完整shortcode，带pickedCompletion和适当input.complete userEvent。建议使用公开history `isolateHistory.of("full")`让一次撤销只撤销本次接受、恢复输入的前缀，保持前后输入分组；确认目标版本公开接口后实现，不自己改历史栈。接受不追加空格，避免擅改用户正文；菜单关闭后焦点留编辑器。

只读底层controller拒写为最后防线，不以其存在省略候选禁用。readonly从加载中/列表打开态切入、跨标签旧鼠标回调、source与safe变化都需真实入口测试。错误或过期apply不得先改选区再拒绝。

### 3.4 与现有Enter的明确仲裁

已核 `list-input.ts` 的`listInputExtension`是`Prec.high(EditorView.domEventHandlers(...))`；CM补全keymap即使自身Prec.highest，其DOM keymap runner仍可能后于该列表handler，不能据优先级名字假称解决。拟把本片候选键路由实现为更高优先的局部`EditorView.domEventHandlers`，在现有列表处理前运行，但只处理当前编辑器已打开候选菜单的无修饰方向键/Esc/Enter；无菜单直接false，不改变普通列表/围栏路径。测试必须真实组合两扩展检查事件处理顺序，而非分别调用两个函数。

采用`defaultKeymap:false`、`selectOnOpen:false`，建议本source唯一的autocompletion配置`interactionDelay:0`：用户须先用方向键或鼠标明确选择，因而不依赖默认75ms延迟来防盲接收，也避免已明确选择后的Enter因延迟落入列表续写。方向键调用公开moveCompletionSelection；Enter仅在当前选中项有效、apply资格通过时接受并消费，否则无选中项关闭菜单后按原文Enter行为继续。若选中项已过期/权限冻结，则先取消候选，不得旧坐标写入；readonly/IME由上层现有guard处理，不以新路由代替。Esc仅关闭本菜单，不改选区；Tab不拦截。鼠标仍走同一apply最后守卫，不调用内部completionState。

公开history `isolateHistory`已核安装包声明（commands/dist/index.d.ts约65–72行）：`full`明确隔离前后事务。上文“确认目标版本接口”已完成只读核实，不是历史/撤销行为运行证据。

## 4. 最小 happy path 与实现后验证

最小流程：可写编辑文档输入 `:smi` → 索引首次按需加载 → 下键选`:smile:`/Enter或鼠标接受 → 正文为`:smile:` → 移开显示😄 → 一次撤销回`:smi`；源码查看保持shortcode；Esc取消不改正文。

拟正式测试（实现后补，不采用TDD，也尚未运行实验）：

1. 懒加载：无前缀/单冒号/代码/URL/source/readonly不调用loader；有效前缀才1次导入，多view只共用固定索引、不共用票据；失败后新输入可重试。
2. `:smi`、`:smi|:`闭冒号复用、`:+`、未知/大小写、转义奇偶、词内/时间/URLquery、link label与destination、图片、Frontmatter、表格/quote/list、BOM/CRLF及非BMP边界；每例手写是否查询、替换范围、最终raw，不能仅两个引擎互证。
3. 接受与取消：鼠标/键盘同apply，selectOnOpen不盲提交，Esc不改raw/selection/history；一次undo恢复前缀，redo完整shortcode，BOM/EOL未改；多光标/非空拒绝。
4. deferred loader完成前输入/移动/切tab/权限变化/source/safe/dispose、旧DOM回调必须无写入；组合开始失效、结束重查。真实controller readonly拒写，不能只向工厂附低优先级facet假称readonly。
5. 当前CM真实source/result/apply与公开tooltip集成回归；原有列表Enter、Tab、Escape查找、保存等上下文不被无菜单路径吞掉。性能只做固定词典首载与少量prefix查询/固定显示数观察，正式冻结样本后运行，不增加每键全文解析。
6. 主线新包WK：实际输入/菜单/上下键与鼠标/取消、接受后复制shortcode及一次撤销、浅深主题、代码/URL无误触、两模式/只读切换、跨标签、正常退出和自建样本SHA。自然IME若不能实际输入则仍明确未测，不用模拟事件冒充。

不预设具体耗时SLO；公开API成熟不代表项目中已接通，当前没有新实验或测试结果。

## 5. 继承约束与收尾责任

- **F-002**：固定本地打包词典，无远程请求；dynamic chunk属于本地资源。离线项仍留最终人工，不断网、不改网络。
- **中文与外观**：菜单空态不强弹窗，错误不输出正文；显示名称为语法原名、Emoji为系统字形，必要辅助提示中文；复用主题变量并核浅深，OBL-068/069仅协作、不关闭整项。
- **命令与键盘**：不安装默认Ctrl-Space/Alt-i全键表，不劫持Tab或IME；仅当前候选菜单消费显式选择键，所有写入经当前文档统一许可和历史通道。
- **安全与日志**：名字来自固定生成表，detail只text，不innerHTML/图片/URL，不输出用户路径/正文；加载错误可匿名记录阶段，菜单失效不修改数据。

登记中没有F-047主承接的现有OBL，故本片obligations/deferred均none；不虚构已关闭义务。候选片通过仅补S-11编辑候选这一责任，不关闭完整F-047、阅读子窗、自然IME未测、冻结F-041d、F-028c专项或offline-final。本轮只新建这份唯一方案；手册/总账在主线批准实现后按真实状态维护。下一alpha与build/WK/Git全部仍由主线管理。

## 6. 实施候选与证据路由修订（2026-10-16）

主线批准后实现 `emoji-completion-context.ts` 有界前缀资格、`emoji-completion.ts` 公开 CM completion 与逐 view 代数、生成器独立候选索引，以及 live presentation / MemoryEditor 当前 controller 接线。直接依赖精确 autocomplete 6.20.3；未升级其他包。安装同步 bun.lock 既有 workspace 版本 alpha164→当前 alpha165，不是本片升版。语法映射、profile、reading-legacy 不改。

主线明确修订两项证明路径：

1. 不新增 DOM 测试依赖。自动测试覆盖真实 EditorState、CompletionContext/result/apply、真实 controller/history 与受控 view/class seam；**不称实际 EditorView DOM 组合事件已通过**。更高优先 DOM handler 与列表 Enter 的真实顺序、鼠标接受、未选 Enter 恰一次落通、Esc/Tab 等须在后续 alpha166 WK 实操。此条覆盖上文自动测试必须真实 DOM 的原拟定路径，不取消产品责任。
2. 固定 version、生成器 `--check` 和名字逐项等价检查替代冗余 hash；当前没有实现索引 hash。生成索引 31,183 bytes，静态语法映射不变；只在合法前缀后 dynamic import。初始化/加载/菜单布局并非免费；分包与真实加载由后续构建核实，当前不宣称首载性能实测。

composition-end 实现为一次 20ms 延后、复核当前 view/route/组合标志和最新前缀后尝试公开 startCompletion，不是轮询至 IME 标志必清，也不声称自然输入法全矩阵通过。显式取消增代并清理该 timer；开始组合、blur、失去资格和 dispose 均失效旧请求。真实 IME 仍须按实操证据记录。

### 6.1 失败与修正保留

- 首次 typecheck：`ViewPlugin.fromClass` 将可注入 loader 构造参数推断为插件参数，改为 `ViewPlugin.define` 显式构造，未削弱类型。
- `/tmp/f047d-author-first-tests.log` 为 28 pass / 2 fail：一项测试将 facet 错传为 effect，改公开 appendConfig 并断两选区；另一项是真实迟到结果缺口——同 Text/selection 切 readonly 仍返回候选。追加当前 `emojiPrefix` 资格复验及 readonly/source/safe 负例，不只依赖正文身份。
- controller 测试初版 `this.state` 类型不成立，改直接读取当前 controller state；lint 的 require-await/prefer-const/多余断言均修测试，不改生产守卫。一次从 desktop 执行根 typecheck 得到 `Script not found`，改在仓库根执行；失败日志保留。
- 独立 Spec 在 65/473 通过后发现 Esc 只关闭公开菜单但未增本片代数，旧返回 apply 可写同 Text/selection。修为本片所有显式关闭走 `session.cancel()`，增代、清 timer 再关闭；新增取消后旧 apply 不改 raw/history、组合结束排队后取消不重开的回归。原缺口不因先前测试绿而省略。

### 6.2 作者定向收据与剩余责任

`bun test apps/desktop/src/client/emoji-completion.test.ts apps/desktop/src/client/documents.test.ts` 最新取消修正收据为 **66 pass / 476 assertions / 0 fail**（`/tmp/f047d-author-cancel-tests.log`），Standards 独立同 66/476（`/tmp/f047d-standards-targeted.log`），仅定向代码证据。测试含有效/排除宿主、BOM/CRLF/Unicode、闭冒号复用、同 Text 权限/模式失效、旧回调、一次 undo/redo，以及真实 controller 写入与只读拒写。

当前不是完整产品验收。主线全量、最终独立代码复核、分包检查和实际 WK 仍待执行；自然 IME、实际 tooltip DOM 键盘/鼠标、完整竞态、离线人工及父功能均不冒通过。作者未升 alpha、未构建、未启动 GUI、未 Git。

## 7. alpha166 实际验收中，交互阻断未解决

主线全量源码1521/36556、包内Bun运行仓库1521/36558通过；type/full lint/docs/lock通过。独立Spec及Standards最终定向66/476、0必要构建阻断。unsigned canary构建成功，alpha166/hash `kser9y9ee4p`；候选索引独立chunk25.34kB/gzip9.14kB，主入口动态导入已核。构建仍有大chunk及hdiutil弃用警告，未做首载性能测量。

真实WK已观察`:smi`无初选、Down/Enter接受、一次撤销、无初选Enter换行、Esc取消、鼠标接受`:smile_cat:`、源码核对及复制粘贴为原shortcode。此为有限中间证据，不是本片验收。

在源码选中token、BackSpace、定位列表尾、切模式这一工具序列后，列表出现计划外下划线`ji`，仍源码且保存/侧栏等禁用。用户明确未操作窗口。Escape、Return、blur/refocus、Right、CmdQ均未解除；后续Space在其他空行插入空格，禁用仍在。不能据此认定工具、原生输入法、CM或本片根因，也不能以按钮状态证明compositionStarted值。独立只读检查确认多操作共享canLeaveEditor屏障，但无现有UI直接读该组合标志。

现场为exec98516/Bun50553，直接包`/tmp/agentic-direct166.CPw2Gn/Agentic Markdown-canary.app`，隔离数据`/tmp/agentic-f047d-ui.wg886Z/data`；仅自建completion.md处于内存dirty，磁盘样本SHA尚未变化。未强制终止、未保存、未验收、未Git；剩余列表Enter、负例、主题、只读、跨标签与正常退出须继续。旧alpha135终止授权不迁移至本实例。

### 7.1 用户退出后同版重开复查

用户告知已退出；主线核50553消失、两磁盘SHA原样，再启动同直接包/隔离数据，exec20279/Bun54385。列表末尾输入`- :smi`，Down/Enter仅接受为`- :smile:`；菜单关闭后Enter正常生成下一`- `，源码核对，三次撤销恢复clean。源码输入`:smi`无菜单；分步selectText/BackSpace、定位列表尾及切模式成功，未再次出现ji或禁用。未闭合反引号按普通正文提供候选；补闭合后在代码内部修改仍为`:smi`且无候选，符合解析上下文区别。

工具在编辑渲染文本定位列表尾时一次实际落入下方行内代码，已撤销，不冒称正确定位；后续改末尾键盘定位。另源码selectText完整代码token返回找不到文本，改CmdEnd/CmdShiftLeft并先核选区后删除，恢复clean。最终CmdQ实际App quit、exec20279 exit0、54385消失，两原SHA不变，无保存或强制终止。此前阻断根因仍未知、不能宣称已修复；浅深/只读/跨标签/Tab等剩余验收仍待继续，尚未完整通过或Git。

### 7.2 Tab、跨标签、只读与主题补验

同版再次启动exec77940/Bun55749。初次选择器的连续快捷键未进入路径框，重新观察后分步定位成功，不计为产品打开失败。readonly.md以444打开为明确只读，工具输入`:smi`及Esc未改正文、无候选、仍clean，之后可正常切回completion。候选打开且Down选中`:smile:`后单独Tab，AX正文仍`:smi`且菜单/选中状态未变，未被Tab接受；随后直接切只读标签菜单消失，返回原文档保留前缀但没有旧菜单。不是精确异步竞态覆盖。

浅色菜单实际截图文字可读；设置切深色后实际截图背景/文字/选中行可辨。首轮点击主题加Esc并未应用，已用键盘Down/Return确认深色值；均只改隔离测试数据。一次在候选尚未出现前批量Down未得到菜单，重查后先观察菜单再Down取得明确选中证据，不把该批次当成功导航。

末行`:smi`键盘选中删除后恢复clean；CmdQ实际App quit，exec77940 exit0、55749消失，两样本SHA仍原样，readonly权限恢复644。本段没有再次出现持续禁用，但不证明旧ji阻断根因或已修复。自然IME、首载成本和完整竞态未验证；待独立最终复核决定有限片结论，未Git。

### 7.3 独立复核仍保留验收阻断

Spec独立复核确认功能路径有限证据，但原ji涉及计划外输入、全局禁用和退出失败；分步复查与后续正常退出尚未闭合原触发序列，也未隔离为本片外问题。主线接受此阻断，不无条件批准验收，不以自然IME未测替代已观察到的红。下一先重建原候选接受/原文复制/源码选择删除/定位列表与切模式顺序，逐步保留证据；如需诊断增量先定仅元数据方案，不修改组合守卫猜测修复。运行日志另有IMKCFRunLoopWakeUpReliable mach port消息，未证与原问题因果，不据此归因。当前无运行测试实例，未Git。

### 7.4 原顺序对照与临时反馈方案

同版exec46343/Bun57594重放首候选接受/撤销、未选Enter/撤销、Esc再输入l、鼠标第二项、源码选择shortcode、编辑复制/末尾粘贴/撤销、回源码，再原样同一调用执行selectText token→BackSpace→selectText列表尾→CmdShiftM。此次token删除、模式切换成功且恢复clean，没有ji；CmdQ App quit、exec46343 exit0。主题沿上一轮深色、时间间隔不同，不能称完全等价确定性重放或证明已修复。

为建立红能力反馈而非猜根因，拟仅在既有EDITOR_FAULT_LAB显式开启且手动开始采集时扩展focus-trace。主线已读现trace、lab、MemoryEditor守卫接线及现controller公开getter，范围如下，待独立路线复核后实施：

1. 沿128条内存环形与手动停止展示；新增compositionstart/update/end及Escape/Backspace键类别，不记录字母、event.data、正文、路径、documentId、选区偏移。不写磁盘日志/新RPC。
2. 临时独立getter注册模块以实例identity注销；MemoryEditor仅flag为true时登记当前view只读getter，返回currentView、公开compositionStarted/composing/hasFocus和readOnly；失配/异常为unknown。Lab从现controller公开getSnapshot/hasSaves/getMode/isSafeSource/canToggleSourceMode/canSelectFolder/canSave读取固定布尔/枚举，不增加controller写接口。停用不调用getter。
3. capture行明确处理前；对组合/input/有限控制键最多一个合并setTimeout(0)后读，关联首末capture序号，不假称逐事件after。开始/停止各固定snapshot；stop/clear/dispose代数取消旧post、不轮询、不dispatch、不改guard/CM私有状态、不focus。
4. 显示采用每条短摘要与完整固定字段，避免只读到AX前500字符而误判缺事件；不动态刷新焦点或采样。临时代码统一标TEMP-F047D，取证后精确清理，原trace功能保留。
5. 实现后测试停用零读取、getter异常隔离、旧identity注销、新owner保留、128上限、post合并/取消、字段白名单与无正文；独立代码复核后才由主线升alpha167构建。真实仅自建样本重复原顺序，记录事件与状态相关性，未出现红不进入根因假设或冒称修复。自然IME与系统根因仍未知。

此为诊断方案，不是修复批准；无新版本/构建/Git，现alpha166整体验收保持待定。

### 7.5 TEMP-F047D 临时实施候选

主线批准7.4后使用 diagnosing-bugs 与 implement，仅实施取证，不改变输入守卫、controller状态或补全行为。新增 `focus-trace-state.ts`：实例identity注册/注销只读getter、异常与失配unknown、固定字段运行时投影。MemoryEditor只在原有 `__AGENTIC_MARKDOWN_EDITOR_FAULT_LAB__ === true` 时注册，卸载时identity注销，不创建新开关。FocusTraceLab从现有controller公开getter读取固定摘要，不记录documentId；只在手动采集期间调用。

focus-trace沿原128环形；无可选诊断reader时原行为保持。启用时start/stop固定snapshot、事件capture-before、组合/input/有限控制键后至多一个setTimeout(0)合并post，记录首末capture序号；stop/clear/dispose取消timer并增代。异常不保存Error或message。显示每条独立details短摘要及完整固定元数据，停止后才展示，无实时刷新/自动focus。未读取event.data、正文、路径、选区偏移或CM私有状态。

实现后初轮 typecheck通过；定向focus-trace测试8/65通过（`/tmp/f047d-trace-tests.log`）。初轮lint三项为多余初始化和import顺序，已窄修；最终type/lint/定向复跑另记。自动测试覆盖停用零读取、getter异常、旧identity注销不删新owner、白名单、128上限、post合并关联及stop/clear/dispose取消；不是实际WK故障复现或修复证据。

精确清理清单：删除新 `focus-trace-state.ts`；移除MemoryEditor TEMP注册/import/cleanup；恢复FocusTraceLab无controller参数及既有trace调用、删除新增逐条临时摘要；撤销document-service-panel该prop；删除focus-trace可选reader/phase/state/post与新增组合/control分类；移除focus-trace.test两项TEMP测试及import。保留原focus-trace功能与既有测试。清理后须rg `TEMP-F047D`并重验，不将临时模块当产品交付。

最终作者收据：根typecheck、定向eslint exit0（`/tmp/f047d-trace-type-final.log`、`/tmp/f047d-trace-lint-final.log`），focus-trace 8 pass / 65 assertions / 0 fail（`/tmp/f047d-trace-tests-final.log`）；文档检查与diff检查通过。仅诊断候选，待独立复核和主线打包取证；无版本/build/UI/Git动作。

### 7.6 alpha167 诊断首轮真实对照

独立Spec实跑8/65及Standards静态均0必要诊断构建阻断；主线全文读临时实现，采纳短摘要加入compositionStarted/mode/canToggle并升alpha167。全量首跑1522/1/36570为既有callout-query long whitespace测试5秒超时（实际18490ms），日志`/tmp/f047d-alpha167-tests.log`保留；未改测试或超时，原源码复跑1523/0/36570（`/tmp/f047d-alpha167-tests-repeat.log`）。type/full lint/docs通过。unsigned构建成功hash14g1p4pq0icrn，日志`/tmp/f047d-alpha167-build.log`；尝试读取已被构建删除的中间tar失败，改提取最终wrapper内已观测zst，不运行安装器。

直接包`/tmp/agentic-direct167.bs4LRf/Agentic Markdown-canary.app`，既有环境flag开启，exec43003/Bun59119。首组仅键入完整shortcode作为前态，非重新走候选全序：source选token→BackSpace→选列表尾→切模式，clean成功。11行trace显示started/composing始终false、canToggle true；展开post #4关联capture3，currentView true，busy/frozen/saves false。逐条摘要可读；完整JSON单AX文本仍截断约500字符，不能声称其所有末尾字段已读全。

第二组工具pressKey n/i观测：正文暂有ni且操作禁用；Escape后正文恢复clean、许可恢复。31行trace明确#7 compositionstart前false，#8 update时started=true/composing=false、canToggle=false；#11 post二者true；#22 compositionend处理前仍true；#23 Escape及#24 post二者false/canToggle=true，#31 stop正常。只证此工具组合对照正常，不证明自然IME全矩阵或原ji故障根因。初次诊断未捕获持续红，不进入根因推断/修复。

CmdQ实际App quit、exec43003 exit0、59119消失；两正文SHA原样。运行退出收据仍含IMKCFRunLoopWakeUpReliable消息，正常对照也出现，但不由此断定旧故障原因。临时诊断保留以继续抓取偶发红，尚未清理、整体验收待定、不得Git。

包内Bun运行仓库全量1523 pass/0 fail/36571 assertions，`/tmp/f047d-alpha167-bundled-tests.log`、exec52263 exit0；非打包后UI验收替代。

## 8. 用户允许延期偶发问题，继续收尾（2026-10-16）

用户明确“继续推进，偶发问题可先记录，最后再一并解决”。原ji问题转[FINAL-ISSUE-001](../deferred-obligations.md)，不再阻塞本片有限候选交付；这不是根因已明、缺陷消失或自然IME全矩阵通过。保留第7节全部失败与限制，主线批准按7.5清单精确清理临时诊断，后续alpha168仍须代码复核、全量验证及真实清理版检查，再决定验收/Git。

### 8.1 临时诊断精确退役

按批准清单使用 apply_patch 删除 `focus-trace-state.ts`，移除 MemoryEditor 临时登记/import/注销，恢复 FocusTraceLab 原参数/采集/显示与 document-service-panel 调用，移除 focus-trace 临时 state/phase/post/组合分类及两项 TEMP 测试。逐文件核对这四个既有 trace/panel 文件与当前已提交基线无差异；MemoryEditor 仅保留正式 Emoji 补全接线。`rg` 检查 desktop/src 无 TEMP-F047D、focus-trace-state、registerTraceView 或 removeTraceView 残留。

作者实现后验证：根 typecheck、定向 ESLint exit0（`/tmp/f047d-cleanup-type.log`、`/tmp/f047d-cleanup-lint.log`）；focus-trace、emoji-completion、documents 三文件 **72 pass / 527 assertions / 0 fail**（`/tmp/f047d-cleanup-tests.log`）。原 trace 六项保留，正式候选实现不改。删除的临时源码可从本会话 apply_patch 与第7.5清单恢复，历史失败及真实诊断收据不删。本次未升版、build、GUI 或 Git；原偶发故障仍未知/未修复，等待主线清理包与独立验收。

### 8.2 独立模块入口循环修正及原全量红记录

主线 alpha168 原两次同进程全量均1520 pass / 1 fail / 36556 assertions：callout-query long whitespace 超过5秒timeout，实际约18秒；不因定向绿抹去红例。逐文件替代验证到 `link-presentation.test.ts` 暴露 `Cannot access editingMarkdown before initialization`，不是async-markdown文件。完整分组client999/32174、rest522/4382通过，207文件无遗漏经Standards核对，但不冒称原同进程全量通过。

只读一次新进程入口对照：import raw-buffer exit0，import live-formatting exit1同TDZ。确认本片新增直接环 `live-formatting → emoji-completion → emoji-completion-context → editor-mode → live-formatting`，editor-mode顶层createEditorModeExtensions同步读未初始化editingMarkdown。此为本片入口风险，不按既有偶发问题豁免；与长空白timeout不混为同一根因。

主线批准后按implement进行最小修正：新无presentation依赖 `editor-mode-state.ts` 仅承载同一mode/safe Facet、EditorMode与两个只读getter；mode仍取首项默认editing，safe仍some(Boolean)。editor-mode导入相同实例并re-export原公开API；emoji-completion-context改从state模块读。没有改权限/组合guard、模式行为或测试导入顺序。

新增 `editor-mode-entry.test.ts` 在真实新Bun进程首先import live-formatting并核导出。作者定向67 pass / 478 assertions（entry、emoji-completion、documents三文件，`/tmp/f047d-cycle-tests.log`），原link-presentation单文件独立6/87通过（`/tmp/f047d-cycle-link-alone.log`）；根typecheck及定向lint通过（`/tmp/f047d-cycle-type.log`、`/tmp/f047d-cycle-lint.log`）。修后全量、独立最终复核及清理包实际验收由主线继续；作者无version/build/UI/Git操作。
