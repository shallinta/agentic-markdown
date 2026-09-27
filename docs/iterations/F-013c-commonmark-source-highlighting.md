# F-013c：CommonMark 源码颜色高亮补齐

> 状态：2026-09-27 用户验收通过（alpha.32，本切片范围）
> 日期：2026-09-27

## 2026-09-27 最终交付 alpha.32

2026-09-27 用户明确确认“A 验收通过”。本片按用户总体确认关闭人工验收，不补造浅深色、IME、选区或保存的逐项实际动作；历史自动与窗口证据边界不变。OBL-069 仅本片颜色范围通过，未来扩展外观与 OBL-070 仍开放，父 F-013 未完成。本次文档收尾不授权 Git。

- alpha.31 后仅格式调整，依规则递增并重新构建 alpha.32（hash `7d00qowzqtv4`），最终路径 `/private/tmp/agentic-markdown-batch32.lKGi3Y/Agentic Markdown-canary.app`。构建、归档核对、Lint/typecheck 通过，包内 Bun 487 项 / 3831 断言 / 75 文件，2.60 秒。
- 新包系统 WebView 隔离实验正常退出 0，[alpha.32 报告](evidence/2026-09-27-alpha32-editor-view-report.json) 7/7 成功；B dispatch 2–22ms、双帧机会 23–34ms、原文/撤销一致和坐标偏差 0；C 实际 1200ms、双方 pending、正对照 2037 次 / 13ms、销毁后 0 次、重建原文/选区/历史一致。均为有限合成观测，不证明真实输入、绘制或完整生产性能。
- 本片已获上述用户总体验收，无 Git 操作。下方 alpha.31 结果保留历史，不改标为 alpha.32；alpha.31 当时其他切片取消未命中运行期的记录不变，后续 alpha.32 已实际完成 B/C 取消与重跑，见集中清单。

## 2026-09-27 alpha.31 历史批次证据（下方为当时状态）

- 最终交付 alpha.31（hash `1vguffajb6upe`）；`AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary` 成功并核对归档版本。alpha.30 曾构建成功，后因报告提交后取消提示修正而被 alpha.31 替代。
- `bun test` 本机 487 pass / 3831 断言 / 75 文件，2.87 秒；包内 Bun 1.4.0 同样 487 / 3831，2.35 秒；typecheck 通过。Lint 首次与构建并发扫描临时 `.cottontail-tmp` 失败，构建结束后重跑通过。独立规格/规范复核无剩余问题。
- [集中人工验收清单](2026-09-27-l2-followup-acceptance.md) 包含最终包路径、复验步骤和证据限制。仅进入待人工验收，不关闭父功能或开放 OBL，无 Git 操作。
- 源码映射和状态保真已有自动证据；浅深/系统主题对比度、真实 IME 与人工编辑手感仍待验收，不以 B/C 的合成实验代替。
> 用户授权推荐 A → B → C → D 批量推进人工验收；本片为 A，不授权提交、推送或发布。

<!-- obligations: OBL-069 -->
<!-- deferred-obligations: OBL-070 -->

## 1. 功能说明

- 源码模式仍是纯 Markdown 代码编辑器：统一等宽、字号和常规字重；仅颜色，不增加粗体、斜体、下划线、行内背景或布局。文本源标记始终保留。
- 补齐当前 CommonMark parser 已提供的节点颜色映射：HorizontalRule、Escape、Entity、CodeInfo，以及核实遗漏的注释、引用/列表正文、普通正文、链接定义标签和标题。前景与次级文字色只使用已有主题 token，不新增主题色。
- Heading/strong/emphasis/link/URL/正文/引用/列表保持前景色；语法标记、代码文本、水平分隔线、转义、实体、代码语言/链接标签、注释采用次级色；链接标题采用前景色。纯 HTML 标签/块在官方默认没有独立 tag，仍原样继承前景色，不引入 HTML 子解析器或宣称 HTML 语言细分高亮。
- 不改变编辑模式排版或安全源码隔离，不执行 HTML/资源/网络请求；BOM、混合行尾、选区、历史、dirty/revision、保存和 IME 边界不变。

