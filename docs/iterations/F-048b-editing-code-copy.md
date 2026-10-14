# F-048b：编辑模式右键复制代码块正文

## alpha144 非离线有限片正式通过（2026-10-15）

主线依据实际WK操作与最终独立Spec/Standards各0必要阻断，批准本片受托Agent代验通过，非用户亲验。编辑右键纯正文复制、只读与模式隔离、背景误输入窄防护已交付；源码1273/32533、包内Bun仓库1273/32534。两样本原样、readonly644、进程退出已独立核实。Git待实际执行；下方“待验/构建中”均为历史检查点，不覆盖本条。自然IME、精确竞态、极端成本/完整父/专项/F028c/offline-final继续开放。

## 主线冻结检查与打包（2026-10-15）

独立Spec/Standards代码复核各0必要阻断、各定向11项/156断言，主线同组复跑一致。源码全量1272项/32520断言/183文件、29.94s通过（`/tmp/f048b-main-full.log`）；type/full lint、功能/义务/lockfile/diff检查通过。版本递增alpha.143。初次构建缺少发布签名身份报`MissingDeveloperId`（`/tmp/f048b-alpha143-build.log`），未修改签名配置或凭据，按仓库既有本地测试开关`AGENTIC_MARKDOWN_SKIP_SIGNING=1`重试同版（`/tmp/f048b-alpha143-unsigned-build.log`）；当前尚待构建结束/真实WK，不能宣称通过。

自建验收目录`/tmp/agentic-f048b-ui.gIfQvs`，`code.md`初始SHA256 `9ae03f770bcee47187679399fa82f76e6844074cf1363b9c5671b8fc93b56ce2`；`readonly.md`为`8e20186d0e3ef9288043d33319d13ecdea82990ca68376782581928f9b2db7f2`。尚未在新版打开或修改，非用户正文。

> 状态：主线全文读最小方案及135项窄匹配实验、两独立轴0路线阻断后批准生产。当前typed候选已实现并完成作者定向检查，待独立代码复核与主线真实WK验收；未版本/构建/UI/Git。

## 生产候选收据（待验）

### alpha143实际失败与窄修批准

主线真实WK鼠标复制、Return复制及Esc恢复选区通过；菜单Down选中后工具`pressKey('space')`未复制，曾将空格写入正文，已undo回clean。focus-trace显示没有Space keydown/up：ArrowDown keyup后直接beforeinput `insertText`，target是editor、activeElement为menuitem，随后editor获得焦点。不能将其称为已验证的物理Space激活失败，也不推断工具内部根因。现CM普通beforeinput不要求焦点，历史guard仅处理undo/redo；F045h只读surface修复不覆盖普通可写editor。

主线批准且Spec0路线阻断：仅本菜单同步open、焦点确在本Content、事件target确在当前同view contentDOM、owner实时身份有效时，对cancelable beforeinput执行preventDefault；不把空格转复制，不改全局IME/close，不事后undo。关闭/换view/卸载清理并同步核旧handler。修复只防菜单期间串入后台编辑器，不宣称物理Space键已验证；原alpha143红和诊断证据保留，下一包由主线管理。

作者窄修候选已实现：`code-menu-input.ts`实际guard及正反例，菜单每目标在当前contentDOM注册capture监听，读取同步openRef、owner及view身份、Content真实ref和activeElement；close/失效/卸载移除，迟到回调先实时核验。仅preventDefault，不stopPropagation、不改变输入内容/复制/IME。新定向含原回归22 tests / 316 assertions通过，root type、三增量文件lint、docs/diffcheck通过；仅逻辑seam结果，尚未新包或实际复验。

新增`code-copy-target.ts`公共命中/单趟分片映射/有界matcher、`editing-code-copy.ts`真实菜单owner与对应两测试；`editing-code-menu.tsx`复用UI菜单，MemoryEditor仅包装容器。初审必要问题已修：StrictMode effect新建owner、select-text覆盖、每次右键目标主动换代、重试preventDefault、非目标撤销旧准备且保浏览器默认、当前controller订阅延迟到view接受后核身份。owner测试实际调用生产接口，不是另造模型；effect式重建不是React DOM StrictMode实操证明。

作者定向21 tests / 302 assertions / 4 files通过（目标、菜单owner、既有canonical与reading copy），root typecheck、6文件定向lint通过。初始import包名/type及lint错误均已修；没有版本/构建/WK证据，不能宣布验收。保留完整AST传输与canonical极端责任，菜单真实事件/选区/焦点/系统剪贴板及自然IME仍须对应证据。主线负责全量和打包，两轴独立审核后再真实验收。

