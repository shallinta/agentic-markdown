# F-026c：统一多根文件树呈现与导航

> 状态：2026-10-05 F-026c alpha.92非离线本片正式通过。用户自然Space必要路径亲验，其余受托Agent代验；最终独立verifier 0剩余阻断，主线确认通过。Git待实际执行，不预写成功。既有失败、未实操边界和父功能/完整义务/最终离线人工保持开放；下一F-027b仍仅规划。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## 功能说明与范围

将当前分离的目录树与独立文件列表合并为一个树视图、一个滚动容器和统一选择/键盘导航。目录根和 standalone Markdown 文件都是真正的同级顶层 treeitem；目录根可展开/收起，独立文件保持叶子。复用已经授权的文件集合与安全扫描结果，不新增扫描、授权或正文副本。

沿用 F-025a 当前切片行为：单击只选择，不创建标签；文件双击或 Enter 持久打开，已打开文档只激活并保留模式/dirty/选区/历史。目录操作只改变呈现展开状态，不打开文档、不修改磁盘。临时预览仍由 F-032 后续接入，不在本片冒称实现。

来源为当前基础结论 7–10、W-02/W-03/W-05、F-025a 与 F-026 当前范围。顶层拖放排序属于 W-15 / F-061，本片不实现拖动或修改顺序。当前数据仍是目录 roots 顺序、standalone entries 顺序与扫描节点顺序；合并视图时保留已有目录段后独立文件段的相对显示顺序，不新增按名称、修改时间或跨类型加入时间排序，也不把该继承顺序冻结为最终产品规则。

## 依赖与后续责任

- 硬前置：F-025a 安全多根集合与扫描，F-026a 隐藏策略，F-026b 侧栏布局，F-011 和当前已验收打开路由。
- 本片无 OBL 主承接或关闭责任。协作检查 OBL-008 的同源过滤展示，其唯一主承接仍是 F-025；不关闭完整父 F-026 或其他完整义务。
- F-061 继续负责顶层根排序/移除；F-029 负责跨重启根与树恢复；F-032 负责预览/区域路由。目录监听、虚拟化、完整无障碍专项和其他性能收敛不由本片宣称完成。
- F-028c 自动刷新因撤销历史产品决定待确认而暂停，本片完全独立，不通过“历史为空”子集绕过该决定。

## 最小技术方案

1. 用纯展示投影将现有 folder roots、安全扫描节点与已过滤 standalone entries 汇合为统一可见树序列。沿用现有覆盖去重和显式隐藏独立文件例外，`.git` 始终排除；不新建第二份文件清单或自行推断授权。操作仍携带服务 opaque handle，displayPath 只用于展示及已有去重关联，不成为授权输入。
2. 统一选择与焦点模型，目录根作为层级 1 的节点，子节点层级递增，standalone 文件同为层级 1。目录根默认保持此前已展开呈现；用户收起只隐藏后代，不撤销集合、扫描、授权或打开状态。一个实际 tree 与一个树内容滚动容器，不仅通过样式伪装原来的多个 tree。
3. 上下方向键跨所有可见节点移动选择/焦点；右键展开目录或进入其已可见首个子节点，左键收起已展开目录或定位父节点；Home/End 定位首尾，Space 仅选择，不打开或展开；树节点采用单一 Tab 入口（roving tabIndex），根操作按钮另保持可达。文件 Enter 打开，目录 Enter/双击切换展开，单击仍仅选择。IME、冻结与权限上下文沿用现有保护；不增加树拖放或隐式预览。
4. 根的隐藏开关和重新扫描继续走已有命令/服务，保留可访问的独立按钮，不把操作按钮嵌入另一个按钮或让其事件同时选择/展开根。状态提示准确保留 scanning/complete/partial/paused/failed 及空根反馈，不把尚未扫描完当作没有文档。
5. 状态只属于当前运行窗口。扫描 generation 变化、隐藏项移除、父根覆盖吸收或集合清空后清理失效 handle；如果焦点原本在已失效树节点，恢复到仍存在的所属根或最近有效树入口。开关按钮仍存在则保留其焦点；焦点在正文/其他控件时不自动抢回树。保留有效节点的选择和展开，不将路径关联当 documentId 跟随或授权恢复。
6. 侧栏隐藏/展开沿用 F-026b，不因统一树卸载文档或清空集合；层级投影和导航不触发正文解析/保存。记录真实数据规模、呈现节点与交互观察，不据本片宣称实现树虚拟化或大工作区性能目标。

主线实现前补充：展示投影按来源 snapshot memo，使用可见文件 displayPath Set 与 coveredHandles Set，替代每个 entry 对全部节点的嵌套扫描。只有 coveredHandle 且实际树中已经存在对应文件时才吸收 standalone 叶，不能仅凭目录覆盖隐藏显式独立隐藏文件；该路径集合仅用于展示去重，不用于授权。

## 最小 happy path 与边界验证

- 同一窗口加入两个目录根和独立文件：一个树/一个滚动容器，同级顶层项清晰；目录可折叠，根间与独立文件间键盘导航连续。
- 单击文件/目录只改变选择；双击/Enter 打开现有文档不产生重复实例，模式、dirty、选区与撤销历史保持。目录 Enter/左右键仅展开、收起或定位，不打开文件。
- 子根/独立文件被父根覆盖吸收后依然只显示一次；显式隐藏独立文件例外与 `.git` 硬排除不变，路径不被作为操作授权。
- 隐藏开关和重扫的 generation 换代后，不保留可操作的陈旧 handle；被删除/隐藏的聚焦项回到有效树入口，正文焦点不被后台更新抢走，独立开关操作不同时折叠根。
- 空、扫描中、partial、失败根及同名不同路径文件反馈准确；不新增排序和拖放。侧栏隐藏再展开保留当前有效树状态，不触发文档变化。
- 自动测试覆盖投影、导航、失效状态及命令回归；真实 WK 验证混合根、跨根键盘、鼠标展开、开关焦点、dirty 文档保持和浅/深外观。区分自动语义检查与真实操作，不声称完整 VoiceOver 专项已完成。

## 继承约束检查

- F-002：使用现有本地集合与扫描，不写文档或联网；离线实测留最终人工。
- 中文与外观：中文根状态、操作控件及焦点/选择在当前浅/深/系统外观下清晰，沿用已有样式，不扩大主题功能。
- 命令与键盘：原打开/隐藏/重扫入口不绕过命令和冻结/IME 保护；树导航提供键盘等价，不加入临时预览、拖动或磁盘移动。
- 安全与日志：不改授权/路径规则、不访问额外文件、不执行内容；仅用已核验 handle 操作，清理陈旧节点，不新增正文或路径日志。

## 最终人工待验：F-026c-offline-final

真实离线统一树导航与打开链路留最终统一人工，本片不断网、不执行进程隔离、不标离线通过。该待验入口不阻塞非离线范围交付，完整功能责任保持开放。

## 实际改动与验证

### 实现内容

- 新增纯展示 `workspace-tree-model.ts`，统一 roots、扫描节点和 standalone entries；投影随来源 snapshot memo，覆盖匹配使用 Set，不在正文每次编辑时重复全树投影。节点携带原 opaque handle，路径仅沿用展示去重，不新增授权来源。
- `WorkspaceTree` 改为一个实际 tree、一个滚动容器，根目录和独立文件同为层级 1；保留来源顺序、根状态、隐藏开关和重扫入口。折叠不删除集合；目录展开仍只使用已有 prioritize，未新增 rescan。
- 合并选择、跨根导航、Home/End、Space 仅选择与 roving Tab 入口。清理失效节点，并仅在树原本持有焦点且旧节点消失时寻找有效父级/根/首项；正文或外部控件持有焦点时不主动抢回。该焦点行为仍须真实 WK 验证，模型/SSR 测试不代替实操。
- 保留 standalone 原有冻结保护，独立于目录选择操作的 busy/save 禁用条件，避免本次统一 UI 意外禁止保存期间激活已经打开的独立文档。
- 独立 Standards 预审指出的 Home/End、单一 Tab 入口及宽目录 spread 参数上限问题已修正；遍历改用迭代及逐项入栈。未实现最终排序、预览、拖放、会话恢复、授权恢复或树虚拟化。

### 自动验证与证据边界

- 新增 6 项 / 42 断言：统一层级和源顺序、覆盖与显式隐藏文件例外、跨根导航及 Space、generation 换代焦点回退、宽/深树遍历、SSR 单树/单滚动/单 Tab 入口及 standalone 独立禁用条件。宽 150000 节点、深 5000 层仅为合成模型安全测试，不是实际工作区性能目标或真实窗口交互测量。
- 初次测试 fixture 把函数式 workspace request 误写为对象，测试未调用该接口但 typecheck 揭示签名错误，现已修复；随后 lint 揭示 import 分组与正则调用规范，两项均已修复。不将此前失败检查记作通过。
- 最终格式化后 `bun run typecheck`、`bun run lint`、`bun run check:obligations`、`git diff --check` 均通过；全量 `bun test` 738 项 / 19307 断言通过（120 文件，14.96s，临时日志 `/tmp/agentic-f026c-executor-final-tests.log`）。此前同规模一次为 15.04s，仅记录实际运行，不比较为性能收益。执行者未构建、未进行真实 UI 代验、未执行 Git，不冒称窗口路径或离线验收通过。
- 独立 Spec / Standards 的最终结果与主线构建、真实 WK 验收另由对应执行方补齐。父 F-026、完整 OBL-008 及后续预览/排序等责任保持开放；`F-026c-offline-final` 保持最终人工待验。

### alpha.85 构建与真实 WK 局部检查点（2026-10-05）

独立代码 Spec / Standards 最终均 0 阻断：Spec 复跑 38 tests / 340 assertions；Standards 复跑 20 tests / 94 assertions（3 文件），未以模型/SSR 结果代替真实交互。主线构建 exit 0，日志 `/tmp/agentic-f026c-build85.log`；包目录 `/tmp/agentic-markdown-alpha85.0NnmM9/Agentic Markdown-canary.app`，版本 `0.1.0-alpha.85`，hash `27igvuxvdmmhz`。包内 Bun 执行仓库测试 738 pass / 0 fail / 19307 assertions，120 文件、13.88 秒，日志 `/tmp/agentic-f026c-packaged85.log`。

主线实际启动 PID `46708`，CUA 已见欢迎页、空统一树、侧栏 26.4；文件选择器曾出现，但尚未成功打开本轮样本。后续工具调用分别约 78 / 77 / 79 秒后出现 stale-state，点击调用 120 秒超时。以上为工具调用观察，根因未知，不推断应用失去响应、锁屏或启动/文件读取性能，不将选择器出现等同文档已打开。

本片仍未验收、不执行 Git；主线继续按间隔重试恢复代验，不改变网络或执行隔离。混合根、跨根导航、焦点恢复、控件交互、正文状态保持和外观等真实路径仍待验证；完整父 F-026 / OBL-008、后续预览/排序与 F-026c-offline-final 保持开放，F-028c 撤销历史仍待用户决定。