## 2. 最小技术方案

- 核实本地 `@lezer/markdown` README 与官方 `markdownHighlighting` styleTags：contentSeparator/escape/character/labelName/comment/quote/list/content/string 等 tags 已随现有 CommonMark 树提供；仅扩展 sourceHighlightStyle，不替换 parser 或重建文档状态。
- 通过真实 parser 节点和 highlightTree + 当前 state 的 highlightingFor 回调验证实际高亮范围；不能只验证 tags 注册。编辑模式无源码高亮扩展，安全源码没有 parser/highlighter，均不得误启用本片颜色规则。
- 现有 Compartment 保持模式切换、暂停恢复与故障隔离；样式仅使用 `var(--foreground)` / `var(--muted-foreground)`，主题切换无需重解析。
- OBL-069 仅本片当前 CommonMark 颜色范围，未来扩展/主题消费者保持开放；OBL-070 后续命令仍延期，不关闭父 F-013 / F-042。

## 3. 继承约束检查

- F-002：离线、纯视图颜色，不改磁盘/保存、1 MiB 正常边界和原文唯一真源；自动核对 BOM/混合行尾、历史和源码原串。
- 中文与外观：中文/emoji 原样；仅已有浅深/系统 token，颜色对比度留真实窗口检查，不把无 DOM 测试等同人工验收。
- 命令与键盘：无新入口，继续仅快捷键切换源码；不改已有只读/中文候选门禁，不新增按钮或命令面板项目。
- 安全与日志：HTML/URL/实体仅作为源码高亮，不渲染、不读取资源、不执行代码，不记录用户正文或路径。

## 4. 最小 happy path

1. 打开包含标题、引用、列表、水平线、转义、实体、围栏语言、链接定义/标题、注释及原始 HTML 的样本，快捷键进入源码：标记完整可编辑，颜色区分但字号/字重一致。
2. 编辑/源码往返、选择、修改/撤销/重做，BOM/混合行尾和未保存状态保持；编辑模式原排版不受影响，安全源码仍隔离。
3. 自动测试实际树高亮范围、只颜色约束和状态保真；构建后浅深/系统主题及真实中文候选手感留人工确认。

## 5. 实施与验证记录

2026-09-27：先核实官方本地 tag 映射，再记录本批最小方案；尚未实现、构建或人工验收。

### 实施与自动验证

- 仅扩展 `editor-mode.ts` 的 sourceHighlightStyle tags；未改变解析器、正文或入口。新测试对 12 类实际 CommonMark 节点和当前模式高亮范围作断言，覆盖用户指出四类及额外漏项；同时验证仅 color 属性、HTML 原文、编辑/源码/安全源码隔离、BOM/混合行尾、选区与历史。没有 HTML/代码子语言解释器，没有真实 IME 新证据。
- `bun test apps/desktop/src/client/commonmark-source-highlighting.test.ts apps/desktop/src/client/editor-mode.test.ts`：5 pass / 0 fail、92 断言；本机全量 `bun test`：481 pass / 0 fail、3764 断言、73 文件，3.09 秒。
- `bun run typecheck`、本片三份源码/脚本 ESLint、Prettier 与 `git diff --check` 通过。新增迭代后 `check:obligations` 首次因 OBL-069 缺本片反向登记失败，交公共文档作者同步，不修改或关闭整体责任。
- `bun scripts/create-f013c-fixtures.ts` 生成一次性样本 `/var/folders/jy/rh9p8thj3t32m4pwhk38jydc0000gn/T/agentic-markdown-f013c-wCa9Qd`，01 含全部本片语法，02 含 BOM/混合换行。仅临时文件，不覆盖旧样本。
- 本片代码已完成，待独立审核、批次构建与人工验收；未修改版本、打包或 Git，未宣称颜色对比度/真实窗口已经通过。
