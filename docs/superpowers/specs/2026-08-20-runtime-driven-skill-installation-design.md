# Runtime 驱动的 Skill 安装设计

## 目标

在现有受管多仓库、Candidate 和 Released 版本能力之上，为 Codex、CodeBuddy、DeepSeek Harness（DSH）提供统一的 Skill 安装入口。安装动作完全由用户选中的 Runtime Agent 在独立会话中通过 Bash 完成；Rolling Skill 只冻结安装源、编排任务、转发权限与确认交互、校验结构化结果、保存 Trace，并展示跨 Runtime 安装状态。

发布与安装是两个独立动作。发布只生成不可变 Released 版本；发布成功后提示用户前往 Runtime 安装矩阵，不自动修改任何 Runtime 文件。

本设计取代《Skill 受管多仓库、版本安装与优化闭环设计》中 provider-specific 文件安装适配器和强制原子回滚部分。受管仓库、版本生命周期、固定 commit、内容摘要和评测冻结语义保持不变。

## 明确不做

- Rolling Skill 主进程不直接复制、覆盖、删除或软链接 Runtime 的 Skill 目录。
- 不维护 Codex、CodeBuddy、DSH 的硬编码安装路径和删除脚本。
- 不自动提权，不绕过 Runtime 自己的权限模型。
- 不自动覆盖未托管、漂移、冲突或无法确认身份的目标。
- 不强制创建备份，不承诺 Runtime 崩溃后的自动回滚。
- 不安装 Working 或隐式 HEAD；只能安装已冻结的 Released `commit + skillRoot + contentDigest`。
- 不把 Agent 的自然语言“成功”当作安装成功，不在协议缺失时猜测状态。
- 首版不实现远程仓库同步、自动升级计划或 Runtime 原生插件打包。

## 核心架构

### 1. 安装源冻结

用户从 Skill 管理工作台选择一个 Released 版本。Rolling Skill 在任务创建时冻结：

- `repositoryId`
- `skillId`
- `versionId`
- 受管仓库绝对路径
- 完整 Git commit SHA
- `skillRoot`
- Skill 名称
- 预期 `contentDigest`

任务运行期间，即使 Working、分支、其他 Candidate 或新的 Released 版本发生变化，该任务仍只安装冻结的 commit。Runtime 必须从该 commit 导出 Skill，不能直接复制当前工作树。

### 2. 独立安装会话

每个 Runtime 目标创建一条独立、可见、可继续对话的安装会话。它不属于普通 Chat，也不复用评测、Curator、Rubric 或 Case 校准会话。会话保存完整模型输出、Bash 工具调用、权限申请、用户回答、最终协议和 Trace 引用。

用户为每个任务选择：

- Runtime 实例；
- Runtime 当前目录中可用的模型；
- 模型支持的推理强度；
- Runtime 权限档位。

Rolling Skill 不自动提升权限。权限不足时，Runtime 使用现有 permission/question 机制请求用户；用户可以放行、拒绝、取消，或自行安装后再执行检查。

### 3. Runtime 的职责

Rolling Skill 只给安装 Agent 一份冻结请求和规则，不给 provider-specific 路径脚本。Runtime Agent 自行：

1. 校验受管仓库、commit 和 `skillRoot` 可读；
2. 用 Git 从固定 commit 导出临时源，并计算内容摘要；
3. 发现自己实际使用的 Skill 根和目标目录；
4. 检查目标、管理标记、软链接和实际摘要；
5. 按统一分类决定是否可继续；
6. 必要时通过交互向用户说明覆盖对象和影响并请求确认；
7. 使用 Bash 复制、覆盖或清理精确目标；
8. 写入管理标记；
9. 重新计算摘要，并尽可能让 Runtime 刷新或重新发现 Skill；
10. 在最终回复中输出唯一的结构化安装结果。

Runtime 可以自行创建备份，但这不是协议强制项。Runtime 不得将命令交给 Rolling Skill 主进程代执行。

### 4. Rolling Skill 的职责

Rolling Skill 负责：

- 创建、启动、停止和恢复安装任务；
- 冻结请求并生成 provider-neutral 安装提示；
- 把 Runtime permission/question 交互展示给用户；
- 阻止同一 `runtimeId + skillId` 同时运行多个安装任务；
- 允许不同 Runtime 的安装并行，同一 Runtime+Skill 的任务串行；
- 解析并校验 `rolling-skill-install-result/v1`；
- 保存任务状态、实际模型/强度/权限、目标路径、验证等级、错误与 Trace；
- 根据已验证结果更新 Runtime 安装矩阵。

