# DSH Rolling Skill 用户旅程审计

日期：2026-09-01  
对照版本：Electron App `0.9.3`  
首次检查插件：DSH `0.1.34`  
状态：实施中

## 本轮安装验收进展（0.1.35 → 0.1.62）

本轮实现由主 agent 亲自完成，不再委派子 agent 写代码。下表只记录已经操作过的安装版页面，未完成的恢复/批量分支不标绿。

| 旅程 | 安装版操作与结果 | 仍未通过/未覆盖 |
| --- | --- | --- |
| J1 连接 | 0.1.37 已加载 Raw Case 后停止 Host；5 秒健康探测显示断开；离线点刷新仍保留 Case 与“内部报表”筛选；重启后恢复连接 | 初始离线进入的自动恢复已加行为回归，0.1.39 浏览器复验待做；跨全部长任务恢复尚未全覆盖 |
| J2 原生沉淀 | 原生 DSH 对话→限定范围→Draft→自然语言修订→保存通过；第二段仅冻结两条 Item。0.1.44运行中丢弃后按钮恢复；0.1.50后台自动保存后，无重载计数1→2、按钮变已保存、绿色范围均实测；0.1.52窄屏按钮89.7×30px保持单行 | Bad Case、删除回收未全部覆盖 |
| J3 自动沉淀 | 0.1.47 来源 DSH→Codex Luna/max 检测→Codex Sol/high Curator→自动保存全程3分11秒。0.1.50 关闭Host后17:26系统启动Worker，17:28:46保存第三条Case，17:28:54正常退出；游标保留，上次成功只在保存后更新。0.1.51后台占用后工作台自动恢复已实测；0.1.53无新增扫描1.1秒，重启后7.3秒，无重复Case | Linux/Windows无真实 OS 运行证据；多失败恢复仍未覆盖 |
| J4 Raw Case | 两个受管 Skill 筛选与空态；新增/搜索/编辑；多行备注；新建默认沿用当前 Skill 筛选；保存后不再被旧搜索藏住；0.1.36 从 Raw 派发后自动打开真实 DSH 新会话并完成回答 | 当前会话派发、并发编辑冲突、自动 Raw→人工审核保存仍需安装版覆盖 |
| J5 Draft | 原生捕获→自动审核→自然语言改摘要→保存并进入 Case 详情通过；修订期间保留上一有效 Draft。0.1.43 第二段实际 Curator Sol/high 与保存配置一致；查看 Draft 不再叠着捕获弹窗 | 第一轮捕获漏传 profile 而用了 xhigh，已修且以新任务复验；重启恢复和模型不可用分支未全覆盖 |
| J6 Dataset/Case | 独立验收 Dataset 已有3 Good Case（手动1、自动2）；详情内部滚动，实际CSV导出；0.1.60单条更新经DSH执行→独立Codex Sol/high整理→自动跳转Draft→审核保存通过，同一Case ID/问题不变；批更新3条均创建并到达待审核 | 批更新尚未保存；批校准、回收语义、CSV混合Good/Bad筛选尚未本轮全程操作 |
| J7 安装 | Codex同名冲突保留App目录未覆盖；独立新Skill经Git URL导入→Agent编辑→Diff审核→发布→DSH安装→原生会话加载通过。1.0.1又完成3次真实DSH重装；0.1.68新鲜页面验证默认不选目标、按目标模型/强度、首活动等待说明、可读活动名和可信安装记录 | 系统文件夹选择器受工具限制未操作；覆盖冲突、ZIP和远程Git授权分支未覆盖；模型目录尚未按本机Provider凭据预过滤 |
| J8 Rubric | 独立 Dataset：生成→自动到达审核→自然语言修订标题→发布 v1 已通过。gpt-5.6-sol/xhigh 保持不变，全程无需点刷新 | 真实失败→重试、discard、旧 contract 迁移和发布后批校准未全覆盖 |
| J9 评测 | DSH GLM-5.3 Target + 原 Codex Terra/xhigh Judge 实际4Case自动激活运行；0.1.41四条执行和评分全部完成，UI无需刷新。Trace/Skill-read/no-tool/not_applicable已获得实际分支证据；0.1.43另修description误匹配script | 0.1.43词边界修复有回归但未再次重跑整轮；Judge失败单项重试、跨Host中断恢复、多Runtime对比未全覆盖；旧分数保留 |
| J10 自操作 | 0.1.47增加明确资源范围、21项权限、7项预算；只读任务读取结果、Artifact预览、追问、暂停→恢复→取消通过。0.1.52新任务保存并展示Luna/high，实际读出3Case并回复，明确区分本轮回复完成和任务授权仍开启，之后取消 | 高风险审批、预算耗尽、重启恢复未覆盖 |
| J11 自动优化 | 真实3Case基线/评分、暂停→恢复、隔离编辑、候选安装、候选评测、拒绝发布、自动恢复均走到可核验终态；结束Run只读Markdown报告在0.1.64安装版通过，没有伪造Artifact | 令牌/费用无法可靠累计，未冒充可用；其他停止规则、失败接管和跨Host恢复仍未形成完整矩阵。仍未全量App parity通过 |

### 可追溯的真实任务

