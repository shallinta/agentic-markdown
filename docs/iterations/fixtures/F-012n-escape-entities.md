# 转义与字符实体验收样本

请复制到临时目录编辑保存。本样本与清单不是验证结果。

## 普通文本

转义：\* \_ \[ \] \\ \< \> \&

命名实体：&amp; &lt; &gt; &quot; &copy; &NotEqualTilde;

数值实体：&#65; &#x41; &#20013; &#x1F642;

非法码点替换字符：&#0; &#xD800; &#x110000;

无效或非实体：&unknown; &amp &#xZZ; \a

## 保守原文边界

空白控制：&nbsp; &Tab; &NewLine; &#32; &#9; &#10; &#13; &#128;

零宽及双向控制：&#x200B; &#x202E;

## 父节点触及

[标签 &amp; \*](https://example.invalid/?a=1&amp;b=2 "title &amp;")

标题 &amp; \*
=============

## 排除上下文

`&amp; \*`

```markdown
&amp; \*
```

[引用 &amp;][known]

[known]: https://example.invalid/?q=&amp; "title &amp;"

![alt &amp; \*](https://example.invalid/image.png)

<div>
&amp; \*
</div>

<span title="&amp;">普通文本 &amp;</span>

&lt;script&gt;alert(1)&lt;/script&gt;

## 后续人工操作（尚未执行）

1. 移出/移入各转义与实体，键盘和鼠标选区覆盖源范围，核对纯文本呈现与完整原文恢复。
2. 触及链接或Setext标题其他位置，检查子项一起恢复；核对排除上下文与控制/空白实体，不执行脚本或加载资源。
3. 修改、复制、撤销/重做、切源码返回，保存临时副本再读，确保正文保持Markdown而非显示字符。
4. 检查主题、中文候选、选择和实际输入手感，记录实际结果后再验收。
