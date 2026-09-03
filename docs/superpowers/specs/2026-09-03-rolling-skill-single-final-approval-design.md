# Rolling Skill 单次最终审批设计

## 目标

将优化完成后的“发布审批 → 正式安装审批 → 最终回归评测”简化为一次用户可理解的最终决策：

- “安装改进版”：发布当前改进版并正式安装到本次冻结的全部目标 Runtime；安装成功即结束优化任务。
- “回退原版本”：不发布、不正式安装，并恢复所有实验目标在优化开始前的安装状态。

Electron App 与 DSH 插件必须使用相同的后端语义，并在优化详情中直接提供决策入口。

## 现状与问题

当前 Runner 在候选评测通过后依次申请发布审批和正式安装审批，安装后还执行最终回归评测。审批记录属于 Operator 任务，优化详情只提供跳转到 Agent 的入口，因此用户很难发现审批位置，也无法从审批按钮直接理解最终结果。

最终回归还会在用户已经批准并安装之后，重新用程序规则决定保留或回退，与“最终结果由用户审批决定”的产品意图冲突。

## 方案选择

新增单一审批动作 `optimization.release-install`，复用现有持久化审批、幂等、审计和重启恢复能力。不复用旧的 `optimization.release` 名称，避免审计记录无法表达安装副作用；不增加独立审批系统，避免复制状态与恢复逻辑。

## 状态流转

```text
候选改进版评测与决策完成
          |
          v
waiting_approval：等待最终审批
      /                         \
安装改进版                      回退原版本
    |                              |
发布不可变版本                     恢复/移除实验安装
    |
正式安装到冻结的目标 Runtime
    |                              |
安装成功 -> succeeded              成功 -> cancelled
安装失败 -> 自动恢复               失败 -> needs_recovery
              |
              +-> 恢复成功 -> failed
              +-> 恢复失败 -> needs_recovery
```

本流程不再创建第二次安装审批，也不再创建 `final-regression` Evaluation、Artifact 或状态阶段。

## 后端设计

### Runner

`OptimizationRunner` 在停止规则选择完成后进入一次 `waiting_approval`，请求 `release-install` 审批。

- 审批拒绝：调用现有恢复流程，恢复优化前的目标安装状态，任务以 `cancelled` 结束。
- 审批通过：发布当前 Candidate，然后正式安装 Released 版本。
- 正式安装成功：将当前 Epoch 和 Run 标记为 `succeeded`，清理隔离工作区。
- 发布或正式安装失败：调用现有恢复流程；恢复失败时保持 `needs_recovery`。

审批通过只授权本次冻结的 Candidate、Epoch、Run 和 Runtime 集合。发布与安装继续由程序状态机执行，Agent 不能绕过审批或自行改变目标。

### 状态与兼容

状态存储允许已审批的 `installing` 阶段在安装成功后直接进入 `succeeded`，不经过 `evaluating` 和 `deciding`。

旧 Run 中已有的 `installApprovalId`、`finalEvaluationArtifactId`、`finalRegressionPassed` 和 `final-regression` 类型继续允许读取，以免历史任务、报告或恢复数据失效；新 Run 不再写入这些字段。

### 报告

报告章节改为“最终审批与安装”，展示：

- 最终审批结果与审批 ID；
- Released 版本；
- 正式安装 Artifact；
- 安装失败后的恢复状态。

不再为新 Run 展示最终回归结果。历史 Run 若存在旧回归证据，可以放在兼容性附注中展示，但不能暗示新流程仍会执行回归。

## App 与 DSH 交互

审批入口直接放在优化详情中，而不是只藏在 Operator 任务详情里。

当当前 Run 存在待处理的 `optimization.release-install` 审批时，两端显示同样的信息：当前改进版、评测结果、涉及的 Runtime 和安装风险，并提供两个语义化按钮：

- 主操作：“安装改进版”；
- 次操作：“回退原版本”。

按钮仍调用现有 `operators.approve` 接口：前者提交 `approve/once`，后者提交 `reject/once`。审批完成后继续使用现有状态刷新机制展示发布、安装、恢复或终态进度。Operator 详情仍可显示同一审批记录，作为兼容入口，但不能产生第二份审批。

预检说明同步改为：首次实验安装和一次最终“发布并安装”需要明确审批；删除“两次审批”和“最终回归”文案。

## 错误与恢复

- 重复点击依靠审批 ID、审批终态与现有幂等键阻止重复发布或安装。
- 页面刷新或重启后，从持久化 Approval 和 Optimization checkpoint 恢复同一个待审批决定。
- 审批拒绝不是异常，而是用户选择回退；只有恢复失败才进入 `needs_recovery`。
- 正式安装部分失败必须尝试恢复全部已纳入目标的 Runtime，不把混合安装状态标记为成功。

## 测试

1. Runner 顺序测试断言只申请一次 `release-install` 审批，且 Evaluation 只有 baseline 和各轮 candidate。
2. 审批通过测试断言发布、正式安装后直接成功，没有 final-regression。
3. 审批拒绝测试断言不发布，并恢复实验安装。
4. 发布或正式安装失败测试断言执行恢复；恢复失败进入 `needs_recovery`。
5. Store 测试覆盖 `waiting_approval -> installing -> succeeded`，并保留旧 Run 的读取兼容。
6. App 与 DSH 用户旅程测试从优化详情完成“安装改进版”和“回退原版本”，验证不会生成重复审批。
7. 报告与本地化测试确认不再把新流程描述成两次审批或最终回归。

## 非目标

- 不改变 Baseline、Candidate、多 Epoch、Judge 或停止规则。
- 不删除通用 Operator 审批系统。
- 不承诺安装后的自动质量判断；最终是否安装由用户根据候选评测证据决定。
