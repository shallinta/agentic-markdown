# F-045f：GFM 自动链接识别与非活动呈现

## 本片通过（2026-10-13）

最终独立Spec（26项406断言）与Standards（22项367断言）均确认0剩余必要代码/有限验收阻断；主线正式批准alpha130阅读有限片受托Agent代验通过，非用户亲验。最终源码1024/29526、type/full lint、文档义务与diff均通过；实际WK、官方语法边界、失败及未测范围见下文。当前无运行实例，两自建样本原样644；Git待实际执行。编辑/源码自动链接、完整S05/F045及三模式一致性、F055、专项与offline-final保持开放。

## 实际WK收尾候选（2026-10-13，待最终独立复核）

独立Spec实际复跑完整官方GFM五例，确认中文句号组合是既定规范解释边界，无需新增产品选择；主线按既有连续授权保留官方语义，不加裁剪器。仅新增两项正式测试，生产算法和产物alpha130/hash1ny8rt4kta46x未变化，因此不重复打包。最终源码全量1024项29526断言通过（25.92s）；此前包内Bun运行仓库1022/29508在追加两项测试前完成，数量差异如实保留。

重启同一inner包exec50670首次连接成功，实际自建links.md：源码显示完整实体/转义/标记且clean；EOF输入https://new.example变dirty，一次undo恢复clean，redo后切编辑及阅读保留追加文字；阅读revision21审计49受控元素，退出阅读再undo恢复clean，重进阅读revision22/48元素，无模式切换新增撤销项。点击包含URL的正文后按Tab转到文件树而非链接焦点，未见浏览器/应用内导航；只是有限UI观察，没有网络监测，不能称实测零网络。

初次深色App+纸页正文、后续实际选择浅色（第一次点击选项后Escape未生效，改Home/Return确认Value浅色）截图均可读，任务链接下划线、行内代码不做链接。未切其它阅读主题包/系统动态主题，未宣称全矩阵；原生视图菜单Escape未关闭，按已暴露Cancel动作关闭后继续，无生产修正。

readonly.md改444后通过原生选择器打开，权限只读；切阅读显示完整文字，revision0/2顶层，DOM审计6元素通过，无编辑控件。切回links.md恢复revision22/11顶层/48元素、clean，不混入只读文档。回编辑后触发既有呈现故障，切安全源码显示完整原文、无阅读切换按钮、clean。两文档clean后⌘Q正常退出，exec50670 exit0、CUA App quit；两SHA保持基线、readonly恢复644，未保存用户正文。

边界：真实原文精确BOM/EOL及缺profile竞态由自动测试覆盖，不冒称肉眼/物理输入全矩阵；本片未重新自然IME、系统主题、极端性能、网络/离线、原HTML浏览器复杂矩阵。受控自动测试与实际WK分别记录，编辑/源码自动链接及三模式一致性、F055、完整父与offline-final仍开放。当前仅最终验收候选，不提前Git。

## alpha130 实际验收发现（2026-10-13，未通过）

诊断补证：精确原行末有中文句号。`~~删除 https://example.com~~`本身正常，`~~删除 https://example.com~~。`失败；最小`~~https://a.b~~。`由主线复跑`bun /tmp/agentic-f045f-strike-red.BF9rCq/repro.ts '~~https://a.b~~。'`得到exit1：旧配置delete1、新配置delete0，URL实际为`https://a.b~~。`，SSR忠实呈现。不能把下文省略句号的引用当完整复现输入。syntax或mdast顺序交换未解决，官方完整组合临时对照待完成；尚未判断这是集成错误还是规范组合语义，不能预先写为需自定义裁剪的bug。公开搜索工具HTTP429失败不作为规范证据。

构建exit0，产物版本alpha.130/hash `1ny8rt4kta46x`；冻结源码及包内Bun运行仓库各1022项29508断言全绿。直接官方tar解包到`/tmp/agentic-direct130.P5WiCD/Agentic Markdown-canary.app`，隔离AGENTIC_MARKDOWN_HOME并启用既有故障实验，inner launcher exec16437，首次CUA连接成功，无安装完成窗口。不是旧超时根因证明。

真实打开自建links.md后编辑clean，切阅读actual Worker完成revision0/11顶层/9ms，挂载DOM审计48受控元素通过。实体、转义、大小写及Unicode链接文字出现，任务只读状态、行内代码和围栏原文保留；但`~~删除 https://example.com~~`在阅读AX显示原样结束标记而非删除线，与编辑strike表现不同。本片不验收，不提交；进入diagnosing-bugs临时最小parse/SSR及旧配置对照，尚未推断原因或批准修法。主题/只读/safe/点击/历史等完整实操未完成，不能引用本次为通过。

