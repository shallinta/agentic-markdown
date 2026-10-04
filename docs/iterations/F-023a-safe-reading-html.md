# F-023a：阅读模式有限安全 HTML 块

> 状态：已验收（2026-10-04，alpha.70 非离线本片受托 Agent 代验通过，非用户亲验）。独立 planner 与 verify_html_acceptance 最终均 0 阻断；离线最终人工及完整父义务开放，Git 待主线实际核验。

<!-- obligations: OBL-032 -->
<!-- deferred-obligations: none -->

## 功能说明与范围

在阅读模式中呈现 Canonical CommonMark 识别的独立、完整 HTML 块，复用现有 `CONTENT_TAGS` 零属性白名单与 DOMPurify 净化策略。仅当净化、完整输出审计与保真检查全部通过时呈现；不支持、危险、结构不完整或净化/规范化改变输入时，整块显示原始源码与中文原因，绝不静默删改原文。

本片局部承接 F-023 全部主承接 ID OBL-032；无其他延期 ID 不代表完整义务关闭。行内 HTML、HTML 图片/链接/更多属性、编辑模式及未知 fenced block 完整呈现留后续，父 F-023/完整 OBL-032 开放。硬前置为 F-019b Canonical、F-020 安全净化基础及 F-021a 阅读消费者，不等待这些父功能全部完成。

不支持 script、iframe、表单、SVG/MathML、style、事件/URL 属性、下载或任何资源加载；不新增信任开关、主题能力、文件权限或网络能力。编辑/源码原文与 dirty、历史、保存均保持原行为。

## 最小技术方案

Canonical `node.value` 必须与原文源范围逐字一致，否则整块原始源码加中文原因；不剥离引用/列表前缀，不规范化 CRLF 来争取渲染。初始可调安全保护值为单块 32 Ki UTF-16、单次正文 128 Ki UTF-16、每块 2048 节点及深度 32；实现中验证其行为与真实成本，不视为预设性能门禁或已测结论。

1. 只消费既有 Canonical 位于 root/blockquote/listItem 的 flow HTML 块节点与准确源范围，不通过全文正则猜测块，不把行内节点或残缺标签拼成 HTML。净化前先用纯字符串严格预检：只允许 CONTENT_TAGS 小写零属性标签、正确配对及 void br/hr、普通文本；拒绝注释、doctype、自闭合变体、任何属性和未知 `<`，实体仅作文本。预检限制 UTF-16 源长、token 数及深度，拒绝后不进入 DOMParser/DOMPurify，防止不支持资源标签在净化前产生请求；实现前由 executor 评估并补恶意语料。不支持资格则局部源码降级，不把净化后安全当作解析过程无副作用的证明。
2. 复用 `createSafeContent` 与 `CONTENT_TAGS`：当前 p/br/strong/em/code/pre/blockquote/ul/ol/li/h1–h6/hr/span，所有属性均禁止。DOMPurify 生成分离 fragment 后审计全部节点、HTML namespace、标签及零属性；沿用序列化与输入严格一致的保守保真条件。大小写、空白或结构规范化导致变化也整块降级，不承诺所有浏览器可解释 HTML 都会呈现。
3. 组件只 clone 已通过审计的 fragment，再用 replaceChildren 接入，不重新解析 HTML；不使用未经审计的 innerHTML 或动态属性，不把净化 removed 列表当授权凭证。不让原始 HTML 图片借 F-022a Markdown 图片通道加载，既有脚本/导航/资源限制保持，不改变已有实验台策略。
4. 净化前限制单块及单次正文处理源长，净化后以有界遍历限制节点数/深度；保护值在本轮实现测量后记录，为可调安全资源值而非性能门禁。源长预检查限制同步净化输入，后置节点检查不能宣称阻止全部解析成本；不宣称硬取消或硬内存封顶。
5. 结果按当前正文版本与节点范围复用，切阅读主题不重新净化，不增加每键全文工作；切文档、正文变化及卸载清理陈旧结果，错误只影响对应块。净化器异常、不支持及超限均保留原块源码、固定中文原因，普通日志不输出原文或路径。

## 最小 happy path 与异常验证

- 独立完整零属性段落/标题/列表等块在阅读显示有限结构；前后 Markdown 保持，编辑/源码仍为原文，dirty/撤销/保存字节不变。
- 行内 HTML、残缺/嵌套异常及净化后规范化变化整块保守降级；测试 script、事件属性、style、iframe、表单、SVG/MathML、HTML img/a、危险 URL 与 namespace 混合，不执行脚本/导航/资源请求。
- 节点/深度/源长超限、净化失败安全降级；内容版本变化不复用旧结果，换主题不重新净化，切文档/关闭清理，不把测试成功扩称硬取消或 RSS 限制。
- 真实 WK 验证安全块呈现、危险块源码与中文原因、两阅读主题及 App 外观下可辨、模式往返与焦点；固定安全语料监测无执行副作用，不用网络隔离测试。记录构建 alpha、真实命令结果及独立双轴复核，再进行受托代验。

