/** No real network URL or filesystem resource in any HTML input. */
export const securityCorpus = [
  {
    id: "safe",
    label: "安全段落和强调",
    html: "<p>中文<strong>强调</strong><br><em>斜体</em></p>",
    mode: "sanitized",
  },
  {
    id: "structure",
    label: "安全列表与代码",
    html: "<blockquote><ul><li>项目</li></ul></blockquote><pre><code>原文</code></pre>",
    mode: "sanitized",
  },
  {
    id: "script",
    label: "脚本整段源码",
    html: "<p>前文</p><script>globalThis.__f020executed=true</script><p>后文</p>",
    mode: "source",
  },
  {
    id: "attributes",
    label: "属性和事件源码",
    html: '<p id="f020" style="color:red" onclick="globalThis.__f020executed=true">内容</p>',
    mode: "source",
  },
  {
    id: "link",
    label: "主动链接与下载属性",
    html: '<a href="javascript:void(0)" target="_blank" download>链接</a>',
    mode: "source",
  },
  {
    id: "resource",
    label: "资源标签源码",
    html: '<img src="data:text/plain,inert" onerror="globalThis.__f020executed=true">',
    mode: "source",
  },
  {
    id: "namespace",
    label: "SVG与模板源码",
    html: "<svg><a>图形</a></svg><template><p>模板</p></template>",
    mode: "source",
  },
  {
    id: "normalization",
    label: "安全但非规范格式也保守降级",
    html: "<P>大写标签</P>",
    mode: "source",
  },
] as const;
export const securityURLs = [
  "#标题",
  "../note.md",
  "https://example.invalid/",
  "mailto:test@example.invalid",
  "javascript:alert(1)",
  "%256aavascript%253aalert(1)",
  "//example.invalid/",
  "file:///not-accessed",
  "https://example.invalid/%0a",
];
