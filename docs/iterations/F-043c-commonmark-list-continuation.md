# F-043c：CommonMark 列表续写基础

## 实际提交推送收据

2026-10-10 主线实际提交并推送 `376b2ab719288bdd401d823e0f0ddec62cce48ab`，远端 main 经 `ls-remote` 核验相同，核验时工作树干净；本条收据后续随文档提交，不预写其自身 Git 结果。下方 Git 待执行保留为此前历史。

## 正式结论：alpha.109 非离线本片通过（2026-10-10）

最终独立 Spec/Standards 均 0 剩余阻断，主线确认本片受托 Agent 代验通过，非用户亲验。Standards 最终定向 30 项 / 335 断言 / 198ms，文档/义务及 diff 检查通过。Git 待主线实际执行；父 F-043、完整 OBL-058/064 与 F-043c-offline-final 继续开放。下方候选结论、105—109 的失败与限制保留为历史，不扩称所有输入源、平台或竞态均已覆盖。

## alpha.109 最终包实际证据

清理后包 CFBundleVersion alpha.109，hash `22te7hij1rwc7`，路径 `/tmp/agentic-markdown-alpha109.AovLzc/Agentic Markdown-canary.app`；本次 exec72029 / PID85197。源码846项 / 20463断言 / 136文件 / 20.70s，包内 Bun 运行仓库测试846项 / 20464断言 / 136文件 / 21.35s，分别记录；日志 `/tmp/agentic-f043c-source109-tests.log`、`/tmp/agentic-f043c-packaged109-tests.log`、`/tmp/agentic-f043c-build109.log`。typecheck、完整 lint、文档/义务及 diff 检查通过。

alpha.109 真实 WK：源码 ime 的 n/i 候选→Return 仅 AAAni、原 CUA 单列表项断言 green；下一普通 Return 正常续 `- `，undo 两次回原。Shift+Return 后 paste CONT 得两空格 CONT，undo 两次回 clean。随后打开 readonly.md，只读编辑及源码的 Return/Shift+Return 均无改、保持 clean。

返回 clean ime，AAA 后 Return+NEW，再 readonly→ime→编辑，undo NEW/undo 新项、redo 新项/redo NEW 准确；再 undo 两次 clean。浅色设置首次 AX click+Escape 未应用，保留该失败；后用 combo Up+Return 确认浅色，截图内容可辨，AAA 后 Return 正常续 `- `，undo clean；恢复深色并 combo 回读确认。

两 clean 标签下 Cmd+Q 无确认、App quit，PID85197 消失；ime 与 readonly 的 SHA 均同原，全程未保存，输入源仍为中文。当前无 alpha.109 运行现场。以上是受托 Agent 真实工具路径，非用户自然键盘亲验；系统动态主题、任意跨结构选择、所有竞态及长期性能未实测，不扩称覆盖。经最终独立复核及主线确认，非离线本片通过，Git 待实际执行；父、完整义务与 offline-final 开放。下方构建中/待复验为历史。

## 最新：清理临时 IME 诊断，待 alpha.109 必要复验

按 diagnosing-bugs 收尾，仅以 apply_patch 移除本轮临时 composition/公开 view flags/is229/pre-handler 采集及逐事件摘要和对应新增测试；原 opt-in focus lab、原九类文档监听、128 条边界和选择摘要全部保留，三个诊断文件现与本轮基点一致。列表实现及版本未改。定向原焦点诊断与列表路由共9项 / 83断言 / 46ms 通过；主线后续 alpha.109 重新必要 smoke，不把 alpha.108 的实际证据直接当清理后新包验收。

本次根因闭环限定为已实测路径：新增 contentDOM capture 先于 CM 原有 IME 保护，在 compositionend 先于 Enter 时，公开即时 flags 已 false，误执行列表命令；迁移公开 DOM handler 后 CM 先处理该时序，alpha.108 原红断言转绿。另公开 handler 的 handled=true 会取消默认行为，因此候选分支必须不认领事件，权限拒绝的普通 Enter 才消费。没有私有状态读取或自造时间阈值；106完整23条摘要已留档，清理不删除失败历史，也不外推所有平台自然键盘。

## 最新：alpha.108 原 IME 红路径已复验通过，整片仍待验收

alpha.108 后段补证（不是 alpha.109）：嵌套 `+` Enter 保留 `+`，空项再 Enter 提升为父 `-`；undo 两次后 Shift+Enter、paste CONT，实际四空格 CONT 续行。9→10 样本显示四空格续行及子项，后项为11；手写1/7/12保持。一条中文 selectText“甲”后 Enter 落点异常，实际在7后空行，原因未知，保留而不声称修复；undo 后最小 ASCII `1. AAA` / `7. BBB` / `12. CCC` 选择 AAA 后 Enter 得 `1. AAA` / `2. ` / `7. BBB` / `12. CCC`。