后续首次确认 cover.md 后，应用实际显示“文档通信失败或返回结果无效，请重试或重新选择文件。”，文件树仍空，不能记录为打开成功。再次打开选择器期间，多次 native 操作 120 秒超时、AX 状态约 78–90 秒后 stale；随后 setValue 的 focusedPath 已读回确认为 `/tmp/agentic-f026c-F5TULE/alpha/cover.md`，目标文件被选中且 Open 已启用。点击 Open 再次 120 秒超时，之后 getAXAndScreenshot 30 秒超时并重置工具 kernel。仍无文件成功打开证据。

应用错误与工具错误分别保留，原因未知，不归因为锁屏、网络、特定应用缺陷或性能表现。主线继续间隔约 20 秒重试，不断网、不扩大验收结论；本片未验收、不得 Git。

随后按应用路径 getApp 再次 120 秒超时；按 bundle ID 获取应用 30 秒超时并重置工具。主线实际 ps 仍见 PID `46708` 为 sleeping，应用现场保留；进程存在不证明窗口可响应，也不说明超时根因。

主线已为当前线程建立 ACTIVE heartbeat（周期续接）自动化 `agentic-markdown`，每 10 分钟恢复已获授权的本任务；首次创建因缺少 destination 失败，补充 destination=thread 后创建成功。它仅提供续接机制，不增加产品决定、验收、Git 或系统网络操作权限。本片仍未验收、不得 Git；F-028c 撤销历史仍待用户决定。

### heartbeat 续接局部进展（2026-10-05，01:50 后）

主线重新绑定 alpha.85 成功，先实际读取欢迎页空树与此前通信错误。打开选择器及选择 cover.md 的工具调用各约 78 秒；随后 Open 点击约 3.6 秒成功返回应用，首次确认本轮样本已打开：统一树顶层叶 `cover.md`，展示路径 `/private/tmp/agentic-f026c-F5TULE/alpha/cover.md`，一个持久标签，编辑模式显示完整 108 字节样本、clean，焦点在编辑器。界面请求耗时 171524ms 包含选择器与工具等待，不作为文件读取性能。

随后点击加入文件夹 120 秒超时，尚无加入结果核验。本节仅补齐独立文件打开局部路径，不覆盖此前失败记录，不等同混合根及统一导航验收。仍未验收、不得 Git；继续窗口代验，不改代码/版本、不重新构建，父功能、离线最终人工与 F-028c 待决定保持。

本次续接末尾重试：等待约 20 秒后，getAX 与截图调用 88.66 秒返回，仍实际显示 cover.md 编辑模式 clean，未见文件夹加入结果；随后改点正文已有“加入文件夹”入口（当次 AX index 70）仍在 120.14 秒超时。未据点击本身认定文件夹已加入。本次 heartbeat 不再操作 UI，保留现场，由既有 10 分钟续接机制继续；这不是验收通过或 Git 放行，工具延迟原因仍未知。

### heartbeat 续接局部检查点（2026-10-05，02:01 后）

getApp 约 113 秒返回目录 Open 选择器，说明此前点击最终产生了选择器，但不代表目录已加入。CmdShiftG 约 77.58 秒返回 stale-state；AX 与截图约 79.34 秒显示 Go To。setValue 约 78.46 秒后读回路径 `/tmp/agentic-f026c-F5TULE/alpha`；Return 约 2.52 秒后确认 alpha 被选中且 Open 启用。点击 Open 约 121.97 秒超时；等待约 20 秒后的 AX 与截图调用再次 30 秒超时并重置工具 kernel。

本次没有目录成功加入结果，不能据选择器状态宣称混合根或覆盖去重通过。当前已确认的窗口产品路径仍仅此前 cover.md 打开；以上为工具时序，不是读取/扫描性能，也不推断超时根因。无代码、版本、构建或 Git 操作，仍未验收、不得 Git；保留现场由既有 heartbeat 继续。完整父功能、离线最终人工和 F-028c 产品决定待用户状态不变。

2026-10-05 02:13 后续接：以 alpha.85 精确应用路径 getApp，120.28 秒超时；等待约 20 秒后重试同路径，30.01 秒超时并重置工具 kernel。未取得新产品状态，仍无目录加入结果证据，不改变此前 cover.md 局部结论；原因未知，不作为性能测量。既有 heartbeat 继续重试，本片未验收、不得 Git；本次无代码、版本、构建或 Git 操作。

### alpha.85 目录与导航局部进展（2026-10-05）

真实窗口已确认 alpha 目录加入；此前独立顶层 cover.md 被吸收，只在目录内显示一次，原 cover clean 标签保留。根 Left 收起、Right 展开，End 移至 section，Right 展开后再 Right、Enter 打开 detail；detail 为 74 字节、clean，cover 标签仍在。以上为已实操局部路径，不补写其他混合根或完整代验通过。

新观察：根的隐藏开关与重扫按钮在截图可见，但 AX 未暴露；根行点击后连续 Tab 两次移至 splitter。平台键盘策略与树结构仍在排查，尚不认定根因。随后根点击并 Left、确认焦点后，使用 alt+Tab 再按小写 space，截图隐藏开关变为“隐藏：显示”，根仍收起、detail 仍 clean；这证明至少隐藏开关存在已实操的替代键盘路径，不能继续描述成完全不可键盘到达。AX 控件缺失及重扫等路径仍待修复或核验，未宣布通过。

工具曾因大写 Space 报 keyNotFound，改用小写 space 后成功；该错误属于工具按键名称，不是应用异常。AX 正文出现 `#**标题**` 文本，但界面仍为 74 字节 clean、截图正常，不能据此声称正文已修改。点击与按键工具调用约 85 秒，只记录工具时序，不作为应用性能测量。

本次无生产代码、版本、构建或 Git 操作。其余真实路径、完整父功能与离线最终人工保持开放；F-026c 仍未验收、不得 Git，F-028c 撤销历史仍待用户决定。

### alpha.86 AX 结构修复及局部复验（2026-10-05）

补充 alpha.85 实证：主线再次展开 alpha，AX 已见 .secret.md、same、cover 与 section，没有 .git，进一步证实此前 alt+Tab、space 确实切换隐藏项；该旧包局部结果不冒充新版复验。

修复将 treeitem 从 button 移至 li，隐藏开关及重扫仍为独立 button；click/doubleClick 排除按钮后代，keydown 限当前 treeitem，避免根操作按钮事件同时选择/展开根。roving、显式 disabled guard 与焦点 ref 同步调整。独立 Spec 6 tests / 46 assertions、Standards 20 tests / 98 assertions，无新增源码阻断；静态/SSR 检查并不自行证明 WK AX 暴露已修复。

源码测试 738 pass / 0 fail / 19312 assertions、15.68 秒，日志 `/tmp/agentic-f026c-ax-source-tests.log`；包内 Bun 执行仓库测试 738 pass / 0 fail / 19311 assertions、14.03 秒，日志 `/tmp/agentic-f026c-packaged86.log`。断言数分别按实录，不强行一致。alpha.86 构建 exit 0，日志 `/tmp/agentic-f026c-build86.log`；版本 `0.1.0-alpha.86`，hash `2lc8ypl2d619x`，包 `/tmp/agentic-markdown-alpha86.8YKBz3/Agentic Markdown-canary.app`，PID `51028`。旧包经 super+Q 后 ps 确认 PID 46708 不存在，两个样本 hash 不变。

新包真实欢迎页版本 alpha.86、侧栏宽 26.4。选择目录过程中工具长延迟，点击 alpha 120 秒超时；等待约 20 秒后截图确认 Open 启用，坐标点击 Open 约 3.45 秒后成功加入 alpha。AX 此时明确出现 row 58 下的 switch 61“alpha：显示隐藏文件”（on）与 button 62“alpha：重新扫描”，根状态扫描完成；.secret 出现，无 .git。该证据支持本次 AX 暴露修复路径，不扩大为完整混合根、generation 换代、dirty 或其他产品验收。

随后点击 switch 61 再次 120 秒超时，结果仍待核验，不能声称隐藏切换复验通过。工具时序不作为应用性能测量，未执行网络操作或 Git。F-026c 未验收、不得 Git；父功能、完整义务、离线最终人工及 F-028c 撤销历史待决定状态保持开放。

本次最后重试：switch 点击实际 120.18 秒超时后等待约 20 秒，再次 getAXStateAndScreenshot 调用 126.62 秒超时，仍未取得开关结果。保留 alpha.86 / PID 51028 运行现场，由既有 heartbeat 后续重试；不据超时推断切换失败或成功，不扩大验收，仍未验收、不得 Git。

### alpha.86 重扫、dirty 保持与键盘目标差异（2026-10-05，02:57 后）

本次 heartbeat getApp 约 94.75 秒成功，实际显示隐藏 switch 为 off、.secret 隐藏且根展开，证实上次超时点击最终已生效。树中 cover 经点击、Enter 打开，108 字节、clean；随后在尾部粘贴“F-026c alpha86 临时未保存验收标记。”，变为 dirty，仅修改临时样本的内存正文，没有保存。点击重扫后显示扫描完成，根展开及 dirty 标记保留；坐标点击隐藏开关后为 on，.secret 出现。

键盘观察必须与上述鼠标路径区分：确认根焦点，执行 Right、Left、alt+Tab 后，AX 焦点显示 switch 15 或 rescan 16，但下一次小写 space 给正文尾部追加空格，switch 未变。分开工具调用重复两次、同次调用组合一次均出现，三个空格保留在临时内存正文。最后在同次调用内 root Right、Left、alt+Tab、Return，实际 switch 变为 off、根仍收起，正文没有新增换行。这说明不能概括为所有键盘操作失败，也不能宣称 Space 已通过。

当前 CUA/AX 报告焦点与实际 DOM 键盘目标可能存在差异，根因尚未确定，不据此直接认定应用错误。独立 executor 只读检查未找到 window focus 时恢复编辑器焦点或把普通字符全局转送的代码；源码未找到路径不等于排除运行时问题，下一步仍需实际事件目标证据。

保留 alpha.86 / PID 51028 及临时 dirty 正文，不保存或清空。此轮无生产代码、版本、构建、Git 或网络变更；工具长延迟不作为应用性能。本片未验收、不得 Git，其他真实路径、完整父项、离线最终人工及 F-028c 产品决定待用户保持开放。

主线本轮核验 cover 磁盘 SHA-256 仍为 `dd892cc5a5190572ebf43686ca4a9013de9aeef30c5da8107cf8d1e8649a5479`，临时样本未保存；`git diff --check` 通过。该磁盘核验与内存 dirty 状态分别记录，不以磁盘未变抹除临时内存输入。

### 最小事件目标诊断方案（2026-10-05，主线批准、尚未实现）

目的仅为核对同一键盘路径中 Space 与 Enter 的真实事件目标，区分 CUA/AX 焦点信息与实际 DOM 输入落点；不预判根因，不直接修改生产树或编辑器交互。本诊断是本片验收问题的局部证据工具，不新增正式用户功能。

