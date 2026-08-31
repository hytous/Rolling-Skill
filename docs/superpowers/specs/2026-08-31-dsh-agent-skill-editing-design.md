# DSH Agent 对话式 Skill 编辑与自动发布设计

## 目标

在 Rolling Skill DSH 工作台的“版本管理”页补齐 Skill 修改入口。用户不需要在浏览器中手工编辑文件，而是选择 Runtime、模型和推理强度，通过连续对话让 Agent 修改一个隔离的 Skill 草稿。用户审阅文件 Diff 后点击“应用修改并发布”，系统把修改应用到受管 Skill，并自动发布下一个补丁版本。

这项能力解决当前版本管理流程的断层：工作台已经可以导入、保存 Candidate、发布和安装，却只能通过外部编辑器修改受管 Skill。新流程保留外部编辑能力，同时为常用修改提供可恢复、可审阅、可审计的 Agent 编辑路径。

## 已确认范围

- 不建设浏览器内文本编辑器。
- 版本管理页继续提供“打开受管 Skill 文件夹”，并新增具体路径展示和复制路径。
- Agent 可以修改所选 Skill 根目录内的全部文件。
- Agent 只修改隔离草稿，不能直接修改受管工作区或 Runtime 安装目录。
- 用户可以连续追问，关闭对话框或重启 DSH 后继续编辑会话。
- 用户点击“应用修改并发布”后，系统自动创建 Candidate 并发布补丁版本。
- 发布不自动安装到任何 Runtime。
- 对话框允许选择 Runtime、模型和推理强度，并记住上一次选择。

## 明确不做

- 不在第一版实现 Monaco、文件树或任意文件的浏览器内直接编辑。
- 不把这条轻量编辑流程包装成完整自动优化；不要求 Dataset、Rubric、Judge 或 Evaluation。
- 不允许 Agent 修改其他受管 Skill、Rolling Skill 元数据、历史版本或 Runtime 安装副本。
- 不自动合并编辑期间发生的外部修改。
- 不自动发布主版本、次版本、预发布版本或自定义版本号。
- 不在发布后自动安装。
- 不让 Renderer 传入或决定本地绝对工作路径。

## 方案选择

采用“复用 Operator 会话 + 专用隔离 Skill 编辑工作区”。

现有 Operator 已支持 Runtime、模型、推理强度、连续会话、权限交互、暂停恢复和绑定受管工作区。本设计新增专用 Skill Edit Session 和 Workspace Manager，让 Operator 的原生文件工具只看到一个隔离草稿目录。完整 Optimization 继续负责多 Epoch 评测优化；普通 Operator 工作台继续负责跨领域操作；Skill Edit Session 只负责一次可审阅的 Skill 修改。

不采用以下方案：

- 复用自动优化：依赖过重，普通文本调整不应强制配置数据集和 Judge。
- 普通 DSH 对话直接打开受管目录：缺少隔离，失败或中断会污染当前 Skill。

## 用户界面

### 版本管理页

在当前 Skill 标题区增加：

- “让 Agent 编辑”：主入口。若该 Skill 已有未结束编辑会话，文案变为“继续 Agent 编辑”。
- “打开受管 Skill 文件夹”：调用 Host 解析并打开受管仓库。
- 路径文本和“复制路径”：路径由 Host 返回，只用于展示和本机剪贴板复制。

“准备发布”区域继续处理外部编辑产生的普通 Candidate。Agent 编辑成功应用后会直接发布，因此不会再停留在该区域等待用户重复操作。

### Agent 编辑对话框

使用接近全屏的大对话框：

- 标题区：Skill 名称、会话状态和当前基础摘要。
- 配置区：Runtime、模型、推理强度。会话启动后冻结并只读。
- 对话区：用户消息、Agent 回复、运行状态、权限请求和问题。
- Diff 区：按文件展示新增、修改、删除和二进制变化。
- 输入区：连续追问输入和发送按钮。
- 操作区：“放弃修改”和“应用修改并发布”。

“应用修改并发布”仅在以下条件全部成立时启用：

- Operator 当前没有正在执行的 Turn；
- 草稿相对起始快照存在真实内容变化；
- Skill 扫描和路径安全校验通过；
- 当前受管 Skill 摘要仍等于会话起始摘要；
- 会话未被放弃或应用。

关闭对话框不停止会话。用户可从同一个 Skill 的版本管理页继续。第一版每个 Skill 只允许一个活动编辑会话；新建前必须继续或放弃已有会话。

## 领域模型

新增持久化 Skill Edit Session：

