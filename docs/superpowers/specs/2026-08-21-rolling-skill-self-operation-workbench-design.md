# Rolling Skill 自操作工作台设计

## 目标

Rolling Skill 增加一个独立的自操作工作台。用户选择本机已发现的 Codex、CodeBuddy、DeepSeek Harness 或后续 Runtime，并为该 Runtime 选择模型和推理强度；Rolling Skill 随后以明确的 Operator 身份启动 Agent，使其可以通过受控工具编排 Raw Case、Runtime 会话、Case 沉淀、数据集、评测、Skill 修改、Candidate、发布和 Runtime 安装。

这套能力的最终目标是形成可审计的多 Epoch Skill 优化闭环：固定基线、数据集和 Rubric，评测当前版本，分析失败，修改隔离的实验工作区，安装并评测 Candidate，判断是否继续下一轮，最后由用户批准发布和正式安装，再运行一次回归评测。

普通 Chat、被测 Runtime、Curator、Rubric Agent 和 Judge 不获得 Rolling Skill 控制面工具，也不会收到 Operator 身份说明。自操作能力必须与真实 Skill 自动触发和执行评测严格隔离。

## 现状与问题

Rolling Skill 已经具备较完整的内部控制面：

- Raw Case 查询、装填、编辑、删除和派发；
- Runtime、模型、会话、Turn、问题回答和停止；
- Dataset、Case、Rubric、Curator 和 Case 校准；
- Evaluation 启动、停止、查询、判分和历史记录；
- 受管 Skill 仓库、Candidate、Released 版本和 Runtime 驱动安装。

这些能力目前主要通过 Electron preload 暴露给 Renderer。外部 `rolling-skill-tool` 只允许离线装填和查询 Raw Case。普通 Runtime 会话不知道自己位于 Rolling Skill 中，也不能调用上述控制面能力。用户因此仍需手工跨多个页面完成“运行、沉淀、评测、修改、发布、安装、再评测”的流程。

本设计把现有内部能力归一化为一套可复用控制面，再让界面、MCP 和 CLI 使用相同的业务规则。它不是把 Renderer IPC 原样暴露给 Agent，也不是依靠一段提示词让 Agent 自行编辑 Rolling Skill 的本地数据文件。

## 已选择方案

采用 **Tool Gateway + 持久化工作流引擎**：

```text
Operator Agent
      │
 Provider-native Tool / MCP / CLI
      │
Tool Gateway ── Policy Engine
      │
持久化 Job Engine
      │
Control Plane Core
 ├─ Raw Cases
 ├─ Runtime conversations
 ├─ Curator / Cases
 ├─ Dataset / Rubric
 ├─ Evaluation / Judge
 └─ Skill repositories / versions / installations
```

MCP、CLI 和 Electron IPC 只是传输层。参数校验、权限、预算、幂等性、状态机、业务操作和审计只实现一次。

## 明确不做

- 不在 App 中内嵌或固定使用某个 Agent Runtime。
- 不让普通 Chat 或正式被测会话获得 Rolling Skill 控制工具。
- 不让 Operator 直接调用任意 Electron IPC、操作 Renderer DOM 或修改 Rolling Skill 数据文件。
- 不允许优化任务修改被冻结的数据集、Case、Rubric、基线版本或历史评测结果来迎合新 Skill。
- 不用 Prompt 注入 Candidate 正文代替真实安装和自动触发评测。
- 不在第一阶段增加常驻后台 daemon 或网络服务；App 未运行时，只有现有 Raw Case 离线入口可用。
- 不让主进程直接复制 Runtime Skill。Candidate 实验安装、恢复和 Released 正式安装仍由选中的 Runtime Agent 使用自己的工具完成。
- 不承诺在未知、漂移或非 Rolling Skill 管理的 Runtime Skill 目录上执行无人值守版本轮换。

## Control Plane Core

### 领域服务

现有 `main.cjs` IPC handler 中的业务调用逐步下沉到类型化服务：

- `RawCaseService`
- `RuntimeTaskService`
- `CurationService`
- `DatasetService`
- `EvaluationService`
- `ManagedSkillService`
- `SkillInstallationService`
- `OptimizationService`

