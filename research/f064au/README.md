# 退役索引目录排他移动实验

实验使用正式 canary 包中的 Bun 和原生索引资源，在自建临时目录生成一个退役索引。探针单独编译，应用构建不会打包或调用它。

## 复跑

在仓库根目录运行。将 `app` 指向已经解包的 alpha.231 canary 应用，路径以 `.app/Contents` 结尾。需要 macOS、Xcode 工具链、已安装的仓库依赖及 Python 3。

```sh
set -eu
app='/absolute/path/Agentic Markdown-canary.app/Contents'
scratch=$(mktemp -d /private/tmp/f064au-XXXXXXXX)
printf '实验目录 %s\n' "$scratch"
mkdir "$scratch/bun"
ln -s "$app/Resources/app/native" "$scratch/native"
headers="$(cd apps/desktop && bun -e 'console.log(require("node:path").join(require("node:path").dirname(require.resolve("node-api-headers/package.json")), "include"))')"
xcrun clang -bundle -undefined dynamic_lookup -DNAPI_VERSION=8 -Wall -Wextra -Werror \
  -I "$headers" research/f064au/stage.c -o "$scratch/stage.node"
"$app/MacOS/bun" build apps/desktop/scripts/probe-index-reclaim-stage.ts --target=bun --outfile "$scratch/bun/probe.js"
AGENTIC_MARKDOWN_HOME="$scratch/home" TMPDIR="$scratch" python3 -c \
  'import subprocess, sys; sys.exit(subprocess.run(sys.argv[1:], timeout=60).returncode)' \
  "$app/MacOS/bun" "$scratch/bun/probe.js" "$scratch" "$scratch/stage.node"
```

实验输出用于核对身份与文件守恒。移动后的索引留在实验目录，供独立复核。实验结论适用于本轮环境与夹具。正式缓存仍需持久记录、租约中断处理和恢复流程。
