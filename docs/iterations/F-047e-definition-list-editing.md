# F-047e：定义列表编辑呈现与源码保真

> 状态：局部14例有限证据保留；完整容器路线及interrupt窄修均在原表格P0失败，主线与独立Spec复现，P1–3未跑。当前不批准生产；技术路线待收敛，完整定义列表需求保持开放。持续批次转向不依赖本片的F-060c准备，不取消本片或冒称已交付。

## 首个隔离检查获准（2026-10-16）

主线全文读本方案与已安装Lezer公开Block/Leaf契约、维护者README和PHP Markdown Extra定义列表来源；独立Spec/Standards均0必要隔离阻断。现仅批准新临时目录固定`micromark-extension-definition-list@2.0.2`及`mdast-util-definition-list@2.0.1`的canonical **E12** 单次检查，记录registry完整性/许可；真实production editing全部扩展底座仅追加候选，不改GFM次序/删节点/normalize抹位置。先断手写table/header及两body cell、无DL，再比真实完整AST。宿主15秒监督；初始化失败或语义红立即停止，E1–11与Lezer不执行/不写。绿也只证明E12，不批准其它实验或生产/仓库依赖/版本/build。下方12条为后续候选，不将未冻结完整语法当已确认行为。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## 1. 产品范围与前置

依据[总账117 / S-09及历史决策](../product-capability-register.md)：原子 `DefinitionListExtension` 加入固定 `ExtendedMarkdownPreset`；术语行后跟一个或多个冒号定义；编辑模式显露必要结构标记，源码原文保真，使用固定兼容性 corpus。这不是 CommonMark/GFM 核心，也没有依据宣称“Typora定义列表兼容”。

本片建议优先实现编辑用途的规范结构、Lezer结构及局部术语/定义样式与标记显隐，源码完整保留。定义正文仍由既有 Markdown 行内/块消费者处理，不转HTML注入、不维护第二份正文。读取/保存、BOM/EOL、撤销/只读与IME原有边界不变。不新增自动续写/缩进快捷键、定义列表折叠、导航或编辑表单。

阅读继续明确 `reading-legacy`，不借新canonical结构自动改变旧阅读；阅读子窗的语义呈现接入在对应轮完成，不能据本片关闭完整F-047。源码只保真，不渲染编辑样式。固定原子扩展加入编辑profile，未来阅读承接可复用语义，而非复制新解析器。

已读[义务登记](../deferred-obligations.md)：未找到F-047既有主责OBL，本片none不等于无验证责任；OBL-068/069仍仅外观协作。FINAL-ISSUE-001/002继续开放，不以本片覆盖既有组合输入/全量超时问题。F-041d冻结、F-028c专项、最终离线不动。

## 2. 已核接口与依赖候选

