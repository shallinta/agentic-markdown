# F-060d：用系统默认应用打开文件树选中文件

> 状态：alpha170 非离线有限片已通过受托代验和独立最终复核；已提交推送 `f81542ddb428d0a007ae04542241ca60e4899c4d`

## 状态（2026-10-17）

Git收据：提交钩子前后tree均`f4f0a87866e41e0dd0e87d2eaa30ae31905952ed`，命令级SSH443、既有github.com HostKeyAlias与严格校验推送exit0；HTTPS ls-remote远端main及origin/main均与上述完整SHA一致。未改持久配置，下方Git待执行为历史。

最终独立Spec与Standards均0必要有限验收阻断，另核三SHA/权限/进程与两份全量日志；主线批准本片受托Agent代验通过，非用户亲验。完整父和未测边界仍开放，源码既有失败不抹除，Git尚待执行。下方“待最终复核”为历史。

### alpha170 真实验收候选

unsigned构建exit0（`/tmp/f060d-alpha170-build.log`），hash`2jlf1dbdgs58m`，直接解包`/tmp/agentic-direct170.Lx2swI`；不运行安装器，独立测试数据`/tmp/agentic-f060d-ui.EbNwph/data`。包内Bun运行仓库1542/0/36665、209文件30.18秒exit0（`/tmp/f060d-alpha170-bundled-tests.log`），不覆盖源码先前1541/1失败，不称FINAL002已修。

实际WK：初始无选择两按钮禁用；根和子目录选择时Finder可用而默认打开禁用。Right展开、Down选中未打开.md、Option+Tab两次焦点到默认打开按钮，Return后Xcode窗口URL精确匹配且正文F060D_DISK_UNOPENED；App仍无标签。独立文件打开并键入UNSAVED_APP_ONLY后dirty，选择自身默认打开，Xcode精确URL和正文仅F060D_DISK_STANDALONE、不含未保存串；App仍唯一原标签、dirty/原文保持。另选择只读项，通过CmdShiftP的选中文件命令打开，Xcode精确只读URL及F060D_DISK_READONLY并提示无写权限锁定；App仍原独立dirty标签。返回正文CmdZ一次撤销到clean。浅色及深色实际截图新按钮/说明可读，当前尺寸无溢出；旧Finder入口重新定位只读文件，AX选中container162对应只读URL。

正常CmdQ：launcher session45502 exit0、Bun12723消失；退出stderr一条IMKCFRunLoopWakeUpReliable不推断根因。三份样本SHA与准备记录完全一致，readonly恢复644。Xcode三个自建测试窗口逐一核URL后CmdW关闭，末noWindowsAvailable；未保存外部正文、未退出其他应用或改默认关联。

工具失败保留：首次GoTo合并粘贴后仍旧F060c路径，未确认Open；再次paste未改AX，改公开setValue核F060d实际路径后才确认。首次独立默认打开的外部观察出现screen capture size invalid(0,0)，重新getApp核Xcode实际目标后继续，没有重复发送打开请求。首次截图任务标签写深色而实际为浅色，后续明确切深并实拍，两者按实际像素记。没有将这些工具动作失败推断为产品问题。

自然IME、所有系统竞态、默认关联回本App、外部写回、极窄尺寸与系统静默失败未实操，离线最终人工。当前等待独立最终复核，尚未批准验收/Git；下方构建前状态为历史。

主线源码全量1541通过/1失败/36665断言/209文件，48.33s exit1（`/tmp/f060d-main-tests.log`）：唯一既有long-whitespace 18.975s超过原5s，保持FINAL002，不称全量绿。type/full lint/docs/lock/diff均通过。独立两轴各59/350通过；Standards指出cross-action默认分支缺SDK计数桩已补，主线及Standards各14/81窄复跑通过，Spec核实际差异；最终两轴0必要构建阻断。主线已读核心和所有接线，批准递增alpha170与unsigned构建及真实验证，尚未构建成功或验收/Git。

主线已全文读取本方案及实际broker/controller/SDK公开接口，独立Spec与Standards均0必要实施阻断，批准按下述最小范围实施并补实现后测试。F060c已验已推85b3ba6/alpha169；本片不得沿用其验收结论，下一版本/构建/真实验证仍由主线后续管理。下方未授权为方案初稿历史。

