# Rolling Skill DeepSeek Harness 插件化设计

日期：2026-08-26  
状态：已完成对话设计确认，待书面规格审阅

## 1. 背景

Rolling Skill 当前是 macOS Electron 应用，已经具备 Case、Raw Case、Dataset、Rubric、Skill 管理、Skill 评测、多 Runtime、自操作、优化、Case 更新与自动沉淀能力。DeepSeek Harness 0.1.1-rc.1 提供基于 Cordis 的可安装 Profile Bundle、Host 服务、Client Slot、Web API 与插件包管理能力，可以成为 Rolling Skill 的新宿主。

当前 Electron 完整版本固定保存在分支 `archive/electron-before-dsh-plugin-20260826`，对应提交 `d9e6a27b60d957ded0b33765c0cc321b265175d5`。后续开发继续直接在 `main` 进行，不创建 feature 分支、worktree 或子 Agent。

## 2. 目标

- 将 Rolling Skill 交付为一个可由 DeepSeek Harness 一条命令安装的 npm 兼容包。
- 在 Harness 内提供原生中文/英文工作台，复用 Harness 的主题、语言和控件体系。
- 保留现有 Case、Dataset、Raw Case、Rubric、评测、Skill、Runtime、自操作、优化和 Case 生命周期能力。
- 将业务逻辑整理为宿主无关的 Rolling Skill Core，供 DSH Host 和后台 Worker 复用。
- 第一版包含 Harness 关闭后仍可按日或周执行的完全自动沉淀模式。
- 支持通过公共 npm、腾讯 npm 软件源、腾讯普通文件源、Git 或本地 tarball 分发。
- 插件升级、卸载和重装不得默认删除用户数据。

## 3. 非目标

- 不把 Electron 进程作为插件运行时或插件依赖。
- 不通过 iframe 或另开 Rolling Skill 网页复用旧 Renderer。
- 不一次性把稳定的 CommonJS 业务模块全部重写成 TypeScript。
- 不在 npm `postinstall` 阶段静默注册系统后台任务。
- 不要求用户同时安装或启动 Electron App。
- 不把 Harness 的会话内提醒机制当作无人值守系统调度器。

## 4. 已选方案

采用“原生 DSH 插件 + 内置共享 Core + 可独立唤醒 Worker”。

```text
DeepSeek Harness Client
  └─ Rolling Skill 原生工作台
           │ JSON RPC
DeepSeek Harness Host Plugin
           │
           ├──────────────┐
           ▼              ▼
Rolling Skill Core   Runtime Adapters
           ▲
           │
rolling-skill-worker
           ▲
           │
OS Scheduler
```

这里的共享 Core 是普通 Node.js 业务引擎，不是服务器、第二个 App 或远程服务。最终用户只安装并看到一个 DSH 插件包。共享发生在 DSH Host 与后台 Worker 之间，Electron 归档版不参与运行。

### 4.1 未选方案

**Electron 套壳**：由插件启动现有 Electron 主进程或本地 Web 服务。虽然改动少，但安装重、生命周期复杂、界面割裂，因此拒绝。

**全部重写为 Cordis 服务**：可以实现，但会把存储、评测和后台逻辑绑定到仍处于 RC 阶段的 Harness 接口；Harness 关闭后 Worker 也无法取得 Host 服务。该方案改写面和回归风险高，因此拒绝。

## 5. 源码和发布结构

源码采用两个清晰边界，发布时构建成一个最终包：

```text
packages/
  rolling-skill-core/
    src/
    test/
  rolling-skill-dsh/
    src/host/
    src/client/
    src/worker/
    src/scheduler/
    cordis.patch.yml
    package.json
```

- `rolling-skill-core` 在源码仓库中保持独立、可单测，但作为私有工作区包，不要求用户单独安装。
- `rolling-skill-dsh` 构建时把 Core 包入最终产物。
- 最终发布名暂定 `@rolling-skill/dsh-plugin`；进入腾讯软件源时可改为实际分配的 scope，例如 `@tencent/rolling-skill-dsh`。
- 包声明 `dsh.bundle.patch`、Host 入口、`./client` 入口和 `bin/rolling-skill-worker`。

用户安装形式：

```bash
dsh plugin --profile web add @rolling-skill/dsh-plugin
```

Harness 会把包加入 `~/.dsh/profiles/web/package.json` 的依赖和 `dsh.profile.bundles`，下次启动 `dsh web` 时加载插件。

## 6. Rolling Skill Core

