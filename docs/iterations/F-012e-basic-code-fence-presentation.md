# F-012e：代码围栏基础呈现

## 当前验收结论（2026-09-27）

用户确认 alpha.26 语言展示验收通过，既有围栏与其他项通过结论保留。本片 F-012e 已验收；不补造本轮真实 IME 候选期间自然故障、深色或键盘按钮复验，下方历史证据保持原貌。OBL-068 仅本片范围通过，未来消费者仍开放，父功能未完成。A/B/C/D 本批结束，下一轮由用户选择，未提交或推送。

> 状态：已验收（本片围栏与语言展示范围；后续责任开放）
> 日期：2026-09-26
> 用户授权按 A、B、C、D 顺序实现并统一进入人工验收；本片为 A，不授权提交或推送。

<!-- obligations: OBL-068 -->
<!-- deferred-obligations: OBL-012, OBL-020, OBL-041 -->

## 1. 功能说明

- 编辑模式为 CommonMark 围栏代码与缩进代码增加基础背景、边界和等宽呈现。光标或任意选区触及整个围栏代码块源码范围时显示原始开闭围栏及 CodeInfo（语言与尾部元数据）；全部选区离开后，隐藏 CodeMark 与完整 CodeInfo，语言首 token 以较小字号、次级主题色呈现在首行右上角。无语言不显示标签；正文、容器前缀及空行保留，不改写原文。
- 源码模式继续使用纯代码编辑器外观，不叠加本片背景或边界。模式切换共用原文、选区、历史和保存通道。
- 不新增语言语法高亮、折叠、复制按钮、行号、格式化或专用滚动容器；保持现有自动视觉折行，不改变换行策略，不执行代码、HTML或网络请求。
- 原文 BOM、混合换行、缩进和末尾换行不受展示影响，继续遵循 1 MiB 普通文档边界。未被现有解析器识别的内容保持原样。

## 2. 最小技术方案

- 复用 `liveFormattingPlugin`，识别 `FencedCode` / `CodeBlock`，只在各可见范围交集的物理行添加固定行装饰。第一/最后源码行附边界类，不为可见片段伪造代码块边缘。
- 背景与边界使用已有应用主题 token；边界以内部阴影呈现，保留 CodeMirror 基础行距、内边距和宽度。代码子树不继续遍历，避免标题、列表及行内格式误装饰。
- 围栏显隐仅检查 FencedCode 首尾两个子节点是否为 CodeMark，在可见范围内去重生成替换装饰；不遍历正文或引用前缀子节点。选区与整个块采用含端点相交判断。不隐藏换行、正文或容器前缀；源码和安全源码模式不挂载本片装饰。
- 语言展示仅在首行可见且块未激活时读取开围栏后的一个兄弟节点 CodeInfo，替换其完整原范围；有界读取首 token，用安全 data 属性和 CSS 伪元素显示，不解释 HTML。标签字符数与视觉宽度受限并省略，不改行高或扩大横向布局；块激活立即移除标签并恢复 info 正常源码字体。源码与安全源码始终不加此装饰。
- 复用 IME 期间装饰冻结/映射和现有编辑/源码 Compartment。外观不修改文档或构建第二份正文，不主动全量解析、扫描整个代码块。
- OBL-068 只承接本片外观；后续编辑扩展责任继续开放。OBL-012 完整调度/取消与版本隔离、OBL-020 全局缓存预算、OBL-041 完整编辑命令保留后续，本片不新增格式命令。父 F-012 / F-042 未完成。

## 3. 继承约束检查

- F-002：核心离线；仅视图装饰不写盘，回归原文、BOM/换行、源码切换及复制数据；真实保存沿用既有实现。
- 中文与外观：中文代码注释与 emoji 原样，浅深/系统背景及边界使用应用 token；真实 IME 与对比度留人工验收，自动检查只证明状态及装饰边界。
- 命令与键盘：不增加按钮或命令；现有方向键、选择、编辑/源码切换、保存、撤销均保留。围栏原标记始终可编辑，不引入仅鼠标能执行的动作。
- 安全与日志：无 HTML 解释、脚本执行、网络资源或代码运行；不新增正文/路径日志。代码字符串仅留在原编辑文档，已有只读、保存及关闭保护不变。

## 4. 最小 happy path

