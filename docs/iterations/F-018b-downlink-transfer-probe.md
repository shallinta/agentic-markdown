# F-018b：全文下行与传输测量

> 状态：已验收（本片下行与应用 JSON 探针范围，后续责任开放）
> 日期：2026-09-26
> 本批顺序：A F-012e → B F-013b → C F-014b → D F-018b；D 已验收，其他片按批次清单当前状态，不提交或推送。

<!-- obligations: OBL-003 -->
<!-- deferred-obligations: none -->

## 当前人工验收结论（2026-09-26）

用户明确确认 D 验证通过，本片全文下行与应用 JSON 探针范围转为已验收。此为用户总体结论，不补造逐项运行、取消、主题或键盘操作；下方历史构建与实测证据保留。OBL-003 仅本片范围通过，严格单向、实际复制与完整大文档保护余项保持开放，父 F-018 未完成。B 的 Agent 代验不与本片人工结论混淆；未提交或推送。

## 1. 功能说明

扩展现有显式启用的合成实验台，在 1/10/50 MB（十进制字节）、多短行及单长行语料上测量 Bun → WebView 全文响应，并检查客户端收到的正文、长度与摘要完整性。补充实验请求/响应对象的 JSON 编码探针，不改变正式文档 1 MiB 上限，不自动后台运行实验。

本片是实验能力，不是正式大文档功能。请求到收到全文的 RTT 包含小请求、后台生成与响应序列化/传输，不冒称严格单向耗时。JavaScript 对象的 JSON stringify/UTF-8 字节探针不代表完整 SDK envelope 或实际 wire 字节；测量本身的 CPU/内存开销也须说明。引擎实际复制次数、WebView heap 与严格单向时间无可靠观测时保持 null，不通过相减编造。

## 2. 最小技术方案

- 复用现有单会话、固定尺寸、序号与取消/超时协议，新增固定全文下行操作；请求不接受任意路径、文本或脚本，语料仅由尺寸与形态生成。
- 客户端比较预期合成正文、UTF-8 长度与摘要，失败不当成功。结果只落盘数字与固定元数据，不写正文。
- 使用纯编码探针记录应用对象的 JSON UTF-8 字节数、stringify 与编码耗时，区分原二进制 `encodeMs`。报告与 UI 更新范围说明，保留旧实验历史文件。
- 沿现有实验环境开关与自动运行/退出方式，真实打包 WebView 执行全部样本并保存匿名报告；普通启动不加载实验界面、不运行测量。
- OBL-003 仍保留严格单向、实际复制等不可观测或未完成项，父 F-018 不因本片通过而完成。不冻结性能门槛或生产传输路线。

## 3. 继承约束检查

- F-002：全部为离线合成数据，不读取、编辑或保存真实文档，正式限制不变。
- 中文与外观：中文路线和范围说明、浅深主题可读；实验数字单位明确，null 不显示成零。
- 命令与键盘：沿用显式实验入口、运行/取消/复制结果的键盘按钮；本片无正式文档新命令、拖放或分隔线。
- 安全与日志：精确字段校验、固定大小及单会话限额；匿名报告不含正文或用户文件路径，取消释放自有引用不等于 RSS 即刻归还。

## 4. 最小 happy path

1. 自动回归下载禁用、非法字段/序号、结束后请求拒绝、正文/摘要/长度损坏拒绝、JSON 中文与换行转义尺寸及报告白名单。
2. 真实打包 WebView 运行 1/10/50 MB 两种形态，六条全文下行均产生诚实状态与指标。
3. 人工实验台运行、取消及重跑，不混入旧结果；普通启动仍是文档工作区。

## 5. 实施与验收记录

待 C 项完成后实施。当前不声明新测量结果或新包已交付。

### 实施与局部验证（2026-09-26）

- C 完成后按批次顺序实施。新增 `full-text-downlink`：复用固定尺寸、单会话、精确请求字段和顺序约束，Bun 生成合成正文返回 WebView；客户端比较全文、UTF-8 长度、摘要及 runId/sequence。下载生命周期复用实验 Worker 的退出确认，但 Worker 不参与下行正文处理；取消可在生成前生效，同步生成/编码期间仍可能延迟，不假装可中断。
- 新增应用对象 JSON 探针，分别记录 stringify 时间、UTF-8 编码时间和字节。上行测应用请求对象，分块累计，patch 指标不含基线；下行测 `{ text }` 对象，不包含 SDK envelope、传输封装或探针字段。两端探针均影响 RTT；Bun CPU/内存采样仅包含 Bun 端探针、不含 WebView 请求探针/客户端验证，且采样早于 SDK 响应序列化。客户端全文验证另记耗时；旧 `jsonUtf8Bytes` 表示未测线传字节，继续 null，不与新指标混用。
- `oneWayMs`、`nativeCopyCount`、`rendererHeapBytes` 保持 null；报告仅允许数值、固定元数据，不包含全文。原合成开关、自动运行/退出、普通 1 MiB 限制未更改，旧报告未修改。
- 定向命令 `bun test apps/desktop/src/shared/perf-lab.test.ts apps/desktop/src/client/perf-runner.test.ts apps/desktop/src/bun/perf-lab/index.test.ts apps/desktop/src/bun/perf-lab/worker-state.test.ts`：19 项通过、161 断言，覆盖下行禁用/精确字段/错序/结束拒绝/取消、正文损坏、JSON 字节与报告不含正文。`bun run typecheck` 通过；Lint 初次发现两处测试格式问题，修正后 `bun run lint`、同一定向测试、`bun run check:feature-docs`（含承接检查）与 `git diff --check` 通过。
- 当前尚未进行本批构建、真实 WebView 六条下行或人工验收；版本及统一构建由主任务后续记录，OBL-003 和父 F-018 仍开放。