- 验收 Dataset：`DSH 全流程验收 0901`，`a6dfda70-83f7-4f50-853d-2d1910e9c1c9`；只写入本轮测试内容。
- Rubric：`90ba65da-9d5d-427c-b650-0f288d671122`。14:34:57 开始，14:40:50 自动进入审核，14:42:51 完成自然语言修订，14:45:25 发布 v1。生成约 5 分 53 秒，有真实 Runtime 活动；不是 UI 卡死，不为缩短等待改模型/强度。
- 原生 Raw 派发：`【DSH 原生派发验收 0901】这是`，15:08–15:09，GLM-5.3、Skill 调用可见，18 秒完成离线 JSON；没有执行外部操作。
- Codex 安装：`ede5fb79-3ff4-4cd4-8185-d938d2a89a78`，14:38:13–14:42:53，现存目录内容相同但标记属于 App 仓库，未覆盖。后续发现原生 Case 沉淀不应要求 Curator Runtime 重装来源 Skill，已按 DSH 来源安装记录修正，而非绕过安装审计。
- 旧显式评测：`80b35c3f-d1f0-4c81-a13a-3c288100fabf`，4 Target + 4 Judge 完成，但不能认定评分正确；当时 Trace 噪声和规则误推断可能影响分数。
- 0.1.37 自动评测：`26c577d7-f76a-4cd9-a577-6e4beda77f01`。4 Target 完成；2 Judge 成功、2 Judge 失败。实际 Tool 调用存在，但公开 DSH tool-result 没有 private meta，Skill-read 漏识别。保留失败审计。
- 0.1.39 自动评测：`d81cd511-c724-4e62-a812-166b08858a36`，15:32:59开始，3 Judge成功（96.2/92.8/96），1失败（不适用项误要求工具证据）。旧审计保留。
- 0.1.41 自动评测：`eac8421f-4aa6-406a-b69c-8f3f882e126d`，4 Target与4 Judge均completed，97.3/96.4/100/100；UI自动到终态。高分不等于全量功能验收或模型泛化结论。
- 原生 Curator：`f84f43b9-bb3a-4fac-a5d6-564cade2df34`，自然语言将参考摘要改为“P1，内部日志检索降级但无客户影响。”并保存，Dataset现有1 Good Case；第一次漏传profile实际xhigh而非设置high的问题随后发现并修正。
- 0.1.43多轮Curator：`e84680ca-3647-4bf4-bb4d-fc4535c6efb7`，保存/实际参数均Sol/high，原问题570、回答1044、边界570–1046；Skill加载99/100仅作为继承身份上下文，不作为本Case工具执行。
- 导出文件：`/Users/wangbaoheng/Downloads/DSH-全流程验收-0901-goodcases.csv`，input/output两列，1个新验收Case；原数据集与原评分标准未改。

### 本轮查明的根因与修复边界

1. 后台任务状态不变时只轮询一次；Rubric/Curator 改为持续更新，安装和评测详情也跟随列表进展。
2. 离线刷新先重挂页面再请求，清空了“承诺保留”的旧数据；改为成功加载后才重挂，并对空闲页面做轻量健康探测。
3. Raw 原文派发直接用裸 Agent 创建接口，缺 DSH 标准 preset、模型、权限和会话导航；改用宿主正式 Session create/prompt/open 入口。
4. 手工沉淀的来源 Runtime 与 Curator Runtime 混用；改为绑定来源安装证据、独立保留 Curator 配置和对话 Runtime。只读已保存安装记录，不引入实时目录/hash 校验。
5. 当前 Case Trace 把流式 token/重放投影当关键事件，挤出真正 Tool 证据；真实 847 条记录重放为 32 条语义记录、815 条噪声压缩、关键遗漏为 0。Case 边界不扩到整个会话。
6. 公开 DSH skill tool-result 不带内部 meta；使用成功且相关联的真实工具结果识别 Skill-read，失败/未配对结果不能算成功读取。
7. 评分门禁从历史 evidenceBasis 推断新任务必须执行工具，且把 no-tool 禁令识别成正向调用要求；现在历史依据不增加执行要求，禁用工具条目需要完整 Case Trace 证明未调用；正向脚本执行条目仍要求真实调用证据。原 Rubric、Case 和旧分数均不改写。
8. 手工 Raw→Draft 可能被自动沉淀管理器误接管自动保存、Case refresh 新建 manager 会中断已有 Curator；分别限制自动任务归属并复用共享 manager。
9. 原生捕获未传入插件保存的 Curator model/effort；补齐传递，新真实任务effective值确认为Sol/high，而非Runtime默认xhigh。
10. Case详情读取了不存在的顶层rubric/operationEvidence/episode字段，实际数据在rubricVersionId/evidence.operationEvidence/source；改为结构化中文预览及真实来源字段，不改写存储。
11. 宿主portal Modal的限高只覆盖少数页面；为插件detail/form正文统一限高、内部滚动，原生DSH弹窗不受影响。
12. 第二段没有新Skill调用时捕获失败；从可信历史工具结果继承Skill身份，单独冻结skillContext，不拉入历史Case消息，不改变原生Skill触发与执行。
13. 不适用评分项仍被要求正向工具执行；改为回答+完整Case Trace证明适用性，权重不变。英文script缺少词边界还误命中description，造成冗余Judge校验重试；0.1.43加词边界，并保留脚本执行正向约束。
14. 自动扫描会重复请求无新增回复的 pending 会话；保存消息完成状态的 inspectionSignature，只有新消息或回复完成才再次检测，并展示真实检测阶段/已查会话数。
15. 检测器将真实用户关于 Rolling Skill 故障的请求仅凭主题判为内部任务；明确按任务来源/用途判断，不能按关键词排除真实案例。生成式内部任务仍排除；0.1.50 补齐新版检测提示词前缀，避免重启后扫描自身检测记录。
16. DSH 来源、检测 Runtime 与全局 Curator Runtime 解耦；自动 Case 仅接管显式标记的自动 Draft，进程重启不自动收走手工 Draft。Host 启动不突袭补跑历史计划；只读可信安装记录，不新增实时 Skill/hash 门禁。
17. Worker 与 Host 不允许同时打开同一组缓存数据存储；后台 Worker 等待属于本轮的 Curator 保存后才报告成功。受控 DSH 子进程只注册证据读取端点，不再启动第二个业务存储/定时器。
18. 每条原生消息各自一次性查询标记，后台保存无法刷新；0.1.48 同会话共享一次请求与5秒轮询，断线保留标记，释放最后订阅后停止轮询。
19. launchd 只有系统 PATH，`.bin/rolling-skill-worker` 的 env-node shim 退出127。0.1.50 注册绝对 Node+worker.cjs、显式 source workspace，并给 Runtime 子进程保留 Node PATH；状态区不再掩盖系统启动退出码。Worker 与 application 共享扫描状态实例，完成/失败都不覆盖新游标。

