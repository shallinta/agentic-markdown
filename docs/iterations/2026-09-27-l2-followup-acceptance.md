# L2 补证批次集中人工验收（2026-09-27）

当前状态：2026-09-27 本批切片范围验收结束。A 由用户确认通过；B/C/D 按用户授权由 Agent 代验通过，其中 B/C 已补齐真实运行中取消和重跑，D 仅有边界研究范围。受托代验不等于用户逐项亲验，不等于全部 L2 或父功能完成。本文汇集清单，不替代四份唯一迭代记录。

## 2026-09-27 最终受托代验结果

用户确认“已退出”后，Agent 在隔离数据目录 `/private/tmp/agentic-markdown-accept32.EWtGUD` 操作 alpha.32：

- 实际点击运行，再在 C 进行中取消，页面显示“已取消；未完成项目不表示成功”，临时报告“尚未生成”。B 六行已完成，C 为 cancelled、未完成测量为空（双方 pending 为 1），没有伪记成功。
- 宿主可访问性树已无残留编辑器；运行可用、取消禁用。随后再次点击运行，[重跑报告](evidence/2026-09-27-alpha32-acceptance-rerun.json) 7/7 成功。
- B 六行 raw/undo 均为 1、坐标偏差 0；合成 dispatch 2–20ms、双帧机会 22–37ms。C 观察 1201ms，正对照 2037 次 / 11ms，销毁后 0 次，重建原文/选区/历史一致。不推断键盘、IME、实际绘制或完整性能保证。
- 最后 `⌘Q` 已观察到 App 退出。用户普通窗口由用户自行退出；Agent 未保存或丢弃用户文档。版本仍 alpha.32，无代码改动、重打包或 Git。
- D 的独立 SDK 执行和规格/规范复核维持本片研究范围通过；wire bytes、严格单向时间及原生复制未知。整个批次到此结束，下一轮仍由用户选择。

## 2026-09-27 等待用户退出时的验收进展（历史）

- A / F-013c：用户总体验收通过，不推断用户逐项操作。
- B / F-018d、C / F-012i：用户授权 Agent 代验；独立复核既有真实报告通过，核心证据仍保持原观测边界。运行中取消/重跑尚未验证；当前普通窗口有两份未保存文档，需用户自行保存并退出后再安全定位实验窗口。Agent 未保存、丢弃或关闭用户文档，不以代验授权扩大权限。
- D / F-018e：授权后的独立 Agent 已运行真实 SDK 探针并复核，无规格/规范阻断，本片有边界研究范围代验通过；不是用户亲验，不代表真实 wire/单向/原生复制已测出。
- 本次独立复核：SDK/解析辅助测试共 5 项 / 52 断言、报告服务 8 项 / 75 断言通过，承接检查通过。由 Agent 启动的隔离进程已结束，用户普通窗口未动。没有代码、版本或 Git 变更。

## 最终交付 alpha.32

请先保存并退出旧版，再打开 [alpha.32 普通 App](</private/tmp/agentic-markdown-batch32.lKGi3Y/Agentic Markdown-canary.app>)，不要从下方历史 alpha.31 路径启动。

- 最终版本 `0.1.0-alpha.32`，hash `7d00qowzqtv4`；alpha.31 后仅格式调整，仍按流程递增并重新打包。构建成功且已核对归档版本，最终 Lint/typecheck 通过；包内 Bun 1.4.0 全量 487 项 / 3831 断言 / 75 文件，2.60 秒。本机 487 / 3831 证据保留在下方。
- alpha.32 已在隔离数据目录 `/private/tmp/agentic-markdown-probe32.6YLoSl` 运行真实系统 WebView 并正常退出 0；[新包实际报告](evidence/2026-09-27-alpha32-editor-view-report.json) 7/7 成功。
- B 六组坐标偏差均为 0、原文/撤销一致；合成 dispatch 2–22ms、双帧机会 23–34ms。C 双方 pending 为 1，1200ms 内正对照 2037 次 advance / 13ms、销毁后 0 次，重建原文/选区/历史一致。有限合成观测不能推广为真实输入延迟或性能保证。
- alpha.31 的人工工具操作记录仅属于 alpha.31；没有假定 alpha.32 的普通窗口、颜色外观、真实 IME 或运行中取消已经亲验。

