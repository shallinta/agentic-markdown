# F-046a：Frontmatter 识别与编辑模式原文折叠

## Git 收据（2026-10-16）

已提交 `356ed9c7d4a5f19bd2544247802b9548c23616f2` 并通过既有单命令 HTTPS credential helper 推送 main；主线随后以显式 `github.com:443` HTTPS ls-remote 核远端同 SHA，origin/main 已同步。普通 github.com URL 查询遇 SSH port22 连接关闭，保留为连接失败；显式443查询成功，不推断根因、不改持久网络或 origin 配置。Git hook 未改变已验源码，冻结 F-041d stash 不动。下方 Git 待执行为历史状态。

## 主线正式结论：alpha161 非离线有限片代验通过

最终独立 Spec/Standards 两轴均0必要阻断，主线正式批准 F-046a alpha161（hash `2bxph215iwtab`）非离线有限片受托 Agent 代验通过，**非用户亲验**。范围为文档首部原子识别、编辑原文折叠/独立命令、源码完整、有限语法诊断及编辑消费者用途隔离。源码/包内均1377/33532，真实 WK、正常退出、五 SHA 原样/权限恢复与失败历史见下文；Git仍待主线实际执行，作者不预写推送成功。

完整 F-046/S-06、阅读子窗口呈现专项及最终离线人工保持开放；自然 IME、精确故障/竞态、极端资源与完整主题矩阵未实操，不因本片通过扩大保证。以下“待最终复核/未正式批准”等是过程历史，由本节正式结论覆盖，旧失败不删除。

## alpha161 真实 WK 验收候选：待最终独立复核，未正式批准

主线补充收尾：在 Frontmatter 后的真实正文代码块右键复制，出现复制提示；CmdEnd/CmdV 粘贴的两行 const/console 正确，CmdZ 回 clean。浅色设置下正常 YAML 状态清晰、invalid 红波浪线及错误提示可见，随后已恢复深色；这是最小浅色路径，不扩大为全主题矩阵。旧阅读模式实际仍把 YAML 内伪 `#` 当标题，确认 legacy 未迁移，不构成新阅读呈现批准；返回编辑恢复原子首部。readonly 返回源码仍只读且 clean。

退出前五个标签全部无 dirty，CmdQ 正常退出，exec49248 exit0，Bun1032 经 ps 核查已消失；launcher 的 IMK mach port stderr 保留，不归因。主线核五份自建 Markdown SHA 均原样，readonly 权限恢复644。另一次截图后 fullAX 重编号，再使用旧120目标报告 invalidID、未产生动作；重新取得当前AX后恢复，不推断产品问题。下段“实例仍运行/浅色未测”是先前进度历史，现已由本段覆盖。当前待最终独立双轴复核和主线正式决定，仍不得 Git。

主线实际构建 alpha161，hash `2bxph215iwtab`，直接解包 `/tmp/agentic-direct161.1Jht64`，自建五份样本位于 `/tmp/agentic-f046a-ui.OzsTCz`。源码与包内 Bun 运行仓库均 **1377 pass / 33532 expect**；typecheck/full lint/docs/lock 检查通过。构建的大 chunk 与 hdiutil 警告保留，不推断运行故障。实例 exec49248 仍运行，尚未退出/正文 SHA 与权限终检；本节仅记录主线实际观察，不构成作者自批或用户亲验。下方构建前状态为过程历史。

实际已观察：

- `frontmatter.md` 的 YAML 原文（含 `#` 注释）不误渲染为 Markdown，显示未发现语法错误；gutter 折叠、摘要展开、独立中文命令面板折叠均可用。`⌘⇧M` 到源码显示完整原文并只解除 FM 折叠，返回编辑不会自动重折。
- `invalid.md` 显示语法错误及局部下划线，首部内 definition 不被当作正文图片来源；正文末尾输入 `BODY-CHECK` 后 CmdZ 回 clean，跨回 frontmatter 诊断不串文档。
- `readonly.md` 权限444且界面明确只读，可由命令面板折叠/摘要展开；工具尝试输入 `READONLY` 被拒绝、仍 clean，源码切换正常。这不是自然 IME 输入验证。
- `empty.md` 无正文行时执行 FM 命令不折叠；`blank.md` 含一个真实空白行时可折。将 blank 临时替为 `---\na: [\n---\n# EOF 检查\n`，实际显示“有语法错误”而非“诊断暂不可用”；CmdZ 恢复原文 clean 和正常诊断。

保留工具失败：首次 Open、`⌘⇧G`、typeText 连发未正确定位，现场显示 tftpboot；改为分步读取 AX 和定位后恢复，不推断根因、不称产品回归。自然 IME、故障精确竞态、极端预算/内存与浅色本批尚未实操，不扩大为全矩阵通过。F-046a 当前无对应新 OBL 所有权条目；不虚构完成条目，完整父项/阅读呈现/最终离线继续开放。待主线补退出与终检收据、最终独立复核及正式决定；不执行 Git。

## 主线构建批准（alpha161，尚未验收）

主线首轮全量1374 pass/1 fail/33498，唯一红为旧grammar硬编码；补验过程中并行typecheck捕获新增测试string[].at不兼容目标lib，作者改为既有数组索引，未改tsconfig。复跑全量1377 pass/0 fail/33532 expect/203文件，日志`/tmp/f046a-root-full-tests-2.log`；typecheck、full lint、feature-docs/obligations、lock来源与diff检查通过。两独立轴各复跑增量13/179且0必要构建阻断；此前192/1653及全部失败保留，不混称同次运行。

主线已读核心parser、用途身份、typed fold、诊断owner/presentation与新测试；批准alpha161构建和真实WK有限验收。版本及lock workspace元数据同步，不改依赖版本。当前尚未构建完成、实际验收或Git；阅读呈现、冻结stash、自然IME/极端成本和最终离线边界不变。

## 生产候选实施中（尚未冻结、构建或验收）

首版冻结后的正式补验：主线全量 1374 pass / 1 fail / 33498，唯一红为 canonical-autolink 仍硬编码旧 MARKDOWN_GRAMMAR；按批准更新精确新版本常量，保留原 autolink 语义断言。Spec 要求正文复制与 guard 证据补齐：新增真实 `codeCopyTarget`→`createEditingCodeCopy`→editing canonical owner 的 BOM/CRLF 正例，排除 YAML 内伪围栏并复制正文；首次测试误把已转 raw 的目标再次传给内部自行映射的 owner，12 pass / 1 fail，改为实际 UI 的 CM target 后13/179通过，不改生产转换器。新增生产 Input 读取观察区分完整 root proof 无首部扫描、stop=B 不足 guard 必重扫、partial-body 可复用及开行/闭行/闭 EOL 编辑失效，均与独立冷树对照。这里只补既定 P5，未扩产品范围。

命令规则以主线顶部补充为准：共享 typed builder 不等于重路由既有标题/围栏专用命令；`⌘⌥F` 继续只操作标题，Frontmatter 仅独立中文命令与自身箭头/摘要，不新增快捷键。下文 P3“复用现有折叠命令按当前位置 kind 分派”的笼统历史文字被此明确规则覆盖。

补验冻结：定向 **198 pass / 0 fail / 1790 expect / 13 files / 3.16s**，`/tmp/f046a-author-revised-tests.log`；新增测试曾使用 `string[].at` 导致目标 lib 的 type/lint 报错，已改项目既有 `[length - 1]` 访问，不更改 tsconfig。生产源码自首版冻结后未变（补验仅三测试和记录）；未作构建/真实验收。

作者首版冻结收据：新四测试与相关旧定向合计 **192 pass / 0 fail / 1653 expect / 12 files / 3.15s**，`/tmp/f046a-author-final-tests.log`；最终 typecheck、全部改动 TS/TSX 与新增 Frontmatter 文件定向 lint、`git diff --check`、feature-docs/obligations 均 exit0。两独立代码轴正在复核；作者不自行批准，不替代主线全量/包内/真实 WK。所有 parser 用途迁移旧测试同时显式选择，编辑图片/代码复制 oracle 使用 editing-semantic。bun install 将 lock 中旧 alpha139 workspace 元数据同步当前 alpha160；package 未升新版本，后续版本由主线统一管理。

P1–P4 已接入 typed document Parser、显式 fragment/reading/editing 用途、固定语法版本、Frontmatter fold kind/独立命令及局部诊断 Worker。直接依赖仅 mdast-util-frontmatter 2.0.1、micromark-extension-frontmatter 2.0.0、yaml 2.9.0，官方 registry 安装完成；版本仍 alpha160，作者不执行 build/GUI/Git。生产 scanner 每 advance 4096 字符，fragment/组合每 advance 128 项，区别于先前实验预算，不声称硬 CPU 门槛。

实现后第一批正式新测试 13 项/82 断言通过；连旧定向 188 项/1627 断言通过，日志 `/tmp/f046a-author-tests.log`。随后补实际 controller 首次 closed-FM 后台接受（含旧用例 4/46）、双 canonical owner 显式用途与交叉 profile 拒收（含旧用例 11/151）；最终收据待冻结后统一重跑。插件测试直接实例化生产 ViewPlugin 类并使用真实 EditorState，验证组合开始取消、捕获晚回调拒收、结束延后再请求和正文外编辑复用；这是受控 seam，不是自然 IME/WK 验收。

保留失败：readonly 测试首次仅追加 readOnly facet，被真实工厂的 writePermission false 遮盖，3 pass/1 fail；改为生产公开 compartment reconfigure 后核 readOnly=true、三 kind 实际 fold、raw/history 原样，4/22通过，不弱化 oracle。首次定向 lint 43 项主要为 import 顺序/格式及可选链，正在正规修正；中间 typecheck 通过，不冒最终冻结收据。`a: [`/未闭合引号实测库 pos 为 `[len,len+1]`，原严格投影抛错；按主线追加批准仅将这个 EOF 虚拟单位映射零宽，4 个中英文回归保留 hasErrors 且不越界，诊断测试 5/33 通过，其他非法范围仍拒绝。未定义 alias 不经 resolve/toJS，因此不提供引用语义校验。

尚待正式最终两轴复核、全量测试和真实 WK；阅读子窗、完整父项、自然 IME/极端内存与最终离线边界保持开放。

## 当前主线批准：P1–P5有限生产实施

主线已全文读取下列最终typed方案与独立Spec/Standards意见，两轴均0必要实施路线阻断，现批准在当前工作目录实现P1–P5及实现后测试。允许三个精确版本作为直接依赖及最小lock同步；不把临时模型原样复制进生产。正式代码/真实验收尚未取得，版本仍alpha160，下一包alpha161由主线复核后管理；不得提前Git。

实施约束补充：既有标题/围栏专用命令及⌘⌥F语义不变，Frontmatter提供独立中文命令能力（不增加快捷键），可共享底层typed dispatch。`---\n---`无折叠入口，`---\n\n---`有实际空白正文行可折，不以trim判空。诊断hasErrors/hasWarnings来自完整数组长度，最多读取投影32项，不先全量map；watchdog在postMessage前建立，同步throw立即清timer/worker并结算。canonical用途不以隐式默认掩盖未迁移的编辑调用。正常CM unsupported、现存折叠safe清理、readonly实际状态和真实诊断生命周期均须实现后验证，不以安全退路或模型通过替代。

实施中EOF窄投影批准：主线与作者实测yaml@2.9.0对常见未闭合数组返回BAD_INDENT、pos=[正文长度,正文长度+1]，严格校验此前使其仅显示不可用，失败保留。两轴均0必要路线阻断，主线批准仅在可信库结果投影层将这个精确EOF虚拟单位归一为[长度,长度]，保留hasErrors和首部错误状态，不画越界字符。传输validator不变，其它非整数/负数/倒序/越界仍拒绝；加EOF与相邻非法范围正式回归，不做广泛clamp。


### 第10组公开API窄修与独立复跑

主线批准的新目录 `/tmp/agentic-f046a-statefix.qVReQf` 仅为group.ts增加StateEffect import，并把appendConfig调用移至该公开API；`api-only.diff` 保存两处差异，model/helpers/BomAware/wire内容不变。仅运行第10组的 `run.ts` 有15秒外监督，`first.jsonl` 为exit0、timeout=false、stderr空；前9组没有重跑，旧Ndphxa的红保留。

主线 `/tmp/f046a-statefix-root.jsonl`、Spec `/tmp/f046a-spec-statefix.jsonl`、Standards `/tmp/f046a-statefix-standards-replay.jsonl` 均同单组通过。因此是“旧1～9通过＋新第10通过”，不是原整批曾exit0。Spec指出readonly仅断言能返回事务，没有应用后核fold/raw/dirty；safe断言之前doc edit已清空fold，不能证明现存FM可被safe主动清理。这两项及正式metadata接线放入下列实现后必补测试，不再扩临时模型，有限实验不冒产品验收。

### 最终typed有限生产方案候选（主线全文批准前不实现）

本方案以已取得的真实接口证据直接收敛生产接线；不继续复制第11/12层相同模型，不把所有父功能或未来阅读窗口作为本片门禁。上述unknown明确转为对应实现后测试或有限验收限制，不能被“模型通过”覆盖。计划只交付首部识别、编辑原文折叠、源码完整与有限非阻塞诊断；不做YAML属性编辑/数据转换或阅读新呈现。

#### P1. 固定原子扩展与解析接线

新增 `frontmatter-extension.ts` / `frontmatter-parser.ts`（文件名可在实现时按现有布局细化），固定提供同nodeSet的原子Frontmatter类型、document Parser与fragment Parser。现有 `markdown-grammar.ts` 是preset组合点，只增加该原子声明，原strike/Table规则不改；不创建用户插件API。公开 `BomAwareParser` 改为显式构造所用parser，逐个迁移当前调用，禁止隐式全局把fragment升级document：

- 编辑Language、markdown-parser.worker、callout-summary.worker使用document；前后台MARKDOWN_GRAMMAR同新版本，wire只换固定nodeSet来源/版本，不改props/缓冲校验。
- inline-format、list/quote-indentation的local及局部probe使用fragment；全文分析/调试入口按真实用途显式选择，不凭字符串内容猜资格。
- 原阅读canonical保持legacy，独立当前阅读呈现与搜索行为不被新编辑grammar偷偷替代。

