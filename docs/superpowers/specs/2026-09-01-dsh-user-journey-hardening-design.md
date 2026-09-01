# DSH Rolling Skill 用户旅程完整性与可靠性设计

日期：2026-09-01  
状态：已确认，按用户既有授权直接进入实施

## 1. 背景与问题

当前 DSH 插件已经暴露了 Electron App 的大部分领域 API，但“存在接口”并不等于“用户可以完成任务”。此前的 surface parity 清单把大量能力按代码文件和小型测试直接标记为 green，缺少真实页面证据，导致以下问题仍能进入已安装插件：

- Rubric 和 Curator 等长任务只轮询一次，后台已完成但页面永久停在“生成中”；
- DSH Host 退出后，工作台保留旧画面，子页分别显示无上下文的 `Failed to fetch`；
- 顶部“刷新”只刷新 Dashboard，不刷新当前页面；
- 多个页面重复实现加载、错误、轮询和 mutation，状态行为不一致；
- 页面暴露空下拉框、原始状态名、ISO 时间、内部 ID、digest 和不完整的操作反馈；
- Electron App 中完整的配置、确认、进度、结果、Trace 与恢复语义在 DSH 中经常只剩一个按钮或一段内部数据；
- 现有测试偏向函数、Source contract 和 API 边界，无法证明真实用户旅程可完成。

本次工作不再把“代码存在”和“小测试通过”作为 UI 完成证明，而是以安装后的 DSH 页面和完整用户任务为验收对象。

## 2. 目标

1. 建立 Electron App → DSH 的真实用户旅程矩阵，逐项记录入口、配置、执行、等待、结果、失败恢复和 DSH 原生替代。
2. 修复所有阻断核心旅程的问题，以及同一根因影响多个页面的横切问题。
3. 补齐 Electron App 中对完成任务必要、但 DSH 当前缺失或阉割的交互和信息。
4. 在打包安装后的真实 DSH 页面中完成桌面宽度和窄宽度验收。
5. 建立能覆盖跨组件状态变化的整体测试，避免以低价值的小型断言代替用户验收。

## 3. 不做的事情

- 不修改 Electron App；它只作为能力与交互基线。
- 不复制 Electron/Chromium 壳或把 DSH 变成第二个 Electron App。
- 不重做由 DSH 原生提供的对话、会话列表、模型选择、Trace 主界面和插件管理。
- 不把内部 commit、digest、Job ID 或 Runtime 路径继续作为普通用户的主要信息。
- 不以“API 可调用”或静态 Source contract 代替安装后 UI 验收。

## 4. 方案选择

### 方案 A：继续逐页修补

每次根据截图修一个按钮、布局或状态。改动小，但加载、轮询、错误和刷新逻辑继续复制，已证明会反复产生同类缺陷。放弃。

### 方案 B：用户旅程矩阵 + 共性状态层 + 缺口闭环（采用）

先按用户任务盘点 App 和 DSH，再统一加载、重连、轮询、刷新、操作反馈和空状态，最后补齐各旅程的关键缺口。这样既保留 DSH 原生体验，又能从根上修复多个页面的重复问题。

### 方案 C：移植 Electron Renderer

功能最接近 App，但会复制会话壳、Runtime 管理和 Electron IPC 假设，包体、维护和宿主一致性成本过高。放弃。

## 5. 用户旅程矩阵

每条旅程必须覆盖 `进入 → 选择/配置 → 执行 → 等待 → 结果 → 失败/恢复 → 刷新/重开`。状态只允许：

- `native`：DSH 原生完整承接，插件只做兼容回归；
- `complete`：DSH 插件可完整完成；
- `partial`：可进入但缺少完成任务所需的交互或信息；
- `broken`：流程阻断、假成功、永久等待或数据不可达；
- `intentional`：有明确理由且不影响任务完成的差异。

### J1 工作台进入、连接与刷新

- 从 DSH 原生侧栏打开/关闭工作台；
- Host 可用时加载 Dashboard；
- Host 断开时显示统一连接状态、保留上下文并可重连；
- 顶部刷新同时刷新 Dashboard 和当前页面；
- 重开工作台后恢复路由和选择，不保留幽灵 busy 状态。