### 0.1.44–0.1.50 新增真实证据

- 丢弃：Curator `2e0c90c4-237d-4ca1-b8ed-a1aaee0335db`，运行中放弃后 cancelled，原生无需刷新恢复按钮；第一段已保存标记保留。
- 自动保存：来源 `session-e6658c5c-e406-4e14-848e-a5e0036dfb02`，实际用户故障复盘第二段；17:00:57.786 点击运行，198会话检查、2次分析；Curator `90129c3c-fc7b-4ecd-a08f-9d88d3331002` 17:02:37.435开始、17:04:08.496归档；17:04:09.100才报告成功。
- 自动 Case `939bf036-afc9-453a-8381-75ec7d401331`，Raw `7a946517-03d4-4060-b19f-3ebc119a6a70`。只冻结事件1530–2064的2条消息；Skill加载124/125仅作继承身份，原第一段正文不混入。Curator saved/effective均Sol/high。
- Operator `d0a3f3ff-c207-4467-9891-2a7249eb6721`；Job `fba8c628-2fb0-4ef7-b986-f943b2a414b9`。仅context.read/datasets.read、测试Dataset+incident Skill、无Target Runtime，10分钟/4轮/0评测/0Target/0Judge。实际读取后Artifact `step-74668580-ed62-4db0-b965-02fc773a0ddf.json` 可展开，追问成功；暂停、恢复、取消后Job cancelled。effort=null 的旧事实保留，不倒填修复后参数。
- 17:24，0.1.50安装页面实际显示旧系统退出127；通过页面保存17:26计划后确认plist使用绝对Node、正确worker.cjs及原工作目录，错误清除；关闭Host等待系统定时验收（结果待追加）。
- 后台结果：17:26:05.744由launchd启动Worker PID53939（父进程1），源DSH与检测Codex子进程正常启动。Curator `564f1f32-5243-4a81-a6af-e4ce086b7738` 17:28:03.112开始、17:28:46.719归档，saved/effective Sol/high；新Case `c1980d96-6acd-42e0-9f1e-a7fc2365393c`、Raw `81a5ff6f-e318-491c-b44b-2ccf2a1dae72`。Worker17:28:54.398 completed，系统exit0，游标最后检查Item `760f03cb-6da2-4fd8-970f-93172c98f65d`与signature保留，无覆盖回退。
- 未重载原生会话：第三段从“沉淀Case”变“已沉淀Case”，标题已沉淀范围从1→2，截图绿色左边框/背景可见；同时发现窄屏原生按钮继承宿主图标按钮宽度而三行折字，下一版改独立最小内容宽度。
- 0.1.51：后台占用是HTTP503而不是断网，健康恢复没有connection事件，导致原工作台错误页不重试；补健康成功后对DATA_BUSY的初始页面自动重载。设置初始加载前隐藏默认表单/保存动作，防止误覆盖；Operator/Skill编辑协议提示词排除防止自捕获。
- 0.1.51后台复验：17:33:05.784系统启动，17:34:08.817结束；原工作台先显示等待，完成后无需点击自动恢复，Case仍3条。无新模型调用，但旧会话全文读取耗时约一分钟，因此继续优化软件开销，而不改变模型参数。
- 0.1.52自操作 `7790bb39-5bf7-4006-b802-745656d06aad` / Runtime线程 `01a05c53-86e2-7d92-afb3-e9d5ba0e0f08`：Luna/high、仅context.read/datasets.read、10分钟/4轮/其他执行次数0；实际返回3Case与摘要可读性，两句回复；任务已取消，产物保留。
- 0.1.53增量扫描：只有闲置且有真实修改时间的DSH会话提供sourceRevision；成功检查后持久化，失败/运行中/无可靠时间均不跳过。17:39:03.430–17:39:26.097第一轮建立198条记录；17:39:48.573–17:39:49.672下一轮1.099秒、0分析调用；重启后17:40:23.155–17:40:30.421检查198会话、0分析调用，未重复Case。已恢复原Codex来源、原Dataset与每日20:00。

### 包与数据保护

0.1.54–0.1.59 自动优化的安装版验收暴露了仅靠局部测试没有发现的接线问题，失败任务均保留，不能把以下修复当作整条流程已经通过：

- `3482bd12-2a27-482d-a5e1-1dabb37fcc72`：子任务未传父任务冻结预算，真实启动失败。补真实 JobStore/JobEngine 适配测试和预算继承。
- `d529b81f-8228-4f68-acbc-b30c6036473c`：基线版本使用 `versionId`，候选使用 `id`，丢失安装绑定。统一身份并使用已保存的正式安装记录，不新增运行时扫描/哈希门禁。
- `5b9bc51a-71a8-4841-9148-ce410e1cec5a`：3条基线执行，Judge两条完成、一条容量不足。原先仍进入优化，且取消无法结束待提交请求。现缺分会明确失败；取消/退出会解除等待；安装版重启后取消成功。
- `254c6396-d87e-4d29-a82b-e6507e2bba31`：18:15:41启动，基线 `1b8a3ef0-cf2e-435c-94e5-6e63866f11e9` 的3执行+3Judge全部完成，89.5/92.7/59.9。Operator Luna/high实际编辑隔离SKILL.md，但新增checkpoint字段未加入控制协议、授权会话ID被误当持久Operator ID，导致读取/提交失败。0.1.58修复协议和可信会话身份。
- 该任务暂停后恢复又暴露真实存储的状态门禁：保留的editing轮次被误判为倒退；异步准备异常被吞掉。0.1.59允许继续未提交的同一轮次但仍禁止安装阶段倒退，准备失败同步返回并停止孤立Operator。原任务30分钟预算到期后经UI取消，未延长预算，隔离草稿保留，未创建候选/安装/发布。
- 0.1.59同时给Agent提交等待加剩余时间上限，避免没有提交时无限显示编辑中；这是回归验证，尚无真实耗尽验收。
- 18:55:30启动新任务 `baf3bb46-21b6-4d2a-aba2-88e08340835a`：独立3Case Dataset、Operator Luna/high、Target DSH GLM-5.3、原Judge Terra/xhigh；固定1轮，60分钟，20轮Agent对话。结果继续记录，未擅自批准正式发布。
- 0.1.58安装版评测详情截图：633px窄窗口，高831/top16，首屏版本1.0.0、Rubric名称、执行/评分3/3、Target/Judge模型、第一条得分可见；审计信息折叠，内容内部滚动，未改历史评分。
- 文件夹导入验收尝试被自动化工具限制：系统选择器不在可控制App列表，Codex窗口禁止computer-use，已停止尝试，不绕过限制，也不将CLI导入算成UI通过。临时来源 `/tmp/rolling-skill-import-0901.hI2aNr` 尚未导入，不影响现有Skill。