混合 `- AAA\n\nPLAIN` 经 Cmd+Alt+Down 两次建立三光标，Enter+paste X 得 `- AAA\n- X\n\nX\nPLAIN\nX`；undo X、undo Enter、redo Enter，Escape+paste MAIN 仅末行 MAIN，补主范围路径证据。undo MAIN 后编辑→阅读，Enter/Shift+Enter 仍阅读、revision61，无编辑 DOM 且原内容保持。返回编辑注入解析故障进入 safe，AAA 后 Enter+SAFE 仅普通换行，无新列表标记。

随后 undo、Cmd+Q，坐标点击 Discard 正常退出；PID84122 已不存在，ime 磁盘 SHA 原样。包内 alpha.108 测试847项 / 20478断言 / 136文件 / 20.13s 通过，与源码20477断言分别记录。当前无 alpha.108 运行现场；alpha.109 清理包构建中，尚未验证，整片仍未验收。

主线 alpha.108 构建成功，hash `lg5wj2b0y604`，包 `/tmp/agentic-markdown-alpha108.ImOxhD/Agentic Markdown-canary.app`，CFBundleVersion 已核验 alpha.108；运行 exec77266 / PID84122。源码测试847项 / 20477断言 / 136文件 / 20.51s，typecheck、完整 lint、文档/义务及 diff 检查通过；包内测试仍运行，未预写结果。alpha.107 仅为此前构建成功、未启动的历史候选，不混用版本证据。

真实 WK 本次复验：`ime.md` 源码 n/i→Return 仅保留 `- AAAni` 一个列表项，原 CUA 红断言现为 green；再普通 Return 正常续写 `- `，undo 两次回 clean。n/i+Space 实际为“你”，随后 undo；n/i+Escape 回 clean。编辑模式 n/i→Return 无额外新项，之后普通 Enter 正常，undo 恢复。仅这些 native 工具实际路径，不扩大为所有自然物理输入或平台。

多光标：内存替换为 `1. AAA` / `2. BBB` / `3. CCC`，源码双光标经截图确认；n/i→Return 两行各插入 ni 而无新项，之后普通 Return 得 `1. AAAni` / `2. ` / `3. BBBni` / `4. ` / `5. CCC`，undo 两次。n/i+Escape 正文恢复原三项，但后续普通 Return 仅主光标插入，因此不声称 Escape 保留双范围，旧 F-044b 批量 Escape 限制保留。重新在 AAA 用 Cmd+Alt+Down 建立双光标，英文 Return+x 实际得 `1. AAA` / `2. x` / `3. BBB` / `4. x` / `5. CCC`。

当前 dirty 仅 Agent 自有 fixture 内存，未保存；其余验收仍待完成，整片未通过、不得 Git。下面105/106失败和107未启动记录保留为历史。

## 最新：alpha.106 已采到候选结束先于 Enter，待最小修复

独立 Spec 发现迁移后的 composing 分支不能返回 true：公开 handler 的 true 会由 CM 取消默认行为，旧直接函数断言不足以证明原生候选未被取消。已改该分支 false，不认领候选；补调用层 handled→preventDefault 语义测试，区分候选事件不取消与普通权限拒绝仍消费。修后定向 30 项 / 335 断言 / 206ms 通过，类型/lint 收尾中；此为受控语义证据而非真实 IME 验收。alpha.107 已构建成功（hash `2e5tmjtfgcm8r`），源码846/20470/21.34s，但未启动且不包含本次最终修正，不作为最终候选；下一包由主线递增 alpha.108。并行 lint 曾命中构建临时 `.cottontail-tmp` 生成文件而失败，构建结束后重跑，不改忽略规则。

最小修复源码候选已完成：普通 raw state 安装公开高优先 DOM handler，本片 capture 已移除；当前 view WeakMap 回调身份检查注销，统一命令与原 controller 门禁保留，未新增计时或私有字段，诊断保留。定向 29 项 / 328 断言 / 185ms 通过，typecheck 通过；首次专项 lint 报测试 import 分组空行，补齐后复跑。受控注册/注销/旧清理、权限拒绝与修饰键证据不代替真实 composition 时序复验；alpha.107 构建及原红环尚待主线。

alpha.106 实际退出：完整23条摘要读回并记录后，Cmd+Q→截图定位放弃，App quit，PID82552不存在；ime.md磁盘SHA256仍为 `99460fba9d87d4d01624c3f1264f94643e9ff459f0eebca081327718250ee3fc`，没有保存。当前无运行现场。摘要完整不等于旧JSON全部字段已导出；未读扩展字段不补造。

