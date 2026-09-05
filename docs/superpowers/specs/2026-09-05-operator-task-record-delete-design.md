# 自操作任务记录批量删除设计

## 背景

自操作左侧任务列表会持续展示所有历史任务。自动优化和普通自操作运行次数增加后，已完成、失败和已取消的记录会长期堆积，用户无法清理，新的任务也更难找到。

## 目标

- 用户可进入批量管理状态，勾选一条或多条已结束任务并一次删除。
- 运行中、排队中、等待审批、暂停中、正在停止和等待恢复的任务不可删除，必须先结束。
- 删除入口只属于可信 Renderer 用户操作，不作为 Operator Control Tool 暴露给 Agent。
- 删除后任务立即从列表消失，当前选择被删除时回到新建任务界面。
- 保留优化报告和审计链仍依赖的底层任务证据。
- 中英文文案和视觉样式沿用现有自操作工作台。

## 方案比较

### 方案一：物理级联删除

从 Operator Job Store 中删除 Job、Session、Step、Approval、Artifact 和 Event。优点是磁盘数据也被清理；缺点是已结束优化报告仍会读取这些 Artifact，直接删除会破坏报告和历史证据，还需要跨 Optimization、Evaluation 和 Managed Skill Store 做复杂级联。

### 方案二：增加归档列表

把已结束任务移动到独立的“已归档”页面。数据安全，但只是把拥挤转移到另一个列表，而且不符合用户明确的删除心智，还增加页面和恢复交互。

### 方案三：从任务历史逻辑删除（采用）

Operator Job Store 持久化已移除的根 Job ID；摘要列表过滤这些根任务及其关联 Session、Step、Approval，详情和 Artifact 仍保留供优化报告及审计引用。它直接解决列表堆积问题，同时不破坏历史报告。

## 交互设计

任务面板标题区增加“管理”按钮。点击后：

- 每条任务前显示选择框。
- 只有 `succeeded`、`failed`、`cancelled` 三种已结束状态可选。
- 其他状态的选择框禁用，并通过提示说明“请先停止任务”。
- 面板底部显示“全选已结束”“删除所选（N）”“取消”。
- 未选择任务时删除按钮禁用。
- 删除前显示一次确认，说明记录将从任务列表移除，优化报告和审计证据仍会保留。
- 删除成功后退出管理状态并刷新完整摘要；若当前任务被删除，切换到新建任务界面。

## 数据设计

Operator Job Store 升级为 `rolling-skill-operator-jobs/v3`，新增顶层字段：

```json
{
  "dismissedRootJobIds": []
}
```

迁移规则：

- v1 先执行既有 envelope/Artifact 路径迁移，再补空数组并写为 v3。
- v2 保持原数据不变，补空数组并写为 v3。
- v3 严格校验 ID 唯一、只引用现存根 Job，并且引用 Job 必须处于终态。

新增 `dismissJobRecords(jobIds)`：

- 输入必须是 1–100 个不重复 ID。
- 每个 ID 必须是根 Job；子 Job 不可单独删除。
- 每个根 Job 必须处于终态。
- 整批先校验再一次持久化，任意一条不合法时整批不变。
- 重复删除已移除记录是幂等的。

`readSummaryPage()` 只输出未移除根 Job 的完整树及其 Session、Step、Approval；`getJob()`、`getSession()`、`listEvents()` 和 Artifact 读取仍能访问底层证据。

## IPC 与安全边界

新增 `operator:dismiss-records` IPC：

- 继续使用现有 Renderer sender 校验。
- 只接受 `jobIds`，限制 1–100 个规范 ID。
- 直接调用 Store 的逻辑删除方法并发出摘要失效通知。
- 不新增公共 Control Method，也不加入 Runtime Agent 的 Tool 清单，Agent 无法自行删除任务历史。

## Renderer 状态

工作台维护本地 `managingJobs` 和 `selectedJobIds`。管理状态只影响列表，不改变当前 Job 的运行状态。删除成功后调用全量摘要 catch-up，确保分页、当前选择和通知 revision 一致。

## 验证

- Store 单测：v1/v2 迁移、终态根任务批量删除、活动任务拒绝、子任务拒绝、原子性、幂等性、摘要过滤、Artifact/报告依赖仍可读、重启持久化。
- Main bridge 单测：可信 IPC、严格输入、Preload API、Agent Tool 不暴露删除方法。
- Renderer 单测：管理模式、终态可选、活动项禁用、全选、确认、取消、删除后刷新和当前项回退。
- Renderer smoke：真实 DOM 中选中并删除历史任务，确认无 Renderer 错误。
- Desktop 全量、DSH 全量、构建、macOS 打包签名与安装版启动检查。