0.1.59：6文件、1,153,841压缩字节、6,780,971解压字节。384项Core/DSH/优化及Operator回归通过，build/inspect通过。安装与构建SHA一致：client `b1ed8b8b2df95ccae3778dd696dd06566da47c3d83e5c3baef0909f9fa5a4d4d`，host `e3936a25e045797243bd93c1f67dab879a9349213b539b83d84493a6594d5f10`，worker `8df8223b91c637bda3bf047f6d3dde24dc52f20c95e34df75ed012e584b3bbe3`。完整用户旅程仍未全绿。

0.1.60新增实测与修复：

- 0.1.59新加的等待计时调用误传Run对象，而Core接收`{runId, epoch}`，使 `baf3bb46-21b6-4d2a-aba2-88e08340835a` 在基线完成后失败。这是本轮新增回归，不归咎于模型或旧版；0.1.60修正参数并让测试核对实际适配签名。
- Case单条更新原先把执行Runtime DSH直接用作Curator，但Curator模型仍为保存的Codex Sol/high；真实Draft `be743bb2-f6a6-498c-bf95-bd28b3379b05` 失败为provider-qualified model错误，页面还没有自动打开失败Draft。通过UI丢弃该失败测试Draft，原Case不变。
- 0.1.60把执行与整理Runtime分开，保留任务和Curator的模型设置。页面执行中持续提示，返回后直接进入Draft。批更新保留前面已创建Draft，后续单项失败不再让整批结果消失，并展示Draft入口、跳过和失败数。
- 单条更新复验：`14698dc6-372b-4126-9e85-a1a53e1a6255`，DSH执行后19:05:27启动Codex Sol/high Curator，自动显示进行中及待审核，19:07:56经UI保存；只更新测试Case `6510b1d0-033a-49ba-970e-bc1107f85898`，Case ID、原问题不变，测试Dataset仍3条、calibration=current，原Dataset4Case时间戳仍8月27–28日。
- 当前安装0.1.60：6文件、1,154,607压缩字节、6,784,698解压字节；391项Core/DSH及相关领域回归通过，另全部共享desktop领域1180项通过（只是补充证据，不替代UI旅程）。build/inspect和安装SHA核对通过：client `8c6becbff6aa7e7b25908939b8cc9575e0f7b3f45e04ec0d7e6f7086bcfbbb0e`，host `4f4fc417ad601e5f33342204345a69fea0cd2d8ddd53208048de93d4a6cb507e`，worker `2d49465ceaec2fd85cb4a6a0f87fbf8905a90c06e8e6e954099b2905add6280a`。

0.1.53：6文件、1,143,464压缩字节、6,729,493解压字节，不含Electron；inspect及全Core/DSH+相关共享Runtime回归通过。安装SHA与构建一致：client `018d4c9412d54ac8c700afbef24a1258585b743c7905b51f2f1f3d7aac2a9edf`，host `faee834cffd82f7226f9d8893ea8ad263bdd49007dc9e9275ed4e64cf134ca0c`。原4Case更新日期仍为8月27–28日，未改写。

0.1.60–0.1.61 追加真实证据：

- 批更新Draft：`c1176dd8-712e-46c5-8585-1bc82f0efde9`、`8d24f867-45b4-478f-a87a-f59d8df068e1`、`79a93829-00cf-47dd-8e6e-70043d8b1eae`，19:10–19:11创建，均使用配置的Sol/high并到达needs_review；UI显示3创建/0跳过/0启动失败和审核入口。没有保存，不改冻结中的优化数据集。
- 优化 `fb29c6f8-3d18-46a3-a06e-1876cf646a8b`，19:09:19开始；基线 `17cc9ea5-8a7e-4ae2-a4e4-834c118ba047` 完成3执行+3Judge。暂停后经UI恢复，轮次仍为 `2025e94b-f813-4e50-9c94-9179c5e719cb`，未重复基线；新Operator `83d922e9-b173-4e59-98ef-c7a2b09c8397` 在隔离目录修改SKILL.md，19:14:45成功提交候选 `83143350-1139-4741-83c3-9aa2ecb323a2`（未发布）。
- 只读检查 `7d932aa9-118a-4f10-b7e1-a22e92b3f047` 19:14:45–19:22:44：旧普通管理标记摘要为59位十六进制、少了`05364`，但实际两个Skill文件与15a8574e基线逐字节一致。模型将普通标记误填入实验标记字段，导致解析报“Before experiment marker is invalid”；旧UI只显示通用未验证。流程自动failed，父Job也failed；没有覆盖/发布/恢复动作，不能算恢复验收通过。
- 0.1.61保留不可信结果的失败说明（仍unverified，绝不升为成功）；严格按来源身份提取诊断，不接受成功、外来身份、多个结果块或超长文字。优化持久化当前安装操作/Job IDs/等待状态，增加阶段文案和直达任务入口；恢复后不再公开旧pauseReason。提示词明确普通/实验标记区别和用JSON序列化冻结值。
- 本地数据修复仅管理标记：主agent用`git show <冻结commit>:<文件> | cmp`确认SKILL.md及agents/openai.yaml与基线一致；备份到`~/.dsh/rolling-skill/backups/incident-response-planner-marker-before-0901-audit-repair.json`后补回丢失的5字符。未改Skill文件、原Case、Rubric或旧安装审计，不把这次人工修复当UI安装成功。
- 0.1.61已安装并核对构建/安装SHA：client `6cabf5ab3c1f55682f01beb87a722aebf31e8935ecf729a96b068781802c3583`，host `04d9fa2c9e07d91c1bd8d35d055d5d73388bb0b83d272605096f0eb3725107df`，worker `c0b8898ec26c5c3e21d2d6aac6d413c070ca8f08364b470dd4895b871c2af4d1`。6文件、1,156,182压缩字节、6,791,459解压字节，421相关测试通过。共享全套首次1182/1183：失败在测试子进程未退出即清临时目录的ENOTEMPTY，修正测试清理顺序后复验待记录。
- 19:30:13经UI预检/启动新Run `1df9942c-ee82-4e4b-9bf1-de15a9294246`，同一测试Dataset3Case；Operator Luna/high、Target DSH GLM-5.3、Judge Terra/xhigh，1轮/60分钟/20Agent轮。原配置未变；尚未正式发布。

