# Case 更新、定时沉淀与删除回收设计

## 目标

Rolling Skill 补齐三条彼此关联的数据维护链路：

1. 已保存 Case 可以用当前数据、当前 Skill 和当前工具协议重新执行，原问题保持不变，新结果替换旧答案。
2. Automatic Capture 从“每次回答结束立即截取整段对话”升级为每天或每周运行的增量问题发现器，只处理尚未检查的新对话，并支持待审核与完全自动两种沉淀方式。
3. 删除 Case 或数据集前，用户可以把问题回收到 Raw Case，避免有价值的问题永久丢失。

新增界面继续使用 Settings 中已有的中英文、主题、模型目录和视觉组件。功能直接在 `main` 开发，不创建分支、worktree 或子 Agent，不打开浏览器页面。

## 非目标

- Case 更新不修改问题文本，也不自动生成相似问题。
- Case 更新不是普通评测运行，不产生 Judge 分数或新的评测记录。
- 定时沉淀不注册 macOS `launchd`、登录项或常驻辅助进程；App 未运行时不主动拉起 App。
- 定时扫描不把整个历史对话反复发送给模型。
- 删除回收只保存问题和来源，不把旧参考答案复制到 Raw Case。
- 本轮不增加跨设备同步或云端调度。

## 方案比较

### Case 更新方案 A：Agent 直接覆盖现有答案

实现最短，但 Agent 执行失败、工具返回不完整或 Case 在执行期间被修改时仍可能覆盖有效数据，也没有统一的结构化校验和人工复核入口。

### Case 更新方案 B：重新执行、Curator 校验、原位替换（采用）

先使用当前 Skill 重新执行原问题，再把新执行片段交给现有 Curator 生成合法 Draft。单条更新由用户审核后 Done；批量更新对合法 Draft 自动 Done。只有完整链路成功后才替换 Case，并保存旧版本历史。

该方案复用现有 Case Draft、Case 校准批处理、Curator JSON 校验和自动保存状态机，新增行为最少且可追溯。

### Case 更新方案 C：先运行评测，再从评测结果提升为 Case

执行与证据设施齐全，但会混入 Judge、评分记录和多 Runtime 组合，用户还需要从评测结果手工选择一次，链路过重。

### 定时扫描方案比较

- 整段会话扫描：边界信息最完整，但重复上下文和成本随历史持续增长。
- 固定滑动窗口：上下文有上限，但容易切断跨窗口的问题，且重复窗口仍会影响缓存与成本。
- 两阶段增量扫描（采用）：第一阶段只读新增用户消息识别问题边界；第二阶段只读取命中的局部片段判断 Skill 和解决状态。跨批次未结束的问题保存为 pending tail，而不是硬切 token 窗口。

## 总体架构

新增三个明确边界的服务：

- `CaseRefreshManager`：冻结目标 Case，使用当前 Runtime 重放问题，生成 `refresh` 类型 Curation Session，并管理单条或批量更新的运行状态。
- `ConversationDiscoveryManager`：计算计划时间、增量读取对话、调用小模型识别问题边界与结果，并把候选持久化到 Raw Case。
- `CaseRecycleService`：在删除前预检，先把问题批量写入 Raw Case，再提交 Case 或数据集删除。

现有 `CurationManager` 继续负责 Draft 生成、模型活动、重试、Discard 和 Done。`LocalEvaluationStore` 负责 Case 原位更新、更新历史、刷新会话状态和扫描游标。`RawCaseStore` 继续作为独立追加式问题收件箱。

## Case 更新

### 单条执行流程

1. 用户在 Case 列表中点击“更新”。
2. 主进程冻结目标 Case 的 `id`、`updatedAt`、原问题、Case 类型、结构化参考答案、来源摘要、数据集 Skill 绑定和当前 Rubric 版本。
3. `CaseRefreshManager` 检查当前 Runtime 是否仍提供数据集绑定的 Skill。
4. 更新 Agent 收到两类输入：
   - 不可变的原问题；
   - 原 Case 作为“意图和工作方式参考”，明确禁止把旧数值当成事实直接复制。
5. Agent 使用当前 Skill 和当前工具协议重新完成问题。数据值变化时重新查询；工具名称、参数或调用顺序变化时按当前 Skill 完成同一意图。
6. 新响应、工具活动、Trace 引用和 Skill 证据被整理成新的 Episode，创建 `operation: "refresh"` 的 Case Draft。
7. 用户可在现有 Case Drafts 抽屉中查看、追问、修订、Discard 或 Done。
8. Done 时再次校验目标 Case 的 `updatedAt`、数据集 Skill 身份和 Rubric 版本。全部未漂移才原位替换答案和证据。