1. 打开反引号、波浪号、缩进代码、空代码块及未闭合围栏样本，编辑模式显示基础背景边界；离开块时围栏符号与原始 info 隐藏，语言首 token 显示在右上角，光标或选区触及块时移除标签并恢复全部源码。语言与正文原文始终不变，展示随激活变化；内部 Markdown 不被标题/列表排版。
2. 编辑中文与 emoji、选择/复制代码、撤销/重做并保存；BOM 与未触及混合换行保留。切入源码后无本片排版，切回恢复，选区/历史连续。
3. 缩窄窗口及滚动长围栏，保持现有视觉折行；只渲染可见行且跨视口不出现虚假首尾边界。浅深/系统主题、真实中文候选和实际复制保存人工检查。
4. 运行定向、类型、Lint、格式及承接检查；本批最终统一构建和人工验收由主任务记录。测试通过不代表用户验收。

## 5. 实施与验证记录

2026-09-26：本批授权下落最小迭代方案，开始实现；尚未构建交付或人工验收。

### 实施与局部自动验证（2026-09-26）

- 已在编辑呈现中加入代码块可见行背景和首尾边界，采用内部阴影而不增加盒模型宽度；原围栏、语言串、代码及所有缩进保持可编辑原文，不进入代码子树处理标题/列表。新增回归覆盖空/未闭合围栏、缩进代码、列表内代码、HTML 排除、重叠可见范围、BOM/混合换行、模式切换和撤销历史；旧代码块测试同步允许纯行级代码装饰，继续禁止内部 Markdown 替换。
- `bun test apps/desktop/src/client/code-fence-presentation.test.ts apps/desktop/src/client/live-formatting.test.ts apps/desktop/src/client/list-presentation.test.ts`：25 项通过，592 个断言；本片新代码块测试 4 项。
- `bunx --no-install eslint --max-warnings 0 apps/desktop/src/client/live-formatting.ts apps/desktop/src/client/live-formatting.test.ts apps/desktop/src/client/code-fence-presentation.test.ts scripts/create-f012e-fixtures.ts` 与 `bun run typecheck` 通过，相关源码经 Prettier 格式化。
- `bun scripts/create-f012e-fixtures.ts` 已生成一次性样本：`/var/folders/jy/rh9p8thj3t32m4pwhk38jydc0000gn/T/agentic-markdown-f012e-4xEe4b`。01 为各类代码块及长行，02 为 BOM、CRLF 2 / LF 1、无末尾换行，03 为长围栏滚动样本。运行脚本会生成新目录，不覆盖既有文件。
- 承接检查启动时通过；新增迭代后的首次收尾因 OBL-068 尚缺本片登记回链失败，交主任务同步登记后复查。最终全量、构建、产物版本与人工验收由本批主任务补录；上述局部通过不代表已交付或人工通过。

### 批次构建与全量验证（2026-09-26）

- 统一版本 `0.1.0-alpha.23`；构建前递增，`AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary` 成功，归档内 `version.json` 核对 hash `3ukcs6yqf2ef9`、canary。产物 `apps/desktop/artifacts/canary-macos-arm64-AgenticMarkdown-canary.dmg`，未签名；实际解包 `/private/tmp/agentic-markdown-batch23.E3S8Ib/Agentic Markdown-canary.app`。
- `bun test`：448 pass / 0 fail，3195 assertions，68 files，2.57 秒。`bun run lint`、`bun run typecheck`、`bun run check:feature-docs`（含承接检查）、`bun run check:lockfile`、`git diff --check` 通过。包内 Bun 1.4.0 全量重跑同为 448 pass / 0 fail，2.27 秒。
- 包内 Bun 首次与性能实验并行的全量运行有 1 项既有文件/父目录权限测试失败，447 项通过；随后权限定向 6 项/39 断言通过，完整重跑全部通过。未定位首次失败原因，不把它宣称为已修复，也未为通过而放宽断言。正式测量为非隔离环境单次探索，不是性能门槛。
- 多链接承接检查器已支持同一开放责任的多个合法切片，保留逐片双向校验、唯一主承接及关闭条件；13 项/31 断言通过，解决新增切片后的旧单链接检查失败。不关闭本片之外的责任。
- 独立复核覆盖规格、规范和安全；各片实际证据见本文件。人工统一使用[批次验收清单](2026-09-26-batch-acceptance.md)。本批全部停在待人工验收，未提交或推送。

### 真实窗口与人工交付

alpha.23 实际窗口浅色截图已观察反引号/波浪线代码块背景、边界及缩进代码，代码内部标题/列表/HTML 保持原文。文件选择器自动化曾超时，后续恢复观察成功，未将工具等待算作应用性能。深色、窄窗口和完整滚动/输入手感仍留人工。