0.1.62追加：

- 上一Run在19:37:18失败：基线`adcfe01a-f001-48f3-bc1e-d594c0a14f12`完成，候选`43d3636d-4033-43df-a29b-d15ab79ae141`已生成；只读检查`d7327cf1-973a-44f4-8406-649108c3f613`确认目录与修复后的旧标记均正常，却按错误模板填destination=null、actualDigest=Candidate、markerWritten=false。解析器要求已有基线绝对路径、基线摘要及现存普通标记。这是提示词与解析协议不一致，不是Skill质量失败；未发生试验安装。
- 0.1.62对齐managed-clean/absent模板，明确markerWritten在只读检查中表示现存普通标记已验证，而非本轮新写入。只读检查的无效结构允许同模型、同只读权限纠正一次，沿用原剩余超时，仍失败则unverified；写入操作不自动重试。原输出、纠正说明、第二次输出保留在消息审计中。
- 0.1.61安装版真实观察到新的检查阶段提示以及从优化详情进入准确的安装Job；不是仅有UI测试。0.1.62进一步保证恢复/失败状态不会被旧pending标志覆盖，当前轮次标题同步真实阶段。
- 安装活动接口曾把真实`command/status/name`投影掉，导致界面只剩commandExecution。0.1.62明确输出有界活动字段，仍不暴露无关私有属性；安装版旧Job详情已显示“试验安装检查（只读）”“执行命令·已完成·时间”，展开能看到真实`ls -la ...`命令。
- 评测详情默认收拢评分依据，每项完整标准另设展开；保留分数、原始Judge理由、证据引用，翻译正式通过/直接判失败条件/已核验等界面状态。0.1.62安装版截图验证633px窄窗口中能连续看到Case结果卡片；展开评分后原始说明仍在，未改写历史分数或Rubric。
- 0.1.62包：6文件、1,158,475压缩字节、6,800,640解压字节；436项相关回归通过，共享领域1185/1185通过；build/inspect/diff-check通过。构建与安装SHA一致：client `b47b5891482b16a1dcd019cc81cd8683736fc26936840940364f476983a03dbf`，host `582ca2d3eb0972c72285723d5c550c7cd058476cc3883e114dfe9f45a30d7896`，worker `6bdd80e21f29152d3e72c4cfe3a2f88a60535193bec687408f31e1d66a2d22d5`。
- 19:44:30经UI启动`4c8ce8aa-7552-49eb-b6e0-8d6b033d9353`；基线`07c999e9-260d-428e-bab3-453da9a1ef85`，Operator`5b4e6789-fce0-4d9e-bb43-17296a73eacd`，同一隔离Dataset与模型配置，结果继续追加。此时原4Case时间戳仍8月27–28日，配置仍Curator Sol/high、Rubric Sol/xhigh、Judge Terra/xhigh。
- 本轮基线3执行+3Judge完成，87.6/89.1/59.9。只读检查`6f16d46d-8c08-4af0-a0e5-a99563424d77`在19:52:38成功，正确报告已有基线/普通标记，未触发格式纠正；随后自动进入试验安装`ff51dde1-85a6-40e1-b000-548ae99e6d9b`。安装模型误抄仓库路径一位后反复搜索控制器记录与历史trace，耗时显著；冻结请求原路径正确，不把模型自述的路径差异当成真实配置错误。20:09实际候选文件及独立实验标记已写入，仍等待最终结果/后续评测与恢复，不提前算完整通过。

0.1.63准备中的实测修复（尚未替换运行中的0.1.62）：