更新 Agent 使用当前 Runtime 的 Task 模型与推理强度；Curator 使用现有 Curator 配置。模型选项始终来自 Runtime 目录，不新增内置模型名单。

### 安全边界

Case 更新采用非交互、只读优先的执行策略。提示词禁止为了刷新 Case 发起真实删除、迁移、审批、改负责人、购买或其他外部写操作。若当前 Skill 必须获得写操作确认才能完成，刷新停止并留下失败或待审核 Draft，不在单条或批量模式中自动越过确认。

这不影响查询类 Case 使用当前实时数据生成新答案，也允许根据当前 Skill 描述更新写操作的说明与步骤，但不会为了更新样例真正执行高风险动作。

### 原位替换规则

以下字段保持不变：

- Case `id`
- `datasetId`
- `caseType`
- `question`，包括原有空白和标点
- `createdAt`

以下字段使用新 Draft 和新执行证据替换：

- `answer`
- `curated`
- `skillReference`
- `rubricVersionId` 与 `rubricCalibration`
- `source` 中本次执行、Curator、Runtime、模型和 Trace 信息
- `evidence`
- `updatedAt`

Case 新增 `refreshHistory`。每次成功替换前保存旧的答案、结构化契约、Skill 引用、Rubric 状态、来源、证据和归档时间。更新历史只用于审计与恢复，不显示为额外 Case。

### 批量更新

数据集 Case 工具栏增加“批量更新”，打开紧凑确认弹窗：

- 范围：仅 Goodcase、全部 Case；
- 显示将处理的 Case 数；
- 提示合法 Draft 会自动保存并替换原 Case；
- 开始、取消。

批量任务沿用 Case 校准的串行状态机：一次只更新一个 Case，显示已完成数量、当前 Case、停止和错误。每个 Draft 通过固定校验后自动 Done；遇到执行失败、Draft 无效、目标漂移或需要写操作确认时暂停，保留当前 Draft 供用户处理。用户手动追问、修改、Done 或 Discard 当前 Draft 时，自动批处理停止，避免后台状态和人工操作竞争。

批量任务在 Renderer 重载或 App 重启后不自动恢复。已经成功替换的 Case 保持成功，尚未开始的 Case 不变，正在运行的 Session 按现有中断恢复规则转为失败或待审核。

## 定时自动沉淀

### 设置

Automatic Capture 设置改为以下字段：

- 模式：关闭、定时发现、完全自动；
- 周期：每天、每周；
- 本地时间：`HH:mm`；
- 每周模式下的星期；
- 分析模型和推理强度；
- 可选首选数据集。

默认模式为关闭。旧数据中的 `autoCapture: false` 迁移为关闭；`autoCapture: true` 迁移为“定时发现”，默认每天本地时间 09:00 运行一次，不自动保存 Case。只有用户显式选择“完全自动”后，合法 Draft 才允许自动 Done。

App 运行时在计划时间启动扫描。若 App 在计划时间未运行，下一次启动检测到错过的计划槽后补跑一次；无论错过多少次都只补一次，不连续回放多轮。扫描不会打开网页或创建可见 Chat 会话。

### 扫描游标

Local Store 保存不对 Renderer 暴露的自动沉淀运行状态：

```json
{
  "lastScheduledSlot": "2026-08-26T09:00:00+08:00",
  "lastRunAt": "ISO-8601",
  "runtimes": {
    "runtime-id": {
      "threads": {
        "thread-id": {
          "lastInspectedUserItemId": "item-id",
          "pendingStartUserItemId": "item-id-or-null",
          "updatedAt": "ISO-8601"
        }
      }
    }
  }
}
```

游标按 Runtime 和 Thread 隔离，切换两个 Codex 版本不会互相覆盖。扫描分页读取当前 Runtime 的普通与已归档对话，并排除 Curator、Rubric Agent、Case 刷新和其他内部隐藏线程。

只有候选已持久化、明确判定为无关，或明确判定仍未结束并保存 pending tail 后，才推进游标。模型、Runtime 或持久化失败时不推进对应范围，下次计划重试。

### 第一阶段：用户消息边界

小模型只接收每个 Thread 中游标后的用户消息，以及上一轮尚未结束问题的首条用户消息。输入包含稳定的 Thread、Turn 和 Item ID，但不包含 Agent 回答、Reasoning、命令输出或完整工具结果。

模型输出固定 JSON：

- 问题开始用户消息 ID；
- 问题结束前最后一条用户消息 ID；
- 是否已经进入下一问题；
- 是否需要等待后续消息；
- 简短问题摘要。

用户对同一问题的补充、纠正和追问留在同一范围；明确切换意图时结束上一范围。最后一个尚未完成的范围写入 pending tail，等待下次增量扫描。

