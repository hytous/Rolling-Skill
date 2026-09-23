# Rolling Skill

Rolling Skill 是面向 Agent Skill 的评测与持续优化工作台。它把真实任务整理成可重复运行的数据集，在实际 Agent Runtime 中执行回归，并结合任务评分和执行轨迹迭代 Skill。

如果你已经写好了一个 Skill，但还需要判断它是否稳定触发、能否完成不同任务，以及一次修改有没有引入回归，Rolling Skill 可以帮助你建立这套验证流程。

工作台以 **DeepSeek Harness（DSH）插件**运行，支持中文、英文及 Harness 主题，可接入 CodeBuddy、Codex 和 DSH Runtime。

## 核心能力

- **从真实任务积累评测集**：手工录入问题，或从会话中提取任务、回答和证据；审核后保存为 Case，按 Dataset 管理，也可更新因工具或数据变化而失效的案例。
- **按任务目标评测 Skill**：维护对应的评分标准，由评测 Agent 结合回答与执行轨迹逐项判断；校验证据引用，并用权重、扣分项和关键失败规则汇总结果。
- **在真实 Runtime 中回归**：接入 CodeBuddy ACP、Codex app-server 和 DSH HTTP/WebSocket，记录实际执行结果、Skill 触发证据、工具调用和耗时，不额外强制加载 Skill 来改变触发结果。
- **管理可追溯的 Skill 版本**：通过 Git 管理 Skill 仓库、候选版本、发布版本和安装记录，让评测结果对应到明确的版本。
- **自动生成并比较候选**：基于评测反馈迭代 Skill，支持随机反馈多候选搜索、同一候选的多 Worker 回归、Pareto 非支配筛选和评分向量多样性选择。
- **保留操作边界**：限制 Agent 可访问的资源、操作权限和迭代次数，支持停止、恢复及最终发布审批；无法确认安装恢复状态时，保留现场供人工处理。

## 一次优化如何进行

1. **建立基线**：选择 Skill、评测集和目标 Runtime，对当前版本运行完整回归。
2. **生成候选**：从父版本的失败反馈中随机抽取案例，同时保留少量通过案例作为对照，交给 Agent 修改 Skill。不同候选看到的反馈可以重叠，但不必完全相同。
3. **验证修改**：候选版本依次安装；每个候选都运行相同的完整评测集。同一候选内可使用多个 Worker 并行执行 Case，执行完成后由独立评分队列评测。
4. **选择后续版本**：先排除结果不完整、质量低于基线或新增关键失败的候选，再按质量和可用成本指标进行非支配排序；结合逐项评分向量距离选择后续父版本。
5. **审核发布**：从历史候选中选出发布版本，展示与基线的比较，等待最终人工审批。如果没有更好的候选，就保留基线。

随机反馈多候选搜索是可选模式，默认关闭。默认每组生成 3 个候选、保留最多 2 个活跃父版本；候选总量由迭代上限控制。这里使用非支配排序和评分向量距离，不是 NSGA-II。

配置、评分向量计算、版本清理及恢复规则见 [多候选搜索指南](docs/sampled-candidate-search.md)。

## 快速开始

### 环境要求

- Node.js 22 或更高版本，以及 Git。
- 已安装 DeepSeek Harness；插件的 DSH peer dependency 为 `^0.1.1-rc.1`，需使用兼容版本。
- 至少一个已安装并完成必要登录配置的 CodeBuddy、Codex 或 DSH Runtime。

Rolling Skill 不捆绑、下载或升级 Runtime，使用的是你本机选择的 Runtime 和模型配置。

### 从源码安装

在终端执行：

```bash
git clone https://github.com/hytous/Rolling-Skill.git
cd Rolling-Skill
npm ci --ignore-scripts
npm ci --prefix desktop/rolling-skill --ignore-scripts
node -e "require('node:fs').mkdirSync('packages/rolling-skill-dsh/dist', { recursive: true })"
npm pack --workspace @rolling-skill/dsh-plugin --pack-destination packages/rolling-skill-dsh/dist
```

