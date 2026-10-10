# F-041b：普通源码逐项替换

实际交付收据：主线已提交推送 `678000d9e0b1a526973f3a42bbfa87d13b4a461a`，核验远端main同SHA、当时工作树干净；本收据文档追加本身尚未提交。下文待Git保留为提交前历史，非离线本片及父/义务/离线边界不变。

> 状态：2026-10-11，alpha.114非离线本片受托Agent代验通过，非用户亲验。Git待实际执行；父/完整义务与最终离线开放。

## 正式结论（2026-10-11）

最终独立 verifier 确认非离线本片0剩余已识别阻断，独立复跑29项/257断言/4文件/2.02s，核对源码及包内日志、三样本SHA与文档/义务/diff均通过。主线正式确认 F-041b alpha.114 非离线本片受托Agent代验通过，非用户亲验；以下候选/未构建文字均为历史检查点。普通源码逐项替换可用，父F-041及完整OBL-056、F-041b-offline-final与全部替换/编辑阅读余项继续开放。113/114组合证据及所有未实测边界保留。当前无运行窗口，Git待主线实际执行，不预写提交成功。

## alpha.114 非离线验收候选（待最终独立复核）

主线已构建 alpha.114，hash `140vnzr6plmf5`，产物 `/tmp/agentic-markdown-alpha114.ptYNPA/Agentic Markdown-canary.app`；version.json与Info.plist一致。exec74657 / PID266，仍同隔离数据目录，未打开用户正文。源码885项/20840断言/142文件/22.99s通过，typecheck、全lint、文档/义务/lock与diff检查通过。源码日志 `/tmp/agentic-f041b-source114-tests.log`、构建日志 `/tmp/agentic-f041b-build114.log`；构建退出0，既有chunk及hdiutil警告保留。提示窄修两轴独立复核均0代码阻断，未据此直接验收。

包内Bun运行仓库测试885项/20840断言/142文件/22.02s通过，日志 `/tmp/agentic-f041b-package114-tests.log`；此项不等同完整包资源或实际UI验收。

真实WK复验：

- A的“保持原样”替换为两次重复仍显示—/2及有效no-next提示；显式下一到1/2时旧提示立即消失，替换恢复可用。undo回clean；另替换为X后无结果提示，查询改alpha后1/3且旧提示消失。全词cat到DOG不改scatter/cat_，undo正文变化也清旧提示，回原文clean。
- 替换框普通Tab仅观察到HTML焦点，无成功按钮证据，不推断系统原因；实际Option+Tab聚焦“替换当前”，Space执行上述全词替换。Option+Shift+Tab聚焦收起按钮，Return收起，Space展开；独立核对既有同类Option+Tab验收约定，不改系统设置。
- 编辑/阅读无本片入口，返回源码仍保留cat/全词/DOG及展开状态。浅色、固定深色与跟随系统当前深色画面均有截图；未改变系统外观来测试动态切换，最后设置读回固定深色。
- B首次查找空白且替换区未展开；配置beta/BETA2后A仍cat/DOG，返回B保持beta/BETA2。一次AX标签点击未切换，重新读回后重试成功，不据此确定原因。B触发既有解析故障后安全源码不留查找/替换，正文clean；关闭重开B后故障解除、查找条件空白、替换区未展开，未继承旧条件。
- B重设beta，替换框系统中文源工具键ni期间替换禁用，Esc取消组合但栏仍开，ni+Space提交你，正文不变；点击替换后仅首个beta变你并定位剩余项。不是用户物理键盘验收。CmdQ出现未保存确认，继续编辑后内容/条件均保留；单次undo回原文clean。最终A/B均clean，正常CmdQ返回App quit，PID266已不存在；三样本SHA与上列基线一致，未保存、未断网。

alpha.113的字面模板、多行、同文、删除及只读真实证据保留版本边界；114仅notice寿命窄修，不冒称所有113路径已逐项重跑。完整替换行为另由最终源码/包内受控测试覆盖，不能冒称WK同等实测。未实际注入Worker timeout/晚回执竞态、1MiB超限、loneCR/BOM磁盘保存、多光标与替换组合、真实权限在途失效、用户物理键盘、RSS或系统主题动态切换；对应模型/既有基础证据与边界均保留。父F-041、完整OBL-056、全部替换/编辑阅读消费者和F-041b-offline-final继续开放。本片当前仅验收完成候选，待最终独立verifier与主线确认，未Git。

### alpha.113 实际窗口中间证据（未验收）