- 文件夹选择器的工具边界仍未绕过。改用界面自带Git URL入口输入独立本地fixture `file:///tmp/rolling-skill-import-0901.hI2aNr`，20:03:12导入成功；这是Git URL导入证据，不是文件夹选择器证据。新Skill `rolling-skill-journey-note-0901` / `427201a4-7608-449a-988c-cc2ce3f3c06d`，受管仓库`3b838cd1-6027-41c4-ab6c-7dab2f160375`，不改原Skill。
- 编辑`eed259b3-c364-403c-8c32-c6f732a7f5b6`：配置的Codex Sol/high，20:03:48启动，20:04:44待确认；第二轮自然语言只改标题，20:07:10完成。界面审核SKILL.md Diff后20:08:08“应用修改并发布新版本”成功，发布测试版本1.0.0 / `26c04db7-c543-4286-a011-c8753d7b4a32`。未发布incident优化候选。随后20:08:53经UI向DSH发起普通安装`15171e6f-a1b1-4171-a4c8-cb32e698ed8f`，结果待记录。
- 真实界面新增发现：编辑对话把内部英文包裹指令标成“你”、需求重复；继续编辑的Runtime `starting`误显示待确认并短暂开放旧Diff应用；发布成功后仍显示“Agent还没有返回消息/没有文件变更”；选择新Skill时安装审计混进旧Skill记录。0.1.63分别修正首次展示投影（原审计保留）、starting/restoring忙碌状态、发布成功后的假空态，以及按当前Skill过滤安装矩阵和任务。
- 试验安装提示明确只读取指定仓库、目标、标记与Runtime库存，不搜索控制器存储/旧对话/源码；精确复制请求值，不推测替代路径；试验保留已有普通管理标记，只用独立实验标记表达候选。此限制尚未真实执行，不能声称已经解决安装耗时。正常Case/评测仍只信任下发记录，没有新增实时hash门禁。
- 439相关回归通过；包检查6文件、1,159,298压缩字节、6,803,187解压字节。当前安装仍0.1.62，先让活跃试验恢复，不能中途替换Host冒充已安装。
- 后续0.1.63追加修复与重建：发布测试Skill后其Operator `84bd4c40-7e5e-4ee1-8160-b6ce5cdb5b76`仍运行、隔离目录却已清理，20:15:53经自操作页面取消遗留任务。修复为发布后先停止编辑Runtime再清理；停止失败保留已发布版本和工作区并明确告警。安装提交后直接打开新建Job，避免按钮悄悄复位；审计查询也传当前skillId。最终440相关回归通过，共享1185/1185；最终0.1.63包6文件、1,159,660压缩字节、6,804,638解压字节（仍待安装）。
- 新Skill安装`15171e6f-a1b1-4171-a4c8-cb32e698ed8f`在20:13:28 succeeded，DSH GLM-5.3/默认强度，Runtime库存已发现。20:18原生新会话显式调用该Skill，10秒完成，实际Skill调用可见，最终“已知事实：报告已生成，但尚未复核。下一步：未知。”；无外部操作。
- 优化候选安装20:11:04 succeeded后自动开始`094a995c-4e32-4f67-8daf-517c1e69fd88`，3执行+3Judge完成，96.2/98.2/96.2，平均96.866667，较同轮基线+18分，0执行/评分失败。20:14:17自动进入发布审批，20:15:08经UI明确拒绝；没有正式发布候选，自动进入恢复`3697beb4-34ae-457a-b6fb-22104aae99e1`。恢复尚未完成，不能记为完整恢复成功。小型验收集得分提升不代表普遍泛化能力。
- 20:24:59恢复Job succeeded（experiment-restored）、Run和父Job均cancelled，recovery=null。主agent再次用git show/cmp逐字节确认SKILL.md及agents/openai.yaml与基线一致，普通标记身份/摘要正确，实验标记不存在；incident仅原1.0.0为released。拒绝正式发布→自动恢复这条真实分支通过，未把取消标成优化发布成功。
- 随后真实终态“生成报告”失败且提示被弹窗挡住。进一步查明在创建Artifact时就被真实OperatorJobStore的终态门禁拦截，未产生报告（不使用最初“已经写出”的误判）。0.1.63改为对结束Run从冻结证据派生只读Markdown预览，artifactId=null，不伪造持久化、不修改结束Job；运行中仍沿用持久报告。同步控制协议和弹窗内错误提示。该修复等待安装版同一结束Run复验。

0.1.64–0.1.68续验：

- 0.1.64安装版重新打开已取消的优化Run `4c8ce8aa-7552-49eb-b6e0-8d6b033d9353`，点击“生成报告”后弹窗内完整显示只读Markdown。报告如实写明发布被拒、候选未发布、恢复Job与Run最终取消；没有伪造持久Artifact。0.1.63末尾的报告阻断已关闭。
- 旧1.0.1普通安装记录曾在30分钟后以`INSTALLATION_TURN_TIMEOUT`失败，详情只有用户消息。0.1.64用同一发布版本重试：Job `957fe52e-ddee-4ad8-a180-93188433bf01`，10:44:35开始，10:53:53成功；前态为`managed-clean`，安装后版本`1918f200-0273-4c68-ac8e-a7e6dc397e5f`、commit `b751ada31d58…`、digest `sha256:d7c05fc4…cc5aa0`，可信矩阵更新为`runtime-inventory`。这次约9分18秒，不再把旧失败推断为文件丢失或固定超时。
- 用户视角仍有三个真实缺陷：开始后约90秒没有首条可见活动；DSH的todo/read等活动被投影成`dynamicToolCall`；安装页无法为每个目标Runtime单独选择模型/强度。0.1.65增加首活动等待说明，保留DSH活动`title/tool`，并为每个已选Runtime提供独立模型/强度配置且实际下发；回归先红后绿。
- 0.1.65新鲜安装页又暴露出首个Runtime（本机为Codex App）被自动勾选。验收没有点击安装、没有改App；0.1.66改为默认不选择任何目标，Runtime失效时只移除失效选择。安装版复验中四个Runtime均未勾选且提交按钮禁用，只有用户显式选择后才开放。
- 0.1.66安装版选择DSH后约5秒加载真实模型目录，可见DeepSeek-V4与GLM系列，并可独立保留选择。选择DeepSeek-V4-Flash/Low时因本机未配置该Provider凭据立即失败，页面明确显示缺少`DEEPSEEK_API_KEY`，没有假运行或假成功；当前目录仍会列出未配置凭据的模型，作为后续UX问题保留。
- 0.1.66改用GLM-5.3重试：Job `df16d60e-0e96-4f09-af16-8de62e7e89aa`，10:58:48开始，11:07:09成功，约8分21秒；等待阶段真实显示“首个可核验活动完成后会显示在这里”，后续Read/Grep/Load Skill均显示具体名称，不再退化成`dynamicToolCall`。版本、commit、digest和Runtime库存再次核验一致。
- 正常安装提示词此前仍让Runtime搜索控制器Job存储、历史会话与trace。0.1.67把普通安装/检查的读取范围限制为冻结仓库、精确目标/标记和Runtime库存，并优先复用可信安装目的地。Job `293d497d-8f85-4ebf-a032-eeea8b888031`，11:08:12开始，11:13:50成功，约5分38秒；比0.1.66少2分43秒，且不再搜索控制器存储/旧Job/历史trace。首活动仍约59秒，等待说明只解决可理解性，不把模型思考冒充为即时响应。
- 0.1.67结果还暴露出冻结证据带入当前Job的`lastJobStatus=running`等易变字段，导致Runtime生成无意义警告。0.1.68只向安装提示传递绝对目的地和稳定可信身份/摘要/安装时间，不再传当前Job易变状态；该改动先有失败回归再修复。
- 0.1.68新鲜安装页在清理旧验收页后正常加载：工作台、1.0.1版本、可信安装矩阵和历史Job均可读；四个Runtime默认未勾选且安装按钮禁用，显式选择DSH后才加载独立模型/强度控件。没有点击Codex App安装，也没有修改App。
- 0.1.68最终全量回归：DSH 221/221、共享桌面层1190/1190；build、package inspect与`git diff --check`通过。包为6文件，1,162,035压缩字节、6,814,261解压字节；tarball SHA256 `aa746c5c03e7ae3fae8f3ac5703a95ea1951004ad2c3b6321496b0075b74b40f`。构建与安装SHA一致：client `e331f290b5a772cbdcf5643c53d5cbc291b46d7eef3d817f8b74d8881aeceaaf`，host `e5970c272bee89300c2ed93b703b28b33ad0b4e51a39a55cca99559c52a03587`，worker `e4f55df88531b567c2b4531cf77a63642578540c12d2b03e20486992cc7dd3b1`。

