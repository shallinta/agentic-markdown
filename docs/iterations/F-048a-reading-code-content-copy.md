# F-048a：阅读代码正文呈现与复制

> 状态：alpha.141 非离线有限片经两独立最终复核0必要阻断及主线正式批准受托Agent代验通过，非用户亲验；Git待实际执行。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## alpha141 非离线有限片正式通过（2026-10-15）

两独立最终复核均0必要阻断后，主线正式批准本片受托Agent代验通过，**非用户亲验**。源码与包内Bun运行仓库各1205项/31870断言通过；实际WK正文复制/正常粘贴核验、键盘Option+Tab及Return/Space、只读复制、主题与DOM复用、正常退出和样本原样收据见下文。没有将普通Tab未到按钮解释为产品修复，也不扩大完整系统导航设置证据。

真实WK未故障注入API缺失/拒绝/迟到冻结；完整EOL/容器矩阵仅自动测试，完整像素/自然IME/性能RSS仍未实测。父F-048/S15–18、编辑右键复制、高亮/折叠/行号、专项和完整协作义务保持开放，offline-final仍最终人工。**Git待主线实际执行**。下方待复核与待验是历史检查点，保留全量旧断言失败及修正记录。

## alpha.141 真实窗口验收候选（2026-10-15）

源码及包内 Bun 运行仓库测试均 **1205项/31870断言**，分别见 `/tmp/f048a-full-final.log`、`/tmp/f048a-bundled-tests.log`；不是包内测试文件。typecheck/full lint/docs/obligations/lock/diff检查通过。独立Spec初轮29/248，Standards含最终HTML断言34/290，均0必要代码阻断；全量曾有1204绿1旧围栏期待红，保留 `/tmp/f048a-full.log`，修订后HTML转义安全断言仍在。

构建命令 `AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary` 成功，日志 `/tmp/f048a-alpha141-build.log`，保留既有bundle大小warning，不把成功构建解释为性能达标。实际产物 version.json 核 `0.1.0-alpha.141` / hash `3l39a1csrvx84`。直接解包至 `/tmp/agentic-direct141.FbWlRm/Agentic Markdown-canary.app`，不运行安装完成窗口；隔离数据 `/tmp/agentic-f048a-ui.6m8Ru4/data`，launcher26832/Bun26844，exec20622。原包已退出才启动，不重叠启动或改变网络。

实际通过 CUA 精确路径连接 WK `views://mainview/index.html`，打开自建 `code.md`：阅读审计42元素通过，5个代码块显示正文和纯文本语言，无围栏/info/容器语法；复制本身保持clean。鼠标点击JS块显示“已复制”，切源码在末尾真实⌘V得到 `const message = "中文 <script> & test";\nconsole.log(message);`，无围栏/语言，撤销恢复clean。此处只用正常粘贴核本次自建payload，未调用剪贴板read API或shell，未保存正文。

键盘入口：本机普通Tab从阅读容器转到Web内容，没有落到按钮；使用WebKit的Option+Tab控件导航，AX确认按钮获得焦点，Return触发JS复制，随后Option+Tab至波浪线块、Space触发复制，实际⌘V得到“波浪线正文”，撤销clean。墨夜按钮键盘focus可见边框和文字有截图证明。工具驱动系统按键，不冒称实体键盘亲验或所有系统导航设置均已验证。

缩进代码鼠标复制→源码⌘V得到“缩进代码\n第二行”（不含四空格语法）；引用内代码得到“引用内部代码”（不含引用/围栏）；分别撤销clean。空代码块显示“已复制”，源码末尾⌘V无变化且clean，没有带入前次引用payload。

将自建 `readonly.md` 设444，App明确显示只读；阅读复制成功，切到可写code标签源码⌘V得到“readonly-copy-只读”，撤销clean；只读文档始终clean。纸页/墨夜主题可辨，App浅色与墨夜组合截图、纸页截图、墨夜焦点截图已观察；恢复App深色。主题切换复用60节点（主文）/14节点（只读）通过；同一只读实例复制反馈出现并消失后再切主题仍14节点通过、解析请求14未变。完整所有App/阅读主题/系统设置像素矩阵未逐项实测。

两标签clean后⌘Q正常退出，exec20622返回0，`ps -p 26832,26844`均无进程；只读样本恢复644。两文件前后SHA256相同：code `7ae1f6083d7c287fb458348181ef9fcce7ddcb1eaa20e1ed9ac2cc74ff66eaed`，readonly `5663cf107e9a1858e48f1a3f3c77a732584c7e2d967f665f7607c55bb2c2344c`。未保存用户正文，未断网，未强杀。

