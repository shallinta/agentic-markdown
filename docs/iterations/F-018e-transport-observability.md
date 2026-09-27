# F-018e：传输可观测性补证

> 状态：2026-09-27 授权 Agent 代验通过（alpha.32，本片研究边界）
> 日期：2026-09-27

## 2026-09-27 最终交付 alpha.32

2026-09-27 用户授权“B/C/D 由你代验”。独立 Agent 已复跑真实 SDK 探针并进行规格/规范复核，本片无阻断，受托代验通过；不是用户亲验。与解析辅助测试合计 5 项 / 52 断言通过，报告服务 8 项 / 75 断言通过，承接检查通过。仅 SDK 内存 JSON envelope 研究范围通过，严格单向、实际 wire bytes、原生复制仍未知，OBL-003 和父 F-018 不关闭。

- alpha.31 后仅格式调整，依规则递增并重新构建 alpha.32（hash `7d00qowzqtv4`），最终路径 `/private/tmp/agentic-markdown-batch32.lKGi3Y/Agentic Markdown-canary.app`。构建、归档核对、Lint/typecheck 通过，包内 Bun 487 项 / 3831 断言 / 75 文件，2.60 秒。
- 新包系统 WebView 隔离实验正常退出 0，[alpha.32 报告](evidence/2026-09-27-alpha32-editor-view-report.json) 7/7 成功；B dispatch 2–22ms、双帧机会 23–34ms、原文/撤销一致和坐标偏差 0；C 实际 1200ms、双方 pending、正对照 2037 次 / 13ms、销毁后 0 次、重建原文/选区/历史一致。均为有限合成观测，不证明真实输入、绘制或完整生产性能。
- 本片研究边界已按用户授权受托代验通过，无 Git 操作。下方 alpha.31 结果保留历史，不改标为 alpha.32；alpha.31 当时取消未命中运行期的记录不变，B/C 后续 alpha.32 实际取消及重跑已通过，见集中清单。

## 2026-09-27 alpha.31 历史批次证据（下方为当时状态）

- 最终交付 alpha.31（hash `1vguffajb6upe`）；`AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary` 成功并核对归档版本。alpha.30 曾构建成功，后因报告提交后取消提示修正而被 alpha.31 替代。
- `bun test` 本机 487 pass / 3831 断言 / 75 文件，2.87 秒；包内 Bun 1.4.0 同样 487 / 3831，2.35 秒；typecheck 通过。Lint 首次与构建并发扫描临时 `.cottontail-tmp` 失败，构建结束后重跑通过。独立规格/规范复核无剩余问题。
- [集中人工验收清单](2026-09-27-l2-followup-acceptance.md) 包含最终包路径、复验步骤和证据限制。仅进入待人工验收，不关闭父功能或开放 OBL，无 Git 操作。
- 第 8 节实际 SDK 隔离结果及 3 项 / 39 断言保留：只观测内存 JSON envelope，不宣称真实 socket/native、严格单向时间或复制次数。脚本未接入生产链路；本片没有新增窗口交互，人工可审阅并接受研究边界。

<!-- obligations: OBL-003 -->
<!-- deferred-obligations: none -->

## 1. 功能与当前范围

用户授权本批 A → B → C → D 推进集中验收。本片为 D，先调查本地 Electrobun 2.0.1 的真实传输边界；正式接入在前片完成后决定，不抢改共享 RPC 或实验台。调查不是实现、运行结果或人工验收。

仅部分承接 OBL-003 的传输观测口径。严格单向时间、原生实际复制、完整大文档保护等未完成责任继续开放；不因有源代码或无法观测而关闭父 F-018。普通文件 1 MiB 限制不变，固定合成实验不接触用户正文。

## 2. 最小方案（待按调查收敛）

### 本批已收敛执行范围

按主任务确认，新增独立 `apps/desktop/scripts/probe-transport-envelope.ts` 与真实 SDK 测试，不接入生产 transport 或实验台。脚本无参数，只接受代码中固定中文/BMP/emoji、ArrayBuffer/Uint8Array 样本，双向经过真实 createRPC 及内存 JSON 通道，输出 SDK/运行时版本、标量字节数和保真布尔值。入口用 `import.meta.main` 限定显式命令运行；测试 import 不启动测量。严格单向、完整 wire bytes、native copy 三项固定 null。测试/测量结果待实际执行后追加；此前调查记录保留。

- 优先复用现有显式开启的合成实验台和 runId / sequence / 取消约束，新增指标必须标明采样边界、单位、是否包含探针开销。不得从两端独立时钟直接相减或从 RTT 减后台耗时推导单向传输。
- 可执行的最小切片：以本地 SDK 的真实 `createRPC` 加隔离内存 transport 验证 envelope（RPC 封装）序列化口径，补充应用对象与 SDK 封装的差别、二进制保真事实及不支持项；报告明确“不经过真实 WebSocket/native，不是 wire bytes”。若接入真实窗口观测，需要先确定限定实验实例的可靠 hook，不能全局替换 WebSocket 或修改依赖包来隐式扩权。
- `sdkEnvelopeJsonUtf8Bytes` 一类候选指标只代表序列化 RPC 对象。即使将来观察 `WebSocket.send` 参数字节，也只能称 WebSocket 消息载荷，不包含 frame、mask、TCP/IP、重传等线传成本。fallback 独立标记，不借用 socket 指标。
- 无可靠入口的指标保持 `null` 和固定原因码。只保留标量元数据，及时释放正文、编码副本和闭包引用；不增加后台持续采样或持久化正文。

