# F-060c：在 Finder 中显示文件树选中项

> 状态：alpha169 非离线有限片受托代验通过；已提交并推送 `85b3ba67025df93c6102aca31f9e3107fedb4fde`

<!-- obligations: OBL-060 -->
<!-- deferred-obligations: none -->

## 当前状态（2026-10-17）

Git提交钩子前后tree均`fb5521d6d6bc3c19c77ebec9ade60c024dca9a6a`，无额外源码改写。首次SSH22连接关闭；HTTPS远端读取成功但push无可用Username；SSH443首次未知主机标识验证失败，随后仅该命令使用既有github.com的HostKeyAlias并保持StrictHostKeyChecking=yes，push exit0；未改持久Git/系统网络或跳过主机校验。远端收据随后核对。下方Git待执行为历史。

独立Spec最终0必要有限验收阻断，另核PID消失、三SHA及权限和包内日志；Standards无新增代码阻断，要求修正手册单击预览旧措辞并同步交付状态，已落实。主线批准本片非离线受托Agent代验通过，非用户亲验；不关闭完整F-060/OBL-060或已列未测边界，不称全量测试绿。Git已执行且HTTPS ls-remote远端main与origin/main均核为上述85b3ba6完整SHA。

alpha169 unsigned 构建 exit0，payload hash `1ka88jt8lsqh0`；直接解包至 `/tmp/agentic-direct169.4hh99w`，使用独立测试数据区，没有运行安装完成窗口。包内Bun运行仓库测试1533通过/1失败/36612断言/209文件，46.21秒exit1；唯一相同long-whitespace用例17.850秒触发5秒时限，日志`/tmp/f060c-alpha169-bundled-tests.log`。与源码失败均保留FINAL-ISSUE-002，不称全量绿或修复。

真实WK/Finder已实际核：无选择按钮禁用；根、子目录、未打开文件、独立文件和只读文件均在Finder选中精确目标。方向键选择、Space无正文变化、Option+Tab至按钮再Return可定位且不打开标签。独立文档临时输入TEST形成dirty后，定位自身/其他只读项及命令面板入口均保持活动标签、内容与dirty；CmdZ撤销TEST回到clean，未保存。只读文档打开后定位也正常。浅深外观按钮可读，无当前尺寸溢出；浅色选择首次Escape取消后使用Home/Return确认，不将取消算成功。初次root行AX点击误触隐藏开关，已恢复off后点文本重新验；异步展开后第一次Down未移动，观察后再次Down才选中文件。实际现有单击只选择，双击/Enter打开，前文“原单击预览”只是旧方案措辞，不代表本片实现预览。

正常CmdQ退出：工具返回App quit，launcher session15757 exit0、Bun10552不存在；三份样本SHA与下方原值完全一致，只读样本权限已恢复644。自然IME、精确竞态、64批取消/无witness成本及系统静默失败未做真实验证，离线仍留最终人工。当前仅有限验收候选，待两轴最终复核；下文构建前状态为历史。

用户回复已退出，主线进程核对旧launcher/Bun均不存在，批准递增alpha169及unsigned构建（`/tmp/f060c-alpha169-build.log`）。不触碰此前用户文档；后续真实验收使用独立数据区及自建样本。尚未构建成功/验收/Git，下述源码全量既有延期失败保持。

主线全文读取及独立两轴复核后已批准有限实现；当前为实现后自动验证候选，尚无新版本、构建或真实验收。连续授权下推进本片，不取消或关闭 F-047e 定义列表研究及其原失败证据。最新已验包仍为 alpha168。

## 功能说明

在文件树选中一个授权根、子目录、Markdown 文件或独立文件后，通过统一命令“在 Finder 中显示选中项”定位该项。不打开文档、不切换活动标签、不展开目录、不保存或修改 dirty 内容；只读文件允许定位。不修改已有“显示当前文档”命令含义，不增加默认快捷键，不加入默认应用打开目录能力。

