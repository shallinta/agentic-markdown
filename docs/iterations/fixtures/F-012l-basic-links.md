# F-012l 链接基础呈现验收样本

请复制到临时目录再编辑保存。此样本不应发起导航、网络请求或图片加载；它不是验证结果。

## 单物理行呈现候选

[中文标签](https://example.invalid/path)

[带标题](https://example.invalid/title "说明文字")

[空目标]()

<https://example.invalid/auto>

<hello@example.invalid>

[包含 **粗体** 与 *斜体* 的标签](https://example.invalid/nested)

[包含 `代码` 的标签](https://example.invalid/code)

## 引用式与定义：全部保留原文

[完整引用][known]

[known][]

[known]

[无定义][missing]

[missing][]

[missing]

[known]: https://example.invalid/reference "引用标题"

## 多物理行与空标签：整链接保留原文

[跨行
标签](https://example.invalid/multiline)

[跨行目标](
https://example.invalid/destination)

[]()

[](https://example.invalid/empty-label)

## 图片及嵌套图片：保留原文且不加载

![图片](https://example.invalid/image.png)

![alt [label](https://example.invalid/inner)](https://example.invalid/image.png)

[![alt](https://example.invalid/image.png)](https://example.invalid/outer)

## 代码与 HTML 上下文：不误隐藏

`[代码中的链接](https://example.invalid/code)`

```markdown
[围栏中的链接](https://example.invalid/fence)
<https://example.invalid/fence-auto>
```

<div>
[HTML块内的文本](https://example.invalid/html)
</div>

<a href="https://example.invalid/html-anchor">HTML原文</a>

## 后续人工操作清单（尚未执行）

1. 编辑模式将光标移出、移入上述单行链接，用鼠标和方向键选择或跨越源范围，核对标签呈现和完整原文恢复；空目标仍显示标签。
2. 核对引用、定义、多行、空标签、图片及代码/HTML边界无误隐藏，无跳转或加载。
3. 修改标签或目标，使用中文候选；复制、撤销/重做、切源码再返回，检查原文与选区。源码与安全源码不隐藏链接语法。
4. 在可丢弃副本保存后重读，检查完整Markdown；切换浅深/系统主题观察链接及选区对比。记录实际结果，不把清单存在视为验收通过。
