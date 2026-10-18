# F-058b：普通 dirty 文档的显式版本复制

## alpha180 有限非离线代验通过（2026-10-18）

> 状态：有限非离线受托代验通过，Git 待执行；完整父与未测边界保持开放。

最终独立 Spec/Standards 复核均无必要有限验收阻断，分别回核版本、日志、原文件 SHA、副本字节与退出进程；真实 WK 操作为主线受托代验，非用户亲验。主线批准本片有限通过，Git 待执行。只读源与普通 dirty 分别有正式测试，只读且已有 dirty 的组合未直接验证；不扩张为完整父项通过。

主线完成下列实际 WK 操作，不是用户亲验；本节记录先于最终批准，现批准状态见顶部。alpha180同源码重试构建session21395 exit0，hash `2rf0tzashp6xm`，直接解包`/tmp/agentic-direct180.p41eI1`并核version.json为0.1.0-alpha.180，不经安装完成窗口。首轮hdiutil资源忙仍保留，重试成功不证明根因或修复。包内Bun运行仓库测试1689/0/37738、226文件34.14秒（`/tmp/f058b-alpha180-bundled-tests.log`，session58994 exit0），不是包内嵌测试，不关闭源码FINAL002。

实际fixture见末节：仅授权root-a，打开68bytes原文，选择“最后一行”并粘贴“未保存内容一”。dirty复制对话初始“请选择复制版本”、提交禁用；鼠标选择当前未保存内容后创建`原文 copy.markdown`，74bytes与原raw替换该文字后的UTF8逐字节相等，BOM/两个CRLF/无末尾换行保留。源标签仍dirty；返回后CmdZ恢复clean，CmdShiftZ恢复dirty并选中“未保存内容一”。

再从dirty源打开复制，通过菜单End+Return确认“磁盘版本”，创建`原文 copy 2.markdown`，68bytes与原盘cmp全等。返回源仍dirty且精确选中文字保留。原documentId `d1c51535-14bc-4b78-8b32-47d55475a929`、内存副本`1a87fbe5-677a-4180-adcf-e60985f7d515`不同；源磁盘revision1、bufferRevision3且尚未保存。首次ID读取在复制之后，不冒操作前GUI ID已采集；身份不变另有正式测试。副本短暂显示权限确认中，切回源时该提示消失，不归因或宣称故障。

clean副本再次打开对话默认disk；取消不产生`原文 copy copy.markdown`。深色截图及切换浅色后的命令面板“复制当前文档”对话截图均可读，中文选择项与说明完整。CmdQ仍因原dirty弹汇总保护，继续编辑保留三标签；再返回源CmdZ恢复clean，正常CmdQ结束session36295 exit0，PID68014消失。退出stderr有IMKCFRunLoopWakeUpReliable文本，保留不归因。三原SHA与准备值全部相同，目录仅两份预期副本，无取消目标。

工具细节：首次加入文件夹后连按GoTo尚未出现sheet，再按后进入；确认root-a真实路径才Open，没有误授权旧目录。版本菜单第一次End+Return后仍展开但磁盘项已选，再Return后确认collapsed value才提交，不把中间态当已选择。

有限边界：clean对话期间变dirty、hash取消、已知外部风险、unknown/重放/迟到接纳、最大1MiB由正式自动测试覆盖，不冒本次GUI。只读源与普通dirty分别测试，二者组合未直接验证。1MiB真实WK桥接、自然IME、跨卷、完整真实OS故障和新空目录目标组合未实际验；其他原文件只核磁盘不变，不冒其他dirty标签GUI。离线留最终人工；异常状态复制消费者/完整父/FINAL001002003/阅读子窗/冻结/专项保持开放。

> 历史实施批准状态：2026-10-18 主线全文读取最终合同和实际接点，独立 Spec/Standards 均 0 必要实施路线阻断，批准普通 dirty 两版本有限正式实现及实现后测试。不新增原生探针或依赖；当时尚未批准新版本、构建、验收或 Git。最新状态见本页顶部。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## 功能与范围

依据[总账第 319、347 条及 W-11](../product-capability-register.md)、[MVP F-058](../mvp-product-spec.md)及[义务登记](../deferred-obligations.md)。本片没有既有 OBL 主承接项，不关闭其他 ID。

将 F-058a 的“复制文档”扩展至已打开的普通 dirty 文档。对话框明确提供“当前未保存内容”与“磁盘版本”两个选择；dirty 情况要求用户作出显式选择，未选不能提交，不默认替用户保存。clean 继续默认原磁盘版。磁盘版本仍指可靠读取且与当前已确认基线一致的版本；若外部磁盘发生变化，本片拒绝该磁盘分支而不接受新的基线。

