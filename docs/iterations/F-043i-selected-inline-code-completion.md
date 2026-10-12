# F-043i：反引号输入包裹非空选区

> 状态：alpha.124 非离线有限片受托Agent代验通过，非用户亲验；Git 待执行。
> 日期：2026-10-12

<!-- obligations: OBL-058 -->
<!-- deferred-obligations: none -->

## 功能说明

最终独立 Spec / Standards 补证复核均0剩余必要阻断，主线正式批准本片有限非离线交付。源码初次965/27776、包内Bun仓库965/27775、最终源码复跑965/27775/23.91s分别保留，不推断计数差异原因。真实窗口/组合转换路径、取消需undo恢复所选原文、自然IME和其它未实测限制见下方；完整父/E-05/OBL-058/064及offline-final保持开放。未保存用户正文，两自建fixture原样、644、正常退出；下方待验收/缺口记录为过程历史。

依据能力总账 E-05 与2026-08-25决定：明确意图时自动补齐行内代码，选区允许包裹，触发输入与自动插入应一次撤销。F-042a/b 为显式格式命令，F-043b 为五类括号/引号配对，均未覆盖本行为。

本片普通编辑/普通源码中，选择非空、同物理行、可靠合法正文后输入一个反引号，以足够长度的反引号和必要 padding 包裹为行内代码，代码解析值必须等于原选中文字。只包裹，不调用 toggle 解包已有代码；内部选区方向保留。源码多范围全部满足才一次事务包裹；混合空范围或不支持范围不部分执行。不能补齐时返回原输入处理，不能为无补齐吞掉正常输入。

不增加空光标配对、闭反引号跳过、跨行包裹、代码围栏内部 Enter、强调/链接自动补齐。已有代码、围栏/HTML/结构边界、受保护长行、不完整解析等按现有保守格式资格排除；普通原输入仍可编辑，不把“无自动包裹”误写为禁止用户输入。阅读/只读/安全源码/IME不新增该自动补齐。编辑仍单选区，源码保留已有多范围能力。

## 最小技术方案

先核本地固定版本公开 CodeMirror inputHandler 与已有 pairing/inline-format 实现，以隔离实验明确有选区时输入路由与单次原文事务。复用现有行内代码规划与公开 Lezer 局部语义验证（canonical parser只作测试oracle），通过明确 wrap-only 语义拒绝解包，不复制另一套 Markdown 引擎，也不把生成的事务再转字符串二次派发。规划无副作用，执行前核当前 view/state、权限/模式/冻结/IME 与输入 from/to；旧意图拒绝。不借用 native 菜单票据或面板失焦豁免，不改已有五类配对与显式命令行为。

若复用规划器必须改变显式命令语义、扩展全局扫描或引入新解析引擎，先停止相关实现并报告。沿公开扩展接线，选区所有范围整体计划/验证成功才单次派发；与原生组合输入分离，防重复执行。未支持情况原路回退。

## 最小 happy path 与边界验证

- 自动：普通/反向选区、内部反引号及首尾空格的语义与 padding；源码多范围全成功与混合拒绝；单次 undo/redo 原文、CRLF/BOM；空光标/跨行/已有代码/围栏/结构/保护长行/不完整树；IME/只读/旧view及from/to不符；显式 toggle 和原五类配对回归。
- 真实 WK：普通编辑及源码选中文字后输入反引号，切源码核原文/选区；一次撤销、跨标签与模式保持；无选区原输入/已有代码不解包；工具组合输入避让、只读/安全源码边界；所有临时修改撤回、正常退出、fixture hash不变。
- 源码多范围若工具不能稳定建立，使用已公开命令入口并先核选区；不以多次单光标冒称多范围。实际矩阵与自动证据分列，不把自然键盘IME或全部主题/性能边界宣称已验。

## 继承约束与义务

F-006统一入口及F-014原文历史/IME、F-042a语义规划、F-043b公开输入入口和F-044b多范围已具备。局部承接OBL-058，OBL-064协作且主责不迁移；完整E-05/F-043与义务保持开放。F-002本地内存、不自动保存或网络请求，`F-043i-offline-final`留最终统一人工，不断网。中文无新增独立UI；既有主题/安全降级和权限不能绕过。

每个代码重打包递增alpha；先独立方案/实现后两轴评审、自动检查和真实WK代验，再最终独立复核/主线结论，之后才提交推送。非TDD，不预设性能门槛。

- 中文与外观：沿既有编辑器渲染，不新增独立按钮文案；中文/emoji选区原文与既有主题保持。
- 命令与键盘：复用已注册公开输入处理与当前文档守卫，不增加全局快捷键或拖动；输入法优先。
- 安全与日志：不新增磁盘写入、外部资源请求或正文日志；安全源码/权限隔离保持，测试仅临时fixture。

