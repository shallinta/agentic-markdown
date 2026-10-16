# F-047a：固定高亮方言的编辑呈现与源码保真

## Git 收据（2026-10-16）

主线已提交推送`70d81c9fec431ebcba7cba83f818e842d33996e3`，HTTPS ls-remote实际核远端main同SHA，origin/main同步；编写此收据前工作树干净。以下Git待执行为当时记录，本收据自身后续随文档提交。

## 当前：alpha162 非离线有限片正式通过

alpha162/hash `1jrx3g6uy44x8` 经下述有限真实WK检查及最终独立Spec/Standards均0必要阻断，主线正式批准非离线有限片受托Agent代验通过，非用户亲验。源码与包内Bun仓库全量均1410pass/33788assert/0fail。Git待主线实际执行；完整F-047、OBL-068/069、阅读子窗和最终离线仍开放。下方“构建中/实现中/待复核”记录为当时历史，后续测试修正没有生产变化，未重复构建。

## 主线 alpha162 构建批准（2026-10-16）

主线两轮全量分别1409/33740与1409/33768，日志 `/tmp/f047a-root-full-tests.log`、`/tmp/f047a-root-full-tests-final.log`，均0fail；最终type/full lint/文档及lock检查通过。独立Spec指出原只读测试实际资格为false，作者以公开writePermission重配置并显式assert修正；主线与Spec增量36/256通过，不改生产权限守卫。最终两轴0必要构建阻断，主线已全文读核心扩展/用途/profile/装饰/消费者接线，批准alpha162构建及有限真实WK验证。版本与lock workspace同步；当前正在源码全量重跑和unsigned构建，尚无新包成功或实际验收，不得Git。原中途typecheck及参数误用等失败保留，不能以自动结果替代只读输入或折叠像素。

> 状态：2026-10-16，有限实现、自动验证、真实WK与独立最终复核已完成，主线批准本片通过；不是用户亲验，不关闭完整父项及离线责任。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

继承检查：F-002 本地/离线边界保持；中文与外观沿现有主题 token；命令与键盘本片不新增入口；安全与日志不输出正文、不扩网络/HTML能力。OBL-068/069只协作，不冒F-047主责或关闭；最终离线仍人工确认。

## 状态与选择依据

当前获主线批准本片typed源码、必要已锁helper直接依赖及最小lock、实现后测试；不改版本、不build/GUI/Git，由主线后续管理alpha162。原回扫不直接迁入，采用已验局部floor窄修，仍不称全局线性。早期未批准记录为历史。本轮只选 `==text==`，不同时开启脚注、定义列表、上下标或 Emoji。F-046a 已由主线核实提交并推送 `356ed9c`；本片尚未提交。

选择依据：总账现行 S-10 明确高亮属于 MVP、`HighlightExtension` 原子扩展、主题决定颜色、编辑显隐标记；历史 S-10c 是同能力的决定记录，不新造第二功能编号。S-PRESET 要求固定内置组合且无用户方言开关。F-047 主行已列硬前置为对应解析/编辑/阅读消费者，可按模式有限推进；高亮是局部行内语法，不依赖脚注全局引用索引或阅读子窗口交互，因此建议先做编辑与源码切片。完整 F-047/S-10 与阅读承接后续保留。

## 本轮功能说明

- 编辑模式：合法双等号行内内容使用主题背景强调，光标/选区涉及该节点时显示必要 `==` 标记，离开后隐藏；沿用现有编辑显隐、IME、只读和长行保护规则。内容仍是原始 Markdown，不替换成富文本数据。
- 源码模式：所有标记与原文始终完整可见，仅允许已有源码颜色规则，不能加背景、改变字号/字重或隐藏标记。编辑/源码共享原文、历史、选区，主题切换不得重新解析。
- 不新增格式按钮/快捷键、不新增颜色选择或写入颜色属性。既有粗体/斜体/代码命令遇新节点必须保真，必要时按已验未知语法策略拒绝，不能移除 `==`。
- 本轮不改变旧主窗阅读，也不设计阅读子窗的数量/内容同步/主题或高亮呈现。新编辑 canonical 用途获得同语义节点，reading-legacy 保持旧解析。以后在阅读窗口对应迭代接安全呈现；不把模式有限实现称固定 Preset 全部完成。

## 已核本地接口与风险

1. `markdown-grammar.ts` 组合 CommonMark、双波浪线、Table 与 Frontmatter；`FrontmatterParser` 包装此固定 nodeSet 的完整文档，fragment 入口单独使用同 grammar。增加行内规则不需要新文档 parser/Worker 管线，FM 内不可解析高亮。`markdown-tree-wire.ts` 前后台必须使用同新 grammar 版本及静态 nodeSet。
2. `@lezer/markdown@1.7.2` 公开 `MarkdownConfig.parseInline` / `InlineContext.addDelimiter` / `DelimiterType.resolve,mark` 可以提供真实行内节点。已安装包有 Strikethrough/Subscript/Superscript，但没有 Highlight；不能把替换文本的预处理或全篇 regex 装饰假称语法支持。新增 `Highlight`/`HighlightMark`，使用公开扩展钩子，不读取私有 delimiter 栈。
3. `canonical-parser.ts` 已区分 editing-semantic 与 reading-legacy。已安装官方 micromark/mdast 支持 `extensions` 与 `mdastExtensions`，但本地没有高亮扩展；候选是在同原子模块贡献窄的 typed micromark tokenizer/resolver 与 mdast `highlight` phrasing 节点。不是另造全文 parser；不得对解析完成 text 节点用 regex 拆分冒准确 source range。若需引入 helper 的直接依赖，仅列实际用途和本地已安装精确版本，再由主线批准；当前零 install。
4. `live-formatting.ts` 目前处理 strong/emphasis/code/strike，且只遍历可见且非保护范围；高亮接同有限入口及 edge marker 显隐，不能另加每键全文扫描。`editor-mode.ts` 的源码 HighlightStyle 仅颜色；给 marker 现有 processingInstruction 标签、内容普通标签即可，源码不复用编辑背景。
5. `image-summary.ts` 的 editing canonical 递归 children、`editing-code-copy` 寻找 code 值、`callout-inline.ts` 对语法壳有白名单。新节点必须保留 children 与来源，不丢高亮内图片/链接及代码；Callout 中 HighlightMark 不能被误算为可见非空内容。`inline-format.ts` 有显式语法集合，需验证格式命令在/跨高亮边界不会损坏标记；这是兼容性补齐，不顺便交付高亮格式命令。
6. 当前 canonical corpus 的旧 reading 比较不能充当新 editing 高亮 oracle；为新语法单设固定样本，以手写期望节点/range 为主、两实际解析器互比为辅。raw BOM/CRLF/CR 与 CM 规范化坐标各自核对，不能只回环自证。

