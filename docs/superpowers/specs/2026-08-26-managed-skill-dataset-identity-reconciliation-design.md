# Managed Skill 数据集绑定双版本设计

日期：2026-08-26  
状态：已完成对话设计确认

## 1. 背景与根因

Dataset-level Skill binding 早于受管 Skill 版本管理实现。旧模型把 Dataset 绑定为 Runtime inventory 返回的 `name + path + runtimeId`，目的是让 Case 和评测继承同一个已启用 Skill。当受管 Repository、Skill、Version 和 Runtime Installation 后来加入时，Dataset 模型没有随之迁移。

后来的 Skill 管理设计已经规定：Dataset 绑定稳定 `skillId`，评测启动时再选择或继承具体版本。当前代码却仍把 Runtime 安装路径当作 Dataset 身份，造成三个问题：

- Dataset 无法稳定关联受管 Skill，优化预检缺少 `repositoryId + skillId`。
- 同一 Skill 安装到 Codex、CodeBuddy、DSH 时路径不同，一个 Dataset 无法正确代表所有 Runtime。
- Runtime 安装目录属于可变部署状态，却被混入 Dataset、Case 和 Rubric 的长期领域身份。

当前 `main` 是 DeepSeek Harness 插件；Electron 完整版冻结在 `archive/electron-before-dsh-plugin-20260826`。两个版本都需要改为受管 Skill 绑定，并分别形成可安装产物。

## 2. 目标

- Dataset 只绑定稳定的受管 Skill 身份：`repositoryId + skillId`。
- Dataset、Cases 和 Rubric 不绑定 Runtime、安装路径或具体版本。
- 普通评测启动时选择 Dataset、Released Version 和目标 Runtime；后端解析并冻结每个 Runtime 的可信安装证据。
- 优化使用 Dataset 的稳定 Skill 身份校验 Released 基线和 Candidate，不再从路径反推身份。
- 旧路径型 Dataset 只在一次性迁移时使用安装路径查找受管 Skill；迁移后路径不再是 Dataset 主身份。
- 保留现有 Cases、Published Rubric、Curator 历史和 Evaluation Run 冻结证据。
- DSH 与 Electron 分别测试、构建、安装并做一次本机检查。

## 3. 非目标

- 不让 Dataset 固定到某个 Version；同一 Dataset 应可比较同一 Skill 的不同版本。
- 不让 Dataset 固定到某个 Runtime；同一 Dataset 应可跨 Runtime 评测。
- 不把受管仓库工作目录当成 Runtime 已安装副本。
- 不按名称静默关联受管 Skill。
- 不在 Runtime 缺少所选版本时自动覆盖安装；安装仍是独立、显式流程。
- 不修改历史 Case、Curator Session 或 Evaluation Run 中已经冻结的执行证据。
- 不合并 Electron 归档分支回 `main`，不删除任何用户数据。

## 4. 采用的领域模型

```text
Dataset
  └─ ManagedSkillBinding(repositoryId, skillId, name)
       ├─ Cases
       └─ Published Rubric

Evaluation Request
  ├─ datasetId
  ├─ versionId
  └─ target runtimeIds
       └─ resolve verified RuntimeInstallation per Runtime
            └─ freeze destination, commit, digest and Runtime identity in EvaluationRun

Optimization Request
  ├─ datasetId → ManagedSkillBinding
  ├─ baselineVersionId
  └─ Candidate installations created per Runtime and Epoch
```

Dataset 的领域相等只比较 `repositoryId + skillId`。`name` 是展示快照，不是身份主键。Runtime 路径、provider、版本、commit 和 digest 都属于一次执行或安装记录。

### 4.1 未选方案：Dataset 保留 Runtime 路径并补 IDs

这只能修复当前预检报错，却继续把部署状态混入 Dataset。跨 Runtime 路径不同、安装升级和目录移动仍会使 Dataset 失效，因此只允许作为旧数据迁移的输入证据，不作为新模型。

### 4.2 未选方案：预检时临时映射

只在优化预检反查安装记录会让 Dataset 列表、普通评测、Case 归属和权限范围继续不一致。

## 5. 持久数据模型

### 5.1 Dataset

现有 `skillReference` 字段升级为 managed precision，避免新增第二个并行的身份源：

```json
{
  "schemaVersion": "rolling-skill-skill-reference/v1",
  "evidencePrecision": "managed",
  "id": "<skill id>",
  "repositoryId": "<repository id>",
  "name": "incident-response-planner",
  "path": null,
  "runtimeId": null,
  "providerId": null
}
```