## 有限隔离验证批准

主线已全文读取方案，两独立轴确认0隔离实验阻断，批准仅临时目录验证真实Lezer/raw坐标与canonical代码块端点/value、正常规模现有Worker完整请求/AST回传/查找成本。尚未批准生产。独立菜单owner避免阅读生命周期争用；是否沿用完整AST协议或窄返回协议，须依据本轮证据再收敛，均不预称已实现。

### 首轮冻结结果（非生产批准）

目录`/tmp/agentic-f048b-probe.EzkIep`，纯`query.ts`与薄`run.ts`；复跑`bun /tmp/agentic-f048b-probe.EzkIep/run.ts`，成本另跑同命令追加`cost`。17基础样本×LF/CRLF/CR×有无BOM，共102例：**72端点完全一致、30端点差异**，未猜附近节点或改差异期望。`matrix-corrected.log`保留每项Lezer editor/raw范围及canonical raw/editor范围/value。缩进、quote缩进、list缩进、含空行缩进及Tab五组各六例：Lezer起点在缩进后首内容，canonical起点保留代码缩进，末端本矩阵一致；围栏/空/未闭合/嵌套围栏及非代码负例本矩阵一致。例`    a\n    b\n`为Lezer `[4,11]`、canonical `[0,11]`、value `a\nb`；CRLF/CR正文保留对应EOL，不能主动统一换行。

原`matrix.log`102项unknown是实验驱动误用`createRawEditorState(..., isolated=true)`关闭语言，**不是产品解析缺陷**。查公开editor-mode接线后修驱动为真实默认state并复跑，旧日志保留。无伪造complete树；当前小样本通过公开ensureSyntaxTree得到完整树，此调用是实验准备，不是生产右键时强制全文parse方案。

`cost.log`为Bun实际现有Worker与独立`createCurrentCanonical`实例，1/100/1000代码块、raw30/3000/30000 UTF-16单位：完整请求至AST回复约16.11/24.53/68.91ms，Worker parse约3.70/13.35/53.92ms，全文code收集约0.097/0.226/0.290ms，JSON结果表示大小684/43637/445926字节。往返含启动、克隆、解析，未独立测clone；JSON大小不是实际structured-clone字节或RSS。仅正常有限样本，非WK、非SLO、非极端性能结论。未验证鼠标/剪贴板/菜单/选区/IME或完整取消竞态。

**下一最小修正建议，尚未实施**：围栏可继续精确双端匹配；缩进必须显式适配真实起点差异，候选为同代唯一canonical code覆盖真实Lezer目标、末端严格相等，且起点差仅允许同首行的ASCII缩进空白，保留Tab列规则与容器边界核对，不机械从value裁剪。需独立复核该规则，不能把30红解释为已解决；若无法证明则保留不可靠状态并继续窄修，不删缩进代码范围。owner复用现服务可运行但完整AST传输实存，是否改只回目标value仍由主线整体判断。菜单非modal外点关闭不得无条件view.focus抢焦点；非目标/保护状态保原生菜单，避免preventDefault阻断Radix自己的anchor/open。

<!-- obligations: none -->
<!-- deferred-obligations: none -->

## alpha144 真实窗口收尾候选（待最终独立复核）

本地免签构建成功，hash `mqr86dq2n2ha`，副本`/tmp/agentic-direct144.lA3ZNe/Agentic Markdown-canary.app`；独立数据沿用自建目录，exec63019/Bun37530。源码1273/32533，包内Bun运行仓库1273/32534；断言差1保留不推因。两轴窄修代码各12/170无必要阻断。

