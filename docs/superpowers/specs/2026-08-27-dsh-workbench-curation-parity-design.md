# DSH 独立工作台与 Case 沉淀能力补全设计

日期：2026-08-27  
状态：已完成对话设计确认

## 1. 背景与根因

Rolling Skill 迁移到 DeepSeek Harness（DSH）时，把完整工作台注册到了 `settings.section`。这使概览、Case、Skill、评测、自动沉淀和优化全部出现在设置弹窗内。设置页因此承担了业务工作台职责，高频操作入口层级错误。

迁移还只覆盖了部分功能：

- DSH Client 可以创建 Dataset、查看或刷新 Case、编辑或删除 Raw Case。
- Shared Core 已实例化 `CurationManager` 和 `RubricManager`。
- DSH 的公开应用方法和 Client UI 没有接出 Raw Case 到 Draft、Draft 修订与保存、Rubric 生成与发布工作流。

因此当前 DSH 版不能完成 Electron 版的核心闭环：

```text
真实任务片段 -> Raw Case -> Case Draft -> 人工审核/修订 -> Case
                               ^
Dataset -> Rubric Draft -> 审核/修订 -> Published Rubric
```

## 2. 已验证的平台约束

DSH 当前没有供第三方插件安全追加顶层页面路由的公开槽位。替换 `conversation`、`sidebar` 或其他 single slot 会遮蔽宿主界面，不可采用。

`sidebar.footer.action` 是官方声明的 additive list slot，允许插件在 Settings 旁注册独立操作入口。入口组件可以自己持有覆盖层状态，因此采用：

- 在侧栏底部、Settings 旁注册 Rolling Skill 独立按钮。
- 展开侧栏时显示图标与“Rolling Skill”；折叠侧栏时显示可访问的图标按钮。
- 点击后打开接近全屏的工作台覆盖层，不替换会话页面，不依赖 Settings 弹窗。
- `settings.section` 只保留插件级配置和旧数据导入，不再承载完整工作台。

## 3. 目标

- Rolling Skill 成为 DSH 中可直接进入的独立业务工作台。
- 补齐 Raw Case 到 Draft、Draft 对话修订、保存 Case 和丢弃 Draft。
- 补齐 Rubric 草稿生成、对话修订、发布和版本历史。
- 保持 Electron 版的业务语义，同时使用 DSH 原生 React 和 UI primitives 实现界面。
- 继续遵循 Dataset 只绑定稳定 Managed Skill 身份的领域设计。
- DSH 与 Electron 共享 Core、Store、Manager 和 Runtime 适配逻辑，但保留各自原生前端与安装产物。

## 4. 非目标

- 不把 Electron、Chromium、`.app` 或 Electron Renderer 打进 DSH 插件。
- 不复制 Electron 的原生 DOM Renderer；只复用交互语义和共享领域逻辑。
- 不替换 DSH 的会话主界面或侧栏 shell。
- 本轮不新增直接编辑 Curator JSON 的表单；Draft 修订保持 Agent 对话加结构化预览。
- 不为插件包设置任意的固定字节上限。
- 不让 Client 提交或长期保存 Runtime 安装路径作为 Dataset 身份。

## 5. 方案比较

### 方案 A：侧栏独立入口 + 大型工作台覆盖层（采用）

使用 `sidebar.footer.action` 注册独立入口。它是 additive slot，不覆盖宿主 UI；覆盖层具有足够空间展示来源片段、结构化 Draft、对话历史和 Rubric。

### 方案 B：侧栏独立入口 + 窄抽屉

实现简单，但 Draft 与 Rubric 的左右对照、长文本和对话区会过度拥挤，不适合作为完整工作台。

### 方案 C：替换会话或顶层 shell

能获得最大页面空间，但依赖 single slot replacement，会遮蔽宿主已发货 UI，兼容性和升级风险不可接受。

## 6. 工作台信息架构

工作台保留现有能力，但按工作频率重组：

1. **概览**：Dataset、Case、Raw Case、Draft、Evaluation、Managed Skill 和 Optimization 状态。
2. **收件箱与 Draft**：Raw Case 列表、创建 Draft、活动 Draft 审核和归档 Draft。
3. **Case 与数据集**：Managed Skill Dataset 创建、Case 查看、刷新、删除和 CSV 导出。
4. **评分标准**：按 Dataset 查看 Published Rubric、版本历史和 Rubric Agent 会话。
5. **Skill 管理**：Repository、Skill、Version 和 Runtime Installation。
6. **Skill 评测**：Released Version 与目标 Runtime 评测。
7. **自动沉淀**：自动捕获模式、运行状态和系统调度器。
8. **自操作与优化**：Operator 和 Optimization。

设置弹窗中的 Rolling Skill section 仅保留：

- 插件 Runtime 默认值与低频插件配置。
- Electron 归档数据导入。
- 数据目录与诊断信息。