主线批准的最小修复方案：独立 Spec 与 executor 分别核对本机 CodeMirror 公开接口，选择 `Prec.high(EditorView.domEventHandlers({keydown}))`，移除本片 contentDOM capture。稳定扩展仅装普通 raw state，isolated 不装；按实际 view 的 WeakMap 注册当前生命周期回调，清理时核对 callback 身份，避免旧清理删新绑定。保持统一命令与活动文档/权限/焦点/模式/冻结/IME即时门禁，普通权限拒绝仍消费 Enter 避免默认写入；非目标模式/修饰键原路由。处理器返回 handled，由 CM 负责 preventDefault，不自行全局 stop 或添加定时器/私有状态。先仅迁移事件入口，保留 opt-in 诊断以实际比较；源码受控回归验证注册/注销/旧目标/模式/修饰键及权限拒绝，但必须 alpha.107 同一最小 native 红环、正常 Enter/ShiftEnter、多光标和历史实际复验后才判断修复。旧105/106失败证据保留，整片未验收。

仅诊断包 alpha.106（hash `3smk8pgzthngd`、CFBundleVersion 核验一致），路径 `/tmp/agentic-markdown-alpha106.5PID6e/Agentic Markdown-canary.app`，exec45847/PID82552；构建日志 `/tmp/agentic-f043c-build106.log`，源码845/20456/136文件20.98s，日志 `/tmp/agentic-f043c-source106-tests.log`，typecheck/lint/docs通过。独立诊断 Spec/Standards 7/64通过，不等于修复。

打开独立合成 `ime.md`（6字节，SHA256 `99460fba9d87d4d01624c3f1264f94643e9ff459f0eebca081327718250ee3fc`），源码 AAA 后 n/i 候选→Return 再次 `- AAAni\n- `。停止后完整读回本次23条紧凑摘要（不是105旧trace）：目标/活动均editor:1、focus=true，直到末尾lab操作；以下布尔顺序为view.composing/compositionStarted。

| seq | ms | 事件 | eventIME / viewIME / is229 |
| --- | --- | --- | --- |
| 1 | 7169 | focusin | 未采三字段，DOM同editor单范围 |
| 2 | 7201 | compositionstart | 未采 / false,false / 未采 |
| 3 | 7201 | compositionupdate | 未采 / false,true / 未采 |
| 4,5 | 7201,7202 | beforeinput,input insertCompositionText | true / false,true / 未采 |
| 6,7 | 7328,7341 | keydown,keyup Other | true / true,true / true,false |
| 8 | 7343 | compositionupdate | 未采 / true,true / 未采 |
| 9,10 | 7343,7344 | beforeinput,input insertCompositionText | true / true,true / 未采 |
| 11,12 | 7347,7349 | keydown,keyup Other | true / true,true / true,false |
| 13,14 | 11290,11291 | beforeinput,input Other | true / true,true / 未采 |
| 15,16 | 11294,11294 | beforeinput,input Other | true / true,true / 未采 |
| 17 | 11297 | compositionend | 未采 / true,true / 未采 |
| 18 | 11299 | keydown Enter | false / false,false / true |
| 19 | 11485 | keyup Enter | false / false,false / false |
| 20,21 | 17591,17591 | pointerdown,mousedown lab:2 | 活动editor:1；三字段未采 |
| 22 | 17591 | focusout editor:1 | 活动other:3；三字段未采 |
| 23 | 17640 | click lab:2 | 活动other:3；三字段未采 |

composition/key/input 均为 pre-handler，非事后终态。实际证明本次 native 工具路径 compositionend 比 Enter 早2ms，候选 guard 当前flags不足，Enter仍有229；不推断所有自然键盘/平台一样。当前新capture在CM原有composition保护之前，官方安装源码自身已有Safari事件倒序保护；先评估公开CM keymap/handler接入，禁止读私有pending字段或自造延时。内存dirty只含Agent测试、不保存，trace停止保留。整片仍未验收、不得Git。

## alpha.105 实际验收阻断与最小诊断方案

alpha.105 收尾：首次点击退出确认的 AX 元素失效，随后画面返回编辑器，原因未知；再次 Cmd+Q 后用截图定位“放弃变更”，App quit，PID80196 不存在、lists SHA256 仍为 `8ad3367fa5944833fb8abba4a579d22e74e91609f2372ab1168ea7367851fef7`。仅放弃 Agent 本次合成测试内容，未保存。trace23 未读部分随退出丢失，只保留上文/下文实际读取字段，不补造；当前无 alpha.105 运行现场。

构建成功，产物 `/tmp/agentic-markdown-alpha105.vw0Nfg/Agentic Markdown-canary.app`，CFBundleVersion alpha.105，hash `2ls2rhcf1gu82`；launcher exec56267 / Bun PID80196。包内 Bun 运行仓库测试 844/20443/136 文件/20.99s，日志 `/tmp/agentic-f043c-packaged105-tests.log`。这不代替 UI 验收。