Agent 在旧临时目录 `f012e-4xEe4b` 的 01 样本进行了 B 故障后编辑保存测试。已重新运行样本脚本生成干净目录 `/var/folders/jy/rh9p8thj3t32m4pwhk38jydc0000gn/T/agentic-markdown-f012e-xwrZCV`，以此为人工验收基准，不覆盖旧样本或真实用户文件。普通 alpha.23 已重新启动到欢迎页。

### 围栏显隐反馈与调整（2026-09-26）

- 用户反馈 A 在编辑模式离开代码块后仍显示反引号/波浪线，其余 A 检查通过。旧方案确实始终保留围栏标记，以上 alpha.23 历史记录不改写；当前方案按用户反馈调整为块级激活显隐，本片调整待复验，不自动关闭 OBL-068 或父功能。
- 现在光标或任意选区与整个围栏源码范围（含端点）相交即恢复围栏；全部离开后仅替换直接 CodeMark 符号，语言名、引用/列表前缀、正文、换行和空行保持。重叠可见范围去重，代码正文仍不进入 Markdown 子装饰；不改变现有 IME 冻结机制、原文、历史和保存。
- 新回归直接检查非激活装饰包含准确 CodeMark 替换范围（旧实现没有此替换），并验证块内/边缘/跨块及多选区恢复；覆盖反引号、波浪线、更长围栏、空/未闭合块、列表/引用嵌套、BOM/混合换行、视口裁剪和源码/安全源码原文。同步旧测试仅允许围栏符号替换，仍禁止内部伪 Markdown 排版。
- 定向 `bun test apps/desktop/src/client/code-fence-presentation.test.ts apps/desktop/src/client/live-formatting.test.ts apps/desktop/src/client/list-presentation.test.ts`：27 pass / 0 fail，695 断言。`bun run typecheck`、三份修改源码的 ESLint 与 Prettier 通过。初次定向运行发现旧“仅行级装饰”断言与列表圆点替换干扰了围栏专属断言，调整为分别核对代码行背景与围栏范围后通过，未放宽正文保真义务。
- 新包版本、构建与人工复验由主任务追加；此记录不宣称新包已交付或真实 IME 重新验证通过。
- 本次本地 `bun test`：450 pass / 0 fail，3298 断言、68 文件，3.07 秒；`bun run check:feature-docs`（含承接检查）与 `git diff --check` 通过。
- 独立复核发现初版查找 CodeMark 遍历全部直接子节点，长引用围栏存在每行 QuoteMark/CodeText，违反视口有界要求。现已核实 CommonMark 闭合/未闭合、嵌套、空块结构并改为仅检查首尾子节点；单一开标记由既有去重处理。新增 10,000 行真实引用围栏回归，探测真实 nextSibling accessor，三行中部与开围栏视口均不遍历正文兄弟节点；不以易波动耗时阈值替代有界性验证。
- 有界性修复后，以上三文件定向测试 28 pass / 0 fail、702 断言；类型检查、两份修改源码的 ESLint/Prettier、文档承接及差异检查通过。后续新包由主任务重新构建，不交付已知性能回归版本作为验收包。

### 语言展示态反馈与调整（2026-09-26）

- 用户确认围栏符号隐藏通过，并明确要求语言文本改为展示态；本次请求授权以下调整。旧方案特意保留 CodeInfo 原串，不是解析失败；保留先前方案与验收记录，不把此次新增展示要求写成早已实现。
- 未激活块隐藏完整 CodeInfo，包括语言与尾部元数据；语言首 token 在首行右上角以 0.75em 和主题次级文字色显示。标签为安全 data 属性经 CSS `content: attr(...)` 呈现，非 HTML；最多有界读取 65 个源码单位、显示 40 单位加省略号，去除显示控制符，视觉最大 `min(40%, 24ch)` 并溢出省略。不改变正文行高和文档数据；无语言不显示标签。任意选区触及整个块，移除标签、恢复全部 info 与围栏正常源码字体。
- 首尾标记维持有界访问，仅首行可见时取开标记后的一个兄弟节点；依据 CodeInfo 原范围替换，不读取整段巨大 info，不扫描代码正文。源码/安全源码、选区/历史、保存和 IME 冻结路径保持不变。
- 新回归 `inactive info becomes a bounded upper-right label, active info returns verbatim` 先在旧实现运行，真实失败于 CodeInfo 未被替换；实现后通过。补充无语言、恶意尖括号/属性文本、尾部元数据、100,000 字符 info、方向控制符、重叠视口去重与主题 CSS 断言。长引用围栏回归调整为首行至多一次兄弟读取，正文视口不遍历；三文件定向 30 pass / 0 fail，743 断言。
- 本次实现仍待独立复核、新包构建及人工验收；不凭 CSS/状态断言宣称真实窗口视觉通过。
- 本地全量 `bun test`：453 pass / 0 fail、3346 断言、68 文件，2.77 秒；`bun run typecheck`、三份修改源码的 ESLint/Prettier、`bun run check:feature-docs`（含承接检查）及 `git diff --check` 通过。未构建或变更版本，未执行 Git 提交/推送。