## 3. 继承约束检查

- F-002：本地官方依赖调查与固定合成内容；不写用户文件、不改变生产读写上限或原文真源。以测试确认实验未开启时无采样路径。
- 中文与外观：若接入界面，使用中文口径说明并继承浅深/系统主题；本阶段仅文档与终端探针，无新增界面验收。
- 命令与键盘：沿用实验台显式启用、运行/取消及键盘等价按钮，不添加隐式采样入口；只读探针无需新生产命令。
- 安全与日志：不打印正文、路径、secret key、明文/密文包；仅固定样本的数字和类型。真实 hook 必须限定授权合成 run，不能监听其他 RPC 或保留其对象引用。

## 4. 最小 happy path

1. 用真实 SDK `createRPC` 产生请求/响应封装，检查方法、ID、成功/失败类型及 UTF-8 口径；中文/emoji 不以 JS 字符长度冒充字节。
2. 二进制对象经现有 JSON 边界后明确判定是否保真，不把 Worker transfer 的成功推广成 RPC 零复制。
3. 未支持的跨时钟/原生复制指标仍 `null`，报告不接受伪造单向值或无来源的 wire bytes；取消、失效 run 和失败回执不生成成功报告。
4. 若最终仅交付调查/隔离验证，界面和真实 socket 测量必须明确未实施；若加入真实 hook，再验证开启/关闭、失败/fallback及释放，不以隔离探针替代窗口证据。

## 5. 本地官方源代码调查

本机 `apps/desktop/node_modules/electrobun/package.json` 与 `apps/desktop/.hutch/devkit/package.json` 均为 2.0.1。以下路径相对仓库根；`.hutch/devkit` 是本机生成的官方 SDK，不提交其内容。本片未联网，也未根据旧版资料推断当前实现。

| 边界 | 本地证据 | 可得结论 / 限制 |
| --- | --- | --- |
| RPC 封装 | `.hutch/devkit/api/shared/rpc.ts`（位于 `apps/desktop` 下）：请求 313–323，响应 443–462 | 请求包含 type/id/method/params，响应含 type/id/success/payload 或 error；封装不同于应用 `{ text }` 对象。 |
| 低层 hook | 同文件 156–165、321、433、461；高层配置 518–586 | `createRPC` 有 `_debugHooks`，发出前/处理收到对象时回调；`defineElectrobunRPC` 的配置及构造没有转发该参数。不可宣称当前高层 defineRPC 能直接启用该 hook。 |
| WebView 上行 | `apps/desktop/.hutch/devkit/api/browser/index.ts`：175–248 | 完整包 JSON.stringify；socket 可用时排队，常规加密后发送 `{encryptedData,iv,tag}` JSON；显式 plaintext 标记可走明文。连接未就绪会等待，不可将排队当纯网络时间；不可用时 native postMessage fallback。 |
| WebView 下行 | 同文件 94–131 | 字符串消息先 JSON.parse，密文再异步解密/parse；Blob 分支没有应用 RPC 处理实现，不能据此声称 binary RPC 已支持。 |
| 编码/加密 | `apps/desktop/.hutch/devkit/api/preload/encryption.ts`：21–31、51–105 | UTF-8 编码、AES-GCM、12 字节 IV、16 字节 tag、base64、JSON 外壳；可见显式 ArrayBuffer/slice/set 等操作，但不是整个引擎和原生链路实际复制计数。 |
| Bun 下行 socket | `apps/desktop/.hutch/devkit/api/sdks/main/core/Socket.ts`：10–39 | JSON.stringify 后 macOS 交 native FFI；Linux 有不同预加密分支，不能套用为 macOS 实测。函数布尔返回表达是否 socket 发送路径接受，不是对端收到时间。 |
| 下行 fallback | `apps/desktop/.hutch/devkit/api/sdks/main/core/BrowserView.ts`：210–231、405–453 | socket 失败可改 executeJavascript，JSON 包嵌入 receiveMessageFromHost 调用；存在批处理，不是 WebSocket payload。markSent 不是对端 ack。 |
| native 边界 | `apps/desktop/.hutch/devkit/api/sdks/main/proc/native.ts`：2162–2181、3658–3671 | 发送函数接收 UTF-8 C 字符串；可见 Buffer.from 与终止零。native 内部封装、排队、分配及浏览器内部复制不由这些 TS 行号证明。 |
| 时钟 | 当前 `perf-runner.ts`、后台实验及 SDK transport/RPC 路径 | 当前两端测量使用各自环境计时；上述 SDK 未提供共同校准时钟或同步误差界。单进程阶段差值可测，跨进程 performance.now / timeOrigin / Date.now 不能无条件相减当严格单向。 |