建议在文件树附近提供键盘可达的显式按钮，使用当前真实选择；无选择或选择失效时禁用，不将首个可用 roving-focus 项冒充已选项。点击按钮或调用命令捕获选中目标，异步期间选项变更只取消尚未提交的旧请求；已经交给系统的请求不能撤回。原文件树单击、双击、方向键和 Space 行为保持。

## 当前接口与缺口

- `src/components/workspace-tree.tsx` 内部保存 `selected`，通过 `projectWorkspaceTree`、`visibleWorkspaceItems` 得到投影；当前没有对外的选中项定位回调。`src/client/workspace-tree-model.ts` 的 `TreeItem` 区分 root/node/standalone；`path` 和 `WorkspaceNode.displayPath` 只供显示，不能当授权。
- `src/client/workspace.ts`、`src/shared/workspace.ts`、`src/bun/workspace/index.ts` 已有 opaque root/entry handle、generation 与服务端 Root 对象；`open` 仅允许 `root.files` 中的文件，并通过 `authorizeEntry` 验证。定位不得借用 open 创建文档。
- `src/bun/workspace/authorization.ts` 的 `verifyRoot` 复核授权祖先身份；`authorizeEntry` 复核文件 fingerprint、目录 chain 和当前隐藏规则。目录节点由 scan file 的路径前缀投影，目前 Root 仅保存 nodes/byPath/files，没有独立目录身份映射，不能只把显示路径 lstat 一次就视为原授权对象。
- `src/bun/documents/index.ts` 的 `dispatchDocumentPath` / `reveal` 已基于文档 handle 验证 grant、scope、epoch、fingerprint 和写屏障，再调用注入的 `revealPath`。独立文件可复用该服务，但前端需受控的显式目标入口；不能先激活该文件，再调用 `revealCurrentDocument`。
- `src/bun/app/start-desktop-app.ts` 已注入 `Utils.showItemInFolder(path)`。实际 SDK 是项目 `.hutch/devkit/api/sdks/main/core/Utils.ts:14` 与 `proc/native.ts:603,2285`，公开接口最终返回 void；不是缓存的 Electrobun 1.18.1。继续使用公开 SDK，不写新 Bun FFI/原生桥，不拼接 shell。

以上路径均相对 `apps/desktop/`。本次调查也读取了 F-060a 唯一记录与 OBL-060；旧片的 SDK void、文件系统 TOCTOU 限制不能隐去。

## 最小技术方案

1. 统一命令新增选中项入口，由树组件提供明确目标判别对象：独立文件只带 document handle；根/节点只带 root handle、generation、可选 entry handle。RPC 严格字段白名单和 requestId 校验，绝不接受 renderer path、kind 或 fingerprint 作为权威。共享协议、RPC handler、工作区 controller 和 UI 同轮接入，错误中文且不回传系统原始错误。
2. 根定位从当前 Root.authorization 取路径，`verifyRoot` 后复核 root 对象、live、generation、服务 epoch 与未撤销状态。文件节点从当前 files 表取 ScanFile，复用 `authorizeEntry` 和临时 descriptor，finally 关闭，不调用 documents.openAuthorized、不创建文档身份。
3. 子目录从既有经过校验、有界缓存的 scan file.chain 按需取得完整目录前缀证明，不新增目录映射或第二份缓存；具体连续链、同代 witness 和分批取消规则按下节。无完整证明拒绝定位，不询问 renderer 路径或自动扩权。
4. 目录最终验证使用已有受限目录遍历能力，或公开 lstat 身份链验证的窄辅助函数；必须拒绝目录变 symlink、路径越根、祖先替换、`.git`、隐藏规则已撤销和失效 generation。优先复用 `scan.ts` 的 descriptor/openDirectoryAt 既有安全能力，不为定位另建无校验路径遍历。具体复用接口由实现前复核确认；不能假装当前 authorizeEntry 已支持目录。
5. 每次 await 后重核目标归属、身份及请求活性，最后验证到同步 SDK 调用不再插 await。服务单在途或有界请求策略，重复 requestId、取消、dispose 和根撤销不能迟发旧请求；文件正在保存替换时需与现有文档写屏障协调，不能绕过已打开文档的安全约定。若目标已是现有受控 document grant，可受控复用其 reveal，而非重新授予更宽权限。
6. SDK void 只表示已发请求，绝不显示“定位成功”或声明 Finder 一定选中。同步 throw/校验失败为局部错误；系统静默失败不可观测。跨进程在最终验证与 Finder 消费路径之间仍存在 TOCTOU，不承诺原子定位；不以无限重试掩盖身份变化。
7. 目标变化/组件卸载/工作区撤销使迟到反馈失效；不污染新选项、正文选区、dirty/history 或查找状态。遵守现有 busy/IME/frozen 保护，不因新增定位入口绕过组合输入规则。实现后补测试，不采用 TDD 默认流程。

