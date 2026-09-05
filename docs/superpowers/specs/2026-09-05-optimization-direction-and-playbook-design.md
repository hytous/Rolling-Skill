# Skill 自动优化方向与内置 Playbook 设计

## 目标

为多轮 Skill 自动优化增加一个可选的“优化方向”，并把此前联网调研形成的 Skill 优化方法论正式沉淀为版本化内置 Playbook。新建优化任务默认由系统全面自主优化；用户填写优化方向时，Agent 在全面检查的基础上优先解决该方向的问题。

App 与 DSH 必须使用同一份 Playbook、同一套评测证据投影和同一个提示词构造器。优化不依赖目标 Runtime 是否额外安装了 `skill-creator`、`writing-skills` 或其他指导 Skill，也不在每个 Epoch 临时联网搜索方法论。

本设计延续现有 Epoch-only 闭环和一次最终审批，不恢复最低分、最低通过率、耐心轮数、最小提升、最长时间或 Agent Turn 上限。

## 已确认的问题

### 用户目标没有进入优化任务

App 的普通自操作表单一直显示“目标”，但切换到多轮 Skill 优化后：

- 该字段只被改成非必填；
- `optimizationValues()` 不读取它；
- 冻结优化配置和运行快照不包含它；
- Optimization Operator 收到的是程序固定生成的通用目标。

因此，用户即使填写了优化重点，当前优化 Agent 也无法稳定获得它。

### 联网调研成果没有成为运行时方法论

此前已经联网调研 Agent Skills 评测指南、OpenAI Agent Evals 与 Prompt Optimizer、Anthropic Agent Evals、DSPy GEPA 和 TextGrad，并形成了以下结论：

- 优化 Agent 应同时看到当前 Skill、失败断言、Judge 反馈、执行轨迹和人工反馈；
- 修改必须从证据中泛化，不能围绕单个 Case 写死答案；
- 每轮生成独立候选版本，并在固定数据集和评分标准下重新评测；
- 新旧版本需要可比较，完整回归后再交给用户审批；
- Skill 应保持精简，通过清晰触发条件、渐进披露、明确工作流和确定性脚本提高可靠性。

后续实现先落地了评测可信度，再增加候选版本优化闭环，但上述方法论没有被固化为版本化运行时输入。当前不存在由 Rolling Skill 明确加载或要求触发的 Skill 优化指导 Skill。

### App 与 DSH 的阶段提示不一致

DSH 的共享 Core 已有 `optimizationRequestMessage()`，能向优化 Agent 提供有界的基线与当前评测证据。Desktop App 仍在 `main.cjs` 中拼接简短消息，只告诉 Agent 当前 Run、Epoch 和需要调用的提交 Tool，没有使用同一份详细证据构造器。

这会造成同一优化任务在不同入口得到不同上下文，也使 App 优化 Agent 更依赖自身经验和主动查询。

### 当前并不是真正的统一系统提示词

Rolling Skill 通过 Runtime Adapter 驱动 Codex、CodeBuddy 和 DSH。现有 Operator Protocol 会以 `operatorContext` 构造环境上下文，但不同 Adapter 最终可能把它序列化成普通文本输入，并不保证每个 Runtime 都存在等价的原生 system/developer 消息接口。

因此，本设计使用“App 控制的分层上下文”作为跨 Runtime 契约，不把正确性建立在某个模型供应商的单一消息角色上。若 Runtime 支持原生高优先级指令，Adapter 可以映射到对应角色；否则必须按相同顺序和边界作为环境上下文注入。

## 选择的方案

采用“版本化内置 Playbook + 可选用户方向 + 分阶段证据注入”。

### 不采用：每个 Epoch 实时联网调研

每轮联网会引入来源漂移、网络失败、额外时延和不可复现内容，同一冻结任务可能在不同 Epoch 获得不同方法论。权威资料的更新应在产品开发阶段完成，审核后发布新的 Playbook 版本，而不是让运行中的优化 Agent 自由搜索并改变流程。

### 不采用：依赖 Runtime 预装优化指导 Skill

不同 Runtime 的 Skill 安装方式、发现规则和版本状态不同。把自动优化建立在额外安装项上，会再次引入“未安装、未触发、版本不匹配”的前置条件。Runtime 自己已有的辅助 Skill 可以被正常使用，但不能成为闭环成立的必要条件。