对 managed precision：

- `id`、`repositoryId`、`name` 必填。
- `path`、`runtimeId`、`providerId` 必须为空。
- 身份相等只比较 `repositoryId + id`。
- 受管 Skill 重命名时可以更新展示名称，不改变 Dataset 归属。

### 5.2 Evaluation Request

普通评测请求新增必填 `versionId`。Client 只提交稳定 IDs：

```json
{
  "datasetId": "...",
  "versionId": "...",
  "targets": [{"runtimeId": "...", "modelId": "...", "effort": "high"}],
  "judge": {"runtimeId": "...", "modelId": "...", "effort": "high"}
}
```

Client 不提交安装路径、commit、digest、provider 或安装 Job ID。

### 5.3 Frozen Evaluation Run

Core 校验 Version 属于 Dataset 绑定的 Skill，并从可信安装存储为每个目标 Runtime 解析所选 Version。Evaluation Run 冻结：

- Dataset 的 `repositoryId + skillId`。
- Version 的 `versionId + commit + skillRoot + contentDigest + state`。
- 每个目标 Runtime 的 `runtimeId + providerId + installationId + destination + verification`。
- 从冻结 Version commit 生成的 Skill Evidence。

Runner 向每个 Runtime 传该 Runtime 自己的安装引用，而不是共享 Dataset path。Judge 不需要安装被测 Skill。

## 6. 安装解析规则

普通评测只接受持久化的非 optimization-experiment 安装记录：

- `repositoryId`、`skillId`、`versionId` 与请求完全一致。
- `runtimeId` 与目标 Runtime 完全一致。
- `providerId` 与当前 Runtime descriptor 一致。
- `destination`、`commit`、`contentDigest` 完整。
- `verification` 不是 `none`，对应安装 Job 是可信成功结果。

同一 `Runtime + Skill + Version` 有多条记录时选择最新的有效记录；若最新记录之间仍存在冲突则 fail closed。安装 destination 可在启动时与 Runtime inventory 再验证，验证失败不能开始评测。

## 7. Dataset 创建与 Case 生命周期

### 7.1 新建 Dataset

DSH 和 Electron 创建表单只选择受管 Skill，不选择 Runtime 或安装路径。Core/Main Process 根据 `repositoryId + skillId` 查询可信 Managed Skill Store，写入 managed precision 引用。

Dataset 可以在尚未安装 Skill 时创建，以便先准备 Cases 和 Rubric；只有需要从 Runtime 对话沉淀 Case、刷新 Case 或发起评测时才要求对应 Runtime 存在匹配安装。

### 7.2 Case 沉淀与刷新

来自 Runtime 会话的 Case 仍保留当时观察到的 Runtime Skill 路径、Runtime ID、commit/digest 等冻结 provenance，但 Dataset 只保存受管身份。保存前通过安装记录或 managed marker 验证该 Runtime Skill 属于 Dataset 的 `repositoryId + skillId`。

Case、Curator Session 和历史 Evaluation Run 的旧 `skillReference` 不回写；它们是历史执行证据。

## 8. 旧数据迁移

迁移仅处理 Dataset 本身：

1. 已含完整 `repositoryId + id` 的引用直接转换为 managed precision，移除 Dataset 层的 Runtime/path 身份。
2. 路径型引用使用 `runtimeId + normalized Skill root + name` 匹配可信安装记录；安装 marker 可用时必须与记录的 Repository、Skill、Version、commit 和 digest 一致。
3. 唯一匹配时写入 managed precision；Cases、Rubric、Curator 历史和 Evaluation Runs 原样保留。
4. 0 个或多个候选时保持 legacy/unbound 状态，并要求用户显式选择受管 Skill。
5. name-only 引用不靠名称自动猜测；只能显式绑定。

安装协议通常返回目录，而 Runtime inventory 返回 `.../SKILL.md`。迁移匹配时统一规范化为 Skill 根目录，但规范化路径只用于迁移证明，不进入新 Dataset 身份。

## 9. DSH/Core 实现