## 方案核对与有限实验批准

独立Spec确认E-05明确授权本片，0执行路线阻断。主线批准仅临时目录公开入口PoC，验证多range主from/to、反向选区与代码值/padding、单事务raw/history和fallback；尚未批准生产接线。不支持时整体返回原输入处理，可能按原编辑器行为替换选区，不能宣称原文字不变。先行文档检查两次失败分别为OBL-058缺反向链接及继承清单标签缺失，已补齐，不作为生产代码失败。

前轮F-042b已实际提交推送`bc3e6a429f4fcc3109554d82131e3e58c77d959c`，远端main同SHA，开始本文件前工作树干净。

## 有限公开入口实验

隔离目录`/tmp/agentic-f043i-poc.FOfTXk`保存planner.ts、driver.ts、run-final.log；32组通过，主线all复跑exit0记录main-rerun.log。24组普通/源码、正反范围及反引号/首尾空格/全空格payload，1组多范围mainIndex，6组fallback，1组前后普通input.type与wrap自身full历史隔离；代码值由canonical测试oracle核对，BOM/CRLF保真。主选区from/to经公开inputHandler facet受控调用，多范围一次dispatch。未使用真实DOM输入，生产view/session/controller接线与真实WK仍待验证。

前三次失败日志保留：临时目录模块入口互操作改为安装的精确ESM路径；fake view dispatch被undo解构后this未绑定改为闭包；段落首结构缩进空格被既有规划器拒绝，最终改在段落内START之后验证padding，不扩为结构缩进支持。实验为避免toggle先独立扫描InlineCode，仅用于验证，生产必须在原规划器内明确wrap-only，不复制该预扫描。fallback harness会继续派发默认输入，不能据其声称readonly/IME/focus整链安全，只证明新handler不接管。

主线读回与复跑通过；独立Spec另复跑32组通过、有限生产路线0必要阻断。主线批准窄生产接线：原规划器明确wrap-only、缓存区分意图，不改默认toggle；既有pairing公开入口新增反引号分支，精确state/session/controller守卫及一次input.type/full历史隔离。原生菜单、旧配对与其它补齐规则不变。实验通过不替代生产或WK验收。

## 生产候选冻结与自动验证

三生产文件为contextual-pairing.ts、inline-format.ts、memory-editor.tsx，新增selected-code-input.test.ts六组；wrap-only缓存区分，新严格第三guard不改变旧配对资格，旧注册cleanup不能删新注册。executor定向39项/573断言/5文件/196ms；测试unused参数lint一次失败已移除无用参数，type与专项lint最终绿。

主线源码全量965项/27776断言/154文件/23.52秒通过（`/tmp/agentic-f043i-full.log`），typecheck与全量lint通过（同前缀type/lint.log），文档/义务/diff检查通过。独立Spec与Standards代码两轴各0必要阻断、各复跑26项/498断言/5文件；受控fallback并非正文不变，真实WK仍待验证。现升alpha.124打包，尚未实际验收，不得Git。

## alpha.124 构建与连接

### 最新真实窗口证据（覆盖下方连接阻塞检查点）

最终复核第一轮两轴均0代码阻断，但共同指出上述最小计划的组合避让证据缺口；主线未豁免。再次启动同包exec86365/Bun11669补验：选择A普通源码Alpha行，切换输入源，第二次ctrl+space后按n明确见蓝色marked-text下划线及相关命令禁用。此时按物理grave，输入法提交为“你·”，未自动包裹、无重复字符，组合结束命令恢复；一次undo回原文clean。再次n进入组合，Esc后临时正文该选中行为空（取消不自动恢复原选中文字），再一次undo恢复原文clean。两次均未保存；⌘Q正常退出并核11669消失、两SHA原样。此为本机工具驱动组合/物理grave路径，输入法输出中点而非字面反引号，不冒称组合中实际提交ASCII反引号或自然物理键盘全矩阵。此前普通n未组合的失败记录保留。主线全量再次复跑记录`/tmp/agentic-f043i-final-tests.log`，供最终复核读回。

用户正常退出后主线核旧 Bun9514 与匹配进程均消失，重启同一副本 exec44997/Bun10870，未改代码或重打包。CUA 恢复欢迎页及实际窗口操作，不据此归因此前超时。通过原生选择器打开 retry.MxGv3d 的自建 A/B，未保存正文。

