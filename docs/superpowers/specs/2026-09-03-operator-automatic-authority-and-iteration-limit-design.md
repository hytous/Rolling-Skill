# App 自操作自动权限与迭代上限设计

## 目标

Electron App 的“自操作”任务应在用户选定的 Skill、Dataset 和 Runtime 范围内连续自动推进，不因运行 Runtime、评测、发布 Skill、发布 Rubric 或安装 Skill 等正常工作步骤中途等待审批。创建任务时只让用户选择确实可能被 Agent 意外触发且不可逆的操作。

同时修复自动优化停止规则中“关键 Case 必须通过”复选框过大、与文字错位的问题，并把难以理解且容易误限正常任务的多维硬预算简化为一个“最大迭代次数”。

## 已确认的问题

### 复选框错位

“关键 Case 必须通过”位于 `.operator-budget-grid` 内。现有 CSS 同时把网格内所有 `label` 设置为 Grid，并把所有 `input` 设置为宽度 `100%`、最小高度 `34px` 的文本输入框。复选框因此继承了数字输入框的尺寸和布局。

### 自动化被两层权限阻断

创建普通自操作任务时，Renderer 只默认勾选 `.read` action。即使 Agent 的目标要求运行 Runtime、评测、发布或安装，它也拿不到对应 capability。

即使用户事先勾选了这些 action，Operator Job Engine 仍会为发布 Skill、发布 Rubric、安装等动作创建运行时审批。这相当于对同一个自动化任务重复授权，并使无人值守执行停在 `waiting_approval`。

### 预算字段不是用户心智模型

最长时间、Runtime Turn、评测次数、Target/Judge 执行次数、Token 和费用等字段暴露了内部实现。用户无法在任务开始前可靠预测这些数字，它们会把正常的子任务扇出误判为超限，并触发运行时扩容审批。

## 选择的方案

采用“范围内默认自动化 + 创建时选择不可逆删除 + 单一迭代上限”。不根据自然语言临时猜测权限，也不把删除能力默认开放。

### 权限分类

以下现有 Operator action 对所有新建自操作任务自动开放，不在界面中逐项展示：

- `context.read`
- `raw_cases.read`、`raw_cases.write`
- `runtime.execute`、`runtimes.read`
- `datasets.read`、`datasets.write`
- `evaluations.read`、`evaluations.execute`
- `skills.read`、`skills.write`、`skills.release`
- `jobs.read`、`approvals.read`
- `curation.write`
- `rubrics.publish`
- `installations.read`、`installations.execute`
- `optimizations.read`、`optimizations.execute`

`datasets.delete` 不默认开放。界面只保留一个默认关闭的选项：

> 允许永久删除数据集或 Case

该 action 同时覆盖控制面中的数据集删除和 Case 删除。未勾选时，capability 在进入 Job Engine 前拒绝调用；勾选即表示用户在创建任务时完成预授权，实际执行时不再弹第二次审批。

目前 Operator action 目录没有开放 Raw Case、Skill、评测记录或仓库删除 action，因此不为不存在的删除能力增加占位选项。未来若新增不可逆 action，必须显式加入这一创建时风险选择区，默认关闭。

### 不再使用普通自操作运行时审批

普通自操作任务的冻结 action capability 就是执行授权。Operator Job Engine 不再为下列必要流程动作创建审批：

- 发布 Skill Candidate；
- 发布 Rubric；
- 启动或取消安装；
- 用户在创建任务时已经显式允许的数据集或 Case 删除。

普通自操作也不再创建预算扩容审批。超出迭代上限时自动暂停并报告当前结果；如需更多迭代，用户创建一个新的任务并设置新的上限，而不是让 Agent 在运行中申请扩大权限。

底层 Agent Runtime 若尝试绕过 Rolling Skill Tool、直接请求命令或文件系统权限，App 不弹运行时权限框，而是自动拒绝并记录审计。自动化必需动作必须通过已授权的 Tool Gateway 完成；如果某个正常 Tool 流程错误地依赖底层 Runtime 权限，应修复对应 adapter，不能把权限选择重新转嫁给用户。

该变化只影响普通自操作 Tool Step 的通用审批门禁。自动优化 Candidate 完成后的“一次最终审批”继续保留，因为它是用户在“安装改进版”和“回退原版本”之间作出的最终业务决定，不是 Operator action capability。

### 作用范围继续冻结

去掉逐 action 选择不等于取消范围控制。任务创建时仍冻结：

- 当前 Skill 和受管仓库；
- 当前 Dataset；
- 允许使用的目标 Runtime；
- Operator Runtime、模型和推理强度。

Agent 不能访问范围外对象，也不能通过提示词扩大 capability。所有 Tool 调用、参数、结果、发布版本和安装任务继续写入 Job/Artifact 审计。

