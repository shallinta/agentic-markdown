# F-018f：超长行软换行与 token 高亮保护

> 状态：2026-09-28 用户总体验收通过（alpha.33，本切片范围）
> 日期：2026-09-27

## 2026-09-28 人工验收结论

用户明确确认“验收通过”，本片随 alpha.33 批次获总体验收。此结论不补造浅深外观、粘贴、IME、原生入口或延迟竞态等逐项亲验；下方 2026-09-27 实现、测试、窗口操作与未实测范围保留为当时证据，其中“待验收”是历史状态。父功能与本片主承接义务的完整余项及未来消费者保持开放；长行密集 200k 合成 dispatch 128/125ms 性能余项不因验收关闭。批次授权结束，下一轮由用户选择；本次仅文档收尾，无代码/版本/构建或 Git 操作。

<!-- obligations: OBL-003 -->
<!-- deferred-obligations: none -->

## 功能说明与边界

2026-09-27 路线确认：用户确认继续保留现有软换行并开始实施源码局部 token 保护。以下调查与候选记录保留历史；本轮落实公开 API 高亮器，不实施逐行 nowrap，不改变 parser。实现后由主任务完成真实窗口验证、打包与集中验收。

用户授权本批按 A → B → C → D 推进至集中人工验收，本片 A 调查当前长行自有装饰保护之外的软换行与 token（语法着色片段）成本。普通文件仍限 1 MiB，不修改 Markdown 语义、原文、保存协议或全局软换行，不 fork（维护依赖分支）CodeMirror。OBL-003 仅本片局部承接，未实施部分继续开放，不因调查完成关闭父 F-018。

## 本地官方依赖调查

已读取当前安装的 `@codemirror/view` 6.43.12、`@codemirror/language` 6.12.4 官方发布源码及公开类型，不以外部旧版本资料推断：

- `apps/desktop/node_modules/@codemirror/view/dist/index.js`：5374–5425 的 HeightOracle 只保存一个全局 `lineWrapping`；6333 起从 `contentDOM` 的 computed `whiteSpace` 取值；6506 起长行 gaps 同样按这一全局值决定垂直或水平占位。公开 `EditorView.lineWrapping` 是编辑器级扩展，没有逐物理行参数。
- `Decoration.line` 可以设置某一行的 DOM 属性，但仅给一行 CSS `white-space: pre` 并不会同步上述全局高度估算、长行 gaps 与坐标分支。源码不足以保证混合软换行安全，不能将 CSS 外观看似成功当成生产方案；本片不这样实现。
- `apps/desktop/node_modules/@codemirror/language/dist/index.js`：1727 起 `syntaxHighlighting` 安装私有 TreeHighlighter；1764–1800 按 `visibleRanges` 调用公开 `highlightTree`。标准 Highlighter 的 style 回调只接 tags，不接文档位置，无法直接根据物理行长度局部禁用。
- 当前 App 仅源码模式安装 `syntaxHighlighting(sourceHighlightStyle)`；编辑模式使用自有 livePresentation，并已在 F-018c 裁剪受保护行装饰。当前保护不等于跳过解析器，也不能由 CSS 去色声称省去 token 构建。

## 候选最小技术方案（未实施）

1. 逐行取消软换行保持未解决：继续已有全局软换行与 CM 长行 gaps，不引入 fork 或全局 nowrap。
2. 若确认缩小到源码局部 token 保护，可用公开 `ViewPlugin`、`syntaxTree`、`highlightTree`、`Decoration.mark` 和原 `HighlightStyle` 构造有界高亮器：仅对可见范围减去既有长行保护区间后调用 highlightTree，保留普通范围颜色；不再同时安装内置高亮器，避免先构造再遮盖。须注册原样式模块，不修改语法树或解析调度。
3. 在真实 WebView 对密集强调、链接、实体长行与普通邻行验证源码/编辑切换、选区定位、编辑撤销与保真；数值只报告测量，不设预期门槛。F-018d 的纯 x 长行结果不能替代本片密集 token 验证。
4. 上述自有源码高亮器是一项技术候选，交主任务评估是否需要用户确认；在确认前不修改生产源码，不将本片记为实现完成。

## 继承约束检查

- F-002：调查仅读本地依赖；后续只操作临时合成文件，生产 1 MiB 与原文唯一真源不变。
- 中文与外观：后续若改变提示须中文，源码保持纯代码字体和既有浅深颜色；真实主题/选区可辨性需窗口检查，不用状态测试代替。
- 命令与键盘：不新增鼠标专属入口，继续既有模式快捷键与编辑命令；候选期间保护不变。
- 安全与日志：不执行文档内容、不请求资源，不打印正文、真实路径或原始异常；测量仅固定合成样本的标量。

## 最小 happy path（候选方案获确认后执行）

