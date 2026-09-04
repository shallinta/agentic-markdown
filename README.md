# Agentic Markdown

[English](./README_EN.md)

一款正在设计中的高性能、本地优先、多文档 Markdown 桌面 App。

## 当前状态

项目目前处于产品规格整理与 M0 技术验证准备阶段。产品能力调研、逐项决策和首轮一致性审计已经完成，但仓库中还没有可运行的 App，也没有可用的安装、构建或测试命令。

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

桌面框架已经确定基于 Electrobun 与 `electrobun-app-starter`。CodeMirror 6、Lezer 和独立的 Canonical Markdown 阅读管线是当前技术方向；编辑热路径、阅读渲染、文档服务、索引和文件监听的具体实现仍需在 M0 的性能与可行性 PoC（Proof of Concept，概念验证）中重新评估，不应视为已经实现或永久锁定。

## 项目文档

- [产品能力总账](./docs/product-capability-register.md)：完整能力清单、阶段、边界和决策历史；
- [领域术语](./CONTEXT.md)：文档身份、路径、保存状态和解析语义等统一语言。

## 下一步

从能力总账提取独立的 MVP 产品规格基线，然后进入 M0 技术 PoC，优先验证编辑性能、Canonical 阅读管线、原子保存与恢复、多根目录扫描和大型文档表现。
