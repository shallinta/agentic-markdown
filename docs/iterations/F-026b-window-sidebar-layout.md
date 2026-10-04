# F-026b：当前主窗口侧栏布局

> 状态：2026-10-05 用户确认分隔线验证通过，补齐指针拖动；此前 alpha.81 非指针路径及新进程布局恢复为 Agent 代验，独立最终代码复核 0 阻断。非离线本片已通过；当前 alpha.82 组合的指针待验 Git 阻碍解除，提交推送待主线核验。历史失败与离线最终人工项保留，父功能仍开放。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## 功能说明与范围

落实 U-09 / 基础结论 197：当前主窗口可显式显示/隐藏文件树，拖动侧栏分隔线调整宽度；保存该窗口的可见性和上次主动确定的有效展开宽度，正常退出后重启恢复布局。隐藏只移除布局占位，不卸载文件树与工作区、清除选择/展开、关闭文档或改变授权。再次显示按当前可用空间夹取，不横向溢出。

本片仅复用当前主窗口的既有 window-state 槽位，不使用 App 全局共享侧栏偏好，不引入新的 Workspace 产品对象。根集合/授权和文档会话恢复留 F-029/F-037；原生多窗口、主副区及其已确认 160px 最小宽度留 F-031 等消费者，不在本片提前实现。无主承接义务，父 F-026 仍有完整树余项。

## 最小技术方案

1. 复用 `packages/shared/src/server/window-state.ts` 的版本化设置存储，为当前窗口槽位补充受校验的侧栏可见性与展开宽度；通过既有窗口 RPC/统一命令路径读写最小布局元数据。不存文件路径或正文，不将布局恢复当作权限恢复。
2. 复用 `apps/desktop/src/bun/app/window-state.ts` 串行合并写与退出 flush，避免布局、frame、zoom 互相覆盖。写入失败须可见，不虚构成功持久化；拖动高频事件只合并布局更新，不同步频繁磁盘写。真正退出等待既有 flush，取消退出不丢当前状态。
3. 替换 starter 的 `sidebar-size` localStorage 直接读写接线。初始化先完成已保存布局读取/校验，再允许 resize 回调持久化；首次挂载或程序性恢复回调不能用默认值覆盖旧宽度。旧值迁移如有必要仅作明确一次性兼容，不把旧全局值长期当权威。
4. 区分用户主动拖动记忆宽度与窗口变窄产生的临时 clamp。临时夹取、隐藏尺寸或程序性恢复不改写上次主动展开宽度，窗口变宽/再次展开可恢复；主动拖动才更新意图。现有侧栏 200px、正文 640px 为继承实现保护参数，随真实验证调整，不是新产品下限或性能门禁，不能替代主副区 160px 规则。可用宽度不足时仍安全约束实际布局，不横向溢出，不提前冻结完整布局策略。
5. 侧栏保持挂载但隐藏占位，隐藏时内容不可获得键盘焦点。复用既有中文菜单、`⌘B` 与统一切换命令，并在侧栏外新增最小可聚焦中文切换按钮，隐藏后仍可达、调用同一命令；当前尚无该独立按钮，不将其写成继承能力，也不为此设计整个工具栏。布局 token 更新不触发目录重扫、root generation 变化、Markdown 重解析或文件树数据重建，正文 dirty、历史、模式和授权保持。

本地已安装 `apps/desktop/node_modules/react-resizable-panels/README.md` 的正式 API 说明中，`onLayoutChanged` 的 `isUserInteraction` 区分指针/键盘主动变化与 API/挂载变化，可作为主动宽度记忆的最小接线；`groupResizeBehavior` 的 preserve-pixel-size 可评估用于侧栏，同时保留至少一个相对伸缩 panel，不提前扩展完整布局架构。基础结论 29 / M-36 的 3px 命中区针对副区文档分隔线，本片不改该规则；侧栏既有视觉线与库的最小拖动命中范围分别核对，不以 CSS 线宽冒充实际命中宽度，不无意全局修改共用分隔线组件。