scanner改为typed常量状态与分片advance；根组合保留原Tree/TreeBuffer及contextHash，分片处理顶层children，最终构造不声称硬CPU常量。proof恢复严格采用上节可信nodeSet原子＋fragment半开guard及BOM offset规则；fragment候选查找也纳入分片状态，不把createParse同步遍历藏在预算外。仅首部正向proof，未知/失效不得猜；无FM时沿用原parser。非full document ranges显式失败由既有Guarded进入安全源码，实际正常请求如出现这一情况是必须修复/重评路线的红，不能把降级当成功交付。

实现后必须以真实公共parser+wire的test覆盖各类fragment/body重用，而不依赖弱类型实验events。旧源文件raw、CM EOL规范化、保存历史和主解析调度框架不改。

#### P2. 新编辑语义与旧阅读用途分派

`canonical-parser.ts` 增加显式用途参数/窄公开入口；editing-semantic注册官方两项Frontmatter扩展，reading-legacy保留原配置。两者由同原子扩展描述提供，不将yaml节点吞掉后重新按Markdown解析。固定直接依赖版本由同次package/lock小改声明，不借传递依赖；本地临时已用2.0.0/2.0.1，正式仍以这两个确切版本为候选。

`current-canonical-protocol.ts` / `current-canonical.ts` / `document-canonical.ts` / worker以固定用途选择config，结果必须匹配捕获用途和文档/内容/owner票据。现 `document-service-panel.tsx` 的阅读消费者显式legacy；`editing-code-menu.tsx` 显式editing，image-summary.worker固定editing并更新其profile；callout摘要使用同新Lezer。不能一次输入同时为两个消费者额外同步解析全文；沿用各自既有按需Worker生命周期。

只改变新增原子块相关语义。正文reference、代码复制、图片解析须新增真实正例回归（临时三样本只有排除负例不足）；阅读原树/SSR/当前查找输入与旧baseline保持。任何yaml新节点传入旧阅读的路径应测试失败，而非靠render未知节点回退凑兼容。canonical诊断/probe命名中旧“reading-only”注释按实际用途纠正，不宣称全局通用AST系统已完成。

#### P3. 正式fold kind与模式/交互

在现有 `editor-fold-state.ts` 的联合类型新增frontmatter kind，绑定document Text、当前可靠结构身份及from/to/openingFrom；新增资格来自当前实际原子节点和syntaxTreeAvailable，完整闭行未解析不得提供入口。唯一builder负责注册metadata与foldEffect成对、当前身份、非包含重叠拒绝、选择/IME守卫；不是把临时裸foldEffect迁入UI。preparePlaceholder仍单向读metadata，metadata.update不得读取新foldState造成环或新state双算。

编辑区保留开行，折叠范围为开行末至闭行内容末，隐藏包括闭围栏，但不吞后续换行/正文。空YAML不提供入口，只有空白行是否可折按真实正文行数而非trim误认，选择明确不含正文的空区块不折。初次打开不自动折叠。摘要固定“YAML Frontmatter”，可附短诊断状态，不显示字段值；原文展开使用已有等宽正文呈现，不另造YAML表单。鼠标gutter/摘要、中文命令面板及当前块折叠命令等价，经同一入口，不借默认placeholder点击绕过守卫；不另占新快捷键，复用现有折叠命令按当前位置kind分派。

编辑→源码必须同事务只unfold frontmatter，保留heading/fencedCode及原文、选区、撤销历史；再回编辑保持FM展开，不自动重新折叠。源码不显示FM折叠按钮/命令能力，仍可看/选/编辑完整原文。只读编辑允许展示折叠但不改dirty；单空caret主动折叠可移开行末，多光标或非空选区相交拒绝并中文提示。定位进入隐藏区展开，旧Text/旧DOM拒绝，tab暂停保留合法现存折叠但可安全展开，safe/fault/内容变更清派生状态。frontmatter、heading、fencedCode命令不能互相误操作。新原子块内不得沿用标题/任务/代码菜单的错误局部命中，必要的当前结构资格守卫限定在这些消费者，不泛化修改编辑器。

#### P4. 有限诊断owner、成本保护与故障退路

新独立诊断Worker与typed owner仅在当前编辑消费者请求首部状态时启动；无可靠FM或源码状态不启动新请求。从CM Text的开行EOL后到闭分隔行起点前提取YAML正文，坐标自然为CM UTF-16；不改变raw保存内容。结果pos必须整数、有序、落在正文内，加正文起点后才给当前块标记；无效范围当不可用，不能越界标正文。YAML的CRLF/CR规范化与诊断行列等价需实现后回归，不以实验LF代替。

正式候选 `yaml@2.9.0`，只parseDocument/固定安全选项/code+pos投影，不toJS/toJSON/resolve/自定义tag函数或网络；不把库message/字段值写日志。每结果最多保留32条诊断，另有hasErrors/hasWarnings/truncated标志；即使被截断也不能显示全部正确。超过投影预算可显示简短“诊断信息较多”，不循环同步遍历大数组到UI。库内分配风险通过Worker隔离和输入界限约束，不误用maxAliasCount当parse限制。

建议第一版实现参数：正文最多65,536个UTF-16单位参与诊断，超出仅提示“诊断暂不可用”，**仍可编辑/保存/折叠整个文档**；这不是新的文件打开上限。提取与发送仅在结构/内容代稳定后按需一次，超过限制先拒绝不拷贝全文。宿主从派发起1,500ms watchdog，超时terminate单Worker、结算请求、清引用后允许下一代重建；这两个值是可调整的操作成本保护，不是预设产品性能门槛，也不以64KiB单次数字承诺最坏时间。正式实现时若沿用项目已有统一成本参数需主线复核，不能静默去掉边界。

单在途/单最新pending；首部变化即时使旧结果失效，IME期间只持最新ticket不派发，结束后发当前；正文外编辑仅在结构及changes证明首块未动时保留结果，不每键hash全文。cancel、切用途/标签退役、close、异常、watchdog、dispose都必须结算Promise；先失效generation再terminate，晚回调无权发布。Worker.onerror真实进入unavailable，不能只测显式failure消息。正文解析失败走既有safe，诊断失败仅局部unavailable，不能降级整个编辑器或阻止保存退出。自然IME/真实WK最终仍由主线验收，不拿mock当自然输入。

#### P5. 实现后最小必补验证清单

| 模块 | 必补真实代码回归，不由临时模型替代 |
| --- | --- |
| parser/profile | 冷树手写oracle、BOM三EOL、decoded恢复及正文子树复用、开闭行/EOL guard失效、stop=B/partial-body区分；正常实际工厂/控制器跨标签和后台首次closed接受；所有公开入口用途及unsupported安全降级 |
| 语义消费者 | YAML内伪heading/reference/image/code排除；**正文正常图片reference与围栏复制正例**不丢；新旧用途并发、错profile/旧owner拒绝；原阅读树/SSR/查找输入保持，不能全路由legacy伪绿 |
| fold metadata | 真正frontmatter联合及唯一builder、官方selection自动清理一致、prepare字段更新次数、嵌套heading/code共存与独立命令；编辑→源码仅去FM并保留两个旧kind，回编辑FM不重折 |
| readonly与safe | readonly实际应用事务后核fold存在、raw/revision/dirty不变；**先建立现存FM＋heading/code再直接safe/fault**核全部按规则清理，不用先doc edit清空后断0；oldText/旧回调/单caret与多选区/IME保护 |
| 诊断owner | 正文区间提取与pos回映、32条截断/hasErrors不误报、65,536界限、实际提取与postMessage成本分开；真实onerror、派发后宿主watchdog、首消息前取消结算、dispose引用清理、IME旧代结果拒绝及body外变化复用 |
| 真实集成 | 型别/定向lint/全量自动测试与两个独立代码轴复核后，主线alpha161打包及真实WK；编辑箭头/命令、源码全文、无效YAML不中断正文、只读、跨tab、source/编辑、正常退出；不能以模型通过提前Git |

成本/取消的正式测试使用受控Worker故障与明确句柄终止；不要求故意制造无界YAML阻塞或断网。若无法证明真实忙碌parse即时停止，保留该证据限制，UI仍有明确unavailable和旧代拒收；不得宣称实时CPU抢占或RSS归零。真实自然IME、极端内存与最终离线人工等既有边界不扩不关。

这份方案待主线全文读取和两轴复核后方可批准生产。候选实现完成后再维护功能手册与义务的有限状态，最终是否通过仅由主线决定；当前没有生产改动、alpha161构建或新Git操作。


### 合并10组首跑冻结：9组通过，第10组测试接线失败

目录 `/tmp/agentic-f046a-prereq.Ndphxa`，固定脚本 `model.ts`、`helpers.ts`、`group.ts`、`run.ts`、各import影子、诊断模型/Worker、README及lock。仅该目录通过官方registry安装固定 `yaml@2.9.0`、`micromark-extension-frontmatter@2.0.0`、`mdast-util-frontmatter@2.0.1`，48个临时依赖，生产package/lock未动。影子差异保存 `model.diff`、`canonical-edit.diff`、`image-shadow.diff`、`owner-shadow.diff`、`protocol-shadow.diff`；BomAware/wire/Async保持上一ESM批的已记录重定向。

首跑前Standards早审发现诊断模型在IME pending时未失效旧代、首消息前取消可能留下pending Promise；冻结前补generation失效、cancel/exit结算和dispose清pending，并补首消息前取消断言。属于草稿审查修正，不称运行修复实证。根级proof精确条件包含 `fragment.to > B` 和映射root长度 `> B`，即半开范围实际覆盖[B,B+1)，不是to=B。

运行 `bun /tmp/agentic-f046a-prereq.Ndphxa/run.ts`：整批exit1，组1～9各exit0、无timeout；组10为 `TypeError: undefined is not an object (evaluating 'EditorState.appendConfig.of')`，无timeout。原输出 `first.jsonl` / `first.stderr` 冻结。readonly分支测试脚本把公开appendConfig放错到EditorState（应核StateEffect），这是实验接线失败，不推断产品readonly失效；首红后未改脚本或重跑。最后组之后无未运行组，但第10组readonly及后续safe路径未执行，不算整批通过。

| 组 | 取得的有限证据 |
| --- | --- |
| 1 | 原01/15 × LF/BOM-LF，共4个decode后append：根级恢复均rootIdentityKnown=false、header scan0，BOM offset=1；与冷树相同。原15正文共享child数2，原01正文只有被编辑标题，无共享child，不冒所有输入均复用 |
| 2 | BOM-CRLF/BOM-CR真实工厂规范化后复用offset1、raw保持；开行/闭行/闭EOL三处改动均不恢复旧proof且与冷树相同 |
| 3 | stop2不恢复，body stop15恢复首块closed，续算与冷树相同；EOF无guard重扫。错误wire profile、不同NodeType根、非首child拒绝，不放宽同nodeSet保护。可信来源前提仍不是任意外部Tree认证 |
| 4 | 实际factory正常创建、一次编辑和临时Language compartment暂停/恢复的记录均为完整ranges；显式非0/gap经真实Guarded产生fault、无伪FM树。小样本模拟后台首次closed FM接受与前景树相同。不是完整document-controller跨标签/viewport矩阵 |
| 5 | 3固定文档新canonical的definitions与真实calloutDefinitions一致；实际image-summary影子无首部图片泄漏，原15首部伪围栏不能复制。reading canonical输入及真实SSR同原生产baseline；实际DOM查找投影未执行、正文图片/代码正例不在该固定三样本，不能泛称全消费者无回归 |
| 6 | 两套实际current-canonical owner（编辑仅protocol/profile影子）交错文档/内容代/错误profile，旧结果拒绝，用途不混；受控Worker终止标记全部为true，非真实传输释放证明 |
| 7 | 6个YAML正文：正常/锚点alias/...无errors，坏语法与重复键有errors，未知tag有warning；只输出code/局部范围，无原message/value，无转换/展开调用。传入只为去围栏正文；已核局部范围，未独立断言加正文起点后的文档范围映射 |
| 8 | 4固定ASCII样本单次结果见下，不将Bun数字当WK性能目标或内存保证 |
| 9 | 临时诊断owner使用真实node:worker_threads：IME先失效后派最新、固定晚回调拒绝、failure返回unavailable、首消息前取消Promise完成；5个terminate返回exit0，最终worker句柄null。body-external复用由调用方提供同首部证明，仅模型；终止的是受控hold/已完成任务，不冒忙碌YAML parse被中断、RSS或DOM IME实证 |
| 10 | 到报错前已走过实际工厂/官方foldState：编辑FM折叠、源码去FM同时保留既有heading/code、回编辑不自动折、选区进入FM后展开及raw不变。readonly配置报错，readonly/oldText/safe后续断言没有取得。FM只是薄guard与官方effect，未扩生产私有typed元数据builder，不能称正式FM kind已实现 |

成本首跑（正文实际UTF-8 bytes与UTF-16单位相同；数字仅该单次测量）：

| 样本 | 实长 | 结构毫秒 | 提取毫秒 | YAML毫秒 |
| --- | ---: | ---: | ---: | ---: |
| 闭合普通首部 | 65,536 | 3.894 | 0.00075 | 8.782 |
| 闭合单scalar | 1,048,576 | 8.123 | 0.000958 | 45.272 |
| 未闭合Markdown | 65,536 | 7.632 | 不诊断 | 不诊断 |
| 深度256嵌套 | 517 | 0.06675 | 0.000459 | 4.705 |

这里提取为string.slice调用耗时，可能共享字符串存储，**不是完整复制/跨Worker发送成本**；大样本YAML在组子进程同步执行，宿主15秒可结束整个组，不等于产品Worker超时机制或总CPU硬上限。diagnoseMs含解析和code/range投影，未独立拆两者；未测RSS。createParse恢复proof时仍同步遍历fragment列表，不在advance计数内，是尚需限界/说明的成本，不因scanner有预算而隐去。

