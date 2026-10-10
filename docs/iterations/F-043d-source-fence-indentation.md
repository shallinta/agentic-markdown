# F-043d：普通源码围栏内容缩进与段落 Tab 规则

> 状态：alpha.117非离线本片经最终独立verifier确认0剩余必要阻断、主线正式确认受托Agent代验通过，非用户亲验；Git待主线实际执行。PID9762已退出，A/B磁盘原样、无当前运行现场；下方候选/待批准为此前历史。
> 日期：2026-10-11

<!-- obligations: OBL-058 -->
<!-- deferred-obligations: none -->

## 功能说明与责任

依据能力总账 E-07、基础结论82/83及2026-08-25/26决定：编辑/源码最终都须结构感知缩进；普通段落无合法目标时消费 Tab/Shift+Tab、保持焦点、不插字符。本片仅普通源码：完整可靠顶层 fenced code block 的内容行缩进/反缩进，及普通段落无操作规则。原有反引号/波浪线围栏、info string及未触及正文保持原样。

列表、引用内的嵌套围栏、缩进式代码、列表/引用结构升降级、编辑模式入口留F-043后续切片；不能把这些上下文当普通段落或宣称完整E-07交付。本片局部主承接OBL-058，沿OBL-064历史/IME约束作消费者回归，不改OBL-064唯一主责F-014。完整两义务、父F-043及`F-043d-offline-final`开放，最终离线留人工。

普通源码Tab/Shift+Tab本片统一处理：全部范围均在同一或多个可靠顶层围栏的内容行时，选中逻辑行去重后整体处理；纯普通段落保持焦点不写入。跨内容/围栏、跨语法块、混入未支持结构、解析不足或受长行保护时整次不修改，不只改合法子集；给简短中文原因，不跳出编辑器。空光标作用当前内容行，选区末端恰下一行行首时不包含该行；多光标同一行只处理一次，保留方向/mainIndex并按最终changes映射。

## 公开 API 与键位核查

本地已装CM commands6.11.1的公开indentMore/indentLess对所选行机械加减indentUnit；language6.12.4公开indentUnit默认两空格，仓库未发现生产override。因此本片读取当前state的公开indentUnit，沿现有默认两空格，不新增用户配置或自定缩进单位。已有Tab字符反缩进按公开列宽语义处理，不把tabSize误当indentUnit。

raw-buffer接入defaultKeymap，现有Cmd-[ / Cmd-]分别指向机械indentLess/indentMore；不能让它们在普通源码绕过本片结构守卫。建议仅普通源码把这两个既有键位接入同一统一缩进命令，与Tab/Shift+Tab范围/权限一致；不新增系统键位、不改原生菜单，编辑/安全源码保持旧入口，本片不冒称它们结构语义已完成。

defaultKeymap另含Cmd-Alt-反斜杠的indentSelection（自动重算缩进），不是本片加减一个单位的命令；该入口仍属继承草稿，本片不改绑、不宣称其完成结构感知/统一registry或覆盖相同保护。若其与新增功能形成实际误改冲突，再向主线报告并明确最小处理，不静默扩大本片为完整快捷键改造。

CM公开toggleTabFocusMode已由defaultKeymap绑定macOS Shift-Alt-m，开启后Tab可移出编辑器；保留此既有可访问性出口。CM自带Escape后临时Tab-focus逻辑，但本项目源码Escape先被F-044b局部捕获以简化多选区，不能声称Escape→Tab当前可用；本片不改Escape多选区产品行为，也不自行新增快捷键。真实验收须确认既有Shift-Alt-m→Tab/Shift+Tab可离开、再次切回正常编辑。如果该路径实际不通，先诊断/报告，不以全局吞Tab作为完成。

## 最小技术方案

