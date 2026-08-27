# Rolling Skill Electron → DSH 完整能力迁移账本

日期：2026-08-27  
状态：基线盘点完成，待用户复核与实施证据回填

## 1. 用途

本账本是 DSH 迁移的完成闸门。它统计的不只是 Electron 页面按钮，还包括：

- `desktop/rolling-skill/renderer/index.html` 与 Renderer 事件流；
- `window.rollingSkill` Preload API 和 Electron Main handlers；
- Shared Core、Manager、Store、Worker 和系统调度器行为；
- 持久化、恢复、并发、审批、追问、错误与 destructive recovery；
- Electron、Core 和 DSH 的现有自动化测试。

归档 Electron 分支与 `main` 的 Renderer/Preload/Main 用户能力基线一致；当前分支差异集中在 Managed Skill Dataset/Installation 领域修复，因此以下账本同时约束两个版本。

当前基线共 **136 项**：Shell/会话 12、原生对话沉淀 11、Dataset/Case 16、Curation 12、Rubric 8、Managed Skill/Installation 12、Evaluation 11、自动沉淀 11、Operator 9、Optimization 7、Settings/分发 10、DSH 专属集成 5、横切质量 12。新增能力或盘点发现的新状态流必须追加新 ID，不能塞进旧 ID 后不增加总数。

### 1.1 机械盘点输入基线

| 来源 | 2026-08-27 基线 | 统计含义 |
| --- | ---: | --- |
| Electron Renderer `id` | 276 | 页面、抽屉、对话框、表单、状态和操作锚点 |
| Electron `window.rollingSkill` Preload 方法 | 128 | Renderer 可调用和可订阅的完整桥接面 |
| Electron Main `ipcMain.handle` | 81 | Electron 专属可信后台入口 |
| Shared Core DSH dispatch 方法 | 55 | 当前 DSH Host 已公开的业务方法 |
| Electron/Core/DSH 自动化测试 | 1,165 | 当前已有的行为、安全、恢复和分发测试（1088 + 41 + 36） |

这些数量不是完成证明，只用于发现源面变化。实施阶段的 parity contract 必须保存并比较**名字集合**，把每个 Renderer 业务入口、Preload 方法、Main/Core handler 和 DSH Agent Tool 映射到本账本 ID；仅让总数碰巧一致不能通过。

## 2. 状态和证据规则

| 标记 | 含义 |
| --- | --- |
| `N` | DSH native：宿主原生承接，插件不得破坏 |
| `C` | Conversation extension：DSH 原生对话 additive slot |
| `W` | Rolling Skill 独立工作台 |
| `B` | Host/Worker 后台能力 |
| `S` | Settings 中的低频插件配置、导入或诊断 |
| `D` | Intentional difference：必须有理由和用户批准 |

实施状态只能是 `baseline`、`red`、`green`、`ui-verified`。最终完成要求每个 ID 至少为 `green`；用户可见项还必须为 `ui-verified`。`N` 项也要做宿主回归，不能因为“不需要开发”就跳过。

## 3. Shell、任务和原生会话

| ID | Electron 基线能力 | DSH 承接 | 验收重点 |
| --- | --- | --- | --- |
| SH-01 | 新建、选择、刷新当前任务 | N | 插件安装后 DSH 新建/切换仍可用 |
| SH-02 | 当前/归档任务列表、归档与恢复、归档只读 | N | 插件不接管会话存储；真实 UI 回归 |
| SH-03 | Workspace 选择、名称和精确路径显示 | N/S | DSH workspace 原生；插件设置只显示自身数据根 |
| SH-04 | Runtime 检测、显式选择、自动选择和重启 | N/S | DSH 当前 Agent 由宿主管理；Rolling Skill operation Runtime 独立选择 |
| SH-05 | 每任务 model、effort、permission mode 与默认 Profile 分离 | N/S | 会话由 DSH native；Curator/Rubric/Judge defaults 属于插件 |
| SH-06 | 发送、中断、失败恢复和 composer 固定布局 | N | 安装插件后行为不回归 |
| SH-07 | Runtime permission 与 ask-user-question 原生交互 | N/B | 前台宿主承接；后台 installation/operator 仍需自身处理 |
| SH-08 | 用户/助手 Markdown、安全链接和本地路径打开 | N | 不替换 DSH message renderer |
| SH-09 | Tool、command、context、subagent 和 reasoning activity | N | Case 标色不得遮挡、重排或截断这些节点 |
| SH-10 | Trace 查看、刷新和诊断目录 | N/S | DSH Session log/轨迹原生；Rolling Skill frozen trace 在诊断中可定位 |
| SH-11 | 会话草稿、滚动位置和加载更早历史恢复 | N | 插件状态恢复不得触发跳动或强制全量加载 |
| SH-12 | 中英文化、浅色/深色/自定义主题适配和可访问标签 | N/W/C/S | 插件跟随 DSH locale/theme，并补全自身文案 |