## 拟采用语法边界（待主线批准并以隔离证据确认）

Typora 官方资料确认 `==...==`，没有完整公开嵌套/flanking 文法。本 App 不声称逐字复刻 Typora；建议采用下列可版本化固定语义，并记录兼容 corpus：

| 边界 | 候选规则 |
| --- | --- |
| delimiter | 恰好两个未转义连续 `=`；单个、三个及更长 run 不从中间截双等号；转义奇偶按宿主解析器规则 |
| 内容 | 非空、开头/结尾非空白；内侧可以有空格；flanking 使用与当前双波浪线相同的空白/标点分类原则，中文与 Emoji 视原 UTF-16 文本保真 |
| 跨行 | 同一 paragraph 内 soft line break 可包含；不能跨空段/块边界；容器 quote/list 的逻辑行由宿主块解析决定，不能自扫跳出容器 |
| 嵌套 | 与 emphasis/strong/strike、行内代码和链接按宿主行内优先级组合；配对不得交叉。相同 marker 的歧义串先在固定实验中明确手写 oracle，再据两引擎结果收敛，不留生产“哪个先跑就算哪个” |
| 排除 | fenced/indented code、inline code 内、Frontmatter 原子块、HTML tag 属性、URL/definition 的语法字段不解释；纯文本标签中允许。原始 HTML 文本是否独立 inline 仍由宿主处理，不穿透 tag token |
| 未闭合/非法 | 保留普通原文，不创建半个 Highlight，不隐藏未匹配 marker，不阻断正文 |

## 最小技术路线

`HighlightExtension` 单一模块拥有 Lezer 声明、canonical token/节点映射及固定语义 metadata；preset 组合点显式注册，保持 internal first-party 边界，不做插件管理器。grammar 与 EDITING_CANONICAL_PROFILE 同轮更新，worker 请求/结果用途验证、wire 和影子/调试入口全部使用同版本；CANONICAL_PROFILE legacy 不变。

Lezer 候选通过公开 delimiter 解析一次参与宿主 inline 解析；canonical 候选通过公开 tokenizer 收集恰双 run 和 flanking，resolver 只在合法 inline token 区间匹配并输出真正父子节点。不得原样复制可能反复扫描前缀的匹配器后宣称线性；在生产前明确配对索引/栈、跨节点边界和最多一次事件遍历等实际工作。若公共 hook 无法安全保留嵌套/优先级，先报告路线红，不把特殊字符串改写成波浪线再还原，也不绕过当前所有权/预算。

样式只增加编辑语义 token，浅深主题保持与正文对比度；不写入 Markdown。图片/Callout、代码复制和格式命令做必要 consumer 兼容；source history/原文保存、当前搜索/选区展开、已验 heading/code/FM 折叠保持。新节点本身不加 interactive DOM、HTML 或资源加载，不扩 CSP/协议白名单。

## 第一轮有限隔离实验计划（未执行，待另批）

采用新 mktemp 模块与薄单命令驱动，不写生产或新安装依赖。先冻结最多24条小样本和手写期望，每条每 engine 一次；每条宿主15秒、整批180秒、首个语义红保存并停止，不循环修改凑绿。原文/range、两引擎树、失败及未执行项分别输出。

固定覆盖类别：基本中文/英文、内空格、空串、首尾空格、单等号、三/四等号 run、未闭合、奇/偶转义、中文/标点邻接、两个独立范围、strong/strike 嵌套、同型歧义、代码排除、链接文字与URL字段、图片alt、quote/list、TableCell、FM伪标记、Setext `=` 行、soft break/空段和 BOM/EOL。写驱动前把组合样本精确列成24条及 oracle，不能用一个“复杂样本”暗中扩大无限矩阵。

同批仅少量真实 consumer seam：高亮内正文图片/reference仍有独立正确来源、代码复制正文不变、Callout语法壳不算内容；旧reading canonical 同输入与已验baseline比较。若全语义通过，再提出一次有限标记密集成本检查或实际生产方案，不在本批准里预执行大文档压力。需要 type augmentation/公开 helper 但本地不可直接解析时先报告，不偷偷 install。

此实验回答“当前两个 parser 的公共接口能否表达同一固定方言并保持旧消费者”，不是编辑显隐/自然IME/WK验收。成功后只剩 typed integration、既有视口装饰/颜色接线和正式生命周期测试；不继续多层等价模型，更不把全部 F-047 做成一批。

## 首批24条固定输入与手写 oracle 候选（仅方案，未执行）

以下输入栏是 JSON 字符串表示，驱动只作一次 JSON 解码；`\\n` 在此规则里不自动展开为额外测试。表中 `H("...")` 指完整高亮源范围**包含两端双等号**，内容范围各去两单位；用明确且唯一的源片段标识期望范围，冻结驱动时写入对应手工 UTF-16 offsets，不从被测 parser 节点反推。`无H` 仍须验证原文完整，不代表整个文档无其他 Markdown 语义。多个指定片段按出现次序列出，不能“找到了一个就算通过”。

配对候选的**硬前提**是开marker内侧紧邻字符非空白、闭marker内侧紧邻字符非空白且内容非空，然后才应用标点/flanking分类；不得仅复制宿主strike分类便称完全等价。第04/05是独立手写的空白拒绝oracle，即便标点组合让宿主默认规则接受也不得改判。