1. 基于当前生产state公开syntaxTree和可靠解析覆盖判定，确认完整顶层围栏起止及所有受影响行均属内容；不强制全篇parse、不用正则猜未就绪树、不动围栏或info。嵌套结构/受保护跨度明确拒绝。
2. 先小型隔离公开API验证：真实state中调用indentMore/indentLess的行集合、两空格/tab反缩进、空行、行首结束选区、多范围同一行去重及精确方向/mainIndex；同时确认该命令是否产生唯一事务和历史。只读已安装公开声明/实现，不fork或复制私有算法。若直接复用不能保证只内容行，可用公开ChangeSet/列宽API小型行计划适配，但先报告具体缺口并补最小方案，不默默改选区为大范围或逐range完整state。
3. 按可靠准入后统一生成单次transaction，沿raw-buffer和controller提交，未触及BOM/混合行尾保持；效果无变化不额外制造历史。原计划不接F041c批量优化；下方隔离实验发现本片大量短行同样依赖共享raw热路径，新增的窄helper候选仅拟解除本片前置成本，不交付F041c全部替换、不改变其待用户决定或文件1MiB边界。权限、非source/safe、IME、frozen/busy、当前view/session/state和活动文档在执行时再检查。
4. 沿公开CM keymap/事件生命周期，保留CM内置组合保护和tab-focus mode，不新增DOM capture抢先处理输入法。统一registry由局部键盘调用；无新RPC、native菜单或命令面板目标捕获。按当前view绑定/解绑，销毁或切模式后旧回调不能写旧文档。
5. 扫描仅所选受影响行和相关围栏边界；不每次render全文扫描。多范围去重/排序，一次编辑；广选/长行无法有界可靠处理时明确不修改，不新增性能SLO。

## 最小 happy path

自动：真实生产state的反引号/波浪线、带info、普通段落及BOM/CRLF/LF；空光标/多行/正反多范围、同一行去重、末端行首边界；Tab缩进→ShiftTab反缩进→单次undo/redo精确raw；围栏/info不变。跨边界/混合unsupported/partial tree/长行保护整次拒绝且选区/历史不变。本片新增registry/target在只读、safe、IME、冻结、旧view及旧state条件不执行；不把safe继承默认Cmd[]草稿路径宣称只读。普通段落保持内容，命令路由一致。

真实WK：普通源码代码内容实际Tab/ShiftTab和Cmd[]，围栏保持、多光标/选区方向及undo/redo；段落Tab无正文变化且焦点保持；混合选择不部分修改；Shift-Alt-m的键盘离开与恢复；中文候选不抢键、只读/模式隔离、跨标签历史与退出保护。自动测试不代替自然或工具实际事件，证据边界分开记录。主线负责版本、构建、实际验收和Git。

## 继承约束检查

- F-002：原文/磁盘基线职责不变；局部行编辑、BOM与未触及混合行尾保真，离线留最终人工。
- 中文与外观：中文不可用原因及既有焦点可见性，浅深/系统外观沿既有主题；没有新固定工具栏。
- 命令与键盘：统一registry、保留既有tab-focus出口，不改系统快捷键或Escape产品行为，无拖放/分隔线。
- 安全与日志：实时权限/IME/状态守卫，陈旧回调不写入，不输出正文路径；无网络、文件授权或原生能力扩展。

## 当前证据

仅本地公开声明/实现及现有接线核查，尚未运行本片PoC或生产测试。没有新产品配置或专项设计默认值；以上Cmd[]统一守卫与Tab-focus验收路线待主线和独立Spec核对后才实施。

## 隔离公开 API 实验（2026-10-11）

主线批准后使用 `/tmp/agentic-f043d-poc.9MwV4y`，apply_patch建立driver.ts，运行 `bun /tmp/agentic-f043d-poc.9MwV4y/driver.ts`，输出run.log。使用实际createRawEditorState和已安装公开commands/state/language ESM模块，没有修改生产/依赖/版本。下方结果不是WK产品验收。

10组观察：空内容行；反向选择to恰关闭围栏行首不触及关闭行；同一行双光标去重；多个围栏与mainIndex；既有Tab按列4减少到两空格；无缩进反缩进raw不变且undoDepth0；BOM/混合行尾；开围栏前1/2/3空格三组。每组公开命令只派发一个事务；有变化的样本验证单次undo/redo精确raw和undo恢复选区。公开命令保留通常所选行及方向行为。

