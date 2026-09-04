# Agentic Markdown

本上下文描述 App 如何理解本地 Markdown 文档及其位置。它用于避免把逻辑文档、磁盘路径和平台文件标识混成同一个概念。

## Language

**Markdown 文档**：
由一个本地 `.md` 或 `.markdown` 文件承载正文的逻辑文档；磁盘文件是正文唯一真源。
_Avoid_: 文件（讨论身份时）、页面、笔记

**文档身份（`documentId`）**：
一个 Markdown 文档在 App 中稳定、不透明的身份；可靠重命名或移动前后仍是同一身份，复制或删后重建则是新身份。
_Avoid_: 路径身份、canonical 文档、inode 身份

**当前路径（canonical absolute path）**：
Markdown 文档当前磁盘位置按真实卷语义规范化后的绝对路径；一个文档身份在一个时刻至多对应一个当前路径。
_Avoid_: 文档身份、永久路径

**文件系统身份信号**：
平台提供的 file ID、inode 或同类关联线索；它不是跨平台、永久或唯一的文档身份。
_Avoid_: 文档 ID、永久文件 ID

**未命名文档**：
尚未绑定磁盘路径、正文仅存在于 App 状态中的 Markdown 文档；它与已被删除但仍保留原路径和内存内容的 missing 文档不同。
_Avoid_: 草稿、临时预览、missing 文档

**复制文档（Duplicate）**：
从现有文档的磁盘内容或用户明确选择的当前内存内容创建一个新文件和新 `documentId`；原文档的身份、路径、标签与保存状态保持不变。
_Avoid_: 另存为、Save As、切换当前文档

**未保存变更**：
当前文档内容尚未确认在其当前路径达到 durable，或原路径已经 missing、关闭后将失去唯一可用内容的状态。
_Avoid_: 仅用 dirty 布尔值判断、已有恢复日志即视为已保存

**Canonical Markdown 语义**：
App 对同一段 Markdown 的规范、权威解释；编辑交互解析与阅读解析出现差异时，以该语义决定阅读、复制、导出和最终修正方向。`canonical` 是职责，不是某个依赖包的名字。
_Avoid_: canonical path、某个 parser 的全部内部 AST、只要能渲染出的任意结果

**文档结构快照（`DocumentStructureSnapshot`）**：
绑定 `documentId`、内容 revision 与解析配置版本的轻量结构投影，向大纲、标题折叠和锚点定位提供统一的标题、范围、层级及稳定块关联；它不是第三棵完整 Markdown AST。当前候选由 Lezer 或 Canonical 管线通过适配层生成，具体 schema 与技术路线在开发 PoC 时重新评估。
_Avoid_: Lezer Tree、mdast、完整文档 AST、渲染 DOM

## Flagged ambiguities

- 旧文档中的 `identity` 有时表示 canonical path，有时表示稳定逻辑文档。统一后，未加限定的“文档身份”只指 `documentId`；路径只称“当前路径”或“canonical path”。

## Example dialogue

> 开发：watcher 可靠确认 `/notes/a.md` 被重命名为 `/notes/b.md`，这是新文档吗？
> 领域专家：不是。保留原 `documentId`，只更新当前路径。
> 开发：如果 `a.md` 被删除，之后同一路径又出现一个文件呢？
> 领域专家：那是新的 Markdown 文档，必须分配新的 `documentId`。
> 开发：用户新建后还没有选择路径的文档呢？
> 领域专家：那叫未命名文档；它没有当前路径，但仍拥有自己的 `documentId`。
> 开发：把当前内存内容复制成新文件后，当前标签会切到新文件吗？
> 领域专家：不会。那是复制文档；原标签和状态保持不变，产品不提供另存为。
> 开发：关闭主窗口时有三篇文档存在未保存变更呢？
> 领域专家：这等同退出 App，只确认一次是否放弃全部变更；取消则继续保留整个 App。
> 开发：大纲是不是直接同时读取 Lezer Tree 和 canonical AST？
> 领域专家：不是。它只读取当前 revision 的文档结构快照；两条解析管线通过适配层生产相同协议的数据，具体实现会在开发 PoC 时复核。