1. 复用既有 `AGENTIC_MARKDOWN_EDITOR_FAULT_LAB` opt-in（主动启用）实验台；默认不安装事件监听，即使实验台可见也需显式开始采集。提供开始、停止并展示、清空入口。
2. 内存仅保留最近 128 条记录，使用有界队列。记录字段只允许事件类型、白名单按键及 inputType、固定事件目标类别、临时 WeakMap 元素编号、activeElement 固定类别、hasFocus 与修饰键标志。未知按键/输入类型只归入固定类别，不记录任意字符串。
3. 不采集正文、事件 data、路径、文件名、aria-label 或其他能还原用户内容的属性；不通过 RPC、网络、日志或持久化输出记录，不读取 Markdown 内容。元素编号只用于本次内存采集关联，不作为跨会话身份。
4. 采集期间只写内存，不为每条事件实时触发 React render；停止后展示固定快照。停止和卸载都移除全部监听，清空移除记录；重复开始/停止不叠加监听。采集不阻止默认事件、不改焦点、不发送替代键盘事件。
5. 自动验证默认无监听、128 条边界、字段白名单/敏感信息排除、重复启动与停止/卸载清理，以及停止后才展示。真实 alpha 包中按相同根焦点→Right/Left→alt+Tab 路径分别操作 Space 与 Enter，对照事件 target、activeElement 和正文/开关实际结果，保留不一致而不据单次记录提前归因。

现有临时 dirty 现场不得保存或清空；如诊断构建必须切换进程，先由主线按既有丢失保护处理现场，不能把“清空诊断记录”误作清空正文。诊断代码交付后依原 alpha 规则构建、复核，真实事件证据仍待取得。本方案已获主线批准，executor 可据此实施；F-026c 仍未验收、不得 Git，父项、离线最终人工及 F-028c 撤销历史待用户状态不变。

随后主线为下一诊断包正常退出 alpha.86：super+Q 实际出现全部未保存变更放弃确认，主线明确选择放弃，仅丢弃本轮 Agent 加入临时样本的验收标记及三个空格，不保存正文。ps 已确认 PID 51028 不存在；cover 磁盘仍沿用此前核验的不变 hash 证据，不冒称新增一次哈希测量。当前不再保留旧运行/dirty 现场，以上“保留现场”是退出前检查点，诊断真实验证尚未开始。

### alpha.87 opt-in 诊断交付与局部检查点（2026-10-05）

已实现只在既有故障实验台内显式启动的内存事件诊断，默认无监听，最近 128 条元数据、固定字段/类别、停止后展示与清空，停止/卸载清理；采集期不按事件更新 React，不新增 RPC、网络、日志或持久化。独立 Spec / Standards 各复跑 9 tests / 71 assertions，均无源码阻断。本工具只协助定位焦点，不是正式产品能力或生产交互修复；capture 阶段记录的 prevented 仅表示当刻值，不证明后续处理器或事件终态是否阻止默认行为。

源码全量 741 pass / 0 fail / 19336 assertions，121 文件、15.45 秒，日志 `/tmp/agentic-f026c-focus-trace-tests.log`。alpha.87 构建 exit 0，日志 `/tmp/agentic-f026c-build87.log`；版本 `0.1.0-alpha.87`，hash `a51hkxcp4gl`，实际包 `/tmp/agentic-markdown-alpha87.OUBm3x/Agentic Markdown-canary.app`，PID `53272`。包内 Bun 执行仓库测试 741 pass / 0 fail / 19337 assertions，121 文件、14.32 秒，日志 `/tmp/agentic-f026c-packaged87.log`；断言差异分别按实录，不抹平。

真实 WK 欢迎页已见开始、停止并显示、清空诊断入口，但未开始采集。加入目录与 CmdShiftG 路径有工具延迟，最终 Go To 路径已读回 alpha，Return 后 alpha 被选中且 Open 启用；点击 Open 120.74 秒超时，等待约 20 秒后 AX 与截图 30.02 秒超时并重置工具 kernel。尚无目录加入结果，也无真实事件 trace；不以入口可见证明诊断已取得根因，不以工具时序作为应用性能。

当前保留 alpha.87 / PID 53272 现场，由既有 heartbeat 续跑；自动化提示中旧 alpha.85 信息须以最新 AGENTS 检查点覆盖，不重复操作旧包。Space 根因仍未确定、未修复，完整 F-026c 未验收、不得 Git；父项、离线最终人工及 F-028c 待用户产品决定继续开放，alpha.86 正常退出并确认丢弃 Agent 自造标记的历史不变。

### alpha.87 heartbeat 续接检查点（2026-10-05，03:26）

getApp 约 89.13 秒成功返回，真实读回 alpha 已加入、根展开且扫描完成；隐藏 switch 为 off，重扫 AX 可见，子项 same、cover、section 可见，诊断入口存在，尚未打开文档或采集 trace。该读回补齐上一检查点未知的目录加入结果，不删除此前超时记录。

随后点击 cover（当次 AX index 19）被工具立即拒绝，返回“Computer Use is not active ... first call get_app_state”；未调用未文档化 API。改用文档化 getAXState 后 120.01 秒超时，等待约 20 秒后按相同应用路径 getApp 再次 124.13 秒超时。未获得新的打开或诊断结果，不将工具错误归因为应用问题或性能。

保留 alpha.87 / PID 53272 现场，既有 heartbeat 继续；无真实 trace，Space 根因未知、未修复，F-026c 未验收、不得 Git。此轮无代码、版本、构建或网络操作，父项、离线最终人工及 F-028c 待用户决定不变。

### alpha.87 首次事件记录局部证据（2026-10-05，03:36）

本次成功打开 cover，108 字节、clean。点击开始采集在 120.17 秒超时；等待约 20 秒后 AX 无变化，但截图确认正在采集。随后 root 点击、Left、alt+Tab、工具 pressKey(space)，正文变为 dirty。首次停止操作未成功；刷新完整 AX 后改点正确停止入口（当次 index 29），最终停止采集并保留 16 条记录。

AX 文本截断只提供前 500 字，主线逐屏截图读取了以下片段，未完整读出的字段不补造：

- seq 1，t=173125：focusin，target tree-item 1，active 1。
- seq 2，t=173279：click，target tree-item 2，active 1。
- seq 7，t=173322：focusout，target tree-item 1，active other 3。
- seq 8：focusin，target root-switch；其他字段未完整读取。
- seq 9，t=173400：beforeinput，target editor 5，active root-switch 4，trusted=true、hasFocus=true、prevented=false、inputType=insertText、composing=false。
- seq 10，t=173407：focusout，target root-switch 4，active editor 5。
- seq 13，t=173407：keydown，target editor 5、active editor 5；key 未完整读取。
- seq 16，t=359883：click，target lab 6、active other 3。

相邻 seq 8 到 seq 9 之间没有 keydown：该次记录显示 DOM activeElement 仍为根开关时，editor 先收到 insertText，随后开关失焦、编辑器取得焦点。不能据工具调用名把它当作自然 Space 的开关激活验证，也不直接归因工具或框架；本片尚未查明原因、未修复。capture 的 prevented=false 仍只代表捕获当刻，不证明事件最终行为。

读记录期间多次 scroll 调用 120 秒超时，等待约 20 秒后的截图才恢复；失败历史保留，时序不作为应用性能。诊断已经停止，保留 16 条内存记录和临时 dirty 样本，不保存或清空。此轮无生产代码、版本、构建、网络或 Git 操作，F-026c 未验收、不得 Git，父项、离线最终人工与 F-028c 待决定保持开放。

独立诊断边界补充：上述 seq 8→9 应精确解释为“本采集器未观察到 keydown”，不等于证明系统没有发生 keydown。trusted=true 不证明自然键盘输入，capture prevented 不是事件终态；早期较短措辞以本条精确边界解释，不扩大因果结论。

后续实际补读：seq 13 的 alt/ctrl/meta/shift/composing 均为 false，key 仍未读到；seq 14，t=173553，为 keyup，target 与 active 均 editor 5，hasFocus=true、trusted=true，其余字段未完整读取。再次 scroll 120.24 秒超时，等待约 20 秒后截图 99.3 秒恢复；最后微拖滚动条 121.17 秒超时。仍只记录工具时序，不作为性能。

保留已停止的 16 条 trace 和临时 dirty 样本；下一次续接先读取现有 seq 8、11–15 尚缺字段，不重启采集或清空覆盖。后续同路径 Enter trace 对照须先保存当前已读证据（诊断记录，不是保存临时 Markdown 正文）。本次无代码、版本、构建、Git 或网络变更；未验收、不得 Git。

主线本次再次实际 shasum 核验 cover 为 `dd892cc5a5190572ebf43686ca4a9013de9aeef30c5da8107cf8d1e8649a5479`，磁盘未变而临时内存 dirty 保留；diff 检查通过。

### alpha.87 既存记录字段补读（2026-10-05，04:13）

getApp 53.02 秒成功返回，alpha.87 的 cover dirty 及已停止的 16 条 trace 仍保留。随后截图调用 81.45 秒返回，明确读到 seq 14 起始前的 seq 13 字段 key=Space；结合此前已读记录，该项为 t=173407 的 keydown，target 与 active 均 editor 5，alt/ctrl/meta/shift/composing 均为 false。此前“key 未读到”保留为当时读取边界，本次仅补齐该字段。

seq 13 的 Space keydown 在已读 seq 9 beforeinput 之后；不因此证明自然键盘来源，也不直接归因工具或框架。seq 8、11–12、14–15 的完整字段及同路径 Enter 对照仍待补证。

随后 scroll up 0.5 调用 120.72 秒超时，等待约 20 秒后截图 96.77 秒恢复，但回到 seq 7–8 片段，没有新增事件结论；以上是工具时序，不是应用性能测量。保留已停止的 16 条记录与临时 dirty 样本，不清空、不保存。本次无代码、版本、构建、Git 或网络修改，原因未知、未修复、未验收、不得 Git；父项、离线最终人工及 F-028c 待决定仍开放。

本次后续 scroll down 0.3 调用 120.28 秒超时，等待约 20 秒后 AX 与截图 62.40 秒恢复，读回 seq 10 的既有字段，并新增读到 seq 11：t=173407、type=focusin、target=editor；其他字段未完整读取，不补造元素编号或 active 值。随后 scroll down 0.15 再次 120.26 秒超时，尚无新结果。该局部补读不构成根因结论或性能测量；继续保留已停止的 16 条 trace 与临时 dirty 正文，不保存或清空，未验收、不得 Git。

### alpha.87 既存记录继续补读（2026-10-05，04:27）

本次 getApp 2.21 秒恢复连接，多个 screenshot/scroll 调用在约 0.3–2 秒返回；仅记录本轮工具恢复，不推断此前问题已解决或作为应用性能。现有 16 条停止记录及 cover dirty 仍保留，连续截图补读如下：

- seq 11：t=173407，focusin，target 与 active 均 editor 5，hasFocus=true、trusted=true、prevented=false。
- seq 12：t=173407，input，target 与 active 均 editor 5，hasFocus=true、trusted=true、prevented=false、inputType=insertText、composing=false；字段由连续截图读取。
- seq 8：target 与 active 均 root-switch 4，hasFocus=true、trusted=true；prevented 尚未完整读取。