### J2 对话中沉淀 Case

- finalized Assistant 回复显示 Good/Bad 操作；
- 选择来源起点、Dataset 和问题说明；
- 前置检查失败可理解；
- Draft/已保存范围颜色、终点按钮状态和重开恢复；
- 打开对应 Draft 或 Case；DSH 原生 Trace 继续可用。

### J3 自动沉淀

- off/scheduled/automatic、运行位置、daily/weekly 和明确时分选择；
- Case 检测 Runtime、模型/强度和候选 Skill → Dataset 映射；
- 保存、后台调度启停、立即运行、运行中状态和上次结果；
- 多 Skill 列表滚动、不撑坏布局；不可选 Dataset 显示原因。

### J4 Raw Case 分诊

- 按受管 Skill 筛选/分组、搜索和新增；
- 自动来源显示限定 Case 范围的可读消息，不展示原始 Trace JSON；
- 编辑问题/备注/Skill、创建 Draft、在新对话验证和移除；
- 所有操作有确认、结果和失败恢复。

### J5 Draft 审核

- 进行中/已保存选中态明确；
- 原问题、限定来源消息和结构化 Draft 为主；
- 自然语言修订、模型/强度、持续工作状态、失败重试；
- 保存、放弃和跳转 Case；Runtime/审计细节默认折叠。

### J6 Dataset 与 Case 生命周期

- 按受管 Skill 创建/绑定 Dataset；
- Case 分页、Good/Bad 筛选、结构化详情；
- CSV 导出范围和输出模式；
- 单 Case/批量 refresh、校准、进度和人工接管；
- 删除 Case/Dataset 的可恢复确认与错误说明。

### J7 Managed Skill 导入、编辑、版本与安装

- 文件夹、ZIP、本地 Git 使用系统选择器，Git URL 使用输入框；
- 受管 Skill 列表与选择稳定；
- 打开受管目录、Agent 对话编辑、Diff、应用并自动发布；
- Released 版本历史、废弃；
- 选择版本和 Runtime 安装、Job 进度、追问、取消、审计与可信安装结果。

### J8 Dataset Rubric

- Published Rubric、版本历史和 active 标识；
- 使用设置中的 Runtime/模型/强度创建或修订；
- 自然语言生成/修订、持续进度、失败重试；
- 结构化 Draft、发布、丢弃和迁移旧标准；
- 安装与冻结证据默认摘要展示，内部摘要折叠。

### J9 Skill Evaluation

- Dataset/Case 范围、Released Version、目标 Runtime、activation mode；
- Judge Runtime/model/effort 与目标分离；
- preflight 阻断可理解；
- Run 启动、持续进度、取消、删除；
- 总分、criterion、automatic failure、Judge 和限定 Trace/Artifact 可阅读。

### J10 自操作

- Runtime、模型、目标、Managed Skill/Dataset、scope 和预算配置；
- 启动、消息、状态、审批、Artifact、暂停/恢复/取消；
- Runtime 追问和权限请求可处理；
- 详情不会被长 ID、路径或错误撑坏。

### J11 自动优化

- Dataset/Skill/版本/Runtime/Judge/停止规则配置；
- preflight 后才允许启动，阻断逐项说明；
- epoch、候选、评测对比、审批、暂停/恢复/取消；
- 报告生成和重复查看；失败后可恢复或明确终止。

## 6. 共性架构

### 6.1 Workbench 连接边界

Workbench 持有一个 `refreshEpoch` 和连接状态。顶部刷新增加 epoch；所有当前页面都收到新的 epoch 并重新加载。任一请求识别到网络断开时，页面保留已加载内容并显示统一的 Host 断开横幅，而不是把每个页面替换成孤立的 `Failed to fetch`。

重试成功后清除连接横幅，并刷新 Dashboard 与当前页面。API 错误继续保留后端的业务错误 code/message；只有网络错误转换为可理解的“DSH 服务连接已断开”。

### 6.2 持续任务轮询

新增共享轮询调度器，约束以下行为：

