# DSH Rolling Skill 用户旅程审计

日期：2026-09-01  
对照版本：Electron App `0.9.3`  
首次检查插件：DSH `0.1.34`  
状态：实施中

## 证据规则

- `native`：DSH 原生承接，仍需插件兼容回归。
- `complete`：安装后的 DSH 页面已完整跑通。
- `partial`：有入口，但配置、执行、结果或恢复不完整。
- `broken`：用户流程被阻断、假卡住、假成功或数据不可达。
- `intentional`：明确批准且不影响任务完成的差异。

“源码里有组件”“API 能返回”“小型测试通过”均不能单独把页面标为 `complete`。

## 首轮真实环境

- 页面：`http://127.0.0.1:3080/?rollingSkill=0.1.34`
- 宿主：DeepSeek Harness `0.1.1-rc.1`
- 数据：1 个受管 Skill、1 个 Dataset、4 个 Good Case、已发布 Rubric v1
- Runtime：2 个 Codex、1 个 CodeBuddy、1 个 DeepSeek Harness
- Baseline：`npm run test:dsh`，156/156 通过；`npm run build:dsh` 成功

这份 Baseline 只能证明现有自动化没有失败，不能证明以下用户旅程可用。

## J1 工作台进入、连接与刷新

### 用户目标

从 DSH 侧栏打开工作台，在服务可用、断开和恢复时知道当前状态，并能刷新当前任务。

### App 基线

App 通过 Runtime state/notification subscription 显示连接、错误和持续更新；页面级刷新不依赖用户猜测服务状态。

### DSH 0.1.34 结果

- 侧栏入口和近全屏 Overlay 可用：`native`。
- DSH Host 退出后，已打开工作台保留陈旧内容；切换子页后每页单独显示原始 `Failed to fetch`：`broken`。
- 没有统一“Host 已断开”状态、重连入口或最后成功数据保留策略：`broken`。
- 顶部刷新会重新加载 Dashboard 并重挂当前页面；此前“只刷新 Dashboard”的怀疑经源码验证不成立。

### 证据

2026-09-01 12:03 首轮页面扫描期间，3080 Host 退出；自动沉淀、Raw Case、Draft、Case、Dataset、Skill、Rubric、Evaluation、Operator、Optimization 页面均出现 `Failed to fetch`。`curl` 返回连接失败，旧 Rubric 画面仍保留。

## J2 对话中沉淀 Case

### DSH 0.1.34 结果

- finalized Assistant 回复的 Good/Bad 按钮、已沉淀按钮和范围颜色可见：`partial`。
- 当前会话实例显示 1 个已沉淀范围，且原生 Skill/Think/JSON 节点未被替换：已获得单例 UI 证据。
- 多 Turn 起点选择、丢弃/删除后的实时颜色恢复、重新打开 Draft/Case 仍需真实矩阵：`partial`。

## J3 自动沉淀

### DSH 0.1.34 结果

- off/scheduled/automatic、运行位置、日/周、时/分、Runtime/模型/强度和 Skill→Dataset 目标均有控件：`partial`。
- Host 断开时所有下拉退化为空，页面只显示 `Failed to fetch`；没有保留设置或重连解释：`broken`（归入 J1 共性根因）。
- 保存、立即运行、后台调度启停和长任务终态仍需真实操作：`partial`。

## J4 Raw Case 分诊

### DSH 0.1.34 结果

- 代码具备受管 Skill 筛选、搜索、新增/编辑、可读 Episode Evidence、创建 Draft、原文派发和移除：`partial`。
- 多 Skill、自动来源范围、所有操作反馈和窄屏尚未安装后完整跑通：`partial`。

## J5 Draft 审核

### DSH 0.1.34 结果

- 活动/归档分类、结构化 Draft、自然语言修订、保存和放弃入口存在：`partial`。
- Curator 详情使用与 Rubric 相同的一次性 `setTimeout` 依赖：若第一次 1.5 秒轮询时服务端 `status/revision` 未变化，Effect 不再重建，页面永久停留在运行中：`broken`。
- 原始证据和审计已默认折叠；模型仍是任意文本输入，不是 Runtime 模型目录：`partial`。

