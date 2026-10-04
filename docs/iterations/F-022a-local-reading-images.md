# F-022a：阅读模式本地栅格图片

> 状态：已验收（2026-10-04，alpha.69 非离线本片受托 Agent 代验通过，非用户亲验）。独立 Spec / Standards 最终均 0 阻断；离线子项仍留最终人工，父功能/完整义务开放。Git 待主线实际执行核验。

<!-- obligations: OBL-010, OBL-031 -->
<!-- deferred-obligations: none -->

## 功能说明与范围

在已授权单独文档的主区阅读模式中，呈现文档父目录子树内的 PNG/JPEG 相对图片引用，包含 CommonMark 行内与引用式图片、中文及空格路径。使用当前内存正文的规范解析结果，不要求先保存，不修改正文、dirty、历史或文件树。授权范围内的符号链接可以解析；逃出范围的目标拒绝，不以字符串路径或链接入口代替权限。

本片局部承接 F-022 全部主承接 ID：OBL-010、OBL-031。无其他延期 ID 不代表义务完成；目录根消费者、编辑模式图片、远程显式加载、SVG/其他格式及完整缓存责任留 F-022 后续，完整父功能/义务保持开放。现有 F-004a 单文件授权、F-019b 规范解析、F-020b 受控节点、F-021a 阅读为硬前置；不要求这些父功能整项完成。当前图片资产读取服务尚需本片实现。

远程图片继续阻止并显示来源域名占位，不进行网络请求；不提供点击图片导航、下载、导入或写入。SVG、其他类型、缺失/越界/损坏/资源超限显示中文占位，不回退到 WebView 直接读取。编辑与源码保留原文，本片不开放 Raw HTML。

## 最小技术方案

1. Renderer 只提交文档 opaque handle 与受控相对引用，不提交可授予权限的绝对路径。Document Service 校验现有 grant 后建立以规范文档父目录子树为边界的非枚举只读 asset scope；不把父目录加入文件树，不授予文档写权限。相对引用单次 percent decode，兼容中文空格及引用式目标；拒绝 NUL、绝对路径、未知及 file/data/http 等协议，远程仅占位，不让 URL 绕过服务。
2. `realpath` 只用于发现目标相对 canonical 根的路径分量，使用路径分量/实际卷语义检查范围。从 `/` 逐段 nofollow 打开根 fd 并验证 grant 祖先身份，再从根 fd 逐段 `openat`：目录使用 `O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC`，叶子使用 `O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC` 并验证 regular file；最终只从 fd 读取。允许已解析到范围内的 symlink 目标，不跟随遍历时再次出现的链接。前后复核源路径、目录链、目标身份及 grant epoch，拒绝陈旧映射；这些检查不是唯一防越界措施，不宣称文件系统快照原子性。本片保守拒绝 `nlink > 1` 目标，明确硬链接限制；越界拒绝，后续显式资产 capability 消费者另行接入，不猜测其他授权。全部 fd 在 finally 关闭。
3. 复用现有 Node-API 模块新增两个只读 primitive（锚定目录打开、相对 fd 安全打开），不采用 Bun FFI、不引入新原生依赖。明确 fd 所有权与 finally 关闭，异常/撤销/销毁时释放；不影响已有保存 primitive。
4. 使用固定后台 Worker 执行 native 读取，配最小有界队列，避免慢文件系统同步阻塞主线程；既有 save worker 不变。限制读取量，核对 PNG/JPEG 签名、结构及尺寸，类型只由已验证字节确定；签名/尺寸不等于安全解码，浏览器实际 decode 失败降级占位。服务仅返回固定 `image/png` / `image/jpeg` MIME 的受控 data URL，不向正文暴露磁盘 URL、任意 MIME 或任意属性。呈现组件与 DOM 安全审计同步允许这一狭窄受控 img 路径，不放宽脚本、导航、SVG 或网络策略。
5. 图片接近视口后才请求与解码；同文档同规范相对引用合并在途读取并使用有界缓存，限制并发、字节及像素。缓存池绑定 handle、文档、保存基线与正文代际，池内以规范引用为键，成功回执保留目标 identity，但它不参与索引；这是当前阅读代际快照，不宣称实时检测磁盘资产变化或不同引用同目标去重。切主题复用、离开释放，save/regrant 失效，失败缓存也清理；目标变化刷新、跨引用去重与完整跨文档缓存留 F-022 后续及对应监听消费者。具体保护值在本轮实现/样本测量后记录，是可调整的安全资源值，不是预设性能门禁。主题切换不重取图片、不重解析正文；关闭、授权撤销与销毁丢弃晚回执并清理缓存和资源。不增加每键全文扫描。