- Dataset 面板加载 Managed Skill catalog，创建请求提交 `repositoryId + skillId`。
- Core `datasets.create` 从 Managed Skill Store 构造 managed precision 引用，不再写入默认 `rolling-skill` 插件引用。
- Evaluation 面板在选择 Dataset 后加载该 Skill 的版本，要求选择一个可评测 Version。
- 目标 Runtime 列表展示该 Version 的安装状态；未安装时禁止启动并引导到 Skill 安装页。
- Evaluation Service 解析 Version 和每个 Runtime 的可信安装，生成 Frozen Evaluation Run。
- Optimization 面板继续按 `repositoryId + skillId` 过滤 Dataset；无需路径补全或宽松匹配。
- Core 初始化迁移 legacy Dataset，name-only 默认 Dataset 不自动绑定。

## 10. Electron 实现

- Dataset 新建和重新绑定界面从 Managed Skill catalog 选择 Skill，不再从当前 Runtime inventory 选择路径。
- Case 沉淀界面验证当前会话 Skill 与 Dataset 受管身份的安装映射。
- 评测工作台增加 Version 选择，并按每个目标 Runtime 显示安装状态。
- Main Process 独占 Managed Skill、Version 和 Runtime Installation 的解析；Renderer 不传路径或摘要。
- `currentRuntimeSkillReference()` 继续用于会话/执行证据，不再作为 Dataset 创建 API 的输入。
- 旧路径型 Dataset 在 Store/Main Process 初始化阶段执行一次性安全迁移。

## 11. 错误处理

- Dataset 未绑定受管 Skill：禁止保存新 Case 和发起评测，提供“绑定受管 Skill”。
- Version 不属于 Dataset Skill：拒绝请求。
- 目标 Runtime 未安装所选 Version：提示先安装，不自动覆盖。
- 安装记录未验证、路径漂移或 digest 不符：拒绝评测并提供检查安装入口。
- 多个迁移候选：不修改 Dataset，要求显式选择。
- 显式重新绑定到不同 Skill：沿用未完成 Session 闸门，并清除 active Rubric；历史证据不改。
- legacy → managed 的同概念迁移：保留 active Rubric 和全部 Cases。
- 迁移写入使用现有临时文件和原子替换；失败保留旧文件。

## 12. 测试与验证

两个分支都严格执行 RED → GREEN：

- managed precision 的验证、持久化和稳定身份比较。
- Dataset 创建只接受存在且匹配的受管 Skill IDs。
- Dataset 不保存 Runtime、path 或 Version。
- 路径型 legacy Dataset 唯一迁移、无候选、歧义和 marker 冲突。
- 迁移后 Cases、Published Rubric、Curator 历史和 Evaluation Run 完全不变。
- Version 必须属于 Dataset Skill。
- 每个目标 Runtime 必须具有所选 Version 的可信安装。
- 两个 Runtime 使用不同 destination 时，Evaluation Run 分别冻结并正确执行。
- DSH 与 Electron Client 都只提交稳定 IDs，不提交路径、commit 或 digest。
- `incident-response-e2e` 旧数据迁移后可通过优化预检。

验证范围：

- `main`：Core/DSH 聚焦测试、`npm run test:dsh`、`npm run build:dsh`、包检查、本机插件安装与一次界面检查。
- Electron 分支：聚焦测试、完整 `desktop/rolling-skill` 测试、macOS App 打包、签名校验、本机安装与一次界面/预检检查。

## 13. 分支与交付顺序

1. 在 `main` 完成 DSH/Core 修复、测试、提交并推送。
2. 遵循既有偏好，不创建 feature branch、worktree 或子 Agent；在普通 checkout 切换到 `archive/electron-before-dsh-plugin-20260826`。
3. 在归档分支独立完成 Electron 修复、测试、提交并推送该分支。
4. 将 DSH `.tgz` 安装到本机 web profile 并刷新 Harness。
5. 将 Electron 构建产物安装为仓库根目录 `Rolling Skill.app`；旧 App 移到可恢复备份位置。
6. 两个版本的数据目录保持分离，不移动或删除用户数据。

## 14. 验收标准

- 两个版本的新 Dataset 只保存受管 `repositoryId + skillId`。
- Dataset 不依赖任何 Runtime 路径或安装状态。
- 普通评测明确冻结所选 Version 和每个 Runtime 的独立安装证据。
- 同一 Dataset 可以对同一 Version 执行跨 Runtime 评测。
- 优化通过稳定 Skill IDs 校验 Dataset 和 Released 基线。
- 旧路径型 Dataset 可在唯一匹配时无损迁移，歧义时不猜测。
- DSH 插件和 Electron App 均完成构建、安装和一次本机检查。
