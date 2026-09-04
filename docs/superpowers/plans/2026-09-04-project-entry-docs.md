# Project Entry Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create concise Chinese and English project entry pages plus a Chinese repository guide for coding Agents.

**Architecture:** Keep `README.md` and `README_EN.md` as equivalent, lightweight projections of stable product decisions rather than copies of the capability register. Keep `AGENTS.md` focused on how an Agent resolves facts, preserves product boundaries, updates decision documents, and verifies changes. Detailed product truth remains in `docs/product-capability-register.md`, while terminology remains in `CONTEXT.md`.

**Tech Stack:** Markdown, Git, existing project decision documents; no application runtime or package dependencies.

---

## File map

- Create `README.md`: concise Chinese project entry.
- Create `README_EN.md`: English document equivalent to `README.md`.
- Create `AGENTS.md`: Chinese repository instructions for coding Agents.
- Read `docs/product-capability-register.md`: authoritative capability and decision register.
- Read `CONTEXT.md`: authoritative domain terminology.

### Task 1: Create the Chinese project entry

**Files:**
- Create: `README.md`

- [x] **Step 1: Write `README.md` with the approved lightweight structure**

Use this exact content:

```markdown
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
```

- [x] **Step 2: Check the Chinese README structure**

Run:

```bash
rg -n '^#|^## ' README.md
```

Expected headings: project title, 当前状态, 产品方向, MVP 形态, 当前技术方向, 项目文档, 下一步.

### Task 2: Create the equivalent English project entry

**Files:**
- Create: `README_EN.md`
- Read: `README.md`

- [x] **Step 1: Write `README_EN.md` as the English equivalent**

Use this exact content:

```markdown
# Agentic Markdown

[中文](./README.md)

A high-performance, local-first desktop app for viewing and editing multiple Markdown documents, currently in design.

## Current Status

The project is currently consolidating its product specification and preparing for M0 technical validation. Product research, capability-by-capability decisions, and the first consistency audit are complete, but the repository does not yet contain a runnable app or usable installation, build, or test commands.

## Product Direction

- Provide an elegant way to view and edit multiple Markdown documents;
- Treat performance as a core product metric, not a post-release optimization;
- Keep local `.md` and `.markdown` files as the sole source of truth for document content, with core features fully available offline;
- Target macOS first and build on [`electrobun-app-starter`](https://github.com/shallinta/electrobun-app-starter);
- Treat Agentic as a long-term direction; Agent capabilities are outside the MVP.

## MVP Shape

- One window can contain multiple arbitrary folders and standalone Markdown files as peer top-level items;
- Reading, editing, and source modes are document-level states; full WYSIWYG is not provided;
- A tabbed primary area sits on the left, while a secondary area on the right vertically tiles multiple documents;
- Local quick open, full-text search, in-document find, and Markdown navigation are included;
- Atomic saves, external-change detection, conflict handling, and crash recovery protect local content;
- `.md` and `.markdown` are first-class document formats; `.mdx` is outside the supported scope.

## Current Technical Direction

The desktop framework is fixed on Electrobun and `electrobun-app-starter`. CodeMirror 6, Lezer, and an independent Canonical Markdown reading pipeline are the current technical direction; the concrete implementations of the editing hot path, reading renderer, document service, indexing, and file watching must be reevaluated through M0 performance and feasibility proofs of concept. They must not be described as implemented or permanently locked in.

## Project Documents

- [Product capability register](./docs/product-capability-register.md): complete capability list, stages, boundaries, and decision history;
- [Domain language](./CONTEXT.md): shared terminology for document identity, paths, save states, and parsing semantics.

## Next Step

Extract a standalone MVP product specification from the capability register, then begin M0 technical proofs of concept focused on editing performance, the Canonical reading pipeline, atomic save and recovery, multi-root scanning, and large-document behavior.
```

- [x] **Step 2: Compare the two README structures and claims**

Run:

```bash
rg -n '^#|^## ' README.md README_EN.md
```

Expected: both files contain the same seven sections in the same order, with reciprocal language links and equivalent product facts.

### Task 3: Create the repository guide for coding Agents

**Files:**
- Create: `AGENTS.md`
- Read: `CONTEXT.md`
- Read: `docs/product-capability-register.md`

- [x] **Step 1: Write the concise Chinese `AGENTS.md`**

Use this exact content:

