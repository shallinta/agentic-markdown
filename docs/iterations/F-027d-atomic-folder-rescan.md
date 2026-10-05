# F-027d：完整目录安全重扫与前端快照原子更新

> 状态：2026-10-05 alpha.96非离线本片已受托Agent代验通过，最终独立verifier 0剩余阻断、主线确认，非用户亲验。Git待实际执行。alpha.95失败和跨根局部证据保留且不冒充新版；完整父/义务/离线、F-028c与未知toast边界保持开放。

<!-- obligations: OBL-005, OBL-016 -->
<!-- deferred-obligations: OBL-011 -->

## 功能说明与边界

已完整扫描的根目录点击现有“重新扫描”，后台以F-027b/c受控候选复验并安全接受；扫描及前端读取分页期间保留上一份完整可见树，不先清空再填入。所有目录refresh使用统一暂存入口，roots、nodes、coveredHandles及相关assetEpochs完成一致性校验后一次替换，保留仍有效handle的选择、展开及焦点。不跟随重命名，不以显示路径把失效handle重新绑定。

非complete根仍保留现有restart恢复途径；加入目录、隐藏策略变更、clear等既有授权与代次规则不改变，但返回数据必须经过同一前端完整分页暂存，不能绕过原子更新。初扫增长中的目录可延后展示到一次一致快照，不提前承诺性能提升或扫描进度逐节点实时呈现。

重扫失败时保留旧可见树并明确失败；结果未知时不当作未提交，不偷偷调用破坏性restart恢复。未知operation保留且只query，后续独立refresh仍可读取并原子发布当前一致目录快照（不以树状态推断旧operation结果），不能因此冻结其他根显示。分页失败保持旧快照，后台已提交但显示失败须明确区分。不改变正文、模式、选区、撤销历史、保存或磁盘基线，不增加全局编辑冻结。无自动watch、正文自动刷新或F-028c撤销策略；离线留最终人工。

## 源码核对与依赖

- `client/workspace.ts`当前每次state/page请求立即publish，generation变化清空nodes；周期refresh每轮仅取一页，不能直接承接后台稳定接受。
- `shared/workspace.ts`当前为严格字段白名单；沿已有workspaceRequest增加最小操作，不把路径、文件身份链或可篡改内部对象交给renderer。
- F-027c已提供私有候选、单调operation、幂等接受/query、完整安全复扫及Root-local open屏障；后台成功不等于前端完整快照成功。
- OBL-005/016本片局部承接前端代次隔离、完整读取与受控重扫；OBL-011延期，完整watch与父F-027继续开放。

## 本轮最小技术方案

1. **重扫操作身份先于可提交请求。** 只对complete根走受控prepare/issue→accept→query。renderer先取得并保存服务签发的opaque operation，再发送可能提交的accept；prepare/issue响应丢失不发生树提交。accept超时后只查原operation，不再签发新operation重试，不以未知当失败。pending/unknown保留原operation及准确提示，后续重试优先查询同一操作；已确认rejected或committed后才结束本次。未解决操作不能被普通轮询悄悄替换或新重扫覆盖。明确预算淘汰后unknown不可重执行，必要时保留未知状态而非猜结果。
2. **最小严格RPC。** 经现有workspaceRequest路由只扩所需受控操作及有限结果；验证requestId、root opaque handle、operation的session/安全整数序号及准确字段集，拒绝路径/多余字段/伪造身份。后端不接受renderer指定inventory、generation发布值或任意执行方法。prepare/issue、accept/query各结果清晰区分，不用通用成功roots伪装接受结果。
3. **单一刷新暂存。** transport请求先验证且不publish。先捕获全部roots的generation、初始entries=N、meta、coveredHandles和assetEpochs；源码核对同generation扫描只追加不可变前缀，因此每根仅读取[0,N)，N=0不请求页，最后页可验证后截至N。不等待全部根complete，不因其他根持续追加而饥饿。每页及最终state核对根集合/代次/hidden不变且entries>=N，允许同代status/examined/errors/entries增长；缩短或换代拒绝。最终一次publish初始捕获meta/coverage/assetEpochs和完整前缀，绝不混入后页覆盖信息；下轮补增长。轮询、select、hidden、rescan、prioritize及clear不得旁路发布半批数据。错误/取消丢弃staging保留旧快照，不无限同步循环；这不是正文/授权/磁盘全局事务快照。
4. **结构与资源校验。** roots/handles唯一，分页cursor必须严格前进且恰等于累计长度，节点总量与entries一致；拒绝跨页重复handle、未知或文件parent、自指/循环、跨根parent、混代/缺页/多页，根和节点预算共同有界。old快照、暂存页、验证索引的持有量一并计预算；沿当前有界元数据策略保守核算，不将RSS或I/O时长宣称硬封顶，不提前扩容掩盖失败。旧树过大导致无法安全暂存时明确拒绝并保留旧树。
5. **状态与焦点。** 原子提交后复用树现有有效handle保留/失效回退逻辑；不按同路径猜同身份，不异步强抢用户已移走的焦点。现runWorkspaceAction的protect可能全程freeze，故重扫增加专用短preflight：protect只完成save settlement及成功标志，finally解冻后重新检查生命周期/IME/操作可用性，再执行长扫描；不改变select/hidden/clear原保护。不持全局写锁或全程freeze，新保存如令候选变化则安全拒绝。正文授权、scope、baseline、undo不随目录变动刷新；coverage与nodes同批提交避免独立叶短暂消失或重复。
6. **失败与生命周期。** 清理/隐藏/根吸收/撤权/dispose使旧任务及暂存失效；后端仍使用单Worker、有界候选及回执。前端dispose后不得发布/继续轮询，clear不能让迟到页复活旧根。未知accept只查原operation，UI快照刷新失败与后台已提交分别显示，绝不把已提交改写为未提交。非complete根显式restart保持原恢复行为，不作为complete失败的fallback。

