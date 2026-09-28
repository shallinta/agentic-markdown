# F-018j：多行大文档后台解析与输入响应

> 状态：2026-09-28用户总体验收alpha.47本片范围通过；完整性能与父功能余项开放
> 日期：2026-09-28

<!-- obligations: OBL-003 -->
<!-- deferred-obligations: none -->

## 功能说明与边界

将既有固定 Worker 后台解析的适用范围，从超长单行扩展到多行大文档，以减少初开、首笔及后续输入等待同步解析的情况。用户已确认本文件最小方案，并于2026-09-28总体验收alpha.47本片范围通过；实测收益及局限见末尾最终证据。沿用同一解析器、BOM修复及生产 wait 调度；不改语义、磁盘1 MiB字节上限或软换行。

OBL-003仅局部承接本片解析路径选择；完整大文档、传输/实际复制及其他消费者性能余项仍开放，父F-018不完成。deferred none表示无另一个主承接ID，不表示内部全部责任关闭。此前不弹文件选择器的问题未定位，本片不宣称修复。

## 最小技术方案

1. 复用固定Worker和wait，以文档总量作为超长行之外的候选条件；直接读取Text.length（UTF-16单位，O(1)），与磁盘文件字节上限分别处理。沿用正确alpha.43基线，使用已知800020字节大段落及普通/密集/围栏/混合结构的多个大小对照，依据本轮证据确定实现分界，不提前冻结数值门禁或承诺收益。
2. 在首次createParse便选择路径，不先执行昂贵同步解析再判断；总量与长行条件分离。首次createParse、会话生命周期激活请求、docChanged后取消并转同步三个既有入口须复用同一后台适用判定，避免请求未激活或刚发出就因无超长行被取消。既有长行CSS/token简化仍仅由长行条件控制，不能因总量进入后台就关闭全文高亮、装饰或语法呈现。
3. 覆盖阈值上下输入、删除和撤销，使文档能进入/退出后台路径并取消已过期任务。具体边界稳定处理依据样本确定，避免频繁重建Worker；不得隐式改用quiet-restart、换解析器或构建全新调度框架。若需超出本片选择策略的关键路线/行为变化，先更新本文件并重新确认。
4. 正文、保存、选区和历史不等待派生语法；等待期间不以旧树冒充当前树。沿用Text身份/requestId与Worker会话隔离、过期成功/错误拒绝和故障安全源码。后台故障或销毁不得隐式退回昂贵同步解析，故障沿用已确认安全源码处理。标签切换、销毁、长短行及总量条件往返均清理旧任务，不损失原文。
5. 以相同正确语义基线比较初开、首笔、连续输入和最终语法就绪；alpha.42错误复用结果不得作为速度基线。分清输入同步阻塞与后台就绪等待，不声称解析本身变快；无安全有效改善则如实记录未解决。

## 最小 happy path

- 普通小文档与多种大文档真实打开，首笔、连续输入后原文/选区正确，最终语义树与原同步解析一致；分别测状态/View初始化及输入、就绪区间，嵌套不重复相加，原生选择器停留与工具耗时不算App处理时间。
- 实现分界附近输入、删除、撤销/重做，重复跨界和短暂停顿，验证正确选择、有限重建、旧请求清理和最终收敛；BOM及混合行尾保真保持。
- 编辑/源码及标签往返后，完整高亮/装饰仍按现有规则呈现；在可丢弃文件中输入保存、撤销/重做和重读核对，保存不等待语法也不清除历史。重读遵循既有历史规则。
- 真实中文候选、滚动和视觉体验留人工，不以合成事务代替；故障安全源码、只读及退出保护继续生效。

## 继承约束检查

- F-002：仍离线处理已授权文本，文件字节上限不变；Text长度只是内部路径决策单位。可丢弃样本真实读写核对，不扩大磁盘授权。
- 中文与外观：不新增产品开关，沿用中文反馈与浅深/系统主题；语法稍后呈现不等于取消呈现，人工检查IME和外观，未验证项保留未知。
- 命令与键盘：复用统一输入/模式/历史/保存/打开命令及候选、只读上下文，不新增鼠标专属操作；切换与撤销跨界不得破坏选区或键盘入口。
- 安全与日志：Markdown仅为固定Worker的数据，禁止内容执行；原文与派生任务所有权隔离，拒绝过期结果。日志/报告只含固定样本标量，不记录用户正文或路径。

## 方案阶段记录（保留确认前历史）

2026-09-28：用户已确认多行大文档后台解析方向；细化方案待确认。当前仅文档，未实施、实验、构建或执行Git，不预写收益或验收结论。

## 实施启动（2026-09-28）