### 采用：共享、冻结、可审计的内置 Playbook

Rolling Skill Core 提供带 ID、版本、内容摘要和来源记录的 Playbook。启动新任务时把当前 Playbook 完整冻结进 Run 快照；App、DSH、恢复流程和报告都读取该快照，不读取可变的“最新版”。

## 用户界面

### App

切换到“多轮 Skill 优化”时，将普通自操作的“目标”字段转换为：

> 优化方向（可选）

占位提示：

> 例如：重点改善权限查询、异常下钻和失败后的恢复体验。留空时由系统全面优化。

辅助说明：

> 留空时，系统根据基线评测和用户使用体验自主寻找改进点；填写后优先处理该方向。

该字段不能再表现为普通自操作必填目标，也不能在优化模式下被静默忽略。

### DSH

DSH 的优化页面增加同名字段并使用相同语义。启动配置、详情、报告和恢复都与 App 一致。DSH 同步迁移到 Epoch-only 新任务合同，不再继续通过旧表单创建带质量阈值和多维预算的新优化任务。

### 运行详情与报告

任务详情显示：

- 用户填写时：`优化方向：<用户内容>`；
- 留空时：`优化方向：系统全面优化`；
- `优化方法：Rolling Skill Optimization Playbook vN`。

最终报告记录冻结的方向、Playbook 版本与摘要，并说明每个 Epoch 的改动如何响应用户方向或评测证据。

## 配置与冻结快照

新建任务使用 `rolling-skill-optimization-config/v3` 和 `rolling-skill-frozen-optimization-run/v3`。旧 v1/v2 任务继续按原快照读取和恢复，不在恢复途中静默加入新方法论。

新配置增加：

```json
{
  "schemaVersion": "rolling-skill-optimization-config/v3",
  "optimizationDirection": "可选字符串或 null"
}
```

标准化规则：

- 去除首尾空白；
- 空字符串归一化为 `null`；
- 最大长度 8,000 字符；
- 创建后不可修改；
- 不作为停止条件、评分项或发布条件。

冻结 Run 增加：

```json
{
  "schemaVersion": "rolling-skill-frozen-optimization-run/v3",
  "optimizationDirection": null,
  "playbook": {
    "id": "rolling-skill-optimization",
    "version": 1,
    "digest": "由完整 Playbook 快照计算的 SHA-256",
    "content": "冻结后的 Optimization Playbook v1 正文",
    "sources": [
      {
        "title": "Agent Skills: Evaluating skills",
        "url": "https://agentskills.io/skill-creation/evaluating-skills",
        "retrievedAt": "2026-08-14T03:38:30.000Z"
      }
    ]
  }
}
```

Playbook 内容和来源记录参与 Run digest。应用升级后即使内置最新版变化，运行中的任务仍使用原始冻结内容。

## Playbook v1 来源

Playbook v1 固定记录以下调研来源；产品运行时不重新抓取这些页面：

- Agent Skills：`https://agentskills.io/skill-creation/evaluating-skills`
- Agent Skills：`https://agentskills.io/skill-creation/optimizing-descriptions`
- OpenAI Agent Evals：`https://developers.openai.com/api/docs/guides/agent-evals`
- OpenAI Prompt Optimizer：`https://developers.openai.com/api/docs/guides/prompt-optimizer`
- Anthropic Agent Evals：`https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents`
- DSPy GEPA：`https://dspy.ai/getting-started/gepa-optimization/`

来源记录用于解释方法论出处，不在运行时变成可执行指令。创建下一版 Playbook 时重新调研、审核、更新来源和 digest；既有 Run 继续使用原冻结版本。

## 内置 Playbook v1

Playbook 是优化 Agent 的工作方法，不是评分 Rubric。v1 至少包含以下步骤。

### 1. 从用户视角理解完整 Skill

- 阅读 `SKILL.md` 以及实际被引用的 references、scripts 和 assets；
- 明确 Skill 的触发场景、用户目标、输入输出、工具依赖和失败恢复；
- 检查完整用户旅程，不把优化缩小成几个断言或一个局部文本补丁。

### 2. 建立证据矩阵

- 对照基线、上一候选和本轮结果；
- 逐 Case 记录失败断言、Judge 理由、Runtime 错误、Trace 中的实际行为和用户反馈；
- 区分 Skill 缺陷、Runtime/服务故障、数据缺失和 Judge 证据不足；
- 不把偶发基础设施故障当成 Skill 质量退化。