| # | 精确输入（JSON） | 手写期望与排除 |
| --- | --- | --- |
| 01 | `"==a=="` | 唯一H，raw/CM `[0,5)`，内容 `[2,3)` |
| 02 | `"==中文😀==\n\na==😀==b"` | 仅首段H `[0,8)`，内容 `[2,6)`；Emoji 两个UTF-16单位，不能按码点压成7。第二段按Unicode标点/符号flanking拟定无H（内侧Emoji为符号、外侧字母非标点），专门暴露Lezer UTF-16单元与micromark字符分类差异，不因两边不同而取消此断言 |
| 03 | `"a==b==c，==中==。"` | 两H：`==b==`、`==中==`；词内与中文标点不阻断；中间普通字不被吞 |
| 04 | `"==a b==\n\n== a==\n\n==a =="` | 只有首段H `==a b==`；首/尾空格两段无H |
| 05 | `"=a=\n\n===a===\n\n====a====\n\n====\n\n== =="` | 全无H；不得截取长run尾部配对；空或纯空格也不高亮 |
| 06 | `"\\==a=="` | 无H，转义后的单剩余等号不构成开标记 |
| 07 | `"\\\\==a=="` | H `[2,7)`，前两个raw反斜杠为宿主escape来源；不把raw反斜杠折算后复用旧坐标 |
| 08 | `"==unclosed"` | 无H，原始开标记完整保留 |
| 09 | `"==one== + ==two=="` | 两独立H `==one==`、`==two==`，不得跨越 ` + ` 合成一个 |
| 10 | `"==**b**== ~~==s==~~"` | H `==**b**==` 内有strong；H `==s==` 位于delete内部；不重复/交叉节点 |
| 11 | `"`==code==` ==`x`==\n\n==a `b==`"` | 首inlineCode内部无H；唯一外H `==` + `` `x` `` + `==`，保留内部inlineCode；末段潜在闭marker在code内部，不能跨code边界闭合，整个末段无H |
| 12 | `"```\n==fenced==\n```\n\n    ==indent==\n\n==body=="` | 只有H `==body==`；围栏和缩进代码均保持字面标记，代码正文值不变 |
| 13 | `"---\nx: ==yaml==\n---\n==body=="` | 编辑document路径仅H `==body==`，首部仍一个Frontmatter；fragment入口不是此文档资格oracle；legacy阅读按旧baseline另核 |
| 14 | `"[==label==](https://x/==url==)\n\n[id]: https://x/==def==\n\n==[x==](u)"` | 只有链接文字H `==label==`，URL与definition值字面不改，仍有正确link/definition；末段不得跨链接文字边界配对外侧开marker，末段无H且link文字保留 `x==` |
| 15 | `"==![alt](a.png)==\n\n![==caption==](b.png)"` | 首段H包image，图片source/alt仍a.png/alt；第二段image alt中的高亮资格见下面待决定D1，不能用两解析器不同树硬比较 |
| 16 | `"> ==q==\n\n- ==l==\n\n| h |\n| - |\n| ==t== |"` | 三H `==q==`、`==l==`、`==t==`，各留原quote/list/table容器，容器prefix不属于高亮范围 |
| 17 | `"title\n===\n\n==body=="` | 首段Setext H1完整，等号下划线不是行内H；仅正文 `==body==` 高亮 |
| 18 | `"==a\nb=="` | 同paragraph softbreak，唯一H `[0,7)`、内容 `[2,5)`，不得隐式拼掉LF |
| 19 | `"==a\n\nb=="` | 空段切断，无H，不能全篇查找后闭合 |
| 20 | `"==a ==b== c=="` | 拟定D2：外H `[0,13)`、内H `[4,9)`，同型正常嵌套且不交叉；若公共解析规则做不到不得随意改为首尾贪心 |
| 21 | `"==a **b== c**\n\n**a ==b** c=="` | 拟定D3：第一段H `==a **b==`、其中`**`字面、无strong；第二段strong `**a ==b**`、其中`==`字面、无H；先遇到有效闭合的一种结束，不能交叉节点 |
| 22 | `"<a title=\"==attr==\">==text==</a>"` | 仅H `==text==`，HTMLTag属性不高亮，不激活链接/HTML资源、不改CSP |
| 23 | `"\uFEFF==a\r\nb=="` | canonical raw H `[1,9)`、内容 `[3,7)`；CM H `[1,8)`、内容 `[3,6)`；BOM保留，rawCRLF两个单位→CM LF一个单位，只用独立手写映射核 |
| 24 | `"==a\rb=="` | raw与CM H都 `[0,7)`、内容 `[2,5)`；raw仍CR，CM为LF，坐标同长度不代表raw被改写 |

### 需要主线明确的三个语义点（现在不执行含未定项的批次）

- **D1 图片 alt**：建议保留宿主图片标签解析及语义 alt 提取：Lezer 可在image label有Highlight子节点；canonical image节点依法只有alt值、不发独立H child，不因此当“双引擎不一致”。是否令 `==caption==` 的语义alt成为 `caption`，需主线决定并在两侧显式核；若选择字面alt，应评估公开hook是否可一致表达，不能偷偷剪除图片语法。第一段外部H包image不含该歧义。
- **D2 同型嵌套**：建议允许上述外/内两个H，复用宿主delimiter规则，语义明确而非人为按最近两段文字切开；背景可视觉等效但结构必须对齐。该规则不是Typora公开保证。
- **D3 交叉闭合**：建议采用表中先闭合者保留、未配对内marker当字面，符合非交叉树和当前emphasis/strike类扩展思路；仍须公共接口实证。若主线另选拒绝整个歧义表达式，先改手写oracle再执行，不按结果追认。

### 轻量驱动设计与证据边界

单一JSON fixture表保留上述24项，逐项构建原始raw与仅CM路径需要的独立EOL映射。每条单独宿主子进程内各跑一次真实Lezer candidate和micromark/mdast candidate；比较的是各自手写期望，不把candidate输出喂回期望。记录容器/marker/content范围、图像来源/alt、代码正文以及legacy基线差异。第15项允许AST表示形状不同，但语义依据只能是批准的D1，不以“某引擎没有节点”为缺省通过。