根级缓存、ranges显式失败和语义用途隔离已有有限新证据，但当前整批仍未通过，生产与alpha161未批准。下一先由主线决定最小修正组10公开API接线，保留本次9绿1红；诊断范围回映、数据发送成本及真实忙碌终止等未证边界须在正式最小实现中明确，不能借一批通过抹掉。未改生产、版本、构建、GUI或Git。

Spec独立复跑 `/tmp/f046a-spec-prereq-first.jsonl` 同为1～9通过、第10相同TypeError。补充边界：1MiB指YAML正文，加入围栏和后续标题后整文档超现行1MiB打开上限，此样本仅解析依赖隔离成本，不是App可打开文件实测；组9的fail是Worker显式返回unavailable，不是实际抛错分支验证。上述未证项不因独立复跑一致而关闭。

> 状态：2026-10-15，仅最小方案候选，等待主线全文读取及独立双轴复核。尚未批准或执行实验、生产实现、依赖安装、版本、构建、GUI 或 Git。上一片 F-048c 的通过不代表本片通过。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## 功能说明与本片边界

依据能力登记 S-06、结论114/115/121及2026-08-26对应决定：由原子 `FrontmatterExtension` 纳入固定 `ExtendedMarkdownPreset`，识别文档首部合法 YAML Frontmatter；编辑模式始终操作原始 YAML，可折叠；**源码模式显示完整原文，不提供本片 Frontmatter 折叠**。解析错误就地提示，不阻塞后续 Markdown、模式切换或保存。保持键顺序、注释、引号、锚点、别名、缩进及 BOM/EOL，不序列化 YAML 回写。

阅读呈现仍待专项设计，阅读独立子窗口尚未实现；本片不决定隐藏、摘要或完整呈现，不以依赖默认 HTML 输出替用户作决定。不做 Properties 表单、tags/property 索引、schema/保留字段、TOML/JSON Frontmatter、运行脚本、自定义标签执行、自动修复或格式化，不关闭完整 F-046。

拟定窄交互：编辑首部区块保留开分隔行及固定中文“YAML Frontmatter”摘要，折叠隐藏其后内容至闭分隔行末，保留后续换行与正文；摘要不展示用户字段值。鼠标箭头、摘要和统一命令面板键盘入口等价。空内容可识别但不提供无意义折叠入口；错误时仍可展开原文，摘要只展示有无错误/诊断暂不可用。精确端点、空行处理与诊断状态文案待下述实验后收敛，非已实现行为。

## 来源、现有前置与风险

产品来源：[能力登记](../product-capability-register.md) S-06/114/115/121；[MVP规格](../mvp-product-spec.md) F-046；[义务登记](../deferred-obligations.md)。已检索无以 F-046 为主承接的 OBL；本片 none 不取消其他父项责任。

当前源码证据：`markdown-grammar.ts` 仅配置已有 CommonMark、双波浪线删除线及 Table；`canonical-parser.ts` 注册 strike/task/autolink/table 并标注 Callout，没有 Frontmatter。`markdown-profile.ts` 的 Lezer 与 canonical profile 为版本化常量；`heading-structure.ts`、`editor-fold-state.ts` 和 `heading-folding.ts` 已提供可靠结构发布、官方折叠状态及 heading/fencedCode 类型，但尚无仅编辑模式的折叠类型。`bun.lock` 的 yaml@2.9.0 是开发工具传递依赖，不是桌面直接生产依赖；两项官方 Frontmatter 扩展当前未安装。不得借传递依赖偶然可解析冒充正式依赖声明。

官方公开依据（2026-10-15查阅）：