共享 Core 仍复用 `desktop/rolling-skill` 下的模块，因此需要安装该目录的依赖；`--ignore-scripts` 避免下载 Electron。`npm pack` 会自动构建插件，不需要启动桌面 App。

以下以仓库当前包版本 `0.1.70` 为例；版本变化时，请使用打包命令输出的实际文件名：

```bash
node packages/rolling-skill-dsh/scripts/inspect-package.mjs packages/rolling-skill-dsh/dist/rolling-skill-dsh-plugin-0.1.70.tgz
dsh plugin --profile web add ./packages/rolling-skill-dsh/dist/rolling-skill-dsh-plugin-0.1.70.tgz
dsh web --no-open
```

打开 DSH Web 界面，从侧栏底部进入 **Rolling Skill Workbench**。首次使用建议：

1. 在设置中选择 Runtime，以及案例整理、评分标准生成和评测使用的模型配置。
2. 导入受管 Skill 仓库，发布一个基线版本并安装到目标 Runtime。
3. 创建并绑定 Dataset，准备 Case 和评分标准，先运行一次评测确认配置。
4. 进入优化页面选择 Skill、Dataset、Runtime 和迭代上限；需要时启用随机反馈多候选搜索。

更新、卸载、后台自动沉淀和旧数据导入见 [插件使用文档](packages/rolling-skill-dsh/README.md)。本地打包不代表该版本已发布到公共 npm。

## 使用边界

- **并发需显式开启**：多候选搜索中的 `caseWorkers` 默认为 1，每个 Runtime 可设为 1–8。不同候选仍串行切换，普通独立评测不会自动使用该并发设置。
- **工作目录隔离不等于外部资源隔离**：并行 Case 使用独立客户端和工作目录，但数据库、远端 API 及外部文件是否冲突，需要由任务本身保证。
- **Token 成本依赖实际统计**：当前并非所有 Runtime 都提供完整 Token 遥测。只有参与比较的版本都有可靠统计时，Token 才进入筛选目标；未知成本不会按零计算。耗时指标同样要求完整记录。
- **评分不是客观真值**：证据引用校验和关键失败规则约束评分流程，但不能消除模型判断误差。建议保留人工审核过的评测集，检查关键案例的评分理由和执行证据。
- **迭代不保证提升**：随机反馈用于提供不同观察子集，不能保证候选修改一定不同或一定更好。是否发布应以回归结果和人工审批为准。

## 数据与隐私

默认数据目录为 `~/.dsh/rolling-skill`，普通更新和卸载不会删除数据。评测和优化会通过你选择的 Runtime 调用模型及工具；发送到外部服务的内容取决于 Runtime、模型和工具配置。使用真实业务案例前，应确认相应的数据使用权限。

Git 候选版本、执行轨迹和 Case 工作目录用于追溯结果；它们不等同于会自动清理的临时缓存。

## 开发与文档

完成上面的依赖安装后：

```bash
npm run test:dsh
npm run build:dsh
```

部分测试依赖 POSIX 文件权限或符号链接权限，在 Windows 上可能失败；请区分环境限制与功能回归，不要为通过测试放宽数据保护检查。

| 目录 | 内容 |
| --- | --- |
| `packages/rolling-skill-dsh` | DSH 插件、工作台界面、后台 Worker 与安装文档 |
| `packages/rolling-skill-core` | Host 共用的应用与业务服务 |
| `desktop/rolling-skill/src` | 共享的 Runtime 适配、评测、版本管理与优化模块 |
| `docs/sampled-candidate-search.md` | 多候选搜索配置、算法与限制 |

当前主要维护 DSH 插件与共享 Core。`desktop` 目录中的旧桌面界面不作为当前安装入口，其中的共享模块继续被插件复用。

## 许可证

见 [LICENSE](LICENSE)，包含 MIT 条款及已有版权声明。