用户已确认最小方案并授权实施，真实证据待补，不预写分界数值、收益、构建或验收结果。首次解析/生命周期激活/docChanged取消使用一致适用判定，生产wait、原文/语义/历史及长行呈现边界保持；关键路线变化仍须重新确认。完整父功能与OBL-003余项开放，无Git。

## 中间实现与构建进度（2026-09-28，alpha.45历史）

后台选择条件新增文档总量迟滞：达到128000 UTF-16单位进入，低于64000退出，避免边界反复重建；仍兼容既有超长行条件。三个入口统一判定，长行CSS/token简化不扩大，固定Worker、wait、解析器、BOM修复及1 MiB字节上限不变。以上为内部路由参数，非SLO/性能门禁。

非DOM对照原始证据：[同步基线](evidence/2026-09-28-f018j-bun-baseline.json)、[Worker路径](evidence/2026-09-28-f018j-bun-worker.json)。Worker配置72/72最终树一致；其中target128k因语料取整实际units可能低于128000，不得把整个目标档视为后台。测量无View/RPC/自然输入，就绪等待在独立完整解析之后开始，不代表总语法延迟。

alpha.44仅中间构建；连续探针超时分类经规格复核调整后最终构建alpha.45成功，hash `3k7805acu2qj4`，应用 `/private/tmp/agentic-markdown-batch45.d5e6N0/Agentic Markdown-canary.app`，产物版本已读回核对。本机全量559项/9567断言/86文件通过（11.61s），包内同559/9567/86通过（10.38s）；typecheck、lint通过，两路独立针对测试各16项/4716断言通过。

真实系统WebView正在验证，尚无最终结果，不预写成功或收益。普通alpha.45尚未启动，仅隔离实验实例，未强退旧包。全新可丢弃人工样本目录 `/var/folders/jy/rh9p8thj3t32m4pwhk38jydc0000gn/T/agentic-markdown-f018i-uKdO0o`，由F-018i语料生成方式创建。本片尚未人工验收，完整父功能与OBL-003余项开放，无Git。

## 中间验证与最终候选（2026-09-28，以下保留最终运行前历史）

128000进入/64000退出是中间候选，不是最终参数。前述非DOM Worker 72组证据属于该中间候选，不能改标为512000/256000验证。

- [alpha.45首轮](evidence/2026-09-28-alpha45-disk-open-first.json)为4成功、20不支持：既有首笔最终树全匹配，大样本连续阶段未观察到全文ready，原文/保存/历史/重读正确。定位为新探针在顶部视口向末尾合成输入却未scrollIntoView，公开解析调度可能只覆盖视口范围；工具/探针观察边界不直接等于产品缺陷。
- alpha.46仅给连续末尾输入增加与首笔一致的scrollIntoView并升级版本，生产未改；[报告](evidence/2026-09-28-alpha46-disk-open.json)24组成功，不称生产修复。mixed约440010 UTF-16样本首笔13–23ms、打开至交互86–106ms、就绪等待1155–1190ms，相比正确alpha.43的12–14/78–84/559–570ms没有改善，不能只报800k样本收益。
- 按已确认的实测分界选择条款，将最终候选调为512000进入、低于256000退出（UTF-16），保留既有长行条件及wait。希望避免把此mixed样本转后台，但不能证明所有更大mixed都更快；未曾进入后台的256k–511k文档仍同步，其成本余项保留。
- alpha.47构建成功且tar版本读回一致，hash `yb4klsqyb39y`，应用 `/private/tmp/agentic-markdown-batch47.90mGB2/Agentic Markdown-canary.app`。本机559项/9567断言/86文件通过（11.88s），包内同559/9567/86通过（10.90s），typecheck/lint/docchecks/diff检查通过。

最终alpha.47系统WebView正在测量，未预写报告或验收结果；普通应用尚未启动。当前文档记录过程，不宣称全部性能已解决或关闭父功能/OBL-003，无Git。

## alpha.47 最终真实证据（2026-09-28，以下保留验收前记录）

本轮真实验证命令包括：

```sh
bun test
"/private/tmp/agentic-markdown-batch47.90mGB2/Agentic Markdown-canary.app/Contents/MacOS/bun" test
bun run typecheck
bun run lint
bunx --no-install prettier --check apps/desktop/src/client/background-parsing.ts apps/desktop/src/client/async-markdown.ts apps/desktop/src/client/async-markdown.test.ts apps/desktop/src/client/async-markdown-integration.test.ts apps/desktop/src/client/raw-buffer.ts apps/desktop/src/client/markdown-worker-browser.ts apps/desktop/src/client/multiline-routing-experiment.ts apps/desktop/src/client/open-document-probe.ts apps/desktop/src/bun/perf-lab/index.ts
bun run check:feature-docs
git diff --check
AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary
```

构建日志 `/tmp/agentic-f018j-build47.log`。真实实验在隔离数据环境运行以下入口，非普通用户文档窗口：