```markdown
# AGENTS.md

本文件约束在本仓库中工作的编码 Agent（智能体）。项目仍处于产品规格与 M0 技术验证准备阶段；除非任务明确要求，不要初始化应用工程，也不要把已经确认的产品能力描述成已经实现。

## 事实来源

发生冲突时按以下顺序解释项目事实：

1. 用户在当前任务中的明确指示；
2. `docs/product-capability-register.md` 的当前基础结论和能力表；
3. 同一文件中日期更晚的决策记录；
4. `CONTEXT.md` 的领域术语；
5. 外部产品或技术调研仅作为证据，不自动成为本项目需求。

历史记录用于保存决策演变，不代表当前范围；不能因为早期记录与当前能力表不同，就恢复已经被后续决定修改的方案。

## 核心产品边界

- 核心价值是多 Markdown 文档的优雅查看和编辑；
- 性能是一等指标，重要交互必须在 M0 建立可复现基准和门禁；
- 用户本地 `.md` 与 `.markdown` 文件是正文唯一真源，App（应用）的核心功能必须离线可用；
- MVP（Minimum Viable Product，最小可行产品）为 macOS-first（首先支持 macOS），Agentic（智能体化）能力不进入 MVP；
- 不提供完整 WYSIWYG（What You See Is What You Get，所见即所得）编辑模型；
- 不支持 `.mdx`，不允许 Markdown 内容触发 shell（命令行解释器）、脚本、任意进程或越权文件访问；
- 已确认的产品行为与候选实现必须分开表达，技术候选不等于最终选型。

## 领域语言

涉及文档身份、路径、保存、恢复或解析语义前，先阅读 `CONTEXT.md`。尤其不要混淆：

- `documentId`：App 内稳定、不透明的逻辑文档身份；
- canonical absolute path：按真实文件系统语义规范化的当前绝对路径，只负责定位、授权与去重；
- Canonical Markdown 语义：App 对 Markdown 的规范、权威解释；
- `DocumentStructureSnapshot`：供大纲、折叠和锚点消费的轻量文档结构快照，不是第三棵完整 AST（Abstract Syntax Tree，抽象语法树）；
- PoC（Proof of Concept，概念验证）：用于验证风险与可行性的实验，不是生产实现；
- M0：正式功能编码前冻结约束、基准、风险和技术边界的阶段。

术语表覆盖多个产品阶段；某个概念出现在 `CONTEXT.md` 中，不代表它属于 MVP。

## 决策文档维护

修改产品决定时，应同步检查并更新：

1. 产品能力总账顶部的当前基础结论；
2. 对应的详细结论和能力表行；
3. 文件末尾追加的带日期决策记录；
4. 新增或改变领域概念时的 `CONTEXT.md`。

保留早期历史记录原貌，通过更新当前结论和追加较新记录表达覆盖关系，不能静默改写历史。每项决定至少说明是否提供、所属阶段、用户行为、实现边界、性能影响以及明确不做的内容。

## 技术决策纪律

- 未完成对应 M0 benchmark（基准测试）或 PoC 前，不冻结依赖版本、性能数值、RPC（Remote Procedure Call，远程过程调用）载荷、索引后端或完整 schema（数据结构规范）；
- `DocumentStructureSnapshot`、micromark/unified 等是当前方向或候选时，应明确保留开发阶段重新评估的空间；
- 不为了未来 Agentic、插件、多平台或协作能力提前扩大 MVP；
- 不虚构不存在的源码目录、安装步骤、命令、测试、构建结果或发布状态。

## 工作与验证

- 搜索文件和文本优先使用 `rg` 或 `rg --files`；
- 修改文件使用 `apply_patch`，保留用户和其他任务的无关改动；
- 文档修改至少运行 `git diff --check`，并核对内部链接、README 中英文事实等义、能力 ID 重复和 Markdown 表格结构；
- 代码出现后，按受影响范围运行真实的格式检查、类型检查、测试和构建，不用其他检查替代；
- 未经用户明确要求，不创建提交、不 push、不改写 Git 历史；
- 用户要求提交时只暂存任务相关文件，提交前复核 staged diff（暂存差异）；提交不代表允许 push。
```

- [x] **Step 2: Check that the guide contains no nonexistent engineering commands**

Run:

```bash
if rg -n 'npm |pnpm |bun (install|run|test)|cargo |pytest|vitest|playwright' AGENTS.md; then exit 1; fi
```

Expected: no matches.

### Task 4: Verify the complete documentation set

**Files:**
- Verify: `README.md`
- Verify: `README_EN.md`
- Verify: `AGENTS.md`

- [x] **Step 1: Verify Markdown whitespace and links**

Run:

```bash
git diff --check
test -f README.md
test -f README_EN.md
test -f AGENTS.md
test -f CONTEXT.md
test -f docs/product-capability-register.md
```

Expected: every command exits with status 0 and `git diff --check` prints nothing.

- [x] **Step 2: Scan for placeholders and premature project claims**

Run:

```bash
if rg -n 'TO''DO|TB''D|安装命令|Install with|npm install|bun install|MIT License|Contributing' README.md README_EN.md AGENTS.md; then exit 1; fi
```

Expected: no matches.

- [x] **Step 3: Review the final diff and worktree scope**

Run:

```bash
sed -n '1,240p' README.md
sed -n '1,240p' README_EN.md
sed -n '1,280p' AGENTS.md
git status --short
```

Expected: only `README.md`, `README_EN.md`, `AGENTS.md`, and this implementation plan are new or modified. Do not commit or push unless the user explicitly requests it.