## alpha.31 自动证据（历史，不作为最终包）

- 最终包 `0.1.0-alpha.31`，hash `1vguffajb6upe`；已从归档核对版本，解包位置 `/private/tmp/agentic-markdown-batch31.WEaUfw/Agentic Markdown-canary.app`。alpha.30 曾成功构建，后因报告提交后取消提示修正而由 alpha.31 替代，不作为最终交付。
- 构建命令 `AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary` 成功。`bun test`：本机 Bun 487 pass / 3831 断言 / 75 文件，2.87 秒；包内 Bun 1.4.0 同样 487 / 3831，2.35 秒。typecheck 通过；Lint 首次与构建并发时扫描了临时 `.cottontail-tmp` 而失败，构建完成后重跑通过，不改写为首次通过。独立规格与规范复核无剩余问题。
- 已真实启动系统 WebView 隔离实验，使用临时 App 数据目录 `/private/tmp/agentic-markdown-probe31.vZHVYi` 与 `PERF_LAB / PERF_EDITOR / PERF_AUTO / PERF_AUTO_EXIT` 四个 `AGENTIC_MARKDOWN_` 前缀开关，进程正常退出 0。[实际报告](evidence/2026-09-27-alpha31-editor-view-report.json) 共 7/7 行成功。
- B 六行原文/撤销一致、坐标偏差 0；合成同步 dispatch 2–21ms，双帧机会 22–29ms，只是这次样本测量，不是性能门槛或真实输入延迟。
- C 双方 pending 为 1；1202ms 观察中正对照 2037 次 advance / 22ms，销毁组后续 0 次；重建原文/选区/历史一致。只支持本次有限生命周期观察。
- D 真实 SDK 内存 JSON 证据见唯一迭代第 8 节，不是实际 socket/native 运行测量。浅深主题、真实 IME、手动取消/重跑尚未由这些自动结果证明。
- 另一次非自动运行的隔离窗口通过实际 UI 核对中文运行/取消按钮，并完成第二次 7/7 成功（临时报告 `agentic-markdown-perf-vYCoUb`）。取消操作实际落在任务结束之后，不能算运行中取消通过；工具延迟不是 App 延迟。该合成实验窗口已用 `⌘Q` 退出；Agent 尚未启动普通模式新包，不影响用户旧窗口。

## A：源码颜色（F-013c）

样本：[源码颜色](</var/folders/jy/rh9p8thj3t32m4pwhk38jydc0000gn/T/agentic-markdown-f013c-wCa9Qd/01-source-colors.md>)、[BOM/混合换行](</var/folders/jy/rh9p8thj3t32m4pwhk38jydc0000gn/T/agentic-markdown-f013c-wCa9Qd/02-mixed.markdown>)。目录为 `/var/folders/jy/rh9p8thj3t32m4pwhk38jydc0000gn/T/agentic-markdown-f013c-wCa9Qd`。若临时目录已清理，可运行 `bun scripts/create-f013c-fixtures.ts` 重新生成，使用该次输出路径。

1. 普通启动新包，打开 `01-source-colors.md`，用 `⌘⇧M` 进入源码模式。
2. 检查水平线、转义、实体、代码语言和注释等颜色：标记完整保留，只有前景/次级颜色区别；不应出现大标题字号、粗体、斜体或行内块背景。原始 HTML 不渲染、不执行。
3. 切换浅色、深色（系统主题可随系统变化），确认文字和选区可辨；编辑/源码往返，编辑模式既有排版正常。
4. 在 `02-mixed.markdown` 修改少量文字、选择文字、切换模式、撤销/重做，确认内容和选区不意外丢失；可检查中文候选期间保存和切换仍受既有保护。BOM/混合换行精确保真另以自动断言为证，不要求凭肉眼判断字节。

## B：真实长行视图探针（F-018d）

推荐验收方式：先阅读本页 Agent 已获得的六组保真/撤销结果和测量边界，认可即可明确回复“接受 B 的 Agent 实测证据”；不要求自行计算坐标或计时。只有希望检查实验工具运行/取消时才需要打开实验页。