seq 14–15 仍未完整，Enter 对照尚未进行；trusted 与 capture prevented 的既有证据边界不变，不补造未读字段或因果结论。最终滚动回到 seq 7 附近，多次滚动距离不符合预期，原因未定。保持原 16 条及临时未保存现场，不保存、不清空；本轮无生产代码、版本、构建或 Git 变更，根因未知、未修复、未验收、不得 Git。

后续拖动诊断滚动条成功定位，补齐 seq 14–15：seq 14，t=173553，keyup，target 与 active 均 editor 5，hasFocus=true、trusted=true、prevented=false、key=Space，alt/ctrl/meta=false；shift=false 位于一张截图底部，composing=false 从下一张截图读回。seq 15，t=263486，focusout，target=editor 5、active=other 3，hasFocus=true、trusted=true、prevented=false。当前视口位于 seq 15，记录仍停止且未清空；Enter 对照和根因调查仍开放，不改变未验收、不得 Git 的结论。

继续补读前段原记录，当前截图定位在 seq 6：

- seq 3：t=173318，keydown，key=ArrowLeft，target 与 active 均 tree-item 1，hasFocus=true、trusted=true、prevented=false；alt/ctrl/meta/shift/composing 均 false，由前后两张截图读取。
- seq 4：t=173321，keyup，key=ArrowLeft，target 与 active 均 tree-item 1，hasFocus=true、trusted=true、prevented=false、alt/ctrl/meta=false；shift/composing 尚未完整读取。
- seq 5：t=173321，keyup，key=Tab，target 与 active 均 tree-item 1，hasFocus=true、trusted=true、prevented=false、alt=true、ctrl/meta=false；shift/composing 尚未完整读取。
- seq 6：t=173322，keydown，key=Tab，target 与 active 均 tree-item 1，hasFocus=true、trusted=true、prevented=false、alt=true、ctrl/meta/shift=false；composing=false 已从此前截图读回。

该采集序列中 Tab keyup 记录早于 Tab keydown，仅作为已观察到的记录次序，不据此推断 CUA 或系统根因。原 16 条停止记录不清空，dirty 正文不保存；未实施生产修复，仍未验收、不得 Git。

### alpha.87 Enter 对照尝试与快照更替（2026-10-05，04:27 后）

原 Space 已读关键字段落档后，主线点击开始并确认采集中，执行坐标根点击、Left、alt+Tab、Return，再停止并确认已停止。本次新采集替换了内存中的原 16 条 Space 记录；原记录以此前已落档字段为限，尚未读到的局部字段不补造。隐藏开关仍 off，正文仍 dirty 且未保存。

新对照序列已读如下，不与原 Space 的同编号混用：

- seq 1：t=7552，focusin，target 与 active 均 tree-item 1。
- seq 2：t=7594，click，target tree-item 2、active tree-item 1。
- seq 9：t=7656，window blur，targetId=null、active other 3，hasFocus=false、trusted=true、prevented=false。
- seq 11：t=7670，keydown，key=Enter，target 与 active 均 other 3，hasFocus=false、trusted=true、prevented=false；alt/ctrl/meta/shift/composing 均 false。
- seq 12：t=7670，keyup，target=other 3（targetId=3），末尾 key=Enter、alt/ctrl/meta/shift/composing 均 false；active 及中间 hasFocus/trusted 等字段未完整读取。
- seq 13：t=13800，window focus，active other 3；其余字段未完整读取。

此次 Enter 不能作为有效的根开关对照通过证据，失焦原因未确认；alpha.86 的旧 Enter 成功路径仍仅属于旧版，不替代本次验证。当前保留新对照的停止快照、seq 13 视口及临时 dirty 正文，不保存、不清空；不实施生产修复、不 Git，F-026c 仍未验收。

随后读到快照结尾，确认新 Enter 对照共 14 条：末条 seq 14，t=13852，click，target=lab 5、active=other 3，hasFocus=true、trusted=true、prevented=false。当前视口位于该末条，14 条停止快照继续保留，不改变上述对照无效及未验收边界。

最后补齐新对照 seq 13：t=13800，window focus，targetId=null、active=other 3，hasFocus=true、trusted=true、prevented=false。当前视口回到 seq 13，停止的 14 条记录和 dirty 正文继续保留，未保存或清空；本检查点至此收口，未验收、不得 Git。

下一取证建议（独立 next_planner 提出，尚未执行）：新一轮采集时将操作拆为根点击/Left → 单独 alt+Tab → AX 检查开关焦点 → 仅事前焦点到开关时 Return → 停止并读取 trace。AX 仅作事前检查，须 trace 中 Enter 的 target/active 确为开关且 hasFocus=true，才构成有效开关对照；不连续追加按键、不重做 Space、不修改生产交互。

### alpha.87 分步 Enter 有效对照（2026-10-05，04:39）

本次实际执行上述分步建议：开始并确认采集 → AX 点击根（当次 index 12）及 Left，确认 AX 焦点为根 → 单独 alt+Tab，确认 AX 焦点为隐藏开关（当次 index 15，off）→ Return，AX 读回开关 on → 停止并确认已停止。每步独立执行。当前 alpha 根仍收起、隐藏开关 on，cover 仍 dirty，未保存。

新采集替换了内存中的首次 Enter 14 条，当前共 13 条停止记录，视口位于末条 seq 13。新序列已读字段如下，不与前两次记录混用：

- seq 9：t=14998，keydown，key=Enter，target 与 active 均 root-switch 4，hasFocus=true、trusted=true、prevented=false，alt/ctrl/meta/shift/composing 均 false；字段分截图读取。
- seq 10：t=14999，click，target 与 active 均 root-switch 4，hasFocus=true、trusted=true、prevented=false。
- seq 11：t=15002，focusout，target=root-switch 4、active=other 3，hasFocus=true、trusted=true、prevented=false。
- seq 12：t=15003，keyup，key=Enter，target 与 active 均 other 3，hasFocus=true、trusted=true、prevented=false，shift/composing=false；alt/ctrl/meta 本次未完整读取。
- seq 13：t=19997，click，target=lab 5、active=other 3，hasFocus=true、trusted=true、prevented=false。

这是一次有效的 Enter 开关对照，由事前 AX、实际开关变化及上述 trace 联合支撑；不是 Space 路径通过，也不建立异常根因或证明生产修复。前段（含 seq 3–8）未完整读取，不声称全 trace 没有某类事件；trusted 与 capture prevented 的既有解释边界保持。保留当前 13 条停止快照与临时 dirty 正文，不清空、不保存，不改生产、不 Git，F-026c 仍未验收。

### alpha.87 多根与独立文件主路径补证（2026-10-05，04:39 后）

通过原生目录选择器选择 `/tmp/agentic-f026c-F5TULE/beta` 并加入；alpha 原收起/on 保持，beta 展开/off 且扫描完成。随后通过原生文件选择器打开 loose.md，clean、77 字节，原 cover dirty 标签保留；AX 显示仅一个 outline 同时包含 alpha、beta 和 loose 顶层叶。

树中点击 alpha 后 Down 焦点到 beta，再 Down、Down 到 loose，未切换正文；Up、Return 打开 beta/same.md，clean、82 字节，内容为 Beta。随后点击 alpha、Right 展开，再双击其中 same.md，打开独立 alpha/same.md，clean、83 字节，内容为 Alpha；两个 same 标签的 help 路径不同。单击 cover 只选择，正文仍为 Alpha；Return 激活既有 cover dirty，未新增 cover 标签、正文仍原样。未核对选区或 undo，不据此宣称它们已验证。

当前 alpha 展开可见 same、.secret、cover、section，无 .git；beta 展开可见 same，loose 为顶层叶。当前四标签为 active cover dirty、loose、beta/same、alpha/same；此前有效 Enter 的 13 条停止 trace 仍保留，正文未保存、记录未清空。Space 再次分步重试、外观与退出尚未进行，不关闭功能、不更改未验收结论，不执行 Git 或生产修复。

### alpha.87 侧栏保持与一次分步 Space 重试（2026-10-05，04:39 后）

实际隐藏再显示侧栏，alpha/beta 展开、cover 选择、26.4 宽度、四标签与 dirty 均保持。随后依据独立 next_planner 建议仅执行一次分步 Space 对照：开始采集 → 根点击/Left 后 AX 确认根焦点 → alt+Tab 后 AX 确认开关 on 且焦点在开关 → 单独 pressKey('space')。开关仍 on，编辑器正文前出现额外空格且焦点转入 editor；随后停止，得到新 16 条停止快照。新快照替换 Enter 13 条，先前已读证据仍保留本文，不混用同编号。

新 Space 序列已读字段：

- seq 9：t=15945，beforeinput，target=editor 5、active=root-switch 4，hasFocus=true、trusted=true、prevented=false、inputType=insertText、composing=false。
- seq 12：t=15951，input，target 与 active 均 editor 5，hasFocus=true、trusted=true、prevented=false、inputType=insertText、composing=false。
- seq 13：t=15951，keydown，key=Space，target 与 active 均 editor 5，hasFocus=true、trusted=true、prevented=false，alt/ctrl/meta/shift/composing 均 false；字段分截图读取。
- seq 14：t=15954，keyup，key=Space，target 与 active 均 editor 5，hasFocus=true、trusted=true、prevented=false，alt/ctrl/meta/shift/composing 均 false。
- seq 16：t=22454，click，target=lab 6、active=other 3，hasFocus=true、trusted=true、prevented=false。

seq 10–11 本次未完整读取，不借原 Space 序列填补。当前视口位于末条 seq 16；alpha 收起/on、beta 展开/off、loose 为顶层叶，cover active dirty 含本次额外空格，其余三标签 clean。正文不保存，停止快照不清空。

分步重试重复出现 Space 工具路径异常，但仍不建立工具、系统或应用根因，不盲目修改生产交互，也不再循环重复相同路径。真实自然键盘 Space 保留为必要人工确认，明确属于非离线待验，不能当作 offline-final 延期或据此放行整片 Git。有效 Enter 对照及其余主路径证据保留；其他待验可继续，F-026c 仍未验收、不得 Git。

主线最后只读核验 cover 磁盘 SHA-256 仍为 `dd892cc5a5190572ebf43686ca4a9013de9aeef30c5da8107cf8d1e8649a5479`，磁盘内容原样。已异步询问用户自然键盘 Option+Tab 到开关后的 Space 行为；不为方便该测试保存或清空现有 dirty。暂无进一步 UI 操作，保留当前现场，等待自然键盘证据及本检查点独立复核，不预写结果。

### alpha.87 层级导航与跨模式激活补证（2026-10-05，04:49 后）

主线通过 CUA 连接 alpha.87，getApp 约 2 秒成功。根点击后 End 焦点到 loose；Home、Return 使 alpha 展开。点击 section 后 Right、Right 焦点到 detail；Left 返回 section，再 Left 收起 section。全程四标签及 cover dirty 保持，未保存或撤销。