### 第二阶段：Skill 与解决状态

对第一阶段得到的完整候选，主进程只截取该问题对应的局部 Episode，并提供：

- 范围内用户与 Agent 消息；
- 压缩后的 Skill、MCP、动态 Tool 和命令活动；
- 当前 Runtime 的可用 Skill 身份；
- 已有数据集的 Skill 绑定。

小模型返回：

- 触发或主要负责的 Skill；
- `resolved`、`unresolved` 或 `uncertain`；
- 推荐 `goodcase` 或 `badcase`；
- 问题范围的最终 Assistant Item ID；
- 置信度和简短依据。

`resolved` 默认推荐 Goodcase，`unresolved` 默认推荐 Badcase。置信度范围为 0 到 1，完全自动的最低阈值固定为 0.8。`uncertain`、低于 0.8、无法绑定 Skill、缺少最终回答或范围证据不完整的候选只进入待处理 Raw Case，不允许完全自动保存。

### 候选持久化与自动路由

每个识别出的候选先写入 Raw Case，确保即使后续 Draft 失败也不会丢失。Raw Case 保留原问题，以及以下来源定位：

- `kind: "automatic_capture"`
- Runtime、Thread、起止 Turn/Item ID
- 解决状态、推荐 Case 类型、置信度
- 检测到的 Skill
- 检查时间

同一 Skill 下完全相同的问题继续使用现有去重规则。若重复记录已经存在，自动沉淀把新的 Episode 定位作为关联观察追加到来源中，而不是创建第二张完全相同的 Raw Case。

“定时发现”模式到此结束。来源完整的自动候选在 Raw Case 卡片上提供“创建 Case Draft”，数据集列表优先显示 Skill 匹配项；成功创建 Draft 后用现有 dispatched 事件从 pending 收件箱移除。

“完全自动”模式继续自动选择目标数据集：

1. 首选数据集存在且 Skill 匹配时使用首选数据集；
2. 没有首选项但只有一个数据集匹配 Skill 时使用该数据集；
3. 没有匹配项或存在多个无法消歧的匹配项时保留 Raw Case，等待用户选择。

自动创建的 Draft 通过 Curator 固定校验后自动 Done。Curator 失败、目标数据集或 Skill 漂移、Rubric 不可用、低置信度或保存失败时，Raw Case 保留；已经创建的 Draft 也保留在 Case Drafts 中供审核。只有 Case 保存成功后才标记对应 Raw Case 已处理。

### 幂等与上下文控制

- Raw Case 使用 Skill 身份与原问题文本去重。
- Curation Session 使用 Thread 范围的起止 Item ID 去重。
- 扫描任务使用计划槽 ID 防止同一时间槽重复运行。
- 每个模型请求有用户消息数量和字符预算；超限时按 Thread 分批，不截断单条问题范围。
- 第一阶段请求保持稳定提示前缀，但不为了缓存命中保留无限对话历史。
- 第二阶段只读取命中的局部 Episode，长工具输出沿用现有中间截断和完整 Trace 引用策略。

## 删除回收到 Raw Case

### 界面

Case 删除弹窗增加默认勾选项“将问题保留到 Raw Case”。数据集删除弹窗增加同一勾选项，并显示“将保留 N 个问题”。空数据集时选项禁用并显示 0。

确认按钮仍是现有轻量危险样式；回收选项使用现有表单、说明文字和中英文管线，不引入新的弹窗视觉体系。

### 回收内容

每个回收记录包含：

- Case 的原始 `question`，逐字保留；
- Case 或数据集绑定的稳定 Skill 身份；
- note：来源数据集名称、Goodcase/Badcase 和删除回收说明；
- source：`kind: "deleted_case"`、dataset ID、Case ID、Case 类型和回收时间。

答案、Curator 对话、评分契约和评测结果不写入 Raw Case。已有评测运行继续保留自己的冻结快照，遵循现有删除语义。

### 提交顺序

1. 预检 Case 或数据集是否允许删除，包括活动中的 Case 校准、Case 更新、Curator、Rubric 和数据集 reservation。
2. 勾选回收时，先把问题同步写入 Raw Case。数据集超过 200 个 Case 时按现有批量上限分块。
3. duplicate 视为已经安全保留；任何 rejected 或写入异常都中止删除。
4. Raw Case 全部安全落盘后，同一主进程调用中删除 Case 或数据集。

Raw Case 已写入但正式删除随后失败是安全的可恢复状态：原 Case 仍存在，重试时去重。禁止先删除 Case 再异步写 Raw Case。

## 数据模型变化

### Case

新增：

```json
{
  "refreshHistory": [],
  "lastRefresh": {
    "sessionId": "uuid",
    "refreshedAt": "ISO-8601",
    "runtimeId": "runtime-id",
    "modelId": "model-id"
  }
}
```

