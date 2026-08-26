# Managed Skill 数据集身份补全双版本设计

日期：2026-08-26  
状态：对话方案已确认，待书面规格审阅

## 1. 背景

Rolling Skill 的受管 Skill 安装记录保存了 `repositoryId`、`skillId`、Runtime、安装目录、版本和内容摘要；数据集则保存 Runtime 实际发现的 Skill 引用。正常的 Electron 全流程会把数据集绑定到 Runtime 安装目录中的 `SKILL.md`，但不会把安装记录中的受管身份补入数据集。优化预检只接受带 `repositoryId + skillId` 的数据集，因此导入、发布、安装、评测均成功后仍无法进入优化。

当前 `main` 已迁移为 DeepSeek Harness 插件。DSH 的数据集创建界面只提交名称，Core 随后写入一个代表 Rolling Skill 插件本身的 name-only 引用，同样没有受管身份。优化界面会过滤掉这类数据集，后端预检也会拒绝缺失身份的数据集。

Electron 完整版冻结在 `archive/electron-before-dsh-plugin-20260826`。本需求要在两个版本分别修复，并分别形成可安装产物。

## 2. 目标

- 新建数据集时保存 Runtime Skill 证据与完整受管身份。
- 对已有的 Runtime 路径型数据集安全补全受管身份，不清除 Cases、已发布 Rubric 或历史评测证据。
- 自动关联只允许唯一、已验证、当前身份一致的安装记录；无候选或多候选时 fail closed。
- DSH 与 Electron 使用一致的匹配语义，但各自在本分支的宿主边界内实现。
- 修复后，受管 Skill、Released 基线和对应数据集能通过优化预检。
- 分别构建并安装 DSH 插件与 macOS Electron App。

## 3. 非目标

- 不重写评测、Rubric、优化或安装协议。
- 不修改冻结的 Case、Rubric 版本或历史 Evaluation Run 中的 Skill Evidence。
- 不把名称相同视为足够证据。
- 不在存在歧义时静默选择某个 Runtime 或安装版本。
- 不删除旧 Electron 数据或 DSH 数据。
- 不合并 Electron 归档分支回 `main`。

## 4. 方案比较

### 4.1 采用：持久身份补全

在安装存储上提供只读的已验证安装查询与唯一匹配能力。创建数据集时直接写入完整引用；读取现有数据时仅对可唯一证明为同一个 Runtime Skill 的引用补全 `repositoryId`、`id` 和 `providerId`。补全沿用原 `path + runtimeId`，因此 `LocalEvaluationStore.bindDatasetSkill()` 将其视为同一 Skill 身份，不会清空已发布 Rubric。

优点是数据从此自洽，评测、优化、控制面和后续迁移共享同一身份。缺点是需要同时修改存储服务、宿主 facade 和界面创建参数。

### 4.2 不采用：仅在优化预检临时映射

只让预检临时把路径解析成受管 Skill。改动较少，但数据集继续缺失身份，优化界面、权限范围和其他调用方仍会出现不一致。

### 4.3 不采用：只增加手动重新绑定界面

让用户在优化前重新选择受管 Skill。该方案能处理歧义，但会给正常安装流程增加额外步骤，并且现有数据仍可能因重新绑定语义而丢失 active Rubric。

## 5. 统一身份与匹配规则

### 5.1 安装候选

候选必须来自持久化的普通受管安装记录，不使用 optimization experiment：

- `repositoryId`、`skillId`、`runtimeId`、`providerId`、`destination`、`contentDigest` 均完整。
- `verification` 不是 `none`，且对应安装 Job 的可信结果为成功。
- 受管 Skill 仍存在，并属于记录中的 Repository。
- 安装记录的 Skill 名称与 Runtime Skill 名称一致。

若同一 Runtime 和 Skill 有多次安装记录，只考虑每个 Runtime 最新的有效记录；仍然出现多个不同受管身份时拒绝自动关联。

### 5.2 路径规范化

安装协议返回目录，而 Runtime inventory 通常返回 `.../SKILL.md`。匹配时把两者规范化为真实的 Skill 根目录：

- Runtime 路径以 `SKILL.md` 结尾时取父目录。
- 安装 destination 保持目录；若历史记录直接保存 `SKILL.md`，同样取父目录。
- 使用绝对、规范化路径比较，不跨越符号链接边界猜测目标。
- 可读取 `.rolling-skill-managed.json` 时，要求 marker 的 Repository、Skill、Version、commit 和 digest 与安装记录一致。

### 5.3 唯一性

匹配键至少包含：

```text
runtimeId + providerId + normalizedSkillRoot + normalizedSkillName
```

marker/content digest 用于进一步证明身份。匹配结果为 0 或大于 1 时不修改数据集，并返回可理解的错误或保持数据集不可用于优化。

### 5.4 补全字段

补全后的引用保留原有 Runtime 证据字段，并增加：

```json
{
  "id": "<managed skill id>",
  "repositoryId": "<managed repository id>",
  "providerId": "<runtime provider id>"
}
```