关键不满足：开围栏缩进N=1/2/3且内容仅含N基线空格时，indentLess分别删成0/0/1空格；它不了解CommonMark围栏基线，不等价于“只减少实际代码缩进”。三例日志是实际行为断言而不是产品预期通过。基线不足的内容行/空行直接indentMore也不能默认增加两个实际代码列：新增空格可能先被围栏基线剥离。故不批准直接接入公开机械命令。

tab-focus实验只证明公开toggleTabFocusMode委托view.setTabFocusMode一次；源码可见CM在keymap前按状态放行Tab。没有真实DOM/焦点验证，必须留WK；没有在此实验测试生产准入守卫/长行/IME，不能补造覆盖。

### 待主线批准的小适配方向

复用公开树作完整顶层围栏和内容行准入，逐逻辑行去重，一次ChangeSet/事务；不逐range完整state。对开围栏0–3空格分别明确CommonMark基线：反缩进只减少基线之后实际代码的列数，零代码缩进不动原有基线；增加缩进须保证新增单位属于代码，原基线不足时必要补齐后再增加。已有Tab按当前tabSize与公开countColumn/indentString等列宽API处理，不能仅按字符删N。

在生产接入前再以小样本验证“围栏渲染代码文本只增减一个单位”的语义，包括基线不足、空白行、Tab穿越基线、info及围栏原文不动，并验证精确raw/history/选择映射；必要规范化仅限被执行的内容缩进，不改围栏或其他行。不复制CM私有算法、不新增配置、不把缩进围栏漏支持作为通过。此为待批准技术小适配，尚未实现；若公开语义不能明确，则向主线报告而不猜测生产行为。

## 基线适配与共享热路径隔离结果（2026-10-11，冻结）

实验目录 `/tmp/agentic-f043d-baseline.Lbd2wz`，Bun 1.3.14；仓库基线 `e492c6fb5c39a94268949f85558a3d5a43b24cc8`。脚本均apply_patch创建，无生产代码、依赖、版本或UI变化。各日志与同名脚本保留，可用 `bun <绝对脚本路径>` 复跑；cost-driver每个子进程外部8秒终止，属于实验防卡保护，不是产品性能门禁。

### 语义