真实 WK 局部通过：编辑 Enter 1/2/3→1/新2/3/4、undo clean、redo；空项退出；源码嵌套 `+` 续写和空项提升为父 `-`；Shift+Enter 四空格续行+CONT；8 后插入使9→10且续行/子项三空格→四空格，后10→11；手写7/12保持。源码双光标 AAA/BBB 后 Enter 再 x，出现2.x/4.x且后CCC变5；随后 x 的候选状态及 Enter 观察另列，不当作普通 ASCII 测试。以上均已撤销回 clean；未保存磁盘。

**新阻断**：已确认中文输入源（n/i 后 Space 实际提交“你”）；n/i 候选期间 Enter 在单光标及双光标出现额外列表项。主线最小化自己的临时 lists 内存为 `- AAA`，n/i→Return 得 `- AAAni\n- `；CUA 根据 AX 两个 `text (settable) - ` 节点执行断言，实际抛出 `F043c IME Enter added an extra list item`。原始及最小重复可复现，非推测。不能据此宣称自然物理键盘必然相同，亦不归因工具。

现有 opt-in trace 已停止、内存保留23条；仅部分已读：seq16 at24429 beforeinput Other/composing=true；seq18 at24434 keydown Enter/composing=false，editor target/active id1、trusted/hasFocus=true、prevented=false、修饰键全false；seq19 at24445 keyup Enter/composing=false；末seq23 at29525 lab click。未读条目不补造。capture prevented 不是最终处置；trusted 不证明自然键盘。当前临时文档 dirty，无用户正文改动，不保存。

诊断按 skill 分阶段：已有最小红断言；区分 compositionend→keydown 时序、新 capture 先于 CM 原有保护、工具与自然输入差异三假设。主线批准先仅扩展原 opt-in trace：compositionstart/update/end 类型、公开 view.composing/compositionStarted 布尔、固定 keyCode===229 布尔，标记 pre-handler；不读 data/正文/路径/私有 CM 状态，不影响事件，128条有界且停止后展示。用紧凑元数据摘要便于真实 UI 读取，不实时刷新。先实测顺序，再批准最小修复；该诊断不是正式功能或已修复。下一代码包必须递增 alpha.106。整片未验收、不得 Git，父及离线保持开放。

## 最新检查点：alpha.105 构建中，未验收

诊断源码增量已完成候选：仅 focus-trace.ts/test.ts 与 focus-trace-lab.tsx，新增三种 composition 类型、实际事件目标对应公开 EditorView flags、is229 和 pre-handler 标签，紧凑摘要停止后展示；contentDOM/ownerDocument 不匹配省略状态。默认 opt-in、128 条、无正文/路径/data、不阻止事件或改变列表路由保持。定向 7/64/28ms、typecheck 通过；首次新测试重复定义 fixture 已有不可配置 data getter 失败，删除重复测试定义后通过；后续 lint optional-chain 提示已机械修正。无实际新版采证，alpha.105 的23条仍只有前述部分字段被读取，不补造完整 trace 或根因。

主线修后全量 `bun test`：844 项 / 20443 断言 / 136 文件 / 21.08s，通过，日志 `/tmp/agentic-f043c-final-source-tests.log`；typecheck、完整 lint、文档/义务及 diff 检查通过。独立 Spec 修后 28/315/204ms、Standards 28/315/227ms 均无剩余代码阻断；这不是产品验收。主线已递增 `apps/desktop/package.json` 为 alpha.105，执行 `AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary`，日志 `/tmp/agentic-f043c-build105.log`；尚未确认构建成功或取得新包真实窗口证据，不得 Git。父、完整义务及 offline-final 保持开放。

## 2026-10-10 用户决定与最小生产方案（已批准实施）

用户确认：选择 1B，连续后项自动顺延；允许小型列表适配器。后续类似低成本技术选择优先较佳体验，但不据此扩展本轮任务/GFM、独立引用、结构 Backspace 或完整 Tab 缩进。主线完整读取后已批准实施，当前源码检查与独立核对进行中，未构建或验收；下方 PoC 待授权为此前历史。

### 一个局部结构模块、一次事务

复用当前生产 CommonMark 公开 syntaxTree/SyntaxNode 与 EditorState；不调用私有 getContext/renumberList，不复制解析器，不逐范围生成完整 State。以事务开始时同一 state 为唯一坐标系：先提取每个选择所需的 ListItem / OrderedList / BulletList 公开祖先、当前物理行标记及直接同级项，再汇总 ChangeSpec，最后仅一次 state.update；只读取受影响项及必要的连续同级后缀，不遍历全文。公开树未覆盖目标、保护长行或结构不确定时，该范围使用普通换行，不同步 ensure 全篇、不猜列表。普通范围与可识别列表范围可以混合，单个无结构范围不得使其他范围整批退化。