临时只读已安装公开helper版本固定为 `micromark-util-types@2.0.3`、`micromark-util-classify-character@2.0.1`、`micromark-util-resolve-all@2.0.1`、`micromark-util-chunked@2.0.1`；若直接需要character则为`2.1.1`。仅从本地锁定ESM模块读取，未授权 install；生产是否声明direct待后续实际用量批准。Lezer公开resolveMarkers内部仍有回扫/内容遍历，候选自己的一次索引并不使宿主整体线性；本批零“两个引擎线性/硬耗时有界”承诺，成本观察后置另批。

复用实际生产解析配置的影子只更改实验import/profile，不修改生产文件；无DOM/真实Worker/GUI，本批不声称生命周期已验证。旧reading对照须真实调用已验parseReadingMarkdown与候选reading用途，两者全树比对只证明该用途保持旧行为，不证明新编辑语义。涉及image summary/copy/Callout的实际consumer只能用已明确入口对照，未接到的标unknown，不以手工函数同名冒真实接线。

每条15秒、整批180秒，24项不自动乘三种EOL；BOM/CRLF与CR由23/24覆盖，18是LF。不得加warmup、随机生成或密集压力样本；首红停止并保留所有脚本/输出，剩余项未执行。此时仍仅文档方案，等待D1–D3和具体实验批准。

## 实现后最小 happy path（后续获批才执行）

1. 同文件有普通 `==中文 highlight==`、strong嵌套、围栏内字面标记、FM内标记；编辑只有正文合法范围有背景，光标进入显标记、离开隐藏，选区复制/编辑/一次撤销原文不变。
2. `⌘⇧M` 源码全文等宽无高亮背景，无 `==` 丢失；返回编辑恢复样式，历史/光标与查找原文匹配保持；readonly可看、不可改变正文。
3. 新节点中的图片/链接、Callout与正文代码复制保持；旧reading保持原样，不宣称新阅读高亮。
4. 浅深切换只换样式；故障安全源码、跨标签与正常退出回归。完整自动测试/两独立轴后由主线升alpha、打包真实WK；自然IME与离线边界不替代。OBL-068/069只跟随新增消费者验证，不关闭完整责任。

## 只读来源

