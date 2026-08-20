# Skill 受管多仓库、版本安装与优化闭环设计

## 目标

Rolling Skill 增加一套本地优先的 Skill 管理能力，将用户提供的 ZIP、普通文件夹、本地 Git 仓库或 Git URL 统一转换为可编辑、可追溯的受管 Git 仓库，并把确定版本独立安装到 Codex、CodeBuddy、DeepSeek Harness（DSH）等 Runtime 自己的 Skill 目录。

这套能力为后续的 Skill 评测与自动优化提供稳定基线：数据集和 Rubric 保持固定，评测记录冻结实际运行的 Skill commit 与内容摘要，每轮优化留下 Candidate commit、Diff、中文报告和跨 Runtime 分数变化，用户确认后才能发布为正式版本。

## 明确不做

- 首版不建设远程 Skill 托管服务，也不自动 push、pull 或发布到公共市场。
- 不把所有 Skill 强行放进一个 monorepo；一个导入源对应一个受管仓库，一个仓库可以包含一个或多个 Skill。
- Runtime 不直接软链接 Rolling Skill 的可变工作仓库。
- 不通过普通 Agent 对话提示模型自行复制或删除安装文件。
- 导入完成后不自动安装，不在导入阶段执行 Skill 脚本。
- 优化 Agent 不得修改数据集、Case、Rubric 或既有评测结果来迎合新版本。
- 不自动覆盖或卸载 Runtime 中原本存在、但未由 Rolling Skill 管理的同名 Skill。
- 首版不把 Runtime 专属 plugin wrapper 当作统一 Skill 源；核心 Skill 可统一管理，Runtime plugin 打包留作后续扩展。

## 既有 Runtime 边界