对选区先规划替换范围再保留合法列表前缀：非空选区仅在同一已识别列表项且没有跨越结构标记时续写；跨项/跨结构选区按普通换行替换，避免凭局部树重建多项。记录该保守边界，不宣称任意跨结构选择自动整理。source 多范围按 CM 已规范化顺序规划，保留主范围；编辑模式现有单范围不变。

### Enter、空项与软换行

实施前补充解析准入：可靠覆盖必须包含顺延所需的直接同级连续后缀及必要续行/子项边界，不仅是光标位置。若部分树可能截断同一列表，相关组回退普通换行，不同步强制解析全篇。

- 普通列表项 Enter 在光标处分为新项，保留无序符号、有序分隔符和所在层级；后半正文原样移动，不额外转换标点或段落。已有松散列表保留其必要分隔，不把所有列表改为松散。
- 当前项只有标记及空白时，Enter 去掉当前层：顶层退出列表；嵌套降一级形成父层同类项，保留已存在容器前缀。不能安全识别的复杂组合回退普通换行，不能删除未选中正文。
- Shift+Enter 不建立新项、不增减编号，只插入 soft break 及原列表项所需延续缩进/既有容器前缀；不插入两个尾空格或反斜杠，不当作 Markdown hard break。需用续输普通文字后的公开树验证仍属于原 ListItem，而不只断言换行字符。
- 本轮不主动续写任务标记、独立引用；嵌套列表的既有容器必须保真，否则保守回退，不悄悄删除 `>`。安全降级保持原输入行为。

### 同列表多范围与编号冲突

所有新项/退出项先形成语义操作表，按原坐标排序，按真实同一父 List 节点分组（嵌套列表独立）。连续性依据原始直接同级项的数值：后项恰为前项加一才属于同一连续段；手写跳号开启新段，不越过跳号重排。新项编号为所在项原编号加一，再加该连续段内之前插入/移除的净差；既有后项数字只应用它之前的净差一次，原分隔符/空格保留。多个光标在同项中按原位置依次产生新项并累计，不逐光标改完再重新解析。

空项退出对同层后缀贡献 -1；嵌套降级若产生父层新项，对父层贡献 +1，各组分别计算。先聚合每个列表的全部 delta，再按源顺序单次扫描有关连续后缀，以累计差更新；不得每个光标重复扫描同一后缀形成 ranges×items 开销。先收集全部正文替换及数字替换再检查区间：相同数字范围合并为唯一最终值；数字替换落在本次正文删除范围中时不另写；相邻插入按确定顺序合并。遇到不能无歧义归并的结构操作，相关冲突组整体回退普通换行，而不是提交相互覆盖的 changes；其他独立组不受影响。数字上溢 CommonMark 九位范围时保守回退该组，不生成失效十位标记。

数字位宽变化（例如 9→10）不能只换数字：保持标记后的合法间隔，同时按内容列变化调整该项已有显式缩进的续行/子项缩进，保持相对结构与原正文字符；空白行不无故写入，lazy continuation 不伪装为显式缩进。父子层的缩进变化先按包含关系累计，保证同一行只生成一次最终前缀替换，避免独立父子 edits 冲突。制表符以公开 CM 列宽工具计算，不能把 tab 当一个空格。结构或混合容器前缀无法可靠局部映射时回退相关组，保留原文；测试必须核对实际解析后子项/续行归属，而非仅数字输出。此局部保真不扩展为用户 Tab 缩进功能。

选择结果以每范围实际换行插入后的目标位置建立并经最终 ChangeSet 映射，不能把数字宽度变化当常量；纯数字重排不得移动未参与的文档状态。生成唯一 transaction，沿现有 rawText / controller / history 链路；不另维护正文副本或历史栈。

### 接线与保护

统一登记列表 Enter/Shift+Enter 命令，只在当前普通编辑/源码 view 局部路由，参考 F-044b 的 registry 和 IME 避让；不加入全局普通 Enter 捕获、不劫持树/设置/命令面板。实时核活动文档、view.hasFocus、canWrite、readonly、busy/frozen/inputBlocked、safe/fault 与 compositionStarted/composing。view 生命周期注册/清理，缓存 state 不捕获旧 controller/view；禁用或候选输入不执行适配，原 CM 输入继续由既有只读/冻结屏障保护。通过原 dispatcher 接受事务，不新建保存通道。源码多选区及 F-043b 配对不相互改写快捷键。

### 最小测试与交付边界

