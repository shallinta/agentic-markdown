# F-045g：GFM表格语义与阅读呈现有限片

> 状态：alpha133 非离线有限阅读表格片经独立最终Spec/Standards各0剩余必要阻断，主线正式批准受托Agent代验通过，非用户亲验；Git待主线实际执行。2026-10-13。下方候选/方案/失败检查点均保留历史。

## 主线最终批准收据（2026-10-13）

本片仅canonical/阅读表格范围正式通过。源码1033项/29685断言；alpha133包内Bun运行仓库1033项/29686断言/163文件、exit0，非包内测试文件。alpha132的结构/原文/history/权限实操与边框失败不改写为133；133的主题边框/滚动复验与退出证据见下方原收据。完整S02三模式、F054、父F045、offline-final及无EditorView阅读故障恢复责任保持开放，不把clean重开恢复当该故障已修。尚未执行本片Git。

## alpha133 复验收据（待最终复核）

132重开clean自建A后正常恢复编辑；在编辑模式注入解析故障实际进入安全源码，完整raw保留且clean。随后正常CmdQ退出，无该包进程、两样本SHA原样，readonly权限恢复644。此不修复reading无EditorView缺口，已明确登记OBL070/F013后续F013d候选，当前不实施或宣称通过。

主线批准的CSS窄修仅将th/td加入阅读作用域reading-border；新增静态契约测试，不冒充computed style证据。独立Standards复跑9/92、0必要代码阻断。alpha133同命令构建exit0、hash`2lymjin26wllb`，直接解包`/tmp/agentic-direct133.Ilw5F3/Agentic Markdown-canary.app`；以同临时HOME/故障开关运行exec75339，首次CUA成功。源码全量1033/29685/163文件、type/full lint/docs/lock/diff均通过，日志alpha133-tests.log。

实际WK在App深色下重新打开同tables.md：纸页的表格边框已恢复阅读棕灰色，与132近白边框有可见区别；通过命令面板切墨夜，蓝灰边框与深底清晰，95元素审计通过、145节点主题DOM复用通过，revision0/解析请求1未变。墨夜宽表拖横向滚动条确认E/F末列可达，外层未撑开。源码/只读/跨标签/history行为在132实操，133仅CSS与静态测试变化，不声称全部重跑；未实际缩窄整个窗口、系统动态主题、自然IME、图片授权矩阵及离线。表格限定视口溢出滚动已在两包实际验证。

133正常CmdQ退出、exec75339 exit0、只读进程检查无该包，样本SHA两者均与上节基线一致，权限各644。没有用户文件保存、网络改变或安装完成窗口。包内Bun运行仓库复跑1033/29686/163文件、exit0（alpha133-packaged-tests.log），不是包内测试文件。当前为有限验收候选，完整S02/父及故障恢复/专项/离线责任开放；待独立最终复核。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## 功能说明与已确认依据

能力总账S-02确认GFM表格，结论109/112与S-GFM规定在固定CommonMark上以整体、内置、版本化GFM能力演进，不提供子语法开关。主线选定本片先交付canonical表格语义与只读阅读呈现；编辑/源码保留原文字节与既有能力，未交付三模式结构一致性，完整S-02/F-045继续开放。E-26/结论104及F-054单元格编辑、键盘移动、增删行列/对齐工具栏不在本片，不借本片自动实施。合并、多行单元格、筛选/排序/公式不支持。

最小阅读行为：识别可靠GFM表头、分隔行与正文行，显示受控表格；首行用表头语义，列对齐来自规范align，允许单元格现有行内格式/非活动链接。窄容器可横向滚动，不改raw、不增history、不持久化列宽。无新增编辑命令、点击导航、网络加载能力。表格内图片仅沿既有图片授权服务，不因表格新增资源权限。

## 本地官方API调查与候选依赖

方案阶段仅只读核本地源码，未安装依赖或运行实验。仓库desktop现有直接GFM依赖仅strike/task/autolink，未见table直接依赖。前轮明确诊断tmp `/tmp/agentic-f045f-strike-red.BF9rCq/node_modules`已有官方`micromark-extension-gfm-table@2.1.2`与`mdast-util-gfm-table@2.0.0`，已读各package版本、公开index.d.ts、README及对应实现；这些是候选精确版本，不声称最新版。初稿将前者误写2.1.1，获批实验前按实际package.json纠正。实验只在新mktemp目录安装核实版本及当前fromMarkdown2.0.2和已有固定扩展，不修改仓库package/lock。