2026-10-04 修正版最小路线补充（主线已批准）：针对 alpha.78 窗口变宽未恢复，使用可取消的下一 `requestAnimationFrame` 恢复，执行时读取最新布局意图与实际 group 宽度，避开约束重注册后的提交时序。最终取消边界为 Group pointerdown 暂停帧，window pointerup/pointercancel/blur 后重新协调；依赖变化和卸载清旧帧，卸载移除全局 listener。键盘不再无条件取消帧，帧读取同步更新后的最新意图；可见但 group 宽 0 时等待后续尺寸变化，不 resize 为 0。隐藏焦点与 inert 立即生效。此前无条件取消会使普通点击吞掉唯一恢复机会，经 Standards 提醒修正；这是局部恢复接线，不建立新布局框架。

## 最小 happy path 与异常验证

- 初始无布局设置时使用合法默认；显隐及拖动后正常退出重启，可见性/主动宽度恢复，但无根或文档自动授权恢复。损坏或未来版本设置沿既有安全策略处理。
- 有根及展开/选择、dirty 阅读或编辑文档时隐藏再展开：树状态、标签、正文/dirty/历史/模式保持，root generation 与解析请求无新增；键盘可重新显示，隐藏树不残留焦点入口。
- 拖至有效宽度→缩小窗口产生临时夹取→扩大恢复意图；隐藏时缩放再展开无溢出，不把 0 或夹取值写回主动宽度。恢复读取延迟与初始化 resize 并发时不覆盖已保存值。
- 连续拖动/切换及 frame/zoom 并发写、立即正常退出 flush、持久化失败和取消退出均有验证；自动测试不冒称真实窗口竞态。
- 真实 WK 通过菜单/快捷键/控件、拖动/窗口尺寸变化及重启核对布局和中文浅深/系统呈现；记录实际样本与参数，不预写性能收益。按 alpha 规则构建、独立复核和代验后再记录通过。

## 继承约束检查

- F-002：仅 App 数据区布局元数据，不写用户文件或联网，不改变离线产品边界。
- 中文与外观：切换与失败提示中文，浅/深/系统下分隔线、焦点及恢复入口可辨，不改变阅读主题。
- 命令与键盘：复用统一命令、菜单与快捷键，保留上下文和输入组合保护；隐藏后不困住键盘焦点。
- 安全与日志：布局值受运行时校验，窗口槽位不授予文件权限；不记录路径或正文，不提前构建根/会话恢复。

## 最终人工待验：F-026b-offline-final

真实离线显隐、拖动及布局恢复留最终统一人工，不执行、不标通过，不断网或尝试进程网络隔离；不阻塞非离线范围通过后的交付。完整父功能与后续消费者开放。

## 实际改动与验证

最小方案经主线批准与独立 verifier 最终 0 阻断，executor 已开始实施；尚无实现交付、测试、构建或验收结果。侧栏外新增最小切换按钮按修正方案执行，不将其当作已有控件。

### 实际实现与构建前验证（2026-10-04）

侧栏元数据复用当前主窗口 window-state 原子合并存储，native 300ms 合并写、串行队列及 flush；get 返回当前 desired 布局。Renderer flush 接入既有唯一 canonical discard participant 的 `waitForSaves`，先等正文保存再等待布局 RPC，涵盖 reload/退出；失败可见、阻止该次退出并可重试，初始读取失败且无主动修改不困住退出。初始化晚读按可见性/宽度分别保留主动意图，临时 clamp 与 API/挂载回调不写偏好；旧全局 localStorage 不再是 Page 权威来源。

侧栏保持挂载并在隐藏时 inert，侧栏外中文按钮与菜单/`⌘B` 使用同一命令；隐藏前树或分隔线焦点转至外部按钮且 preventScroll，不主动移动正文焦点。最终补充冻结状态下晚 resize 回调的 guard，不让退出冻结后回执制造新的布局意图。

作者首次全量 704 通过 / 0 失败 / 17846 断言 / 115 文件，13.48 秒（`/tmp/agentic-sidebar-tests.log`）；该全量在最后 late-resize guard 前执行。最终定向 30 项 / 166 断言 / 7 文件通过，typecheck、16 文件 scoped ESLint 与 diff 检查通过。独立 Spec、Standards 各复跑 19 项 / 71 断言 / 5 文件，两轴代码复核 0 阻断，不等于窗口验收。

