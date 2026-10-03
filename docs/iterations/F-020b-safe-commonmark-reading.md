# F-020b：真实 CommonMark 阅读内容安全

> 状态：已验收

2026-10-03：alpha.62 本片经用户授权由 Agent 代验通过，独立复核无剩余阻断；非用户亲验。临时 IME 内容经关闭放弃后，完整 AX 确认欢迎页、无打开标签而文件树 B 保留；磁盘 B 仍 157 字节，SHA-256 `3afe08140f446b53ba6cca1dc5665dee4a280a6d0f334d9966d24a01deab523e`，未保存临时输入。输入源三次只读检查均为搜狗拼音，本轮未切换系统输入源。

下方“未验收/待授权/待复验”均为历史检查点，不覆盖本结论；版本差异、失败和有限实操边界保留。完整父 F-020/F-021/F-030、OBL-030/047 保持开放，OBL-029 主题延期，其他既有义务不关闭。连续自动推进及验收后 Git 授权保持；当前提交推送尚未执行，不预写成功。

## 最新检查点：alpha.62 待复验（2026-10-03）

alpha.62 退出放弃已实际确认 App quit、目标包无进程、B 磁盘 157 字节且无退出临时文字，详见 [F-021a 最终退出实证](./F-021a-basic-reading-mode.md#alpha62-退出放弃最终实证)。前几次索引失效/疑似取消不计成功；其他已记录路径各保留范围边界。真实 IME 仍待用户对临时系统输入源切换授权及实际操作，不标整批已验收、不提交。

alpha.62 新增实证见 [F-021a 重复打开与关闭放弃](./F-021a-basic-reading-mode.md#alpha62-重复打开与关闭放弃)：A 文本普通/辅助点击后仍留阅读区（无抓包结论），重复打开只保留一标签且模式不变；“权限确认中”实际出现并恢复；B 阅读 dirty 后关闭放弃，磁盘未写临时内容。仍缺退出放弃及真实 IME，不全验收、不 Git。

当前包 `/tmp/agentic-markdown-alpha62.Xbkepv/Agentic Markdown-canary.app`，版本 `0.1.0-alpha.62`、hash `199hn43mu7z6i`，构建成功（`/tmp/agentic-reading-build62.log`）。源码与包内各 617 pass / 0 fail、17265 断言、99 文件，分别 12.04 秒与 11.48 秒，日志 `/tmp/agentic-reading-test62.log` 和 `/tmp/agentic-reading-packaged62.log`；typecheck、完整 lint、feature-docs、obligations 及差异检查真实通过。权限文案独立复核无阻断，但新版真实文案路径仍待复验；alpha.62 已启动并成功打开 A 安全样本，不据此宣称整批通过。

alpha.61 另有系统外观证据：选择跟随系统后阅读画面正常，再打开设置，AX 确认组合框为“跟随系统”；之后 Up、Return 执行恢复深色，但动作后未单独 AX 读取组合框，不将恢复动作写成已复核设置值。Escape 后 `⌘Q` 普通退出，CUA 返回 App quit；该记录属于 alpha.61，不外推为 alpha.62 退出或系统明暗切换全过程验证。以下旧版本检查点保持历史，完整父功能与 OBL 不关闭，未全验收、不 Git。

## 最新检查点：alpha.61 局部复验（2026-10-03）

当前待验包为 `/tmp/agentic-markdown-alpha61.TSp0bB/Agentic Markdown-canary.app`，版本 `0.1.0-alpha.61`、hash `1gety8p99mazd`，构建成功（`/tmp/agentic-reading-build61.log`）。源码 Bun：615 pass / 0 fail、17254 断言、99 文件、12.25 秒（`/tmp/agentic-reading-test61.log`）；包内同数、11.34 秒（`/tmp/agentic-reading-packaged61.log`）。主 Agent 确认 typecheck/lint/文档检查通过；本次实际读取 `/tmp/agentic-reading-check61.log` 仅含 lockfile registry 检查通过，不能将该文件冒充其他检查日志。

真实 alpha.61 长文经命令面板编辑→阅读→编辑保持第 06 节末/07～09 节附近，alpha.60 命令面板跳顶问题已实际复测修复；Escape 后截图亦保持附近，焦点仍待 AX 确认。alpha.60 浅色截图正常、已恢复深色，属于旧版外观证据，不冒充 alpha.61 或系统主题专项。剩余 UI 验收与完整父功能/义务保持开放，未验收、不 Git；下方 alpha.60 失败和阶段记录保留历史。

## 最新检查点：alpha.60 待复验（2026-10-03）

本批最新进展见 [F-030a 选区保护与位置缺陷](./F-030a-mode-lifecycle-foundation.md#alpha60-选区保护通过与长文模式位置缺陷)：部分关闭/模式实证补齐，但发现长文切阅读跳回开头，正在修复，本批仍不验收、不提交；安全本片此前局部证据不等于整批通过。

以下检查点按产生时事实保留；以[本轮阅读保存与模式往返追加](./F-021a-basic-reading-mode.md#alpha60-阅读保存保真与暂态只读观察)为最新局部证据，后面的“第二文件未证实/返回未知”等为旧历史。fidelity 源码往返阅读后 DOM 6 项仍通过，不代表剩余项已验收。

本轮新增实际阅读 DOM 审计：B 修改后 revision 1 / 10 个受控元素、fidelity 修改后 revision 1 / 6 个受控元素均通过；阅读保存与混合换行磁盘保真以及暂态只读观察见 [F-021a](./F-021a-basic-reading-mode.md#alpha60-阅读保存保真与暂态只读观察)。这些局部成功不构成本批总体验收，暂态异常和剩余真实验证仍开放，不提交。

后续实际打开 B 成功，默认编辑且 clean，A/B 同时存在；返回 A 的操作继续超时，最终结果未知。详见 [F-030a 本次真实检查点](./F-030a-mode-lifecycle-foundation.md#alpha60-新增打开-b-的真实检查点)，不据此宣称多文档往返或改变未验收状态。

后续实际进展：alpha.60 已成功打开 reading-a 并进入阅读，正确只读状态文案复验通过；规范解析 rev 0 / 20 块 / 7 ms（仅 Worker），DOM 诊断通过 68 个受控元素且无编辑 DOM。深色实景样式可辨；第二文件打开及其他必要路径仍未证实，未验收、不提交。详细新证据与工具阻塞边界见 [F-021a](./F-021a-basic-reading-mode.md#alpha60-局部真实复验与后续工具阻塞)，下方首次连接失败保持历史。

下方 alpha.59 阻塞记录保留为历史，后续已取得局部真实窗口证据，不能外推为全部通过；当前最终待验包为 alpha.60。三片与完整父功能/OBL 均不据此关闭。用户重申后续自动推进，不再逐轮要求手动打开文件；遇到实际无法克服的验证阻塞仍如实说明并在必要时请求协助。

alpha.60 修正阅读状态条误报“编辑模式 · 可编辑”的显示问题，独立复核及专项 11 项 / 204 断言通过。源码和包内全量各 612 pass / 0 fail、17246 断言、97 文件，分别 12.65 秒与 11.39 秒，日志为 `/tmp/agentic-reading-test60.log`、`/tmp/agentic-reading-packaged60.log`。构建成功，日志 `/tmp/agentic-reading-build60.log`；产物 `/tmp/agentic-markdown-alpha60.M5Sl6x/Agentic Markdown-canary.app`，版本 `0.1.0-alpha.60`、hash `2vwyssfti5ctq`。以 `AGENTIC_MARKDOWN_EDITOR_FAULT_LAB=1` 启动，会话 `79902` / PID `48027`；首次 CUA 获取应用 120 秒超时，尚未完成新版复验。完整 alpha.59 进展和环境边界见 [F-021a](./F-021a-basic-reading-mode.md#alpha59-继续真实代验与-alpha60-环境边界)，不将旧版证据冒充新版复验。

## 当前检查点：alpha.59 待真实代验（2026-10-03）

未实证真实 WK 阅读 DOM、内容入口和惰性内容点击；SSR/受控测试不能替代实际挂载验证。 以下此前等待构建的记录为历史，本段仅更新实际交付证据，不预写验收。三片共享同一构建，各自责任和完整父功能仍开放，连续授权保留，但须先完成本批验收再提交。

- 源码全量测试 611 pass / 0 fail、17215 断言、96 文件、13.35 秒；日志 `/tmp/agentic-reading-full-test.log`。包内 Bun 同数通过、11.47 秒；日志 `/tmp/agentic-reading-packaged59.log`。
- typecheck、lint、check:feature-docs、check:obligations 和 lockfile 检查通过；独立 Standards/Spec 最终无阻断，但不等于真实 UI 验收。
- `AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary` 成功，日志 `/tmp/agentic-reading-build59.log`；产物 `/tmp/agentic-markdown-alpha59.rpbM4N/Agentic Markdown-canary.app`，版本 `0.1.0-alpha.59`、hash `2wd300v77wvvc`。

主 Agent 以 `AGENTIC_MARKDOWN_EDITOR_FAULT_LAB=1` 启动本包，会话 `31495` / Bun PID `45539`（检查点时观察）。实际只确认欢迎页、诊断入口、alpha.59 提示、`⌘O` 原生选择器及 `⌘⇧G` 路径框。设置临时 reading-a 路径并两次 Return 的工具调用约 124 秒后 Sky 超时，重绑应用约 20 秒超时并重置内核，再次获取应用 120 秒超时；未实证成功打开文档、阅读、三模式或 DOM。工具此前每次调用亦曾约 78 秒，原因未知，不据此判断锁屏或应用故障。

恢复用临时样本目录为 `/tmp/agentic-reading-acceptance.bpUydC`，未写回用户文档或这些样本。a SHA-256：`2fbfa46474cbfcbc5cba04ead012490e6d3d9ef780574bd48b95ddf2fadd33f0`；b：`3b638c94bb52473c314d1d09ff87fbf09ffce9a31a85f1747d33166f2f08f2bb`；fidelity：`025d4fd419fe0cdacb7985a1eed53bfc90edcaae8ca7054da2cabe40e4b04944`。主 Agent 准备请用户手动打开样本以解除工具阻塞，不将该计划写成已操作。OBL-030/047 仅局部实施、OBL-029 延期，原父功能与其他义务不关闭。

<!-- obligations: OBL-030 -->
<!-- deferred-obligations: none -->

## 功能说明与边界

将 F-020a 固定语料的应用入口保护推进到真实 Markdown 文档的首个阅读消费者，为 [F-021a](./F-021a-basic-reading-mode.md) 提供安全的 CommonMark 节点呈现。优先保证不可信正文只是数据，没有脚本、资源、导航或下载的主动入口。

本片局部承接 OBL-030，完整 F-020、Raw HTML 安全子集、资产、链接打开、后续扩展与原生静态风险仍开放。`deferred-obligations: none` 不表示本片关闭完整 OBL-030。沿用 F-020a 用户批准的应用入口路线，不自行修补原生框架、不运行真实下载 PoC、不访问真实 Downloads。

2026-10-02 用户补充明确：留待专项设计的产品选项先不自动开发。本片不决定副区展开入口、大纲呈现、Frontmatter 阅读呈现或围栏内部换行策略；只继续不依赖这些决定的安全基础。

## 本片最小技术方案

1. 消费 F-019b 当前身份、正文 revision、解析配置及 generation 对应的规范解析结果；不重新解析磁盘旧正文，不把内部 mdast 变成跨模块的可变权威状态。结果过期或异常时不挂载旧文档内容。
2. 使用 React 显式元素或 `createElement`/`textContent` 构建受控 HTML 节点，标签名与应用属性由代码白名单决定。支持标题、段落、引用、列表、强调、行内代码、代码块、分隔线和换行等当前 CommonMark 结构；正文、info string、链接标题等始终作为字符串数据，不展开为 props、style 或 HTML。
3. 禁止 `innerHTML`、`dangerouslySetInnerHTML`、任意标签名、任意输入属性、DOMParser 解析用户 HTML、SVG/MathML 活动节点及正文提供的事件。由纯节点构建保证安全不是绕过净化：这条路径不接收 HTML；未来接收 Raw HTML 的 F-023 仍须使用对应净化与审计。
4. Raw HTML 节点在原位置按不可执行源码呈现并有中文原因；图片只显示可理解的占位/替代文本，不创建 `img`、`src`、CSS URL 等资源入口；链接及引用链接仅呈现惰性可见文本，不创建 `href`、`target` 或 `download`。这些都是首片限制，不改变 F-022/F-023/F-055 已确认的最终产品规则。
5. 未知节点保留对应原文范围并局部降级，不能静默丢失内容；合法引用定义按 CommonMark 非正文语义处理，不误认为未知节点。递归深度/工作量异常要有安全退路，不用截断原文伪装渲染成功。
6. 继承 CSP、导航规则和内容容器默认行为保护；允许普通选择与复制，不阻止无害正文操作。检查产出 DOM 只有受控命名空间、标签与属性，没有内容产生的主动入口。原生 2.0.1 静态下载分支风险不等于此入口可利用，也不因本片验证而宣称修复。

## 最小 happy path 与自动/代验计划

- 正常 CommonMark 样本呈现预期结构，BOM/CRLF/emoji 范围映射对应原文；代码和未知语言不执行。
- 威胁语料包含 HTML 脚本/事件、iframe/form、SVG、远程与本地图片、`javascript:`/`data:`/协议相对链接、下载属性与畸形嵌套。检查节点构建结果及真实 WKWebView DOM，无主动节点/属性；Raw HTML 源码完整可见。
- 不通过“点击真实恶意地址”证明安全；先核查不可达入口，再在无真实下载副作用的样本上操作普通/辅助点击与键盘，检查不离开 App、不产生内容触发的打开动作。
- 验证未知节点和构建异常只进入安全降级，不写回正文、不改变 dirty/撤销/保存基线；新旧解析结果竞争时拒绝旧结果。
- 自动测试和真实打包窗口代验分开记录。独立 reviewer 检查所有内容入口及降级保真；失败自动修复后递增打包版本并重验。无法实操或无法观测的项目写“未验证”，不得用合成事件代替原生结论。

## 继承约束检查

- F-002：离线处理当前内存文档，不额外读取用户路径、不加载网络资源、不回写 Markdown；验收前后核对测试文件字节。
- 中文与外观：降级、占位与错误提示中文；浅色/深色/系统外观下可读。正文主题由 F-021 跟进，不把 App 外观当完整阅读主题。
- 命令与键盘：本片不增加链接打开命令；正文可选择，阅读模式入口由 F-021a 统一命令承接，验证键盘选择及焦点不会激活惰性内容。
- 安全与日志：拒绝正文触发 RPC、脚本、任意进程或资源权限扩大；日志仅必要匿名状态/耗时，不含正文、路径、链接或完整 AST。

## 实际实施与验收记录

尚未实施；完成后在本文件追加真实改动、测试命令、版本/构建、独立审查与 Agent 受托代验证据。不将自动测试通过或本方案记录标为已验收，不关闭父 F-020/完整 OBL-030。

### 2026-10-03 实施检查点

上句为方案阶段历史。新增 `security/commonmark-content.tsx`：直接从内部 mdast 构建静态白名单 React 元素；无 HTML 输入 API、无动态正文属性、无 URL 资源属性。HTML 按范围显示源码，链接惰性文字、图片替代说明，定义按非正文处理。代码块目前完整源码降级，不借此决定围栏换行专项；深度/工作量异常整篇原文保留。

`auditReadingContent` 仅在显式 `AGENTIC_MARKDOWN_EDITOR_FAULT_LAB=1` 下检查实际已挂载阅读 DOM 并显示匿名结果，不是挂载前安全闸。属性按元素种类与固定 class/title/role 值检查，范围值限定为非负安全整数。安全来源是节点构建本身；审计不能替代该边界，更不能证明原生下载分支已修复。独立首轮建议已修正任意 class 和 title/role 所属标签检查，并增加负例。

实现后运行联合专项命令：`bun test apps/desktop/src/client/documents.test.ts apps/desktop/src/client/current-canonical.test.ts apps/desktop/src/client/cross-mode-save.test.ts apps/desktop/src/client/reading-position.test.ts apps/desktop/src/security/commonmark-content.test.tsx`，46 pass / 0 fail、605 assertions；其中 SSR 测试只证明安全节点输出，不冒充真实 DOM。类型检查与本片 scoped ESLint 通过。初次测试误把 escaped HTML 文本内的 `src=` 视为活动属性，修正为仅核对输出真实标签后通过，未改变安全行为。真实包和 WK 证据由协调 Agent 补入。