## 最小happy path及异常验证

- 真实Node-API与RPC集成：完整根经已有重扫接线，新增/删除/替换后完整接受；stable handle保持、替换新handle，伪造/过期operation拒绝，同op重复不二次提交；超时/丢回执只query原op。
- 客户端模拟多页>128节点：每页到达时监听者不见半批或空树；完整一次publish且roots/nodes/coverage/assetEpochs一致，选择/展开有效句柄保留。所有refresh调用途径均覆盖，不仅手动重扫。
- 持续增长B根不阻止A根发布：N=0、末页越N截断、同代缩短拒绝；发布捕获coverage，B中新覆盖独立叶不能因后页新coverage提前消失。pending保存先结算后解冻，长重扫pending时允许输入/保存；settlement失败不启动扫描，其他workspace action屏障保持。
- 缺页/重复/循环或非法parent/混代/cursor不前进/预算不足/最终state变化拒绝原子发布，旧状态保持；dispose/clear/hidden及root失效晚回执不复活。结果unknown不签发新op、不fallback restart。
- 原生WK必须实际加入根、打开文档并制造临时未保存标记与选区；磁盘增删临时节点后点击重扫，验证新增/删除、有效选择展开/焦点、同名/独立叶覆盖及正文dirty/选区/undo保持。多页主要由集成测试证明，不把工具延迟当性能。
- 本片真实WK重扫失败提示、正常重扫路径、深浅外观及最终退出按本轮实际覆盖留证；无法自然制造的race用受控测试，不冒充原生实操。测试样本不保存用户正文，退出放弃临时标记遵循已有授权与确认。

## 继承约束与最终人工

- 中文与外观：中文重扫/失败/未知状态，深浅主题实际验证，不增加新的布局或主题产品决定。
- 命令与键盘：沿现有按钮/键盘激活，不新增命令，不改Space/Enter或编辑器IME/选区/历史。
- 安全与日志：opaque能力严格校验，不记录正文/路径日志，不扩大根或资源授权。

F-002本轮仅读取本地目录元数据，不改Markdown磁盘正文，不联网或运行任意脚本。界面沿中文现有重扫入口，新增失败/未知提示须准确；无新快捷键或最终排序规则。性能不提前设门禁，记录真实扫描/暂存成本，不能把全根扫描称增量优化。不默认TDD，批准后实现，独立Spec/Standards及实际WK验收分列；版本/构建/Git由主线执行。

稳定最终人工入口：`F-027d-offline-final`，目录受控重扫及原子呈现离线可用性留最后统一人工，未执行、不宣称通过，不断网或修改系统网络。

## 当前记录

2026-10-05：F-027c已主线提交推送`d80171040089facd4950790814eeeb69cff34012`，远端main同SHA、当时工作树干净。按连续授权选定F-027d可见纵向闭环，当前仅最小方案，待主线批准与独立核对后编码；前轮权限测试首红未归因、F-028c待专项决定和完整父/离线义务继续开放。

### 2026-10-05 实施检查点

主线及独立方案核对后实施captured同代前缀与短preflight。最小RPC实际为prepareRescan（prepare+issue，绝不提交）、acceptRescan、queryRescan，沿已有workspaceRequest严格字段验证；先保存签发operation再accept。accept发出后即使查询为issued也仅查询，不重发accept或新issue。query响应不调用syncAssets扩权，其附带目录数据不直接发布。