失败/API缺失与异步迟到/冻结并发仅受控测试，未在真实WK故障注入；CRLF/CR/BOM/列表/未闭合等语料为自动seam，非全部逐项窗口粘贴。无性能/RSS普遍结论，无自然IME新矩阵。当前仅真实操作完成候选，最终独立复核后才能批准及Git；完整F-048/S15–18、协作义务、F-028c/专项和 `F-048a-offline-final` 保持开放。

## 实现候选收据（2026-10-15，未验收）

主线首次全量1204通过/1失败（`/tmp/f048a-full.log`）：reading-html.test.tsx旧断言仍要求围栏` ```unknown `原文。依已批准正文语义改为精确语言标签与转义的代码正文断言，同时新增不存在真实em/script/iframe/事件属性断言；原inline HTML与多行引用保真断言保留。这是旧呈现期待迁移，不修改HTML安全实现；失败收据保留。

主线全文及Spec 0路线阻断后批准有限生产实施。现code使用原canonical `value`，固定纯文本语言、pre/code与自有复制控件；保留原文、无新parser或原生桥。按钮实时核controller活动文档/模式/冻结/busy、session/fault、revision及canonical结果身份，用户回调内同步发起writeText。晚到成功/失败不污染新owner；同owner暂时busy/frozen时settle仅清pending至idle，防解除保护后按钮永久disabled，不重提交旧payload。成功提示1500ms清理，仅体验参数非SLO，卸载/新owner清timer与票据。

固定按钮/属性/结构审计加React ref授予的WeakSet所属，未放宽raw HTML白名单；每代码块6个元素计入预算。阅读主题使用已有变量。主题DOM复用诊断仅额外排除自有代码反馈p的动态text子节点，保留代码正文、容器与按钮元素身份；正式非DOM seam验证伪造class不享排除，节点更换仍失败，真实WK待主线。

作者定向 **29项/248断言/5文件**、root typecheck及本片ESLint零警告通过，日志`/tmp/f048a-target-final.log`。首轮20绿2旧期待红记录在`/tmp/f048a-target-first.log`：旧断言要求围栏raw已按批准正文语义调整，未删除安全断言，控件改为精确计数/属性；后续两个新测试夹具缺真实UUID/DOM.closest的失败记录`/tmp/f048a-target.log`，修正夹具后通过。CR输入的`node.value`实测仍保CR，未擅自归一LF；末尾换行依官方解析结果，不自行添加。真实controller只读/冻结/模式/重读session、复制失败/重复/迟到和SSR/owned结构audit分别有针对验证，不等同真实剪贴板或DOM验收。

当前代码冻结供两独立lane复核，主线后续全量、alpha141构建和真实WK。作者未改版本/build/UI/Git/AGENTS；全部父/义务/offline-final保持开放。下方“仅方案”保留批准前时间状态。

## 当前状态（2026-10-15）

主线依连续授权选择本片；基线 HEAD `c8654a9`、alpha140，选择时工作树干净。本文件仅最小方案与公开接口只读调查，待主线全文读取及独立路线审核；未批准/执行实验、生产实现、依赖变更、版本、构建或 Git。较低编号的图片、缓存、完整 L2/L3 等余项继续保留，层级不是逐项阻塞门禁。

## 功能与边界

阅读模式将现有“代码块原文（完整代码呈现待后续接入）”替换为真正的纯文本代码正文展示。支持 canonical 已识别的 fenced/indented code，包括引用、列表内代码；空代码块保留容器。语言信息只作惰性文本，不执行、不拼接类名/URL。右上角复制按钮在 hover 或键盘 focus 时显示，具有中文可访问名称、可见焦点，Enter/Space 使用原生 button 激活；只复制正文并明确反馈成功或失败，只读文件同样可复制。源码普通复制不变，编辑右键当前块复制留后片。

复制内容与展示内容都来自同一个已接受 canonical 节点 `value`，不是 raw(node)、DOM innerText，也不是自行去掉首尾两行。`value` 表达 Markdown 语义代码正文：不含围栏/info string、容器标记或代码缩进语法；解析器对行尾/末尾换行的具体处理以公开实现和固定语料结果为准，不承诺原始字节等价、不额外 trim 或补换行。原文、BOM、原始 EOL、dirty/revision/history 不因展示或复制改变。若实际 parser 语义与上述正文目标不一致，先报告，不暗改 parser。

不做高亮 grammar、懒加载、折叠、代码行号、编辑语言控件或围栏内部 Enter 策略；不关闭 F-048/S-15～18。F-028c 与其他专项、最终离线人工保持不动。

## 硬前置与义务

继承检查：**F-002 原文与离线**不回写、不联网；**中文与外观**使用中文控件及阅读主题；**命令与键盘**原生按钮可达且无新全局键位；**安全与日志**受控纯文本、精确审计、无正文日志。F-005 生命周期与取消边界、F-008 安全存储约束沿用，不增加后台解析或持久化。

- F-019 已提供 canonical code；F-021 受控阅读、F-020 安全审计、F-007 阅读主题及 F-030 文档/模式身份已存在。本片无 grammar 模块，故不要求 F-024 重模块先交付；不提供折叠，故不要求 F-040 折叠先交付。这是本片所需前置，不免除完整父项依赖。
- 已查义务登记：没有以 **F-048 为主承接者**的 OBL。本片无新增/迁出主责，不关闭任何完整 OBL。
- OBL-029 阅读主题、OBL-030 安全、OBL-064 原文/history 为消费者协作；OBL-068/069 编辑/源码外观本片不新增接线，保持原主责。F-006 的键盘与中文入口约束沿用，复制不新增全局快捷键或进入编辑命令历史。
- 原 1 MiB 文档边界、渲染工作/节点预算、失败安全原文回退、无正文日志继续有效；新增控件/标签/状态 DOM 必须计入准确预算，不绕父级 audit。

## 最小技术候选与公开接口调查

1. `security/commonmark-content.tsx` 当前 code 分支显示 raw(node)，可改为小型受控代码组件；tree/value 保持原样，不复制 AST、不新建解析管线。固定 pre/code、语言标签、按钮及状态文本，无 HTML 注入、资源属性或任意 spread。代码块文字保持转义，语言也按普通文本呈现。主题只使用 `reading-background/foreground/muted/secondary/border` 等现有变量，纸页/墨夜独立于 App 外观；切主题不重解析。
2. 当前 `isControlledReadingElement` 不允许 button，原测试也整体拒 button。需仅为本 App 代码控件增加精确 namespace/tag/class/属性/属性值审计及所在受控结构验证；不能只允许通用 button，不能放宽 raw HTML 白名单。事件由受控组件绑定，用户 Markdown 永远不能生成按钮或事件；新增 DOM 工作量精确收费。安全 seam 和真实挂载 audit 必须分别验证。
3. 剪贴板首选用户激活回调中**同步发起** `navigator.clipboard.writeText(value)`，不先 await 解析/权限检查而丢失激活。仓库 performance-lab 已使用此公开 API，但不是正式 WK 成功证明。[MDN writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText) 明确安全上下文限制、Promise 完成语义与 NotAllowedError；实际打包 WK 是否允许仍需验证。不预读剪贴板、不轮询权限、不自动重试、不用 execCommand 或 shell 替代。
4. 仅当前已接受 document/session/revision、模式为阅读且内容尚有效时可启动复制；旧 snapshot/pending/安全回退或不可交互状态不启动。同控件 pending 防重复激活。发起时固定本次 payload 和 owner token；Promise 成功后才显示“已复制”，拒绝/API缺失给“复制失败，请选择代码正文后复制”等明确反馈。切文档/模式、重解析、卸载或新请求后，旧 Promise 不更新新控件/全局 toast。已经提交给系统的写入无法取消，不声称 token 能撤回副作用；身份检查发生在发起前，迟到结果只隔离 UI。无正文/路径日志。
5. 若实际 WK 不支持该 API，记录真实失败并暂停这条复制接线报告主线；**新原生桥未获批准**，不自行扩大 RPC/权限或用自动降级路径掩盖失败。后续路线批准与否不由测试绿替代。

## 最小验证与收尾

先方案审核，再按需要批准最小接口实验或生产；不默认 TDD，不建立通用剪贴板框架。实现后定向语料覆盖反引号/波浪线、空/未闭合、缩进代码、引用/列表容器、HTML样式正文、LF/CRLF/CR/BOM及正文尾空白。逐例对照实际 node.value，展示和复制 payload 相同，原文完全不变；错误/API缺失、pending重复、切文档/模式后迟到结果另用受控 seam。

最小真实 happy path：打开自建含语言围栏文件→阅读只展示正文→鼠标复制→在自建可写测试位置粘贴核正文（无围栏/语言），撤销回 clean；键盘聚焦按钮并激活一次，复核只读文件也可复制；纸页/墨夜与 App 浅深组合检查可辨、DOM audit 无违规，模式切换原文/history不变并正常退出。测试剪贴板只写用户本任务授权的自建语料，不读取原有剪贴板；实际成功失败与工具限制分列。真实故障注入若需额外实验入口须另获窄批准。

最终执行定向/全量测试、type/lint/docs/lock检查、两独立代码轴；主线负责 alpha141 构建及真实 WK，再最终独立复核与批准。通过前不 Git。每次代码重打包递增 alpha；维护产品手册、规格及义务消费者记录。`F-048a-offline-final` 留最终统一人工，不断网、不以本片关闭父功能/三模式或未测性能矩阵。
