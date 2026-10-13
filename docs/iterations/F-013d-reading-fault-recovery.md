# F-013d：阅读无EditorView时的文档故障恢复

> 状态：alpha134经最终独立Spec/Standards均0必要阻断及主线正式批准，非离线有限片受托Agent代验通过，非用户亲验；Git待实际执行。2026-10-14。下方方案、冻结、构建及待验检查点保留历史。

## 主线正式批准与正常启动补证

主线在最终独立两轴0必要阻断后正式批准本片有限范围。源码及包内Bun运行仓库均1042pass/29801断言/164文件；详细实际故障注入、dirty/history/只读与退出证据见末节，不扩为自然故障或用户亲验。

同alpha134包另以无实验flag正常启动exec35108，主线CUA AX及截图确认欢迎页无实验入口，CmdQ正常退出、exit0。本次正常启动不替代故障链或任意页面的全覆盖。完整父F-013、OBL-070及offline-final仍开放，历史失败与未实操限制不删除；Git尚待主线实际执行。

<!-- obligations: OBL-070 -->
<!-- deferred-obligations: none -->

## 功能说明与既定边界

承接G-22/F-013与OBL-070的后续消费者责任：同一打开文档的自有编辑解析会话发生故障，即使当前阅读模式没有EditorView，也应在允许恢复时进入安全源码并发布明确状态，不永久停在“等待当前输入或操作结束”。保留最后接受的raw、dirty、revision、磁盘基线、保存快照与撤销历史，不通过关闭、重读或重新创建正文state来消除故障。不是修复canonical Worker失败，也不覆盖进程崩溃/OOM/死循环、CM核心损坏或任意未来阅读模块异常。

F-013b现有隔离边界继续有效：一次故障后不自动重启解析/排版，本次打开期间模式命令不能绕过隔离；只读仍只读，恢复失败保留原文并固定报错、不循环。完整F-013、OBL-070及其它未来消费者开放。本片只局部承接OBL-070；OBL-069外观、OBL-064原文/history为回归协作，不关闭它们。F-045g已提交推送`3a4d0bbfdc86478a3c5d71ea8e811f3860fce5ef`，主线远端同SHA且核验时clean；其表格能力不与本修复混作同一交付。

## 已有红证据（历史诊断，不是新实验）

F-045g alpha132真实WK：reading clean文档点击“实验：解析故障”无即时AX变化，再切编辑出现pending提示、仍reading且模式出口禁用；跨B再A不恢复。阅读表格审计仍通过。clean关闭重开恢复编辑，编辑模式注入可进入安全源码；这不是允许丢弃dirty内容的策略。

已证触发来自opt-in实验注入，不是观察到自然阅读内容触发编辑parser异常；本片拟修的是故障已进入自有编辑session后、无EditorView时的通知与恢复责任。尚未证明自然故障在所有阅读生命周期的发生条件，不能把限制实验按钮当作普遍恢复修复，也不把canonical阅读解析失败混为同一故障链。

临时真实controller链：`bun /tmp/agentic-reading-fault.P5pE6n/repro.ts`，`red.log` exit1。普通段落与table都得到inject=true、fault=parser、notify=false、published=0、toggle=false、reading pending；raw未变、clean。同脚本`reopen`参数exit0只证明clean关闭重开回到editing，无自然IME/DOM证明。未对所有历史版本bisect。

源码因果边界：`document-service-panel.tsx`阅读只挂ReadingView；`memory-editor.tsx`持有唯一session.notify恢复回调并在卸载清除；`editor-fault.ts`只异步通知该回调。`documents.ts`阅读允许注入编辑parser fault，故障不改变raw/mode时updateEditor不发布，随后canToggleSourceMode的fault守卫拒绝切换。故障相关文件在F045g发现时相对HEAD零diff；普通文本同红，不需要表格作为前提。

## 最小技术方案（批准后实施）