服务接受稳定 ID 和经过 schema 校验的输入，不依赖 Electron `event`、DOM 状态或当前页面。Renderer 使用同一服务的 IPC adapter；Operator 使用 Tool Gateway adapter。现有 manager 和 store 可先作为服务的内部依赖，不要求一次性重写。

### 工具命名空间

Operator 看到的是少量领域工具，而不是所有内部 IPC：

- `raw_cases.*`：查询、装填、编辑和派发；
- `runtimes.*`：查询 Runtime/模型、启动任务、追问、停止、读取结果和 Trace 摘要；
- `curation.*`：冻结会话范围、启动 Curator、追问、保存和丢弃；
- `datasets.*`：查询数据集、Case、Rubric 和绑定关系；
- `evaluations.*`：预检、启动、停止、读取进度和结果；
- `skills.*`：读取受管 Skill、创建实验工作区、查看 Diff、生成 Candidate、发布、安装和检查；
- `optimization.*`：创建、执行、暂停、恢复和停止多 Epoch 优化任务。

工具默认返回状态、摘要、稳定对象 ID、`jobId` 或 `artifactId`。Trace、完整回复、Diff 和评分详情通过分页查询读取。Tool Gateway 不把高频 runtime delta、完整 stdout 或整份评测快照重复塞入 Agent 上下文。

### 传输

App 主进程监听仅当前 macOS 用户可访问的本地 Unix domain socket，不开放 TCP 端口。Operator 会话启动时获得短期、限定范围的 capability。传输适配如下：

- Codex app-server 使用线程级 `dynamicTools` 和 `item/tool/call` 请求直接连接 Tool Gateway，不修改用户的全局 MCP 配置；
- CodeBuddy ACP 通过 `session/new.mcpServers` 为该 Operator 会话启动预授权的 stdio MCP bridge；
- Runtime 无法可靠连接 MCP 时，Agent 通过 Bash 调用 `rolling-skill-tool control ... --json`，CLI 仍连接同一 socket 和控制面；
- Renderer 继续通过受限 preload API 调用同一控制面；
- 现有 Raw Case CLI/MCP 保持可在 App 关闭时写入 owner-only JSONL，它不自动获得其他控制权限。

第一版不向任意外部 Agent 自动发放完整控制面权限。外部 CLI/MCP 如需操作 App 内功能，必须由运行中的 Rolling Skill 创建授权会话。

## Operator 身份与 Runtime 选择

自操作工作台允许用户选择任一本机已发现且通过兼容性探测的 Runtime，并选择该 Runtime 实际公布的模型和推理强度。模型未公布 reasoning effort 时不传入通用默认值。

每个 Operator 会话使用版本化的 `rolling-skill-operator/v1` 内部指令，明确说明：

- 当前环境是 Rolling Skill 自操作工作台；
- 可用工具、对象 ID、分页和 Job 语义；
- 哪些动作可以自动执行，哪些动作必须等待审批；
- 不得直接修改固定数据集、Rubric、历史结果或 Rolling Skill 存储；
- 必须用结构化 Tool 结果判断状态，不能凭自然语言声称成功。

这份内部 Operator 协议不是待评测 Skill，不安装到 Runtime Skill 目录，也不参与 Skill 自动触发评分。不同 Runtime 的 adapter 负责用其支持的最高优先级指令和工具机制承载同一协议。

启动前执行 capability preflight。如果所选 Runtime 缺少可用的 provider-native Tool、MCP/CLI 工具传输、必要的文件工具或对应权限，任务在运行任何有成本的步骤前失败，并明确列出缺少的能力。

## 权限与预算策略

默认采用“有界自动化”。

### 自动允许

- 所有只读查询；
- 在用户已选择的 Skill、Dataset 和 Runtime 范围内创建 Raw Case；
- 在已批准预算内运行 Runtime 任务、Curator 草稿和 Evaluation；
- 读取和分析评测、Trace、Diff 和评分产物；
- 修改当前优化任务独占的实验工作区；
- 创建不可变 Candidate。

### 必须审批

- 发布 Candidate 为 Released；
- 正式安装或覆盖 Runtime 中的 Skill；
- 第一次允许某个 Runtime 进入 Candidate 实验版本轮换；
- 删除 Dataset、Case、评测记录、Raw Case、受管仓库或版本元数据；
- 发布 Rubric；
- 扩大 Epoch、Runtime、模型、Token/费用或时间预算；
- 访问任务原始授权范围之外的 Skill、Dataset、Runtime 或工作目录。

