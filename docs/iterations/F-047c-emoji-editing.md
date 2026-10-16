# F-047c：Emoji shortcode 编辑呈现与源码保真

> 状态：有限生产候选已实现，待最终代码复核、构建及真实窗口验收；未批准通过或 Git。

## 主线批准有限临时探针（2026-10-16）

主线全文读取方案及第6节准确输入，两轴独立复核均0必要有限实验阻断。现只批准新临时目录取源固定gemoji8.1.0（核registry完整性/许可、不改仓库依赖），以及第6节12个固定样本的公开接口语义探针；每例15秒、整批180秒、首红停，unknown不计通过。反斜杠奇偶与URI向左回查每候选共用256单位预算，名称最大长度来自固定映射，左右Unicode码点各最多2单位并另实计；无法证明inline起点或预算尽则unknown保原文，严禁无界回扫。不运行仓库生产或大输入、不修改旧冻结oracle，不批准正式安装/代码/版本/build/GUI/Git；复杂URI/完整消费者/候选按需与阅读责任仍未证。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

继承检查项：F-002 本地/离线边界不变；中文与外观须核浅深及原文回退；命令与键盘不擅加快捷键或劫持 IME；安全与日志不输出正文/私密路径、不加载远程图像。offline-final 留最终人工，不执行断网。

## 当前状态（2026-10-16）

主线已全文批准第14节T1–T5并获独立两轴0必要实施路线阻断，准许精确gemoji直接dev依赖/最小lock、typed有限实现及实现后测试。当前已实现原子解析、编辑局部widget和实际消费者，版本仍alpha164；尚未构建或真实验收，前片通过不代表本片通过。下方早期“仅方案/尚未实施”均为历史阶段，不覆盖当前状态。

选择依据是产品总账第 **122** 项与 **S-11**：原子 `EmojiExtension` 纳入固定 `ExtendedMarkdownPreset`，固定版本 `:name:` 映射；编辑/阅读呈现 Emoji，源码与磁盘保留 shortcode；编辑合法上下文内按需加载候选，仅识别已知且满足词法边界的 shortcode，避免时间和 URL 误转换。本片先闭合编辑显示与源码保真；按需候选明确留下一有限片，阅读由独立子窗口承接。此划分不取消任何 S-11 产品责任，不迁移 reading-legacy，不关闭 F-047 或 OBL-068/069。

## 1. 固定映射来源与现成实现评估

- 候选数据依赖为 `gemoji@8.1.0`，官方 npm registry 已只读确认存在、MIT、ESM，`nameToEmoji` 为公共导出。该项目由 Titus Wormer 维护，来源为 GitHub gemoji，并非 GitHub 官方维护的同名 npm 包；没有图片，显示使用系统字体 Emoji。
- 精确来源提交为 `95b8d4669ce0b67ad6cfe09632c0515b9b0e01e2`；registry tarball shasum `3d47a26e569c51efa95198822a6f483d7a7ae600`，integrity `sha512-HA4Gx59dw2+tn+UAa7XEV4ufUKI4fH1KgcbenVA9YKSj1QJTT0xh5Mwv5HMFNN3l2OtUe3ZIfuRwSyZS5pLIWw==`。这是待批准的固定版本，不声称最新，也不从 main 的当前条数推定该版本条数。后续若批准安装，应核锁文件与实际导出，不能静默更新映射。
- npm 维护者 MIT 许可及上游 GitHub MIT 许可均已阅读；发行随依赖/复制的数据保留适用版权与许可。仅用 Unicode 映射，不引入上游图片、网络图标或自定义远程 Emoji。
- 现成 `remark-gemoji` 使用 `mdast-util-find-and-replace` 对已解码文本执行 `/:(\+1|[-\w]+):/g`，不能直接证明 App 的转义、URL、原文位置与词法边界。建议复用数据而非直接迁移这个后处理算法。仅凭两引擎输出相同也不能证明语义正确。
- 仓库未直接安装 gemoji/remark-gemoji/emojilib；锁内 emoji-regex 是 CLI 间接依赖，并不提供 shortcode 映射。当前不存在可直接宣称成熟的候选弹层生命周期。