### 显隐修正验收包（2026-09-26）

- `0.1.0-alpha.24` 为中间构建，未作为验收包交付；性能修正后再递增为 `0.1.0-alpha.25`。执行 `AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary` 成功，归档内版本核对 `0.1.0-alpha.25`、hash `1i19cut7t322i`、canary；未签名。
- 解包 `/private/tmp/agentic-markdown-batch25.6spzk9/Agentic Markdown-canary.app`，launcher 已核对可执行。DMG：`apps/desktop/artifacts/canary-macos-arm64-AgenticMarkdown-canary.dmg`。未强退或替换用户正在运行的窗口。
- 本机 `bun test` 451 pass / 0 fail、3305 断言、68 文件；`bun run lint`、`bun run typecheck` 通过。独立 Standards / Spec 复核确认有界性问题关闭，另检验空块、未闭合及混合嵌套首尾结构，未发现剩余阻塞。
- 人工仅需补验围栏显隐：编辑模式光标与选区移到块外后隐藏围栏符号，回到块内恢复；语言、空行与正文保留；源码模式完整显示。不是通过切换窗口焦点隐藏仍包含光标的代码块。此前其他 A 项通过结论保留，本次新包显隐仍待用户复验。
- alpha.25 归档内 Bun 执行全量测试：451 pass / 0 fail、3305 断言、68 文件，2.29 秒；本次包内运行没有出现 alpha.23 历史权限测试波动。新版实际窗口和真实 IME 未重新执行，不以测试结果代替人工复验。

### 语言标签验收包（2026-09-27）

- 构建前版本递增为 `0.1.0-alpha.26`，执行 `AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary` 成功；归档版本核对 hash `1kgql8h2mqdnc`、canary。未签名 DMG 路径不变；解包 `/private/tmp/agentic-markdown-batch26.idkIh5/Agentic Markdown-canary.app`。
- 独立 Standards 与 Spec 两条只读复核均无阻塞；额外核对前置空白、无语言、引用/列表嵌套、未闭合与首行边界。小字号、次级色、右上角仅为规则与回归证据，未冒充实际像素验收。
- 本机完整 Lint、类型检查通过。与构建并行的首次全量出现既有 `same-name files and hard links have separate canonical locations` 用例 `FILE_CHANGED`，452 pass / 1 fail；原因未定位，未改用例或放宽断言。该文件定向重跑 11 pass / 53 断言；随后本机全量 453 pass / 0 fail、3346 断言、68 文件，2.23 秒；alpha.26 包内 Bun 全量同为 453 pass / 0 fail、3346 断言，2.08 秒。
- A 围栏符号隐藏已由用户认可，本次语言标签交互仍待复验。B 窗口代验遇 Mac 锁定，已请求解锁，因此尚未启动 alpha.26 做窗口验证；C/D 用户验收结论保持，不提前关闭父功能或开放责任。

### alpha.26 实际显示观察（2026-09-27）

- 用户解锁后，实际新版窗口打开 `agentic-markdown-f012e-VMJo5F/01-code-blocks.md`。浅色截图确认：块外 `typescript` 与 `unknown-language` 标签在各代码块首行右上角，字号小于正文、颜色为次级色，原位围栏和语言串隐藏；点击 TypeScript 块正文后，标签消失、原始反引号与 `typescript` 在左侧原位恢复正文字体。
- 这是 Agent 对浅色普通宽度及块内外切换的实际观察，不代替用户视觉验收；深色、窄窗口与真实 IME 本次未复验。源码保真与布局边界自动证据见前文。
- 此临时样本随后用于 B 故障后的编辑/保存验证，已包含测试标记，不再作为干净原始样本。普通 alpha.26 已启动欢迎页，等待用户对 A 语言标签的最终确认；本轮只更新记录，没有代码改动或重新打包。