## 4. 原生对话沉淀与来源区间

| ID | Electron 基线能力 | DSH 承接 | 验收重点 |
| --- | --- | --- | --- |
| CV-01 | 每条 finalized Assistant 回复可“沉淀 Case” | C | `conversation.chat.assistant-actions`；进行中回复不出现 |
| CV-02 | 选择连续来源起点，终点固定为当前回复 | C/B | 起点来自 Host 完整日志，支持未加载的更早历史 |
| CV-03 | 选择 Dataset、Good/Bad 和可选问题说明 | C | Dataset 必须匹配 Managed Skill 且有 Published Rubric |
| CV-04 | 创建前显示可操作阻断，不产生半成品 Draft | C/B | 边界、Rubric、Installation、重复请求全部前置校验 |
| CV-05 | 冻结 user/assistant/tool/turn/step/usage 完整 Trace | B | `readSession` 原始事件切片和 digest，不接收 Client 正文 |
| CV-06 | 处理 compaction/replacement 与 Session lineage | B | `traceEvent` 保存来源链；`traceSession` 只作 lineage |
| CV-07 | Draft 来源区间 warning 标色和终点状态标签 | C | 跨节点/跨 Turn、刷新和加载历史后恢复 |
| CV-08 | 已保存 Case 来源区间 success 标色和终点状态标签 | C | 已保存优先于重叠 Draft |
| CV-09 | “再次整理”、打开 Draft/Case、重复创建保护 | C/W | `sessionId + endMessageId` 幂等与明确状态 |
| CV-10 | 丢弃 Draft、删除 Case、保存 Case 后标记实时更新 | C/B | 状态订阅或有条件刷新，不残留幽灵颜色 |
| CV-11 | DSH 升级移除稳定 flow key 时 fail-visible | C | 兼容性测试失败并退化为状态标签，不错误标区间 |

## 5. Raw Case、Dataset 和 Case

| ID | Electron 基线能力 | DSH 承接 | 验收重点 |
| --- | --- | --- | --- |
| DC-01 | Dataset 列表、计数和按 Managed Skill 创建 | W | 只提交 `repositoryId + skillId`，不提交 Runtime path |
| DC-02 | Legacy Dataset Skill 绑定迁移与显式修正 | W/B | 唯一可信映射才自动迁移；歧义 fail closed |
| DC-03 | Dataset 删除前将问题批量回收到 Raw Case | W/B | 用户可选恢复；批次失败则不删除 Dataset |
| DC-04 | CSV 导出 all/goodcase 与 curated/original 模式 | W/B | 空集 headers、最终 Assistant、缺失原始答案提示 |
| DC-05 | Case 列表、分页、Good/Bad 筛选和结构化详情 | W | 问题保持 verbatim，显示 evidence/rubric 绑定 |
| DC-06 | 单 Case 删除前回收问题或显式永久删除 | W/B | destructive confirmation 与原子性 |
| DC-07 | 单 Case refresh：重放不可变问题并生成 Review Draft | W/B | 使用当前 Skill、保留历史 baseline、拒绝重复活动任务 |
| DC-08 | Good Case 或全部 Case 批量 refresh | W/B | 串行、进度、停止、跳过、失败保留和人工接管 |
| DC-09 | Raw Case 按 Skill 分组、计数、搜索/空状态 | W | 自动来源与手工来源均可辨识 |
| DC-10 | 手工新增 Raw Case，问题 verbatim、Skill、note | W/B | 使用稳定 Skill 身份，不接受路径 |
| DC-11 | Raw Case 编辑 question/Skill/note 与并发版本校验 | W/B | compare-and-set，避免覆盖后台更新 |
| DC-12 | Raw Case 删除 | W/B | 就地确认、状态立即刷新 |
| DC-13 | Raw Case 来源 Runtime、置信度、结果和完整性证据 | W | 自动捕获候选可追溯 |
| DC-14 | 有完整 Episode 的 Raw Case 直接创建 Draft | W/B | Dataset/Skill/Rubric/Installation 前置闸门 |
| DC-15 | 无完整 Episode 的 Raw Case 原问题验证/运行 | W/N | 通过 DSH 原生新会话按原文发起，成功后再沉淀 |
| DC-16 | dispatched 状态、重复待处理问题检测和当前/新鲜操作 | W/B | 仅在真实派发或持久化成功后更新 |