~~~json
{
  "id": "uuid",
  "repositoryId": "uuid",
  "skillId": "uuid",
  "skillRoot": ".",
  "baseCommit": "full sha or null",
  "baseContentDigest": "sha256:...",
  "baseSnapshotDigest": "sha256:...",
  "workspaceId": "uuid",
  "operatorSessionId": "uuid or null",
  "runtime": {
    "runtimeId": "stable runtime id",
    "modelId": "model or null",
    "effort": "effort or null"
  },
  "state": "draft | running | idle | applying | published | discarded | failed | needs_recovery",
  "publishedVersionId": "uuid or null",
  "publishedVersionLabel": "1.0.1 or null",
  "error": "bounded public error or null",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
~~~

状态约束：

~~~text
draft → running ↔ idle
  │        │       │
  ├────────┴───────┼→ applying → published
  │                ├→ discarded
  │                └→ failed / needs_recovery
  └──────────────────→ discarded
~~~

终态会话保留只读元数据、对话审计和最终 Diff 摘要。草稿工作区在成功发布或放弃后清理。清理失败不改变发布结果，但记录诊断。

## 隔离编辑工作区

新增 SkillEditWorkspaceManager，工作区位于 Rolling Skill 数据根目录下的专用 owner-only 目录，不位于目标工程或 Runtime 安装目录。

启动会话时：

1. 在仓库级读锁内解析所选受管 Skill。
2. 读取当前 Working 内容，而不是只读取最新 Released。这样用户通过外部编辑器完成但尚未发布的修改也会成为 Agent 的起点。
3. 使用安全复制器把所选 skillRoot 的精确快照复制到新工作区。复制器拒绝路径逃逸、设备文件和越界符号链接。
4. 在隔离工作区初始化内部 Git 仓库，并提交只用于 Diff 的 baseline commit。
5. 记录 baseCommit、baseContentDigest 和完整文件清单摘要。

工作区只包含所选 Skill 的文件，不包含同仓库的其他 Skill。Operator 的 cwd 指向该目录。每轮结束后重新扫描工作区；检测到越界、非法文件类型或损坏的 Skill 结构时，保留会话但把应用状态标记为不可用。

## Operator 集成

扩展 managedSkillBinding，允许绑定 skillEditSessionId。Host 根据服务端会话记录解析实际工作区，不接受 Renderer 传入路径。

Skill 编辑 Operator 使用最小权限：

- 原生 Runtime 文件读取和写入能力仅作用于隔离工作区；
- Rolling Skill 控制面只授予读取所选 Skill 元数据和处理当前 Operator 交互所需的能力；
- 不授予 skills.release、installations、数据集写入或优化执行能力；
- Agent 无法自行调用应用或发布接口。

初始内部指令说明：

- 当前任务是修改一个隔离的 Skill 草稿；
- 仅修改当前目录；
- 不执行发布、安装或版本操作；
- 对不明确的需求先在对话中询问；
- 每轮结束总结改动，但成功与否以 Host 计算的 Diff 和校验为准。

用户在对话框中处理 Runtime 权限请求和问题。运行中的 Turn 不允许应用；用户可以关闭对话框，后台继续执行。

## Host API

在现有同源受限 JSON API 中新增：

- skillEdits.list({skillId})
- skillEdits.start({skillId, runtimeId, modelId, effort, objective})
- skillEdits.get({sessionId})
- skillEdits.send({sessionId, text})
- skillEdits.diff({sessionId})
- skillEdits.applyAndRelease({sessionId, expectedRevision})
- skillEdits.discard({sessionId, expectedRevision})
- skills.path({skillId})

所有写请求继续由 Host 生成或校验幂等键和 revision。公开 DTO 不返回内部工作区绝对路径、Capability、环境变量、原始异常或控制 socket 信息。skills.path 只返回受管 Skill 的用户可见路径；编辑会话接口不返回草稿工作区路径。

skillEdits.get 返回会话状态、Runtime 显示信息、经过裁剪的连续对话、发布结果和当前 Diff 摘要。大型对话与 Diff 使用分页或明确的大小上限，避免一次请求撑爆 DSH Client。

## Diff

Diff 由 Host 根据隔离工作区 baseline commit 计算，Renderer 不上传修改正文或自报摘要。

每个文件条目包含：

- 相对路径；
- added、modified、deleted 或 binary；
- 修改前后大小和摘要；
- 有界 unified diff；
- 是否因大小限制而截断。

文本文件按 UTF-8 或可靠检测结果渲染。二进制文件、大文件和无法安全解码的文件只显示元信息。Diff 只允许 skillRoot 内的规范相对路径。

没有 Diff 时禁用应用。只有时间戳或内部 Git 元数据变化不算 Skill 内容变化。

## 应用并自动发布

applyAndRelease 是一个服务端编排操作，Renderer 不能拆成“复制、Candidate、Release”三个可独立失败的步骤。

执行顺序：

1. 获取仓库级独占 mutation lock。
2. 重新读取当前受管 Skill 的 commit、Working 摘要和安全文件清单。
3. 与会话冻结的 baseCommit、baseContentDigest 和 baseSnapshotDigest 比较。
4. 如有外部变化，返回 RESOURCE_CHANGED，不修改任何文件，保留草稿。
5. 校验草稿 Skill 身份、结构、路径、文件限制和内容摘要；无实际变化时返回 NO_CHANGES。
6. 计算下一个自动版本号。
7. 备份所选 Skill 当前 Working 快照和仓库 HEAD/索引状态。
8. 仅把草稿文件树应用到所选 skillRoot，不暂存或提交同仓库其他 Skill 的改动。
9. 创建包含所选 Skill 修改的 commit 和 Candidate 记录。
10. 使用同一 commit、内容摘要和预期 Candidate 状态发布 Released 版本。
11. 标记编辑会话为 published，记录版本 ID 和版本号。
12. 异步清理隔离工作区。

步骤 8–10 发生失败时执行补偿：恢复所选 Skill 的原始 Working 快照、仓库 HEAD/索引和 Candidate 元数据。补偿成功后会话回到可重试状态；补偿失败则进入 needs_recovery，停止任何后续版本动作并展示精确诊断。不会把“文件已改但未发布”包装成成功。

## 自动版本号

版本号只考虑当前 Skill 的 Released 版本：

1. 收集符合 major.minor.patch 的正式版本标签。
2. 没有符合项时使用 1.0.0。
3. 有符合项时选择数值最大的版本并把 patch 加一。
4. 若计算结果已被任何历史版本占用，继续增加 patch 直到可用。

自定义标签和预发布标签保留在历史中，但不参与最大值比较。自动流程不修改 major 或 minor。发布成功后 UI 明确显示新版本号。

## 冲突与恢复

### 外部修改冲突

编辑期间受管 Skill 的内容、HEAD 或起始文件清单发生变化时，应用必须失败关闭。UI 提供“基于当前内容重新开始”：

- 保留旧会话为只读冲突记录；
- 创建以当前 Working 内容为基础的新编辑会话；
- 不自动搬运旧草稿或尝试三方合并。

### Runtime 失败

Agent Turn 失败、断开或被取消时保留工作区和已有 Diff。用户可继续发送消息或恢复会话。Runtime 不支持原生 resume 时，服务用已保存的有界对话上下文创建续接线程。

### DSH 重启

启动时扫描非终态 Skill Edit Session：

- 工作区、Operator Job 和 Runtime 会话可恢复：恢复原状态；
- 工作区存在但 Operator 不可恢复：标记 idle，允许续接；
- 工作区缺失或摘要不一致：进入 needs_recovery，禁止应用；
- applying 状态根据持久化检查点执行恢复或补偿，不能盲目重跑发布。

## 路径与安全

- 受管路径和草稿路径仅由 Host 解析。
- API 只接受稳定 ID、消息、Runtime 配置和 revision。
- 所有复制、Diff 和应用操作拒绝绝对路径、父目录跳转、越界符号链接、设备文件和异常文件数量。
- 草稿内部 .git 仅供 Host 计算 Diff，不会复制回受管 Skill。
- Agent 生成的文件在应用前重新经过 Managed Skill 扫描限制。
- Runtime 安装目录不参与编辑工作流。
- 同一仓库的写操作串行化；同一 Skill 只允许一个活动编辑会话。

## 设置记忆

Client 记住最近一次成功启动 Skill 编辑时选择的：

- Runtime ID；
- 模型 ID；
- 推理强度。

重新打开对话框时先用 Host 返回的当前 Runtime/模型目录校验记忆值；失效值回退到 Runtime 默认，不保留不存在的模型或推理强度。不向后端写入硬编码模型默认值。

## 测试

### 单元测试

- 当前 Working 快照包含未提交的所选 Skill 修改。
- 工作区只包含所选 Skill，拒绝路径逃逸和异常文件。
- Diff 覆盖新增、修改、删除、二进制、截断和无变化。
- 自动版本号覆盖首次发布、patch 递增、非语义标签和冲突跳号。
- 状态机拒绝终态重入、运行中应用、重复发布和过期 revision。
- Client 的 Runtime、模型和推理强度记忆会过滤失效值。

### 集成测试

- 启动、连续对话、重启恢复、权限请求和恢复失败。
- Agent 文件修改只发生在隔离工作区。
- 应用前外部修改触发 RESOURCE_CHANGED，受管内容不变。
- 合法草稿一次操作完成文件应用、Candidate 和 Released 版本。
- Candidate 或 Release 失败时补偿文件、Git 和元数据。
- 同仓库其他 Skill 的脏文件不被提交或覆盖。
- 发布不创建安装 Job。
- API DTO 不泄漏草稿绝对路径、Capability 或内部错误。

### Client 与打包回归

- 版本管理页显示三个入口和可复制受管路径。
- 已有活动会话显示“继续 Agent 编辑”。
- 对话框在窄宽度下改为上下布局，不发生控件重叠或文字溢出。
- 无 Diff、运行中、冲突和校验失败时应用按钮禁用并给出原因。
- 发布成功显示版本号并刷新版本列表。
- npm run build:dsh、npm run test:dsh、包 allowlist 检查和真实 DSH 安装验收全部通过。

## 交付顺序

1. Skill Edit Store、Workspace Manager、Diff 和自动版本号。
2. Operator 的 Skill Edit 绑定与恢复。
3. skillEdits 和 skills.path Host API。
4. 版本管理入口、对话框、Runtime 配置、Diff 和冲突/发布状态。
5. 回滚、重启恢复和安全测试。
6. DSH 插件版本提升、打包、安装和真实页面验收。