## J6 Dataset 与 Case 生命周期

### DSH 0.1.34 结果

- 创建/绑定 Dataset、分页、Good/Bad、单/批 refresh、批量校准、CSV 导出和删除 API 均有 UI 入口：`partial`。
- 删除使用浏览器原生 confirm，无法呈现 App 的问题回收语义；批处理持续进度和失败接管尚未真实验证：`partial`。

## J7 Managed Skill 导入、编辑、版本与安装

### DSH 0.1.34 结果

- 文件夹/ZIP/本地 Git 可信选择器、Git URL、Agent 编辑、Diff、自动发布、版本历史、多 Runtime 安装和交互 Broker 均有入口：`partial`。
- Skill Edit、Installation 各自实现轮询和反馈，状态/错误/诊断层级不一致；全流程尚未安装后重跑：`partial`。

## J8 Dataset Rubric

### 复现

1. 在“评分标准”选择 Dataset。
2. 输入生成要求并开始。
3. Rubric 后台 Codex 任务运行 113.8 秒并完成。
4. API `rubrics.list` 返回 `needs_review`、`working:false` 和有效 Draft。
5. DSH 页面仍显示 `running` 和“评分标准生成中…”。

### 根因

`RubricPanel` 和 `RubricSessionView` 都使用只触发一次的 `setTimeout`。第一次请求若仍返回相同 `status/updatedAt/revision`，React Effect 的依赖没有变化，因此不再安排下一次轮询。

### 状态

- 后台跨 Runtime Rubric 生成已真实成功。
- 用户页面无法自动到达审核：`broken`。
- App 有持续 activity subscription；DSH 必须提供等价的持续轮询和明确终态。

## J9 Skill Evaluation

### DSH 0.1.34 结果

- 目标 Runtime 与 Judge Runtime/模型/强度分离；automatic/explicit、Case 范围、Run 列表、结构化 Judge/分数/Trace 代码入口存在：`partial`。
- 安装后真实 Run 的启动、等待、取消、结果、Case 限定 Trace 和删除尚未完整跑通：`partial`。

## J10 自操作

### DSH 0.1.34 结果

- Runtime、模型、目标、Skill/Dataset、Session 列表、审批、消息、Artifact 和控制 API 有入口：`partial`。
- 相比 App，DSH 配置明显更轻，预算/scope 的可见完整性和真实恢复尚未验证：`partial`。

## J11 自动优化

### DSH 0.1.34 结果

- Dataset/版本/Runtime、preflight、start/pause/resume/cancel/report 入口存在：`partial`。
- App 中 activation、Judge、预算、停止规则、epoch timeline、候选对比和 approval 的完整程度未在 DSH 页面得到等价证明：`partial`。

## 横切缺陷清单

| 严重级 | 缺陷 | 影响旅程 | 当前状态 |
| --- | --- | --- | --- |
| P0 | 长任务只轮询一次，后台完成但页面永久运行中 | J5、J8 | broken |
| P0 | Host 断开后每页显示原始 `Failed to fetch`，无统一恢复 | J1–J11 | broken |
| P1 | 页面把“存在 API/按钮”当作能力完成，没有真实终态证据 | J3–J11 | partial |
| P1 | App Push activity 在 DSH 中没有可靠等价机制 | J5、J7–J11 | partial |
| P2 | 英文状态、ISO 时间、内部 ID/digest 直接作为主信息 | J4–J11 | partial |
| P2 | 原生 confirm、空 select 和短暂按钮禁用造成不可理解交互 | J3–J11 | partial |
| P2 | 原 parity manifest 用生成 ID 和泛化测试把未验收项标绿 | 全部 | broken（审计可信度） |

## 本轮退出条件

- 所有 P0 关闭并在安装后页面复现通过；
- J1–J11 每条都有 installed-browser 结果；
- 没有无解释的 `broken`；
- 核心任务不存在“只有按钮/API，但无法从配置走到结果”的 `partial`；
- 完整测试、build、package inspect、安装 SHA 和真实浏览器矩阵均有新鲜证据。