生产模块测试覆盖五类标记、行中/行尾、嵌套/空项、松散列表、Shift+Enter 后续文字树归属；连续后项/手写跳号、9→10 位宽变化、同项双光标/同列表双光标、嵌套不同层、插入与退出混合及冲突回退。全部断言精确全文、主范围及最终选区；BOM/混合行尾/emoji保持、单次 undo/redo、非目标数字不变。定向验证一次目标事务，读取范围限于有关结构，不建立固定性能门槛。解析未就绪/保护区域、只读/冻结/安全模式、IME/旧 view 为接线回归，受控测试不冒充自然输入。

主线负责 alpha 递增、打包与真实 WK；实际编辑/源码输入、混合范围、历史、模式标签往返、主题、只读/安全及自然 IME、退出和磁盘未改仍需验收。完整 OBL-058 / OBL-064、任务范围、父项与 F-043c-offline-final 不因此关闭。主线批准本节后才实现；若需要超出此局部算法或无法可靠合并，先回报，不扩造列表引擎。

### 实施检查点（尚未实际窗口验收）

已新增 list-continuation 局部公开树/事务模块与 list-input 路由，统一登记 continueList/listSoftBreak，MemoryEditor 当前 view 注册/清理及 controller 读写、活动、模式、IME、冻结门禁接线。候选只准备一个最终事务，不逐范围创建完整 State。解析覆盖须满足有关列表后缀；保护长行、组合引用/任务与无法可靠归并的组保守回退。普通全回退直接公开 insertNewlineAndIndent；混合普通范围使用公开 IndentContext 的 simulateBreak/simulateDoubleBreak、公开缩进查询及固定 ASCII 相邻括号，保留空白消费与中间光标。没有生成额外默认候选事务重复执行 filters，也未复制私有列表算法。

实际初轮错误保留：countColumn 误从 Lezer 导入导致运行失败，改为 CM State 公开导出；首次 typecheck 报项目目标不支持 string.at，改用下标。之后类型及专项 lint 通过。定向从 4/92 扩展至 10/186：精确编号/原文/history、多范围主选区及坐标、一次 filter、9→10 与 tab gap 解析子项归属、软换行续输树归属、同组插入+退出、BOM 空项、前导零、未就绪/长行及嵌套代码隔离；混合普通文字空格/空白行/括号/围栏括号与公开默认命令做全文和选区对照。受控 lifecycle/command 测试另覆盖焦点 readiness、IME/inputBlocked、只读、冻结、旧目标和清理；不冒称真实 DOM 焦点或自然 IME。

同列表后缀按聚合 delta 单扫，项目节点索引和松散状态按组缓存；附加 edits 与原删除区间按有序双指针筛选，避免每光标重复后缀过滤。数字列宽变化按完整 prefix+marker+gap 计算，父子缩进变更累计，冲突使有关依赖组重新安全规划并排除，独立组保留。全量与最终独立核对待完成，版本/构建/UI/Git 仍仅主线执行。

源码候选检查：`bun test` 全量 844 tests / 20442 assertions / 136 files / 20.46s 通过（`/tmp/agentic-f043c-source-tests.log`）；typecheck 与完整 lint 通过。mixed 普通范围对照仅覆盖上述当前 Markdown 常见输入，不宣称任意未来语言/依赖行为完全等价。独立审查和真实窗口仍待完成，不因源码测试绿记作验收通过。

最终 Spec 找到真实 P1：同一普通空白行两个光标与独立列表混合时，正文正确但手写 mapPos 选区把两个插入点合并，丢主光标。新增精确 `[6,13,18]` / mainIndex 2 断言在旧代码红（`/tmp/agentic-f043c-overlap-red.log`，9 pass / 1 fail），随后改由公开 changeByRange 合并范围及选择，再映射一次独立编号/缩进 ChangeSet；不增加 State 更新或 filters。修后定向 28/315/193ms、typecheck 和专项 lint 通过，最终仍仅一次事务。上述 844 项全量为修正前证据，修后全量和独立复核由主线续接，不混作同一版本通过。

> 状态：2026-10-10 经主线批准的隔离 PoC 已完成，55 条记录已落档，独立核对中；下一关键适配路线待用户确认，未生产接入、版本、构建或验收。父 F-043 开放。

当前建议而非已批准路线：以既有 CommonMark 局部结构实现窄列表适配器，单事务分别处理混合范围，仅新增项递增、不改后续已有编号，Shift+Enter 保持项内所需缩进；不复制私有算法、不建立完整解析器。此关键路线尚需用户确认，不能沿用前轮配对授权；PoC 已完成不等于独立通过或产品验收。

