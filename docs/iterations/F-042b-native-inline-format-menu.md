# F-042b：原生菜单基础行内格式入口

> 状态：alpha.123 非离线本片经独立最终 Spec/Standards 确认0必要阻断，主线正式批准受托 Agent 代验通过，非用户亲验。源码/包内Bun仓库各959项/27512断言，真实WK证据如下。Git待实际执行；完整父/义务、已知SDK限制及offline-final开放。下方旧待验/暂停/构建中均为历史。
> 日期：2026-10-12

## 最新真实 WK 代验：alpha.123

用户回复“我已退出，请重新打开”。主线确认旧进程不存在后重启同一包、同隔离数据与 fault lab，exec90227 / Bun63071；CUA 本次成功连接，不据此归因旧超时。版本/代码未变化，不重打包。以下均为受托 Agent 代验，非用户亲验。

- 自建 `/tmp/agentic-f042b-ui.8MTHfi/menu-a.md` 和 `menu-b.md` 通过原生选择器打开。A 47 字节、B 34 字节；请求耗时包括选择器停留，不是文件读取性能指标。
- A 以键盘明确选中 `Alpha plain text.` 后，编辑模式从原生“编辑”菜单分别执行粗体、斜体、行内代码；切源码分别核对 `**Alpha plain text.**`、`*Alpha plain text.*`、反引号包裹原文，选区保持内部文字。源码菜单移除粗体和代码均回 clean，源码斜体及代码添加也已实操。斜体一次撤销回 clean、重做回标记；重做选区含标记，是实际观察，不冒称所有撤销路径均保持内部选区。
- 打开 B 再回 A，撤销恢复此前代码格式、重做回 clean；源码/编辑往返选区仍为原文字。B 内容独立未被 A 操作改变。
- 树行焦点、设置页、查找输入框、阅读模式均实见三项格式菜单 disabled；退出对应界面后 A 仍 clean。B 通过临时 chmod444 成为只读，切入后菜单三项 disabled；恢复644后界面重新可编辑。
- B 编辑器按 `n` 出现原生组合输入下划线，相关控件冻结，菜单三项 disabled；显式 Cancel 菜单后 Esc 取消组合，正文 clean。仅工具原生组合输入路径，非自然键盘用户 IME 全矩阵。随后粘贴测试标记正常，单次撤销回 clean。
- B 通过既有解析故障实验进入安全源码，正文完整、clean；聚焦并全选后菜单三项 disabled。
- 应用浅色截图正文/选区可辨，深色偏好已实际恢复。原生菜单中文/disabled 状态在两种应用外观下有 AX 证据；未修改系统外观，不冒称系统原生菜单浅深像素矩阵或截图验收。首次 AX 点击浅色文字未提交选择，随后 Home/Return 正确选中并核对设置值，不把首次动作记成功。
- 最终 A 普通源码 clean、B 安全源码 clean，⌘Q 返回 App quit，Bun63071 随后不存在。未保存正文。两文件权限恢复644，SHA256与初始一致：A `33cf12847620bd4b4d1c40bb8b12bf12c7ef21729a6d2f03b5b29017d4275650`，B `ff6999fd666ce6fb532e302a2b4abc4d3cb3b1e480379058b38906204bae2aae`。

旧票据/ABA/重复消息和100次同可用性更新不重建菜单由受控测试覆盖，未伪造 native 延迟竞态或 RSS 实测。SDK 实际布尔改变仍残留 registry 的已知限制保持；自然键盘 IME、系统菜单像素矩阵与离线项不扩大为已验证。

最终独立 Spec 与 Standards 分 lane 核查均0必要代码/验收阻断，后者复跑6文件37项/272断言/187ms，双方独立核fixture hash/权限与进程不存在。UI证据来自主线操作，非两位reviewer亲自实操。主线据此正式批准非离线有限片受托代验通过；完整父F-042/OBL-057/064与F-042b-offline-final继续开放。Git仍待实际执行，不预写成功。

## alpha.123 构建与连接检查点

第四次：再间隔30秒后精确App路径仍返回`-10005 timeoutReached`。无AX/截图及新的真实验收结果，用户窗口状态回复仍待收到；保留进程，不重复启动。当前停止在真实窗口连接步骤，未验收/不得Git。

补充：包内Bun运行仓库测试959项/27512断言/153文件/21.95秒通过，日志`/tmp/agentic-f042b-package123-tests.log`，不是产物内全部资源实测。第三次在重建CUA会话、再间隔30秒后使用/private/tmp规范路径仍timeoutReached，无窗口证据；已异步询问用户是否解锁且新版窗口可见，仍保留现有进程、不重复启动、不强杀或改网络。三次失败根因未知，未打开fixture，真实代验尚未开始。

`AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary`成功（`/tmp/agentic-f042b-build123.log`），保留既有chunk与hdiutil弃用警告。已核CFBundleVersion及展开version.json为alpha.123、hash`1yz5ylfmuuoqb`，副本`/tmp/agentic-markdown-alpha123.FYClhK/Agentic Markdown-canary.app`，同隔离数据/fault lab启动exec33241 / Bun58285。首次连接及间隔20秒后精确路径重连均`-10005 timeoutReached`，无AX/截图，不推断根因；没有打开测试文档/保存或重复启动。源码测试不替代实际菜单验收，未验收/不得Git。

## 当前候选暂停：菜单重建生命周期风险

后续主线批准最小替代候选：独立Spec确认不新增产品选项，授权快照时点明确改为native点击回调同步复制Bun缓存票据，而非菜单打开时选区；回WebView仍使用该票据、严格state/view/session/focus/权限/IME并单次消费，缓存落后只能拒绝。不因token变化重建原生菜单；本地授权立即同步失效，与合并同轮的展示通知分离，原生仅按最终三个布尔变化重建，不能让每state的null→新票据导致两次重建。受控测试必须证明同可用性的连续输入/移动选区不增加setApplicationMenu调用，而旧票据及ABA不能复活。真实布尔变化仍有SDK注册增长，本片仅消除每state引入的放大，不宣称修复SDK或内存无界问题。若实测布尔仍高频切换，继续报告。原候选暂停为历史，替代尚未完成/验收。

主线与两条独立只读核查一致：2.0.1 `proc/native.ts` 的 `storeMenuData` 每次序列化建立Map项，`deserializeMenuAction`仅点击时清对应项；`setApplicationMenu`替换路径未清旧项。包含undefined data及role项，省略data、把票据塞action或延迟仍不能消除高频重建残留。此为源码生命周期证据，不冒称RSS实测。当前每state票据触发菜单全量重建的候选暂停，不构建/验收/Git，不访问SDK internal清理或修改SDK。

候选已落部分源码与测试，尚有3项lint问题、最后typecheck未运行；不是通过状态。有限Bun三类规划测量50次选区state变化：100字符总9.69ms/max2.20ms，9000字符总68.31ms/max2.17ms；现有缓存仅同state同kind复用，新state仍三次规划。这是合成规划开销，不含UI/native重建，不设性能门槛。

正在独立评估将原生菜单action与频繁目标快照分离的最小路线：既有availability桥仅更新Bun目标缓存，不因票据更新重建菜单；点击回调快照当刻缓存票据，回WebView仍严核旧票据，不用接收时最新目标。尚未批准替代生产，需评估布尔可用性变化是否仍造成高频重建，不能仅换字段就宣称解决。

<!-- obligations: OBL-057 -->
<!-- deferred-obligations: none -->

## 功能说明与依据

能力总账 E-20 确认快捷键/菜单格式入口；F-042a 已交付粗体、斜体、行内代码的快捷键和命令面板，明确将原生菜单留后续。本片仅在原生菜单提供这三项中文入口，不新增格式种类、浮动工具栏或快捷键。既有合法范围、原文保真、单次撤销、多范围整体拒绝和代码 padding 限制完全继承 F-042a。

F-006 命令、F-014 历史、F-042a 格式规划器已具备。仅局部承接 OBL-057；OBL-064 作为历史/IME 消费者协作，主责不迁移。完整 F-042/OBL-057/064 保持开放，不涉及 F-028c、代码围栏内部换行或其它待专项设计。

## 最小技术方案与先行调查

复用现有原生 ApplicationMenu、命令可用性消息和统一命令路由，最终仍执行 F-042a 原文事务。不以原生 enabled 缓存作为写入授权；执行时重核当前活动文档、注册 view/session、state/selection、权限/冻结、普通模式与 IME。只从合法当前编辑器获得目标，树、设置、搜索框、其它输入框不能借旧目标修改正文。

先查本地已装 Electrobun 公开 API、原生菜单生命周期及现有历史菜单行为。必须查清菜单选择造成的 DOM/window 焦点变化与回调时序；不能直接删除 hasFocus 守卫或长期缓存“最后编辑文档”。若严格当前焦点即可工作，优先最小适配；否则先证明生命周期协议可拒绝失效目标，再批准接线。未证明之前不预定全局焦点补丁、原生 addon 或新增 RPC 协议。需要关键路线扩展时报告，不猜测放宽安全边界。