### 3. 形成可泛化修改

- 修复共同原因，而不是复制 Case 问题、答案、金额或 ID；
- 检查 description/触发条件、工作流完整性、Tool 参数与分页、数据校验、错误恢复、输出格式和可复查性；
- 优先用确定性脚本处理适合程序化验证的步骤；
- 保持主 Skill 精简，把细节放在按需读取的 reference 或脚本中；
- 不因某条有效执行路径与示例顺序不同而机械判错或强制改写。

### 4. 自检候选版本

- 检查修改文件、引用关系和脚本入口；
- 运行与修改直接相关的确定性测试和静态检查；
- 确认没有无变化候选、无关文件污染和明显功能删减；
- 提交简洁的改动摘要和预期影响，交由控制器创建 Candidate、安装和评测。

### 5. 根据完整回归决定下一步

- 比较基线、上一轮和本轮的逐 Case 结果；
- 检查新增失败、明显回归、证据缺失和跨 Runtime 差异；
- 有明确、可泛化的下一步时继续；
- 已充分改善且没有值得继续的证据时结束；
- 决策必须引用真实评测证据，不虚构缺失分数。

## 分层注入与流转时机

### 第一层：Operator Protocol

创建 Runtime 会话时注入一次稳定的 Operator Protocol，包括作用域、可用 Tool、持久化 Job 语义和 Runtime 交互规则。该层由程序生成，不包含用户优化方向。

### 第二层：冻结任务上下文

创建 Optimization Operator 时注入：

- Run、Skill、基线、Dataset、Rubric 和 Runtime 身份；
- 最大 Epoch；
- 完整 Playbook v1；
- 用户优化方向，或“系统全面优化”；
- 当前隔离工作区和候选提交职责。

该层在会话首次启动和重新创建 Operator 会话时完整注入。

### 第三层：Candidate 阶段上下文

基线评测完成以及每个后续 Epoch 开始时，程序使用共享构造器发送：

- 当前 Epoch 和等待的 `submit_candidate` 动作；
- 用户优化方向；
- Playbook 版本及完整方法论正文；
- 基线、上一轮和当前可用的有界评测证据；
- 失败 Case、评分理由、执行/评分错误和关键 Trace 证据；
- 前一候选的改动与结果摘要。

每个 Candidate 阶段都重新附带 Playbook 正文，避免长会话压缩、Runtime 差异或阶段恢复导致初始方法论丢失。内容必须有固定大小上限；超限时优先压缩评测数据，不截断 Playbook、用户方向或失败索引。

### 第四层：Decision 阶段上下文

候选评测完成时发送：

- 基线、上一轮与本轮的确定性比较；
- 新增通过、持续失败、退化、执行故障和证据不足；
- 用户方向的响应摘要；
- `continue`、`finish`、`pause` 的结构化返回合同。

Decision 阶段引用冻结 Playbook 的决策原则，但不必重复与编辑无关的长篇细节。

### 第五层：Tool 结果与环境事件

Tool 输出、子 Job 完成和安装/评测状态只作为当前阶段的事实数据回注，不能替代前四层上下文。程序仍通过 Runtime 完成事件推进 Candidate、安装、评测和 Decision，不依赖 Agent 用自然语言宣布完成。

### 恢复

恢复时根据 Run 快照重建上述层级：

1. 重建 Operator Protocol；
2. 注入冻结任务上下文与完整 Playbook；
3. 根据持久化状态只恢复当前 Candidate 或 Decision 阶段；
4. 带上已完成 Epoch 的压缩摘要，不能重复创建 Epoch 或候选版本。

恢复提示不能只有“继续”，也不能读取最新版 Playbook替换冻结版本。

## 共享实现边界

在 Desktop Optimization domain 中建立可被 App 直接打包、也可被 `packages/rolling-skill-core` 复用的唯一来源；Core 保留稳定的转发入口，DSH 构建时将同一实现打入插件：

- Playbook 注册表与摘要校验；
- 任务级上下文构造器；
- Candidate 阶段消息构造器；
- Decision 阶段消息构造器；
- 有界评测证据投影；
- 用户方向归一化和展示语义。