## 7. Raw Case 与 Draft 工作流

### 7.1 创建 Draft

Raw Case 行显示来源 Runtime、Skill、置信度或原因、来源完整性和当前处理状态。只有具备完整 episode provenance 的 Raw Case 才能创建 Draft。

用户点击“创建 Draft”后：

1. 选择与 Raw Case Managed Skill 身份一致的 Dataset。
2. 来源 Runtime 自动锁定；不能切换到无法访问来源 task/episode 的其他 Runtime。
3. 后端校验 Dataset 已绑定 Managed Skill、Raw Case 与 Dataset Skill 身份一致、来源 Runtime 有唯一可信安装、Dataset 有 Published Rubric。
4. 后端创建 Curation Session，并把 Raw Case 标记为已派发到该 Session。

缺失来源边界、Managed Skill 映射、可信安装或 Published Rubric 时，按钮禁用并就地显示处理办法，不先创建半成品 Session。

### 7.2 审核和修改 Draft

Draft 详情显示：

- 来源 task、episode 边界、问题和原始回答摘要。
- Dataset、Managed Skill、冻结的 Runtime/Version/Installation 证据与 Rubric 版本。
- 当前结构化 Draft 预览，包括 Case 类型、参考答案、分析与 Rubric 覆盖。
- Curator 对话和运行状态。

修改采用 Electron 现有语义：用户在对话框输入修订要求，Curator Agent 生成下一版结构化 Draft。Client 不直接修改受约束 JSON。

当 Draft 处于 `needs_review` 且通过结构、来源边界和 Rubric coverage 校验时，显示：

- “保存为 Case”：归档 Session 并写入 Case。
- “继续修改”：发送新的对话指令。
- “丢弃”：停止并归档 Session，不写入 Case。

刷新和重试继续使用同一 Session；Client 刷新不能重复创建任务。

## 8. Rubric 工作流

评分标准按 Dataset 组织。Dataset 详情显示当前 Published Rubric、版本、发布时间和历史版本。

“生成评分标准”或“修订评分标准”需要选择：

- 一个属于 Dataset Managed Skill 的 Released Version。
- 一个具有该 Version 可信安装的 Runtime。
- 可选模型和 effort；默认继承 Rubric Profile。

后端解析并冻结确切 Version、Runtime Installation、commit、digest 和 Skill evidence。Dataset 本身仍只绑定 `repositoryId + skillId`，不会因此绑定 Version 或路径。

Rubric Agent 生成结构化 Draft 后，工作台显示 criteria、权重、评分模型和对话历史。用户通过对话提出修改；Draft 通过统一 Rubric contract 校验后才允许“发布”。发布生成新的 Dataset Rubric Version，并切换 active Rubric；旧版本保留只读历史。

## 9. Managed Skill 与 Runtime 证据

长期身份与执行证据严格分层：

```text
Dataset
  -> Managed Skill identity(repositoryId, skillId)

Rubric/Curation operation
  -> Released Version
  -> Runtime-specific verified Installation
  -> frozen commit, digest, provider, path and verification
```

Client 只提交 Dataset、Version、Runtime 和会话 ID。路径、commit、digest、provider 和安装 Job 由后端可信解析。

新产生的 Raw Case 应记录足够的 Managed Skill/Version/Installation 来源证据。Legacy Raw Case 只允许在其路径和 Runtime 能唯一解析到可信安装时迁移；无候选或多候选时保持未绑定并要求显式处理，不按名称猜测。

## 10. Core API 边界

在 DSH Application 的现有 JSON request boundary 上增加与 Electron 语义一致的方法：

- `curation.list`、`curation.listArchived`、`curation.get`
- `curation.createFromRawCase`
- `curation.send`、`curation.retry`、`curation.archive`、`curation.discard`
- `curation.updateModel`、`curation.updateEffort`
- `rubrics.listVersions`、`rubrics.active`、`rubrics.listSessions`、`rubrics.getSession`
- `rubrics.create`、`rubrics.send`、`rubrics.retry`、`rubrics.publish`、`rubrics.discard`
- `rubrics.updateModel`、`rubrics.updateEffort`

所有 mutation 进入现有序列化 mutation queue。创建操作使用 idempotency key；重复请求必须返回原结果或拒绝不同 payload 复用同一 key。

前台活动 Session 使用有条件轮询读取状态；关闭工作台或切换 Session 时立即 abort。Core 已有 `onChanged` 发布仍服务 Host/Worker，不为本轮引入第二套长连接协议。

## 11. 错误处理与恢复