## 6. Curation Draft 生命周期

| ID | Electron 基线能力 | DSH 承接 | 验收重点 |
| --- | --- | --- | --- |
| CU-01 | 从对话区间、Raw Case、Case refresh 创建 Draft | C/W/B | 三种入口共享同一冻结证据和 Curation contract |
| CU-02 | 从 Rubric calibration 创建 Case review Draft | W/B | 保留 Case baseline 与新 Rubric 版本 |
| CU-03 | 活动 Draft 和归档 Draft 列表、计数、选择与跳转 | W | 刷新不丢 selection，支持直接 deep link |
| CU-04 | 来源问题、回答、边界、Runtime/Version/Installation/Rubric 证据 | W | 只读显示冻结值，不读取当前路径冒充历史证据 |
| CU-05 | Good/Bad 结构化 Draft 预览与 Rubric coverage | W | Bad Case 必须有 failure analysis 和可执行 recurrence deductions |
| CU-06 | Curator 对话修订、连续 revisions 和最新有效 Draft | W/B | Client 不直接编辑受约束 JSON |
| CU-07 | Curator model/effort 独立选择和 effective 值显示 | W/B | requested/effective 分离，切换不清空未发送输入 |
| CU-08 | compact live reasoning/activity，不泄露巨大工具输出 | W/B | 高频更新合并、DOM 不抖动 |
| CU-09 | retry、运行失败、无效 revision 和中断后恢复 | W/B | 保留最后有效 Draft，错误可操作 |
| CU-10 | 保存为 Case/归档，只允许 `needs_review` 且通过校验 | W/B | exactly-once，陈旧 Dataset/Rubric 拒绝 |
| CU-11 | discard：停止/清理 Agent task，不写 Case | W/B | 与启动/恢复竞态安全，失败可重试清理 |
| CU-12 | 单个/批量 calibration 的串行、暂停和人工接管 | W/B | 每个有效 Draft 只归档一次 |

## 7. Dataset Rubric

| ID | Electron 基线能力 | DSH 承接 | 验收重点 |
| --- | --- | --- | --- |
| RB-01 | 当前 Published Rubric、版本历史和发布时间 | W | 旧版本只读，active 明确 |
| RB-02 | Legacy split-layer Rubric contract 迁移 | W/B | 显式操作、校验失败不覆盖旧数据 |
| RB-03 | 为 Dataset 创建/修订 Rubric Agent Session | W/B | 选择同一 Managed Skill 的 Released Version 和可信安装 |
| RB-04 | Rubric criteria、权重、scoring model 结构化预览 | W | 总分和 contract 校验明确 |
| RB-05 | Rubric 对话修订、revisions、model/effort | W/B | 保留最后有效 Draft和未发送输入 |
| RB-06 | retry、失败恢复和 discard | W/B | 后台 task 清理与 Curation 同级稳健 |
| RB-07 | publish 新版本并切换 active | W/B | 冻结 Version/Installation/commit/digest；exactly-once |
| RB-08 | 发布后 Case calibration 状态与批量入口 | W/B | current/stale/pending 状态、串行和停止 |

## 8. Managed Skill 与 Runtime Installation

