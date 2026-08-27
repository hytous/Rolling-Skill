# Rolling Skill for DeepSeek Harness

Rolling Skill 是一个可安装到 DeepSeek Harness（DSH）的原生双语工作台，用于持续沉淀、更新和评测真实 Case。插件包含 Host、Client、一次性后台 Worker 和共享 Core，安装一个包即可使用。

## 要求

- DeepSeek Harness `0.1.1-rc.1` 或兼容版本；
- Node.js 22 或更高版本；
- 至少一个已安装、可被本机发现的 Codex、CodeBuddy 或 DSH Runtime。

界面跟随 Harness 的中文/英文设置和主题。插件不会安装、下载或升级 Runtime，也不会启动 Electron App 或额外打开浏览器网页。

## 安装与更新

从公共 npm 安装：

```bash
dsh plugin --profile web add @rolling-skill/dsh-plugin
```

从本地或下载好的 `.tgz` 安装：

```bash
dsh plugin --profile web add ./rolling-skill-dsh-plugin-0.1.0.tgz
```

通过 HTTPS 分发时，先下载再安装同一个 npm 兼容包：

```bash
curl -fL -o rolling-skill-dsh-plugin-0.1.0.tgz https://example.com/rolling-skill-dsh-plugin-0.1.0.tgz
dsh plugin --profile web add ./rolling-skill-dsh-plugin-0.1.0.tgz
```

腾讯 npm 软件源也可以托管此包。发布到实际的软件源后，为 `@rolling-skill` scope 配置企业提供的 registry，再使用相同的 `dsh plugin --profile web add @rolling-skill/dsh-plugin` 命令安装。软件源地址和登录方式以所属腾讯 npm 服务的配置为准。

更新时重新执行对应的 `add` 命令即可。启动 Harness：

```bash
dsh web --no-open
```

安装后从 Harness 侧栏底部打开独立的 Rolling Skill Workbench。日常的 Draft 审阅、Dataset / Case / Raw Case、评分标准、Managed Skill、安装、评测、自动沉淀、Operator 和 Optimization 都在工作台中；Settings 只保留默认 Runtime 与 Curator/Rubric/Judge Profile、数据诊断和旧版导入。

每条已完成的 Assistant 回复旁会出现“沉淀 Case”入口，不需要先切到工作台。创建后，Draft 来源区间使用 warning 色，保存成 Case 后使用 success 色；刷新和重新打开会话后标记仍从持久化证据恢复。手工 Raw Case 没有完整 Episode 时，可以从工作台把原问题原样派发到新的 DSH 原生会话，成功入队后才标记为 dispatched。

Dataset 只绑定受管 Repository/Skill 的稳定 ID，不保存 Runtime 安装路径。每次 Curation、Rubric、Evaluation、Installation 或 Optimization 操作再由 Host 解析并冻结 Released Version、Runtime、安装校验、commit 和 digest 作为该次操作证据。

## 完全自动沉淀

业务模式包括关闭、定时提取和完全自动；执行位置包括仅 Harness 运行时以及 Harness 关闭后仍运行。后者需要先选择完整 Runtime 身份，再在自动沉淀页显式安装系统调度器：

- macOS：LaunchAgent；
- Linux：systemd user timer；
- Windows：Task Scheduler。

固定调度标识为 `com.rolling-skill.dsh.capture`。Worker 只执行一个到期 slot，使用跨进程 lease 保证同一 slot 不重复完成；启动 DSH Runtime 时始终使用 `--profile web --no-open --port 0`。

## 数据与旧版导入

默认数据目录为 `~/.dsh/rolling-skill`。更新和普通卸载都会保留该目录；普通卸载会保留所有数据。

设置页可以显式导入归档 Electron 版的数据。导入采用 copy-only：先复制到 staging，校验已知 schema，再原子切换；不会修改或删除 Electron 源目录。导入成功后需要重启 Harness。

## 卸载

如果安装了系统调度器，先在 Rolling Skill 的自动沉淀页选择“移除系统调度器”，再卸载插件：

```bash
dsh plugin --profile web remove @rolling-skill/dsh-plugin
```

卸载不会删除 `~/.dsh/rolling-skill`。清除数据属于独立的破坏性操作，应在确认目录和备份后由用户自行执行。

## 开发打包

```bash
npm install
npm run build --workspace @rolling-skill/dsh-plugin
mkdir -p packages/rolling-skill-dsh/dist
npm pack --workspace @rolling-skill/dsh-plugin --pack-destination packages/rolling-skill-dsh/dist
node packages/rolling-skill-dsh/scripts/inspect-package.mjs packages/rolling-skill-dsh/dist/rolling-skill-dsh-plugin-0.1.0.tgz
```