主线构建 alpha.113，hash `3fqo4pae3wfss`，包 `/tmp/agentic-markdown-alpha113.89GDIv/Agentic Markdown-canary.app`，exec98174 / PID99124；源码884/20833/142文件22.33s、包内Bun运行仓库测试884/20834/142文件22.39s，类型/全lint/文档/义务/lock检查通过，不等同整体验收。日志 `/tmp/agentic-f041b-build113.log`、`/tmp/agentic-f041b-source-final-tests.log`、`/tmp/agentic-f041b-package113-tests.log`。Vite大chunk与hdiutil弃用提示保留，构建退出0。

真实WK自造样本 `/tmp/agentic-f041b-ui.1GmR2h`：replace-a 的字面 `$1\\X` 替换、自动下一、单次undo/redo再undo回clean；同文替换仍clean并从2/3到3/3；跨行AAA/BBB到ONE/TWO后undo回clean；保持原样到重复两次后显示—/2且替换禁用、显式导航1/2恢复执行；随后空替换删除一次回原文clean。替换textarea Enter插入换行、正文不变。只读文件可查找和填写NO但替换禁用并有原因；返回A仍原独立条件。系统中文输入源的工具键ni期间替换禁用、Esc只取消组合而不关栏；再次ni+Space得到你且正文clean。这是工具驱动系统输入源，不冒称用户物理键盘。深色真实截图可见。

期间发现no-next旧提示在显式导航/undo/query变化残留，独立Spec确认P2，必须修正再构建114复验。原生选择器paste未改变旧路径，改AX setValue并读回后只打开本轮样本；未打开旧format或用户正文。若干批量键返回首个AX未反映操作，分步读回后才记录终态，不据此归因工具或应用。两标签均clean后CmdQ返回App quit；未保存、未断网，三样本磁盘SHA原样。113仅中间局部证据，不替代114复验及其余检查，不得Git。

三样本SHA256：replace-a `f2f891f681c4b5ef37c656c5b6d42052d88a65d2a8c316b17013bc4492894737`；replace-b `7edf53d1c097567ed3ad3a5c540fbbfc708c5cee938d9b23c10685b2a4f7b8c8`；readonly `f6af9c5457359901979f21c15ea156467de4eb5bc0c8218c049ec8fd2103bd2a`。

> 历史方案检查点：2026-10-11，主线已批准最小方案、独立 Spec 0 方案阻断，当时实施中、尚未构建或验收。仅本文件为本轮记录，当前结论以顶部正式结论为准。

<!-- obligations: OBL-056 -->
<!-- deferred-obligations: none -->

## 功能与已确认边界

依据能力总账 E-10、E-11 及 MVP F-041 分模式接入约定，承接已交付 F-041a 的普通源码当前文档查找，增加逐项替换。前置为 F-041a 查询/有界索引、F-014 文档事务与历史、F-016 可写能力及统一命令，均有对应基础。仅局部承接 OBL-056；完整父 F-041、编辑/阅读可见文本查找、全部替换与完整命令责任继续开放。

用户已明确决定：保留 `⌘H` 隐藏 App，替换先使用查找栏按钮，快捷键后续统一设计。本片不改原生菜单、RPC 或系统快捷键，不新增替换快捷键，也不把按钮交付称作完整 E-10 已完成。不推进 F-028c、专项设计或离线验证。

## 最小交互

- 既有 `⌘F` 查找栏增加“展开替换 / 收起替换”按钮；展开后显示替换文本框与“替换当前”按钮。按钮提供中文可访问名称、可见焦点与 Tab/Space/Enter 操作；不新增命令面板入口。收起不丢替换文本，关闭查找栏沿既有行为。
- query、大小写/全词、replacement 和替换区展开状态按已打开文档独立保存，仅内存；切标签/离开普通源码保留小状态，关闭文档、替换会话、clear/dispose 释放。查询条件变化按既有规则失效；替换文本变化不重新扫描正文。
- 匹配语义完全沿 F-041a：普通文本、大小写、全词，无正则、无兼容字符扩展。替换内容始终字面文字，`$1`、反斜杠不作模板解释；空串删除当前命中，textarea 保留粘贴多行，输入组合期间不执行替换。Enter 在替换 textarea 中输入换行，不隐式提交写入；通过按钮执行替换，Escape 候选期间不关闭查找栏。
- “替换当前”操作已完成搜索的当前命中，不要求编辑器原选区刚好等于该范围；只替换一个结果，不对源码多光标分别写入。完成后自动定位下一项：从插入结束处向后寻找，末尾可回绕；此次自动定位跳过与刚插入区间相交的命中，避免替换文字再次包含 query 时立即重复处理。删除后在同一位置形成的新命中可作为下一项。没有其它候选时保留精确总数并提示“替换完成，没有下一匹配项”；用户仍可显式上/下一项重新选择任何现有命中。该跳过仅限本次自动定位，不删除索引结果。
- 替换内容与匹配内容在实际原文效果上相同时不制造 dirty 或空撤销步骤，按上述规则定位下一项；真实变更只形成一个 transaction / 一次 undo，后续搜索与导航不进入正文历史。超过现有正文 1MiB 字节上限则拒绝整次写入、保留原文并说明，不截断内容。
- 只读普通源码仍可查找、展开及填写替换条件，但执行替换禁用并说明；非普通源码及 safe 不安装本片消费者。搜索中、无当前命中、结果失效或当前输入组合未结束时不允许执行；不得把失败状态当作无结果。

