# 手动沉淀受管 Skill 绑定设计

## 背景

Electron App 已将 Dataset 的长期身份迁移为无路径的受管 Skill 引用，但手动沉淀、Dataset 创建/改绑和部分运行前检查仍沿用 Runtime 已安装 Skill 的本地路径。这会造成两类问题：

- 用户在 Dataset 之外再次选择 Runtime Skill，存在身份分叉和误选；
- 已绑定受管 Skill 的 Dataset 使用 `path: null`，旧运行前检查把它当成本地 Skill 路径并报 `A valid absolute Skill path is required`。

当前表单只在底部展示该英文错误，提交按钮没有处理中状态，因此用户感知为“开始沉淀没有反应”。

## 目标行为

1. Dataset 是手动沉淀时 Skill 身份的唯一来源。
2. 选择 Dataset 后，界面自动显示其绑定的受管 Skill，不提供第二个可覆盖选择。
3. 创建或改绑 Dataset 时只列出有效的受管 Skill，不列 Runtime 当前安装的其它 Skill。
4. 开始沉淀时，主进程根据 Dataset 的受管 Skill ID、当前 Runtime 和中央安装记录解析受信任的实际安装路径。
5. 找不到 Released 版本或当前 Runtime 的已验证安装时，显示面向用户的明确中文/英文阻断原因，不把 `path: null` 交给 Runtime。
6. 点击“开始沉淀”后立即显示“正在启动…”并禁用关闭、取消和重复提交；成功后关闭表单并打开 Curator，失败后恢复按钮并将错误滚入视野。

## 界面设计

### 手动沉淀表单

- 保留 Dataset 下拉框。
- Dataset 下方显示只读的“受管 Skill”状态，内容来自 `dataset.skillReference`。
- 移除手动沉淀表单中的“更换 Skill”入口；Skill 绑定属于 Dataset 管理，不属于单次 Case 沉淀。
- 新建 Dataset 行仍保留 Skill 下拉框，但数据源改成 `state.managedSkills.skills` 中状态为 `valid` 的条目。重名时附带受管仓库名称区分。
- Dataset 切换时同步刷新只读 Skill、Rubric 和安装前置状态。

### Dataset 管理

- 评测工作台中的新建 Dataset 和“更换 Skill”对话框统一使用受管 Skill 目录。
- Renderer 只提交 `{repositoryId, skillId}`；不得构造或提交路径型 `skillReference`。
- 主进程从受管目录生成规范化的 pathless managed reference 后写入 Dataset。

## 主进程数据流

```text
选择 Dataset
  → 读取 Dataset 的 managed Skill reference
  → 校验受管仓库、Skill 和 Released 版本
  → 按当前 Runtime/provider 查询中央安装记录
  → 选择与 Released commit/digest 匹配的最新已验证安装
  → 生成 executionSkillReference（含真实 SKILL.md 路径）
  → 生成 operationEvidence
  → 冻结会话 Episode 并创建 Curator Session
  → Curator 使用解析后的 Runtime Skill 执行
```

Dataset 中继续只保存受管身份；真实安装路径只进入本次操作的冻结证据，不回写 Dataset。

## 后端边界

- `datasets:create` 与 `datasets:bind-skill` 只接受受管 `repositoryId`、`skillId`。
- 手动会话沉淀和 Raw Case 转 Draft 均调用同一受管操作解析器。
- 解析器必须验证：
  - Dataset 为 pathless managed reference；
  - Skill 属于指定仓库且仍有效；
  - 存在未废弃的 Released 版本；
  - 当前 Runtime/provider 有中央日志认可的安装；
  - 安装的 version、commit、digest 与 Released 版本一致；
  - 安装目标为绝对目录。
- 任一条件不满足时在创建 Session 前失败，不产生半成品 Draft。

## 错误与反馈

- 点击提交后按钮改为“正在启动…”，并设置 `aria-busy=true`。
- 前置条件错误使用可本地化文案，例如：
  - “该数据集尚未绑定受管 Skill。”
  - “请先在当前 Runtime 安装并验证该受管 Skill。”
  - “该受管 Skill 尚无已发布版本。”
  - “该数据集尚无已发布评分标准。”
- 主进程保留精确英文错误用于日志；Renderer 将已知错误映射为当前语言的用户文案。

## 测试与验收

- 单元测试先证明受管操作解析器能从 pathless Dataset + 中央安装记录生成带绝对路径的执行引用。
- 单元测试覆盖缺少 Released 版本、缺少当前 Runtime 安装、digest 不匹配和错误仓库身份。
- Renderer 行为测试证明 Dataset 创建/改绑只提交受管 ID，手动沉淀不再从 Runtime Skill 下拉框取值。
- Renderer smoke 验证切换 Dataset 后只读 Skill 自动变化，点击提交立即出现处理中反馈，错误可见。
- 安装新版 App 后，用现有 `billing-skill-cases → billing-cost-management` 真实点击“开始沉淀”，确认创建 Curator Session 并启动 Turn。

## 非目标

- 不自动安装缺失的 Runtime Skill。
- 不改变 Dataset 已有 Case、Rubric 或历史评测的冻结证据。
- 不删除现有 Raw Case 或 Curator 记录。