- 同原缩进坐标右键→Down→Space：正文不变、clean、显示已复制。现有诊断仍记录seq9 beforeinput insertText，target editor id3、active菜单id5；之后新增seq10 keydown Space target菜单id5、seq11 click，然后回到editor。document capture的prevented=false为目标监听前采样，不证明目标未阻止；此次结果支持背景正文未被误写，后续菜单键盘激活成功，不推断工具内部机制、不冒称自然物理键盘矩阵。
- 关闭菜单后折叠选区、CmdEnd、Space实际新增EOF空格，CmdZ恢复clean。第一次点击离屏END定位形成大范围选择，Space替换选区，亦一次undo恢复；属于本轮工具定位限制，不把它报为单光标输入证据，随后明确折叠再测才是单光标证据。
- ABC选区右键另一TS块，Escape回ABC；重新右键、Down/Return复制，CmdV确实替换ABC为两行代码并保留缩进，CmdZ恢复。引用块复制粘贴EOF得到`const quoted = 2;`，无引用符或围栏；列表块Control点击、Down/Space复制粘贴EOF得到`list code`，无列表缩进，分别一次undo恢复clean。
- 只读自建readonly.md临时444后通过原生选择器打开，显示只读且无未保存；右键/Enter可复制，Space不改只读正文，切code.md粘贴EOF得到`const readonly = true;`，undo恢复。菜单打开后外点readonly标签，目标与焦点转到readonly，未抢回旧正文。
- 普通源码与故障按钮触发的安全源码右键代码均是WK原生菜单（Copy等），无自有块复制；普通编辑正文右键也保留原生菜单。阅读模式入口仍渲染，readonly阅读复制按钮实际显示“已复制”；没有把该反馈单独等同于再次核剪贴板payload。
- 浅色只读代码菜单截图文字/背景可辨；设置已恢复深色。alpha143有空块、波浪线、缩进payload及鼠标复制实证；144复验TS/引用/列表/readonly与Space/Enter，未声称每个旧样本在144完整重跑。

本轮未进行自然物理中文IME、全系统菜单/触屏导航、精确准备中换目标异步竞态、真实15s超时或剪贴板权限拒绝、CRLF/CR/BOM真实剪贴板像素矩阵、极端成本/RSS及离线；对应自动seam/既有责任不替代实操。尤其自然IME与菜单交互仍为继承限制，未增加候选输入功能。完整父/专项/F028c/offline-final开放。

两文档最终clean，CmdQ正常退出、exec63019 exit0，未保存正文。两样本SHA与alpha143基线相同；readonly恢复644。当前仅实际验收收尾候选，待最终Spec/Standards及主线批准，未Git。

## alpha143 主线实际窗口补充证据

源码及包内Bun运行仓库均1272项/32520断言通过；两轴代码定向11/156通过。首次常规签名构建因MissingDeveloperId失败，未改凭证配置；使用既有本地测试AGENTIC_MARKDOWN_SKIP_SIGNING=1重建成功，hash z87ealwdb144。直接解包副本`/tmp/agentic-direct143.tVkclt/Agentic Markdown-canary.app`，独立数据`/tmp/agentic-f048b-ui.gIfQvs/data`，exec41521/Bun36374，避开安装完成窗口。包内测试指包内Bun运行仓库测试，不是包内包含测试源码。

自建code.md先选ABC后右键另一TS块，菜单期间AX曾临时显示greeting选区，Escape及复制关闭后恢复ABC；不声称菜单期间DOM选区完全没变。真实CmdV替换ABC为`const greeting = "你好";`加换行及两个空格缩进的`console.log(greeting);`，无围栏/info，CmdZ一次恢复clean。波浪线复制后粘贴为“波浪线代码”，一次undo恢复。缩进块复制粘贴为两行`indented code`/`second line`，无四空格；工具选END未可靠定位，粘贴实际在EOF，记录为工具定位限制。Control点击列表块及普通右键缩进块的Space未复制，普通右键Space还把选中的indented替换空格；鼠标/Return成功并显示已复制。空块鼠标复制后CmdV无正文变化、仍clean，不粘贴上一份缩进内容。该有限成功不抵销下文输入失败。

现有焦点诊断显示ArrowDown keyup之后直接出现seq9 beforeinput、target editor id3、active other id5（菜单项）、trusted true、insertText、composing false，随后focusout菜单及focusin正文；没有Space keydown/up。只证明工具驱动文本输入路径，不能声称真实物理Space键失效或工具内部根因已确定。独立审查确认窄防护路线，不改Radix关闭或globalIME，不将文本当命令。最后测试空格已undo，AX显示已保存基线一致；CmdQ正常exit0。两样本磁盘SHA保持：code.md `9ae03f770bcee47187679399fa82f76e6844074cf1363b9c5671b8fc93b56ce2`，readonly.md `8e20186d0e3ef9288043d33319d13ecdea82990ca68376782581928f9b2db7f2`。未保存用户正文、未断网；本版未验收/未Git。

窄修后两轴独立代码各12/170、主线全量1273/32533、type/full lint/文档/义务/lock/diff检查通过。下一包递增alpha144重新实际验收，测试通过不替代WK。

## 选择与已确认范围

