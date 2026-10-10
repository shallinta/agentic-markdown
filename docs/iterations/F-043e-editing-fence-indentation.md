# F-043e：编辑模式围栏内容缩进与段落 Tab

> 状态：alpha.118非离线本片经最终独立verifier确认0剩余阻断，主线正式批准受托Agent代验通过，非用户亲验；Git待实际执行。PID12145已退出，A/B磁盘原样、B权限644，无当前运行现场；下方候选/待批准为此前历史。
> 日期：2026-10-11

<!-- obligations: OBL-058 -->
<!-- deferred-obligations: none -->

## 功能说明与依据

能力总账E-07及基础结论82/83已确认编辑/源码的结构感知Tab：围栏只处理内容，多行选区整体操作；普通段落无目标时消费Tab/ShiftTab、保持焦点且不改原文。本片只把已交付F-043d的顶层围栏内容缩进和段落规则接入普通编辑模式，不另造语义或配置。F-043d已提交推送`3a6213aa02867dd1a90949071b83d9a7e33294f0`，主线核验远端同SHA、当时clean；此收据不代表本方案已提交。

编辑模式保持单选区，可选择多行；`Tab / Shift+Tab`及继承`⌘] / ⌘[`共享相同原子计划。默认缩进单位沿CM既有两空格；围栏0–3空格结构基线保留，Tab穿越基线语义与F-043d一致。不动开闭围栏、info或未触及行尾；减缩进若使内容成为关闭围栏，整次拒绝并给现有准确中文提示。零实际缩进不造空历史。纯普通段落无操作；包含标记、其他结构或解析不足的混选整次拒绝，不部分写入。

焦点出口沿同一已交付`⌥⇧M`物理键公共适配扩至普通编辑模式：聚焦、非输入法候选且当前view/state/session有效时切换CM公开tab-focus mode，使Tab/ShiftTab可移出；再次切换恢复编辑规则。只读可逃逸但不可缩进。不新增快捷键、不改Escape、无新原生菜单或命令面板失焦目标。

## 最小实现方案

1. 直接复用F-043d的纯缩进计划与lazy raw helper；计划本身使用真实公开CommonMark树和逻辑选区，不读渲染DOM反推源码。必要时仅调整内部名称/注释消除source-only误解，不改已有command协议和生产语义。不得引入第二个缩进算法、重新解析全文或逐范围完整EditorState。
2. 在现有registry/controller、MemoryEditor注册和公开CM事件入口放宽本片模式守卫为普通编辑或普通源码；原isolated不装扩展，动态safe可保留handler但由实时guard拒绝新增行为，阅读没有编辑view消费者。不为此新增扩展物理卸载机制。保持原当前doc/view存活、精确state/session、权限、IME、busy/frozen和旧回调清理检查。tab-focus出口不借写权限阻塞只读，但依然受焦点/组合与当前目标约束。
3. 编辑排版会按选区显露围栏标记，计划仍只作用真正的内容行。标记显隐及语言标签、视口装饰、自动软换行不参与raw计算；不把视觉隐藏的标记当可删除空白。效果用一次既有transaction、共享raw/history，单次undo恢复精确原文与选区。源码回归不能因本片模式扩展退化；不修改F014c逆效果/filter或lazy实现。
4. 原有拒绝原因沿用。readonly/safe等守卫仅指本片新增registry/target不执行，不扩称安全源码所有继承命令均不可写。`⌘⌥\\`自动机械缩进仍继承草稿，不在本片改绑或验收。没有新持久偏好、RPC、依赖、授权或产品可见性能限制。

## 最小 happy path

自动验证：使用真实默认编辑state，不先切source伪装编辑验证。覆盖反引号/波浪线、info、开围栏0–3空格、空内容行、Tab前缀、精确BOM/混合行尾；单选区正反多行及末端行首排除；一次事务及精确undo/redo、跨编辑/源码共享历史；closing hazard、围栏标记混选、嵌套/保护/partial tree整批拒绝。新增模式守卫回归检查阅读/safe/只读/IME/冻结/旧目标；公开焦点适配包含编辑/只读条件。沿用既有raw oracle而不重复另造性能实验。