## 最小 happy path 与必要验证

### 实施前收敛：可信 broker 与按需目录证明（2026-10-17，主线已批准）

选择**复用文档服务可信broker，不新增长期目录proof map**。本节取代初稿新增目录映射及相关计费方案，其他安全要求保留；两轴复核后主线已授权有限生产实现和实现后测试。

- `TrustedDocumentService` 新增仅Bun内部使用的 `revealAuthorized`。它复用现有 `dispatchDocumentPath` 的单个 `revealing` 槽、requestId重复检查、task取消/dispose、服务epoch、`saving`、`writeBarrier`、`selectBarrierGeneration` 和同步 `revealPath` 调用。不得用 `withWriteBarrier` 包住定位（那会使定位本身被屏障拒绝），不得在workspace复制一份saving布尔值，也不让workspace直接调用SDK。
- broker接收可信authorizer回调及当前来源活性检查，不接受renderer路径或fingerprint。回调在Bun验证当前root/entry/generation并返回 `{path, close}` 受控临时资源；路径仅来自现有授权对象。资源创建后若回调校验失败，由回调自身关闭；成功返回后所有成功/取消/错误分支统一由broker `finally` 关闭，不能转移或创建document grant。每次await后调用broker提供的task/barrier检查及来源检查；最后检查到同步SDK之间不再await。
- 独立文件继续按现有document handle定位规则；树根/节点按自身workspace来源授权。**某个已打开文档scope撤销不等于自动禁止同路径另一个仍有效的独立/根授权**：不以路径相同继承失效scope，也不凭路径相同扩大权限。共同保证来自同一个broker保存屏障；若树来源所持扫描fingerprint在保存替换后过期，按既有授权规则拒绝并等待刷新，不借文档最新handle悄悄升级该树请求。
- 子目录proof按需从当前Root的既有有界 `files` 映射寻找witness：选中节点必须仍是 `byPath` 中同一个directory对象；找到一条已接纳ScanFile，其chain包含目标目录且从授权根到目标的每级路径/fingerprint完整。仅使用直到目标目录的链前缀，不把子文件末级或显示路径当授权。首个完整witness仍需descriptor链复核；无完整witness拒绝，不自动扩权。
- 不缓存新proof map，故scan append、reconciliation publication、rescan、hidden切换无需维护第二份证明索引。捕获当前 `files`/`byPath` 对象与witness文件handle/object，每次await和最终dispatch前重核；publication替换映射、witness失效、generation或可见规则改变则拒绝。查询最多遍历当前既有cache所容纳的files/chain，额外内存只保单条至多既有限制的chain前缀；以小批次（建议64条文件）让出事件循环并检查取消，不同步扫描整个最大工作区。此为有界缓存上的按需搜索，不承诺常数时间或已测性能；实现后测无匹配/深目录路径，若不足再评估计费索引而非暗加无界缓存。
- 目录/root最终通过 `openDirectoryDescriptor` 复用已有 `DirectoryNative.openDirectoryAt` 与真实fstat指纹，从 `/` 沿授权祖先/目标chain逐级打开；注入现有native能力，不新增桥。descriptor打开失败由原helper关已拥有fd；成功由broker finally释放。文件节点仍通过 `authorizeEntry` 得临时file。公开SDK void及最终系统路径TOCTOU限制保持。
- 前端只从树真实selected得到目标，roving tabStop不是选择。目标包含opaque handle/generation，无path/kind权威字段；选择变化和卸载取消旧未提交请求。统一命令和按钮共用同入口与IME/frozen/save可用性，定位本身不额外激活文档、不触发保存。已有单击文件临时预览/激活与双击行为不改变；“未打开文件不产生标签”使用方向键真实选中后定位来验，不要求改变既有单击行为。请求严格独立schema与single-flight反馈，旧请求迟到不能污染新选项。

