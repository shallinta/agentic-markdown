# F-045d：固定GFM tagfilter

## 当前结论：本批不生产，保留待实现（2026-10-13）

主线全文读取实验结果，独立Standards复跑36例及14重编/10边界差异/4前检准入，确认记录0必要阻断、生产前置仍未满足。主线采纳本批延期D，集中完成B+C；不放宽安全，不把实验通过当功能交付。后续恢复须从末节真实sanitizer/序列化与有效呈现前置开始，明确畸形slash和保真策略，S-05a/完整父及offline保持开放。无D生产、仓库依赖或新版本改动。

> 状态：最小方案待主线全文读取与独立Spec复核；未实验、未生产。2026-10-13。拟与任务续写合批自动检查/打包验收，各片保持独立结论。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## 产品依据与前置

能力总账S-05a、S-GFM/S-GFM-A确认固定首方GFMExtension中的tagfilter，过滤会改变HTML解析上下文的原始标签；不替代完整渲染安全策略、不提供子开关。F045a已交付固定profile与安全消费者；F045b目前仍实际验收中，不能预写通过。本片基于同批最终固定profile，旧结果失效与三模式回归联合验证。

## 最小功能与公开接口核查

目标是按官方GFM tagfilter的标签集合、大小写与词法边界处理原始HTML呈现，同时保留磁盘/源码字节和编辑原文。普通文本、code/fence、已转义标签不得误过滤；不是一律删除HTML内容，也不是解除现有净化。

本地已安装canonical是`mdast-util-from-markdown`，现有任务/删除线扩展不提供已核实的tagfilter接口；本轮本地搜索未找到可直接采用的公开tagfilter函数，不假定其会改变mdast结构。现`commonmark-content.tsx`将HTML交受控阅读管线，源码与编辑不执行原HTML。应先核官方包/规范的过滤阶段与现HTML净化顺序，再决定最小适配位置；候选可调查官方`micromark-extension-gfm-tagfilter`/`rehype-raw`相关公开能力，但包存在性、精确发布版本和适用接口尚未核实，不授权安装或直接依赖。

必须区分“现安全层已拒危险DOM”与“GFM规定的字面显示语义已实现”。如果官方能力仅为HTML序列化过滤，不能把它误装为fromMarkdown语法扩展；先提交明确公开接口/小型规范适配路线供批准，不复制依赖私有算法或引入通用HTML引擎。

## 获批后隔离验证与最小接线候选

先临时pure转换/渲染driver对照官方规范/公开库：九类受限标签title/textarea/style/xmp/iframe/noembed/noframes/script/plaintext，大小写、开始/结束标签、空白/斜线边界、相似合法标签名；inline/block、属性含引号、嵌套普通HTML、实体/转义、code/fence、BOM/CRLF。断言字面可见内容与无危险DOM分开，不仅sanitizer exit0。具体包版本经主线/独立核实后才临时安装；不得凭候选名创建依赖。

若路线成立，仅固定profile配置与HTML呈现前的明确过滤边界接线，DOMPurify、URL策略和隔离阅读保持最后安全边界；缓存/request/response/wire版本同步拒旧。若Lezer树语义不变，明确无需新增树节点而非伪造树转换；格式/结构命令保持原文。不得把预转义后的文本写回raw或影响undo/save。

happy path：含危险原始标签的Markdown在阅读显示规定字面内容且不执行，普通HTML仍按既有允许策略；编辑/源码往返原文不变、无dirty；同包任务与删除线回归。真实WK需核可见文本、浅深/安全降级，不以纯模型证明DOM安全或完成验收。

## 继承约束与义务

- 中文与外观：沿原中文错误提示及主题，原始字面标签可辨，不新增复杂设置。
- F-002：固定本地依赖/规范，无网络解析，无磁盘重写；最终离线人工。
- 命令与键盘：本片无新写命令/快捷键；查找/选择/复制不得把过滤误当原文修改。
- 安全与日志：tagfilter不替代净化、不开放input/script/任意HTML属性；日志不含用户正文。
- 生命周期与性能：沿既有HTML块/字节预算、缓存和失效，不每键全文HTML重解析，不设新SLO。