公开组合为`fromMarkdown(raw, {extensions:[…, gfmTable()], mdastExtensions:[…, gfmTableFromMarkdown()]})`。产出`table`（align数组）、`tableRow`、`tableCell`及行内子节点；官方进入/退出token处理位置，且专门处理表格内inlineCode中的转义pipe。不要复制其内部token字段/算法；不使用toMarkdown整文写回。资料来源：[micromark官方table](https://github.com/micromark/micromark-extension-gfm-table)、[mdast官方table](https://github.com/syntax-tree/mdast-util-gfm-table)。已安装Lezer1.7.2另有公开Table配置，但本片不注册或改变编辑树，不把读取声明当两树已一致。

需实验核定的实际语义：无首尾pipe、escaped pipe/inline code、空单元格、少列/多列、表头与分隔列数不符、对齐、引用/列表容器、空行结束。不得凭表面字符串split推断单元格，也不能假定mdast全部生成节点有原文位置。既有autolink transform可令表格内Link/Text缺position，该已知契约继续有效。

## 最小技术路线（实验后再批准生产）

1. canonical-parser添加两个官方扩展，单源CANONICAL_PROFILE换代；canonical请求/结果拒旧配置。MARKDOWN_GRAMMAR、Lezer wire与局部格式/结构命令不改，不虚报编辑表格能力。BOM/CRLF/loneCR仍由原canonical适配保留raw坐标，不创建第三棵树或每单元格重新解析。
2. 在`security/commonmark-content.tsx`用已解析节点构建固定React `table/thead/tbody/tr/th/td`，显式固定类与列对齐枚举，不透传HTML属性/style/URL。受控阅读审计仅增加这些**App生成结构**及精确允许属性（例如th固定scope=col与有限对齐类）；`safe-content.ts`的原始HTML白名单、reading-html前检/DOMPurify/严格保真检查均不扩大。原始`<table>`不得因受控表格可用而进入安全HTML路径。
3. 顶层table自身需可靠raw范围，供现阅读锚点与降级；子cell/Link缺position不能伪造，不作为编辑坐标。行内内容继续递归既有受控renderer；HTML保持原文、链接inert、安全预算仍执行。列缺失/多余如何按GFM显示由公开官方HTML输出对照决定，不随意显示parser留下的全部超出列。若必须合成展示空格或空cell，明确它只有呈现身份、无原文位置。
4. 继续现current-canonical按需Worker与doc/session/revision/raw取消、阅读memo/卸载及主题消费者；不增加每键canonical扫描。表格节点数量/嵌套沿既有呈现work/depth预算，超限安全原文回退；横向滚动不成为文档状态。单元格不挂载EditorView或新通用表格平台。
5. 保留旧canonical corpus每节点rangesValid/expected。新表格用独立canonical语义/范围能力测试：结构、列对齐、完整单元格文字及已有位置合法性与缺位置明确分开；旧case如变化保留失败先报告，不静默改expected凑绿。

## 获批后的有限隔离PoC计划

先由主线全文阅读与独立核对批准，随后按prototype/LOGIC在明确mktemp内纯候选+薄case/all/interactive驱动，禁止本方案阶段先实验。候选使用完整当前canonical官方组合加table；现配置作对照，公开micromark table HTML编译输出仅作离线语义oracle，不插入DOM、不运行危险HTML。输出原始输入、table/row/cell树、align、精确自身raw范围/缺位置、单元格规范文字及官方列显示数量。

有限矩阵：基本2列/三种对齐及默认；可选首尾pipe；空表头/空cell、少列/多列；分隔列数不符非表格；`\\|`与代码中的escaped pipe；强调/删除线/自动链接/实体及字面HTML；段落相邻/空行结束；引用/列表中的表格；BOM/混合EOL。反例完整保留，不用字符串搜索或父范围填充缺失position。

先回答解析/列语义与位置问题；如可收敛，再提出最小受控React纯渲染候选供主线批准，不在实验中无授权修改安全审计。需要SSR验证时只用固定受控元素/静态输出，与HTML编译器字符串严格隔离；SSR不是WK、事件/资源安全或真实外观证明。出现官方组合与已交付语法相互作用，先记录具体反例、规范对照与消费者影响，不自行裁剪或写新方言。

## 最小happy path与验收

打开自建含表头/对齐/不等列数及混合行内内容的文档，阅读显示正确列结构和完整文字；窄窗口可读且不挤坏外层，链接无活动导航，原HTML不能执行。编辑/源码仍见原Markdown，切换不dirty、不改undo/save；只读阅读可用，safe保留原降级。自动回归覆盖官方语义、顶层BOM/EOL范围、旧profile拒绝、取消/陈旧结果、受控DOM白名单与原HTML禁止、旧语法/原文历史。主线打包后实际WK核表格/浅深外观、横向滚动、模式/标签切换及退出；未知自然输入/系统动态主题等不冒称完成。

## 继承约束与义务

- F-002：本地固定解析依赖，磁盘raw唯一真源；无网络解析/自动保存，`F-045g-offline-final`仍最终人工，不更改网络设置。
- 中文与外观：现中文状态与主题；表头/边框/对齐/窄屏需实际验收，禁止把SSR等同视觉通过。
- 命令与键盘：本片无新写命令、快捷键或单元格焦点编辑；不接F054，不影响已有普通选区/IME。
- 安全与日志：受控React表格不等于任意HTML表格获准；不扩原HTML白名单/属性/URL授权，日志仅固定样本不记用户正文。
- 义务核对：当前deferred-obligations无F045专属主责或延期ID，标记none；协作OBL030安全、OBL064原文历史、OBL068/069模式外观及F074一致性，不迁移/关闭完整责任。F045/S02、F054、tagfilter、编辑自动链接余项开放；F028c、围栏内部Enter专项及offline不推进。

本方案只提供有限可验证路线，不代表生产批准或整个GFM表格能力完成。

## 获批有限纯解析PoC结果（2026-10-13）

主线全文读取及独立Standards确认0隔离路线阻断后授权运行；上方“未实验”为原方案检查点。本次已冻结临时产物，尚未SSR、生产或真实WK验收。

- 目录：`/tmp/agentic-f045g-poc.bgH6kE`；`prototype.ts`为纯解析模块，`driver.ts`为case/all/interactive薄驱动。命令：`bun /tmp/agentic-f045g-poc.bgH6kE/driver.ts all`；可将all替换为`short-extra`、`bom-eol`等case名或`interactive`。没有仓库运行脚本或依赖变更。
- 临时精确依赖：table micromark2.1.2/mdast2.0.0、fromMarkdown2.0.2、micromark4.0.3；既有strike2.1.0/2.0.1、task2.1.0/2.0.0、autolink2.1.0/2.0.1。首次安装过程中校对manifest至与生产strike版本一致后重新安装，最终安装成功；无仓库依赖写入。Bun1.3.14。
- `run-first.log`：16例中12例不符预设。无首pipe的`a | b\n- | -\nc | d`被官方mdast和HTML共同识别为段落+列表，初稿误将它及派生样本预设为表格。不是两解析器分歧，也不据此修改算法。首轮shell末尾tail导致外层退出0，不冒称该层exit证明实验成功；日志明确failed12。
- 保留`single-dash-list`独立反例，其余无首pipe表格改用`--- | ---`明确分隔行。`run-second.log`17例/0失败、命令exit0；随后添加有限精确align/单元格文字/少多列官方输出/escaped-code/BOM范围断言，`run-final.log`仍17例/0失败、exit0。自动检查还包含预设table数量和已存在position的整数/输入边界；完整前后树、raw切片及HTML均逐例输出。不是所有子树语义的自动等价证明。

已观察与最小消费者要求：

1. 对齐为`left/center/right/null`。cell自身raw范围包含pipe或边缘空格，例如basic第一cell范围`[0,4]`为`| a `，规范文字仅`a`；不能将cell.raw直接作为显示文字。
2. `short-extra`的mdast正文两行分别有1和3个cell，表头2列；官方HTML每行2个td，少列补空、多列`discarded`不显示。受控React消费者须按表头列数呈现，不是遍历所有cell，也不能给补出的空cell伪造position。源文仍完整保留，不做原文裁切。
3. escaped pipe及inlineCode样本规范内容分别`x|y`和`a|b`；强调/删除线/实体/代码样本规范文字`bold em del`、`& code`。引用/列表/任务项内表格可解析；旧配置的完整对照树保留，未称旧corpus已回归。
4. `html`样本在表头后以`<script>`开行，结束表格并成为后续HTML块，不是表格单元格HTML样本。官方安全默认HTML字符串转义标签；这既非生产sanitizer验证，也不覆盖单元格内HTML，后续受控呈现验证须补该边界。
5. 本17例没有缺position节点；本例裸URL/邮箱不是已有autolink transform缺位置反例的穷尽替代，不能据此关闭已知缺位置契约。BOM+混合EOL表格自身raw范围精确`[1,23]`，BOM不混入正文、CRLF/loneCR未改写；HTML字符串自身行尾策略与raw不是同一保真通道。

最小下一建议：可据此编写/核对受控React table呈现实验或生产方案，保留固定列数规则、原HTML白名单隔离、精确profile分离及旧corpus失败先报告；需主线另批准。当前未运行SSR/DOM、安全审计、owner陈旧回执或真实外观，不把纯解析exit0视为本片通过；F045/S02/F054及offline-final保持开放。

## 最小生产接入方案（待主线全文读取与独立批准，未实施）

主线已复跑冻结17例，`run-root.log` exit0；此仅纯解析证据。以下收敛到canonical/阅读，不增加Lezer表格、编辑单元格或新命令。

1. **固定解析与身份**：`apps/desktop/package.json`/`bun.lock`精确新增`micromark-extension-gfm-table@2.1.2`、`mdast-util-gfm-table@2.0.0`，不升级其他依赖。`client/canonical-parser.ts`在当前官方组合追加公开table语法与mdast适配；`shared/markdown-profile.ts`仅将CANONICAL_PROFILE换为`commonmark-gfm-strike-task-autolink-table-4`。MARKDOWN_GRAMMAR及编辑wire不变。沿既有canonical协议、Worker/owner、文档会话/原文/revision/config fencing与卸载，不新增缓存或同步解析通道；旧canonical profile请求/回执均拒绝。
2. **受控typed呈现**：只在`security/commonmark-content.tsx`的官方mdast可判别联合中处理`table/tableRow/tableCell`（沿`ReturnType<typeof parseCanonicalMarkdown>`，必要时使用官方类型的类型导入）；禁止`any`、强造节点、任意props展开或HTML字符串注入。列数取实际表头cell数，align按有限枚举映射固定类；首行为thead/th，其余tbody/td。每行只呈现前N列，缺列生成纯展示空td，无伪position；超出的原cell仍留在原树/raw但不渲染。单元格递归复用现有行内renderer，不用cell.raw替代文本，也不重新parse。
3. **分配前预算**：保留既有100000 work与128 depth上限和超限原文回退，不新设文档大小限制。在建立行列数组/React元素前，以剩余work核表头列数×行数及固定wrapper/section/row开销；通过除法比较避免溢出。全部实际或合成空cell都计费，表格/thead/tbody/tr/td/th等新增结构深度也计入，行内后代仍逐节点计费；不得只按mdast已有cell数量放过大量短行×宽表头放大。嵌套表格沿同一全局预算累计，不能每表重置；不为了预算先构造二维矩阵。原definition遍历保护保持，失败时沿现有完整原文回退，不展示部分表格。
4. **安全与外观**：`isControlledReadingElement`只增加App生成的table/thead/tbody/tr/th/td、固定表格/滚动容器class、有限left/center/right类及th的`scope="col"`精确组合；其他属性继续拒绝。`safe-content.ts`的CONTENT_TAGS、reading-html原HTML白名单/前检/净化均不改变，原始`<table>`仍走旧保守路径。真实单元格HTML仍显示原文，不变成活动节点；链接保持inert，图片只沿既有ReadingImage/LocalImages授权，不透传src/href。滚动wrapper固定overflow-x样式、表格不撑破外层，使用既有主题token；不保存列宽、滚动或新增表格交互状态。允许必要固定样式落既有样式文件，不建立表格平台。
5. **范围和原文**：顶层table必须满足既有可靠raw范围，BOM及混合EOL仍原坐标；单元格下缺position的autolink节点照既有文字/语义消费者处理，不借父范围补齐。补空cell只是React展示，不回写mdast。所有读模式操作不修改controller raw/history/save基线；safe及旧解析失败继续原降级。`components/reading-view.tsx`仍用现有canonical owner与memo路径，原则上不改其生命周期。

正式最小回归（实施后运行，当前未执行）：

- 新canonical table测试沿17例核精确表头/align/行列/单元格正文、缺/多列、escaped-pipe代码、引用/列表/任务容器、BOM/CRLF/loneCR、表格起止及非表格边界。既有corpus/每节点rangesValid不改；如既有表格按段落预期变红，保留失败交主线判断，不静默弱化判据。新增语义预期与位置可用性分列，不把缺位置视作可伪造。
- `security/commonmark-content.test.tsx`用真实canonical树SSR核完整混合正文/邻接顺序、thead/th scope及列数补齐截断；真实单元格HTML夹具以pipe开行，例如`| <b>x</b> | <img src=x onerror=alert(1)> |`，先断其确位于tableCell，再核标签字面文字和无活动DOM，不复用script开行终止表格来冒充此测试。额外保持script开行终止表格作为边界回归。GFM组合含删除线、task容器、URL/邮箱及既有自动链接缺位置类；链接inert、无原始活动input/HTML表格白名单扩张。
- 审计测试拒绝任意align/style/事件属性/非法scope；宽表头×短行合成空cell先预算回退，嵌套/多表累计及depth保护不漏。SSR不证明真实DOM安全/资源事件或横向滚动可用。
- `client/current-canonical.test.ts`及协议相关测试核新profile接受、旧`...autolink-3`拒绝，旧revision/session回执不能呈现；编辑profile保持原值、不接受canonical身份。保留原文/history相关回归。主线后续实际WK验证表格对齐/横向滚动/浅深主题、只读阅读、切模式标签不dirty、safe与退出；本节不预记通过。

此方案仅有限生产候选；未改生产、依赖、版本、未跑SSR/构建/UI/Git。S02三模式完整能力、F054单元格编辑、F045父及offline-final继续开放。

## 有限生产实现与定向证据（2026-10-13，待独立复核）

主线全文读取上述方案并批准实施后，已完成固定canonical table依赖/profile4及受控React表格。原HTML白名单/净化、Lezer grammar/wire、编辑单元格、controller/raw/history均未改；应用版本仍由主线管理，本lane未构建/UI/Git。

实际文件：`apps/desktop/package.json`、`bun.lock`仅新增两直接依赖及必要`markdown-table`传递依赖；`client/canonical-parser.ts`、`shared/markdown-profile.ts`；`security/commonmark-content.tsx`；新增`client/canonical-table.test.ts`、`security/commonmark-table.test.tsx`，扩展`client/current-canonical.test.ts`并将`client/canonical-autolink.test.ts`的精确当前profile断言同步4。未更改旧corpus或rangesValid。受控renderer使用官方类型判别，不含any/props透传；表头固定列数、合成空cell、tbody及行开销在数组构造前统一预扣work，inline后代继续计费，深度不足或合并多表超预算整次原文回退。固定Tailwind类与th scope审计，不添加任意align/style/事件权限。

失败历史与修正：首轮typecheck新增table switch漏闭括号报TS1128、reader测试无法加载，同时旧autolink profile3精确断言失败；补闭括号及仅该身份断言后旧corpus等17/288通过。新增table测试首跑6通过/1失败，是测试误将prepareReadingHtml的返回字段写成status=rejected，实际API为mode=source；改为真实API并断被拒原HTML的sanitizer调用0次。后续typecheck指出测试嵌套RootContent未收窄BlockContent及异构属性记录类型，已用官方判别类型收窄修正；定向lint指出import排序、无必要非空断言、正则多余转义，均局部修正，没有disable或阈值调整。

最终实际命令与结果：

- `bun test apps/desktop/src/client/canonical-table.test.ts apps/desktop/src/client/canonical-markdown.test.ts apps/desktop/src/client/canonical-autolink.test.ts apps/desktop/src/client/current-canonical.test.ts apps/desktop/src/security/commonmark-content.test.tsx apps/desktop/src/security/commonmark-table.test.tsx apps/desktop/src/client/gfm-strikethrough.test.ts`：39 pass / 0 fail / 806断言 / 7文件，297ms有限本机样本，非SLO。
- `bun run typecheck`：exit0；对上述改动的7个TS/TSX文件运行`bunx --no-install eslint --max-warnings 0 ...`：exit0；仅本轮源码/测试使用prettier，未格式化其他模块。
- `bun run check:feature-docs`（含obligations）、`bun run check:lockfile`、`git diff --check`：exit0。

已证：真实canonical表格与完整混合SSR字符串、少多列、实际tableCell内HTML字面呈现/无活动资源节点、原HTML table前检0净化调用、BOM/EOL/缺位置autolink、合成空cell与多表全局预算/嵌套深度、旧profile与revision/session/cancel晚回执拒绝。既有corpus未变化且通过。受控Worker/SSR不证明真实DOM资源安全、滚动/主题/焦点或WK验收；独立代码复核、主线全量和打包实操仍待完成。S02三模式与F054/父/完整义务/offline-final不关闭。

## alpha132 实际验收发现与待修正（2026-10-13）

源码全量1032/29681、包内Bun运行仓库1032/29682（不是包内测试文件），均0fail；type/full lint/docs/lock/diff通过。独立Spec39/806/7文件、Standards26/416/4文件均0必要代码阻断。构建命令`AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary`成功；alpha132/hash`1pclsdocnvf5l`，直接解包`/tmp/agentic-direct132.qmoYuq/Agentic Markdown-canary.app`，无安装完成窗口。日志`/tmp/agentic-f045g-{full-test,packaged-bun-test,alpha132-build}.log`。

自建样本目录`/tmp/agentic-f045g-ui.kvf9d2`：tables.md原SHA`dc6987210b292951f0fa3815ea9e247d292ae4cc209f81a2e29a9e87013c6599`，readonly.md原SHA`49425b7d5991fe752f17700b3f691035746da5c6fdc13761a0294c3350ffa027`，后者验收权限444，结束须恢复644。仅操作自建样本、不保存正文、不改网络。首次运行exec12246，恢复本轮时观察到空欢迎窗口且进程69107/69108不同于旧日志66563，退出/重启原因未知，不推断。主线正常CmdQ退出空窗口并核进程消失，以同包、同临时HOME和故障诊断开关重启exec3916，日志alpha132-resume.log；连接成功。

实际WK有限证据：表头三列与左中右对齐、少列补空、多列不呈现、转义pipe/代码/实体、强调/删除线、引用与任务内表格均观察到；阅读审计95元素通过，单元格HTML字面显示、裸URL无活动链接，原始HTML table仍原文回退。宽表普通right滚动尝试无视觉变化，随后拖实际横向滚动条，截图确认E/F末列完整可达且外层未撑开。源码仍含全部多余列/原标记，切换不dirty；将12345工具输入改为67890，阅读revision5正确更新，一次undo恢复clean、redo恢复67890、再undo clean，跨标签后revision8正文及95元素审计正确。只读样本阅读13元素审计通过，源码输入X无变化/未dirty/保存禁用。自然IME、离线及完整图片授权交互未实操，不能扩大结论；打开请求计时含选择器操作，不当文件I/O性能。

两项发现分开处理，当前未验收、不得Git：

1. App浅色/深色已实际切换，纸页阅读仍米色底，但表格边框沿`border-border`随App深色变白而过浅。独立Spec确认新增table未沿现有`--reading-border`，这是本片收尾修正项。最小方案：仅在现有阅读CSS作用域把th/td加入`--reading-border`规则，不扩HTML审计/属性、不改解析或结构。主线已检查现有blockquote/hr同类规则并批准此窄修；需CSS测试、独立复核、alpha133重新构建及实际浅深/阅读主题检查，不把132外观当最终通过。
2. 阅读模式点击诊断“解析故障”后无即时AX变化，再切编辑出现pending安全源码提示且模式出口禁用；跨只读标签正常，回A仍pending、正文clean。独立真实controller临时loop`bun /tmp/agentic-reading-fault.P5pE6n/repro.ts` exit1，普通段落及table同红；`reopen`参数close/reopen clean样本恢复绿。相关五文件对HEAD零diff，只证明既有调用链亦包含缺口，不称所有历史版本已bisect。待定位/单独登记，不能记safe验收通过。本轮不强改恢复策略。假设排序：阅读无MemoryEditor恢复通知消费者；table专属故障（普通段落同红反证必要性）；busy/IME屏障（默认false仍红反证必要性）。