评审预读指出并修正：未决操作不能阻塞所有目录refresh；query明确拒绝要结束pending；poll确认committed后分页失败也必须保留已提交事实。另一预读发现350ms静态轮询不能全量重下载树，现静态相同元数据只state请求且保留nodes引用；同代增长复用已验证前缀只取新增suffix，换代仅重读变化根；仍计旧快照、暂存引用/索引、临时页与新节点预算。RPC读回root hidden同代突变亦拒绝，不能复用错误策略前缀。

初始旧测试依赖逐页可见和clear仅一响应，随统一staging改为完整原子断言与真实clear后state语义；新props测试接线缺失导致首轮typecheck失败，补齐runRescan；初次lint三处导入/await matcher/可选链已修。新增hidden策略guard后，一个mock未换generation失败，修正mock遵守原有hidden增代规则；失败保留，不声称产品问题。专项曾50项/359断言/4文件/1030毫秒通过，日志`/tmp/agentic-f027d-targeted-initial.log`，后续又补实际client→RPC→Native目录安全重扫、完整原子观测与稳定handle验证。

独立Standards当前0阻断，独立复跑56项/410断言/1279毫秒及diff通过；尚待最终Spec、末次全量、主线alpha.95构建和真实WK完整验收。未修改版本、未构建/操作UI或Git；主线预备的`/tmp/agentic-f027d-ASrFfi`样本未由执行者修改。

末次源码已冻结交主线：typecheck/lint退出0，全量775项/19683断言/126文件/14.73秒，日志`/tmp/agentic-f027d-source-tests.log`。双轴当前均0代码阻断，最后RPC闭环及同代隐藏策略guard已通知复核；构建、真实WK及本片验收仍未完成，不执行Git。

### 2026-10-05 alpha.95 实际失败与提示保持修复候选

主线真实WK中两根均complete，将不承载当前正文的临时beta目录移动为beta-held后点击beta重扫：AX无变化、后续截图未显示error，旧树及dirty保持。该次未取得失败提示瞬时出现的直接UI证据，不声称原生已确认具体时序；alpha.95本片未通过，临时目录现场由主线维护。

执行者按diagnosing-bugs构建最小真实client回归：prepareRescan返回ok:false后，先断言error已出现，再执行3次普通refresh，期望仍保留原错误。命令`bun test apps/desktop/src/client/workspace-atomic.test.ts --test-name-pattern 'failed rescan preparation'`修前0通过/1失败：预期“目录更新未完成，保留上次可见结果；请重试。”，实际null。该证据排除enqueue finally先清空和错误未进入client；源码确认prepare失败只由enqueue写state.error，普通refresh以rescanNotice=null覆盖。

局部修复仅将显式rescan失败同时写入rescanNotice，普通轮询可更新树但不等于用户重试，不清除该失败确认；成功重扫或clear才清除。未知原operation仍仅query，已提交但显示失败仍保留其准确文案，无正文/树授权/保存变化。回归覆盖静态poll及meta变化poll保留、成功重试清除，修后1项/5断言通过；无临时诊断日志。独立双轴及typecheck/lint待收尾，主线下一代码包应递增alpha.96，当前未验收不得Git。

### 2026-10-05 alpha.95 完整历史补证（不是alpha.96复验）

- 构建成功，日志`/tmp/agentic-f027d-build95.log`；包`/tmp/agentic-markdown-alpha95.idZPkK/Agentic Markdown-canary.app`，hash `9rz8mex7qeum`。包内Bun运行仓库测试775项/19684断言/126文件/14.76秒，日志`/tmp/agentic-f027d-packaged95.log`；与源码19683断言分别记录。
- 真实WK PID `93685`：加入临时alpha根，打开cover（139字节，磁盘SHA256 `5de8ab038c8d455dd4a5f889f98ddbebff236a40f4665404bd5a8144aef59161`），将KEEP替换为DIRTY，选中marker；section展开且选中。主线新增added.md，将remove.md移出根并保留为remove-retained.md，点击重扫后added出现、remove消失，section展开/选择保持，焦点在重扫按钮。截图显示marker灰色选区仍在；CmdZ恢复clean KEEP、CmdShiftZ恢复dirty DIRTY成功。
- 加入beta及独立loose（47字节）；beta新增同名cover后重扫，loose保持选中及clean正文，原cover dirty标签仍在。仅这些实际路径有证据，不外推到全部并发或未知回执情况。
- beta临时移动为beta-held后点击重扫未见可见error，是上述未通过项；随后主线已恢复beta，不留根被移走作为后续测试前提。
- CmdQ出现未保存确认，选择继续编辑；切cover标签CmdZ恢复clean KEEP，同时观察到一次“命令执行失败，请重试”toast，原因未确认，不推断是撤销失败或忽略该观察。随后CmdQ正常退出，PID 93685已不存在；cover磁盘SHA256仍为上述原值，没有保存临时DIRTY内容。