当前总账无F045专属主承接OBL，主责none；协作F020/OBL030安全、F012/OBL068和F013/OBL069外观、F074一致性。父GFM、全部余项及`F-045d-offline-final`开放，F028c/专项不推进。该方案不代表接口或生产路线已证实；主线与独立复核批准后才实验，之后另批实现。

## 官方接口与本地接入调查（2026-10-13，非生产批准）

本轮先读本地 `client/canonical-parser.ts`、`security/commonmark-content.tsx`、`components/reading-html-block.tsx`、`security/reading-html.ts` 与 `security/safe-content.ts`，再读取下列官方规范与上游源码。网页搜索工具首次遭 429/Cloudflare，随后通过只读 HTTP 取得官方页面及仓库原文；未安装依赖、未执行转换实验、未改生产或 UI。

### 已核实的规范与公开接口

- [GFM 6.11 / Example 657](https://github.github.com/gfm/#disallowed-raw-html-extension-) 指定 `title`、`textarea`、`style`、`xmp`、`iframe`、`noembed`、`noframes`、`script`、`plaintext` 九类原始 HTML 标签，在输出 HTML 时转义其起始 `<`，而不是删除标签或内容；示例明确大小写变体。其他标签不由 tagfilter 改写，但仍受本 App 更严格的安全策略约束。
- [GitHub cmark-gfm 参考实现](https://github.com/github/cmark-gfm/blob/master/extensions/tagfilter.c) 检查 `<` 后可选 `/`、大小写不敏感的完整名称，名称后须为空白、`>` 或紧邻的 `/>`。因此相似长名称不能仅靠前缀命中；`< script>` 不是同一词法形式。规范本节未穷举全部畸形 HTML，不能把任意相似字符串都宣称规范要求转义。
- [micromark 官方包文档](https://github.com/micromark/micromark-extension-gfm-tagfilter) 的准确公开接口为 `gfmTagfilterHtml(): HtmlExtension`，通过 `micromark(..., {htmlExtensions: [...]})` 使用；它不改变 Markdown 解析、不是 `fromMarkdown` 的 syntax/mdast 扩展。示例开启 `allowDangerousHtml` 是编译器用法，不是允许本 App 开放危险 HTML 的授权。
- [npm 官方 registry 的 2.0.0 元数据](https://registry.npmjs.org/micromark-extension-gfm-tagfilter/2.0.0) 已确认版本真实存在；所载 gitHead 为 `a5309cf90b76c0567398880bdfb3c9e62e4a9c20`。[该发布对应实现](https://github.com/micromark/micromark-extension-gfm-tagfilter/blob/a5309cf90b76c0567398880bdfb3c9e62e4a9c20/lib/index.js) 对 flow HTML 全局处理、对已被严格解析的 inline HTML 仅检查开头；边界字符为 tab/LF/FF/CR/空格/`/`/`>`。这里单独 `/` 即命中，与 cmark 的 `/>` 条件有差异，尤其畸形 flow HTML 必须保留双参考结果，不能默默视为完全等价。本轮只核存在性，未称 2.0.0 是最新发布。
- [hast-util-raw 公开接口](https://github.com/syntax-tree/hast-util-raw#api) 为 `raw(tree, {tagfilter: true})`，该选项默认 false；它会以 parse5 重解析 HAST 与 raw 节点。接口真实存在，但本 App 目前是 mdast→受控 React/HTML 管线，不能将它直接传给 `fromMarkdown`，也不建议为九类标签引入整套 HAST 重解析路线。

### 当前管线关系与必要缺口

canonical 目前只注册删除线与任务列表的官方 micromark/mdast 扩展，保留原 HTML 节点及原始位置。阅读层 flow HTML 使用原始切片，并检查其与 `node.value` 相同，再进入 `ReadingHtmlBlock`；inline HTML 直接作为 React 文本呈现。编辑/源码的原文、选区、保存和历史不应增加转义。

flow 安全顺序为 `preflightReadingHtml` 词法白名单和预算 → DOMPurify → 固定 DOM 审计 → 序列化与输入严格相等的保真检查。现九类危险标签会被前置检查拒绝，完整显示原文；这仅证明现有安全边界，不等同于 GFM 输出语义完成。特别是前置检查拒绝“没有任何允许标签”的纯文本片段，净化器又要求 `container.innerHTML === source`：仅将 `<` 换成 `&lt;` 后送入原入口，纯受限标签块仍可能回退，实体/`>` 的序列化也需验证。不得默认删除严格检查或扩大 HTML 白名单。

### 提交主线批准的最小路线建议

1. 先批准临时、有限的原始 HTML 呈现转换实验；输入只来自已解析的 HTML 节点，不扫描/改写整份 Markdown，不处理代码、转义文本或普通 text 节点。以规范 Example 657 为直接断言，以上述公开编译接口作对照，畸形 slash 差异单独记账，不复制依赖内部 token handler 当公开 API。
2. 若确定需要独立小型纯词法适配，只依据明确规范写有界、保留大小写和原文的呈现转换，并明确选择哪种畸形边界；此时原始切片与派生 HTML 必须分离，失败回退仍展示原切片，不能展示二次实体编码。过滤先于任何 HTML DOM 解析/净化，净化仍不可省略。
3. 实验必须同时验证纯受限标签块、普通允许标签包围受限标签、属性/注释中的相似序列、实体及未闭合标签。需证明如何保留现有安全前检/保真约束而得到预期可见文本，再收敛最小生产接口；可以考察不经 HTML parser 的纯文本输出分支，但不能以任意拆分字符串破坏普通 HTML 嵌套，或以宽松 DOM 解析绕过资源前检。当前尚无此接线的实验证据，故只建议进入隔离验证，不批准生产。
4. 原始及派生输入均沿既有块/累计预算保护，转义增长在送 DOM 前核验；不每键全文重解析。固定 GFM profile 不增加子开关；raw/mdast/Lezer 节点保持不变，呈现/worker 缓存版本须如实失效，不伪造新语法树。真实 WK 的字面内容和危险 DOM 缺失分开验收，代码实验不能代替。

## 2026-10-13：获批有限PoC结果与未满足的生产前置

主线完整读取上述路线并批准仅临时实验；执行子线使用prototype/LOGIC技能，角色从Spec转为本次实验作者，最终须由其他lane独立审核，不能自批生产。临时目录`/tmp/agentic-f045d-poc.00iLd7`，`prototype.ts`纯词法转换，`driver.ts`薄case/all/interactive入口；仅目录内安装`micromark-extension-gfm-tagfilter@2.0.0`、`micromark@4.0.3`，未改仓库依赖、生产、版本或UI。运行`bun /tmp/agentic-f045d-poc.00iLd7/driver.ts all`，最终`run-final.log`exit0；单case例如`example657`，交互命令`interactive`。原`run-first.log`、`run-mapped.log`保留。

问题是“仅已解析HTML节点的有界呈现转换能否匹配官方输出，且能否不放宽现安全层形成有效交付”。候选输入分inline/flow，inline只在节点开头匹配，flow按整个HTML节点；只转义受限tag的起始小于号，不改raw/mdast，也不复制官方内部token handler。官方`gfmTagfilterHtml()`只通过公开micromark HTML扩展使用；`allowDangerousHtml:true`仅产生对照字符串，没有插入DOM、执行脚本或网络加载，不是生产安全配置。

### 实际证据

- 36个固定case含Example657、九tag大写开始/小写结束、ASCII空白/闭斜线/畸形斜线/相似名、inline/flow、纯受限块/混合允许结构、属性/注释中的相似序列、实体/转义、code/fence、BOM/CRLF/loneCR。Example657预期逐字抄自官方HTML示例并实际断言。首次尝试官方`/gfm/spec.json`返回404、JSON读取失败，后改读官方HTML Example657；这只是资料读取失败，不是转换通过或失败。
- 每个case使用当前canonical取得HTML节点及上下文；driver在未过滤的公开compiler输出中顺序定位原HTML节点字面，替换为纯候选派生结果后，与启用官方tagfilter的完整输出逐字相等，36例均通过。此定位仅为有限实验oracle映射，不是可搬入生产的raw/HTML位置算法，不证明任意引用容器/规范化节点都可映射。code/fence/已反斜杠转义case无HTML节点，保持原输出。
- 初轮同时尝试“把派生片段拼回Markdown再重新编译”作为反面观察，36例有14例输出不同：纯`<script>payload</script>`会额外产生段落包装，inline标签的`>`序列化也不同。不能把全部14例都称可见内容错误，但足以否决此重解析接线；不能在生产把预转义内容回写raw或重跑全文Markdown来模拟tagfilter。
- 畸形slash共10例存在双列差异：例如flow中的`<script/no>`，公开micromark扩展转义，依据已读cmark `/>`词法条件的小模型不转义。第二列只是限定边界模型，未安装/运行cmark，也没有对其所有空白/畸形情况作完全等价断言。不是36例统一规范共识，更未自动选择生产畸形策略。
- 对所有派生HTML节点调用真实现有`preflightReadingHtml`，仅4个节点通过：Example657的blockquote片段、mixed的p片段、entity的p片段、mixedEol的blockquote片段；纯受限标签片段没有允许tag，仍被“标签未完整配对”拒绝，带属性/注释/非白名单标签仍拒绝。真实`prepareReadingHtml`加故意throw的sanitizer哨兵证明拒绝项0次调用，4个准入项各调用1次后安全回退。此非真实DOMPurify/DOM序列化通过；仓库没有jsdom/happy-dom/linkedom，未额外安装DOM库或伪造其结果。
- 既有32KiB块预算沿用：输入32769单位先拒；3000个`<script>`输入24000、派生33000，先计增长再拒，不构造派生输出。本实验未验证128KiB累计/256块控制器接线，不称整篇成本保证。

### 结论与精确后续最小计划（待主线/他人审核，不批准生产）

词法节点转换在固定语料具备候选证据，但目前没有同时保持安全前检/严格序列化保真并交付有效增量的生产闭环。纯受限块改为受控原文文本，与现有raw fallback的字面内容通常相同，不能换名便称tagfilter交付；包含实体时，直接原文文本与官方输出的实体解码还可能不同。4个混合准入片段仍须真实DOM验证，尤其派生`&lt;script>`经DOM序列化可能与输入不同，现`createSafeContent`严格相等检查会继续回退；当前只有源码风险推断，不冒称实测该比较已经失败。

建议本批先不实现F045d，不阻碍F045b/c收尾。若后续继续，最小生产接线候选必须先满足：

1. 在获批有限DOM实验中复用真实现有sanitizer及审计，对上述4个混合节点和纯受限/实体节点取得实际模式、可见文本及序列化证据，不执行危险HTML、不绕词法资源前检；若仍需放宽严格保真，先单独批准具体安全方案，不能静默修改。
2. 只在阅读flow HTML入口提供`originalSource`与独立`presentationHtml`；先验证原始node/raw一致性与原/派生预算，转换必须在任何HTML解析前。失败永远显示originalSource，绝不显示双重转义的派生源码。既有inline文本路径不必为无有效增量而重写。
3. 生产畸形slash策略须由主线基于双参考差异明确记录；选择官方micromark边界可作为推荐，但本实验没有替主线作决定。适配只依明确词法规范，不搬driver的整篇compiler/顺序字符串定位，不引入新的HTML AST平台。
4. 只有取得实际有用呈现且所有现安全检查不被暗中削弱后，再批准精确模块/调用点、profile换代与自动回归；随后真实WK核可见文本、危险DOM缺失、原文/模式/dirty及主题。若最低成本路线仍只回原文或需较大安全重构，继续延期，不以实验exit0关闭S-05a/完整GFM/安全及离线义务。

以上是实验作者结果与建议，非独立验收结论。未构建、未UI、未提交推送；临时目录保留为明确标记的诊断证据，未吸收入生产。

## 下一有限真实DOM实验最小方案（2026-10-13，待主线及独立批准）

主线已全文读取本节及实际security-lab/reading-html/safe-content实现。临时入口允许范围限定为新增`components/tagfilter-prototype.tsx`和`components/security-lab.tsx`的opt-in挂载；安全生产模块、普通阅读、依赖及配置协议均不修改。独立Standards复核发现discardGuard只支持单参与者，因此否决新组件独立注册：保留SecurityLab唯一discard注册，由父组件组合停止两个实验；子组件通过稳定回调向父组件登记stop函数并在卸载时解除，独立generation及卸载清理防止迟到挂载。不得修改公共discardGuard。任何fragment必须在挂载前通过原审计；不把已挂载后才检查当准入。Spec其余方案无必要阻断；本项修正复核后由主线批准有限临时编码，不代表生产交付。

本次只回答：先前4个准入的派生HTML片段，经**真实WK的现有preflight → sanitizer → audit → serialize保真**路径后，是否仍全部回退，以及是否存在有效、保真的呈现增量。不先实现tagfilter生产，也不放宽任何安全检查。

### 执行入口与工具边界

现`components/security-lab.tsx`只运行固定securityCorpus且直接调用createSafeContent；没有任意HTML输入或可直接执行本轮prepareReadingHtml的按钮。因此不能声称现包已经能跑本矩阵。推荐主线另批最小临时诊断入口：仅既有opt-in安全实验台内一个固定case表及“运行tagfilter固定对照”按钮，调用生产`preflightReadingHtml`、`prepareReadingHtml`、`readingHtmlSanitizer(window)`和`auditContentDOM`；正常阅读/原固定实验不改。无需安装依赖或DOM库。入口与固定表的临时接线须在本方案批准后另行明确允许文件；若需要打包，由主线统一构建一次实际WK诊断候选。此处不授权当前先写或构建。

工具仅以已允许的CUA原生AX/截图/点击操作该按钮并读取逐条摘要；不shell注入UI、不evaluate任意用户HTML、不用jsdom/happy-dom结果冒称WK。若不批准诊断接线/包，则记录无法执行真实seam并暂停这一实验，不用SSR顶替。实验结束保留结果，临时入口随后按主线要求清理，不提交为产品功能。

### 固定输入（不扩矩阵）

沿`/tmp/agentic-f045d-poc.00iLd7/run-final.log`4个原准入HTML节点逐字取值，不拿整份Markdown重解析：

1. Example657的blockquote节点：`<blockquote>\n  <xmp> is disallowed.  <XMP> is also disallowed.\n</blockquote>`（实际节点末尾换行以原日志为准，执行前打印length及JSON字符串核同）。
2. mixed：`<p><script>payload</script></p>`。
3. entity：`<p><script>&amp; &lt;b&gt;</script></p>`。
4. mixedEol：`<blockquote>\r\n<script>x</script>\r<style>y</style>\n</blockquote>`。

另仅3个对照：纯受限`<script>payload</script>`、纯受限带实体`<script>&amp; &lt;b&gt;</script>`、普通允许结构`<p>safe</p>`。固定原/派生字符串在临时纯模块预先生成并以已核官方输出对照，不在WK临时执行官方HTML编译器，也不引入未经批准的通用转换。记录micromark词法列；本轮不增加畸形slash样本或决定其生产规则。

### 安全执行顺序与观测字段

- 原始/派生长度在任何DOM步骤前核既有32KiB块预算；输入仅上述自造固定字符串，不读取用户文件/URL，不含网络或资源属性。逐case先记录原始前检与派生前检；**只派生前检通过才可调用真实sanitizer**。前检拒绝项的sanitizer调用计数必须0。
- 使用包装计数的真实readingHtmlSanitizer(window)注入prepareReadingHtml；不改配置、不替换DOM、不绕前检。记录sanitizer自身mode/reason、返回fragment审计、textContent及其clone置入离线空div后的innerHTML；这只是对**已净化返回片段**的观测。若sanitizer已source回退，日志明确其fragment是派生字符串的文本回退，不能当成中间净化结果；不通过额外裸DOM解析“偷看”失败前的危险输入。
- prepare若sanitized，才将已审计fragment挂入实验区域；若source，区域只用createTextNode(originalSource)，始终展示原始片段而非派生转义字符串。记录prepare最终mode/reason、mounted textContent、outer结构/零属性审计与source回退是否逐字等于原文。所有原/派生调试字符串也只通过textContent显示，不能innerHTML插入。
- 每条摘要分独立AX文本项：case、original/derived长度、前检理由、sanitizerCalls、sanitizerMode/Reason、prepareMode/Reason、audit、serializedEqual、visibleText(JSON)、原文fallbackEqual、耗时。完整固定结果可保留在本轮唯一，不收集用户正文。序列化相等在sanitized时与派生输入比；source时单独列为回退片段序列化，不能据其不相等推断内部DOMPurify具体输出。
- 正常取消/关闭沿现generation和discard生命周期，仅取消后续case，不声称中断同步sanitizer。主线用截图核可见字面内容与普通允许块外观，既有默认事件阻止可复用；没有网络仪器则不称证明绝对无网络。

### 判据与停止条件

安全与有效呈现分开：任何前检拒绝仍调用sanitizer、危险/带属性DOM进入挂载区、source回退显示派生源码而非原文，均实验失败并停后续。保持安全但全部source回退也是合法实验结果，却不能据此宣称tagfilter交付。普通`<p>safe</p>`须sanitized作为真实环境正对照；否则先记录环境/既有路径问题，不解释为tagfilter结论。

4个混合样本若因`&lt;…>`序列化规范化失败，只能记录准确mode/reason与可取得的返回值；不得删除严格相等检查。若至少存在有效增量，再按证据提出独立原文/派生HTML最小生产接口；如必须调整保真策略，必须另提具体安全设计、独立审核后才编码。纯受限带实体的规范可见文字与原文回退不等价应明确，不靠exit0掩盖。S-05a、完整F045、协作OBL030及offline-final继续开放。

当前只追加此方案，未安装、未运行新实验、未改生产、版本、构建/UI或Git。

## 获批临时WK诊断入口实现（2026-10-13，尚无DOM实测）

主线及独立复核批准限定入口后，新增`apps/desktop/src/components/tagfilter-prototype.tsx`，仅在既有opt-in `security-lab.tsx`挂载。固定7组原/派生字符串，无任意输入或WK编译器；父组件仍唯一discard参与者，通过稳定registerStop回调组合取消、卸载identity匹配解除；子generation取消后续样本并清本地事件。普通阅读、安全模块、依赖及配置协议不改。

实际入口固定字符串由临时`/tmp/agentic-f045d-poc.00iLd7/wk-fixed-oracle.ts`读取字符串字面量，分别与原project候选及官方micromark+gfmTagfilterHtml对照；`bun /tmp/agentic-f045d-poc.00iLd7/wk-fixed-oracle.ts`为7/7逐字相等、exit0，`wk-fixed-oracle.log`保留输入/派生/官方结果。无DOM/脚本执行，原14重解析差异及安全前置失败历史不变。

诊断实现先核两侧预算/前检，仅prepare准入才调用真实sanitizer，记录调用数；返回片段审计通过后clone观测，任何审计失败停止后续而不被prepare的回退catch掩盖。sanitized片段再次审计才挂载，source始终createTextNode(original)；逐字段独立AX摘要，明确source返回序列化不是内部净化中间值。普通允许p作为正对照。没有测试/构建/实际WK结果提前宣称。

`bun run typecheck`通过；两文件`bunx --no-install eslint --max-warnings 0 ...`通过。首轮lint有两条effect清理ref警告，改稳定失效函数及捕获清理数组后消除，没有disable。仅两临时组件和本唯一记录有本lane变更，已冻结待独立审核；主线负责诊断包与真实WK，不属于tagfilter产品交付。

## 实际WK结果：简单派生接入无有效增量（2026-10-13）

独立Standards代码复核0必要阻断后，主线递增alpha.131并执行`AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary`，exit0；日志`/tmp/agentic-f045d-alpha131-build.log`，产物hash`1n4l2ic73buth`。直接解包官方更新artifact到`/tmp/agentic-direct131.9AKTfT/Agentic Markdown-canary.app`并核version.json；隔离数据目录`/tmp/agentic-f045d-ui.QI1lZr/data`，同时设置PERF_LAB/SECURITY_LAB启动inner launcher（exec72332）。首次精确路径CUA连接成功，无安装完成窗口；不据此推断旧超时根因。

通过原生AX点击“运行tagfilter固定对照”，实际显示7/7完成，再滚动取得完整摘要与截图；结果如下。长度为JS字符串单位，耗时为本次诊断同步测量，不是性能保证。

| 固定case | 原/派生长度 | 派生前检 | sanitizer次数/模式 | prepare | 挂载前审计 | 原文回退相等 | 本次ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| example657 | 76/82 | 通过 | 1/source | source | true | true | 3 |
| mixed | 31/37 | 通过 | 1/source | source | true | true | 0 |
| entity | 39/45 | 通过 | 1/source | source | true | true | 0 |
| mixedEol | 63/75 | 通过 | 1/source | source | true | true | 1 |
| pure | 24/30 | 标签未完整配对 | 0/未调用 | source | true | true | 0 |
| pureEntity | 32/38 | 标签未完整配对 | 0/未调用 | source | true | true | 0 |
| allowed | 11/11 | 通过 | 1/sanitized | sanitized | true | 不适用 | 1 |

前6例原始前检均拒绝不支持标签，allowed原/派生均通过。前4例sanitizer/prepare准确理由均为“净化或格式规范化改变了输入，本片保守显示完整源码”；返回fragment审计true、serializedEqual=false、serializationKind为fallback-text-not-intermediate-DOM。此序列化只来自净化器返回的文本回退片段，不是内部净化中间结果，不能据它定位具体哪一字符规范化。allowed返回text为`safe`、序列化为`<p>safe</p>`且相等，截图也显示safe而非标签。6例可见区域均原文，未把派生实体源码当用户原文；mixedEol逐字相等由现场字段验证，AX空白折叠不能替代此精确检查。

随后点击既有安全语料得到8/8通过（不扩大为通用网络/原生下载证明）。本次仅浅色实验台、一次7例完整运行；取消在途竞态、深色、任意HTML和自然输入未实操，不需要为丢弃实验声称全产品验收。未打开/保存用户文档、未改网络。通过CUA `⌘Q`正常退出，工具返回App quit，exec72332 exit0，ps无该包进程。

结论：已取得真实WK证据，简单转义后复用现有严格入口在6个tagfilter样本无有效呈现增量；生产接入仍不批准。保留F045d/S05a及父功能开放，后续须另拟保真与原文分离的具体安全方案，不能移除检查冒充完成。临时组件副本留`/tmp/agentic-f045d-poc.00iLd7/tagfilter-prototype-wk.tsx`和`security-lab-wk.tsx`作为诊断证据，alpha131仅实验包，不作为功能交付。

临时组件已用apply_patch删除，SecurityLab与HEAD逐字无diff，源码无残留引用；清理后typecheck、feature-docs/obligations及diff通过。独立最终Standards确认0必要研究收尾阻断，并核入口清理/无运行进程；主线批准本次有限研究收尾，不是F045d功能验收。没有新增生产代码，不以旧全量测试数字冒称本次新跑。版本131保留实验使用记录，不倒退或重包；下一修改代码打包从132起。手册同步未交付状态；Git待主线执行核验。