独立复核更新：最终 verifier 实际复跑得到 55 条记录、退出 0，文档核对 0 阻断，证据足以供路线决定，非产品验收。仅 history 有精确断言，其余主要为打印核对；没有 mainIndex 断言，部分长字段输出截断，不能称“55 项测试全部通过”。longLineProtection 是标记而非该原生命令门禁，native 返回 true 不等于已证违反产品规则；未来方案仍需明确有限局部结构读取与保护 span 回退。主线将询问保留后续已有编号及新窄适配路线，尚未获同意。

<!-- obligations: OBL-058 -->
<!-- deferred-obligations: none -->

## 功能说明与边界

依据已确认 E-06，编辑和普通源码支持 CommonMark 无序/有序列表 Enter 续写、嵌套层级与原标记保持、空项退出；Shift+Enter 插入软换行而不续写标记。正文真源、BOM/行尾、单次历史和多选区保持既有规则。阅读只读、安全源码继续隔离。

任务项续写留 F-045；引用续写、结构 Backspace、Tab/Shift+Tab 缩进不在本片。已有后续有序编号是否重排尚未形成新的产品决定，不因依赖默认行为自动接受。F-043b 的小型配对适配授权不自动覆盖本轮自研列表算法。

## 最小 PoC 技术方案

1. 主线批准后在明确 mktemp 目录写隔离 driver，复用当前安装 `@codemirror/lang-markdown` 公开 `insertNewlineContinueMarkupCommand({ nonTightLists: false })`、真实 CM EditorState 与项目 raw-buffer/editor-mode。只读核查本地声明和源码，不修改生产依赖、源码、版本或构建，不访问私有解析树内部字段。
2. 用 command target 收集实际 Transaction，核对正文、selection/mainIndex、原文 raw 映射与 undo。普通编辑/源码分别配置，保留解析已就绪与未就绪状态的证据，不能把 ensure 完整解析的结果冒称普通输入延迟行为。
3. 原样记录公开 command 的 true/false、是否 dispatch、所改范围。源码初读提示任一非空范围或无 markup 上下文会令整批 false；有序列表可能自动重排后续编号、非 tight 列表可能插空行。它们是待实测依赖行为，不是已批准产品规则。
4. Shift+Enter 只验证公开普通换行路径与原文事务作为候选，不把默认输出当验收预期；已确认预期是列表项内 soft break，须保留必要延续缩进和既有容器前缀，不是 hard break，也不默认接受可能脱项的裸换行。此处不新增独立引用/任务/缩进功能。若 command 返回 false，记录既有普通换行能否安全保持正文；不得把整批 fallback 当作已满足混合范围续写。解析未就绪不能强行同步解析整篇或猜测结构。
5. 若原生行为不能满足已确认范围，报告确切输入/输出与限制；需要新的关键适配/替代算法时先由用户确认。不得沿用上片授权自行写列表解析引擎。PoC 后先形成最小生产方案，经主线批准再实施。

## 最小验证样本

- 无序 `-`、`+`、`*` 与有序 `1.`、`1)`，行中/行尾、嵌套及不同缩进；断言保留对应标记及层级。
- 空项 Enter：单层、嵌套和连续空项，记录退出/降级行为，不提前认可任何超出既定规则的删除。
- 有序列表后方已有连续、非连续及手写不同编号，核对实际改写范围和 renumber 输出；不以测试得到值替代产品选择。
- 多选区：两个列表项、列表与普通段落、非空选择与空光标混合；准确记录整批 false 与回退，不逐光标 dispatch。
- tight/non-tight 列表、普通段落、代码围栏/引用/任务标记对照，避免把本轮排除结构的默认续写误称通过。
- 真实 raw-buffer 含 BOM、CRLF/LF、中文 emoji；一次 Enter / Shift+Enter 后精确全文和选择断言，undo 恢复原始字节，redo 同结果；非目标片段不归一化。
- 解析未就绪及长行保护样本：记录是否安全普通回退，不承诺性能基准。无 DOM PoC 不验证原生键盘、IME、权限竞争、焦点或真实外观。

## 继承约束与义务

- **F-002 本地与离线**：隔离本地实验，无新网络或外部服务；`F-043c-offline-final` 留最终人工，不断网、不做网络隔离。
- **中文与外观**：实验含中文/emoji；无 UI 阶段不声明主题或自然中文输入验收。后续实际主题与输入随生产接入验证。
- **命令与键盘**：OBL-058 局部主承接；后续 Enter/Shift+Enter 必须遵循当前 editor/view/模式/IME/只读与冻结上下文，不能绕过统一命令架构或污染树、设置焦点。本阶段没有产品键盘接线。
- **安全与日志**：仅临时合成语料，不执行 Markdown，不改用户文件、权限、设置或系统网络；不新增正文日志/遥测。