## 最小实现路线

复用现有 search store/owner/Worker 与公开 CM `EditorState`、`Transaction`、ChangeSpec。现有 `@codemirror/search` 6.7.2 的匹配范围已由公开 SearchQuery 产生，不另写 Unicode、正则或替换匹配引擎；本片仅将一个可信匹配范围替换为字面文本。若自动定位需要跳过范围，为既有 Worker 导航增加有界、严格验证参数，只返回一个结果，不将全文索引发送到 UI。

统一 registry 接入展开/收起及替换当前命令，参数不接任意正文范围。执行从当前受控 owner 获取不可变当前结果凭据，检查 documentId、不可复用 editor session、当前 Text 身份、query/options signature、Worker 请求代次与当前匹配范围；比较该范围的当前正文仍与凭据一致，不能只检查 revision 或查询长度。当前 view 挂载身份、活动文档、普通源码模式、实时 canWrite、冻结/busy、controller 输入阻断、编辑器及两个查询输入的 IME 状态均须再核对，不能靠按钮 disabled 或过期菜单可用性赋权。

凭据必须由 owner 同步提供当前已验证结果，不能读取可能滞后的 React rendered result 作为写票据；接收及执行同帧仍复核 live 身份。替换 textarea 的未提交 composition 草稿同样阻止执行，不能只检查正文 view 的 compositionStarted。

成功路径在一次同步执行中构造和应用当前正文事务，沿既有 controller/updateEditor 授权通道；不允许异步晚回执直接写入。提交失败不发后继导航、不重试旧写入。成功后立即使旧匹配失效并发起当前正文重算，自动定位绑定替换后的 Text/session/query 与该次意图；等待期间用户输入、改变条件、切文档/模式、手动导航或关闭使旧自动定位失效，不覆盖新选区。连续点击在重算阶段禁用，无无界写入队列。

沿 raw-buffer 的公开逻辑位置到 rawText 事务映射，保留未触及 BOM、CRLF/LF 与所有其它字节；新换行遵循已有编辑插入规则，不另建文件格式规范化。受影响的原文范围按真实 CM 位置而非 raw 偏移计算。写入前及 controller 既有边界均验证结果字节上限；不把 UTF-16 长度等同 UTF-8 字节数。导航/显示不推进磁盘基线、不自动保存。

既有 applyEditorChanges 可能在 lone CR/LF 边界调整实际 CM 范围，后继起点和本次插入排除区必须依据最终 transaction 的 changes/map 与最终 state 推导，不能盲用旧 from + replacement.length；同文判定也以实际原文效果为准。

继承 F-041a 单 Worker/有界 pending、失败取消、session/Text/query fencing、presentation 释放契约；替换执行不新增 Worker、全文主线程查找或全量 DOM。实现前核已安装公开 API 声明及原文映射测试；若现有接口无法保持这些边界，先报告局部方案问题，不扩架构。

## 最小 happy path 与边界验证

自动测试：普通源码两处相同词，替换第一处、精确定位第二处，undo/redo 恢复原文；空串、多行、同文本、替换内容含 query、尾部回绕/没有其它匹配；大小写/全词及 emoji 真范围；BOM、混合 CRLF/LF 未触及保真和字节上限拒绝；多选区只改当前命中、一次正文事务；A/B 条件隔离及关闭释放；只读/safe/非源码/IME/冻结拒绝；旧 session、Text、query、当前范围、late 重算和连续点击均不能重用旧写；权限在按钮显示后失效仍拒绝。受控生命周期测试不冒称真实 WK 或自然键盘验收。