1. **通知归文档会话**：在`editor-fault.ts`/`documents.ts`与必要的`memory-editor.tsx`接线中，让controller对其持有的每个editor fault session拥有稳定通知生命周期，不依赖view挂载。最小内部订阅应区分owner与view职责，不能让后挂载/旧view cleanup覆盖或删除owner通知；不创建全局会话缓存、第二正文或通用事件平台。创建/替换editor时绑定精确documentId+session身份，关闭/clear/dispose与旧session替换时解除。故障通知异步合并，不在CM state.update或publish中同步重入恢复。
2. **读取当前真源与守卫**：恢复始终重新取controller当前editor并核session同一、fault存在、未disposed、未safe、未recoveryFailed；遵守busy/frozen与当前交互/IME门控。已有EditorView时不能用owner回调绕过compositionStarted；沿现有setInteractionCheck与视图通知协作。无view的reading也复用原`enterSafeSource`事务，不重建raw/history或自动保存。若文档不再存在/会话更换，旧排队回调无操作；非活动文档只隔离自己的state，不能切换当前标签或写其它文档。
3. **有限重试与发布**：fault到达后及时发布pending说明；busy/frozen或IME阻挡时保留待恢复身份，不忙轮询。仅在既有状态解除点（busy结束、endDiscard、notifyInteraction/视图组合结束及交互检查切换）重新调度一次，进入safe后停止；publication/recovery互调须合并并防重复事务。失败仍沿原固定recoveryFailed结果，不自动无限重试。模式仍由实际safe state决定，不能只改reading集合或按钮enabled伪装恢复。
4. **范围保持**：`safeSourceEffects`、raw映射/history插件、保存协议、canonical renderer/Worker、HTML安全与模式产品规则不改。可窄增controller通知接线和正式tests，故障实验入口继续opt-in；不以仅禁用reading实验按钮掩盖真实无view会话责任。原恢复选区策略沿F-013b（安全源码单范围），不扩新增多选区恢复语义；原文、history与dirty严格不变。

实施前先以现临时loop固化正确调用链回归，再做有限实现；项目不默认TDD，本片诊断红已经存在。若现单notify接口无法可靠分离owner/view清理，先报告所需窄接口，不以双重盲写回调凑通过。

## 最小自动验证与happy path

- 真实controller普通段落和表格：reading注入→微任务后safe source，不需要先点模式按钮；pending/恢复发布可观测，raw、revision、dirty、baseline、save transfer、undo/redo保持。已有未保存输入→降级→一次undo撤原输入、redo恢复；不产生空history。只读同样可恢复但拒绝正文写入。
- busy/frozen/交互false分别阻挡，解除后无需新故障自动重试；反复notify不重复恢复。view组合期不重配置，结束后恢复；seam不冒称系统真实候选。
- 跨标签、相同documentId重建session、关闭/clear/dispose后的旧微任务、旧view cleanup不得复活或影响新会话；无关B正文/模式不变；恢复失败只固定报错且不循环。
- 原编辑/源码故障恢复、canonical失败处理与既有模式命令/权限回归，定向/type/lint后独立双轴。所有正式断言基于生产owner/controller链，不只直接调用enterSafeSource掩盖缺失通知。
- 主线新包实际WK：自建A有未保存修改和历史，在reading注入→安全源码可见且raw/dirty保留、undo/redo准确；B不受影响，只读恢复不变可写。编辑模式故障旧路径回归，组合输入/冻结等待能真实实施的范围分别记证据，无法实操的保持seam边界。不关闭dirty内容以恢复；验后撤销自造内容或显式按既有确认处理，样本hash/退出核验。正常启动无实验入口。

## 继承约束

- F-002：本地恢复、不重读磁盘、不自动保存，不变raw真源；`F-013d-offline-final`最终人工，不改网络。
- 中文与外观：沿既有pending/safe/recoveryFailed中文提示与安全源码主题；不新增可见产品配置，不把测试代替真实外观。
- 命令与键盘：复用模式/历史/权限guard；safe隔离后不允许模式快捷键重启故障模块，IME候选不被恢复事务打断。
- 安全与日志：固定故障分类，不记录用户正文/路径/message/stack，不开放HTML、资源或系统权限。

当前仅此文档方案，主线全文与独立路线批准后才实施。父F-013、完整OBL-070、未来阅读模块及offline-final保持开放；不涉及F-028c或其他专项决定。

## 有限实现与定向证据（2026-10-14，待独立复核）

生产仅修改`client/documents.ts`与`components/memory-editor.tsx`。controller在创建/替换editor后绑定自身持有session的notify，close/clear/dispose同步解绑；原报告边界与microtask不改，view不再写session.notify。恢复队列只保存已故障文档ID并重核owner/session，首次通知发布pending；仅busy/frozen解除、交互通知/检查或dispatcher装卸触发合并重试，不从失败尝试自行循环。dispose即使等待保存而暂保留editor，也拒绝直接恢复。交互check和history dispatcher安装返回身份检查cleanup，旧view清理不覆盖新注册。view组合结束沿现有通知恢复，不新增计时判定IME。

仅接受safe转换后移除该文档reading标志，保证安全源码实际可按原权限编辑/撤销；拒绝或抛错事务不提前改模式。raw/history算法、保存基线、canonical解析及故障实验按钮不改。视图初次构造前controller已拥有session通知，这是源码生命周期结论；新测试不是实际DOM构造/自然IME证明。