实施中曾发现 zoom 更新误取消 sidebarTimer，已修并通过定时并发回归；Canonical helper 首次 async 改变微任务行为导致旧测试失败，调整为无 hook 时保留原 Promise 后通过。保留这些失败历史，不把较早全量冒充最终源码全量。

主线已开始 alpha.77 构建，尚无成功产物或真实 WK 结果；显隐/拖动/clamp、焦点、重启与树及解析保持仍待真实验证。离线最终人工、父功能余项保持开放，无本轮 Git。

### alpha.77 构建与宽度记忆失败（2026-10-04）

构建 exit 0，plist / manifest 版本核对为 alpha.77，hash `3gddx61jjsk5j`，包目录 `/tmp/agentic-markdown-alpha77.mVan8p`，PID `26305`；本轮隔离 App 数据目录 `/tmp/agentic-sidebar-layout-data.cPxLT0`。包内 Bun 704 项 / 17847 断言 / 115 文件、14.29 秒通过，记录实际断言数，不与先前源码数字抹平。完整 lint 首次与构建并发时扫描临时 `.cottontail-tmp` 出现 5 errors / 1 warning，构建结束后重跑通过。

真实 WK 右方向键调分隔线，显示宽度由 20.016 变为 25.016，但 `window.json` 仍保存旧 256px，隐藏再显示回到 20.016；宽度记忆失败已交 executor 修复，alpha.77 不可验收，不据此提前断定修复原因。

已取得的局部证据：根甲 `normal.md` 打开 22 bytes、请求 38 ms（单样本），粘贴“侧栏状态验收”后为 dirty 阅读，revision 1 / 2 顶层块 / request 1。树选择保持，经按钮、`⌘B` 和“视图→切换侧栏”显隐，dirty 正文、模式及 revision / request 1 保持。Option-Tab 实际聚焦加入文件夹后，`⌘B` 隐藏将焦点转至外部“显示文件树”按钮；隐藏时 AX 无树及 splitter。未实测 root generation，不将这些观察扩大为该字段不变证据；重启、clamp、主题尚未验证，继续修复与代验，无 Git。

### 宽度回调修正与 alpha.78 待复验（2026-10-04）

已安装库实现中，`onLayoutChanged` 同步回调早于 DOM commit，此时 `getSize().inPixels` 读取旧 offsetWidth，导致实际比例改变但保存旧像素值。修正使用稳定 sidebar panel ID、回调携带的当前 layout 百分比，乘两 panel 像素总量（排除 separator）；不将原因误写为 ref 闭包或磁盘延迟。单位边界等定向 10 项 / 40 断言 / 3 文件通过，作者 typecheck / scoped lint 通过，独立 verifier 同样 10 项 / 40 断言 / 3 文件复跑且 0 阻断。alpha.78 构建中，尚未 WK 复验，不记修复验收通过。

alpha.77 另实操 `⌘Q` 后继续编辑取消：dirty、树和模式保留，但解析 request 从 1 变为 6。独立源码核对 `9f26ab0` 基线已有 frozen 时取消派生解析、解冻后重新请求的语义，不归因本片。这里“不触发重新解析”只约束显隐、主动调宽与临时 clamp 等布局操作，不涵盖退出/重载保护流程。最后切编辑 Undo 恢复 clean，`⌘Q` 后精确路径 pgrep exit 1，normal.md 原 SHA 保留。无整体验收或 Git。

### alpha.78 宽度记忆复验与恢复夹取失败（2026-10-04）

构建 exit 0，plist / manifest 核对 alpha.78，hash `2v8djvpb298ig`，包目录 `/tmp/agentic-markdown-alpha78.3hPTl0`，PID `27623`。包内 Bun 705 项 / 17852 断言 / 115 文件、13.16 秒通过；完整 typecheck、lint、docs/obligations、lockfile、diff 检查通过。CUA 首次 pipe closed，间隔 20 秒重试恢复，不归因产品性能。

真实 WK Right 将比例从 20.016 调至 25.016，存储 `319.95464`；隐藏再以 Space 显示后仍为 25.016，前述主动宽度记忆路径复验通过。指针拖动暂未观察到可见变化，不写成拖动已通过。