### 独立复核修正

- 修复报告 RPC 失败或缺失/畸形回执仍可能被视为正常结束的旧边界，失败改为拒绝运行，UI 显示实验中断。补失败、缺失、空值和非法路径回执回归，匿名报告只接受预期临时 basename；报告 generation 与 CPU/JSON scope 已按下行事实修正。
- 同一定向四文件重跑：20 项通过、167 断言（包括显式断言真实 BOM 和 CRLF，而非仅字面反斜杠）；最终 `bun run lint`、`bun run typecheck` 通过。不将该自动结果视为真实包实验数据。

### 批次构建与全量验证（2026-09-26）

- 统一版本 `0.1.0-alpha.23`；构建前递增，`AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary` 成功，归档内 `version.json` 核对 hash `3ukcs6yqf2ef9`、canary。产物 `apps/desktop/artifacts/canary-macos-arm64-AgenticMarkdown-canary.dmg`，未签名；实际解包 `/private/tmp/agentic-markdown-batch23.E3S8Ib/Agentic Markdown-canary.app`。
- `bun test`：448 pass / 0 fail，3195 assertions，68 files，2.57 秒。`bun run lint`、`bun run typecheck`、`bun run check:feature-docs`（含承接检查）、`bun run check:lockfile`、`git diff --check` 通过。包内 Bun 1.4.0 全量重跑同为 448 pass / 0 fail，2.27 秒。
- 包内 Bun 首次与性能实验并行的全量运行有 1 项既有文件/父目录权限测试失败，447 项通过；随后权限定向 6 项/39 断言通过，完整重跑全部通过。未定位首次失败原因，不把它宣称为已修复，也未为通过而放宽断言。正式测量为非隔离环境单次探索，不是性能门槛。
- 多链接承接检查器已支持同一开放责任的多个合法切片，保留逐片双向校验、唯一主承接及关闭条件；13 项/31 断言通过，解决新增切片后的旧单链接检查失败。不关闭本片之外的责任。
- 独立复核覆盖规格、规范和安全；各片实际证据见本文件。人工统一使用[批次验收清单](2026-09-26-batch-acceptance.md)。本批全部停在待人工验收，未提交或推送。

### 真实打包 WebView 实验

以 `AGENTIC_MARKDOWN_PERF_LAB=1 AGENTIC_MARKDOWN_PERF_AUTO=1 AGENTIC_MARKDOWN_PERF_AUTO_EXIT=1` 启动上述 alpha.23 的 launcher，实验完成并正常退出（exit 0）。[匿名原始报告](evidence/F-018b-alpha23-perf.json)通过字段白名单复核：46 行、45 成功、1 原生二进制不支持，无失败；新增六条全文下行均完成正文/UTF-8长度/摘要/身份/序号检查，停止后均观察到 Worker 退出与自有状态释放。

| 十进制大小 | 多短行下行 RTT（ms） | 单长行下行 RTT（ms） | 多短行应用 JSON 字节 | 单长行应用 JSON 字节 |
| --- | ---: | ---: | ---: | ---: |
| 1 MB | 60 | 54 | 1086967 | 1000011 |
| 10 MB | 416 | 372 | 10869575 | 10000011 |
| 50 MB | 2064 | 1861 | 54347835 | 50000011 |

每项仅一次，非隔离桌面环境，部分早期测量与测试运行重叠；没有 P95、输入绘制或性能达标结论。JSON 字节仅 `{ text }` 应用对象的探针，换行转义可扩大尺寸，不是实际 SDK wire。客户端全文验证另计，多短行/单长行分别为 1 MB 2/3 ms、10 MB 27/27 ms、50 MB 138/138 ms，不计入已收到响应为止的 RTT；Bun 响应 CPU 采样不含 WebView 验证或随后 SDK 序列化。

严格单向、原生复制次数、WebView heap 与实际 wire 字节仍为 null；不能由 RTT 相减推导。新数据仅补充下行和应用 JSON 口径，不关闭 OBL-003，不调整生产限制或选定传输架构。人工运行/取消/重跑及显示体验见统一清单 D。