审批是持久化 `waiting_approval` 状态，不是阻塞 Renderer 的同步弹窗。用户可以批准一次动作、当前 Epoch、当前优化任务或拒绝。Prompt 不能绕过 Policy Engine。

## 持久化 Job Engine

### 核心实体

- `OperatorSession`：Runtime、模型、推理强度、会话 ID、协议版本和 capability；
- `Job`：类型、目标、父子关系、预算、状态和当前检查点；
- `Step`：一个实际动作、幂等键、输入摘要、输出引用、重试和错误；
- `Approval`：风险说明、请求范围、用户决定和生效期限；
- `Artifact`：回复、Trace 摘要、评测、Diff、Candidate、诊断和报告；
- `OptimizationRun`：冻结基线、数据集/Rubric、Runtime 矩阵、停止规则和总体预算；
- `OptimizationEpoch`：输入版本、修改、Candidate、评测、改善/回归和继续/停止理由；
- `CapabilityGrant`：Operator 可访问的领域、对象和动作。

### 状态

```text
queued → running → waiting_approval / paused
                    ↓
        succeeded / failed / cancelled / needs_recovery
```

耗时业务操作返回 `jobId`。Operator 和 UI 订阅 Job 级状态变化，读取 Artifact 获取详情，不轮询所有内部 store。父 Job 只有在全部必需子 Job 完成且补偿动作成功后才能进入 `succeeded`。

### 幂等性

所有写操作携带由 Job Engine 创建的幂等键。重复 Tool 调用不能重复启动相同 Evaluation、创建相同 Candidate、保存相同 Case 或重复发布。服务在执行写操作时同时校验对象 revision、冻结摘要和前置状态，避免过期 Agent 计划覆盖用户的新修改。

## 多 Epoch 自动优化

### 创建任务

用户通过自然语言和结构化配置共同定义：

- 受管 Skill 与基线 Released 版本；
- 固定 Dataset、Case revisions 和已发布 Rubric；
- Operator Runtime、模型和推理强度；
- 被测 Runtime、模型、推理强度和激活模式；
- 固定 Epoch 或 Agent 自决策模式；
- `maxEpochs`、目标分数/通过率、无改善耐心轮数；
- 最大时间、Token/费用和并发范围；
- Candidate 实验安装授权范围。

推荐默认是带硬上限的 Agent 自决策。Agent 每轮提出 `continue | finish | pause` 和结构化理由，Job Engine 再验证预算和停止规则。Agent 不能自行提高上限。

### Epoch 定义

基线评测不计入 Epoch。一个 Epoch 包含：

```text
分析上一版本评测
  → 修改独占实验工作区
  → 生成不可变 Candidate
  → Runtime 安装并验证 Candidate
  → 使用同一冻结 Dataset/Rubric 评测
  → 记录改善、回归和下一步决策
```

Candidate 在 Epoch 之间连续推进，不在每轮恢复基线：

```text
Baseline Released
  → Candidate 1
  → Candidate 2
  → Candidate 3
  → 发布最终 Candidate，或在整个任务结束时恢复 Baseline
```

默认停止条件：

- 达到目标总分、通过率或关键 Case 全部通过；
- 连续配置的 Epoch 没有达到最小改善；
- 出现新的关键失败、大范围回归或 Agent 无法可靠定位原因；
- 达到 Epoch、Token/费用或时间上限；
- Candidate、Runtime 安装、内容验证或评测前置检查失败；
- 用户暂停或停止。

### 数据集和 Rubric 冻结

OptimizationRun 创建时冻结 Dataset、Case revisions、Rubric version、Skill baseline、Runtime 配置和评分计算版本。运行期间：

- Operator 可以提出新的 Raw Case 或 Rubric 建议；
- 建议只能进入独立草稿或 Raw Case 队列；
- 当前 OptimizationRun 不吸收这些变化；
- 如需使用新 Case 或 Rubric，用户必须结束当前 Run 并显式创建新基线。

这样保证每轮分数可比较，不允许评分标准随 Skill 变化。

## Candidate 实验安装与恢复

普通 Skill 管理工作台继续只允许正式安装不可变 Released 版本。本设计新增的 Candidate 安装仅存在于已获批的 OptimizationRun 内，使用独立的 `experiment` 操作和管理标记，不进入可信 Released 安装矩阵。