旧 Case 迁移时补空 `refreshHistory`，不修改问题或答案。

### Curation Session

`operation` 扩展为 `capture | calibration | refresh`。`refresh` Session 增加 `targetCaseId`、冻结的 `targetCaseUpdatedAt`、`baselineCaseSnapshot` 和新执行 Episode。归档时走 Case 原位更新分支，不创建新 Case。

### Automatic Capture

Settings 使用显式 `mode` 和 `schedule`；扫描游标和最后运行状态单独保存在 Local Store，不混入面向用户的设置表单数据。

## UI 布局

- Case 行在删除按钮前增加紧凑的“更新”按钮；运行中显示“更新中…”，已有刷新 Draft 时显示“查看更新”。
- 数据集 Case 页工具栏增加“批量更新”，不与“批量校准”混在 Rubric 状态提示中。
- `refresh` Draft 继续显示在 Case Drafts 抽屉，标题标识“Case 更新”，上方折叠显示当前已保存答案作为对照。
- 批量更新显示与批量校准一致的进度条、停止和错误状态。
- Raw Case 的自动候选显示来源对话、检测 Skill、已解决/未解决和“创建 Case Draft”。删除回收的 Raw Case 继续使用现有“当前会话执行/新会话执行”。
- Settings 的 Automatic Capture 区域按模式逐步显示周期、时间、星期、模型、强度和首选数据集，关闭时隐藏无关项。
- Topbar 沉淀状态显示关闭、下次运行时间、扫描中、待处理数量或最近错误；Settings 显示最近一次成功扫描时间，避免定时任务成为不可见后台行为。
- 所有新增文案同时提供 `en` 与 `zh-CN`，状态时间使用当前设置语言格式化。

## 错误与恢复

- Case 更新执行失败：原 Case 不变，Session 显示可重试错误。
- Curator 已有合法 Draft 后再次出错：保留上一版合法 Draft，沿用现有行为。
- Case、Skill 或 Rubric 漂移：Done 失败并要求重新开始更新，绝不覆盖新状态。
- 批量更新中断：已成功 Case 保留，当前 Session 可审核，后续 Case 未修改。
- 自动扫描 Runtime 不可用：记录本次错误，不推进相关游标，下次计划重试。
- 自动候选无匹配数据集：保留 Raw Case，不创建错误归属的 Case。
- 完全自动保存失败：Raw Case 与 Draft 均保留。
- 删除回收失败：正式 Case 或数据集不删除。

## 测试策略

只做与本次变更成比例的聚焦验证：

- Store：Case 刷新原位替换、问题不变、历史记录、漂移拒绝、设置迁移、扫描游标。
- Case Refresh Manager：当前 Skill 重放、只读安全提示、失败不覆盖、单条与批量状态。
- Curator：`refresh` Draft、Done 原位更新、Discard、重试、合法 Draft 自动归档。
- Conversation Discovery：每日/每周计划、启动补跑、用户消息分段、pending tail、局部第二阶段、隐藏线程、游标幂等、低置信度回退。
- Raw Case：自动候选来源、重复观察合并、删除回收去重、超过 200 条分块、部分失败中止删除。
- Main/preload：新增刷新、扫描状态、删除回收 IPC，不暴露内部游标。
- Renderer：中英文设置、单条更新、批量范围、进度/停止、Raw Case 创建 Draft、删除回收选择。
- 最后只启动一次本机 App 检查真实界面，不打开浏览器；完成后更新仓库根目录 `Rolling Skill.app` 与 `rolling-skill-tool`。

## 验收标准

1. 单条 Case 可以用当前数据和工具重新执行，Done 后 Case ID 与问题不变，答案和证据更新，旧版本可追溯。
2. 数据集可以批量更新仅 Goodcase 或全部 Case，合法 Draft 自动保存，过程可停止，失败不会覆盖原 Case。
3. Automatic Capture 可以配置每天或每周固定时间，只检查尚未检查的新对话，并正确保留跨批次未结束的问题。
4. 小模型第一阶段只读取用户消息，第二阶段只读取命中局部范围；能记录主要 Skill、问题边界和解决状态。
5. 定时发现模式把候选保存在 Raw Case；完全自动模式只在置信度、数据集、Skill、Rubric 和 Draft 都有效时自动保存 Case。
6. App 错过计划时间后下次启动只补跑一次，不注册外部常驻任务，不弹网页。
7. 删除 Case 或数据集时可以选择先回收问题；回收失败会阻止删除，重复问题不会重复创建。
8. 新增界面在中文和英文下完整可用，并与现有 Codex 风格工作台一致。
