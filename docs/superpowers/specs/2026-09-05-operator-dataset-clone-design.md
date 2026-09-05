# Operator 数据集复制设计

## 背景与根因

Operator 收到“从现有数据集复制评分设置和三个 Case，新建一个数据集”时，先调用了 `datasets.create`。当前实现把受管 Skill 仓库中的 `SKILL.md` 源码路径当成 Runtime 安装路径，并要求 Runtime 上报完全相同的路径。源码位于 Rolling Skill 的受管仓库，而实际安装位于 `~/.codex/skills/...`，因此合法的受管 Skill 被误判成“未安装”，控制面再把内部异常收敛成无信息的 `CONTROL_ERROR`。

即使创建成功，现有 Operator 也只有查看、创建空数据集和删除 Case 的工具，没有复制完整 Case 与已发布评分标准的写操作。Agent 无法完成用户要求，只能停在半成品或错误诊断上。

## 目标

- `datasets.create` 创建受管数据集时只绑定稳定的 `repositoryId + skillId` 身份，不依赖当前 Runtime 或安装路径。
- 新增一个原子化的 `datasets.clone` Operator 操作：从作用域内的源数据集创建目标数据集，复制指定 Case，并复制当前已发布的评分标准。
- Agent 能从 `datasets.get(includeCases: true)` 获得 Case ID，选择三个后一次调用完成用户需求。
- 创建与复制属于已授权的非破坏性数据集写操作，不弹运行时审批。
- 工具描述明确区分“创建空数据集”和“复制数据集”，使 Agent 不再自行拼接不存在的流程。

## 方案比较

### 方案 A：专用原子复制操作（采用）

由本地数据存储在一次持久化中创建数据集、复制评分标准和指定 Case。控制面只暴露必要参数和摘要结果。

优点是用户意图与操作一一对应，不暴露完整 Case 内容给 Agent，不会出现只创建成功一半的状态，也便于范围校验与幂等控制。代价是增加一个专用控制方法。

### 方案 B：补齐“新增 Case”和“发布评分标准”底层操作

Agent 先读取完整内容，再逐条创建 Case、创建评分会话并发布。该方案调用次数多、失败中间态多，还会把大段答案和评分规则塞进工具参数，扩大控制面与上下文负担。

### 方案 C：提供通用对象复制接口

用一个通用 API 复制任意本地对象。它看似灵活，但权限边界、字段过滤和未来兼容都更难审计，超过本需求范围。

## 数据与控制流

1. Agent 调用 `datasets.get` 查看源数据集与 Case 摘要，确定要复制的三个 Case ID。
2. Agent 调用 `datasets.clone({sourceDatasetId, name, caseIds, idempotencyKey})`。
3. 控制面根据源数据集解析受管 Skill 身份，并同时校验源数据集、Skill、仓库均在冻结作用域内。
4. 本地存储校验所有 Case 都属于源数据集且 ID 不重复，然后在内存状态中构造完整副本。
5. 若源数据集存在活动评分标准，则创建目标评分标准版本并把目标数据集指向它；否则目标保持无评分标准。
6. 为每个 Case 生成新 ID、改写 `datasetId` 与时间戳，保留题目、参考答案、策展内容和证据。与源活动评分标准一致的校准引用映射到新评分标准；过期校准状态继续保持“需要校准”。
7. 所有对象一次持久化，返回目标数据集摘要、复制后的 Case 摘要和评分标准是否已复制。

## 受管 Skill 身份

数据集绑定描述“这是哪个受管 Skill”，不描述“某个 Runtime 当前把它安装在哪里”。因此新建数据集保存：

```js
{
  schemaVersion: "rolling-skill-skill-reference/v1",
  evidencePrecision: "managed",
  id: skill.id,
  repositoryId: skill.repositoryId,
  name: skill.name,
  path: null,
  scope: "managed",
  description: skill.description ?? null,
  runtimeId: null,
  providerId: null,
  confirmedAt: now,
}
```

真正运行评测或策展时，再依据受管版本和安装登记解析 Runtime 的执行路径。创建元数据不应被 Runtime 可用性阻塞。

## 契约与权限

`datasets.clone` 输入：

```js
{
  sourceDatasetId: string,
  name: string,
  caseIds: string[], // 1..100，必须唯一
  idempotencyKey: string,
}
```

它复用 `datasets.write` 权限。解析出的访问范围包含源 `datasetId`、源数据集绑定的 `skillId` 和 `repositoryId`；策略要求三者都属于 Operator 会话冻结作用域。目标 ID 由应用内部生成，无需提前加入作用域。

输出只包含公开摘要：目标数据集、复制 Case 列表、`rubricCopied` 布尔值。不会返回完整参考答案、内部路径或评分标准正文。

## 错误与一致性

- 源数据集、受管 Skill、仓库或 Case 不存在时，不执行任何写入。
- Case ID 重复、超过上限或为空时由输入契约拒绝。
- 任一 Case 不属于源数据集时拒绝整个操作。
- 构造完成后只调用一次持久化；不会留下“空数据集已创建但 Case 未复制”的半成品。
- 相同幂等键重放返回第一次结果，不重复创建数据集。

## 测试与验收

- 本地存储测试验证完整 Case、活动评分标准、校准引用和新 ID 的复制，以及失败时零写入。
- 控制契约与策略测试验证输入边界、Operator 暴露、三类作用域和无需审批。
- Domain Service 测试验证受管创建不调用 Runtime 绑定解析，并验证原子复制的公开输出。
- Operator 工具测试验证 `datasets_create` 与 `datasets_clone` 的说明能引导正确选择。
- 运行桌面端全量测试、核心/DSH 测试、Renderer smoke、构建与签名。
- 安装新版 App 后，从自操作真实发起原需求，确认生成 `billing-test`、恰好三个 Case、活动评分标准存在，且没有待审批或失败子 Job。

## 非目标

- 不新增跨 Skill 复制。
- 不复制历史评测运行、策展会话或评分会话。
- 不让 Agent 直接提交完整 Case 或评分标准正文。
- 不改变破坏性删除操作的审批策略。