## 继承约束检查

- F-002：仅本地内存正文派生呈现，不改写文件/保存基线、不请求网络，普通 Markdown 1 MiB 边界不变；断网验证留最终人工。
- 中文与外观：源码降级原因中文，源文原样；纸页/墨夜与 App 浅深/系统下局部结构及提示可辨，不污染外壳。
- 命令与键盘：纯呈现无新增按钮或鼠标专属动作；复用打开与模式/主题统一命令、冻结/IME 与键盘焦点规则，不让 HTML 获得可交互控件。
- 安全与日志：固定 DOMPurify 零属性策略、完整子树审计、保守保真回退与资源保护；无脚本/网络/文件权限扩张，日志不含源文/路径。

## 最终人工待验：F-023a-offline-final

本子项挂 OBL-032：真实 WK 离线环境下安全 HTML 呈现及危险块降级留最终统一人工确认，当前仅记录、不执行也不标通过。不得断网或执行网络隔离；不阻塞本片非离线范围验证通过后的交付及后续，完整义务不关闭。

## 实际改动与验证

当前仅方案，尚未实施、构建或验收；后续在本文件记录实际保护值、测试/构建、真实窗口与独立复核证据，不预写通过或 Git。

2026-10-04 启动补记：主线阅读确认最小方案，独立 Spec 范围复核无阻断，已授权 executor 开始实施。上段保留文档先行时的历史状态；当前代码实施中，尚无构建或验收结果。

### 实际实现与自动验证（2026-10-04，未验收）

- 独立完整 flow HTML 经纯字符串预检、固定零属性 DOMPurify、完整审计及严格序列化等值后，以 clone/replaceChildren 接入独立 `SanitizedFragment` 宿主。实际 Chrome 初测曾发现安全→源码回退复用 div 时旧 cleanup 删除新 React 内容，现以独立宿主修复并经最终回归通过；不删此失败历史。部分单行 SVG 被 Canonical 归为行内，恶意块测试改用 p 内 SVG，未修改 parser 语义。
- 实际保护值：单块 32 Ki / 正文 128 Ki UTF-16，正文最多 256 个 HTML 块，第 257 块起完整源码回退；前置计数最多 2048 token（包括 closing 标签，保守而非实际 DOM 节点数）、深度 32；后置含文本节点最多 2048、深度 33。window 共享固定无 hooks 净化器，主题变化复用结果；样式仅作用于阅读主题内 `reading-html` 宿主。不宣称硬取消、RSS 限额或整体大文档性能解决。
- 主线最终源码全量 655 项 / 17578 断言 / 107 files，12.85s；typecheck、lint、文档/义务、lockfile、diff 检查通过。样式补齐前 655 项 / 17571 断言为中间记录，不能混作最终断言数。独立 Standards 最终生产代码复核无阻断，并复跑相关 Bun 12 项 / 166 断言通过。
- 独立执行 `PLAYWRIGHT_PACKAGE=/Users/shallinta/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node scripts/check-reading-html.mjs` 成功：实际 Chrome/React/DOMPurify 验证安全与降级内容、主题节点复用、换源、资源探针 0 请求、恶意源净化调用 0 次。真实 Tailwind preflight 下纸页/墨夜列表 disc/decimal、引用 3px、分隔线 1px 与代码背景均符合预期。首次默认路径启动因缺 playwright module 失败，指定现有依赖后通过，非代码失败；未安装依赖或执行网络隔离。
- 成本记录保留：初测 256 小块约 53.6ms；最终独立 Chrome 256 块 / 4240 UTF-16 为 34.5ms，15000 块 / 90000 UTF-16 为 822.1ms，换源 38ms。主线另次为 35.2/843.5/30.7ms，executor 另次为 33.9/802.2/40.3ms。均为 parse+React 整体同步合成成本，不是 WK、自然输入、RSS、门禁或稳定提速结论；256 块净化上限并未消除大量源码回退节点的总体成本。
- alpha.70 正在构建，不能写成已交付；真实 WK 代验尚未进行，F-023a-offline-final 留最终人工，不断网，父 F-023/完整 OBL-032 仍开放。

### alpha.70 构建与启动（2026-10-04，未验收）

`AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary` 成功（`/tmp/agentic-html-build70.log`）；tar 实际解包至 `/tmp/agentic-markdown-alpha70.nfouBf/Agentic Markdown-canary.app`，Info.plist 的 `CFBundleVersion` 为 `0.1.0-alpha.70`，无 `CFBundleShortVersionString`；update.json 版本一致、hash `1c2o6quiuj7q0`。包内 Bun 655 项 / 17578 断言 / 107 files、11.81s 通过（`/tmp/agentic-html-packaged70.log`）。

以 `EDITOR_FAULT_LAB=1` 启动，launcher session 76182、PID 2374；真实深色欢迎页截图已确认。打开样本选择器调用 120 秒超时，尚无 WK 内容验收证据，继续重试；工具延迟不归因应用，也不代替内容通过。上方构建中记录保留历史，当前仍未验收、无 Git，离线与完整父义务保持开放。

### alpha.70 WK 局部检查点（2026-10-04）

打开 816 字节临时样本的首轮实际出现“文档通信失败或返回结果无效”，原因未确定；期间多次 CUA 70–120 秒及 kernel reset，不作产品性能归因。第二轮成功打开，界面请求 231965ms 包含选择器/自动化等待，不能作为磁盘 I/O 测量。真实纸页阅读截图显示安全 p/strong/em/code 与 ul 圆点；DOM 审计 66 元素、无编辑 DOM，revision 0 / request 1，Canonical 18 个顶层块、4ms 仅为 Worker 时段。危险内容、主题、dirty 往返及退出仍待验证，继续重试，不据局部成功宣称本片验收通过。

### alpha.70 非离线代验完成候选（2026-10-04）

- 纸页安全 p/strong/em/code 与 ul 圆点已有真实截图，初始 DOM 66、revision 0 / request 1、18 块 / Worker 4ms。后续滚动截图确认 iframe、事件属性及嵌套结构规范化均为完整源码和中文原因；AX 核对 script/img/iframe/事件/行内标签、多行引用原前缀及 unknown 围栏全部保留原文。
- `⌘⇧M` 到源码，完整原文且 clean；`⌘Home` 后粘贴 `<p>临时未保存 HTML</p>\n\n` 成为 dirty。快捷键回阅读，新增段落实际呈现且 dirty 保留，revision 1 / 19 块 / DOM 69 / Worker 4ms / request 3；回源码 `⌘Z` 再回阅读恢复 clean，revision 2 / 18 块 / DOM 66 / request 5。未保存文件。
- `⌘⇧P → Down → Return` 键盘纸页切墨夜，实际截图安全内容、列表、引用为墨夜，107 节点复用通过，request 5 不变。App 深色切浅色后截图墨夜仍独立；跟随系统设置值已确认、AX 正文正常，未修改 OS，未测动态系统变化，末次仅小 badge 截图不作完整画面证据；最终设置深色值已回读恢复。
- `Escape → ⌘Q` 工具 120 秒超时，但 PID 2374 已消失，launcher session 76182 自然 exit 0；残留 `IMKCFRunLoopWakeUpReliable` warning 未归因。样本 SHA-256 前后均为 `283ad68cf6b32f519a1a623bfd0fae5354668aff8312ddecc2a1b99ad6127d10`，未写回。
- 保留首开通信失败、多次工具延迟和 kernel reset，不作性能结论。WK 未直接读取 sentinel 或运行网络探针（Chrome 有对应证据），未新开第二文档；换源/卸载生命周期由自动集成支持，不补造 WK 路径。F-023a-offline-final 留最终人工，完整父 F-023/OBL-032 及后续范围开放。当前仅代验候选，待独立最终复核，不自批准、不预写 Git。
- 主线补跑既有真实 Chrome 位置回归，通过 A/B/A、重复选择、新编辑 B 关闭（有/无主题切换）及选择取消/失败（`/tmp/agentic-html-position70.log`）。这不是 WK 或 HTML 专项多文档实操，不充作本轮桌面第二文档证据。

### 非离线本片验收结论（2026-10-04）

独立 planner 与 verify_html_acceptance 最终复核均为 0 阻断，主线确认 alpha.70 非离线本片受托 Agent 代验通过，非用户亲验。证据包括源码及包内各 655 项 / 17578 断言 / 107 files、独立 Standards 专项 12 项 / 166 断言、真实 Chrome 安全/资源探针与上述 WK 路径；不新增或补造未执行的验收。上方候选、首次失败及未证实边界保留历史，不覆盖本结论。

F-023a-offline-final 仍未验收、留最终人工，不断网；父 F-023/完整 OBL-032 以及行内、更多属性/资源、编辑和未知围栏后续范围开放。Git 待主线实际执行及远端核验，不预写成功。

2026-10-04 Git 回执：已提交并推送 `5a3197f137f7a91adf0108ccad330164166068b6`，主线核验远端相同、当时工作树干净；覆盖此前待 Git 状态，不关闭离线及父义务。