无人值守版本轮换只允许以下起始状态：

- 目标不存在，任务结束时可以验证后删除本任务创建的精确目标；或
- 目标是摘要一致、标记完整的 Rolling Skill `managed-clean` Released 安装，任务已冻结其恢复源。

`managed-drifted`、`unmanaged`、`conflict` 或 `uncertain` 不能直接进入自动 Epoch。用户需先通过普通安装工作台修复为可信 Released 基线，或者把该 Runtime 排除出自动优化。

每次 Candidate 安装仍由对应 Runtime Agent 执行：导出固定 commit、验证 digest、检查目标、复制、写实验标记、刷新 inventory 并返回结构化结果。下一 Epoch 直接从当前 Candidate 切换到新 Candidate。

整个 OptimizationRun 终止时：

- 用户批准发布并且 Released 正式安装成功：保留新 Released，随后运行最终回归评测；
- 未发布、取消、失败或正式安装失败：恢复任务开始前的 Released 版本，或删除任务从 absent 状态创建的精确实验目标；
- 恢复前再次校验目标仍带有本 Run 的实验标记和预期摘要；不匹配时不得删除或覆盖；
- 恢复后重新执行内容和 Runtime inventory 验证；失败则父 Job 进入 `needs_recovery`，停止后续自动动作并展示精确状态。

Released 发布成功但正式安装失败时，Released 版本不会撤销；Job 明确显示“发布成功、安装失败、Runtime 已恢复/需要恢复”，不能折叠为模糊的整体失败。

## 工作台界面

主导航增加独立页面：

```text
对话 | Skill 评测 | Skill 管理 | 自操作
```

### 布局

- 左侧为 Operator 任务列表，区分运行中、等待审批、暂停、完成、失败和需要恢复；
- 中间为 Operator Agent 会话，明确显示 `Rolling Skill Operator`、Runtime、模型、推理强度、权限和预算；
- 右侧为当前 Job 的固定状态栏，显示 Skill、冻结 Dataset/Rubric、Epoch、分数趋势、预算、子任务、实验版本和审批；
- 该页面使用自己的三栏布局，不复用会覆盖 Raw Case、Trace、Curator 的抽屉系统。

### 新建任务

自然语言目标和结构化配置同时存在。自然语言用于表达优化意图，结构化配置是实际授权和冻结来源。创建前显示完整预检摘要，用户可以修改 Runtime、模型、预算、停止规则和权限。

### 运行中交互

- 用户可以追问、暂停、恢复、停止或调整尚未冻结的后续计划；
- Agent 计划、工具动作、诊断、Diff、评分趋势和回归报告以可展开 Artifact 卡片显示；
- 审批进入统一队列，不连续弹出模态窗口；
- 点击 Dataset、Case、Evaluation、Candidate 或 Installation 可跳转到现有工作台并定位对象；
- 后台任务只更新状态和未读数量，打开后从持久化快照恢复完整已观察输出。

工具活动使用业务标签，例如“启动 10 个 Case 的跨 Runtime 评测”或“安装 Candidate 2 到 CodeBuddy”，同时允许展开查看底层 Runtime、Tool、command 和 Trace 证据。

## 事件、刷新与性能

Job Engine 写入追加式事件并维护每个 Job 的最新快照。Renderer 不因任意后台 Runtime delta 重新渲染当前页面：

- 未打开的 Operator 会话只更新内存状态、持久化事件、徽标和进度摘要；
- 当前可见会话把文本 delta 和活动更新合并到固定刷新帧；
- 大型 Artifact 延迟加载、分页读取并缓存 revision；
- 切换任务直接使用最近快照和有限 catch-up，不从第一条事件播放动画；
- 同一 Job 的重复进度事件在主进程或 Renderer store 中合并；
- Trace 原文保持独立保存，不复制进会话消息或 Job 快照。

这些约束沿用普通 Chat 和 Curator 已有的后台会话抑制原则，必须通过 Renderer 性能回归测试固定下来。

## 错误恢复

