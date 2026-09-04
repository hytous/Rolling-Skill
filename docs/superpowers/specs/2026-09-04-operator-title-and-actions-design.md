# 自操作任务标题与操作按钮一致性设计

## 目标

新建 Skill 自动优化任务后，Rolling Skill 的任务列表和会话标题应显示与 Codex Runtime 任务一致的中文短标题，而不是用于驱动 Agent 的英文 objective。自操作会话中的发送、暂停/继续、停止/停止并恢复、查看报告按钮应使用同一套紧凑白蓝视觉语言。

## 问题与约束

- `operator_session_configuration.payload.title` 已保存正确的展示标题，但渲染层仍直接读取 `job.objective`。
- 根目录 Skill 的 `skillRoot` 为 `.`，不能把它当作展示名称。
- 英文 objective 是 Runtime 执行指令，仍需保留，不应为了 UI 展示而改写它。
- 老任务可能没有持久化 title 或 skillName，必须继续可读。
- 停止是高影响动作，但用户要求危险色只做轻量提示，因此默认保持中性，仅在 hover/focus 时显示危险语义。

## 设计

### 标题来源

增加纯函数 `operatorJobTitle(snapshot)`，同时兼容 Job Store 对外返回的顶层配置字段和旧测试/兼容数据中的嵌套 `payload`，并按以下顺序返回标题：

1. 最新 `operator_session_configuration` 的持久化 title；
2. 旧任务的 `job.objective`；
3. `job.id`。

左侧任务列表和中间会话标题都只调用该函数，从而避免两个位置再次分叉。

优化冻结快照的 baseline 增加可选 `skillName`。预检从受管 Skill 记录读取真实名称并写入可信冻结数据；`optimizationTaskTitle(run)` 优先使用它，再回退到非 `.` 的 skillRoot 末段和 skillId。字段保持可选，以兼容已有 v1/v2 快照。

### 按钮视觉

引入统一 `operator-action-button` 基础类：相同高度、内边距、圆角、边框、字号、字重、hover、focus 和 disabled 状态。

- 发送：`primary` 变体，使用主题强调色。
- 暂停、继续、查看报告：中性白蓝样式。
- 停止、停止并恢复：`danger` 变体，默认中性，hover/focus 才使用轻红边框与背景。

会话顶部动作和优化侧栏动作复用同一基础类。最终审批按钮也复用基础类，以保证同一区域后续出现审批时不重新破坏一致性。

## 验证

- 单元测试覆盖 title 优先级和旧任务回退。
- 控制服务测试覆盖 `skillRoot: "."` 时使用真实 Skill 名。
- 静态界面测试覆盖统一按钮类、主动作和轻量危险态。
- 运行 renderer smoke、桌面端完整测试与构建，并重新安装 macOS App 后从用户视角检查实际页面。