OBL-064 为后续生产历史/IME 消费者回链，主承接仍 F-014；本 PoC 不关闭完整义务、父 F-043 或离线，不把原生接口的探索结果当成产品可用。

## 2026-10-10 已批准隔离 PoC 实际结果

本节软换行结果只证明默认命令的字符输出及历史保真，不证明续输后仍处于原列表项；必要延续缩进/容器前缀的语义验收尚未满足，不把裸换行或默认缩进记为产品通过。

主线完整读取并批准后，`mktemp -d /tmp/agentic-f043c-poc.XXXXXX` 创建 `/tmp/agentic-f043c-poc.N1qEuc`，apply_patch 写入 `driver.ts`。执行 `bun /tmp/agentic-f043c-poc.N1qEuc/driver.ts > /tmp/agentic-f043c-poc.N1qEuc/results-final.log` 成功；首轮 `results.log` 保留。真实生产 createRawEditorState / switchEditorMode，直接导入当前安装依赖 ESM 公开 API；无逐范围临时 state、私有字段、生产接线或依赖修改。日志打印精确结果和 ChangeSet，历史还原为实际断言；不是所有语义都有预设通过断言，不能称全矩阵产品通过。

- **生产解析兼容**：编辑/源码两模式 `markdownLanguage.isActiveAt` 均为 true，小样本 ensureSyntaxTree 成功。五种标记 `- + * 1. 1)`、行中、嵌套续写实际成立，一次 dispatch；全部有 dispatch 的样本 undo 精确恢复 raw、redo 精确恢复结果。注册的自定义 Language 并未使公开命令全部失效。
- **空项**：`- ` → 空文；`- a\n- ` → `- a\n`；嵌套 `- top\n  - ` → `- top\n- `，即降一级而非一次退出所有层。`nonTightLists:false` 避免空第二项先转换松散列表。
- **后项重编号真实发生**：首项后 Enter，`1. a\n2. b\n3. c` → `1. a\n2. \n3. b\n4. c`，ChangeSet 明确含后两项数字写入；而 `1. a\n7. b\n12. c` 保留 7/12。空第二项 `1. a\n2. \n3. c` → `1. a\n\n2. c` 同样改后项。尚无产品授权接受这种额外改写，不能原样生产接入。
- **松散列表**：即使 nonTightLists:false，已有 `- a\n\n- b` 首项后 Enter 仍得到 `- a\n\n- \n\n- b`；配置只控制空第二项分支，并非禁用所有额外空行。
- **多范围**：两列表光标成功一次 dispatch；真正列表/普通段落混合 `- a\n\nplain` 双光标原生命令 false/零 dispatch，默认回退得到 `- a\n\n\nplain\n`，列表光标未续标记。非空范围+列表光标也整批 false。首试 `- a\nplain` 被 CommonMark 解释为 lazy continuation，原生命令 true；它不是“独立普通段落”对照，补了空白分隔样本，旧结果保留。
- **排除结构**：普通段落与围栏内容 false；引用 `> abc` 却自动补 `> `，任务样本 `- [x] abc` 自动补 `- [ ] `，即使本轮 CommonMark 范围没有承接任务语义也会发生。不能无门禁直接绑定完整原生命令。
- **软换行与原文**：当前默认 Shift+Enter 对应 insertNewlineAndIndent；普通 `- abc` 得 `- abc\n`，嵌套末行带原空格缩进而不续标记。BOM/中文 emoji/混合 CRLF-LF 样本以正确 CM offset 7 操作，Enter 输出 `\ufeff- 中文😀\r\n- \r\nplain\n尾`，默认软换行输出 `\ufeff- 中文😀\r\n \r\nplain\n尾`；均实际 undo/redo 原文精确。首试误用 offset 8（已在下一行起点）返回 false，不当作 BOM 缺陷，旧记录保留。
- **未就绪/保护不等价**：550006 字符多行样本未 ensure，语法树只到 3002，尾部列表命令 false，普通换行安全插入；不是异步解析恢复验收。500002 字符单长行实际处于 longLineProtection，树 length 已完整且命令仍 true，可继续列表。说明原生命令不自行遵守本 App 长行交互保护；不能用“未 ensure”一词把它当未就绪回退，更不能直接把它认作生产保护通过。

**结论与下一步**：原生 API 可处理基础同类范围，但不能整体满足当前最小范围。先由主线决定是否向用户询问后项重编号及窄适配路线；若采用新的列表适配，需要明确授权与新最小生产方案，不继承 F-043b 配对授权，不 fork 或复制私有算法。不接受以仅支持同类光标、整体普通回退来宣称完整多范围续写。无 DOM、自然 IME、权限竞争、性能基准、窗口验收或保存实操；没有生产、版本、构建或 Git 修改，完整义务与 offline-final 保持开放。