所有正文未修改、未保存；阅读已保存状态后⌘Q正常退出，launcher exit0，CUA报App quit。两fixture SHA与上述基线相同，readonly恢复644。当前无运行验收现场，保留alpha130产物与失败证据；修复后重打包须升131。

## 代码复核与构建检查点（2026-10-13）

最终独立Spec、Standards均0必要代码阻断，各定向7文件41项810断言通过；非真实验收。主线全量1022项29508断言通过，最终full lint通过；最后测试fixture构造与公开encode/decode往返断言调整后再跑冻结全量中。前次full lint对Tree默认toString报两处错已改为公开结构往返断言，无disable。主线将manifest及lock统一升alpha.130并启动canary构建，尚未宣称产物成功/实际WK或Git。

自建实际验收目录`/tmp/agentic-f045f-ui.tqCjIG`，links.md SHA256 `1af049376664206e983df0f907164a50a5ba54012985ae9e6712959665a1cae7`，readonly.md `9a20dfad8bcfd066b58049f56ac42177e8fc87a2bd8d84246ef70c7e53283f12`。仅测试样本，不保存用户正文、不执行离线网络操作；预期沿官方语义核完整文字，不假定中文邻接全被排除。

## 消费者核查与下一有限实验（2026-10-13）

用户要求继续后，主线与两独立调查确认：公开mdast节点位置可选，转换生成Link/Text缺位置并非官方违约；current-canonical只核身份/config/root等，不逐子节点要求位置；阅读link分支仅递归inert span，滚动锚点用顶层块位置。HTML/code/未知节点原文分支仍要求自身位置，规范实验rangesValid全节点判据也仍不满足。不得据此宣称实际阅读已通过。

Lezer公开wrapper只能小范围门控mailto/xmpp和现有Link/Image内的独立装饰；大小写、Unicode域名与实体/转义不能只修改入口参数修好。当前canonical owner整文按需Worker并非现成每键增量缓存，将其搬入编辑热路径或增加语义映射引擎属于另需设计的路线，未批准。

主线已阅读两方源码调查，并批准下一步仅prototype/LOGIC隔离消费者实验：复用临时已装官方候选，将未改位置的树送进真实commonmarkContent静态呈现，核文字、非活动属性、是否完整原文降级、顶层范围；受控Worker回执送真实currentCanonical owner核接收及旧revision/session/config拒绝。包含缺位置六类、代码/HTML邻接、BOM/EOL；保留失败。无需仓库依赖/生产改动，不启动WK，不构建/版本/Git，不将SSR或受控Worker声称真实窗口/真实线程验收。结果先独立复核，之后再决定是否将阅读消费者拆为独立可交付切片；尚未变更三模式产品目标。

> 状态：有限隔离PoC已冻结；作者、主线与独立Spec均复跑30例/18项诊断，直接注册路线不采用。主线已全文读取末节结果，生产未批准，应用仍alpha.129。2026-10-13。

当前有限交付范围：主线及Spec复跑消费者15/0后，主线选择先规划canonical/阅读自动链接非活动呈现；末节新增生产方案仍待全文阅读与独立批准。编辑/源码裸URL识别与外观本片不实现、不降低既有编辑能力；原三模式目标保留为完整S-05/F-045父目标。下文最初三模式接线设想属于研究历史，不是本轮生产范围。

独立核对追加判据：缺失position单独报告，禁止借父范围或字符串搜索伪造精确raw范围，注明原文/规范化坐标；比较完整相关内联树及可见文字，不只URL数量。mailto/xmpp识别不授权执行；有限支持域仅作为后续方案建议，差异/raw回退/非DOM实验不计三模式交付。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## 功能说明与产品依据

S-05确认GFM裸URL/邮箱识别，S-GFM/S-GFM-A规定统一固定版本首方扩展、无子功能开关。本片拟补三模式识别与呈现，不接F-055点击导航：不打开浏览器/邮箱、不请求网络、不授权文件或新原生桥。F045e已推送42ad894f0f171edbbd2afe88c947615e71ef2e80，主线核远端一致；F045d仍研究，不随本片放宽HTML安全。

普通编辑为可靠可见裸链接添加非活动外观，不隐藏或替换其任何原文字节；源码保留全部原文并按URL token着色；阅读沿现有link非活动span呈现文字。已有尖括号CommonMark自动链接和明确行内链接保持，不把它们误称GFM新增。没有href、点击/⌘点击处理、tab导航目标或预加载；实际目标URL仅供语义验证，不作为执行授权。只读允许呈现，safe保持原安全源码边界。

## 本地官方API与依赖调查