仅普通可用编辑状态：clean 为 saved，普通 dirty 须 `getSaveStatus() === "dirty"`；非 saving/failed/uncertain、非外部风险或 stale、非 missing/conflicted/恢复、非 IME 或编辑故障。对话输入期不冻结正文，确认提交时才固定版本。本片不实现上述异常状态的版本选择或 F-028/F-066 消费者，明确继续开放；不能通过仅清空历史等方式绕过 F-028c 待决项。可读只读源不因不可写而被一概排除；权限变化后若仍满足上述普通 dirty 与可信 grant/基线条件，可以复制，不以 canWrite 为前置，也不改变其只读状态。

继承 F-058a：当前目录只有已获目录授权才可默认；否则用户明确选择授权目标。目标可包含 F-057b 本会话新建目录。名称按可修改的 `copy` 递增规则，排他发布不覆盖；不复制附件、恢复记录或私有元数据。副本获得新文件和独立 documentId，可按既定常驻打开路径打开，原标签身份/路径、dirty、选区、撤销重做历史、保存结果及其他标签均不改，不是 Save As。

## 继承约束

| 约束 | 本片要求 |
| --- | --- |
| F-002 本地/离线 | 仅本地授权复制，无网络；实施后登记 `F-058b-offline-final`，最终人工不断网之外另验，不在本轮断网。 |
| 中文与外观 | 版本选择、无法确认、已发布未打开与残留提示使用中文；浅深主题真实验收。 |
| 命令与键盘 | 复用复制命令与对话框；版本选择可键盘操作，不新增抢占快捷键。 |
| 安全与日志 | 原文档和保存链路不提交、不清 dirty；有界原文快照、操作绑定、unknown 查询而非重发，目标沿原排他发布与身份核验。日志仅匿名阶段与错误类别，不记录正文或用户路径。 |

## 实际接点与候选路线

已只读核实际代码：`client/raw-buffer.ts` 的 `rawText` StateField 保留 BOM、CRLF、孤立 CR、末行；CM `state.doc` 是规范化坐标文本，不能作为复制原文。`shared/documents.ts` 现有 `MAX_DOCUMENT_BYTES=1024*1024`；`shared/save-content.ts` 的 `rawHash(text)` 用 TextEncoder、UTF-8 往返校验和 SHA-256，并检查同一字节上限。现 `incrementalSave` 会进入保存/镜像协议，不应为复制调用它或改动原镜像。

现 `DuplicateSource` 六字段为 handle/documentId、expectedRevision/expectedHash、bufferRevision/gateToken。前端 `canDuplicate` 与 `matchesDuplicateSource` 目前要求 saved/非 dirty；后端 `withDuplicateSource` 在 `withCreateBarrier` 下核 grant/基线并稳定读取磁盘原 bytes。`publishDuplicate` 已接受 `{bytes, hash, check, revalidate}` 并执行临时文件写入/fsync、排他发布与后验。正式实现复用这些实际接点，不增加第二个原生发布实现。

候选一：复用保存 mirror/patch 通道传当前内容，再导出副本。它会耦合原镜像与保存状态，不选为本片最小路线。候选二（建议）：确认时取一次受现有 1 MiB 限制的 `rawText` 快照，单次 RPC 传输，后端只为副本验证/编码；不更新原 mirror/identity。单槽、单个小文档上限已有，不为本片增加流式传输框架；真实验证仍须观察最大合法内容的序列化/主线程成本，若现通道拒绝则先报告真实接点，不预写已可行。

## 最小 typed 接入合同

### T1：版本载荷与有界生命周期

在 duplicate create 分支新增严格版本选择：`version: {kind:"disk"} | {kind:"buffer"; text:string; hash:string}`；普通空白 create endpoint 拒绝该字段。`source` 继续携带上述六字段，不把 rawText 塞进 source。既有 clean 调用迁移为显式 disk，消除隐含分支；preview/suggest 不传正文。

先核严格字段和 text UTF-16 长度不超过 MAX_DOCUMENT_BYTES，再 UTF-8 编码、往返与字节上限、64 个十六进制字符的 SHA-256（256 bit）格式及实际 digest 一致；拒绝孤立 surrogate、超限和混入字段，不静默替换字符。前端复用 `rawHash`，后端用现有 Node crypto 独立重算，不信 renderer 的 hash。BOM/EOL 原样进 bytes，不提供新 format 参数，也不从 CM doc 重建。新增 version 时同步更新严格键集合/字段数量、RPC endpoint 分流和原 blank create 拒绝版本载荷的回归。