本项为测量工具，不是新增长文档产品能力。显式设置 `AGENTIC_MARKDOWN_PERF_LAB=1` 与 `AGENTIC_MARKDOWN_PERF_EDITOR=1` 后进入隔离实验页；普通启动不显示该页。实验只创建固定合成内容，不修改用户文档。真实运行已完成，用户可接受上述 Agent 自动证据或选择重跑；取消按钮的实际交互仍可另验。

1. 运行 B/C，核对 B 六行覆盖编辑/源码模式及 10,000 / 50,000 / 200,000 UTF-16 单位长行。
2. 检查原文、撤销及坐标反查结果。`unsupported` 是无法观测，不等于通过；失败不得被平均耗时掩盖。
3. 如需复验运行/取消，可使用按钮或键盘聚焦后操作。取消停止后续工作并释放实验 View；若报告已提交，取消不保证撤销后端写入的合成报告，界面应明确说明。

View 创建时间不含前面的状态创建；dispatch 是合成同步编辑，不代表真实键盘或 IME 延迟；两次帧回调不证明屏幕已完成绘制。不设性能数值门槛。

可选：若要亲自打开 B/C 隔离实验页，先退出本次普通窗口，再在终端运行以下命令。该命令不覆盖系统 HOME，只为 App 创建独立临时数据目录；没有自动运行/自动退出，进入后点击“运行 B/C”。

```sh
task_probe_home=$(mktemp -d /private/tmp/agentic-markdown-manual32.XXXXXX)
AGENTIC_MARKDOWN_HOME="$task_probe_home" AGENTIC_MARKDOWN_PERF_LAB=1 AGENTIC_MARKDOWN_PERF_EDITOR=1 AGENTIC_MARKDOWN_PERF_AUTO=0 AGENTIC_MARKDOWN_PERF_AUTO_EXIT=0 "/private/tmp/agentic-markdown-batch32.lKGi3Y/Agentic Markdown-canary.app/Contents/MacOS/launcher"
```

结果中文状态为“成功”才表示该行探针通过；“不支持”是不可观测，“失败”请直接反馈。耗时只需观察和记录，不要求达到某数值。实验结束用 `⌘Q` 退出，重新打开普通 App 即不进入此隔离页。

## C：解析生命周期（F-012i）

推荐验收方式：审阅上述有正对照的实际结果及有限观察边界，认可即可回复“接受 C 的 Agent 实测证据”；无需手动数 parser 回调。

与 B 同次运行，检查第七行解析生命周期结果；上述真实新包结果已获得，不把辅助纯状态测试与真实 View 证据混淆。

1. 只有双方存在 pending、存活正对照继续推进、销毁组没有后续推进，才能支持本次有限观察通过。
2. 销毁组仍推进优先记失败；未见推进但缺有效正对照记不支持。
3. 重建后的原文、选区及撤销历史分别核对。此实验不等于完整应用任务队列或未来解析消费者已支持取消，也不证明 GC 已释放特定字节。

## D：传输边界补证（F-018e）

无需在窗口中寻找新按钮。可审阅 [F-018e](F-018e-transport-observability.md) 的来源与固定样本结果，或运行 `bun apps/desktop/scripts/probe-transport-envelope.ts` 复现。

1. 字符串中文/BMP/emoji 在真实 SDK 的双向内存 JSON 通道中保真；ArrayBuffer/Uint8Array 的二进制类型不能保留。
2. SDK envelope 的 UTF-8 字节数不等于真实线传字节；本片没有真实 socket/native 观测。
3. `wireBytes`、`oneWayMs`、`nativeCopyCount` 保持 null。接受本片表示接受这一有边界的研究证据，不代表未知项已完成或生产路线被替换。

## 剩余范围与确认方式

父 F-012 / F-013 / F-018 仍未完成；OBL-003 / OBL-012 / OBL-069 仅局部承接，OBL-020 / OBL-041 / OBL-068 / OBL-070 等余项开放。生产上限仍为 1 MiB。没有 Git 操作授权。

A 用户总体验收与 B/C/D 授权 Agent 代验结论见顶部，本批切片范围验收结束。不得把受托代验重写为用户逐项亲验；剩余父功能与 OBL 保持开放，不自动开始下一迭代或 Git。