## 管理标记与安装分类

受 Rolling Skill 管理的目标目录根部包含：

```text
.rolling-skill-managed.json
```

内容为：

```json
{
  "schema": "rolling-skill-install/v1",
  "repositoryId": "repository-id",
  "skillId": "skill-id",
  "versionId": "version-id",
  "commit": "40-character-sha",
  "contentDigest": "sha256:...",
  "installedAt": "ISO-8601"
}
```

摘要计算排除该管理标记。Runtime 必须将安装前状态分类为：

- `absent`：目标不存在，可以直接安装。
- `managed-clean`：标记身份与当前 Skill 匹配，实际摘要与标记一致，可以自动更新。
- `managed-drifted`：标记身份匹配，但实际摘要与标记不一致，必须让用户确认。
- `unmanaged`：目标存在但没有管理标记，必须让用户确认。
- `conflict`：标记属于其他 Skill、标记损坏、目标或关键内容为软链接等高风险冲突，必须让用户确认；无法确定安全边界时必须失败。
- `uncertain`：Rolling Skill 有历史记录，但目标标记丢失，或证据不足以归入上述状态，必须让用户确认。

只有 `absent` 和 `managed-clean` 可以在不追加覆盖确认的情况下继续。Runtime 权限申请仍由权限策略独立决定。

## 结构化结果协议

最终回复必须包含一段以哨兵包裹的 JSON：

```text
<rolling-skill-install-result>
{
  "schema": "rolling-skill-install-result/v1",
  "status": "succeeded",
  "operation": "install",
  "classificationBefore": "absent",
  "destination": "/absolute/runtime/skill/path",
  "source": {
    "repositoryId": "repository-id",
    "skillId": "skill-id",
    "versionId": "version-id",
    "commit": "40-character-sha",
    "skillRoot": "skills/example",
    "expectedDigest": "sha256:..."
  },
  "permission": {
    "requested": "workspace-write",
    "effective": "workspace-write"
  },
  "result": {
    "actualDigest": "sha256:...",
    "markerWritten": true,
    "runtimeDiscovered": true
  },
  "warnings": [],
  "error": null
}
</rolling-skill-install-result>
```

字段约束：

- `status`：`succeeded | failed | cancelled | unverified`。
- `operation`：`install | update | overwrite | inspect`。
- `classificationBefore`：前述六种分类。
- `destination`：Runtime 报告的绝对目标路径。
- `source`：必须逐字段等于任务冻结请求。
- `result.runtimeDiscovered`：`true | false | null`；无法执行 Runtime inventory 验证时使用 `null`。
- `warnings`：字符串数组。
- `error`：成功时为 `null`，其他状态为结构化 `{code, message}`。

Rolling Skill 校验哨兵唯一、JSON 可解析、schema 正确、枚举合法、冻结身份完全匹配、路径为绝对路径、成功状态的实际摘要等于预期摘要且标记已写入。协议缺失、重复、截断、身份不匹配或字段自相矛盾时，任务进入 `unverified`，保留原始会话供用户追问，绝不更新为成功安装。

## 验证等级

安装记录同时保存验证等级：

- `runtime-inventory`：实际摘要、标记和 Runtime 原生 Skill inventory/发现结果均成功。
- `filesystem-only`：实际摘要和标记成功，但 Runtime 无法证明已重新发现。
- `none`：无法完成可靠校验。

`succeeded` 只允许 `runtime-inventory` 或 `filesystem-only`。`filesystem-only` 在安装矩阵中显示“已复制，待 Runtime 验证”，不能伪装成完全生效。协议失败、摘要不一致或验证等级为 `none` 时使用 `unverified` 或 `failed`。

## 任务状态与持久化

安装任务状态：

```text
queued → running → awaiting_permission / awaiting_confirmation
       → verifying → succeeded / failed / cancelled / unverified
```

持久化记录包含：

- 任务 ID、创建时间、完成时间；
- Runtime/provider 标识和版本；
- 冻结的 Repository/Skill/Version/commit/digest；
- 请求模型、推理强度、权限与 Runtime 报告的实际值；
- 安装前分类、目标路径、操作类型、验证等级；
- installer thread ID、Trace 引用、警告和错误；
- 结构化结果原文及校验结果。

安装矩阵读取每个 `runtimeId + skillId` 最新的可信任务；失败、取消和未验证记录保留在历史中，但不能覆盖上一次可信安装状态。

## 交互、停止与错误恢复

### 覆盖确认