核心 Skill 内容采用以 `SKILL.md` 为入口的目录结构。Codex 当前推荐仓库级或用户级 `.agents/skills`，并支持通过 plugin 分发；官方格式说明见 [Build skills](https://learn.chatgpt.com/docs/build-skills)。本机适配验证显示：

- Codex 可从 `.agents/skills` 发现 Skill，并提供 Skill/plugin 查询和 plugin 安装能力。
- CodeBuddy 使用 `.codebuddy/skills`，核心 Skill 文件结构兼容，但安装位置和 plugin manifest 属于 CodeBuddy 自己的协议。
- DSH 扫描 `.dsh/skills` 和 `.agents/skills`，支持软链接发现，但没有独立的 Skill 安装 RPC。

因此 Rolling Skill 统一管理 Skill 内容和版本，安装动作由 provider-specific adapter 翻译为各 Runtime 的原生目录、API 或 CLI。Runtime 实际安装副本与受管仓库分离。

## 方案比较与选择

### 方案 A：只索引外部目录

Rolling Skill 只记录 ZIP 解压位置、用户文件夹或 Git 仓库路径。实现简单，但 ZIP 和临时目录无法稳定编辑；原路径被移动、删除或修改后，评测证据无法复现；也无法为所有来源提供一致版本历史。

### 方案 B：一个统一 monorepo

所有 Skill 复制进 Rolling Skill 的一个 Git 仓库。集中管理方便，但会混合无关 Skill 的历史、权限和发布节奏；导入已有 Git 仓库时会丢失自然边界；后续接远程仓库也难以独立同步。

### 方案 C：受管多仓库 + 不可变安装快照（采用）

每个导入源归一化为 Rolling Skill 管理的本地 Git 仓库。一个仓库可以包含多个 Skill，每个 Skill 通过稳定的 `skillRoot` 定位。安装和评测只使用某个 commit 生成的不可变快照，并复制到 Runtime 自己的 Skill 根目录。

该方案兼顾独立仓库习惯、多 Skill 仓库兼容、ZIP/文件夹可编辑性、版本复现和跨 Runtime 安装确定性。

## 存储布局与职责

默认受管仓库根目录：

```text
~/Library/Application Support/Rolling Skill/repositories/
├── <repository-id>/
│   ├── .git/
│   ├── SKILL.md
│   └── ...
└── <repository-id>/
    └── skills/
        ├── skill-a/SKILL.md
        └── skill-b/SKILL.md
```

Git 保存 Skill 文件和版本历史；Rolling Skill 本地数据库保存 UI 索引、来源、Runtime 安装状态、优化任务和评测关联。数据库损坏时，可以从受管仓库、Git refs 和 Runtime 安装标记重建主要索引。

Runtime 安装目录由适配器发现和验证，例如：

```text
Codex:      <runtime-skill-root>/<skill-name>/
CodeBuddy:  <runtime-skill-root>/<skill-name>/
DSH:        <runtime-skill-root>/<skill-name>/
```

实际根目录不能由 renderer 任意传入；主进程只能使用已通过 compatibility probe 的 Runtime inventory 和对应 adapter 返回的允许目录。

## 数据模型

### Repository

```json
{
  "id": "uuid",
  "displayName": "billing-cost-management",
  "managedPath": "absolute path",
  "defaultBranch": "main or imported default branch",
  "source": {
    "kind": "zip | folder | local-git | git-url",
    "location": "redacted or display-safe origin",
    "importedAt": "ISO-8601"
  },
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

来源信息仅用于溯源。导入完成后，受管仓库是 Rolling Skill 内部编辑和版本管理的权威源，不继续依赖 ZIP 或原文件夹。

### Skill

```json
{
  "id": "uuid",
  "repositoryId": "uuid",
  "skillRoot": "skills/billing-cost-management",
  "name": "billing-cost-management",
  "description": "frontmatter description",
  "status": "valid | warning | invalid",
  "lastScannedCommit": "sha"
}
```

`repositoryId + skillRoot` 在一个仓库内唯一。Skill 重命名或移动需要显式迁移，不能只靠名称静默重绑 Dataset。

### Version

```json
{
  "id": "uuid",
  "repositoryId": "uuid",
  "commit": "full sha",
  "skillRoot": "relative path",
  "contentDigest": "sha256",
  "state": "candidate | released",
  "versionLabel": "v1.3.0",
  "createdBy": "import | user | optimization",
  "optimizationRoundId": "nullable uuid",
  "createdAt": "ISO-8601"
}
```

`contentDigest` 对安装快照中的 Skill 文件计算，排除 Rolling Skill 自己的安装元数据。一个 commit 可以包含多个 Skill，每个 `skillRoot` 拥有独立摘要和发布状态。

### RuntimeInstallation

```json
{
  "id": "uuid",
  "runtimeId": "provider instance id",
  "skillId": "uuid",
  "versionId": "uuid",
  "destination": "absolute path",
  "installedCommit": "full sha",
  "installedDigest": "sha256",
  "state": "managed | unmanaged | drifted | missing | unverified | incompatible",
  "verifiedAt": "ISO-8601",
  "previousVersionId": "nullable uuid"
}
```

### OptimizationRun 与 OptimizationRound

OptimizationRun 冻结 baseline version、Dataset、Rubric revision、Case revision、Runtime/model/reasoning 配置、停止规则和预算。OptimizationRound 记录 Candidate version、修改说明、Diff、各 Runtime 评测结果、相对基线变化、Agent 建议和最终处置。

### Evaluation 关联

每次评测继续使用既有 EvaluationRun，但新增冻结字段：

- `repositoryId`
- `skillId`
- `skillRoot`
- `commit`
- `contentDigest`
- 每个 Runtime 的安装验证结果

Dataset 绑定稳定 `skillId`；启动评测时再选择或继承具体版本。Dataset 的 Rubric 不跟随 Skill commit 自动变化。

## 导入流程

### ZIP

1. 在隔离临时目录安全解压。
2. 拒绝绝对路径、`..` 路径穿越、越界软链接、异常文件数量和压缩炸弹。
3. 忽略或移除归档中的 `.git` 元数据和 hooks。
4. 扫描所有 `SKILL.md`，展示发现的 Skill、警告和可执行文件。
5. 用户完成导入后复制到新受管目录，初始化 Git，并创建初始导入 commit。

### 普通文件夹

复制目录内容到受管目录，不继续引用原路径。若该目录实际是 Git 仓库，UI 建议改用“本地 Git”导入，以保留历史；用户仍坚持按文件夹导入时，剥离 `.git` 后创建新的初始历史。

### 本地 Git

克隆完整历史到受管目录，不直接修改用户原仓库。记录原路径作为来源；首版不自动同步。Git hooks 不在 Rolling Skill 流程中执行。

### Git URL

克隆到受管目录并记录 URL。首版只完成一次性导入，不提供后续 fetch、pull、merge 或 rebase；远程同步作为后续独立设计处理，也绝不在 App 启动或评测时自动发生。

### 多 Skill 仓库

扫描到多个合法 `SKILL.md` 时保留原仓库结构，并为每个目录创建 Skill 记录。发布、安装和评测以 `skillRoot` 为粒度；Git commit 仍属于整个仓库。

## 校验与信任边界

导入扫描至少检查：

- `SKILL.md` 存在且可读取；
- frontmatter 名称、描述和目录关系合法；
- reference、script、asset 相对路径没有逃逸仓库；
- 软链接目标位于仓库内；
- 文件数、总大小、单文件大小在配置上限内；
- 可执行文件和脚本列表可展示；
- 同一 Runtime 目标范围内是否存在名称冲突。

警告不一定阻止导入，但无效 Skill 不能发布或安装。导入扫描绝不执行仓库脚本、Git hooks 或模型生成命令。

## 版本生命周期

### Working

受管仓库当前工作树。允许用户或优化 Agent 编辑，可包含未提交内容。Working 不能作为正式“最新版”安装；需要先创建 Candidate commit。

### Candidate

已经提交、摘要固定、可安装和评测，但尚未发布的版本。每轮自动优化必须创建独立 Candidate commit。被拒绝的 Candidate 仍保留 commit、评测和报告，以便审计和比较。

### Released

用户明确确认的正式版本。发布操作为指定 commit/skillRoot 创建不可变版本记录和 Git tag。“安装最新版”只解析到最新 Released，不使用随时变化的 working tree 或 HEAD。

### 内部 Git 引用

优化候选使用 Rolling Skill 管理的内部 Git refs，避免要求用户直接处理临时分支。正式发布标签和主分支保持清晰。Rolling Skill 不因候选被拒绝而破坏其可追溯性，也不强制把拒绝版本展示在正式发布列表。

## Runtime 安装适配器

安装适配器不是独立软件，而是 Rolling Skill 内部的 provider driver。统一接口包括：

```text
inspect(runtime, skill)
install(runtime, snapshot)
update(runtime, snapshot)
switchVersion(runtime, snapshot)
uninstall(runtime, managedInstallation)
refresh(runtime)
verify(runtime, expectedIdentityAndDigest)
```

每个 adapter 负责：

- 确定 Runtime 自己的 Skill 根目录；
- 使用 Runtime 正式 API/CLI 或确定性文件复制；
- 请求 Runtime 刷新或重新发现 Skill；
- 将 Runtime inventory 映射为统一安装状态；
- 返回 typed evidence，而不是只返回自由文本。

首选顺序：Runtime 原生安装 API/CLI、确定性文件系统安装、明确失败。不使用普通会话让 Agent 自行判断安装命令。

### Codex

核心 Skill 安装到 Codex compatibility probe 返回的允许 Skill 根；如未来使用 Codex plugin 分发，由 Codex adapter 单独生成或安装 plugin wrapper，核心仓库版本仍是权威源。

### CodeBuddy

安装到 CodeBuddy 自己的 `.codebuddy/skills` 范围，不能假设它读取 Codex 目录。CodeBuddy plugin 是独立扩展路径，不影响核心 Skill 快照复制语义。

### DSH

安装到 DSH 支持的 `.dsh/skills` 或 `.agents/skills` 根。由于 DSH 没有独立安装 RPC，首版主要使用安全文件复制，然后通过 DSH `skill.list` 验证发现结果。

## 原子安装与回滚

每个 `runtimeId + destination + skillId` 使用独立互斥锁：

1. 从指定 commit 导出 `skillRoot` 到临时 staging 目录。
2. 计算摘要并与 Version 记录比较。
3. 写入安装管理元数据，记录 repo、skillRoot、commit、摘要和安装时间。
4. 检查目标是否受管、是否漂移以及是否存在名称冲突。
5. 将既有受管版本原子移动到备份目录。
6. 将 staging 原子切换为正式目标。
7. 触发 Runtime refresh，并验证 Runtime 实际发现的名称、路径和版本证据。
8. 验证成功后更新数据库；验证失败则恢复备份并再次验证。

App 中断时，下一次启动扫描 staging/backup 事务记录并完成恢复。只有安装和验证都成功后，RuntimeInstallation 才进入 `managed`。

## 安装状态与冲突处理

- `managed`：由 Rolling Skill 安装，摘要与记录一致。
- `unmanaged`：Runtime 已有同名 Skill，但没有 Rolling Skill 管理证据。
- `drifted`：曾受管，当前内容摘要与安装记录不同。
- `missing`：数据库记录存在，但安装目录缺失。
- `unverified`：文件复制完成，但 Runtime 没有发现或无法证明发现。
- `incompatible`：Runtime 能力、目录结构或 Skill 格式不兼容。

对于 unmanaged/drifted，UI 提供：

- 从 Runtime 导入为受管仓库的新版本；
- 明确确认后使用受管版本覆盖；
- 保留现状；
- Runtime 支持安全改名时并存安装。

自动更新和卸载只作用于 `managed` 且管理标记匹配的副本。卸载前再次计算摘要；发现漂移时不能静默删除。

## Skill 管理工作台

Rolling Skill 顶部主工作区调整为：

```text
对话 | Skill 评测 | Skill 管理
```

Skill 管理页面包含：

- 左侧：受管仓库与 Skill 列表、导入入口、校验状态；
- 中间：Skill 文件、Working 状态、Candidate/Released 历史、版本 Diff、评测成绩、发布操作；
- 右侧：Codex、CodeBuddy、DSH 等 Runtime 的安装矩阵、目标位置、实际版本和操作。

主要操作：

- 导入 ZIP、文件夹、本地 Git、Git URL；
- 创建 Candidate；
- 查看 commit/Diff/来源；
- 发布或弃用正式版本；弃用只影响“最新版”选择，不删除标签和历史证据；
- 安装、批量安装、更新、切换、回滚、卸载、验证；
- 从 Runtime 导入外部修改；
- 启动固定数据集与 Rubric 的优化任务。

Runtime 中发现但尚未受管的 Skill 仍可用于 Chat 或既有评测，但显示“未纳入版本管理”。Raw Case 和 Dataset 后续绑定稳定 `skillId`；名称字符串只作为兼容旧数据和未受管 Skill 的过渡标识。

## 评测与优化闭环

### 启动

用户选择一个 Released 基线、Dataset、参与 Runtime、模型、推理强度、最大轮数、超时和可选预算。系统冻结：

- baseline commit 与内容摘要；
- Dataset/Case revision；
- Rubric revision；
- Runtime/model/reasoning/permission 配置；
- 停止与接受规则。

### 单轮流程

```text
读取基线与失败证据
  → 优化 Agent 只修改受管 Skill 工作副本
  → 创建 Candidate commit 和摘要
  → 原子安装 Candidate 到选中 Runtime
  → Runtime 间并行执行 Case
  → Case 完成即进入 Judge 队列
  → 汇总固定 Rubric 下的变化
  → 生成中文轮次报告
  → 作为下一轮基线或停止
```

优化 Agent 可以读取 Skill、固定 Rubric、Case 结果、typed trace evidence 和历史轮次报告，但不拥有修改 Dataset、Rubric、Case 或 Evaluation 的写接口。

### 轮次报告

每轮保存：

- 修改文件与逐项修改理由；
- 完整 Git Diff 与 Candidate commit；
- 各 Runtime、各 Case 的得分变化；
- 提升、退化和未变化 Case；
- 工具调用链与 Skill 执行方式变化；
- 错误、超时、交互阻断和证据缺失；
- Agent 的接受/拒绝建议与置信度；
- 实际停止原因。

### 自动继续与停止

“自动接受”仅表示使用当前 Candidate 作为下一轮优化基线，不等同于发布。默认停止条件：

- 达到最大轮数；
- 连续两轮没有达到最低提升幅度；
- 出现关键合规回退；
- 多 Runtime 出现明显退化；
- Runtime 或工具持续失败；
- 达到用户设置的超时、Token 或费用预算；
- 用户点击停止。

优化评测结束或中断后，默认把各 Runtime 恢复到开始前版本。用户可以明确选择保留 Candidate。恢复失败则标记 `drifted` 并提供修复入口。

## 并发模型

- 仓库导入和 Git 写操作按 repositoryId 串行。
- 同一 Runtime 目标 Skill 的安装操作串行。
- 不同 Runtime、不同 Skill 的安装可以并行。
- Evaluation 沿用分阶段队列：target execution、evidence preparation、judge grading 相互独立，Case 执行完成即可判分，不等待整个数据集。
- 优化任务之间若写同一 Repository，后启动任务进入等待或要求用户选择独立工作副本，不能并发改同一 working tree。
- Renderer 只订阅聚合状态；高频进度由主进程合并和限频，避免重现会话流式输出造成的 UI 刷新卡顿。

## IPC 与主进程所有权

Renderer 只传稳定 ID 和用户意图。主进程负责解析路径、校验版本、执行 Git 操作、安装事务和 Runtime 验证。新增能力按领域分组：

- `skill-repositories:list/import/remove/rescan`
- `managed-skills:list/read/validate`
- `skill-versions:list/create-candidate/release`
- `runtime-skill-installations:inspect/install/switch/uninstall/verify`
- `skill-optimization:start/stop/read/list`

所有写操作返回 typed result 和稳定错误码。renderer 不直接访问受管仓库目录或 Runtime Skill 根，也不能提供任意目标路径。

## 删除语义

- 删除 Skill 索引不自动删除其仓库。
- 删除 Repository 前列出其中全部 Skill、Runtime 安装和 Evaluation 引用。
- 有受管安装时，默认阻止删除仓库；用户需先卸载或选择保留安装副本为 unmanaged。
- Evaluation/Optimization 引用的 commit 不因 UI 删除记录而立刻清理；版本保留策略确保历史可复现。
- 物理删除优先移动到废纸篓或应用恢复区，并明确告知是否可恢复。

## 迁移与兼容

现有 Dataset 可能只保存 Skill 名称、文件路径或 runtime-discovered reference。迁移流程：

1. 扫描受管仓库和 Runtime inventory。
2. 名称、规范路径和内容摘要唯一匹配时，建议绑定到 skillId。
3. 多个候选或内容不一致时保持旧引用，并标记“待接管”，不自动猜测。
4. 既有 Evaluation 保持原始证据，不回写成新版本记录。
5. 用户可将当前 Runtime Skill 导入受管仓库，再显式修复 Dataset 绑定。

没有受管仓库时，现有 Chat、Raw Case、Curation 和 Evaluation 功能继续工作，不把 Skill 管理作为启动前置条件。

## 安全与隐私

- 受管路径、来源 URL 和安装目录只保存在本地。
- 凭据由 Git/Runtime 自己的认证机制处理，不写入仓库元数据或评测报告。
- UI 展示来源时对 URL userinfo、token、查询参数和本地敏感路径做脱敏。
- Git 命令禁用 hooks，避免隐式执行仓库代码。
- 导入、Diff 和验证可以读取文件；脚本执行只发生在用户明确启动的 Runtime 任务中。
- 安装目标必须通过 adapter allowlist 和路径解析，拒绝根目录、HOME 根、符号链接逃逸和宽泛删除。

## 错误与恢复

稳定错误类型至少包括：

- `IMPORT_ARCHIVE_UNSAFE`
- `IMPORT_LIMIT_EXCEEDED`
- `SKILL_MANIFEST_INVALID`
- `REPOSITORY_DIRTY_CONFLICT`
- `VERSION_NOT_IMMUTABLE`
- `RUNTIME_SKILL_CONFLICT`
- `RUNTIME_INSTALL_PERMISSION_DENIED`
- `RUNTIME_INSTALL_DRIFTED`
- `RUNTIME_SKILL_NOT_DISCOVERED`
- `RUNTIME_INSTALL_ROLLBACK_FAILED`
- `OPTIMIZATION_BASELINE_CHANGED`
- `OPTIMIZATION_STOPPED`

错误必须携带阶段、Runtime、Skill、版本、可恢复性和建议动作。批量安装/评测允许部分 Runtime 成功，但结果必须逐项呈现，不能用一个笼统失败覆盖全部状态。

## 测试策略

### 单元测试

- Repository/Skill/Version/Installation 数据不变量；
- ZIP 路径穿越、压缩炸弹、越界软链接、大小限制；
- 单 Skill 与多 Skill 扫描；
- digest 确定性、可执行权限和元数据排除；
- Working/Candidate/Released 状态转换；
- unmanaged/drifted/missing/unverified 状态判定；
- 安装锁、事务日志、崩溃恢复与回滚；
- 固定 Dataset/Rubric 的优化任务冻结和停止规则。

### Adapter 合约测试

对 Codex、CodeBuddy、DSH 使用 fake Runtime roots 验证：

- inspect/install/update/switch/uninstall/refresh/verify；
- 目标路径 allowlist；
- 同名外部 Skill 不被覆盖；
- Runtime 发现失败时自动回滚；
- 不同 Runtime 并行、同一目标串行。

### 真实 Runtime smoke

在本机可用 Runtime 上安装临时 fixture Skill，验证 Runtime inventory 确实发现指定名称和路径，然后切换版本、验证摘要并恢复原状态。真实 smoke 必须清理临时受管副本，不碰用户已有 unmanaged Skill。

### Renderer smoke

- 三个主工作区切换；
- 仓库导入预览和多 Skill 选择；
- 版本列表、Diff、发布和回滚；
- Runtime 安装矩阵和冲突处理；
- 优化轮次实时状态、停止、报告和恢复；
- 窄窗口布局、键盘操作和错误可访问性；
- 高频状态合并不导致全页面刷新或风车扩散。

### 发布门槛

全量单测、renderer smoke、真实 Runtime smoke、macOS 打包、稳定本地代码签名、签名校验和启动检查全部通过后，才交付新版 App。

## 分阶段实施

### Phase 1：目录与版本核心

实现 Repository/Skill/Version Store、安全导入、Skill 扫描、Candidate/Released 生命周期和只读 Skill 管理页面。

### Phase 2：Runtime 安装

实现统一 adapter contract、Codex/CodeBuddy/DSH 安装适配、安装矩阵、原子切换、验证和回滚。

### Phase 3：现有模块绑定

把 Dataset、Raw Case 和 Evaluation 从名称/路径引用迁移到稳定 skillId + frozen version，同时保留旧数据兼容。

### Phase 4：优化闭环

实现基线冻结、优化 Agent、Candidate 轮次、临时安装、跨 Runtime 评测、中文报告和停止恢复。

### Phase 5：远程与 plugin 扩展

在本地流程稳定后，再设计远程同步、凭据、冲突合并、Codex/CodeBuddy plugin wrapper 和发布市场集成。

## 验收标准

1. 用户可以从 ZIP、文件夹、本地 Git 和 Git URL 导入 Skill；导入后即使原来源被删除，受管仓库仍可编辑和提交。
2. 一个仓库可正确登记一个或多个 Skill，并以 skillRoot 独立发布和安装。
3. “安装最新版”只安装最新 Released；Candidate 必须显式选择，Working 不能直接作为正式安装版本。
4. Codex、CodeBuddy、DSH 获得各自目录中的独立副本，不依赖 Rolling Skill 工作仓库软链接。
5. 安装完成后必须由 Runtime 实际发现验证；验证失败自动恢复上一版本。
6. Rolling Skill 不静默覆盖、删除或篡改 unmanaged/drifted Skill。
7. Evaluation 记录能证明每个 Runtime 实际使用的 repository、skillRoot、commit 和 digest。
8. 自动优化期间 Dataset、Case 和 Rubric 保持冻结；每轮都有 Candidate commit、Diff、中文报告和分数变化。
9. 优化停止或 App 中断后可以恢复 Runtime 原版本，失败状态有明确修复入口。
10. 全量测试、真实 Runtime smoke、打包、稳定签名与启动验证全部通过。
