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
- [产品功能手册](./docs/product-feature-manual.md)：当前功能的使用方式、限制和随迭代维护的变更记录；
- [F-001 迭代记录](./docs/iterations/F-001-app-shell.md)：本轮范围、方案及验证结果。

## 下一步

由用户选择下一轮功能。L1 保留 8 个条目：7 个独立功能中完整验收 1 个，F-003a、F-004a、F-006a 和 F-007a 已验收，父功能 F-003、F-004、F-006、F-007 仍为部分完成；另有 F-002 持续约束随相关功能落实，不作为完成前置。

## 本地运行

使用锁定的 Bun `1.3.14`。项目开发、构建和运行在工具沙箱外执行。

```sh
bun install --frozen-lockfile
bun run dev
AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary
```

未签名构建位于 `apps/desktop/build/canary-macos-arm64/`（当前验证平台为 Apple Silicon）。默认数据目录为 `~/.agentic-markdown`，可通过 `AGENTIC_MARKDOWN_HOME` 覆盖。安装过程默认设置 Git hooks；本轮验证使用 `HUSKY=0` 跳过了该设置。

附带的发布、更新及其他 starter 功能尚未验收；完整来源见 [starter 记录](./docs/starter/SOURCE.md)。