完整正文只在执行期局部变量保留；slot 长期只绑定 source 六字段、版本 kind、服务端验证后的 digest/byteLength、目标与原始名称，不保存正文、不对包含正文的 source 反复 JSON.stringify。终态无论成功/失败/unknown 都释放临时 text/bytes 引用，包括前端 gate、adoptionSource 与 params 闭包中的载荷引用；迟到资格仅保留无正文 source token。query/ack/retry-open 无正文。重复 create 必须重新验证实际 payload digest/长度与原 operation 绑定，异版本/异内容拒绝且不重写磁盘；不把“客户端自称同 hash”视为精确重放证明。

### T2：前端 owner、固定版本与迟到接纳

版本选择与目标/名称输入不锁文档。保留选择是否由用户显式确认的标记；clean 的隐式 disk 默认在源变 dirty 时失效，提交重新检查并要求明确选择，不能仅凭 kind=disk 绕过。dirty 变 clean 可以保留已显式选择，不暗换版本。确认时同步核当前 handle/documentId、基线 revision/hash、bufferRevision、普通状态和 IME，建立现有 duplicate owner，再读取固定 rawText；异步 hash 完成后重新核同 owner/版本/状态，失效则在发 RPC 前取消。选择 disk 同样绑定当前 dirty bufferRevision，保证复制期间原编辑状态不被改变。

gate 接实际编辑事务/undo/save/关闭切换入口，不只禁按钮。提交后 pending/传输未知继续同槽 query；明确 working=false 释放本人 gate，terminal unknown 保收据禁止重创。取消关闭意图使 activation intent 失效，不把已发复制当取消写盘；正常退出继续全部 dirty 保护。

源资格改为按固定版本核，不再统一要求 `!needsDiscard`；**允许原 dirty 保持 dirty，不允许 bufferRevision/raw 内容变更**。释放 gate 后再接纳新 snapshot 的每次异步检查仍复核原 source 和 activation intent，防同步 release listener 修改源或退出取消后迟到激活。副本已打开但未被前端接纳的 grant，沿既有 opaque handle 清理，仅清本 operation 新 grant，不影响原 dirty 标签；旧 opened 收据不复活已关闭副本。

### T3：后端来源信任与发布复用

disk 分支仍走现有 `withDuplicateSource` 的可信 grant/基线、稳定磁盘 hash 与发布前重验，只放宽前端普通 dirty 资格；复制磁盘版也不保存内存。

buffer 分支增加窄受控来源入口（建议 `withDuplicateBuffer(source,payload,action)`）：沿 `withCreateBarrier` 排空已准入 save/acceptance、核当前 grant/documentId/基线 revision/hash、已知风险/uncertain 与 disposal owner；独立验证固定 payload bytes/hash 后给同一 `publishDuplicate`。其 check/revalidate 仅重核这些服务端可见资格，始终使用同份已验证 bytes；内存分支不要求重新读取磁盘字节并等于基线，不把未知磁盘变化改写成另一份内容。它不声称后端有权威 dirty 镜像，不推进原 identity/revision/hash/mirror，不调用 incrementalSave 或 mirrors.prepare。renderer 观察到风险只保证发 RPC 前拒绝及迟到接纳时不激活；没有已实现的取消信号，不承诺它能撤回已发送后的磁盘发布。服务端已知失效应阻止未发布动作，已发布只能保留收据而不倒退；异常入口仍不在本片范围。

现有 `publishDuplicate`、creationHost、名称等价检查、strict 0、ENOTSUP、未明回执、已发布后的身份检查和 no-unlink 清理边界不改。本片新增验证集中在来源和版本合同，不重复创建 C API。copy gate 释放不更新原基线，原 undo/redo 和 dirty 在复制成功后依然可用。关闭/撤权后 retry-open/query 不路径复活，精确重放不能切换 disk/buffer。

## 最小 happy path 与必要实现后测试

批准实施后再编写/运行正式测试，不采用 TDD，不将本方案当运行证据。