- 只要状态属于 active 集合，就按固定间隔继续轮询，不依赖服务端 revision 是否变化；
- 页面隐藏或组件卸载时停止；
- 网络失败保留最后状态并采用有界退避；
- 进入终态立即停止并触发父列表刷新；
- 同一组件只有一个 timer，不因 rerender 叠加；
- Curator、Rubric、Installation、Evaluation、Skill Edit、Operator、Optimization 共用相同语义。

### 6.3 操作反馈

统一操作状态组件：`starting / running / succeeded / failed`。Mutation 点击后立即显示动作名称，后台 Job 创建成功后切换为持续状态，成功给出下一步，失败保留输入并提供重试。禁止用短暂禁用按钮或按钮文案闪一下代替状态。

所有状态和时间使用用户语言与本地时间；内部 ID 只在折叠的诊断区出现。

### 6.4 空状态和能力约束

下拉框没有可用项时不显示空白控件；改为说明缺少什么、到哪里创建/安装，以及刷新入口。Runtime、版本、Dataset、Rubric 或可信安装造成的阻断在表单旁逐项解释。

### 6.5 用户确认

删除、丢弃、取消长任务等操作使用工作台内一致的确认 Dialog，说明影响和可恢复内容。浏览器原生 `window.confirm` 不作为最终交互。

## 7. App 对照原则

App 是“任务完整性”基线，不要求像素和布局一比一：

- App 的 Chat/Task/Trace/Runtime 主界面由 DSH 原生替代；
- App 的 Push event 在 DSH 中可由可靠轮询替代，但用户可见状态必须等价；
- App 的 Electron 文件选择与路径打开由 DSH Host 可信 API 替代；
- App 中只有诊断价值的 commit/digest/路径在 DSH 默认折叠；
- App 可完成而 DSH 只有一个不可用按钮、空下拉或原始 JSON 时，一律记为 `partial` 或 `broken`，不能记作 parity。

## 8. 测试与验收

### 8.1 整体功能测试

新增用户旅程验收清单，按 J1–J11 记录：前置数据、操作步骤、预期界面、实际结果和证据。测试必须运行在打包安装后的 DSH 插件上。

### 8.2 自动化测试

自动化测试围绕跨组件行为，而非零散实现细节：

- active 状态在服务端 revision 不变时仍持续轮询，直到终态；
- 顶部刷新驱动当前页面重新读取；
- 网络断开 → 保留内容 → 统一提示 → 重连成功；
- 关键工作流的 API 状态机（创建、运行、完成、失败、重试）与 UI 状态一致；
- App 用户旅程清单中的每条非 native 能力都有 DSH 实现引用和真实 UI 证据。

### 8.3 真实页面矩阵

- 普通桌面宽度；
- 窄工作台宽度；
- 中文与英文；
- 数据为空、单 Skill/Runtime、多 Skill/Runtime；
- Host 断开与恢复；
- 至少一个 Curator、Rubric、Installation、Evaluation 长任务跑到终态。

### 8.4 发布验收

1. DSH/Core 完整测试；
2. build；
3. package inspect；
4. remove/add 安装新版本；
5. 比较构建产物和安装文件 SHA-256；
6. 启动 DSH；
7. 在安装后页面重跑 J1–J11；
8. 记录仍存在的外部 Runtime 或测试数据限制，不能把未验证项标记为完成。

## 9. 实施优先级

1. P0：断线、全局刷新、永久等待、假成功、关键流程阻断；
2. P1：App 中必要但 DSH 缺失的配置、进度、结果、Trace 和恢复；
3. P2：原始状态/时间/ID、空控件、确认框、窄屏和信息层级；
4. P3：非阻断的视觉统一与诊断折叠。

## 10. 完成定义

“完成”要求同时满足：

- J1–J11 每条子步骤有实际状态和证据；
- 所有 `broken` 已关闭；
- 核心旅程不存在无理由的 `partial`；
- 自动化完整回归通过；
- 安装包、安装文件和运行版本一致；
- 真实 DSH 页面完成桌面与窄屏验收；
- 不再用 surface parity 的 ID 总数或小型 Source test 代替上述证据。