前轮F-022c已实际提交推送`180767af2ab31858a9e8035edb657f7c0d56a167`，主线核远端main一致、工作树clean。连续授权下一选择S-17第129条的编辑模式命令式复制，不取消F-029最近项候选，也不把较低编号未完成项视为阶段门禁。

编辑模式在真实代码块上右键，菜单提供“复制代码块内容”；不叠加正文悬浮按钮。复制当前块的纯正文，排除围栏、语言/info及行号，与F-048a canonical `code.value`一致；围栏与缩进代码、引用/列表内代码都不通过机械trim猜正文。原文、dirty、历史与已有选区保持。只读可复制，源码保原有普通选区复制，阅读入口不变。本片不做高亮、折叠、行号、围栏Enter专项或代码资产下载。

硬前置已满足：F-012代码结构/编辑消费者、F-048a纯文本复制服务、当前canonical语义、既有controller权限/组合保护和UI菜单库。该命令不需F-024重模块或F-040折叠完成；它们仍是父F-048其他切片前置，不冒称解除整父依赖。

## 已读本地公开接口与风险

- `packages/ui/src/ui/context-menu.tsx`包装Radix ContextMenu Root/Trigger/Content/Item；安装版公开Root有`open/onOpenChange/modal`，Content继承菜单的关闭自动聚焦事件。Trigger内部通过contextmenu坐标设置virtual anchor，随后open并preventDefault；与调用者handler组合，不能在错误层级preventDefault后还假定默认anchor会更新。
- CodeMirror公开`EditorView.posAtCoords({x,y})`在未覆盖DOM时返回null；不使用`precise:false`估算命中。`syntaxTree`真实节点祖先可定位`FencedCode/CodeBlock`，使用相关范围完成性；普通inline code/HTML不能冒充代码块。CM当前contextmenu observer只记时间，但浏览器右键默认选区/鼠标前序事件仍需实际验证，不能从这一行代码推定自然选区不变。
- `reading-code-copy.ts`现有`createReadingCodeCopy`及`writeCodeClipboard`允许手势中同步发起`navigator.clipboard.writeText`、pending去重、迟到反馈隔离；取消不能撤销已交给系统的写入。复用该服务，不另建原生桥、`execCommand`回退、剪贴板读取或权限轮询。
- canonical完整解析已知极端成本保持；局部raw切片在引用/列表缩进下并非天然同语义，禁止直接substring去围栏/trim。此命令可以在用户打开菜单时准备同代正文，不得变成每键全文parse。
- 已比较现有`createDocumentCanonical/createCurrentCanonical`：它已提供懒请求、session对象/revision/raw身份、15s期限、取消及`isCurrent(result)`；但实例是单消费者，`request()`先取消上一次，`ReadingView`effect清理也无条件cancel。直接共享阅读单例的请求/取消会争用生命周期。最小建议复用**现有服务与现有Worker代码**，仅创建菜单独立实例，不新增Worker协议或解析实现；代价是既有协议返回完整AST，而非只回正文。读取现有共享ready结果虽技术上可经`isCurrent`核验，但正常退出阅读会cancel，收益不稳定，本片先不引入双来源缓存。该选择待主线复核，不默认批准新后台管线。

## 最小技术方案

