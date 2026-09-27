# F-012h：非活动编辑派生解析缓存回收

## 当前总体验收结论（2026-09-27）

用户明确确认：“如果是 CommonMark 允许的语法，那么忽略我的问题。其他验收通过。”据此本批 F-012f / F-018c / F-012g / F-012h 均转为本片范围已验收。保留 CommonMark 引用无需空格的解析行为；不采用此前针对此问题的 A/B 修改提议，不新增源码改动。

此为用户总体确认，不补造逐项深色、IME、启动或其他动作，不宣称 Agent 已启动 alpha.29。下方构建、自动验证、窗口观察及当时未启动/待复验状态保留为历史证据，由本结论覆盖当前待验收状态。OBL-003 / OBL-012 / OBL-020 / OBL-041 / OBL-068 只认可本片实现范围，完整调度、缓存预算、未来命令/消费者、完整长行能力等余项继续开放；父 F-012 / F-018 未完成。批次授权结束，下一轮由用户选择；本次未修改代码/版本、未构建、未提交或推送。

### alpha.27 真实窗口补充（2026-09-27，Agent 验证）

- 打开 `03-threshold.markdown` 时保护提示可见；一次 Backspace 删除一个 x 后，完整窗口可访问文本确认提示消失、文档为未保存；`⌘Z` 后提示恢复，并回到与已保存基线一致的状态。
- 末尾粘贴换行及 `B27_SELECTION` 后选择该文本，实际切换到 `01-quotes-rules.md` 再返回，正文与未保存状态保留；截图中原末尾灰色选区部分可见，但没有精确选区坐标的窗口测量证据，不扩大声明。
- `⌘Z` 回基线，`⌘⇧Z` 后 `⌘S`，磁盘尾部实际含 `B27_SELECTION`；再 `⌘Z` 与 `⌘S` 清理。使用 `Buffer.from(arrayBuffer).toString("utf8")` 保留 BOM 解码后与原 fixture 整串严格相等，含 BOM、CRLF 2 / LF 2、10,000 个 x、末尾无换行，样本保持干净。首次 `Bun.file.text()` 比较因解码剥离 BOM 不等，随后字节保留核验为 true，不将验证方式差异判为生产问题。
- 原生文件选择器自动化曾一次等待 120 秒超时，随后确认窗口已成功读取；工具等待不作应用性能数据。真实 IME、深色与完整滚动手感仍留人工。以上是 Agent 当前窗口证据，不代表用户验收，不自动勾选清单项。

### alpha.27 集中交付（2026-09-27）

- `AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary` 成功，归档核对 `0.1.0-alpha.27` / hash `1hvqb5z2s5a5d` / canary；未签名。解包 `/private/tmp/agentic-markdown-batch27.DK5xd6/Agentic Markdown-canary.app`；安装包 `apps/desktop/artifacts/canary-macos-arm64-AgenticMarkdown-canary.dmg`。
- 本机首次全量 473 pass / 1 fail，既有 write-capability 权限刷新测试失败、原因未定位；定向 6 pass / 39 断言及完整重跑 474 pass / 3694 断言 / 72 文件（2.44 秒）通过，包内 Bun 同为 474 pass（2.40 秒）。Lint、类型、功能文档/承接、锁文件及差异检查通过，不将重跑通过解释为原因已修复。
- 独立复核完成：f/h 规格及 c/g 独立验证分别进行，不自审批准。长行不同保护区间父节点误裁剪已修正，四类父节点、完整/中间视口回归通过。
- 正常新包已启动，浅色引用竖线/激活恢复与三种分隔线已观察，代码/HTML 原文保持；其他窗口流程以主任务后续实测追加为准，不冒充用户验收。统一使用[集中验收清单](2026-09-27-l2-batch-acceptance.md)。本片待人工验收，父功能与后续责任开放；未提交或推送。

> 状态：已验收
> 日期：2026-09-27
> 用户授权按推荐顺序开发 L2 并集中验收；本片位于 F-012f → F-018c → F-012g 之后的逻辑顺序，不授权 Git 操作。

<!-- obligations: OBL-020 -->
<!-- deferred-obligations: OBL-012, OBL-041, OBL-068 -->

## 1. 功能说明

- 当前单活动文档架构中，只有活动文档保留 Markdown 解析状态；非活动标签移除可重建解析树/上下文，重新激活时按原文恢复解析。此策略为活动至多 1 份、非活动 0 份语言解析缓存，不是字节配额或系统内存释放承诺。
- 文档原文、BOM/换行、选区、撤销历史、dirty、buffer revision、滚动快照及各文档编辑/源码模式保持；安全源码不恢复解析或解除隔离。保存捕获和回执不能因切换而被替换。
- 首次重新激活可能重新解析；不冻结数值性能门槛，不引入内容截断、自动关闭标签或历史淘汰。完整分类预算、LRU/成本淘汰、后续多区域消费者仍待后续设计。