- [micromark-extension-frontmatter](https://github.com/micromark/micromark-extension-frontmatter#syntax)：默认 YAML preset 为三连 `-`，只在文档起始、非容器出现，要求闭合；分隔行允许尾空格/tab，支持 LF/CRLF/CR。其 `frontmatterHtml` 丢弃 Frontmatter 输出，不能用于本片替代阅读决策。
- [mdast-util-frontmatter](https://github.com/syntax-tree/mdast-util-frontmatter)：与 micromark 扩展配套生成 YAML 节点；结构识别不等于 YAML 值解析或合法性验证。
- [Lezer Markdown 公开扩展接口](https://github.com/lezer-parser/markdown)：使用 `MarkdownConfig`、`defineNodes`、`parseBlock` 与块规则顺序；本地 `@lezer/markdown/dist/index.d.ts` 提供 `BlockContext` 的位置/父层级/逐行推进接口。不得用独立正则装饰假扮语法扩展。
- [yaml 文档 API](https://eemeli.org/yaml/#parsing-documents)：`parseDocument` 返回节点及 errors/warnings；恶意输入仍可能资源耗尽。`prettyErrors` 默认含正文摘录；`toJS` 的 alias 限制不是解析本身硬预算。YAML 的 `...` 文档结束标记也不等于 Markdown Frontmatter 默认闭围栏。

### 识别候选约定

先按官方默认 YAML 边界做兼容性基线：仅 BOM 后绝对文档首行 `---` 开始、匹配 `---` 闭合；闭行后为 EOL 或 EOF。首部空行、缩进、容器内、正文中、四连横线、尾非空白文本及未闭合不识别为已闭合 Frontmatter，按原 Markdown 回退。BOM 是否由适配层剥离再映射、连续分隔行空块及末 EOL 以独立 oracle 核实。

`...` 必须作为显式负例/差异例：官方默认 preset 不将它视为闭围栏；它若在已闭合 `---` 包围的 YAML 内容里，交给 YAML 诊断，不额外扫描成 Markdown 边界。暂不扩为自定义 `---`/`...` 方言；实验若证据不同须保留原输出并交主线收敛，不能改 oracle 掩盖差异。未闭合的普通 Markdown 回退不是“有效区块内 YAML 错误”，二者必须分开报告。

### 必须在片内补齐的最小前置

1. 原子扩展拥有编辑 Lezer 配置、canonical 对应配置、版本身份及固定 corpus；由现有组合入口声明注册及优先级，不创建用户插件系统或新可切换方言。首部规则必须优先于 HorizontalRule/Setext 等竞争规则。只有最终可靠闭合才提供结构/折叠，partial 树不得把当前尾当闭合；既有后台解析 Worker 必须使用同一配置。
2. 所有编辑消费者必须看到真正 Frontmatter 节点而非其内的 Markdown 假节点：内部 `#`、列表、围栏、链接定义、图片、HTML 不得进入标题/代码折叠、链接打开、图片加载、Callout 或表格装饰。检查定义摘要 Worker、代码复制候选等所用 grammar/profile，不能仅修改主编辑器。
3. 原始源码搜索、选择复制、保存及撤销继续基于原文；不可排除 YAML 的可搜索文本。canonical 节点变化的影响必须先覆盖图片/链接定义、代码复制、阅读 SSR/可见正文查找及来源位置，不把 unknown 新节点静默忽略当兼容。

## 最小技术路线候选与尚待实验决策

### A. 结构与旧消费者兼容

编辑 Lezer 使用公开块解析扩展产生单一 Frontmatter 结构，原始内容不再被当 Markdown 嵌套解析。分隔符判断只存在于原子扩展，折叠/UI不另写一套识别器。规范位置明确分为 raw UTF-16（BOM与原EOL）及 CM规范化Text；跨层只经既有映射，单次 round-trip 不是独立正确性证明。

**公开接口可行性尚未证明**：`BlockContext.nextLine` 会推进输入，而公开接口没有任意回退；不能先消费到文尾、发现未闭合后简单 return false，声称普通 Markdown 已恢复。首组实验必须证明未闭合回退和真实 partial 的结构都正确。若公开接口不能在现有调度内安全实现，需要先提出有界前置方案重新复核，不能访问私有 input/to 或靠额外每键全文扫描绕过。本节是候选而非已解决的实现路线。

canonical 不能直接注册 yaml 后默认丢弃，亦不能把 yaml.value 再当独立 Markdown 解析就声称恢复旧阅读：文外引用定义、邻接 Setext 与位置都可能不同。本轮先比较两种受控数据：现行完整 canonical 树/实际消费者输出作为兼容基线，官方 Frontmatter 扩展语义树作为新结构 oracle。**暂不批准任何一个替换生产阅读输入。**

隔离实验验证的最小过渡候选是：原子扩展显式提供当前旧阅读消费者的兼容配置（维持原完整解析输入与输出）和新 Frontmatter 语义配置，固定 preset 内按已命名消费者版本分派，不能是用户方言开关，也不能用 regex 挖洞后局部重解析。若要同时保留两种结果，只在现有按需消费者请求时选择所需配置，不新增每次输入双重全文解析；明确 profile/cache/owner 分离，不将旧阅读结构混作 Frontmatter 语义索引。此过渡会留下阅读消费者迁移责任，须主线实验后批准并登记；尚不能称整个 preset 已全面统一接入。

如果上述配置隔离仍无法保证旧阅读/复制/定义消费者行为，或为了一个旧消费者必须引入持续双全文解析，则记录路线失败，先定最小兼容前置，不默认改阅读展示，也不把仅编辑视觉效果称为 S-06 完整完成。实验不要求构建通用 AST 转换器。

### B. YAML 局部诊断及成本

诊断与 Markdown 结构识别分离：闭合区块即使 YAML 无效也保持块边界，后续正文继续解析。候选使用公开 `yaml.parseDocument`，固定安全选项、关闭正文摘录/库日志，不注册自定义标签解析函数，不调用 `parse` 的值转换、`toJS`、`toJSON`、alias.resolve、stringify 或遍历展开别名。锚点/别名只保留为语法数据；未知 tag 可产生局部诊断，不执行、不联网、不加载 schema。仅返回受限错误代码/范围及中文分类，原错误 message 不直接写日志或 UI。

诊断按需独立 Worker：只有可靠首部区块且当前编辑消费者需要状态才加载；以文档身份、内容代数、区块范围/内容代数和诊断profile绑定结果。选择/滚动/只切主题不重算；正文区块外变化在结构仍证实原块未变时复用诊断，不为判断缓存相等每键序列化/哈希全文。区块内变化使旧诊断失效，合并为单个最新待处理任务，组合输入期间不派发新诊断；结束后处理最新内容。只传区块，不传后续全文；超大首部复制/发送成本也必须测量，不能只测 Worker CPU。

单 worker 同步 YAML parse 不能靠 worker 内 setTimeout 中断；候选采用宿主超时/取消后 terminate、旧结果拒收及按需重建，不无限排队。尚未冻结时间/大小数值，隔离成本结果决定临时实现参数。超预算、异常或不可诊断只显示“诊断暂不可用”，不得误报“YAML正确”，不得冻结编辑、保存或模式切换。没有 alias 展开不等于无解析成本/内存风险；栈深、重复键、巨长scalar和alias密集均需有限证据。只需语法诊断，不把普通用户键和值变成 App 状态。

### C. 编辑专用折叠与生命周期

扩展现有严格 fold kind 为 Frontmatter 专属类型，保留官方 foldState 为隐藏范围真源、metadata单向依赖和唯一受控 builder。新fold须当前可靠结构、同Text和编辑模式；源码 mode 禁止创建此类型。**切入源码时精确移除该类型的 fold 和 metadata，保留标题/代码折叠，不改正文、选区或历史；切回编辑默认保持展开，不额外保存一份隐藏偏好。** 这是满足源码完整的最小候选，需真实工厂模式事务验证，不沿用围栏两模式共享的规则。

已有同Text精确live展开不依赖重新全文解析，避免partial恢复锁死。标签往返保留合法编辑fold；修改、safe/fault清理；选区查找进入隐藏区展开。单空光标显式折叠可迁至开行末，多光标或非空选择相交则拒绝中文提示，IME/忙/冻结守卫与只读展示规则沿用。旧DOM/旧诊断回调必须拒绝新文档，即使数字范围相同。单gutter/placeholder按kind分派，不允许标题/代码命令误操作 Frontmatter，不接默认可绕过守卫的点击处理。

## 两组有限隔离实验计划（未执行，待批准）

使用已读 prototype/LOGIC；依项目批准惯例，mktemp纯模块加薄单命令驱动，无生产TUI、测试框架或仓库依赖安装。若需官方包，仅实验目录锁定版本并记录；当前授权尚不包含下载/安装或运行。每组冻结固定oracle及全部输出供主线和独立两轴复跑，失败原样保留；临时代码不得直接迁生产。

1. **真实结构、消费者与有限成本。** 当前Lezer配置加公开候选扩展，对照官方micromark+mdast：正常/空块/尾空白、闭合 `---`/非闭合 `...`/缺闭合、非首部/容器/缩进、YAML内伪标题/定义/HTML/围栏、BOM与LF/CRLF/CR、真实partial及增删闭行。分别输出raw与CM范围、后续块及官方类型，不拿转换后的同源坐标当独立oracle。用少量含跨块引用的固定文档比较旧实际canonical消费者（阅读SSR/可见文本、图片/链接定义、代码复制）与过渡兼容配置；任何输出/范围差异均红。另在同一脚本的有限成本场景测大首部、未闭合长文、深层/重复键/alias密集：单次结构解析/区块提取/诊断/取消结果分别记录，Bun结果不冒WK帧率或RSS，有限时外终止保留失败。不得为收绿缩小原红样本。
2. **真实CM与typed生命周期。** 使用当前 `createRawEditorState`/GuardedParser及官方foldState，注入临时Frontmatter类型最小模型；验证新fold资格、prepare→metadata单向无循环、官方选区自动清理一致、编辑→源码完整→编辑展开而标题/代码fold不丢、只读、跨标签partial恢复可展开、所有选区定位、正文/safe清理与旧Text拒绝。状态输出包含实际fold/metadata/selection/raw/history/dirty，不用裸Language替代实际工厂；无法注入时保留缺口而不改生产搭实验。诊断仅补固定旧结果/取消时序，不冒实际Worker及GUI生命周期已验证。

两组结束即收敛本唯一正式最小实施方案；没有证据的关键接口必须写明前置，不无限扩语法研究。只有主线完整阅读及两轴复核后，才批准生产/必要直接依赖与实现后测试。

### 首批 A1 冻结范围（仅方案，尚未执行）

上述第一组细分为 **A1 结构与消费者兼容**、**A2 大首部/诊断/取消成本**。当前仅申请 A1；A2 和第二组真实CM状态均后置，必须另获主线批准。A1不是性能benchmark，不执行YAML诊断器、压力样本或暖机。

最多16个固定fixture。下表使用 `\n` 表示换行，运行前在临时脚本冻结实际输入、预期首部分类及后续正文节点；不能运行后按输出重写预期。每个fixture生成LF、CRLF、CR三个EOL版本，共48case；BOM直接包含在第4fixture，不再做BOM乘法展开。每case每engine仅运行一次，无warmup；遇红保留后报告，禁止循环重跑大红或擅自扩矩阵。

| ID | 固定输入（转义记法） | 先验检查重点 |
| --- | --- | --- |
| 01 | `---\na: 1\n---\n# body` | 首部闭合，后续H1独立 |
| 02 | `---\n---\nbody` | 空内容边界；不推断空块折叠 |
| 03 | `--- \t\na: 1\n---\t\nbody` | 分隔行尾空白 |
| 04 | `\uFEFF---\na: 1\n---\nbody` | BOM适配及raw/CM位置独立 |
| 05 | `---\na: 1\n---` | 闭行EOF，无末EOL |
| 06 | `---\na: 1\n...\n# body` | 默认preset不以...闭合，普通Markdown回退 |
| 07 | `---\na: 1\n# body\n\ntext` | 未闭合不可吞后续节点 |
| 08 | `\n---\na: 1\n---\nbody` | 首部空行后不识别 |
| 09 | `prefix\n\n---\na: 1\n---\nbody` | 正文中不识别，原Setext/HR语义 |
| 10 | `> ---\n> a: 1\n> ---\n\noutside` | 引用容器不识别 |
| 11 | `- ---\n  a: 1\n  ---\n\noutside` | 列表容器不识别 |
| 12 | ` ---\na: 1\n---\nbody` | 首行缩进不是合法首部 |
| 13 | `----\na: 1\n---\nbody` | 四连横线不冒三连边界 |
| 14 | `---x\na: 1\n---\nbody` | 非空白后缀不识别 |
| 15 | `---\n# fake\n[id]: /inside.png\n![x][id]\n<script>x</script>\n~~~js\nx\n~~~\n---\n# body\n\n![outside][id]\n\n[other]: /outside.png` | 有效区块内部伪Markdown；文内定义对外部图片的旧/新语义差异必须可见 |
| 16 | `---\na: [\nb: &a [*a]\n...\n---\nHeading\n=======\n\n[x][outside]\n\n[outside]: /ok` | 无效YAML不影响闭合结构，alias不求值，正文Setext与外部定义 |

部分树属于同case同engine执行内的单次真实解析推进观察，不额外重跑全文：在第01/07/15/16的闭行前请求有限解析范围，记录树覆盖和资格，随后同一parse任务推进完毕；不得构造截短字符串后称为真实partial。若公开接口/实际工厂不能这样观察，标记缺证，不追加隐式运行。`BlockContext.nextLine` 消费后无法公开回退即为路线红，保留未闭合输出，不用私有成员、重新全文扫描或隐藏重试伪装修复。

每case每engine置于宿主监督的独立子进程，**15秒外部超时**后终止该实验子进程、保留stderr/已得输出和缺证状态；不是Worker内timer，也不是产品性能目标。子进程仅处理自建输入，不涉及App或用户数据。官方实验依赖只允许批准后从标准包registry取得，临时目录锁定明确版本/完整性，记录版本与来源；不引用浮动latest执行，不改仓库package/lock，不做生产安装。

### A1 的真实消费者对照与非自证边界

两配置是拟议新Frontmatter语义配置与保留旧阅读的兼容配置。**基准必须调用未修改的生产入口**，候选必须走临时原子扩展注册/配置分派及实际消费者接入，不能让baseline和candidate变量都指向原函数后说兼容验证完成。官方micromark/mdast的yaml边界和值/位置是结构独立oracle，Lezer输出不能反过来生成期望。

每case固定记录以下实际可调用输出（每个engine仅解析一次，随后复用其树供消费者；不额外parse兜底）：

- Lezer：完整块节点/位置、Frontmatter边界、正文标题/围栏候选，及已有定义摘要消费者结果；预期语义配置排除YAML内伪节点，非目标输入与旧production一致。
- canonical：未修改production全树及候选语义全树的类型/位置/定义；明确列出应有差异，不要求新语义树与旧树全等。
- 旧消费者兼容路径：实际阅读SSR/可见文本来源（可用的纯投影，不冒真实DOM）、图片/链接定义解析及代码复制候选/值/位置。分别和未修改production对照；第15必须覆盖首部定义改变文外引用的情况，不能只比较局部yaml.value或后缀HTML。
- raw/CM文本与坐标：原输入独立保存，检查BOM/EOL原样；映射输出仅作为观测，手写边界及官方raw位置才是独立对照。

若某实际消费者只能经Worker/DOM运行而本次薄驱动不能忠实接入，就明确记录该消费者未验证，不手写一个同名简化函数冒充它。兼容配置原样选择legacy解析器最多证明分派没有改变输入，**本身不构成兼容完毕**；必须同时证明新注册/profile不串入旧owner/cache，以及所有本片预计影响消费者的实际输出。无法在A1证明的owner/cache/真实DOM项列为后续正式接线前置，不宣称统一迁移已完成，也不以“兼容分支是identity”跳过第15等交叉影响。

公开API回退或实际消费者出现红/缺证即回报，A1结束冻结目录供主线/两轴复跑，再决定是否批准A2或第二组；本文没有预授权后续实验或生产。

## 实现获准后的最小 happy path

1. 自建有效 Frontmatter 文档，编辑原YAML与后续 Markdown；折叠/摘要/命令键盘展开正常，源码完整显示，切回编辑不自动隐藏；保存/重开及撤销保真。
2. 首部含错误YAML只局部提示，正文标题正常；修复后新代诊断清除，旧代不能覆盖。非首部/未闭合保持普通Markdown，无假fold；安全回退仍显示原文。
3. 查找YAML隐藏文本会展开定位，选区复制与原文一致；非空选区拒绝、只读无dirty、跨标签、正文修改清理、标题/围栏fold互不混淆。
4. 深浅主题、中文提示、真实WK滚动与正常退出；自然IME仅实际操作才记通过。自建样本SHA、权限恢复；实际worker超时/取消和大首部输入响应按实现风险补测，不以单元测试替代真实验收。

实现后补定向/全量/type/lint/docs，两独立代码复核、主线递增alpha及打包后真实验收，最终批准才Git。当前未到这些阶段，手册不提前列为可用。

## 继承约束检查与收尾

- **F-002 原文与离线**：本地纯数据、无回写格式化；BOM/EOL/保存历史保真。F-046a-offline-final留最终人工，不断网验证。
- **中文与外观**：新摘要/诊断/命令中文，复用主题；OBL-068/069仅协作回归，未迁移或关闭主责。
- **命令与键盘**：统一命令上下文及等价键盘入口，不抢现有快捷键；IME、readonly、busy/safe行为明确。OBL-064仅原文历史/组合协作。
- **安全与日志**：YAML永不执行，tag/alias不转换求值，无正文日志、路径或异常摘录；Worker失败只局部降级。OBL-030富内容安全协作保持，不能借阅读兼容绕过CSP/协议边界。

启动 `bun run check:obligations` 已通过，仅证明登记一致，不证明本方案/实现通过。父F-046阅读呈现、F-040/F-048剩余、专项设计、F-028c及最终离线责任不关闭。

## A1 首版实际收据（2026-10-15，失败候选冻结，等待独立复跑）

主线全文读取A1具体表且两轴无必要首子步路线阻断后，批准仅A1。实验目录 `/tmp/agentic-f046a-a1.c9OZXu`：`fixtures.ts`、`candidate.ts`、`engine.ts`、`run.ts`、`README.md`、临时 `package.json`/`bun.lock`，原始输出 `run-first.jsonl`/`run-first.stderr`。标准registry先查询明确版本，随后只在临时目录安装 `micromark-extension-frontmatter@2.0.0`、`mdast-util-frontmatter@2.0.1`；仓库依赖未改。lock保留完整性，安装47个临时包。

运行 `bun /tmp/agentic-f046a-a1.c9OZXu/run.ts`，实际 **48case、6项红、exit1**，无子进程超时；16fixture×3EOL，每case的旧/新Lezer、旧/新canonical与compat共五配置各单独子进程运行一次，宿主15秒监督，无warmup/循环重跑。原执行exec23679已结束。主线后来建议先最小未闭合反例；收到时驱动已启动，核进程时已全部48结束，不能写成首红已提前停止，也未因此另跑矩阵。

**确认失败**：06（`...`未闭合）和07（缺闭合）三个EOL版本均 `nonTargetFallback=false`。LF06旧树为HR 0–3、Paragraph 4–12、H1 13–19，新候选只剩Document 0–19；LF07旧树为HR 0–3、Paragraph 4–8、H1 9–15、Paragraph 17–21，新候选只剩Document 0–21。候选公开 `nextLine()` 消费后 return false 无法回退，吞掉后续结构；这条路线已否定，不访问私有成员、不另做每键全文扫描弥补，也未进入生产。

有限正证据：官方默认yaml识别符合预先冻结分类，包括 `---` 闭合与 `...` 负例；成功闭合的Lezer候选将内部伪Markdown隔离。例15实际 `calloutDefinitions` 从ID/OTHER变OTHER，内部假标题和围栏消失、正文H1保留。原始BOM/EOL和normalized位置分别输出；临时Lezer BOM通过移位观察，不代表生产BomAwareParser接线已经验证。

**旧消费者不可直接切新语义树**：实际 `commonmarkContent` SSR对例15的旧树展示HR/假标题/原HTML安全回退/代码与图片占位；新yaml节点走“未支持结构，按原文显示”，且文外 `![outside][id]` 变普通文字，因为首部定义不再注册。实际 `findCodeCopyValue` 的旧内部代码x消失是语义差异；其本实验目标由canonical节点派生，不等于真实Lezer/GUI复制目标已核。新canonical正确识别不授权这组阅读呈现变化。

compat实际选用旧production入口，其全树/SSR/代码值与baseline相等，但仅identity分派有限证据，**没有证明新原子注册及profile/owner/cache完整兼容**。真实阅读DOM可见搜索、图片资源/Worker生命周期及真实复制目标均unknown，不能用SSR代替。Lezer仅真实PartialParse逐次advance位置输出，没有注入生产syntaxTreeAvailable资格；候选开块扫描可一次推进过整块，闭行前partial可用范围未证实。该缺口保留，不把截短字符串冒部分树，也不追加全量解析。

下一须由主线及两轴复跑原失败后决定：收敛公开解析接口的合法回退前置、以及旧消费者版本隔离的真实接线证明。当前不能批准生产。A2大首部/诊断/取消成本及第二CM状态组均未执行；无YAML值转换/自定义tag执行、无新App包/版本/build/GUI/Git。复跑应保留原日志并预期exit1，不能删红或只挑正常输入声称通过。

## A1 独立冻结结论与官方替代路线调查（仅只读，2026-10-15）

主线 `/tmp/f046a-a1-root.jsonl` 与独立Spec `/tmp/f046a-spec-a1-independent.jsonl`、Standards复跑均48case/6红、exit1、无timeout，确认06/07三个EOL回退失败。当前直接块扫描方案不可生产；identity compat、canonical派生copy目标及partial/owner/cache等证据限制不因复跑一致而解除。原目录及失败保留，不修改旧脚本凑绿。

### 优先核官方 `yamlFrontmatter({content})`

只读查阅 [官方归档源码yaml.ts](https://github.com/codemirror/lang-yaml/blob/main/src/yaml.ts)、[公开frontmatter grammar](https://raw.githubusercontent.com/codemirror/lang-yaml/main/src/frontmatter.grammar) 及 [Lezer混合解析文档](https://lezer.codemirror.net/docs/ref/#common.parseMixed)。新官方forge地址本次返回403，GitHub已归档，故这里是可取得源码证据，**不声称新forge最新实现已核**。registry只读查询确认存在 `@codemirror/lang-yaml@6.1.3` 及integrity；本阶段没有安装或运行该包。

官方实现以LR外层识别可选Frontmatter/Body，再用 `parseMixed` 分别挂YAML与传入的content语言。这比自造第三套Markdown parser优先，但不是现有 `MarkdownConfig` 的直接替换。静态已发现以下差异/硬前置：

1. grammar 的分隔token只接受三横线后紧接CR/LF/EOF，不接受A1第03的尾空格/tab。不能为采用库而改掉已定官方micromark基线；只有运行证明或明确最小公开适配方案后再选。不能改私有生成parser文件。
2. 未闭合时LR可能错误恢复；源码不能证明它会完整退回原Markdown。06/07仍必须作真正运行oracle，不因“官方成熟”免验；空块、BOM、CRLF及`...`也不能从类型签名推断通过。
3. 本地 `@lezer/common` 公开类型说明：非overlay挂载树默认替代宿主参加普通遍历，overlay需resolveInner/enter；因此不能笼统说 `tree.iterate` 不进入挂载树。官方此处没有配置overlay，但根Document、Body替换、YAML Stream及匿名节点的实际形态仍待验证。现 `heading-structure.ts`/`callout-definitions.ts` 只遍历既定容器白名单；必须核正文是否可达、YAML内部是否隔离，不能只看树字符串。
4. **现Worker协议明确不兼容任意挂载树**：`markdown-tree-wire.ts` 固定单一 `markdownGrammar.nodeSet`，encode仅接受contextHash per-node属性，其他props主动抛错；mixed mounted含不同nodeSet及mounted属性。直接挂官方外层会需要明确序列化/反序列化前置，不能丢props、错配node ID，不能改成全部同步主线程以绕过此保护。是否值得扩协议应在最小实验发现后由主线决定。
5. `BomAwareParser` 当前直接代理固定markdownGrammar并移位fragment/范围；官方wrapper若引入，应明确BOM适配位于外层、raw/CM范围与mounted位置一致。当前 `GuardedParser(AsyncLongLineParser(BomAwareParser))` 及Worker独立BomAware须同配置，不可只改可见编辑器。Guarded本身接受公开Parser，但不代表新的parseMixed生命周期、stopAt/fragments、故障树及缓存复用已验证。
6. 官方LanguageSupport携带YAML高亮/缩进/语言数据；本片只需原文识别/折叠及局部错误，不能顺手启用未计划的自动缩进、块内折叠或键盘行为。利用公开 `.language.parser` 与配置隔离的可行性待证，不能以支持包存在为由直接把全部support装入生产。

建议下一步只申请官方wrapper的小范围结构探针：固定版本临时安装后复用原48输入，不加压力样本；先03/06/07和15证明尾空白、未闭合恢复、内部伪节点隔离，再决定是否继续。检查公开树、真实生产消费者及现encode是否明确拒绝，失败保留不修改协议；依旧每case/config一次及15秒外监督。**此处仅提案，尚未批准或执行**。如果这些必要边界不满足，先报告，不为适配库扩成混合语言平台。

### 官方wrapper不适合时的公开Parser候选（尚无实现）

仅作为后备研究方向：在现有Parser.createParse/Input/PartialParse内做首部闭行预判，再选择原Markdown或带原子节点的受控解析，避免推进BlockContext后回退。不是新增YAML求值parser，也不是每次输入额外同步全文扫描。生产前至少要明确以下契约，未解决前不得执行或实现：

- 每次advance分片读取公开Input，扫描位置与真正parsedPos分开；扫描发现字符不代表语法已可发布，等待闭合时不得把扫描游标冒成syntaxTreeAvailable。不能返回伪空树让后续内容永久失去解析。
- 未闭合必须回原Markdown完整解析，但如何限制首次双遍成本及输入时复用尚待证。首部无标记应常数路径；正文区块外变更若复用边界须有正确内容身份/版本证明，不以全文hash或裸offset相同代替。关闭/修改分隔符后失效规则必须覆盖首次未闭合缓存。
- TreeFragment是树片段而不是完整内容身份，openStart/openEnd、编辑映射和grammar版本须验证；不擅用未变fragment推定首部边界未变，不把旧闭行坐标用于新Input。
- stopAt只能按公开规则收紧；ranges可能不含0或有间隙，无法证明文档首部时必须保守拒绝新Frontmatter资格，不能读范围外内容再当已解析。BOM移位、EOF、真实Worker输入及Guarded取消/异常必须一起定义。
- 必须保持当前单nodeSet/已验wire协议或明确最小必要变化，不偷用私有input/to、不把小样例正确当增量/partial正确，也不声称“有分片”即成本已解决。

本节仅路线调查与下一最小提案。A2诊断/取消成本和CM状态实验仍未获执行批准，当前无新包、生产代码、依赖修改或验收结论。

## 备选：公开分片边界证据与固定节点集合（仅方案，待复核）

主线决定暂不采用官方mixed直挂，也不批准上节官方wrapper探针：已知尾空白与当前wire障碍足够，不为Frontmatter扩大混合树协议。以下替代A1直接消费回退路线，尚无模块、实验或生产实现；不是“成熟无成本方案”。

### 最小接口模型

保留单个静态 `MarkdownParser` 配置，在其nodeSet仅新增原子Frontmatter节点，全部Markdown节点及wire仍属于这一套nodeSet。采用公开 `MarkdownConfig.wrap`/`ParseWrapper(inner, input, fragments, ranges)` 返回一个 `PartialParse` 包装器，在调用inner.advance之前产生闭行证据，块规则只在已证实闭合时消费；没有证据时原首部HR/Setext规则接管，不再先消费后回退。

候选状态只有 `checking → closed | absent → delegating → finished`，以及取消/故障；证据包含首部开始、开行末、闭行起止、闭行完整EOL/EOF、输入长度与本次parse身份。`closed`不是YAML合法性，`absent`只代表本次完整检查无合法闭边界。证据不挂每个Tree的自定义prop，不引入mounted或多nodeSet。

**待实证接口假设**：公开BlockContext实现PartialParse，配置wrap得到的inner能否与parseBlock回调cx使用同一对象身份，是窄实验必须验证的第一点。拟用模块私有WeakMap，以该公开对象为key存本次证据，块规则只读当前cx关联；不是访问私有成员，也不将“最近一次扫描结果”放全局变量。并行两个parse必须隔离；结束/错误清理证据，不把Input长期留在全局缓存。若对象身份不能可靠对应，就报告路线缺口，不通过强制私有类型断言、全局当前parse或每parse重新configure来偷接；须另定最小公开接口方案。

### 分片检查及普通输入成本

先检查首部有限字符及尾空白，开行不匹配立即委托原解析；首行极长尾空白同样按字符预算分片，不能一个正则扫描无限长line。首部合法开行后才逐块查闭行，最多处理本次advance的有限字符量，保存游标/行状态后返回null；只用公开Input.read固定长度片段，不依赖chunk一次返回有界字符串。预算为实验后确定的实现参数，不预设产品门禁。

区块内编辑/新打开且没有可靠fragment时重算首部；未闭合最终委托同一原Markdown任务从起点解析。首次未闭合最坏会多读全篇一遍，这是明确成本风险，不声称消除了全文成本；须后续批准后测量，A1原失败不能替它证明性能。现有后台调度仍决定长文进入Worker，不为了此wrapper改为全主线程；Worker `.parse()` 会连续advance到完成，分片并不自动令其可中断或降低总CPU，取消仍依既有owner策略。

闭行之后的正文修改应优先从可靠fragments复用边界，不能每键重扫首部，也不每键取全文/hash。仅考虑严格保守的旧树前缀证据：当前grammar node类型身份匹配；旧树根首个真实Frontmatter位于0；fragment经公开applyChanges映射后仍从0连续覆盖完整首部及闭行终止字符，offset为0且无openStart；闭边界落在fragment未变范围内部。openEnd落在或贴近边界、前缀有缝、位移、BOM改动、删除/追加闭行字符均拒绝复用。旧树为EOF闭行的情况仅在无openEnd且当前Input长度与已证实完整旧树长度相同等严格条件下考虑，否则重算。不会拼接多个fragment猜一个完整前缀，也不会复用旧树里的“无Frontmatter”结论缓存。

上述fragment条件是候选充分条件，**不是已证明**：需用真实TreeFragment.addTree/applyChanges覆盖首字符插入、开/闭行编辑、闭行末插入、正文区编辑和fragment裁切。nodeSet同一不自动证明输入未变；fragment本身由正确上游提供且保留完整guard范围，才可作复用依据。若当前wire返回树无法提供该证明，宁可重算，不伪造版本票据。BOM坐标适配后的fragment是否仍满足条件另核。

### parsedPos、stopAt、ranges与取消

扫描游标单独保存；checking期间parsedPos保持已真实完成语法的前缀（首部待定时0），绝不返回扫描游标；进入delegating后才转发inner.parsedPos。仅closed且inner实际完成相应节点，才能发布折叠结构，扫描成功本身不等于syntaxTreeAvailable。

`stopAt`只允许收紧并保存请求，不扩大值。**重要未决**：在闭行之前要求停止时，不能长期返回null，也不能把不确定首部作为普通Markdown已确认前缀返回后被错误复用；如何用公开partial结果/openEnd表达待定而满足CodeMirror调度，需要先接口模型验证。本文不预定返回伪空Document、忽略stopAt或无限扫描越过stop点作为答案。这是生产前硬缺口，不得留到GUI才发现。

完整连续ranges从0开始时才允许首部证据；不从0或有间隙的请求不得把局部range首行当文档开头。保守委托原parser时是否会让已有首部错误降级、部分请求如何继承既有closed证据，也需验证；不私自读ranges外再宣称已解析。默认正常全文路径通过不等于非完整ranges契约通过。

包装器不自建timer/后台任务：每次advance内有限工作，外层不再调用时应只由本parse持有Input及状态，不能靠全局强引用续跑；发生错误抛给既有GuardedParser。worker请求取消不等于同步`.parse()`内部即时停止，需如实沿用既有取消能力并后续核实，不改变解析路由。超时诊断Worker属于A2，不能借此提前实现。

### BOM、Guarded与wire约束

期望层次保持 `GuardedParser → AsyncLongLineParser → BomAwareParser → 固定MarkdownConfig.wrap`；BOM由现有外层规范化，证据内部从归一化位置0开始，最终按已有规则回映。Worker与同步共用同一grammar/profile；新增node后递增grammar身份，wire encode/decode仍使用同一静态nodeSet，不放宽unknown props拒绝，正文及历史不变。`BomAwareParser`目前移位fragments的方法是否足以让旧前缀证据安全复用必须独立检查，不能从旧单parser测试推断新wrapper正确。

既有代码直接使用 `markdownGrammar.parse` 与通过BomAware的消费者都要核对；没有BOM时二者也不可一个走wrapper一个不走。原子节点内部不产生Markdown子节点，现有定义/标题/代码消费者应自动排除该内部内容；正文的可达性与复制/阅读兼容仍需A1后续证据，不被这套Parser接口模型代替。

### 下一允许讨论的最小验证顺序（未获执行批准）

先只验证公开wrap-inner/cx身份与并行隔离、closed/absent分支不吞正文、真实stopAt及ranges待定行为、fragment正文外变更复用计数；使用原48中的01/03/06/07/15/16小样本，不先做新压力测试、不改生产。接口红即停止回报；基础契约可行再申请完整固定语义矩阵和后续成本/取消研究。若stopAt无法安全表达或复用频繁失败导致每键双遍，则需要主线重新评估路线，不能将缺陷写成“后续优化”后生产。

## 下一窄接口探针固定清单（仅方案，待主线批准执行）

Spec与主线查阅公开 `PartialParse.stopAt` 契约：结果允许因解析算法前瞻包含停止位置之后的节点。因此不以“任何越点读取/节点”作为失败oracle，也不要求产出树长必须等于stop位置。仍必须遵守stoppedAt不扩大、未确认扫描不冒parsedPos、完整结果不吞正文；无限null、伪已确认partial或忽略停止请求不能冒符合契约。

最多下列12组，原A1目录不修改。只使用原01/03/06/07/15/16的LF输入及表中指定的微小编辑，不引入BOM/EOL乘法或压力样本，不启动A2/YAML诊断/Worker取消或CM折叠组。新mktemp模块加薄单命令驱动，现有项目依赖即可；无新增依赖安装或生产缝。

每组独立子进程由宿主15秒监督；每个PartialParse最多128次advance，组内累计最多256次advance，超过即记录未收敛而终止该组，不继续无限null。临时扫描每advance最多128字符工作单位，仅是实验参数，非产品门槛、性能承诺或已证明的成本上限。记录每次advance前后state/parsedPos/stoppedAt、公开Input.read区间与累计字符、结束tree与分支；独立oracle取未修改production同输入的真实解析及手写首部分类，不能候选树自己生成期望。多parse组只进行表中列出的次数，不循环暖机或自动重试。

| 组 | 固定操作与输入 | 成功依据/必须保留的未知 |
| --- | --- | --- |
| 01 | fixture01，单次从零推进至完成 | 闭合结构及后续H1；证明wrap的inner和进入块规则cx公开对象身份相同。若不相同直接报告，不接私有成员 |
| 02 | fixture03，单次完成 | 尾空白按已定边界识别，后续正文不吞；记录扫描读取量 |
| 03 | fixture06，单次完成 | `...`不闭合，absent分支完整树与原production相同，保留A1原红对照 |
| 04 | fixture07，单次完成 | 缺闭合完整回退，与原production树相同，不能只比较无Frontmatter |
| 05 | fixture15，单次完成 | 已知区块内伪标题/定义/代码隔离、正文结构正确；仅结构，不再声称阅读兼容 |
| 06 | fixture16，单次完成 | YAML语法错不影响闭合和正文Setext；不运行YAML求值/诊断 |
| 07 | fixture01与07各建一个parse，轮流各advance一次直到完成 | 两个公开对象关联及证据独立；closed不能泄漏到absent。每parse128、总256上限 |
| 08 | fixture01分别新建三个parse，在首次advance前stopAt(2)、stopAt(6)、stopAt(13) | 覆盖开行内/闭行前/闭行后；记录每次read/advance及最终树，不以允许的lookahead越点直接判红。每parse最多64、总192次；未能判断CM可用资格时写unknown |
| 09 | fixture01单parse，先stopAt(13)再stopAt(6)，一次advance后尝试stopAt(13) | 收紧值保留；提高值按公开契约抛错，不吞掉异常记成功；该契约错误后不再继续复用该parse。记录扫描是否错冒parsedPos |
| 10 | fixture15分别新建ranges不从0、以及首部中间有间隙的两个parse；ranges精确取已有整行边界 | 不把局部首行冒文档首部；公开范围内正文与原production对应请求比较。跨缝资格无法证明则unknown，不越权读缝并当已解析；记录所用确切ranges |
| 11 | fixture01先完整parse，用真实addTree/applyChanges在正文H1之后追加一个普通字符，再启动一次增量parse | 只在fragment严格覆盖首部guard时复用，记录fragment from/to/offset/open flags及扫描计数；语义与新输入原production/已定Frontmatter结构对照。若库裁切不保留前缀则记录fallback，不能声称reuse已证 |
| 12 | fixture01先完整parse，再分别从同一旧fragment基线改变开行首字符、闭行横线、闭行终止处插入非空白字符 | 三个独立mapped fragments/parse均应使旧closed证明失效；从0检查后正确回退/重识别，禁止套旧range。含初始共四parse，每parse64、组总256上限；不改原fixture文件 |

组11/12若无法在预算内建立可信fragments，不扩大预算或偷用手写fragment凑reuse；记录实际字段与缺证。只有观察到可靠前缀真复用且header编辑真失效，才能称该有限模型验证通过；一次fresh解析无扫描优化证据。组08/10只用公开Parser不能自动证明真实CodeMirror `syntaxTreeAvailable`，必须明确保留宿主接线前置。

接口身份、回退或停止契约出现红时保留原输出并立即向主线报告，不自动改方案/重跑；尚未运行的组写未执行。12组都过也仅是公开接口有限模型，不能批准生产、全增量性能、Worker/DOM或完整Frontmatter产品。当前仅列表与预算收敛，无新实验已执行。

主线执行批准：已全文读取上述12组及两轴公开契约复核，0必要窄实验阻断。采用12组既定上限（不扩为额外48场景），扫描每advance实际取16字符以强制观察分片，仍遵守原每parse/组advance次数及15秒宿主限制，并加整批180秒监督。closed fragment与stopped/partial缺证必须区分，不能把前瞻读取当受fragment保护。仅批准新临时目录该探针；无新依赖、生产、版本、构建、A2或后续状态实验授权。

## 窄接口探针首跑收据（2026-10-15，冻结待独立复跑）

目录 `/tmp/agentic-f046a-interface.h3yPbW`，冻结 `model.ts`/`group.ts`/`run.ts`/`README.md` 及 `first.jsonl`/`first.stderr`；引用原冻结A1的LF fixtures，不改A1文件、不安装依赖。命令 `bun /tmp/agentic-f046a-interface.h3yPbW/run.ts`，实际 **12组通过、0超时、exit0**；15秒每组/180秒整批宿主监督、有限advance计数与每次16字符扫描均在驱动实际执行。第09组手动调用恰一次advance但日志count未计入（显示0实际1），这是计数展示遗漏，保留原脚本/输出，不声称该组零advance或修改后重跑。

观察到公开wrap的inner与块规则cx确实是同对象，可通过按parse对象WeakMap取得闭行证据；并行closed/absent两parse互不污染。01/03/15/16闭合输出原子节点及后续正文，06/07回退全树与未修改原parser严格相等，A1原吞正文红在本有限路线样本不再出现。闭合成功case的自动断言只核Frontmatter及正文存在，完整节点输出已保留供独立核对，不能称完整48语法等价证明。

组08 stopAt(2)/(6)前瞻识别首部后各返回长度13的树，stoppedAt保持原值；stopAt(13)返回长度19。checking期间parsedPos仍0，委托inner后才推进。这里不把允许前瞻判失败，也**不把树长/扫描读取量当fragment可靠覆盖或真实CM可用资格**。组09收紧后提高stop值按公开契约抛错；组10非0/间隙ranges直接原parser回退、结构与原对应请求一致，局部range树坐标保留真实输出，不混作完整文档位置。

组11真实addTree/applyChanges(minGap=0)产生from0/to19/offset0/openStart=false/openEnd=true的前缀，guardEnd13严格在其内；完成树侧WeakMap中的既有closed证明使正文末尾追加后的扫描读取从16变0，非仅凭同数值range。组12开行首字/闭行横线/闭行终止处三种变化均使复用失效，回退树与原parser一致。证明只在停止请求为空且实际完整树返回时登记；但没有额外构造stopped树后复用回归，故不能声称所有partial缓存情况已证明。

**不可迁生产的模型限制**：临时每行字符串累积和整行正则仍可能在极长行产生非分片分配/检查成本，16字符read不等于整个advance成本有界；真实生产前必须改为有限状态计数或明确成本路线。完成树WeakMap仅进程内本parser拥有，没有跨Worker传输，新Worker仍首次扫描。没有BOM/CRLF/CR、本体wire集成、真实CM syntaxTreeAvailable、Worker取消/诊断/A2成本、GUI或RSS证据。未闭合首次扫描后原解析双遍成本保持开放。

本次仅接口有限模型，待主线及两独立轴复跑，不能由作者自批生产；A1旧6红不删。后续任何补验、正式方案、生产与A2仍需主线批准，没有新代码包/版本/build/Git。

## 下一窄补：强化oracle与停止树续算（仅方案，未执行）

主线及独立两轴实际复跑上节12组均exit0，认可仅有限接口证据；现仅批准编写本补验方案，不执行。新建隔离目录、保留原 `h3yPbW` 的全部文件/弱断言/count0历史。复制原模型算法不改，只强化驱动断言与输出；最多原12组加下列2个停止树情境，共14组，不扩48/EOL/BOM/压力/诊断A2/生产。

继续16字符scanner参数、每parse最多128/每组最多256advance、多parse组按原64限制；每组宿主15秒和整批180秒。第09的那次手动advance计入真实计数并打印前后位置；提高stop之后不再使用该parse。每组一次，无暖机；首红保留后停止，不为让新断言通过改model算法。

### 原12组断言收紧

- closed四固定输入不再只核节点存在。手写期望Frontmatter都是from0，01 to12、03 to15、15 to72、16 to27；必须恰一个，不吞末分隔LF。后续正文按既有固定输入要求：01 ATXHeading1 13–19；03 Paragraph 16–20；15 ATXHeading1 73–79、Paragraph 81–95、LinkReference 97–118；16 SetextHeading1 28–43、Paragraph 45–57、LinkReference 59–73。根及全部子节点与手写完整数组对照，不能由候选输出生成运行期oracle。使用第一轮已保存节点只是核对文本计数，新增期望需作者从固定文本确认并由独立轴复核。
- 除Document/Frontmatter自身外，节点不得落在已识别Frontmatter内部；例15内部假H1、LinkReference、HTMLBlock、FencedCode全部排除，真实正文定义仍存在。不是简单“有一个真实H1”就算没有伪内部结构。absent与ranges仍和未修改production相同请求精确全树比对，局部range坐标不当全局映射证明。
- 第11组必须断言实际receipt含reuse且增量parse的scanReads严格0，并断言新完整树正确；碎片不足导致fallback这次就应失败，不能仅打印false仍绿。初次扫描仍应非零；只用真实addTree/applyChanges(minGap=0)，不用手写fragment或改旧树。
- 第08明确固定模型输出范围：stop2/6结果Document 0–13、Frontmatter 0–12，无正文H1；stop13结果Document 0–19、Frontmatter 0–12、H1 13–19及标记13–14，stoppedAt分别仍2/6/13。这里验证该具体模型的已观察正确输出，不把这些位置升为所有Parser通用契约。扫描阶段parsedPos0、进入delegate才推进，并保留前瞻read记录。

### 新增两组（13/14）

| 组 | 操作 | 必须断言 |
| --- | --- | --- |
| 13 | fixture01原LF先stopAt(2)得到停止树；用真实TreeFragment.addTree(tree, [], true)标记partial，再以该fragment对同一完整输入启动无stop新parse | 保存完整fragment flags/ranges；新parse不能从该停止树取得complete WeakMap证明，reuse receipt为false、scanReads大于0；最终完整树严格为Frontmatter 0–12和正文H1 13–19，不把旧树13长度当全文或漏正文。两parse每个64advance |
| 14 | fixture01先stopAt(6)；真实addTree(partial=true)后applyChanges(minGap=0)，仅把闭行第一横线（原offset9）替换为x；对新完整输入启动无stop parse | partial/open边界映射原样记录；不复用closed proof，scanReads大于0；新树与未修改production解析新原文的完整树严格相同（原开行HR、后续普通段落和body H1），无Frontmatter，无旧闭合范围。两parse每个64advance |

这两组仅证明本进程模型停止树不会误获“已完整确认”侧证明、后续能重新算完；不证明真实CM的缓存调度、BOM映射或wire跨Worker缓存。完整初parse复用与partial停止树重扫必须分别报告，不能合并成“fragment全部通过”。

**保持不可迁问题**：line字符串累积/整行regex并非有界CPU；即使预判分片，inner块规则在已证闭合后仍用同步while/nextLine逐行消费，可能单advance阻塞。此次不改它们，也不以新14组通过声称成本已解决。原A1六红及本轮12组弱断言/count遗漏历史保持，生产/A2/后续性能路线仍未批准。

## 14组断言窄补实际收据（2026-10-15，等待独立复跑）

主线全文读取并批准后执行，新冻结目录 `/tmp/agentic-f046a-assertions.8Lt5Pe`：`model.ts`、`group.ts`、`run.ts`、`README.md`、`first.jsonl`、`first.stderr`。`cmp`核model.ts与原h3yPbW版字节一致（exit0）；仅驱动加强断言/计数，原12组与A1目录不改。无依赖安装。

命令 `bun /tmp/agentic-f046a-assertions.8Lt5Pe/run.ts`，实际 **14组通过、0超时、exit0**。闭合四例完整手写节点数组及内部伪节点排除、组11真实reuse且scanReads=0、组08精确停止输出均通过；组09计数现在为1，输出before/after均[0,6]，原count0历史不覆盖。

组13：stop2树长13，真实partial fragment为[0,13]、offset0/openStart=false/openEnd=true；无stop续算没有reuse receipt，scanReads16，最终完整树长19且正文H1 13–19存在。组14：stop6树后将闭行offset9横线替换为x，真实applyChanges得到[0,9] openEnd与[10,13] openStart两片；续算无reuse，scanReads19，完整树与原production解析新输入一致，保留正文H1且无Frontmatter。前瞻形成的停止树没有被误登记为完整闭合证明。

这是14组有限模型与oracle强化结果，尚待主线/两轴复跑，不是生产批准。临时line累积/regex/inner同步while的成本、真实CM/Worker/wire/BOM/EOL/阅读兼容/A2/GUI仍无新增证据，旧失败保留。未改生产、版本、依赖或Git。

## 下一最小贯穿方案：常量扫描状态与原子树组合（仅方案）

主线及两独立轴14组复跑均通过；第08虽有最终树精确断言，逐次parsedPos/read只记录而非全部强断言，不将记录冒完整进度证明。现只批准编写下一方案，未批准实验或生产。目标一次有限贯穿检查回答能否接入当前Parser/CM/wire，不再以孤立模型通过层层推定产品可用。

复跑收据：主线 `/tmp/f046a-assertions-root.jsonl`（stderr空）、Spec `/tmp/f046a-spec-assertions.jsonl`、Standards `/tmp/f046a-assertions-standards-replay.jsonl`，均14/0。

### 1. 移除两处已知同步成本源

首部scanner改为常量状态：当前位置、行起点、横线数量（超过3即失配）、是否仅尾space/tab、当前行是否可能是delimiter、CR待配LF及open/closed状态。每advance最多固定字符读取/判断，不积累line、不对整行做regex、不slice完整首部；分隔行精确三个横线且其余只空白。CRLF作为一个行终止，保留原始位置，末EOF只在实际行边界确认。预算仍实验参数，不提前冻结产品值。

闭合后**不再让BlockContext逐行while消费Frontmatter**。使用静态配置的单一nodeSet（原Markdown全部节点加Frontmatter原子类型），用公开 `new Tree` 构造Frontmatter节点，把闭行终止之后的body范围交原MarkdownParser。外层组合一个Document，子节点为Frontmatter和body的直接孩子；不挂mixed tree、不执行YAML parser、不引入第二Markdown语义。无合法Frontmatter时直接委托原完整解析，保留未闭合首部先扫描再解析的最坏双遍成本。

结构来源仍属于 `FrontmatterExtension` 的公开Parser实现，preset固定注册。不是只做视觉装饰，也不据此确定阅读展示。静态nodeSet在创建parser时固定，不能每次输入configure产生新type身份。

### 2. 坐标、Tree结构与终止

定义 `F` 为闭分隔行内容末、`B` 为闭行完整EOL之后（若EOF则B=F）。规范CM输入中Frontmatter节点为[0,F]，正文从B开始，根至少覆盖[0,B]。若body空，不调用body parser，直接完整根。否则使用原Input、仅body的公开ranges请求；依据已有组10，返回Tree的节点坐标相对请求起点，不能将parsedPos的输入绝对坐标混作树局部坐标。

拟组合公式：只剥body最外层Document，bodyTree孩子的位置统一加B，Frontmatter位置0；最终root.length为B+bodyTree.length。根type使用同配置Document type，Frontmatter type取同nodeSet；孩子Tree/TreeBuffer及自身props原样保留，不平移内部数组、不再嵌套Document。保留body.propValues并核现有contextHash语义与wire一致，未知props仍拒绝，不通过重造内部节点丢属性；根上下文因组合变化是否仍可复用须实证。现wire不增自定义元数据。顶层children/positions组合是O(顶层孩子数)，不是O(1)；拟在advance中预算化追加数组，完成后才发布Tree，最终构造成本另记，不称总CPU硬有界。所有公式必须用BOM/EOL固定oracle及真实消费者核实，不只做encode→decode自证。

checking期parsedPos不超过已完成语法前缀；扫描位置单独记录。closed原子节点实际建成后才能将语法进度推进到B，body阶段使用其公开绝对parsedPos。stop请求在B之前时允许为确认闭行前瞻并返回覆盖B的部分树（公开契约允许），但标记为stopped、不登记完整证明；不无限null也不忽略stop值。stop在B之后转发body parser的原输入坐标stop，返回结果再按相对树公式组合；提高stop仍抛错。每次进度必须增加强断言，不能只记录。

非0或有缝ranges不能误认“范围首行”是文档首部。候选先沿用保守原parser请求，不发布Frontmatter闭合证据；但这可能与已识别完整树的局部语义不一致，真实CM会否发此类请求、如何避免缓存错误是贯穿检查的必要问题。若实际宿主需要这类范围保持Frontmatter语义而候选无法满足，报告路线失败，不能以正常全文路径通过掩盖。

### 3. fragments与缓存，不拿吞吐退化换实现简单

首部闭合证据优先复用仍采用完整已证实前缀及闭行终止guard，不凭lookahead/partial树长。正文外变更只要真实fragments覆盖该前缀就不重扫；开/闭行或guard处变化必须失效。完成树侧WeakMap可用作同进程快速路径，但不是正确性唯一依据：BomAware会重建根、Worker decode也创建新Tree，身份映射可能消失，不能因此宣称BOM/Worker后每键都能复用。

正文原parser也必须有可用增量fragments，不能简单永远传[]然后声称省了Frontmatter成本。首个贯穿候选坚持完整Input及全局body ranges，优先保留已有完整组合树的fragment及原offset，不无条件减B；实际parser能否安全复用须实证。只有明确以独立旧bodyTree替换fragment.tree时，才按treePos=docPos+offset把offset减旧B（body起点对应负B），同时保持文档from/to及正确open标记；这是不同表示，不能混用。首探针不引入suffix Input的额外全套坐标映射。body起点变化不得沿用旧body上下文；必要时放弃缓存，但不可普通正文编辑时常态放弃。

若side map因BOM/解码消失，能否从可靠同nodeSet组合树重建body视图、如何避免每键复制所有根children，尚待贯穿验证。不能直接遍历全树重建或为优化新增跨文档永久缓存；仅可固定根级结构适配并计入成本。若不能在当前公开接口保持正文增量，该方案不算可接入，先向主线报告而非继续加泛化缓存层。

### 4. BOM/EOL、真实宿主与wire

保持Guarded→AsyncLongLine→BomAware的既有路由，BOM位移在外层，组合核心只在BOM移除的坐标运行；原文raw仍由既有rawText保存，CM仍按现有规范化EOL。兼容测试分别断言raw原样、CM规范化节点、BOM根偏移、局部body相对坐标及后续正文锚点；不能拿同一适配器来回转换自证。

本地 `Tree`/`TreeFragment`/`Parser` 均有公开构造或委托接口，现 `markdown-tree-wire.ts` 编解码绑定其import的固定markdownGrammar.nodeSet与profile。因此临时实验不能把新type硬交旧decoder后伪称兼容；需要在临时目录作明确的**最小影子接线**：复制实际模块并只重定向grammar/profile或Parser构造入口，让同一静态nodeSet贯穿encode/decode/Worker样本；记录与原模块的精确差异。wire主体校验、props限制及buffer逻辑不得弱化。若需要超出该重定向的小改动，报告为正式前置，不能在影子里修完却说原生产直接支持。

**全文/片段资格及消费者最小路由**不能遗漏。实际 `inline-format.ts:309` 使用BomAware解析local，`list-indentation.ts:267`/`quote-indentation.ts:207`直接解析局部片段；不能全局替换通用grammar/BomAware后把任意片段offset0当文档首。候选明确两种公开入口、同一静态nodeSet：document入口才启用首部识别，fragment入口保持原Markdown语义，不靠字符串内容猜资格。

| 实际消费者类别 | 本片候选资格/语义 | 缓存与边界 |
| --- | --- | --- |
| 编辑器全文、markdown-parser.worker、callout-summary.worker | document入口，新Frontmatter编辑语义；源码使用同结构但完整显示原文 | grammar/profile递增，前后台一致；既有owner按当前文档/内容代拒旧结果 |
| inline-format、list/quote-indentation的local；相关局部probe | fragment入口，不识别Frontmatter | 参数显式资格而非默认全局；片段开头三横线仍原语法。全文canonical-markdown/probe需按实际输入用途显式选择 |
| image-summary及编辑代码复制等canonical消费者 | 新Frontmatter语义配置，不把YAML内定义/伪代码当Markdown来源 | image摘要不能和callout定义摘要一新一旧；配置身份进入既有按需owner/cache，不每键追加同步canonical全文parse |
| 现有阅读canonical/阅读可见搜索与呈现 | 显式legacy兼容配置，保持已验行为，迁移待阅读对应迭代 | 独立profile及owner；不能把全部canonical统称reading，也不能复用编辑新语义缓存给旧阅读 |

上表是最小限定，不是通用插件注册系统。首个贯穿批先证明Parser/CM/wire及全文/fragment资格，canonical两类消费者路由仍是生产前必须收敛的具体前置；若没有真实输出证据，就记未验证而非“兼容已完成”。按需分派不意味着同次输入同时跑两遍canonical。F-041d冻结候选仍不启用。

真实 `createRawEditorState`/GuardedParser/AsyncLongLine的宿主验证也须同样明确：优先公开Language重配置实际状态；如果工厂不暴露替换入口，只允许方案列明的临时影子import替换，不修改生产或塞测试专用产品入口。结果标为实际工厂逻辑的影子接线，不冒未修改production已经安装扩展。折叠/GUI/诊断仍不进入本批。

### 5. 一批最小贯穿验证候选（未获执行批准）

拟在一个新mktemp目录，最多8组、每组15秒/整批180秒宿主监督及有限advance，固定输入，不先做大文档性能。具体脚本前再冻结上限和oracle；本段不是执行授权。

1. 原01/03/06/07固定LF：常量scanner与原子Tree组合，精确闭合树/absent旧树，记录实际advance/read；不存在inner逐行消费Frontmatter。
2. 原15/16：内部伪结构隔离、正文标题/定义与实际 `calloutDefinitions`、`headingStructureSteps` 消费可达，完整树手写oracle保持；同一原01以fragment入口解析必须等于原Markdown，不把局部0当首部。不将canonical identity冒阅读兼容。
3. 原01加BOM并分别LF/CRLF/CR，经真实CM规范化与BomAware影子入口，明确各raw/CM/树位置；保存原文，正文H1位置符合独立预期。
4. stop2/6/13及真实CM按范围请求：强断言checking parsedPos不冒扫描、stopped值不扩、续算正文完整；非0/gap请求与缓存资格明确，不仅比较树长。
5. 完整树正文外编辑与开/闭行编辑，用真实addTree/applyChanges：首部reuse及零重扫、body增量fragments实际传入，结果精确；不得只凭side map存在宣称缓存生效。
6. stopped/partial树及BOM重建/解码后的fragment：不得将partial当完整证明；验证完整头/正文再算与复用实际行为，记录side map缺失成本，不偷偷改为恒全量。
7. 相同静态nodeSet的真实wire影子encode/decode、buffer/props限制与grammar标记错误拒绝；解码后实际消费者节点/位置与独立oracle一致。不新增mixed/自定义props。
8. 实际EditorState工厂逻辑及Guarded/Async宿主影子接线：前景与模拟后台响应同树、解析错误进入原故障路径、状态编辑后旧树不发布。这里只是宿主自动接口，不是真WK/真实Worker取消或IMЕ。

一次贯穿批结束必须作是否值得生产的结论：任一坐标、缓存安全或wire前置不可满足则保留红并报告；全部有限正确也只能进入正式最小技术路线复核，性能与YAML诊断A2另批。当前旧阅读消费者兼容、原子preset全面迁移与自然IME/真实窗口等余项不因这批而关闭。尚无新实验、模块或生产改动。

成功后的明确收敛点：不再为相同Parser接口追加一连串模型，转为一份typed生产最小方案，列实际修改文件/四类入口/profile与保真边界，并依已批准范围安排实现后回归。进入生产前还必须由主线批准解决两件事：（一）新编辑canonical与旧阅读兼容分派的真实消费者输出/缓存隔离；（二）诊断依赖与按需Worker的有限安全/成本证据（A2）。它们是本片必要能力，不是其他父功能全部完成的门禁；可在一个有界后续批里验证并收敛，不追求完整插件系统/所有未来窗口。若贯穿结果显示无法保住现有Parser/CM/wire或每次输入仍重扫/重组全文，则先重新评估路线，不以“之后优化”获生产许可。实际GUI只在实现、自动验证及双轴代码复核之后，由主线打包执行。

历史执行批准（仅指前述已完成14组）：主线全文读取14组窄补方案，批准不改算法的断言加强及两组partial树续算；不是本节八组的授权。

### 主线八组贯穿执行批准

主线全文读取本节方案及独立Spec/Standards意见，均0必要实验路线阻断，现批准新临时目录内八组贯穿实验。冻结脚本后每组仅首跑一次，首红即停止保存未执行列表，不自动改算法重跑。每parse最多2048次advance、每组累计8192次（手动/并行均计数），scanner每advance16字符，组合每advance16个顶层孩子；每组外部15秒、整批180秒，所有同步oracle也在同子进程时限内。这些是有限实验监督参数，不是整个原parser或Tree构造的CPU硬保证。

实际正文增量须给公开子树复用或输入工作计数证据，不能只因传入fragments宣称复用。Async仅小样本影子低阈值/模拟响应，不扩压力输入，不冒真实Worker或WK验收。影子重定向差异逐项保留，wire主体不放宽；任何额外必要改动先报告而不默改生产。仅批准本批，无诊断A2、canonical消费者迁移、生产、版本、build、GUI或Git授权。

主线导入窄修批准：首批GaeSUw在wire模块初始化失败，0功能用例完成，2–8未运行。主线在desktop目录实际检查：绝对目录NodeSet与bare-import NodeSet不相等，grammar仅instanceof后者；bare解析至dist/index.js。首次从仓库根运行检查因根无该直接依赖而模块不存在，随后在实际desktop消费目录确认，不混作功能回归。现仅批准新临时目录将Lezer/CodeMirror绝对目录导入统一为同包dist/index.js，算法、instanceof保护、oracle、八组预算均不变；冻结旧失败，重新首跑仍首红停。不是放宽生产wire或认可未运行用例。

### 八组贯穿首跑冻结：导入阶段失败，尚未取得结构结果

目录 `/tmp/agentic-f046a-chain.GaeSUw`；`model.ts` 为常量scanner及分片根组合候选，`group.ts` / `run.ts` 为八组驱动，`oracle.ts` 保留前批完整手写节点数组。`bom-shadow.ts` / `wire-shadow.ts` / `async-shadow.ts` 仅重定向依赖、grammar/profile或背景资格入口，差异分别冻结为三份 `*-shadow.diff`；`profile-shadow.ts` 使用实验标记，`background-shadow.ts` 仅对固定小样本返回true。工厂仍调用真实 `createRawEditorState(..., ..., true)`，用高优先级Language接线，不复制工厂。

首跑前两轴早审指出scanner闭行检测后尚未建原子却提前报告B，作者在首跑前增加实际atomic构造状态，未删除checking进度强断言；同时补正文heading非空及定义集合、完整手写树、stop结果和真实工厂fault断言。这些是草稿审查修正，不冒称运行失败或修复实证。

执行 `bun /tmp/agentic-f046a-chain.GaeSUw/run.ts`，原输出 `first.jsonl` / `first.stderr`。第1组子进程在导入 `wire-shadow.ts:18` 时抛 `CommonMark node set unavailable`，子进程exit1、timeout=false，stdout为空，尚未执行第一fixture。驱动按首红停止，明确未运行 `[2,3,4,5,6,7,8]`；不是八组解析失败，更不是结构、CM或wire已通过。外层读取日志用tail，shell最终状态0不作为驱动成功：日志已记录实际子进程失败和停止。

只读核查见公开包 `@lezer/common@1.5.3` 同时提供main=`dist/index.cjs`与import export=`dist/index.js`；实验用绝对包目录导入，实际生产用包名导入。模块身份/入口差异是待核候选原因，当前没有运行定位证据，不直接认定根因。wire的nodeSet instanceof保护原样保留，不通过删保护或换鸭子类型绕过失败。目录与输出冻结；后续依赖入口窄修须主线另批，当前不改算法重跑。

实际正文增量、BOM/CM、partial恢复、异步旧结果和真实消费者等本批预期结论均未取得。前14组有限模型证据仍保持，但不可替代本次真实链路。无生产、依赖安装、版本、构建、GUI或Git操作，尚不可批准F-046a生产。

只读路径定位补充：`Bun.resolveSync('@lezer/common', apps/desktop/src/client)` 实际返回仓库 `.bun/@lezer+common@1.5.3/node_modules/@lezer/common/dist/index.js`；同函数解析实验的绝对包目录实际返回同包 `dist/index.cjs`。因此入口差异已有直接resolve证据，尚未用修正后的初始化验证因果。拟在新目录将临时绝对依赖目录显式指向公开ESM入口 `/dist/index.js`，保持所有实例身份保护、模型、oracle及预算原样，再按同八组首红停；旧目录不改，当前等待主线对此import-only修正执行批准。

### 八组ESM入口窄修首跑收据（候选，待独立复跑）

经主线import-only批准，新目录 `/tmp/agentic-f046a-chain-esm.qG1fLT` 将临时Lezer/CodeMirror绝对包目录仅改为该包公开ESM `/dist/index.js`，`import-only.diff` 保留差异；模型、实例保护、手写oracle和预算均未改。旧 `/tmp/agentic-f046a-chain.GaeSUw` 初始化失败完整保留。执行 `bun /tmp/agentic-f046a-chain-esm.qG1fLT/run.ts`，`first.jsonl` / `first.stderr` 冻结：八组子进程均exit0、timeout=false，整批exit0，stderr空。初始化保护此次通过，不能把旧CJS/ESM失败说成Frontmatter算法失败。

| 组 | 实际结果与证据边界 |
| --- | --- |
| 1 | 01/03完整树符合前批手写oracle；06/07无闭合回退与旧解析树全等。scanner闭合检测后仍不冒语法进度；原子构造后才推进 |
| 2 | 15/16手写完整树、原子首child及无内部伪Markdown通过；真实calloutDefinitions分别仅OTHER/OUTSIDE；真实CM工厂headingStructure恰有一正文标题且位置为73/28。fragment入口01仍等于旧Markdown |
| 3 | BOM加三EOL经过真实raw工厂及BomAware影子，raw原样；CM中Frontmatter[1,13]、H1[14,20]符合独立预期。未测试BOM编辑后fragments复用 |
| 4 | stop2/6/13均保持stoppedAt原值，组合树固定Document[0,13]与FM[0,12]；非0/有缝ranges与旧树全等。真实CM是否发这些ranges及缓存资格仍未证明 |
| 5 | 原15全文append正文后，真实TreeFragment更新，header reuse=true且scanReads=0；新旧根children有2个相同对象（新FM不复用，因此为正文子树/缓冲复用证据），不只是传入fragments。闭分隔行改动后回退树与旧parser全等；非大文档成本结论 |
| 6 | stop2结果通过真实addTree(partial=true)后不复用完整证明，再算全文正确；完整树wire解码后再append正文，实测decodedReuse=false，仍要扫描。BOM身份丢失的复用成本未测，不以此断言替代 |
| 7 | 同静态nodeSet与profile影子wire对01/15编码解码节点全等，错误grammar与未知NodeProp确实拒绝；wire主体保护未删。具体大TreeBuffer矩阵未单独构造 |
| 8 | 真实createRawEditorState的高优先级Language接线可用，编辑首开行后旧FM不发布；真实GuardedParser在实际工厂ParseContext中把异常记录到原fault session。Async影子仅重定向imports/实验低阈值，小样本模拟Worker先回旧闭合请求、再回修改后的absent请求，started=2/completed=2/staleDiscarded=1，最终树与前景absent树相同。并非真实Worker/WK；新闭合FM结果首次被后台接受的路径本组未单独验证 |

日志`total`仅计薄驱动显式调用parse的advance，组3为0不表示CM未解析；候选model内部另有每parse2048/整组8192强保护，涵盖实际工厂及模拟后台调用，宿主组15秒/整批180秒同时保持。原parser同步oracle受宿主监督，不宣称其内部每步或最终Tree构造CPU硬有界。组合顶层数组仍O(children)，本轮仅固定小样本，不冒性能验收。

目前结论是公开单nodeSet原子组合路线取得有限真实链路可行证据；尚不可直接迁生产。解码后首部proof重建/缓存、BOM后身份与fragment资格仍须在正式最小方案明确，不能常态每键重扫大首部；canonical编辑/旧阅读的消费者分派及按需诊断A2仍为已列必要前置，未在本批执行。无需再为了同一已证接口重复层层模型；下一由主线结合双轴复跑决定最小剩余适配/诊断批或typed方案，不自行扩大实验、改生产或关闭父项。

### 八组复跑结论与typed最小接入候选（仅方案）

主线复跑 `/tmp/f046a-chain-root.jsonl`、Spec `/tmp/f046a-spec-chain-esm.jsonl`、Standards `/tmp/f046a-chain-standards-replay.jsonl` 均八组exit0、无timeout，主线stderr空。仅批准继续收敛方案，以下不是实现或实验执行收据。前批所有失败、未测和unknown保持。

#### 1. 原子扩展与最小typed边界

由单个第一方 `FrontmatterExtension` 声明静态Lezer节点/完整文档Parser、canonical扩展配置和版本身份；preset注册原子扩展，局部Markdown入口显式采用fragment资格。接口只区分 `document` / `fragment`，不建立通用插件注册器，不在调用处用正则做视觉伪装。全文链路仍Guarded→Async→BomAware→document；fragment保留原Markdown，不共享全文parse-context或缓存。

结构任务使用判别联合：checking、closed（原子范围/闭行EOL边界）、absent、unsupported。closed是“当前首部闭合”的正向证明，不等于全文已解析；absent不能由partial尾推断。没有任何诊断结果参与Markdown节点判定。当前弱类型临时model及events数组不可原样迁生产。

最小文件边界：新增原子扩展/完整文档Parser和诊断owner模块；调整现有grammar/profile及document/fragment显式调用点；canonical按用途分派；接入已有typed fold元数据与编辑呈现。raw/history/save、解析任务治理框架、阅读窗口和既有wire安全主体不重构。正式实现文件列表与最后接线测试须在本批前置通过后由主线全文批准，不在此先写代码。

#### 2. decoded/BOM根级正向证明重建

不再把WeakMap是否命中当闭合资格。仅接受固定当前profile的可信生产Tree或经现有严格wire解码得到的Tree；检查根type和首个直接child的type均为**同一静态nodeSet的确切类型对象**，不是节点名字相同即可。首child必须原子Frontmatter、无children，根位置/长度合法；不遍历全树，不复制正文children来寻找proof。未知来源、错误profile、其他nodeSet或结构不符均不恢复证明。

对每个候选TreeFragment按公开 `treePos = documentPos + offset` 映射：原子起点减offset须等于当前document入口的0。普通树位置0/offset0；经BomAware去BOM投影的旧树位置1/offset1可成立，不通过无条件减1猜测。该fragment必须从当前0起连续覆盖完整原子与闭行EOL，且有**闭行后至少一个受保护单位**；`openStart` 不可为true。在新Input原子末处只读最多两个单位判别LF/CRLF/CR及B边界，并核fragment.to覆盖guard。闭行EOL或guard被修改导致切口时不复用。引用/容器、片段和未闭合原文不可能凭这个正向形状成为closed。

停止在B的树没有后续guard，拒绝恢复；不能因其长度跨过扫描点就当完整树。若部分树确实包含原子、完整EOL和仍受fragment保护的后继单位，可仅恢复“首块closed”，仍不宣称全文完成，正文继续按partial解析。这是比早期“仅完整树WeakMap”更窄而可传输的语法证明，须新样本明确验证，不能默改旧partial oracle。仅Frontmatter且EOF闭合的树暂不做这个跨身份复用优化；编辑其内容本来须重算，首次追加正文允许重新扫描，不声称所有形态零重扫。

复用只恢复F/B数值和可信原子child，不添加新NodeProp或wire元数据。正文仍将合格完整组合树fragments交同静态MarkdownParser，以现有公开复用规则处理；完整根映射、BOM的offset+1、编辑闭行导致B变化都须对照冷解析树与实际子树/输入工作。若不能保住常见正文编辑的首部及正文增量，报告必要缺口，不用“以后优化”放行。根child重组合仍O(children)分片，不承诺常量总成本；失效大首部的首次扫描成本在同批A2观察。

#### 3. ranges契约：不发布语义不同的伪成功树

document入口只接受覆盖当前完整Input的单一range（经BomAware正常投影后仍满足）。非0或有缝ranges不再按旧八组临时模型委托普通Markdown然后冒充新profile；改为显式unsupported错误，交既有GuardedParser记录故障和安全源码降级，保留原文，不自动重试相同错误形成循环。fragment入口明确不识别Frontmatter，可继续支持原Markdown公开ranges；本地语法工具必须使用该入口。

这样没有不兼容的普通Markdown树进入document缓存：失败仅产生既有故障路径的none树，不能恢复Frontmatter证明或冒称syntax可用；安全降级时既有清理负责撤掉派生折叠。正常CM创建、正文编辑、跨标签解析恢复、stopAt/viewport、模拟后台首次接受等请求须实际记录ranges。若真实正常路由发非full请求且因此频繁降级，则本契约不能认为可用，整批报告路线红；不为了绿扩展混合parser通用ranges语义，也不隐藏用户可见回退。

#### 4. canonical用途分派与按需诊断

canonical入口拟用明确用途联合 `editing-semantic` / `reading-legacy`，各自固定profile；同次请求只选一个。前者注册官方frontmatter/mdast扩展并保留原子yaml节点，图片摘要、编辑代码复制等不得把YAML内定义/围栏当来源；callout定义摘要与其同代语义一致。后者保持原树及实际阅读SSR/可见查找输入，不预定阅读隐藏或显示。局部inline/list/quote格式工具仍走fragment Markdown。调用用途、profile、document身份/内容代进入已有各自owner票据，不能跨用途复用缓存；选择/滚动/模式切换不触发新增同步全文canonical解析。测试须调用实际输出消费者，而非两个路由都返回旧parser的identity自证。

诊断是只对可靠闭合区块按需执行的独立Worker任务，不做YAML数据转换。候选固定 `yaml@2.9.0` 的公开parseDocument，`prettyErrors:false`、`logLevel:'silent'`，不自定义tag函数，不调用toJS/toJSON/alias.resolve/stringify；errors只投影固定中文类别与合法范围，原message/source不泄漏日志。未知tag、重复键、深层结构、锚点别名只当语法，不执行或联网。

typed结果区分ready（含errors/warnings有限投影）、unavailable、pending；只有真实完成且无errors才能显示未发现语法错误，取消/预算外不能报正确。票据绑定document/content代与块身份/profile；正文外编辑仅在结构证明同一首部且变更区间不相交时复用，不为比较每键全文hash。只发送当前首部一次，单在途/单最新待处理；IME期间不派发，结束后派最新。宿主terminate旧worker后释放引用，旧回调即使到达也拒绝；同步YAML不能靠worker内部timer取消。计入区块提取/发送/parse/错误投影各阶段成本，不只报parse毫秒。正式预算参数由此次有限证据收敛，不预置产品性能门槛。

#### 5. 下一批合并前置验证范围（计划，待主线批准）

一个新mktemp目录/薄驱动，最多10组，每组首跑一次、宿主15秒/整批180秒，首红停并保留未运行组。只在实验目录引用或固定registry安装 `micromark-extension-frontmatter@2.0.0`、`mdast-util-frontmatter@2.0.1`、`yaml@2.9.0`；不安装到生产。结构scanner实验256单位/advance、组合16孩子/advance，每parse8192、每组16384上限；修改这些实验参数是为同批最多1MiB首部，不是撤销宿主监督或宣称原parser步长硬有界。所有冷解析oracle仍受同子进程时限。

| 组 | 固定输入与必答问题 |
| --- | --- |
| 1 | 原01/15，LF与BOM-LF各一：parse→真实wire decode→实际fragments正文append，断言恢复closed且scan0、树同冷解析；记录正文公开子树复用，不以传入fragments代替证据 |
| 2 | 原01的BOM-CRLF/BOM-CR经真实CM规范化，正文append；另固定开行、闭行、闭行EOL三处变更，证明offset映射与guard失效。原文保真及节点独立坐标同时断言 |
| 3 | 原01 stop2所得树、body内停止所得树、仅FM到EOF三个场景：前者不恢复，中者只恢复受保护首块不冒全文，EOF保守重扫。另错误profile/nodeSet/原子非首child各一拒绝，不接受节点名伪装 |
| 4 | 实际工厂创建/一次正文编辑/解析暂停恢复/stop请求及小样本模拟Async首次闭合FM接受，记录每次document ranges；closed后台树与前景完全一致。显式非0/gap请求各一走实际Guarded fault，确认不发布普通Markdown伪树；正常路由触发unsupported即红 |
| 5 | 原15/16与原01（总3文档）真实新editing canonical及image摘要/代码复制/callout定义消费者一致，旧reading SSR与查找输入对原生产baseline全等；YAML内definition不污染新编辑，正文外定义仍有效。无法调用的真实消费者明确unknown并作为接入前缺证，不能只跑identity路由 |
| 6 | 两用途两文档固定交错请求，复用现有owner或最小import影子验证profile/文档/内容代拒旧与用途隔离；仅纯票据模型不足则报告具体未接线，不伪称生产缓存完成 |
| 7 | 6个小YAML：普通、语法错、重复键、未知tag、锚点alias、含文档结束...；固定安全选项，原文不改、正文可解析、错误范围合法且不输出字段值；不调用值转换证明alias不展开 |
| 8 | 4个成本样本：64KiB闭合普通首部、1MiB闭合单scalar、64KiB未闭合Markdown、深度256嵌套小YAML。每样本一次，结构/提取/parse/投影分段记录；超时保留红，不能缩小同样本凑绿，非RSS/WK结论 |
| 9 | 固定诊断owner时序：首部内改动旧结果、正文外改动复用、IME pending、取消后晚到、抛错与宿主终止。真实Worker或现有Worker机制影子，若只用mock则明确不能证明终止/释放；不得把父进程结束冒称全部资源已释放 |
| 10 | 实际CM与官方foldState最小Frontmatter kind接线：编辑可折/源码完整再回编辑展开；标题和代码折叠保留、只读可折、搜索选区自动展开、old Text拒绝、safe清理。仅临时适配，不改产品入口，无法无侵入接入时如实报告前置而非扩大模块复制 |

本批目的不是完成全产品或所有未来窗口，而是一次回答已剩生产前置能否收敛。若缓存/ranges/语义分派无法成立，停在具体路线红；若仅固定小矩阵成立、诊断预算外路径可明确退化，则收敛typed生产方案和实现后测试，由主线批准。诊断不可用不得阻碍编辑/保存；但未测安全成本不可直接宣称可靠诊断。折叠生命周期仍须最终生产回归和真实WK，由主线后续打包验收。当前只有方案，无新临时目录/依赖/代码/版本/构建或执行。

### 主线合并10组前置执行批准

主线全文读取typed候选与10组，并读取官方yaml公开parseDocument/Options/Errors文档；独立Spec/Standards均0必要实验路线阻断。批准按上述固定新目录、样本和预算执行，正式生产仍未批准。冻结时将guard条件写为半开区间精确断言：受保护范围须包含闭行完整终止及B处至少一单位，不能把to=B当覆盖B。BOM offset与partial单独核对；nonfull正常宿主触发即红。

YAML只提取开行EOL后到闭分隔行起点之前的内容，errors.pos据该起点回映；不把闭合---传入parseDocument。固定ASCII成本样本并记录UTF-8/UTF-16实长，冷解析重复计预算。仅受控code/范围输出，prettyErrors关闭不视为message无敏感值，maxAliasCount不冒解析CPU保护。所有Worker在成功、异常及超时分支清理；无法证明释放就如实保留，不以父驱动退出替代。首红停、不改同样本凑绿；缺依赖/接线失败保留后报告，不改生产或预算。

主线第10组接线窄修批准：主线及独立两轴复跑Ndphxa均1–9通过、10在EditorState.appendConfig.of处失败，无timeout；root日志`/tmp/f046a-prereq-root.jsonl`、Spec`/tmp/f046a-spec-prereq-first.jsonl`、Standards`/tmp/f046a-prereq-standards-replay.jsonl`。主线已查安装版本公开声明，appendConfig属于StateEffect。批准新目录仅修该import/调用，单独首跑固定第10组并保留15秒宿主监督，模型/前9组/预算不改，无新生产或性能重跑。旧只读/oldText/safe未到达不能预写通过。前9组诊断总计时、正文外复用恒等、hold空闲终止和输出未限额等限制全部保留，候选不可直接迁生产。