点击模式按钮将 cover 转为阅读模式（revision 2），再从树中点击 loose、Return，激活 clean、77 字节的 loose 编辑模式；树中点击 cover、Return，激活既有 cover 阅读模式及 dirty，四标签未增加。随后切回编辑模式，根点击、Left 恢复 alpha 收起/on；beta 展开/off、loose 顶层，cover active dirty，AX 焦点在 alpha 根。

诊断仍为此前最新 Space 16 条停止快照，未重新采集或清空。上述仅证明本次已观测的导航、模式与标签状态保持，不宣称选区或 undo 通过。自然键盘 Space 尚无用户回复，其他待验仍开放；整片未验收、不得 Git，本次无代码或版本变更。

主线随后只读复核 cover 磁盘 SHA-256 仍为 `dd892cc5a5190572ebf43686ca4a9013de9aeef30c5da8107cf8d1e8649a5479`，磁盘未变；当时 git diff --check 通过，不构成新增代码测试或整片验收结论。

### alpha.87 应用外观补证（2026-10-05，04:59 后）

本次 CUA getApp 约 2 秒成功。先点击 alpha 重扫按钮，AX 无变化，不能据此证明 generation 换代或控件焦点通过。

通过菜单设置将应用主题由深色切为浅色并读回 AX 值，关闭设置后截图显示浅色树文字、根操作按钮和选中 alpha 可辨。再进入设置选择跟随系统并读回 AX 值，关闭后截图为当前深色画面；没有更改系统主题，不宣称动态跟随已实测。最后设置固定深色、读回 AX 值并关闭设置。

最终四标签及 cover 编辑模式 dirty 保留，alpha 收起/on、beta 展开/off、loose 顶层、侧栏宽度 26.4；原最新 Space 16 条停止快照保留，当前焦点 HTML。未保存、清空或退出，无代码、版本或 Git 操作；自然键盘 Space 仍待用户，选区/undo 及其他剩余待验不关闭，整片未验收、不得 Git。

主线本次再次只读核验 cover 磁盘 SHA-256 为 `dd892cc5a5190572ebf43686ca4a9013de9aeef30c5da8107cf8d1e8649a5479`，仍未变；diff 检查通过。

### alpha.87 树激活往返的选区与编辑历史补证（2026-10-05，05:09 后）

从树中点击 loose、Return 激活 clean、77 字节文档，执行 super+End、粘贴 `F026c-selection-XYZ`、三次 shift+Left，AX 与截图均确认 XYZ 选中且 loose dirty。随后树中点击 beta/same、Return，激活 clean、82 字节文档；再从树中点击 loose、Return，AX 仍为 Selected text XYZ，标记及 dirty 保留，总四标签未重复。

在 loose 执行 super+z，临时标记消失并恢复 clean；super+shift+z 后标记恢复、dirty；再次 super+z 回 clean。仅本次文件树往返路径的选区与编辑历史取得实际证据，不外推全部模式或消费者。

最后点击 cover 标签返回原 cover 编辑模式 dirty，正文原样；原最新 Space 16 条停止快照未重采或清空。树仍选择 loose，alpha 收起/on、beta 展开/off，固定深色、宽度 26.4，焦点在 cover 编辑器。未保存、退出或修改代码/版本，无 Git；自然键盘 Space 尚无回复，其他焦点/隐藏例外等待验保持，整片未验收。

主线只读磁盘核验：cover SHA-256 仍为 `dd892cc5a5190572ebf43686ca4a9013de9aeef30c5da8107cf8d1e8649a5479`；loose 当前为 `df518fd4dfb0d0a04d9aced8b32edb65c36fbeada7748d2a1a338ae920a44693`，本次没有其事前 hash，不声称完成前后 hash 对比。diff 检查通过。

### alpha.87 重扫读取新目录状态补证（2026-10-05，05:19 后）

既有树中 beta 仅显示 same；主线 ls 核验该目录也仅有 same 后，以 apply_patch 新增临时文件 `/tmp/agentic-f026c-F5TULE/beta/rescan-0519.md`，54 字节，内容为标题 `# Rescan 0519` 及 `F026c rescan fixture 2026-10-05 05:19.`。再次读 AX 无变化，新叶尚未出现。

点击 beta 重新扫描（当次 index 22）后，AX 显示 beta 扫描完成并出现 rescan-0519 叶，焦点/选择为 beta 根；不记作按钮焦点保留通过。点击新叶、Return，打开 clean、54 字节文档并核对上述唯一内容；关闭该 clean 标签无弹窗，返回 alpha/same，再点击 cover 回到原编辑 dirty。

四标签保留，树仍选择新 rescan 叶，alpha 收起/on、beta 展开/off；临时文件保留在磁盘供后续测试。Space 16 条停止快照未动，未保存正文或退出，无代码、版本或 Git 操作。本次仅证明重扫后新目录状态可见，不是 UI 读到 generation 数值，也不是失效焦点回退通过；自然 Space 仍无用户回复，其他未验范围开放，整片未验收、不得 Git。

### alpha.87 重扫按钮坐标点击对照（2026-10-05，05:29）

主线按 diagnosing-bugs 的 Phase 1 收集证据，不修改代码。getApp 与截图确认 beta 重扫按钮中心为 `[591, 320]`；操作前树选择 rescan 叶，焦点为 cover 编辑器。坐标点击后，AX 显示 beta 根 selected/focused，仍展开、扫描 complete，新叶仍在，cover dirty 与 Space16 停止记录保持。

第二次先点击 loose 树项，再点击当前 active cover 标签，AX 显示 loose selected、焦点为 HTML（不是 editor）；随后再次点击相同按钮中心，AX 又显示 beta 根 selected/focused。坐标点击与此前 AX 点击具有相同可见结果，独立按钮不改变根选择的约束尚未满足，作为独立待查项保留；不据此推断 generation 回退、工具或框架根因。

当前 alpha 收起/on、beta 展开/off 且 selected/focused，四标签中 cover active dirty，Space16 停止快照保持，固定深色、宽度 26.4。未保存、退出或修改代码/版本，无 Git；自然 Space 仍待用户，不再重复同一 Space 工具路径，整片未验收。

05:29 后独立 next_planner 确认：现有诊断仅保留一轮，重新开始会清除旧记录；在不覆盖旧记录且不退出的条件下，尚无已验证的另一 DOM 事件取证入口。当时的补读后评估替换建议尚未执行，不构成新的产品决定。主线当次只读核验 cover hash 仍为原值、diff 检查通过。

### alpha.87 重扫事件次序补证（2026-10-05，05:39）

主线决定以已落档的旧 Space 关键字段为证据边界，未读字段继续未知，并替换内存采集；这不是新产品决定，也没有代码改动，不称旧 Space 完整导出或仍在内存。先点击 loose 选择，再开始采集，此时 AX 焦点为 HTML；点击重扫按钮中心 `[591, 320]` 后 beta selected/focused，再停止。

新 trace 完整读回共 4 条，前三条由 AX 与截图拼读，第四条末尾 `]` 确认记录结束。每条均 hasFocus=true、trusted=true、capture prevented=false，除此及下列字段外无其他字段：

1. t=9582，focusin，target 与 active 均 tree-item 1。
2. t=9625，click，target=root-button 2、active=tree-item 1。
3. t=19951，focusout，target=tree-item 1、active=other 3。
4. t=20001，click，target=lab 4、active=other 3。

根 focusin 早于按钮 click，仅作为本轮事件次序证据，不能单凭它确定系统或应用根因，也不表示 Space 已被解释。最新快照为这 4 条停止记录、视口末条；alpha 收起/on、beta 展开/off 且 selected，焦点 HTML，四标签 cover dirty、其他 clean。未保存、退出或修改版本，无 Git；原 Space16 仅保留已落档证据，整片仍未验收。

### 指针按下诊断最小增量方案（2026-10-05，实施前）

为进一步区分默认聚焦祖先、工具先聚焦、程序化恢复三个尚未证实的解释，主线批准仅在既有 opt-in 内存采集器的 documentEvents 加入 pointerdown、mousedown，便于对照 pointerdown → focusin → click 次序。此为 diagnosing-bugs Phase 1 的取证能力补齐，不声称已有自动化的真实故障红绿回归或根因，不实施生产交互修复。

沿用现有 type、固定 target/active 类别与临时 ID、hasFocus/trusted/capture prevented 元数据；不读取或新增坐标、正文、任意属性，不阻止默认行为。默认无监听、128 条上限、停止/卸载移除监听及不持久化边界保持。只修改 focus-trace.ts 与其测试，不修改 workspace-tree，不改版本、不构建、不操作 UI 或 Git；alpha.88 构建由主线后续负责。

最小验证：确认显式安装的文档监听从 7 增为 9 且 teardown 对称；合成 pointerdown/mousedown/focusin/click 保持发送次序；用抛错 getter 证明不读取敏感指针属性，默认行为未取消。执行定向测试、typecheck、lint；合成测试不代替真实 WK 焦点验证。独立审查由其他 Agent 承担，执行作者不自批。

实现及自动验证：focus-trace.ts 仅新增 pointerdown/mousedown 两个 document 事件名；测试更新 9 个监听的对称移除，并覆盖新事件顺序、默认无采集、停止后无新记录、固定元数据字段及坐标/指针标识/压力/修饰键等 getter 不读取，未改 workspace-tree 或 UI。

实际执行 `bun test apps/desktop/src/client/focus-trace.test.ts`：4 pass、0 fail、42 assertions，26 毫秒；`bun run typecheck` 与 `bun run lint` 均 exit 0。全量 `bun test`：742 pass、0 fail、19353 assertions、121 文件、15.28 秒，日志 `/tmp/agentic-f026c-pointer-source-tests.log`。`bun run check:feature-docs`（含 obligations）及 `git diff --check` 通过。尚待独立审查与主线新包取证，没有版本、构建、UI 或 Git 操作；这些测试不代表故障已复现/修复或 F-026c 验收。

### alpha.88 实际构建与切包（2026-10-05）

主线更新版本为 `0.1.0-alpha.88`；源码全量 742 pass、0 fail、19353 assertions、121 文件、14.59 秒，日志 `/tmp/agentic-f026c-source88.log`。独立 Spec / Standards 对本次诊断增量各复跑 4 tests / 42 assertions，均 0 阻断，不扩大为生产修复结论。

首次 `bun run build:canary` 因 MissingDeveloperId 失败，日志 `/tmp/agentic-f026c-build88.log`；按既有 `AGENTIC_MARKDOWN_SKIP_SIGNING=1` 重试 exit 0，日志 `/tmp/agentic-f026c-build88-unsigned.log`，未修改系统。tar 解包到 `/tmp/agentic-markdown-alpha88.Ff5n4o/Agentic Markdown-canary.app`，版本 alpha.88、hash `thfhqyfemf0d`。包内 Bun 跑仓库源码测试 742 pass、0 fail、19353 assertions、121 文件、13.99 秒，日志 `/tmp/agentic-f026c-packaged88.log`；不称其为已打包 UI 自动验收。

