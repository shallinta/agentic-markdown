# F-064b：固定桥接可行性证据

本片经两独立轴复核及主线批准受托 Agent 代验通过，非用户亲验、非正式应用验收。仅验证固定 Tantivy 0.27.0 → Rust 稳定 C ABI → Node-API 8 → Bun worker 的自建小缓存 CRUD、重开、错误阶段和自然退出。正式 typed 构建／包内资源由后继 F-064c 推进；没有全文搜索 UI、真实授权或 dirty 覆盖。四项 OBL-006/018/026/035 继续 deferred。

完整范围与原红见[唯一迭代](../../docs/iterations/F-064b-tantivy-native-bridge.md)。本目录不包含编译二进制、工具链、Cargo 缓存、target 或索引数据库。

## 五个持久文件

- 本 README：证据边界及人工重建说明。
- [inventory.json](inventory.json)：164 个成员的原历史来源、相对包内路径、size、SHA-256。57 个源码／199,826 bytes，107 个收据、stdout、stderr、audit／1,023,244 bytes。
- [evidence.tar.xz](evidence.tar.xz)：164 成员全部原 bytes，总原文 1,223,070 bytes；XZ 100,084 bytes，SHA-256 `c44a3ceea313f1d0bbd81f51ce1960adf4fa386f0556160064579a780b03d768`。
- [pack-receipt.json](pack-receipt.json)：原打包验证收据；完整 tar 展开 1,351,680 bytes、164 个成员逐项 hash／size、总量、零尾与 XZ EOF 均通过。
- [archive/pack.py](archive/pack.py)：原冻结打包工具，SHA-256 `9f0533b55bf4f3deea1834cddbf88f1c84b839faa4959ffc78dac7188b65d39b`，与收据 scriptSHA 相同。原 inventory SHA 为 `bac8ca269150f2d75d420dad1e16807abe2cf850e6d64d24b7b0963e0589af6a`。

打包工具只用于固定、自产且逐项 SHA 已核的清单，不是任意不可信输入的通用归档／解压器。2 MiB 展开计费不是 LZMA decoder RSS 硬上限。脚本按历史布局在同级查 inventory；本目录保存的是原件，不宣称直接运行当前位置即可重新打包。不要为方便运行而修改历史源或收据。

## 实际结果及保留失败

`bridge.w0G13h/run-1792339410377845000`保存首次编译、Rust 系统库输出及链接收据。原 native SHA-256 为 `6589e6ea852dce773d6a46bea665f6c00a95dda0094069fcde591e529fc8dd78`，只保来源与重建条件，不提交二进制，也不保证另机重编字节相同。

原六组在 case2 首 ACK／断言完成后进程超时。所有减法探针与原失败均保留；永久事件观察发现第三条同 id `BRIDGE_ERROR`，随后分类确认实验调用不存在的 global `close`，被 catch 后监听器仍保活。候选只在 native close／ACK 后解除消息监听器自然排空，不使用 process.exit、unref 或 terminate。早期简化例自然 exit0 没有完整迟到错误观察，不能追认无 worker error。

`regression.tQc04Q/run-1792341527379330000`为最终六组完整结果：原 case body、client、protocol 不变；worker 仅修关闭；独立观察器核所有真实派发与回执。六子自然 exit0、无残组。case2 两 worker 为22／4请求；case4 为6请求、held／release 各1，生命周期2／2／2；case6 为4请求，仅 commitLost 对应 id 允许一次 unknown，两个 `INDEX_PANIC` 为已标明注入。所有 worker pending／errors／failures 为0。它不是自然 OS 故障、OOM／abort、正式 app 打包或性能保证。

## 人工审阅与重建

先核本目录三份证据文件 hash 与 pack 收据，再在**新的自建工作目录**中依 inventory 验证包内相对路径、普通文件类型、唯一成员、大小、SHA 和完整 EOF 后读取所需源码。不要向仓库或历史 `/tmp` 覆盖解包，也不使用未校验的 extractall。无须恢复任何索引数据库，固定文本在 cases 源码中。

包内路径前缀对应15次历史源目录，例如 `bridge.w0G13h/`、`direct-events.LxL5OG/`、`regression.tQc04Q/`。源和 JSON 中的 `/tmp` 路径是原始历史事实，不是跨机可用入口。

重建前置：macOS arm64；Rust 1.90.0；包内记录的 Bun（编译收据含准确 SHA）；Node-API 8 headers（原编译收据列四文件 SHA）；固定 Cargo.toml／Cargo.lock（锁 SHA `639d75f7f400a528fb5879936175f31f51ba6a762e5cee8202f80f73dc00f347`）。工具取得／校验参考[F-064a 研究说明](../f064a/README.md)，不重复归档其工具链或缓存，不自动下载／升级。

在新工作副本中显式映射工具、header、原目录、worker／addon 路径；保存映射 diff 与新 source SHA，绝不修改包内历史源和 receipt。原公开编译接点为 `cargo rustc --release --locked --lib -- --print native-static-libs`，按实际输出由 clang Node-API 8 链接；精确 flags、环境、600秒编译止损见 `bridge.w0G13h/run.py`。编译后将新 native 放到新回归目录，采用 `regression.tQc04Q/run.py` 的六组15秒／180秒及加强终态规则；重建版本的 source／binary pins须另写，不能冒原哈希。

此处提供可审证据与人工重建路线，不承诺一键可移植重放，也未执行迁移后的编译／六组。原 source／receipt bytes 保真；F-064c 不应直接复制试验注入、全 raw 返回或过程级 panic hook 为生产接口。