alpha.95的局部成功证据与失败同时保留，不当作alpha.96验证。新包仍须复验失败提示保持、相关恢复及最终退出；当前未验收、不得Git。上述均为主线真实操作，文档作者本次仅追加记录、未修改源码/版本/样本。

后续独立Spec补发现noncomplete根显式restart成功后未清持久提示的遗漏；主线暂缓alpha.96构建。新增真实client回归首次/再次restart失败保留提示、成功响应后清除，修前0通过/1失败（成功后仍旧错误）；仅在request成功且未被生命周期取消时清rescanNotice，失败及unknown不作成功。修后相关27项/199断言/3文件/103毫秒通过，日志`/tmp/agentic-f027d-notice-final-tests.log`；此次只有client局部条件及回归测试改动，不改版本/构建/Git，仍待主线新版实际验收。

### 2026-10-05 alpha.96 实际复验与最终候选

- 最终源码全量777项/19691断言/126文件/15.02秒，日志`/tmp/agentic-f027d-source96-final.log`。构建成功，日志`/tmp/agentic-f027d-build96.log`；包`/tmp/agentic-markdown-alpha96.ve64q2/Agentic Markdown-canary.app`，hash `1fs5ohv4fubnx`。包内Bun运行仓库测试777项/19692断言/126文件/14.86秒，日志`/tmp/agentic-f027d-packaged96.log`，与源码断言差异按实录保留。
- 真实WK PID `95018`，同隔离应用数据目录、非faultlab。beta完整扫描且有两叶；临时移为beta-held后点击重扫，明确错误持续存在，多次观察及设置切浅色后的截图均保留旧树，红色文案可读。恢复beta并新增recovered.md后再次重扫，新叶出现且错误消失：新版失败提示保持及显式成功恢复已有实际证据。
- 打开beta/cover（65字节），将beta替换为BETA-DIRTY-96并选中；重扫后dirty、选中cover及重扫按钮焦点保持，截图marker灰色选区可见。新增final-added.md，将recovered.md移出根并保留为recovered-retained.md，重扫正确呈现增删，正文仍dirty。CmdZ恢复clean beta、CmdShiftZ恢复dirty，再CmdZ回到clean。
- 恢复固定深色设置值已实际核对；重扫按钮Return后界面未变化，此观察不单独证明发生新generation。CmdQ无弹窗正常退出，PID 95018已不存在。
- beta磁盘完整原文已读回，当前SHA256为`9cb60378e126fb0e50fc685a6f71c5cd59d2e872f87f84ab801f155dcb194030`；本轮未取得该文件操作前hash，不伪称前后hash比较。alpha cover原SHA256仍为`5de8ab038c8d455dd4a5f889f98ddbebff236a40f4665404bd5a8144aef59161`，未改变。

alpha.95多根、独立叶和展开保持是前版局部证据，不冒充alpha.96逐项重做；alpha.96承担窄修失败/恢复及同模块实际回归。运行中的长扫描、自然IME、真实竞态未实操，由受控测试覆盖相应边界，不当作自然操作证明；系统主题动态跟随未实操。alpha.95一次命令失败toast原因仍未知，本轮未见不等于已修复。F-027d-offline-final、完整父功能/OBL-005/016、延期OBL-011、自动watch及F-028c待定范围仍开放。

当前整理为非离线受托Agent代验完成候选，待最终独立证据复核与主线确认；不标用户亲验，不预写正式通过或Git结果。文档作者本次仅整理主线实际证据，不修改源码、版本或样本。

### 2026-10-05 正式非离线本片结论

最终独立verifier确认0剩余阻断，主线正式确认F-027d alpha.96非离线本片受托Agent代验通过，非用户亲验。通过范围为完整根现有重扫入口的安全候选接受、统一有界分页原子更新、失败提示保持/恢复及本轮已记录的编辑状态回归；上方候选、alpha.95失败及各次测试记录保留历史，当前结论不将旧版局部证据改写为新版操作。

父F-027、完整OBL-005/016、延期OBL-011、F-027d-offline-final、自动watch及F-028c待专项产品决定保持开放。实际长扫描/自然IME/race、动态系统主题及未归因toast边界不扩大。Git待主线实际执行和远端核验，不预写成功。

2026-10-05 Git实际回执：主线已提交推送`a6355381d8e22a32b5bb413c3c8ad07c77e30cbc`，远端main同SHA、当时工作树干净。本回执仅覆盖已验收F-027d，不外推为后续研究或实现已提交。