```sh
AGENTIC_MARKDOWN_PERF_LAB=1 AGENTIC_MARKDOWN_PERF_OPEN=1 AGENTIC_MARKDOWN_PERF_AUTO=1 AGENTIC_MARKDOWN_PERF_AUTO_EXIT=1 "/private/tmp/agentic-markdown-batch47.90mGB2/Agentic Markdown-canary.app/Contents/MacOS/launcher"
```

上式列出实验开关与已验证入口；实验服务内部创建私有临时语料与独立文档授权登记，不读取用户文档。重新运行不要与存在未保存内容的普通实例混用。

[最终独立报告](evidence/2026-09-28-alpha47-disk-open-final.json)与原始 `agentic-markdown-perf-a4WUG6/report.json` 一致，报告结构有效，24个唯一组全部成功、正确性指标均1。延续正确alpha.43首开区间口径；新增连续输入为重读后重新挂载视图，三次末尾输入间隔20ms并scrollIntoView，不混入首次打开指标。

| 普通800k大段落 | 正确alpha.43 | alpha.47 |
| --- | --- | --- |
| State初始化 | 50–66ms | 9–15ms |
| 首次合成事务 | 53–62ms | 12–17ms |
| 打开至合成交互 | 155–190ms | 77–98ms |
| 额外语法就绪等待 | 0ms | 495–498ms |

普通800k后续三次输入各12–13ms，没有旧版同口径连续输入对照。结果支持该样本减少同步阻塞，代价是语法随后就绪，不表示解析变快。

mixed约440010 UTF-16：State21–27ms、首笔12–20ms、打开至交互82–93ms、语法就绪等待544–575ms；alpha.43分别21–23/12–14/78–84/559–570ms。等待回到原区间，但同步仍有波动，不能声称完全无回退或全面优化；连续输入13–45ms同样没有旧版对应对照。更大mixed和未进入后台的256k–511k成本仍是开放边界。

最终512000进入/低于256000退出是内部UTF-16迟滞而非字节限制。首次打开440k仍同步；从较大文档缩到440k可继续后台直至低于退出边界。20组大样本保存前syntax-ready为0，但只有16组符合本次总量Worker条件；mixed4组是CodeMirror正常视口调度，不能称20组Worker均pending。所有组原文/选区/树/保存/历史/磁盘重读正确，不用工具耗时当自然输入或绘制延迟。

普通alpha.47已用系统open启动，按精确应用路径读取可访问性状态确认欢迎界面、文件树与打开按钮，不是实验台；未代做自然输入、IME或内容视觉验收。父F-018/OBL-003完整余项开放，未执行Git。

## 人工验收清单（验收前提供，非逐项操作记录）

最终应用 `/private/tmp/agentic-markdown-batch47.90mGB2/Agentic Markdown-canary.app`，hash `yb4klsqyb39y`。全新可丢弃样本目录 `/var/folders/jy/rh9p8thj3t32m4pwhk38jydc0000gn/T/agentic-markdown-f018i-uKdO0o`，含六类文件和中文README说明；普通800k段落为`02-large-paragraph.md`，mixed为`06-mixed-blocks.md`。

1. 打开小样本作对照，再打开普通大段落、密集多行、闭合/未闭合围栏及mixed，确认正文即时可编辑、语法随后正常呈现，未因总量关闭全部高亮或装饰。
2. 连续输入、选择和滚动，使用日常中文候选；切换编辑/源码和标签再返回，检查内容、选区及语法没有错位。用户无需肉眼核验毫秒。
3. 对可丢弃样本保存，确认保存不等待语法；撤销/重做及重读按既有规则工作。自动边界测试覆盖阈值往返，人工无需精确手工拼到512000个字符。
4. 观察所用浅深/系统主题和实际输入手感；如出现回退或安全源码提示，反馈具体文件与操作，不将本轮视为全面性能问题解决。

当时真实IME、自然输入与视觉体验留人工，状态为尚未验收；此处保留验收前清单，不补造逐项执行结果。

## 2026-09-28 用户总体验收与本片收尾

用户明确确认“验收通过。提交并推送。”F-018j alpha.47本片范围已总体验收，实施授权结束，不自动开始下一功能。本结论不补造逐项亲验、自然IME或主题操作；上述真实自动验证和Agent未实操边界保持历史原貌。普通大段落收益不代表全面性能解决，父F-018与OBL-003完整余项继续开放。

发布前重新核验：`bun test` 559通过、9567断言、86文件、12.21s；`bun run typecheck`、`bun run lint`及义务检查通过。此为本次新核验，不覆盖alpha.47构建时记录。本次用户已明确授权提交和推送，由主任务实际执行并报告；本文档收尾不宣称Git操作完成，无代码、版本或构建变更。
