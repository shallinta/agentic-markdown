# F-060b：用系统默认应用打开当前文档

## 非离线有限片正式通过（2026-10-15）

最终独立Spec/Standards各0必要阻断，主线批准alpha147受托Agent代验通过，非用户亲验。实际Xcode目标/磁盘版与dirty分离、撤销/三模式/只读/键盘/主题/missing/旧Finder及退出证据如下，两个fixture原样644，测试进程正常退出。下方作者待验/构建等为历史；完整F060/OBL060其余消费者、offline-final及已列未实操限制保留。Git待执行，先前两提交SSH待推送不冒称成功。

## 作者实现候选（待独立代码复核及真实验收）

已实现后端共享`dispatchDocumentPath(request, action)`，reveal/open-default动作复用同一任务、授权与清理路径；公开SDK同步注入，open只有`===true`才提交成功，reveal正常void语义不变。前端复用pending、目标/IME/只读/dirty/缺失状态守卫，统一命令及可见按钮，并常驻说明“打开磁盘上的版本，不会自动保存当前修改；默认应用也可能是本 App”。无新快捷键、桥、shell、自动保存或基线刷新。

实现后定向`bun test apps/desktop/src/bun/documents/reveal.test.ts apps/desktop/src/client/reveal-document.test.ts`共12项/84断言通过。原reveal矩阵与open同跑，包含路径/readonly/missing、cancel/release/dispose、scope失败、完整屏障与save身份换代、双动作并发BUSY及false后成功；save用实际service配write seam，不是原生落盘。controller验证dirty原EditorState/原文保持且0save/0read、readonly、IME取消迟到失败和missing禁用。本片不把SDK true当外部应用已显示，也未验证自然IME或默认关联实际目标。

原11项/76断言为添加dirty回归前的中间绿收据，无本片已知测试红例。作者未改版本/构建/UI/Git；仍待主线全量、两轴及真实WK，完整F060/OBL060与offline-final开放。

> 状态：alpha147非离线有限片受托Agent代验通过，Git待执行；完整父义务及最终离线仍开放。

## alpha147 实际验收候选（2026-10-15）

构建成功/hash `19vu56umf3o22`，直接解包 `/tmp/agentic-direct147.JzuDuX/Agentic Markdown-canary.app`，独立数据区`/tmp/agentic-f060b-ui.ipehb3/data`。包内Bun运行仓库1298项/32696断言/190文件（28.74s，`/tmp/f060b-bundled147-tests.log`）；源码断言差1保留不推因。Bun46336正常退出、launcher退出0；两样本SHA与下方基线相同、最终均644。未保存用户正文、未改网络/默认关联。

真实WK：空欢迎入口disabled。甲编辑模式点击后Xcode窗口URL明确`file:///tmp/agentic-f060b-ui.ipehb3/甲 disk.md`，正文DISK_ORIGINAL_ALPHA正确。App末尾粘贴UNSAVED_APP_ONLY变dirty后再次打开，App仍dirty含该串，Xcode仅磁盘正文无该串；回App一次撤销回clean。阅读与源码分别打开仍目标甲且模式不变。乙444打开后App只读、Xcode对应乙URL及DISK_READONLY_BETA，Xcode还显示无写权限锁定说明。切回甲通过⌘⇧P搜索中文命令、Return打开，Xcode目标甲而非乙，证明键盘等价入口。非声称实体键盘亲验。

暂移自建甲为`.test-held`，watch观察missing后两系统按钮disabled、内存保留，已移回；不冒称该试验覆盖replaced/竞态服务错误toast。浅深实际截图按钮/磁盘版说明可读，恢复深色；共用路径后旧Finder按钮真实选中乙（AX selected container153）。CmdQ因未接受的外部变化提示，放弃仅测试内存状态后正常退出；关闭两个Xcode测试文件窗口而不退出其他应用，未在Xcode编辑保存。

中途打开乙后CUA返回native pipe closed；重建工具会话即恢复，实际乙已打开，不重复点击。恢复时后台甲短暂“权限确认中”，切回甲后正常可编辑，磁盘SHA/权限原样；根因未定，不归因本片或声称修复。未实操外部编辑写回/默认回本App/系统无关联、OS静默失败、精准竞态、自然物理IME和极窄矩阵；相关自动测试仅其层级证据，父与offline-final保留。当前待独立最终复核及主线批准，不得提前Git。前两本地提交远端SSH最新仍timeout128。

## alpha147 构建中（2026-10-15）

作者冻结12/84；独立Spec复跑12/84、Standards含recent-selection16/109，均0必要代码阻断。主线源码全量1298项/32695断言/190文件（29.49s），type/full lint/文档检查通过，日志`/tmp/f060b-main-{tests,type,lint}.log`。初次文档检查缺状态及继承清单标识，已补正文并通过，无生产错误。已升alpha147构建，实际GUI尚未开始，不得Git。