旧 alpha.87 执行 super+Q 出现放弃确认，主线仅放弃 Agent 临时空格；工具返回 App quit，ps 确认 PID 53272 不存在，cover 磁盘原 hash 未变。旧重扫 4 条记录已完整落档，内存随退出丢弃，不再声称仍保留旧窗口或 dirty 现场。

新包使用同隔离 HOME、`AGENTIC_MARKDOWN_EDITOR_FAULT_LAB=1` 启动，PID 62075、exec 60055。CUA 已见欢迎页、空树、侧栏宽度 26.4、诊断停止且无记录；尚未进行新版 pointer 实测，下一步 beta 最小复现。未修复生产交互、未验收、无 Git，历史证据不混作新版验证。

### alpha.88 无文档重扫指针序列（2026-10-05）

新包 PID 62075 仅加入 beta 根，含两个子文件，没有打开文档。先单击 same 选择，再启动诊断，此时焦点 HTML；坐标 `[592, 232]` 点击重扫，beta 根变 selected/focused，随后停止诊断并通过截图滚读完整 8 条。各条均 hasFocus=true、trusted=true、capture prevented=false：

1. t=14155，pointerdown，target=root-button 1、active=other 2。
2. t=14155，mousedown，target=root-button 1、active=other 2。
3. t=14156，focusin，target 与 active 均 tree-item 3。
4. t=14208，click，target=root-button 1、active=tree-item 3。
5. t=23131，pointerdown，target=lab 4、active=tree-item 3。
6. t=23131，mousedown，target=lab 4、active=tree-item 3。
7. t=23131，focusout，target=tree-item 3、active=other 2。
8. t=23183，click，target=lab 4、active=other 2。

无编辑器时仍出现根选择/焦点变化。此次按钮 down 早于根 focusin，采集器未观察到按钮 focusin，不支持“本次按下前已预聚焦根”的解释；不据此确定系统或应用根因，也不解决 Space 路径。当前 beta 展开/off，8 条停止诊断保留，无文档、无 dirty；本次未改代码/版本或执行 Git，F-026c 仍未验收。

### 根按钮焦点最小修复试验方案（2026-10-05，实施前）

基于 alpha.88 真实 down → 根 focusin → 按钮 click 记录，仅试验两个根操作按钮的主键 mousedown：preventDefault 后显式 button.focus({preventScroll:true})，click 仍执行既有隐藏/重扫动作；保持树 click/dblclick/keydown 对按钮后代的隔离。非主键不干预，不改变树选择或展开，不在异步完成后抢回焦点。此试验针对已复现的根按钮路径，不推断已确定平台根因，也不宣称解决 Space。

临时 folder busy 使用 aria-disabled 呈现及点击时最新 folders.getSnapshot().busy 守卫，不再用原生 disabled 令当前按钮失焦；全局 disabled 保持原生禁用。已核对 folders.setHidden/rescan 经 enqueue 同步发布 busy=true 后才排入异步操作；继续核对命令与 runWorkspaceAction 同步调用链，避免 React 尚未重渲染时重复提交。

最小测试覆盖主键焦点/default 行为、非主键、全局禁用、最新 busy 防重入、busy 不原生禁用以及动作异步完成后不抢焦点；只补当前正确 seam，不把合成测试当 WK 行为通过。不改版本、构建、UI 或 Git；独立双轴复核后由主线交付 alpha.89 实测，本片保持未验收。

同步链核对与主线范围确认：命令 registry 同步调用 handler，常规 runWorkspaceAction 的 protect 在无保存 barrier 时直接 action()，由 folders.enqueue 同步设置 folder busy。遗留保存 barrier 可能 beginDiscard 令全局 frozen=true，使原生 disabled 生效并失焦；主线明确采用窄修复保留该策略，不扩大到保存 barrier 或宣称全面焦点保持。动作可用性仍由既有命令/controller 守卫，不以可获得焦点代替操作权限。

实际实现：抽出 `workspace-root-control.ts` 小事件 handler seam，由两个根按钮复用；主键 mousedown 仅 preventDefault 与当前按钮 focus，click 检查全局 disabled、主键和最新 folder busy 后执行原 action。folder busy 仅 aria-disabled，原生 disabled 留给全局禁用；未增加异步焦点恢复，未修改树点击/双击/键盘隔离或生产 Space 路径。

自动验证：`bun test apps/desktop/src/client/workspace-root-control.test.ts apps/desktop/src/client/workspace-tree-model.test.ts` 为 9 pass、0 fail、73 assertions，235 毫秒。测试使用真实 folder 控制器验证 setHidden/rescan 同渲染闭包下 busy 同步阻止第二次动作，并核对非主键/全局禁用、停止动作后的无异步再聚焦；SSR 核对临时 busy 不原生禁用、全局原生禁用及选择/展开投影不变。`bun run typecheck`、`bun run lint`、文档/义务及 diff 检查均通过。全量 `bun test` 为 745 pass、0 fail、19380 assertions、122 文件、15.21 秒，日志 `/tmp/agentic-f026c-root-control-tests.log`。合成事件/SSR 不证明 WK 焦点修复，尚待独立双轴审查与 alpha.89 实测；无版本、构建、UI 或 Git 操作，整片未验收。

### alpha.89 构建及重扫焦点局部实证（2026-10-05）

主线沿用 `AGENTIC_MARKDOWN_SKIP_SIGNING=1` 构建 exit 0，日志 `/tmp/agentic-f026c-build89.log`；tar 解包路径 `/tmp/agentic-markdown-alpha89.dgInQI/Agentic Markdown-canary.app`，版本 `0.1.0-alpha.89`、hash `2d8ogwd77wxqh`。包内 Bun 跑仓库测试 745 pass、0 fail、19380 assertions、122 文件、13.90 秒，日志 `/tmp/agentic-f026c-packaged89.log`。独立 Spec 9 tests / 73 assertions、Standards 14 tests / 89 assertions，均 0 阻断。

alpha.88 首次 super+Q 因工具未激活失败；getApp 重绑后再次 super+Q 返回 App quit，PID 62075 消失，无文档、不需丢弃。alpha.89 以相同隔离 HOME / fault lab 启动，PID 63894、exec 38564。

加入 beta、选择 same、开始诊断后，以坐标 `[592, 232]` 重扫：AX 焦点确为重扫按钮（当次 index 63），但选择仍回 beta 根、叶节点 AX 重建。所以仅取得焦点部分改善的实证，不能记作全部修好，选择 fallback 仍需核查。停止后读到以下新 trace：

1. t=8999，pointerdown，target=root-button 1、active=other 2。
2. t=9000，mousedown，target=root-button 1、active=other 2。
3. t=9000，focusin，target 与 active 均 root-button 1。
4. t=9048，click，target 与 active 均 root-button 1；hasFocus=true，其余字段未读。

前 3 条均 hasFocus=true、trusted=true、capture prevented=false；第 4 条未读字段不从前三条推断。后续记录及总数尚未读取，不补造。当前 beta 展开/off selected、焦点 HTML，无文档或 dirty，停止 trace 保留；Space 仍独立待验，整片未验收、不得 Git。

随后独立 planner 核查：本根重扫导致 generation 换代、旧 handle 失效，selected 回退 root 符合“有效节点保持、失效节点清理”的既定规则。上述“不能记作全部修好”仅表示缺少有效节点对照，不是确定实现失败；不得径称选择回退为缺陷，也不按同路径重绑定旧 handle。下一步以独立 loose 等仍有效节点验证选择保持，尚未在本记录中取得该对照结果。

### alpha.89 有效独立节点与两按钮对照（2026-10-05）

文件选择器开始两次 paste+Return 未定位，仍在 beta，不推断根因。改用 Go To setValue 设置路径并读回后 Return，成功打开 loose.md，77 字节、clean 编辑模式，只有一个标签，并出现独立顶层叶。

点击 loose 树项选中，再点击 beta 重扫：beta 仍展开，loose selected 保持，AX 焦点为重扫按钮。点击 beta 隐藏开关 off→on，loose 选择及 clean 文档保持，焦点为 switch；再 Return，on→off 成功且焦点仍在 switch。

本次补齐普通重扫的有效独立节点选择、两按钮焦点及 Enter 路径；结合独立源码核查，支持此前本根旧叶回退属于 generation 失效清理，而不是有效节点被按钮动作改选，不扩大为全消费者结论。Space 不重复、仍未验证，busy 期间主动移焦及真实重入未实操。诊断未重采，仍为 alpha.89 原停止 trace，前 4 条仅部分已读、总数未知。

当前 PID 63894 现场保留：beta 展开/off，loose selected、唯一 active clean 编辑文档，焦点 switch。无保存或 Git，整片未验收。

### alpha.89 显式隐藏文件例外与覆盖去重（2026-10-05，06:18）

连接现有窗口成功；从打开文件选择器通过 Go To setValue 设置 alpha/.secret.md 路径，Return 仅进入 alpha 目录，再点击可见 .secret.md 项与 Open 成功。出现独立顶层 .secret，101 字节、clean 编辑模式；另一个 loose 标签显示“权限确认中”，不推断原因，也不声称权限已恢复。

加入父 alpha 后继承既有 showHidden on，.secret 仅在 alpha 内出现一项，顶层独立叶消失。点击 alpha 隐藏开关 on→off，.secret 恢复顶层一项，截图缩进证实其顶层位置；alpha 内仅 same、cover、section。两标签及 active .secret clean 正文保持。Return off→on 后，.secret 再归 alpha 内一项、顶层消失，switch 焦点保留，loose 树选择仍在。

当前 beta 展开/off、alpha 展开/on、section 折叠；两 clean 标签为 active .secret 与仍显示权限确认中的 loose。PID 63894 现场保留，原诊断停止未重采、总数未知。本次仅证明显式隐藏独立例外、覆盖吸收及切换去重，不宣称权限恢复或 Space 等余项通过；未保存、退出或执行 Git，无代码/版本改动，整片未验收。

随后点击既有 loose 标签，AX 中该标签及顶层叶的“权限确认中”消失；loose active、77 字节、可编辑 clean，焦点为编辑器，两标签仍在。仅记录本次激活后重新确认的实际结果，不推断此前状态原因；其他树状态及停止 trace 不变，当前现场以 loose active 覆盖上一段。

独立 next_planner 核查后的下一最小实际项为空目录根呈现及最后 alpha.89 普通退出，仅记录计划、尚未实施；自然键盘 Space 仍待用户。busy 竞态与失效焦点回退继续保留测试证据，不声称已取得真实操作证据，不改变整片未验收、不得 Git 的结论。

### alpha.89 空目录根实际补证（2026-10-05）

主线通过 mktemp 创建 `/tmp/agentic-f026c-empty.bQYDP4`，使用原生选择器加入空目录。初次 Go To 后 Open 为 disabled，点击目录本身后 enabled，再 Open 成功。树出现展开的顶层空根，显示“扫描完成 · 没有可显示的 Markdown 文档”，无子项。