真实WK由主线完成：编辑模式聚焦/未聚焦时围栏显隐不变，内容Tab/ShiftTab/Cmd[]正确、多行一次撤销，普通段落Tab不改且可继续输入；拒绝闭合风险/混选；编辑→源码→编辑原文与选择/历史保持；中文组合期间不抢Tab；只读不可缩进但可焦点逃逸，`⌥⇧M`开/关及Tab/ShiftTab实际移动；浅深主题、退出取消与最终正常退出，样本原文未保存则SHA保持。记录工具与自然键盘证据边界，不用模型测试替代真实焦点验证。

## 继承约束检查

- F-002：磁盘仍唯一正文真源；沿原文事务和保存边界，不改磁盘基线；最终离线留人工。
- 中文与外观：沿已有中文原因、编辑排版及主题；不新增英文工具栏或固定材质。真实验证围栏装饰与主题，未实测动态系统主题不补造。
- 命令与键盘：沿统一registry和当前上下文；同一Tab/Cmd[]与公开焦点出口，无capture、私有状态或IME计时；不新增拖动/分隔线。
- 安全与日志：权限/模式/输入法/生命周期执行侧复核；不输出正文/路径，不扩大网络、文件或原生能力。

## 义务与不包含范围

局部主承接OBL-058；OBL-064仅作为历史/IME消费者协作，主责仍F-014，不改其责任。完整父F-043、OBL-058/064及`F-043e-offline-final`保持开放。列表/引用结构升降级、嵌套围栏、缩进代码、多光标编辑模式、围栏内换行专项、F-041c成本保护及F-028c撤销决定都不在本片，不借此默认实施。

前置已具备：F-012编辑与共享state、F-014历史/IME、F-043d基线适配和统一入口；目前未识别新产品决定。若编辑装饰产生不能保真的实际边界，先诊断并报告，不静默改变确认规则。本轮先方案批准，再实现/定向验证/独立两轴/主线构建与受托验收；版本与Git由主线负责。

## 实施与自动证据（代码候选）

使用implement技能，按项目非默认TDD及主线版本/验收/Git权限执行。只在controller放宽普通编辑入口，MemoryEditor共用`isOrdinaryIndentation`谓词接既有registry及焦点出口；source前缀内部command ID保持兼容，不新增面板命令或状态。纯计划、lazy raw helper、F014c历史/filter及装饰代码均未改变，原isolated不装与动态safe实时隔离明确区分。

新增`editing-indentation.test.ts`四项使用真实默认editing state，验证单range正反多行中的反向选择、围栏0–3基线与BOM/混合行尾、单次transaction filter、共享源码/编辑undo/redo、空行/普通段落/零缩进、标记和closing风险拒绝、readonly与动态safe消费者边界。既有history-documents测试更新普通编辑准入预期，其余权限/旧目标/冻结/输入法守卫保持。测试未运行DOM，不能据此声明实际标记显隐、焦点或中文输入已验收。

定向 `bun test apps/desktop/src/client/editing-indentation.test.ts apps/desktop/src/client/source-indentation.test.ts apps/desktop/src/client/source-indentation-input.test.ts apps/desktop/src/client/history-documents.test.ts`：32项/847断言/4文件/224ms通过；typecheck、受影响文件eslint及diff检查通过。全量、alpha118构建与真实WK由主线执行，本记录不预写成功或自批验收；完整父/义务/offline-final继续开放。

主线最终源码全量912项/26382断言/147文件/23.48s，typecheck/full lint通过；独立Spec32/847、Standards40/935均0代码阻断。alpha.118构建session98713进行中，日志`/tmp/agentic-f043e-build118.log`；全量及type/lint日志为`/tmp/agentic-f043e-source118-tests.log`、`/tmp/agentic-f043e-type118.log`、`/tmp/agentic-f043e-lint118.log`。尚无成功包或真实WK验收结论，不列可用，不以代码审核代替产品验收。

## alpha.118 局部真实证据（主线回报，验收进行中）