- 普通源码与编辑模式选择 Alpha plain text. 后按 grave 均得到单反引号包裹；切源码核原文与内部选区。单次撤销回干净原文，重做恢复包裹（redo 实际选中含定界符范围，不声称始终保持内部范围）。首次当前输入源的 grave 产生中点并替换选区，不是反引号功能测试；撤销后 ctrl+space，实际反引号输入才计入验证。
- 内含反引号的 a`b 选区产生双反引号定界符；切 B 再切 A 一次撤销回原文与原选区。选中段内首尾各一空格的 padded 得到定界符内各两空格，内部选区保持原文字，语义 padding 与自动 oracle 证据互补。
- 既有代码内部 existing code 选区输入反引号，走原输入替换为三个连续反引号，不自动解包；空光标仅插入一个反引号。分别撤销恢复干净。
- B 临时粘贴 AAA/BBB 两行，公开添加下方光标并 Shift+Home 建立两个非空选区，截图先核两处高亮。一次 grave 两行均包裹，一次 undo 两行同时恢复，第二次 undo 恢复磁盘基线。首次建立的混合空/非空选区未输入，重建后才验；包裹后 AX 汇总 Value 截断，但逐行 AX 与截图均确认两行完整定界符，不冒称汇总文本可靠。
- B 临时权限444，切标签后实际显示只读，选中正文按 grave 无修改且 clean；恢复644。随后解析故障实验降级安全源码，选中正文按 grave 仅按普通输入替换成单反引号、无自动包裹；undo 恢复 clean。
- 输入源切回后按 n，仅见普通 n，无候选窗或明确 marked-text 下划线，不能算真实组合输入验证。Esc/undo 清理；自然 IME 与组合中 grave 路径仍未实测，依自动 guard 证据但不冒称已覆盖。未新增主题UI，本次仅深色，浅色/全键盘/跨行及全部保护拒绝矩阵未逐项实操。
- 两标签最终均 clean，⌘Q 正常退出（工具 App quit），随后核 Bun10870 不存在；A/B SHA256 与预建值完全一致、权限均644。未保存用户正文、未断网。候选待独立最终复核，完整父/OBL 与 offline-final 保持开放。

本次恢复现场第三次：重建CUA会话后间隔30秒，规范/private/tmp路径仍timeoutReached，无AX/截图。用户解锁已确认；现仅请求用户正常退出App后通知，供核退后重开，不强杀、不推断根因，不提交。

最新重试：用户明确已解锁。主线核Bun66249不存在、CUA inventory App未运行，原/tmp副本/fixture/隔离data均不存在，不推原因。仓库原产物plist alpha.124与metadata hash373qbh3rsoznc仍匹配，ditto到`/tmp/agentic-f043i-retry.MxGv3d/Agentic Markdown-canary.app`并以新隔离data/fault lab启动exec3225/Bun9514；未改源码/版本或重打包。展开version.json一致，新同名A/B内容哈希与下方原fixture完全一致。首次及间隔20秒第二次CUA连接仍timeoutReached，无AX/截图，未打开/保存fixture。已知解锁，不重复询问；仍未真实验收、不得Git。旧临时日志当前是否存在未逐项核，不把历史日志路径当作当前必然可读。

第四次再间隔30秒后精确App路径仍timeoutReached，无新AX/截图。当前停在真实桌面连接步骤，用户窗口/解锁回复待收到；保留Bun66249运行和未验收状态，未提交本片。

包内Bun运行仓库965项/27775断言/154文件/21.86秒通过（`/tmp/agentic-f043i-package124-tests.log`），与源码断言计数相差1，保留实际数字，不推因、不称产物全部资源实测。CUA重建会话并再间隔30秒后第三次规范路径仍timeoutReached；无AX/截图、尚未通过App打开fixture。已异步询问用户当前窗口与解锁状态，保留现有进程，未真实验收/不得Git。

`AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary`成功，日志`/tmp/agentic-f043i-build124.log`，保留既有大chunk与hdiutil弃用警告。ditto副本`/tmp/agentic-markdown-alpha124.H9JnNp/Agentic Markdown-canary.app`，plist与展开version.json核alpha.124/hash373qbh3rsoznc。相同隔离HOME/fault lab启动exec80202 / Bun66249；首解压sandbox_extension警告后安装完成。首次CUA与间隔20秒精确App路径重连均timeoutReached，无AX/截图，不推因；保留进程、不重复启动或改网络，真实代验未开始。

预建fixture `/tmp/agentic-f043i-ui.OYGijO/wrap-a.md`（SHA256 `4ab6b767371d5866c5f0d50f3cb5a80c7d4fc0c4c436b838d07aeeba4c807bc7`）及wrap-b.md（`7b633701ea5e51222235fba6f5ac7887bc1311b59a813482019d4f4b694e4374`）尚未通过App打开或保存。