1. 同一 BOM+CRLF/孤立 CR/无末行样本修改为 dirty，显式选内存复制：新文件逐字节等于 rawText 编码；原磁盘 SHA、原身份/dirty/选区/undo/redo 不变。
2. 同一 dirty 文档选择磁盘复制：新文件等于已确认磁盘原字节，不含未保存修改；原 dirty 不变。clean 默认磁盘路径回归。
3. 输入期源修改、hash 期间版本变化、提交 gate、释放 gate 的同步 listener 改源、跨标签/取消退出/迟到 snapshot 分别核正确拒绝或不激活，不误关闭原标签。
4. 伪 hash、孤立 surrogate、超过现有 1 MiB、异 kind/异内容同槽重放、回执丢失/unknown、已发布打开失败与 retry 均不重创；执行后槽不保正文。最大合法快照成本有限观察，不新增性能门槛或全局线性结论。
5. 源保存排空后基线变化拒绝旧版本；目标新空目录/只读源/冲突名称、原 15 项复制与创建回归；conflict/missing/failed/恢复入口仍明确不在本片范围，不改变待决项。

主线批准新 alpha/构建后真实 WK：中文版本选择键盘/鼠标、两种副本实际字节、原 dirty 与历史、其他标签、取消、浅深主题、正常退出保护。所有自建测试文件原 SHA 与新副本检查；自然 IME、跨卷和未注入的真实 OS 故障如实登记，离线留最终人工。

## 父项与后续责任

普通 dirty 两版本有限片不完成全部 F-058。conflicted/failed/missing/恢复中的可用内容及磁盘版本选择继续承接于后续 F-058 切片；F-028 三方比较结果复制、F-066 恢复日志与复制消费者各归原父项，OBL-036/065/067 不迁移或关闭。F-028c 撤销历史待决、阅读子窗口、专项、冻结候选、FINAL-ISSUE-001/002/003 与既有最终离线责任保持。

## 方案文档检查记录

初次 `bun run check:feature-docs` 的 catalog 检查通过，义务检查因继承约束标题写作“中文/主题”而报 `missing inherited checklist 中文与外观`；未涉及生产或运行测试。修正为既有四项精确名称后，`bun run check:feature-docs`（含 check:obligations）及 `git diff --check` 通过。此记录不代表方案已批准或功能已实现。

## 后端作者实现与有限验证

主线正式批准后新增严格 `DuplicateVersion`、`withDuplicateBuffer` 与 workspace 版本绑定。blank endpoint 拒绝版本载荷，duplicate 必须 source/version 成对；buffer 独立 UTF-8 往返/字节预算/实际 digest 核验，沿原 create barrier 与排他发布，不调用保存或 mirror 更新。slot 仅保存版本 kind/digest/byteLength，正文为执行局部参数；这是结构检查，不声称测量了堆回收。原 disk 测试只明确补 disk 版本，不改既有预期。

首次定向测试 18/0/95；首 lint 报六项（测试 thenable/空 callback 与无 await 方法），修正后通过。首 type 的四项错误属于并行前端施工（unused 三 import 与 params 可能 undefined），已通知作者并保留 `/tmp/f058b-backend-type.log`，随后全仓 typecheck exit 0。未放宽测试语义。

最终作者命令 `bun test apps/desktop/src/bun/documents/duplicate-source.test.ts apps/desktop/src/bun/workspace/duplicate-disk.test.ts apps/desktop/src/bun/workspace/create-markdown.test.ts apps/desktop/src/bun/documents/create-admission.test.ts`：41 pass、0 fail、238 assertions，四文件，日志 `/tmp/f058b-backend-frozen2.log`。覆盖 raw BOM/CRLF/lone CR、原基线/磁盘不变、异版本重放/伪 hash/孤立 surrogate/ASCII 与非 BMP 超限、现有最大合法字节预算、门禁与 release/dispose；只测有限正式接点。尚未独立后端复核、全量或真实 WK，本节不自批验收。测试沿既有脚本编译测试 native/worker，不是 App 打包；无版本或 Git 动作。

主线要求补最大合法内容的 workspace 实际发布后，同命令最终冻结结果为 42/0/242（`/tmp/f058b-backend-frozen3.log`，1.67 秒整组）。新增 1 MiB 多行原文经正式 workspace 发布且逐字节相等、原盘未变；不代表 WK/RPC 最大载荷或性能门槛已验证。原 41 项结果保留为中间记录。

### 独立复核发现的服务端已知风险窄修

Standards 指出原 42 项未覆盖 `observations.last` 已记录风险而 renderer 尚未接纳通知的间隙，主线批准限 T3 诊断修正。新增真实文件改写后调用现有 observe/probe 的回归首跑为 0 pass/1 fail/3 assertions（`/tmp/f058b-known-risk-red.log`）：后端已得 content-changed，buffer action 却仍进入。未改此预期；首红停止该测试后续 missing/replaced 分支。