依据[CommonMark围栏规范](https://spec.commonmark.org/0.31.2/#fenced-code-blocks)及[Tab规则](https://spec.commonmark.org/0.31.2/#tabs)，结构基线剥离采用固定4列Tab，实际代码缩进列才采用CM的tabSize。`driver.ts` / `run.log`：576组（开围栏0–3空格、12种前缀、空/非空内容、增/减、tabSize2/4/8）与仓库独立canonical parser的Code.value对照通过，另多围栏选区/mainIndex与8组提前关闭围栏风险验证通过。代码列零时反缩进保持原文；需要变化时只规范化所选行前导空白为空格，基线不足时先补齐再增加代码单位。缩进再反缩进不承诺还原原Tab字节，undo/redo才恢复精确原文。

内容中≥4列缩进的同类围栏串反缩进后可能成为关闭围栏；试验确实观察到canonical结构变化，因此生产候选必须整批拒绝这种变更。该实验没有生产准入/生命周期、DOM或IME，不能代替真实WK验收。

### 成本观察与失败保留

`cost.ts` / `cost-driver.ts` / `cost-valid-output.log`使用真实生产完整state与history，每个内容行插入两空格。100/1000/10000行提交分别约4.43/40.09/2720.44ms；70000行输入770007字节、输出910007字节，提交未完成即8秒终止，退出137。此前`cost.log`的90000行同样超时但结果会超过1MiB，仅保留探索历史，不能用它替代有效大小下70000行失败。

先试用F041c隔离后缀表helper，`candidate-cost.log`70000行提交244.64ms；但`sparse.log`的1MiB开头单点helper从旧约0.14–0.19ms变约2.24–2.38ms，确认每次全文数组/逆扫引入普通输入额外成本。此候选不作为最终建议。

最终`lazy.ts`改为单调前向raw偏移游标、前一行尾记录及惰性下一CR/LF终止位置缓存；无LF插入不查行尾。不分配全文后缀数组，不改变公开ChangeSet及其默认相邻报告语义，不合并原changes，也不全文replace。`lazy-differential.ts` / `lazy-differential.log`：68679个穷举/随机旧helper oracle比较通过，覆盖同坐标、多范围、loneCR/CRLF；保留相邻合并会改变映射的反例，未采用该路线。

`raw-candidate.ts`是从最新alpha115仓库raw-buffer复制，仅替换helper和临时绝对import；保留F014c raw-only inverse修复、原filter/字段/history，不是生产模块原样。`state-compare.ts` / `state-compare.log`：2000随机及F014c三个历史红例和最小CR例共2004组，通过精确raw、changes JSON、多选区方向/mainIndex、undo/redo对照。没有controller/UI覆盖声明。

`candidate-cost-driver.ts`现加载lazy候选，最终日志`lazy-cost.log`：100/1000/10000/70000行完整提交约3.33/8.37/50.50/248.26ms；70000行后续undo+redo+参考生成及断言合计395.07ms，RSS读取277610496字节是整个子进程结束时瞬时值，不是峰值或helper独有分配。原baseline的undo区间不含redo，不能直接作净undo速度对比。

`sparse.ts`现加载lazy，最终`lazy-sparse.log`：1MiB开头单点helper旧约0.15–0.21ms、lazy约0.10ms；尾部旧约2.46–2.55ms、lazy约3.39–3.46ms，有约1ms常数回退，不宣称所有输入更快。`sparse-state.ts` / `sparse-state.log`完整state每格5次：开头字符旧5.76–10.33ms/lazy6.37–9.31ms，末尾字符旧9.80–14.26ms/lazy14.19–15.44ms；换行和三点实验有波动，三点换行lazy一例56.36ms离群保留。此为有限本机成本观察，无SLO、无强统计结论；样本插入后可能超过1MiB，仅用于比较共享state成本，未声称controller会接受超限正文。所有输出逐项与旧raw核对一致。

## 待批准生产最小候选

1. 新增小型源码缩进计划模块：公开完整顶层FencedCode准入，选中内容逻辑行去重；按上方固定4列结构基线/公开代码列宽生成精确前导空白changes。所有范围先校验再单事务；普通段落无操作，unsupported混选不部分修改。检查计划是否使内容行变为关闭围栏，若是整批拒绝；未就绪树/长行保护保持既定拒绝，不新增广选行数阈值。
2. 仅将`raw-buffer.ts`的`applyEditorChanges`替换为经差分的lazy实现（可相邻纯helper模块），接口不变。保持F014c inverse守卫、filter顺序、controller权限/字节/发布以及CMhistory不变。此为本片必要共享内部热路径适配，不实施F041c全部替换或其极端单长行保护选项；该问题仍开放。
3. 按现有public CM keymap与当前view生命周期接统一registry及Tab/ShiftTab、Cmd[]，优先让CM自身tab-focus机制放行；不添加capture或IME时间阈值，不改其他继承快捷键。动作执行实时复核source/safe/readonly/IME/frozen/session/state，旧view回调拒绝。
4. 预计影响：新source-indentation计划/路由及测试，raw-buffer/helper及测试，MemoryEditor生命周期、documents统一命令执行、shared commands与panel registry局部接线；不新增native/RPC/依赖。先定向与type/lint，再独立Spec/Standards，主线构建和实际WK验收。
5. 回归至少包括：上述baseline/Tab/closing hazard、BOM混合行尾、行首排除与重复行、多围栏正反范围/mainIndex、单transaction/undo；真实state的权限/mode/IME/旧owner路由；raw helper oracle差分和F014c raw-only历史保持；合理多短行及单点有限成本对照。生产和真实窗口尚未执行，完整父/OBL058/064与offline-final开放。

## 生产实施候选（2026-10-11，待独立最终复核）

主线已批准上述窄方案；使用implement技能按既有非TDD和主线验收/Git权限执行。已落`source-indentation.ts`计划、`source-indentation-input.ts`公开CM事件/WeakMap注册，raw-buffer仅将原helper接至`raw-changes.ts`，F014c字段/filter/inverse未改。MemoryEditor使用存活/current view、精确controller state和session共同验证，现有CM组合/Tab-focus生命周期在公开handler前处理；registry/controller实时权限、模式、输入法与冻结检查。新命令palette:false，无命令面板失焦捕获，仅现有键盘入口；中文标签缩窄分支不代表新增面板入口。

正式测试新增source-indentation及input两文件、history-documents一项；独立测试lane新增raw-mapping-linear旧oracle差分。最终定向命令：`bun test apps/desktop/src/client/source-indentation.test.ts apps/desktop/src/client/source-indentation-input.test.ts apps/desktop/src/client/history-documents.test.ts apps/desktop/src/client/raw-mapping-linear.test.ts apps/desktop/src/client/raw-only-history.test.ts`，39项/5495断言/5文件/457ms通过。包含canonical基线、可变tabSize对照、真实background partial tree、开长度3/4/5及更长closing/较短非closing、BOM/混合行尾、选择方向/mainIndex、原文历史和守卫回归。没有用受控事件冒称实际Tab-focus或自然IME通过。

中途失败保留：首次typecheck漏新命令标签联合类型缩窄；初测试用错appendConfig所属API、误指关闭行、readonly facet优先级，均已修正测试与接线。增加防旧view检查时曾引用私有destroyed，typecheck识别后删除，改沿已有alive/ref及state/session，不采用私有API。lint的startsWith/import顺序已修。最终typecheck、受影响文件eslint及git diff --check通过；全量/版本/构建/WK由主线负责，当前未验收，不得以代码候选绿关闭父或离线义务。

## alpha.116 真实发现与最小修正方案（待主线批准）

主线真实WK已局部验证Tab/ShiftTab/Cmd[]基线与history；提前关闭围栏的变化被整批拒绝，行为正确，但沿用“选区需完整位于已解析的顶层代码围栏内容中”误导用户。拟仅该风险分支返回“反缩进会改变代码围栏边界，未修改内容”，其他拒绝原因保持；现有开长度3/4/5、较长closing测试改精确文案断言，较短串/尾随正文继续允许。

另一必要红：普通源码选择“alpha 中文”，工具Alt+Shift+m后Tab路径实际插入Â并dirty，主线已撤销恢复clean。首次实验台/AX selectText路径trace的target/active为other，不用于归因。随后Start并明确坐标点击正文、AX确认editor焦点，再Alt+Shift+m仍插入alphaÂ；新停止trace的seq5为keydown，target/active editor id3、alt+shift=true、ctrl/meta=false、composing=false；seq6 beforeinput同editor。诊断仅将键记录为Other，未采code，不能补称已读到key=Â或code=KeyM。

按diagnosing-bugs建立公开隔离红环：`bun /tmp/agentic-f043d-tabfocus.zBuHri/driver.ts`，输出`red.log`。在Mac平台条件下，以公开keymap/defaultKeymap/runScopeHandlers和仅state/setTabFocusMode的受控view验证：key=m命中toggle一次，key=M及Â均不匹配；安装或移除本片公开handler结果相同，本片回调始终未认领该键。脚本明确断言失败，证明给定字符事件在默认匹配路径的缺口；不是完整DOM/自然输入复现，也不把真实未采集的code当已知。假设排序为默认Mac字符映射、本片handler拦截、composition时序；受控对照排除本片handler拦截作为此输入的解释，composition和真实字段边界保持。

拟追加的最小公开适配：仅当前普通source、聚焦且有效view/state/session、无event/CM组合状态时，在现有公开domEventHandlers内识别既有Alt+Shift+物理KeyM（ctrl/meta均false），调用公开toggleTabFocusMode。保留CM先行组合过滤，不读取私有tabFocus/inputState、不装capture或自造时间阈值，不改Escape，不新增快捷键。它是焦点出口，不用canWrite挡只读文档；实际缩进仍经过原只读/权限/冻结守卫。非source/safe、失效view及IME不启用此新增适配，既有默认路径不扩大改造。

修正后需用公开dispatcher红环加适配对照证明可到toggle，正式回归包括物理code条件、修饰键、只读逃逸与禁止缩进、IME/旧view不执行、清理；主线再构建下一包并真实复验原红路径、Tab/ShiftTab移出及恢复，不能仅据脚本通过放行。此节仅方案，尚未生产修正，116失败证据保留。

### alpha.116 收尾及获批修正候选

主线回报116构建成功hash `z5sh36cwux1q`，源码及包内Bun运行仓库测试各907/26220/146，typecheck/full lint/doc/diff通过，实际验收未完成。主线clean Cmd+Q退出，CUA报告App quit，PID7953已不存在；A SHA `3096a91c8fecf7ddcf248b97b4d6c19b712f64a520642588b04094ce26a70da8`、B SHA `7b571a5f241bfa7a5795cee0964434317f23cd64a25c7f481f628f710dd02bed`均原样。当前无运行现场；trace仅已读字段已记载，未读字段随退出不可再读，不补造完整捕获。

主线已阅读批准两项修正，现源码候选已实现：closing风险独立reason；新增`routeSourceTabFocus`在现有public handler内先识别Mac/物理KeyM/精确修饰键/当前普通源码与聚焦非组合条件，再调用公开toggleTabFocusMode，不借写权限阻止只读逃逸。MemoryEditor仍使用原当前view/state/session检查；缩进自身守卫未放宽。正式测试补拒绝文案及只读/不同物理code/平台/修饰键/组合/焦点/注册清理。

隔离`/tmp/agentic-f043d-tabfocus.zBuHri/fixed.ts`保留与原red.log分开，以生产适配+公开runScopeHandlers对照6组key=m/M/Â、readonly true/false全部handled true且toggle恰一次；原默认路径红历史仍保留。此为受控公开API，不是WK焦点实际离开证据。定向初10/576通过；补测试stub类型及includes lint小修，最终检查待下条记录，不预写通过。未更改版本/构建/UI/Git，下包由主线负责。

修正后最终定向40项/5512断言/5文件/440ms通过，typecheck及受影响eslint、diff检查通过。不会重复toggle的依赖源码证据：本地view6.43.12 `dist/index.js:9084`默认keymap的DOM处理器为Prec.default，本片为Prec.high；`:4568–4580`公开handler调用链遇true会preventDefault并break，不再调用默认keymap。只读取依赖实现以核对公开契约，没有调用其私有方法/状态。正式stub测试与隔离短路对照不能替代真实事件链，下一包仍须主线实际验证；当前为冻结代码候选，不宣称117已构建或通过。

### alpha.117 局部真实验证（主线回报，验收进行中）

构建成功hash `1kj4xu3ovzko6`，包 `/tmp/agentic-markdown-alpha117.R8Aosw/Agentic Markdown-canary.app`，exec6175 / PID9762运行。源码908项/26239断言/22.94s、包内Bun运行仓库测试908项/26237断言/21.64s分别记录，不混同断言数；typecheck/full lint/doc/diff绿，两轴0代码阻断不等于整体验收。

真实打开自建A文档源码，聚焦选择“alpha 中文”后Alt+Shift+m无内容变化；Tab焦点转HTML，ShiftTab返回editor，再ShiftTab到summary50、Tab返回。Alt+Shift+m关闭焦点模式后，选择alpha_code并Tab实际增加两空格、dirty；CmdZ回clean且保留selection，redo后ShiftTab回clean。选择四空格加四反引号内容行，ShiftTab整次不变、仍clean，专属“反缩进会改变代码围栏边界，未修改内容”提示已显示。

以上是主线受托工具实际WK验证，不是用户自然键盘亲验；未采真实事件code，不因行为转绿补造字段。其余验收仍进行中，当前无整片通过结论，不得Git；生产源码未为本段记录修改。

### alpha.117 追加范围、历史、输入法与只读实证

A两行范围Tab同时增加两空格，一次CmdZ回clean。紧接undo在同一工具调用中的selectText找不到文本；刷新AX后相同选择成功，保留为工具时序观察，原因未知，不认定产品已修或无关。选择包含开围栏` ```ts `及alpha_code的范围，Tab整次拒绝且clean。base_code用Cmd[不减少围栏基线；Cmd]增加两空格，再Cmd[回clean。

B打开源码second_code，Tab后dirty；切A仍保留base_code选区且clean。AX点B一次未切换，截图后坐标点B成功，B选区与dirty保持；B切编辑后CmdZ回clean。A光标置alpha_code前、Cmd+Alt+Down，截图确认两行光标；Tab两行同时加两空格，一次CmdZ回clean。上述两次工具定位/切换观察均保留，不扩称全部焦点时序已覆盖。

Escape简化后，A的alpha_code末输入n/i，实际蓝色下划线组合与控件禁用可见；Tab没有缩进，Escape取消后clean。这是工具驱动系统中文输入源，不是用户物理键盘亲验。

B临时chmod444后实际显示只读，源码Tab/Cmd]均不改正文。首次toggle前焦点未明确，之后一次ShiftTab仍editor，不据此归因。显式点击确认editor焦点后作两次toggle状态对照，最终Tab转HTML、ShiftTab两次转summary、Tab返回；toggle关闭后Tab/Cmd]留editor且clean。B已恢复644；A/B磁盘SHA均原样，未保存正文。

当前A/B均clean，B处于源码，PID9762仍运行；其余验收继续，未最终通过、不得Git。本段只补记录，不修改生产代码。

### alpha.117 最终候选收尾（待独立verifier与主线确认）

B权限恢复后实际显示可编辑clean。浅色设置值与截图确认源码、行号可辨，恢复深色设置值已读；未实测跟随系统动态切换。B注入实验解析故障进入safe，正文保留clean；聚焦选择second_code后Tab焦点移至HTML且不改正文，仅证明本片新增Tab处理在safe隔离，不宣称继承默认Cmd[]被禁。关闭clean的B回到A。

A在alpha_code执行Tab后dirty，CmdQ出现全部未保存确认；选择继续编辑，dirty和selection保留。CmdZ恢复clean，首次AX滞后，随后fullAX确认clean，保留工具读回先后差异。A普通段落“alpha 中文”Tab/ShiftTab均不改正文；paste paragraph_check准确替换选区，证明焦点保持，undo后fullAX确认clean。

最终CmdQ返回App quit，PID9762不存在；A/B原SHA一致，B权限为644。没有保存用户文件或测试正文，没有断网，当前无App运行现场。真实证据均为受托工具验证，不是用户物理键盘亲验。

本片非离线验收证据现为完成候选，待最终独立verifier及主线明确批准，尚不写整片通过或Git成功。自然物理输入、多键盘布局keycode、真实大规模UI/RSS/竞态、系统动态外观未实操，不扩大声明；最终离线留人工。完整父F-043、OBL-058/064与F-043d-offline-final仍开放，F-041c未获批产品成本保护及全部替换未夹带实现。生产源码未为收尾记录修改。

## 最终本片结论（2026-10-11）

最终独立verifier确认0剩余本片必要阻断，主线正式确认alpha.117非离线本片受托Agent代验通过，非用户亲验。Git待主线实际执行，不预写提交或推送成功。上文116失败、工具时序差异、真实字段未采与未实操边界全部保留；不以本片关闭父F-043、完整OBL-058/064或F-043d-offline-final，不改变F-041c/F-028c待决及专项设计范围。