上述选择避免新proof缓存的多入口计费/原子发布复杂度，代价是每次目录定位可能进行按需搜索；该搜索必须分批、可取消、验证当前映射身份，并保留实际成本证据。

自建含中文/空格目录，加入窗口后选择根、子目录、未打开 Markdown 文件和独立文件，分别执行定位；实际 Finder 选中对应对象，原活动标签和正文保持，未打开文件不产生标签。对已有 dirty 文档重复定位，内容和未保存状态不变；只读项也可定位。键盘选择后 Tab 到按钮并执行，原 Space 不编辑正文；正常退出并核样本 SHA。

自动验证覆盖严格请求、raw path 注入、跨根/失效 handle、generation 更新、目录与祖先 symlink/替换、missing、隐藏规则与撤 scope；deferred 校验中取消/dispose/保存替换后不得调用 SDK。验证无新增长期证明映射、单链有界与分批取消、既有映射换代失效、文件 descriptor 关闭、SDK throw 局部错误和 void 不冒成功，以及目标切换不误发/误提示。固定探针只证明实际边界，不冒全部系统竞态已解决。

真实 WK/Finder 验证与独立最终复核通过后才能验收。代码重打包由主线递增 alpha；本方案不批准构建或 Git，后续按连续授权及实际验收执行。自然 IME、精准竞态和系统静默失败按实际证据记录；离线项 `F-060c-offline-final` 只登记，留最终人工，不断网。

## 实现后自动验证候选（2026-10-17）

- 后端共享 trusted `revealAuthorized` 单槽/取消/epoch/写屏障及 SDK；补独立 save-start generation，防止 authorizer 等待中一次保存已完整结束后旧请求恢复。资源由返回前 authorizer、返回后 broker finally 分别负责关闭。未新增 renderer path 或文档授权。
- workspace 从同代 byPath/files 与 witness 对象按需推导连续链；目录走既有 Node-API descriptor，文件沿原 authorizeEntry，检查回调贯穿路径授权内部等待。当前小批64让出；没有新增 proof map。真实包内 native 路径和有限搜索成本尚需主线复核，不称全局性能证明。
- 前端作者4定向文件19测试/143断言及type/lint通过；主线另复跑 reveal controller+tree-model 13/73。内部 selected 没有用户选择时不把 roving focus fallback当定位目标；原单击预览行为保持。
- 后端最新 `bun test apps/desktop/src/bun/documents/reveal.test.ts apps/desktop/src/bun/workspace/index.test.ts`：44通过、0失败、275断言，5.39秒；随后全项目 typecheck 和9后端/shared文件eslint exit0。覆盖根/目录/未打开文件无新增grant、替换symlink、失效generation、真实clear、在途hidden/rescan/clear/dispose、完整save跨越和关闭资源。
- 保留首红：新工作区测试误用不存在的 `remove` op，改实际 `clear` 并先断请求成功；cancel回执先于finally导致close计数首读0，作者42/1/263及独立Standards49/1/285均保留，窄修测试等待真实cleanup promise，不用sleep、不改生产取消语义，现close恰一次。开发中type/lint红（前端尚未接RPC/fixture props、空检查回调/无await async、可选链对空字符串联合）均经窄修；无关全文件格式已收敛。
- 精确64批取消、无witness成本、所有竞争时序和真实系统展示未由以上定向证明；仍须按独立复核判断必要缺口。当前用户非自建样本文档dirty窗口保持原状，等待用户正常保存退出；不记录正文或路径。桌面工具可连接不等于本片验收。未版本/build/GUI/Git；F-047e原失败、FINAL001/002与最终离线义务保持。