- 未绑定 Managed Skill：引导到 Dataset 绑定或 Skill 管理。
- Version 不属于 Dataset Skill、未 Released 或已 Deprecated：拒绝创建任务。
- 来源 Runtime 不可用：保留 Raw Case，不创建 Draft。
- Runtime 缺少可信安装、marker/digest 漂移：引导检查或重新安装，不自动覆盖。
- Dataset 无 Published Rubric：提供前往“评分标准”的直接操作。
- Draft/Rubric Agent 失败：保留 Session、最后有效 Draft 和对话，允许 retry 或 discard。
- 保存前 Dataset Skill 或 active Rubric 已变化：拒绝旧快照保存，要求重新确认或重新生成。
- 网络请求取消或工作台关闭：只取消 Client 等待，不隐式取消后台 Agent Session。

## 12. 前端组件边界

- `RollingSkillLauncher`：侧栏按钮、折叠态可访问标签和覆盖层开关。
- `WorkbenchShell`：覆盖层、主导航、刷新与关闭，不承载业务请求。
- `RawCaseInboxPanel`：Raw Case 条件、Dataset 选择和 Draft 创建。
- `CurationWorkspace`：来源、Draft 预览、对话、保存与丢弃。
- `RubricWorkspace`：Published/History、Agent Session、修订与发布。
- 现有 Dataset、Case、Skill、Evaluation、Automatic、Operator 和 Optimization panels 迁入 shell，按需小幅适配，不重写业务逻辑。
- `PluginSettingsSection`：设置页中的低频配置与导入。

组件通过窄 API hooks 调用 Core，避免把所有状态继续堆进一个 Workbench 文件。

## 13. 打包设计与体积策略

DSH 包继续是标准 Cordis Host/Client 插件：

- `main` 指向 Host bundle。
- `dsh.client.platform` 保持 `web`。
- React 和 DSH UI 依赖保持 peer/host-provided。
- Shared Core、Manager 和必要 Worker 逻辑由 esbuild 打进插件 bundles。
- Electron App 和 Electron runtime 完全独立构建与安装。

2026-08-27 的本地基线：

- DSH `.tgz`：918,727 bytes，6 个打包条目。
- Electron `Rolling Skill.app`：约 290 MB。
- 本地 Electron runtime：约 296 MB。

不设置 2 MB 或其他固定上限。包检查改为验证内容边界并报告体积：

- 拒绝 `.app`、`Electron.framework`、Chromium、Electron executable、原生 runtime bundle 和意外的绝对路径。
- 输出 packed bytes、unpacked bytes、文件数和相对上次已知基线的变化，供评审判断。
- 体积增长本身不自动失败；引入禁止内容或破坏 DSH package contract 才失败。

即使工作台功能完整，它仍通过 `dsh plugin add` 安装并遵循 DSH Cordis contract，因此仍是插件包，不是内嵌桌面应用。

## 14. 测试与验证

所有新增行为按 RED -> GREEN：

- Core API method allowlist、mutation serialization、idempotency 和 JSON 边界。
- Raw Case 来源完整性、Managed Skill 一致性和可信安装解析。
- Draft 创建、修订、retry、保存、discard 及并发/陈旧快照拒绝。
- Rubric 生成、修订、contract 校验、publish 和版本历史。
- Dataset 保持 pathless managed identity；每个操作冻结 Runtime-specific evidence。
- Client source/component tests 覆盖独立 launcher、Settings 瘦身、按钮闸门和请求 payload 不含路径或摘要。
- 临时数据目录中的完整 Curation/Rubric 集成流程。
- `npm run test:dsh`、`npm run build:dsh`、tarball 内容检查和体积报告。
- 本机 web profile 强制更新插件后，用真实 DSH 浏览器检查独立入口、覆盖层、空状态和阻断提示。

Electron 归档分支继续使用自身完整测试、macOS App 构建和签名验证；本设计不把两套前端合并成一个产物。

## 15. 交付顺序

1. 在 `main` 按本设计补齐 DSH 工作台和 Core API，完成测试、打包、强制安装和浏览器检查。
2. 推送 `main`。
3. 切换到既有 `archive/electron-before-dsh-plugin-20260826`，完成此前批准的 Managed Skill Dataset 修复。
4. 构建、签名并安装 Electron App，推送归档分支。
5. 两个产品数据目录继续隔离；不移动或删除用户数据。

## 16. 验收标准

- Rolling Skill 在 DSH 侧栏有独立入口，完整工作台不再位于 Settings 弹窗。
- Settings 只显示插件级配置、导入和诊断。
- 用户能从具备完整来源的 Raw Case 创建 Draft、通过对话修改并保存为 Case 或丢弃。
- 用户能为 Dataset 生成/修订 Rubric、通过对话调整并发布新版本。
- Dataset 永久只绑定 Managed Skill identity；Version 和安装路径只作为操作级冻结证据。
- 所有阻断在创建任务前给出可操作原因，不产生半成品 Session。
- DSH tarball 不包含 Electron/Chromium/.app，包检查报告实际体积但无任意硬上限。
- DSH 插件与 Electron App 分别通过测试、构建、安装和本机检查。