真实 WK：Agent 自造 fixture，`⌘F`→展开替换→字面替换并定位下一→撤销/重做；删除、多行与无变化路径；跨标签状态、只读查询允许/替换拒绝、模式隔离、中文候选、Tab 按钮操作与浅深外观；退出前通过撤销回 clean 或按授权仅放弃 Agent 自造变更。主线负责版本递增、打包、运行与真实代验，未测路径如实保留。

## 继承约束检查

- F-002：本地内存操作，不新增网络、路径或磁盘写权限；`F-041b-offline-final` 留最终人工，不断网。
- 中文与外观：中文标签/不可用和失败原因，浅深/当前系统外观、焦点及高亮可辨；不改变主题或重新解析策略。
- 命令与键盘：按钮与键盘激活复用统一命令；保留 `⌘H` 隐藏 App，替换快捷键留后续统一设计；候选期间不抢输入法。
- 安全与日志：执行侧实时权限与身份检查，旧结果不写入；不记录正文、查询、替换文本或路径，不持久化替换历史；保持原文/历史和派生资源释放。

## 当前证据与后续责任

alpha.113 实际 WK 新 P2（主线复现、独立 Spec 确认）：显式导航已有1/2匹配后仍保留“替换完成，没有下一匹配项”，undo/改变query也残留。不能以先前测试绿覆盖此失败。窄修将提示绑定当前 Text 与 query/options/open 生命周期：同步条件订阅、正文变化（含undo/redo）、显式导航、关闭及再次替换时清理，普通viewport回执不清有效提示；订阅随消费者卸载释放。新增生产 `createReplacementNotice` 接缝回归，验证同Text/条件重复同步保留，Text/查询/选项/关闭及显式清理失效。修后定向29项/257断言/4文件/2.02秒通过；待独立复核及主线alpha.114实际原路径重验，尚不声明113问题已在真实窗口修复。

主线批准、独立 Spec 无方案阻断后已实现候选：owner 同步匹配票据、单次 scan 排除插入区后继（真实计数不删减）、公开 CM 单事务替换 helper、逐文档替换条件及查找栏按钮。原生菜单/RPC/快捷键未改变；生产尚待独立代码核对及真实窗口代验，不声明产品已通过。OBL-056 为局部承接，完整父能力与 `F-041b-offline-final` 开放；全部替换、编辑/阅读消费者及快捷键统一设计后续独立承接，不借本片关闭。

实际定向命令：`bun test apps/desktop/src/client/source-replacement.test.ts apps/desktop/src/client/source-search-engine.test.ts apps/desktop/src/client/source-search-owner.test.ts apps/desktop/src/client/source-search-view.test.ts apps/desktop/src/client/history-documents.test.ts apps/desktop/src/commands/registry.test.ts`，50项/397断言/6文件/2.09秒通过；typecheck 与受影响 eslint 通过。覆盖票据导航在途/查询即时失效、返回范围副本、排除仅作用本次自动定位、字面内容/BOM混合行尾、lone CR/LF最终transaction映射、同文无undo与真实单步历史、输出字节上限及文档条件释放。中途 readonly 测试直接追加普通 facet 被现有 writePermission 优先项覆盖导致1项红，已改用生产 compartment 切换构造真实只读状态，不修改生产以迁就测试；import顺序和optional-chain lint提示已修。

上述为模型与controller既有接缝证据，不冒称完整React按钮/自然IME/真实WK输入验证。主线负责后续全量、alpha版本、构建及实际验收；此候选未构建、未 Git。

独立 Spec 随后指出 P2：关闭栏取消 Worker 却未清自动定位意图，重开同正文/条件可能恢复旧排除区与选区跳转。已将关闭路径接入 `closeSearchSession`，先清意图再取消及关闭；失效/空查询分支及任务失败同样清除，卸载释放。新增同步 store 订阅，在查询/选项变化时立即取消意图，即使 React effect 前改回原条件也不复活；订阅随消费者卸载释放。生产调用的关闭及订阅接缝回归覆盖关闭→重开、query改走→改回、其它文档条件不误伤。lone CR/LF测试新增明确结果 position2/exclude[2,2]，不只比较map自身。修正后定向51项/403断言/6文件/2.07秒通过，待最终独立核对，不把此前主线全量预检当修订通过。