正式修正仅在 `withDuplicateBuffer.check` 查询同 handle/documentId/revision/hash 的现有观察，last 非 unchanged 时拒绝（unavailable 同样保守）；没有新增磁盘重读/监听/镜像状态。修后同测试以真实 writeFile/rename 覆盖 content-changed、missing、replaced，均在 action 前拒绝。原四文件重新冻结 43/0/254、1.84 秒（`/tmp/f058b-known-risk-final.log`）；全仓 typecheck、两变动文件 ESLint 通过。原 42 项绿仍只是修前局部证据，不抹去此缺口；独立复核与真实验收仍由主线后续决定。

## 前端实现、失败与独立代码复核

前端新增显式版本选择与来源状态同步；dirty没有默认版本，clean隐式disk在变dirty后清空，提交仍兜底检查。确认时建立原owner，从rawText取快照并经rawHash，await后重验，再发送独立version；gate/adoptionSource不持正文，params/version执行后释放。原disk路径保留，统一命令名称改为“复制当前文档”。

作者首次将state.busy加入matchesDuplicateSource，误挡接纳自身load；已删除该处busy条件，初始准入仍检查busy，原接纳回归通过。中途测试遗漏byteLength、字节断言误写、超限编辑早已被原guard拒绝以及历史编辑同组的问题均保留；历史测试以公开isolateHistory建立明确分组，不放宽单次撤销语义。最终作者五文件52/0/445、type与定向lint通过。1MiB mockcontroller总2.459ms，JSON载荷1049211bytes、序列化0.364ms，仅CLI单次有限观察，不冒真实bridge/WK。

独立Spec实跑后端四文件42/0/242及前端五文件52/0/445，0必要构建阻断；后端作者独立前端Standards再跑五文件52/0/445（`/tmp/f058b-independent-frontend.log`），0必要构建阻断，不自批自己的后端。最终主线全量/构建/真实WK仍须完成，不以本节当验收。

## 真实验收准备（尚未执行）

alpha180首轮构建session77438 exit1：Vite及压缩完成后`hdiutil: create failed - 资源忙`、`ReleaseCommandFailed`，日志`/tmp/f058b-alpha180-build.log`；不能记整包成功。只读`hdiutil info`无列出挂载镜像，ps未见仍运行的hdiutil/hutch，不据此判根因；未卸载/杀进程或改网络。依diagnosing-bugs保留原红，先同源码同版本重试，日志`/tmp/f058b-alpha180-build-retry.log`，尚无新验收结论。

修后主线冻结全量1688 pass/1 fail/37738断言、226文件52秒（`/tmp/f058b-source-tests-final.log`，session15869 exit1）；唯一既有long-whitespace18.814秒超时仍FINAL002，不能称全绿。type/full lint/docs/lock/diff通过（session95137）。独立Spec修后43/254、后端Standards连observation48/1188及前端Standards52/445均0必要构建阻断；主线全文读最终生产接点，批准alpha180 unsigned构建与真实WK，不提前验收/Git。FINAL001003和父项保持。

修前主线全量1688/0/37726、226文件36.17秒（`/tmp/f058b-source-tests.log`，session5609）；type/full lint/docs/lock/diff通过（session63583）。但独立后端Standards在42/0/242之外指出真实合同缺口：buffer未核已有同绑定observations.last外部风险。主线批准仅补已有风险检查及正式回归，暂不构建；修前全绿不抵消此缺口，也不关闭FINAL001002003。后续以修后冻结结果为准。

主线自建夹具 `/tmp/agentic-f058b-wk.4Px9pl`，不会操作用户文档。`root-a/原文.markdown` 为68字节、BOM+两个CRLF、无末尾换行，SHA256 `81c8554e3697d5077d9e67230049bb8da618bece057ad2468fd2be3855764d8d`；`root-a/其他.md` 为 `a7c892023682198c65bf7224b9b0a49f43ce356b924d59bc853e1b018f40be01`；`root-b/cover.md` 为 `3d79f605cafe9b0b1aed645e577757ace994d17ad429aacaea7a2a217852d285`。apply_patch最初规范化换行，随后仅对自建原文做CRLF/末尾换行格式化并用xxd及SHA核实，以上为最终准备值，不冒已验收。独立应用数据区拟使用同夹具的data目录。