## 最小正常路径与边界验证

- 自动：三项菜单标签/禁用/动作映射，严格消息校验；各自可用性与现有格式一致；过期目标、选区或状态变化、注销、模式/权限/IME变化拒绝；保留现有键位，不出现双重执行。
- 真实 WK：普通编辑/源码选中文字后从原生菜单分别加格式/去格式；一次撤销及跨标签/模式历史；从树/设置/其它输入框打开菜单不能借旧选区写入；只读、阅读、安全源码及工具原生组合输入不误写；关闭/取消菜单后正常输入；浅深菜单可辨、正常退出及样本磁盘 hash 原样。
- 生产测试与真实界面证据分列；原生 API 行为未证实前不得把受控单测当焦点正确的证据。先独立方案核对，再实现、独立代码审核、打包递增 alpha、实际代验和最终复核。

## 继承约束检查

- F-002：本地内存事务，无网络、自动保存；`F-042b-offline-final` 留最终人工，不执行断网或进程隔离。
- 中文与外观：复用原生中文菜单和系统呈现，不新增自绘主题；实际浅深菜单和现有编辑外观分别检查。
- 命令与键盘：统一命令入口与实时守卫，保留现有快捷键及 IME 优先；无新拖动。
- 安全与日志：不新增正文/路径遥测、授权或磁盘写入；只用自建 fixture，失效目标整次拒绝。

## 当前进展

替代候选实现冻结：既有format命令新增独立nativeToken，未复用面板失焦豁免；MemoryEditor注册精确目标与controller/view事件守卫，blur/组合输入/状态变化同步撤销，展示通知microtask合并；Bun缓存每个新票据但只因三布尔及既有availability真正变化重建菜单，点击即时复制缓存回传，不使用可变menu.data。未改版本/构建/UI验收/Git。

executor最终定向6文件37项/272断言/141ms通过（native-format-menu、inline-format-input、inline-format、bun/app/menu、commands/registry、bun/rpc/index），typecheck、8文件专项eslint和diff绿。覆盖旧/重复票据、权限/焦点ABA、selection-only实际updateListener、旧注册cleanup与100次同可用性票据更新setMenu增量0。初次Object.hasOwn目标lib不支持及3条lint已局部修正；新增严格数组拒绝回归与Array.isArray守卫一并冻结。主线type/full lint绿；首次全量与末尾schema修正时间重叠，报958通过1失败/27513断言，named-property array未拒绝，日志`/tmp/agentic-f042b-full.log`保留；现对冻结源码重跑，不把失败删掉或预写已绿。独立最终两轴代码复核待结果。

前轮 F-043h 已提交推送 `2d69b91284767a01f8ca631ebf541fe65d76f109`，主线以 ls-remote 核远端 main 同 SHA，开始本文件前工作树干净。新片无代码、版本或运行结果；公开 API/焦点调查与独立方案复核待完成。

## 公开 API 调查与严格候选批准

已核本地固定2.0.1的`apps/desktop/.hutch/devkit/api/sdks/main/core/ApplicationMenu.ts`：支持action/data/enabled及点击事件，未提供open/close生命周期；不能使用根node_modules残留旧版本推断行为。沿既有可用性消息和command桥接，主线批准先实施严格候选，不新增原生桥或RPC端点：仅真实当前editor聚焦时创建不含正文的opaque票据，绑定document/view/session/精确state及selection；任何失焦、IME开始、状态/权限/模式/冻结/卸载变化同步失效，恢复不能复活旧票据。回调必须携带菜单项原票据，不能替换成最新票据或降级无票据入口；执行仍要求hasFocus和实时guard，成功前消费、防重入/重复执行。菜单不绑定新accelerator，保留CM既有键位。独立Spec确认这条调查/验证路线0阻断，但不预先批准可交付；若真实菜单失焦导致拒绝，就报告候选失败，不放宽守卫。

旧alpha.122预调查：同隔离数据重启exec57552/Bun56364，打开自建A源码，尝试选Keep后打开编辑菜单；AX显示原生菜单但不提供DOM焦点。工具Escape后快捷键执行，菜单AX仍在，截图不可用；显式Cancel后读到Keep后插入粗体占位，而非预期包裹Keep。该路径未在开菜单前核选区，因此既不能证明菜单丢选区，也不能证明准确保持；不作为新消费者通过证据。撤销后clean，⌘Q正常退出，未保存。仍须在候选包中对真实菜单action及票据失效做专门验证。