Core 负责业务规则和持久状态，不依赖 Electron、IPC、BrowserWindow、DOM 或 DSH Slot：

- Case、Dataset、Raw Case 和 Rubric 存储。
- Case Draft、校准、刷新、批量刷新与删除回收。
- 评测运行、Trace 证据、Judge、评分与运行记录。
- Managed Skill、Git 版本、发布与安装任务。
- Runtime Registry 与 Codex、CodeBuddy、DeepSeek Harness adapter。
- 自动对话发现、问题边界、候选分类、Raw Case 和自动保存闸门。
- 自操作、优化任务和持久 Job 状态。

第一阶段移动现有模块并保持行为；只对 Electron 注入点做接口化。CommonJS 模块可以继续存在，新增边界使用明确的 factory 和依赖注入。稳定后再按收益逐步迁移 TypeScript，而不是把语言迁移作为插件化前置条件。

Core 不直接决定界面语言、主题、系统调度器或 DSH Slot。

## 7. DSH Host 插件

Host 插件运行在 Harness Node.js 进程，负责：

- 初始化 `~/.dsh/rolling-skill` 数据目录和 Core。
- 将当前 Harness 会话能力适配为 Core 可读取的对话源。
- 向 Client 暴露包私有 JSON RPC；只传 JSON 标量和业务 DTO，不传 Cordis 活对象。
- 订阅 Harness 会话与生命周期事件，刷新状态但不重复复制完整 Conversation Snapshot。
- 暴露模型可调用的 Rolling Skill 工具，例如创建 Raw Case、触发 Draft、启动评测和读取运行状态。
- 在 Harness 运行期间执行非完全自动模式的调度和启动补偿。
- 完全自动模式启用时把定时触发权交给 OS Scheduler，Host 只展示和编辑配置。

Host 停止或插件更新时必须释放事件、RPC、定时器、Runtime 子进程和存储句柄。

## 8. DSH Client 工作台

Client 使用 React + TypeScript 构建，并注册到 Harness 当前公开的 Slot。DeepSeek Harness 0.1.1-rc.1 已公开 `settings.section`，可为一个功能提供完整页面；第一版将 Rolling Skill 作为独立 Settings Section，获得原生导航和完整内容区。若当前版本支持安全的附加式侧边栏入口，再增加快捷入口，但不替换整个 Sidebar 或根布局。

工作台保留以下模块：

- 概览
- Case / Raw Case / Dataset
- Rubric 与 Skill 评测
- Case 更新与批量更新
- Managed Skill 与 Runtime 安装
- 自动沉淀
- 自操作与优化
- 插件设置和后台状态

界面规则：

- 默认跟随 Harness locale，并提供“跟随 Harness / 简体中文 / English”。
- 中文和英文文案进入 DSH locale 注册，不直接复用 Electron DOM 翻译逻辑。
- 使用 Harness theme token、组件间距、按钮、下拉框、焦点和暗色模式。
- 不复制 Electron 全局 CSS；只保留与 Rolling Skill 信息层级有关的局部布局。
- Runtime 卡片继续显示完整名称、版本与路径，但改用 Harness 原生组件视觉。
- 长任务通过持久运行记录和轻量状态更新展示，不传递完整 reasoning。

## 9. 数据与迁移

默认数据目录：

```text
~/.dsh/rolling-skill/
  config.json
  evaluation-store.json
  automatic-capture-state.json
  raw-cases/
  managed-skills/
  traces/
  jobs/
  logs/
  locks/
```

- 插件代码位于 profile 的 `node_modules`，用户数据永远不写入插件安装目录。
- 更新和普通卸载保留数据。
- “卸载并清除数据”必须是独立、显式且带目标路径确认的操作。
- 首次启动检测旧 Electron 数据目录时提供一次性导入，默认复制并校验元数据，不移动或删除旧文件。
- 导入记录来源、时间和 schema；失败不修改 DSH 数据。

## 10. 完全自动模式

自动沉淀仍保留业务模式：

- `off`：关闭。
- `scheduled`：按计划发现问题，只进入 Raw Case。
- `automatic`：按计划发现问题，通过安全闸门后自动生成并保存 Case。

另增加执行位置：

- `while-harness-running`：由 Host 定时器和启动补偿执行。
- `always`：由 OS Scheduler 唤醒 Worker，即使 Harness 已关闭。

### 10.1 Worker

`rolling-skill-worker` 是一次性命令，不是常驻守护进程：