1. **目标票据**：只在编辑且有效view/controller/session、非safe/fault、非busy/frozen/IME时识别鼠标命中。记录documentId、session、revision、Text/raw身份、profile、当前真实CodeBlock/FencedCode范围及原选区；只读不作为拒绝理由。命中不可靠/null/非代码块则保留原生菜单，不替用户定位最近块。右键命中代码块才启用自有菜单，普通CmdC等现有快捷键不变；不声称自有单项菜单等价于全部系统菜单项目。
2. **菜单准备与手势**：受控菜单保持公开Trigger虚拟锚定位；可在外层capture记录目标和阻止会修改CM选区的前序默认行为，但不靠合成contextmenu或修改私有selection状态。实施须核Trigger handler执行顺序，非目标/被保护状态不拦截原生菜单。打开菜单后正文准备中显示禁用“正在准备代码内容…”；用户选择已启用“复制代码块内容”的onSelect才同步调用复制服务，绝不在解析完成回调里自动写剪贴板。菜单按键导航/Enter/Space及Esc走库公开行为；关闭自动聚焦只在同一有效view恢复焦点，不设置新selection、不抢新标签焦点。
3. **正文准备**：菜单独立实例复用现有`createDocumentCanonical`及`CurrentCanonicalWorker`，仅在打开代码菜单时request一次。既有Worker返回完整同代AST，主线程仅消费精确匹配code节点的`value`，不将AST接入编辑装饰，也不改阅读单例。根据捕获raw与editor坐标做一次目标端点映射，按有序节点位置裁枝定位，不盲去引用前缀或推测缩进；遍历有界分片且每片检查票据。菜单关闭销毁AST引用与实例。空块允许空字符串，BOM/CRLF/CR/未闭合围栏按canonical既有值。引用定义不另解析或拼接。菜单关闭、换目标、revision/session变化、模式切换、IME/冻结撤销准备资格并终止/忽略旧回执；同目标同代可在本菜单生命周期复用结果，不建立跨文档全局缓存。完整AST结构化克隆成本是现协议的实存代价，测试记录它，不冒称仅正文传输；若这一复用途径实测不可接受，再报告窄返回协议路线，不先扩实现。
4. **实时复制guard**：onSelect再次核当前document/session/revision/Text/raw/profile、target票据、代码范围及view已被controller接受；若有变化立即拒绝，不复制旧块或当前另一个块。不依赖旧React render布尔值。菜单关闭动作与pending复制反馈分开：本次有效手势发起后允许在目标仍当前时短暂toast“已复制”，失败“复制失败，请重新打开菜单重试”；系统写入发生后无法撤回只隔离迟到UI，不能声称取消副作用。目标失效/销毁清timer和服务pending状态，不把已失败复制自动重放。
5. **失败及成本**：准备失败/无精确节点/超时保原文和选区，菜单给可恢复失败或“重新准备”入口；重新准备不是写剪贴板，随后仍需用户选择复制项。一次任务失败不无限循环，不增加文件大小门槛。沿现15s保护作实现候选参数非SLO；公开保留全文canonical极端成本责任，不把少量正常菜单成功解释为所有合法文件成本已解决。仅复制实际value，无语言渲染/HTML执行/网络或文件写入。

## 实现后最小验证

- 纯正文：反引号/波浪线、有/无语言与info、空块、缩进代码、quote/list容器、未闭合围栏、CRLF/CR/BOM；精确比对同代canonical value，不改预期凑绿。inline code/HTML/块外点击无自有命令。
- 票据与生命周期：菜单A后编辑/换tab/reload同revision/切source/safe/开始组合/冻结/销毁，旧回执与旧onSelect拒绝；两次打开不同块不能串结果；只读允许，选择与raw/history不变；失败显式重试、关闭后不继续准备，不发生自动写入。
- 手势：服务writeText在菜单onSelect同一同步调用链发起；Promise resolve不能自主复制；失败/缺API/迟到仅自动seam，实际WK通过菜单鼠标和键盘复制，再正常粘贴到自建可写样本核payload并撤销。覆盖已有非空选区上右键另块及菜单Esc，原选区应保持；源码/阅读旧入口回归。
- 真实WK另外核自然右键/控制点击的事件顺序、菜单定位、浅深/readonly、工具IME、跨标签及正常退出；自然物理IME/完整系统菜单导航/极端性能不得凭seam称通过。每次代码打包alpha递增由主线执行；独立双轴、实际验收及主线批准前不Git。

## 义务与后续责任

继承检查：**F-002 原文与离线**不回写、不联网；**中文与外观**使用中文菜单/反馈与现有浅深主题；**命令与键盘**使用菜单公开键盘交互、保留CmdC且不新增全局键位；**安全与日志**纯文本剪贴板、实时身份保护、不记录正文或路径。F-005取消与生命周期、F-008安全边界保持。

已核登记，无以F-048为主承接的迁出义务，本片声明`obligations:none`；不自行抢占或关闭其他父义务。协作继承F-002离线本地、F-008安全、OBL-030消费者外观/可访问性、OBL-064历史与中文组合、OBL-068编辑主题责任；按本片实际证据局部记录而非整体完成。`F-048b-offline-final`留最终人工，不断网。完整F-048/S15–18、F-028c及其他专项、已知canonical极端成本与未测自然IME继续开放。

## 下一候选精确匹配规则（待主线批准验证）

先捕获当前可靠Lezer节点`L`及同代raw；仅对其两个editor端点映射raw，记`[s,e]`。候选不是按距离找最近块：只查询同代canonical树中的`type=code`节点`C`，验证整数合法范围、`C.end=e`，并要求唯一匹配。