- [Typora Markdown Reference — Highlight](https://support.typora.io/Markdown-Reference/#highlight)：确认双等号示例，不提供完整边界规范。
- [Lezer Markdown 官方接口](https://github.com/lezer-parser/markdown#interface)：MarkdownConfig、InlineContext、DelimiterType；已归档仓库指向新 forge，本次与本地1.7.2公开声明/实现互核，不把归档视无效或升级请求。
- [micromark 扩展接口](https://github.com/micromark/micromark#extensions)：语法扩展与编译扩展分开；官方列出的内建扩展没有 Highlight，不能假称安装即用。
- [mdast-util-from-markdown Options](https://github.com/syntax-tree/mdast-util-from-markdown#options)：syntax extensions 与 mdastExtensions 联合提供树节点，供本片 typed 路线使用。

## 首批执行批准（主线，2026-10-16）

主线全文读取上述24条后批准 D1 为宿主语义 alt=`caption`（Lezer 可有内部 H，mdast image 无 H children），D2 允许同型内外 H，D3 按表先闭合形成非交叉树。上述“待决定/未批准实验”为此前方案状态；表中期望现在固定，不按运行结果改判。

仅批准新临时目录中的这24条：公开接口、已安装精确 helper、每条15秒/整批180秒/首红即停；先冻结全部脚本与手写期望再执行。无生产、install、版本、build、GUI 或 Git。宿主 delimiter 回扫和 resolver 事件遍历的最坏成本未获证明，本批不声称线性。真实 consumer 未接到即记 unknown，不以结构代理冒接线通过。F-041d stash、专项、F-028c 与最终离线约束均未动。

执行前主线发现并行读取的表版本差异，作者先暂停未运行；主线重读当前全文后明确批准02词内Emoji、11代码内闭marker、14链接内外闭marker三段，按 `/tmp/agentic-f047a-highlight.JTXaox` 冻结版本执行，仍为24文档。此为执行前明确确认，不是结果追认。

## 首跑初始化失败（冻结保留）

`bun /tmp/agentic-f047a-highlight.JTXaox/run.mjs` 返回1，`first.jsonl`记录第01子进程 `timeout:false`，但在解析前加载 `apps/desktop/node_modules/micromark-util-chunked/index.js` 失败。`first.stderr`为空（子进程stderr在JSON中），没有语法通过/失败结论；02–24未执行。未改脚本后重跑，原candidate/fixture/oracle全部冻结。只读检查发现该已锁helper实际在仓库 `node_modules/.bun/micromark-util-chunked@2.0.1/node_modules/micromark-util-chunked/`，不在desktop直接依赖链接下；下一仅申请新目录import路径修正，不安装、不改算法/期望/预算。

## import 窄修后首次语义红（冻结，尚不可生产）

主线实际复跑初始化失败一致后批准新目录仅import路径修正。`/tmp/agentic-f047a-importfix.GBoByY` 只把三个已安装helper指向锁定 `.bun/<name>@2.0.1/node_modules/<name>/index.js`；case/fixtures/run 与旧目录SHA完全相同，算法及24项期望未改。新candidate SHA256=`41400e621f7e4a33471b9ef1acb18ec81f49f75c352a0d4692bccecc4a97dbfb`。

命令 `bun /tmp/agentic-f047a-importfix.GBoByY/run.mjs` 首次返回1，`first.jsonl`记录01通过、02失败，03–24未执行；两子进程均无超时，批次stderr为空。02的Lezer仅有手写期望H `[0,8)`，canonical却额外产生词内Emoji H `[11,17)`，不满足已批准Unicode符号flanking。完整树和原文保留日志，未为绿更改oracle或算法后重跑。

真实image-summary/代码复制/Callout接线均未注入，明确unknown；01的旧reading全树对照只是该用途保持旧行为的有限证据。无生产、依赖安装、版本、构建、GUI或Git，等待独立复跑及主线决定最小修正路线。

## Unicode 邻居分类最小窄修方案（只读，未执行）

主线复跑 `/tmp/f047a-root-importfix.jsonl` 同01绿02红。公开本地源码证据：micromark `create-tokenizer.js` 用 `chunk.charCodeAt(point._bufferIndex)` 向状态机发送UTF-16单元，并把消耗的单元保存为 `previous`；`classifyCharacter@2.0.1` 将单个Code交给unicodePunctuation。Emoji高/低代理单元各自不是完整Unicode符号，故本候选直接使用helper不能满足已定码点分类。Lezer候选已从固定至多2单位邻域取得完整码点，两侧分类入口不等价；不是文件长度或原文丢失。

不使用私有 `_bufferIndex`/`_index`，不伪造Point，不对每marker取全文/长token切片。公开 `TokenizeContext.now()` 与 `Token.start/end.offset` 提供原始输入offset，但 `sliceSerialize` 要求真实完整Point，且对前一data token取全文再截尾可能重复大段复制，故不采用这个看似局部的方案。

建议只改临时canonical扩展工厂为 `highlight(parseText)`：每次fromMarkdown调用建立独立闭包，捕获**同一个实际传给fromMarkdown的剥BOM字符串**（复用字符串引用，不另做全文复制）。开/闭marker的真实token.start/end.offset定位左右邻居，分别最多读取2个UTF-16单位拼完整码点，交与Lezer一致的空白/Unicode P或S分类。遇宿主Code为null或负的virtual空白/EOL，仍按宿主空白规则，不把负值当字符串索引；其他非法offset拒绝本候选，不猜范围。闭包不跨调用/文档共享；不改事件解析或mdast位置加BOM步骤。

新目录仅此分类输入接线及固定常量邻居helper；24项、所有手写oracle、resolver/配对、legacy对照、15/180秒与首红停止不变。没有新依赖或新压力输入，完整emoji分类成本仅每marker至多4个原始单位；这不是宿主整个解析的线性或硬预算承诺。独立Spec也建议此公开输入闭包路线。待主线全文批准再执行，不把新方案写成已验证。

公开坐标依据：`micromark-util-types@2.0.3` 的 `Point.offset` 文档为“0-indexed position in the document”，不是当前inline片段相对位移；Token.start/end用该Point。只读本地实现交叉核：`micromark-util-subtokenize` 从 `token.start` 创建子tokenizer，后续容器行调用公开 `defineSkip(current.start)`；create-tokenizer用 `from.offset` 初始化，并在容器换行skip中累计被略过prefix长度，CRLF增加2个原单位。故候选捕获整次原始parseText而非容器slice，正常token offset仍以该输入为坐标。实现只用公开offset，不调用上述内部函数；第16容器与23/24 EOL仍是必须运行的独立oracle，不能把静态接口证据冒已测。

## Unicode 窄修首跑收据（候选，待独立复跑）

主线全文读取上节及公开声明后批准同24条新目录执行。冻结 `/tmp/agentic-f047a-unicode.JSBZh2` 只改同次parseText闭包、公开token.start/end.offset与最多2单位邻居分类；null/负virtual仍调用宿主分类，非法offset抛错不猜。resolver、case、fixtures及run完全不变；candidate SHA256=`62cb4b1efe71cdf72e64b2adddf245c63bb90aef6b20bbd8bad4657c97010671`。与上一目录的 `diff -u .../candidate.mjs .../candidate.mjs` 可复核全部变更。

首跑 `bun /tmp/agentic-f047a-unicode.JSBZh2/run.mjs` 返回0，`first.jsonl`为24条全部通过且均无timeout，`first.stderr`为空。01–24均已执行，包含两侧手写范围、marker范围、D1 alt=caption、D2同型嵌套、D3非交叉树及11/14字面未配对marker；第16容器、第23 rawCRLF/CM LF与BOM、第24 rawCR/CM LF固定oracle通过。每条legacy配置与真实已验阅读parser对照一致，只证明该有限用途未变，不是新阅读呈现。

真实image-summary/代码复制/Callout仍unknown；该批只检查真实AST中的image/code等字段与结构，不冒实际consumer所有权、Worker、装饰或GUI验证。旧初始化失败与Emoji语义失败全部保留。已发主线及两独立轴复跑，未自批生产或产品验收；无源码/依赖安装/版本/build/Git。

## 下一前置：一次有限密集标记成本对照（仅方案，未执行）

主线已实际复跑上述24条均通过。下一不重跑已知1MiB极端canonical，也不扩大语法矩阵；只使用新mktemp成本驱动导入冻结Unicode候选及已验生产baseline，不修改它们。四个固定ASCII样本如下，构造表达式也是冻结输入定义：

| 样本 | 精确构造 | UTF-16长度/UTF-8字节 | 用途 |
| --- | --- | --- | --- |
| C1 | `"plain x\n".repeat(4096)` | 32768 / 32768 | 同规模普通正文基线 |
| C2 | `"==a== x\n".repeat(4096)` | 32768 / 32768 | 同一段落4096个正常配对marker |
| C3 | `"x x a==\n".repeat(4096)` | 32768 / 32768 | 同一段落4096个只有闭侧资格的marker，观察缺opener失败回扫 |
| C4 | `"==a **b== c**\n\n".repeat(2048)` | 30720 / 30720 | 2048个小段落的非交叉闭合与事件重组 |

每样本分别运行已验Lezer全文parser、candidate Lezer、已验editing canonical、candidate canonical，各独立子进程**只解析一次**，共16次，不warmup、不取最好值、不修改size。宿主每次15秒，整批180秒；异常/超时首个即停止，未执行项明确列出，不能缩输入凑绿。初始化完成才记录parse前后 `performance.now()`；另记实际bytes/units、parse成功、H数量（C1=0、C2=4096、C3=0、C4=2048）、真实根长度/原文未改，baseline没有H属于预期。canonical计数遍历在parse计时之外单独记耗时，不能把统计时间当parser时间；不输出整棵大树或正文。Lezer也单独记必要统计时间。进程启动与整批墙钟另列，Bun单机样本不是WK或SLO，没有固定性能通过门槛。

正常完成只回答“这四个有限输入未发现不可接受的异常/超时，成本量级可见”，不证明所有输入/生产高并发/每键延迟。相对baseline显著增幅需主线判断路线，不凭一次比值自批。已知Lezer resolveMarkers与候选micromark resolver有回扫、slice/splice及嵌套递归，最坏复杂度仍未证明；不能把两个局部邻居读取改为常量就声称整体线性。若本批暴露严重放大，只报告最小resolver修正方案，不默改后重复压力。

## 消费者接线的最小选择（本轮不复制生产影子）

只读确认：`summarizeImages` 内部固定导入editing canonical，`createEditingCodeCopy` 通过已有独立owner请求canonical，Callout则沿真实Lezer cursor/定义摘要。为了临时注入新语法而复制这些模块/Worker协议/owner会制造第二套实现，收益低且仍不能证明正式接线。因此本批不再造消费者影子；保留unknown，作为**获批typed接线后的必要测试**，不得用24条AST字段比较取代。

正式测试必须调用真实入口：高亮外包image、image alt内高亮、reference定义在首部外与首部内排除的image summary；带高亮段落的正文围栏实际copy target/owner及raw EOL映射；Callout标题/正文的高亮marker排除但内容与图片/link不丢；普通格式命令遇高亮完整/部分选区的保真或明确拒绝。每项接在现有对应测试文件，不新建庞大通用consumer注入层。旧reading profile及其实际parser保持原样；本片不接reading renderer。

## 最小typed生产接入方案（待主线批准，不是实施收据）

1. **单一原子扩展与固定profile。** 新 `highlight-extension.ts` 提供 typed Lezer配置、按同次parseText创建的micromark配置和mdast配置，统一恰双run/内侧非空白/Unicode邻居规则。`ExtendedMarkdownPreset`的现有固定组合点接入，不做用户开关或通用插件系统。Lezer保持同一static nodeSet前后台一致；MARKDOWN_GRAMMAR与EDITING_CANONICAL_PROFILE递增，reading-legacy版本不变。真实grammar fragment与document配置都包含行内扩展，但FM原子块仍排除，不能全局改reading。
2. **公开typed协议。** 通过官方MarkdownConfig/DelimiterType、micromark Extension/Tokenizer/Resolver/Event/Token与mdast扩展声明类型，不用any或私有栈。mdast `PhrasingContentMap`增加highlight(children)；只对实际自有token增加必要类型，不扩公共Worker可执行payload。生产直接依赖只声明确实使用的已锁helper：chunked2.0.1、resolve-all2.0.1、classify-character2.0.1及types2.0.3（类型用途按仓库惯例）；不升级其他包。Unicode闭包捕获同次剥BOM parseText，不跨owner缓存；marker限定邻域，virtual空白/EOF保宿主。
3. **配对成本与宿主语义。** 不在本片更换全文parser。待四例成本收据后，主线决定是否采用窄的官方strike同构resolver；若采用，明确仍有回扫/数组重组最坏成本，不能复制后冒线性；保留现有canonical owner按需Worker与失败/取消路径，不新加每次输入全文canonical解析。Lezer仍由现有增量/后台/长行保护调度。生产正式回归24条及实际CM/strict wire往返、旧消息profile拒绝，不以临时独立parser代替真实工厂。
4. **编辑装饰与源码隔离。** 只在live-formatting已有可见、非保护树遍历中处理Highlight与HighlightMark，复用全选区触碰显隐及IME/安全模式路径。编辑背景使用主题token，字号/字重不变；源码不含背景或marker replace。两模式原文/history不改，readonly照常只读；不新增按钮/快捷键。主题切换仅样式，不重启解析。标题/code/FM折叠与高亮相交时遵守现有折叠装饰排除，不产生重叠replace异常。
5. **必要消费者与保护。** Callout语法壳显式识别HighlightMark；image summary递归新phrasing节点且alt保宿主语义；code copy保持真实canonical code值和raw target。inline-format按现有unsupported语法边界将Highlight/HighlightMark纳入必要保护，先用实际选区验证“不破坏标记”，不借此交付高亮toggle能力。原有链接/图片、搜索、全选/复制、一次撤销不改路径。新语法不生成HTML/执行脚本/加载资源，CSP协议不变。
6. **实现后最小验证与真实验收。** type、定向lint/上述实际consumer与parser/wire/CM装饰测试，全量及两独立轴后，由主线管理下一alpha、构建、真实WK。实际编辑显隐/选区复制/撤销、源码全文无背景、readonly、跨标签、折叠与浅深主题、正常退出为有限happy path。自然物理IME、极端成本/精确竞态、完整父及离线不以合成事件或小样本通过关闭。产品手册只记已验有限范围；当前尚无生产/验收/Git批准。

成功路径不再新增层层等价模型：四例成本完成并经主线评估后，以上typed路线与独立审查收敛即可进入正式实现；真实消费者unknown转为实现后测试责任，而非提前宣称兼容。

### 四样本执行批准

主线全文读取后指出原C3只有open不会触发逐closer查找，执行前明确改为上表close-only字符串；预期仍H0，不是结果追认。批准仅四样本×四路径=16独立单次、15秒/次与180秒整批、首异常/超时/计数红停止。消费者不另复制影子，转正式接线后真实入口必需测试；typed生产仍未批准，须待成本及独立路线结论。

### 四样本首跑成本收据（待路线判断）

冻结 `/tmp/agentic-f047a-cost.JKwX2r`，`bun .../run.mjs` 首跑返回0，16次全部成功、无timeout，整体墙钟2378ms；`first.jsonl`含parse/统计/进程墙钟分列，`first.stderr`为空。case SHA256=`c8240fbefb5048a5437cac2c5b1c7d50bb05ba75579e76f684c1f9057d23234a`，run SHA256=`7201b785acec369bfebe99542b93c6a6c2ee0e3831ca345b7ab6cc4d6fc6ff03`。输入大小、全部根长度和四项H数量独立断言通过。

| 样本 | baseline Lezer ms | candidate Lezer ms | baseline canonical ms | candidate canonical ms |
| --- | ---: | ---: | ---: | ---: |
| C1 | 9.152 | 9.802 | 59.675 | 59.445 |
| C2 | 9.288 | 17.116 | 67.068 | 126.840 |
| C3 | 9.345 | 28.882 | 67.285 | 323.642 |
| C4 | 12.900 | 15.024 | 74.304 | 81.783 |

统计遍历另计，最高2.818ms，不混入上述parse值。C3仅32KiB已观察canonical约4.81倍及Lezer约3.09倍放大，作者已明确报主线评估；“16次没有超时”不等于性能可接受/线性或生产批准，不用15秒宿主监督当产品门槛。本轮未扩大规模或重跑选最好值，未改resolver。consumer继续待正式接线后测试，两独立轴已获冻结命令等待复跑；无生产/版本/build/Git。

## resolver 失败查找下界窄修方案（只读，未执行）

主线同四样本复跑16/0，但C3 canonical317.59ms对65.31ms，日志 `/tmp/f047a-root-cost.jsonl`；明确不批准原回扫直接生产。下述仅修高亮自有resolver的重复失败查询，不改Lezer私有实现、Unicode分类或24条语义。

每次 `resolve(events,context)` 建独立局部 `floor=0`，表示此前失败已证明不含可用opener的前缀之后，下一次允许查询的首个event索引。候选只有一种长度恰2的delimiter，无多长度类别可混用该结论；每次递归resolver有自己的floor，不跨调用/文档缓存。

1. 遇临时闭marker的enter事件索引 `i`，仍从 `i-1` 倒查到 `floor`（含）找既有同类临时marker的exit且 `_open` 为真；匹配条件不变，不用“全篇没有open”的输入特判。
2. 若本次失败，则这一范围内没有候选opener，令 `floor=i`（当前enter索引），后续不重新扫描此已证失败前缀。当前闭marker也可能 `_open=true`，其exit事件位于 `i+1`，必须留给后续closer匹配，不能把可双向的当前marker一并排除。没有任何失败时floor保持0，合法已有opener继续可见。
3. 若成功，仍用原公开resolveAll处理内部事件并执行同一splice；随后**保守重置 `floor=0`**。这是主线采纳Standards后指定的最小实现，不维护成功splice后的复杂索引证明或重映射；此前作者提出的min下调不实施。因此只优化连续失败查询，不承诺成功频繁时的回扫成本下降。
4. 成功时原算法将两端temporary改为sequence，内部resolveAll在独立slice上解析；外部prefix不改。内部递归返回的节点/配对marker不是新temporary opener，不可穿过已形成父节点重新交叉配对。当前marker若本次成功作为closer，就按原算法消耗，不额外兼作新的opener。主循环的成功后index公式、最后未配对temporary降为data保持原样。

下界不变式只涉及**此前查找失败且未被后续splice触及的前缀**，不是“已经扫描过的所有事件都可永久丢弃”。不能在任意成功后推进floor至closer末尾，否则会吞掉此前仍未匹配的外层opener。特别是第20同型嵌套和第21交叉优先级，必须保持既有精确oracle；本方案不声称宿主其他resolver不会回扫，也不声称slice/splice、递归或Lezer整体线性。

获批后新mktemp从冻结Unicode候选派生，只改上述查询循环/局部floor及必要注释；24条fixture/case/oracle、Unicode/配置保持SHA原样。先跑同24小语义一次（15秒每例/180秒整批/首红停），全部通过才导入该新候选跑同四固定成本16次一次（相同15/180监督）；不扩大样本、不改旧日志或挑最好值。记录两命令与candidate最小diff，独立复跑后主线再决定typed路线；生产/版本/build/GUI/Git仍未批准。

### 失败下界窄修执行批准与首跑

主线全文批准失败floor=i、成功floor=0、每resolve独立的新临时实验；另明确批准**独立补充25**：`a==b==c==d==`，H `[1,6)`/`[7,12)`、内容b/d、marker `[1,3)`/`[4,6)`/`[7,9)`/`[10,12)`，外部text为a/c，无嵌套。此补充验证成功splice后另一个失败closer仍可作未来opener，不回改原24；25条每例15秒、整批180秒，首红停，全部通过才跑原四成本。

冻结 `/tmp/agentic-f047a-floor.dhstTu`，candidate SHA256=`68663adc1ca62cb8968243e961d71b159f8ffbe8fdce988b7405c7ca4d563ec6`，原case/fixtures SHA保持；case25单独文件。`bun .../run.mjs`首跑25/0、返回0、无timeout；`first.jsonl`保留完整树与结果。随后`bun .../cost-run.mjs`首跑16/0、返回0、无timeout，墙钟2127ms，`cost-first.jsonl`保留分项统计，两个stderr均空。未修改旧候选/失败。

| 样本 | baseline Lezer ms | floor候选 Lezer ms | baseline canonical ms | floor候选 canonical ms |
| --- | ---: | ---: | ---: | ---: |
| C1 | 9.371 | 10.833 | 60.060 | 61.005 |
| C2 | 9.439 | 16.827 | 66.229 | 128.502 |
| C3 | 9.322 | 28.286 | 65.593 | 77.993 |
| C4 | 13.015 | 14.631 | 75.630 | 82.203 |

C3 canonical本次77.993ms，相比原候选323.642ms下降，但这是同机各单次有限观察，不取最好值、不宣称稳定倍数或全局线性；LezerC3约28ms仍有宿主回扫放大未被本片修改。C2创建4096个新语义节点相对baseline仍有成本。所有固定count/rootlength断言通过，仅证明有限结构与成本样本。已交主线及两独立轴复跑，typed生产仍待主线正式批准；真实consumer/装饰/生命周期/WK仍未验证。

## 正式有限实施批准及候选收据

主线及独立Spec/Standards均复跑25/0与16/0，主线全文读typed六点、公开API及floor后正式批准本片源码/必要直接依赖/实现后测试；不授权作者版本、build、GUI或Git。实际采用floor窄resolver，保留完整MIT版权与许可文字，不冒整体线性。另经主线明确允许同已锁 `@types/mdast@4.0.4` 为devDependency，供真实mdast节点映射类型声明。`bun install --ignore-scripts`退出0，lock仅5条workspace直接依赖元数据新增，无已锁包升级。

候选已接入单一HighlightExtension、编辑grammar/profile与editing canonical用途、编辑可见装饰/源码颜色隔离、Callout marker壳与既有格式命令保护。reading legacy profile/parser不变；mdast注册PhrasingContentMap及RootContentMap供现有typed递归消费，不用any扩散。真实image summary、实际代码copy target/owner和Callout函数已有实现后回归，不再以实验AST字段冒消费者接线。产品手册只记候选。

实现后首轮失败均保留：mdast首次只注册PhrasingContentMap造成现有递归类型不闭合，补标准RootContentMap；Tokenizer的State允许undefined，修类型声明而非改解析；测试误用isolated=true关闭了工厂parser、误用sourceColorDecorations参数、between回调隐式number及官方opaque spec的unsafe类型均已按公开实际接口修正。另纯装饰函数与真实模式compartment不同、近行扩展可保留被fold盖住的底层mark，原测试错误要求“source纯函数无装饰/折叠范围无mark”失败后改验实际源码样式compartment与source颜色入口、fold范围包含/定位展开，真实像素交后续WK，不因测试改生产保护。初始grammar硬编码期望按本片正式新profile精确更新，旧profile拒绝另有断言。

当前定向命令覆盖highlight-extension、editing-code-copy、image-summary、canonical-autolink、gfm-strikethrough、heading-folding、live-formatting、inline-format八文件：**112 tests / 1359 assertions / 0 fail**，日志 `/tmp/f047a-author-targeted.log`。新25条全部走实际createRawEditorState与strict wire，原文及BOM/EOL、marker范围、嵌套和排除维持手写oracle；源码无背景、readonly格式拒绝、定位解折叠、历史undo/redo和profile旧消息拒绝均有限自动验证。自然IME/真实WK像素、真实主题/只读输入/退出尚未执行，不把该自动结果当验收。

候选最后typecheck、十个源码/测试路径定向eslint、feature-docs/obligations、lock registry与git diff check均退出0。作者冻结交主线及两独立轴最终代码复核；全量、版本/构建/真实验收/正式批准由主线管理，本条不预写通过。

### 只读测试证据修正（不改生产）

独立Spec发现上段readonly测试仅追加低优先级facet，被工厂writePermission默认false遮盖，实际state.readOnly=false，旧绿不能作为只读证据。已使用公开writePermission.reconfigure并断言true。补实际controller拒变更测试首次同样漏掉GUI挂载时的权限同步，主线全量捕获1409pass/1fail/33772，保留 `/tmp/f047a-alpha162-source-tests.log`；作者定向旧红保留 `/tmp/f047a-author-readonly.log`。该setup缺项不构成生产守卫失败，也未改权限实现。

正式补测直接调用已有prepareEditorViewState真实接线，分别在编辑/源码断言readOnly=true、editable=false；经controller.updateEditor提交变更返回false，state身份、CRLF原文、undoDepth与clean状态均保持。修后三文件65pass/619assert/0fail，`/tmp/f047a-author-readonly-fixed.log`。本次只修改两测试文件及此收据，生产不变；真实WK仍由主线完成。

再冻结定向十文件146pass/1746assert/0fail（`/tmp/f047a-author-final-targeted.log`），typecheck退出0；新增import顺序lint一红按排序修复后两测试eslint、feature-docs/obligations和diff check退出0。此收据替代旧只读证据，不替代主线最终全量或验收。

## alpha162 主线真实候选收据（待最终复核）

- 自动与构建：源码 `/tmp/f047a-root-source-recovery.log`、包内Bun运行仓库 `/tmp/f047a-alpha162-bundled-tests.log` 均1410/33788、退出0。alpha162/hash `1jrx3g6uy44x8` 构建成功，日志 `/tmp/f047a-alpha162-build.log`；后续只有测试修正，生产未变，未重构建。
- 实际运行：direct `/tmp/agentic-direct162.vQ5UJz`，隔离data `/tmp/agentic-f047a-ui.LtatgD/data`。打开自建highlight.md与readonly.md，深/浅主题高亮实际绘制；焦点触及时显示marker、移出隐藏，源码完整原文且无高亮背景。粗体、删除线、嵌套、链接label、Callout、table cell，以及代码/Frontmatter排除均有实际截图。标题`⌘⌥F`折叠无残色、展开恢复。
- 编辑与只读：原生双击可见highlight文本、复制粘贴到尾部确为highlight，一次undo回clean；再双击替换为edited形成`==中文 edited==`，一次undo恢复原文clean。readonly权限444时编辑/源码typeText X/Y均拒绝，跨标签返回highlight正常。这些工具文本输入不是自然中文IME候选验证。
- 失败与恢复：AX selectText请求中文highlight后，一回实际粘贴得到完整字符串`ghlight==，以及 ==**粗`，一次undo回clean；改用原生双击并核可见选区后复制正确，不推断AX根因。主题AX点击浅色后Escape取消，主题未变；改combo Home/Return提交后浅色成功。组合invalid同一行可在相邻marker间合法形成“、a”高亮，不能把分段孤立oracle机械用于整行并声称全不高亮。
- 退出与保真：`⌘Q`正常退出，exec26352退出0、Bun21389消失；IMK退出stderr保留，不推因。readonly恢复644，三份自建样本SHA与主线summary基线全同。other.md只准备未打开；未修改用户正文。
- 限制：本批未执行自然IME、极端规模、完整竞态、真实图片呈现（只有自动consumer证据）或网络/离线验证。真实浅/深为有限happy path，不冒完整主题矩阵。完整F-047、阅读子窗承接及最终离线人工保持开放；此段只汇总主线实测，不由作者自批通过。

### 最终主线批准与样本保真

最终独立Spec与Standards均0必要阻断，主线正式批准alpha162非离线有限片受托Agent代验通过，非用户亲验；作者仅同步此结论。Git未在本收尾执行。三份样本实际SHA256读回如下，与主线基线一致：

- highlight.md：`912d58fb170a05a8d5295ec952d01e4b5c8b79bae51009144afe4a7759110db5`
- readonly.md：`81de78a5901e76371c2b46535ca67b7977acd618959cffa4514a353e8e5ce9df`
- other.md：`e12e8dccfeb467e8a836ff6a6c3dbfd70f6888868322c4257378d5c9d870442e`

本片只完成高亮编辑/源码有限范围，不关闭完整F-047、OBL-068/069、阅读子窗承接、自然IME等未测边界或最终离线人工。