1. 普通范围高亮与现有实现等价，长行 token 标记跳过而普通邻行不丢失。
2. 增删跨越保护边界后可恢复颜色，原文、BOM/行尾、选区及撤销保持。
3. 编辑/源码/安全源码切换无旧插件残留；安全源码仍不解析、不高亮。
4. 真实密集 token 视图可编辑、撤销与定位；软换行仍原样，未知项如实保留。

## 当前验证记录

本次仅完成依赖源码与现有实现只读调查，并建立唯一迭代文档；无源码修改、测试、构建、版本递增或人工验收。后续实施与真实结果必须另行追加，不预填通过。

## 已确认路线实施（2026-09-27）

本节覆盖上方调查时的待确认/未实施状态，保留其历史。现已新增 `source-highlighting.ts`，在源码模式用公开 ViewPlugin 与 highlightTree 生成颜色标记，先把可见范围减去既有长行保护区间，再遍历语法树；保护行内不调用 highlighter。普通范围继续使用原 sourceHighlightStyle，注册其样式模块，不再安装内置 TreeHighlighter，不做 CSS 遮色。文档变化、视口变化、重配置、解析树发布和保护区间变化均重建当前标记，不映射旧保护边界颜色。编辑模式继续现有呈现；安全源码仍通过原 compartment 移除语言和呈现；软换行、parser、原文与保存协议未改。

- 自动回归：普通范围与官方同树同视口 highlightTree 完全一致；整段保护范围 highlighter 调用 0 次；普通首尾邻行仍有颜色；跨越 10,000 单位阈值后撤销，BOM/混合行尾保持、标记恢复；部分树与完整树的结果替换。辅助函数测试不冒充真实 View 更新测试。
- `bun test apps/desktop/src/client/source-highlighting.test.ts apps/desktop/src/client/commonmark-source-highlighting.test.ts apps/desktop/src/client/editor-mode.test.ts`：9 pass、112 断言。既有 mode 测试改验实际颜色构造，并明确内置高亮 facet 缺席；不是将已有颜色断言删掉。
- 局部 ESLint 首次因 import 顺序及测试读取 any spec 等失败，已修正后通过；Prettier 已格式化。第一次 typecheck（基本实现时）通过，后次被并行 probe 测试使用 ES2022 `.at` 阻断，已报告主任务，不改项目 lib 来掩盖。
- 当次共享工作区 `bun test`：501 pass、4043 断言、77 文件，3.14 秒；包含其他作者并行新增测试，不全归属本片。`git diff --check` 通过。
- `bun scripts/create-f018f-fixtures.ts` 生成一次性目录 `/var/folders/jy/rh9p8thj3t32m4pwhk38jydc0000gn/T/agentic-markdown-f018f-cESZcJ`，包含 9999 / 10000 / 50000 / 200000 单位密集 token 长行、中文普通邻行、BOM/混合行尾。只创建临时样本，不覆盖用户文件。
- 主任务另已接入源码保护提示，并扩展隔离真实 View 探针为普通 x / 密集 token 两类 × 三长度 × 两模式。当前仅接线/自动测试，最终真实报告、版本、构建及人工验收由主任务追加，不预记成功。

当前实现待独立复核与实际新包验证；逐行取消软换行明确未实施，OBL-003 / 父功能未关闭，无 Git 操作。

主任务修正并行 probe 测试的 `.at` 后，`bun run typecheck` 及本片六个源码/脚本文件 ESLint 最终重跑均通过。A 作者冻结源码，后续由独立规格/规范复核与真实窗口验证接续。

## alpha.33 构建与真实 WebView 证据

主任务已执行 `AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary`，构建成功并核对 `0.1.0-alpha.33` / hash `1il49blgh1a9z`。最终共享工作区全量测试 529 pass / 4630 断言 / 79 文件，3.33 秒；这包含本批 B/C/D，不全部归于本片。

[alpha.33 实际报告](evidence/2026-09-27-alpha33-dense-view-report.json) 来自真实系统 WKWebView：普通 x / 密集 token × 10k、50k、200k × 编辑/源码，共 12 行，另有既有解析生命周期复验 1 行，合计 13/13 正确性断言成功。12 行均 `rawMatches=1`、`undoMatches=1`、坐标往返偏差 0、`wrappingEnabled=1`；6 行源码的 `protectedColorMarks=0`，编辑模式该指标为 null，不冒充源码颜色测量。此为实验 View 的 DOM/状态观测，未逐项亲验普通编辑窗口外观或阈值恢复。

密集 200,000 单位长行同步 dispatch：编辑模式 128ms、源码模式 125ms。该耗时仍明显存在，不能把无颜色标记或正确性通过宣称为完整性能问题已解决；原文更新、解析等剩余成本未由此探针分解，也不推定瓶颈归属。dispatch 是程序派发事务，不是自然键盘/IME 延迟；双帧回调不等于屏幕绘制完成。本片不设数值门禁，不据本次数据修改生产上限或软换行。

本片进入集中人工验收；普通窗口的浅深可辨、边界删字/撤销恢复及实际编辑体验留用户清单。完整性能保护与 OBL-003 继续开放；未提交或推送。