Desktop App 删除 `main.cjs` 中单独拼接的简短优化消息，改为调用共享 Optimization domain。DSH 通过 Core 的稳定转发入口调用同一实现，不复制方法论正文或提示模板。共享实现返回结构化消息部分，Runtime Adapter负责映射到它支持的高优先级环境上下文、用户输入和普通阶段消息。

## 完整数据流

```text
用户选择 Skill / Dataset / Runtime / maxEpochs
        +
可选填写优化方向
        ↓
冻结基线、Rubric、方向、Playbook vN 和摘要
        ↓
创建隔离工作区与 Optimization Operator
        ↓
注入 Operator Protocol + 冻结任务上下文
        ↓
Baseline 完整评测
        ↓
┌─ Candidate 阶段：Playbook + 用户方向 + 评测证据
│       ↓
│  Agent 修改隔离 Skill 并调用 submit_candidate
│       ↓
│  程序创建 Candidate → 安装 → 完整评测
│       ↓
│  Decision 阶段：确定性比较 + 用户方向响应
│       ├─ continue 且未达上限 → 下一 Epoch
│       └─ finish 或达到上限 ───────────────┐
└──────────────────────────────────────────┘
                                             ↓
                                      一次最终审批
```

## 安全与权限

不额外增加面向优化 Agent 的权限边界免责声明。既有控制面继续按当前冻结范围执行，用户方向只改变优化重点，不改变程序已经授予的工作区和 Tool。

## 错误与兼容

- 当前 Playbook 缺失、摘要不匹配或无法冻结时，新任务预检失败并显示明确错误，不退化到无方法论提示。
- 新任务的用户方向和 Playbook 必须参与 idempotency 与 Run digest，重试不能创建语义不同但 ID 相同的任务。
- v1/v2 历史任务保持可读、可报告和按原语义恢复；新任务不生成旧版质量目标和预算字段。
- 评测证据过大时，保留逐 Case 索引、错误、评分理由和摘要，并明确 omitted 数量；不能把截断后的缺失当成通过。
- Runtime 不支持原生 system/developer 消息时，Adapter 使用冻结顺序的环境上下文文本，行为和审计字段保持一致。
- App 与 DSH 的 prompt digest 不一致时，测试和启动前检查必须失败，不能各自静默运行不同模板。

## 测试策略

### 合同与快照

- 空白方向归一化为 `null`，非空方向去除首尾空白并冻结；
- 超长方向被明确拒绝；
- Playbook 内容、来源和 digest 参与 Run digest；
- 篡改 Playbook、方向或摘要会导致快照校验失败；
- v1/v2 历史快照继续通过兼容测试。

### 提示词与上下文

- 首次创建、每个 Candidate 阶段和恢复会话都能看到完整 Playbook；
- 用户方向非空时出现在任务和阶段上下文，空值显示系统全面优化；
- Decision 阶段获得新旧比较和结构化动作合同；
- 大型评测证据压缩时不截断 Playbook、用户方向和失败索引；
- App 与 DSH 对同一冻结 Run 生成相同的阶段消息和 digest；
- Desktop 不再使用仅包含 Run ID 的简短独立提示。

### 闭环行为

- Agent 无需安装任何额外优化 Skill 就能收到完整方法论；
- Agent 提交 Candidate 后仍由程序负责 commit、安装、评测和最终审批；
- 用户方向不参与停止条件，Agent 可以在上限前主动结束；
- 达到最大 Epoch 后进入现有一次最终审批；
- Runtime 重连从同一阶段恢复，不重复 Candidate 或 Epoch。

### 用户界面与真实流程

- App 和 DSH 均显示“优化方向（可选）”及留空说明；
- 优化模式不再静默忽略普通“目标”文本；
- 任务详情和最终报告显示方向、Playbook 版本和摘要；
- 使用填写方向与留空两种配置各完成一次真实端到端优化冒烟；
- 验证 Agent 实际修改隔离 Skill、收到评测证据、完成下一轮决策并进入最终审批。

## 非目标

- 不让运行中的优化 Agent自由联网更新方法论；
- 不要求用户管理或选择 Playbook 版本；
- 不要求 Runtime 预安装 `skill-creator`、`writing-skills` 或其他辅助 Skill；
- 不把用户优化方向转换成评分阈值或硬停止条件；
- 不取消现有完整评测、回归保护、恢复和一次最终审批；
- 不在本次改动中重新设计 Dataset 或 Rubric 内容。