选中该根 Return 收起，再 Return 展开；原两标签及 loose 正文保持。期间 loose 再次出现权限确认中，随后 AX 恢复可编辑 clean，不推断原因。点击 .secret 标签返回 101 字节可编辑 clean，两标签无重复。

最终 beta 展开/off、alpha 展开/on、section 折叠、空根展开 selected，.secret active clean、焦点编辑器，PID 63894 与原停止 trace 保留未动。空目录实际补证完成，普通退出仍留末尾，自然 Space 待用户；未保存、退出或执行 Git，整片未验收。

### alpha.89 现场变化、空窗口退出与隔离重启（2026-10-05）

主线本轮 getApp 读到空欢迎页，无诊断实验，侧栏宽度 20.016；ps 确认旧 PID 63894 不存在，当前 launcher 73037 / Bun 73041。原因及旧实例退出方式未知，不能将其写成旧两文档正常退出，也不能补造旧 trace 未读字段或总数；旧诊断内存不再可读。

对当前无文档窗口 super+Q 返回 App quit，随后 ps 确认 73037 / 73041 均无进程，证明本次 alpha.89 空窗口正常退出，不覆盖旧两文档现场或已打开 clean 文档的退出路径。

随后显式设置应用数据隔离 `AGENTIC_MARKDOWN_HOME=/tmp/agentic-sidebar-layout-data.cPxLT0` 与 `AGENTIC_MARKDOWN_EDITOR_FAULT_LAB=1`（未修改系统 `HOME`），重启同路径 `/tmp/agentic-markdown-alpha89.dgInQI/Agentic Markdown-canary.app`，exec 89564、Bun PID 73345。欢迎页侧栏宽度 26.4，诊断停止且无记录。

经原生选择器加入 `/tmp/agentic-f026c-F5TULE/alpha`，继承 hidden on；选择 cover、Return，打开 108 字节 clean 编辑文档。点击隐藏 on→off，AX 焦点为 switch、根 selected，cover 仍 clean 唯一标签；此次本根 generation 失效不另作异常归因。当前 alpha 展开/off，same、cover 可见，section 折叠，焦点 hidden switch。

不再调用工具 Space，保留当前现场供用户自然键盘对照；未保存、无代码/版本或 Git 操作。普通退出仅补齐上述空窗口证据，已打开 clean 文档退出不冒称覆盖，整片仍未验收。

### 用户自然目录 Space 反馈与反馈环（2026-10-05）

用户明确确认显示隐藏文件功能正常；另反馈鼠标点击 alpha 目录名后直接按 Space，目录无变化，正文首行出现光标并新增空格、dirty。其中目录无变化符合 Space 仅选择而非展开的规则，错误是输入落入正文；不将其当作先前根按钮问题或仅工具异常。

主线在当前 alpha.89 cover 用户 dirty（3 个空格）现场开始采集，点击 alpha 文本（当次 index 14），AX 显示根焦点（index 12），再 pressKey('space') 并停止：正文由 3 空格变 4 空格。新 trace 前两条为 pointerdown/mousedown，target=tree-item 1、active=other 2，后段待读。用户输入和主线新增空格均未保存或撤销。

本次使用 diagnosing-bugs Phase 1 的显式 native/人工反馈环例外：用户亲验与主线实际 WK 都已呈现错误，原生窗口取证由主线负责；既有 Bun 环境仅有模型/SSR，没有真实 DOM 浏览器 seam，暂不虚构可自动红绿的自然键盘测试。不另装依赖或以 shell headless 绕过 CUA；后续只在真实调用链上建立可用回归，合成事件不冒充 WK 自然输入。

取证前提出三条可证伪解释，均未确认为根因：

1. 目录文本默认 mousedown 的原生选择/输入目标与随后 li.focus 不同步：预测直接控制该主键 down 的默认行为及聚焦后，Space 应先到树、正文不变；需用实际事件与 DOM selection 类别作区分，不能凭静态代码直接修复。
2. 点击引发编辑器重建或异步焦点恢复：预测树 focus 后、Space 前出现 editor focusin 或新的元素身份；缺少该轨迹会削弱此解释。源码当前 MemoryEditor 仅挂载效应调用 view.focus，依赖 controller/documentId，不存在已找到的普通字符全局转发链。
3. Space 到树后被本地 guard 跳过：预测 keydown target 为树或后代，之后才出现正文 beforeinput；若正文 beforeinput 已先于 editor keydown 且树未收到 keydown，此 guard 不能解释最初输入转向。

仅复跑既有定向 `bun test apps/desktop/src/client/workspace-tree-model.test.ts apps/desktop/src/client/workspace-root-control.test.ts` 为 9 pass / 73 assertions（359 毫秒），仍不能检出此次自然 WK 输入症状；文档/义务/diff 检查通过，不将该通过冒称红回归或修复。等待新完整事件目标证据，尚未修改生产源码。

主线新 trace 关键字段：seq3 t=64 focusin tree-item 3/active3；seq4 t=115 click tree-item 1/active tree-item 3，hasFocus/trusted=true、prevented=false；seq5 t=11509 keyup Space，target/active tree-item 3，所有修饰/composing=false，前1–4未见keydown；seq6 t=11534 beforeinput，target editor4/active tree-item3，hasFocus/trusted=true、prevented=false、insertText、composing=false；seq7 t=11535 树失焦到other2，seq8 t=11539 editor4 focusin（后段未全读），seq10 t=11540 editor4 keydown Space。该次正文 beforeinput 早于编辑器抢焦点，也不是树 keydown guard 先消耗事件；缺少前置 keydown 仍不足以确定平台根因。

最小候选方案（主线批准，实施前）：仅树行的主键 mousedown，在非按钮后代且该节点未禁用时 preventDefault 并 focus 当前 li（preventScroll）；不处理全局 Space，不清 DOM/编辑器选区，不修改正文或编辑历史，不改变单击仅选择、Enter/双击展开。保留 rootControl 行为与按钮事件隔离。将实际 li 接线提为无 hook 小组件，直接测试其生成的真实 onMouseDown/原 click/key handler，覆盖按钮后代、非主键、禁用与其余事件不变；SSR仍通过真实WorkspaceTree渲染。此仅可证伪候选，不是根因确证；自然WK正文不再插入的回归由主线在新版完成，用户dirty切包授权另由主线取得，执行者不保存/退出。

用户随后明确授权切新版时放弃当前测试空格。主线 super+Q 实际弹出全部未保存放弃确认，点击放弃后 App quit；ps 确认 PID 73345 不存在，cover 磁盘 SHA-256 仍为 `dd892cc5a5190572ebf43686ca4a9013de9aeef30c5da8107cf8d1e8649a5479`。本次是 dirty 确认后放弃退出证据，不冒称 clean 文档退出路径。旧 trace 只保存已读部分，未读字段随退出不可再读，不能补造；上述保留 dirty 要求为授权退出前状态。

候选实现完成：新增无 hook 的 `WorkspaceTreeItem`，生成实际 li 并透传 ref/ARIA/既有 click、doubleClick、keydown 与 children；唯一新增行为为非按钮后代、未禁用主键 mousedown 的 preventDefault + 当前 li.focus({preventScroll:true})，由 WorkspaceTree 对全部实际行接线。未修改 rootControl、全局键盘、DOM/CodeMirror 选区或正文。

直接调用该生产小组件的测试检查生成 li 的真实事件接线、仅 down 聚焦不触发 click/展开、原处理器保留以及禁用/非主键/按钮后代不干预；原统一树 SSR/模型和根按钮测试继续运行。定向最终 `bun test apps/desktop/src/components/workspace-tree-item.test.tsx apps/desktop/src/client/workspace-tree-model.test.ts apps/desktop/src/client/workspace-root-control.test.ts`：11 pass / 97 assertions，210 毫秒。首次 lint 揭示 JSX.Element.props 默认 any 的测试访问问题，已通过显式 ReactElement<ItemProps, "li"> 返回类型修正；随后 typecheck 与全量 lint 均 exit 0。初版全量 747 pass / 19403 assertions（123 文件，15.35 秒，`/tmp/agentic-f026c-tree-item-tests.log`）；最终完整复跑结果另记录，不用旧断言数冒充新增断言后的运行。文档/义务/diff 检查通过；这些测试仅锁定候选接线，不宣称自然 WK 症状已经修复。

最终完整源码复跑：747 pass、0 fail、19404 assertions、123 文件、14.80 秒，日志 `/tmp/agentic-f026c-tree-item-final-tests.log`。候选源码稳定，后续版本/构建和实际 WK 验证由主线执行，整片未验收、不得 Git。

### alpha.90 候选实测失败与局部撤回（2026-10-05）

主线构建 exit 0，日志 `/tmp/agentic-f026c-build90.log`，包 `/tmp/agentic-markdown-alpha90.j5P95j/Agentic Markdown-canary.app`，hash `j6w7g1i51ybr`；同隔离环境运行 exec 86165 / Bun PID 79772。包内全量 747 pass / 19404 assertions、13.89 秒通过，但不能抵销真实窗口失败。

加入 alpha（hidden off）、打开 cover 108 字节 clean，点击 alpha 文本（index 25），AX 显示根焦点（index 23）；随后 Space 令 cover dirty，焦点进入 editor（index 64）。本次没有采集 trace，不推断未观察到的事件顺序。该结果否定“仅主键 mousedown preventDefault+li.focus 足以修复”的候选，不等于确定另一根因。

已按主线要求仅删除本次新增 `workspace-tree-item.tsx` / 测试，WorkspaceTree 恢复原 li 接线；保留 rootControl 和其余 F-026c 改动，不撤回其他任务内容。版本 alpha.90 保留，未重构建或 Git，下一个代码包由主线使用 alpha.91。撤回后定向 9 tests / 73 assertions 通过（289 毫秒），typecheck 另行核验；下一步先核查 DOM 选区及原生键盘路由，未新增猜测性修复。

撤回后 typecheck、lint、文档/义务及 diff 检查均通过。移除的是本轮 Agent 新建的失败候选源码/测试，不涉及用户文档；方案、测试和失败历史保留本文，候选可据记录重建。

后续只读证据：本地 Electrobun 2.0.1 安装内容的原生实现为 dylib，未找到对应 Objective-C 源码；preload/events.ts 的键盘监听用于 Meta/链接检测，未找到 Space 送回编辑器的逻辑；SDK ui/input.ts 的原生 keyDown 属于 WGPU/InputSink，不能冒充当前 WK DOM 输入链。暂无可直接证明本机原生 bridge 是根因的源码证据。