仅最小方案，待主线全文读取与独立两轴路线复核；尚未授权本片实现、实验、构建或验收。依用户连续授权承接既定 W-14 / F-060，不增加任意程序或命令配置。F-060c 当前实际验收与 Git 收据由其唯一迭代记录负责，本片不预写其结果。

<!-- obligations: OBL-060 -->
<!-- deferred-obligations: none -->

## 功能说明

文件树真实选中的独立文件或目录内 Markdown 文件提供“用默认应用打开选中文件”按钮及统一命令，不新增默认快捷键。根目录、子目录、无选中项均不可用；后端同样拒绝根/目录目标，不能只依赖前端禁用。保持当前单击选择、双击或 Enter 打开的行为；本操作本身不在 App 中打开或激活文档，不创建标签、grant 或文档身份。

常驻说明“打开磁盘版本，不自动保存当前修改”。只读和 dirty 文件可交系统；不保存、不改正文/选区/历史，不确认外部冲突，不修改 F-028c。系统默认关联可能是本 App，不承诺必定外部编辑器；不改系统关联、不新增接收文件或再次转交链路。文件丢失、身份变更、失效授权和 busy/保存/组合输入/frozen 等不安全状态拒绝或禁用。

## 已读取的现有接点

以下源码路径均相对 `apps/desktop/`：

- `.hutch/devkit/api/sdks/main/core/Utils.ts:54` 的公开 `openPath(path): boolean`，通过既有平台实现；`src/bun/app/start-desktop-app.ts:42` 已注入 `Utils.openPath`，无需新原生桥、Bun FFI 或 shell。
- `src/bun/documents/index.ts` 的 `dispatchAuthorizedPath` 已支持 `reveal | open-default`，共用 `revealing` 单槽、重复 ID、epoch、selectBarrierGeneration、saveStartGeneration、saving/writeBarrier 与持资源 finally；open-default 仅 `=== true` 视作系统请求接受。
- `src/bun/workspace/index.ts` 的 `reveal` 已从 opaque root/entry/generation 或 document handle 取得可信目标，复核当前 byPath/files/witness，文件走 `authorizeEntry`，不依赖 renderer path。
- `src/client/workspace-reveal.ts` 已保存真实选中对象及单 pending，失效取消、迟到反馈隔离；`workspace-tree.tsx` 选中回调、`document-service-panel.tsx` 操作 owner 和统一命令可复用。本片不新增另一份彼此独立的 action pending。
- 产品总账第322条与 W-14 已确认默认应用打开；F-060b 仅交付当前文档入口。F-060c 的目录 Finder 定位不意味着默认打开目录已获本片授权。

## 最小技术方案

1. 后端只增加可信 Bun-only `openDefaultAuthorized(request, authorizer, current)`，转同一个 `dispatchAuthorizedPath(..., "open-default", ...)`。不暴露 authorizer 或路径到 renderer；两类工作区动作与原当前文档动作共用原任务/保存屏障槽。取消回执可先于收尾，但槽只能 finally 释放，不能为新的动作提前让位。
2. workspace 提取最小私有目标解析/授权调用以共用 Finder 与默认打开逻辑，保持现有 reveal RPC 和字段语义。新增 `openDefaultWorkspaceItem` 严格 RPC，请求只带 protocolVersion/requestId 与 opaque target；根/无entry目标在schema或后端拒绝，目录entry由服务端实际node.kind拒绝，不接受 renderer kind/path/fingerprint。独立文件转 `documents.openDefault`；目录内文件必须同代且当前node为file、ScanFile.path等于服务端node路径，才走可信broker。不能借用同路径新grant自动升级旧树授权。
3. 保留现有授权每次 await 后检查、files/byPath/witness对象与generation/可见规则检查、连续路径身份及最终同步SDK前检查。文件descriptor从授权成功一直持有到同步系统调用，再finally恰一次关闭；返回资源前失败由authorizer负责关闭。完整保存已结束也必须被 save-start generation 拒绝。无需目录proof新索引；默认打开根/目录不能走已有目录descriptor分支。
4. 前端将本轮两个树动作纳入同一个 controller/pending，记录动作和目标身份，动作各自中文失败；reveal可选目录、默认打开仅文件。UI持有实际选中item的kind资格，但它只是可用性提示，授权仍由后端判定。无选择时不把首个roving-focus项当用户选择。失效、卸载、busy/IME等取消并清除迟到反馈；旧Finder行为不变。
5. `openPath` false/throw返回固定局部失败，不泄漏系统详细错误；true仅表示请求接受，不显示“文件已打开”成功toast。最后路径校验与外部应用读路径之间仍有TOCTOU，不能保证原子读取或外部App展示。已经送达系统的请求不可撤回，不自动重试造成重复打开。外部实际修改继续走现有watcher/revision/冲突流程。