- 当前锁与desktop依赖未含定义列表扩展；Lezer Markdown公开exports无DefinitionList。安装版本公开 `BlockParser.leaf`、`LeafBlockParser.nextLine/finish`、`BlockContext.addLeafElement`可在段落式叶块观察后继冒号，`before/after/endLeaf`定义与列表/Setext等优先级。没有公开回退nextLine能力，不能消费多行后return false伪装原文正常解析。`startComposite`可表达容器，但具体术语与多个definition父子关系仍待有限实证。
- [micromark官方项目扩展清单](https://github.com/micromark/micromark)列出第三方[wataru-chocola定义列表扩展](https://github.com/wataru-chocola/micromark-extension-definition-list)。官方npm registry只读核实候选 `micromark-extension-definition-list@2.0.2`、`mdast-util-definition-list@2.0.1`，均MIT；未安装。后者提供from-markdown类型/结构转换，不等于需要本App引入to-hast/to-markdown运行路径；如采用须核其包依赖与真实tree-shaking，不先承诺包体免费。
- 维护者说明以[PHP Markdown Extra定义列表](https://michelf.ca/projects/php-markdown/extra/#def-list)为目标，同时明确与其它扩展兼容存在风险，并列出冒号行截断GFM table的已知问题。此为必须测试的红能力样本，不要求用户改原文绕开。本App已验表格不能退化。
- [Pandoc手册](https://pandoc.org/MANUAL.html#definition-lists)另有tilde及compact变体；本产品只确认冒号，不自动全量引入Pandoc选项。以下窄语法为待批准的App固定profile提案，不按依赖输出追认产品规则。

本轮最小路线先验证现成canonical候选是否满足冻结核心结构和表格兼容，再验证Lezer公开接口能否表达同样结构。若canonical出现已知兼容红，首红停报告最小修正/替代方案，不直接迁生产或无界改第三方解析器。API声明支持不等于实现已证明。

## 3. 待冻结语法边界

建议首个profile：非空术语后直接跟冒号定义，冒号必须跟至少一个空格或tab；同术语允许连续多个定义。冒号前最多三个缩进空格沿宿主容器计算，不将四空格代码抢成定义。孤立冒号、无后空白、转义冒号、代码/HTML/FM内部保持宿主语义。普通段落和定义正文中的行内语法沿既有组合解析，不对字面文本自造正则渲染。

空行分隔术语与定义、多术语共用定义、多段/嵌套definition、懒续行/缩进归属的最终完整规则尚需收敛；首批不覆盖这些并不代表产品永久取消。首批仅能证明下列明确核心与冲突，不能称完整定义列表已完成。若原子节点接入会改变这些未冻结输入，必须列出候选真实行为供主线决定，不能靠未测试推定兼容。

## 4. 首批建议：12条固定语义oracle，尚不执行

输入以JSON字符串表示，半开位置使用原输入UTF-16；本批均LF，无BOM。`DL`表示一个定义列表语义容器，`DT`术语，`DD`定义；两栈节点名可不同，父子/内容/位置必须明确匹配，不能仅看节点总数。列表整体range应覆盖表内语法块，不吞尾随空行或后继正文。下表为手写期待，不由候选运行生成。

| 编号 | 输入JSON | 手写核心期待 |
|---|---|---|
| E1 | `"Term\n: def"` | DL[0,10)，DT文本Term[0,4)，一个DD正文def[7,10)，冒号[5,6)。 |
| E2 | `"Term\n: one\n: two"` | 一个DL，一个DT，两个同级DD正文one[7,10)、two[13,16)，不能变两个术语。 |
| E3 | `"Term\n: def\n\nTail"` | DL[0,10)，独立后继Paragraph Tail[12,16)，不吞后继。 |
| E4 | `"Term\n:def"` | 无DL，普通段落原文；缺必要分隔空白。 |
| E5 | `": def"` | 无DL，孤立冒号原文，不生成空术语。 |
| E6 | `"Term\n\\: def"` | 无DL，宿主Escape正常；定义语法不能抢转义冒号。 |
| E7 | `"Term\n:\tdef"` | 一个DL，DT Term，DD def[7,10)，tab原文不改。 |
| E8 | `"Term\n: **bold** and [x](u)"` | 一个DL，DD含strong bold与link x→u；不得把内部语义压成纯text。 |
| E9 | `"> Term\n> : def"` | 外层Blockquote，内DL/DT/DD，正文def[11,14)；QuoteMark不属于DT/DD可见文字。 |
| E10 | `"```\nTerm\n: def\n```"` | 单FencedCode，无DL，代码内容Term换行: def。 |
| E11 | `"Term\n---\n: def"` | SetextHeading2 Term保持；后继普通Paragraph : def，无DL，不逆向抢标题。 |
| E12 | `"head\n| - |\nrow1\n: row2"` | 保持既有GFM一列表格：header head，body两行row1和: row2；无DL，完整表格结构与当前production基线相同。 |

E1长度核算：`Term`4+LF1+冒号1+空格1+`def`3=10。E2整体16、E9整体14。正式驱动须同时断DT/DD父子与原始marker，不把HTML外观等价替代结构证明；E8至少核真实内部strong/link及URL。E12除手写结构还与当前已验production完整AST对照，不能只断DL=0。

待主线批准后才可新mktemp纯模块+薄单命令驱动。建议固定上述12输入、每例宿主15秒/整批180秒、单次无warmup，首语义红/超时停并保留未运行项。临时依赖仅固定registry版本与许可/完整性记录；不安装到仓库。Lezer不可安全表达则报告接口缺口，不读取私有children/input或每按键全文重解析。该首批不做大压力/新Worker/UI，不称有界总CPU或完整增量可用。

## 5. 通过首批后仍须承担的接入责任

首批建议执行顺序为 **E12 → E1–E11**，先测已知GFM表格冲突；不改变12条输入/oracle，避免已知阻断后继续堆积绿例。

首批通过也不授权生产。最小typed方案须明确单原子Extension、固定nodeSet/wire与编辑canonical profile变更、旧profile拒绝和legacy隔离；局部fragment入口与真正document入口区别；同Text/tree可靠性、partial不误解释、视口预算/原子失败保原文。不得新增每键canonical全文或共享跨文档隐态。

实际消费者不能仅因已有递归就冒通过：图片摘要/alt与定义引用、Callout正文判定、代码复制target/owner、inline-format全/部分选区、标题/代码折叠边界与查找需明确承接。嵌套块definition如果改变这些遍历白名单，必须真实入口回归。后续冻结BOM/CRLF/CR、容器缩进、空行/空定义/多段与长段落等必要语义及有限成本，再进入正式实现后测试；不是不断追加孤立模型或无限矩阵。

编辑最小happy path：打开Term/: def→非焦点术语与定义区分且冒号隐藏→进入该块显露原标记→修改一次/撤销恢复原文→源码完整→只读可看不写；浅深、滚动/partial、跨标签、IME、正常退出及自建SHA按实际WK有限验收。语义化definition list在编辑中的具体DOM/可访问性应由正式接入方案确定，不把视觉缩进冒完整语义化输出。

本文件只提出方案，尚无实验结果、代码或依赖变更，无版本/build/UI/Git；主线完成当前片验收与Git后另行批准执行。完整父、阅读子窗与最终离线仍开放。

## 6. 继承检查清单

- **F-002**：解析依赖本地打包，不新增网络资源；最终离线人工保持，不执行断网测试。
- **中文与外观**：术语/定义样式复用主题变量，失败提示中文；OBL-068/069完整责任不关闭。
- **命令与键盘**：不新增定义列表自动续写/快捷键；现有Enter、Tab、保存/撤销和IME守卫不绕过。
- **安全与日志**：不注入HTML或执行定义内容，不打印用户正文/路径；canonical-markdown允许节点、wire白名单及summary owner对新结构的接纳均是正式接入必验，不因临时parser绿而假定通过。

## 7. 首次 E12 初始化失败收据（2026-10-16）

按主线仅 E12 批准，在 `/tmp/agentic-f047e-e12.63VfEB` 创建纯候选模块与薄驱动。临时 `bun install --ignore-scripts` 成功，固定两个直接版本，不修改仓库依赖。registry 精确版本元数据与落地 LICENSE 均为 MIT：

- `micromark-extension-definition-list@2.0.2`：`sha512-475nroY7fOVNMVs36i8R9K8Nuy4ZJABYupKpQS3MR/83ijbG8PMltxLeCPkPyUrJqgUrXpQ86vm0K02qYMfB6g==`。
- `mdast-util-definition-list@2.0.1`：`sha512-o3bsHwKEentTj5LtRpKJfGNFH1FCq7igzdxRlPxNJGwOotICE4A7ZHiExd5B9d5rrEB02hrsZHZm0tVSJnpB6Q==`。

`production.snapshot.ts` 保留真实 canonical-parser 来源；`candidate.ts` 仅重定向原导入到实际解析路径并追加两候选扩展，保留全部编辑扩展顺序、BOM 位移、Callout 注解和完整位置。`case.ts` 冻结 E12 原输入、手写单表格三行/三单元格文本期望及完整 AST baseline equality，未删除或正规化 AST。

首次命令 `bun /tmp/agentic-f047e-e12.63VfEB/run.mjs` 返回 **exit 1、timeout false**。宿主 15 秒监督包含模块初始化。驱动误将公开 `defList` 对象当工厂，调用 `defList()` 抛出 `TypeError: defList is not a function`；错误原文保存 `first-run.log`。这是实验接线初始化失败，未得到候选 AST，不是 E12 语义红或绿，E1–E11 与 Lezer 均未执行。按首红停止，未自行修正重跑。

失败后只读公开声明确认 `defListFromMarkdown` 也为对象而非工厂；下一最小建议是新目录仅改两处为对象引用，原目录/oracle/底座/监督不变，须主线另批，不把初始化失败冒依赖算法缺陷。

冻结 SHA-256：candidate `ac5a4c08e959462c2c6e52d4443df9a9f42bcba5172a93130c479af51d33d11b`；case `b098f58e2092a6df1fa13ee515c1fd2b19954fcdccfc1bf045096bb0e80af148`；run `206fab08c888205d598cc0c6c2fe85f48b52cacb3cfefd664db941779aeb849e`；临时 lock `20439442d7ea54d241d18d45b7bb014b9b1e11175b2956788800bac9cbaf5dcc`。未生产/版本/build/UI/Git。

## 8. 公开对象 API 窄修后的 E12 语义红（2026-10-16）

主线读取两个公开声明后批准新目录仅移除 `defList()` / `defListFromMarkdown()` 两处括号，不改 oracle。复制至 `/tmp/agentic-f047e-object.EWpxbt` 后用 apply_patch 执行此两行修改，diff 已核仅两处。新 candidate SHA-256 `2a9aad37f05574c38940c4b4c59b37125719a0ccad104d5c6c6fbf10d550faf9`；case/run/lock 与第7节同 SHA。

实际命令 `bun /tmp/agentic-f047e-object.EWpxbt/run.mjs`：**exit 1、timeout false**。初始化成功，真实 production baseline 的根仅有一个 table，含 header `head`、body `row1`、body `: row2`。候选根有两个子节点：table 只含 header 与 `row1`，`[16,22)` 的 `: row2` 被拆成根级 paragraph；table 结束点由22退至15。手写 `root.children.length === 1` 断言红（actual2/expected1），完整 AST equality 因先前断言失败未执行，但完整两树已在实际工具输出 chunk `9e9650` 输出，可直接复跑核查；失败 stderr 摘录在新目录 `object-run.failure.log`，不声称该摘录包含全部 AST。

这确认该固定候选直接追加到当前真实编辑底座会破坏既有 GFM 表格，**不可据此路线进入生产**。不改 GFM 次序、不要求用户转义、不修改手写期待。遵守首红停止：E1–E11、Lezer、消费者与成本均未执行；本次并未证明定义列表其它语法可用。旧初始化失败目录完整保留。主线及独立Spec/Standards实际复跑同样exit1/无timeout，日志分别`/tmp/f047e-main-e12.log`、`/tmp/f047e-spec-e12.jsonl`与`.stderr`、`/tmp/f047e-standards-e12.log`。主线接受此路线失败，不推断所有公开接口无解；本轮无生产/仓库依赖/版本/build/UI/Git。

只读后续调查：安装包公开`defList: Extension`为常量，无公开table兼容配置；内部资格函数将tableHead/tableRow纳入可能术语并依赖内部tokenizer事件，不批准包装私有函数或改GFM顺序。未找到已证明兼容的同栈直接替代依赖。下一须提出基于公开接口的最小兼容方案、继续用原E12判定；不能将本次确定性语义失败并入用户允许延期的偶发问题。尚未批准任何新实验。

## 9. 自有 contentInitial 四例可行性方案（2026-10-17，已有限通过）

本节保留执行前冻结的最小隔离方案；随后经主线批准并完成四例有限复核，实际收据见9.4，不等于生产资格。第7、8节原失败目录与手写 oracle 冻结，不修改原第三方包、不继续直接接入该包；无仓库依赖、生产、版本、build、GUI 或 Git 变更。

### 9.1 公开接点与有限假设

候选改为自有 micromark `Extension.contentInitial` 的 `null` 构造。公开 `Effects.attempt` 声明失败 `nok` 会恢复原状态；公开 `Token.contentType: "text"` 与 `previous` / `next` 可声明交给宿主处理的行内 chunk。mdast 仅使用公开 `Extension.enter/exit` 与 `CompileContext.enter/exit`，将真实 token 编译为 `defList`、`defListTerm`、`defListDescription` 及宿主生成的行内子节点，不合成 `Point`、不按修剪文本补位置。

本次只探查**同一个 content 块、单行非空术语、紧接单行非空 DD**的 API 可行性：冒号必须跟至少一个空格或 tab；本批四例仅覆盖一个 ASCII 空格。DT 与 DD 分别建立独立的 `chunkText` 链，绝不以 `previous/next` 跨越术语和定义边界连接，使同一输入里的强调分隔符不能跨 DT/DD 配对。内部换行和冒号/分隔空白单独消费，不作为 DT/DD 正文；成功仅在本次限定的 DD 到达 content EOF 时提交，EOF 不由候选重复消费，交回宿主。DT/DD 范围直接由各自真实 enter/exit 产生。

若术语后第二行不是合法冒号定义（含 E12、E4），整个候选 `nok`，由宿主还原普通解析；若已识别 DD 后还出现后继行，不论是否冒号，本次窄探针也整体 `nok`，不吞后继内容或强行拆出未证明的边界。此处不宣称多行后回退已有实证；E4 专门检查消费术语及换行后的失败恢复。所有变化只能落在本次构造创建的 token 和闭包，禁止修改已有 events/token、共享外部可变状态、私有 `_tokenizer` / `_container` 字段；不调用第二遍全文或局部 parse，不改 GFM 优先级，不 fork 或包装第三方私有函数。

不能将本方案概括成“flow 表格总在前面，所以天然安全”：本地 `content.resolve` 会立即 subtokenize，GFM/Setext 后续仍可能依赖 paragraph 事件，真实先后兼容尚未证明。E12 的具体候选理由仅是第二行不合法时应整体回退，而不是预先承诺所有表格/标题冲突已解决。

### 9.2 冻结的四例与断言

执行顺序固定 **E12 → E1 → E4 → X1**。均为无 BOM 的 LF 原输入，位置是 UTF-16 半开范围；原 E12/E1/E4 输入及期待不改。基线为当前真实 production **editing** canonical 全部扩展及原次序，候选只追加自有语法与 mdast handler；保留原 BOM、Callout 和位置处理，不加载第8节失败的第三方定义列表扩展，不删节点或 normalize AST 来制造相等。

| 顺序 | 输入 JSON | 执行前手写断言 |
|---|---|---|
| E12 | `"head\n\u007c - \u007c\nrow1\n: row2"` | 根仅一个 table，header `head`、body `row1` 与 `: row2` 共三行/三个单元格，无 DL；随后断候选与真实基线完整 AST 深相等，含位置。此 JSON 的 `\u007c` 解码为原 E12 的竖线，原输入字节不变。 |
| E1 | `"Term\n: def"` | 根仅 `defList[0,10)`，依次包含 `defListTerm[0,4)` → `text("Term")[0,4)` 和 `defListDescription[7,10)` → `text("def")[7,10)`；不得多出 paragraph、吞 marker 或压平父子结构。真实 marker token 为 `[5,6)`，DD 前空白为 `[6,7)`。 |
| E4 | `"Term\n:def"` | 无 DL；候选完整 AST 与真实基线深相等，含普通 paragraph 原有子节点和全部位置；不是只比较渲染文字。 |
| X1 | `"*Term\n: def*"` | 长度12；根仅 `defList[0,12)`，`defListTerm[0,5)` → `text("*Term")[0,5)`，`defListDescription[8,12)` → `text("def*")[8,12)`；marker `[6,7)`，空白 `[7,8)`。整树无 emphasis，禁止将两个独立行内域连接配对。 |

位置除 offset 外还须核对应真实 line/column：E1 DT `(1,1)–(1,5)`、DD `(2,3)–(2,6)`；X1 DT `(1,1)–(1,6)`、DD `(2,3)–(2,7)`。可通过公开 mdast handlers 保留本次自有 marker token 的元数据供断言，不输出用户正文或伪造来源；最终树与 marker 检查必须来自同一次解析。

### 9.3 执行及证据边界

批准后仅新 `mktemp` 目录、纯候选模块、冻结 case 与薄命令驱动；复用本地已锁公开接口，不新增依赖安装。每例单次、无 warmup，宿主监督 **15秒/例、60秒整批**，初始化失败/语义红/超时立即停止并保留原日志及未运行项；不改变期望或放宽超时。记录候选、case、驱动 SHA 和实际命令、退出码、是否 timeout；失败后只读提出下一窄修，不自行改后重跑。

四绿也仅证明这四个 canonical 输入的 API 可行性，不是生产资格或完整语义通过。本次不执行 Lezer、消费者、成本、UI 或构建。多 DD、引用/list 容器、独立后继段落、空行、多术语、多段/嵌套定义、引用定义与链接、代码/HTML/Frontmatter、Setext、BOM/EOL 仍需后续明确语义与实际验证；没有从完整定义列表能力中永久删除。`reading-legacy`、阅读子窗、FINAL-ISSUE-001/002、冻结候选、专项和最终离线边界不变。

### 9.4 批准与首跑收据（2026-10-17）

主线全文读取第9节，独立方案审查0必要阻断后，批准仅上述四例隔离实验。作者在新目录 `/tmp/agentic-f047e-content.FpONom` 通过 apply_patch 创建纯公开 `extension.ts`、保留真实 editing 全部扩展的 `candidate.ts`、冻结 `case.ts` 与薄监督 `run.mjs`，未安装依赖或修改生产。

实际单次命令 `bun /tmp/agentic-f047e-content.FpONom/run.mjs > /tmp/agentic-f047e-content.FpONom/first-run.log 2>&1` 返回 **exit 0**：E12、E1、E4、X1 顺序各通过，四例均 `timeout:false`；驱动记录239ms仅本次总时长，不是成本试验或性能结论。E12 与 E4 真实完整基线 AST 深相等；E1/X1 的 DL→DT/text、DD/text、真实位置及 marker 断言通过。X1 原基线有跨两行 emphasis，候选为两个独立 text，无跨 DT/DD 配对；这是一项预先冻结的有意语义差异，不要求候选与该基线全等。无本批未运行项；第4节其它样本、Lezer/消费者/成本/真实界面仍未执行。

`markerPosition` 临时诊断直接引用自有 marker token 的 `start/end`，未生成或补算 Point，也未读取/修改其私有字段；因此完整 JSON 日志包含随引用序列化的 `_bufferIndex/_index`，不得把此临时元数据形状迁为正式 wire/API。测试只断公开 offset/line/column。候选未按结果再改或重复首跑，待主线及独立复核，四绿不批准生产。

冻结 SHA-256：

- `candidate.ts`：`cba1b3522d1b0365ca069dca3799d79979322538bd8b03febb79cef13b9c3ccb`。
- `extension.ts`：`77c5564ad114549c97de47430646949be9bb2eebfd7929bb08a62856bbba17f9`。
- `case.ts`：`575ff7c4f93f4f9937f8297b56edf71726d6bd810c00610b568f1ca1f541a097`。
- `run.mjs`：`912109f760ec3ee8dc5630614f6d46b92480dbf07153fc478ce6b2ed3f217e42`。

主线全文读取四文件并实际复跑同样4/0、exit0、无timeout，日志 `/tmp/f047e-content-main.log`；独立Standards及Spec亦复跑同结论（Spec工具chunk `3c42c1`），主线认可四例有限通过。补充证据边界：当前空白范围仅由真实 `marker.end` 与 `DD.start` 推定，未直接观测/断言 `appDefSpace` token；不得将其描述成直接空白 token 验证。该限制不改变原四例结果，也不把未测多DD/容器/消费者当完成。

## 10. 原语料双栈贯穿最小方案（2026-10-17，已首跑，断言窄补待收敛）

以下保留执行前冻结的贯穿原 E1–E12、X1 与 X2 共14输入、两栈方案；后续批准与首跑见10.4，断言窄补见10.5。不再追加孤立的中间模型。复用第4、9节输入和手写语义/位置，不依据运行结果修改 oracle。X2 用于两栈都有资格识别的有竖线表格正向保护，不替换 E12。目标是判断公开接口是否足以承载已列核心，而非宣称全部定义列表、消费者或真实界面已完成。第9节四例原候选保持不变。

### 10.1 canonical 最小扩展

沿第9节自有 `contentInitial`，维持真实 editing 全扩展和原顺序，仅加入候选。将单 DD 扩为同 content 中的连续多个 DD；DT 与各 DD 单独交宿主行内解析，支持原 E8 的 strong/link，不自行重新解析文本。所有 marker、空白仍来自真实 token；下一批直接记录并断言 `appDefSpace` 的公开位置，不再只凭相邻范围推定。

第9节整段 EOF 限制仅是 API 探针，不迁为产品规则。识别至少一个 DD 后，遇换行使用公开 `effects.check` 的独立局部构造检查后继是否为合法 DD：合法则本构造消费换行及下一 marker；不合法则在**原换行位置**关闭当前 DL 并交回宿主，不消费后继行。尚未识别任何 DD 就失败仍整体 `nok`。不得依靠私有回退或改 Point。E3 的空行后 Tail 必须为根级独立 paragraph；同 content 内无空行普通续行的归属尚未冻结，不因候选暂时结束策略宣称该语义已验。两种情况的区别须在输出中明确，不能把未入本批14例的输入当已测。

引用的 E9 必须由宿主容器供给原始 chunk 和位置，不能剥去 `>` 后重解析；E10/11/12 继续证明代码/Setext/表格不被抢占。若公开 content 块输入未提供必要信息或两栈无法一致，报告具体红与接口缺口，首红停止，不扩大到私有解析器修改。

### 10.2 Lezer 公开 leaf 路线

使用**当前实际 production factory**的完整 editing parser 底座，追加原子临时 `MarkdownConfig`（`defineNodes`、`parseBlock`），不以裸默认 Lezer parser 代替现有 grammar/Frontmatter 包装。实际 grammar 使用原 Table 而非已证明的自定义 Table；官方 Table leaf 要求术语候选首行有竖线，E12 首行 `head` 无竖线，故本栈基线可能不是表格，不能冒称两栈基线本来相同。公开 `BlockParser.leaf` 注册观察者；`LeafBlockParser.nextLine` 可在未消费当前行时返回 true 结束已确定块，`finish` 处理 EOF/空行/宿主 endLeaf；`BlockContext.addLeafElement` 负责宿主容器 markup 注入。只用 `LeafBlock.start/content`、`Line.text/basePos/pos/indent/baseIndent`、`cx.lineStart` 等公开来源，创建 `cx.elt`；各 DT/DD 分别调用公开 `cx.parser.parseInline(text, actualOffset)`，不读取私有 children/input/marks 或改已有元素。

首行保存术语来源；第二行若不合法则本观察者在该 leaf 内永久失效，返回 false，不移动游标，交还现有 paragraph/Table/Setext；不得后来遇到 E12 的 `row1/: row2` 再重新激活。确认合法 DD 后按当前真实行记录 marker、空白、正文及 inline 元素，返回 false 让宿主正常积累；连续 DD 同样处理。若遇非 DD 后继，已确定块可以 `addLeafElement` 后返回 true，**不调用 `cx.nextLine()` 消费后继**；未确定块不能消费多行后假装回退。明确优先级相对现有 Table/Setext，不调整它们自身顺序；E12 必须以实际基线证明兼容，不能通过检查私有 TableParser 实例推断。

候选不得直接扫全文或每行重复 parse 整个 `leaf.content`；保存单次行来源并分别行内解析。`addLeafElement` 的容器注入和 E9 位置是否正确属于本批实际待证事项，不由声明代替。partial/reuse、BOM/EOL、长段落成本和正式 wire 尚未验证，不能复制临时 helper 直接投入生产。

### 10.3 固定验证与停止规则

顺序固定 E12 → X2 → E1 → E2 → E3 → E4 → E5 → E6 → E7 → E8 → E9 → E10 → E11 → X1。每输入先 canonical、再 Lezer；采用一个宿主受控 case 子进程覆盖该输入两栈及初始化，15秒/输入、210秒整批，单次无 warmup，首初始化失败/语义红/timeout 停止。保留冻结14例和代码 SHA、实际命令及未执行项；超时界限只是防挂保护，不是性能门槛。本批不追加压力、Worker、生产依赖或 UI。

新增 X2 JSON 为 `"\u007c head \u007c\n\u007c - \u007c\n\u007c row1 \u007c\n\u007c : row2 \u007c"`（解码后长度34）。执行前冻结：两栈各自只有一个表格主体、header `head` 及两个 body `row1` / `: row2`，无 DL；canonical table范围 `[0,34)`，三行范围 `[0,8)`、`[15,23)`、`[24,34)`，三处文本范围 `[2,6)`、`[17,21)`、`[26,32)`；Lezer对应 Table/TableHeader/TableRow 与单元格原文投影相同范围，允许其额外 delimiter/竖线语法节点。Lezer无普通Text节点，这里的文本是依据真实cell范围读取原文的投影，不伪造Text节点。每栈候选与该栈真实完整基线深相等（含所有语法节点和位置），不能用投影 equality 代替此检查。

每栈独立断原手写 DL/DT/DD 父子、文本/marker/空白公开范围，E2 必须一个DT和两个同级DD，E8必须真实strong/link与URL，X1不得跨DT/DD强调。非DL的E4/5/6/10/11/12分别与该栈真实基线完整结构及位置比较；E12 的 canonical 另断原一列表格三行与三个单元格，Lezer 只要求不新增 DL 且完整基线保持，单独记录其既有差异，不要求临时候选顺带修旧表格。此为显式两栈基线差异，不更改原 E12 的 canonical 手写 oracle。Lezer可有QuoteMark等语法节点、canonical可保语义节点，两栈只比较明确投影，不用节点数量相等替代完整各自断言；E9须保留完整容器/marker树供审查，不能只看可见文字。

全部通过后才收敛 typed 正式接入最小方案及必要消费者/有限成本验证，不继续无界堆临时模型；任一接口阻断则提供具体证据和最小替代。空行分隔术语、多术语、多段/嵌套 definition、无空行普通续行、四空格与容器缩进边界、引用定义作用域等完整语义仍待定/待证，未从产品永久删除。现有阅读隔离、最终问题、冻结/专项/离线边界不变；本方案不是生产或新构建授权。

### 10.4 获准首跑与断言边界（2026-10-17）

主线全文读最终方案，两独立轴0必要方案阻断后批准仅该14例。作者在 `/tmp/agentic-f047e-dual.vZfAJ7` 通过 apply_patch 创建候选/冻结case/薄runner，复用实际 `markdownGrammar` 与 `FrontmatterParser`，无依赖安装或生产修改。单次命令 `bun /tmp/agentic-f047e-dual.vZfAJ7/run.mjs > /tmp/agentic-f047e-dual.vZfAJ7/first-run.log 2>&1` 返回 **exit0**，按预定顺序14输入、每输入两栈全部通过，无timeout；1280ms仅本次总时长，不是性能结论。无本批未运行项，原第8节失败与第9节四例冻结目录未改。

本次确认E12 Lezer真实基线非table而候选完整保留；canonical仍为完整table。多DD、引用QuoteMark、直接空白token范围、strong/link与URL、独立行内边界及其它negative基线断言已执行。作者自检发现一处**断言覆盖缺口**：X2 canonical检查表格三行/文字以及完整基线AST深相等，但未将预冻结三行/文本offset逐个单独assert；完整日志包含这些位置供独立直接核查，不将其描述为手写位置断言已全部执行。候选与case在首跑后未修改或重跑，待主线及独立复核决定是否需要最小补证。

临时marker/space元数据仍直接引用真实Point，日志包含其内部字段但候选不读取/修改；禁止迁作正式wire。Lezer节点名和直接marker子节点是临时表示，不据此确定最终typed schema。本批仍不覆盖partial/reuse、成本、消费者、自然IME、GUI或完整定义列表语义，不批准生产。

冻结SHA-256：candidate `ea44cf179a5ba94b0e99f7e14286668e24a7f73ad46309518aafafb26cfc91fc`；extension `672382a99053a282a5207fb8067010bf259cf44a8827995cfae0908ed999036a`；lezer `7cd49a19c4b716f891c168b31c9b679e07201ba05d8e4f1e8e434f069e42a691`；case `4e7d22b0bf8b0fe3bb87e94aebbcde6032ad00add3427431110f45fd6b2ba5a8`；run `57ef26dac424b240f48d0832402e2237b018c6afad52a0b830fa4b8fef3a5283`。

主线全文读取extension/lezer/case/run并核candidate底座后，实际复跑同样14/0、exit0、无timeout，日志 `/tmp/f047e-dual-main.log`。主线进一步指出：Lezer DL本体范围未独立assert；E8 Lezer inline节点只检查全树存在、没有限定在DD子树；E9两栈DL的严格父关系断言不全。以上与X2范围缺口共同限制结果，**14绿不等于完整预定oracle达标**。当前保留冻结代码，等待两独立轴列出必要断言窄补，不执行下一实验。

另有实现未定边界：canonical的后继DD check目前只确认冒号及至少一个空白，没有确认DD正文非空；如后继空DD可能进入后整体回退。这不属于本批原输入的已验证行为，记录待定，不暗中修正或视为产品决定，不因这些临时发现扩大到生产。

### 10.5 仅断言窄补获准（2026-10-17）

后续窄修批准：主线核官方mdast enterCell、micromark flushCell及原base/actual，Spec独立确认新增cell oracle误写；批准新目录由vZfAJ7精确复制四非case文件，case由YrAbAp复制后仅把 `position(c,...cs[i])` 改为 `position(c,...rs[i])`。运行前逐一核四文件SHA一致且case diff只有该处，否则不得运行。原14输入/15/210与首红停止不变，旧失败原样保留。

窄修实际收据：新 `/tmp/agentic-f047e-cellfix.3odr3l` 由cp精确复制，运行前四非case SHA与10.4逐一一致，case diff只有上述一处，case新SHA `e9c7fe7b2335bfb1cb7b367f33783494fbafee50084024e17517bb021d5965b9`。单次 `bun /tmp/agentic-f047e-cellfix.3odr3l/run.mjs > /tmp/agentic-f047e-cellfix.3odr3l/first-run.log 2>&1` 返回exit0、14输入双栈及增强断言全部通过、无timeout，1292ms仅本次总时长；无本批未跑项。原YrAbAp失败保留，不把本次测试修正说成算法修复；待主线及独立两轴实际复核，不批准生产。

主线认可独立两轴指出的覆盖缺口，批准新临时目录只增强 `case.ts`，candidate/extension/lezer/run四文件逐一保持原SHA；14原输入、顺序及15/210监督不变。不改算法或按输出修改语义。补齐每正例Lezer DL范围与完整直接子序列/根落点；E9两栈唯一Blockquote[0,14)直接DL[2,14)，QuoteMark[0,1)在BQ及[7,8)在DL；E8 DD直接strong[7,15)/link[20,26)，URL[24,25)在link，canonical bold[9,13)/x[21,22)及文本/markup坐标；X2 canonical表格行/cell/text冻结offset及Lezerheader/rows；canonical每正例文本类型/数量/位置，原四例line/column保留，不允许额外正例siblings。执行一次首红停止，若实际不符保留红，不能调整期待重跑。

实际目录 `/tmp/agentic-f047e-assert.YrAbAp`，单次 `bun /tmp/agentic-f047e-assert.YrAbAp/run.mjs > /tmp/agentic-f047e-assert.YrAbAp/first-run.log 2>&1` 返回exit1、无timeout：E12增强断言通过；X2旧断言通过，新增canonical cell位置断言红，余E1–E11/X1未执行。作者将canonical cell错误地按text的 `[2,6)` 检查，实际cell `[0,8)`，日志同时保留base与candidate完整树；原手写只明确行/text范围，不应由Lezer cell范围推断canonical cell。此为待主线复核的断言编写问题，不宣称生产语义退化，也不自行改期待重跑。

另有执行偏差：通过apply_patch复制四固定文件时各意外增加一个末尾空行，运行前虽打印SHA却未拦停不一致；只读diff确认extension仅末尾空行，其他文件仍须逐一核。因此本轮未满足“算法/runner四文件hash一致”前置，不能冒严格窄补通过。失败目录原样保留，下一若获准需新目录先精确恢复四文件字节并核hash，再处理case问题。新增case SHA `e81dd2dc2713e4aa318adc6d72f5c62e3da5aa2faaa2e3291c643d65b9da38ce`；本次无生产或版本/build/Git。

### 10.6 新增断言纠错与有限复核通过（2026-10-17）

主线与两独立轴读取官方 `mdast-util-gfm-table` 的 `tableHeader/tableData → enterCell` 及 micromark `flushCell` 的组/正文分离，核对原baseline与candidate均保留整行cell范围。原第10节只冻结行和文字；将新增cell等同文字是测试编写错误，不是原语义期待变化。主线批准新目录仅将 `position(c,...cs[i])` 改为 `position(c,...rs[i])`，保留原文字范围、所有其它断言与两个失败目录。四非case文件须从原dual精确恢复并核字节，不能再次忽略不一致。

新目录 `/tmp/agentic-f047e-cellfix.3odr3l` 执行前四文件与dual逐字一致，case差异仅上述一处，SHA `e9c7fe7b2335bfb1cb7b367f33783494fbafee50084024e17517bb021d5965b9`。作者首跑 `bun /tmp/agentic-f047e-cellfix.3odr3l/run.mjs` 14/0、exit0、无timeout；完整 `first-run.log` 保留。主线再次逐文件cmp及diff后复跑14/0（`/tmp/f047e-cellfix-main.log`），独立Spec及Standards分别逐字核对、单次复跑同样14/0（`/tmp/f047e-cellfix-spec.log`、`/tmp/f047e-cellfix-standards.log`），全部无timeout。原E8/E9具体归属、DL范围、X2行/cell/text与正例文本坐标缺口已补齐；各次总时长不作为性能结论。

主线认可固定14输入的双栈核心有限证据，不批准生产。下一先收敛空DD、普通续行、缩进/容器以及空行、多术语、多段/嵌套定义的识别与退出规则；不能将临时单行DD变成永久产品规范，亦不能忽略两栈已知未定差异。partial/reuse、正式schema/wire/profile、真实消费者、有限成本、实际WK、完整父及阅读子窗仍待后续。无生产/依赖/版本/build/Git；alpha168仍最新已验包。

## 11. 完整规则与架构收敛（2026-10-17，只读调查）

主线重新查阅 [PHP Markdown Extra 官方定义列表说明](https://michelf.ca/projects/php-markdown/extra/#def-list)：它明确包含单行术语、同定义多个术语、同术语多个定义；冒号可缩进0–3空格且后接空格/tab；定义可以有未缩进的普通续行，术语与前一个定义之间用空行分隔；定义前空行会形成段落包装，定义内部可以有多段、引用、列表、代码及嵌套定义列表。故第10节遇普通后继行就结束的行为只是探针限定，不可直接宣称符合此语法。引用该来源不代表采用其表格等其它方言；本App既有GFM表格/Setext等语义仍须保护。

下一优先冻结完整识别及退出规则，再评估公开宿主容器接点；不直接把当前单content块/leaf探针翻成生产typed实现。跨空行与嵌套块不能由本批绿推定已支持，也不能靠重复全文解析、私有事件修改或静默拆碎结构补足。空DD编辑中间态、容器相对缩进和优先级仍需明确。当前仅只读架构收敛，未批准新实验；无需用户为普通技术路线再次确认，按持续授权继续，但任何明确专项仍不自动实现。

## 12. document 前向确认与宿主 flow 最小探针（2026-10-17，待批准，不执行）

本节只回答两个架构问题：公开document构造能否前向确认跨空行术语而不破坏宿主行生命周期，以及DD正文能否由宿主flow真实产生嵌套块。不扩展到Lezer索引/完整新解析器，不复跑第10节14例来替代新接点验证；仅下面四个准确canonical输入。

### 12.1 公开接点与必须失败的条件

使用公开 `Extension.document`、`Construct.tokenize/continuation/exit`、`Effects.check/attempt`、`TokenizeContext.containerState/interrupt/now` 与mdast公开handler。前向check只消耗检查所需字符，在原位置恢复，不改外部数组、旧token或宿主events。正式构造只生成自己的DL/DT/DD、marker/空白token和每个术语独立的 `chunkText(contentType:text)`，只保存本容器的阶段/缩进状态；不得读写私有字段、`_closeFlow`、`_tokenizer`，不得合成Point或第二次parse正文。

候选从已确认术语起点建立DL。在正式tokenizer中，术语文本及之间的换行/空行均由本构造的真实token消费；到首个冒号时结束术语阶段，只消费DD marker及分隔空白，然后将**第一个DD正文字符原位**交回宿主。DD必须是独立嵌套容器，其正文不自行生成paragraph/blockquote，不调用字符串parse，而由document原有childFlow/flow tokenizer生产。续行只通过公开continuation消费本层要求的缩进，留下 `>` 等给宿主原有容器；不把嵌套块当纯文本。

**跨行消费不是已证明安全的假设**：主线已读 `initialize/document` 中 `lineStartOffset`、`continued`、chunkFlow开始/结束与lazy处理。正式构造一次跨过术语行和空行后直接交DD字符，可能与宿主每行推进契约冲突；本探针必须通过同次真实token→mdast层级及位置证明成立，不能仅靠最终拼出树掩盖。必须输出完整原始事件投影（enter/exit、type、公开start/end）与完整mdast，验证嵌套paragraph/blockquote确由宿主流产生、token嵌套平衡、enter.start/exit.end事件位置及父子包含合法；不错误要求每个事件token.start全局单调。不得通过重排已有events、修改end点或补造paragraph使断言变绿。

DD/DL结束不能只假定`exit`会提前关闭已经延续的childFlow。`continuation nok`本身不立即关闭DD，宿主可能尝试lazy continuation；新container成功时才有明确closeFlow+exit旧容器路径，不能将自有exit等同于该宿主机制。P2末尾空行后`Tail`应使DD/DL资格终止，必须实际检验宿主如何结束旧flow并将Tail放在根级，输出完整host children位置及事件闭合顺序；若仍被lazy吞入，保留红，不伪造新container或私有关闭标志强迫成功。下一DD开始的公开构造接续仍是后续责任，不能从本四例推断多DD已支持。若不能在不写私有关闭标志下得到此闭合顺序，即为本路线红并停止，不继续拼装更大解析器。官方blockquote实现中的`_container`也不照抄。

flow资格使用公开检查且不得硬编码输入全文或固定单词来认样本；若document层调用flow检查的context不合约，保留真实错误并停止。对既有table/Setext必须整体放弃候选，保留完整真实production基线；不能先吞行后由手写结果补回。实际底座仍为当前editing所有已验扩展原次序，只增加候选；不使用第8节已失败第三方扩展。

### 12.2 执行前冻结四例

均无BOM、LF，offset为UTF-16半开范围；所有node和自有marker/空白token均来自同次解析。以下paragraph结构为语义树要求，不允许用纯字符串DD替代。

| 顺序 | 输入JSON | 准确oracle |
|---|---|---|
| P0 | `"head\n\u007c - \u007c\nrow1\n: row2"` | 原E12。根唯一table[0,22)，header head文本[0,4)，body row1[11,15)、`: row2`[16,22)；无DL，完整AST与真实production基线深相等。 |
| P1 | `"Alpha\nBeta\n\n: def"` | 长17。根唯一DL[0,17)，直接子序列DT[0,5)→text Alpha[0,5)、DT[6,10)→text Beta[6,10)、DD[14,17)→paragraph[14,17)→text def[14,17)。marker[12,13)，空白[13,14)。术语间LF[5,6)、第二术语后LF[10,11)、空行LF[11,12)不进入DT正文。 |
| P2 | `"Term\n: first\n\n    > quote\n\nTail"` | 长31。根直接DL[0,25)、paragraph Tail[27,31)。DL直接DT[0,4)→text Term、DD[7,25)。DD直接paragraph[7,12)→text first、blockquote[18,25)→paragraph[20,25)→text quote。marker[5,6)，空白[6,7)，续行本层缩进[14,18)，宿主引用marker[18,19)、引用分隔空白[19,20)。LF[12,13)/[13,14)为定义内部段落分隔；末尾LF[25,26)/[26,27)不能吞Tail。 |
| P3 | `"Term\n---\n: def"` | 原E11。根直接heading depth2[0,8)（text Term[0,4)）、paragraph[9,14)（text `: def`[9,14)）；无DL，完整AST与真实production基线深相等。 |

P1 DD前空行要求真实paragraph包装。P2首个紧接冒号的DD paragraph作为mdast规范块节点保留，不根据最终HTML是否省略`p`标签删掉AST节点。P2不是“无空行普通续行”的规则证明；Tail与定义之间已有空行。所有位置须同时核line/column由原始文本得到；完整子节点数量和父关系均断言，不只全树搜索存在。P0/P3不要求出现自有marker事件；要求候选没有新增DL事件且原树完整保真。

### 12.3 批准后执行边界

主线全文读并独立复核后另行批准，才创建新临时目录。每例先真实production基线、再候选，**P0→P1→P2→P3**，15秒/例、60秒整批，单次无warmup；初始化失败、语义红或timeout首个即停，保留代码SHA、完整日志与未跑项，不能改后重跑。事件提取只能由同次公开token/handler或resolver记录只读元数据，不另行parse生成第二份“正确事件”。若公开接口不足以取得所需证据，标明缺口，不冒通过。

四绿也只支持此容器接点进一步评估，不是完整grammar或生产批准；多个DD、lazy continuation、完整相对缩进、空DD和嵌套定义列表仍开放。无Lezer新索引、依赖安装、生产、版本/build/GUI/Git；原候选/失败目录与FINAL问题、阅读子窗、冻结/专项/离线边界保持。

### 12.4 获批首跑的P0兼容红（2026-10-17）

主线全文读取并认可本四例语义、两轴0必要隔离阻断后，批准新临时目录探针。作者通过apply_patch创建 `/tmp/agentic-f047e-document.UTc2uh`，未安装依赖或改生产。单次 `bun /tmp/agentic-f047e-document.UTc2uh/run.mjs > /tmp/agentic-f047e-document.UTc2uh/first-run.log 2>&1` 返回 **exit1、timeout:false**，在首个P0即停止，P1–P3未执行。

真实baseline为完整table[0,22)，候选变成根级paragraph `head`[0,4)与DL[5,22)：DT `| - |`[5,10)、DT `row1`[11,15)、DD[18,22)内宿主paragraph/text `row2`。完整AST深相等失败，日志保留两树和同次compiler handler事件投影。该document-context公开flow检查未阻止抢占表格，不能宣称仅使用公开接口就兼容；不因见到一次paragraph就称跨空行/嵌套/lazy/退出已验证。代码未改后重跑，原候选冻结。

额外证据限制：当前记录通过公开CompileContext.config handler包裹获得同次handler调用，**不是完整raw token事件流**；自有case对后续正例明确会报告此证据缺口而不标绿，P0首红尚未进入该检查。该诊断会替换本次编译config中的handler函数但保留原调用行为，应由主线审核是否符合own-token限定；不能视为只读记录原始全events，更不应迁入生产。无私有字段读写、Point合成或第二次parse正文。下一先只读收敛正确context资格及完整同次证据接点，不靠手写排除本条字符串修绿。

冻结SHA：candidate `04bc5cb59d572c5c85a59f10c904c95414e54f46bb8adda645c56f1a21bfd702`；extension `62f6eaf4aac15204ff9ce4532f91bc9adc6eb60d2e793b614075bf0edee9517f`；case `025c3d12713c4b31fd243d55e0d9e7da00c3370db7bd2e345e095afa65ae5773`；run `f2970d2c809559dbe08d8c7095d951af89f49ad9084333c38bc698c30a3739bd`。

### 12.5 公开interrupt资格与同次事件引用窄修方案（待独立审核、未执行）

主线全文读取首红候选后，仅提出两处窄修，仍需独立审核及主线批准后才可新目录执行；原UTc2uh及四oracle保持冻结，暂不改任何临时算法文件。

1. **DL开始资格**：在 `openDL` 首部加入公开 `this.interrupt` 为真则 `nok`，不打断已active flow。原P0在初始 `head` 的flow check已拒绝，但之后在delimiter行重新启动DL而破坏表格；新守卫仅阻止这种正在打断宿主flow的入口，不硬编码表格输入、不改GFM规则。其余qualify、术语消费、DD独立容器与续行/退出算法保持原样。此判断是否确实保护P0且允许P1/P2，不由源码推断当作结果，必须同四例实测。

2. **同次完整事件证据**：删除所有 `CompileContext.config` handler重写和模块全局 `observed`。每次 `makeExtension()` 独立闭包，在公开 `dl.resolveAll(events)` 只保存传入events原数组引用并原样返回，不复制/增删/修改events或token。`parseCanonicalMarkdown` 完成本次 `fromMarkdown` 后，才通过该闭包读取所保存的引用，将每个事件的enter/exit、token身份及公开start/end投影为诊断数据；身份以本次局部Map登记，不读私有字段。公开resolver可能在同次parse多次调用，需保留本次独立各引用并显式核哪一个包含最终DL与host flow，不借拼接局部碎片伪造全事件流。

官方postprocess会原地subtokenize，但保存的resolver数组是否就是最终完整数组、是否已含实际宿主paragraph/blockquote及所有闭合事件，**仍属待证假设**。正例必须核同一token对象enter/exit严格配对、栈顶匹配、父子范围包含与enter.start/exit.end位置合法，并看到P2完整DD→paragraph/blockquote及根级Tail的真实顺序；不能断言所有token.start全局单调。若引用仍只有chunkFlow或局部事件、缺宿主节点或严格栈失败，明确红并首停，不能读取 `_tokenizer`、手动postprocess第二次或另parse填补。负例P0/P3完整baseline AST相等且没有自有DL事件；未触发resolver时无引用不构成“完整事件已读”的证据。

四例P0→P1→P2→P3、原节点/marker/位置oracle、15秒/例与60秒整批保持。获批后仅新目录改上述两处及对应诊断断言，单次首红停；不放宽既有断言、不解决未运行的新问题、不引入私有关闭标记或二次parse。此次仅方案文档，不批准生产、Lezer、依赖、版本/build/UI/Git。

### 12.6 两处窄修仍在P0红（2026-10-17）

主线全文读12.5及本地公开接口、独立Spec0必要隔离阻断后批准执行。新目录 `/tmp/agentic-f047e-docguard.xvpkTa` 保留原候选，apply_patch只增加interrupt资格、替换同次诊断接点及对应断言；无依赖或生产修改。单次 `bun /tmp/agentic-f047e-docguard.xvpkTa/run.mjs > /tmp/agentic-f047e-docguard.xvpkTa/first-run.log 2>&1` 返回 **exit1、timeout:false**，仍首个P0完整AST相等失败，P1–P3未执行。

本次候选保留header/delimiter为table[0,10)，但后续row1[11,15)被重新作为DL[11,22)的DT；DD[18,22)内为宿主paragraph/text `row2`。公开interrupt守卫使抢占位置后移，并未保护完整table；不能将`interrupt=false`等同“没有activeflow”。未修改或重跑，禁止以字符串特判补绿。

本次闭包保存的单个resolver原数组引用在fromMarkdown完成后可看到展开的table/content/paragraph及自有token，未再改config或使用global observed。这是当前失败输入中的实际观察；因P0先语义红，正例严格token身份栈、父子包含、完整P2宿主blockquote/尾段闭合断言未执行，不宣称已证完整事件生命周期。仍无私有字段读写/合成Point/二次parse。

冻结SHA：candidate `7124269a8bce489c08d89976bb404c4d8d4961db0da9048be2b64da8e026fcd0`；extension `ed103dc95bfd1e5140aa8ca0db02881f098c28821b875135b088ec96e1bbf070`；case `be1c18a53081963faa754e8b769157f37a503f23441d39eb12254e0e078c9b28`；run `f2970d2c809559dbe08d8c7095d951af89f49ad9084333c38bc698c30a3739bd`。下一只读核正确宿主资格来源，不推断公开接口全部无解；尚未生产/新版本/build/Git。

主线全文核代码及原四例并实际复跑同样P0 exit1/no timeout（`/tmp/f047e-docguard-main.log`）；独立Spec亦复跑同结论（`/tmp/f047e-docguard-spec.log`）。当前文档层守卫不能可靠判断既有表格归属，停止同接点无证据试改，不把失败归为用户允许延期的偶发问题。完整F047e未完成，所有实验原样保留。

## 13. 后续承接与持续批次切换

恢复F047e时必须先读本记录，选择能够证明宿主块归属及完整定义列表语义的公开路线；复验原E12/P0、跨空行/嵌套flow和完整父需求，不自动恢复已红候选，不直接把单行14例接入产品。若需替换主要解析引擎等关键路线变更，先说明成本和影响并取得相应确认；当前没有作出该决定。

为避免单项技术调查阻塞整个MVP，主线在既有连续授权下选择F060c文件树选中项Finder定位为下一独立片，先写最小方案再实施/独立复核/实际代验。它不依赖定义列表；本轮状态是技术待收敛，不是验收或取消。alpha168仍最新已验包，F047e不提交生产或关闭父项。