官方来源：[gemoji 公共 API](https://github.com/wooorm/gemoji)、[精确版本 registry](https://registry.npmjs.org/gemoji/8.1.0)、[固定提交许可](https://github.com/wooorm/gemoji/blob/95b8d4669ce0b67ad6cfe09632c0515b9b0e01e2/license)、[上游许可](https://github.com/github/gemoji/blob/master/LICENSE)、[remark-gemoji 实现](https://github.com/remarkjs/remark-gemoji/blob/main/lib/index.js)。本轮 web 后续请求曾返回 HTTP 429，改用只读 curl 读取相同官方许可；不把取源失败当算法证据，没有安装或下载 tarball。

## 2. 最小词法提案（待主线批准，不按依赖倒推规则）

仅 ASCII 冒号配对、单物理行、精确大小写命中固定名称。名称允许固定映射实际使用的 ASCII 字母/数字、`_`、`-`、`+`；未知名称完整保留。候选最大名称长度来自该固定映射，不人为裁掉合法别名。

建议外侧采用“不能紧邻 Unicode 字母/数字/组合标记、下划线、冒号或斜杠”的保守边界；文首/尾、空白与其余标点允许。于是中文连续词内也不替换，需空白或标点。这是对 S-11 边界的具体技术提案，不声称 Typora 或 GitHub 完全相同，待主线决定。Emoji 本身不是字母数字，可作为相邻符号。

开闭冒号必须来自原文，反斜杠转义冒号、实体拼出的冒号不识别。代码、围栏、Frontmatter、HTML 标签/属性、链接目的地/title、自动链接和引用定义不识别；正文、标题、列表/引用、表格单元格、链接 label、合法强调/高亮/上下标内部可识别。图片 alt 须遵循宿主文字串语义，不能把自定义 Parent handler 假设直接适用；下一实验必须明确 `![:smile:](x)` 的 canonical alt 为映射字符，编辑图片消费者仍按原文授权目标处理。网络裸 URL 里的片段不应被转换，即使 Lezer 不是 GFM autolink 树，需明确同段 URL 资格防护，不只检查父节点名称。

## 3. 拟定实现接口及前置风险

1. 原子扩展持有固定不可变映射。Lezer 通过公开 `InlineParser` / `InlineContext.addElement` / `elt` 建 `EmojiShortcode` 原文范围，不重入局部 parseInline；canonical 使用公开 micromark token 与 mdast handler，在同次原文范围确认后产生有位置的 typed Emoji 节点及映射文本。不得由已解码 value 猜 raw 坐标。如何避开裸 URL、链接内部宿主边界、图片 alt 编译须先有限探针，不假定已解决。
2. 固定 grammar / editing-semantic profile 同步升级，strict wire 节点集和过期 profile 拒绝随之测试。reading-legacy profile、旧阅读行为保持原样。所有现有编辑消费者（image summary、Callout 可见正文、inline-format、代码复制）必须在实际入口回归，不能把 canonical 全体当阅读消费者。
3. 编辑仅对当前可靠树、同 Text、可见范围中合法完整 token 使用惰性文本 widget；不写 DOM HTML、不改原文/history。选区触及 token 或需揭示的 inline 祖先时恢复原文；source/safe、IME 候选及失效树不做替换。复用现有字符呈现的 inert 文本机制前先核键盘、复制与原生选区，不能将已有 entity widget 测试冒成 Emoji 实测。
4. 单次候选扫描受固定最大名称长度约束；显示新增工作共享节点/字符预算，完整 token 原子通过才添加替换，超限保原文，不能半替换或丢剩余责任。重复可见范围去重不能漏后段。预算数值在实施方案结合代表性小文档确定，不照搬 alpha163 的过低阈值，也不承诺全局线性或 SLO。没有每键 canonical 全文解析、新 Worker 或跨文档缓存。
5. 解析所需精确 name→Emoji 小表必须在固定 grammar 可用前一致就绪，不可异步加载后悄然改变同一树语义。后续候选索引/描述/排序可以独立按需 import，避免完整搜索数据进入首屏；这两种数据用途必须分清，不能为“懒加载”使已知 shortcode 暂时不识别。

## 4. 下一有限探针提案（尚未执行）

待主线确认第 2 节边界后再冻结脚本与精确位置 oracle。最多下表 12 个小文档、每引擎单次、每例宿主 15 秒和整批 180 秒监督，首红停；不进行极端 1 MiB 压力，也不由实际输出反改预期。下面 E 表示该版本精确映射，安装获批后须核 `smile`、`+1` 的固定值再冻结，不以另一个 parser 的结果作 oracle。

| 例 | 原文（转义形式） | 手写预期 |
| --- | --- | --- |
| 1 | `:smile:` | 1 个完整 Emoji 原文范围；可见 E(smile) |
| 2 | `(:smile:) :+1: :unknown_app_name:` | 前两已知项；未知原样 |
| 3 | `a:smile:b 中文:smile:词 :SMILE:` | 全部原样 |
| 4 | `\\:smile: &#58;smile: :smile&#58;` | 全部原样；不得借解码制造 token |
| 5 | `12:30 https://x.test/:smile: <https://x.test/:smile:>` | 全部不替换；裸 URL 必须实证 |
| 6 | `` `:smile:`\n\n```txt\n:smile:\n``` `` | 无 Emoji 节点 |
| 7 | `**:smile:** ==:smile:== ^:smile:^` | 各宿主内 1 项；保留宿主拓扑 |
| 8 | `[:smile:](https://x/:smile: ":smile:")` | 仅 label 1 项；目的地/title 原样 |
| 9 | `![:smile:](x)\n\n[r]: /:smile:` | alt 映射；定义 URL 无 Emoji；图片原授权目标不变 |
| 10 | `---\na: :smile:\n---\n# :smile:\n> :smile:\n- :smile:` | 首部排除，其后三处各 1 项 |
| 11 | `😀 :smile:\r\n:+1:\r末尾` | 精确 UTF-16/raw EOL 范围；CM 坐标另核不混用 |
| 12 | `::smile:: /:smile: :smile:/ <b title=":smile:">:smile:</b>` | 前三边界排除；标签属性排除；标签外文字 1 项 |

实际 `createRawEditorState`、BomAwareParser 与 raw/CM 映射可用时优先真实工厂；若仅影子 canonical，标出差异。映射取源、Lezer、canonical、图片 alt 与裸 URL 任一未接线项只标 unknown，不报告矩阵全部通过。成本与真实消费者正式测试在路线收敛后同一方案补齐，不复制大量生产模块作模型。

## 5. 最小 happy path 与后续责任

本显示片的目标 happy path：打开含已知/未知/转义/URL shortcode 文档；编辑未触及显示 Emoji、触及可编辑原文；源码完整保留 `:name:`；替换与一次撤销保持历史；只读两模式拒绝输入；浅深主题、折叠/查找定位、跨标签及正常退出后原字节不变。自然 IME、复杂竞态、密集视口或离线若未实际覆盖必须保留限制，不用自动 seam 冒真人输入或 WK 像素。

明确跟踪的剩余责任：

- **显示片 F-047c**：固定映射、两编辑语义消费者、源码保真、视口显示和实际验收；当前全待实施。
- **候选片（后续唯一编号再核）**：有效冒号前缀时才加载搜索索引；已知名称候选、键盘/鼠标接受、取消、IME 不抢候选、readonly 禁用、源码是否有入口按 S-11 编辑范围处理；当前未设计/未实现。F-047c 验收时必须在总账/手册/义务协作中仍明确开放，不能只凭显示关闭 S-11。
- **阅读子窗口**：承接 Emoji 显示及其语义 profile，按新窗口决定另轮收敛；本片不迁移旧阅读。
- **完整父项/协作**：脚注、定义列表及 F-047 余项继续开放；OBL-068/069 仅对应外观协作，不迁移主责或提前关闭。必要的新延期只在真实拆分实施时登记，不虚构已有 OBL 已完成。专项、F-028c、F-041d 冻结与 offline-final 不变。

下一步由主线全文审核这份方案及具体边界，再决定是否批准固定依赖的临时取源和有限实验；本文件不是实验或生产授权。

## 6. 实验前精确化：URL 资格与准确输入提案

主线已同意第 2 节保守 Unicode 外边界先作为实验语义。两轴指出原例 5 的斜杠相邻本就拒绝，不能证明裸 URL 识别；本节加入 `https://x.test/?q=:smile:`，开冒号前是等号、末尾 EOF，本可通过相邻规则，必须由 URL 资格拒绝。原表保留为前案，若获执行批准，以本节准确 JSON 为唯一输入，不在运行后修改 oracle。

### 有限公开资格候选

对已通过固定名称、转义与邻接规则的候选，先依宿主排除明确代码/URL/title/HTML/定义等节点或 token。额外裸 URI 防护只读同次原文与公开位置：Lezer `InlineContext.text/offset/char/slice/end`；canonical 捕获同次 parseText 与 token 的公共 `Point.offset`。不读私有流索引、不从解码值反推位置。

从开冒号向左逐单位检查，至 inline 起点、物理换行、空白或 `< > [ ] ( ) " '` 分界停止，最多 256 UTF-16 单位。完整取得片段若以 ASCII URI scheme（首字符字母，后续字母数字 `+.-`，随后冒号）或 `www.` 开始，则候选受保护。查询内的 `= ? &` 不中止回查。它是保守 URI-like 保护，不冒完整 URL 解析；带括号 URL 等复杂边界仍是后续回归责任。预算耗尽或不能证明 inline 左边界则标 unknown、保留原文，不能当确定非 URL。输出实际检查字符数与 unknown 原因；256 是探针参数，不是产品性能目标。最大名称长度、邻接完整 Unicode 码点和转义奇偶检查也须明确计数，不允许每 marker 无界整段回扫。

本批只核确切样本；是否迁生产及普通文档误回退风险，须后续正式批准。没有执行资格算法。

### 固定值与准确半开区间

已只读固定提交 index.js 确认 smile→😄（U+1F604），+1→👍（U+1F44D，别名 thumbsup），均两 UTF-16 单位；未安装或执行模块。下面语义范围由手写选择，字符串长度/出现位置只用基础字符串算术交叉核，不调用 Markdown parser。范围零基 UTF-16 半开；除例11外 raw=CM。例11 raw长度19、CM18，CRLF→LF、单CR→LF；未来必须实际调用 raw-buffer 映射核，不能用此算术回环冒真实接线。

| 例 | 准确 JSON（解码一次） | 合法 Emoji oracle |
| --- | --- | --- |
| 1 | `":smile:"` | [0,7) |
| 2 | `"(:smile:) :+1: :unknown_app_name:"` | [1,8), [10,14) |
| 3 | `"a:smile:b 中文:smile:词 :SMILE:"` | 无 |
| 4 | `"\\:smile: &#58;smile: :smile&#58;\n\n\\\\:smile:"` | [36,43) |
| 5 | `"12:30 https://x.test/:smile: <https://x.test/:smile:> https://x.test/?q=:smile:"` | 无 |
| 6 | `"`:smile:`\n\n```txt\n:smile:\n```"` | 无 |
| 7 | `"**:smile:** ==:smile:== ^:smile:^"` | [2,9), [14,21), [25,32) |
| 8 | `"[:smile:](https://x/:smile: \":smile:\")"` | [1,8) |
| 9 | `"![:smile:](x)\n\n[r]: /:smile:"` | Lezer [2,9)；mdast image.alt=😄，不要求 image children |
| 10 | `"---\na: :smile:\n---\n# :smile:\n> :smile:\n- :smile:"` | [21,28), [31,38), [41,48) |
| 11 | `"😀 :smile:\r\n:+1:\r末尾"` | raw [3,10), [12,16)；CM [3,10), [11,15) |
| 12 | `"::smile:: /:smile: :smile:/ <b title=\":smile:\">:smile:</b>"` | [47,54) |

例4第一段开头恰一个 U+005C，冒号被 Escape 消费；第二段恰两个反斜杠，宿主先形成字面反斜杠，随后 [36,43) 冒号未被转义，允许识别。不能把两者都按含反斜杠排除；实体拼出的冒号不制造 Emoji。

例7保留 strong/highlight/superscript 拓扑；例8仅label；例9图片 canonical alt精确等于😄，不要求图片 children；例10首部排除；例12属性不转换，标签间正文转换。所有其余已知 shortcode 位置均不产生 Emoji，未知名称保持原样。接口不能保证时保留红或 unknown，不改期待凑绿。

仍仅方案，无安装、实验、生产、版本或Git。待主线重审这12例和有限资格算法。

## 7. 首次隔离语义探针收据（2026-10-16）

上节未执行为批准前历史。主线批准后按 prototype 纯模块与薄单命令驱动执行，冻结目录 `/tmp/agentic-f047c-emoji.W1eIIZ`，复跑命令 `bun /tmp/agentic-f047c-emoji.W1eIIZ/run.mjs`。12 个固定 case 每例一个子进程、两引擎各一次；宿主每例15秒、整批剩余180秒限时，首红停。首次 `/tmp/f047c-first.jsonl` 共12条、全部子进程 status0、无timeout/unknown，stderr文件为空；未重跑修改 oracle，不代表正式生产或真实窗口验收。

固定 registry tarball 仅取至临时目录并解包，SHA1 与 SHA512 分别精确符合第1节 shasum/integrity；已实际阅读包内 MIT 许可，无仓库依赖安装/lock变更。首次 curl 展示固定源文件时 head 提前关闭管道产生 curl56，随后完整流经 rg 成功取证；非数据解析失败、不据此推网络根因。

脚本冻结 SHA256：fixtures.json `fc8327eb474d39f1302547029260a2a2c6a0d7ba808529961de43d3fddd1b125`；candidate.mjs `0b824b81f16989269f558a2c262508cda3e9418552365fa5797fa445817fbdfb`；case.mjs `8fa45462f7d64c5d4324a2c2483b57a40601f7c0599e16c25374818cff44eb00`；run.mjs `140d395f4aa0fdfc9b4c3b9d8cb3bbd7edaca35d01e7995045e8ac7fe3599886`。

实际调用仓库 markdownGrammar.configure、新 FrontmatterParser/BomAwareParser 以及 raw-buffer 的 editorText/rawOffset/editorOffset；canonical 是使用全部当前生产扩展和 annotateCallouts 的临时薄影子再加 Emoji，并非修改真实工厂/profile。例7宿主 strong/highlight/superscript 均非空；例9图片 alt=😄；例11两坐标与实际映射一致；例5含 query 的裸 URL 两侧均无 Emoji。每条原输出保留整树节点/类型、两侧合法范围和每候选读数。

证据限制：没有实际 createRawEditorState/GuardedParser/wire、显示、owner消费者、候选弹层、阅读或GUI；预算unknown路径本批未触发（遇到会抛错使case失败），不证明生产回退；新节点名和映射生命周期仅临时。同次原文闭包读取代替Lezer局部片段资格，复杂容器/URI括号范围不在12例，不称完整语法或全局成本。现阶段只供独立复跑及主线判断下一最小方案，不能迁生产或自批通过。

## 8. 下一窄补计划：资格来源与预算边界（未执行）

主线实际复跑12/0（`/tmp/f047c-root-first.jsonl`），独立Spec亦12/0；仍禁止迁生产。上一冻结目录与原输出不改。下一仅提议新目录新增下列6例，原12保留作原证据，不改其oracle；每例每引擎一次、15秒/例、180秒整批、首红停。尚未获执行批准。

### 候选最小调整

预算耗尽改为明确 `unknown-budget` 返回，不抛异常进入解析故障；调用方不建Emoji节点，原文按宿主正常解析。unknown在固定6例中只有指定预算反例允许，必须准确计数/原因；其它unexpected unknown仍判失败。这是验证原文回退，不把unknown冒语义支持。

来源适配必须分别记录：Lezer使用本次公开InlineContext的offset/end与slice/char，原始文档仅作坐标对照，不能以全raw闭包替代inline资格。记录候选document位置及公开slice得到的实际字符；引用/列表续行不得默加容器前缀。canonical仍使用同次parseText和真实Point.offset，明确公开事件所能证明的inline边界；若不能取得与本片资格要求一致的边界，则报告unknown/路线缺口，不用私有buffer、猜行前缀或全raw相同就称已接通。BOM剥离及位置移回要用当前生产流程的明确影子，真实BomAwareParser与raw-buffer映射另列为实际调用，不称全真实factory。

计费按实际读取而非只记成功字符：URI与反斜杠奇偶共享256次左侧UTF-16读取，同一位置重读也再次计费；预算到达后不得先读第257个单位再回退。名称检查包含导致循环退出的冒号/非法字符读取，最大名称长度取固定表；左右Unicode各最多2单位单独计数，必要的低代理对核验也计入。固定样本smile的名称输入含5字母+闭冒号至少6单位，原实验仅打印nameReads5不是完整成本证明。EOF位置检查不算读取不存在字符，但必须单列边界判断；禁止slice整个剩余字符串后再声称有界读取。

计数口径分开输出：`sourceReads`是从宿主来源实际取得的UTF-16单位，重复取得重复计；`scanSteps`记录对已取得字符的分类/URI识别步骤，不冒CPU时长。可在首次左读时保存最多256单位局部缓冲，URI匹配只作用此有界缓冲，但拼接/反转/regex仍属额外工作，须输出缓冲长度与匹配调用，不称总操作等于sourceReads。若仍直接slice来源构造prefix则其长度必须再次计sourceReads且会影响N1预算，因此候选应复用已有缓冲，不以漏计凑N1绿。未知名称/非法终止也保留receipt，输出其实际nameReads和拒绝原因；固定6例没有未知名称不等于该分支已回归。无时间SLO或全局线性结论。

### 六个新增固定 oracle

重复构造是精确输入定义，不是随机生成；区间仍零基UTF-16半开。`!`重复串不带空白或URI scheme，其相邻字符本身允许，故能真正触发左来源预算。

| 编号 | 准确输入定义 | 手写预期 |
| --- | --- | --- |
| N1 | `"!".repeat(255) + ":smile:"` | 原始/CM长度262；Emoji[255,262)，值😄；左读为奇偶首次非slash1+URI255=256，不unknown、不throw。名称闭冒号读取计入。 |
| N2 | `"!".repeat(256) + ":smile:"` | 长度263；需第257次左读才可取得完整资格，unknown-budget且Emoji0；原始shortcode全部保留，不throw、树含正常段落。已读恰256，不能先越额。 |
| N3 | JSON `"\uFEFF:smile:\r\nend"` | raw长度13、CM12；Emoji raw/CM[1,8)，值😄；canonical内部parseText[0,7)再移回[1,8)，不能漏BOM位移；实际映射核端点、正文end仍存在。 |
| N4 | JSON `"> first\n> :smile:\n> last"` | raw=CM长度24；唯一Emoji[10,17)，属于Blockquote下Paragraph；实际InlineContext候选slice等于`:smile:`，对应inline局部位置须由公共offset读回，不预造offset。容器标记/换行不可被吞。 |
| N5 | JSON `"- first\n  :smile:\n  last"` | raw=CM长度24；唯一Emoji[10,17)，属于BulletList/ListItem/Paragraph；原缩进和last正文保留，公共inline来源和document位置实际对照。 |
| N6 | JSON `"**:smile:** ==:smile:== ^:smile:^"` | 三Emoji[2,9)、[14,21)、[25,32)；Lezer分别直接位于StrongEmphasis/Highlight/Superscript且这些容器是Paragraph的兄弟；canonical分别为strong/highlight/superscript的唯一emoji内容，段落间隔text只为空格；不得用全树有这几个type的弱断言替代父子关系。 |

N4/N5公开inline offset不预先猜具体数值，oracle固定的是document端点、原文和父子拓扑；探针必须输出实际offset与slice映射，无法公开解释即失败而非空集合通过。预算反例只允许保持字面shortcode，不改source/disk。六例通过也不证明复杂带括号URL、整段超预算体验、实际显示或全部consumer；这些仍是生产前待收敛边界。本节仅计划，未执行、未改冻结或生产。

## 9. 六例窄补首跑：N1 来源资格未完成，停止（2026-10-16）

主线批准第8节后创建 `/tmp/agentic-f047c-boundary.7Fwpll`，命令 `bun /tmp/agentic-f047c-boundary.7Fwpll/run.mjs`；原12目录不变。首跑整批exit1，仅N1执行，N2–N6未运行，无timeout。原输出 `/tmp/f047c-boundary-first.jsonl`、stderr文件 `/tmp/f047c-boundary-first.stderr` 保留；子进程断言失败详情在JSONL的stderr字段。

N1 Lezer确实取得公开 inlineFrom0/inlineTo262，Emoji[255,262)，leftReads256、nameReads6、neighborReads2、sourceReads264、scanSteps262、prefixUnits255、regexCalls1；这是有限公开inline来源/边界计数，不证明N2预算回退或全部成本。canonical候选没有已证明的inline起点适配，因此真实tokenizer记录公开now/events并显式返回 `unknown-inline-boundary`，不创建Emoji。两次冒号调用均记录unknown，真实宿主仍输出完整原文段落；硬断言unknown应0报红，未捕获全部异常伪造树。这是**候选来源接口尚未实现/证明**的路线失败，不是证实micromark不能实现该能力，也不是语义算法已经执行而解析错误。

具体公开证据：已安装 `micromark-util-types/index.d.ts` 的TokenizeContext位于604行，675行events只声明“Current list of events”，约717行now只声明“Get the current place”；defineSkip公开说明容器吞前缀后的行列跳转。`micromark/lib/create-tokenizer.js`约61行接收from、106行初始化events=[]、164行now返回当前位置。候选能读到N1此前data事件，但这些声明本身未证明events[0]在所有嵌套/容器中等于所需inline起点，故没有擅把它或当前now当边界。后续可只读研究公开text tokenizer上下文/chunks或mdast段落位置是否可支持资格后置判断；本次未擅自实现替代路线或补跑余五例。

冻结SHA256：candidate.mjs `41782ba63ff6af4e1aaae86ed17d7d3c1d266ff4dee09653075a38d1596019ef`；case.mjs `332d1c01f98e01f236def70af68db0829da8f8970a73b2583a84940dac62113e`；fixtures.mjs `b93d5056daa51419f6672aab994fd70f0d9530fa5d5889610257df70c12c1086`；run.mjs `f8d521d87bef6b9f29cc68670f4e13c6a529504cebfd6e8ddbf4023d31eebea2`。仅临时代码与本收据，无仓库生产/依赖/version/build/GUI/Git；不批准生产。

### N1计数纠正（原冻结不改）

独立Standards复跑相同首红 `/tmp/f047c-standards-boundary.jsonl`；主线亦实际复跑相同。成功路径另调用 `cx.slice(from,to)` 取得publicSlice诊断，7个单位没有计入sourceReads。因此264仅算法read helper计数，包含该诊断取得后至少271单位，绝不能称全部读取264。`ctx.events.map`也复制了整个当前事件列表，仅诊断输出，不在算法预算内、不可迁生产。后续分开 algorithmSourceReads、diagnosticSourceReads、scanSteps/缓冲处理，保留原日志不重写数字。

## 10. 最小替代来源提案：公开 resolveTo 后置资格（仅调查）

本节没有新实验或代码。已读本地公开接口与实现：`micromark-util-types/index.d.ts`约508行resolveAll说明内容完成后的整个事件范围；519行resolveTo明确“从content起点（包含其它构造）至当前tokenize刚完成处”；531行resolve仅当前构造。当前tokenize的events本身只有“Current list”的声明，不能沿用N1不成立的边界推断。公开文档：[micromark extension API](https://github.com/micromark/micromark#extensions)、[micromark-util-types](https://github.com/micromark/micromark/tree/main/packages/micromark-util-types)。本节依据已安装类型和实现，不假定未来版本相同。

首选只收敛一个候选：在tokenize中仅按同次raw/真实now接受形态完整且已知映射的shortcode，保留原生Point形成临时token；在**同构造resolveTo**中利用它公开保证的content前缀范围读取第一个事件的start.offset作为有限左边界，结合刚产生的真实临时token做第8节有界资格。首事件、offset或临时token身份无效则明确unknown并拒绝，不用event全列表遍历/复制求最小值，不猜当前段落行首。content内结构与容器所需的实际范围必须在后续N4/N5实证，不因签名文字直接视为全部成立。

接受时将该真实临时token改为Emoji类型并用公共mdast handler写映射值；拒绝或unknown则把同一真实token改为标准data，让原始片段走宿主文本，不合成Point、不写私有_index/_bufferIndex、不由已解码value反推raw。该构造消费的是仅ASCII短名，因此不跨行/容器跳跃。resolveTo只看首事件和当前token/已知末端对，不引入每marker扫描整个前缀events。反斜杠/URI左预算仍共享256，名称与邻居单独实计；诊断读取另列。

**必要风险而非已证可行**：临时token先截断了data，拒绝后改回data是否在宿主GFM autolink最终处理前正确合并/识别，必须核最终URL节点及完整href，不只断Emoji为0。链接label、图片alt与inline组合的既有解析次序亦需保持。若拒绝data的时机造成宿主解析变化，应报红，不重复调用私有resolver、也不在AST事后补造链接。本轮仍不新增宽泛URL规则或其它产品语义。

也已核 `mdast-util-from-markdown/lib/types.d.ts`公开CompileContext.stack/tokenStack/enter/exit；实现约421行enter会放入position.start，460行exit才补end。因此在自有mdast handler内可观察paragraph/heading等祖先的起点，但最终compile阶段已晚于GFM事件解析，临时token可能先改变自动链接，且tableCell/image buffer也需额外边界。此路暂不首选，不并行扩大成第二模型或通过重写已解码text补救原文。

若主线批准下一步，优先在新目录以相同6例验证resolveTo来源与N2正常字面回退，原12不改；再由主线决定是否需原URL例5的结构恢复对照。后者是生产前必要证据，不以6例通过冒称裸URL整体已证明。现阶段没有实验执行授权，不迁生产；等待独立调查交叉和主线全文审核。

## 11. resolveTo 六例首跑收据（2026-10-16）

主线全文批准后新目录 `/tmp/agentic-f047c-resolveto.bXn8sQ` 执行，命令 `bun /tmp/agentic-f047c-resolveto.bXn8sQ/run.mjs`。原N1–N6输入/oracle不改，15秒/例、180秒整批，首跑6条status0、整批exit0、无timeout；原输出 `/tmp/f047c-resolveto-first.jsonl` 与空stderr `/tmp/f047c-resolveto-first.stderr` 保留。原两个冻结目录不变，原12与URL拓扑未重跑。

N1左读256接受；N2耗尽明确unknown-budget，经真实临时token改data返回原始段落，不throw或捕获异常造树；N3真实BomAware/raw-buffer及明确canonical薄影子BOM位移通过；N4/N5实际公共InlineContext来源、指定容器父链及坐标通过；N6精确三种父类型、仅一个Emoji子项、Paragraph兄弟关系和两个空格text均断言通过。canonical resolveTo只以公开本content下界读取，不称精确paragraph/label父界，也不读取/复制整个events。它证明这六例的有限来源适配，不是全宿主语法证明。

计费证据仍有限：match部分的char读取与diagnosticSourceReads分开；**canonical tokenize生成临时token之前再次预读名称、mdast handler获取名称的slice，尚未加入match的sourceReads**。因此sourceReads不能称两引擎全解析取得总数，未完成全部读取计费责任。完整原输出供复核，不在此原目录补改计数凑验收。没有新成本/URL/图片/生产消费者实验，不据六绿批准生产。

冻结SHA256：candidate.mjs `5f00714b3ba25ef7087ed7f4e41cc8bb1bfddab05b863de4201bb532a6e73384`；case.mjs `0ba35d0d83fd32416726bc165c7b50e1ccabdaad185f585cb6282e98aa42b80e`；fixtures.mjs `e9e4641e2ff50f1593fb24b33610f15e85745f6ac879931267ab959af57820cb`；run.mjs `020ce9da955d0ab39268d788caad53ff8bcc03e2b6a00b05e3251ef1ae40228f`。复制形成新文件多了末尾换行，不改fixture值或原文件。没有生产、仓库依赖、版本、构建、GUI或Git。已交两轴独立复跑与主线判断下一步，不自批通过。

## 12. 下一最小批提案：原12宿主保真与完整计费（未执行）

主线复跑六例6/0 `/tmp/f047c-root-resolveto.jsonl`，不代表生产批准。下一只提议新目录运行原第6节12个准确JSON与原N6，共13例，输入和既有合法Emoji范围完全不变；N6虽与原例7同输入，保留为原有严格拓扑oracle，不扩大其它矩阵。每例15秒、整批180秒、每引擎单次、首红停。仅增加既有样本的必要宿主结构断言；当前不执行。

### 12.1 end资格差异及唯一窄修方向

上一canonical适配的 `end=source.length` **不是实际inline end**，与Lezer `cx.end`不同；BOM剥离后的整份原文长度只能作内存读取上界。它不能证明名称/右邻没有跨宿主content。下一候选不再把这个值命名为inlineTo或用作语义资格：canonical名称改由公开tokenizer的code顺序消费到闭冒号，遇EOF/负虚拟换行/非名称字符或固定最长名限制就nok，让宿主正常恢复；不先从整raw预扫再假定属于inline。所消耗真实token保留原Point。

闭冒号完成后保存宿主交给State的下一个code，作为右侧资格证据：null表示本content结束，负虚拟空白/换行按宿主空白处理，非负时与同次raw的公开end.offset处首单位核对；需要完整Unicode邻居时最多再读一个低代理单位，无法证明一致就unknown保原文，不拿文档后续字符替代content结束。Lezer继续以真实cx.end判断；两侧输出rightCode、documentLimit与实际使用的右邻，不虚构canonical完整inlineTo。resolveTo仅证明content**下界**，名称的归属和右邻另由流式tokenizer保证。此路线是否影响原例11 EOL或链接label闭界，必须本批实证。

`unknown-content-boundary`（首事件缺失/offset非整数/超出候选等资格失败）不得throw成整体解析故障；仅将已知身份、保留真实Point的临时token改回data并记unknown原因。必须先核末端enter/exit为同一真实临时token，不能因未知而猜测修改其它事件。违反这个内部身份前提不是可吞掉的任意异常；记录路线红并停止，不用catch-all伪造树。所有13例的语义预计unknown0，任何unknown仍使实验失败；实际预算unknown回退已由前N2有限验证，不能据本批无触发冒新证明。

### 12.2 完整但不混淆的计费口径

- `tokenizerCodeSteps`：宿主每次传入code并分类的次数，含非法终止/闭冒号后的lookahead；这是宿主流处理次数，不是rawSourceReads。失败候选仍输出receipt。
- `algorithmSourceReads`：所有原文char/slice实际取得UTF-16单位，按名称/左右Unicode/左URI与parity/handler映射分别拆项；重复取得重复计。URI+parity独立受256左读预算，不把名称和handler挤占成错误阈值。新streaming方案消除原预读但不隐藏其它重复来源工作。
- `handlerSourceReads`：若handler再slice名称，计其真实长度，并进入algorithm总和；也可将已核固定映射值附在自有token类型上避免再读，但不改Point或私有宿主字段。本批优先保留简单slice并诚实计数，不引入缓存架构。
- `diagnosticSourceReads`单独记录publicSlice等诊断读取，`scanSteps`、局部缓冲长度、regex调用、token及AST输出遍历另列。两者不能伪装进算法SLO；导入固定映射/宿主原parser成本不在新增字符预算内，明确不是全解析CPU或内存证明。

### 12.3 对原样本补充的手写宿主oracle

原例5整体必须是Paragraph，顺序为text `12:30 `、三个link之间各一个空格text；三个link的url依次精确等于 `https://x.test/:smile:`、`https://x.test/:smile:`、`https://x.test/?q=:smile:`，各label为对应完整URL，不因临时token/data还原拆成多个text或丢最后冒号。与未加Emoji的真实 `parseCanonicalMarkdown(raw,"editing-semantic")` 做完整AST对照（位置亦包含），**同时**断这份手写结构，避免仅两候选互比自证。Lezer本无GFM autolink节点，不以它当canonical URL oracle。

原例9图片节点url=`x`、alt精确😄，定义identifier=`r`、url=`/:smile:`不变；图片仍无children。原例8唯一link url=`https://x/:smile:`、title=`:smile:`，唯一label Emoji的range[1,8)和值😄；原例12属性HTML原文完整且独立，只有标签间正文Emoji[47,54)。这些是既有inline边界，不新增产品语法。原例6围栏/行内代码value保留shortcode，原例10Frontmatter原子value保留shortcode。N6照旧严格父子，不能降级为types存在。

本批不会证明任意URI括号/超长inline、完整view/owner、候选功能或reading子窗；那些仍需生产方案明确边界。不重跑已冻结目录、不新安装依赖、不动生产或版本。待当前双轴复核与主线全文批准后才执行。

### 第12节 E5 提案纠错：裸 URL 末冒号（未运行候选）

主线发现并暂停批准：12.3原先把三个URL均含末冒号、仅空格text间隔写成oracle，是错误提案，保留历史但不得用于执行。已核[官方GFM 6.9](https://github.github.com/gfm/#autolinks-extension-)的末尾标点规则、已安装 `micromark-extension-gfm-autolink-literal/lib/syntax.js`584/644附近将code58列为trailing punctuation，以及仓库未加Emoji的真实 `parseCanonicalMarkdown(raw,"editing-semantic")` 只读输出。裸URL的末冒号在链接外，尖括号自动链接保留末冒号。这是执行候选前对官方语义和baseline的核实，不是依据新候选结果调整期待。

E5准确oracle更新为单Paragraph [0,79)，其children顺序：

1. text `12:30 `，范围[0,6)。
2. link [6,27)，url/唯一text均 `https://x.test/:smile`，title=null，text[6,27)。
3. text `: `，范围[27,29)。
4. link [29,53)，url/唯一text均 `https://x.test/:smile:`，title=null，text[30,52)（尖括号不属于label）。
5. text ` `，范围[53,54)。
6. link [54,78)，url/唯一text均 `https://x.test/?q=:smile`，title=null，text[54,78)。
7. text `:`，范围[78,79)。

Emoji仍为0，原输入不变；完整AST对照必须与这份独立手写结构同时通过。没有运行第12节候选、没有更改任何冻结脚本。等待主线重新批准。

## 13. 流式资格与宿主保真首跑（2026-10-16）

主线批准第12节及E5纠错后，新冻结 `/tmp/agentic-f047c-stream.vReHxq`，命令 `bun /tmp/agentic-f047c-stream.vReHxq/run.mjs`。固定原12+N6共13例，每例两引擎各一次，宿主15秒/例、180秒整批首红停；首次13条status0、整批exit0、无timeout。原输出 `/tmp/f047c-stream-first.jsonl`、空stderr `/tmp/f047c-stream-first.stderr`；没有回改旧实验目录或oracle。

canonical通过真实tokenizer code流消费名称，null/负code不拿raw后文作右邻；resolveTo使用公开content下界，缺资格改真实token为data，末端token身份不匹配属于明确路线异常、不catch-all。本批所有预期合法/排除范围一致，unexpected unknown0。E5纠正后的7个children、url/title/label/位置及真实未加Emoji baseline完整AST全等；E9alt=😄及原定义url、E8label/title、E12HTML、代码/首部排除、N6严格父子均通过。

分别打印tokenizerCodeSteps、nameReads、neighborReads、leftReads、handlerSourceReads、algorithmSourceReads、diagnosticSourceReads、scanSteps、prefix长度及regex调用；断算法来源取得等于各分项之和、leftReads≤256。canonical不再进行名称raw预扫，handler名称slice显式计入；diagnostic publicSlice单列。此仍为新增候选读取账，不是整个宿主解析/映射加载的CPU或内存预算；未运行性能样本。

冻结SHA256：candidate.mjs `80f514c1d0aa002bd72d52e135520c636e93d20d67be043a31e9f581ce91396a`；case.mjs `f721e3046ec673d05c453b58020534140630b4a0cc2d558f7c195bf3397a7598`；fixtures.json `77e3c915a587e90c00e175361e7a9a3dd641688c8594381c621bcdfd985a6294`；run.mjs `3cf42acca7172f427544dd3d35e42f3495a54a5de1b9d9d15cea1323e49518d3`。

限制：canonical仍薄影子，未接真实EditorState/Guarded/wire/view、所有owner消费者、候选UI或reading子窗；本批不含BOM（有raw/CM EOL），先前BOM与N2预算回退仅对应旧候选，未冒新版已复验。unknown-content-boundary实际注入、真实宿主身份错误、复杂括号URI/右邻代理边界亦未触发。已交独立两轴及主线复跑，当前仅有限隔离候选，不自批生产；无仓库依赖、版本、构建、GUI或Git。

## 14. Typed 最小正式接入方案（仅方案，待主线批准）

主线与独立两轴均复跑13/0，主线日志 `/tmp/f047c-root-stream.jsonl`；当前无本批隔离阻断，不等于生产批准。下一拟直接实施后补正式回归，不再拆一串微型PoC。alpha165、构建、真实WK与Git仍由主线管理；本节不授权这些操作。

### T1 固定数据与原子语法

精确增加 `gemoji@8.1.0` 为映射生成工具的直接devDependency，最小锁文件变更，不升级其它包。新增一次性可复现生成脚本，读取该版本公共nameToEmoji，按稳定名称顺序输出仅name→Unicode的typed模块及固定maxName；映射源码纳入仓库、测试重建结果一致。编辑/Worker运行时只import这份小表，不import原gemoji全metadata，不为每次输入复制表。保存版本、integrity与适用MIT版权/许可归属。生成时拒绝空值、CR/LF/控制字符和非预定名称alphabet，发现数据不符就报告，不静默丢映射；允许合法ZWJ/variation selector等Emoji序列，不能套用entity的Cf过滤而丢组合Emoji。

这是显示解析必需的固定表，不是按需候选索引；后续候选搜索/描述模块独立懒加载，其责任仍保留第5节。首次grammar创建前表已就绪，不因加载后改变同一profile语义。生成脚本和直接依赖选择须随本方案一并获批，尚未安装。

新增 `emoji-extension.ts`：typed `EmojiExtension`（Lezer EmojiShortcode叶、micromark自有token、mdast emoji叶及声明合并）进入固定preset。采用已验公开streaming/resolveTo路线与真实token身份，不迁诊断events.map、整树日志、无界扫描或临时any。名称/邻居/256左资格预算有明确参数与局部原文回退；unknown资格仅拒该token，不使全文safe，异常身份则走现有可见故障通道，不catch-all吞掉。新增名称表最大长度与token stream一致，不从解码value反推raw。

### T2 双profile及真实消费者

在 `markdown-grammar.ts` 的同static nodeSet加入原子扩展；document/fragment现有入口不改，Frontmatter原子排除保持。`canonical-parser.ts` 仅editing-semantic加入Emoji；reading-legacy固定profile与旧行为完全不变。同步 `shared/markdown-profile.ts` grammar/editing版本、strict wire节点集/旧profile拒绝；不新增Worker或每键canonical解析。

正式测试用当前createRawEditorState/Guarded/BomAware及实际wire往返，不只手工parser配置。`image-summary`用真实editing canonical owner核alt=映射Emoji、reference定义与URL不变；`callout-inline`按可靠Emoji叶直接判可见非空（预算沿既有generator，unknown保原文仍非空），避免递归叶误判空壳。`inline-format`对部分穿过shortcode的格式操作保守拒绝；整token选择是否沿既有安全wrap路径可实现须通过原文/解析回归，不为本片放宽其它方言规则。代码复制实际target/owner核围栏内部shortcode原样，普通段落Emoji不能变成代码目标。读取节点value/children的编辑消费者必须接受typed叶；图片alt由公共mdast编译路径处理，不另造children。

### T3 局部编辑呈现与源码隔离

在既有 `liveDecorations` 可见范围遍历中消费可靠EmojiShortcode，复用 `TextCharacterWidget` 的textContent与原生事件行为；不调用displayTextCharacter的实体过滤，不插HTML/图片/URL、不新增原生桥。可信树、当前Text/route、单物理行、授权显示与原文范围全部通过后，才添加一个完整replace widget；不能先隐藏冒号再发现预算不足。source/safe不安装该呈现，源码只保原文现有颜色，不放大字号或显示Emoji替换。

光标/任一选区触及shortcode（含边界）恢复全部原文；Link/Setext及会隐藏组合标记的inline祖先触及也恢复，祖先检查复用已有迭代路径，不对普通无Emoji链接引入新全局预算回退。父折叠/图片opaque区域不得泄露widget。IME沿现有composition冻结/结束重建通道，不主动dispatch来显隐；doc/parser/safe身份变化使旧派生失效。只读仍可看Emoji但不允许修改，readonly测试必须断实际facet与controller拒绝，不以孤立扩展传入冒真实只读。

新增显示工作按单次liveDecorations共享 **1024节点访问/4096原文单位** 的初始实现参数计费，含Emoji节点、祖先和名称读取，不按每个token重新获得预算；若与现有SubSup预算使用不同对象，需显式输出总新增工作，不称全编辑器硬预算。去重只在该token资格处理完成后登记，多个visible range不能漏掉后段。超过预算保完整原文，不能出现半个shortcode或半个glyph。参数不是验收SLO；必须以代表性整屏短文及200项固定回归确认不会重演alpha163普通短文尾部无样式。没有新增缓存、全树每键遍历或DOM测量循环。

### T4 实现后必须补齐的正式验证

保留全部旧失败与错误oracle纠正记录。将原12+N6精确输入/手写结构移入正式测试，并加本版本N1/N2、BOM/CRLF/CR、引用/列表续行与表格合法边界；不将旧候选BOM/预算收据冒新代码通过。rightCode分别核null、虚拟换行、普通BMP和非BMP邻居（Emoji符号允许、Unicode字母/数字拒绝），未配对代理不得越界或造成整体故障。注入unknown-content-boundary验证只回退当前原文；真实token身份违例单独断可见错误，不吞异常造树。流式达到maxName后的终止/未知name同样原文保真。

实际工厂编辑装饰：未触及1个完整widget；进入/离开、非空选区、源码允许时多选区、祖先揭示、标题/code折叠、跨标签、doc变更/safe均回归；受控composition seam标明非自然IME。200项全部末端有widget；512项允许受限但每项只能完整widget或完整原文，不能半套。实际image/Callout/format/codeCopy消费者与wire/profile按T2硬回归。

有限成本只做4个固定小样本：无shortcode的 `"plain x\n".repeat(1024)`；有效 `":smile: ".repeat(1024)`；未知 `":unknown_app_name: ".repeat(512)`；预算边界 `("!".repeat(256)+":smile:\n").repeat(32)`。同当前原baseline与候选、Lezer/canonical各一次，共16独立运行，15秒/次、180秒整批外监督，异常/语义差异/超时停。报告实际UTF-16/UTF-8大小、节点数量、unknown次数、耗时，不制定产品门槛或宣称全局线性；不运行已知1MiB极端。生产修改后比较baseline必须固定原提交的同配置入口或明确薄影子diff，不能以更少扩展的空parser冒增量开销。

### T5 真实WK与交付边界

主线打包后以自建多段样本核首尾、引用/列表/表格、组合样式、已知/未知/转义/URL/代码/首部；触及恢复shortcode、修改后一次撤销、源码原文、折叠/查找定位、跨标签、readonly实际拒写、浅深主题、正常退出及正文SHA。至少包含组合Emoji/变体选择符显示，不承诺跨OS字形一致；自然IME若没有真实输入仍开放。实际复制通过揭示原shortcode后选中复制/粘贴核原文；未测的直接glyph原生选择不冒已验或自行定义新剪贴板产品语义。

仅在正式源码测试、独立双轴及真实有限验收通过后由主线判本显示片。手册/总表/义务协作明确：本片显示通过不等S-11按需候选完成；后续候选唯一片必须继续登记，阅读子窗、完整F-047、OBL-068/069和最终offline保持开放。本节提出时仍仅方案；下节记录随后获批实现，不改历史批准边界。

## 15. 有限生产候选与实现后收据（2026-10-16）

主线全文批准T1–T5及精确dev依赖后实施；未改alpha164、未构建、未做真实窗口验收或Git。新增 `emoji-extension.ts` 为同次canonical factory持有真实token的WeakMap及Lezer原子节点；unknown资格改真实token为data，异常身份明确抛错。grammar/editing profile升级，reading-legacy不变。显示在当前可见遍历中采用完整replace、同树/选区/祖先/折叠资格与每pass共享1024节点/4096字符预算，失败整token保原文；与SubSup预算独立，不称整个编辑器全局硬预算。inline-format整token和部分token均保守拒绝，不增加新格式产品能力。

固定 `gemoji@8.1.0` 作为dev工具依赖，lock仅三个新增行，无包升级。生成脚本、固定版本/maxName、Unicode表与MIT归属纳入仓库，运行时不载gemoji metadata。生成文件50,466字节，`bun apps/desktop/scripts/generate-emoji-map.ts --check`通过；对象创建及freeze、模块首次导入有实际成本，本批计时未涵盖，不能称免费。

作者定向命令：`bun test apps/desktop/src/client/emoji-extension.test.ts apps/desktop/src/client/editing-code-copy.test.ts apps/desktop/src/client/documents.test.ts apps/desktop/src/client/canonical-autolink.test.ts`。最终70 pass/0 fail/1764断言，日志 `/tmp/f047c-author-frozen-tests.log`。实际factory/wire、12固定结构、链接精确AST、图片真实summary.alt与定义URL、表格cell、Callout真实generator、代码真实target/owner（普通Emoji段落无目标）、readonly真实controller两模式拒写/raw/history/dirty、source样式隔离、旧wire profile拒绝、N1/N2预算、BOM/EOL/容器、非BMP及最大名称、unknown真实token回退均涵盖。图片摘要自身为真实函数，不冒所有异步image owner生命周期已另测。组合检查为既有LiveFormatting class受控view seam，非真实DOM/自然IME。

`bun run typecheck` exit0，日志 `/tmp/f047c-author-typecheck-final.log`；所改源码/测试/生成器限定eslint `--max-warnings 0`通过，`/tmp/f047c-author-lint-final.log`为空。原typecheck因目标lib无Object.hasOwn失败，改用hasOwnProperty而未改tsconfig；初次lint37项主要import排序/测试typed取值等，原日志保留 `/tmp/f047c-author-lint.log`。定向首次68过1红为canonical-autolink测试硬编码旧grammar stamp，更新精确新值保留原语义断言（`/tmp/f047c-author-final-targeted.log`）；补普通代码目标的测试误断undefined，公开API实际null，原69过1红 `/tmp/f047c-author-targeted-recovery.log` 保留，修测试为null未改生产。

### 15.1 固定小成本对照

主线核脚本和oracle后执行 `/tmp/agentic-f047c-cost.J7SRc5/run.mjs`：四个T4固定输入、两引擎、baseline/candidate各一次，16/0 exit0，无timeout；15秒每子、180秒整批宿主监督，原输出 `/tmp/f047c-cost-first.jsonl`，stderr空。baseline两模块由已验HEAD `f01c3b91eb456685d448076fbbbe97b9b2a96e7a` 的canonical-parser/markdown-grammar原文仅相对import改为绝对路径；其余扩展与当前同配置，不以reading空配置冒baseline。候选使用真实当前入口，不迁实验解析器。

执行前手写oracle：C2候选1024 Emoji均😄、baseline0，canonical聚合分别为`"😄 ".repeat(1024).trimEnd()`及原文trimEnd；C1/C3/C4两边Emoji0且canonical text聚合为各自raw.trimEnd。生产未插桩unknown计数，明确未测而非打印伪0。C4零节点与原文回退已断。时间为单次parse不含断言/模块初始化，单位ms：

| 样本/UTF-16与UTF-8大小 | Lezer baseline→candidate | canonical baseline→candidate |
| --- | --- | --- |
| C1 无shortcode，8192 | 5.436→5.462 | 20.071→19.675 |
| C2 合法密集，8192 | 3.665→6.264 | 8.702→14.709 |
| C3 未知名，9728 | 4.327→4.597 | 14.768→16.263 |
| C4 左预算回退，8448 | 3.816→5.261 | 12.286→13.597 |

这是有限小样本观察，不是全局线性、WK性能或产品SLO。没有重跑1MiB极端，没有与测试并行执行。冻结SHA256：baseline-canonical `a758b91e90d2d4f2675e642c8774407c49366c28f42c3c162f0069029eb8decf`；baseline-grammar `c128adbcba6d7c36591f266cd4b0519a106940f47d172883b7d5b67954fe3496`；case `4d5c915f163bb646dd1f3766893bb6de671e21520184eb146413a2c4bd0f1ea8`；run `b57981b5f7a2ba1637d7c5a7dc248fb57e4f935231ea7d32fd7ef4746f53d925`。

候选仍待主线全量/独立两轴/真实WK。自然IME、字形系统差异、真实选择复制/替换撤销、浅深主题、真实密集viewport/完整竞态/RSS与离线没有自动冒验；按需候选、阅读子窗、完整父及义务保持开放。

## 16. alpha165 真实窗口候选收据（2026-10-16，待最终独立复核）

主线全量源码1489 pass/0 fail/36458断言（`/tmp/f047c-root-full.log`），type/full lint/docs/lock/diff检查通过；两轴定向均70/1764、无必要构建阻断。主线另复跑成本16/0（`/tmp/f047c-root-cost.jsonl`），仍为单次小样本、初始化未计，不作性能承诺。alpha165 unsigned canary构建exit0，hash `2x826g9z7bw88`，日志`/tmp/f047c-alpha165-build.log`保留chunk大小与hdiutil弃用警告。解包至`/tmp/agentic-direct165.4au9Bo`直接启动，未经过安装完成窗口。包内Bun运行仓库全量1489/0/36460（`/tmp/f047c-alpha165-bundled-tests.log`），不冒称打包资源自动测试。

真实WK使用隔离`AGENTIC_MARKDOWN_HOME=/tmp/agentic-f047c-ui.z9whEg/data`，自建emoji.md/readonly.md，无用户正文。实际取得：

- 编辑像素首段😄/👍/👩‍💻/❤️，未知/转义/词内保持原样；粗体、高亮、引用、列表组合显示。滚动文末表格cell与末段Emoji显示，URL/行内代码/围栏短码原样；首部不替换。样本Frontmatter本身为无效YAML，错误提示属预期；`^上标 :smile:^`含空格不是合法Sup，本次未将它算Sup组合验收。
- 点击glyph揭示完整短码。编辑AX selectText首次实际只选到`ile: 与 `，未修改；切源码后按原文精确选择成功，再切编辑将`:smile:`替换`:heart:`出现dirty，一次CmdZ恢复clean。工具AX显示文本坐标差异保留，不推断原因或称所有原生glyph选区通过。
- 源码精确选中后切编辑揭示原文，CmdC、文末CmdV，再切源码确认粘贴为`:smile:`而非glyph；一次撤销回clean。源码始终完整原文，无Emoji替换。
- 标题CmdOptionF隐藏末段，第二次恢复；源码CmdF查`:smile:`为1/13，Enter为2/13，Esc关闭。编辑CmdF未打开，核现有组件仅source挂载，未将未实现的编辑查找冒本片回归。
- readonly.md实际444载入明确只读，编辑/源码各typeText x后无变化、无dirty；返回emoji.md仍clean。深浅两主题实际像素可见表格/末段Emoji与代码排除。设置菜单第一次AX点击浅色未生效，键盘Home/Return后Value浅色并截图确认；非首试成功。
- 正常CmdQ，CUA返回App quit；exec37302 exit0，Bun44273消失。日志有IMKCFRunLoopWakeUpReliable提示，未推断原因；不等同自然IME验收。

退出后SHA256：emoji.md=`4462fefa36a0c7dd0a2a04d8cc8ce84adb7d9cf351679dbbb2f78f3625216877`，readonly.md=`2c3a372776d8286d1207bdd6735e41128a95b967b82ffef5f7f8bd4a036c4a65`，均与初始一致；readonly恢复644。选择器初次连发快捷键过早进入错误目录，重新使用已观察GoTo字段成功；UI显示请求耗时包含选择器等待，不作读取性能数据。

边界：未实操自然物理IME、直接glyph原生拖选复制、全部名称/跨OS字形、真实密集视口、完整竞态/RSS、合法Sup真实组合及最终离线；这些不由有限自动/像素证据扩张。按需候选另片，阅读子窗、完整F047/S11/OBL068069及F041d冻结保持。当前候选等待最终两轴复核与主线正式判定，未提交。

## 17. 正式有限判定（2026-10-16）

独立Spec/Standards全文审第16节及当前diff，实际读测试日志并核两SHA/进程退出，均0必要代码与有限验收证据阻断；指出总表/手册历史候选状态待收尾同步。主线据此批准alpha165本显示片非离线受托Agent代验通过，非用户亲验。同步手册/总表/义务，仍不关闭S11候选输入与完整父/阅读子窗/自然IME/冻结及离线责任。Git待实际执行，不预写远端成功。