## 最小 happy path 与必要验证

实现后测试，不采用TDD：

- opaque协议白名单、坏handle/generation、伪路径、根与目录强制拒绝；独立与目录内文件成功，未打开文件不新增grant/标签。
- 默认打开true/false/throw及失败后下一次正常；与Finder和当前文档动作交叉BUSY/重复ID，保留旧Finder全部必要回归。
- 授权在途切目标/撤根/隐藏/重扫/dispose/取消、完整save跨越、只读/dirty；资源关闭用真实完成信号，不以取消响应或固定sleep代表finally结束。既有source authority语义保持，不扩大为同路径永久封禁。
- controller按钮和统一命令可用性、目录拒绝、单槽、迟到错误不污染新选择、动作正确反馈；原单击/双击不变。

主线串行全量、type/lint/docs及独立两轴后，再由主线决定递增alpha和构建。真实WK/默认应用仅使用自建样本：方向键选择未打开文件发起，外部目标路径与磁盘正文正确、App无新标签；dirty样本打开磁盘版且App仍dirty可撤销；只读与独立文件正确；根/目录不可用、键盘统一命令、浅深外观及正常退出。若系统默认关联不可观测，保留证据缺口，不改关联绕过。用户运行中的未保存窗口不自动关闭、保存或丢弃，切换构建先满足既定安全前置。

## 继承与限制

### 实现后候选（2026-10-17）

后端增加Bun-only可信默认打开入口和严格RPC，两个工作区动作共用同一私有授权helper及原broker槽；根与目录服务端拒绝，文件不创建文档grant。前端共用pending及动作区分反馈，opaque相同但file资格变化也取消；统一命令、按钮和磁盘版本提示已接入。作者后端2文件49/313、前端3文件19/114通过，type及定向lint通过。主线已读生产与测试差异，正在串行全量及两轴代码复核，未构建或实际验收。

首红保留：初次移动helper错误插入state内部造成TS6133/2304，已移至createWorkspaceService层；补丁anchor未匹配没有修改文件。未改语义oracle、测试时限或既有FINAL问题。前端作者首轮无红；定向通过不等于真实窗口已验。

真实验收准备独立自建目录`/tmp/agentic-f060d-ui.EbNwph`，尚未实操。未打开/只读/独立三样本原始SHA依次`1abfff015b67eaec9bde791457a3663d80dfe5da0a89ee13a4cbc7bfbbbf896d`、`82892e9ee68a9d872326885fc9ee2cebe444db0aca8c742eb37cc3704d459499`、`db2058f029e1d8844e6643701b21ec61270a5b96ad7ca36c946f1ebccd16512f`。只读暂444，结束后恢复644；测试不得修改用户正文或系统默认关联。

登记首检查因OBL-060缺反向链接exit1，主线补齐义务表链接后重跑；不改变功能/验收标准。

继承：F-002 本地不自动保存/联网；中文与外观：沿浅深主题及中文反馈；命令与键盘：统一注册与可达按钮；安全与日志：可信授权、无shell/自定义程序、不记录正文或系统原始路径错误。产品手册实现后标候选，真实验收及主线最终批准后才改为已验并依授权Git。

最终离线 `F-060d-offline-final` 仅登记不执行。自然物理IME、系统静默失败与精确OS竞态未实操不冒证明；不关闭完整F-060/OBL-060。F-047e确定性表格兼容红及完整需求、FINAL-ISSUE-001/002、阅读子窗、专项、F-028c与冻结stash均保持，不借本片宣称已解决。
