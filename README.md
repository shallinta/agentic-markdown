# Agentic Markdown

[English](./README_EN.md)

一款开发中的高性能、本地优先、多文档 Markdown 桌面 App。

## 当前状态

MVP 产品规格已确认，F-001「macOS 可运行外壳」已于 2026-09-19 通过人工验收，包括离线重启和基本窗口交互。starter 附带能力属于“继承草稿”，不代表 Markdown 产品功能已实现。

F-003a「只读文档服务」已于 2026-09-20 通过人工验收，完整 F-003 仍为部分完成。正文区提供原文验证入口，不是正式阅读器或编辑器。

F-004a「单文件路径识别与只读授权」已于 2026-09-20 通过人工验收；完整 F-004 仍为部分完成。

F-006a「现有操作的统一命令与键盘入口」已于 2026-09-20 通过人工验收；提供打开、重新读取、清空、切换侧栏和命令面板五项命令的统一入口，不代表完整 F-006 或全 App 中文化已完成。

F-007a「现有界面简体中文与 App 外观」已于 2026-09-21 通过人工验收：当前自有界面固定中文，支持浅色、深色和跟随系统外观及偏好保存；完整 F-007 仍为部分完成。

## 产品方向

- 优雅地查看和编辑多个 Markdown 文档；
- 把性能作为核心产品指标，而不是发布后的补充优化；
- 以用户本地 `.md` 和 `.markdown` 文件作为正文唯一真源，核心功能完全离线可用；
- 首先面向 macOS，桌面框架基于 [`electrobun-app-starter`](https://github.com/shallinta/electrobun-app-starter)；
- 项目名称中的 Agentic 代表长期方向，Agent 能力不进入 MVP。

## MVP 形态

- 一个窗口可以同时加入多个任意目录和独立 Markdown 文件，并以同级顶层项呈现；
- 支持阅读、编辑和源码三种文档级模式，不提供完整 WYSIWYG；
- 左侧主区域使用标签页，右侧副区域纵向平铺多篇文档；
- 提供本地文件快速打开、全文搜索、文内查找和 Markdown 导航能力；
- 以原子保存、外部变更检测、冲突处理和崩溃恢复保护本地内容；
- `.md` 与 `.markdown` 是一等文档格式，`.mdx` 不在支持范围内。

## 当前技术方向

桌面框架基于 Electrobun 与 `electrobun-app-starter`。CodeMirror 6、Lezer 和独立的 Canonical Markdown 阅读管线是当前技术方向；具体实现随对应功能迭代重新评估，必要时进行 PoC（Proof of Concept，概念验证），不设置独立 M0 阶段。

## 项目文档

- [产品能力总账](./docs/product-capability-register.md)：完整能力清单、阶段、边界和决策历史；
- [领域术语](./CONTEXT.md)：文档身份、路径、保存状态和解析语义等统一语言。
- [MVP 产品规格](./docs/mvp-product-spec.md)：依赖层、动态排序和实施状态；
- [迁出能力承接登记](./docs/deferred-obligations.md)：剩余能力的主承接功能、状态与验收证据；
- [产品功能手册](./docs/product-feature-manual.md)：当前功能的使用方式、限制和随迭代维护的变更记录；
- [F-001 迭代记录](./docs/iterations/F-001-app-shell.md)：本轮范围、方案及验证结果。

## 下一步

当前 [F-012a：内存编辑底座](./docs/iterations/F-012a-memory-editing-foundation.md) 的其他项目已通过用户验收；切换标签后的选区显示问题已在 `0.1.0-alpha.8` 修复并通过自动与界面验证，仅该项待用户复验，整体及 OBL-062 仍待人工验收。单文件仍限 1 MiB，没有保存、正式模式或正文恢复，不要用于需要保留修改的真实工作。父 F-012 仍未完成。

[F-010：编码与换行读取保真](./docs/iterations/F-010-text-fidelity.md) 与 [F-011：单文档实例与持久标签](./docs/iterations/F-011-persistent-document-tabs.md) 已于 2026-09-22 通过人工验收，F-011 验收包为 `0.1.0-alpha.3`；该轮已验收范围仅为只读原文，不包含编辑、保存或重启恢复。下一轮等待用户选择，不自动推进、提交或推送。

[F-005a：读取任务取消与有界调度](./docs/iterations/F-005a-document-task-cancellation.md)已于 2026-09-21 通过人工验收。同日按用户选择的方案 A，L1 收敛为当前外壳与只读流程的独立基础能力；上文父功能“部分完成”描述的是调整前的完整范围，后续消费者仍须按 [规格 6.1](./docs/mvp-product-spec.md)落实，不删除需求。

新增 [F-008a 安全、匿名日志与设置版本基线](./docs/iterations/F-008a-shell-security-baseline.md)及 [L1 六个模块](./docs/iterations/L1-module-acceptance.md)已于 2026-09-21 通过人工验收，方案 A 的 L1 基础范围完成；F-002 继续作为持续约束。下一轮由用户选择，不自动进入 L2 或提交、推送。

[F-009a 欢迎页与独立文件](./docs/iterations/F-009a-welcome-standalone-files.md)已于 2026-09-22 通过用户人工验收；此前自动检查和未签名构建通过，Agent 当时因 Mac 锁定未完成新窗口实测的记录仍保留，不追加用户具体操作证据。下一轮由用户选择，不自动推进。F-009 父功能仍部分完成，文件夹和最近项入口由 OBL-039 / OBL-040 继续追踪，当前仍非正式阅读器或编辑器。

## 本地运行

使用锁定的 Bun `1.3.14`。项目开发、构建和运行在工具沙箱外执行。

```sh
bun install --frozen-lockfile
bun run sdk:sync
bun run dev
AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary
```

未签名构建位于 `apps/desktop/build/canary-macos-arm64/`（当前验证平台为 Apple Silicon）。Electrobun 2.0.1 首次准备 SDK 需要下载配对工具链，生成的 `.hutch/devkit` 不入库；产物内 Bun 为 1.4.0，不改变本地开发 Bun。默认数据目录为 `~/.agentic-markdown`，可通过 `AGENTIC_MARKDOWN_HOME` 覆盖。安装过程默认设置 Git hooks；本轮验证使用 `HUSKY=0` 跳过了该设置。

附带的发布、更新及其他 starter 功能尚未验收；完整来源见 [starter 记录](./docs/starter/SOURCE.md)。