| ID | Electron 基线能力 | DSH 承接 | 验收重点 |
| --- | --- | --- | --- |
| MS-01 | Repository 列表、详情、计数和 rescan | W/B | managed root 边界和状态错误可见 |
| MS-02 | 从本地目录或 Git URL 导入 Repository | W/B | 复制/clone 到受管目录，拒绝逃逸与非法仓库 |
| MS-03 | Skill 列表、详情、描述和 Repository 归属 | W | 使用稳定 ID，不以名称猜测 |
| MS-04 | Candidate Version 创建和 base/变更预览 | W/B | 冻结 commit/digest，脏工作树行为明确 |
| MS-05 | Version release label、Released/Deprecated 生命周期 | W/B | 只有合规 Candidate 可发布；废弃后不能新执行 |
| MS-06 | Repository 在本地显示/打开 | W/S | 只打开后端解析的可信路径 |
| MS-07 | Installation target Runtime 列表和多目标选择 | W/B | Runtime 身份完整，禁止 Client 传 executable path |
| MS-08 | 为确切 Released Version 启动多 Runtime 安装 | W/B | 每个 Job 冻结 Runtime/Version/源 digest |
| MS-09 | Installation Job 状态、日志摘要和详细检查 | W/B | 不把密钥、原始大输出或不可信路径返回 Client |
| MS-10 | Installation Agent follow-up、追问和权限处理 | W/B | 问题 request/resolve、并发和重启恢复 |
| MS-11 | Installation cancel 与晚到事件清理 | W/B | 竞态安全、不覆盖新一代 Job |
| MS-12 | 安装后 marker/digest/内容验证与漂移检测 | W/B | Dataset 仍 pathless；执行证据冻结 Installation |

## 9. Skill Evaluation

| ID | Electron 基线能力 | DSH 承接 | 验收重点 |
| --- | --- | --- | --- |
| EV-01 | Dataset/Case 选择、数量、Good/Bad 范围与 verbatim 问题 | W | 不改写测试问题 |
| EV-02 | Released Version、目标 Runtime matrix 和可信安装 preflight | W/B | 目标 Runtime 与安装 exact match |
| EV-03 | automatic/explicit Skill activation mode | W/B | 显式注入与自动触发证据分别记录 |
| EV-04 | Target model/effort 与 Judge Runtime/model/effort 独立配置 | W/B | Judge fresh session、拒绝其工具请求 |
| EV-05 | Dataset Published Rubric 与 Case addenda 统一 100 分 contract | W/B | criteria 完整，固定 policy/digest 不可篡改 |
| EV-06 | 启动 run、幂等、进度和当前 Case 状态 | W/B | Dataset/Case/Skill evidence 在开始时冻结 |
| EV-07 | cancel 和 delete run | W/B | compact stop control、确认删除、后台清理 |
| EV-08 | Run 历史、分页、筛选和 legacy neutral history | W | 旧结果不伪装成新评分 contract |
| EV-09 | 结果总分、criterion rating/reason/evidence 和自动失败 | W | 不信任 Judge 自报总分；本地确定性计算 |
| EV-10 | Trace/evidence catalog、引用验证和 Artifact | W/B | workflow 分必须引用真实执行证据 |
| EV-11 | duration、超时、错误诊断和安全输出边界 | W/B | 分钟秒展示，超时主动取消目标 turn |

## 10. 自动沉淀与 Worker