[WebKit 112854](https://bugs.webkit.org/show_bug.cgi?id=112854) 描述 DOM 选区仍留在可编辑内容时键入可能重新聚焦；[CodeMirror 官方讨论 8095](https://discuss.codemirror.net/t/how-to-force-unfocus-of-the-codemirror-element-in-safari/8095) 有相同 Safari 行为报告。这些仅支持待验证解释，不代替本机证据。本地 CodeMirror 的公开 EditorView.focus 会同步模型选区至 DOM；selectionchange 处理在可编辑视图未持有实际焦点时返回，支持评估“只释放 DOM 选区、不改 EditorState.selection”的公开 API 路线，但仍须验证实际往返与 IME 边界。

待独立方案评审的最小建议（未实施）：树取得真实焦点后，仅当 Selection 的 anchor/focus 同属本应用当前 .cm-content 时 removeAllRanges；不修改正文、模型选区、历史或全局 Space，不清阅读/树/跨区选区，不异步抢焦点。必须补禁用/组合输入及返回编辑器选区、撤销历史验证，未把此建议写成实现或修复通过。

### 本机 DOM 选区摘要诊断方案（2026-10-05，实施前）

独立 planner 与主线决定先取得本机 Selection 证据，不实施上述释放选区建议。仅扩展现有 opt-in focus-trace：在 focusin 事件读取 rangeCount、anchor/focus 固定类别（受控 editor/其他/无）及两端是否同属一个受控 editor 布尔值。受控 editor 限当前文档内带 `[data-document-editor]` 的 `.cm-editor` 下 `.cm-content`；不读取正文、文件标记值、路径、offset 或任意属性，不保留 DOM 引用。Shadow DOM 或不可可靠读取的情况不附摘要，不推断选区。

沿用默认无监听、128 条内存、停止/卸载清理，不修改焦点、Selection、EditorState 或生产交互；可在停止后原 JSON 上方显示仅同字段的紧凑 focusin 摘要，不在采集时更新 React。用现有 fake DOM 测试无选区/受控单端与同端/跨编辑器/普通内容/Shadow 不可靠及敏感 getter 不读取、无修改方法调用。主线负责 alpha.91 构建与本机验证，执行者不版本/构建/UI/Git。

alpha.90 包内测试通过但 native 失败及失败候选撤回保持上述结论；当前主线 alpha.90 样本新增的 1 个 Agent 空格仍在内存，未保存，不将其误写为旧 alpha.89 已放弃的空格。

诊断实现完成：focusin 新增四个扁平可选字段 selectionRangeCount、selectionAnchor、selectionFocus、selectionSameEditor；端点仅用当前 Document 根及固定 .cm-content / .cm-editor[data-document-editor] 结构判定，同 editor 只比较临时引用，不保存引用或标记值。不可读取、端点跨根或可观察的 Shadow 场景省略摘要，不能声称覆盖不可观察的 closed Shadow DOM。停止后显示紧凑摘要并保留完整 JSON，采集期无 React 实时更新。不改焦点/选区、正文或输入事件默认行为。

定向 `bun test apps/desktop/src/client/focus-trace.test.ts`：6 pass、0 fail、51 assertions、15 毫秒；typecheck 与三文件专项 ESLint 均通过。fake 测试覆盖空选区、同 editor、不同 editor、单端、普通内容、跨根、读取失败及可见 Shadow，敏感字段/修改方法 getter 禁止读取；原默认关闭、128 条、监听清理及指针不取消测试保留。此为诊断源码与受控测试证据，不代表本机 Selection 假设已证实或症状已修复。独立双轴审核和主线 alpha.91 构建/实测待进行，未验收、不得 Git。

主线随后已对 alpha.90 super+Q 实际确认放弃本轮 Agent 测试空格，App quit 且 PID 79772 不存在；cover 磁盘 SHA-256 仍为 `dd892cc5a5190572ebf43686ca4a9013de9aeef30c5da8107cf8d1e8649a5479`。首次 super+Q 工具提示 target 改变要求重查，重查无状态变化后再次退出成功，不推根因；当前不再保留 alpha.90 dirty 运行现场。

### alpha.91 本机选区阳性与局部适配方案（2026-10-05，实施前）

主线 alpha.91 构建 exit 0（`/tmp/agentic-f026c-build91.log`），包 `/tmp/agentic-markdown-alpha91.EOCzXV/Agentic Markdown-canary.app`，hash `80si8ucaafy5`，exec31846 / Bun80857。源码747 tests / 19389 assertions / 15.25秒；包内Bun运行仓库747 / 19389 / 122文件 / 13.92秒通过（`/tmp/agentic-f026c-packaged91.log`）。

真实窗口加入alpha off、打开cover108字节clean后，开始诊断并点击alpha目录文字，AX根焦点，停止摘要实际为 `#3 tree-item → tree-item: ranges=1, anchor=editor, focus=editor, same=true`。本次未按Space、未改正文，样本clean；这直接证实树持有焦点时DOM选区仍留在同一受控编辑器，不证明所有平台事件异常均由此引起。

主线批准局部候选：在统一树既有focus capture中，仅当实际activeElement就是本树获得焦点的行或根按钮，Selection两端都属于当前Document的同一受控.cm-content时，使用公开EditorView.findFromDOM核对实际view.dom/contentDOM，检查view.compositionStarted、view.editable与state.readOnly，安全才调用Selection.removeAllRanges。输入法组合、只读/冻结、普通/阅读/跨区/跨编辑器/Shadow或未知情况均不处理。根按钮同属树焦点消费者，不另设全局规则；不改变焦点、正文、EditorState.selection、历史或单击/Enter产品行为，不吞全局按键，不异步抢焦点。返回编辑器沿用既有公开view.focus同步模型选区路线。受控测试覆盖决策与接线；真实Space和往返选区/历史由主线alpha.92验证，未验收不得Git。

候选实现：新增 `tree-editor-selection.ts`，统一树现有 onFocusCapture 调用；实际 editable API 为 `view.state.facet(EditorView.editable)`（上文方案简称 view.editable 并非实例属性）。独立 Standards 预核指出冻结采用 contentEditable=false 而非 facet，已另检 `view.contentDOM.isContentEditable`，不只依赖界面 disabled。公开 compositionStarted 覆盖组合输入已开始但尚未改字的阶段。仅一个DOM Range、端点同受控 content且真实view匹配才释放，不调用dispatch/focus或修改模型；普通/混合/跨根/异常均返回false。

受控helper测试3项44断言，连同既有树模型/SSR和root control共12项117断言通过（185毫秒）；typecheck与三文件专项lint通过。首次lint样式及静态方法绑定提示已修；源码全量750 pass、0 fail、19433 assertions、123文件、14.91秒（`/tmp/agentic-f026c-dom-selection-tests.log`）。全量运行期间仅有等价lint修正，最终定向/type检查重新通过。不把fake DOM/模型对象不变测试冒充真实WK选区、IME或历史往返，后者待主线实际验收；原诊断保留，尚未构建alpha.92或宣称通过。

### alpha.92 原症状与选区/历史局部复验（2026-10-05）

主线构建成功（`/tmp/agentic-f026c-build92.log`），包 `/tmp/agentic-markdown-alpha92.qWn8kd/Agentic Markdown-canary.app`，hash `ym1df8795dlv`，exec1792 / Bun PID81870。包内Bun运行仓库750 pass、19434 assertions、123文件、14.08秒（`/tmp/agentic-f026c-packaged92.log`）；与上方源码19433断言分开按实录，不强行对齐。切包前 alpha.91 clean 文档 super+Q 正常退出，PID80857 消失；不是 alpha.92 退出证据。

真实WK加入alpha/off，cover108字节clean、编辑器焦点，点击alpha目录文字（25），AX根23焦点；按Space后AX无变化，根仍保持焦点，正文clean未变。这是原目录名路径首次新版局部成功，不替代用户自然键盘复验。

编辑模式选中“覆盖去重样本”范围后，树Space、再激活same/cover，范围恢复；粘贴“选区回归”准确替换所选范围并dirty，树Space正文不变，再same/cover后undo恢复原文clean与原选区。redo恢复替换dirty，再undo回clean。随后⌘⇧M进入源码模式，同范围经树Space仍clean且根焦点，Return收起/展开成功，same/cover往返仍为源码模式并恢复该范围。仅这些实际路径证实模型选区及编辑历史保持，不扩大为全部 IME、只读、冻结或所有输入方式验收。

当前alpha展开/off，cover源码clean同范围，same另一clean标签；未保存磁盘、尚未alpha.92退出。原诊断保留，独立最终复核已请求；本片仍未整体验收、不得Git，父功能/义务/离线待最终人工保持开放。

alpha.92后续收尾实证：cover源码仍选中“覆盖去重样本”，点击隐藏按钮26切为on且switch焦点，Space切回off并保持正文clean/焦点，Return再on、Return再off。same/cover往返仍源码并恢复该范围。再次带范围点击重扫27，叶AX重建、焦点rescan；Space/Return后AX无变化，按钮焦点、根selected与clean保持，不把AX无变化写成每次generation换代实证。再次same/cover恢复选区，⌘⇧M回编辑仍同范围clean。

两clean标签下⌘Q正常返回App quit，ps确认PID81870无进程。cover磁盘SHA-256仍`dd892cc5a5190572ebf43686ca4a9013de9aeef30c5da8107cf8d1e8649a5479`，本轮未保存；此补alpha.92带clean文档正常退出，不覆盖dirty取消等其他路径。alpha.92自然IME、用户自然键盘和只读新路径未实操，保护逻辑仅保留对应受控测试证据。当前无alpha.92运行现场，历史内存诊断不可再读；整片待独立最终判断，不自批、不Git，不关闭父项或最终离线责任。

最终verifier结论：0代码阻断，但此前已明确的用户自然Space复验仍为必要项，不降为可选，不凭工具Space通过替代，整片尚未验收/不得Git。主线typecheck、全lint、feature-docs/obligations及diff检查通过。

为用户复验，主线重新启动同alpha.92包，exec38227 / Bun PID82645；实际加入alpha/off并展开，打开cover108字节clean唯一编辑标签，编辑器焦点，树cover selected、section折叠，诊断停止无记录，侧栏26.4。该新运行现场覆盖前次“当前无运行现场”，等待用户点击alpha目录名后使用自然键盘Space；未保存、不补造用户结论。F-027b仅为下一推荐规划，当前不实施，其他父功能/义务/离线边界不变。

### 用户必要自然复验通过（2026-10-05，待最终验收复核）

用户明确反馈本地验证无问题：选中目录名后直接按空格，正文无变化、文件无变化、目录无变化。该自然Space必要项已亲验通过，不再列为待用户；用户此前确认显示隐藏文件功能正常仍保留，不将其扩写为所有边界逐项亲验。

结合上述受托Agent实际窗口代验与独立代码审核，本片非离线验收完成候选提交最终verifier判断，作者不自批、不预写Git。自然IME、只读新路径、真实busy竞态等未实操限制保留；F-026父功能、其他完整义务与F-026c-offline-final仍开放，不断网，不以本片关闭后续消费者责任。

### 非离线本片正式通过（2026-10-05）

最终独立verifier确认0剩余阻断，复跑18 tests / 168 assertions / 4文件 / 213毫秒及相关检查通过；主线据此确认F-026c alpha.92非离线本片正式通过。用户亲验为自然Space必要路径，其余为受托Agent代验，不混写来源或补造逐项亲验。历史失败/候选、自然IME及只读新路径等未实操限制保留，父F-026、完整义务和F-026c-offline-final继续开放。Git仍待主线实际执行核验，不提前写提交或远端成功。