## 继承约束检查与义务

### 主线检查与独立代码复核（2026-10-17）

主线已读取共享broker、保存开始代数、授权内部检查、工作区证明来源及前端接线。独立Spec与Standards均0必要代码阻断，各自实际复跑3文件51测试/297断言、exit0，日志分别`/tmp/f060c-spec-targeted.log`及`/tmp/f060c-standards-focused.log`。原保存竞态发现与取消资源收尾测试首红保留，不以绿抹除历史。

主线全项目typecheck、full lint、feature-docs/obligations、lockfile及diff检查均通过；全量实际1533通过/1失败/36612断言/209文件，47.61秒、exit1（`/tmp/f060c-main-tests.log`）。唯一失败为既有callout-query长空白用例18.584秒触发原5秒时限，与已登记FINAL-ISSUE-002同用例；未改源码或时限，同源码该文件单独96/659、2.80秒、exit0（`/tmp/f060c-callout-query-isolated.log`）。不据单文件绿声称全量通过或既有问题修复，不抹除全量失败。

精确64批取消及无witness成本未实测，两轴接受为本有限片证据限制，不能声称已测大工作区性能或全竞态。当前用户旧实例含未保存内容，已请求用户自行保存并正常退出；未关闭、保存或丢弃用户内容，未覆盖运行包。代码仍未构建/实际验收/提交，alpha168保持。自建真实验收样本已准备于`/tmp/agentic-f060c-ui.XZ2S8z`，未用于实际验收；三份样本初始SHA为`af5ee8e8051d6e1d86104208b6857d37e587e58064f231e83bba3dc0418df95b`、`fd3c8df3922ee44922971896d6d54d52ca8e5149d12d764c6f2f265ce93dadbc`、`f4b15eab31bcb24b0d9e0eef4d583a35ea7ab9dfcb0447e4e1f2dde2847161e3`（依次未打开/只读/独立）。

- F-002：定位只调用本地 SDK，不加载网络资源；离线最终人工。
- 中文与外观：中文按钮/错误，沿现有浅深及系统主题；新按钮焦点可见，不挤破树布局。
- 命令与键盘：主承接 OBL-060 的文件树目录/文件选中上下文、统一命令和键盘等价入口；不引入拖放行为。仅本消费者范围，不预先关闭完整 F-060/OBL-060。
- 安全与日志：opaque handle、服务端证明链与撤销检查；不记录正文、真实路径或原始系统错误。仅匿名请求结果和必要测试证据。
- 协作 F-004/F-025/F-026 授权与树状态、F-015 写屏障；不改派既有义务。F-047e、FINAL-ISSUE-001/002、阅读子窗、冻结 F-041d、专项、F-028c 和最终离线仍开放。

## 调查验证记录

方案编写前 `bun run check:obligations` 通过；仅只读代码/官方本地 SDK 调查，不是运行验收或实现完成。后续必须补独立方案复核、实际代码检查、产品手册、真实验收和 Git 收据，不预写成功。

文档新增后首检查缺少固定状态头，已补；再次检查提示 OBL-060 尚缺 reciprocal register link（义务表反向链接）。本作者只获准写唯一方案，未改义务表；交主线登记时补本迭代链接后重跑，不将当前检查记绿。`git diff --check` 通过。