| ID | Electron 基线能力 | DSH 承接 | 验收重点 |
| --- | --- | --- | --- |
| AC-01 | off/scheduled/automatic 三种模式 | W/B | 默认 off，切换原子更新 |
| AC-02 | daily/weekly、时间、weekday 和下一次运行 | W/B | 本地时区、跨月/年和 missed slot 折叠 |
| AC-03 | Runtime、Dataset、model、effort Profile | W/B | 自动模式必须有 Runtime；Dataset Skill 路由唯一 |
| AC-04 | 仅 DSH 运行时/关闭后继续运行 execution location | W/S/B | Host timer 与 system scheduler 不重复执行 |
| AC-05 | scheduler capability/status/install/uninstall | W/S/B | launchd/systemd/Task Scheduler；失败原因可见 |
| AC-06 | 手动 run once、运行中 lease 和并发拒绝 | W/B | owner-only lock、崩溃恢复和无重入 |
| AC-07 | 扫描 current/archived Session，排除内部 Agent tasks | B | 分页完整、hidden thread IDs 生效 |
| AC-08 | boundary/outcome 分类、低置信/歧义 fail closed | B | Prompt/parse bounds 和 Skill 路由严格 |
| AC-09 | Scheduled 只保存 Raw Case、游标和 pending tail | B | 先持久化候选再前移 cursor，slot 去重 |
| AC-10 | Automatic 仅在 Rubric 和全部闸门通过后保存 Case | B | 失败保留 Raw Case，保存成功后才 dispatched |
| AC-11 | next run/last run/last success/error 实时状态 | W/S/B | 无需整页刷新，Host/Worker 状态一致 |

## 11. Operator 自操作

| ID | Electron 基线能力 | DSH 承接 | 验收重点 |
| --- | --- | --- | --- |
| OP-01 | 三栏 Operator workbench、Session/Job 列表和详情 | W | selection、空状态和响应式布局 |
| OP-02 | 新建通用 Job：kind、scope、managed Skill/Dataset、Runtime/targets | W/B | capability 和资源归属在后端解析 |
| OP-03 | model/effort、permission grants 和 budget | W/B | 范围、TTL、token/step/tool/time 预算严格 |
| OP-04 | Session transcript、composer 和 follow-up | W/B | 只向对应 Session 路由，未发送文本保留 |
| OP-05 | Job/step 状态、child jobs 和实时事件 | W/B | generation/revision 防止旧事件覆盖 |
| OP-06 | pause/resume/stop/cancel | W/B | parent Session 与 child Job 控制分离 |
| OP-07 | human approval queue、approve/reject | W/B | 只有 Renderer human authority 可决策，漂移后拒绝 |
| OP-08 | Artifact 列表、分页与可信本地打开 | W/B | 路径后端解析，Client 不提交任意路径 |
| OP-09 | capability token、method/action policy 和控制面隔离 | B | secret 不落盘明文、不跨 Session、不泄漏 Trace |

## 12. Optimization

| ID | Electron 基线能力 | DSH 承接 | 验收重点 |
| --- | --- | --- | --- |
| OZ-01 | Dataset/Skill/Released Version/Installation 选择与 preflight | W/B | Dataset Skill 一致、Rubric active、安装可信 |
| OZ-02 | activation、baseline、Judge、预算、模式和恢复配置 | W/B | 必填/互斥字段和错误就地显示 |
| OZ-03 | 冻结 Dataset Cases、Rubric、Skill Version 和 Runtime 证据 | B | 开始后源数据漂移不能静默改变 run |
| OZ-04 | start/pause/resume/stop | W/B | 幂等、停止警告、恢复 epoch |
| OZ-05 | timeline、候选 actions、评测对比和状态 | W/B | 当前/历史阶段可追溯 |
| OZ-06 | 发布前 approval、漂移复核和 release | W/B | destructive/release 动作需要可信人类决策 |
| OZ-07 | report 生成、重复获取和 Artifact | W/B | 报告绑定冻结 snapshot，重复调用一致 |

## 13. Settings、导入、诊断和分发

| ID | Electron 基线能力 | DSH 承接 | 验收重点 |
| --- | --- | --- | --- |
| ST-01 | Curator/Rubric/Judge 默认 model/effort | S | operation 可覆盖，默认值不绑某条 Dataset |
| ST-02 | Automatic Capture Profile 和 execution policy | W/S | 高频调度在工作台，低频权限在设置 |
| ST-03 | language、theme 和 local access | N/S | 视觉跟随 DSH；插件只保存自身必需配置 |
| ST-04 | Rolling Skill 数据根、版本、Runtime 和诊断 | S | 可复制/打开可信路径，敏感信息脱敏 |
| ST-05 | Electron legacy data inspect/import | S/B | 仅显式确认、非空目标拒绝、完整 schema 校验 |
| ST-06 | Electron Runtime plugin catalog/install | N/D | DSH 插件由宿主“插件”页面管理，不复制 Electron Runtime 插件 UI |
| ST-07 | 独立侧栏入口和近全屏 workbench overlay | W | Settings 不再承载完整业务工作台 |
| ST-08 | DSH Host、Client、Worker 一个 Cordis 插件包 | B | 标准 manifest、同源 API、uninstall contract |
| ST-09 | DSH tarball 不含 Electron/Chromium/.app | B | 报告体积和文件清单，不设置任意硬上限 |
| ST-10 | Electron `.app` 独立构建、签名、安装 | D | 只在 Electron 归档分支交付，数据目录与 DSH 隔离 |