遇到 `managed-drifted`、`unmanaged`、`conflict` 或 `uncertain` 时，Runtime 必须在安装会话中展示：

- 实际目标路径；
- 分类证据；
- 将要覆盖或删除的精确目录；
- 预计保留或丢失的内容；
- “继续覆盖 / 我自行安装 / 取消”选项。

用户拒绝或取消后不得继续写入。对于软链接、目标边界无法确认或危险路径，Runtime 必须失败，而不是依赖一次宽泛确认。

### 停止任务

用户点击停止时，Rolling Skill 调用对应 Runtime interrupt，将任务记为 `cancelled`。由于 Bash 可能已部分执行，Rolling Skill不能假设文件未变化；中断后自动创建同一安装会话中的只读检查 turn，让 Runtime 重新报告目标分类和摘要。检查失败则状态保持 `unverified`。

### Runtime 或协议失败

- Runtime 崩溃、断连或超时：记录 `failed` 或 `unverified`，不自动回滚。
- 权限拒绝：保留交互证据，任务 `cancelled` 或 `failed`。
- 结构化协议无效：任务 `unverified`，用户可在同一安装会话追问 Agent 修正结果或重新检查。
- Runtime 报告成功但摘要或标记不匹配：任务 `failed`。

## 界面设计

Skill 管理右侧使用页签：

```text
版本 | Runtime 安装
```

Runtime 安装页包含：

- Released 版本选择；
- Runtime 安装矩阵，每行显示 Runtime、当前可信版本、目标路径、验证等级、最近任务状态与更新时间；
- 每行的模型、推理强度、权限选择；
- “安装 / 更新 / 重新安装 / 检查”操作；
- 多选 Runtime 后并行启动；
- 安装任务队列和历史入口。

点击任务打开独立安装会话，显示普通消息、简化工具活动、权限/问题交互、停止按钮和结构化结果摘要。任务在后台运行时沿用现有后台会话抑制策略，不持续刷新不可见 DOM；切回时通过持久化快照和有限 catch-up 恢复。

Released 发布成功后显示非阻塞提示：“版本已发布，前往 Runtime 安装”，按钮只切换到 Runtime 安装页并预选该版本。

## Prompt 边界

所有 provider 使用同一套安装任务结构和安全规则。provider adapter 只负责现有的 thread/turn、模型、权限、interrupt、question 和 Trace 事件协议，不包含安装路径或复制逻辑。

Prompt 明确要求 Runtime：

- 自行通过 Bash 检查和执行；
- 只处理冻结 Skill 的精确目标；
- 不执行受管 Skill 中的脚本；
- 不读取 Working 作为源；
- 不把自然语言判断替代摘要和管理标记；
- 需要覆盖确认或权限时必须暂停交互；
- 最终只输出一份符合协议的结果。

## 测试策略

### 单元测试

- 结果协议解析、重复哨兵、截断 JSON、冻结身份不匹配和状态矛盾。
- 安装标记与六种分类规则的提示生成。
- `runtimeId + skillId` 并发锁和不同 Runtime 并行。
- 任务状态机、可信安装矩阵选择、未验证结果不覆盖可信状态。
- 停止后的 inspect turn、权限拒绝、Runtime 崩溃和协议失败。
- provider-neutral Prompt 不包含 Codex、CodeBuddy、DSH 硬编码目标路径。

### 主进程与 Renderer 测试

- IPC 只接受注册的 Runtime、Skill 和 Released version ID；renderer 不能提交仓库路径、commit 或目标路径。
- Runtime 安装页的 Released 选择、模型/强度/权限选择、并行启动、停止、会话打开和发布后提示。
- 后台安装任务不会触发不可见会话的高频全量渲染。

### 真实 Smoke

每个可用 Runtime 使用临时测试 Skill 和隔离测试目录完成：安装、更新、未托管冲突、权限拒绝、结构化结果和 Runtime 发现验证。Smoke 不接触用户真实 Skill 目录。最终再由用户在安装矩阵中选择一个正式 Released Skill 做交互式验证。

## 完成标准

- 用户可以从一个 Released 版本对多个 Runtime 并行发起安装。
- 每个安装由对应 Runtime 的独立可见会话和 Bash 工具执行。
- 权限和危险覆盖由用户在会话中明确决定。
- 成功记录能追溯固定 commit、摘要、目标、实际 Runtime 配置和完整 Trace。
- 无效协议、断连、中断或证据不足不会显示成成功。
- 发布不会自动安装，只提示进入安装矩阵。
- 现有 Chat、Case、Rubric、评测、Raw Case 和受管仓库能力不回归。