- `FencedCode`：`C.start=s`，同时canonical `lang/meta`可为空；不通过语言值猜节点。
- `CodeBlock`：canonical `lang/meta`均为空；`C.start<=s`，两起点必须在同一raw行，区间`[C.start,s)`逐字符只能是ASCII空格或Tab（不含BOM、CR、LF、引用符号、列表标记或正文）。允许起点相等；不固定减4、不trim、不重新计算正文或Tab列。代码资格来自两棵真实树，空白差仅作身份对应验证，不是自写缩进解析器。
- 任一类型若数量不是恰好一、末端不同、差区含非空白、树不完整或票据失效，则结果unknown，不借相邻节点或父块的value。复制内容直接使用该`C.value`，保持空字符串与原解析EOL。

这一规则是待验证候选，102例中的30红仍保留。下一有限对照须加入多空格/混合Tab、容器紧邻块及未闭合相邻代码，证明不误拿邻块；仅已有矩阵末端一致不能证明所有合法输入端点一致，发现新差异继续保留并窄修，不把unknown永久当已完成范围。

主线独立复跑首轮102/30差异及成本成功：1/100/1000块往返约16.10/24.63/70.70ms、parse4.07/13.30/54.88ms；与作者同属Bun有限样本，不是WK或性能目标。首轮命令/日志及完整限制位于本文顶部“首轮冻结结果”，不是第55行以后。

## 第二轮匹配冻结与最小生产候选（待批准）

主线全文读取精确规则、两轴0隔离路线阻断后批准追加实验。旧query/run/首轮日志不改；新`matcher.ts`与`match-run.ts`位于同临时目录，命令`bun /tmp/agentic-f048b-probe.EzkIep/match-run.ts`。`matcher-final.log`为**135项/0差异**：原102项、9种混合Tab/容器邻块/字面围栏/空行/未闭合组合×3EOL、6个伪候选拒绝（末端错、重复、起点在后、fence不等起点、跨行差、差区含quote）。候选直接读取当前canonical节点的lang/meta和值，输出真实范围和值；初版`matcher.log`未输出lang/meta，最终驱动补从真实canonical直接读出后复跑，原日志保留。目标映射沿原query为每目标两端各一次；实验收集全树仅对照，不能当生产每事件策略。0差异仅有限矩阵，不证明所有Markdown全等，真实UI仍未验证。

拟生产仅五处窄接线：

1. typed目标票据与matcher：菜单准备阶段从捕获raw一次顺序遍历映射两个目标端点；当前Lezer只查命中祖先并验证相关范围完整，禁止每键或每selection遍历全文。canonical使用上节规则直接raw范围，候选结果必须唯一，返回value不二次解码/裁剪。寻找采用显式栈，按节点范围裁枝，每task最多128个节点/游标操作，间隙字符核验另以4096字符/task续算，yield时保留单调进度并核身份。不slice巨大间隙或同步recursive遍历。
2. 最小owner复用现有CurrentCanonical服务与Worker但独立实例（现有限成本可接受，暂不加摘要协议）；一次菜单request，取消/关闭销毁结果与续算任务，同代目标内复用。准备与复制分离；同revision reload/session、view更换、raw/Text/profile或目标改变都撤销。结果当前性同时核canonical.isCurrent及目标票据，现服务只验root形状不等于matcher可忽略节点字段，消费时验证code/position整数范围/value类型。
3. 非目标原生菜单：不能只设open=false或同事件setState disabled。外层公开`onContextMenuCapture`先同步判资格；非代码/保护状态只`stopPropagation()`，不preventDefault，让浏览器原生默认继续且阻止Radix Trigger bubble接管。可靠代码才让Trigger自己的handler更新anchor/open。前序右键/Control点击pointer capture只在可靠代码阻止会移动选区的默认行为，不拦普通点击；这条事件路线须真实WK确认，不凭React模型认定。触屏长按不冒称已覆盖。
4. Radix菜单真实onSelect同步发起writeText；不await解析后再写、不在自动准备成功时写。只读复制允许；IME/busy/frozen/safe与票据失效拒绝。菜单close与clipboard pending各自生命周期，迟到反馈隔离。Escape/选择关闭可在当前view恢复焦点；外点关闭或换tab不得无条件view.focus，保持库非modal外部互动处理。原selection不经setSelection重写，不新增历史。
5. MemoryEditor只绑定本菜单owner、中文准备/失败重试及现主题菜单；非code原菜单/源码/阅读不变，无新全局键位或原生桥。正式测试需覆盖matcher135有限样本代表、分片取消/ABA与菜单事件路由/同步写入；实际WK核非code原生菜单、右键原非空选区、容器复制粘贴、只读、Esc/外点焦点、IME和退出。必须独立复核与主线真实验收后方可认定本片通过。