## 14. 横切质量与安全语义

### 14.1 DSH 专属集成能力

这些能力不是 Electron 迁移项，但已经由当前 DSH 插件提供，也必须防止后续工作台重构时丢失。

| ID | 当前 DSH 能力 | 承接 | 验收重点 |
| --- | --- | --- | --- |
| DS-01 | `rolling_skill_status` Agent Tool | B | 返回 Dataset/Case/Raw Case/Evaluation/Operator/自动沉淀安全摘要 |
| DS-02 | `rolling_skill_add_raw_case` Agent Tool | B | 问题 verbatim、稳定 Skill 身份、可选 note，不接受路径 |
| DS-03 | `rolling_skill_start_evaluation` Agent Tool | B | Dataset、Runtime、model、effort 严格输入并返回 run 摘要 |
| DS-04 | `rolling_skill_run_automatic_capture` Agent Tool | B | 明确 Runtime、并发 lease、错误有界 |
| DS-05 | 同源 Host JSON API、请求上限和统一错误 envelope | B | 非 POST/错误 content-type/未知方法/超限/关闭后请求全部 fail closed |

### 14.2 横切质量矩阵

| ID | 基线语义 | 承接 | 验收重点 |
| --- | --- | --- | --- |
| QL-01 | Dataset 长期只绑定 Managed Skill identity | W/B | 所有 Client payload 和持久化均无 Runtime path |
| QL-02 | Version/Installation/commit/digest 只作 operation frozen evidence | B | Rubric/Curation/Evaluation/Optimization 一致 |
| QL-03 | 所有 mutation 串行化、idempotency 和 stale snapshot 拒绝 | B | 重试不重复，key 不可复用不同 payload |
| QL-04 | JSON boundary、大小限制、未知字段/方法拒绝 | B | Client 不可传对象原型、路径或任意 evidence |
| QL-05 | 分页、游标和大数据上限 | W/B | Dataset/Case/Run/Artifact/Skill 长列表不截断 |
| QL-06 | 后台状态恢复、晚到事件和 generation 隔离 | B | Curation/Rubric/Installation/Evaluation/Operator 全覆盖 |
| QL-07 | destructive confirmation、问题回收和可恢复错误 | W/B | 删除不因局部失败留下半状态 |
| QL-08 | Abort 只取消 Client 等待，不隐式取消后台 Job | W/B | 关闭 overlay/切换详情行为一致 |
| QL-09 | 主题、locale、键盘、ARIA、窄屏与长文本 | W/C/S | 真实 DSH 浏览器矩阵验收 |
| QL-10 | 安全链接、本地路径、日志/Trace/密钥脱敏 | N/W/B | 后端解析可信目标，不向 Client 暴露凭据 |
| QL-11 | DSH 和 Electron 数据根隔离且不移动/删除用户数据 | B | 安装与升级前后检查 |
| QL-12 | 所有管理 Session/Job 不混入普通会话发现 | B | hidden thread/session inventory 完整 |

## 15. 完成判定与回填格式

实施时为每个 ID 回填：

```text
ID | status | implementation reference | automated test | real UI evidence | notes
```

完成报告必须同时附：

1. 所有 ID 的非 `baseline` 状态汇总，`green`/`ui-verified` 数量和零缺口证明。
2. DSH native 回归、Conversation extension、Workbench、Host/Worker 和 Settings 五类测试结果。
3. DSH 包内容/体积报告，Electron App 构建/签名/安装结果。
4. 任何 `D` 项的用户批准记录；未批准差异一律算缺陷。