自建样本`/tmp/agentic-f060b-ui.ipehb3/甲 disk.md` SHA256 `3b712b83e96b5794a8a7602196afabb1beffb37c102cfb634495a2b4e12c2b87`；乙readonly.markdown SHA `00bfbf9ba3b4df1b5e22de1b8b69de5a3dfe2009bce7830a74c3898f107a7e89`，乙暂444最终恢复644。Finder旧测试.markdown Get Info只读观察默认Xcode，未改关联，信息窗已关闭；该观察不是本功能打开验收。

## 有限生产方案批准（2026-10-15）

独立Spec/Standards均0路线阻断，主线全文阅读并批准最小生产适配。采用动作discriminant：reveal void正常返回视为提交；open仅`=== true`视为请求接受，false/throw固定失败，不把void误判false，不抹掉bool。共用单pending/任务/重复ID及所有取消生命周期，前端错误按发起动作且严格目标身份。增加跨动作BUSY、false后下一次成功及原reveal完整回归。当前批准实施非验收，无新版本/GUI/Git。

## 最小方案（2026-10-15）

前片F060a alpha146已有限代验并本地提交`e3af96a`，F029a提交`c62d123`；SSH连接超时，尚未推送。依连续授权补既定W14，不引入专项或F028c选择。主线已读总账W14、规格F060硬前置及实际2.0.1 SDK，当前待独立方案复核，不是实现或验收。

<!-- obligations: OBL-060 -->
<!-- deferred-obligations: none -->

## 功能

活动、已授权Markdown文档提供“用系统默认应用打开”，明确说明打开磁盘版本；dirty不自动保存、不清历史、不刷新读取基线。readonly可打开，missing/replaced、busy/frozen、保存中、IME及禁止离开编辑器状态禁用。新动作只由显式按钮或统一命令发起，不由正文触发，不新增快捷键。

仅使用操作系统默认关联，不选择程序/参数、不改系统关联。默认应用可能就是本App，不能称必定外部编辑器；不新增open-file接收或自动再次转交链路。外部实际修改沿已有watcher/revision提示，本片不接受冲突、不更改撤销历史策略。

## 最小技术方案

实际SDK `api/sdks/main/core/Utils.ts:54`公开`openPath(path): boolean`，`proc/native.ts:611,2294`为cstring→bool。直接注入已加载同步函数，不用旧detached openPath，不新增FFI/原生桥或shell。false/throw仅固定中文局部失败；true仅系统接受请求，无成功toast，不保证另一个App已展示。

RPC仍仅protocolVersion/requestId/handle；后端从grant取路径，复用F060a授权验证与生命周期，允许内部有限helper消除重复。两种系统文件动作共享单在途与重复ID保护，捕获不可变fingerprint/identityKey及scope、epoch、屏障代数；每次await后和同步native前核验，descriptor保持到dispatch并finally清理。cancel/release/dispose必须真正接入；已送OS请求不可撤回，TOCTOU不作原子保证。

前端动作按类型记录在途请求，切目标/冻结/busy/IME变化取消，迟到回执不污染新文档，pending开始结束都发布新snapshot；不改F060a原有语义。新增统一命令及中文可见按钮和“打开磁盘版本，不自动保存当前修改”说明，沿现主题，键盘可达。错误不输出原文/OS细节。

## 最小 happy path 与边界验证

实现后测试，不TDD：true/false/throw，伪路径/坏handle，readonly/dirty，跨动作BUSY和重复ID，cancel/release/dispose、保存完整换代/屏障跨越/scope拒绝；原reveal回归保持。controller验证pending身份、取消、迟到错误、dirty与历史不变。全量/type/lint/文档及独立两轴后构建alpha147。

真实WK仅自建样本：按钮打开默认应用，核其实际文件名/路径与磁盘正文；编辑未保存后仍打开磁盘版、原App保持dirty，可撤销；readonly与切标签目标正确；空文档及missing禁用，键盘入口、浅深与正常退出。若默认应用不是可观察外部编辑器，保留实际证据限制，不改系统关联绕过。外部写回若必要，仅自建测试文件、记录新hash及恢复，不触用户文件。实际验收不能被SDK true或自动测试代替。

继承：F-002本地不保存/不联网；中文与外观：中文文案、浅深主题；命令与键盘：统一注册及按钮键盘可达；安全与日志：受控授权、无shell、不泄漏正文或OS详细错误。最终离线`F-060b-offline-final`只登记不执行。自然物理IME、系统静默失败及精确OS竞态未实操不冒称。完整F060/OBL060其余消费者保持开放。实际代验及独立最终复核后才提交推送；用户无需再确认常规实施选择。