不把版本 ID写入数据集引用；优化基线版本由用户单独选择并在预检时冻结。

## 6. DSH/Core 实现

### 6.1 数据集创建

DSH Dataset 面板加载 Managed Skill catalog 和该 Skill 的安装矩阵。创建表单除名称外，要求选择受管 Skill；若该 Skill 只有一个有效安装，自动选中，多个有效安装则显示完整 Runtime 名称、版本和路径供用户选择。

Client 提交：

```json
{
  "name": "incident-response-e2e",
  "repositoryId": "...",
  "skillId": "...",
  "runtimeId": "..."
}
```

Core 不接受 Client 传入路径或 provider 身份，而是从可信安装存储解析完整绑定后调用 `createDataset()`。

### 6.2 旧数据补全

Core 初始化后扫描缺少 `id/repositoryId` 的路径型数据集。只对唯一匹配的受管安装调用 `bindDatasetSkill()`，使用原路径和 Runtime ID并补上 IDs。name-only 的 `rolling-skill` 插件数据集没有安装路径证据，不能自动猜测，继续保持原状；用户可在界面显式选择受管 Skill 后重新绑定。

### 6.3 优化界面

Optimization 面板继续只展示完整身份匹配且已有 Published Rubric 的数据集。创建/补全成功后无需放宽此条件。

## 7. Electron 实现

Electron 保留现有“从当前 Runtime inventory 选择 Skill”的界面。`currentRuntimeSkillReference()` 完成 Runtime 验证后，使用 Runtime、名称和规范化安装路径查询唯一已验证安装，并在返回引用中补入受管 IDs。

在数据集列表进入控制面或优化工作台前，对旧的路径型引用执行相同的安全补全。补全只增加身份字段；`path + runtimeId` 不变，因此 Cases 和 active Rubric 保留。

`resolveManagedSkillBinding()` 不再只验证受管仓库内部路径；若选中 Skill 已存在唯一已验证 Runtime 安装，则返回实际安装路径的完整绑定。没有有效安装时保持 fail closed，不把受管仓库工作区误当成 Runtime 已启用安装。

## 8. 错误处理

- 无安装：提示先把 Released Skill 安装到某个 Runtime。
- 多个可用安装而未选择 Runtime：要求显式选择，不自动使用“当前”或第一项。
- 路径、marker 或 digest 冲突：拒绝补全并保留原数据。
- 旧 name-only 数据集：不自动猜测，允许显式重新绑定。
- 补全写入失败：保持原存储文件可读取，不推进优化。
- 数据集存在正在进行的 capture/curator/rubric session 时，沿用现有存储闸门；同身份字段补全仍允许原子写入。

## 9. 测试

两个分支都按 RED → GREEN：

- 安装存储返回完整、去重后的已验证安装记录。
- `SKILL.md` 路径与安装目录能规范化匹配。
- 唯一匹配补全 IDs；无匹配、provider/runtime 不符、marker 冲突和歧义均拒绝。
- 补全已有数据集后 Cases 数量、active Rubric 和历史 Evaluation Run 不变。
- DSH 创建请求必须包含受管 Skill 与 Runtime，Client 不提交路径。
- DSH 新建数据集立即带完整身份，并出现在对应 Optimization 数据集列表。
- Electron 新建和旧数据集补全均产生完整身份。
- 原始 `incident-response-e2e` 形态可通过回归测试进入优化预检。

验证范围：

- `main`：Core 与 DSH 聚焦测试、`npm run test:dsh`、`npm run build:dsh`、包检查与本机 DSH 安装。
- Electron 分支：相关聚焦测试、`desktop/rolling-skill` 完整测试、macOS App 打包、签名校验和一次本机界面/预检检查。

## 10. 分支、提交与安装

1. 在 `main` 完成 DSH/Core 修复、测试、构建、提交并推送。
2. 在当前普通 checkout 中切换到 `archive/electron-before-dsh-plugin-20260826`；遵循用户偏好，不创建 feature branch、worktree 或子 Agent。
3. 在归档分支独立完成 Electron 修复、测试、构建、提交并推送该分支。
4. 把 DSH `.tgz` 安装到本机 web profile，并重启/刷新当前 Harness。
5. 把 Electron 构建产物安装为仓库根目录的 `Rolling Skill.app`；旧 App 先移动到可恢复备份位置。
6. 两个版本的数据目录保持分离，不复制、移动或删除用户数据。

## 11. 验收标准

- DSH 新建受管 Skill 数据集包含 `id + repositoryId + providerId + runtimeId + path`。
- Electron 通过 Runtime 安装路径创建的数据集包含相同完整身份。
- 现场旧路径型数据集可在唯一匹配时无损补全。
- Cases、Published Rubric 与历史评测记录保持不变。
- 对应 Skill 的 Released 版本、数据集和 Runtime 能通过优化预检。
- 歧义、无安装或证据冲突不会产生错误绑定。
- DSH 插件与 Electron App 均完成构建、安装和一次本机检查。

