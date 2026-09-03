# 自动优化单按钮启动设计

## 背景与根因

当前多轮 Skill 优化要求用户先点击“执行优化预检”，预检通过后才能点击“开始优化”。这把内部一致性检查暴露成了额外的用户步骤，而且开始按钮虽然处于 `disabled`，视觉上仍像可点击按钮，造成“点击没有反应”。

本次 Epoch-only 配置升级还删除了 v2 配置的 `telemetry` 字段，但 `resolveOptimizationPreflight()` 仍无条件读取 `config.telemetry.tokens` 和 `config.telemetry.cost`。合法 v2 配置因此在预检中触发 TypeError。异常发生在 Control Plane 的可信范围解析阶段，没有进入现有的服务错误诊断通道，Renderer 最终只能看到 `Control operation failed`。

## 用户流程

多轮 Skill 优化只保留一个主要动作“开始优化”。用户完成表单后点击该按钮：

1. App 从当前表单生成一份不可变配置。
2. 按钮立即进入“正在检查并启动…”状态并暂时禁用，防止重复提交。
3. `optimization.start` 在内部完成基线、数据集、Rubric、Runtime 和模型检查，并冻结本次 Run 的输入。
4. 检查通过后立即创建 Optimization Run，不再要求第二次点击。
5. 检查失败时留在当前表单，恢复按钮，并显示可执行的具体原因。

独立的“执行优化预检”按钮、预检成功摘要和“请先预检”前置状态全部删除。内部冻结与就绪检查仍保留，不降低运行一致性。

## 错误处理

- v2 配置不再读取不存在的 `telemetry`；只有 legacy v1 配置才检查 token/cost 遥测能力。
- Control Plane 对可信范围解析阶段产生的内部服务错误写入现有的、仅供本机 Renderer 消费的诊断通道；外部控制协议仍只收到安全的公共错误。
- Renderer 不再把所有 `required`、`must`、`preflight` 错误压成“配置无效”。常见的基线不匹配、缺少已发布 Rubric、Runtime 不可用和模型不可用应转换为中文可执行提示；未知错误显示安全诊断详情。
- 表单本地缺项继续使用字段的原生 required 校验，不发起后台操作。

## 状态与并发

- “开始优化”仅在请求进行期间禁用；空闲时保持可点击，并用表单校验拦截缺项。
- 同一次点击只生成一个 `optimization.start` idempotency key。
- 请求失败不会保留已通过预检的临时 Renderer 状态，也不会创建半成品 Run。
- 请求成功后沿用现有 Run 面板、轮询和恢复逻辑。

## 验证

- 单元测试覆盖 v2 配置无 `telemetry` 时预检成功，legacy v1 遥测检查仍生效。
- Control Plane 测试覆盖可信范围解析异常只向本机诊断消费者暴露具体消息，对普通调用方仍保持 `CONTROL_ERROR`。
- Operator workbench 测试覆盖只有一个“开始优化”动作、单击自动调用 `optimization.start`、请求期间禁用、失败后恢复并显示具体错误。
- Renderer smoke 覆盖单按钮流程和零 Renderer 错误。
- 安装新 App 后按真实用户路径选择现有 Skill、数据集、Released 基线和目标 Runtime，点击一次“开始优化”，确认能够越过原故障点并创建 Run；若真实运行会产生后续优化写入，则在创建成功后及时停止测试 Run。

## 非目标

- 不删除后端冻结输入和 Runtime 就绪检查。
- 不修改 Optimization Epoch、最终审批或停止语义。
- 不修改 DSH 插件。
- 不提交仓库根目录的 `.tgz` 文件。