## 最小 happy path 与异常验证

读取最多 `maxBytes + 1` 字节以识别超限，不无限读到 EOF；资源预算计入 base64 膨胀、在途并发及已缓存数据，具体数值随本轮实现实测记录。

- 临时文档引用 PNG/JPEG（含引用式、中文空格及授权内 symlink），阅读正确呈现/保留宽高比并受正文限宽；编辑/源码原文及 dirty 保持，磁盘字节不变。
- 两文档同名不同图隔离；同文档重复引用合并、视口外不提前读取；切主题不重取、切模式/标签及关闭后晚回执不污染下一文档，销毁后资源释放。
- 拒绝 `..` 越界、同名前缀欺骗、外部 symlink、目录/目标替换、已撤销 handle、伪扩展 HTML/SVG、损坏图片、过大字节/像素；FIFO/目录/硬链接不得挂住，成功失败及取消路径均核对 fd 清理。验证失败留中文占位、无用户路径日志。
- 远程/协议相对/file/data 等输入不触发网络 fetch 或 WebView 回退，受控 DOM 仅接收服务产生的固定 MIME 数据；无网络调用的测试与静态审查不冒充断网实测。
- 真实 WK 检查两个主题及 App 外观下图片/占位、视口懒加载、当前文档切换与正文状态；记录资源值、实际样本与结果，不预写收益。按 alpha 规则构建并核对产物，独立双轴复核后受托代验。

## 继承约束检查

- F-002：读取限定本地授权资产，不写用户文件，不改变 Markdown 1 MiB 边界；离线能力实测留最终人工，不断网、不执行网络隔离。
- 中文与外观：图片失败/阻止提示中文，替代文本保留；纸页/墨夜及 App 浅深/系统不造成溢出或不可辨，按本片真实验证记录。
- 命令与键盘：纯呈现无新增点击动作或命令，不制造只有鼠标可用的入口；复用既有打开/模式/主题命令与键盘路径，保持焦点及冻结/输入组合规则。
- 安全与日志：最小只读 handle/fd 授权、类型和资源限额、受控 DOM，无网络/脚本/进程触发；日志仅错误码与有限计数，不含路径、正文或资产字节。

## 最终人工待验：F-022a-offline-final

本子项同时挂在 OBL-010/031 的本片证据下：真实 WK 离线条件下读取授权本地图并切换主题，留最终统一人工确认，当前不执行、不标通过。遵从用户通用要求，不修改系统网络、不尝试进程网络隔离；不阻塞本片非离线范围验证通过后的交付及后续。完整义务不关闭。

## 实际改动与验证

当前以末节 alpha.69 非离线本片验收结论为准；离线专项及完整父功能/义务仍开放，Git 待实际核验。以下实施细化、中间待验及失败记录保留历史，不把中间构建或测试替代真实 UI 证据。

### 实施细化（2026-10-04，尚未验收）