1. 读取配置和当前计划 slot。
2. 获取独占运行租约。
3. 发现配置的 Runtime，并启动所需的无界面 Host；DeepSeek Harness 使用 `--profile web --no-open --port 0`，不得打开浏览器。
4. 复用 Core 执行一次增量扫描。
5. 先保存 Raw Case，再提交扫描游标。
6. 在 `automatic` 模式执行既有置信度、Skill、Dataset、Rubric 和 Draft 安全闸门。
7. 写入最后成功或错误状态，释放租约并退出。

### 10.2 系统调度器

使用统一 `SchedulerAdapter`：

- macOS：LaunchAgent，第一版完整支持。
- Linux：systemd user service + timer；系统不支持 systemd 时显示明确降级状态。
- Windows：Task Scheduler。

注册、更新和移除只在用户显式开启、修改或关闭 `always` 时发生。npm 安装不得自动注册。调度命令使用 profile 下稳定的 `.bin/rolling-skill-worker` 路径，不指向 pnpm 版本化 store。

### 10.3 并发与幂等

- schedule slot 是稳定幂等键，同一 slot 最多完成一次。
- Host 与 Worker 共用文件租约；过期租约可在记录持有进程和时间后恢复。
- Raw Case 写入先于游标推进。
- Case 自动保存继续使用现有 compare-and-set 和 Draft 验证。
- 同时触发时未获得租约的一方正常退出，不把它记成失败。

## 11. 错误处理和可观测性

- 数据目录、Runtime、模型、凭据或调度器不可用时 fail closed，不推进对应游标。
- 每次 Worker 运行保存开始时间、结束时间、slot、Runtime、处理数量、结果和截断错误摘要。
- 完整日志保存在本地 `logs/`，UI 只展示必要摘要和“打开日志位置”。
- 插件升级后 Core schema 迁移采用临时文件和原子替换；迁移前创建可恢复备份。
- Scheduler 注册失败只关闭 `always` 执行位置，不自动把业务模式改成 `off`。
- Worker 崩溃后下次运行根据租约、slot 和游标恢复，不重复覆盖已有 Case。

## 12. 分发

发布产物为 npm 兼容包和同版本 `.tgz`：

- 公共 npm：直接按包名安装。
- 腾讯 npm 软件源：配置实际 registry 和 scope 后按包名安装。
- 腾讯普通文件源：上传 `.tgz`，通过 HTTPS tarball URL 安装。
- Git / 本地目录：用于开发和内测。

包内不得包含用户数据、模型凭据、内部绝对路径或 Electron 构建产物。版本使用 SemVer；Harness RC 兼容范围声明为 peer dependency，并在不兼容时给出明确启动错误。

## 13. 实施顺序

1. 建立工作区和 Core 边界，移动不依赖 Electron 的模块并保持行为。
2. 创建可安装 DSH Bundle、Host 生命周期和最小 Client Section。
3. 接通数据、Case、Dataset、Raw Case 和自动沉淀 API。
4. 接通评测、Skill、Runtime、自操作与优化 API 和界面。
5. 实现一次性 Worker、共享租约和 macOS LaunchAgent。
6. 实现 Linux/Windows SchedulerAdapter，并提供能力探测与降级。
7. 加入旧 Electron 数据导入、更新/卸载语义和发布脚本。
8. 生成本地 `.tgz`，通过 `dsh plugin --profile web add <tgz>` 做一次聚焦安装与启动检查。
9. 更新本机 DSH profile 安装，不重复执行无意义的全量验证。

## 14. 验收标准

- 一个外部用户可以用一条 `dsh plugin --profile web add ...` 命令安装。
- `dsh web` 中存在中文/英文 Rolling Skill 工作台，风格跟随 Harness。
- 插件不启动 Electron，也不额外打开 Rolling Skill 网页。
- 现有核心数据和运行能力通过 DSH Host 可用。
- 开启 `always` 后关闭 Harness，系统仍能在指定日/周时间唤醒 Worker。
- 同一 slot 不会因 Host、Worker 或重启重复沉淀。
- 更新或普通卸载插件后数据仍存在。
- npm 包和 `.tgz` 可放入腾讯软件源进行分发。

## 15. 回滚

- 插件化代码可从 `main` 回退，不影响 Electron 归档分支。
- 当前 Electron 完整版本始终可从 `archive/electron-before-dsh-plugin-20260826` 构建。
- 插件数据与安装代码分离，移除 Bundle 不删除数据。
- 禁用 `always` 会移除系统调度项，但保留配置、Case 和运行历史。