0.1.43包含6文件，1,130,847压缩字节（约1.13MB），不含Electron。package inspect通过；安装文件与build SHA256一致：client `1961e91abd7868eacf3e6b404dd98ad46810cf58c9225226b17b43fb53e19e56`，host `53a4c1378d9b5b062a3cc2c264a0701fbdecbe28276c893cc0ccdd0a3c5e4c10`。Core/DSH与相关共享Runtime回归通过、git diff --check通过；这不是用户旅程的替代证明。保留 `.dsh/rolling-skill` 原数据、原模型设置及其他插件；未公开发布，未更新App安装包。

**整体状态仍是实施中，不是全量 App parity 验收通过。** 下方“0.1.34 结果”和横切表是首轮基线，不代表修复后的当前状态。

## 证据规则

- `native`：DSH 原生承接，仍需插件兼容回归。
- `complete`：安装后的 DSH 页面已完整跑通。
- `partial`：有入口，但配置、执行、结果或恢复不完整。
- `broken`：用户流程被阻断、假卡住、假成功或数据不可达。
- `intentional`：明确批准且不影响任务完成的差异。

“源码里有组件”“API 能返回”“小型测试通过”均不能单独把页面标为 `complete`。

## 首轮真实环境

- 页面：`http://127.0.0.1:3080/?rollingSkill=0.1.34`
- 宿主：DeepSeek Harness `0.1.1-rc.1`
- 数据：1 个受管 Skill、1 个 Dataset、4 个 Good Case、已发布 Rubric v1
- Runtime：2 个 Codex、1 个 CodeBuddy、1 个 DeepSeek Harness
- Baseline：`npm run test:dsh`，156/156 通过；`npm run build:dsh` 成功

这份 Baseline 只能证明现有自动化没有失败，不能证明以下用户旅程可用。

## J1 工作台进入、连接与刷新

### 用户目标

从 DSH 侧栏打开工作台，在服务可用、断开和恢复时知道当前状态，并能刷新当前任务。

### App 基线

App 通过 Runtime state/notification subscription 显示连接、错误和持续更新；页面级刷新不依赖用户猜测服务状态。

### DSH 0.1.34 结果

- 侧栏入口和近全屏 Overlay 可用：`native`。
- DSH Host 退出后，已打开工作台保留陈旧内容；切换子页后每页单独显示原始 `Failed to fetch`：`broken`。
- 没有统一“Host 已断开”状态、重连入口或最后成功数据保留策略：`broken`。
- 顶部刷新会重新加载 Dashboard 并重挂当前页面；此前“只刷新 Dashboard”的怀疑经源码验证不成立。

### 证据

2026-09-01 12:03 首轮页面扫描期间，3080 Host 退出；自动沉淀、Raw Case、Draft、Case、Dataset、Skill、Rubric、Evaluation、Operator、Optimization 页面均出现 `Failed to fetch`。`curl` 返回连接失败，旧 Rubric 画面仍保留。

## J2 对话中沉淀 Case

### DSH 0.1.34 结果

- finalized Assistant 回复的 Good/Bad 按钮、已沉淀按钮和范围颜色可见：`partial`。
- 当前会话实例显示 1 个已沉淀范围，且原生 Skill/Think/JSON 节点未被替换：已获得单例 UI 证据。
- 多 Turn 起点选择、丢弃/删除后的实时颜色恢复、重新打开 Draft/Case 仍需真实矩阵：`partial`。

## J3 自动沉淀

### DSH 0.1.34 结果

- off/scheduled/automatic、运行位置、日/周、时/分、Runtime/模型/强度和 Skill→Dataset 目标均有控件：`partial`。
- Host 断开时所有下拉退化为空，页面只显示 `Failed to fetch`；没有保留设置或重连解释：`broken`（归入 J1 共性根因）。
- 保存、立即运行、后台调度启停和长任务终态仍需真实操作：`partial`。

## J4 Raw Case 分诊

### DSH 0.1.34 结果