构建成功hash `14gj3h9cwmirh`，包`/tmp/agentic-markdown-alpha118.qcH5jB/Agentic Markdown-canary.app`，exec39788 / PID12145运行。源码912/26382/23.48s，包内Bun运行仓库测试912/26383/22.42s分别记录，不混同断言数。复用F-043d自建A/B及原SHA，当前只打开A，默认editing；初始截图确认未选中时围栏标记隐藏、语言在右上角。

首次AX select alpha_code，装饰后读回a_code及下一行片段，未按键；第二次精确选中alpha_code后Tab增加两空格并dirty。切source选区保持，CmdZ回clean；回editing执行redo+ShiftTab后clean，中间redo未单独读回，不补称其独立观察。editing两行范围Tab两行同时加两空格，一次undo回clean；包含开围栏的混选Tab整次拒绝、clean。

base_code两次AX选择仍跨两行，误以为精确后Cmd[实际使deep_code减两空格；已undo回clean。该次定位偏差不计基线缩进通过，也不据此归因产品。改用截图坐标定位base行、CmdLeft/CmdShiftRight，读回精确base_code后Cmd[不变、Cmd]加两空格、Cmd[回clean。

Alt+Shift+M后Tab移到HTML；批量反向Tab焦点未明确，不列通过。显式点击确认editor后单步ShiftTab到summary、Tab回editor；Alt+Shift+M关闭后Tab令当前deep_code加两空格，undo回clean。通过source准确选择四空格加四反引号内容行，切editing后选区准确，ShiftTab显示专属closing风险提示且clean。

其余验收仍进行中，尚未通过、不得Git。以上仅受托工具实际路径，不是自然物理键盘亲验；选择偏移、批量焦点不明及未单独读取的中间状态如实保留。生产源码未为本段记录修改。

## alpha.118 最终候选追加证据（待独立最终复核）

B默认editing，首次AX选择second_code有装饰偏移，未操作；第二次准确选择后Tab增加两空格、dirty。切A保留原closing选区且clean；再切B保留second_code选区和dirty。CmdQ显示未保存确认，继续编辑后CmdZ回clean；单独redo读回增加两空格且dirty，再undo，区别于先前未单独读取的redo路径。

Right+n+i在系统中文输入源下显示蓝色下划线ni、控件disabled，Tab后AX不变，Escape取消回clean。普通段落准确选择后Tab/ShiftTab不变，paste“段落测试”实际替换证明焦点保持，undo回clean。组合路径均为工具驱动系统输入源，不是用户自然物理键盘亲验。

自建B临时chmod444，A→B首次切换未发生、重试成功并显示只读；click确认editor聚焦后Tab/Cmd]无正文或dirty变化，但caret未确证位于围栏内容，不能称该次已实测围栏特定写拒绝。Alt+Shift+M后ShiftTab焦点到summary成功。B恢复644，Tab及Alt+Shift+M回切后打开设置；浅色截图确认背景、语言和文字可辨，恢复深色combo已读回，未测试动态系统主题。

B呈现故障进入safe，完整原文保留且clean；准确选择second_code后Tab移至HTML、正文不变。未测试safe继承Cmd[]，不泛称safe只读或全部命令禁用。最终CmdQ返回App quit，ps确认PID12145不存在；A/B SHA与既有完全一致，B权限644。未保存正文、未断网，无当前运行现场，也无本段引起的生产变动。

非离线验收证据现已完成候选，等待最终独立verifier及主线明确批准，不列正式通过或Git。定位失败/重试、未确证的caret、未读中间状态及其他历史限制保留；未实操自然物理输入、多键盘布局、动态系统外观、真实大规模UI/RSS与异步竞态，不扩大声明。完整父/OBL058/064与F-043e-offline-final继续开放。

## 最终本片结论（2026-10-11）

最终独立verifier确认alpha.118非离线本片0剩余阻断，主线正式批准受托Agent代验通过，非用户亲验。普通编辑模式的本片围栏内容缩进/段落Tab及既有焦点出口消费者已可用；Git待主线实际执行，不预写提交推送。全部失败、工具定位与未实操限制保持；父F-043、完整OBL-058/064及F-043e-offline-final继续开放，不扩入列表/引用或其他未交付范围。