新的自操作 capability 不再携带 Runtime 执行次数或 Evaluation 执行次数预算。控制面只校验 action 和对象范围；最大迭代次数由 Operator Session 在启动每个 Agent Turn 前持久化检查。

## 最大迭代次数

普通自操作创建表单只显示“最大迭代次数”，默认值为 50，必须为正整数。

一次迭代定义为 Operator Agent 获得控制并完成一轮判断与推进。一次评测内的多个 Case、一次安装内的多个内部步骤以及一个 Tool Step 的状态轮询不分别消耗迭代次数。只有环境把已完成或失败的子 Job 结果重新注入 Operator、开始下一轮 Agent Turn 时，才进入下一次迭代。

新任务不再设置或执行以下用户硬预算：

- 累计最长运行时间；
- 独立评测次数；
- Target/Judge 执行次数；
- Token 上限；
- 费用上限。

单个 Runtime Turn、子进程和 IPC 仍保留内部故障超时、进程退出检测和重启恢复。这些是防止永久挂死的技术保护，不是用户预算，不能触发人工扩容审批。

达到最大迭代次数后：

1. 不启动下一轮 Operator Turn；
2. 当前已经开始的有副作用子 Job 按原恢复语义收敛；
3. 父任务进入带 `max_iterations_reached` 原因的暂停状态；
4. 详情显示已完成步骤、当前产物和未完成目标；
5. 原任务不能在运行时扩容；用户可从阶段性结果创建一个具有新上限的后续任务。

旧任务继续读取原有 budget 快照，以保证重启和审计兼容；新建任务只写入迭代上限。旧字段不再出现在新任务表单中。

## App 界面

“权限与预算”改为“自动化边界”，内容只有：

- 最大迭代次数；
- 默认关闭的“允许永久删除数据集或 Case”。

必要能力不再列成 20 个复选框。界面用简短说明告知用户：任务可在所选资源范围内自动运行、评测、整理、发布和安装，所有动作均有审计记录。

“关键 Case 必须通过”继续保留在自动优化停止规则中。CSS 规则改为只匹配数字输入框；复选框使用固定约 14px 的宽高、零 padding、不伸缩，并与标签文字垂直居中。在窄窗口和中文文本下不得换成整列大输入框。

## 数据流

```text
创建自操作任务
  ├─ 冻结 Skill / Dataset / Runtime 范围
  ├─ 自动加入必要 action
  ├─ 可选加入 datasets.delete
  └─ 冻结 maxIterations
          ↓
Operator capability
          ↓
Tool Step 在范围、幂等和迭代限制内直接执行
          ├─ 普通发布/安装/评测：不中断审批
          ├─ 未授权删除：立即拒绝
          └─ 达到迭代上限：暂停并报告

独立 Optimization Run 的最终 Candidate 决策
          ↓
仍进入一次最终审批
```

## 错误与恢复

- 越界对象调用继续由 capability scope 拒绝，不转换为审批。
- 未勾选删除选项时的删除调用明确返回“创建任务时未授权永久删除”。
- 达到迭代上限不标记为成功，也不丢失会话、Job、Artifact 或子任务状态。
- App 重启继续从持久化迭代计数恢复，不能把计数清零。
- 单次 Runtime 或子 Job 超时按现有失败/恢复状态处理，不申请扩大最长时间。
- 专用自动优化的最终审批、拒绝恢复和重启后复用审批语义不变。

## 测试策略

### TDD 行为回归

- 新建普通自操作请求默认包含全部必要 action，不包含 `datasets.delete`。
- 勾选删除后只额外加入 `datasets.delete`。
- Skill 发布、Rubric 发布、安装和评测在 capability 范围内直接执行，不产生 `waiting_approval`。
- 未授权删除在控制面拒绝；预授权删除直接执行且不产生二次审批。
- 达到最大迭代次数时暂停并保留阶段性结果，不创建预算扩容审批。
- 旧 budget 快照仍可恢复，新请求只使用最大迭代次数。
- Optimization Candidate 的一次最终审批仍然存在。

### Renderer 回归

- 自操作表单不再渲染 20 项必要 action 复选框和旧预算字段。
- “自动化边界”只显示最大迭代次数和永久删除选项。
- Electron Renderer smoke 读取真实布局，验证“关键 Case 必须通过”复选框宽高处于标准范围，且与文字中心线对齐。
- 窄窗口下自动化边界与停止规则不溢出、不重叠。

### 全量验证

- Desktop 全量测试；
- Electron Renderer smoke；
- 关键源码 `node --check`；
- `git diff --check`。

本改动只涉及 Electron App。DSH 页面、DSH bundle 和 DSH 插件安装流程不在本次范围内。