源代码只证明该路径存在，不证明本次运行实际选择哪条路径。实际 socket/fallback 选择必须有运行观测，不能按平台默认推定。底层加密参数是格式事实，不记录运行中的密钥或密文。

## 6. 已执行只读探针（2026-09-27）

通过 `bun -e` 直接 import 本地 SDK `api/shared/rpc.ts`，创建 `createRPC`，传入只在内存交接的 transport；`send` 对实际收到的 request 包进行 JSON.stringify 并用 TextEncoder 计数，随后微任务送回成功响应。固定参数含两个汉字及 3 字节 ArrayBuffer；不经过原生、socket 或真实 WebView。

实际输出：SDK request JSON 为 80 UTF-8 字节，应用 params JSON 为 28 字节；ArrayBuffer 在 JSON 解析后的值为 `{}`；SDK 请求 ID 为 1。说明此封装口径可重复取证，JSON 边界不保留该 ArrayBuffer 的内容，不能将数组对象序列化称为二进制或零复制。样本数字不是生产开销比例。

复现入口：`bun -e` 中 import `./apps/desktop/.hutch/devkit/api/shared/rpc.ts` 的 `createRPC`，请求 `probe`，参数 `{ text: "中文", bytes: new Uint8Array([1, 2, 3]).buffer }`；transport 的 `registerHandler` 保存 receiver，`send` 统计实际包并用 `queueMicrotask` 回送 `{ type: "response", id: packet.id, success: true, payload: null }`。完整实现或独立测试由后续 D 实施阶段再决定；本次没有创建源码/测试脚本。

## 7. 调查阶段结论（后续实施见下一节）

最小可行增量是“真实 SDK envelope 口径的隔离验证及能力说明”，而非宣称已测严格单向、wire bytes 或复制次数。真实消息载荷观测属于另外明确的 instrumentation（观测插桩）边界，应由主任务结合现有实验台选择是否纳入本片。当前没有改 shared/perf-lab、RPC、依赖源码、版本，没有构建或 Git 操作；OBL-003 与父功能继续开放。

## 8. 隔离验证实现（2026-09-27）

按本轮收敛方案新增两个独立脚本文件，真实调用本地 SDK `createRPC`，请求及响应均由 SDK 生成，经内存 JSON 序列化后交接；没有伪造成功响应代替本轮服务端 SDK。每个样本独立创建客户端/服务端、完成后移除 transport/receiver；返回对象仅标量，不保留请求、回复或原始样本。模块仅在 `import.meta.main` 时输出报告，不挂生产 RPC、也不覆盖 WebSocket。缺少已准备的 `.hutch/devkit` 时需先按项目既有准备流程安装，不回退为仿制 SDK。

固定语料无参数、无文件输入；命令：`bun apps/desktop/scripts/probe-transport-envelope.ts`。本机 Bun 1.3.14 / SDK 2.0.1 实际结果：

| 固定样本类型 | 应用 JSON UTF-8 字节 | SDK 请求 JSON 字节 | SDK 回复 JSON 字节 | 往返保真 |
| --- | --- | --- | --- | --- |
| 中文 | 8 | 59 | 60 | 字符串严格相等 |
| BMP 字符 | 10 | 61 | 62 | 字符串严格相等 |
| emoji | 10 | 61 | 62 | 字符串严格相等 |
| ArrayBuffer | 2 | 53 | 54 | 二进制类型丢失，结果为普通空对象 |
| Uint8Array | 21 | 72 | 73 | 二进制类型丢失，结果为数字键普通对象 |

字节包括 JSON 引号及封装，非原始正文长度；请求方法为固定 echo，ID 每样本为 1，不可将固定差值推广为所有真实请求开销。与第 6 节旧 probe 的方法名/嵌套参数不同，不混用其 80/28 结果。输出明确 `runtimeTransportObserved: false`，`wireBytes` / `oneWayMs` / `nativeCopyCount` 均为 null。

- `bun test apps/desktop/scripts/probe-transport-envelope.test.ts`：3 pass、39 断言。覆盖 UTF-8、未定义值拒绝、真实双向 SDK 封装/ID、Unicode 精确保真、二进制类型丢失、重复结果和正文不进入报告。
- `bun run typecheck` 通过。首次局部 ESLint 要求接口声明而非对象 type，已按规则修正，两个脚本的 ESLint 重跑通过；`bun run check:feature-docs`（含承接检查）通过。无共享源码/版本/构建/Git 操作。
- 本片无新增 UI/命令/取消生命周期，原实验台仍原样；第 4 节真实运行取消/失效 run 检查只在未来接入该实验台时适用，不冒充本片验证。当前脚本短时固定内存交换，没有后端服务、用户文件或长时间实验任务。
- 独立复核及批次最终人工验收仍待主任务安排；OBL-003 与父功能余项开放，不因本片隔离验证通过而关闭。