原生 AX zoom 将窗口从 1280 扩至 1512 时保持约 319.95px；End 主动调至最大 57.644% / `871.00084`，存储同步。窗口回到 1280 时暂时夹取为 49.961% / 约 639px，存储仍保留 871px；再次扩大至 1512 却停留 42.356% / 约 640px，没有自动恢复 871px，隐藏再 Space 显示后才恢复 57.644%。该恢复夹取失败已交 executor 修第二处时序问题，本片尚未通过，无 Git。

alpha.78 隐藏后立即 `⌘Q` 已正常退出，精确包路径 pgrep exit 1；存储为 visible=false、expandedWidth=`871.00084`，下版仍须验证启动恢复。源码显示 Panel 约束重注册可能触发 Group 后续提交，使父 layout effect 的 resize 早于新约束就绪，这是当前根因候选而非独立真实时序证明。已按上述批准路线落可取消 rAF 与受控 scheduler 测试，尚未新版 WK 验证，不记修复验收通过。

### alpha.79 恢复成功与 Home 焦点待修（2026-10-04）

构建 exit 0，plist / manifest 为 alpha.79，hash `ghyj34lhvao2`，包目录 `/tmp/agentic-markdown-alpha79.i9J3Mu`，PID `28794`。包内 Bun 706 项 / 17856 断言 / 115 文件、13.11 秒通过；rAF 修正定向 11 项 / 45 断言及类型/lint/diff 检查通过。

真实重启恢复 hidden，无根或文档；在 1512 宽展开为 57.644%，zoom 至 1280 为 49.961%，再至 1512 自动恢复 57.644%，窗口变宽恢复路径已实证。另一次隐藏后 zoom 1280 并在同一调用展开，AX 报 0，但独立截图侧栏实际约 639px，下一次 zoom 为 57.644%；ARIA 值仍待复核，不猜根因、不为此盲改或 key remount。

Home 收起时焦点落到 HTML，已获主线批准最小修正：当前 layout 宽 0 且 guard 允许时，先把 separator 当前焦点转至外部 toggle（preventScroll）再提交 hidden，非 0 或正文焦点不改。新增单测后 8 项 / 32 断言、typecheck/scoped lint/diff 检查通过，待下一 alpha.80 真实复验。

浅色、深色及跟随当前系统深色的真实截图中控件可辨，未改变 OS 外观，固定深色已恢复。Left 7 次主动宽度为 `342.15084`，`⌘Q` 正常退出且精确路径 pgrep exit 1。指针拖动仍缺实证，不宣称全部通过；历史失败保留，无 Git。

### alpha.80 焦点修复与分隔线映射缺陷（2026-10-04）

构建 exit 0，plist / manifest 为 alpha.80，hash `1wv3hprq2ct8b`，包目录 `/tmp/agentic-markdown-alpha80.2U3XBX`，PID `29632`；包内 Bun 707 项 / 17859 断言 / 115 文件、14.39 秒通过，完整 lint、typecheck、docs/obligations、lockfile、diff 均通过。真实 Home 收起后焦点到外部按钮，Space 恢复 22.644%，该修复路径通过。

隐藏期间 zoom 后展开，实际宽约 639px 而 AX 为 0 再次出现；重新聚焦并按 Left 也无响应，因此不能仅解释为 AX 缓存。Executor 源码定位：隐藏且 disabled 的 separator 在 Group 约束重注册时被排除出 mapping，展开只 updateProps、未重建 mapping。主线同意最小路线：将 disabled 控制移至 Group 公开 API，separator 保持 hidden/inert/不可 Tab 聚焦；独立复核进行中，尚未新版实际验证，不提前认定修复通过。无本片验收或 Git。

### alpha.81 映射修复与状态保持复验（2026-10-04）

实际采用 Group 公开 disabled 控制 hidden/frozen，使变化重新注册；Separator 不设 disabled，仍 hidden/inert/display:none。无 key remount、手改 ARIA 或私改依赖。静态接线契约测试仅防误接，不冒充 DOM 验证。