- 代码具备受管 Skill 筛选、搜索、新增/编辑、可读 Episode Evidence、创建 Draft、原文派发和移除：`partial`。
- 多 Skill、自动来源范围、所有操作反馈和窄屏尚未安装后完整跑通：`partial`。

## J5 Draft 审核

### DSH 0.1.34 结果

- 活动/归档分类、结构化 Draft、自然语言修订、保存和放弃入口存在：`partial`。
- Curator 详情使用与 Rubric 相同的一次性 `setTimeout` 依赖：若第一次 1.5 秒轮询时服务端 `status/revision` 未变化，Effect 不再重建，页面永久停留在运行中：`broken`。
- 原始证据和审计已默认折叠；模型仍是任意文本输入，不是 Runtime 模型目录：`partial`。

## J6 Dataset 与 Case 生命周期

### DSH 0.1.34 结果

- 创建/绑定 Dataset、分页、Good/Bad、单/批 refresh、批量校准、CSV 导出和删除 API 均有 UI 入口：`partial`。
- 删除使用浏览器原生 confirm，无法呈现 App 的问题回收语义；批处理持续进度和失败接管尚未真实验证：`partial`。

## J7 Managed Skill 导入、编辑、版本与安装

### DSH 0.1.34 结果

- 文件夹/ZIP/本地 Git 可信选择器、Git URL、Agent 编辑、Diff、自动发布、版本历史、多 Runtime 安装和交互 Broker 均有入口：`partial`。
- Skill Edit、Installation 各自实现轮询和反馈，状态/错误/诊断层级不一致；全流程尚未安装后重跑：`partial`。

### 0.1.68 当前结论

- Git URL导入、Agent编辑、Diff审核、发布、DSH安装、Runtime库存发现和原生Skill调用已形成真实安装版闭环；1.0.1的3次DSH重装也均到达成功终态。
- 安装页现在默认不选择任何Runtime，按显式目标提供独立模型/强度；首活动前有等待解释，活动名称可读，可信安装记录与当前Skill隔离展示。
- 系统文件夹选择器、ZIP、远程Git授权、覆盖冲突等分支仍未形成真实UI矩阵；未配置凭据的Provider模型仍会出现在目录中，因此J7整体仍为`partial`，不能按单一成功路径标成全部完成。

## J8 Dataset Rubric

### 复现

1. 在“评分标准”选择 Dataset。
2. 输入生成要求并开始。
3. Rubric 后台 Codex 任务运行 113.8 秒并完成。
4. API `rubrics.list` 返回 `needs_review`、`working:false` 和有效 Draft。
5. DSH 页面仍显示 `running` 和“评分标准生成中…”。

### 根因

`RubricPanel` 和 `RubricSessionView` 都使用只触发一次的 `setTimeout`。第一次请求若仍返回相同 `status/updatedAt/revision`，React Effect 的依赖没有变化，因此不再安排下一次轮询。

### 状态

- 后台跨 Runtime Rubric 生成已真实成功。
- 用户页面无法自动到达审核：`broken`。
- App 有持续 activity subscription；DSH 必须提供等价的持续轮询和明确终态。

## J9 Skill Evaluation

### DSH 0.1.34 结果

- 目标 Runtime 与 Judge Runtime/模型/强度分离；automatic/explicit、Case 范围、Run 列表、结构化 Judge/分数/Trace 代码入口存在：`partial`。
- 安装后真实 Run 的启动、等待、取消、结果、Case 限定 Trace 和删除尚未完整跑通：`partial`。

## J10 自操作

### DSH 0.1.34 结果

- Runtime、模型、目标、Skill/Dataset、Session 列表、审批、消息、Artifact 和控制 API 有入口：`partial`。
- 相比 App，DSH 配置明显更轻，预算/scope 的可见完整性和真实恢复尚未验证：`partial`。

## J11 自动优化

### DSH 0.1.34 结果

- Dataset/版本/Runtime、preflight、start/pause/resume/cancel/report 入口存在：`partial`。
- App 中 activation、Judge、预算、停止规则、epoch timeline、候选对比和 approval 的完整程度未在 DSH 页面得到等价证明：`partial`。

### 0.1.64 当前结论

- 候选安装→候选评测→发布审批拒绝→自动恢复已经真实完成，基线文件与普通管理标记恢复一致，候选没有正式发布。
- 已取消Run的“生成报告”在安装版弹窗中显示冻结证据派生的只读Markdown；`artifactId=null`，没有伪造持久Artifact，也没有把取消状态改写为成功。
- 费用/令牌累计、更多停止规则、失败接管和跨Host恢复仍不完整，因此J11保持`partial`。

## 横切缺陷清单

| 严重级 | 缺陷 | 影响旅程 | 当前状态 |
| --- | --- | --- | --- |
| P0 | 长任务只轮询一次，后台完成但页面永久运行中 | J5、J8 | broken |
| P0 | Host 断开后每页显示原始 `Failed to fetch`，无统一恢复 | J1–J11 | broken |
| P1 | 页面把“存在 API/按钮”当作能力完成，没有真实终态证据 | J3–J11 | partial |
| P1 | App Push activity 在 DSH 中没有可靠等价机制 | J5、J7–J11 | partial |
| P2 | 英文状态、ISO 时间、内部 ID/digest 直接作为主信息 | J4–J11 | partial |
| P2 | 原生 confirm、空 select 和短暂按钮禁用造成不可理解交互 | J3–J11 | partial |
| P2 | 原 parity manifest 用生成 ID 和泛化测试把未验收项标绿 | 全部 | broken（审计可信度） |

## 本轮退出条件

- 所有 P0 关闭并在安装后页面复现通过；
- J1–J11 每条都有 installed-browser 结果；
- 没有无解释的 `broken`；
- 核心任务不存在“只有按钮/API，但无法从配置走到结果”的 `partial`；
- 完整测试、build、package inspect、安装 SHA 和真实浏览器矩阵均有新鲜证据。