- 本片先支持静态 PNG 与单帧 8-bit 常规 JPEG；拒绝重复尺寸头以及 APNG 的 acTL/fcTL/fdAT，避免用单幅尺寸限制冒充动画资源保护。动画及其他格式仍留后续，不取消完整产品责任。格式边界参考 [W3C PNG 第三版](https://www.w3.org/TR/png-3/)，fd 相对读取语义核对本机官方 `man 2 openat`。
- 固定 Worker 超时结算当前与排队请求失败，并暂停接收，直到旧任务在 finally 清理后的回执到达；不强行 terminate 忙 Worker，不宣称硬取消或阻塞文件系统的描述符已即时回收。

### alpha.67 中间验证（2026-10-04，未验收）

- `bun test` 最终本次结果 646 pass、0 fail、17470 断言、105 files、11.54s，记录 `/tmp/agentic-images-test67-final.log`；`bun run typecheck`、全仓 `bun run lint`、文档/义务、lockfile 及差异检查通过。
- `AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary` 成功，记录 `/tmp/agentic-images-build67.log`；源版本与产物 update metadata 均 `0.1.0-alpha.67`，hash `3npzqsi7yob6b`。保留已有大于 700 kB chunk 及 hdiutil deprecated 警告，不冒称性能问题消失。此包尚未进行真实 WK 代验。
- 独立 Standards/security 审查发现图片 Worker 入站仅 TypeScript 类型、缺运行时 schema 与双向版本/种类 envelope，违反 G-02。已安排修复与畸形消息测试；本片不验收、不提交，修复后按版本规则重新构建，不把中间成功构建当最终交付。

### alpha.68 自动验证及真实 WK 待验（2026-10-04）

- Worker 入站运行时校验修复后，又发现 invalid job 以 id 0 响应导致 stalled，已完成请求关联修复及测试闭环。独立 Spec 复跑 23 项 / 171 断言、Standards 最终复跑 10 项 / 91 断言，均无阻断；这些结论不代替实际窗口代验。
- `AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary` 成功（`/tmp/agentic-images-build68.log`）；实际包 `/tmp/agentic-markdown-alpha68.2cbFsP/Agentic Markdown-canary.app`，版本 `0.1.0-alpha.68`，hash `16tut5uxcyc4y`。
- 首次与构建并行的全量测试为 649 pass / 1 fail，失败为 reading-save-capability 的 unavailable，原因未确定。停止构建后定向 1 项 / 5 断言及全量 650 项 / 17524 断言、11.26s 通过（`/tmp/agentic-images-test68-repeat.log`）；包内 Bun 同为 650 项 / 17524 断言、11.26s（`/tmp/agentic-images-packaged68.log`）。typecheck、完整 lint、feature-docs、obligations、lockfile、diff 检查通过，保留首次失败而不归因或抹去。
- 本轮安全资源值：单图原始 8 MiB、16 Mpx；retained 24 MiB，包含 base64 UTF-16 与唯一/实例像素估算；另有单次传输 21.33 MiB。这些是可调保护值，不是 RSS、实测内存硬上限或性能门禁。服务全流程最多 9 个在途，Worker 1 个执行＋8 个等待，10 秒逻辑超时，不 terminate 忙 Worker；缓存代际 snapshot 边界按本文件方案记录。
- alpha.68 已启动，记录时 PID 95338；临时 UI 样本位于本轮 `pCmil2` 目录（实际完整路径由主线运行记录保留）。CUA 只取得欢迎页/选择器，首次操作多分钟后显示通信失败；重试选择样本后调用 120 秒超时，多次重连仍超时，尚未观察到读取成功、图片或主题切换。不将工具问题归因为应用缺陷，也不将自动测试充作真实呈现通过。
- 未修改用户文件，不断网；F-022a-offline-final 留最终人工。主线继续重试，连续授权不因连接超时结束；本片未验收、不提交，完整父 F-022/OBL-010/031 开放。

### alpha.68 真实进展与 alpha.69 待复验（2026-10-04）

- 实际读取临时 A 文档 2968 字节，阅读解析 61 块、8ms（仅 Worker 时段）；PNG、JPEG、引用式与内部 symlink 四图成功，越界、外部 symlink 及伪装 SVG 拒绝，远程显示域名占位。
- 初始末尾图片为待加载，滚动后实际加载成功；纸页截图首个 PNG/JPEG 正常。键盘 `⌘⇧P → Down → Return` 切墨夜，DOM 审计 138 元素通过，稳定正文 181 节点复用、revision 0 / request 1 保持；截图仍在末尾 45–49 及 JPEG 附近，正文显示已保存。
- `node scripts/check-reading-position.mjs` 通过 A/B/A、重复选择、新编辑 B 关闭（含主题）及取消/失败路径；这是 headless 回归，不是额外真实 WK 图片证据。
- 工具多次 70–120 秒超时后继续重试；早先仅欢迎/选择器及通信失败记录保留历史，不覆盖新增实证。旧副标题已修正，alpha.69 构建成功但尚待启动与其余验收；不把 alpha.68 局部证据写成 alpha.69 已复验，不预写本片通过或 Git。

- alpha.69 补证：构建成功（`/tmp/agentic-images-build69.log`），包 `/tmp/agentic-markdown-alpha69.gtvCCC/Agentic Markdown-canary.app`，metadata 版本 `0.1.0-alpha.69`、hash `2b2tfgwsxi97`。源码 650 项 / 17524 断言 / 106 files、12.11s（`/tmp/agentic-images-test69.log`）；包内同数、11.35s（`/tmp/agentic-images-packaged69.log`）。typecheck、lint、feature-docs/obligations、diff 通过，Standards 微改复核无阻断。
- alpha.68 经 `⌘Q` 返回 App quit；alpha.69 已启动欢迎页（launcher PID 97322），选择 A 后工具超时，读取结果尚待确认。新包启动不等于图片路径复验通过，继续真实代验、不记本片已验收。

- alpha.69 后续真实操作：A 头部粘贴临时文字成为 dirty，阅读显示新增文字、四张图片及拒绝占位，revision 1 / 62 块 / Worker 7ms，DOM 审计 140。返回编辑原文保留，再 `⌘⇧M` 到源码，原文与 dirty 仍在；`⌘Z` 撤销后切编辑恢复已保存，未执行磁盘保存。随后经命令面板回阅读，revision 2 / 61 块 / Worker 7ms、DOM 138，图片正常。
- 打开另一目录同名 B（47 字节），阅读 2 块 / Worker 3ms、DOM 6；截图为 256px 图片，比 A 的 128px 图片大，路径正确、未出现串图。`⌘W` 关闭 B 的工具回执超时，最终返回结果尚待确认，不预写成功。以上毫秒数仅 Worker 解析时段，工具耗时不作为产品性能测量；本片仍未验收、不 Git。

### alpha.69 代验完成候选（2026-10-04，待独立复核）

- 后续确认 `⌘W` 已关闭 B，恢复 A 阅读、四张图片及 clean 状态；DOM 138、revision 2、request 10。此为跨文档重新解析路径，不宣称跨文档切换不重解析。
- App 原深色切浅色已由设置和截图确认，纸页占位清晰；纸页切墨夜后截图仍在同一占位区域，DOM 138、稳定正文 181 节点复用、request 10 不变。跟随系统选项已回读并截图当前浅色系统效果，未切换 OS 外观，不扩称动态系统变化；最终恢复 App 深色，设置值及墨夜占位截图正常。
- alpha.69 `⌘Q` 返回 App quit，`ps` 确认 PID 97322 不存在，launcher session 39169 返回 exit 0。日志有 `IMKCFRunLoopWakeUpReliable` warning，未归因。A/B Markdown 与 PNG 共四项 SHA 校验均与基线相同，本轮未保存文件。
- 晚回执隔离及资源释放由单元测试覆盖，不冒称 UI 捕获 race 或测得 RSS。离线子项 F-022a-offline-final 按用户要求仍留最终人工，不断网；工具超时和首次全量测试失败历史保留。
- 当前只记录非离线本片代验完成候选，待独立验收复核后由主线确认，不自批准、不预写 Git；完整 F-022/OBL-010/031 及后续资源消费者开放。

### 非离线本片验收结论（2026-10-04）

独立 Spec 与 Standards 最终复核均为 0 阻断，主线确认 alpha.69 非离线本片受托 Agent 代验通过，非用户亲验。上述候选、首次测试失败及工具超时记录保留历史，不覆盖当前结论；证据边界不扩张。F-022a-offline-final 仍未验收、留最终人工，不断网；完整父 F-022/OBL-010/031、远程/SVG/其他格式/编辑消费者/目录根及完整缓存余项保持开放。Git 尚待主线实际执行及远端核验，不预写成功。