- App 重启时，`running` Job 先进入 reconcile，不盲目重放有副作用的 Step；
- 只读查询可以自动重试；Evaluation 先按保存的 run ID 查询，安装先执行只读 inspect；
- Runtime 会话可恢复时继续原会话；不可恢复时保留全部 Artifact，从已验证检查点创建新会话；
- Agent Tool 参数或结果不符合 schema 时返回可修复错误，允许有界重试；连续失败后暂停；
- 当前 Epoch 失败不删除之前 Epoch、Candidate、评测或 Diff；
- 停止操作取消未开始任务、中断当前 Runtime/Judge/Curator，并执行必要的 Candidate 恢复；
- 补偿动作本身失败时进入 `needs_recovery`，禁止继续发布、安装或下一 Epoch。

## 安全约束

- socket、事件日志、capability 和 Job 数据使用 owner-only 权限；
- capability 绑定 OperatorSession、对象范围、动作集合和到期时间；
- 所有本地路径由主进程根据稳定对象 ID 解析，Renderer 或 Agent 不能提交任意删除目标；
- 控制面日志对 URL 凭据、授权 token 和 Runtime secret 做脱敏；
- Tool 输出默认不包含完整环境变量、授权文件或无界 stdout；
- 发布、正式覆盖、删除和预算扩张由 Policy Engine 硬校验，不能依赖 Agent 是否遵守提示词；
- 普通 Chat 与 Evaluation client 不继承 Operator capability、MCP server 或 CLI 会话配置。

## 测试策略

### 单元测试

- Tool schema、分页、错误结构和对象 ID 解析；
- capability 范围、审批矩阵、预算和到期行为；
- Job 状态机、父子完成条件、幂等键和 revision 冲突；
- 固定 Epoch、Agent 自决策、耐心轮数和硬上限；
- Dataset/Rubric 冻结和优化任务不可变约束；
- Candidate 连续切换、最终 Released 保留、取消后恢复和恢复失败。

### 契约测试

- Renderer IPC、MCP 和 CLI 对同一 Command/Query 产生一致结果；
- Codex、CodeBuddy 和 DSH adapter 的 Operator 工具注册、模型能力和权限映射；
- Runtime 结构化安装、评测和恢复协议的成功、拒绝、截断、重复和身份不匹配路径。

### 集成测试

- 使用 fake Runtime 完成 Baseline 加多个 Epoch、Candidate 安装、评测、停止决策、发布审批和最终回归；
- App 在 Evaluation、Candidate 安装和等待审批阶段退出后恢复；
- 用户停止、预算耗尽、Agent 输出无效、Runtime 断连和恢复失败；
- 已发布但安装失败时的 Released 状态与 Runtime 恢复状态分离。

### Renderer Smoke

- 创建和切换 Operator 任务；
- 后台流式任务不刷新不可见会话 DOM；
- 高频 delta 合并、历史输出恢复和未读状态；
- 审批队列、暂停、停止和 `needs_recovery`；
- Epoch 分数趋势、Diff、Artifact 展开和跨工作台定位；
- 窗口缩小时三栏布局不挤出输入框。

### 本机 Smoke

对已发现的 Codex、CodeBuddy 和 DSH 分别验证 Operator 身份、Tool 调用、Job 状态和停止。真实多 Runtime Smoke 是可选验证，不作为离线测试硬依赖，也不自动消耗大规模评测预算。

## 分阶段交付

### 第一阶段：统一控制面与 Gateway

- 从 IPC handler 抽取类型化领域服务；
- 建立 Command/Query schema、Policy Engine、capability 和本地 socket；
- 让 Renderer、MCP 和 CLI 复用控制面；
- 先覆盖只读、Raw Case、Runtime 任务和 Evaluation。

### 第二阶段：自操作工作台与 Job Engine

- 持久化 OperatorSession、Job、Step、Approval 和 Artifact；
- 增加 Operator Runtime 会话、页面布局、审批队列和恢复；
- 接入 Curator、Dataset、Skill 版本和安装操作；
- 完成后台事件抑制和性能回归。

### 第三阶段：多 Epoch 优化闭环

- 独占实验工作区和 Candidate 生成；
- Candidate 实验安装协议、连续 Epoch 和安全恢复；
- Agent 自决策、硬预算和停止规则；
- 发布、Released 正式安装和最终回归；
- 逐轮 Diff、评分变化、回归和中文优化报告。

每个阶段都必须保持普通 Chat、现有评测和 Skill 管理流程可独立使用。第三阶段不能在 Candidate 安装与恢复不变量通过测试前开放自动多 Epoch。
