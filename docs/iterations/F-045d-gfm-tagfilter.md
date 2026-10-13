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