构建 exit 0，plist / manifest 为 alpha.81，hash `3kf2gmpjy9yry`，包目录 `/tmp/agentic-markdown-alpha81.ursBme`，首次 PID `30588`。包内 Bun 708 项 / 17862 断言 / 115 文件、13.81 秒通过；完整 lint、typecheck、docs/obligations、lockfile、diff 通过。真实 hidden 启动→展开 49.961%→Left 44.961%；放大至 1512、End 57.644%→隐藏→单独 zoom 1280→`⌘B` 展开 49.961%→Left 44.961%，映射修复路径已通过。指针拖动仍未观察到变化，不归因工具或代码，也不宣称已通过。

根甲 normal（22 bytes、单样本请求 40 ms）追加“最终布局验收”后 dirty 阅读 revision 1 / request 1，Left 调宽及显隐保持 dirty、模式与 request 1。开启隐藏项、双击展开 `.secret` 后显隐，选中及展开分支/nested 保留，request 1 仍在。回编辑 Undo 最终 clean；选择普通文档文本后 `⌘B` 隐藏/展开，选区保持。

菜单重载后 hidden 恢复，展开为 39.961%；后端根仍在但标签清空，是原 native 进程存活时的重载，不是新进程授权恢复。最终隐藏后立即 `⌘Q` 正常退出，精确路径 pgrep exit 1，存储 visible=false、expandedWidth=`511.10119`。normal.md SHA 与原 `c205…645ce` 基线相同，无正文保存。二次启动 PID `30986` 验证进行中，本片仍未整体验收；离线留最终人工，无 Git。

二次启动 PID `30986` 已实际确认：初始侧栏 collapsed，欢迎页无根、无文档，新进程没有恢复授权；点击“显示文件树”后 splitter 为 39.961% / 约 511px、树为空，已保存宽度恢复。独立最终代码复核 0 阻断，但指针拖动仍待确认，整片不通过、不提交。当前包保留运行供后续拖动确认，不关闭应用；下一不依赖本片的功能仅调查，尚未启动。指针缺口不冒用离线延期授权。

后续指针补查：alpha.81 第二进程仍运行，主线尝试 Retina 半尺寸坐标 drag `[511,350] → [611,350]`，首次遇到 Sky pipe closed；等待 20 秒后重连成功，再试后 AX splitter 仍为 39.961%。未确认实际拖动效果，不归因工具或应用，也不把坐标尝试本身当作应用缺陷；指针仍未验收。

### 非离线本片验收结论（2026-10-05）

用户明确回复“分割线验证通过。请继续”，补齐此前唯一开放的非离线指针拖动验收。该项记为用户人工验收；此前显隐、键盘调宽、临时夹取、状态保持和新进程布局恢复仍记为受托 Agent 实操，不补造用户逐项操作、坐标或测量值，也不改写此前工具未取得指针证据的历史。

本片非离线范围通过。当前提供的 alpha.82 组合包包含本片布局实现和已代验的 F-027a，用户未另外报告版本号，不将其回复扩写成独立版本核对。指针待验造成的组合 Git 暂缓原因现已解除；主线仍须检查相关差异、提交、推送并核验远端，不预写 Git 成功。

F-026b-offline-final 仍未执行、留最终统一人工，不断网。父 F-026 及根授权/会话恢复、副区、多窗口等后续范围保持开放，本片无主承接义务，不以本次通过关闭完整父功能。

2026-10-05 主线收尾复跑：`bun test` 720 pass / 0 fail / 18855 assertions，117 个文件、14.83 秒；typecheck、lint、check:feature-docs（含 obligations）、check:lockfile 及 diff 检查通过。本次为当前源码复查，不替代此前包内测试或窗口实操；未改代码版本、未重新构建，独立最终复核及 Git 由主线另行核验。

### Git 实际核验（2026-10-05）

主线已将 F-026b/F-027a 已验组合提交并推送 `ef1768d2cbde5b85027c54d7cac8d584924ea811`，以 ls-remote 核验远端 main 同 SHA。当时仍有下一片 F-028a 草案未跟踪，不宣称全工作树干净；本段覆盖此前待 Git 状态，不改写验收执行者、离线待验、失败或未实操边界。