## 2. 最小技术方案

- parserLanguage 专属 pause/resume effect 仅 reconfigure 语言 compartment；不复用会改变模式的 safeSourceEffects。使用本地 CodeMirror 官方 Language/Compartment API；移除语言后 syntaxTree 返回空树、语言 facet 为空，旧 View 销毁沿用 CM parse worker 的 destroy 取消机制。
- controller publish 比较旧/新活动 documentId，仅暂停旧活动、恢复新活动；同一活动每键更新不扫描整个 Map。打开、关闭、重复选择与重读均走现有 publish 流程；控制器不分发这些缓存 effect 到即将销毁的旧 View。
- pause/resume 只更新 EditorState、不增加正文 revision、不入历史。旧 View 延迟事务须通过原有 startState 身份检查，不能把旧解析状态写回；safe source 无解析不恢复，fault session 保持。
- OBL-020 本片只承接非活动编辑派生缓存策略，未来全局/分类/字节预算仍开放；OBL-012 完整解析调度、OBL-041 完整命令及 OBL-068 外观后续明确延期，不关闭父功能。

## 3. 继承约束检查

- F-002：仅本地内存派生状态，不触盘/网络，正常文档边界及原文唯一真源不变。
- 中文与外观：不改变主题或文字，重新激活恢复原模式；真实 IME 仍由既有 composition 离开保护控制，合成测试不代替操作系统输入法。
- 命令与键盘：无新命令，既有标签切换入口与可用性保持；保存/冻结期间行为不放宽。
- 安全与日志：安全源码持续隔离；不新增原文/路径日志、不报告未测的 GC 字节；旧回调失配拒绝。

## 4. 最小 happy path

1. 打开多个文档，编辑并保留选区/撤销历史，切换标签；只有活动文档有语言解析，返回恢复相同模式与原文、dirty 和 revision。
2. 源码、安全源码、只读、关闭邻居、重读、重复切换及保存进行中切换保持状态和保存捕获；旧 View 事务不覆盖新状态。
3. 自动比较实现前后实际 language facet 与 syntaxTree，记录真实结果；构建后中文候选、滚动与快速切换手感交人工，不把单元测试视为验收。

## 5. 实施与验证记录

- 2026-09-27 实现前真实 controller probe：连续打开三个 `# doc N` 文档，活动/非活动三份 state 的 language 均存在、syntaxTree.length 均为 7，确认非活动树仍保留。
- 查阅本地 `@codemirror/language@6.12.4`：syntaxTree 在无 language state 时返回空树，parse worker destroy 取消已调度工作。只据源码确认机制，不声称已实测 OS 内存下降。

### 实施与自动验证

- parserLanguage 新增独立暂停/恢复 effect，controller publish 在活动 ID 改变时只更新旧/新两个槽；同一 ID 的正文更新、通知和保存回执不扫描所有标签或重新配置语言。安全源码始终保持无解析，非活动状态只释放解析派生，不释放原文/历史等权威数据。
- 真实 controller 回归：三标签变为 language `[false, false, true]`、前两份 syntaxTree.length 为 0；恢复后活动树覆盖当前全文，重复切换保持原文、选区对象、历史深度、revision、fault session、dirty、源码模式。拒绝暂停前创建的旧事务，保存进行中切换及非活动保存回执均不重建解析；只读/重读/关闭邻居/重复选择与 composition 离开保护通过。
- 原有两项测试要求整个 EditorState 在切换后对象恒等；本片重配置生成新 state，现改为原 doc/selection 对象恒等并从 controller 最新 state 撤销，历史结果保持；不放宽保存和权限断言。新保存测试首次构造了不符合现有无正文 mirror 回执协议的 mock，修正 mock 后通过，生产保存逻辑未改。
- `bun test apps/desktop/src/client/inactive-parser-cache.test.ts apps/desktop/src/client/documents.test.ts`：25 pass / 0 fail、282 断言。共享工作区当时 `bun test`：473 pass / 0 fail、3674 断言、72 文件，2.60 秒（含并行批次新增测试，不全部归本片）。`bun run typecheck`、四份本片修改源码的 ESLint/Prettier、`bun run check:obligations` 和 `git diff --check` 通过。
- 当前实现和自动验证完成，待独立复核、批次构建与集中人工验收；未测 GC 字节、真实 View 销毁时序或真实 IME，不将树引用移除等同系统立即释放内存。未修改版本、打包、提交或推送。