- 先原样执行`bun /tmp/agentic-reading-fault.P5pE6n/repro.ts`，exit1：普通/table两例仍pending，notify=false、publish0。实现后相同命令exit0：首微任务pending发布1，随后恢复，raw原样、dirty=false；不修改原诊断脚本/原红日志。
- 新增`apps/desktop/src/client/reading-fault-recovery.test.ts`九项，真实controller注入/报告链覆盖阅读dirty历史、BOM与混合EOL、只读、busy/frozen/交互等待及解除、B隔离、重复通知不重复事务、旧view cleanup、旧session/close/clear/reload/dispose和失败停止。降级后undo/redo、baseline/save transfer与revision有精确断言，无关闭dirty恢复。
- 补dispose等待保存回归时，初版只等待微任务，保存hash异步准备尚未捕获transport，出现61pass/1fail（finish undefined）；改用项目已有`waitCaptured`真实等待捕获，不改生产或超时阈值。最终组合62pass/0fail/612断言/5文件/223ms。
- 组合命令：`bun test apps/desktop/src/client/reading-fault-recovery.test.ts apps/desktop/src/client/documents.test.ts apps/desktop/src/client/editor-fault.test.ts apps/desktop/src/client/history-documents.test.ts apps/desktop/src/client/inactive-parser-cache.test.ts`。
- `bun run typecheck`及针对上述两生产文件与新测试的`bunx --no-install eslint --max-warnings 0`通过。未自行运行全量、改版本、构建、UI或Git。

代码检查期间发现disposed守卫首次误插到search释放方法，已在冻结前恢复该无关方法、将守卫放入enterSafeSource；最终dispose保留state测试覆盖此直接API拒绝。以上均为源码/受控链证据，真实WK、构建及独立最终结论仍待主线；父及完整OBL-070/offline-final不关闭。

### 主线源码与独立代码复核收据

主线报告源码全量1042pass/29801断言/164文件，typecheck/full lint/docs通过。独立Standards定向23pass/291断言/3文件，独立Spec定向50pass/573断言/4文件，均0必要代码阻断。alpha134构建进行中；这些不是包内测试或真实WK验收，不代表本片正式通过，Git尚未执行。

## alpha134真实WK收尾候选（待最终独立复核）

主线报告构建成功，hash `t5u84acqv5nv`，实际运行包`/tmp/agentic-direct134.Ub4VYu/Agentic Markdown-canary.app`。包内Bun运行仓库测试1042pass/29801断言/164文件/22.15s，日志`/tmp/agentic-f013d-packaged-tests.log`；不是包内嵌测试或实际窗口验证的替代。

自建样本目录`/tmp/agentic-f013d-ui.3POZt7`。首次批量CmdO/GoTo步骤未打开文件，返回请选择普通md错误；不推断根因，重新逐步选择后成功。以下为主线CUA实际操作证据，非用户自然键盘亲验：

- A：`a.md`编辑12→34产生dirty，切阅读表格显示34；点击实验解析故障后立即安全源码，raw含34且dirty保留，不需要再切模式。CmdZ回12 clean，redo34 dirty，再undo12 clean；CmdShiftM不重启故障解析。未通过关闭dirty文档恢复。
- B：正常编辑→正常阅读2块/4受控元素→编辑；呈现故障注入自动safe、clean。A故障未使B直接降级。
- 只读：`readonly.md`权限444打开显示只读，阅读→解析故障后safe仍只读；点击正文typeX及CmdS，AX无正文变化且save禁用。
- 深色实际截图文本清晰。回A仍safe、12、clean；随后CmdQ正常退出，exec63957 exit0，精确134路径pgrep无进程。

三个样本SHA与原样一致：a=`3bfb153ddc08361470884de26943da8a575f3922bd5da0be7d0b2a1487375ec5`，b=`f3600e150a7c8a478891d6d9d4322f8e7fd9e57aa427185f2e417df304574ab5`，readonly=`4555dc65d5f3b217f8ea9eb4a592b0f1ba90e31601103c0a8cd232096e4eeebf`。readonly已恢复644，全部样本644。无用户正文保存、无断网、无当前运行现场。

限制：本轮两个实际故障路径均为受控注入，不是Worker天然故障；自然故障、自然IME、浅色完整矩阵和实际busy并发未做WK覆盖，自动守卫仅有受控seam证据。父F-013、完整OBL-070及offline-final保持开放。本节仅验收完成候选，最终独立结论、主线批准及Git仍待实际发生。