- 已读本地`@lezer/markdown@1.7.2` README、公开dist/index.d.ts及对应实现。公开`Autolink: MarkdownConfig`可经parser.configure使用；文档列www/http/https/mailto/xmpp及邮箱。当前实现产出`URL`节点，不是既有尖括号`Autolink`容器，且名称相同不证明与canonical全部边界一致。保留现双删除线适配和任务Paragraph投影，不引入整个GFM数组而意外启用TaskList/Table。
- 当前仓库未安装literal-autolink两个包。已只读核npm精确发布元数据：[micromark-extension-gfm-autolink-literal 2.1.0](https://registry.npmjs.org/micromark-extension-gfm-autolink-literal/2.1.0)、[mdast-util-gfm-autolink-literal 2.0.1](https://registry.npmjs.org/mdast-util-gfm-autolink-literal/2.0.1)，候选均真实存在，不声称最新版。后续获批PoC仅临时安装它们及与仓库同版的必要解析依赖，不能先改仓库package/lock。
- [micromark官方API](https://github.com/micromark/micromark-extension-gfm-autolink-literal)提供`gfmAutolinkLiteral()`语法扩展；[mdast官方API](https://github.com/syntax-tree/mdast-util-gfm-autolink-literal)提供`gfmAutolinkLiteralFromMarkdown()`，配合现fromMarkdown 2.0.2的extensions/mdastExtensions，产出既有Link类型。仅此候选组合，不需要HTML编译器或toMarkdown写回。
- 官方说明两种识别阶段：micromark处理解析期，mdast扩展还处理转换期，实体/反斜杠可能导致不同结果。因此不能假定Lezer单次解析已覆盖官方canonical，也不能仅比较裸URL简单样本。精确range/显示文字/目标URL与缺失位置均须实测；差异先报告，不关掉官方transform或复制私有算法以凑绿。

现live-formatting只对Link/尖括号Autolink做受限呈现，对URL已有剪枝；需区分裸URL节点与现有链接目的地URL子节点，不能遍历任意URL都画成正文链接。现阅读link/linkReference为带中文“链接打开尚未接入”提示的span。link-presentation测试的“裸URL无隐藏”只能证明不隐藏，不能证明新识别或外观生效。

## 有限隔离PoC计划（编写时未批准；现获批，见顶部）

主线完整读方案并独立核对后才运行。按prototype/LOGIC使用mktemp纯解析候选与薄case/all/interactive驱动，无仓库脚本或正式测试框架。输入使用当前strike/task固定配置作基线，候选只增自动链接；打印两树与精确原文范围、显示文字、目标URL，区分原CommonMark链接和新裸链接。Lezer没有目标属性时只用公开源码切片作待核解释，不冒称有与mdast同型节点。

有限矩阵：`www.example.com`、http/https、邮箱；大小写、mailto/xmpp、域名下划线及Unicode；尾点/逗号/问号/括号配平、实体尾/反斜杠、相邻标点；强调/删除线内外、明确链接/引用链接与尖括号链接、任务首段/后段；代码/围栏/HTML不可误触；BOM/CRLF/loneCR与多行边界。每个差异保留输入/两方结果，不仅汇总数量。特别验证转换期结果是否具有可靠raw范围，以及新增URL节点是否改变既有格式、列表/引用局部验证语义；不拿纯模型当DOM/生命周期证据。

通过判据是有限支持域的语义及位置可解释，原文与非目标结构不变，可提出窄消费者路线；不是必须让全部样本绿。若缺失位置/实体还原需要新映射引擎、两树明显分歧需要大适配或只能禁用既有可靠格式，先返回具体反例及选项，不自动生产或把raw回退称完整自动链接。

## 实验后拟收敛的最小生产路线

1. 固定profile单源换代；canonical与编辑grammar分别适配同能力，BomAware、Worker解析/树编解码、全部局部inline/list/quote候选解析共同使用新grammar。外层回执及内层tree旧/缺profile拒绝；受信encode来源约束保持。不把canonical依赖拖入编辑热路径。
2. live-formatting按可靠可见裸URL节点加纯mark，不造widget/隐藏范围、不全文复制/逐节点canonical。沿现保护区、节点预算和旧解析失效；源码URL颜色与阅读inert span复用既有呈现。条件不可靠不生成伪装饰，不借fallback解决尚未确认的语义差异。
3. 格式/结构命令继续用同grammar验证候选；核新URL范围不会错误解包、吸收未选正文或改变链接文字。原文事务、历史、保存基线、IME入口不因解析呈现而变化。若需修改命令可用域，先据PoC提出最小方案，不默认扩大禁用。

上述只是待实验验证的技术候选，具体生产文件与依赖增量须结果复核后另批；不提前冻结通用协议、性能目标或新平台。

## 最小happy path与验证

文档含裸URL/邮箱、相邻标点及原尖括号链接：编辑与阅读显示非活动链接样式，源码精确原字节；尾标点不被误包，代码中保持代码。三模式切换不dirty、不增history、不发网络或native打开请求，普通输入/undo/redo及旧任务/删除线不回归。自动证据须断言实际mark/span范围和无活动属性，不能只断hidden为空。

获批实现后补固定profile失配、语义/range corpus、可见范围与保护区、raw/BOM/EOL、格式/结构命令、安全DOM及历史回归；type/lint/fulltests、独立两轴代码复核后由主线递增构建并真实WK代验。真实核浅深外观、滚动/编辑及阅读非活动行为；未实测自然输入/系统主题/极端成本明确保留，不自批或提前Git。

## 继承约束检查

- F-002：固定本地解析依赖，磁盘原文唯一真源，无自动保存/网络解析/预加载；`F-045f-offline-final`留最终人工，不操作网络限制。
- 中文与外观：复用中文未接入提示与主题样式，浅深/系统主题约束继承，真实未测项目如实记录。颜色与非活动span不冒充可点击链接。
- 命令与键盘：无新写命令/快捷键/焦点目标，不新增点击路由；原选区、键盘与IME路径保持。
- 安全与日志：不新增a/href、原始HTML放行、协议执行或文件权限；原净化/审计不变，日志不记录用户正文。安全测试与语义呈现分开证明。

当前义务表无F045主承接ID，主责与延期标记均none；协作F020/OBL030安全、F012/OBL068编辑外观、F013/OBL069源码外观、F014/OBL064原文历史与F074一致性，完整责任不迁移/不关闭。完整F045、F055导航、D/tagfilter、表格及其它余项保持开放；F028c、围栏内部Enter专项及最终离线不推进。

## 有限隔离实验结果（2026-10-13，冻结；直接注册路线不采用）

产物目录`/tmp/agentic-f045f-poc.QXVLuA`：`prototype.ts`为纯解析对照，`driver.ts`为case/all/interactive薄驱动，`install.log`和`run-first.log`保留原始输出。仅临时安装精确版本：autolink micromark 2.1.0/mdast 2.0.1、mdast-util-from-markdown 2.0.2、Lezer markdown 1.7.2，以及现有strike micromark 2.1.0/mdast 2.0.1、task micromark 2.1.0/mdast 2.0.0；安装exit0，仓库依赖未修改。

复跑命令：`bun /tmp/agentic-f045f-poc.QXVLuA/driver.ts all`；单例将all换成`entities`等名称，交互入口为`interactive`。实际30例、18例产生诊断、exit1。主线完整读取并复跑同30/18，日志`/tmp/agentic-f045f-main-poc.log`；独立Spec也复跑同结果。**这些是研究复现，不是通过；18是诊断样本数，不是18项语义错误或正式失败断言。**驱动打印完整相关树，比较新增链接范围/文字/解释目标和canonical前后段落信息；没有将计数作为正式语义断言套件。

### 坐标及对照口径

Lezer打印规范化UTF-16范围（保留BOM坐标、CRLF/loneCR按现editorText归一）及用现rawOffset换算的raw范围；canonical仅使用节点**自己的position**加首BOM偏移，缺失则打印null，未借父节点或搜索文字补造。两端均先剥首BOM解析。下列非BOM/EOL例子的范围均为半开区间，raw与规范化坐标相同。完整BOM/CRLF/loneCR输入与双坐标见原日志。

Lezer `targetCandidate`是驱动根据源码解释www/http/email的候选目标，不是Lezer节点自带URL属性；canonical目标是实际node.url。驱动递归拼接text/inlineCode等值只是模型文字，不是真实DOM显示。全篇遍历、切片及raw映射仅实验仪器，不是获批生产热路径。

### 关键实测反例与诊断分类

1. **直接识别/范围分歧。**`schemes`中`mailto:a@example.com`，Lezer包[44,64)，canonical只包内部邮箱[51,64)；`xmpp:a@example.com/resource`分别[65,92)和邮箱[70,83)。`uppercase`中canonical识别`WWW.EXAMPLE.COM`[0,15)与`HTTPS://EXAMPLE.COM`[16,35)，Lezer未识别这两项。`unicode`中`https://例子.测试`[26,39)只被canonical识别。`multiline`中首行`www.example.`的`www.example`[0,11)只被canonical识别。
2. **实体/转义影响精确边界。**`entitytail`第二个URL源码`https://example.com/path&#x41;`，Lezer范围[30,54)，canonical[30,59)，后者包含`&#x41`而不含最后分号；基线普通文字实体解码与新增链接文字也不同。`escapedmarkup`原文`\\*www.example.com\\*`，Lezer[2,17)，canonical[2,18)包含尾反斜杠，目标也随之不同。此类不能只按数量认为等价。
3. **6例共10个新增canonical Link没有自己的position。**`entities`2个（`www&#46;example.com`、`contact&#64;example.com`）；`escaped`3个（`www\\.example.com`、`https\\://example.com`、`contact\\@example.com`）；`adjacent`2个；`html`1个（inline HTML之间的www）；`entityprefix`1个（`&#104;ttps://example.com`）；`escapedprefix`1个。日志逐个保留null范围、实际文字/目标及父子树，不假定可从转换后文字唯一回推原文。
4. **4例主要是既有Link/Image正文中的新增URL子节点，不能直接算裸链接语义错误。**`inline`的URL[1,20)、`reference`[1,16)、`tasklink`[7,22)，以及`nested`的Link正文[7,22)与Image正文[50,65)，canonical没有新增独立Link而保留原外层结构。消费者必须区分上下文，不能把这些URL子节点当可覆盖外层目标的独立裸链接。
5. **仅前后模型差异也会触发诊断。**`backslashpath`两端链接范围/文字/目标相同，但新链接保留源码反斜杠，原普通文字会处理转义；这是新增语法后的解释变化，不单凭诊断判bug。`task`两端新增链接范围相同，首Paragraph起点从6变2、终点21及正文相同；不把它写成任务正文发生变化或必然呈现故障。上述分类有重叠，不能相加作为独立问题数。

其余12例未触发该驱动诊断：basic、punctuation、underscore、emphasis、angle、code、quote、bomcrlf、lonecr、unsafe、mailpunct、tilde。它们只证明有限对照未发现差别，不是全部GFM兼容、三模式呈现、安全DOM或导航验收。

### 现有消费者影响与未验证边界

- 现live-formatting的Link/Autolink呈现依赖既有标记结构；新增裸URL不能只注册parser就获得正确外观。Link/Image内部URL也需排除独立呈现。这是源码核查，未改或运行真实呈现消费者。
- inline-format现拒绝祖先Link/Autolink等，不含URL；整段/部分裸URL的格式命令还没有实际候选事务对照，不能预先认定保真或一刀切禁用普通编辑。
- canonical规范实验的rangesValid会核所有节点position，新增缺位置Link影响该判据；但不能据此推论阅读一定失败。当前canonical消息携带mdast（不同于Lezer树wire），阅读link分支直接递归子节点为inert span，不直接调用raw(link)，顶层块才取raw定位。真实阅读、协议和其它精确范围消费者仍待专项技术核查，不假造wire/DOM失败。
- 本次没有原文修改、history、真实UI/主题/滚动/IME或网络执行实验；没有生产profile换代，也未改仓库依赖。未执行针对差异的适配，原日志与反例保持。

### 收敛结论与下一最小步骤

主线结合自身及独立Spec复跑，否决“直接同时注册两个官方扩展即进入生产”的当前路线；本片保留研究，父项/义务不关闭。后续最小技术调查应先核官方canonical转换期节点的位置契约与当前消息/精确范围消费者的真实需要，再决定能否在公开API内保留官方语义且不伪造范围；同时对Lezer明确的识别差异评估窄公开适配可行性。不得私自禁用官方transform、复制私有解析算法、增加第三套映射引擎或把raw回退当完整交付。

本次已冻结，不再追加适配/候选盘点；下一调查或独立MVP切片由主线另选另批。上述仍非生产路线批准，应用版本未变，不构建、不UI、不Git。

## 获批消费者隔离实验结果（2026-10-13，待独立复核）

复用`/tmp/agentic-f045f-poc.QXVLuA`官方依赖，新增纯候选/消费者探针`consumer.ts`与薄入口`consumer-driver.ts`，没有新增依赖。命令`bun /tmp/agentic-f045f-poc.QXVLuA/consumer-driver.ts all`，也可指定`entities`、`owner-session`等case或`interactive`。`consumer-first.log`为14例/0失败首轮；补精确span顺序/数量、BOM/HTML顶层范围及任务状态后，冻结`consumer-final.log`为**15例/0断言失败、实际exit0**。原30例/18诊断exit1日志及直接注册否决不变。

候选原样使用官方autolink+现strike/task扩展，缺Link/Text position保持缺失；仅按现生产parseCanonicalMarkdown同规则给已有位置加首BOM偏移。真实调用commonmarkContent与react-dom/server，不复制阅读渲染器。10个SSR样本为六缺位置类entities/escaped/adjacent/html/entityprefix/escapedprefix，以及code、bomcrlf、lonecr、task；没有完整原文降级。逐例断言新增Link的inert span数量、序列及序列化文字与canonical Link子文字一致，期望文字存在，所有SSR元素/属性通过实际isControlledReadingElement，且无a/script/input/iframe/button及href/src/事件/tabindex属性。代码内零链接span，任务状态只出现一次、不重复原`[x]`。

顶层锚点与每个实际顶层节点raw范围逐一一致并在原文内；BOM/CRLF固定样本额外精确断言`[1,20)`、`[24,44)`，HTML样本`[0,28)`、`[30,60)`。原文切片、实际HTML、元素/属性、Link缺位置及Text缺位置数量均保留日志。`serializedText`是HTMLRewriter返回的**实体编码文本串**，不是浏览器textContent；例如实际SSR中`a&amp;amp;b`编码对应模型包含字面`a&amp;b`，不把日志编码当浏览器显示错误。HTML块明确出现既有“HTML 浏览器呈现环境不可用，保留原文”局部回退；行内HTML仍转义原文。此不证明浏览器环境的HTML净化或实际布局。

另5例直接调用真实createCurrentCanonical，使用受控Worker对象：有效身份回执接受且isCurrent为true；发送后当前revision变化、同revision换session identity、错误config、cancel后调用捕获旧callback均返回null，无旧结果ready。每例确认Worker终止一次。回执树包含真实无位置Link；信封使用当前生产CANONICAL_CONFIG仅为验证owner接收契约，**不是新语法profile获批/已生产**。该受控回执绕过实际Worker线程与消息克隆，不证明新grammar编解码、线程成本或完整ABA矩阵。

结论：有限样本证明“无内联Link位置必然导致现阅读失败”的推断不成立；现有阅读inert呈现与顶层定位具有可复用基础。规范实验全节点rangesValid仍不满足，Lezer与canonical识别分歧未修，编辑/源码格式消费者也未新验证。可提交主线评估是否另拟阅读消费者有限片，但尚未改变本片三模式目标、未批准生产。没有真实DOM审计/WK、事件/网络监测、主题/滚动/IME或历史实操；SSR白名单断言不能冒充这些验收。实验至此冻结，无新增生产/仓库依赖/版本/build/UI/Git。

## 阅读有限消费者最小生产方案（待主线与独立批准，非实施）

### 范围与精确接线

1. `apps/desktop/package.json`及`bun.lock`仅新增精确`micromark-extension-gfm-autolink-literal@2.1.0`、`mdast-util-gfm-autolink-literal@2.0.1`，不升级现有依赖或应用版本。`client/canonical-parser.ts`在现官方strike/task配置上增加这两个官方扩展，保留完整转换阶段、BOM偏移与缺位置原貌，不猜范围、不新增映射器。
2. `shared/markdown-profile.ts`继续作为固定配置单源：现`MARKDOWN_GRAMMAR`值保持，另导出固定canonical语义版本（建议`commonmark-gfm-strike-task-autolink-3`）；`shared/canonical-corpus.ts`的CANONICAL_CONFIG改引用canonical版本。二者是两个解析消费者的固定版本身份，不是运行开关。编辑grammar/BomAware/Lezer树wire及inline/list/quote局部parser全部不变，不能给未注册Autolink的编辑树盖新语法身份。canonical请求/回执沿既有CANONICAL_CONFIG核验，明确拒绝原`commonmark-gfm-strike-task-projection-2`和缺失配置；不另造RPC。
3. 阅读继续复用`security/commonmark-content.tsx`的既有inert link span、中文未接入提示与样式，预计不需生产渲染改动。不新增href/a、点击路由、tab目标、预取、邮件或协议执行。代码/HTML/未知结构原文路径与安全审计不放宽。生产改动若发现此预期不成立，先报具体边界，不顺手扩大阅读框架。
4. `client/current-canonical.ts`、`document-canonical.ts`、`components/reading-view.tsx`沿原按需Worker、文档/session/revision/raw身份、取消/卸载/退出及顶层锚点生命周期，不将canonical搬入每键编辑热路径；只在必要回归测试中触达。无位置内联节点不能成为精确原文编辑或滚动目标。只读仍允许阅读，safe仍走原安全源码降级，不为自动链接增加安全模式消费者。

### 语义oracle与范围能力分离

`client/canonical-markdown.ts`现有**每节点rangesValid及旧corpus精确范围判据保持原样**，旧case不删除、不改成只检查有位置节点、不把canonical/Lezer不一致写成一致。新增canonical-only语义回归放独立`client/canonical-autolink.test.ts`（或同职责命名），不塞入宣称两树等价的旧实验行。

新测试分开三类事实：①官方语义节点/URL/完整文字及顺序；②所有实际带位置节点范围合法、顶层块与需要raw的HTML/code位置可用；③转换生成Link/Text位置确实缺失且不伪造。③通过是“符合官方输出契约”，不是“精确内联range可用”。若正式接入令旧corpus某例改变，先保留失败并报告具体输入/新语义，不默改expected或减弱rangesValid。本片不承诺为全部自动链接建立raw级范围对照。

### 最小正式验证与实际验收

- 新canonical语义测试覆盖六缺位置类、普通URL/邮箱、大小写/mailto/xmpp、实体/转义及既有Link/Image内文字，精确检查官方目标、缺位置类别、非目标块和BOM/EOL顶层范围；不自写Unicode或URL识别器。旧canonical corpus完整回归。
- `security/commonmark-content.test.tsx`补真实SSR：混合普通前后文字+多链接+标点+强调/删除线/任务的**完整序列化正文与顺序断言**，不止URL substring；精确inert span数量/内容及顶层raw锚点，任务标记不重复，代码不自动链接。HTML邻接分清局部原文回退与全文降级；危险协议文字、原HTML及属性仍不获得活动元素/导航能力。继续现安全白名单，不把SSR当mounted DOM净化证据。
- `client/current-canonical.test.ts`补真实官方缺位置树的接受/isCurrent及旧profile/缺profile、revision/session过期、取消后晚回执拒绝；保留既有离开阅读/关闭文档/退出取消回归。受控Worker不冒称真实线程测量。
- 编辑/源码的现link presentation、inline-format及原文/history测试回归：未注册Autolink、未新增格式禁用、不增dirty或history；阅读切换不回写raw。根据实际影响补最小集成测试，不为本片复制全部生命周期平台。
- 定向test/type/lint及主线全量、两轴代码审核后集中打包。实际WK在自建样本核阅读混合文字与非活动外观、切换编辑/源码原文仍在且无新增裸链接能力声明、只读阅读、safe隔离、跨标签/退出、浅深主题与DOM审计；BOM/EOL精确字节以自动/磁盘核对为准。真实点击不产生导航/焦点目标按工具能观测范围记录；没有网络监测时不称实测零网络。自然IME、系统动态主题及offline-final未实操仍开放。

这是一项可独立验证的阅读消费者子片，不是完整三模式S-05完成。新增精确范围编辑消费者、Lezer识别一致性、F055导航、F045d/tagfilter等均不随本次进入生产；父/协作义务和离线边界保持。主线完整读取及独立复核前不编码、不安装仓库依赖、不构建。

## 获批有限生产实施记录（2026-10-13，代码候选待独立审核）

主线全文阅读并经独立Spec确认0必要路线阻断后批准本节窄实现。两精确官方依赖及必要传递包已安装；canonical-parser注册完整官方语法/transform，新增固定CANONICAL_PROFILE，旧MARKDOWN_GRAMMAR及Lezer/wire/局部命令均未改。现阅读inert renderer、owner生命周期无需生产逻辑修改。canonical-corpus只改配置来源，两树旧case/expected及全节点rangesValid判据保持原样。

代码文件：`apps/desktop/package.json`、`bun.lock`、`src/client/canonical-parser.ts`、`src/shared/markdown-profile.ts`、`src/shared/canonical-corpus.ts`（src均相对apps/desktop）。测试新增`src/client/canonical-autolink.test.ts`，补`src/client/current-canonical.test.ts`、`src/security/commonmark-content.test.tsx`。其余共享文档由主线维护。bun install耗时86.33s、exit0，另将先前manifest129/lock128不一致同步为129；主线已明确保留此事实同步，非本lane递增版本。

验证：先独立跑旧canonical-markdown测试4项/39断言通过；最终定向命令`bun test apps/desktop/src/client/canonical-autolink.test.ts apps/desktop/src/client/current-canonical.test.ts apps/desktop/src/security/commonmark-content.test.tsx apps/desktop/src/client/canonical-markdown.test.ts apps/desktop/src/client/link-presentation.test.ts apps/desktop/src/client/inline-format.test.ts`为36项/566断言/6文件通过（182ms，有限本机样本），日志`/tmp/agentic-f045f-targeted.log`。`bun run typecheck`通过；上述6个本轮改动TS/TSX文件定向eslint收尾。

失败保留：新增SSR首次组合23pass/1fail/375断言；我预期`www&#46;example.com，中`中的中文逗号/中字在Link外，官方实际将其纳入URL并保持完整文字。主线确认遵官方语义，不自行裁剪；新增canonical精确目标`http://www.example.com，中`断言及完整SSR输出断言后绿。不是旧corpus失败，不把“所有中文标点均在链接外”列为完成判据。定向lint首次仅canonical-parser两条micromark import顺序报错，调整顺序后复核；无算法改动。

正式测试分开缺位置官方语义、已有位置合法性、顶层BOM/EOL范围；owner覆盖缺位置树接受与旧/缺profile、revision/session/取消晚回执拒绝；SSR完整混合文字与任务/删除线顺序、危险HTML局部回退及非活动属性。没有新增精确内联位置能力，仍不伪造范围。本记录仅实现/自动证据，不是正式验收；主线负责全量、两轴、版本/构建及实际WK，父S05/其它模式与offline-final开放。

主线全量预检曾1021pass/1fail（`/tmp/agentic-f045f-main-tests.log`）：旧gfm-strikethrough测试仍把编辑MARKDOWN_GRAMMAR当canonical请求版本并期望接受，属于本次明确拆分身份后的旧耦合断言，不是旧semantic corpus失败。主线授权仅更新`client/gfm-strikethrough.test.ts`：canonical接受CANONICAL_PROFILE且拒绝编辑版本；编辑wire保持本版本往返并拒绝canonical版本。生产守卫未放宽。新增该文件后的7文件定向41项/810断言通过（219ms，`/tmp/agentic-f045f-final-targeted.log`）；随后的lint提醒Tree.toString被规则视为默认对象字符串，改为公开encode/decode往返相等断言，不改生产或测试阈值。全量及实际WK仍主线后续负责。

最终测试夹具的错误profile直接spread构造被TS字面量类型拒绝，改用本文件既有Object.assign构造非法回执方式；没有放宽生产类型。随后typecheck、定向eslint通过，最终该文件5项/244断言通过（`/tmp/agentic-f045f-profile-final.log`）。全部代码/测试已冻结，lock registry检查、feature-docs（含obligations）及diff检查通过；独立审核与实际验收待主线。

## alpha130实际发现：删除线与自动链接组合诊断及主线决定

真实WK自建`/tmp/agentic-f045f-ui.tqCjIG/links.md`的完整行`**强调 www.example.com** 和 ~~删除 https://example.com~~。`在阅读保留删除线标记，编辑仍按旧grammar呈现strike。按diagnosing-bugs读取CONTEXT后建立临时`/tmp/agentic-f045f-strike-red.BF9rCq/repro.ts`，调用真实production parse+SSR并断言delete存在，与无autolink的原官方strike/task配置对照。最初截取不含句号的`~~删除 https://example.com~~`为绿；补回fixture中文句号后红。最小`~~https://a.b~~。`连续两次exit1，旧配置delete1，当前delete0且URL为`https://a.b~~。`。实际完整fixture同断言exit1；删除协议后的`~~a.b~~。`、无尾标点及ASCII句点对照均保留delete。日志original/minimal/period/minimal-period/repeat/no-scheme/fixture保留，不将初次不完整复现绿掩去。

主线向用户展示并批准三个可证伪假设探针：H1自动链接因中文标点将`~~`视为路径内部（预测URL含`~~。`而AST无delete）；H2扩展顺序冲突（交换顺序应恢复）；H3渲染器丢失delete（AST有delete但SSR无del）。`probes.ts`及`probes.log`逐个只改syntax顺序或mdast顺序：两者均不恢复，H2本样本不支持；AST已无delete、SSR忠实输出，排除本样本H3；带中文句号与无/ASCII句点对照支持H1。

经主线单独批准，仅该诊断tmp安装registry核实存在的固定`micromark-extension-gfm@3.0.0`、`mdast-util-gfm@3.1.0`、`mdast-util-from-markdown@2.0.2`（不称最新版），安装exit0。`bun /tmp/agentic-f045f-strike-red.BF9rCq/full-gfm.ts`实际官方完整GFM运行5例exit0、`full-gfm.log`：中文最小样本、真实完整行、完整fixture均delete0且相应URL含`~~。`；ASCII句点及EOF样本delete1、目标`https://a.b`。此exit0只表示探针运行完成，不能把原delete必须存在的红断言解释为已修绿。

官方证据：[GFM extended autolink path validation](https://github.github.com/gfm/#extended-autolink-path-validation)规定特定ASCII尾标点排除但允许路径内部；中文句号不在该列。[官方完整组合源码](https://github.com/micromark/micromark-extension-gfm/blob/main/lib/index.js)组合auto/footnote/strike/table/task；固定安装autolink2.1.0的`lib/syntax.js` pathInside/trail遇中文句号不接受尾标点结束，于是将`~~。`消费进路径，与AST实测一致。不是项目漏注册strike、错误顺序或reader算法问题，也没有修改依赖内部算法。

独立Spec复跑确认这是既定S05官方规范组合边界、既定授权覆盖；主线明确保留官方语义，无需新用户选择。此前“旧strike不回归”准确限定为非交互既有样本保持，**新自动链接与strike的相互作用按官方GFM**；编辑grammar未扩展，因此此组合阅读/编辑差异仍需手册明确，不能称三模式语义统一。没有自行裁剪URL、改用户原文或强制恢复delete。

按主线批准仅补正式三case（中文句点/ASCII句点/EOF）的精确parser目标、range、delete数量与完整SSR输出回归；生产算法、依赖、版本均未改。实际alpha130继续由主线验收，尚未本片正式通过或Git。
